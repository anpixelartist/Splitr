// Firebase Secure Token API: swaps a person's stored refresh token for a
// short-lived ID token, which goes to Firestore as `Authorization: Bearer`.

import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';

export interface Env {
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER: OAuthHelpers;
  // Firebase web config: the same values as the app's VITE_FIREBASE_*.
  FIREBASE_API_KEY: string;
  FIREBASE_AUTH_DOMAIN: string;
  FIREBASE_PROJECT_ID: string;
  // Local development only, e.g. "127.0.0.1:9099" and "127.0.0.1:8080".
  FIREBASE_AUTH_EMULATOR_HOST?: string;
  FIRESTORE_EMULATOR_HOST?: string;
}

/** What each grant remembers about the person (encrypted by the OAuth library). */
export type Props = {
  uid: string;
  refreshToken: string;
  email?: string;
  name?: string;
};

// ─── Firebase Secure Token API ───────────────────────────────────────────────

export class FirebaseAuthError extends Error {
  /** The refresh token will never work again: the person must reconnect. */
  constructor(message: string, public readonly permanent: boolean) {
    super(message);
    this.name = 'FirebaseAuthError';
  }
}

export type IdToken = { idToken: string; refreshToken: string; uid: string; expiresAt: number; claims: Record<string, unknown> };

type AuthEnv = Pick<Env, 'FIREBASE_API_KEY' | 'FIREBASE_PROJECT_ID' | 'FIREBASE_AUTH_EMULATOR_HOST'>;

const decodeJwtPayload = (jwt: string): Record<string, unknown> => {
  const part = jwt.split('.')[1] ?? '';
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), c => c.charCodeAt(0))));
};

/**
 * Swaps a refresh token for a new ID token. The answer comes straight from
 * Google over TLS, so its claims are read without checking the signature;
 * Firestore verifies the token itself on every request.
 */
export async function exchangeRefreshToken(env: AuthEnv, refreshToken: string, fetchFn: typeof fetch = fetch): Promise<IdToken> {
  const base = env.FIREBASE_AUTH_EMULATOR_HOST
    ? `http://${env.FIREBASE_AUTH_EMULATOR_HOST}/securetoken.googleapis.com`
    : 'https://securetoken.googleapis.com';
  let res: Response;
  try {
    res = await fetchFn(`${base}/v1/token?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
    });
  } catch {
    throw new FirebaseAuthError('Could not reach Firebase sign-in. Try again in a moment.', false);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
    const code = body.error?.message ?? String(res.status);
    // TOKEN_EXPIRED, USER_DISABLED, USER_NOT_FOUND, INVALID_REFRESH_TOKEN…: gone for good
    const permanent = res.status === 400 || res.status === 401 || res.status === 403;
    throw new FirebaseAuthError(`Firebase sign-in failed (${code}).`, permanent);
  }
  const data = await res.json() as { id_token: string; refresh_token: string; expires_in: string; user_id: string };
  const claims = decodeJwtPayload(data.id_token);
  if (claims.aud !== env.FIREBASE_PROJECT_ID) {
    throw new FirebaseAuthError('This sign-in belongs to a different Firebase project.', true);
  }
  return {
    idToken: data.id_token,
    refreshToken: data.refresh_token || refreshToken,
    uid: data.user_id,
    expiresAt: Date.now() + Number(data.expires_in) * 1000,
    claims,
  };
}

export const signInProvider = (claims: Record<string, unknown>) =>
  (claims.firebase as { sign_in_provider?: string } | undefined)?.sign_in_provider;

// ID tokens last an hour. Keep them per isolate until 5 minutes before they
// expire, so a burst of tool calls costs one exchange.
const EARLY_MS = 5 * 60 * 1000;
export const idTokenCache = new Map<string, IdToken>();

export async function idTokenFor(env: AuthEnv, props: Props, fetchFn: typeof fetch = fetch): Promise<string> {
  const cached = idTokenCache.get(props.uid);
  if (cached && cached.refreshToken === props.refreshToken && cached.expiresAt - EARLY_MS > Date.now()) return cached.idToken;
  const fresh = await exchangeRefreshToken(env, props.refreshToken, fetchFn);
  if (fresh.uid !== props.uid) throw new FirebaseAuthError('This connection belongs to another account.', true);
  idTokenCache.set(props.uid, { ...fresh, refreshToken: props.refreshToken });
  return fresh.idToken;
}

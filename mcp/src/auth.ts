// Signing people in, and turning their stored Firebase refresh token into a
// fresh ID token for each tool call.
//
// The assistant runs OAuth against this Worker (@cloudflare/workers-oauth-provider).
// Our /authorize page signs the person in with Google through Firebase Auth,
// for the same Firebase project as the app, and posts the Firebase refresh
// token back here. It is stored in the grant's `props`, which the library
// encrypts with a key only the assistant's token can unwrap. On each tool
// call the refresh token is swapped for a short-lived ID token, which goes to
// Firestore as `Authorization: Bearer`, so firestore.rules apply unchanged.

import { OAuthError, AuthorizationError, CimdFetchError } from '@cloudflare/workers-oauth-provider';
import { FirebaseAuthError, exchangeRefreshToken, idTokenCache, signInProvider, type Env, type IdToken, type Props } from './token';

export type { Env, Props };

/** Used when the assistant refreshes its access token: drop grants whose Firebase sign-in is gone. */
export async function checkGrantOnRefresh(env: Env, props: Props): Promise<{ newProps: Props } | undefined> {
  try {
    const fresh = await exchangeRefreshToken(env, props.refreshToken);
    if (fresh.uid !== props.uid) throw new FirebaseAuthError('Account changed.', true);
    idTokenCache.set(props.uid, fresh);
    // Firebase normally returns the same refresh token; keep a rotated one
    return fresh.refreshToken !== props.refreshToken ? { newProps: { ...props, refreshToken: fresh.refreshToken } } : undefined;
  } catch (err) {
    if (err instanceof FirebaseAuthError && err.permanent) {
      throw new OAuthError('invalid_grant', { description: 'The Splitr sign-in was revoked. Connect again.' });
    }
    throw new OAuthError('temporarily_unavailable', { description: 'Firebase is unavailable.', statusCode: 503 });
  }
}

// ─── /authorize ──────────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

// Same major version as the app's `firebase` dependency.
const FIREBASE_SDK = 'https://www.gstatic.com/firebasejs/12.19.0';

function page(title: string, body: string, headers = new Headers(), status = 200): Response {
  headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Frame-Options', 'DENY');
  return new Response(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root { color-scheme: light dark; --bg: #f5f5f7; --card: #fff; --text: #1d1d1f; --muted: #6e6e73; --accent: #0a84ff; --border: #d2d2d7; --warn: #b25000; }
  @media (prefers-color-scheme: dark) { :root { --bg: #000; --card: #1c1c1e; --text: #f5f5f7; --muted: #a1a1a6; --border: #38383a; --warn: #ff9f0a; } }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100dvh; display: grid; place-items: center; padding: 16px; background: var(--bg); color: var(--text);
         font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif; }
  main { width: 100%; max-width: 420px; background: var(--card); border: 1px solid var(--border); border-radius: 20px; padding: 28px 24px; }
  h1 { font-size: 22px; margin: 0 0 8px; }
  p { margin: 0 0 12px; color: var(--muted); }
  strong { color: var(--text); }
  .warn { color: var(--warn); }
  button { width: 100%; font: inherit; font-weight: 600; padding: 12px 16px; border-radius: 12px; border: 1px solid var(--border); background: transparent; color: var(--text); cursor: pointer; margin-top: 8px; }
  button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  button:disabled { opacity: .6; cursor: default; }
  #error { color: #ff3b30; min-height: 1.5em; margin-top: 12px; }
</style>
</head>
<body><main>${body}</main></body>
</html>`, { status, headers });
}

const errorPage = (message: string, status = 400) =>
  page('Splitr connection', `<h1>Couldn't connect Splitr</h1><p>${esc(message)}</p><p>Close this window and start connecting again from your assistant.</p>`, undefined, status);

function consentPage(env: Env, client: { clientName: string; clientDomain?: string; redirectHost: string; redirectIsLoopback: boolean }, handle: string, headers: Headers): Response {
  const origin = client.clientDomain
    ? `Published by <strong>${esc(client.clientDomain)}</strong>.`
    : 'This app registered itself, so its name is not verified.';
  const config = {
    apiKey: env.FIREBASE_API_KEY,
    authDomain: env.FIREBASE_AUTH_DOMAIN,
    projectId: env.FIREBASE_PROJECT_ID,
  };
  // Inline JSON inside <script>: escape "<" so a value can't close the tag
  const json = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');
  return page('Connect Splitr', `
<h1>Connect Splitr to ${esc(client.clientName)}</h1>
<p>${origin} Access goes to <strong>${esc(client.redirectHost)}</strong>.</p>
${client.redirectIsLoopback ? '<p class="warn"><strong>This sends access to an app on this computer.</strong> Continue only if you just started connecting from it.</p>' : ''}
<p>It will see your Splitr groups, expenses and payments, with the same access you have in the app.</p>
<form id="f" method="post" action="/authorize">
  <input type="hidden" name="handle" value="${esc(handle)}">
  <input type="hidden" name="refresh_token" value="">
  <input type="hidden" name="decision" value="approve">
  <button type="button" id="google" class="primary">Sign in with Google to connect Splitr</button>
</form>
<form method="post" action="/authorize">
  <input type="hidden" name="handle" value="${esc(handle)}">
  <button type="submit" name="decision" value="deny">Cancel</button>
</form>
<p id="error" role="alert"></p>
<script type="module">
  import { initializeApp } from '${FIREBASE_SDK}/firebase-app.js';
  import { initializeAuth, inMemoryPersistence, browserPopupRedirectResolver, connectAuthEmulator, GoogleAuthProvider, signInWithPopup } from '${FIREBASE_SDK}/firebase-auth.js';
  const app = initializeApp(${json(config)});
  // Nothing is kept on this site: the sign-in only lives until the form is sent.
  const auth = initializeAuth(app, { persistence: inMemoryPersistence, popupRedirectResolver: browserPopupRedirectResolver });
  ${env.FIREBASE_AUTH_EMULATOR_HOST ? `connectAuthEmulator(auth, ${json(`http://${env.FIREBASE_AUTH_EMULATOR_HOST}`)}, { disableWarnings: true });` : ''}
  const form = document.getElementById('f');
  const button = document.getElementById('google');
  const error = document.getElementById('error');
  button.addEventListener('click', async () => {
    button.disabled = true;
    error.textContent = '';
    try {
      const { user } = await signInWithPopup(auth, new GoogleAuthProvider());
      form.refresh_token.value = user.refreshToken;
      form.submit();
    } catch (e) {
      const code = e && e.code || '';
      error.textContent = code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request'
        ? 'Sign-in was closed before it finished.'
        : code === 'auth/unauthorized-domain'
          ? 'Google sign-in is not enabled for ' + location.hostname + ' yet (auth/unauthorized-domain).'
          : code === 'auth/popup-blocked'
            ? 'Your browser blocked the sign-in window. Allow pop-ups for this page and try again.'
            : 'Google sign-in didn\\'t finish' + (code ? ' (' + code + ')' : '') + '. Please try again.';
      button.disabled = false;
    }
  });
</script>`, headers);
}

/** GET shows the consent + sign-in page; POST finishes or declines. */
export async function handleAuthorize(request: Request, env: Env): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  try {
    if (request.method === 'GET') {
      const authRequest = await oauth.parseAuthRequest(request);
      const details = await oauth.describeConsent(authRequest);
      const consent = await oauth.beginConsent(authRequest);
      return consentPage(env, details, consent.handle, consent.headers);
    }
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

    const form = await request.formData();
    const handle = String(form.get('handle') ?? '');
    if (form.get('decision') !== 'approve') {
      const denied = await oauth.denyConsent(request, handle);
      return new Response(null, { status: 302, headers: denied.headers });
    }

    // Check the sign-in before using up the consent handle
    let signedIn: IdToken;
    try {
      signedIn = await exchangeRefreshToken(env, String(form.get('refresh_token') ?? ''));
    } catch (err) {
      return errorPage(err instanceof Error ? err.message : 'Sign-in failed.');
    }
    if (signInProvider(signedIn.claims) === 'anonymous') {
      return errorPage('Guest accounts can\'t be connected. Open Splitr, go to Profile and sign in with Google first, then connect again.');
    }

    const approved = await oauth.approveConsent(request, handle);
    const props: Props = {
      uid: signedIn.uid,
      refreshToken: signedIn.refreshToken,
      email: signedIn.claims.email as string | undefined,
      name: signedIn.claims.name as string | undefined,
    };
    idTokenCache.set(props.uid, signedIn);
    const { redirectTo } = await oauth.completeAuthorization({
      request: approved.request,
      userId: props.uid,
      metadata: { label: props.email ?? props.uid },
      scope: approved.request.scope,
      props,
    });
    approved.headers.set('Location', redirectTo);
    return new Response(null, { status: 302, headers: approved.headers });
  } catch (err) {
    if (err instanceof AuthorizationError && err.redirectTo) return Response.redirect(err.redirectTo, 302);
    if (err instanceof AuthorizationError) return errorPage(err.description);
    if (err instanceof CimdFetchError) return errorPage('This assistant could not be verified.');
    throw err;
  }
}

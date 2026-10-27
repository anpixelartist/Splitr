// Test helpers: an in-memory stand-in for the Firestore REST API and the
// Secure Token API, and a way to call a tool over real MCP JSON-RPC.

import { createMcpHandler } from '@modelcontextprotocol/server';
import { encodeFields, decodeFields, type Doc } from '../src/firestore';
import { buildServer } from '../src/server';
import type { Env, Props } from '../src/token';

export const env: Env = {
  OAUTH_KV: undefined as never,
  OAUTH_PROVIDER: undefined as never,
  FIREBASE_API_KEY: 'test-key',
  FIREBASE_AUTH_DOMAIN: 'test.firebaseapp.com',
  FIREBASE_PROJECT_ID: 'test-project',
};

const b64url = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const fakeIdToken = (uid: string, aud = env.FIREBASE_PROJECT_ID, provider = 'google.com') =>
  `${b64url({ alg: 'none' })}.${b64url({ aud, user_id: uid, sub: uid, firebase: { sign_in_provider: provider } })}.sig`;

/**
 * A fake backend. `docs` maps paths ("groups/G1", "groups/G1/expenses/e1")
 * to plain objects. Reads are filtered like a member-only rule would: a
 * group's subcollections are readable only by its members.
 */
export function fakeBackend(docs: Record<string, Doc>, uid: string) {
  const calls: { method: string; url: string; body?: unknown }[] = [];
  const root = `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
  const raw = (path: string) => ({ name: `${root}/${path}`, fields: encodeFields(docs[path]) });
  const isMember = (gid: string) => ((docs[`groups/${gid}`]?.members as string[]) ?? []).includes(uid);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const denied = () => json({ error: { status: 'PERMISSION_DENIED', message: 'Missing or insufficient permissions.' } }, 403);

  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = init?.body ? (typeof init.body === 'string' ? JSON.parse(init.body) : Object.fromEntries(new URLSearchParams(String(init.body)))) : undefined;
    calls.push({ method: init?.method ?? 'GET', url: url.toString(), body });

    if (url.hostname === 'securetoken.googleapis.com') {
      return json({ id_token: fakeIdToken(uid), refresh_token: body.refresh_token, expires_in: '3600', user_id: uid });
    }
    const path = decodeURIComponent(url.pathname).replace(`/v1/${root}`, '').replace(/^\//, '');
    if (path === ':runQuery') {
      const value = body.structuredQuery.where.fieldFilter.value.stringValue;
      const hits = Object.keys(docs).filter(p => /^groups\/[^/]+$/.test(p) && (docs[p].members as string[]).includes(value));
      if (value !== uid) return denied();
      return json(hits.map(p => ({ document: raw(p) })));
    }
    if (path === ':commit') return json({ writeResults: [] });
    const segments = path.split('/');
    if (segments.length % 2 === 1) {
      // A collection: groups/{gid}/expenses
      if (!isMember(segments[1])) return denied();
      const prefix = `${path}/`;
      const children = Object.keys(docs).filter(p => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'));
      return json({ documents: children.map(raw) });
    }
    if (segments[0] === 'users' && segments[1] !== uid) return denied();
    if (!docs[path]) return json({ error: { status: 'NOT_FOUND', message: 'not found' } }, 404);
    return json(raw(path));
  }) as typeof fetch;

  return { fetch: fetchFn, calls, decode: decodeFields };
}

/** Calls one tool through the MCP HTTP handler and returns its text. */
export async function callTool(
  fetchFn: typeof fetch,
  props: Props,
  name: string,
  args: Record<string, unknown> = {},
  now?: number,
  withEnv: Env = env,
): Promise<{ text: string; isError: boolean }> {
  const realFetch = globalThis.fetch;
  const realNow = Date.now;
  globalThis.fetch = fetchFn;
  if (now !== undefined) Date.now = () => now;
  try {
    const handler = createMcpHandler(() => buildServer(withEnv, props));
    const res = await handler.fetch(new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2025-06-18',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    }));
    const raw = await res.text();
    // The response is JSON, or an SSE stream whose data line holds the JSON
    const payload = raw.trim().startsWith('{') ? raw : raw.split('\n').find(l => l.startsWith('data:'))!.slice(5);
    const msg = JSON.parse(payload);
    if (msg.error) throw new Error(`MCP error: ${JSON.stringify(msg.error)}`);
    return { text: msg.result.content.map((c: { text: string }) => c.text).join('\n'), isError: !!msg.result.isError };
  } finally {
    globalThis.fetch = realFetch;
    Date.now = realNow;
  }
}

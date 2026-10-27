import { describe, expect, it } from 'vitest';
import { decodeFields, encodeFields, Firestore } from '../../src/firestore';
import { exchangeRefreshToken, idTokenFor, FirebaseAuthError } from '../../src/token';
import { fuzzyFind } from '../../src/group';
import { env, fakeIdToken } from '../helpers';

describe('Firestore value encoding', () => {
  it('round-trips the shapes the app stores', () => {
    const doc = {
      description: 'Dinner', amount: 1200, share: 33.34, ok: true, none: null,
      splits: [{ userId: 'u1', amount: 600.5 }], memberNames: { u1: 'Asha' },
    };
    const fields = encodeFields(doc);
    expect(fields.amount).toEqual({ integerValue: '1200' }); // like the JS SDK
    expect(fields.share).toEqual({ doubleValue: 33.34 });
    expect(decodeFields(fields)).toEqual(doc);
  });

  it('reads server timestamps as milliseconds', () => {
    expect(decodeFields({ recordedAt: { timestampValue: '2026-10-27T12:00:00.000Z' } }))
      .toEqual({ recordedAt: Date.parse('2026-10-27T12:00:00.000Z') });
  });

  it('writes server timestamps and create-only preconditions in a commit', async () => {
    let sent: { writes: unknown[] } | undefined;
    const fetchFn = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return new Response('{}');
    }) as unknown as typeof fetch;
    await new Firestore({ projectId: 'p', idToken: 't', fetch: fetchFn }).commit([
      { path: 'groups/G/settlements/s1', data: { amount: 5 }, mustNotExist: true, serverTime: ['recordedAt'] },
    ]);
    expect(sent!.writes[0]).toEqual({
      update: { name: 'projects/p/databases/(default)/documents/groups/G/settlements/s1', fields: { amount: { integerValue: '5' } } },
      currentDocument: { exists: false },
      updateTransforms: [{ fieldPath: 'recordedAt', setToServerValue: 'REQUEST_TIME' }],
    });
  });

  it('sends the user\'s ID token on every request', async () => {
    let auth = '';
    const fetchFn = (async (_url: string, init: RequestInit) => {
      auth = new Headers(init.headers).get('Authorization') ?? '';
      return new Response(JSON.stringify({ name: 'x/users/u1', fields: {} }));
    }) as unknown as typeof fetch;
    await new Firestore({ projectId: 'p', idToken: 'the-id-token', fetch: fetchFn }).get('users/u1');
    expect(auth).toBe('Bearer the-id-token');
  });
});

describe('ID tokens', () => {
  const tokenResponse = (uid: string, aud?: string) => (async () => new Response(JSON.stringify({
    id_token: fakeIdToken(uid, aud), refresh_token: 'rt', expires_in: '3600', user_id: uid,
  }))) as unknown as typeof fetch;

  it('rejects tokens from another Firebase project', async () => {
    await expect(exchangeRefreshToken(env, 'rt', tokenResponse('u1', 'other-project'))).rejects.toThrow(FirebaseAuthError);
  });

  it('treats a revoked refresh token as permanent', async () => {
    const revoked = (async () => new Response(JSON.stringify({ error: { message: 'TOKEN_EXPIRED' } }), { status: 400 })) as unknown as typeof fetch;
    await expect(exchangeRefreshToken(env, 'rt', revoked)).rejects.toMatchObject({ permanent: true });
  });

  it('caches the ID token between calls', async () => {
    let n = 0;
    const counting = (async (...a: Parameters<typeof fetch>) => { n++; return tokenResponse('cache-user')(...a); }) as typeof fetch;
    const props = { uid: 'cache-user', refreshToken: 'rt' };
    const first = await idTokenFor(env, props, counting);
    expect(await idTokenFor(env, props, counting)).toBe(first);
    expect(n).toBe(1);
  });

  it('refuses a refresh token that belongs to someone else', async () => {
    await expect(idTokenFor(env, { uid: 'alice', refreshToken: 'rt-bob' }, tokenResponse('bob'))).rejects.toThrow('another account');
  });
});

describe('fuzzyFind', () => {
  const people = [{ id: 'u1', name: 'Priya Sharma' }, { id: 'u2', name: 'Priyanka' }, { id: 'p1', name: 'José' }];
  const find = (q: string) => fuzzyFind(people, q, p => p).map(p => p.id);
  it('prefers exact matches, then prefixes, then words', () => {
    expect(find('priya sharma')).toEqual(['u1']);
    expect(find('priya')).toEqual(['u1', 'u2']); // ambiguous: both start with it
    expect(find('sharma')).toEqual(['u1']);
    expect(find('jose')).toEqual(['p1']); // accents don't matter
    expect(find('u2')).toEqual(['u2']); // an id works too
    expect(find('nobody')).toEqual([]);
  });
});

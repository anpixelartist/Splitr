// Runs against the Firebase Auth + Firestore emulators with the real
// firestore.rules: `npm run test:integration` (needs Java for the emulator).
// Proves the connector can only see and change what the signed-in person can.

import { beforeAll, describe, expect, it } from 'vitest';
import { Firestore, FirestoreError } from '../../src/firestore';
import { exchangeRefreshToken, idTokenFor, signInProvider, type Env, type Props } from '../../src/token';
import { callTool } from '../helpers';

const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const FIRESTORE = process.env.FIRESTORE_EMULATOR_HOST;
const PROJECT = 'demo-splitr';

const env: Env = {
  OAUTH_KV: undefined as never,
  OAUTH_PROVIDER: undefined as never,
  FIREBASE_API_KEY: 'demo-key',
  FIREBASE_AUTH_DOMAIN: '127.0.0.1',
  FIREBASE_PROJECT_ID: PROJECT,
  FIREBASE_AUTH_EMULATOR_HOST: AUTH,
  FIRESTORE_EMULATOR_HOST: FIRESTORE,
};

const run = Math.random().toString(36).slice(2, 8).toUpperCase();
const MINE = `M${run}`;   // Alice's group
const THEIRS = `T${run}`; // Bob's group: Alice is not a member

async function signUp(email?: string) {
  const res = await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(email ? { email, password: 'secret-123', returnSecureToken: true } : { returnSecureToken: true }),
  });
  const data = await res.json() as { localId: string; refreshToken: string };
  return { uid: data.localId, refreshToken: data.refreshToken };
}

// "Bearer owner" bypasses the rules in the emulator: only for seeding.
const admin = new Firestore({ projectId: PROJECT, idToken: 'owner', emulatorHost: FIRESTORE });

async function asUser(p: Props) {
  return new Firestore({ projectId: PROJECT, idToken: await idTokenFor(env, p), emulatorHost: FIRESTORE });
}

const expense = (gid: string, id: string, by: string) => ({
  id, groupId: gid, description: 'Dinner', amount: 90, paidBy: by,
  splits: [{ userId: by, amount: 45 }, { userId: 'p1', amount: 45 }],
  createdBy: by, createdAt: new Date().toISOString(),
});

let alice: Props;
let bob: Props;

describe.skipIf(!AUTH || !FIRESTORE)('connector against the emulators', () => {
  beforeAll(async () => {
    alice = { ...(await signUp(`alice-${run}@example.com`)), name: 'Alice' };
    bob = { ...(await signUp(`bob-${run}@example.com`)), name: 'Bob' };
    const group = (gid: string, name: string, owner: Props) => ({
      id: gid, name, members: [owner.uid], admins: [owner.uid], createdBy: owner.uid,
      memberNames: { [owner.uid]: owner.name }, participants: [{ id: 'p1', name: 'Rahul' }],
      currency: 'INR', createdAt: new Date().toISOString(),
    });
    await admin.commit([
      { path: `groups/${MINE}`, data: group(MINE, `Alice Trip ${run}`, alice) },
      { path: `groups/${MINE}/expenses/a1`, data: expense(MINE, 'a1', alice.uid) },
      { path: `groups/${THEIRS}`, data: group(THEIRS, `Bob Secret ${run}`, bob) },
      { path: `groups/${THEIRS}/expenses/b1`, data: expense(THEIRS, 'b1', bob.uid) },
    ]);
  });

  it('lists only my groups and computes balances from real data', async () => {
    const { text } = await callTool(fetch, alice, 'list_groups', {}, undefined, env);
    expect(text).toContain(`Alice Trip ${run} (code ${MINE}) · INR · 2 people · you are owed ₹45.00`);
    expect(text).not.toContain(THEIRS);
  });

  it("won't open someone else's group by name or code", async () => {
    for (const group of [THEIRS, `Bob Secret ${run}`]) {
      const { text, isError } = await callTool(fetch, alice, 'get_group_summary', { group }, undefined, env);
      expect(isError).toBe(true);
      expect(text).not.toContain('Dinner');
    }
  });

  it("can't read another group's expenses or payments, even asking Firestore directly", async () => {
    const db = await asUser(alice);
    for (const col of ['expenses', 'settlements']) {
      const err = await db.list(`groups/${THEIRS}/${col}`).catch(e => e);
      expect(err).toBeInstanceOf(FirestoreError);
      expect((err as FirestoreError).permissionDenied).toBe(true);
    }
    // ...and can't list groups as someone else
    await expect(db.whereArrayContains('groups', 'members', bob.uid)).rejects.toMatchObject({ permissionDenied: true });
  });

  it("can't write into another group", async () => {
    const db = await asUser(alice);
    const writes = [
      { path: `groups/${THEIRS}/expenses/x1`, data: { ...expense(THEIRS, 'x1', alice.uid) }, mustNotExist: true },
      {
        path: `groups/${THEIRS}/settlements/x2`,
        data: { id: 'x2', groupId: THEIRS, from: alice.uid, to: bob.uid, amount: 10, recordedBy: alice.uid, createdAt: new Date().toISOString(), status: 'pending' },
        mustNotExist: true, serverTime: ['recordedAt'],
      },
      // Renaming is admin-only. (Adding yourself to `members` is allowed by
      // the rules on purpose: the group code is the invite. No tool joins.)
      { path: `groups/${THEIRS}`, data: { name: 'Hacked' }, updateFields: ['name'] },
    ];
    for (const w of writes) {
      await expect(db.commit([w])).rejects.toMatchObject({ permissionDenied: true });
    }
    expect((await admin.list(`groups/${THEIRS}/expenses`)).map(d => d.id)).toEqual(['b1']);
  });

  it('writes in my own group pass the rules with the app\'s exact field shapes', async () => {
    const db = await asUser(alice);
    await db.commit([{ path: `groups/${MINE}/expenses/a2`, data: expense(MINE, 'a2', alice.uid), mustNotExist: true }]);
    // A payment to a name-only person: confirmed from the start (initialStatus), server time stamp
    await db.commit([{
      path: `groups/${MINE}/settlements/s1`,
      data: { id: 's1', groupId: MINE, from: 'p1', to: alice.uid, amount: 45, recordedBy: alice.uid, createdAt: new Date().toISOString(), status: 'confirmed' },
      mustNotExist: true, serverTime: ['recordedAt'],
    }]);
    const saved = await db.get(`groups/${MINE}/settlements/s1`);
    expect(typeof saved?.recordedAt).toBe('number');
  });

  it('the write tools save what the rules accept, and only the receiver can confirm', async () => {
    const SHARED = `S${run}`;
    await admin.commit([
      { path: `groups/${SHARED}`, data: {
        id: SHARED, name: `Shared ${run}`, members: [alice.uid, bob.uid], admins: [bob.uid], createdBy: bob.uid,
        memberNames: { [alice.uid]: 'Alice', [bob.uid]: 'Bob' }, currency: 'JPY', createdAt: new Date().toISOString(),
      } },
    ]);
    const tool = (who: Props, name: string, args: Record<string, unknown>) => callTool(fetch, who, name, { group: SHARED, ...args }, undefined, env);

    const added = await tool(bob, 'add_expense', { description: 'Ramen', amount: 3001 });
    expect(added.isError).toBe(false);
    expect(added.text).toContain('- Alice: ¥1,501');
    expect(added.text).toContain('- you: ¥1,500');

    const paid = await tool(alice, 'record_payment', { to: 'Bob', amount: 1000 });
    expect(paid.text).toContain('pending');
    const id = paid.text.match(/Payment id (\S+)\./)![1];
    const saved = await admin.get(`groups/${SHARED}/settlements/${id}`);
    expect(saved).toMatchObject({ from: alice.uid, to: bob.uid, amount: 1000, recordedBy: alice.uid, status: 'pending' });
    expect(typeof saved?.recordedAt).toBe('number');

    // Alice can't confirm her own payment: the tool says so, and so do the rules
    expect((await tool(alice, 'confirm_payment', { payment_id: id })).isError).toBe(true);
    const db = await asUser(alice);
    await expect(db.commit([{
      path: `groups/${SHARED}/settlements/${id}`, data: { status: 'confirmed', decidedBy: alice.uid },
      updateFields: ['status', 'decidedBy'], serverTime: ['decidedAt'],
    }])).rejects.toMatchObject({ permissionDenied: true });

    const confirmed = await tool(bob, 'confirm_payment', { payment_id: id });
    expect(confirmed.text).toContain('Confirmed');
    expect(await admin.get(`groups/${SHARED}/settlements/${id}`)).toMatchObject({ status: 'confirmed', decidedBy: bob.uid });
    expect((await tool(alice, 'get_group_summary', {})).text).toContain('You pay Bob ¥501');
  });

  it('sees guest (anonymous) accounts for what they are', async () => {
    const guest = await signUp();
    const token = await exchangeRefreshToken(env, guest.refreshToken);
    expect(signInProvider(token.claims)).toBe('anonymous');
    expect(signInProvider((await exchangeRefreshToken(env, alice.refreshToken)).claims)).toBe('password');
  });
});

// Security-rules tests. They need the Firestore emulator (and Java):
//   npm run test:rules
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails, assertSucceeds, initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  arrayUnion, collection, deleteDoc, deleteField, doc, getDoc, getDocs, query,
  serverTimestamp, setDoc, updateDoc, where, writeBatch, type Firestore,
} from 'firebase/firestore';

let env: RulesTestEnvironment;

const GID = 'ABC234';
const baseGroup = {
  id: GID,
  name: 'Trip',
  members: ['alice', 'bob'],
  admins: ['alice'],
  createdBy: 'alice',
  memberNames: { alice: 'Alice', bob: 'Bob' },
  participants: [{ id: 'p1', name: 'Carol' }],
  createdAt: '2026-01-01T00:00:00.000Z',
};

const expense = (id: string, by: string) => ({
  id, groupId: GID, description: 'Dinner', amount: 30, paidBy: by,
  splits: [{ userId: 'alice', amount: 15 }, { userId: 'bob', amount: 15 }],
  createdBy: by, createdAt: '2026-01-02T00:00:00.000Z',
});

const settlement = (id: string, by: string) => ({
  id, groupId: GID, from: 'bob', to: 'alice', amount: 15,
  recordedBy: by, createdAt: '2026-01-03T00:00:00.000Z',
});

// A payment as the app writes it now: with a status and the server's time
const recorded = (id: string, by: string, status: 'pending' | 'confirmed', to = 'alice') => ({
  ...settlement(id, by), to, status, recordedAt: serverTimestamp(),
});

const as = (uid: string): Firestore => env.authenticatedContext(uid).firestore() as unknown as Firestore;
const anon = (): Firestore => env.unauthenticatedContext().firestore() as unknown as Firestore;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-splitr',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});

afterAll(async () => { await env?.cleanup(); });

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'groups', GID), baseGroup);
    await setDoc(doc(db, 'groups', GID, 'expenses', 'e1'), expense('e1', 'alice'));
    await setDoc(doc(db, 'groups', GID, 'settlements', 's1'), settlement('s1', 'bob'));
    await setDoc(doc(db, 'users', 'alice'), { name: 'Alice', contacts: [] });
  });
});

describe('users', () => {
  it('lets you read and write only your own profile', async () => {
    await assertSucceeds(getDoc(doc(as('alice'), 'users', 'alice')));
    await assertSucceeds(setDoc(doc(as('alice'), 'users', 'alice'), { name: 'Al' }, { merge: true }));
    await assertFails(getDoc(doc(as('bob'), 'users', 'alice')));
    await assertFails(setDoc(doc(as('bob'), 'users', 'alice'), { name: 'hacked' }));
    await assertFails(getDoc(doc(anon(), 'users', 'alice')));
  });
});

describe('groups', () => {
  it('creates a new group for yourself', async () => {
    await assertSucceeds(setDoc(doc(as('dave'), 'groups', 'NEW234'), {
      ...baseGroup, id: 'NEW234', members: ['dave'], admins: ['dave'], createdBy: 'dave',
      memberNames: { dave: 'Dave' }, participants: [],
    }));
  });

  it('stores a currency code with a new group, and never changes it', async () => {
    const g = (id: string, currency: string) => ({
      id, name: 'G', members: ['carl'], admins: ['carl'], createdBy: 'carl',
      memberNames: {}, participants: [], createdAt: '', currency,
    });
    await assertSucceeds(setDoc(doc(as('carl'), 'groups', 'CUR234'), g('CUR234', 'INR')));
    await assertFails(setDoc(doc(as('carl'), 'groups', 'CUR345'), g('CUR345', 'rupees')));
    await assertFails(updateDoc(doc(as('carl'), 'groups', 'CUR234'), { currency: 'USD' }));
  });

  it('cannot overwrite an existing group (code collision)', async () => {
    await assertFails(setDoc(doc(as('dave'), 'groups', GID), {
      ...baseGroup, members: ['dave'], admins: ['dave'], createdBy: 'dave',
    }));
  });

  it('cannot create a group on behalf of others', async () => {
    await assertFails(setDoc(doc(as('dave'), 'groups', 'NEW234'), {
      ...baseGroup, id: 'NEW234', members: ['dave', 'alice'], admins: ['dave'], createdBy: 'dave',
    }));
  });

  it('requires sign-in for everything', async () => {
    await assertFails(getDoc(doc(anon(), 'groups', GID)));
  });

  it('lets any signed-in user look up a group by code', async () => {
    await assertSucceeds(getDoc(doc(as('dave'), 'groups', GID)));
  });

  it('lists only groups you are a member of', async () => {
    await assertSucceeds(getDocs(query(collection(as('bob'), 'groups'), where('members', 'array-contains', 'bob'))));
    await assertFails(getDocs(collection(as('dave'), 'groups')));
  });

  it('lets you join by adding only yourself', async () => {
    await assertSucceeds(updateDoc(doc(as('dave'), 'groups', GID), {
      members: arrayUnion('dave'), 'memberNames.dave': 'Dave',
    }));
  });

  it('does not let a joiner add others, rename others or grab admin', async () => {
    await assertFails(updateDoc(doc(as('dave'), 'groups', GID), { members: arrayUnion('dave', 'eve') }));
    await assertFails(updateDoc(doc(as('dave'), 'groups', GID), {
      members: arrayUnion('dave'), 'memberNames.alice': 'Mallory',
    }));
    await assertFails(updateDoc(doc(as('dave'), 'groups', GID), { members: arrayUnion('dave'), admins: ['dave'] }));
  });

  it('lets a member leave (remove only themselves)', async () => {
    await assertSucceeds(updateDoc(doc(as('bob'), 'groups', GID), { members: ['alice'] }));
  });

  it('does not let a non-admin remove others or change admins', async () => {
    await assertFails(updateDoc(doc(as('bob'), 'groups', GID), { members: ['bob'] }));
    await assertFails(updateDoc(doc(as('bob'), 'groups', GID), { admins: ['bob'] }));
    await assertFails(updateDoc(doc(as('bob'), 'groups', GID), { name: 'Renamed' }));
  });

  it('lets a member update only their own display name', async () => {
    await assertSucceeds(updateDoc(doc(as('bob'), 'groups', GID), { 'memberNames.bob': 'Robert' }));
    await assertFails(updateDoc(doc(as('bob'), 'groups', GID), { 'memberNames.alice': 'Nope' }));
  });

  it('lets an admin manage admins and leave with succession', async () => {
    await assertSucceeds(updateDoc(doc(as('alice'), 'groups', GID), { admins: ['alice', 'bob'] }));
    await assertSucceeds(updateDoc(doc(as('alice'), 'groups', GID), { members: ['bob'], admins: ['bob'] }));
  });

  it('keeps at least one admin, and admins must be members', async () => {
    await assertFails(updateDoc(doc(as('alice'), 'groups', GID), { admins: [] }));
    await assertFails(updateDoc(doc(as('alice'), 'groups', GID), { admins: ['alice', 'stranger'] }));
  });

  it('treats the creator as admin on legacy groups without an admins field', async () => {
    await env.withSecurityRulesDisabled(async ctx => {
      const { admins: _ignored, ...legacy } = baseGroup;
      await setDoc(doc(ctx.firestore(), 'groups', 'OLD234'), { ...legacy, id: 'OLD234' });
    });
    await assertSucceeds(updateDoc(doc(as('alice'), 'groups', 'OLD234'), { admins: ['alice', 'bob'] }));
  });

  it('only admins (or the last member) can delete a group', async () => {
    await assertFails(deleteDoc(doc(as('bob'), 'groups', GID)));
    await assertSucceeds(deleteDoc(doc(as('alice'), 'groups', GID)));
  });

  it('lets the last remaining member delete the group', async () => {
    await env.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), 'groups', 'SOLO23'), { ...baseGroup, id: 'SOLO23', members: ['bob'], admins: ['alice'] });
    });
    await assertSucceeds(deleteDoc(doc(as('bob'), 'groups', 'SOLO23')));
  });
});

describe('claiming a name-only placeholder', () => {
  const seedClaims = (claims: Record<string, string>) => env.withSecurityRulesDisabled(async ctx => {
    await updateDoc(doc(ctx.firestore(), 'groups', GID), { claims, participants: [
      { id: 'p1', name: 'Carol' }, { id: 'p2', name: 'Erin' },
    ] });
  });

  it('lets a joiner claim a placeholder as themselves', async () => {
    await assertSucceeds(updateDoc(doc(as('dave'), 'groups', GID), {
      members: arrayUnion('dave'), 'memberNames.dave': 'Carol', 'claims.p1': 'dave',
    }));
  });

  it('does not let anyone claim on behalf of someone else', async () => {
    await assertFails(updateDoc(doc(as('dave'), 'groups', GID), {
      members: arrayUnion('dave'), 'claims.p1': 'bob',
    }));
    await assertFails(updateDoc(doc(as('bob'), 'groups', GID), { 'claims.p1': 'alice' }));
  });

  it('lets a member who joined as a duplicate claim later', async () => {
    await assertSucceeds(updateDoc(doc(as('bob'), 'groups', GID), { 'claims.p1': 'bob' }));
  });

  it('never takes over a placeholder someone already claimed', async () => {
    await seedClaims({ p1: 'alice' });
    await assertFails(updateDoc(doc(as('bob'), 'groups', GID), { 'claims.p1': 'bob' }));
  });

  it('allows one claim per member', async () => {
    await seedClaims({ p1: 'bob' });
    await assertFails(updateDoc(doc(as('bob'), 'groups', GID), { 'claims.p2': 'bob' }));
  });

  it('cannot claim another member\'s account', async () => {
    await assertFails(updateDoc(doc(as('bob'), 'groups', GID), { 'claims.alice': 'bob' }));
  });

  it('only admins can undo a claim', async () => {
    await seedClaims({ p1: 'bob' });
    await assertFails(updateDoc(doc(as('bob'), 'groups', GID), { 'claims.p1': deleteField() }));
    await assertSucceeds(updateDoc(doc(as('alice'), 'groups', GID), { 'claims.p1': deleteField() }));
  });
});

describe('expenses', () => {
  it('are readable by members only', async () => {
    await assertSucceeds(getDocs(collection(as('bob'), 'groups', GID, 'expenses')));
    await assertFails(getDocs(collection(as('dave'), 'groups', GID, 'expenses')));
    await assertFails(getDoc(doc(as('dave'), 'groups', GID, 'expenses', 'e1')));
  });

  it('can be added by members as themselves', async () => {
    await assertSucceeds(setDoc(doc(as('bob'), 'groups', GID, 'expenses', 'e2'), expense('e2', 'bob')));
    await assertFails(setDoc(doc(as('bob'), 'groups', GID, 'expenses', 'e3'), expense('e3', 'alice')));
    await assertFails(setDoc(doc(as('dave'), 'groups', GID, 'expenses', 'e4'), expense('e4', 'dave')));
  });

  it('rejects invalid amounts', async () => {
    await assertFails(setDoc(doc(as('bob'), 'groups', GID, 'expenses', 'e5'), { ...expense('e5', 'bob'), amount: -5 }));
    await assertFails(setDoc(doc(as('bob'), 'groups', GID, 'expenses', 'e6'), { ...expense('e6', 'bob'), amount: '30' }));
    await assertFails(setDoc(doc(as('bob'), 'groups', GID, 'expenses', 'e7'), { ...expense('e7', 'bob'), amount: 30.005 }));
    await assertSucceeds(setDoc(doc(as('bob'), 'groups', GID, 'expenses', 'e8'), { ...expense('e8', 'bob'), amount: 0.29 }));
    await assertSucceeds(setDoc(doc(as('bob'), 'groups', GID, 'expenses', 'e9'), { ...expense('e9', 'bob'), amount: 99999999.99 }));
  });

  it('rejects unknown or missing fields', async () => {
    await assertFails(setDoc(doc(as('bob'), 'groups', GID, 'expenses', 'x1'), { ...expense('x1', 'bob'), junk: 'x'.repeat(1000) }));
    const { createdAt: _omit, ...noDate } = expense('x2', 'bob');
    await assertFails(setDoc(doc(as('bob'), 'groups', GID, 'expenses', 'x2'), noDate));
    await assertFails(setDoc(doc(as('bob'), 'groups', GID, 'settlements', 'x3'), { ...recorded('x3', 'bob', 'pending'), junk: 1 }));
    await assertFails(setDoc(doc(as('bob'), 'groups', GID, 'settlements', 'x4'), { ...recorded('x4', 'bob', 'pending'), amount: 0.001 }));
    await assertFails(setDoc(doc(as('carl'), 'groups', 'NEW234'), {
      id: 'NEW234', name: 'G', members: ['carl'], admins: ['carl'], createdBy: 'carl',
      memberNames: {}, participants: [], createdAt: '', junk: true,
    }));
  });

  it('only admins can delete them', async () => {
    await assertFails(deleteDoc(doc(as('bob'), 'groups', GID, 'expenses', 'e1')));
    await assertSucceeds(deleteDoc(doc(as('alice'), 'groups', GID, 'expenses', 'e1')));
  });

  const edit = (uid: string, id: string, changes: Record<string, unknown>) =>
    updateDoc(doc(as(uid), 'groups', GID, 'expenses', id), { ...changes, editedBy: uid, editedAt: serverTimestamp() });

  it('can be edited by whoever added them, or an admin', async () => {
    // e1 was added by alice (admin); bob adds e2
    await assertSucceeds(setDoc(doc(as('bob'), 'groups', GID, 'expenses', 'e2'), expense('e2', 'bob')));
    await assertSucceeds(edit('bob', 'e2', { amount: 40, splits: [{ userId: 'bob', amount: 40 }] }));
    await assertSucceeds(edit('alice', 'e2', { description: 'Fixed by admin' }));
    await assertFails(edit('bob', 'e1', { amount: 1 }));
  });

  it('keeps who added it and when, and stamps the real editor', async () => {
    await assertFails(edit('alice', 'e1', { createdBy: 'bob' }));
    await assertFails(edit('alice', 'e1', { createdAt: '2030-01-01T00:00:00.000Z' }));
    await assertFails(updateDoc(doc(as('alice'), 'groups', GID, 'expenses', 'e1'),
      { amount: 20, editedBy: 'bob', editedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(as('alice'), 'groups', GID, 'expenses', 'e1'), { amount: 20 }));
  });

  it('applies the same checks to edits as to new expenses', async () => {
    await assertFails(edit('alice', 'e1', { amount: -5 }));
    await assertFails(edit('alice', 'e1', { amount: 30.005 }));
    await assertFails(edit('alice', 'e1', { junk: 'x' }));
  });

  it('can carry the day it was spent and how it was split', async () => {
    const add = (id: string, extra: Record<string, unknown>) =>
      setDoc(doc(as('bob'), 'groups', GID, 'expenses', id), { ...expense(id, 'bob'), ...extra });
    await assertSucceeds(add('d1', { date: '2026-10-27' }));
    await assertSucceeds(add('d2', { split: { method: 'shares', values: { alice: 1, bob: 1 } } }));
    await assertSucceeds(add('d3', {
      date: '2026-10-01',
      split: { method: 'items', items: [{ name: 'Pizza', amount: 30, people: ['alice', 'bob'] }] },
    }));
    // Older-style expenses without them still work (the AI connector writes these)
    await assertSucceeds(add('d4', {}));

    await assertFails(add('x5', { date: '27/10/2026' }));
    await assertFails(add('x6', { date: 20261027 }));
    await assertFails(add('x7', { split: { method: 'magic' } }));
    await assertFails(add('x8', { split: { method: 'shares', values: { alice: 1 }, junk: 'x' } }));
    await assertFails(add('x9', { split: 'shares' }));
    await assertFails(add('x10', { split: { method: 'percent', values: Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`u${i}`, 1])) } }));
    await assertFails(add('x11', { split: { method: 'items', items: 'pizza' } }));
  });

  it('lets an edit add or change the date and split, with the same checks', async () => {
    await assertSucceeds(edit('alice', 'e1', { date: '2026-09-30', split: { method: 'percent', values: { alice: 50, bob: 50 } } }));
    await assertSucceeds(edit('alice', 'e1', { split: { method: 'exact' } }));
    await assertFails(edit('alice', 'e1', { date: 'yesterday' }));
    await assertFails(edit('alice', 'e1', { split: { method: 'equal', extra: true } }));
  });
});

describe('settlements', () => {
  it('are readable by members only', async () => {
    await assertSucceeds(getDocs(collection(as('alice'), 'groups', GID, 'settlements')));
    await assertFails(getDocs(collection(as('dave'), 'groups', GID, 'settlements')));
  });

  it('can be recorded by members as themselves', async () => {
    await assertSucceeds(setDoc(doc(as('alice'), 'groups', GID, 'settlements', 's2'), recorded('s2', 'alice', 'confirmed')));
    await assertFails(setDoc(doc(as('alice'), 'groups', GID, 'settlements', 's3'), recorded('s3', 'bob', 'confirmed')));
    await assertFails(setDoc(doc(as('dave'), 'groups', GID, 'settlements', 's4'), recorded('s4', 'dave', 'pending')));
  });

  it('cannot be deleted by non-admins (deleting an expense must not erase payments)', async () => {
    await assertFails(deleteDoc(doc(as('bob'), 'groups', GID, 'settlements', 's1')));
  });
});

describe('payment confirmation', () => {
  const pay = (id: string) => doc(as('alice'), 'groups', GID, 'settlements', id);
  const seed = (id: string, data: Record<string, unknown>) => env.withSecurityRulesDisabled(async ctx => {
    await setDoc(doc(ctx.firestore(), 'groups', GID, 'settlements', id), { ...settlement(id, 'bob'), ...data });
  });
  const decide = (uid: string, id: string, status: string) =>
    updateDoc(doc(as(uid), 'groups', GID, 'settlements', id), { status, decidedBy: uid, decidedAt: serverTimestamp() });

  it('confirms at once only when the receiver records it', async () => {
    await assertSucceeds(setDoc(pay('c1'), recorded('c1', 'alice', 'confirmed')));
    await assertFails(setDoc(doc(as('bob'), 'groups', GID, 'settlements', 'c2'), recorded('c2', 'bob', 'confirmed')));
    await assertSucceeds(setDoc(doc(as('bob'), 'groups', GID, 'settlements', 'c3'), recorded('c3', 'bob', 'pending')));
  });

  it('confirms at once a payment to a name-only member, who cannot confirm', async () => {
    await assertSucceeds(setDoc(doc(as('bob'), 'groups', GID, 'settlements', 'n1'), recorded('n1', 'bob', 'confirmed', 'p1')));
    await assertFails(setDoc(doc(as('bob'), 'groups', GID, 'settlements', 'n2'), recorded('n2', 'bob', 'pending', 'p1')));
  });

  it('takes the time from the server, so auto-confirm cannot be backdated', async () => {
    await assertFails(setDoc(doc(as('bob'), 'groups', GID, 'settlements', 'b1'),
      { ...recorded('b1', 'bob', 'pending'), recordedAt: new Date('2020-01-01') }));
  });

  it('lets only the receiver confirm or reject', async () => {
    await seed('d1', { status: 'pending' });
    await seed('d2', { status: 'pending' });
    await assertFails(decide('bob', 'd1', 'confirmed'));
    await assertSucceeds(decide('alice', 'd1', 'confirmed'));
    await assertSucceeds(decide('alice', 'd2', 'rejected'));
  });

  it('lets the recorder cancel while pending, and the receiver undo once confirmed', async () => {
    await seed('u1', { status: 'pending' });
    await assertSucceeds(decide('bob', 'u1', 'cancelled'));
    // s1 is an older record without a status: it counts as confirmed
    await assertFails(decide('bob', 's1', 'cancelled'));
    await assertSucceeds(decide('alice', 's1', 'cancelled'));
  });

  it('changes nothing but the status, stamped with the real decider', async () => {
    await seed('m1', { status: 'pending' });
    await assertFails(updateDoc(doc(as('alice'), 'groups', GID, 'settlements', 'm1'),
      { status: 'confirmed', decidedBy: 'alice', decidedAt: serverTimestamp(), amount: 1 }));
    await assertFails(updateDoc(doc(as('alice'), 'groups', GID, 'settlements', 'm1'),
      { status: 'confirmed', decidedBy: 'bob', decidedAt: serverTimestamp() }));
  });

  it('lets whoever claimed the receiving placeholder confirm', async () => {
    await env.withSecurityRulesDisabled(async ctx => {
      await updateDoc(doc(ctx.firestore(), 'groups', GID), { claims: { p1: 'bob' } });
    });
    await seed('k1', { status: 'pending', from: 'alice', to: 'p1', recordedBy: 'alice' });
    await assertSucceeds(decide('bob', 'k1', 'confirmed'));
  });
});

describe('deleting a whole group', () => {
  it('lets an admin delete the group and all its data in one batch', async () => {
    const db = as('alice');
    const batch = writeBatch(db);
    batch.delete(doc(db, 'groups', GID, 'expenses', 'e1'));
    batch.delete(doc(db, 'groups', GID, 'settlements', 's1'));
    batch.delete(doc(db, 'groups', GID));
    await assertSucceeds(batch.commit());
  });
});

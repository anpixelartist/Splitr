// Security-rules tests. They need the Firestore emulator (and Java):
//   npm run test:rules
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails, assertSucceeds, initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  arrayUnion, collection, deleteDoc, doc, getDoc, getDocs, query,
  setDoc, updateDoc, where, writeBatch, type Firestore,
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
  });

  it('cannot be edited, and only admins can delete them', async () => {
    await assertFails(updateDoc(doc(as('alice'), 'groups', GID, 'expenses', 'e1'), { amount: 1 }));
    await assertFails(deleteDoc(doc(as('bob'), 'groups', GID, 'expenses', 'e1')));
    await assertSucceeds(deleteDoc(doc(as('alice'), 'groups', GID, 'expenses', 'e1')));
  });
});

describe('settlements', () => {
  it('are readable by members only', async () => {
    await assertSucceeds(getDocs(collection(as('alice'), 'groups', GID, 'settlements')));
    await assertFails(getDocs(collection(as('dave'), 'groups', GID, 'settlements')));
  });

  it('can be recorded by members as themselves', async () => {
    await assertSucceeds(setDoc(doc(as('alice'), 'groups', GID, 'settlements', 's2'), settlement('s2', 'alice')));
    await assertFails(setDoc(doc(as('alice'), 'groups', GID, 'settlements', 's3'), settlement('s3', 'bob')));
    await assertFails(setDoc(doc(as('dave'), 'groups', GID, 'settlements', 's4'), settlement('s4', 'dave')));
  });

  it('cannot be deleted by non-admins (deleting an expense must not erase payments)', async () => {
    await assertFails(deleteDoc(doc(as('bob'), 'groups', GID, 'settlements', 's1')));
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

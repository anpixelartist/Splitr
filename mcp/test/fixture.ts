// Shared test data for the tool tests.

import type { Props } from '../src/token';

export const NOW = Date.parse('2026-10-27T12:00:00Z');
export const DAY = 24 * 60 * 60 * 1000;
export const me: Props = { uid: 'u1', refreshToken: 'rt-u1', name: 'Asha' };

// Goa Trip (INR): me (u1), Priya (u2), Amit (u3, who claimed the placeholder
// p2 "Amit"), and Rahul (p1, a name-only participant nobody claimed).
//   Dinner ₹1,200 paid by me, split 4 ways (₹300 each; p2 → Amit)
//   Taxi   ₹400 paid by Priya, split me/Priya
//   Rahul paid me ₹300 (an older record without status: confirmed)
//   Priya says she paid me ₹500 yesterday (pending: doesn't count yet)
//   Amit paid Priya ₹100 eight days ago (pending, auto-confirmed after 7 days)
// Net: me +400, Priya −200, Amit −200, Rahul 0.
//
// Flat (JPY, no decimals): Priya paid ¥3,000 split with me → I owe her ¥1,500.
export const docs = {
  'users/u1': { name: 'Asha' },
  'groups/GOA111': {
    id: 'GOA111', name: 'Goa Trip', currency: 'INR', members: ['u1', 'u2', 'u3'], admins: ['u1'], createdBy: 'u1',
    memberNames: { u1: 'Asha (old name)', u2: 'Priya', u3: 'Amit S' },
    participants: [{ id: 'p1', name: 'Rahul' }, { id: 'p2', name: 'Amit' }],
    claims: { p2: 'u3' },
    createdAt: '2026-10-01T00:00:00.000Z',
  },
  'groups/GOA111/expenses/e1': {
    id: 'e1', groupId: 'GOA111', description: 'Dinner at the shack', amount: 1200, paidBy: 'u1',
    splits: [{ userId: 'u1', amount: 300 }, { userId: 'u2', amount: 300 }, { userId: 'p1', amount: 300 }, { userId: 'p2', amount: 300 }],
    createdBy: 'u1', createdAt: '2026-10-20T19:00:00.000Z',
  },
  'groups/GOA111/expenses/e2': {
    id: 'e2', groupId: 'GOA111', description: 'Taxi', amount: 400, paidBy: 'u2',
    splits: [{ userId: 'u1', amount: 200 }, { userId: 'u2', amount: 200 }],
    createdBy: 'u2', createdAt: '2026-10-21T10:00:00.000Z',
  },
  'groups/GOA111/settlements/s1': {
    id: 's1', groupId: 'GOA111', from: 'p1', to: 'u1', amount: 300, recordedBy: 'u1', createdAt: '2026-10-22T00:00:00.000Z',
  },
  'groups/GOA111/settlements/s2': {
    id: 's2', groupId: 'GOA111', from: 'u2', to: 'u1', amount: 500, recordedBy: 'u2', status: 'pending',
    createdAt: '2026-10-26T12:00:00.000Z', recordedAt: NOW - DAY,
  },
  'groups/GOA111/settlements/s3': {
    id: 's3', groupId: 'GOA111', from: 'u3', to: 'u2', amount: 100, recordedBy: 'u3', status: 'pending',
    createdAt: '2026-10-19T12:00:00.000Z', recordedAt: NOW - 8 * DAY,
  },
  'groups/FLAT22': {
    id: 'FLAT22', name: 'Flat', currency: 'JPY', members: ['u1', 'u2'], admins: ['u2'], createdBy: 'u2',
    memberNames: { u1: 'Asha', u2: 'Priya' }, createdAt: '2026-09-01T00:00:00.000Z',
  },
  'groups/FLAT22/expenses/f1': {
    id: 'f1', groupId: 'FLAT22', description: 'Groceries', amount: 3000, paidBy: 'u2',
    splits: [{ userId: 'u1', amount: 1500 }, { userId: 'u2', amount: 1500 }],
    createdBy: 'u2', createdAt: '2026-10-25T09:00:00.000Z',
  },
  'groups/GOA2025': {
    id: 'GOA2025', name: 'Goa Trip 2025', members: ['u1'], admins: ['u1'], createdBy: 'u1',
    memberNames: { u1: 'Asha' }, createdAt: '2025-01-01T00:00:00.000Z',
  },
  // Somebody else's group: never visible to u1
  'groups/SECRET': {
    id: 'SECRET', name: 'Secret Club', members: ['u9'], admins: ['u9'], memberNames: { u9: 'Zed' }, createdAt: '2026-01-01T00:00:00.000Z',
  },
  'groups/SECRET/expenses/x1': {
    id: 'x1', groupId: 'SECRET', description: 'Hidden', amount: 10, paidBy: 'u9', splits: [{ userId: 'u9', amount: 10 }], createdBy: 'u9', createdAt: '2026-01-02T00:00:00.000Z',
  },
};

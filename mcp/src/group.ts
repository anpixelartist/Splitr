// Loads a group the way the web app does (src/context/GroupContext.tsx) and
// works out names, balances and the "who pays whom" plan with the app's own
// code, so the connector's numbers always match what people see in Splitr.

import type { Expense, Group, SettlementRecord } from '../../src/types';
import { calculateBalances, calculateSettlements, isSettled } from '../../src/lib/settlement';
import { applyClaims, resolveId } from '../../src/lib/claims';
import { countsTowardBalances, effectiveStatus } from '../../src/lib/payments';
import { DEFAULT_CURRENCY, currencyDigits, formatMoney } from '../../src/lib/money';
import type { Doc, Firestore } from './firestore';

export type GroupData = {
  group: Group;
  /** Claims already resolved, newest first (like the app's context) */
  expenses: Expense[];
  settlements: SettlementRecord[];
};

const byNewest = (a: { createdAt: string }, b: { createdAt: string }) =>
  new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();

const asGroup = (d: Doc & { id: string }) => ({ ...d, id: d.id }) as unknown as Group;

/** Groups I'm a member of (the only list query firestore.rules allows). */
export async function listMyGroups(db: Firestore, uid: string): Promise<Group[]> {
  const docs = await db.whereArrayContains('groups', 'members', uid);
  return docs.map(asGroup).sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadGroupData(db: Firestore, group: Group): Promise<GroupData> {
  const [exp, sett] = await Promise.all([
    db.list(`groups/${group.id}/expenses`),
    db.list(`groups/${group.id}/settlements`),
  ]);
  // Timestamps already arrive as milliseconds (see firestore.ts), matching
  // the app's readExpense/readSettlement.
  const expenses = (exp as unknown as Expense[]).sort(byNewest);
  const settlements = (sett as unknown as SettlementRecord[]).sort(byNewest);
  const resolved = applyClaims(expenses, settlements, group.claims);
  return { group, ...resolved };
}

export const currencyOf = (g: Group) => g.currency ?? DEFAULT_CURRENCY;
export const digitsOf = (g: Group) => currencyDigits(currencyOf(g));
export const moneyIn = (g: Group) => (n: number) => formatMoney(n, currencyOf(g));

export const adminsOf = (g: Group): string[] =>
  g.admins && g.admins.length > 0 ? g.admins : g.createdBy ? [g.createdBy] : [];

/**
 * Everyone who can be part of an expense right now: members, plus
 * name-only participants nobody has claimed (same as getUsersInGroup).
 */
export function peopleIn(g: Group, uid: string, myName?: string): { id: string; name: string }[] {
  const members = g.members.map(m => ({
    id: m,
    name: (m === uid && myName) || g.memberNames?.[m] || `Member ${m.substring(0, 4)}`,
  }));
  const unclaimed = (g.participants ?? []).filter(p => !g.claims?.[p.id]);
  return [...members, ...unclaimed];
}

/** A display name for any id, including claimed placeholders and people who left. */
export function nameOf(g: Group, rawId: string, uid: string, myName?: string): string {
  const id = resolveId(g.claims, rawId);
  if (id === uid && myName) return myName;
  return g.memberNames?.[id]
    ?? g.participants?.find(p => p.id === id)?.name
    ?? 'Former member';
}

/** "you" for the signed-in user, their name for everyone else. */
export const namer = (g: Group, uid: string) => (id: string) =>
  resolveId(g.claims, id) === uid ? 'you' : nameOf(g, id, uid);

export function summarize(data: GroupData, now = Date.now()) {
  const confirmed = data.settlements.filter(r => countsTowardBalances(r, now));
  const pending = data.settlements.filter(r => effectiveStatus(r, now) === 'pending');
  const balances = calculateBalances(data.expenses, confirmed);
  const plan = calculateSettlements(balances);
  return { balances, plan, pending };
}

export const myNet = (balances: ReturnType<typeof calculateBalances>, uid: string) =>
  balances[uid]?.netBalance ?? 0;

export { isSettled };

// ─── Finding things by name ──────────────────────────────────────────────────

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * Best matches for `query` among `items`: an exact id or name wins outright,
 * then names that contain the query (or the other way round), then names
 * sharing every word of the query. Returns all equally good matches.
 */
export function fuzzyFind<T>(items: T[], query: string, key: (t: T) => { id: string; name: string }): T[] {
  const q = norm(query);
  if (!q) return [];
  const exactId = items.filter(t => key(t).id.toLowerCase() === query.trim().toLowerCase());
  if (exactId.length) return exactId;
  const tiers: ((name: string) => boolean)[] = [
    n => n === q,
    n => n.startsWith(q),
    n => n.includes(q) || (n.length >= 3 && q.includes(n)),
    n => q.split(' ').every(w => n.split(' ').some(nw => nw.startsWith(w))),
  ];
  for (const test of tiers) {
    const hits = items.filter(t => test(norm(key(t).name)));
    if (hits.length) return hits;
  }
  return [];
}

export class UserFacingError extends Error {}

/** One group from a name or code, or a clear question back when it's ambiguous. */
export function pickGroup(groups: Group[], query: string): Group {
  if (groups.length === 0) throw new UserFacingError('You are not in any Splitr groups yet.');
  const hits = fuzzyFind(groups, query, g => ({ id: g.id, name: g.name }));
  if (hits.length === 1) return hits[0];
  const all = groups.map(g => `"${g.name}" (${g.id})`).join(', ');
  if (hits.length === 0) throw new UserFacingError(`No group matches "${query}". Your groups: ${all}.`);
  throw new UserFacingError(
    `"${query}" matches more than one group: ${hits.map(g => `"${g.name}" (${g.id})`).join(', ')}. Which one? You can pass the code.`,
  );
}

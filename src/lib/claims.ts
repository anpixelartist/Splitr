import type { Expense, SettlementRecord } from '../types';

// A name-only participant ("Priya") can be claimed by the real person when
// they join. Expenses are immutable, so instead of rewriting them the group
// keeps `claims: { participantId: uid }` and every read resolves through it.
// One small write, applied everywhere at once, and an admin can undo it.

export type Claims = Record<string, string> | undefined;

export const resolveId = (claims: Claims, id: string) => claims?.[id] ?? id;

export function applyClaims(
  expenses: Expense[],
  settlements: SettlementRecord[],
  claims: Claims,
): { expenses: Expense[]; settlements: SettlementRecord[] } {
  if (!claims || Object.keys(claims).length === 0) return { expenses, settlements };
  const r = (id: string) => resolveId(claims, id);
  return {
    expenses: expenses.map(e => ({
      ...e,
      paidBy: r(e.paidBy),
      splits: e.splits.map(s => ({ ...s, userId: r(s.userId) })),
    })),
    settlements: settlements.map(s => ({ ...s, from: r(s.from), to: r(s.to) })),
  };
}

/** Participants nobody has claimed yet: the choices for "Which of these is you?". */
export const unclaimedParticipants = <P extends { id: string }>(participants: P[] | undefined, claims: Claims) =>
  (participants ?? []).filter(p => !claims?.[p.id]);

/** The participant this member claimed, if any. */
export const claimedBy = (claims: Claims, uid: string) =>
  Object.entries(claims ?? {}).find(([, v]) => v === uid)?.[0];

type Roster = {
  members: string[];
  participants?: { id: string; name: string }[];
  claims?: Record<string, string>;
};

/**
 * Everyone in the group, each person once: app members plus the name-only
 * participants nobody has claimed. A claimed participant *is* the member who
 * claimed them, so counting both would list that person twice.
 * Every member count and roster (home list, invite screen, connector) uses this.
 */
export const groupPeople = <G extends Roster>(group: G) => ({
  members: group.members,
  unclaimed: unclaimedParticipants(group.participants, group.claims) as NonNullable<G['participants']>,
});

export const memberCount = (group: Roster) => {
  const { members, unclaimed } = groupPeople(group);
  return members.length + unclaimed.length;
};

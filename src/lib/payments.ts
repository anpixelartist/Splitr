import type { PaymentStatus, SettlementRecord } from '../types';

// Recorded payments need the receiver's OK before they change balances,
// unless the receiver recorded it themselves or can't confirm (a name-only
// member). A pending payment counts after 7 days unless rejected; the clock
// is the server's `recordedAt`, so it can't be backdated. firestore.rules
// enforces the same transitions.

export const AUTO_CONFIRM_MS = 7 * 24 * 60 * 60 * 1000;

/** Status a new payment is saved with. */
export const initialStatus = (recordedBy: string, to: string, memberUids: string[]): PaymentStatus =>
  recordedBy === to || !memberUids.includes(to) ? 'confirmed' : 'pending';

/** What a payment means right now, with auto-confirm applied. */
export function effectiveStatus(r: SettlementRecord, now = Date.now()): PaymentStatus {
  const status = r.status ?? 'confirmed';
  if (status === 'pending' && r.recordedAt !== undefined && now - r.recordedAt >= AUTO_CONFIRM_MS) return 'confirmed';
  return status;
}

export const countsTowardBalances = (r: SettlementRecord, now = Date.now()) =>
  effectiveStatus(r, now) === 'confirmed';

/** Status changes `uid` may make on this payment (mirrors firestore.rules). */
export function allowedActions(
  r: SettlementRecord,
  uid: string,
  opts: { memberUids: string[]; isAdmin: boolean },
): PaymentStatus[] {
  const status = r.status ?? 'confirmed';
  const receiverCanConfirm = opts.memberUids.includes(r.to);
  const actions = new Set<PaymentStatus>();
  if (uid === r.to && status === 'pending') { actions.add('confirmed'); actions.add('rejected'); }
  if (uid === r.to && status === 'confirmed') actions.add('cancelled');
  if (uid === r.recordedBy && status === 'pending') actions.add('cancelled');
  if (!receiverCanConfirm && status === 'confirmed' && (uid === r.recordedBy || opts.isAdmin)) actions.add('cancelled');
  return [...actions];
}

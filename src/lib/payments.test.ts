import { describe, it, expect } from 'vitest';
import { initialStatus, effectiveStatus, countsTowardBalances, allowedActions, AUTO_CONFIRM_MS } from './payments';
import { calculateBalances } from './settlement';
import type { SettlementRecord } from '../types';

const members = ['rahul', 'priya', 'amit'];
const pay = (over: Partial<SettlementRecord>): SettlementRecord => ({
  id: 'x', groupId: 'g', from: 'priya', to: 'rahul', amount: 250, createdAt: '', recordedBy: 'priya',
  status: 'pending', recordedAt: 1_000_000, ...over,
});

describe('payment confirmation', () => {
  it('counts at once when the receiver records it, or the receiver has no app', () => {
    expect(initialStatus('rahul', 'rahul', members)).toBe('confirmed');
    expect(initialStatus('priya', 'carol-placeholder', members)).toBe('confirmed');
  });

  it('waits for the receiver when the payer or a third person records it', () => {
    expect(initialStatus('priya', 'rahul', members)).toBe('pending');
    expect(initialStatus('amit', 'rahul', members)).toBe('pending');
  });

  it('does not change balances while pending, and does once confirmed', () => {
    const expenses = [{ id: 'e', groupId: 'g', description: 'x', amount: 500, paidBy: 'rahul', createdAt: '',
      splits: [{ userId: 'rahul', amount: 250 }, { userId: 'priya', amount: 250 }] }];
    const pending = pay({});
    const counted = (rs: SettlementRecord[]) => rs.filter(r => countsTowardBalances(r, 1_000_001));
    expect(calculateBalances(expenses, counted([pending]))['priya'].netBalance).toBe(-250);
    expect(calculateBalances(expenses, counted([{ ...pending, status: 'confirmed' }]))['priya'].netBalance).toBe(0);
    expect(calculateBalances(expenses, counted([{ ...pending, status: 'rejected' }]))['priya'].netBalance).toBe(-250);
  });

  it('auto-confirms a pending payment after 7 days, never a rejected one', () => {
    const later = 1_000_000 + AUTO_CONFIRM_MS;
    expect(effectiveStatus(pay({}), later - 1)).toBe('pending');
    expect(effectiveStatus(pay({}), later)).toBe('confirmed');
    expect(effectiveStatus(pay({ status: 'rejected' }), later * 2)).toBe('rejected');
  });

  it('treats older records without a status as confirmed', () => {
    expect(effectiveStatus(pay({ status: undefined, recordedAt: undefined }))).toBe('confirmed');
  });

  it('lets the receiver confirm or reject, and the recorder cancel', () => {
    const opts = { memberUids: members, isAdmin: false };
    expect(allowedActions(pay({}), 'rahul', opts).sort()).toEqual(['confirmed', 'rejected']);
    expect(allowedActions(pay({}), 'priya', opts)).toEqual(['cancelled']);
    expect(allowedActions(pay({}), 'amit', opts)).toEqual([]);
    expect(allowedActions(pay({ status: 'confirmed' }), 'rahul', opts)).toEqual(['cancelled']);
    expect(allowedActions(pay({ status: 'confirmed' }), 'priya', opts)).toEqual([]);
  });

  it('lets the recorder or an admin undo a payment to a name-only member', () => {
    const p = pay({ to: 'carol-placeholder', status: 'confirmed', recordedBy: 'priya' });
    expect(allowedActions(p, 'priya', { memberUids: members, isAdmin: false })).toEqual(['cancelled']);
    expect(allowedActions(p, 'rahul', { memberUids: members, isAdmin: true })).toEqual(['cancelled']);
    expect(allowedActions(p, 'amit', { memberUids: members, isAdmin: false })).toEqual([]);
  });
});

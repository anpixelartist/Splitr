import { describe, it, expect } from 'vitest';
import { applyClaims, unclaimedParticipants, claimedBy } from './claims';
import { calculateBalances, calculateSettlements } from './settlement';
import type { Expense, SettlementRecord } from '../types';

const exp = (paidBy: string, splits: [string, number][], amount: number): Expense => ({
  id: Math.random().toString(), groupId: 'g', description: 'x', amount, paidBy, createdAt: '',
  splits: splits.map(([userId, a]) => ({ userId, amount: a })),
});

describe('claiming a name-only participant', () => {
  // Rahul (uid r) paid 300 for Rahul, placeholder Priya (p1) and Amit (p2)
  const expenses = [exp('r', [['r', 100], ['p1', 100], ['p2', 100]], 300)];

  it('moves the placeholder\'s debt to the person who joined', () => {
    const { expenses: e } = applyClaims(expenses, [], { p1: 'priyaUid' });
    const balances = calculateBalances(e);
    expect(balances['priyaUid'].netBalance).toBe(-100);
    expect(balances['p1']).toBeUndefined();
    expect(calculateSettlements(balances)).toContainEqual({ from: 'priyaUid', to: 'r', amount: 100 });
  });

  it('merges with anything the person added after joining as a duplicate', () => {
    // Priya joined as a new member first and paid 30 for herself and Rahul
    const all = [...expenses, exp('priyaUid', [['priyaUid', 15], ['r', 15]], 30)];
    const balances = calculateBalances(applyClaims(all, [], { p1: 'priyaUid' }).expenses);
    expect(balances['priyaUid'].netBalance).toBe(-85); // -100 + 30 - 15
    expect(balances['r'].netBalance).toBe(185);
  });

  it('applies to recorded payments too', () => {
    const paid: SettlementRecord[] = [{ id: 's', groupId: 'g', from: 'p1', to: 'r', amount: 100, createdAt: '' }];
    const { expenses: e, settlements: s } = applyClaims(expenses, paid, { p1: 'priyaUid' });
    expect(calculateBalances(e, s)['priyaUid'].netBalance).toBe(0);
  });

  it('leaves everything untouched without claims', () => {
    expect(applyClaims(expenses, [], undefined).expenses).toBe(expenses);
  });

  it('lists only unclaimed participants and finds a member\'s claim', () => {
    const ps = [{ id: 'p1', name: 'Priya' }, { id: 'p2', name: 'Amit' }];
    expect(unclaimedParticipants(ps, { p1: 'u' })).toEqual([{ id: 'p2', name: 'Amit' }]);
    expect(claimedBy({ p1: 'u' }, 'u')).toBe('p1');
    expect(claimedBy({ p1: 'u' }, 'v')).toBeUndefined();
  });
});

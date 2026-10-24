import { describe, it, expect } from 'vitest';
import { calculateBalances, calculateSettlements, splitEqually, validateExpense } from './settlement';
import type { Expense, SettlementRecord } from '../types';

describe('Financial Logic', () => {
  it('should correctly calculate balances for a single expense split equally', () => {
    const expenses: Expense[] = [
      {
        id: '1',
        groupId: 'g1',
        description: 'Dinner',
        amount: 300,
        paidBy: 'A',
        createdAt: new Date().toISOString(),
        splits: [
          { userId: 'A', amount: 100 },
          { userId: 'B', amount: 100 },
          { userId: 'C', amount: 100 },
        ],
      },
    ];

    const balances = calculateBalances(expenses);

    expect(balances['A'].netBalance).toBe(200); // Paid 300, consumed 100 => +200
    expect(balances['B'].netBalance).toBe(-100); // Consumed 100 => -100
    expect(balances['C'].netBalance).toBe(-100); // Consumed 100 => -100
  });

  it('should generate minimal settlement transactions', () => {
    const balances = {
      'A': { userId: 'A', netBalance: 200 },
      'B': { userId: 'B', netBalance: -100 },
      'C': { userId: 'C', netBalance: -100 },
    };

    const settlements = calculateSettlements(balances);

    expect(settlements.length).toBe(2);
    expect(settlements).toEqual(expect.arrayContaining([
      { from: 'B', to: 'A', amount: 100 },
      { from: 'C', to: 'A', amount: 100 },
    ]));
  });

  it('should handle complex multi-expense scenarios', () => {
    const expenses: Expense[] = [
      {
        id: '1',
        groupId: 'g1',
        description: 'Dinner',
        amount: 100,
        paidBy: 'A', // A pays 100, B & C owe 33.33, A owes 33.34
        createdAt: new Date().toISOString(),
        splits: [
          { userId: 'A', amount: 33.34 },
          { userId: 'B', amount: 33.33 },
          { userId: 'C', amount: 33.33 },
        ],
      },
      {
        id: '2',
        groupId: 'g1',
        description: 'Drinks',
        amount: 50,
        paidBy: 'B', // B pays 50, C owes 50
        createdAt: new Date().toISOString(),
        splits: [
          { userId: 'C', amount: 50 },
        ],
      },
    ];

    const balances = calculateBalances(expenses);

    // A: +100 - 33.34 = +66.66
    // B: -33.33 + 50 = +16.67
    // C: -33.33 - 50 = -83.33
    expect(balances['A'].netBalance).toBeCloseTo(66.66);
    expect(balances['B'].netBalance).toBeCloseTo(16.67);
    expect(balances['C'].netBalance).toBeCloseTo(-83.33);

    const settlements = calculateSettlements(balances);

    // C owes 83.33. Greedy algorithm: C pays A 66.66, C pays B 16.67
    expect(settlements.length).toBe(2);

    // We don't guarantee exact order since it's greedy based on amounts
    // But C is the only debtor, A is biggest creditor
    expect(settlements[0]).toEqual({ from: 'C', to: 'A', amount: 66.66 });
    expect(settlements[1]).toEqual({ from: 'C', to: 'B', amount: 16.67 });
  });

  it('should keep balances correct when a settlement outlives a deleted expense', () => {
    // B paid A $50 to settle a $100 dinner; the dinner was later deleted.
    // The $50 really changed hands, so A now owes B $50 back.
    const records: SettlementRecord[] = [
      { id: 's1', groupId: 'g1', from: 'B', to: 'A', amount: 50, createdAt: new Date().toISOString() },
    ];
    const balances = calculateBalances([], records);
    expect(balances['B'].netBalance).toBe(50);
    expect(balances['A'].netBalance).toBe(-50);
    expect(calculateSettlements(balances)).toEqual([{ from: 'A', to: 'B', amount: 50 }]);
  });
});

describe('splitEqually', () => {
  it('splits evenly divisible amounts', () => {
    expect(splitEqually(90, ['A', 'B', 'C']).map(s => s.amount)).toEqual([30, 30, 30]);
  });

  it('distributes leftover cents so shares sum exactly to the total', () => {
    const splits = splitEqually(100, ['A', 'B', 'C']);
    expect(splits.map(s => s.amount)).toEqual([33.34, 33.33, 33.33]);
    const sumCents = splits.reduce((acc, s) => acc + Math.round(s.amount * 100), 0);
    expect(sumCents).toBe(10000);
  });

  it('never produces floating-point noise', () => {
    for (const total of [0.01, 0.1, 10.01, 99.99, 1234.57]) {
      for (let n = 1; n <= 7; n++) {
        const ids = Array.from({ length: n }, (_, i) => String(i));
        const splits = splitEqually(total, ids);
        for (const s of splits) expect(s.amount).toBe(Math.round(s.amount * 100) / 100);
        const sumCents = splits.reduce((acc, s) => acc + Math.round(s.amount * 100), 0);
        expect(sumCents).toBe(Math.round(total * 100));
      }
    }
  });

  it('returns nothing for an empty list', () => {
    expect(splitEqually(10, [])).toEqual([]);
  });
});

const expense = (amount: number, paidBy: string, splits: [string, number][]): Expense => ({
  id: Math.random().toString(), groupId: 'g1', description: 'x', amount, paidBy,
  createdAt: new Date().toISOString(),
  splits: splits.map(([userId, a]) => ({ userId, amount: a })),
});

describe('Cent-exact balances', () => {
  it('keeps a 1-cent debt in the settlement plan', () => {
    const balances = calculateBalances([expense(0.02, 'A', [['A', 0.01], ['B', 0.01]])]);
    expect(balances['B'].netBalance).toBe(-0.01);
    expect(calculateSettlements(balances)).toEqual([{ from: 'B', to: 'A', amount: 0.01 }]);
  });

  it('does not drift over many odd-cent expenses', () => {
    // 1000 x $0.10 split three ways: A pays everything
    const expenses = Array.from({ length: 1000 }, () =>
      expense(0.1, 'A', splitEqually(0.1, ['A', 'B', 'C']).map(s => [s.userId, s.amount])));
    const balances = calculateBalances(expenses);
    // A's share is 0.04 each time, B and C 0.03 each
    expect(balances['A'].netBalance).toBe(60);
    expect(balances['B'].netBalance).toBe(-30);
    expect(balances['C'].netBalance).toBe(-30);
    const plan = calculateSettlements(balances);
    expect(plan.reduce((t, p) => t + p.amount, 0)).toBe(60);
  });

  it('nets to exactly zero once the plan is recorded', () => {
    const expenses = [
      expense(10, 'A', splitEqually(10, ['A', 'B', 'C']).map(s => [s.userId, s.amount])),
      expense(7.77, 'B', splitEqually(7.77, ['A', 'B', 'C']).map(s => [s.userId, s.amount])),
    ];
    const plan = calculateSettlements(calculateBalances(expenses));
    const records: SettlementRecord[] = plan.map((t, i) => ({ ...t, id: String(i), groupId: 'g1', createdAt: '' }));
    const after = calculateBalances(expenses, records);
    for (const b of Object.values(after)) expect(b.netBalance).toBe(0);
    expect(calculateSettlements(after)).toEqual([]);
  });
});

describe('validateExpense', () => {
  const group = ['A', 'B', 'C'];
  const ok = { amount: 10, paidBy: 'A', splits: [{ userId: 'A', amount: 5 }, { userId: 'B', amount: 5 }] };

  it('accepts a consistent expense', () => {
    expect(validateExpense(ok, group)).toBeNull();
  });

  it('rejects shares that do not add up', () => {
    expect(validateExpense({ ...ok, splits: [{ userId: 'A', amount: 5 }, { userId: 'B', amount: 4.99 }] }, group)).not.toBeNull();
  });

  it('rejects a payer or split person outside the group', () => {
    expect(validateExpense({ ...ok, paidBy: 'Z' }, group)).not.toBeNull();
    expect(validateExpense({ ...ok, splits: [{ userId: 'A', amount: 5 }, { userId: 'Z', amount: 5 }] }, group)).not.toBeNull();
  });

  it('rejects duplicates, fractions of a cent and non-positive totals', () => {
    expect(validateExpense({ ...ok, splits: [{ userId: 'A', amount: 5 }, { userId: 'A', amount: 5 }] }, group)).not.toBeNull();
    expect(validateExpense({ ...ok, amount: 10.005 }, group)).not.toBeNull();
    expect(validateExpense({ ...ok, amount: 0, splits: [] }, group)).not.toBeNull();
    expect(validateExpense({ ...ok, amount: NaN }, group)).not.toBeNull();
  });

  it('accepts every split that splitEqually produces', () => {
    for (const total of [0.01, 0.1, 1, 7.77, 100, 99999.99]) {
      expect(validateExpense({ amount: total, paidBy: 'A', splits: splitEqually(total, group) }, group)).toBeNull();
    }
  });
});

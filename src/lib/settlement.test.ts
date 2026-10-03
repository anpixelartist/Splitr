import { describe, it, expect } from 'vitest';
import { calculateBalances, calculateSettlements } from './settlement';
import type { Expense } from '../types';

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
});

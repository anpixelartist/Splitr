import { describe, it, expect } from 'vitest';
import { previewSplit, splitByWeights, type SplitInput } from './splitModes';
import { splitEqually, validateExpense } from './settlement';

const ids = ['A', 'B', 'C'];
const money = (n: number) => `$${n.toFixed(2)}`;
const input = (over: Partial<SplitInput> = {}): SplitInput => ({ excluded: new Set(), exact: {}, percent: {}, shares: {}, ...over });
const sum = (s: { amount: number }[]) => Math.round(s.reduce((t, x) => t + x.amount * 100, 0));

describe('splitByWeights', () => {
  it('matches splitEqually for equal weights', () => {
    for (const total of [100, 0.01, 0.02, 99.99, 1234.57]) {
      const w = ids.map(userId => ({ userId, weight: 1 }));
      expect(splitByWeights(total, w)).toEqual(splitEqually(total, ids));
    }
  });

  it('splits by parts and always adds up exactly', () => {
    expect(splitByWeights(100, [{ userId: 'A', weight: 2 }, { userId: 'B', weight: 1 }])).toEqual([
      { userId: 'A', amount: 66.67 }, { userId: 'B', amount: 33.33 },
    ]);
    // Leftover cents go to the largest remainders, not just the first person
    const s = splitByWeights(10, [{ userId: 'A', weight: 1 }, { userId: 'B', weight: 1 }, { userId: 'C', weight: 4 }]);
    expect(s).toEqual([{ userId: 'A', amount: 1.67 }, { userId: 'B', amount: 1.67 }, { userId: 'C', amount: 6.66 }]);
    expect(sum(s)).toBe(1000);
  });

  it('handles percentages with decimals, currencies without decimals, and zero weights', () => {
    const pct = splitByWeights(250, [{ userId: 'A', weight: 33.33 }, { userId: 'B', weight: 33.33 }, { userId: 'C', weight: 33.34 }]);
    expect(sum(pct)).toBe(25000);
    expect(splitByWeights(1000, [{ userId: 'A', weight: 1 }, { userId: 'B', weight: 2 }], 0))
      .toEqual([{ userId: 'A', amount: 333 }, { userId: 'B', amount: 667 }]);
    expect(splitByWeights(50, [{ userId: 'A', weight: 0 }, { userId: 'B', weight: 3 }])).toEqual([{ userId: 'B', amount: 50 }]);
    expect(splitByWeights(50, [{ userId: 'A', weight: 0 }])).toEqual([]);
  });

  it('stays exact for the largest amounts the app allows', () => {
    const s = splitByWeights(99999999.99, [{ userId: 'A', weight: 33.33 }, { userId: 'B', weight: 66.67 }]);
    expect(Math.round(s[0].amount * 100) + Math.round(s[1].amount * 100)).toBe(9999999999);
  });
});

describe('previewSplit', () => {
  it('equal: splits between whoever is ticked', () => {
    const p = previewSplit('equal', 100, ids, input({ excluded: new Set(['C']) }), 2, money);
    expect(p).toMatchObject({ ok: true, status: 'Split equally between 2 people' });
    expect(p.splits).toEqual([{ userId: 'A', amount: 50 }, { userId: 'B', amount: 50 }]);
    expect(previewSplit('equal', 100, ids, input({ excluded: new Set(ids) }), 2, money).ok).toBe(false);
  });

  it('exact: says what is left or over, and saves only people with an amount', () => {
    expect(previewSplit('exact', 100, ids, input({ exact: { A: '60' } }), 2, money).status).toBe('$40.00 left to assign');
    expect(previewSplit('exact', 100, ids, input({ exact: { A: '60', B: '50' } }), 2, money).status).toBe('$10.00 over the total');
    const ok = previewSplit('exact', 100, ids, input({ exact: { A: '60', B: '40', C: '' } }), 2, money);
    expect(ok.ok).toBe(true);
    expect(ok.splits).toEqual([{ userId: 'A', amount: 60 }, { userId: 'B', amount: 40 }]);
    expect(previewSplit('exact', 100, ids, input({ exact: { A: '-5' } }), 2, money).ok).toBe(false);
    expect(previewSplit('exact', 100, ids, input({ exact: { A: '99.999' } }), 2, money).error).toBe('Amounts can only have whole cents.');
  });

  it('percent: must add up to 100, then converts to exact amounts', () => {
    expect(previewSplit('percent', 90, ids, input({ percent: { A: '50', B: '20' } }), 2, money).status).toBe('30% left');
    expect(previewSplit('percent', 90, ids, input({ percent: { A: '50', B: '60' } }), 2, money).status).toBe('10% over 100%');
    const p = previewSplit('percent', 90, ids, input({ percent: { A: '50', B: '25', C: '25' } }), 2, money);
    expect(p.ok).toBe(true);
    expect(p.splits).toEqual([{ userId: 'A', amount: 45 }, { userId: 'B', amount: 22.5 }, { userId: 'C', amount: 22.5 }]);
    // Shows amounts as people type, before it adds up
    expect(previewSplit('percent', 90, ids, input({ percent: { A: '50' } }), 2, money).amounts).toEqual({ A: 45 });
  });

  it('shares: splits in proportion to the parts', () => {
    const p = previewSplit('shares', 120, ids, input({ shares: { A: '2', B: '1', C: '1' } }), 2, money);
    expect(p).toMatchObject({ ok: true, status: '4 shares · $30.00 per share' });
    expect(p.splits).toEqual([{ userId: 'A', amount: 60 }, { userId: 'B', amount: 30 }, { userId: 'C', amount: 30 }]);
    expect(previewSplit('shares', 120, ids, input({ shares: { A: '0', B: '0', C: '0' } }), 2, money).ok).toBe(false);
    expect(previewSplit('shares', 120, ids, input({ shares: { A: '1.5', B: '0.5' } }), 2, money).splits)
      .toEqual([{ userId: 'A', amount: 90 }, { userId: 'B', amount: 30 }]);
  });

  it('waits for a total before it can be saved', () => {
    const p = previewSplit('shares', null, ids, input({ shares: { A: '1' } }), 2, money);
    expect(p).toMatchObject({ ok: false, error: 'Enter the total first.', status: '1 share' });
  });

  it('every method produces an expense validateExpense accepts', () => {
    const cases: [Parameters<typeof previewSplit>[0], SplitInput][] = [
      ['equal', input()],
      ['exact', input({ exact: { A: '33.33', B: '33.33', C: '33.34' } })],
      ['percent', input({ percent: { A: '33.33', B: '33.33', C: '33.34' } })],
      ['shares', input({ shares: { A: '1', B: '2', C: '3' } })],
    ];
    for (const [method, inp] of cases) {
      const p = previewSplit(method, 100, ids, inp, 2, money);
      expect(p.ok).toBe(true);
      expect(validateExpense({ amount: 100, paidBy: 'A', splits: p.splits }, ids)).toBeNull();
    }
    const yen = previewSplit('shares', 1000, ids, input({ shares: { A: '1', B: '1', C: '1' } }), 0, money);
    expect(validateExpense({ amount: 1000, paidBy: 'A', splits: yen.splits }, ids, 0)).toBeNull();
  });
});

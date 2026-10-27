import { describe, it, expect } from 'vitest';
import { emptySplitInput, newItem, previewSplit, restoreSplit, splitByWeights, toSplitRecord, type SplitInput, type SplitMethod } from './splitModes';
import { splitEqually, validateExpense } from './settlement';

const ids = ['A', 'B', 'C'];
const money = (n: number) => `$${n.toFixed(2)}`;
const input = (over: Partial<SplitInput> = {}): SplitInput => ({ ...emptySplitInput(), ...over });
const item = (name: string, amount: string, people: string[]) => ({ ...newItem(), name, amount, people });
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
    const cases: [SplitMethod, SplitInput][] = [
      ['equal', input()],
      ['exact', input({ exact: { A: '33.33', B: '33.33', C: '33.34' } })],
      ['percent', input({ percent: { A: '33.33', B: '33.33', C: '33.34' } })],
      ['shares', input({ shares: { A: '1', B: '2', C: '3' } })],
      ['adjust', input({ adjust: { A: '+10.01', C: '-3' } })],
      ['items', input({ items: [item('Pizza', '33.33', ['A', 'B']), item('Beer', '40', ['C'])] })],
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

describe('adjust', () => {
  it('splits the rest equally after each person\'s plus or minus', () => {
    // 120 total: Alice +30 for drinks, Carol −6: 96 split three ways = 32 each
    const p = previewSplit('adjust', 120, ids, input({ adjust: { A: '+30', C: '−6' } }), 2, money);
    expect(p).toMatchObject({ ok: true, status: '$96.00 split equally, plus extras' });
    expect(p.splits).toEqual([{ userId: 'A', amount: 62 }, { userId: 'B', amount: 32 }, { userId: 'C', amount: 26 }]);
  });

  it('leaves out unticked people, and refuses shares below zero or extras over the total', () => {
    const p = previewSplit('adjust', 100, ids, input({ excluded: new Set(['B']), adjust: { B: '+50' } }), 2, money);
    expect(p.splits).toEqual([{ userId: 'A', amount: 50 }, { userId: 'C', amount: 50 }]);
    expect(previewSplit('adjust', 30, ids, input({ adjust: { A: '-20' } }), 2, money).error).toContain('below zero');
    expect(previewSplit('adjust', 30, ids, input({ adjust: { A: '40' } }), 2, money).error).toContain('more than $30.00');
  });
});

describe('items', () => {
  it('splits each item between who had it, and tax/tip by what each had', () => {
    // 2 x 50 items + 20 tax: Alice had the 50 alone, Bob and Carol shared the other
    const p = previewSplit('items', 120, ids, input({ items: [item('Steak', '50', ['A']), item('Pizza', '50', ['B', 'C'])] }), 2, money);
    expect(p).toMatchObject({ ok: true, status: '$20.00 tax/tip shared by what each had' });
    expect(p.splits).toEqual([{ userId: 'A', amount: 60 }, { userId: 'B', amount: 30 }, { userId: 'C', amount: 30 }]);
    expect(sum(p.splits)).toBe(12000);
  });

  it('asks who had an item, and catches items over the total', () => {
    expect(previewSplit('items', 100, ids, input({ items: [item('Naan', '10', [])] }), 2, money).status).toBe('Who had Naan?');
    const over = previewSplit('items', 10, ids, input({ items: [item('', '15', ['A'])] }), 2, money);
    expect(over).toMatchObject({ ok: false, status: 'Items are $5.00 over the total' });
    expect(previewSplit('items', 10, ids, input({ items: [item('', '', [])] }), 2, money).error).toBe('Add at least one item with a price.');
  });

  it('shows what each person had before the total is typed', () => {
    const p = previewSplit('items', null, ids, input({ items: [item('Tea', '4', ['A', 'B'])] }), 2, money);
    expect(p).toMatchObject({ ok: false, status: 'Items add up to $4.00', amounts: { A: 2, B: 2 } });
  });
});

describe('saving and reopening how it was split', () => {
  const reopen = (method: SplitMethod, inp: SplitInput, total = 100) => {
    const p = previewSplit(method, total, ids, inp, 2, money);
    expect(p.ok).toBe(true);
    // Round-trip through JSON, as Firestore would
    const split = JSON.parse(JSON.stringify(toSplitRecord(method, inp, ids)));
    return restoreSplit({ amount: total, splits: p.splits, split }, ids, 2);
  };

  it('reopens percent, shares, adjust and items the way they were entered', () => {
    expect(reopen('percent', input({ percent: { A: '50', B: '25', C: '25' } }))).toMatchObject({ method: 'percent', input: { percent: { A: '50', B: '25', C: '25' } } });
    expect(reopen('shares', input({ shares: { A: '2', B: '1', C: '0' } }))).toMatchObject({ method: 'shares', input: { shares: { A: '2', B: '1' } } });
    const adj = reopen('adjust', input({ excluded: new Set(['C']), adjust: { A: '+10', B: '' } }));
    expect(adj.method).toBe('adjust');
    expect(adj.input.adjust).toEqual({ A: '+10' });
    expect([...adj.input.excluded]).toEqual(['C']);
    const items = reopen('items', input({ items: [item('Steak', '50', ['A']), item('', '', []), item('Pizza', '40', ['B', 'C'])] }));
    expect(items.method).toBe('items');
    expect(items.input.items.map(i => [i.name, i.amount, i.people])).toEqual([['Steak', '50', ['A']], ['Pizza', '40', ['B', 'C']]]);
  });

  it('maps people who claimed a placeholder', () => {
    const r = restoreSplit(
      { amount: 90, splits: [{ userId: 'A', amount: 60 }, { userId: 'C', amount: 30 }], split: { method: 'shares', values: { A: 2, p1: 1 } } },
      ids, 2, id => (id === 'p1' ? 'C' : id),
    );
    expect(r).toMatchObject({ method: 'shares', input: { shares: { A: '2', C: '1' } } });
  });

  it('falls back to amounts when the saved method no longer gives the saved amounts', () => {
    // Someone edited the amounts in an older version of the app: the shares are stale
    const r = restoreSplit({ amount: 90, splits: [{ userId: 'A', amount: 50 }, { userId: 'B', amount: 40 }], split: { method: 'shares', values: { A: 2, B: 1 } } }, ids, 2);
    expect(r).toMatchObject({ method: 'exact', input: { exact: { A: '50.00', B: '40.00' } } });
    // No saved method: equal when the shares match to the cent
    expect(restoreSplit({ amount: 100, splits: splitEqually(100, ids) }, ids, 2).method).toBe('equal');
  });
});

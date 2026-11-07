import { describe, it, expect } from 'vitest';
import { allocate, computeSplit, remapSplitConfig, toSplits } from './splits';
import { validateExpense } from './settlement';
import type { SplitConfig } from '../types';

const total = (u: Record<string, number>) => Object.values(u).reduce((a, b) => a + b, 0);
const run = (config: SplitConfig, amount: number | null, digits = 2) => computeSplit(config, amount, digits);

describe('allocate', () => {
  it('always adds up to the total, giving spare paise to the first people', () => {
    expect(allocate(100, [['a', 1], ['b', 1], ['c', 1]])).toEqual({ a: 34, b: 33, c: 33 });
    expect(allocate(1001, [['a', 1], ['b', 2]])).toEqual({ a: 334, b: 667 });
  });
  it('gives nothing when every weight is 0', () => {
    expect(allocate(500, [['a', 0], ['b', 0]])).toEqual({ a: 0, b: 0 });
  });
  it('stays exact over many random splits', () => {
    for (let n = 0; n < 200; n++) {
      const t = Math.floor(Math.random() * 1e7);
      const w: [string, number][] = Array.from({ length: 1 + (n % 7) }, (_, i) => [`p${i}`, Math.random() * 10]);
      expect(total(allocate(t, w))).toBe(t);
    }
  });
});

describe('equal', () => {
  it('splits between the people in the expense', () => {
    expect(run({ method: 'equal', people: ['a', 'b', 'c'] }, 100).units).toEqual({ a: 3334, b: 3333, c: 3333 });
  });
  it('needs someone and a total', () => {
    expect(run({ method: 'equal', people: [] }, 100).problem).toEqual({ code: 'nobody' });
    expect(run({ method: 'equal', people: ['a'] }, null).problem).toEqual({ code: 'no-total' });
  });
});

describe('exact amounts, rest automatic', () => {
  it('gives the other person what is left (issue #17 example)', () => {
    const r = run({ method: 'exact', people: ['a', 'b'], amounts: { a: 100 } }, 2000);
    expect(r.units).toEqual({ a: 10000, b: 190000 });
    expect(r.auto).toEqual(['b']);
    expect(r.problem).toBeNull();
  });
  it('shares what is left equally between everyone left blank', () => {
    const r = run({ method: 'exact', people: ['a', 'b', 'c', 'd'], amounts: { a: 90 } }, 100.01);
    expect([r.units.b, r.units.c, r.units.d]).toEqual([334, 334, 333]);
    expect(total(r.units)).toBe(10001);
  });
  it('reports going over, and money nobody can take', () => {
    expect(run({ method: 'exact', people: ['a', 'b'], amounts: { a: 150 } }, 100).problem).toEqual({ code: 'over', units: 5000 });
    expect(run({ method: 'exact', people: ['a', 'b'], amounts: { a: 30, b: 50 } }, 100).problem).toEqual({ code: 'unassigned', units: 2000 });
  });
  it('rejects negative amounts', () => {
    expect(run({ method: 'exact', people: ['a', 'b'], amounts: { a: -5 } }, 100).problem).toEqual({ code: 'invalid' });
  });
  it('keeps whole yen', () => {
    expect(run({ method: 'exact', people: ['a', 'b', 'c'], amounts: { a: 1 } }, 1001, 0).units).toEqual({ a: 1, b: 500, c: 500 });
  });
});

describe('percent', () => {
  it('turns percentages into amounts', () => {
    expect(run({ method: 'percent', people: ['a', 'b'], percents: { a: 70, b: 30 } }, 1000).units).toEqual({ a: 70000, b: 30000 });
  });
  it('gives the remaining percentage to the blank people', () => {
    const r = run({ method: 'percent', people: ['a', 'b', 'c'], percents: { a: 50 } }, 200);
    expect(r.autoPercent).toBe(25);
    expect(r.units).toEqual({ a: 10000, b: 5000, c: 5000 });
  });
  it('accepts three people at 33.33%', () => {
    const r = run({ method: 'percent', people: ['a', 'b', 'c'], percents: { a: 33.33, b: 33.33, c: 33.33 } }, 100);
    expect(r.problem).toBeNull();
    expect(total(r.units)).toBe(10000);
  });
  it('reports above and below 100%', () => {
    expect(run({ method: 'percent', people: ['a', 'b'], percents: { a: 80, b: 30 } }, 100).problem).toEqual({ code: 'percent-over', percent: 10 });
    expect(run({ method: 'percent', people: ['a', 'b'], percents: { a: 50, b: 30 } }, 100).problem?.code).toBe('percent-short');
  });
});

describe('shares (parts, ratios, weights)', () => {
  it('splits 2:1', () => {
    expect(run({ method: 'shares', people: ['a', 'b'], shares: { a: 2, b: 1 } }, 300).units).toEqual({ a: 20000, b: 10000 });
  });
  it('treats a blank as 1 share and 0 as "not in it"', () => {
    expect(run({ method: 'shares', people: ['a', 'b', 'c'], shares: { a: 3, c: 0 } }, 400).units).toEqual({ a: 30000, b: 10000, c: 0 });
  });
  it('allows fractional weights', () => {
    expect(run({ method: 'shares', people: ['a', 'b'], shares: { a: 1.5, b: 0.5 } }, 100).units).toEqual({ a: 7500, b: 2500 });
  });
  it('needs at least one share', () => {
    expect(run({ method: 'shares', people: ['a'], shares: { a: 0 } }, 100).problem).toEqual({ code: 'no-shares' });
  });
});

describe('itemized', () => {
  const people = ['a', 'b', 'c'];

  it('splits each item between whoever had it', () => {
    const r = run({
      method: 'itemized', people,
      items: [
        { name: 'Pizza', price: 600, qty: 1, portions: { a: 1, b: 1, c: 1 } },
        { name: 'Beer', price: 150, qty: 2, portions: { a: 1 } },
      ],
    }, null);
    expect(r.billedUnits).toBe(90000);
    expect(r.totalUnits).toBe(90000);
    expect(r.units).toEqual({ a: 50000, b: 20000, c: 20000 });
  });

  it('supports uneven portions of a shared item', () => {
    const r = run({ method: 'itemized', people: ['a', 'b'], items: [{ name: 'Pizza', price: 800, qty: 1, portions: { a: 3, b: 5 } }] }, null);
    expect(r.units).toEqual({ a: 30000, b: 50000 });
  });

  it('spreads tax, tip and discounts in proportion to what people had', () => {
    const r = run({
      method: 'itemized', people: ['a', 'b'],
      items: [
        { name: 'Steak', price: 300, qty: 1, portions: { a: 1 } },
        { name: 'Salad', price: 100, qty: 1, portions: { b: 1 } },
      ],
      charges: [
        { kind: 'tax', mode: 'percent', value: 10 },     // +40
        { kind: 'service', mode: 'amount', value: 20 },  // +20
        { kind: 'discount', mode: 'amount', value: 60 }, // −60
      ],
    }, null);
    expect(r.billedUnits).toBe(40000);
    expect(r.units).toEqual({ a: 30000, b: 10000 });
  });

  it('shares whatever was not itemized between everyone (combination)', () => {
    // ₹1,000 bill, only the ₹200 wine itemized (for a); the rest split three ways
    const r = run({ method: 'itemized', people, items: [{ name: 'Wine', price: 200, qty: 1, portions: { a: 1 } }] }, 1000);
    expect(r.leftoverUnits).toBe(80000);
    expect(r.units).toEqual({ a: 46667, b: 26667, c: 26666 });
    expect(total(r.units)).toBe(100000);
  });

  it('reports items over the total, an item nobody had, and discounts too big', () => {
    const item = { name: 'Wine', price: 200, qty: 1, portions: { a: 1 } };
    expect(run({ method: 'itemized', people, items: [item] }, 100).problem).toEqual({ code: 'over', units: 10000 });
    expect(run({ method: 'itemized', people, items: [{ ...item, portions: {} }] }, null).problem).toEqual({ code: 'item-nobody', item: 'Wine' });
    expect(run({ method: 'itemized', people, items: [item], charges: [{ kind: 'discount', mode: 'amount', value: 500 }] }, null).problem).toEqual({ code: 'below-zero' });
  });

  it('ignores portions of people taken out of the expense', () => {
    const r = run({ method: 'itemized', people: ['a'], items: [{ name: 'Tea', price: 50, qty: 2, portions: { a: 1, b: 1 } }] }, null);
    expect(r.units).toEqual({ a: 10000 });
  });
});

describe('saving', () => {
  it('produces splits that pass the existing expense check for every method', () => {
    const people = ['a', 'b', 'c'];
    const configs: SplitConfig[] = [
      { method: 'equal', people },
      { method: 'exact', people, amounts: { a: 10.01 } },
      { method: 'percent', people, percents: { a: 33.33, b: 33.33 } },
      { method: 'shares', people, shares: { a: 1, b: 2, c: 4 } },
      { method: 'itemized', people, items: [{ name: 'x', price: 33.33, qty: 1, portions: { a: 1, c: 2 } }], charges: [{ kind: 'tip', mode: 'percent', value: 12.5 }] },
    ];
    for (const c of configs) {
      const r = run(c, 100);
      expect(r.problem).toBeNull();
      expect(validateExpense({ amount: 100, paidBy: 'a', splits: toSplits(r) }, people)).toBeNull();
    }
  });

  it('moves a claimed name-only person onto the member, adding duplicates together', () => {
    const c: SplitConfig = { method: 'shares', people: ['u', 'p1'], shares: { u: 1, p1: 2 } };
    expect(remapSplitConfig(c, id => (id === 'p1' ? 'u' : id))).toEqual({ method: 'shares', people: ['u'], shares: { u: 3 } });
  });
});

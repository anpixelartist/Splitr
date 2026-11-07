import { describe, it, expect } from 'vitest';
import { splitExact } from './splits';

const sum = (shares: Record<string, number>) =>
  Math.round(Object.values(shares).reduce((a, b) => a + b, 0) * 100) / 100;

describe('exact amounts with the rest filled in automatically', () => {
  it('gives the other person what is left (issue example)', () => {
    const r = splitExact(2000, ['a', 'b'], { a: '100' });
    expect(r.shares).toEqual({ a: 100, b: 1900 });
    expect(r.auto).toEqual(['b']);
    expect(r.remaining).toBe(1900);
    expect(r.problem).toBeNull();
  });

  it('shares what is left equally between everyone left blank, to the paisa', () => {
    const r = splitExact(1000, ['a', 'b', 'c', 'd'], { a: '100' });
    expect(r.shares.a).toBe(100);
    expect([r.shares.b, r.shares.c, r.shares.d]).toEqual([300, 300, 300]);

    // ₹10.01 left for three people: the extra paise go to the first two
    const odd = splitExact(100.01, ['a', 'b', 'c', 'd'], { a: '90' });
    expect(sum(odd.shares)).toBe(100.01);
    expect([odd.shares.b, odd.shares.c, odd.shares.d]).toEqual([3.34, 3.34, 3.33]);
  });

  it('splits equally when nothing is typed', () => {
    const r = splitExact(90, ['a', 'b', 'c'], {});
    expect(r.shares).toEqual({ a: 30, b: 30, c: 30 });
  });

  it('treats a typed 0 as "not in this expense"', () => {
    const r = splitExact(500, ['a', 'b', 'c'], { a: '0', b: '200' });
    expect(r.shares).toEqual({ a: 0, b: 200, c: 300 });
  });

  it('keeps whole numbers for currencies without decimals', () => {
    const r = splitExact(1001, ['a', 'b', 'c'], { a: '1' }, 0);
    expect(r.shares).toEqual({ a: 1, b: 500, c: 500 });
  });

  it('reports typing more than the total', () => {
    const r = splitExact(100, ['a', 'b'], { a: '150' });
    expect(r.problem).toBe('over');
    expect(r.remaining).toBe(-50);
    expect(r.shares.b).toBe(0);
  });

  it('reports money left over when everyone has a typed amount', () => {
    const r = splitExact(100, ['a', 'b'], { a: '30', b: '50' });
    expect(r.problem).toBe('unassigned');
    expect(r.remaining).toBe(20);
  });

  it('reports negative amounts', () => {
    expect(splitExact(100, ['a', 'b'], { a: '-5' }).problem).toBe('negative');
  });

  it('is fine when the typed amounts add up exactly', () => {
    const r = splitExact(100, ['a', 'b'], { a: '40', b: '60' });
    expect(r.problem).toBeNull();
    expect(r.auto).toEqual([]);
  });
});

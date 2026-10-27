// The ways an expense can be split: equally, by exact amounts, by
// percentages, by shares ("parts"), equally with adjustments, or item by item
// from a bill. Every method ends up as the same list of exact amounts per
// person, which is all balances and validateExpense look at. How it was
// entered is kept alongside (SplitRecord) only so it reopens the same way.

import type { SplitMethod, SplitRecord } from '../types';
import { splitEqually } from './settlement';

export type { SplitMethod, SplitRecord };

/** One line of a bill in an item-by-item split, as typed. */
export interface ItemInput {
  key: string;      // stable id for the form row
  name: string;
  amount: string;
  people: string[]; // who had it; they share it equally
}


export interface SplitInput {
  /** Equal and adjust: people left out (tracked this way so new members are in by default) */
  excluded: Set<string>;
  /** Text typed per person, by method */
  exact: Record<string, string>;
  percent: Record<string, string>;
  shares: Record<string, string>;
  /** Adjust: + or − on top of an equal share */
  adjust: Record<string, string>;
  items: ItemInput[];
}

export interface SplitPreview {
  /** What would be saved: only people with a share above zero */
  splits: { userId: string; amount: number }[];
  /** Each person's amount as it stands, for showing next to their name */
  amounts: Record<string, number>;
  /** Ready to save */
  ok: boolean;
  /** One short line about the split: "₹200.00 left", "100% ✓", "6 shares" */
  status: string;
  /** Why it can't be saved yet, when not ok */
  error: string | null;
}

/**
 * Splits `total` in proportion to `weights`, exact to the currency's smallest
 * unit: whatever rounding leaves over goes one unit at a time to the largest
 * remainders (ties to whoever comes first), so the shares always add up to
 * exactly `total`. Equal weights give the same result as splitEqually.
 * Weights are rounded to two decimals; zero weights get nothing.
 */
export function splitByWeights(
  total: number,
  weights: { userId: string; weight: number }[],
  digits = 2,
): { userId: string; amount: number }[] {
  const scale = 10 ** digits;
  const parts = allocate(Math.round(total * scale), weights.map(x => ({ userId: x.userId, w: Math.round(x.weight * 100) })));
  return parts.map(p => ({ userId: p.userId, amount: p.units / scale }));
}

/**
 * Shares `units` (whole smallest-currency units) in proportion to integer
 * weights, largest remainder first, ties to whoever comes first. BigInt keeps
 * units × weight exact whatever the sizes.
 */
function allocate(units: number, weights: { userId: string; w: number }[]): { userId: string; units: number }[] {
  const w = weights.filter(x => x.w > 0);
  const sum = BigInt(w.reduce((s, x) => s + x.w, 0));
  if (sum === 0n) return [];
  const parts = w.map((x, i) => {
    const product = BigInt(units) * BigInt(x.w);
    return { userId: x.userId, i, units: Number(product / sum), rem: product % sum };
  });
  let left = units - parts.reduce((s, p) => s + p.units, 0);
  for (const p of [...parts].sort((a, b) => (a.rem === b.rem ? a.i - b.i : a.rem > b.rem ? -1 : 1))) {
    if (left === 0) break;
    p.units += 1;
    left -= 1;
  }
  return parts.map(({ userId, units: u }) => ({ userId, units: u }));
}

/** A typed number: empty counts as 0, anything unreadable or negative is NaN. */
const parse = (s: string | undefined): number => {
  const t = (s ?? '').trim();
  if (t === '') return 0;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
};

/** Like parse, but a leading + or − is allowed (adjustments). */
const parseSigned = (s: string | undefined): number => {
  const t = (s ?? '').trim().replace(/^\+/, '').replace(/^[−–]/, '-');
  if (t === '' || t === '-') return 0;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};

const hasAtMost = (n: number, decimals: number) =>
  Math.abs(n * 10 ** decimals - Math.round(n * 10 ** decimals)) < 1e-6;

const fail = (amounts: Record<string, number>, status: string, error = status): SplitPreview =>
  ({ splits: [], amounts, ok: false, status, error });

/**
 * Works out a split as the person fills in the form. `total` is null until a
 * valid total is typed. `ids` is everyone who can be in the split, in order.
 */
export function previewSplit(
  method: SplitMethod,
  total: number | null,
  ids: string[],
  input: SplitInput,
  digits: number,
  money: (n: number) => string,
): SplitPreview {
  const scale = 10 ** digits;
  const ready = (splits: { userId: string; amount: number }[], status: string): SplitPreview => ({
    splits, amounts: Object.fromEntries(splits.map(s => [s.userId, s.amount])), ok: true, status, error: null,
  });

  if (method === 'equal') {
    const active = ids.filter(id => !input.excluded.has(id));
    if (active.length === 0) return fail({}, 'Pick at least one person', 'Select at least one person to split with.');
    const who = active.length === 1 ? '1 person' : `${active.length} people`;
    if (total === null) return fail({}, `Split equally between ${who}`, 'Enter the total first.');
    return ready(splitEqually(total, active, digits), `Split equally between ${who}`);
  }

  if (method === 'exact') {
    const amounts: Record<string, number> = {};
    let sum = 0;
    for (const id of ids) {
      const n = parse(input.exact[id]);
      if (Number.isNaN(n)) return fail(amounts, 'Check the amounts', 'Amounts can\'t be negative.');
      if (!hasAtMost(n, digits)) {
        return fail(amounts, 'Check the amounts', digits === 0 ? 'Each share must be a whole amount.' : 'Amounts can only have whole cents.');
      }
      if (n > 0) amounts[id] = n;
      sum += Math.round(n * scale);
    }
    if (sum === 0) return fail(amounts, 'Enter each person\'s amount', 'Enter at least one amount.');
    if (total === null) return fail(amounts, `${money(sum / scale)} entered`, 'Enter the total first.');
    const diff = Math.round(total * scale) - sum;
    if (diff !== 0) {
      const off = money(Math.abs(diff) / scale);
      return fail(amounts, diff > 0 ? `${off} left to assign` : `${off} over the total`,
        `Amounts don't add up — off by ${off}. Total must equal ${money(total)}.`);
    }
    return ready(ids.filter(id => amounts[id]).map(id => ({ userId: id, amount: amounts[id] })), 'Adds up to the total ✓');
  }

  if (method === 'adjust') {
    const active = ids.filter(id => !input.excluded.has(id));
    if (active.length === 0) return fail({}, 'Pick at least one person', 'Select at least one person to split with.');
    const extra: Record<string, number> = {};
    let extras = 0;
    for (const id of active) {
      const n = parseSigned(input.adjust[id]);
      if (Number.isNaN(n) || !hasAtMost(n, digits)) {
        return fail({}, 'Check the adjustments', digits === 0 ? 'Adjustments must be whole amounts.' : 'Adjustments can only have whole cents.');
      }
      extra[id] = Math.round(n * scale);
      extras += extra[id];
    }
    if (total === null) return fail({}, 'Equal shares, plus or minus extras', 'Enter the total first.');
    const rest = Math.round(total * scale) - extras;
    if (rest < 0) return fail({}, 'Extras are more than the total', `The extras add up to more than ${money(total)}.`);
    const units = splitEqually(rest / scale, active, digits).map(s => ({ userId: s.userId, u: Math.round(s.amount * scale) + extra[s.userId] }));
    const amounts = Object.fromEntries(units.map(x => [x.userId, x.u / scale]));
    if (units.some(x => x.u < 0)) return fail(amounts, 'A share is below zero', 'Someone\'s share would be below zero. Make the minus smaller.');
    const status = extras === 0
      ? `Split equally between ${active.length === 1 ? '1 person' : `${active.length} people`}`
      : `${money(rest / scale)} split equally, plus extras`;
    return ready(units.filter(x => x.u > 0).map(x => ({ userId: x.userId, amount: x.u / scale })), status);
  }

  if (method === 'items') {
    const per = new Map<string, number>(ids.map(id => [id, 0])); // units per person from the items
    let itemsTotal = 0;
    for (const [n, item] of input.items.entries()) {
      const label = item.name.trim() || `item ${n + 1}`;
      const a = parse(item.amount);
      if (Number.isNaN(a) || !hasAtMost(a, digits)) {
        return fail({}, 'Check the item prices', `The price of ${label} isn't a valid amount.`);
      }
      if (a === 0) continue; // a blank row
      const people = item.people.filter(id => per.has(id));
      if (people.length === 0) return fail({}, `Who had ${label}?`, `Choose who had ${label}.`);
      for (const s of splitEqually(a, people, digits)) per.set(s.userId, per.get(s.userId)! + Math.round(s.amount * scale));
      itemsTotal += Math.round(a * scale);
    }
    if (itemsTotal === 0) return fail({}, 'Add the items from the bill', 'Add at least one item with a price.');
    const fromItems = Object.fromEntries([...per].filter(([, u]) => u > 0).map(([id, u]) => [id, u / scale]));
    if (total === null) return fail(fromItems, `Items add up to ${money(itemsTotal / scale)}`, 'Enter the total first.');
    const extra = Math.round(total * scale) - itemsTotal;
    if (extra < 0) {
      return fail(fromItems, `Items are ${money(-extra / scale)} over the total`,
        `The items add up to ${money(itemsTotal / scale)}, more than the total.`);
    }
    // Tax, tip and anything not itemised: shared in proportion to what each person had
    for (const x of allocate(extra, [...per].map(([userId, w]) => ({ userId, w })))) per.set(x.userId, per.get(x.userId)! + x.units);
    const splits = ids.filter(id => per.get(id)! > 0).map(id => ({ userId: id, amount: per.get(id)! / scale }));
    return ready(splits, extra === 0 ? 'Items add up to the total ✓' : `${money(extra / scale)} tax/tip shared by what each had`);
  }

  // Percentages and shares: weights, turned into amounts by splitByWeights
  const isPercent = method === 'percent';
  const typed = isPercent ? input.percent : input.shares;
  const weights: { userId: string; weight: number }[] = [];
  for (const id of ids) {
    const n = parse(typed[id]);
    if (Number.isNaN(n) || !hasAtMost(n, 2)) {
      return fail({}, isPercent ? 'Check the percentages' : 'Check the shares',
        isPercent ? 'Percentages must be positive, with at most 2 decimals.' : 'Shares must be positive, with at most 2 decimals.');
    }
    if (n > 0) weights.push({ userId: id, weight: n });
  }
  const sum = weights.reduce((s, x) => s + Math.round(x.weight * 100), 0); // hundredths
  const approx = (w: number) => total === null || sum === 0 ? 0 : Math.round((total * w * 100 / (isPercent ? 10000 : sum)) * scale) / scale;
  const amounts = Object.fromEntries(weights.map(x => [x.userId, approx(x.weight)]));

  if (isPercent) {
    const left = 10000 - sum;
    const pct = (h: number) => `${(Math.abs(h) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
    if (sum === 0) return fail(amounts, 'Enter each person\'s percentage', 'Enter at least one percentage.');
    if (left !== 0) {
      return fail(amounts, left > 0 ? `${pct(left)} left` : `${pct(left)} over 100%`,
        `Percentages must add up to 100% (now ${pct(sum)}).`);
    }
    if (total === null) return fail(amounts, '100% ✓', 'Enter the total first.');
    return ready(splitByWeights(total, weights, digits), '100% ✓');
  }

  if (sum === 0) return fail(amounts, 'Give at least one person a share', 'Give at least one person a share.');
  const count = (sum / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
  const label = `${count} ${sum === 100 ? 'share' : 'shares'}`;
  if (total === null) return fail(amounts, label, 'Enter the total first.');
  return ready(splitByWeights(total, weights, digits), `${label} · ${money(total * 100 / sum)} per share`);
}

export const emptySplitInput = (): SplitInput =>
  ({ excluded: new Set(), exact: {}, percent: {}, shares: {}, adjust: {}, items: [] });

let itemKeys = 0;
export const newItem = (): ItemInput => ({ key: `item-${++itemKeys}`, name: '', amount: '', people: [] });

/** What to save about how the split was entered. */
export function toSplitRecord(method: SplitMethod, input: SplitInput, ids: string[]): SplitRecord {
  const numbers = (typed: Record<string, string>, keep: (id: string, n: number) => boolean, signed = false) => {
    const out: Record<string, number> = {};
    for (const id of ids) {
      const n = (signed ? parseSigned : parse)(typed[id]);
      if (Number.isFinite(n) && keep(id, n)) out[id] = n;
    }
    return out;
  };
  switch (method) {
    case 'percent': return { method, values: numbers(input.percent, (_, n) => n > 0) };
    case 'shares': return { method, values: numbers(input.shares, (_, n) => n > 0) };
    case 'adjust': return { method, values: numbers(input.adjust, id => !input.excluded.has(id), true) };
    case 'items': return {
      method,
      items: input.items
        .map(i => ({ name: i.name.trim(), amount: parse(i.amount), people: i.people.filter(id => ids.includes(id)) }))
        .filter(i => i.amount > 0),
    };
    default: return { method };
  }
}

/**
 * How to show a saved expense in the form: the way it was entered, when that
 * still gives exactly the saved amounts; otherwise equally (shares equal to
 * the cent) or as exact amounts. `resolve` maps ids saved before a
 * placeholder was claimed to whoever claimed it.
 */
export function restoreSplit(
  expense: { amount: number; splits: { userId: string; amount: number }[]; split?: SplitRecord },
  ids: string[],
  digits: number,
  resolve: (id: string) => string = id => id,
): { method: SplitMethod; input: SplitInput } {
  // Merged per person: a claimed placeholder can make one person appear twice
  const shares = new Map<string, number>();
  for (const s of expense.splits) shares.set(s.userId, Math.round(((shares.get(s.userId) ?? 0) + s.amount) * 100) / 100);
  const base = emptySplitInput();
  base.exact = Object.fromEntries([...shares].map(([id, a]) => [id, a.toFixed(digits)]));
  base.excluded = new Set(ids.filter(id => !shares.has(id)));

  const r = expense.split;
  if (r) {
    const input: SplitInput = { ...base, excluded: new Set(base.excluded) };
    const values = Object.fromEntries(Object.entries(r.values ?? {}).map(([id, n]) => [resolve(id), n]));
    if (r.method === 'percent' || r.method === 'shares') {
      input[r.method] = Object.fromEntries(Object.entries(values).map(([id, n]) => [id, String(n)]));
    } else if (r.method === 'adjust') {
      input.adjust = Object.fromEntries(Object.entries(values).filter(([, n]) => n !== 0).map(([id, n]) => [id, n > 0 ? `+${n}` : String(n)]));
      input.excluded = new Set(ids.filter(id => !(id in values)));
    } else if (r.method === 'items') {
      input.items = (r.items ?? []).map(i => ({ ...newItem(), name: i.name, amount: String(i.amount), people: i.people.map(resolve) }));
    }
    // Only trusted when it reproduces exactly what was saved
    const again = previewSplit(r.method, expense.amount, ids, input, digits, String);
    const same = again.ok && again.splits.length === shares.size
      && again.splits.every(s => Math.round(s.amount * 100) === Math.round((shares.get(s.userId) ?? NaN) * 100));
    if (same) return { method: r.method, input };
  }

  const cents = [...shares.values()].map(a => Math.round(a * 100));
  const equal = cents.length > 0 && Math.max(...cents) - Math.min(...cents) <= 1;
  return { method: equal ? 'equal' : 'exact', input: base };
}

/** Starting values when someone switches to a method. */
export function defaultsFor(method: SplitMethod, ids: string[]): Record<string, string> {
  return method === 'shares' ? Object.fromEntries(ids.map(id => [id, '1'])) : {};
}

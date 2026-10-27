// The ways an expense can be split: equally, by exact amounts, by percentages
// or by shares ("parts"). Every method ends up as the same stored data, a
// list of exact amounts per person, so balances, firestore.rules and
// validateExpense don't need to know which method was used.

import { splitEqually } from './settlement';

export type SplitMethod = 'equal' | 'exact' | 'percent' | 'shares';

export interface SplitInput {
  /** Equal: people left out (tracked this way so new members are in by default) */
  excluded: Set<string>;
  /** Text typed per person, by method */
  exact: Record<string, string>;
  percent: Record<string, string>;
  shares: Record<string, string>;
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
  const units = Math.round(total * scale);
  const w = weights.map(x => ({ userId: x.userId, w: Math.round(x.weight * 100) })).filter(x => x.w > 0);
  const sum = w.reduce((s, x) => s + x.w, 0);
  if (sum === 0) return [];
  // Integer arithmetic throughout: units × weight stays far below 2^53
  const parts = w.map((x, i) => ({ ...x, i, base: Math.floor((units * x.w) / sum), rem: (units * x.w) % sum }));
  let left = units - parts.reduce((s, p) => s + p.base, 0);
  for (const p of [...parts].sort((a, b) => b.rem - a.rem || a.i - b.i)) {
    if (left === 0) break;
    p.base += 1;
    left -= 1;
  }
  return parts.map(p => ({ userId: p.userId, amount: p.base / scale }));
}

/** A typed number: empty counts as 0, anything unreadable or negative is NaN. */
const parse = (s: string | undefined): number => {
  const t = (s ?? '').trim();
  if (t === '') return 0;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
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

/** Starting values when someone switches to a method. */
export function defaultsFor(method: SplitMethod, ids: string[]): Record<string, string> {
  return method === 'shares' ? Object.fromEntries(ids.map(id => [id, '1'])) : {};
}

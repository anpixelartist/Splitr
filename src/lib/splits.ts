import type { SplitCharge, SplitConfig, SplitItem } from '../types';

// ─── The expense-splitting engine ────────────────────────────────────────────
// One place that turns "how the user wants to split it" (a SplitConfig) into
// exact shares. Every method ends in allocate(), which works in the currency's
// smallest unit (paise, cents, yen), so the shares always add up to the total
// exactly and nobody gains or loses a paisa to rounding.

/**
 * Splits `totalUnits` in proportion to the weights, in whole units, summing
 * exactly to the total (largest-remainder method). Leftover units go to the
 * biggest fractions first, then to whoever comes first in the list.
 */
export function allocate(totalUnits: number, weights: [string, number][]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id] of weights) out[id] = out[id] ?? 0;
  const sum = weights.reduce((a, [, w]) => a + w, 0);
  if (!(sum > 0) || totalUnits <= 0) return out;

  const parts = weights.map(([id, w], i) => {
    const exact = (totalUnits * w) / sum;
    // Snap away float noise so 33.3333…/33.3333… ties stay ties
    const floor = Math.floor(exact + 1e-9);
    return { id, i, floor, frac: Math.round((exact - floor) * 1e9) };
  });
  let given = 0;
  for (const p of parts) { out[p.id] += p.floor; given += p.floor; }
  const order = [...parts].sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; k < totalUnits - given; k++) out[order[k % order.length].id] += 1;
  return out;
}

export type SplitProblem =
  | { code: 'nobody' }                          // nobody is in the expense
  | { code: 'invalid' }                         // a negative or unreadable number
  | { code: 'no-total' }                        // no total (and nothing itemized)
  | { code: 'over'; units: number }             // typed / itemized more than the total
  | { code: 'unassigned'; units: number }       // money left that nobody's box can take
  | { code: 'percent-over'; percent: number }   // percentages above 100
  | { code: 'percent-short'; percent: number }  // percentages below 100, nobody blank
  | { code: 'no-shares' }                       // every share is 0
  | { code: 'item-nobody'; item: string }       // an item nobody had
  | { code: 'below-zero' };                     // discounts bigger than the bill

export type SplitResult = {
  /** Each person's share in smallest units */
  units: Record<string, number>;
  /** People whose input was left blank and got an automatic value */
  auto: string[];
  /** percent: the percentage each blank person gets */
  autoPercent?: number;
  /** The total that was split (itemized with no total: the bill) */
  totalUnits: number;
  /** itemized: items plus charges */
  billedUnits?: number;
  /** exact: total − typed; itemized: total − bill. What blank / ticked people share. */
  leftoverUnits: number;
  problem: SplitProblem | null;
};

const bad = (n: number | undefined) => n !== undefined && (!Number.isFinite(n) || n < 0);
const sumOf = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
/** A percentage sum this close to 100 counts as 100 (three people × 33.33%). */
const PERCENT_SLACK = 0.01 + 1e-9;

/**
 * Works out everyone's share. `total` is in major units (rupees); null or NaN
 * means "not entered", which itemized expenses fill from the bill.
 */
export function computeSplit(config: SplitConfig, total: number | null, digits = 2): SplitResult {
  const scale = 10 ** digits;
  const people = [...new Set(config.people)];
  const hasTotal = total !== null && Number.isFinite(total) && total > 0;
  let totalUnits = hasTotal ? Math.round(total! * scale) : 0;
  const empty = (problem: SplitProblem | null, extra: Partial<SplitResult> = {}): SplitResult => ({
    units: Object.fromEntries(people.map(p => [p, 0])), auto: [], totalUnits, leftoverUnits: 0, problem, ...extra,
  });

  if (people.length === 0) return empty({ code: 'nobody' });

  switch (config.method) {
    case 'equal': {
      if (!hasTotal) return empty({ code: 'no-total' });
      return { units: allocate(totalUnits, people.map(p => [p, 1])), auto: [], totalUnits, leftoverUnits: 0, problem: null };
    }

    case 'exact': {
      const typed = config.amounts ?? {};
      if (people.some(p => bad(typed[p]))) return empty({ code: 'invalid' });
      const blank = people.filter(p => typed[p] === undefined);
      const typedUnits = Object.fromEntries(people.filter(p => typed[p] !== undefined).map(p => [p, Math.round(typed[p] * scale)]));
      const leftover = totalUnits - sumOf(Object.values(typedUnits));
      const units = { ...allocate(Math.max(leftover, 0), blank.map(p => [p, 1])), ...typedUnits };
      let problem: SplitProblem | null = null;
      if (!hasTotal) problem = { code: 'no-total' };
      else if (leftover < 0) problem = { code: 'over', units: -leftover };
      else if (leftover > 0 && blank.length === 0) problem = { code: 'unassigned', units: leftover };
      return { units, auto: blank, totalUnits, leftoverUnits: leftover, problem };
    }

    case 'percent': {
      const typed = config.percents ?? {};
      if (people.some(p => bad(typed[p]))) return empty({ code: 'invalid' });
      const blank = people.filter(p => typed[p] === undefined);
      const typedSum = sumOf(people.map(p => typed[p] ?? 0));
      const rest = 100 - typedSum;
      const autoPercent = blank.length ? Math.max(rest, 0) / blank.length : undefined;
      let problem: SplitProblem | null = null;
      if (rest < -PERCENT_SLACK) problem = { code: 'percent-over', percent: -rest };
      else if (blank.length === 0 && rest > PERCENT_SLACK) problem = { code: 'percent-short', percent: rest };
      else if (!hasTotal) problem = { code: 'no-total' };
      const weights: [string, number][] = people.map(p => [p, typed[p] ?? autoPercent ?? 0]);
      const units = problem ? Object.fromEntries(people.map(p => [p, 0])) : allocate(totalUnits, weights);
      return { units, auto: blank, autoPercent, totalUnits, leftoverUnits: 0, problem };
    }

    case 'shares': {
      const typed = config.shares ?? {};
      if (people.some(p => bad(typed[p]))) return empty({ code: 'invalid' });
      const weights: [string, number][] = people.map(p => [p, typed[p] ?? 1]);
      const blank = people.filter(p => typed[p] === undefined);
      if (sumOf(weights.map(([, w]) => w)) <= 0) return empty({ code: 'no-shares' }, { auto: blank });
      if (!hasTotal) return empty({ code: 'no-total' }, { auto: blank });
      return { units: allocate(totalUnits, weights), auto: blank, totalUnits, leftoverUnits: 0, problem: null };
    }

    case 'itemized':
      return itemized(config.items ?? [], config.charges ?? [], people, hasTotal ? totalUnits : null, scale);
  }
}

/** Items (each shared by some people), then charges spread in proportion to what each person had. */
function itemized(items: SplitItem[], charges: SplitCharge[], people: string[], totalUnits: number | null, scale: number): SplitResult {
  const inExpense = new Set(people);
  const zero = () => Object.fromEntries(people.map(p => [p, 0]));
  const fail = (problem: SplitProblem): SplitResult => ({ units: zero(), auto: [], totalUnits: totalUnits ?? 0, leftoverUnits: 0, problem });

  if (items.some(it => bad(it.price) || bad(it.qty) || Object.values(it.portions).some(bad))) return fail({ code: 'invalid' });
  if (charges.some(c => bad(c.value))) return fail({ code: 'invalid' });

  // 1. Each item, split by portions between the people who had it
  const subtotal = zero();
  let itemsUnits = 0;
  for (const it of items) {
    const units = Math.round(it.price * it.qty * scale);
    if (units === 0) continue;
    const had = Object.entries(it.portions).filter(([p, w]) => inExpense.has(p) && w > 0);
    if (had.length === 0) return fail({ code: 'item-nobody', item: it.name || 'An item' });
    const shares = allocate(units, had);
    for (const [p, u] of Object.entries(shares)) subtotal[p] += u;
    itemsUnits += units;
  }

  // 2. Tax, service, tip and fees add to the bill, discounts take off it.
  //    Percentages are of the items. Spread in proportion to each person's items.
  let chargesUnits = 0;
  for (const c of charges) {
    const u = c.mode === 'percent' ? Math.round((itemsUnits * c.value) / 100) : Math.round(c.value * scale);
    chargesUnits += c.kind === 'discount' ? -u : u;
  }
  const billedUnits = itemsUnits + chargesUnits;
  if (billedUnits < 0) return fail({ code: 'below-zero' });
  const billShares = itemsUnits > 0
    ? allocate(billedUnits, people.map(p => [p, subtotal[p]]))
    // Only flat charges and no items: share them equally
    : allocate(billedUnits, people.map(p => [p, 1]));

  // 3. Whatever the total has beyond the itemized bill is shared equally
  //    by everyone in the expense (e.g. itemize the drinks, split the rest).
  const total = totalUnits ?? billedUnits;
  if (total === 0) return { ...fail({ code: 'no-total' }), billedUnits };
  const leftover = total - billedUnits;
  if (leftover < 0) return { ...fail({ code: 'over', units: -leftover }), billedUnits, totalUnits: total };
  const rest = allocate(leftover, people.map(p => [p, 1]));
  const units = Object.fromEntries(people.map(p => [p, billShares[p] + rest[p]]));
  return { units, auto: [], totalUnits: total, billedUnits, leftoverUnits: leftover, problem: null };
}

/** The splits to save: everyone with a share above zero, in major units. */
export const toSplits = (result: SplitResult, digits = 2) =>
  Object.entries(result.units)
    .filter(([, u]) => u > 0)
    .map(([userId, u]) => ({ userId, amount: u / 10 ** digits }));

/**
 * Rewrites the person ids in a config (used when a name-only participant is
 * claimed). If two ids become one person, their inputs are added together.
 */
export function remapSplitConfig(config: SplitConfig, r: (id: string) => string): SplitConfig {
  const merge = (rec: Record<string, number> | undefined) => {
    if (!rec) return undefined;
    const out: Record<string, number> = {};
    for (const [id, v] of Object.entries(rec)) out[r(id)] = (out[r(id)] ?? 0) + v;
    return out;
  };
  const out: SplitConfig = { ...config, people: [...new Set(config.people.map(r))] };
  if (config.amounts) out.amounts = merge(config.amounts);
  if (config.percents) out.percents = merge(config.percents);
  if (config.shares) out.shares = merge(config.shares);
  if (config.items) out.items = config.items.map(it => ({ ...it, portions: merge(it.portions)! }));
  return out;
}

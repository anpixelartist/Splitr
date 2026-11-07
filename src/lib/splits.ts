import { splitEqually } from './settlement';

// "Exact amounts" with automatic remainder: people the user typed an amount
// for keep it, and whatever is left of the total is shared equally between
// everyone whose box is still empty. All maths is in the currency's smallest
// unit (paise, cents, yen) so the shares always add up to the total exactly.

export type ExactSplit = {
  /** Every person's share, in major units (e.g. rupees), typed or automatic */
  shares: Record<string, number>;
  /** People whose share was filled in automatically */
  auto: string[];
  /** Total minus what was typed, in major units. Negative means typed too much. */
  remaining: number;
  /** Why it can't be saved yet, or null when it's fine */
  problem: 'over' | 'unassigned' | 'negative' | null;
};

const isBlank = (s: string | undefined) => s === undefined || s.trim() === '';

export function splitExact(
  total: number,
  people: string[],
  entered: Record<string, string | undefined>,
  digits = 2,
): ExactSplit {
  const scale = 10 ** digits;
  const totalUnits = Math.round((Number.isFinite(total) ? total : 0) * scale);

  const typedUnits: Record<string, number> = {};
  const auto: string[] = [];
  let negative = false;
  for (const id of people) {
    if (isBlank(entered[id])) { auto.push(id); continue; }
    const v = parseFloat(entered[id]!);
    if (Number.isNaN(v) || v < 0) negative = true;
    typedUnits[id] = Number.isNaN(v) ? 0 : Math.round(v * scale);
  }

  const typedSum = Object.values(typedUnits).reduce((a, b) => a + b, 0);
  const remainingUnits = totalUnits - typedSum;

  const shares: Record<string, number> = {};
  for (const [id, u] of Object.entries(typedUnits)) shares[id] = u / scale;
  // Only share out what's left; a negative remainder is shown, not split
  const autoShares = splitEqually(Math.max(remainingUnits, 0) / scale, auto, digits);
  for (const s of autoShares) shares[s.userId] = s.amount;

  let problem: ExactSplit['problem'] = null;
  if (negative) problem = 'negative';
  else if (remainingUnits < 0) problem = 'over';
  else if (remainingUnits > 0 && auto.length === 0) problem = 'unassigned';

  return { shares, auto, remaining: remainingUnits / scale, problem };
}

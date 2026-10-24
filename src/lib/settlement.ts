import type { Expense, Balance, SettlementTransaction, SettlementRecord } from '../types';

// All arithmetic below is done in integer cents. Stored amounts are dollars
// with at most two decimals, so converting each one with Math.round is exact,
// and integer sums never drift. A 1-cent debt is a real debt, not noise.
const toCents = (dollars: number) => Math.round(dollars * 100);

/**
 * Calculates the net balances for each user based on expenses and any
 * previously-recorded settlement payments. Settlement records reduce
 * outstanding debts by crediting the payer (from) and debiting the receiver (to).
 */
export function calculateBalances(
  expenses: Expense[],
  settlementRecords: SettlementRecord[] = [],
): Record<string, Balance> {
  const cents: Record<string, number> = {};
  const add = (userId: string, delta: number) => { cents[userId] = (cents[userId] ?? 0) + delta; };

  for (const expense of expenses) {
    add(expense.paidBy, toCents(expense.amount));
    for (const split of expense.splits) add(split.userId, -toCents(split.amount));
  }

  // Each recorded settlement cancels out that much debt:
  // the payer (from) gets credited, the receiver (to) gets debited.
  for (const record of settlementRecords) {
    add(record.from, toCents(record.amount));
    add(record.to, -toCents(record.amount));
  }

  const result: Record<string, Balance> = {};
  for (const [userId, c] of Object.entries(cents)) {
    result[userId] = { userId, netBalance: c / 100 };
  }
  return result;
}

/** True when this balance is exactly zero (to the cent). */
export const isSettled = (netBalance: number) => toCents(netBalance) === 0;

/**
 * Generates a short list of transactions that settles all debts.
 * Greedy (largest debtor pays largest creditor): at most n-1 transactions,
 * usually optimal for small groups, but not guaranteed to be the true minimum.
 */
export function calculateSettlements(balances: Record<string, Balance>): SettlementTransaction[] {
  const debtors: { userId: string; cents: number }[] = [];
  const creditors: { userId: string; cents: number }[] = [];

  for (const balance of Object.values(balances)) {
    const c = toCents(balance.netBalance);
    if (c < 0) debtors.push({ userId: balance.userId, cents: -c });
    else if (c > 0) creditors.push({ userId: balance.userId, cents: c });
  }

  // Sort by amount descending to greedily match largest debts with largest credits
  debtors.sort((a, b) => b.cents - a.cents);
  creditors.sort((a, b) => b.cents - a.cents);

  const transactions: SettlementTransaction[] = [];
  let d = 0; // Debtor index
  let c = 0; // Creditor index

  while (d < debtors.length && c < creditors.length) {
    const debtor = debtors[d];
    const creditor = creditors[c];
    const settled = Math.min(debtor.cents, creditor.cents);

    transactions.push({ from: debtor.userId, to: creditor.userId, amount: settled / 100 });

    debtor.cents -= settled;
    creditor.cents -= settled;
    if (debtor.cents === 0) d++;
    if (creditor.cents === 0) c++;
  }

  return transactions;
}

/**
 * Splits `total` equally between `userIds`, exact to the cent. Leftover cents
 * go one each to the first people in the list, so the shares always add up
 * to exactly `total` (e.g. 100 / 3 -> 33.34, 33.33, 33.33).
 */
export function splitEqually(total: number, userIds: string[]): { userId: string; amount: number }[] {
  if (userIds.length === 0) return [];
  const totalCents = Math.round(total * 100);
  const base = Math.floor(totalCents / userIds.length);
  const remainder = totalCents - base * userIds.length;
  return userIds.map((userId, i) => ({
    userId,
    amount: (base + (i < remainder ? 1 : 0)) / 100,
  }));
}

/** Rounds a money amount to whole cents. */
export const roundToCents = (n: number) => Math.round(n * 100) / 100;

/**
 * Checks that an expense is internally consistent before it is saved: a
 * positive whole-cent total, a payer and split people who are in the group,
 * no one listed twice, and shares that add up to exactly the total.
 * Returns an error message, or null when the expense is valid.
 *
 * The security rules can't sum a list, so this is the only guard against a
 * UI bug writing an expense that creates or destroys money.
 */
export function validateExpense(
  expense: Pick<Expense, 'amount' | 'paidBy' | 'splits'>,
  groupUserIds: string[],
): string | null {
  const known = new Set(groupUserIds);
  const total = toCents(expense.amount);
  if (!Number.isFinite(expense.amount) || total <= 0) return 'The amount must be greater than 0.';
  if (Math.abs(expense.amount * 100 - total) > 1e-3) return 'Amounts can only have whole cents.';
  if (!known.has(expense.paidBy)) return 'The person who paid is not in this group.';
  if (expense.splits.length === 0) return 'Split the expense with at least one person.';

  const seen = new Set<string>();
  let sum = 0;
  for (const split of expense.splits) {
    if (!known.has(split.userId)) return 'Someone in the split is not in this group.';
    if (seen.has(split.userId)) return 'Someone appears twice in the split.';
    seen.add(split.userId);
    const c = toCents(split.amount);
    if (!Number.isFinite(split.amount) || c < 0 || Math.abs(split.amount * 100 - c) > 1e-3) {
      return 'Each share must be a positive amount in whole cents.';
    }
    sum += c;
  }
  if (sum !== total) return 'The shares don\'t add up to the total.';
  return null;
}

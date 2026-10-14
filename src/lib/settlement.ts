import type { Expense, Balance, SettlementTransaction, SettlementRecord } from '../types';

/**
 * Calculates the net balances for each user based on expenses and any
 * previously-recorded settlement payments. Settlement records reduce
 * outstanding debts by crediting the payer (from) and debiting the receiver (to).
 */
export function calculateBalances(
  expenses: Expense[],
  settlementRecords: SettlementRecord[] = [],
): Record<string, Balance> {
  const balances: Record<string, number> = {};

  for (const expense of expenses) {
    balances[expense.paidBy] = (balances[expense.paidBy] || 0) + expense.amount;
    for (const split of expense.splits) {
      balances[split.userId] = (balances[split.userId] || 0) - split.amount;
    }
  }

  // Each recorded settlement cancels out that much debt:
  // the payer (from) gets credited, the receiver (to) gets debited.
  for (const record of settlementRecords) {
    balances[record.from] = (balances[record.from] || 0) + record.amount;
    balances[record.to] = (balances[record.to] || 0) - record.amount;
  }

  const result: Record<string, Balance> = {};
  for (const [userId, netBalance] of Object.entries(balances)) {
    result[userId] = {
      userId,
      netBalance: Math.round(netBalance * 100) / 100,
    };
  }

  return result;
}

/**
 * Generates the minimum number of transactions to settle all debts.
 */
export function calculateSettlements(balances: Record<string, Balance>): SettlementTransaction[] {
  const debtors: { userId: string; amount: number }[] = [];
  const creditors: { userId: string; amount: number }[] = [];

  for (const balance of Object.values(balances)) {
    if (balance.netBalance < -0.01) { // -0.01 tolerance for floating point precision
      debtors.push({ userId: balance.userId, amount: Math.abs(balance.netBalance) });
    } else if (balance.netBalance > 0.01) {
      creditors.push({ userId: balance.userId, amount: balance.netBalance });
    }
  }

  // Sort by amount descending to greedily match largest debts with largest credits
  debtors.sort((a, b) => b.amount - a.amount);
  creditors.sort((a, b) => b.amount - a.amount);

  const transactions: SettlementTransaction[] = [];
  let d = 0; // Debtor index
  let c = 0; // Creditor index

  while (d < debtors.length && c < creditors.length) {
    const debtor = debtors[d];
    const creditor = creditors[c];

    const settledAmount = Math.min(debtor.amount, creditor.amount);

    transactions.push({
      from: debtor.userId,
      to: creditor.userId,
      amount: Math.round(settledAmount * 100) / 100,
    });

    debtor.amount -= settledAmount;
    creditor.amount -= settledAmount;

    // Move pointers if someone's balance is settled (with tolerance)
    if (debtor.amount < 0.01) d++;
    if (creditor.amount < 0.01) c++;
  }

  return transactions;
}

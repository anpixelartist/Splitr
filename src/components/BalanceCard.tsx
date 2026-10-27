import React from 'react';
import NumberFlow from '@number-flow/react';
import { currencyDigits, formatMoney } from '../lib/money';

type Props = {
  balance: number;    // positive: you are owed; negative: you owe
  groupSpend: number; // sum of every expense in the group
  yourShare: number;  // sum of your splits across those expenses
  currency: string;
};

// The amount rolls to its new value when an expense or payment changes it.
// NumberFlow skips the animation when the OS asks for reduced motion.
export const BalanceCard: React.FC<Props> = ({ balance, groupSpend, yourShare, currency }) => {
  const digits = currencyDigits(currency);
  const tone = balance > 0 ? 'owed' : balance < 0 ? 'owe' : 'settled';

  const label = { owed: 'You are owed', owe: 'You owe', settled: 'You are settled up' }[tone];
  const amountColor = {
    owed: 'text-green-600 dark:text-green-400',
    owe: 'text-red-600 dark:text-red-400',
    settled: 'text-gray-900',
  }[tone];
  const glow = { owed: 'bg-green-400', owe: 'bg-red-400', settled: 'bg-blue-500' }[tone];

  return (
    <div className="relative overflow-hidden rounded-3xl bg-surface p-5 shadow-[0_1px_2px_rgb(0_0_0/0.04),0_12px_32px_-16px_rgb(0_0_0/0.18)]">
      {/* Soft colour wash in the corner, static so it costs nothing after paint */}
      <div aria-hidden="true" className={`pointer-events-none absolute -top-20 -right-20 h-48 w-48 rounded-full opacity-25 blur-3xl ${glow}`} />

      <p className="relative text-sm font-medium text-gray-500">{label}</p>
      <NumberFlow
        value={Math.abs(balance)}
        format={{ style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }}
        className={`relative mt-1 block text-[2.5rem] leading-none font-semibold tracking-tight tabular-nums ${amountColor}`}
      />

      <div className="relative mt-5 grid grid-cols-2 border-t border-gray-200/70 pt-4">
        <div>
          <p className="text-xs text-gray-500">Group spend</p>
          <p className="mt-0.5 font-semibold tabular-nums text-gray-900">{formatMoney(groupSpend, currency)}</p>
        </div>
        <div className="border-l border-gray-200/70 pl-4">
          <p className="text-xs text-gray-500">Your share</p>
          <p className="mt-0.5 font-semibold tabular-nums text-gray-900">{formatMoney(yourShare, currency)}</p>
        </div>
      </div>
    </div>
  );
};

import { describe, it, expect } from 'vitest';
import { formatMoney, currencyDigits, defaultCurrency, currencySymbol, formatDate } from './money';
import { splitEqually, validateExpense } from './settlement';

describe('money formatting', () => {
  it('formats rupees with grouping, Indian style on an Indian phone', () => {
    expect(formatMoney(1000, 'INR', 'en-US')).toBe('₹1,000.00');
    expect(formatMoney(100000, 'INR', 'en-IN')).toBe('₹1,00,000.00');
  });

  it('uses no decimals for yen', () => {
    expect(currencyDigits('JPY')).toBe(0);
    expect(formatMoney(300, 'JPY', 'en-US')).toBe('¥300');
  });

  it('picks the device region\'s currency', () => {
    expect(defaultCurrency('en-IN')).toBe('INR');
    expect(defaultCurrency('de-DE')).toBe('EUR');
    expect(defaultCurrency('en-US')).toBe('USD');
    expect(defaultCurrency('xx')).toBe('USD');
  });

  it('gives a plain symbol for input prefixes', () => {
    expect(currencySymbol('INR', 'en-IN')).toBe('₹');
    expect(currencySymbol('USD', 'en-US')).toBe('$');
  });

  it('writes dates with a month name, never 10/24/2026', () => {
    const d = '2026-10-24T12:00:00.000Z';
    expect(formatDate(d, 'en-IN')).toBe('24 Oct 2026');
    expect(formatDate(d, 'en-US')).toBe('Oct 24, 2026');
  });
});

describe('whole-unit currencies', () => {
  it('splits yen in whole yen', () => {
    expect(splitEqually(100, ['a', 'b', 'c'], 0)).toEqual([
      { userId: 'a', amount: 34 }, { userId: 'b', amount: 33 }, { userId: 'c', amount: 33 },
    ]);
  });

  it('rejects fractions of a yen', () => {
    const e = { amount: 100.5, paidBy: 'a', splits: [{ userId: 'a', amount: 100.5 }] };
    expect(validateExpense(e, ['a'], 0)).not.toBeNull();
    expect(validateExpense({ ...e, amount: 100, splits: [{ userId: 'a', amount: 100 }] }, ['a'], 0)).toBeNull();
  });
});

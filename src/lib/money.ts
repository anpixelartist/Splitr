// Currency and date formatting. Each group has one currency; amounts are
// stored as decimal numbers in it. Currencies with 3 decimals (e.g. KWD) are
// left out because stored amounts are limited to whole cents.

export const DEFAULT_CURRENCY = 'USD';

/** Offered when creating a group (ISO 4217 codes, at most 2 decimals). */
export const CURRENCIES = [
  'INR', 'USD', 'EUR', 'GBP', 'AED', 'AUD', 'BDT', 'CAD', 'CHF', 'CNY', 'HKD', 'IDR',
  'JPY', 'KRW', 'LKR', 'MYR', 'NPR', 'NZD', 'PHP', 'PKR', 'SGD', 'THB', 'VND', 'ZAR',
] as const;

const REGION_CURRENCY: Record<string, string> = {
  IN: 'INR', US: 'USD', GB: 'GBP', AE: 'AED', AU: 'AUD', BD: 'BDT', CA: 'CAD', CH: 'CHF',
  CN: 'CNY', HK: 'HKD', ID: 'IDR', JP: 'JPY', KR: 'KRW', LK: 'LKR', MY: 'MYR', NP: 'NPR',
  NZ: 'NZD', PH: 'PHP', PK: 'PKR', SG: 'SGD', TH: 'THB', VN: 'VND', ZA: 'ZAR',
  // Euro area
  AT: 'EUR', BE: 'EUR', CY: 'EUR', DE: 'EUR', EE: 'EUR', ES: 'EUR', FI: 'EUR', FR: 'EUR',
  GR: 'EUR', HR: 'EUR', IE: 'EUR', IT: 'EUR', LT: 'EUR', LU: 'EUR', LV: 'EUR', MT: 'EUR',
  NL: 'EUR', PT: 'EUR', SI: 'EUR', SK: 'EUR',
};

/** The currency of the region this device is set to, e.g. INR on an Indian phone. */
export function defaultCurrency(locale = typeof navigator !== 'undefined' ? navigator.language : 'en-US'): string {
  try {
    const region = new Intl.Locale(locale).maximize().region;
    return (region && REGION_CURRENCY[region]) || DEFAULT_CURRENCY;
  } catch {
    return DEFAULT_CURRENCY;
  }
}

/** Decimal places the currency uses: 2 for INR/USD, 0 for JPY/KRW/VND. */
export function currencyDigits(currency: string): number {
  try {
    return Math.min(2, new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2);
  } catch {
    return 2;
  }
}

const formatters = new Map<string, Intl.NumberFormat>();

/** "₹1,000.00" (or "₹1,00,000.00" on an Indian phone), "$12.50", "¥300". */
export function formatMoney(amount: number, currency = DEFAULT_CURRENCY, locale?: string): string {
  const key = `${locale ?? ''}|${currency}`;
  let f = formatters.get(key);
  if (!f) {
    const digits = currencyDigits(currency);
    f = new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits });
    formatters.set(key, f);
  }
  return f.format(amount);
}

/** Just the symbol, for input prefixes: "₹", "$", "€". */
export function currencySymbol(currency = DEFAULT_CURRENCY, locale?: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, currencyDisplay: 'narrowSymbol' })
      .formatToParts(0).find(p => p.type === 'currency')?.value ?? currency;
  } catch {
    return currency;
  }
}

/** "Indian Rupee", for the currency picker. */
export function currencyName(currency: string, locale?: string): string {
  try {
    return new Intl.DisplayNames(locale ? [locale] : undefined, { type: 'currency' }).of(currency) ?? currency;
  } catch {
    return currency;
  }
}

/** An unambiguous date in the device's style: "24 Oct 2026" or "Oct 24, 2026", never 10/24/2026. */
export function formatDate(value: string | number, locale?: string, withYear = true): string {
  return new Date(value).toLocaleDateString(locale, withYear
    ? { day: 'numeric', month: 'short', year: 'numeric' }
    : { day: 'numeric', month: 'short' });
}

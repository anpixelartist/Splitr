import React, { useMemo, useState } from 'react';
import { useGroup } from '../context/GroupContext';
import { useAuth } from '../context/AuthContext';
import { X, CheckCircle2, AlertCircle, Loader2, Check, Minus, Plus } from 'lucide-react';
import { defaultsFor, previewSplit, type SplitMethod } from '../lib/splitModes';
import type { Expense } from '../types';
import { DEFAULT_CURRENCY, currencyDigits, currencySymbol, formatMoney } from '../lib/money';

interface Props {
  onClose: () => void;
  users: { id: string; name: string }[];
  /** Open an existing expense instead of adding a new one */
  expense?: Expense;
  /** Show it without letting this person change it */
  readOnly?: boolean;
  /** It's from before the last recorded payment: warn before changing it */
  settledBefore?: boolean;
}

// Prefill for an existing expense: shares merged per person (a claimed
// placeholder can make one person appear twice), and "Equally" when the
// shares differ by at most the leftover cent.
const initialSplit = (expense: Expense | undefined, users: { id: string }[], digits: number) => {
  if (!expense) return { method: 'equal' as const, exact: {}, excluded: new Set<string>() };
  const shares = new Map<string, number>();
  for (const s of expense.splits) shares.set(s.userId, Math.round(((shares.get(s.userId) ?? 0) + s.amount) * 100) / 100);
  const cents = [...shares.values()].map(a => Math.round(a * 100));
  const equal = cents.length > 0 && Math.max(...cents) - Math.min(...cents) <= 1;
  return {
    method: equal ? 'equal' as const : 'exact' as const,
    exact: Object.fromEntries([...shares].map(([id, a]) => [id, a.toFixed(digits)])),
    excluded: new Set(users.map(u => u.id).filter(id => !shares.has(id))),
  };
};

const METHODS: { id: SplitMethod; label: string; hint: string }[] = [
  { id: 'equal', label: 'Equally', hint: 'Tap someone to leave them out.' },
  { id: 'exact', label: 'Amounts', hint: 'Type what each person owes.' },
  { id: 'percent', label: 'Percent', hint: 'Type each person\'s percentage. They must add up to 100%.' },
  { id: 'shares', label: 'Shares', hint: 'Use parts: 2 for someone who had twice as much, 0 to leave them out.' },
];

export const AddExpenseModal: React.FC<Props> = ({ onClose, users, expense, readOnly = false, settledBefore = false }) => {
  const { addExpense, updateExpense, currentGroup } = useGroup();
  const { user } = useAuth();
  const currency = currentGroup?.currency ?? DEFAULT_CURRENCY;
  const digits = currencyDigits(currency);
  const symbol = currencySymbol(currency);
  const step = digits === 0 ? '1' : '0.01';
  const [init] = useState(() => initialSplit(expense, users, digits));

  const [description, setDescription] = useState(expense?.description ?? '');
  const [amount, setAmount] = useState(expense ? expense.amount.toFixed(digits) : '');
  const [paidBy, setPaidBy] = useState(expense?.paidBy ?? user?.uid ?? '');
  const [splitMethod, setSplitMethod] = useState<SplitMethod>(init.method);
  const [exactSplits, setExactSplits] = useState<Record<string, string>>(init.exact);
  const [percentSplits, setPercentSplits] = useState<Record<string, string>>({});
  const [shareSplits, setShareSplits] = useState<Record<string, string>>({});
  // Track who was unticked (not who is ticked) so members who join while the
  // modal is open are included by default.
  const [excludedUsers, setExcludedUsers] = useState<Set<string>>(init.excluded);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The split as it stands, worked out live so the footer can say what's left
  const parsedTotal = parseFloat(amount);
  const total = Number.isFinite(parsedTotal) && parsedTotal > 0 ? Math.round(parsedTotal * 100) / 100 : null;
  const preview = useMemo(() => previewSplit(
    splitMethod, total, users.map(u => u.id),
    { excluded: excludedUsers, exact: exactSplits, percent: percentSplits, shares: shareSplits },
    digits, n => formatMoney(n, currency),
  ), [splitMethod, total, users, excludedUsers, exactSplits, percentSplits, shareSplits, digits, currency]);

  const chooseMethod = (m: SplitMethod) => {
    setSplitMethod(m);
    setError(null);
    if (m === 'shares' && Object.keys(shareSplits).length === 0) setShareSplits(defaultsFor('shares', users.map(u => u.id)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!currentGroup || !user) return;

    // ── Validation ──────────────────────────────────────────────────────────
    const rawAmount = parseFloat(amount);
    if (digits === 0 && !Number.isNaN(rawAmount) && !Number.isInteger(rawAmount)) {
      setError(`${currency} amounts are whole numbers.`);
      return;
    }
    const totalAmount = Math.round(rawAmount * 100) / 100;
    if (!description.trim()) {
      setError('Please enter a description.');
      return;
    }
    if (isNaN(totalAmount) || totalAmount <= 0) {
      setError('Please enter a valid amount greater than 0.');
      return;
    }

    if (!preview.ok) {
      setError(preview.error);
      return;
    }
    const splits = preview.splits;

    // ── Save ────────────────────────────────────────────────────────────────
    setSaving(true);
    try {
      if (expense) {
        if (settledBefore && !window.confirm(
          'This changes balances you already settled. People may owe money again.\n\nSave the changes?',
        )) { setSaving(false); return; }
        await updateExpense(expense.id, { description: description.trim(), amount: totalAmount, paidBy, splits });
      } else {
        await addExpense({ groupId: currentGroup.id, description: description.trim(), amount: totalAmount, paidBy, splits });
      }
      setSaved(true);
      // Close after the animation plays
      setTimeout(onClose, 1150);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      setSaving(false);
    }
  };

  return (
    <div className="anim-fade-in fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4">
      {/* Modal card — position:relative so the success overlay can sit on top */}
      <div className="bg-surface w-full max-w-md sheet rounded-t-3xl sm:rounded-3xl shadow-xl flex flex-col max-h-[90dvh] relative overflow-hidden pb-[env(safe-area-inset-bottom)] sm:pb-0">

        {/* ── Success overlay ─────────────────────────────────────────────── */}
        {saved && (
          <div className="absolute inset-0 bg-surface flex flex-col items-center justify-center z-20 rounded-t-3xl sm:rounded-3xl">
            <div className="anim-pop-in w-24 h-24 bg-green-500 rounded-full flex items-center justify-center shadow-xl shadow-green-200 mb-5">
              <CheckCircle2 className="w-12 h-12 text-white" strokeWidth={2.5} />
            </div>
            <p className="anim-fade-in-up text-xl font-bold text-gray-800" style={{ animationDelay: '0.15s' }}>
              {expense ? 'Changes saved!' : 'Expense saved!'}
            </p>
          </div>
        )}

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="p-4 border-b flex justify-between items-center sticky top-0 bg-surface rounded-t-3xl z-10">
          <h2 className="text-xl font-bold">{!expense ? 'Add Expense' : readOnly ? 'Expense' : 'Edit Expense'}</h2>
          <button onClick={onClose} disabled={saving} className="p-2 rounded-full hover:bg-gray-100 disabled:opacity-40" aria-label="Close">
            <X className="w-6 h-6 text-gray-500" />
          </button>
        </div>

        {/* ── Inline error banner ──────────────────────────────────────────── */}
        {error && (
          <div className="anim-fade-in mx-4 mt-3 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 dark:text-red-300 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* ── Form ────────────────────────────────────────────────────────── */}
        <div className="p-4 overflow-y-auto flex-1">
          <form id="expense-form" onSubmit={handleSubmit} className="space-y-5">

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <input
                type="text"
                placeholder="Dinner, Taxi, Groceries…"
                className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none text-lg"
                value={description}
                onChange={e => { setDescription(e.target.value); setError(null); }}
                disabled={saving || readOnly}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Total Amount ({symbol})</label>
              <input
                type="number"
                inputMode="decimal"
                step={step}
                min="0"
                placeholder="0.00"
                className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none text-2xl font-bold"
                value={amount}
                onChange={e => { setAmount(e.target.value); setError(null); }}
                disabled={saving || readOnly}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Who Paid?</label>
              <select
                className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none"
                value={paidBy}
                onChange={e => setPaidBy(e.target.value)}
                disabled={saving || readOnly}
              >
                {users.map(u => (
                  <option key={u.id} value={u.id}>
                    {u.id === user?.uid ? 'Me' : u.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="border-t pt-4">
              <span className="block text-sm font-medium text-gray-700 mb-2" id="split-label">Split</span>
              {/* One row of four short options: fits a 320px phone without wrapping */}
              <div role="radiogroup" aria-labelledby="split-label" className="grid grid-cols-4 bg-gray-100 rounded-xl p-1 gap-1">
                {METHODS.map(m => (
                  <button
                    key={m.id}
                    type="button"
                    role="radio"
                    aria-checked={splitMethod === m.id}
                    disabled={saving || readOnly}
                    className={`py-2 rounded-lg text-sm font-medium transition-colors ${
                      splitMethod === m.id ? 'bg-surface shadow-sm text-gray-900' : 'text-gray-500'
                    }`}
                    onClick={() => chooseMethod(m.id)}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              {!readOnly && <p className="text-xs text-gray-500 mt-2 mb-3">{METHODS.find(m => m.id === splitMethod)!.hint}</p>}

              <div className={`space-y-2 ${readOnly ? 'mt-3' : ''}`}>
                {users.map(u => {
                  const name = u.id === user?.uid ? 'Me' : u.name;
                  const share = preview.amounts[u.id];
                  const off = splitMethod === 'equal' ? excludedUsers.has(u.id)
                    : splitMethod === 'shares' && shareSplits[u.id] !== undefined && Number(shareSplits[u.id] || 0) === 0;
                  const row = `relative flex items-center gap-3 px-3 py-2 min-h-[52px] border rounded-xl ${off ? 'opacity-50' : ''}`;
                  // Under the name: what this person ends up paying, when it isn't the input itself
                  const label = (
                    <span className="flex-1 min-w-0">
                      <span className="block font-medium text-gray-800 truncate">{name}</span>
                      {splitMethod !== 'exact' && (
                        <span className="block text-xs text-gray-500 tabular-nums">
                          {share !== undefined && total !== null ? formatMoney(share, currency) : off ? 'Not included' : '\u00a0'}
                        </span>
                      )}
                    </span>
                  );

                  if (splitMethod === 'equal') {
                    return (
                      <label key={u.id} className={`${row} cursor-pointer hover:bg-gray-50`}>
                        {label}
                        <input
                          type="checkbox"
                          className="sr-only peer"
                          checked={!off}
                          onChange={e => {
                            const checked = e.target.checked;
                            setExcludedUsers(prev => {
                              const next = new Set(prev);
                              if (checked) next.delete(u.id); else next.add(u.id);
                              return next;
                            });
                            setError(null);
                          }}
                          disabled={saving || readOnly}
                        />
                        <span aria-hidden className={`w-6 h-6 rounded-full flex items-center justify-center border-2 peer-focus-visible:ring-2 peer-focus-visible:ring-blue-500 ${
                          off ? 'border-gray-300' : 'bg-blue-600 border-blue-600'
                        }`}>
                          {!off && <Check className="w-4 h-4 text-white" strokeWidth={3} />}
                        </span>
                      </label>
                    );
                  }

                  if (splitMethod === 'shares') {
                    const n = Number(shareSplits[u.id] || 0);
                    const set = (v: number) => { setShareSplits(prev => ({ ...prev, [u.id]: String(Math.max(0, v)) })); setError(null); };
                    return (
                      <div key={u.id} className={row}>
                        {label}
                        <div className="flex items-center gap-1">
                          <button type="button" className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center disabled:opacity-40"
                            onClick={() => set(Math.ceil(n) - 1)} disabled={saving || readOnly || n <= 0} aria-label={`One share less for ${name}`}>
                            <Minus className="w-4 h-4" />
                          </button>
                          <input
                            type="number" inputMode="decimal" min="0" step="1"
                            className="w-12 text-center bg-transparent outline-none font-semibold tabular-nums focus:ring-2 focus:ring-blue-500 rounded-md py-1"
                            value={shareSplits[u.id] ?? ''}
                            onChange={e => { setShareSplits(prev => ({ ...prev, [u.id]: e.target.value })); setError(null); }}
                            disabled={saving || readOnly}
                            aria-label={`Shares for ${name}`}
                          />
                          <button type="button" className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center disabled:opacity-40"
                            onClick={() => set(Math.floor(n) + 1)} disabled={saving || readOnly} aria-label={`One share more for ${name}`}>
                            <Plus className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  }

                  const percent = splitMethod === 'percent';
                  const values = percent ? percentSplits : exactSplits;
                  const setValues = percent ? setPercentSplits : setExactSplits;
                  return (
                    <div key={u.id} className={row}>
                      {label}
                      <div className={`relative ${percent ? 'w-24' : 'w-32'}`}>
                        {!percent && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">{symbol}</span>}
                        <input
                          type="number"
                          inputMode="decimal"
                          step={percent ? '0.01' : step}
                          min="0"
                          className={`w-full bg-gray-50 border border-gray-200 rounded-lg py-2 outline-none focus:ring-2 focus:ring-blue-500 tabular-nums ${
                            percent ? 'pl-3 pr-7 text-right' : 'pl-7 pr-3'
                          }`}
                          placeholder={percent ? '0' : digits === 0 ? '0' : '0.00'}
                          value={values[u.id] || ''}
                          onChange={e => { setValues(prev => ({ ...prev, [u.id]: e.target.value })); setError(null); }}
                          disabled={saving || readOnly}
                          aria-label={percent ? `Percentage for ${name}` : `Amount for ${name}`}
                        />
                        {percent && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">%</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </form>
        </div>

        {/* ── Footer / submit ──────────────────────────────────────────────── */}
        <div className="p-4 border-t bg-gray-50 sm:rounded-b-3xl">
          {readOnly ? (
            <p className="text-sm text-center text-gray-500 py-2">
              Only the person who added this expense or an admin can change it.
            </p>
          ) : (
          <>
          {/* Always in view while scrolling a long list of people */}
          <p className={`text-sm text-center mb-2 font-medium tabular-nums ${
            preview.ok ? 'text-green-700 dark:text-green-400' : total === null ? 'text-gray-500' : 'text-amber-700 dark:text-amber-400'
          }`} aria-live="polite">
            {preview.status}
          </p>
          <button
            type="submit"
            form="expense-form"
            disabled={saving || saved}
            className="w-full bg-blue-600 text-white font-bold text-lg py-4 rounded-xl hover:bg-blue-700 active:scale-[0.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {saving ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Saving…
              </>
            ) : (
              expense ? 'Save changes' : 'Save Expense'
            )}
          </button>
          </>
          )}
        </div>
      </div>
    </div>
  );
};

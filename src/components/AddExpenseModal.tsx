import React, { useMemo, useState } from 'react';
import { useGroup } from '../context/GroupContext';
import { useAuth } from '../context/AuthContext';
import { X, CheckCircle2, AlertCircle, Loader2, Check, Minus, Plus, Trash2 } from 'lucide-react';
import {
  defaultsFor, newItem, previewSplit, restoreSplit, toSplitRecord,
  type ItemInput, type SplitInput, type SplitMethod,
} from '../lib/splitModes';
import { resolveId } from '../lib/claims';
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

// Six options in a 3 × 2 grid: every one visible and easy to tap on a phone
const METHODS: { id: SplitMethod; label: string; hint: string }[] = [
  { id: 'equal', label: 'Equally', hint: 'Tap someone to leave them out.' },
  { id: 'exact', label: 'Amounts', hint: 'Type what each person owes.' },
  { id: 'percent', label: 'Percent', hint: 'Type each person\'s percentage. They must add up to 100%.' },
  { id: 'shares', label: 'Shares', hint: 'Use parts: 2 for someone who had twice as much, 0 to leave them out.' },
  { id: 'adjust', label: 'Adjust', hint: 'Split equally, then add or take off for someone, e.g. +200 for drinks.' },
  { id: 'items', label: 'Items', hint: 'Add each item from the bill and who had it. Tax, tip or anything not listed is shared by what each had.' },
];

/** A day as YYYY-MM-DD in the phone's own time zone. */
const localDay = (d: Date) => d.toLocaleDateString('en-CA');

export const AddExpenseModal: React.FC<Props> = ({ onClose, users, expense, readOnly = false, settledBefore = false }) => {
  const { addExpense, updateExpense, currentGroup } = useGroup();
  const { user } = useAuth();
  const currency = currentGroup?.currency ?? DEFAULT_CURRENCY;
  const digits = currencyDigits(currency);
  const symbol = currencySymbol(currency);
  const step = digits === 0 ? '1' : '0.01';
  const ids = useMemo(() => users.map(u => u.id), [users]);
  const nameOf = (id: string) => (id === user?.uid ? 'Me' : users.find(u => u.id === id)?.name ?? 'Former member');

  // An existing expense reopens the way it was split, when that still matches
  const [init] = useState(() => expense
    ? restoreSplit(expense, ids, digits, id => resolveId(currentGroup?.claims, id))
    : { method: 'equal' as SplitMethod, input: undefined });

  const [description, setDescription] = useState(expense?.description ?? '');
  const [amount, setAmount] = useState(expense ? expense.amount.toFixed(digits) : '');
  const [paidBy, setPaidBy] = useState(expense?.paidBy ?? user?.uid ?? '');
  const [date, setDate] = useState(expense?.date ?? localDay(expense ? new Date(expense.createdAt) : new Date()));
  const [splitMethod, setSplitMethod] = useState<SplitMethod>(init.method);
  // Everything typed for every method, so switching back and forth keeps it.
  // `excluded` tracks who was unticked (not who is ticked) so members who
  // join while the form is open are included by default.
  const [input, setInput] = useState<SplitInput>(() => init.input ?? {
    excluded: new Set(), exact: {}, percent: {}, shares: {}, adjust: {}, items: [],
  });

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const edit = (change: (prev: SplitInput) => Partial<SplitInput>) => {
    setInput(prev => ({ ...prev, ...change(prev) }));
    setError(null);
  };
  const setTyped = (key: 'exact' | 'percent' | 'shares' | 'adjust', id: string, value: string) =>
    edit(prev => ({ [key]: { ...prev[key], [id]: value } }));
  const toggleIncluded = (id: string) => edit(prev => {
    const excluded = new Set(prev.excluded);
    if (excluded.has(id)) excluded.delete(id); else excluded.add(id);
    return { excluded };
  });
  const editItem = (key: string, change: Partial<ItemInput>) =>
    edit(prev => ({ items: prev.items.map(i => (i.key === key ? { ...i, ...change } : i)) }));

  // The split as it stands, worked out live so the footer can say what's left
  const parsedTotal = parseFloat(amount);
  const total = Number.isFinite(parsedTotal) && parsedTotal > 0 ? Math.round(parsedTotal * 100) / 100 : null;
  const money = (n: number) => formatMoney(n, currency);
  const preview = useMemo(
    () => previewSplit(splitMethod, total, ids, input, digits, n => formatMoney(n, currency)),
    [splitMethod, total, ids, input, digits, currency],
  );
  const itemsTotal = input.items.reduce((s, i) => s + (Number(i.amount) > 0 ? Math.round(Number(i.amount) * 100) : 0), 0) / 100;

  const chooseMethod = (m: SplitMethod) => {
    setSplitMethod(m);
    setError(null);
    if (m === 'shares' && Object.keys(input.shares).length === 0) edit(() => ({ shares: defaultsFor('shares', ids) }));
    if (m === 'items' && input.items.length === 0) edit(() => ({ items: [newItem()] }));
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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setError('Please pick the date it was spent.');
      return;
    }
    if (!preview.ok) {
      setError(preview.error);
      return;
    }
    const details = {
      description: description.trim(), amount: totalAmount, paidBy, splits: preview.splits,
      date, split: toSplitRecord(splitMethod, input, ids),
    };

    // ── Save ────────────────────────────────────────────────────────────────
    setSaving(true);
    try {
      if (expense) {
        if (settledBefore && !window.confirm(
          'This changes balances you already settled. People may owe money again.\n\nSave the changes?',
        )) { setSaving(false); return; }
        await updateExpense(expense.id, details);
      } else {
        await addExpense({ groupId: currentGroup.id, ...details });
      }
      setSaved(true);
      // Close after the animation plays
      setTimeout(onClose, 1150);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      setSaving(false);
    }
  };

  const locked = saving || readOnly;
  const field = 'w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none';
  const smallInput = 'w-full bg-gray-50 border border-gray-200 rounded-lg py-2 outline-none focus:ring-2 focus:ring-blue-500 tabular-nums';
  const round = 'w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center disabled:opacity-40';

  /** Round tick showing whether someone is in the split. */
  const tick = (on: boolean) => (
    <span aria-hidden className={`w-6 h-6 shrink-0 rounded-full flex items-center justify-center border-2 ${
      on ? 'bg-blue-600 border-blue-600' : 'border-gray-300'
    }`}>
      {on && <Check className="w-4 h-4 text-white" strokeWidth={3} />}
    </span>
  );

  /** One person's row for the per-person methods. */
  const personRow = (u: { id: string }) => {
    const name = nameOf(u.id);
    const share = preview.amounts[u.id];
    const off = (splitMethod === 'equal' || splitMethod === 'adjust') ? input.excluded.has(u.id)
      : splitMethod === 'shares' && input.shares[u.id] !== undefined && Number(input.shares[u.id] || 0) === 0;
    const row = `relative flex items-center gap-3 px-3 py-2 min-h-[52px] border rounded-xl ${off ? 'opacity-50' : ''}`;
    // Under the name: what this person ends up paying, when it isn't the input itself
    const label = (
      <span className="flex-1 min-w-0">
        <span className="block font-medium text-gray-800 truncate">{name}</span>
        {splitMethod !== 'exact' && (
          <span className="block text-xs text-gray-500 tabular-nums">
            {off ? 'Not included' : share !== undefined && total !== null ? money(share) : ' '}
          </span>
        )}
      </span>
    );

    if (splitMethod === 'equal') {
      return (
        <label key={u.id} className={`${row} cursor-pointer hover:bg-gray-50`}>
          {label}
          <input type="checkbox" className="sr-only peer" checked={!off} onChange={() => toggleIncluded(u.id)} disabled={locked} />
          <span className="rounded-full peer-focus-visible:ring-2 peer-focus-visible:ring-blue-500">{tick(!off)}</span>
        </label>
      );
    }

    if (splitMethod === 'adjust') {
      return (
        <div key={u.id} className={row}>
          <button type="button" onClick={() => toggleIncluded(u.id)} disabled={locked} aria-pressed={!off}
            aria-label={off ? `Include ${name}` : `Leave out ${name}`} className="rounded-full focus-visible:ring-2 focus-visible:ring-blue-500">
            {tick(!off)}
          </button>
          {label}
          <div className="w-24">
            <input
              type="text" inputMode="decimal"
              className={`${smallInput} px-3 text-right`}
              placeholder="+0"
              value={input.adjust[u.id] ?? ''}
              onChange={e => setTyped('adjust', u.id, e.target.value)}
              disabled={locked || off}
              aria-label={`Extra for ${name}, plus or minus`}
            />
          </div>
        </div>
      );
    }

    if (splitMethod === 'shares') {
      const n = Number(input.shares[u.id] || 0);
      const set = (v: number) => setTyped('shares', u.id, String(Math.max(0, v)));
      return (
        <div key={u.id} className={row}>
          {label}
          <div className="flex items-center gap-1">
            <button type="button" className={round} onClick={() => set(Math.ceil(n) - 1)} disabled={locked || n <= 0} aria-label={`One share less for ${name}`}>
              <Minus className="w-4 h-4" />
            </button>
            <input
              type="number" inputMode="decimal" min="0" step="1"
              className="w-12 text-center bg-transparent outline-none font-semibold tabular-nums focus:ring-2 focus:ring-blue-500 rounded-md py-1"
              value={input.shares[u.id] ?? ''}
              onChange={e => setTyped('shares', u.id, e.target.value)}
              disabled={locked}
              aria-label={`Shares for ${name}`}
            />
            <button type="button" className={round} onClick={() => set(Math.floor(n) + 1)} disabled={locked} aria-label={`One share more for ${name}`}>
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>
      );
    }

    const percent = splitMethod === 'percent';
    const key = percent ? 'percent' : 'exact';
    return (
      <div key={u.id} className={row}>
        {label}
        <div className={`relative ${percent ? 'w-24' : 'w-32'}`}>
          {!percent && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">{symbol}</span>}
          <input
            type="number" inputMode="decimal" min="0"
            step={percent ? '0.01' : step}
            className={`${smallInput} ${percent ? 'pl-3 pr-7 text-right' : 'pl-7 pr-3'}`}
            placeholder={percent || digits === 0 ? '0' : '0.00'}
            value={input[key][u.id] || ''}
            onChange={e => setTyped(key, u.id, e.target.value)}
            disabled={locked}
            aria-label={percent ? `Percentage for ${name}` : `Amount for ${name}`}
          />
          {percent && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">%</span>}
        </div>
      </div>
    );
  };

  /** Items: one card per bill line, with who had it as tappable names. */
  const itemsEditor = (
    <div className="space-y-3">
      {input.items.map((item, n) => {
        const everyone = ids.every(id => item.people.includes(id));
        const chip = (on: boolean) => `px-3 py-1.5 rounded-full text-sm border transition-colors ${
          on ? 'bg-blue-600 border-blue-600 text-white' : 'border-gray-300 text-gray-700'
        }`;
        return (
          <div key={item.key} className="border rounded-xl p-3 space-y-2">
            <div className="flex items-center gap-2">
              <input
                type="text" maxLength={60}
                className={`${smallInput} px-3 flex-1 min-w-0`}
                placeholder={n === 0 ? 'e.g. Paneer tikka' : `Item ${n + 1}`}
                value={item.name}
                onChange={e => editItem(item.key, { name: e.target.value })}
                disabled={locked}
                aria-label={`Item ${n + 1} name`}
              />
              <div className="relative w-28 shrink-0">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">{symbol}</span>
                <input
                  type="number" inputMode="decimal" min="0" step={step}
                  className={`${smallInput} pl-7 pr-2`}
                  placeholder={digits === 0 ? '0' : '0.00'}
                  value={item.amount}
                  onChange={e => editItem(item.key, { amount: e.target.value })}
                  disabled={locked}
                  aria-label={`Item ${n + 1} price`}
                />
              </div>
              {!readOnly && (
                <button type="button" onClick={() => edit(prev => ({ items: prev.items.filter(i => i.key !== item.key) }))}
                  disabled={locked} className="p-2 -mr-1 rounded-full text-gray-400 hover:text-red-500" aria-label={`Remove item ${n + 1}`}>
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={`Who had item ${n + 1}`}>
              <button type="button" className={chip(everyone)} disabled={locked} aria-pressed={everyone}
                onClick={() => editItem(item.key, { people: everyone ? [] : [...ids] })}>
                Everyone
              </button>
              {ids.map(id => {
                const on = item.people.includes(id);
                return (
                  <button key={id} type="button" className={chip(on)} disabled={locked} aria-pressed={on}
                    onClick={() => editItem(item.key, { people: on ? item.people.filter(p => p !== id) : [...item.people, id] })}>
                    {nameOf(id)}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      {!readOnly && (
        <button type="button" onClick={() => edit(prev => ({ items: [...prev.items, newItem()] }))} disabled={locked}
          className="w-full py-3 border-2 border-dashed border-gray-300 rounded-xl text-sm font-medium text-gray-600 flex items-center justify-center gap-1.5">
          <Plus className="w-4 h-4" /> Add item
        </button>
      )}

      {!readOnly && total === null && itemsTotal > 0 && (
        <button type="button" onClick={() => setAmount(itemsTotal.toFixed(digits))}
          className="w-full text-sm text-blue-600 dark:text-blue-400 font-medium py-1">
          Use {money(itemsTotal)} as the total
        </button>
      )}

      {/* What it comes to per person */}
      {Object.keys(preview.amounts).length > 0 && (
        <div className="bg-gray-50 rounded-xl p-3">
          <p className="text-xs font-medium text-gray-500 mb-1.5">{preview.ok ? 'Each person pays' : 'So far, from the items'}</p>
          <ul className="space-y-1">
            {ids.filter(id => preview.amounts[id] !== undefined).map(id => (
              <li key={id} className="flex justify-between text-sm">
                <span className="text-gray-700 truncate">{nameOf(id)}</span>
                <span className="font-medium tabular-nums">{money(preview.amounts[id])}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );

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
                className={`${field} text-lg`}
                value={description}
                onChange={e => { setDescription(e.target.value); setError(null); }}
                disabled={locked}
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
                className={`${field} text-2xl font-bold`}
                value={amount}
                onChange={e => { setAmount(e.target.value); setError(null); }}
                disabled={locked}
              />
            </div>

            {/* Side by side: two short fields, one line on a phone */}
            <div className="grid grid-cols-2 gap-3">
              <div className="min-w-0">
                <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="paid-by">Who Paid?</label>
                <select id="paid-by" className={`${field} px-3`} value={paidBy} onChange={e => setPaidBy(e.target.value)} disabled={locked}>
                  {users.map(u => (
                    <option key={u.id} value={u.id}>{nameOf(u.id)}</option>
                  ))}
                </select>
              </div>
              <div className="min-w-0">
                <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="spent-on">Date</label>
                <input
                  id="spent-on" type="date"
                  className={`${field} px-3 min-h-[50px]`}
                  value={date}
                  max={localDay(new Date())}
                  onChange={e => { setDate(e.target.value); setError(null); }}
                  disabled={locked}
                />
              </div>
            </div>

            <div className="border-t pt-4">
              <span className="block text-sm font-medium text-gray-700 mb-2" id="split-label">Split</span>
              <div role="radiogroup" aria-labelledby="split-label" className="grid grid-cols-3 bg-gray-100 rounded-xl p-1 gap-1">
                {METHODS.map(m => (
                  <button
                    key={m.id}
                    type="button"
                    role="radio"
                    aria-checked={splitMethod === m.id}
                    disabled={locked}
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

              <div className={readOnly ? 'mt-3' : ''}>
                {splitMethod === 'items' ? itemsEditor : <div className="space-y-2">{users.map(personRow)}</div>}
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

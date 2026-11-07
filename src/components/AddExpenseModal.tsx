import React, { useState } from 'react';
import { useGroup } from '../context/GroupContext';
import { useAuth } from '../context/AuthContext';
import { X, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { computeSplit, toSplits, type SplitProblem } from '../lib/splits';
import type { Expense, SplitConfig, SplitMethod } from '../types';
import { DEFAULT_CURRENCY, currencyDigits, currencySymbol, formatMoney } from '../lib/money';
import { ItemizedEditor } from './ItemizedEditor';
import { newItem, type ChargeDraft, type ItemDraft } from './itemizedDrafts';

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

const METHODS: { id: SplitMethod; label: string; hint: string }[] = [
  { id: 'equal', label: 'Equally', hint: 'Untick anyone who isn’t part of this.' },
  { id: 'exact', label: 'Amounts', hint: 'Type amounts for some people. Whatever is left is shared between the empty boxes.' },
  { id: 'percent', label: 'Percent', hint: 'Type percentages for some people. The rest of 100% is shared between the empty boxes.' },
  { id: 'shares', label: 'Shares', hint: 'Parts, ratios or weights: 2 and 1 means the first person pays twice as much. Empty means 1, 0 leaves someone out.' },
  { id: 'itemized', label: 'Items', hint: 'Add what was ordered and who had it. Tax and tips are spread by what each person had. Anything not itemized is shared by everyone ticked.' },
];

type Drafts = {
  method: SplitMethod;
  excluded: Set<string>;
  amounts: Record<string, string>;
  percents: Record<string, string>;
  shares: Record<string, string>;
  items: ItemDraft[];
  charges: ChargeDraft[];
};

const str = (rec: Record<string, number> | undefined) =>
  Object.fromEntries(Object.entries(rec ?? {}).map(([k, v]) => [k, String(v)]));

// Prefill for an existing expense. Expenses saved with their split method
// reopen exactly as they were; older ones become "Equally" when the shares
// differ by at most the leftover cent, otherwise "Amounts".
const initialDrafts = (expense: Expense | undefined, users: { id: string }[], digits: number): Drafts => {
  const blank: Drafts = { method: 'equal', excluded: new Set(), amounts: {}, percents: {}, shares: {}, items: [], charges: [] };
  if (!expense) return blank;
  const notIn = (ids: string[]) => new Set(users.map(u => u.id).filter(id => !ids.includes(id)));

  const c = expense.split;
  if (c) {
    return {
      ...blank,
      method: c.method,
      excluded: notIn(c.people),
      amounts: str(c.amounts),
      percents: str(c.percents),
      shares: str(c.shares),
      items: (c.items ?? []).map(it => {
        const portions = Object.values(it.portions);
        return {
          key: uuidv4(), name: it.name, price: String(it.price), qty: it.qty === 1 ? '' : String(it.qty),
          portions: Object.fromEntries(Object.entries(it.portions).map(([p, w]) => [p, w === 1 ? '' : String(w)])),
          uneven: portions.some(w => w !== portions[0]),
        };
      }),
      charges: (c.charges ?? []).map(ch => ({ key: uuidv4(), kind: ch.kind, mode: ch.mode, value: String(ch.value) })),
    };
  }

  const shares = new Map<string, number>();
  for (const s of expense.splits) shares.set(s.userId, Math.round(((shares.get(s.userId) ?? 0) + s.amount) * 100) / 100);
  const cents = [...shares.values()].map(a => Math.round(a * 100));
  const equal = cents.length > 0 && Math.max(...cents) - Math.min(...cents) <= 1;
  return {
    ...blank,
    method: equal ? 'equal' : 'exact',
    amounts: Object.fromEntries([...shares].map(([id, a]) => [id, a.toFixed(digits)])),
    excluded: notIn([...shares.keys()]),
  };
};

/** A typed number: undefined when blank, NaN when unreadable (the engine reports it). */
const num = (s: string | undefined) => (s === undefined || s.trim() === '' ? undefined : Number(s));
const typed = (ids: string[], rec: Record<string, string>) => {
  const out: Record<string, number> = {};
  for (const id of ids) { const v = num(rec[id]); if (v !== undefined) out[id] = v; }
  return out;
};

/** The form's drafts as a SplitConfig: only the chosen method's fields, no undefined (Firestore refuses it). */
function toConfig(d: Drafts, people: string[]): SplitConfig {
  switch (d.method) {
    case 'equal': return { method: 'equal', people };
    case 'exact': return { method: 'exact', people, amounts: typed(people, d.amounts) };
    case 'percent': return { method: 'percent', people, percents: typed(people, d.percents) };
    case 'shares': return { method: 'shares', people, shares: typed(people, d.shares) };
    case 'itemized': return {
      method: 'itemized', people,
      items: d.items
        .filter(it => it.name.trim() || it.price.trim()) // skip rows left empty
        .map(it => ({
          name: it.name.trim(),
          price: num(it.price) ?? NaN,
          qty: num(it.qty) ?? 1,
          portions: Object.fromEntries(Object.entries(it.portions).map(([p, w]) => [p, it.uneven ? num(w) ?? 1 : 1])),
        })),
      charges: d.charges
        .filter(c => c.value.trim())
        .map(c => ({ kind: c.kind, mode: c.mode, value: num(c.value) ?? NaN })),
    };
  }
}

export const AddExpenseModal: React.FC<Props> = ({ onClose, users, expense, readOnly = false, settledBefore = false }) => {
  const { addExpense, updateExpense, currentGroup } = useGroup();
  const { user } = useAuth();
  const currency = currentGroup?.currency ?? DEFAULT_CURRENCY;
  const digits = currencyDigits(currency);
  const scale = 10 ** digits;
  const symbol = currencySymbol(currency);
  const step = digits === 0 ? '1' : '0.01';
  const [init] = useState(() => initialDrafts(expense, users, digits));

  const [description, setDescription] = useState(expense?.description ?? '');
  const [amount, setAmount] = useState(expense ? expense.amount.toFixed(digits) : '');
  const [paidBy, setPaidBy] = useState(expense?.paidBy ?? user?.uid ?? '');
  // Each method keeps its own inputs, so switching back and forth loses nothing
  const [method, setMethod] = useState<SplitMethod>(init.method);
  const [amountsIn, setAmountsIn] = useState(init.amounts);
  const [percentsIn, setPercentsIn] = useState(init.percents);
  const [sharesIn, setSharesIn] = useState(init.shares);
  const [items, setItems] = useState<ItemDraft[]>(init.items);
  const [charges, setCharges] = useState<ChargeDraft[]>(init.charges);
  // Track who was unticked (not who is ticked) so members who join while the
  // modal is open are included by default.
  const [excludedUsers, setExcludedUsers] = useState<Set<string>>(init.excluded);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameOf = (u: { id: string; name: string }) => (u.id === user?.uid ? 'Me' : u.name);
  const included = users.filter(u => !excludedUsers.has(u.id));
  const config = toConfig(
    { method, excluded: excludedUsers, amounts: amountsIn, percents: percentsIn, shares: sharesIn, items, charges },
    included.map(u => u.id),
  );
  const totalTyped = amount.trim() === '' ? null : parseFloat(amount);
  // Recalculated on every keystroke: everyone's share is always on screen
  const result = computeSplit(config, totalTyped, digits);
  const autoIds = new Set(result.auto);
  const money = (units: number) => formatMoney(units / scale, currency);
  const clearError = () => setError(null);

  const describe = (p: SplitProblem): string => {
    switch (p.code) {
      case 'nobody': return 'Tick at least one person to split with.';
      case 'invalid': return 'Amounts, percentages, shares and prices can’t be negative.';
      case 'no-total': return method === 'itemized' ? 'Add an item with a price, or enter the total.' : 'Enter the total amount.';
      case 'over': return method === 'itemized'
        ? `The items and charges come to ${money(p.units)} more than the total. Raise the total, or clear it to use the bill.`
        : `That’s ${money(p.units)} more than the total.`;
      case 'unassigned': return `${money(p.units)} isn’t assigned to anyone yet. Clear someone’s box to give it to them, or change the amounts.`;
      case 'percent-over': return `The percentages add up to ${round2(100 + p.percent)}%, which is ${round2(p.percent)}% too much.`;
      case 'percent-short': return `The percentages add up to ${round2(100 - p.percent)}%. Clear someone’s box to give them the rest, or change the numbers.`;
      case 'no-shares': return 'Give at least one person a share.';
      case 'item-nobody': return `Tick who had “${p.item}”.`;
      case 'below-zero': return 'The discounts are bigger than the bill.';
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!currentGroup || !user) return;

    // ── Validation ──────────────────────────────────────────────────────────
    if (!description.trim()) {
      setError('Please enter a description.');
      return;
    }
    // Items with no total typed: the bill is the total
    const useBill = method === 'itemized' && totalTyped === null;
    const rawAmount = useBill ? result.totalUnits / scale : totalTyped ?? NaN;
    if (digits === 0 && !Number.isNaN(rawAmount) && !Number.isInteger(rawAmount)) {
      setError(`${currency} amounts are whole numbers.`);
      return;
    }
    if (!useBill && (Number.isNaN(rawAmount) || rawAmount <= 0)) {
      setError('Please enter a valid amount greater than 0.');
      return;
    }
    if (result.problem) {
      setError(describe(result.problem));
      return;
    }
    const totalAmount = result.totalUnits / scale;
    const splits = toSplits(result, digits);
    if (totalAmount <= 0 || splits.length === 0) {
      setError('Please enter a valid amount greater than 0.');
      return;
    }

    // ── Save ────────────────────────────────────────────────────────────────
    const data = { description: description.trim(), amount: totalAmount, paidBy, splits, split: config };
    setSaving(true);
    try {
      if (expense) {
        if (settledBefore && !window.confirm(
          'This changes balances you already settled. People may owe money again.\n\nSave the changes?',
        )) { setSaving(false); return; }
        await updateExpense(expense.id, data);
      } else {
        await addExpense({ groupId: currentGroup.id, ...data });
      }
      setSaved(true);
      // Close after the animation plays
      setTimeout(onClose, 1150);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      setSaving(false);
    }
  };

  // ── The line under the split: what's assigned, what's left, what's wrong ──
  const hasTotal = totalTyped !== null && !Number.isNaN(totalTyped);
  const anythingEntered = hasTotal || (method === 'itemized' && (result.billedUnits ?? 0) > 0);
  const status: { text: string; bad: boolean } | null = !anythingEntered
    ? null
    : result.problem && result.problem.code !== 'no-total'
      ? { text: describe(result.problem), bad: true }
      : method === 'itemized'
        ? {
          text: `Items and charges ${money(result.billedUnits ?? 0)}`
            + (result.leftoverUnits > 0 ? ` · ${money(result.leftoverUnits)} not itemized, shared between ${plural(included.length)}` : '')
            + (totalTyped === null ? ' · used as the total' : ''),
          bad: false,
        }
        : method === 'exact' && result.auto.length > 0 && result.leftoverUnits > 0
          ? { text: `${money(result.leftoverUnits)} left, shared between ${plural(result.auto.length)}`, bad: false }
          : method === 'percent' && result.auto.length > 0
            ? { text: `${round2(result.autoPercent ?? 0)}% each for ${plural(result.auto.length)} left blank`, bad: false }
            : method === 'equal' || method === 'shares'
              ? { text: `Split between ${plural(included.length)}`, bad: false }
              : { text: 'Adds up to the total', bad: false };

  // Input box for one person, depending on the method
  const personInput = (u: { id: string; name: string }) => {
    const disabled = saving || readOnly;
    const cls = 'w-full border-none shadow-sm rounded-md py-2 outline-none focus:ring-2 focus:ring-blue-500 bg-surface';
    const isAuto = autoIds.has(u.id);
    if (method === 'exact') {
      const auto = (result.units[u.id] ?? 0) / scale;
      return (
        <div className="relative w-28">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500">{symbol}</span>
          <input
            type="number" inputMode="decimal" step={step} min="0"
            className={`${cls} pl-7 pr-2`}
            // An empty box shows the share it will get automatically
            placeholder={isAuto && hasTotal ? auto.toFixed(digits) : (0).toFixed(digits)}
            aria-label={`${nameOf(u)} amount${isAuto && hasTotal ? `, automatically ${auto.toFixed(digits)}` : ''}`}
            value={amountsIn[u.id] ?? ''}
            onChange={e => { setAmountsIn(prev => ({ ...prev, [u.id]: e.target.value })); clearError(); }}
            disabled={disabled}
          />
        </div>
      );
    }
    if (method === 'percent') {
      const auto = round2(result.autoPercent ?? 0);
      return (
        <div className="relative w-24">
          <input
            type="number" inputMode="decimal" step="any" min="0"
            className={`${cls} pl-2.5 pr-7`}
            placeholder={isAuto ? String(auto) : '0'}
            aria-label={`${nameOf(u)} percent${isAuto ? `, automatically ${auto}` : ''}`}
            value={percentsIn[u.id] ?? ''}
            onChange={e => { setPercentsIn(prev => ({ ...prev, [u.id]: e.target.value })); clearError(); }}
            disabled={disabled}
          />
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500">%</span>
        </div>
      );
    }
    if (method === 'shares') {
      return (
        <input
          type="number" inputMode="decimal" step="any" min="0"
          className={`${cls} w-16 px-2.5 text-center`}
          placeholder="1"
          aria-label={`${nameOf(u)} shares`}
          value={sharesIn[u.id] ?? ''}
          onChange={e => { setSharesIn(prev => ({ ...prev, [u.id]: e.target.value })); clearError(); }}
          disabled={disabled}
        />
      );
    }
    return null;
  };

  const hint = METHODS.find(m => m.id === method)!.hint;

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
                // Items with no total typed: the bill is the total
                placeholder={method === 'itemized' && (result.billedUnits ?? 0) > 0 ? ((result.billedUnits ?? 0) / scale).toFixed(digits) : '0.00'}
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
                  <option key={u.id} value={u.id}>{nameOf(u)}</option>
                ))}
              </select>
            </div>

            <div className="border-t pt-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">Split</label>
              <div className="flex bg-gray-100 rounded-lg p-1 mb-2 overflow-x-auto" role="radiogroup" aria-label="How to split">
                {METHODS.map(m => (
                  <button
                    key={m.id}
                    type="button"
                    role="radio"
                    aria-checked={method === m.id}
                    disabled={saving || readOnly}
                    className={`flex-1 px-2.5 py-1 rounded-md text-sm font-medium whitespace-nowrap transition-colors ${
                      method === m.id ? 'bg-surface shadow-sm' : 'text-gray-500'
                    }`}
                    onClick={() => {
                      setMethod(m.id);
                      // Start the itemized list with one empty row
                      if (m.id === 'itemized' && items.length === 0) setItems([newItem(included.map(u => u.id))]);
                      clearError();
                    }}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-500 mb-3">{hint}</p>

              {method === 'itemized' && (
                <div className="mb-4">
                  <ItemizedEditor
                    people={included.map(u => ({ id: u.id, name: nameOf(u) }))}
                    items={items} setItems={setItems}
                    charges={charges} setCharges={setCharges}
                    symbol={symbol} step={step}
                    disabled={saving || readOnly}
                    onChange={clearError}
                  />
                  <p className="text-xs font-medium text-gray-500 mt-4 mb-1">Who’s in, and what they pay</p>
                </div>
              )}

              {/* Everyone, with a tick for "in this expense", their input and their share */}
              <div className="space-y-2">
                {users.map(u => {
                  const isIn = !excludedUsers.has(u.id);
                  return (
                    <div key={u.id} className={`flex items-center gap-3 p-2 border rounded-lg ${isIn ? 'bg-gray-50' : 'opacity-60'}`}>
                      <input
                        type="checkbox"
                        className="w-5 h-5 rounded text-blue-600 dark:text-blue-400 focus:ring-blue-500 shrink-0"
                        aria-label={`${nameOf(u)} is in this expense`}
                        checked={isIn}
                        onChange={e => {
                          const checked = e.target.checked;
                          setExcludedUsers(prev => {
                            const next = new Set(prev);
                            if (checked) next.delete(u.id); else next.add(u.id);
                            return next;
                          });
                          clearError();
                        }}
                        disabled={saving || readOnly}
                      />
                      <span className="font-medium text-gray-800 flex-1 truncate">{nameOf(u)}</span>
                      {isIn && personInput(u)}
                      <span className="w-20 text-right text-sm tabular-nums text-gray-600 shrink-0">
                        {isIn && anythingEntered && !result.problem ? money(result.units[u.id] ?? 0) : '—'}
                      </span>
                    </div>
                  );
                })}
              </div>

              {status && (
                <p aria-live="polite" className={`text-sm pt-2 ${status.bad ? 'text-red-600 dark:text-red-400' : 'text-gray-500'}`}>
                  {status.text}
                </p>
              )}
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
          )}
        </div>
      </div>
    </div>
  );
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const plural = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;

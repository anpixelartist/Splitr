import React, { useState } from 'react';
import { useGroup } from '../context/GroupContext';
import { useAuth } from '../context/AuthContext';
import { X, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { splitEqually } from '../lib/settlement';

interface Props {
  onClose: () => void;
  users: { id: string; name: string }[];
}

export const AddExpenseModal: React.FC<Props> = ({ onClose, users }) => {
  const { addExpense, currentGroup } = useGroup();
  const { user } = useAuth();

  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [paidBy, setPaidBy] = useState(user?.uid || '');
  const [splitMethod, setSplitMethod] = useState<'equal' | 'exact'>('equal');
  const [exactSplits, setExactSplits] = useState<Record<string, string>>({});
  // Track who was unticked (not who is ticked) so members who join while the
  // modal is open are included by default.
  const [excludedUsers, setExcludedUsers] = useState<Set<string>>(new Set());

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!currentGroup || !user) return;

    // ── Validation ──────────────────────────────────────────────────────────
    const totalAmount = Math.round(parseFloat(amount) * 100) / 100;
    if (!description.trim()) {
      setError('Please enter a description.');
      return;
    }
    if (isNaN(totalAmount) || totalAmount <= 0) {
      setError('Please enter a valid amount greater than 0.');
      return;
    }

    const splits: { userId: string; amount: number }[] = [];

    if (splitMethod === 'equal') {
      const active = users.map(u => u.id).filter(id => !excludedUsers.has(id));
      if (active.length === 0) {
        setError('Select at least one person to split with.');
        return;
      }
      splits.push(...splitEqually(totalAmount, active));
    } else {
      // Compare in whole cents to avoid floating-point drift
      let sumCents = 0;
      for (const uid of users.map(u => u.id)) {
        const val = parseFloat(exactSplits[uid] || '0');
        if (isNaN(val) || val < 0) {
          setError('Amounts can\'t be negative.');
          return;
        }
        const cents = Math.round(val * 100);
        if (cents > 0) { splits.push({ userId: uid, amount: cents / 100 }); sumCents += cents; }
      }
      if (splits.length === 0) {
        setError('Enter at least one amount.');
        return;
      }
      const totalCents = Math.round(totalAmount * 100);
      if (sumCents !== totalCents) {
        setError(
          `Amounts don't add up — off by $${(Math.abs(sumCents - totalCents) / 100).toFixed(2)}. Total must equal $${totalAmount.toFixed(2)}.`,
        );
        return;
      }
    }

    // ── Save ────────────────────────────────────────────────────────────────
    setSaving(true);
    try {
      await addExpense({ groupId: currentGroup.id, description: description.trim(), amount: totalAmount, paidBy, splits });
      setSaved(true);
      // Close after the animation plays
      setTimeout(onClose, 1150);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4">
      {/* Modal card — position:relative so the success overlay can sit on top */}
      <div className="bg-surface w-full max-w-md rounded-t-2xl sm:rounded-2xl shadow-xl flex flex-col max-h-[90dvh] relative overflow-hidden pb-[env(safe-area-inset-bottom)] sm:pb-0">

        {/* ── Success overlay ─────────────────────────────────────────────── */}
        {saved && (
          <div className="absolute inset-0 bg-surface flex flex-col items-center justify-center z-20 rounded-t-2xl sm:rounded-2xl">
            <div className="anim-pop-in w-24 h-24 bg-green-500 rounded-full flex items-center justify-center shadow-xl shadow-green-200 mb-5">
              <CheckCircle2 className="w-12 h-12 text-white" strokeWidth={2.5} />
            </div>
            <p className="anim-fade-in-up text-xl font-bold text-gray-800" style={{ animationDelay: '0.15s' }}>
              Expense saved!
            </p>
          </div>
        )}

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="p-4 border-b flex justify-between items-center sticky top-0 bg-surface rounded-t-2xl z-10">
          <h2 className="text-xl font-bold">Add Expense</h2>
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
                disabled={saving}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Total Amount ($)</label>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                placeholder="0.00"
                className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none text-2xl font-bold"
                value={amount}
                onChange={e => { setAmount(e.target.value); setError(null); }}
                disabled={saving}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Who Paid?</label>
              <select
                className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none"
                value={paidBy}
                onChange={e => setPaidBy(e.target.value)}
                disabled={saving}
              >
                {users.map(u => (
                  <option key={u.id} value={u.id}>
                    {u.id === user?.uid ? 'Me' : u.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="border-t pt-4">
              <div className="flex justify-between items-center mb-3">
                <label className="block text-sm font-medium text-gray-700">Split Method</label>
                <div className="flex bg-gray-100 rounded-lg p-1">
                  {(['equal', 'exact'] as const).map(m => (
                    <button
                      key={m}
                      type="button"
                      disabled={saving}
                      className={`px-3 py-1 rounded-md text-sm font-medium capitalize transition-colors ${
                        splitMethod === m ? 'bg-surface shadow-sm' : 'text-gray-500'
                      }`}
                      onClick={() => setSplitMethod(m)}
                    >
                      {m === 'equal' ? 'Equally' : 'Exact Amounts'}
                    </button>
                  ))}
                </div>
              </div>

              {splitMethod === 'equal' ? (
                <div className="space-y-2">
                  <p className="text-xs text-gray-500 mb-2">Select who was involved:</p>
                  {users.map(u => (
                    <label key={u.id} className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
                      <input
                        type="checkbox"
                        className="w-5 h-5 rounded text-blue-600 dark:text-blue-400 focus:ring-blue-500"
                        checked={!excludedUsers.has(u.id)}
                        onChange={e => {
                          const checked = e.target.checked;
                          setExcludedUsers(prev => {
                            const next = new Set(prev);
                            if (checked) next.delete(u.id); else next.add(u.id);
                            return next;
                          });
                          setError(null);
                        }}
                        disabled={saving}
                      />
                      <span className="font-medium text-gray-800">{u.id === user?.uid ? 'Me' : u.name}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-gray-500 mb-2">Enter exact amounts for each person:</p>
                  {users.map(u => (
                    <div key={u.id} className="flex items-center gap-3 p-2 border rounded-lg bg-gray-50">
                      <span className="font-medium text-gray-800 flex-1 truncate">
                        {u.id === user?.uid ? 'Me' : u.name}
                      </span>
                      <div className="relative w-32">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                        <input
                          type="number"
                          inputMode="decimal"
                          step="0.01"
                          min="0"
                          className="w-full border-none shadow-sm rounded-md pl-7 pr-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="0.00"
                          value={exactSplits[u.id] || ''}
                          onChange={e => {
                            setExactSplits(prev => ({ ...prev, [u.id]: e.target.value }));
                            setError(null);
                          }}
                          disabled={saving}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </form>
        </div>

        {/* ── Footer / submit ──────────────────────────────────────────────── */}
        <div className="p-4 border-t bg-gray-50 rounded-b-2xl">
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
              'Save Expense'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

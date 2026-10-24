import React, { useState } from 'react';
import { X, CheckCircle2, Loader2, Share2 } from 'lucide-react';
import type { SettlementTransaction } from '../types';
import { shareSettlementImage } from '../lib/shareSettlement';

interface Props {
  pendingTransactions: SettlementTransaction[];
  groupName: string;
  getUserName: (uid: string) => string;
  currentUserId: string;
  onRecord: (selected: SettlementTransaction[]) => Promise<void>;
  onClose: () => void;
}

export const SettleModal: React.FC<Props> = ({
  pendingTransactions,
  groupName,
  getUserName,
  currentUserId,
  onRecord,
  onClose,
}) => {
  // Keyed by payer→payee (not list index) so a plan that changes while the
  // modal is open can't shift checkmarks onto the wrong rows.
  const keyOf = (t: SettlementTransaction) => `${t.from}->${t.to}`;
  const [deselected, setDeselected] = useState<Set<string>>(new Set());
  // Partial payments: an edited amount per row (blank = the full amount)
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [recording, setRecording] = useState(false);
  const [done, setDone] = useState(false);
  const [recorded, setRecorded] = useState<SettlementTransaction[]>([]);
  const [sharing, setSharing] = useState(false);

  const toggle = (key: string) =>
    setDeselected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  // Whole cents between 0.01 and what's owed; null when the typed amount is invalid
  const amountFor = (t: SettlementTransaction): number | null => {
    const raw = amounts[keyOf(t)];
    if (raw === undefined || raw.trim() === '') return t.amount;
    const cents = Math.round(parseFloat(raw) * 100);
    if (!Number.isFinite(cents) || cents < 1 || cents > Math.round(t.amount * 100)) return null;
    return cents / 100;
  };

  const selectedList = pendingTransactions
    .filter(t => !deselected.has(keyOf(t)))
    .map(t => ({ ...t, amount: amountFor(t) ?? 0 }));
  const hasInvalidAmount = pendingTransactions.some(t => !deselected.has(keyOf(t)) && amountFor(t) === null);

  const handleRecord = async () => {
    if (selectedList.length === 0) return;
    setRecording(true);
    try {
      await onRecord(selectedList);
      setRecorded(selectedList);
      setDone(true);
    } catch {
      setRecording(false);
    }
  };

  const handleShare = async () => {
    setSharing(true);
    try {
      await shareSettlementImage(
        recorded,
        groupName,
        (uid) => uid === currentUserId ? 'You' : getUserName(uid),
      );
    } finally {
      setSharing(false);
      onClose(); // always close after share completes or is cancelled
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">

      {/* ── Success card — rendered as sibling to avoid overflow-hidden clipping the animation ── */}
      {done ? (
        <div className="bg-surface w-full max-w-md rounded-t-2xl sm:rounded-2xl shadow-xl flex flex-col items-center px-8 pt-10 pb-8">
          <div className="anim-pop-in w-24 h-24 bg-green-500 rounded-full flex items-center justify-center shadow-xl shadow-green-200 mb-5">
            <CheckCircle2 className="w-12 h-12 text-white" strokeWidth={2.5} />
          </div>
          <p className="anim-fade-in-up text-xl font-bold text-gray-800 mb-1 text-center" style={{ animationDelay: '0.15s' }}>
            {recorded.length === 1 ? '1 settlement' : `${recorded.length} settlements`} recorded!
          </p>
          <p className="anim-fade-in text-sm text-gray-400 mb-8 text-center" style={{ animationDelay: '0.25s' }}>
            Share the summary so everyone knows who paid.
          </p>
          <div className="anim-fade-in w-full space-y-3" style={{ animationDelay: '0.3s' }}>
            <button
              onClick={handleShare}
              disabled={sharing}
              className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3.5 rounded-xl transition-all active:scale-[0.98] disabled:opacity-60"
            >
              {sharing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Share2 className="w-5 h-5" />}
              {sharing ? 'Preparing…' : 'Share Summary'}
            </button>
            <button
              onClick={onClose}
              className="w-full py-3 rounded-xl text-gray-500 hover:bg-gray-100 font-medium transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      ) : (
        /* ── Normal modal ───────────────────────────────────────────────────── */
        <div className="bg-surface w-full max-w-md rounded-t-2xl sm:rounded-2xl shadow-xl flex flex-col max-h-[90dvh] overflow-hidden pb-[env(safe-area-inset-bottom)] sm:pb-0">

          {/* Header */}
          <div className="p-4 border-b flex justify-between items-center shrink-0">
            <div>
              <h2 className="text-xl font-bold">Settle Up</h2>
              <p className="text-sm text-gray-400">Tick what was paid. Change an amount for a part payment.</p>
            </div>
            <button
              onClick={onClose}
              disabled={recording}
              className="p-2 rounded-full hover:bg-gray-100 disabled:opacity-40"
              aria-label="Close"
            >
              <X className="w-6 h-6 text-gray-500" />
            </button>
          </div>

          {/* Transaction list */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {pendingTransactions.map(t => {
              const key = keyOf(t);
              const isSelected = !deselected.has(key);
              const fromName = t.from === currentUserId ? 'You' : getUserName(t.from);
              const toName = t.to === currentUserId ? 'You' : getUserName(t.to);
              return (
                <div
                  key={key}
                  className={`flex items-center gap-3 p-3 rounded-xl border transition-colors ${
                    isSelected ? 'bg-blue-50 border-blue-200' : 'bg-surface border-gray-200'
                  } ${recording ? 'opacity-60' : ''}`}
                >
                  <button
                    type="button"
                    onClick={() => toggle(key)}
                    disabled={recording}
                    aria-pressed={isSelected}
                    className="flex items-center gap-3 flex-1 min-w-0 text-left py-1"
                  >
                    <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                      isSelected ? 'bg-blue-600 border-blue-600' : 'border-gray-300 bg-surface'
                    }`}>
                      {isSelected && (
                        <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none">
                          <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </div>
                    <div className="flex-1 text-sm min-w-0">
                      <span className="font-semibold">{fromName}</span>
                      <span className="text-gray-500 mx-1">{t.from === currentUserId ? 'pay' : 'pays'}</span>
                      <span className="font-semibold">{toName}</span>
                      {t.to !== currentUserId && (
                        <span className="block text-xs text-gray-400">{toName} will be asked to confirm</span>
                      )}
                    </div>
                  </button>
                  <div className="relative w-28 shrink-0">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0.01"
                      max={t.amount}
                      aria-label={`Amount ${fromName} ${t.from === currentUserId ? 'pay' : 'pays'} ${toName}`}
                      disabled={recording || !isSelected}
                      placeholder={t.amount.toFixed(2)}
                      value={amounts[key] ?? t.amount.toFixed(2)}
                      onChange={e => setAmounts(prev => ({ ...prev, [key]: e.target.value }))}
                      className={`w-full pl-6 pr-2 py-2 rounded-lg border text-right font-bold text-gray-900 outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 ${
                        isSelected && amountFor(t) === null ? 'border-red-400' : 'border-gray-200'
                      }`}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer */}
          <div className="p-4 border-t bg-gray-50 shrink-0">
            <button
              onClick={handleRecord}
              disabled={recording || selectedList.length === 0 || hasInvalidAmount}
              className="w-full bg-green-600 text-white font-bold text-lg py-4 rounded-xl hover:bg-green-700 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {recording ? (
                <><Loader2 className="w-5 h-5 animate-spin" />Recording…</>
              ) : selectedList.length === 0 ? (
                'Select at least one'
              ) : hasInvalidAmount ? (
                'Amounts must be 0.01 up to what’s owed'
              ) : (
                `Record ${selectedList.length} settlement${selectedList.length !== 1 ? 's' : ''}`
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

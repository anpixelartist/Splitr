import React, { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useGroup, DELETE_UNDO_MS } from '../context/GroupContext';
import { useAuth } from '../context/AuthContext';
import { ArrowLeft, Receipt, Share2, Plus, Crown, Trash2, CheckCircle2, MoreVertical, LogOut, ChevronDown, SearchX, UserPlus, Loader2 } from 'lucide-react';
import { calculateBalances, calculateSettlements, isSettled } from '../lib/settlement';
import { AddExpenseModal } from '../components/AddExpenseModal';
import { SettleModal } from '../components/SettleModal';
import { BalanceCard } from '../components/BalanceCard';
import { useToast } from '../context/ToastContext';
import { DEFAULT_CURRENCY, formatMoney, formatDate, formatDay } from '../lib/money';
import { unclaimedParticipants, claimedBy } from '../lib/claims';
import { effectiveStatus, allowedActions, countsTowardBalances } from '../lib/payments';
import type { Expense, PaymentStatus, SettlementRecord } from '../types';

export const GroupDetails: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const {
    currentGroup,
    currentGroupStatus,
    isMember,
    joinGroup,
    getMemberName,
    setCurrentGroupId,
    expenses,
    settlementRecords,
    getUsersInGroup,
    isAdmin,
    deleteExpense,
    undoDeleteExpense,
    recordSettlements,
    decidePayment,
    promoteToAdmin,
    demoteAdmin,
    deleteGroup,
    leaveGroup,
    claimParticipant,
    unlinkClaim,
  } = useGroup();

  const { showToast } = useToast();
  const currency = currentGroup?.currency ?? DEFAULT_CURRENCY;
  const money = (n: number) => formatMoney(n, currency);

  const [activeTab, setActiveTab] = useState<'expenses' | 'balances'>('expenses');
  const [isAddExpenseOpen, setIsAddExpenseOpen] = useState(false);
  const [openExpense, setOpenExpense] = useState<Expense | null>(null);
  const [isSettleOpen, setIsSettleOpen] = useState(false);
  const [showGroupMenu, setShowGroupMenu] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [joining, setJoining] = useState(false);
  // Joining: which name-only placeholder this person is ('new' = none of them)
  const [claimChoice, setClaimChoice] = useState<string | null>(null);
  const claimDismissKey = `splitr_claim_dismissed_${id}_${user?.uid}`;
  const [claimBannerDismissed, setClaimBannerDismissed] = useState(() => {
    try { return localStorage.getItem(claimDismissKey) === '1'; } catch { return false; }
  });

  useEffect(() => {
    if (id) setCurrentGroupId(id);
    return () => setCurrentGroupId(null);
  }, [id, setCurrentGroupId]);

  // getUsersInGroup is now synchronous — reads from group.memberNames, no Firestore
  const groupUsers = useMemo(() => getUsersInGroup(), [getUsersInGroup]);

  // Only payments the receiver confirmed (or auto-confirmed after 7 days)
  // move balances; pending ones are listed separately.
  const confirmedPayments = useMemo(
    () => settlementRecords.filter(r => countsTowardBalances(r)),
    [settlementRecords],
  );
  const pendingPayments = useMemo(
    () => settlementRecords.filter(r => effectiveStatus(r) === 'pending'),
    [settlementRecords],
  );

  const balances = useMemo(
    () => calculateBalances(expenses, confirmedPayments),
    [expenses, confirmedPayments],
  );
  const settlementPlan = useMemo(() => calculateSettlements(balances), [balances]);
  const { groupSpend, yourShare } = useMemo(() => ({
    groupSpend: expenses.reduce((sum, e) => sum + e.amount, 0),
    yourShare: expenses.reduce((sum, e) => sum + (e.splits.find(s => s.userId === user?.uid)?.amount ?? 0), 0),
  }), [expenses, user?.uid]);

  // The timestamp of the most-recent settlement record (ISO string, lexicographically comparable)
  const lastSettledAt = useMemo(
    () => confirmedPayments.length > 0
      ? confirmedPayments.reduce((max, r) => r.createdAt > max ? r.createdAt : max, '')
      : null,
    [confirmedPayments],
  );

  // An expense is "settled" only if it was created BEFORE the last settlement was recorded.
  // Expenses added after the last settlement are never settled — even if the net balance
  // happens to be zero — because those new debts haven't been explicitly settled yet.
  const isExpenseSettled = (expense: { createdAt: string }) =>
    lastSettledAt !== null &&
    settlementPlan.length === 0 &&
    expense.createdAt <= lastSettledAt;

  // The group banner shows only when every expense is pre-settlement (no new unsettled expenses)
  const isGroupSettled =
    settlementPlan.length === 0 &&
    confirmedPayments.length > 0 &&
    expenses.length > 0 &&
    expenses.every(e => e.createdAt <= (lastSettledAt ?? ''));

  const getUserName = (uid: string) =>
    groupUsers.find(u => u.id === uid)?.name ?? getMemberName(uid);

  const isFirebaseMember = (uid: string) =>
    currentGroup?.members.includes(uid) ?? false;

  const isMemberAdmin = (uid: string) => {
    if (!currentGroup) return false;
    if (currentGroup.admins?.length) return currentGroup.admins.includes(uid);
    return currentGroup.createdBy === uid;
  };

  const handleShare = async () => {
    if (!currentGroup) return;
    const url = `${window.location.origin}/group/${currentGroup.id}`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Join ${currentGroup.name} on Splitr`,
          text: `Join my group "${currentGroup.name}" on Splitr — code: ${currentGroup.id}`,
          url,
        });
        return;
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return; // user cancelled
      }
    }
    try {
      await navigator.clipboard.writeText(`Join "${currentGroup.name}" on Splitr: ${url} (code ${currentGroup.id})`);
      showToast('Invite link copied');
    } catch {
      showToast(`Group code: ${currentGroup.id}`);
    }
  };

  const handleJoin = async () => {
    if (!id) return;
    setJoining(true);
    const result = await joinGroup(id, claimChoice && claimChoice !== 'new' ? claimChoice : undefined);
    setJoining(false);
    if (result === 'joined') showToast(`Joined ${currentGroup?.name ?? 'group'}`);
    else if (result === 'offline') showToast("You're offline — connect to join this group.", 'error');
    else if (result === 'not-found') showToast('This group no longer exists.', 'error');
    else showToast("Couldn't join the group. Please try again.", 'error');
  };

  const handleClaim = async (p: { id: string; name: string }) => {
    const bal = balances[p.id]?.netBalance ?? 0;
    const owed = bal === 0 ? '' : `, including what ${p.name} ${bal < 0 ? 'owes' : 'is owed'} (${money(Math.abs(bal))})`;
    if (!window.confirm(`Take over ${p.name}'s place in this group${owed}?\n\nAn admin can undo this.`)) return;
    await claimParticipant(p.id);
    showToast(`You're now ${p.name} in this group`);
  };

  const dismissClaimBanner = () => {
    setClaimBannerDismissed(true);
    try { localStorage.setItem(claimDismissKey, '1'); } catch { /* ignore */ }
  };

  const handleUnlink = async (memberName: string, participantId: string, participantName: string) => {
    if (!window.confirm(`Unlink ${memberName} from "${participantName}"?\n\n${participantName}'s share of past expenses goes back to the name-only entry.`)) return;
    await unlinkClaim(participantId);
    showToast(`${memberName} is no longer linked to ${participantName}`);
  };

  const nameOrYou = (id: string, you = 'you') => id === user?.uid ? you : getUserName(id);

  const actionLabel = (r: SettlementRecord, action: PaymentStatus) =>
    action === 'confirmed' ? 'Confirm'
      : action === 'rejected' ? 'Reject'
      : (r.status ?? 'confirmed') === 'pending' ? 'Cancel' : 'Undo';

  const handlePaymentAction = async (r: SettlementRecord, action: PaymentStatus) => {
    const payment = `${money(r.amount)} from ${nameOrYou(r.from)} to ${nameOrYou(r.to)}`;
    if (action === 'rejected' && !window.confirm(`Reject ${payment}?\n\nIt won't count, and balances stay as they are.`)) return;
    if (action === 'cancelled' && (r.status ?? 'confirmed') === 'confirmed'
      && !window.confirm(`Undo ${payment}?\n\nBalances go back to before this payment.`)) return;
    await decidePayment(r.id, action);
    showToast(action === 'confirmed' ? 'Payment confirmed' : action === 'rejected' ? 'Payment rejected' : 'Payment undone');
  };

  const paymentButtons = (r: SettlementRecord) =>
    allowedActions(r, user?.uid ?? '', { memberUids: currentGroup?.members ?? [], isAdmin }).map(a => (
      <button
        key={a}
        onClick={() => handlePaymentAction(r, a)}
        className={`text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition-colors ${
          a === 'confirmed'
            ? 'bg-green-600 border-green-600 text-white hover:bg-green-700'
            : 'border-gray-200 text-gray-600 hover:bg-gray-50'
        }`}
      >
        {actionLabel(r, a)}
      </button>
    ));

  const handleDeleteExpense = async (expenseId: string) => {
    if (confirmDeleteId !== expenseId) { setConfirmDeleteId(expenseId); return; }
    await deleteExpense(expenseId);
    setConfirmDeleteId(null);
    showToast('Expense deleted', 'success', {
      action: { label: 'Undo', onClick: () => undoDeleteExpense(expenseId) },
      duration: DELETE_UNDO_MS,
    });
  };

  const handleLeaveGroup = async () => {
    setShowGroupMenu(false);
    const myBalance = balances[user?.uid || '']?.netBalance || 0;
    if (!isSettled(myBalance)) {
      showToast(
        myBalance < 0
          ? `Settle the ${money(Math.abs(myBalance))} you owe before leaving.`
          : `You're still owed ${money(myBalance)} — settle up before leaving.`,
        'error',
      );
      return;
    }
    if (!window.confirm(`Leave "${currentGroup?.name}"? You'll need the group code to rejoin.`)) return;
    if (await leaveGroup()) navigate('/');
  };

  const handleDeleteGroup = async () => {
    setShowGroupMenu(false);
    if (!window.confirm(`Delete "${currentGroup?.name}" and all its expenses? This cannot be undone.`)) return;
    await deleteGroup();
    navigate('/');
  };

  if (currentGroupStatus === 'not-found') {
    return (
      <div className="max-w-md mx-auto min-h-screen flex flex-col items-center justify-center p-8 text-center">
        <SearchX className="w-12 h-12 text-gray-300 mb-4" />
        <h1 className="text-xl font-bold text-gray-800 mb-1">Group not found</h1>
        <p className="text-gray-500 mb-6">
          The code <span className="font-mono">{id}</span> doesn't match any group. It may have been deleted.
        </p>
        <button onClick={() => navigate('/')} className="bg-blue-600 text-white px-5 py-2.5 rounded-xl font-medium hover:bg-blue-700">
          Back to my groups
        </button>
      </div>
    );
  }

  if (!currentGroup) {
    return (
      <div className="p-8 text-center text-gray-500">
        <Loader2 className="w-6 h-6 animate-spin mx-auto mb-3 text-gray-400" />
        Loading group…
        {!navigator.onLine && <p className="text-xs mt-2">You're offline — this group isn't saved on this device yet.</p>}
      </div>
    );
  }

  // Visiting a shared link for a group you haven't joined yet
  const joinChoices = unclaimedParticipants(currentGroup.participants, currentGroup.claims);
  if (!isMember) {
    return (
      <div className="max-w-md mx-auto min-h-screen flex flex-col items-center justify-center p-8 text-center">
        <div className="w-16 h-16 bg-blue-100 rounded-2xl flex items-center justify-center mb-4">
          <UserPlus className="w-8 h-8 text-blue-600 dark:text-blue-400" />
        </div>
        <p className="text-sm text-gray-500 mb-1">You've been invited to</p>
        <h1 className="text-2xl font-bold text-gray-900 mb-1">{currentGroup.name}</h1>
        <p className="text-sm text-gray-400 mb-6">
          {currentGroup.members.length + joinChoices.length} members · code{' '}
          <span className="font-mono">{currentGroup.id}</span>
        </p>
        {joinChoices.length > 0 && (
          <div className="w-full text-left mb-5">
            <p className="font-semibold text-gray-900">Which of these is you?</p>
            <p className="text-xs text-gray-500 mt-0.5 mb-3">
              Friends may have added you by name before you joined. Pick yourself so your share of past expenses becomes yours.
            </p>
            <div className="space-y-2" role="radiogroup" aria-label="Which of these is you?">
              {[...joinChoices, { id: 'new', name: "I'm not on this list" }].map(p => (
                <label
                  key={p.id}
                  className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                    claimChoice === p.id ? 'border-green-500 bg-green-50' : 'bg-surface hover:bg-gray-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="claim"
                    className="w-4 h-4 accent-green-600"
                    checked={claimChoice === p.id}
                    onChange={() => setClaimChoice(p.id)}
                  />
                  <span className={p.id === 'new' ? 'text-gray-600' : 'font-medium text-gray-800'}>{p.name}</span>
                </label>
              ))}
            </div>
          </div>
        )}
        <button
          onClick={handleJoin}
          disabled={joining || (joinChoices.length > 0 && !claimChoice)}
          className="w-full bg-green-600 text-white py-3 rounded-xl font-semibold hover:bg-green-700 disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {joining && <Loader2 className="w-5 h-5 animate-spin" />}
          Join group
        </button>
        <button onClick={() => navigate('/')} className="mt-3 text-sm text-gray-500 hover:text-gray-700">
          Not now
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-md md:max-w-2xl lg:max-w-5xl mx-auto min-h-screen bg-gray-50 flex flex-col relative">
      <header className="glass border-b border-gray-200/70 sticky top-0 z-10">
        <div className="p-4 flex items-center justify-between">
          <button onClick={() => navigate('/')} className="p-2 -ml-2 rounded-full hover:bg-gray-100" aria-label="Back">
            <ArrowLeft className="w-6 h-6 text-gray-700" />
          </button>
          <div className="flex-1 text-center">
            <h1 className="text-xl font-bold text-gray-900">{currentGroup.name}</h1>
            <p className="text-xs text-gray-500 font-mono">
              Code: {currentGroup.id}
              {isAdmin && <span className="ml-2 text-amber-500 font-medium not-mono">· Admin</span>}
            </p>
          </div>
          <div className="flex items-center gap-1 -mr-1">
            <button onClick={handleShare} className="p-2 rounded-full hover:bg-gray-100 text-blue-600 dark:text-blue-400" aria-label="Invite people">
              <Share2 className="w-5 h-5" />
            </button>
            <button
              onClick={() => setShowGroupMenu(true)}
              className="p-2 rounded-full hover:bg-gray-100 text-gray-500"
              aria-label="Group options"
            >
              <MoreVertical className="w-5 h-5" />
            </button>
          </div>
        </div>
        {/* iOS-style segmented control: the white thumb slides under the active tab */}
        <div className="px-4 pb-3 lg:hidden">
          <div role="tablist" className="relative grid grid-cols-2 rounded-[0.6rem] bg-gray-200/70 p-0.5">
            <div
              aria-hidden="true"
              className={`absolute inset-y-0.5 left-0.5 w-[calc(50%-0.125rem)] rounded-[0.5rem] bg-surface shadow-[0_1px_3px_rgb(0_0_0/0.12)] transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${
                activeTab === 'balances' ? 'translate-x-full' : ''
              }`}
            />
            {(['expenses', 'balances'] as const).map(tab => (
              <button
                key={tab}
                role="tab"
                aria-selected={activeTab === tab}
                className={`relative py-1.5 text-[0.8125rem] font-semibold capitalize transition-colors ${
                  activeTab === tab ? 'text-gray-900' : 'text-gray-500'
                }`}
                onClick={() => setActiveTab(tab)}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="flex-1 p-4 lg:p-8">
        {/* Joined as a new person while a placeholder with your name exists */}
        {(() => {
          const choices = unclaimedParticipants(currentGroup.participants, currentGroup.claims);
          const show = !claimBannerDismissed && choices.length > 0
            && currentGroup.createdBy !== user?.uid // the creator added these names
            && !claimedBy(currentGroup.claims, user?.uid ?? '');
          if (!show) return null;
          return (
            <div className="anim-fade-in mb-4 bg-blue-50 border border-blue-200 rounded-xl p-4">
              <p className="font-semibold text-gray-900">Are you one of these people?</p>
              <p className="text-sm text-gray-600 mt-0.5">
                They were added by name before you joined. Picking yourself moves their share of expenses to you.
              </p>
              <div className="flex flex-wrap gap-2 mt-3">
                {choices.map(p => (
                  <button
                    key={p.id}
                    onClick={() => handleClaim(p)}
                    className="px-3 py-1.5 rounded-lg bg-surface border border-blue-200 text-sm font-medium text-blue-700 dark:text-blue-300 hover:bg-blue-100"
                  >
                    I'm {p.name}
                  </button>
                ))}
                <button onClick={dismissClaimBanner} className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700">
                  None of these
                </button>
              </div>
            </div>
          );
        })()}
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-8 lg:items-start">
          {/* Phones show one tab at a time; laptops show both columns */}
          <div className={`space-y-3 ${activeTab === 'expenses' ? '' : 'hidden'} lg:block`}>
            <h3 className="hidden lg:block text-sm font-bold text-gray-500 uppercase tracking-wider">Expenses</h3>

            {/* ── All-settled banner ─────────────────────────────────────── */}
            {isGroupSettled && (
              <div className="anim-fade-in relative overflow-hidden rounded-2xl border border-green-200 bg-gradient-to-br from-green-50 to-emerald-50 p-4 flex items-center gap-3 shadow-sm">
                {/* subtle ring decoration */}
                <div className="absolute -right-6 -top-6 w-24 h-24 rounded-full bg-green-200/40 pointer-events-none" />
                <div className="absolute -right-2 -bottom-4 w-16 h-16 rounded-full bg-emerald-200/30 pointer-events-none" />
                <div className="anim-pop-in w-11 h-11 bg-green-500 rounded-full flex items-center justify-center shadow-md shadow-green-200 shrink-0 z-10">
                  <CheckCircle2 className="w-6 h-6 text-white" strokeWidth={2.5} />
                </div>
                <div className="z-10">
                  <p className="font-bold text-green-800 dark:text-green-300 text-base leading-tight">All Settled Up!</p>
                  <p className="text-xs text-green-600 dark:text-green-400 mt-0.5">
                    {confirmedPayments.length} payment{confirmedPayments.length !== 1 ? 's' : ''} recorded
                    {' · '}{formatDate(confirmedPayments[0].createdAt)}
                  </p>
                </div>
              </div>
            )}

            {expenses.length > 0 && !isGroupSettled && (
              <p className="text-xs text-center text-gray-400">Tap an expense to see or edit it</p>
            )}

            {expenses.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                <Receipt className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>No expenses yet. Add one to get started!</p>
              </div>
            ) : (
              expenses.map(expense => {
                const isConfirming = confirmDeleteId === expense.id;
                const expSettled = isExpenseSettled(expense);
                return (
                  <div
                    key={expense.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`Open ${expense.description}`}
                    onClick={() => { if (!isConfirming) setOpenExpense(expense); }}
                    onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); setOpenExpense(expense); } }}
                    className={`p-4 rounded-xl border shadow-sm transition-all cursor-pointer hover:border-blue-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                      isConfirming
                        ? 'border-red-300 bg-red-50'
                        : expSettled
                        ? 'bg-green-50/50 border-green-200 border-l-4 border-l-green-400'
                        : 'bg-surface'
                    }`}
                  >
                    <div className="flex justify-between items-start mb-1">
                      <h3 className="font-semibold text-gray-800 flex-1 mr-2">{expense.description}</h3>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-bold text-gray-900">{money(expense.amount)}</span>
                        {isAdmin && (
                          isConfirming ? (
                            <div className="flex flex-col items-end gap-1" onClick={e => e.stopPropagation()}>
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => setConfirmDeleteId(null)}
                                  className="text-xs px-2 py-1 rounded-lg border border-gray-300 text-gray-500 hover:bg-gray-100"
                                >
                                  Cancel
                                </button>
                                <button
                                  onClick={() => handleDeleteExpense(expense.id)}
                                  className="text-xs px-2 py-1 rounded-lg bg-red-600 text-white hover:bg-red-700"
                                >
                                  Delete
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              onClick={e => { e.stopPropagation(); handleDeleteExpense(expense.id); }}
                              className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                              aria-label={`Delete ${expense.description}`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )
                        )}
                      </div>
                    </div>
                    <div className="text-sm text-gray-500 flex justify-between items-center">
                      <span>Paid by {expense.paidBy === user?.uid ? 'you' : getUserName(expense.paidBy)}</span>
                      <span>{expense.date ? formatDay(expense.date) : formatDate(expense.createdAt)}</span>
                    </div>
                    {expense.createdBy && expense.createdBy !== expense.paidBy && (
                      <p className="text-xs text-gray-400 mt-0.5">
                        Added by {expense.createdBy === user?.uid ? 'you' : getUserName(expense.createdBy)}
                      </p>
                    )}
                    {expense.editedBy && (
                      <p className="text-xs text-gray-400 mt-0.5">
                        Edited by {expense.editedBy === user?.uid ? 'you' : getUserName(expense.editedBy)}
                        {expense.editedAt && <> · {formatDate(expense.editedAt, undefined, false)}</>}
                      </p>
                    )}
                    {/* Settled badge */}
                    {expSettled && !isConfirming && (
                      <div className="flex items-center gap-1 mt-2 pt-2 border-t border-green-100">
                        <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                        <span className="text-xs font-semibold text-green-600 dark:text-green-400">Settled</span>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
          <div className={`space-y-6 ${activeTab === 'balances' ? '' : 'hidden'} lg:block`}>
            {/* Your Balance */}
            <section>
              <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3">Your Balance</h3>
              <BalanceCard
                balance={balances[user?.uid || '']?.netBalance || 0}
                groupSpend={groupSpend}
                yourShare={yourShare}
                currency={currency}
              />

              {/* Payments waiting for the receiver: not in the balance yet */}
              {pendingPayments.length > 0 && (
                <div className="mt-3 space-y-2">
                  {pendingPayments.map(r => (
                    <div key={r.id} className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm">
                      <p className="text-gray-800">
                        {r.to === user?.uid ? (
                          <><strong>{getUserName(r.from)}</strong> paid you <strong>{money(r.amount)}</strong>?</>
                        ) : (
                          <><strong>{money(r.amount)}</strong> from {nameOrYou(r.from)} to {nameOrYou(r.to)} is pending</>
                        )}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {r.to === user?.uid
                          ? `Recorded by ${nameOrYou(r.recordedBy ?? '')}. It counts once you confirm, or in 7 days.`
                          : `Waiting for ${getUserName(r.to)} to confirm. Recorded by ${nameOrYou(r.recordedBy ?? '')}.`}
                      </p>
                      {paymentButtons(r).length > 0 && <div className="flex gap-2 mt-2">{paymentButtons(r)}</div>}
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Settlement Plan */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider">Settlement Plan</h3>
                {settlementPlan.length > 0 && (
                  <button
                    onClick={() => setIsSettleOpen(true)}
                    className="text-sm font-semibold text-green-700 dark:text-green-300 bg-green-100 hover:bg-green-200 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    Settle Up
                  </button>
                )}
              </div>
              {settlementPlan.length === 0 ? (
                isGroupSettled ? (
                  <div className="anim-fade-in bg-green-50 border border-green-200 p-5 rounded-xl text-center shadow-sm">
                    <div className="anim-pop-in w-10 h-10 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-2 shadow-md shadow-green-200">
                      <CheckCircle2 className="w-5 h-5 text-white" strokeWidth={2.5} />
                    </div>
                    <p className="font-semibold text-green-800 dark:text-green-300">All settled up!</p>
                    <p className="text-xs text-green-600 dark:text-green-400 mt-0.5">Every expense has been paid off</p>
                  </div>
                ) : (
                  <div className="bg-surface p-5 rounded-xl border text-center shadow-sm">
                    <p className="font-medium text-gray-600">No pending payments</p>
                    <p className="text-xs text-gray-400 mt-1">
                      {expenses.length === 0
                        ? 'Add an expense to start tracking'
                        : 'Add more expenses to split with the group'}
                    </p>
                  </div>
                )
              ) : (
                <div className="space-y-2">
                  {settlementPlan.map(s => (
                    <div key={`${s.from}-${s.to}`} className="bg-surface p-4 rounded-xl border shadow-sm flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center font-bold text-gray-600 text-xs">
                          {getUserName(s.from).charAt(0)}
                        </div>
                        <div className="text-sm">
                          <span className="font-semibold">{s.from === user?.uid ? 'You' : getUserName(s.from)}</span>
                          <span className="text-gray-500 mx-1">{s.from === user?.uid ? 'owe' : 'owes'}</span>
                          <span className="font-semibold">{s.to === user?.uid ? 'you' : getUserName(s.to)}</span>
                        </div>
                      </div>
                      <span className="font-bold text-gray-900">{money(s.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Settled Payments History — collapsible, latest 5 shown */}
            {settlementRecords.length > 0 && (
              <section>
                <button
                  onClick={() => {
                    if (showHistory) setShowAllHistory(false);
                    setShowHistory(h => !h);
                  }}
                  className="w-full flex items-center justify-between mb-3 group"
                >
                  <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider">
                    Settlement History
                  </h3>
                  <span className="flex items-center gap-1.5 text-sm text-gray-400 group-hover:text-gray-600">
                    <span>{settlementRecords.length} payment{settlementRecords.length !== 1 ? 's' : ''}</span>
                    <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${showHistory ? 'rotate-180' : ''}`} />
                  </span>
                </button>

                {showHistory && (
                  <div className="space-y-2">
                    {(showAllHistory ? settlementRecords : settlementRecords.slice(0, 5)).map(r => {
                      const status = effectiveStatus(r);
                      const autoConfirmed = status === 'confirmed' && r.status === 'pending';
                      const inactive = status === 'rejected' || status === 'cancelled';
                      return (
                        <div key={r.id} className={`bg-surface p-4 rounded-xl border shadow-sm ${inactive ? 'opacity-60' : ''}`}>
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-3 min-w-0">
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                                status === 'confirmed' ? 'bg-green-100' : status === 'pending' ? 'bg-amber-100' : 'bg-gray-100'
                              }`}>
                                <CheckCircle2 className={`w-4 h-4 ${
                                  status === 'confirmed' ? 'text-green-600 dark:text-green-400' : 'text-gray-400'
                                }`} />
                              </div>
                              <div className="text-sm min-w-0">
                                <p>
                                  <span className={`font-semibold ${inactive ? 'line-through text-gray-500' : 'text-gray-800'}`}>{nameOrYou(r.from, 'You')}</span>
                                  <span className="text-gray-400 mx-1">paid</span>
                                  <span className={`font-semibold ${inactive ? 'line-through text-gray-500' : 'text-gray-800'}`}>{nameOrYou(r.to)}</span>
                                </p>
                                <p className="text-xs text-gray-400 mt-0.5">
                                  {status === 'pending' ? 'Pending' : status === 'rejected' ? 'Rejected' : status === 'cancelled' ? 'Undone' : autoConfirmed ? 'Auto-confirmed' : 'Confirmed'}
                                  {r.recordedBy && <> · recorded by {nameOrYou(r.recordedBy)}</>}
                                  {r.decidedBy && inactive && <> · by {nameOrYou(r.decidedBy)}</>}
                                </p>
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <p className={`font-bold ${inactive ? 'line-through text-gray-400' : 'text-gray-900'}`}>{money(r.amount)}</p>
                              <p className="text-xs text-gray-400">{formatDate(r.createdAt)}</p>
                            </div>
                          </div>
                          {status !== 'pending' && paymentButtons(r).length > 0 && (
                            <div className="flex justify-end gap-2 mt-2">{paymentButtons(r)}</div>
                          )}
                        </div>
                      );
                    })}

                    {settlementRecords.length > 5 && !showAllHistory && (
                      <button
                        onClick={() => setShowAllHistory(true)}
                        className="w-full py-2.5 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium bg-blue-50 hover:bg-blue-100 rounded-xl transition-colors"
                      >
                        Show all {settlementRecords.length} payments
                      </button>
                    )}
                  </div>
                )}
              </section>
            )}

            {/* Group Members */}
            <section>
              <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3">Group Members</h3>
              <div className="bg-surface rounded-xl border shadow-sm overflow-hidden divide-y">
                {groupUsers.map(u => {
                  const memberIsAdmin = isMemberAdmin(u.id);
                  const memberIsFirebase = isFirebaseMember(u.id);
                  const isMe = u.id === user?.uid;
                  const isLastAdmin = memberIsAdmin && (currentGroup.admins?.length ?? 0) <= 1;
                  const bal = balances[u.id]?.netBalance || 0;
                  const claimedId = memberIsFirebase ? claimedBy(currentGroup.claims, u.id) : undefined;
                  const claimedName = claimedId && currentGroup.participants?.find(p => p.id === claimedId)?.name;

                  return (
                    <div key={u.id} className="p-3 flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-blue-100 text-blue-700 dark:text-blue-300 flex items-center justify-center font-bold text-sm shrink-0">
                        {u.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-medium text-gray-800 truncate">
                            {u.name}{isMe && ' (You)'}
                          </span>
                          {memberIsAdmin && (
                            <span title="Admin" aria-label="Admin" className="shrink-0">
                              <Crown className="w-3.5 h-3.5 text-amber-500" />
                            </span>
                          )}
                          {!memberIsFirebase && (
                            <span className="text-xs text-gray-400 border border-gray-200 rounded px-1 whitespace-nowrap">not on Splitr yet</span>
                          )}
                          {claimedName && claimedName !== u.name && (
                            <span className="text-xs text-gray-400 whitespace-nowrap">was “{claimedName}”</span>
                          )}
                        </div>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {bal === 0 ? 'Settled' : (
                            <span className={bal > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
                              {bal > 0 ? '+' : '-'}{money(Math.abs(bal))}
                            </span>
                          )}
                        </p>
                      </div>
                      {isAdmin && claimedId && claimedName && (
                        <button
                          onClick={() => handleUnlink(u.name, claimedId, claimedName)}
                          className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 shrink-0"
                          title={`Undo: ${u.name} is not ${claimedName}`}
                        >
                          Unlink
                        </button>
                      )}
                      {isAdmin && memberIsFirebase && !isMe && (
                        <button
                          onClick={async () => {
                            if (memberIsAdmin) {
                              await demoteAdmin(u.id);
                              showToast(`${u.name}'s admin role removed`);
                            } else {
                              await promoteToAdmin(u.id);
                              showToast(`${u.name} is now an admin`);
                            }
                          }}
                          disabled={memberIsAdmin && isLastAdmin}
                          className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors shrink-0 ${
                            memberIsAdmin
                              ? 'border-amber-200 text-amber-600 dark:text-amber-400 hover:bg-amber-50 disabled:opacity-40'
                              : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                          }`}
                          title={memberIsAdmin && isLastAdmin ? "Can't remove the last admin" : undefined}
                        >
                          {memberIsAdmin ? 'Revoke admin' : 'Make admin'}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        </div>
      </main>

      {/* Add Expense bar: takes real space at the end of the page and sticks to
          the bottom while scrolling, so it can never cover the last rows */}
      <div className="sticky bottom-0 z-20 glass border-t border-gray-200/70 px-4 lg:px-8 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] flex justify-center lg:justify-end">
        <button
          onClick={() => setIsAddExpenseOpen(true)}
          className="bg-blue-600 text-white px-6 py-3.5 rounded-full shadow-lg shadow-blue-600/25 flex items-center gap-2 whitespace-nowrap font-semibold text-[1.0625rem] hover:bg-blue-700 transition-transform active:scale-95"
        >
          <Plus className="w-6 h-6" /> Add Expense
        </button>
      </div>

      {/* ── Group menu sheet ─────────────────────────────────────────────────── */}
      {showGroupMenu && (
        <div
          className="anim-fade-in fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center sm:p-4"
          onClick={() => setShowGroupMenu(false)}
        >
          <div
            className="bg-surface w-full max-w-md mx-auto sheet rounded-t-3xl sm:rounded-3xl overflow-hidden pb-[env(safe-area-inset-bottom)] sm:pb-0"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-4 pt-4 pb-1">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{currentGroup.name}</p>
            </div>
            <div className="divide-y">
              {/* Leave Group */}
              <button
                onClick={handleLeaveGroup}
                className="w-full flex items-center gap-3 px-4 py-4 hover:bg-gray-50 text-left transition-colors"
              >
                <LogOut className="w-5 h-5 text-gray-500" />
                <div>
                  <p className="font-medium text-gray-800">Leave Group</p>
                  <p className="text-xs text-gray-400">You'll need the group code to rejoin</p>
                </div>
              </button>

              {/* Delete Group — admins only */}
              {isAdmin && (
                <button
                  onClick={handleDeleteGroup}
                  className="w-full flex items-center gap-3 px-4 py-4 hover:bg-red-50 text-left transition-colors"
                >
                  <Trash2 className="w-5 h-5 text-red-500" />
                  <div>
                    <p className="font-medium text-red-600 dark:text-red-400">Delete Group</p>
                    <p className="text-xs text-red-400">Permanently deletes all expenses · cannot be undone</p>
                  </div>
                </button>
              )}
            </div>
            <div className="p-3">
              <button
                onClick={() => setShowGroupMenu(false)}
                className="w-full py-3 rounded-xl bg-gray-100 text-gray-600 font-medium hover:bg-gray-200 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {isAddExpenseOpen && (
        <AddExpenseModal
          onClose={() => setIsAddExpenseOpen(false)}
          users={groupUsers}
        />
      )}

      {openExpense && (
        <AddExpenseModal
          key={openExpense.id}
          expense={openExpense}
          readOnly={openExpense.createdBy !== user?.uid && !isAdmin}
          settledBefore={lastSettledAt !== null && openExpense.createdAt <= lastSettledAt}
          onClose={() => setOpenExpense(null)}
          users={groupUsers}
        />
      )}

      {isSettleOpen && (
        <SettleModal
          pendingTransactions={settlementPlan}
          groupName={currentGroup.name}
          currency={currency}
          getUserName={getUserName}
          currentUserId={user?.uid || ''}
          onRecord={async (selected) => { await recordSettlements(selected); }}
          onClose={() => setIsSettleOpen(false)}
        />
      )}
    </div>
  );
};

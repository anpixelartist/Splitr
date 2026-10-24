import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { db, isFirebaseConfigured } from '../firebase/config';
import {
  collection, query, where, onSnapshot, doc, getDoc, getDocs,
  setDoc, updateDoc, deleteDoc, arrayUnion, writeBatch, deleteField, FieldPath,
  type DocumentReference,
} from 'firebase/firestore';
import type { Group, Expense, SettlementRecord } from '../types';
import { useAuth } from './AuthContext';
import { useToast } from './ToastContext';
import { calculateBalances, isSettled, validateExpense } from '../lib/settlement';
import { applyClaims, resolveId } from '../lib/claims';
import { v4 as uuidv4 } from 'uuid';

// ─── Firestore layout ────────────────────────────────────────────────────────
//   groups/{groupId}                      group doc (members, admins, names…)
//   groups/{groupId}/expenses/{id}        expenses
//   groups/{groupId}/settlements/{id}     recorded settlement payments
//   users/{uid}                           profile + contacts
// Sub-collections let the security rules restrict reads to group members.

const groupDoc = (gid: string) => doc(db, 'groups', gid);
const expensesCol = (gid: string) => collection(db, 'groups', gid, 'expenses');
const settlementsCol = (gid: string) => collection(db, 'groups', gid, 'settlements');

// ─── localStorage helpers ───────────────────────────────────────────────────
// The full store in local-only mode (no Firebase config); otherwise a cache so
// the UI renders instantly before Firestore answers. Keys are scoped per user
// so a shared device never shows one account's data to another.

const lsKey = (k: string) => `splitr_${k}`;

function lsGet<T>(key: string): T[] {
  try { return JSON.parse(localStorage.getItem(lsKey(key)) || '[]'); } catch { return []; }
}
function lsSave(key: string, data: unknown) {
  try { localStorage.setItem(lsKey(key), JSON.stringify(data)); } catch { /* storage full / blocked */ }
}
function lsDel(key: string) {
  try { localStorage.removeItem(lsKey(key)); } catch { /* ignore */ }
}

const groupsLsKey = (uid: string) => `groups_${uid}`;
const expensesLsKey = (uid: string, groupId: string) => `expenses_${uid}_${groupId}`;
const settlementsLsKey = (uid: string, groupId: string) => `settlements_${uid}_${groupId}`;

// Older versions stored expenses/settlements under unscoped keys. Move them
// over the first time a group is opened so local-only data isn't lost.
function lsGetMigrating<T>(scopedKey: string, legacyKey: string): T[] {
  try {
    if (localStorage.getItem(lsKey(scopedKey)) === null && localStorage.getItem(lsKey(legacyKey)) !== null) {
      const legacy = lsGet<T>(legacyKey);
      lsSave(scopedKey, legacy);
      lsDel(legacyKey);
      return legacy;
    }
  } catch { /* storage blocked */ }
  return lsGet<T>(scopedKey);
}

const byNewest = (a: { createdAt: string }, b: { createdAt: string }) =>
  new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();

// ─── Group code generation ───────────────────────────────────────────────────
// 6 chars from a 31-symbol alphabet without look-alikes (0/O, 1/I/L) ≈ 887M codes.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

const randomGroupCode = () => {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
};

// ─── Admin helpers ───────────────────────────────────────────────────────────

const adminsOf = (group: Group): string[] =>
  group.admins && group.admins.length > 0
    ? group.admins
    : group.createdBy ? [group.createdBy] : []; // backward compat: creator is admin on old groups

const resolveIsAdmin = (group: Group | null, uid: string | undefined): boolean =>
  !!group && !!uid && adminsOf(group).includes(uid);

// ─── Context types ───────────────────────────────────────────────────────────

export type GroupStatus = 'idle' | 'loading' | 'ready' | 'not-found';
export type JoinResult = 'joined' | 'not-found' | 'offline' | 'unavailable' | 'error';

interface GroupContextType {
  groups: Group[];
  currentGroup: Group | null;
  currentGroupStatus: GroupStatus;
  setCurrentGroupId: (id: string | null) => void;
  expenses: Expense[];
  settlementRecords: SettlementRecord[];
  loading: boolean;
  isAdmin: boolean;
  isMember: boolean;
  createGroup: (name: string, participants?: { id: string; name: string }[]) => Promise<string>;
  /** Joins by code; `claimId` = the name-only participant this person says they are. */
  joinGroup: (groupId: string, claimId?: string) => Promise<JoinResult>;
  /** For a member who joined as a new person: "that placeholder was me". */
  claimParticipant: (participantId: string) => Promise<void>;
  /** Admins: undo a wrong claim. */
  unlinkClaim: (participantId: string) => Promise<void>;
  addExpense: (expense: Omit<Expense, 'id' | 'createdAt' | 'createdBy'>) => Promise<void>;
  deleteExpense: (id: string) => Promise<void>;
  recordSettlements: (transactions: { from: string; to: string; amount: number }[]) => Promise<void>;
  promoteToAdmin: (uid: string) => Promise<void>;
  demoteAdmin: (uid: string) => Promise<void>;
  deleteGroup: () => Promise<void>;
  /** Resolves false (and does nothing) while the user still owes or is owed money. */
  leaveGroup: () => Promise<boolean>;
  getUsersInGroup: () => { id: string; name: string }[];
  /** Name for any uid/participant id, including members who have left. */
  getMemberName: (id: string) => string;
}

const GroupContext = createContext<GroupContextType>({
  groups: [], currentGroup: null, currentGroupStatus: 'idle', setCurrentGroupId: () => {},
  expenses: [], settlementRecords: [], loading: true, isAdmin: false, isMember: false,
  createGroup: async () => '',
  joinGroup: async () => 'error',
  claimParticipant: async () => {},
  unlinkClaim: async () => {},
  addExpense: async () => {},
  deleteExpense: async () => {},
  recordSettlements: async () => {},
  promoteToAdmin: async () => {},
  demoteAdmin: async () => {},
  deleteGroup: async () => {},
  leaveGroup: async () => false,
  getUsersInGroup: () => [],
  getMemberName: () => 'Unknown',
});

// eslint-disable-next-line react/only-export-components
export const useGroup = () => useContext(GroupContext);

// ─── Provider ────────────────────────────────────────────────────────────────

export const GroupProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, userName, hasDefaultName, updateUserName } = useAuth();
  const { showToast } = useToast();
  const uid = user?.uid;

  const [groups, setGroups] = useState<Group[]>([]);
  const [currentGroupId, setCurrentGroupId] = useState<string | null>(null);
  const [currentGroup, setCurrentGroup] = useState<Group | null>(null);
  const [currentGroupStatus, setCurrentGroupStatus] = useState<GroupStatus>('idle');
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [settlementRecords, setSettlementRecords] = useState<SettlementRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // Ref keeps up-to-date groups value accessible inside snapshot callbacks
  // without adding `groups` to effect deps (which would recreate subscriptions)
  const groupsRef = useRef<Group[]>([]);
  useEffect(() => { groupsRef.current = groups; }, [groups]);

  // True once the server has confirmed my membership (no pending local write).
  // Subscribing to expenses earlier gets rejected by the security rules, e.g.
  // right after creating a group that hasn't uploaded yet, or mid-join.
  const [membershipSynced, setMembershipSynced] = useState(false);
  // Bumped to re-subscribe after a listener was rejected
  const [listenerRetry, setListenerRetry] = useState(0);

  // Everything below reads expenses and payments with claimed placeholders
  // resolved to the member who claimed them (see lib/claims.ts).
  const resolved = useMemo(
    () => applyClaims(expenses, settlementRecords, currentGroup?.claims),
    [expenses, settlementRecords, currentGroup?.claims],
  );

  const isAdmin = resolveIsAdmin(currentGroup, uid);
  const isMember = !!currentGroup && !!uid && currentGroup.members.includes(uid);
  const canListen = isMember && (!isFirebaseConfigured || membershipSynced);

  // Background Firestore write. Local state is already updated (optimistic UI);
  // writes never block because offline writes only resolve once the server
  // acknowledges them. A rejected write (e.g. permission denied) is reported.
  const remote = useCallback((write: () => Promise<unknown>, what: string) => {
    if (!isFirebaseConfigured) return;
    write().catch((err) => {
      console.error(`[Splitr] Failed to ${what}`, err);
      showToast(`Couldn't ${what}. Please try again.`, 'error');
    });
  }, [showToast]);

  const saveGroupsLocal = (next: Group[]) => {
    groupsRef.current = next;
    if (uid) lsSave(groupsLsKey(uid), next);
  };

  // ── Listen for user's groups ──────────────────────────────────────────────
  useEffect(() => {
    // Always reset on account change so one user never sees another's groups
    if (!uid) {
      setGroups([]);
      groupsRef.current = [];
      setLoading(false);
      return;
    }

    const saved = lsGet<Group>(groupsLsKey(uid));
    setGroups(saved);
    groupsRef.current = saved;
    setLoading(saved.length === 0 && isFirebaseConfigured);

    if (!isFirebaseConfigured) return;

    const q = query(collection(db, 'groups'), where('members', 'array-contains', uid));
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        // An empty answer from the local cache on first load just means "not
        // synced yet" — keep the localStorage seed. Anything else is the truth,
        // including an empty list from the server (all groups left/deleted).
        if (snapshot.empty && snapshot.metadata.fromCache) { setLoading(false); return; }
        const data = snapshot.docs.map(d => ({ ...d.data(), id: d.id })) as Group[];
        setGroups(data);
        groupsRef.current = data;
        lsSave(groupsLsKey(uid), data);
        setLoading(false);
      },
      (err) => {
        console.error('[Splitr] groups listener failed', err);
        setLoading(false);
      },
    );
    return unsub;
  }, [uid]);

  // ── Listen for the current group doc ──────────────────────────────────────
  useEffect(() => {
    setMembershipSynced(false);
    setListenerRetry(0);
    if (!currentGroupId) {
      setCurrentGroup(null);
      setCurrentGroupStatus('idle');
      return;
    }

    // Seed from local state so GroupDetails renders immediately
    const localGroup = groupsRef.current.find(g => g.id === currentGroupId) ?? null;
    setCurrentGroup(localGroup);
    setCurrentGroupStatus(localGroup ? 'ready' : isFirebaseConfigured ? 'loading' : 'not-found');

    if (!isFirebaseConfigured) return;

    return onSnapshot(
      groupDoc(currentGroupId),
      { includeMetadataChanges: true }, // so we hear when a pending write is acknowledged
      (docSnap) => {
        if (docSnap.exists()) {
          const g = { ...docSnap.data(), id: docSnap.id } as Group;
          setCurrentGroup(g);
          setCurrentGroupStatus('ready');
          setMembershipSynced(!!uid && g.members.includes(uid) && !docSnap.metadata.hasPendingWrites);
        } else if (!docSnap.metadata.fromCache) {
          // The server says it doesn't exist (wrong code, or deleted)
          setCurrentGroup(null);
          setCurrentGroupStatus('not-found');
        }
      },
      (err) => {
        console.error('[Splitr] group listener failed', err);
        if (!localGroup) setCurrentGroupStatus('not-found');
      },
    );
  }, [currentGroupId, uid]);

  // ── Seed expenses + settlements from the local cache (members only) ────────
  useEffect(() => {
    if (!currentGroupId || !uid || !isMember) {
      setExpenses([]);
      setSettlementRecords([]);
      return;
    }
    const gid = currentGroupId;
    setExpenses(lsGetMigrating<Expense>(expensesLsKey(uid, gid), `expenses_${gid}`));
    setSettlementRecords(lsGetMigrating<SettlementRecord>(settlementsLsKey(uid, gid), `settlements_${gid}`));
  }, [currentGroupId, uid, isMember]);

  // ── Listen for expenses + settlements once membership is confirmed ─────────
  useEffect(() => {
    if (!isFirebaseConfigured || !currentGroupId || !uid || !canListen) return;
    const gid = currentGroupId;

    // A rejected listener is dead; try again a few times (e.g. the rules saw a
    // membership change a moment before it landed).
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const onListenError = (what: string) => (err: unknown) => {
      console.error(`[Splitr] ${what} listener failed`, err);
      if (listenerRetry < 3 && !retryTimer) {
        retryTimer = setTimeout(() => setListenerRetry(n => n + 1), 1500 * (listenerRetry + 1));
      }
    };

    const expUnsub = onSnapshot(
      expensesCol(gid),
      (snapshot) => {
        if (snapshot.empty && snapshot.metadata.fromCache) return;
        const data = snapshot.docs.map(d => ({ ...d.data(), id: d.id })) as Expense[];
        data.sort(byNewest);
        setExpenses(data);
        lsSave(expensesLsKey(uid, gid), data);
      },
      onListenError('expenses'),
    );

    const settUnsub = onSnapshot(
      settlementsCol(gid),
      (snapshot) => {
        if (snapshot.empty && snapshot.metadata.fromCache) return;
        const data = snapshot.docs.map(d => ({ ...d.data(), id: d.id })) as SettlementRecord[];
        data.sort(byNewest);
        setSettlementRecords(data);
        lsSave(settlementsLsKey(uid, gid), data);
      },
      onListenError('settlements'),
    );

    return () => {
      clearTimeout(retryTimer);
      expUnsub();
      settUnsub();
    };
  }, [currentGroupId, uid, canListen, listenerRetry]);

  // ── Keep my display name current in every group I'm in ────────────────────
  // Each group caches member names; this fixes them up after a rename.
  const nameSyncAttempts = useRef(new Set<string>());
  useEffect(() => {
    if (!isFirebaseConfigured || !uid || !userName) return;
    for (const g of groups) {
      if (!g.members.includes(uid) || g.memberNames?.[uid] === userName) continue;
      const attempt = `${g.id}:${userName}`;
      if (nameSyncAttempts.current.has(attempt)) continue; // don't retry-loop on failure
      nameSyncAttempts.current.add(attempt);
      updateDoc(groupDoc(g.id), { [`memberNames.${uid}`]: userName }).catch(() => {});
    }
  }, [groups, uid, userName]);

  // ── Helpers ───────────────────────────────────────────────────────────────

  // Apply a group update to all local state and localStorage immediately
  const updateGroupLocally = (updated: Group) => {
    setCurrentGroup(updated);
    setGroups(prev => {
      const next = prev.map(g => g.id === updated.id ? updated : g);
      saveGroupsLocal(next);
      return next;
    });
  };

  const removeGroupLocally = (gid: string) => {
    if (uid) {
      lsDel(expensesLsKey(uid, gid));
      lsDel(settlementsLsKey(uid, gid));
    }
    setGroups(prev => {
      const next = prev.filter(g => g.id !== gid);
      saveGroupsLocal(next);
      return next;
    });
    setExpenses([]);
    setSettlementRecords([]);
    setCurrentGroup(null);
  };

  // Deletes a group with all its expenses and settlements. Queries the server
  // so nothing is orphaned; falls back to what's loaded locally when offline.
  const purgeGroup = async (gid: string, knownExpenses: Expense[], knownSettlements: SettlementRecord[]) => {
    let refs: DocumentReference[];
    try {
      const [exp, sett] = await Promise.all([getDocs(expensesCol(gid)), getDocs(settlementsCol(gid))]);
      refs = [...exp.docs.map(d => d.ref), ...sett.docs.map(d => d.ref)];
    } catch {
      refs = [
        ...knownExpenses.map(e => doc(expensesCol(gid), e.id)),
        ...knownSettlements.map(s => doc(settlementsCol(gid), s.id)),
      ];
    }
    // Batches hold up to 500 writes; the group doc goes last so the security
    // rules can still see the group while its children are being deleted.
    const all = [...refs, groupDoc(gid)];
    for (let i = 0; i < all.length; i += 450) {
      const batch = writeBatch(db);
      all.slice(i, i + 450).forEach(ref => batch.delete(ref));
      await batch.commit();
    }
  };

  // ── CRUD — all use optimistic updates ────────────────────────────────────
  //
  // Pattern for every write:
  //   1. Update local state + localStorage IMMEDIATELY (instant UI, works offline)
  //   2. Sync to Firestore in the background via remote(), which reports failures

  const createGroup = async (
    name: string,
    participants: { id: string; name: string }[] = [],
  ): Promise<string> => {
    if (!user) throw new Error('Must be logged in');

    // Avoid codes that are already taken. Offline we can't check, but the
    // security rules reject overwriting an existing group anyway.
    let groupId = randomGroupCode();
    if (isFirebaseConfigured && navigator.onLine) {
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          if (!(await getDoc(groupDoc(groupId))).exists()) break;
        } catch {
          break;
        }
        groupId = randomGroupCode();
      }
    }

    const newGroup: Group = {
      id: groupId, name,
      members: [user.uid],
      participants,
      createdBy: user.uid,
      admins: [user.uid],
      memberNames: { [user.uid]: userName },
      createdAt: new Date().toISOString(),
    };

    // 1. Instant local update
    const updated = [...groupsRef.current, newGroup];
    setGroups(updated);
    saveGroupsLocal(updated);

    // 2. Background Firebase sync
    remote(() => setDoc(groupDoc(groupId), newGroup), 'create the group');

    return groupId;
  };

  // A claimed placeholder's name becomes the joiner's name if they haven't
  // chosen one yet ("User a1b2" → "Priya").
  const adoptParticipantName = (group: Group | null, participantId: string) => {
    const name = group?.participants?.find(p => p.id === participantId)?.name;
    if (name && hasDefaultName) updateUserName(name);
    return name && hasDefaultName ? name : userName;
  };

  const joinGroup = async (rawCode: string, claimId?: string): Promise<JoinResult> => {
    if (!user) return 'error';
    const groupId = rawCode.trim().toUpperCase();
    if (!groupId) return 'not-found';
    if (!isFirebaseConfigured) return 'unavailable';
    if (groupsRef.current.some(g => g.id === groupId)) return 'joined';
    if (!navigator.onLine) return 'offline';

    try {
      const snap = await getDoc(groupDoc(groupId));
      if (!snap.exists()) return 'not-found';
      const group = { ...snap.data(), id: snap.id } as Group;
      if (group.members?.includes(user.uid)) return 'joined';
      const claimable = claimId && group.participants?.some(p => p.id === claimId) && !group.claims?.[claimId];
      const name = claimable ? adoptParticipantName(group, claimId) : userName;
      // Add member uid + store display name so others can show our name without Firestore reads.
      // FieldPath: participant ids are UUIDs, which aren't safe in a dotted string path.
      await updateDoc(groupDoc(groupId),
        'members', arrayUnion(user.uid),
        new FieldPath('memberNames', user.uid), name,
        ...(claimable ? [new FieldPath('claims', claimId), user.uid] : []),
      );
      return 'joined';
    } catch (err) {
      console.error('[Splitr] join failed', err);
      return navigator.onLine ? 'error' : 'offline';
    }
  };

  const addExpense = async (expenseData: Omit<Expense, 'id' | 'createdAt' | 'createdBy'>) => {
    if (!currentGroupId || !uid) return;
    const gid = currentGroupId;

    // Refuse to write an expense that would create or destroy money
    const problem = validateExpense(expenseData, getUsersInGroup().map(u => u.id));
    if (problem) throw new Error(problem);

    const newExpense: Expense = {
      ...expenseData,
      id: uuidv4(),
      createdBy: uid,
      createdAt: new Date().toISOString(),
    };

    // 1. Instant local update
    setExpenses(prev => {
      const updated = [newExpense, ...prev];
      lsSave(expensesLsKey(uid, gid), updated);
      return updated;
    });

    // 2. Background Firebase sync
    remote(() => setDoc(doc(expensesCol(gid), newExpense.id), newExpense), 'save the expense');
  };

  const recordSettlements = async (
    transactions: { from: string; to: string; amount: number }[],
  ) => {
    if (!currentGroupId || !uid) return;
    const gid = currentGroupId;

    const now = new Date().toISOString();
    const newRecords: SettlementRecord[] = transactions.map(t => ({
      id: uuidv4(),
      groupId: gid,
      from: t.from,
      to: t.to,
      amount: t.amount,
      recordedBy: uid,
      createdAt: now,
    }));

    // 1. Instant local update
    setSettlementRecords(prev => {
      const updated = [...newRecords, ...prev];
      lsSave(settlementsLsKey(uid, gid), updated);
      return updated;
    });

    // 2. Background Firebase sync (one atomic batch)
    remote(() => {
      const batch = writeBatch(db);
      newRecords.forEach(r => batch.set(doc(settlementsCol(gid), r.id), r));
      return batch.commit();
    }, 'record the settlement');
  };

  // Settlement records are deliberately kept: they are money that really
  // changed hands, so balances stay correct after an expense is removed.
  const deleteExpense = async (id: string) => {
    if (!isAdmin || !currentGroupId || !uid) return;
    const gid = currentGroupId;

    setExpenses(prev => {
      const updated = prev.filter(e => e.id !== id);
      lsSave(expensesLsKey(uid, gid), updated);
      return updated;
    });

    remote(() => deleteDoc(doc(expensesCol(gid), id)), 'delete the expense');
  };

  const promoteToAdmin = async (memberUid: string) => {
    if (!currentGroup || !isAdmin) return;
    const admins = [...new Set([...adminsOf(currentGroup), memberUid])];

    updateGroupLocally({ ...currentGroup, admins });
    // Write the full list: on legacy groups (no `admins` field) arrayUnion would
    // drop the creator's implicit admin role.
    remote(() => updateDoc(groupDoc(currentGroup.id), { admins }), 'update admins');
  };

  const demoteAdmin = async (memberUid: string) => {
    if (!currentGroup || !isAdmin) return;
    const current = adminsOf(currentGroup);
    if (current.length <= 1) return; // never remove the last admin
    const admins = current.filter(a => a !== memberUid);

    updateGroupLocally({ ...currentGroup, admins });
    remote(() => updateDoc(groupDoc(currentGroup.id), { admins }), 'update admins');
  };

  const claimParticipant = async (participantId: string) => {
    if (!currentGroup || !uid || !isMember) return;
    if (currentGroup.claims?.[participantId]) return;
    if (Object.values(currentGroup.claims ?? {}).includes(uid)) return; // one claim per member
    updateGroupLocally({ ...currentGroup, claims: { ...currentGroup.claims, [participantId]: uid } });
    adoptParticipantName(currentGroup, participantId);
    remote(() => updateDoc(groupDoc(currentGroup.id), new FieldPath('claims', participantId), uid), 'link your name');
  };

  const unlinkClaim = async (participantId: string) => {
    if (!currentGroup || !isAdmin) return;
    const claims = { ...currentGroup.claims };
    delete claims[participantId];
    updateGroupLocally({ ...currentGroup, claims });
    remote(() => updateDoc(groupDoc(currentGroup.id), new FieldPath('claims', participantId), deleteField()), 'unlink the name');
  };

  const leaveGroup = async (): Promise<boolean> => {
    if (!currentGroup || !uid) return false;
    const myBalance = calculateBalances(resolved.expenses, resolved.settlements)[uid]?.netBalance ?? 0;
    if (!isSettled(myBalance)) return false;

    const gid = currentGroup.id;
    const otherMembers = currentGroup.members.filter(m => m !== uid);
    const expensesCopy = [...expenses];
    const settlementsCopy = [...settlementRecords];

    // Admin succession: if I'm the last admin, auto-promote the first remaining member
    const currentAdmins = adminsOf(currentGroup);
    const remainingAdmins = currentAdmins.filter(a => a !== uid && otherMembers.includes(a));
    const newAdmins = remainingAdmins.length > 0 ? remainingAdmins : otherMembers.slice(0, 1);

    removeGroupLocally(gid);

    if (otherMembers.length === 0) {
      // Last member leaving — delete the whole group and its data
      remote(() => purgeGroup(gid, expensesCopy, settlementsCopy), 'delete the group');
    } else {
      // memberNames is kept so past expenses still show this member's name.
      // Only admins may touch `admins` (security rules), so others send members only.
      const change = currentAdmins.includes(uid)
        ? { members: otherMembers, admins: newAdmins }
        : { members: otherMembers };
      remote(() => updateDoc(groupDoc(gid), change), 'leave the group');
    }
    return true;
  };

  const deleteGroup = async () => {
    if (!currentGroup || !isAdmin) return;
    const gid = currentGroup.id;
    const expensesCopy = [...expenses];
    const settlementsCopy = [...settlementRecords];

    removeGroupLocally(gid);
    remote(() => purgeGroup(gid, expensesCopy, settlementsCopy), 'delete the group');
  };

  // Synchronous — reads names from the group's memberNames cache (no Firestore calls).
  const getUsersInGroup = useCallback((): { id: string; name: string }[] => {
    if (!currentGroup) return [];

    const memberUsers = currentGroup.members.map(m => ({
      id: m,
      name: m === uid
        ? userName
        : currentGroup.memberNames?.[m] ?? `Member ${m.substring(0, 4)}`,
    }));

    // A claimed placeholder is now that member, so it isn't listed twice
    const unclaimed = (currentGroup.participants ?? []).filter(p => !currentGroup.claims?.[p.id]);
    return [...memberUsers, ...unclaimed];
  }, [currentGroup, uid, userName]);

  const getMemberName = useCallback((rawId: string): string => {
    const id = resolveId(currentGroup?.claims, rawId);
    if (id === uid) return userName;
    return currentGroup?.memberNames?.[id]
      ?? currentGroup?.participants?.find(p => p.id === id)?.name
      ?? 'Former member';
  }, [currentGroup, uid, userName]);

  return (
    <GroupContext.Provider value={{
      groups, currentGroup, currentGroupStatus, setCurrentGroupId,
      expenses: resolved.expenses, settlementRecords: resolved.settlements,
      loading, isAdmin, isMember,
      createGroup, joinGroup, claimParticipant, unlinkClaim,
      addExpense, deleteExpense, recordSettlements,
      promoteToAdmin, demoteAdmin, deleteGroup, leaveGroup,
      getUsersInGroup, getMemberName,
    }}>
      {children}
    </GroupContext.Provider>
  );
};

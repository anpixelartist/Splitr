import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { db } from '../firebase/config';
import {
  collection, query, where, onSnapshot, doc, getDoc,
  setDoc, updateDoc, deleteDoc, arrayUnion, arrayRemove,
} from 'firebase/firestore';
import type { Group, Expense, SettlementRecord } from '../types';
import { useAuth } from './AuthContext';
import { v4 as uuidv4 } from 'uuid';

// ─── localStorage helpers ───────────────────────────────────────────────────
// Used as a full fallback when Firebase is unavailable (e.g. mock API keys).
// When Firebase is healthy these are just an optional cache.

const lsKey = (k: string) => `splitr_${k}`;

function lsGet<T>(key: string): T[] {
  try { return JSON.parse(localStorage.getItem(lsKey(key)) || '[]'); } catch { return []; }
}
function lsSave(key: string, data: unknown) {
  try { localStorage.setItem(lsKey(key), JSON.stringify(data)); } catch {}
}
function lsDel(key: string) {
  try { localStorage.removeItem(lsKey(key)); } catch {}
}

const groupsLsKey = (uid: string) => `groups_${uid}`;
const expensesLsKey = (groupId: string) => `expenses_${groupId}`;
const settlementsLsKey = (groupId: string) => `settlements_${groupId}`;

// ─── Admin helpers ───────────────────────────────────────────────────────────

const resolveIsAdmin = (group: Group | null, uid: string | undefined): boolean => {
  if (!group || !uid) return false;
  if (group.admins && group.admins.length > 0) return group.admins.includes(uid);
  return group.createdBy === uid; // backward compat: creator is admin on old groups
};

// ─── Context types ───────────────────────────────────────────────────────────

interface GroupContextType {
  groups: Group[];
  currentGroup: Group | null;
  setCurrentGroupId: (id: string | null) => void;
  expenses: Expense[];
  settlementRecords: SettlementRecord[];
  loading: boolean;
  isAdmin: boolean;
  createGroup: (name: string, participants?: { id: string; name: string }[]) => Promise<string>;
  joinGroup: (groupId: string) => Promise<boolean>;
  addExpense: (expense: Omit<Expense, 'id' | 'createdAt' | 'createdBy'>) => Promise<void>;
  deleteExpense: (id: string) => Promise<void>;
  recordSettlements: (transactions: { from: string; to: string; amount: number }[]) => Promise<void>;
  promoteToAdmin: (uid: string) => Promise<void>;
  demoteAdmin: (uid: string) => Promise<void>;
  deleteGroup: () => Promise<void>;
  leaveGroup: () => Promise<void>;
  getUsersInGroup: () => { id: string; name: string }[];
}

const GroupContext = createContext<GroupContextType>({
  groups: [], currentGroup: null, setCurrentGroupId: () => {},
  expenses: [], settlementRecords: [], loading: true, isAdmin: false,
  createGroup: async () => '',
  joinGroup: async () => false,
  addExpense: async () => {},
  deleteExpense: async () => {},
  recordSettlements: async () => {},
  promoteToAdmin: async () => {},
  demoteAdmin: async () => {},
  deleteGroup: async () => {},
  leaveGroup: async () => {},
  getUsersInGroup: () => [],
});

export const useGroup = () => useContext(GroupContext);

// ─── Provider ────────────────────────────────────────────────────────────────

export const GroupProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, userName } = useAuth();
  const [groups, setGroups] = useState<Group[]>([]);
  const [currentGroupId, setCurrentGroupId] = useState<string | null>(null);
  const [currentGroup, setCurrentGroup] = useState<Group | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [settlementRecords, setSettlementRecords] = useState<SettlementRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // Ref keeps up-to-date groups value accessible inside snapshot callbacks
  // without adding `groups` to effect deps (which would recreate subscriptions)
  const groupsRef = useRef<Group[]>([]);
  useEffect(() => { groupsRef.current = groups; }, [groups]);

  const isAdmin = resolveIsAdmin(currentGroup, user?.uid);

  // ── Listen for user's groups ──────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;

    // Seed from localStorage immediately so the UI isn't blank while Firestore loads
    const saved = lsGet<Group>(groupsLsKey(user.uid));
    if (saved.length > 0) {
      setGroups(saved);
      groupsRef.current = saved;
      setLoading(false);
    }

    const q = query(
      collection(db, 'groups'),
      where('members', 'array-contains', user.uid),
    );

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as Group[];
        if (data.length > 0) {
          // Firestore has real data — use it and refresh the localStorage cache
          setGroups(data);
          groupsRef.current = data;
          lsSave(groupsLsKey(user.uid), data);
        }
        // If Firestore returns empty (offline / mock keys) keep whatever was
        // loaded from localStorage above — don't wipe the list.
        setLoading(false);
      },
      () => {
        // Error (e.g. invalid API key) — already seeded from localStorage above
        setLoading(false);
      },
    );

    return unsub;
  }, [user]);

  // ── Listen for currentGroup doc + its expenses ────────────────────────────
  useEffect(() => {
    if (!currentGroupId) {
      setCurrentGroup(null);
      setExpenses([]);
      setSettlementRecords([]);
      return;
    }

    // Seed from local state so GroupDetails renders immediately
    const localGroup = groupsRef.current.find(g => g.id === currentGroupId) ?? null;
    if (localGroup) setCurrentGroup(localGroup);

    // Seed expenses and settlements from localStorage
    const savedExpenses = lsGet<Expense>(expensesLsKey(currentGroupId));
    if (savedExpenses.length > 0) setExpenses(savedExpenses);

    const savedSettlements = lsGet<SettlementRecord>(settlementsLsKey(currentGroupId));
    if (savedSettlements.length > 0) setSettlementRecords(savedSettlements);

    // Subscribe to the group document
    const groupUnsub = onSnapshot(
      doc(db, 'groups', currentGroupId),
      (docSnap) => {
        if (docSnap.exists()) {
          setCurrentGroup({ id: docSnap.id, ...docSnap.data() } as Group);
        }
      },
      () => { /* keep local seed */ },
    );

    // Subscribe to expenses
    const expQ = query(
      collection(db, 'expenses'),
      where('groupId', '==', currentGroupId),
    );

    const expUnsub = onSnapshot(
      expQ,
      (snapshot) => {
        const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as Expense[];
        data.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        if (data.length > 0) {
          setExpenses(data);
          lsSave(expensesLsKey(currentGroupId), data);
        }
      },
      () => { /* keep localStorage seed */ },
    );

    // Subscribe to settlement records
    const settQ = query(
      collection(db, 'settlements'),
      where('groupId', '==', currentGroupId),
    );

    const settUnsub = onSnapshot(
      settQ,
      (snapshot) => {
        const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as SettlementRecord[];
        data.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        if (data.length > 0) {
          setSettlementRecords(data);
          lsSave(settlementsLsKey(currentGroupId), data);
        }
      },
      () => { /* keep localStorage seed */ },
    );

    return () => {
      groupUnsub();
      expUnsub();
      settUnsub();
    };
  }, [currentGroupId]);

  // ── CRUD ──────────────────────────────────────────────────────────────────

  // ── Helpers ───────────────────────────────────────────────────────────────

  // Apply a group update to all local state and localStorage immediately,
  // then sync to Firebase in the background (fire-and-forget).
  const updateGroupLocally = (updated: Group) => {
    setCurrentGroup(updated);
    setGroups(prev => {
      const next = prev.map(g => g.id === updated.id ? updated : g);
      groupsRef.current = next;
      if (user) lsSave(groupsLsKey(user.uid), next);
      return next;
    });
  };

  // ── CRUD — all use optimistic updates ────────────────────────────────────
  //
  // Pattern for every write:
  //   1. Update local state + localStorage IMMEDIATELY (synchronous, instant UI)
  //   2. setDoc/updateDoc/deleteDoc fires in the background without await
  //
  // Why: Firestore offline persistence queues writes and retries forever —
  // `await setDoc(...)` never rejects, so awaiting it hangs indefinitely
  // when Firebase is unavailable (e.g. mock API keys, no network).

  const createGroup = async (
    name: string,
    participants: { id: string; name: string }[] = [],
  ): Promise<string> => {
    if (!user) throw new Error('Must be logged in');

    const groupId = Math.random().toString(36).substring(2, 8).toUpperCase();
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
    groupsRef.current = updated;
    lsSave(groupsLsKey(user.uid), updated);

    // 2. Background Firebase sync
    setDoc(doc(db, 'groups', groupId), newGroup).catch(() => {});

    return groupId;
  };

  const joinGroup = async (groupId: string): Promise<boolean> => {
    if (!user) return false;
    const groupRef = doc(db, 'groups', groupId);
    try {
      const groupDoc = await getDoc(groupRef);
      if (!groupDoc.exists()) return false;
      // Add member uid + store display name so others can show our name without Firestore reads
      await updateDoc(groupRef, {
        members: arrayUnion(user.uid),
        [`memberNames.${user.uid}`]: userName,
      });
      return true;
    } catch {
      return false;
    }
  };

  const addExpense = async (expenseData: Omit<Expense, 'id' | 'createdAt' | 'createdBy'>) => {
    if (!currentGroupId) return;

    const newExpense: Expense = {
      ...expenseData,
      id: uuidv4(),
      createdBy: user?.uid,
      createdAt: new Date().toISOString(),
    };

    // 1. Instant local update
    setExpenses(prev => {
      const updated = [newExpense, ...prev];
      lsSave(expensesLsKey(currentGroupId), updated);
      return updated;
    });

    // 2. Background Firebase sync
    setDoc(doc(db, 'expenses', newExpense.id), newExpense).catch(() => {});
  };

  const recordSettlements = async (
    transactions: { from: string; to: string; amount: number }[],
  ) => {
    if (!currentGroupId || !user) return;

    const now = new Date().toISOString();
    const newRecords: SettlementRecord[] = transactions.map(t => ({
      id: uuidv4(),
      groupId: currentGroupId,
      from: t.from,
      to: t.to,
      amount: t.amount,
      recordedBy: user.uid,
      createdAt: now,
    }));

    // 1. Instant local update
    setSettlementRecords(prev => {
      const updated = [...newRecords, ...prev];
      lsSave(settlementsLsKey(currentGroupId), updated);
      return updated;
    });

    // 2. Background Firebase sync
    newRecords.forEach(record => {
      setDoc(doc(db, 'settlements', record.id), record).catch(() => {});
    });
  };

  const deleteExpense = async (id: string) => {
    if (!isAdmin) return;
    // Capture settlements before clearing — they were based on the old expense
    // state; after deletion the balances change and they'd create phantom debts.
    const settlementsCopy = [...settlementRecords];

    // 1. Instant local update
    setExpenses(prev => {
      const updated = prev.filter(e => e.id !== id);
      if (currentGroupId) lsSave(expensesLsKey(currentGroupId), updated);
      return updated;
    });

    if (settlementsCopy.length > 0) {
      setSettlementRecords([]);
      if (currentGroupId) lsDel(settlementsLsKey(currentGroupId));
    }

    // 2. Background Firebase sync
    deleteDoc(doc(db, 'expenses', id)).catch(() => {});
    settlementsCopy.forEach(s => deleteDoc(doc(db, 'settlements', s.id)).catch(() => {}));
  };

  const promoteToAdmin = async (uid: string) => {
    if (!currentGroup || !isAdmin) return;
    const admins = [...new Set([...(currentGroup.admins || [currentGroup.createdBy || '']).filter(Boolean), uid])];

    // 1. Instant local update
    updateGroupLocally({ ...currentGroup, admins });

    // 2. Background Firebase sync
    updateDoc(doc(db, 'groups', currentGroup.id), { admins: arrayUnion(uid) }).catch(() => {});
  };

  const demoteAdmin = async (uid: string) => {
    if (!currentGroup || !isAdmin) return;
    const admins = currentGroup.admins || [];
    if (admins.length <= 1) return; // never remove the last admin

    // 1. Instant local update
    updateGroupLocally({ ...currentGroup, admins: admins.filter(a => a !== uid) });

    // 2. Background Firebase sync
    updateDoc(doc(db, 'groups', currentGroup.id), { admins: arrayRemove(uid) }).catch(() => {});
  };

  const leaveGroup = async () => {
    if (!currentGroup || !user) return;
    const gid = currentGroup.id;
    const myUid = user.uid;
    const otherFirebaseMembers = currentGroup.members.filter(m => m !== myUid);

    // Admin succession: if I'm the last admin, auto-promote the first remaining Firebase member
    const currentAdmins = currentGroup.admins?.length
      ? currentGroup.admins
      : currentGroup.createdBy ? [currentGroup.createdBy] : [];
    const isLastAdmin = currentAdmins.includes(myUid) && currentAdmins.every(a => a === myUid);
    const newAdmins = isLastAdmin && otherFirebaseMembers.length > 0
      ? [otherFirebaseMembers[0]]
      : currentAdmins.filter(a => a !== myUid);

    // 1. Instant local: remove from my groups list
    setGroups(prev => {
      const next = prev.filter(g => g.id !== gid);
      groupsRef.current = next;
      lsSave(groupsLsKey(myUid), next);
      return next;
    });
    setCurrentGroup(null);
    setExpenses([]);
    setSettlementRecords([]);

    // 2. Background Firebase
    if (otherFirebaseMembers.length === 0) {
      // Last Firebase member leaving — delete the whole group
      deleteDoc(doc(db, 'groups', gid)).catch(() => {});
    } else {
      updateDoc(doc(db, 'groups', gid), {
        members: arrayRemove(myUid),
        admins: newAdmins,
      }).catch(() => {});
    }
  };

  const deleteGroup = async () => {
    if (!currentGroup || !isAdmin) return;
    const gid = currentGroup.id;
    const expensesCopy = [...expenses];
    const settlementsCopy = [...settlementRecords];

    // 1. Instant local cleanup
    lsDel(expensesLsKey(gid));
    lsDel(settlementsLsKey(gid));
    setGroups(prev => {
      const next = prev.filter(g => g.id !== gid);
      groupsRef.current = next;
      if (user) lsSave(groupsLsKey(user.uid), next);
      return next;
    });
    setExpenses([]);
    setSettlementRecords([]);
    setCurrentGroup(null);

    // 2. Background Firebase cleanup
    expensesCopy.forEach(e => deleteDoc(doc(db, 'expenses', e.id)).catch(() => {}));
    settlementsCopy.forEach(s => deleteDoc(doc(db, 'settlements', s.id)).catch(() => {}));
    deleteDoc(doc(db, 'groups', gid)).catch(() => {});
  };

  // Synchronous — reads names from the group's memberNames cache (no Firestore calls).
  // Names are written into memberNames when creating or joining a group.
  const getUsersInGroup = React.useCallback((): { id: string; name: string }[] => {
    if (!currentGroup) return [];

    const memberUsers = currentGroup.members.map(uid => ({
      id: uid,
      name: uid === user?.uid
        ? userName
        : currentGroup.memberNames?.[uid] ?? `Member ${uid.substring(0, 4)}`,
    }));

    return [...memberUsers, ...(currentGroup.participants ?? [])];
  }, [currentGroup, user, userName]);

  return (
    <GroupContext.Provider value={{
      groups, currentGroup, setCurrentGroupId,
      expenses, settlementRecords, loading, isAdmin,
      createGroup, joinGroup,
      addExpense, deleteExpense, recordSettlements,
      promoteToAdmin, demoteAdmin, deleteGroup, leaveGroup,
      getUsersInGroup,
    }}>
      {children}
    </GroupContext.Provider>
  );
};

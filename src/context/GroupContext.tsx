import React, { createContext, useContext, useEffect, useState } from 'react';
import { db } from '../firebase/config';
import { collection, query, where, onSnapshot, doc, getDoc, setDoc, updateDoc, arrayUnion } from 'firebase/firestore';
import type { Group, Expense } from '../types';
import { useAuth } from './AuthContext';
import { v4 as uuidv4 } from 'uuid';

interface GroupContextType {
  groups: Group[];
  currentGroup: Group | null;
  setCurrentGroupId: (id: string | null) => void;
  expenses: Expense[];
  loading: boolean;
  createGroup: (name: string) => Promise<string>;
  joinGroup: (groupId: string) => Promise<boolean>;
  addExpense: (expense: Omit<Expense, 'id' | 'createdAt'>) => Promise<void>;
  getUsersInGroup: () => Promise<{id: string, name: string}[]>;
}

const GroupContext = createContext<GroupContextType>({
  groups: [],
  currentGroup: null,
  setCurrentGroupId: () => {},
  expenses: [],
  loading: true,
  createGroup: async () => '',
  joinGroup: async () => false,
  addExpense: async () => {},
  getUsersInGroup: async () => []
});

export const useGroup = () => useContext(GroupContext);

export const GroupProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [groups, setGroups] = useState<Group[]>([]);
  const [currentGroupId, setCurrentGroupId] = useState<string | null>(null);
  const [currentGroup, setCurrentGroup] = useState<Group | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);

  // Listen for user's groups
  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, 'groups'),
      where('members', 'array-contains', user.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const groupsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Group[];
      setGroups(groupsData);
      setLoading(false);
    });

    return unsubscribe;
  }, [user]);

  // Listen for current group and its expenses
  useEffect(() => {
    if (!currentGroupId) {
      setCurrentGroup(null);
      setExpenses([]);
      return;
    }

    // Subscribe to group details
    const groupUnsubscribe = onSnapshot(doc(db, 'groups', currentGroupId), (doc) => {
      if (doc.exists()) {
        setCurrentGroup({ id: doc.id, ...doc.data() } as Group);
      }
    });

    // Subscribe to group expenses
    const q = query(
      collection(db, 'expenses'),
      where('groupId', '==', currentGroupId)
    );
    const expensesUnsubscribe = onSnapshot(q, (snapshot) => {
      const expensesData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Expense[];

      // Sort client-side to avoid needing a complex index immediately
      expensesData.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setExpenses(expensesData);
    });

    return () => {
      groupUnsubscribe();
      expensesUnsubscribe();
    };
  }, [currentGroupId]);

  const createGroup = async (name: string): Promise<string> => {
    if (!user) throw new Error("Must be logged in to create a group");

    // Using a short, user-friendly ID for easy sharing
    const groupId = Math.random().toString(36).substring(2, 8).toUpperCase();

    const newGroup: Group = {
      id: groupId,
      name,
      members: [user.uid],
      createdAt: new Date().toISOString()
    };

    try {
      await setDoc(doc(db, 'groups', groupId), newGroup);
    } catch (error) {
      console.warn("Firebase failed, storing in local state fallback", error);
      // For local testing fallback
      setGroups(prev => [...prev, newGroup]);
    }
    return groupId;
  };

  const joinGroup = async (groupId: string): Promise<boolean> => {
    if (!user) return false;

    const groupRef = doc(db, 'groups', groupId);
    const groupDoc = await getDoc(groupRef);

    if (groupDoc.exists()) {
      await updateDoc(groupRef, {
        members: arrayUnion(user.uid)
      });
      return true;
    }
    return false;
  };

  const addExpense = async (expenseData: Omit<Expense, 'id' | 'createdAt'>) => {
    if (!currentGroupId) return;

    const newExpense: Expense = {
      ...expenseData,
      id: uuidv4(),
      createdAt: new Date().toISOString()
    };

    try {
      await setDoc(doc(db, 'expenses', newExpense.id), newExpense);
    } catch (error) {
      console.warn("Firebase failed, storing in local state fallback", error);
      setExpenses(prev => [newExpense, ...prev]);
    }
  };

  const getUsersInGroup = React.useCallback(async () => {
    if (!currentGroup) return [];

    const users = await Promise.all(
      currentGroup.members.map(async (uid) => {
        try {
          const userDoc = await getDoc(doc(db, 'users', uid));
          return {
            id: uid,
            name: userDoc.exists() ? userDoc.data().name : `User ${uid.substring(0, 4)}`
          };
        } catch {
           return { id: uid, name: uid === user?.uid ? 'Me' : `User ${uid.substring(0, 4)}` };
        }
      })
    );

    return users;
  }, [currentGroup, user]);

  return (
    <GroupContext.Provider value={{
      groups,
      currentGroup,
      setCurrentGroupId,
      expenses,
      loading,
      createGroup,
      joinGroup,
      addExpense,
      getUsersInGroup
    }}>
      {children}
    </GroupContext.Provider>
  );
};

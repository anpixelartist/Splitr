import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  onAuthStateChanged, signInAnonymously,
  signInWithPopup, GoogleAuthProvider,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';
import { auth, db } from '../firebase/config';
import { doc, setDoc, getDoc, updateDoc } from 'firebase/firestore';
import { v4 as uuidv4 } from 'uuid';
import type { Contact } from '../types';

// ─── Persistence key ──────────────────────────────────────────────────────────
// 'google' | 'offline' | null (first time)
const AUTH_PREF_KEY = 'splitr_auth_choice';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isGoogleUser: boolean;
  updateUserName: (name: string) => Promise<void>;
  userName: string;
  contacts: Contact[];
  addContact: (name: string) => Promise<Contact>;
  updateContact: (id: string, name: string) => Promise<void>;
  removeContact: (id: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  continueOffline: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null, loading: true, isGoogleUser: false,
  updateUserName: async () => {},
  userName: '', contacts: [],
  addContact: async () => ({ id: '', name: '' }),
  updateContact: async () => {},
  removeContact: async () => {},
  signInWithGoogle: async () => {},
  signOut: async () => {},
  continueOffline: async () => {},
});

export const useAuth = () => useContext(AuthContext);

// ─── localStorage helpers ─────────────────────────────────────────────────────
const lsContactsKey = (uid: string) => `splitr_contacts_${uid}`;

const lsGetContacts = (uid: string): Contact[] => {
  try { return JSON.parse(localStorage.getItem(lsContactsKey(uid)) || '[]'); } catch { return []; }
};

const lsSaveContacts = (uid: string, contacts: Contact[]) => {
  try { localStorage.setItem(lsContactsKey(uid), JSON.stringify(contacts)); } catch {}
};

const hasExistingLocalData = () =>
  Object.keys(localStorage).some(k => k.startsWith('splitr_') && k !== AUTH_PREF_KEY);

// ─── Provider ─────────────────────────────────────────────────────────────────
export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [userName, setUserName] = useState('');
  const [contacts, setContacts] = useState<Contact[]>([]);

  const isGoogleUser = !!(user && !user.isAnonymous && user.providerData?.length > 0);

  // ── Load user profile from Firestore (or localStorage fallback) ────────────
  const loadProfile = async (u: User) => {
    try {
      const snap = await getDoc(doc(db, 'users', u.uid));
      if (snap.exists()) {
        setUserName(snap.data().name || u.displayName || 'You');
        setContacts(snap.data().contacts || lsGetContacts(u.uid));
      } else {
        const defaultName = u.displayName || `User ${u.uid.substring(0, 4)}`;
        await setDoc(doc(db, 'users', u.uid), { name: defaultName, contacts: [] });
        setUserName(defaultName);
        setContacts(lsGetContacts(u.uid));
      }
    } catch {
      setUserName(u.displayName || 'You');
      setContacts(lsGetContacts(u.uid));
    }
  };

  const useMockUser = () => {
    const mockUser = { uid: 'mock-user-123', isAnonymous: true, providerData: [] } as unknown as User;
    setUser(mockUser);
    setUserName(localStorage.getItem('splitr_display_name') || 'You');
    setContacts(lsGetContacts('mock-user-123'));
    setLoading(false);
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser);
        if (!firebaseUser.isAnonymous) {
          localStorage.setItem(AUTH_PREF_KEY, 'google');
        } else if (!localStorage.getItem(AUTH_PREF_KEY)) {
          localStorage.setItem(AUTH_PREF_KEY, 'offline');
        }
        await loadProfile(firebaseUser);
        setLoading(false);
      } else {
        // No Firebase user — decide what to do
        const pref = localStorage.getItem(AUTH_PREF_KEY);
        const hasData = hasExistingLocalData();

        if (!pref && !hasData) {
          // Genuinely first time — show the login page
          setLoading(false);
          return;
        }

        // Returning user or has existing data — auto sign-in offline/anonymous
        try {
          await signInAnonymously(auth);
          // onAuthStateChanged will re-fire with the anonymous user
        } catch {
          // Mock keys — use stable mock identity
          if (!pref) localStorage.setItem(AUTH_PREF_KEY, 'offline');
          useMockUser();
        }
      }
    });
    return unsubscribe;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auth actions ──────────────────────────────────────────────────────────

  const signInWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    // signInWithPopup throws if Firebase isn't configured — let the caller handle it
    await signInWithPopup(auth, provider);
    // onAuthStateChanged fires → sets user automatically
  };

  const signOut = async () => {
    try { await firebaseSignOut(auth); } catch {}
    localStorage.removeItem(AUTH_PREF_KEY);
    setUser(null);
    setUserName('');
    setContacts([]);
    // loading stays false — App will show LoginPage (user is null)
  };

  const continueOffline = async () => {
    localStorage.setItem(AUTH_PREF_KEY, 'offline');
    try {
      await signInAnonymously(auth);
      // onAuthStateChanged fires → sets user
    } catch {
      useMockUser();
    }
  };

  // ── Profile CRUD ──────────────────────────────────────────────────────────

  const updateUserName = async (name: string) => {
    const trimmed = name.trim();
    if (!user || !trimmed) return;
    setUserName(trimmed);
    if (user.uid === 'mock-user-123') {
      localStorage.setItem('splitr_display_name', trimmed);
      return;
    }
    try {
      await setDoc(doc(db, 'users', user.uid), { name: trimmed }, { merge: true });
    } catch {}
  };

  const addContact = async (name: string): Promise<Contact> => {
    const contact: Contact = { id: uuidv4(), name: name.trim() };
    const updated = [...contacts, contact];
    setContacts(updated);
    if (user) {
      lsSaveContacts(user.uid, updated);
      try { await updateDoc(doc(db, 'users', user.uid), { contacts: updated }); } catch {}
    }
    return contact;
  };

  const updateContact = async (id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const updated = contacts.map(c => c.id === id ? { ...c, name: trimmed } : c);
    setContacts(updated);
    if (user) {
      lsSaveContacts(user.uid, updated);
      try { await updateDoc(doc(db, 'users', user.uid), { contacts: updated }); } catch {}
    }
  };

  const removeContact = async (id: string) => {
    const updated = contacts.filter(c => c.id !== id);
    setContacts(updated);
    if (user) {
      lsSaveContacts(user.uid, updated);
      try { await updateDoc(doc(db, 'users', user.uid), { contacts: updated }); } catch {}
    }
  };

  return (
    <AuthContext.Provider value={{
      user, loading, isGoogleUser,
      updateUserName, userName,
      contacts, addContact, updateContact, removeContact,
      signInWithGoogle, signOut, continueOffline,
    }}>
      {!loading && children}
    </AuthContext.Provider>
  );
};

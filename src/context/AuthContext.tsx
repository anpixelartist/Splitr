import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  onAuthStateChanged, signInAnonymously,
  signInWithPopup, signInWithRedirect, signInWithCredential,
  linkWithPopup, linkWithRedirect, getRedirectResult,
  GoogleAuthProvider,
  signOut as firebaseSignOut,
  type User, type AuthError,
} from 'firebase/auth';
import { auth, db, isFirebaseConfigured } from '../firebase/config';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { v4 as uuidv4 } from 'uuid';
import type { Contact } from '../types';

// ─── Persistence key ──────────────────────────────────────────────────────────
// 'google' | 'offline' | 'signed-out' | null (first time)
const AUTH_PREF_KEY = 'splitr_auth_choice';
// Set while the page is away at Google for a redirect sign-in, so we can tell
// "came back without a result" (a silent failure) from a normal page load.
const PENDING_REDIRECT_KEY = 'splitr_pending_google';
const MOCK_UID = 'mock-user-123';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isGoogleUser: boolean;
  /** Google profile picture, or null for guests */
  photoURL: string | null;
  /** true when running without Firebase: data never leaves this browser */
  isLocalOnly: boolean;
  updateUserName: (name: string) => Promise<void>;
  userName: string;
  /** Still an auto-generated name like "User a1b2": ask the person for theirs. */
  hasDefaultName: boolean;
  contacts: Contact[];
  addContact: (name: string) => Promise<Contact>;
  updateContact: (id: string, name: string) => Promise<void>;
  removeContact: (id: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  continueOffline: () => Promise<void>;
  authError: string | null;
  clearAuthError: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null, loading: true, isGoogleUser: false, photoURL: null, isLocalOnly: !isFirebaseConfigured,
  updateUserName: async () => {},
  userName: '', hasDefaultName: false, contacts: [],
  addContact: async () => ({ id: '', name: '' }),
  updateContact: async () => {},
  removeContact: async () => {},
  signInWithGoogle: async () => {},
  signOut: async () => {},
  continueOffline: async () => {},
  authError: null,
  clearAuthError: () => {},
});

// eslint-disable-next-line react/only-export-components
export const useAuth = () => useContext(AuthContext);

// ─── localStorage helpers ─────────────────────────────────────────────────────
const lsContactsKey = (uid: string) => `splitr_contacts_${uid}`;

const lsGetContacts = (uid: string): Contact[] => {
  try { return JSON.parse(localStorage.getItem(lsContactsKey(uid)) || '[]'); } catch { return []; }
};

const lsSaveContacts = (uid: string, contacts: Contact[]) => {
  try { localStorage.setItem(lsContactsKey(uid), JSON.stringify(contacts)); } catch { /* storage full / blocked */ }
};

const lsGetPref = () => { try { return localStorage.getItem(AUTH_PREF_KEY); } catch { return null; } };
const lsSetPref = (v: string) => { try { localStorage.setItem(AUTH_PREF_KEY, v); } catch { /* ignore */ } };

const hasExistingLocalData = () => {
  try {
    return Object.keys(localStorage).some(k =>
      k.startsWith('splitr_') && k !== AUTH_PREF_KEY && k !== PENDING_REDIRECT_KEY && k !== 'splitr_theme');
  } catch { return false; }
};

const isDefaultName = (name: string) => !name || name === 'You' || /^User [\w-]{4}$/.test(name);

// Popups are blocked in some mobile browsers / installed PWAs — fall back to a
// full-page redirect there. The result is picked up by getRedirectResult on load.
const shouldFallBackToRedirect = (err: unknown) => {
  const code = (err as AuthError)?.code;
  return code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment';
};

const setPendingRedirect = (on: boolean) => {
  try {
    if (on) localStorage.setItem(PENDING_REDIRECT_KEY, '1'); else localStorage.removeItem(PENDING_REDIRECT_KEY);
  } catch { /* ignore */ }
};
const hadPendingRedirect = () => { try { return localStorage.getItem(PENDING_REDIRECT_KEY) === '1'; } catch { return false; } };

/** A message people can act on, with the Firebase code for whoever debugs it. */
export const describeAuthError = (err: unknown): string => {
  const code = (err as AuthError)?.code ?? '';
  switch (code) {
    case 'auth/network-request-failed':
      return 'No internet connection. Connect and try again.';
    case 'auth/unauthorized-domain':
      return `Google sign-in isn't enabled for ${window.location.hostname} yet (auth/unauthorized-domain).`;
    case 'auth/popup-blocked':
      return 'Your browser blocked the Google sign-in window. Allow pop-ups for this site and try again.';
    case 'auth/web-storage-unsupported':
      return 'This browser is blocking the storage Google sign-in needs. Try again in Chrome or Safari, outside private mode.';
    default:
      return `Google sign-in didn't finish${code ? ` (${code})` : ''}. Please try again.`;
  }
};

// ─── Provider ─────────────────────────────────────────────────────────────────
export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [userName, setUserName] = useState('');
  const userNameRef = useRef('');
  useEffect(() => { userNameRef.current = userName; }, [userName]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [authError, setAuthError] = useState<string | null>(null);
  // Linking mutates the same User object in place, so bump this to re-render.
  const [, setAuthTick] = useState(0);

  const isGoogleUser = !!(user && !user.isAnonymous && user.providerData?.length > 0);
  // Like the name, a linked anonymous account only has the photo on the provider entry.
  const photoURL = isGoogleUser
    ? user!.photoURL || user!.providerData.find(p => p.providerId === GoogleAuthProvider.PROVIDER_ID)?.photoURL || null
    : null;

  // ── Load user profile from Firestore (or localStorage fallback) ────────────
  const loadProfile = async (u: User) => {
    try {
      const snap = await getDoc(doc(db, 'users', u.uid));
      if (snap.exists()) {
        setUserName(snap.data().name || u.displayName || 'You');
        setContacts(snap.data().contacts || lsGetContacts(u.uid));
      } else {
        const defaultName = u.displayName || `User ${u.uid.substring(0, 4)}`;
        // Don't await: offline writes only resolve once the server acknowledges them
        setDoc(doc(db, 'users', u.uid), { name: defaultName, contacts: lsGetContacts(u.uid) }, { merge: true })
          .catch(() => {});
        setUserName(defaultName);
        setContacts(lsGetContacts(u.uid));
      }
    } catch {
      setUserName(u.displayName || 'You');
      setContacts(lsGetContacts(u.uid));
    }
  };

  const startMockSession = () => {
    const mockUser = { uid: MOCK_UID, isAnonymous: true, providerData: [] } as unknown as User;
    setUser(mockUser);
    setUserName(localStorage.getItem('splitr_display_name') || 'You');
    setContacts(lsGetContacts(MOCK_UID));
    setLoading(false);
  };

  // After a Google account is linked to the anonymous one, adopt the Google name
  // unless the user already picked their own.
  const adoptGoogleProfile = (u: User) => {
    lsSetPref('google');
    setAuthTick(t => t + 1);
    setUser(u);
    // A linked anonymous account has no top-level displayName; the Google
    // name lives on the provider entry.
    const googleName = u.displayName
      || u.providerData.find(p => p.providerId === GoogleAuthProvider.PROVIDER_ID)?.displayName;
    if (googleName && isDefaultName(userNameRef.current)) {
      setUserName(googleName);
      setDoc(doc(db, 'users', u.uid), { name: googleName }, { merge: true }).catch(() => {});
    }
  };

  const handleLinkConflict = async (err: unknown) => {
    const credential = GoogleAuthProvider.credentialFromError(err as AuthError);
    if (!credential) throw err;
    const ok = window.confirm(
      'This Google account is already used with Splitr, so your guest data can\'t be moved into it.\n\n' +
      'If you switch, the groups, expenses and contacts you made as a guest on this device will no longer be ' +
      'reachable from here. Groups shared with friends still exist, and you can rejoin them with their codes.\n\n' +
      'Switch to the Google account anyway?',
    );
    if (!ok) return;
    await signInWithCredential(auth, credential);
  };

  useEffect(() => {
    if (!isFirebaseConfigured) {
      // Local-only mode: never touch the network.
      if (lsGetPref() === 'offline' || hasExistingLocalData()) startMockSession();
      else setLoading(false);
      return;
    }

    // Finish a redirect-based sign-in / link (mobile popup fallback)
    const expectingResult = hadPendingRedirect();
    setPendingRedirect(false);
    getRedirectResult(auth)
      .then(result => {
        if (result?.user) { adoptGoogleProfile(result.user); return; }
        // We sent the user to Google but nothing came back, and they're still
        // a guest: say so instead of silently showing the same screen again.
        if (expectingResult && (!auth.currentUser || auth.currentUser.isAnonymous)) {
          setAuthError(describeAuthError(null) + ' Your data on this device is unchanged.');
        }
      })
      .catch(err => {
        console.error('[Splitr] Google redirect sign-in failed', err);
        if ((err as AuthError)?.code === 'auth/credential-already-in-use') {
          handleLinkConflict(err).catch(e => setAuthError(describeAuthError(e)));
        } else if (err) {
          setAuthError(describeAuthError(err));
        }
      });

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser);
        if (!firebaseUser.isAnonymous) lsSetPref('google');
        else if (lsGetPref() !== 'google') lsSetPref('offline');
        await loadProfile(firebaseUser);
        setLoading(false);
        return;
      }

      // No Firebase user — decide what to do
      setUser(null);
      setUserName('');
      setContacts([]);
      const pref = lsGetPref();

      // First visit, or the user explicitly signed out → show the login page.
      // (Legacy installs without a pref but with data resume offline.)
      if (pref === 'signed-out' || pref === 'google' || (!pref && !hasExistingLocalData())) {
        setLoading(false);
        return;
      }

      try {
        await signInAnonymously(auth);
        // onAuthStateChanged will re-fire with the anonymous user
      } catch {
        setAuthError('Could not start a session. Check your internet connection — it is needed the first time.');
        setLoading(false);
      }
    });
    return unsubscribe;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auth actions ──────────────────────────────────────────────────────────

  const signInWithGoogle = async () => {
    if (!isFirebaseConfigured) throw new Error('Firebase is not configured');
    setAuthError(null);
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const current = auth.currentUser;

    try {
      if (current?.isAnonymous) {
        // Upgrade the anonymous account in place: same UID, so every group,
        // expense and contact created offline stays with the user.
        try {
          const result = await linkWithPopup(current, provider);
          adoptGoogleProfile(result.user);
        } catch (err) {
          if ((err as AuthError)?.code === 'auth/credential-already-in-use') {
            await handleLinkConflict(err);
          } else if (shouldFallBackToRedirect(err)) {
            setPendingRedirect(true);
            await linkWithRedirect(current, provider);
          } else {
            throw err;
          }
        }
      } else {
        try {
          await signInWithPopup(auth, provider);
        } catch (err) {
          if (shouldFallBackToRedirect(err)) {
            setPendingRedirect(true);
            await signInWithRedirect(auth, provider);
          } else throw err;
        }
      }
    } catch (err) {
      // The user closing the popup isn't an error worth showing
      if ((err as AuthError)?.code === 'auth/popup-closed-by-user'
        || (err as AuthError)?.code === 'auth/cancelled-popup-request') return;
      setPendingRedirect(false);
      console.error('[Splitr] Google sign-in failed', err);
      throw new Error(describeAuthError(err));
    }
  };

  const signOut = async () => {
    lsSetPref('signed-out');
    if (user?.uid === MOCK_UID) {
      setUser(null);
      setUserName('');
      setContacts([]);
      return;
    }
    try { await firebaseSignOut(auth); } catch { /* already signed out */ }
    // onAuthStateChanged(null) clears state and shows the login page
  };

  const continueOffline = async () => {
    lsSetPref('offline');
    setAuthError(null);
    if (!isFirebaseConfigured) { startMockSession(); return; }
    try {
      await signInAnonymously(auth);
      // onAuthStateChanged fires → sets user
    } catch {
      setAuthError('Could not start a session. Check your internet connection — it is needed the first time.');
    }
  };

  // ── Profile CRUD ──────────────────────────────────────────────────────────

  const updateUserName = async (name: string) => {
    const trimmed = name.trim();
    if (!user || !trimmed) return;
    setUserName(trimmed);
    if (user.uid === MOCK_UID) {
      localStorage.setItem('splitr_display_name', trimmed);
      return;
    }
    setDoc(doc(db, 'users', user.uid), { name: trimmed }, { merge: true }).catch(() => {});
  };

  const saveContacts = (updated: Contact[]) => {
    setContacts(updated);
    if (!user) return;
    lsSaveContacts(user.uid, updated);
    if (user.uid !== MOCK_UID) {
      setDoc(doc(db, 'users', user.uid), { contacts: updated }, { merge: true }).catch(() => {});
    }
  };

  const addContact = async (name: string): Promise<Contact> => {
    const contact: Contact = { id: uuidv4(), name: name.trim() };
    saveContacts([...contacts, contact]);
    return contact;
  };

  const updateContact = async (id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    saveContacts(contacts.map(c => c.id === id ? { ...c, name: trimmed } : c));
  };

  const removeContact = async (id: string) => {
    saveContacts(contacts.filter(c => c.id !== id));
  };

  return (
    <AuthContext.Provider value={{
      user, loading, isGoogleUser, photoURL, isLocalOnly: !isFirebaseConfigured,
      updateUserName, userName, hasDefaultName: !!user && isDefaultName(userName),
      contacts, addContact, updateContact, removeContact,
      signInWithGoogle, signOut, continueOffline, authError,
      clearAuthError: () => setAuthError(null),
    }}>
      {!loading && children}
    </AuthContext.Provider>
  );
};

import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signInAnonymously, type User } from 'firebase/auth';
import { auth, db } from '../firebase/config';
import { doc, setDoc, getDoc } from 'firebase/firestore';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  updateUserName: (name: string) => Promise<void>;
  userName: string;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  updateUserName: async () => {},
  userName: ''
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [userName, setUserName] = useState('');

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        // Fetch or create user document
        const userDocRef = doc(db, 'users', currentUser.uid);
        const userDoc = await getDoc(userDocRef);

        if (userDoc.exists()) {
          setUserName(userDoc.data().name || 'Anonymous User');
        } else {
          // Default name
          const defaultName = `User ${currentUser.uid.substring(0, 4)}`;
          await setDoc(userDocRef, { name: defaultName });
          setUserName(defaultName);
        }
      } else {
        // Automatically sign in anonymously for friction-less onboarding
        try {
          await signInAnonymously(auth);
        } catch (error) {
          console.error("Error signing in anonymously:", error);
          // If mock firebase fails, create a fake user so the app still renders for testing
          setUser({ uid: 'mock-user-123', isAnonymous: true } as User);
          setUserName('Mock User');
        }
      }
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const updateUserName = async (name: string) => {
    if (!user) return;
    try {
      const userDocRef = doc(db, 'users', user.uid);
      await setDoc(userDocRef, { name }, { merge: true });
      setUserName(name);
    } catch (error) {
      console.error("Error updating user name:", error);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, updateUserName, userName }}>
      {!loading && children}
    </AuthContext.Provider>
  );
};

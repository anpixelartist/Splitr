import { initializeApp } from 'firebase/app';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  memoryLocalCache,
  connectFirestoreEmulator,
} from 'firebase/firestore';
import { getAuth, connectAuthEmulator } from 'firebase/auth';

// `VITE_USE_EMULATORS=true npm run dev` talks to `firebase emulators:start`
// instead of the real project (handy for testing without touching real data).
const useEmulators = import.meta.env.VITE_USE_EMULATORS === 'true';

// When the VITE_FIREBASE_* env vars are missing the app runs in "local-only"
// mode: a mock identity and localStorage only, with no network calls at all.
export const isFirebaseConfigured = useEmulators || Boolean(
  import.meta.env.VITE_FIREBASE_API_KEY && import.meta.env.VITE_FIREBASE_PROJECT_ID,
);

if (!isFirebaseConfigured) {
  console.warn(
    '[Splitr] Firebase is not configured (VITE_FIREBASE_* env vars missing). ' +
    'Running in local-only mode: data stays in this browser and cannot be shared. See DEPLOYMENT.md.',
  );
}

// Google sign-in must run on the same site the app was opened on. Browsers
// now block the storage a cross-site sign-in helper needs, so a redirect from
// my-app.web.app through my-app.firebaseapp.com comes back empty (the user
// picks an account and nothing happens). Firebase Hosting serves the helper
// at /__/auth/handler on every hosting domain, so use the current one there.
const onFirebaseHosting = /\.(web\.app|firebaseapp\.com)$/.test(window.location.hostname);

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'mock-key',
  authDomain: onFirebaseHosting
    ? window.location.hostname
    : import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'mock.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || (useEmulators ? 'demo-splitr' : 'mock-project'),
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'mock.appspot.com',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '123456789',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:123456789:web:abcdef',
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// Offline persistence shared across all open tabs (IndexedDB). Falls back to an
// in-memory cache in browsers without IndexedDB support.
const db = initializeFirestore(app, {
  localCache: typeof indexedDB !== 'undefined'
    ? persistentLocalCache({ tabManager: persistentMultipleTabManager() })
    : memoryLocalCache(),
});

if (useEmulators) {
  // Same host the page came from, so a phone on the LAN (`npm run dev -- --host`)
  // reaches the emulators on the dev machine too.
  const host = window.location.hostname || '127.0.0.1';
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(db, host, 8080);
}

export { app, auth, db };

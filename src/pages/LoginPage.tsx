import React, { useState } from 'react';
import { Wallet, ArrowRight, UserPlus } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export const LoginPage: React.FC = () => {
  const { signInWithGoogle, continueOffline, authError, isLocalOnly } = useAuth();
  const [googleLoading, setGoogleLoading] = useState(false);
  const [offlineLoading, setOfflineLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGoogle = async () => {
    setError(null);
    setGoogleLoading(true);
    try {
      await signInWithGoogle();
      // onAuthStateChanged will update the user → App re-renders to Home
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign-in failed. Please try again.');
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleOffline = async () => {
    setError(null);
    setOfflineLoading(true);
    await continueOffline();
    // App re-renders once the user is set; on failure authError is shown
    setOfflineLoading(false);
  };

  const shownError = error ?? authError;

  // Opened from an invite link (/group/CODE): say so before asking to sign in
  const inviteCode = useLocation().pathname.match(/^\/group\/([A-Za-z0-9]{4,12})$/)?.[1]?.toUpperCase();

  return (
    <div className="relative min-h-screen overflow-hidden flex items-center justify-center p-6">
      {/* Backdrop: two blurred colour glows over a faint dot grid. Pure CSS and
          static, so it paints with the page and never animates or reflows. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 opacity-60 [background-image:radial-gradient(rgb(var(--gray-300))_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" />
        <div className="absolute -top-32 left-1/2 -translate-x-[70%] w-[28rem] h-[28rem] rounded-full bg-blue-500/20 blur-3xl" />
        <div className="absolute -bottom-40 left-1/2 -translate-x-[10%] w-[26rem] h-[26rem] rounded-full bg-[#BF5AF2]/15 blur-3xl" />
      </div>

      <div className="relative w-full max-w-sm">

        {/* Logo */}
        <div className="anim-fade-in-up flex flex-col items-center mb-10">
          <div className="w-20 h-20 rounded-[1.4rem] bg-gradient-to-b from-[#2E8BFF] to-blue-600 flex items-center justify-center shadow-xl shadow-blue-600/30 mb-5">
            <Wallet className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-[2.5rem] font-bold text-gray-900 tracking-tight">Splitr</h1>
          <p className="text-gray-500 mt-1 text-center text-[1.0625rem]">Split group expenses fairly,<br />settle up instantly.</p>
        </div>

        {inviteCode && (
          <div className="anim-fade-in -mt-4 mb-6 bg-surface border border-green-200 rounded-2xl p-4 flex items-start gap-3 shadow-sm">
            <UserPlus className="w-5 h-5 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-gray-900">You've been invited to a group</p>
              <p className="text-sm text-gray-500 mt-0.5">
                Sign in or try without signing in, and you'll join group <span className="font-mono font-semibold text-gray-700">{inviteCode}</span> next.
              </p>
            </div>
          </div>
        )}

        {/* Card */}
        <div className="bg-surface/80 backdrop-blur-xl rounded-3xl shadow-[0_1px_2px_rgb(0_0_0/0.04),0_24px_48px_-24px_rgb(0_0_0/0.25)] p-6 space-y-4">

          {/* Error */}
          {shownError && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800 dark:text-amber-300">
              {shownError}
            </div>
          )}

          {/* Google sign-in (needs Firebase) */}
          {!isLocalOnly && <>
          <button
            onClick={handleGoogle}
            disabled={googleLoading || offlineLoading}
            className="w-full flex items-center justify-center gap-3 bg-surface border-2 border-gray-200 hover:border-gray-300 hover:bg-gray-50 text-gray-900 font-semibold py-3.5 rounded-full transition-all active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {googleLoading ? (
              <span className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
            ) : (
              /* Google G logo SVG */
              <svg viewBox="0 0 48 48" className="w-5 h-5" aria-hidden="true">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
              </svg>
            )}
            {googleLoading ? 'Signing in…' : 'Sign in with Google'}
          </button>

          <div className="relative flex items-center gap-3">
            <div className="flex-1 h-px bg-gray-200" />
            <span className="text-xs text-gray-400 shrink-0">or</span>
            <div className="flex-1 h-px bg-gray-200" />
          </div>
          </>}

          {/* Offline / anonymous */}
          <button
            onClick={handleOffline}
            disabled={googleLoading || offlineLoading}
            className="w-full flex items-center justify-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-3.5 rounded-full transition-all active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {offlineLoading ? (
              <span className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
            ) : (
              <ArrowRight className="w-4 h-4" />
            )}
            {offlineLoading ? 'Starting…' : 'Try without signing in'}
          </button>
        </div>

        {/* Footer note */}
        <p className="text-center text-xs text-gray-400 mt-6">
          {isLocalOnly ? (
            <>Running in local-only mode: data stays in this browser.</>
          ) : (
            <>Without signing in, your profile stays on this device.
            <br />Sign in with Google to use Splitr on all your devices.</>
          )}
        </p>
      </div>
    </div>
  );
};

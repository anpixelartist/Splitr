import React, { useState } from 'react';
import { UserCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

// New guests start as "User a1b2", which is what friends would see on every
// expense. Ask once for a real name before anything else.
export const NamePrompt: React.FC = () => {
  const { hasDefaultName, updateUserName } = useAuth();
  const [name, setName] = useState('');

  if (!hasDefaultName) return null;

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) updateUserName(name.trim());
  };

  return (
    <div className="anim-fade-in fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-[60] p-0 sm:p-4">
      <form
        onSubmit={save}
        className="bg-surface w-full max-w-sm sheet rounded-t-3xl sm:rounded-3xl shadow-xl p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:pb-6"
        aria-labelledby="name-prompt-title"
      >
        <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mb-4">
          <UserCircle className="w-7 h-7 text-blue-600 dark:text-blue-400" />
        </div>
        <h2 id="name-prompt-title" className="text-xl font-bold text-gray-900">What's your name?</h2>
        <p className="text-sm text-gray-500 mt-1 mb-4">Friends see this on expenses and balances in shared groups.</p>
        <input
          autoFocus
          type="text"
          maxLength={40}
          autoComplete="given-name"
          placeholder="e.g. Priya"
          aria-label="Your name"
          className="w-full border border-gray-300 rounded-xl px-4 py-3 text-lg outline-none focus:ring-2 focus:ring-blue-500"
          value={name}
          onChange={e => setName(e.target.value)}
        />
        <button
          type="submit"
          disabled={!name.trim()}
          className="mt-4 w-full bg-blue-600 text-white font-semibold py-3 rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Continue
        </button>
      </form>
    </div>
  );
};

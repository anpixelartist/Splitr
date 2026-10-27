import React, { useState, useRef, useEffect } from 'react';
import { X, Pencil, Check, Trash2, Plus, UserCircle, LogOut, Monitor, Sun, Moon, AlertTriangle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { getThemePref, setThemePref, type ThemePref } from '../lib/theme';

const THEME_OPTIONS = [
  { value: 'system', label: 'System', Icon: Monitor },
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
] as const;

interface Props {
  onClose: () => void;
}

export const ProfileModal: React.FC<Props> = ({ onClose }) => {
  const { userName, updateUserName, contacts, addContact, updateContact, removeContact, signInWithGoogle, signOut, isGoogleUser, isLocalOnly, user, authError, clearAuthError } = useAuth();

  // Name editing
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(userName);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const { showToast } = useToast();
  const [themePref, setThemePrefState] = useState<ThemePref>(getThemePref);

  // Contacts
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [confirmingUpgrade, setConfirmingUpgrade] = useState(false);
  const [upgradeAcknowledged, setUpgradeAcknowledged] = useState(false);
  const [newContactName, setNewContactName] = useState('');
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [editingContactName, setEditingContactName] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const contactEditRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingName) nameInputRef.current?.focus();
  }, [editingName]);

  useEffect(() => {
    if (editingContactId) contactEditRef.current?.focus();
  }, [editingContactId]);

  const saveName = async () => {
    if (draftName.trim()) {
      await updateUserName(draftName.trim());
      showToast('Name saved');
    }
    setEditingName(false);
  };

  const handleAddContact = async () => {
    const name = newContactName.trim();
    if (!name) return;
    await addContact(name);
    setNewContactName('');
    showToast(`${name} added to contacts`);
  };

  const commitContactEdit = async () => {
    if (!editingContactId) return;
    await updateContact(editingContactId, editingContactName);
    setEditingContactId(null);
    showToast('Contact updated');
  };

  const handleDeleteContact = async (id: string) => {
    await removeContact(id);
    setConfirmDeleteId(null);
    showToast('Contact removed');
  };

  return (
    <div className="anim-fade-in fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-surface w-full max-w-md sheet rounded-t-3xl sm:rounded-3xl shadow-xl flex flex-col max-h-[90dvh] pb-[env(safe-area-inset-bottom)] sm:pb-0">

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b shrink-0">
          <h2 className="text-lg font-bold text-gray-900">Profile</h2>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-gray-100 text-gray-500" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-6">

          {/* ── Identity ── */}
          <section className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-blue-100 text-blue-700 dark:text-blue-300 flex items-center justify-center font-bold text-2xl shrink-0 select-none">
              {((editingName && draftName) || userName).charAt(0).toUpperCase()}
            </div>

            <div className="flex-1 min-w-0">
              {editingName ? (
                <div className="flex items-center gap-2">
                  <input
                    ref={nameInputRef}
                    value={draftName}
                    onChange={e => setDraftName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') saveName();
                      if (e.key === 'Escape') { setDraftName(userName); setEditingName(false); }
                    }}
                    className="flex-1 border-b-2 border-blue-500 outline-none text-lg font-semibold py-0.5 bg-transparent"
                  />
                  <button onClick={saveName} className="p-1.5 text-green-600 dark:text-green-400 hover:bg-green-50 rounded-lg">
                    <Check className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => { setDraftName(userName); setEditingName(false); }}
                    className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-lg font-semibold text-gray-900 truncate">{userName}</span>
                  <button
                    onClick={() => { setDraftName(userName); setEditingName(true); }}
                    className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg shrink-0"
                    title="Edit name"
                    aria-label="Edit name"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              <p className="text-sm text-gray-400 mt-0.5 flex items-center gap-1">
                <UserCircle className="w-3.5 h-3.5" />
                Your display name in groups
              </p>
            </div>
          </section>

          {/* ── Appearance ── */}
          <section>
            <h3 className="font-semibold text-gray-700 mb-3">Appearance</h3>
            <div className="grid grid-cols-3 bg-gray-100 rounded-xl p-1" role="radiogroup" aria-label="Theme">
              {THEME_OPTIONS.map(({ value, label, Icon }) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={themePref === value}
                  onClick={() => { setThemePref(value); setThemePrefState(value); }}
                  className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                    themePref === value ? 'bg-surface shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </button>
              ))}
            </div>
          </section>

          {/* ── Account / Auth ── */}
          <section>
            <h3 className="font-semibold text-gray-700 mb-3">Account</h3>
            {isGoogleUser ? (
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 flex items-center gap-3">
                {user?.photoURL ? (
                  <img src={user.photoURL} alt="" className="w-10 h-10 rounded-full shrink-0" referrerPolicy="no-referrer" />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-blue-200 flex items-center justify-center shrink-0">
                    <UserCircle className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 truncate">{userName}</p>
                  {user?.email && <p className="text-xs text-gray-500 truncate">{user.email}</p>}
                  <p className="text-xs text-green-600 dark:text-green-400 mt-0.5">Synced with Google</p>
                </div>
                <button
                  onClick={async () => { await signOut(); onClose(); }}
                  className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg shrink-0"
                  title="Sign out"
                  aria-label="Sign out"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : isLocalOnly ? (
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
                <p className="text-sm text-gray-600">Local-only mode — data is saved in <strong>this browser</strong>.</p>
                <p className="text-xs text-gray-400 mt-0.5">Google sign-in and sharing need Firebase to be configured (see DEPLOYMENT.md).</p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
                  <p className="text-sm text-gray-600">You're using Splitr as a <strong>guest</strong>. Your groups sync with friends, but this guest profile lives only on this device.</p>
                  <p className="text-xs text-gray-400 mt-0.5">Sign in with Google to use it on all your devices — your groups come with you.</p>
                </div>
                {(googleError ?? authError) && (
                  <p role="alert" className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 border border-amber-200 rounded-lg p-2">
                    {googleError ?? authError}
                  </p>
                )}
                {confirmingUpgrade ? (
                  // Guests must acknowledge the risk before leaving for Google
                  <div className="anim-fade-in bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
                    <p className="flex items-center gap-2 font-semibold text-amber-800 dark:text-amber-300">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      Before you sign in
                    </p>
                    <ul className="text-sm text-gray-700 space-y-1.5 list-disc pl-5">
                      <li>Your groups, expenses and contacts are tied to this guest profile on this device.</li>
                      <li>With a Google account that's <strong>new to Splitr</strong>, everything moves into it and nothing is lost.</li>
                      <li>With a Google account <strong>already used with Splitr</strong>, you switch to that account and your guest data on this device <strong>can be lost</strong>.</li>
                    </ul>
                    <label className="flex items-start gap-2.5 text-sm text-gray-800 cursor-pointer">
                      <input
                        type="checkbox"
                        className="w-5 h-5 mt-0.5 shrink-0 rounded"
                        checked={upgradeAcknowledged}
                        onChange={e => setUpgradeAcknowledged(e.target.checked)}
                      />
                      I understand I could lose my guest data
                    </label>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => { setConfirmingUpgrade(false); setUpgradeAcknowledged(false); }}
                        className="flex-1 py-2.5 rounded-xl bg-gray-100 text-gray-700 font-medium hover:bg-gray-200"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={!upgradeAcknowledged || googleLoading}
                        onClick={async () => {
                          setGoogleError(null);
                          clearAuthError();
                          setGoogleLoading(true);
                          try {
                            await signInWithGoogle();
                          } catch (err) {
                            setGoogleError(err instanceof Error ? err.message : 'Google sign-in failed. Please try again.');
                          } finally {
                            setGoogleLoading(false);
                          }
                        }}
                        className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                      >
                        {googleLoading && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                        Continue to Google
                      </button>
                    </div>
                  </div>
                ) : (
                <button
                  onClick={() => setConfirmingUpgrade(true)}
                  className="w-full flex items-center justify-center gap-2.5 bg-surface border-2 border-gray-200 hover:border-blue-400 text-gray-800 font-semibold py-3 rounded-xl transition-all"
                >
                  <svg viewBox="0 0 48 48" className="w-4 h-4" aria-hidden="true">
                    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                  </svg>
                  Sign in with Google
                </button>
                )}
              </div>
            )}
          </section>

          {/* ── Contacts ── */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-700">
                Contacts
                {contacts.length > 0 && (
                  <span className="ml-2 text-sm font-normal text-gray-400">{contacts.length}</span>
                )}
              </h3>
            </div>

            {/* Add new */}
            <div className="mb-1">
            <div className="flex items-center gap-2 border rounded-xl px-3 py-2 focus-within:ring-2 focus-within:ring-blue-500 bg-gray-50">
              <Plus className="w-4 h-4 text-gray-400 shrink-0" />
              <input
                type="text"
                placeholder="Add a contact…"
                value={newContactName}
                onChange={e => setNewContactName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddContact()}
                className="flex-1 text-base sm:text-sm outline-none bg-transparent placeholder-gray-400 py-0.5"
              />
              {newContactName.trim() && (
                <button
                  onClick={handleAddContact}
                  className="text-xs px-2.5 py-1 rounded-lg shrink-0 bg-blue-600 text-white hover:bg-blue-700 transition-all"
                >
                  Add
                </button>
              )}
            </div>
            </div>

            {contacts.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">
                No contacts yet. Add people you split with often so you can quickly pick them when creating a group.
              </p>
            ) : (
              <div className="rounded-xl border divide-y bg-surface">
                {contacts.map(contact => {
                  const isEditing = editingContactId === contact.id;
                  const isConfirming = confirmDeleteId === contact.id;

                  return (
                    <div key={contact.id} className="flex items-center gap-3 px-3 py-2.5">
                      <div className="w-8 h-8 rounded-full bg-gray-100 text-gray-600 flex items-center justify-center font-bold text-sm shrink-0">
                        {contact.name.charAt(0).toUpperCase()}
                      </div>

                      {isEditing ? (
                        <input
                          ref={contactEditRef}
                          value={editingContactName}
                          onChange={e => setEditingContactName(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') commitContactEdit();
                            if (e.key === 'Escape') setEditingContactId(null);
                          }}
                          className="flex-1 text-base sm:text-sm border-b border-blue-400 outline-none py-0.5 font-medium"
                        />
                      ) : (
                        <span className="flex-1 text-sm font-medium text-gray-800 truncate">
                          {contact.name}
                        </span>
                      )}

                      <div className="flex items-center gap-1 shrink-0">
                        {isEditing ? (
                          <>
                            <button onClick={commitContactEdit} className="p-1.5 text-green-600 dark:text-green-400 hover:bg-green-50 rounded-lg">
                              <Check className="w-4 h-4" />
                            </button>
                            <button onClick={() => setEditingContactId(null)} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg">
                              <X className="w-4 h-4" />
                            </button>
                          </>
                        ) : isConfirming ? (
                          <>
                            <button
                              onClick={() => setConfirmDeleteId(null)}
                              className="text-xs px-2 py-1 border rounded-lg text-gray-500 hover:bg-gray-50"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => handleDeleteContact(contact.id)}
                              className="text-xs px-2 py-1 bg-red-600 text-white rounded-lg hover:bg-red-700"
                            >
                              Delete
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => {
                                setEditingContactId(contact.id);
                                setEditingContactName(contact.name);
                                setConfirmDeleteId(null);
                              }}
                              className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg"
                              title="Rename"
                              aria-label={`Rename ${contact.name}`}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => { setConfirmDeleteId(contact.id); setEditingContactId(null); }}
                              className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg"
                              title="Delete"
                              aria-label={`Delete ${contact.name}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};

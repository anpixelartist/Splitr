import React, { useEffect, useRef, useState } from 'react';
import { X, Plus, Check, Users, CheckCircle2 } from 'lucide-react';
import type { Contact } from '../types';
import { CURRENCIES, currencyName, currencySymbol, defaultCurrency } from '../lib/money';

interface Props {
  contacts: Contact[];
  onAddContact: (name: string) => Promise<Contact>;
  onClose: () => void;
  onCreate: (groupName: string, participants: { id: string; name: string }[], currency: string) => void;
}

export const CreateGroupModal: React.FC<Props> = ({
  contacts,
  onAddContact,
  onClose,
  onCreate,
}) => {
  const [groupName, setGroupName] = useState('');
  const [currency, setCurrency] = useState(() => defaultCurrency());
  const [newPersonName, setNewPersonName] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // local copy so newly added contacts show immediately
  const [localContacts, setLocalContacts] = useState<Contact[]>(contacts);
  // brief success flash after adding someone
  const [addedName, setAddedName] = useState<string | null>(null);
  const addedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (addedTimer.current) clearTimeout(addedTimer.current); }, []);

  const toggleContact = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleAddPerson = async () => {
    const name = newPersonName.trim();
    if (!name) return;
    const contact = await onAddContact(name);
    setLocalContacts(prev => [...prev, contact]);
    setSelectedIds(prev => new Set([...prev, contact.id]));
    setNewPersonName('');
    // Show "Name added" confirmation for 2 s
    if (addedTimer.current) clearTimeout(addedTimer.current);
    setAddedName(name);
    addedTimer.current = setTimeout(() => setAddedName(null), 2000);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddPerson();
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupName.trim()) return;
    const participants = localContacts.filter(c => selectedIds.has(c.id));
    onCreate(groupName.trim(), participants, currency);
  };

  const selectedContacts = localContacts.filter(c => selectedIds.has(c.id));

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-surface w-full max-w-md rounded-t-2xl sm:rounded-2xl shadow-xl flex flex-col max-h-[90dvh] pb-[env(safe-area-inset-bottom)] sm:pb-0">

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b shrink-0">
          <h2 className="text-lg font-bold text-gray-900">Create New Group</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-gray-100 text-gray-500"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col overflow-hidden">
          <div className="p-5 space-y-5 overflow-y-auto flex-1">

            {/* Group name */}
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1.5">
                Group name
              </label>
              <input
                type="text"
                placeholder="e.g. Weekend Trip, Flat Bills…"
                value={groupName}
                onChange={e => setGroupName(e.target.value)}
                className="w-full border rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-blue-500 outline-none text-gray-900"
                autoFocus
              />
            </div>

            {/* Currency: fixed once the group exists, since amounts are stored in it */}
            <div>
              <label htmlFor="group-currency" className="text-sm font-medium text-gray-700 block mb-1.5">
                Currency
              </label>
              <select
                id="group-currency"
                value={currency}
                onChange={e => setCurrency(e.target.value)}
                className="w-full border rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-blue-500 outline-none text-gray-900"
              >
                {CURRENCIES.map(c => (
                  <option key={c} value={c}>{currencySymbol(c)} {c} · {currencyName(c)}</option>
                ))}
              </select>
            </div>

            {/* Add a new person */}
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1.5">
                Add people
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Enter a name and press +"
                  value={newPersonName}
                  onChange={e => setNewPersonName(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="flex-1 border rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-blue-500 outline-none text-gray-900"
                />
                <button
                  type="button"
                  onClick={handleAddPerson}
                  disabled={!newPersonName.trim()}
                  aria-label="Add person"
                  className={`px-4 py-2.5 rounded-xl flex items-center gap-1 shrink-0 transition-all ${
                    addedName
                      ? 'bg-green-500 text-white scale-95'
                      : 'bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40'
                  }`}
                >
                  {addedName ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                </button>
              </div>
              {/* Success confirmation */}
              {addedName && (
                <p className="anim-fade-in-up mt-1.5 text-sm text-green-600 dark:text-green-400 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span><strong>{addedName}</strong> added and selected</span>
                </p>
              )}
            </div>

            {/* Contacts list */}
            {localContacts.length > 0 && (
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-1.5">
                  <Users className="w-4 h-4 text-gray-400" />
                  Your contacts
                  {selectedIds.size > 0 && (
                    <span className="text-blue-600 dark:text-blue-400 font-semibold">
                      — {selectedIds.size} selected
                    </span>
                  )}
                </p>
                <div className="rounded-xl border divide-y max-h-52 overflow-y-auto">
                  {localContacts.map(contact => {
                    const isSelected = selectedIds.has(contact.id);
                    return (
                      <button
                        key={contact.id}
                        type="button"
                        onClick={() => toggleContact(contact.id)}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 transition-colors text-left ${
                          isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'
                        }`}
                      >
                        <div
                          className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 transition-colors ${
                            isSelected
                              ? 'bg-blue-600 text-white'
                              : 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          {isSelected
                            ? <Check className="w-4 h-4" />
                            : contact.name.charAt(0).toUpperCase()}
                        </div>
                        <span className={`font-medium ${isSelected ? 'text-blue-700 dark:text-blue-300' : 'text-gray-800'}`}>
                          {contact.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Selected chips */}
            {selectedContacts.length > 0 && (
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
                  Will be added to group
                </p>
                <div className="flex flex-wrap gap-2">
                  {selectedContacts.map(c => (
                    <span
                      key={c.id}
                      className="inline-flex items-center gap-1 bg-blue-100 text-blue-700 dark:text-blue-300 text-sm px-3 py-1 rounded-full"
                    >
                      {c.name}
                      <button
                        type="button"
                        onClick={() => toggleContact(c.id)}
                        className="ml-0.5 hover:text-blue-900 dark:hover:text-blue-300"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-5 border-t shrink-0">
            <button
              type="submit"
              disabled={!groupName.trim()}
              className="w-full bg-blue-600 text-white py-3 rounded-xl font-semibold hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {selectedContacts.length > 0
                ? `Create group with ${selectedContacts.length + 1} people`
                : 'Create group'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

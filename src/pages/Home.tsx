import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { useGroup } from '../context/GroupContext';
import { Wallet, Users, Plus, ChevronRight, HardDrive, AlertTriangle, X } from 'lucide-react';
import { CreateGroupModal } from '../components/CreateGroupModal';
import { ProfileModal } from '../components/ProfileModal';
import { JoinCodeInput } from '../components/JoinCodeInput';
import { useToast } from '../context/ToastContext';
import { DEFAULT_CURRENCY } from '../lib/money';
import type { Group } from '../types';

// Apple's system colours, picked per group so each one keeps its own icon colour
const GROUP_TINTS = ['bg-[#0A84FF]', 'bg-[#30B0C7]', 'bg-[#34C759]', 'bg-[#FF9F0A]', 'bg-[#FF375F]', 'bg-[#BF5AF2]', 'bg-[#5E5CE6]'];
const tintFor = (id: string) => GROUP_TINTS[[...id].reduce((h, c) => h + c.charCodeAt(0), 0) % GROUP_TINTS.length];

const memberNamesOf = (group: Group) => [
  ...group.members.map(uid => group.memberNames?.[uid] ?? '?'),
  ...(group.participants ?? []).map(p => p.name),
];

export const Home: React.FC = () => {
  const { userName, contacts, addContact, isLocalOnly, authError, clearAuthError } = useAuth();
  const { groups, createGroup } = useGroup();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [joinCode, setJoinCode] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showProfile, setShowProfile] = useState(false);

  const handleCreateGroup = async (
    groupName: string,
    participants: { id: string; name: string }[],
    currency: string,
  ) => {
    try {
      const id = await createGroup(groupName, participants, currency);
      setShowCreateModal(false);
      navigate(`/group/${id}`);
    } catch {
      showToast("Couldn't create the group. Please try again.", 'error');
    }
  };

  // Joining goes through the group's invite screen, which asks "Which of
  // these is you?" when the group has name-only members.
  const joinWithCode = (raw: string) => {
    const code = raw.trim().toUpperCase();
    if (!code) return;
    if (isLocalOnly) {
      showToast('Joining groups needs the online version of Splitr.', 'error');
      return;
    }
    setJoinCode('');
    navigate(`/group/${code}`);
  };

  const handleJoinGroup = (e: React.FormEvent) => {
    e.preventDefault();
    joinWithCode(joinCode);
  };

  return (
    <div className="max-w-md md:max-w-2xl lg:max-w-5xl mx-auto p-4 lg:px-8 space-y-8">

      {/* ── Header ── */}
      <header className="flex items-center justify-between py-4">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-[0.6rem] bg-gradient-to-b from-[#2E8BFF] to-blue-600 flex items-center justify-center shadow-sm shadow-blue-600/30">
            <Wallet className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-[1.75rem] font-bold tracking-tight text-gray-900">Splitr</h1>
        </div>

        {/* Avatar — opens Profile modal */}
        <button
          onClick={() => setShowProfile(true)}
          className="flex items-center gap-2 hover:opacity-80 transition-opacity"
          title="Profile & contacts"
          aria-label="Profile & contacts"
        >
          <div className="w-9 h-9 bg-gradient-to-b from-gray-300 to-gray-400 text-white rounded-full flex items-center justify-center font-semibold text-sm select-none">
            {userName.charAt(0).toUpperCase()}
          </div>
          <span className="text-sm font-medium text-gray-700 hidden sm:block">{userName}</span>
        </button>
      </header>

      {isLocalOnly && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800 dark:text-amber-300">
          <HardDrive className="w-4 h-4 shrink-0 mt-0.5" />
          <p>Local-only mode: data is saved in this browser and can't be shared with other devices.</p>
        </div>
      )}

      <div className="space-y-8 lg:space-y-0 lg:grid lg:grid-cols-[22rem_minmax(0,1fr)] lg:gap-8 lg:items-start">
      {/* A Google sign-in that failed after a redirect lands here, not in Profile */}
      {authError && (
        <div role="alert" className="anim-fade-in flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700 dark:text-red-300">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <p className="flex-1">{authError}</p>
          <button onClick={clearAuthError} className="p-1 -m-1 rounded hover:bg-red-100" aria-label="Dismiss">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ── Actions ── */}
      <section className="bg-surface rounded-3xl p-5 shadow-[0_1px_2px_rgb(0_0_0/0.04),0_12px_32px_-16px_rgb(0_0_0/0.18)]">
        <button
          onClick={() => setShowCreateModal(true)}
          className="w-full bg-blue-600 text-white py-3 rounded-full font-semibold hover:bg-blue-700 transition-transform active:scale-[0.98] flex items-center justify-center gap-2"
        >
          <Plus className="w-5 h-5" strokeWidth={2.5} />
          New Group
        </button>

        <div className="flex items-center gap-3 my-5">
          <div className="flex-1 h-px bg-gray-200" />
          <span className="text-xs font-medium text-gray-400 shrink-0">or join with a code</span>
          <div className="flex-1 h-px bg-gray-200" />
        </div>

        {/* A full code opens the group's invite screen right away; Join is for shorter old codes */}
        <form onSubmit={handleJoinGroup} className="space-y-3">
          <JoinCodeInput value={joinCode} onChange={setJoinCode} onComplete={joinWithCode} />
          <button
            type="submit"
            disabled={joinCode.length < 4}
            className="w-full py-3 rounded-full font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 hover:bg-blue-100 transition-colors disabled:opacity-50"
          >
            Join Group
          </button>
        </form>
      </section>

      {/* ── Groups list: an iOS inset-grouped list ── */}
      <section>
        <h2 className="text-[1.375rem] font-bold tracking-tight mb-3 px-1">Your Groups</h2>
        {groups.length === 0 ? (
          <div className="bg-surface rounded-3xl py-12 px-6 text-center">
            <div className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-3">
              <Users className="w-7 h-7 text-gray-400" />
            </div>
            <p className="font-semibold text-gray-900">No groups yet</p>
            <p className="text-sm text-gray-500 mt-1">Create one for a trip, a flat or dinner, or join with a code.</p>
          </div>
        ) : (
          <div className="bg-surface rounded-3xl overflow-hidden">
            {groups.map(group => {
              const names = memberNamesOf(group);
              return (
                <button
                  key={group.id}
                  onClick={() => navigate(`/group/${group.id}`)}
                  className="group w-full text-left flex items-center gap-3 pl-4 hover:bg-gray-50 active:bg-gray-100 transition-colors"
                >
                  <div className={`w-10 h-10 rounded-xl ${tintFor(group.id)} flex items-center justify-center text-white font-semibold shrink-0`}>
                    {group.name.charAt(0).toUpperCase()}
                  </div>
                  {/* Hairline separators start after the icon, as in iOS lists */}
                  <div className="flex-1 min-w-0 flex items-center gap-3 py-3 pr-3 border-b border-gray-200/70 group-last:border-b-0">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-gray-900 truncate">{group.name}</h3>
                      <p className="text-sm text-gray-500">
                        {names.length} {names.length === 1 ? 'member' : 'members'} · {group.currency ?? DEFAULT_CURRENCY}
                      </p>
                    </div>
                    <div className="flex -space-x-2 shrink-0" aria-hidden="true">
                      {names.slice(0, 3).map((n, i) => (
                        <div key={i} className="w-7 h-7 rounded-full bg-gray-100 ring-2 ring-surface flex items-center justify-center text-[0.6875rem] font-semibold text-gray-600">
                          {n.charAt(0).toUpperCase()}
                        </div>
                      ))}
                      {names.length > 3 && (
                        <div className="w-7 h-7 rounded-full bg-gray-200 ring-2 ring-surface flex items-center justify-center text-[0.6875rem] font-semibold text-gray-600">
                          +{names.length - 3}
                        </div>
                      )}
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-300 shrink-0" />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>
      </div>

      {/* ── Modals ── */}
      {showCreateModal && (
        <CreateGroupModal
          contacts={contacts}
          onAddContact={addContact}
          onClose={() => setShowCreateModal(false)}
          onCreate={handleCreateGroup}
        />
      )}

      {showProfile && (
        <ProfileModal onClose={() => setShowProfile(false)} />
      )}
    </div>
  );
};

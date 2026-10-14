import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { useGroup } from '../context/GroupContext';
import { Wallet, Users, PlusCircle, UserPlus } from 'lucide-react';
import { CreateGroupModal } from '../components/CreateGroupModal';
import { ProfileModal } from '../components/ProfileModal';
import { useToast } from '../context/ToastContext';

export const Home: React.FC = () => {
  const { userName, contacts, addContact } = useAuth();
  const { groups, createGroup, joinGroup } = useGroup();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [joinCode, setJoinCode] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showProfile, setShowProfile] = useState(false);

  const handleCreateGroup = async (
    groupName: string,
    participants: { id: string; name: string }[],
  ) => {
    const id = await createGroup(groupName, participants);
    setShowCreateModal(false);
    navigate(`/group/${id}`);
  };

  const handleJoinGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinCode.trim()) return;
    const success = await joinGroup(joinCode.toUpperCase());
    if (success) {
      navigate(`/group/${joinCode.toUpperCase()}`);
    } else {
      showToast('Group not found — check the code and try again.', 'error');
    }
  };

  const totalMembers = (group: { members: string[]; participants?: { id: string; name: string }[] }) =>
    group.members.length + (group.participants?.length ?? 0);

  return (
    <div className="max-w-md mx-auto p-4 space-y-8">

      {/* ── Header ── */}
      <header className="flex items-center justify-between py-4">
        <div className="flex items-center gap-2">
          <Wallet className="w-8 h-8 text-blue-600" />
          <h1 className="text-2xl font-bold text-gray-900">Splitr</h1>
        </div>

        {/* Avatar — opens Profile modal */}
        <button
          onClick={() => setShowProfile(true)}
          className="flex items-center gap-2 hover:opacity-80 transition-opacity"
          title="Profile & contacts"
        >
          <div className="w-9 h-9 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center font-bold text-sm select-none">
            {userName.charAt(0).toUpperCase()}
          </div>
          <span className="text-sm font-medium text-gray-700 hidden sm:block">{userName}</span>
        </button>
      </header>

      {/* ── Actions ── */}
      <section className="space-y-4">
        <div className="bg-white p-6 rounded-xl shadow-sm border">
          <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
            <PlusCircle className="w-5 h-5 text-blue-500" />
            Create a New Group
          </h2>
          <button
            onClick={() => setShowCreateModal(true)}
            className="w-full bg-blue-600 text-white py-2.5 rounded-xl font-medium hover:bg-blue-700 transition-colors"
          >
            New Group…
          </button>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border">
          <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
            <UserPlus className="w-5 h-5 text-green-500" />
            Join a Group
          </h2>
          <form onSubmit={handleJoinGroup} className="flex gap-2">
            <input
              type="text"
              placeholder="Enter Group Code"
              className="flex-1 border rounded-xl px-4 py-2.5 uppercase focus:ring-2 focus:ring-green-500 outline-none tracking-widest"
              value={joinCode}
              onChange={e => setJoinCode(e.target.value)}
            />
            <button
              type="submit"
              className="bg-green-600 text-white px-4 py-2.5 rounded-xl font-medium hover:bg-green-700 transition-colors"
            >
              Join
            </button>
          </form>
        </div>
      </section>

      {/* ── Groups list ── */}
      <section>
        <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
          <Users className="w-6 h-6 text-gray-700" />
          Your Groups
        </h2>
        {groups.length === 0 ? (
          <p className="text-gray-500 text-center py-8">You aren't in any groups yet.</p>
        ) : (
          <div className="grid gap-3">
            {groups.map(group => (
              <div
                key={group.id}
                onClick={() => navigate(`/group/${group.id}`)}
                className="bg-white p-4 rounded-xl border shadow-sm flex justify-between items-center cursor-pointer hover:border-blue-300 transition-colors"
              >
                <div>
                  <h3 className="font-semibold text-lg">{group.name}</h3>
                  <p className="text-sm text-gray-500">{totalMembers(group)} members</p>
                </div>
                <div className="text-xs bg-gray-100 px-2 py-1 rounded text-gray-600 font-mono">
                  {group.id}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

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

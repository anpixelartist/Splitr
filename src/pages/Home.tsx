import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { useGroup } from '../context/GroupContext';
import { Wallet, Users, PlusCircle, UserPlus } from 'lucide-react';

export const Home: React.FC = () => {
  const { userName, updateUserName } = useAuth();
  const { groups, createGroup, joinGroup } = useGroup();
  const navigate = useNavigate();

  const [editingName, setEditingName] = useState(false);
  const [tempName, setTempName] = useState(userName);
  const [newGroupName, setNewGroupName] = useState('');
  const [joinCode, setJoinCode] = useState('');

  const handleUpdateName = () => {
    updateUserName(tempName);
    setEditingName(false);
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGroupName.trim()) return;
    const id = await createGroup(newGroupName);
    navigate(`/group/${id}`);
  };

  const handleJoinGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinCode.trim()) return;
    const success = await joinGroup(joinCode.toUpperCase());
    if (success) {
      navigate(`/group/${joinCode.toUpperCase()}`);
    } else {
      alert("Group not found");
    }
  };

  return (
    <div className="max-w-md mx-auto p-4 space-y-8">
      <header className="flex items-center justify-between py-4">
        <div className="flex items-center gap-2">
          <Wallet className="w-8 h-8 text-blue-600" />
          <h1 className="text-2xl font-bold text-gray-900">Splitr</h1>
        </div>
        <div className="text-sm">
          {editingName ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={tempName}
                onChange={e => setTempName(e.target.value)}
                className="border rounded px-2 py-1 w-32"
                autoFocus
              />
              <button onClick={handleUpdateName} className="text-blue-600 font-semibold">Save</button>
            </div>
          ) : (
            <div className="flex items-center gap-2 cursor-pointer" onClick={() => setEditingName(true)}>
              <div className="w-8 h-8 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center font-bold">
                {userName.charAt(0).toUpperCase()}
              </div>
              <span className="font-medium">{userName}</span>
            </div>
          )}
        </div>
      </header>

      <section className="space-y-4">
        <div className="bg-white p-6 rounded-xl shadow-sm border">
          <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
            <PlusCircle className="w-5 h-5 text-blue-500" />
            Create a New Group
          </h2>
          <form onSubmit={handleCreateGroup} className="flex gap-2">
            <input
              type="text"
              placeholder="e.g. Weekend Trip"
              className="flex-1 border rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
              value={newGroupName}
              onChange={e => setNewGroupName(e.target.value)}
            />
            <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700">
              Create
            </button>
          </form>
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
              className="flex-1 border rounded-lg px-4 py-2 uppercase focus:ring-2 focus:ring-green-500 outline-none"
              value={joinCode}
              onChange={e => setJoinCode(e.target.value)}
            />
            <button type="submit" className="bg-green-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-green-700">
              Join
            </button>
          </form>
        </div>
      </section>

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
                  <p className="text-sm text-gray-500">{group.members.length} members</p>
                </div>
                <div className="text-xs bg-gray-100 px-2 py-1 rounded text-gray-600 font-mono">
                  {group.id}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

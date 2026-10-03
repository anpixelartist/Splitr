import React, { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useGroup } from '../context/GroupContext';
import { useAuth } from '../context/AuthContext';
import { ArrowLeft, Receipt, Share2, Plus } from 'lucide-react';
import { calculateBalances, calculateSettlements } from '../lib/settlement';
import { AddExpenseModal } from '../components/AddExpenseModal';

export const GroupDetails: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { currentGroup, setCurrentGroupId, expenses, getUsersInGroup } = useGroup();

  const [activeTab, setActiveTab] = useState<'expenses' | 'balances'>('expenses');
  const [isAddExpenseOpen, setIsAddExpenseOpen] = useState(false);
  const [groupUsers, setGroupUsers] = useState<{id: string, name: string}[]>([]);

  useEffect(() => {
    if (id) {
      setCurrentGroupId(id);
    }
    return () => setCurrentGroupId(null);
  }, [id, setCurrentGroupId]);

  useEffect(() => {
    const fetchUsers = async () => {
      const users = await getUsersInGroup();
      setGroupUsers(users);
    };
    if (currentGroup) {
      fetchUsers();
    }
  }, [currentGroup, getUsersInGroup]);

  const balances = useMemo(() => calculateBalances(expenses), [expenses]);
  const settlements = useMemo(() => calculateSettlements(balances), [balances]);

  const getUserName = (uid: string) => {
    return groupUsers.find(u => u.id === uid)?.name || 'Unknown';
  };

  const handleShare = () => {
    if (navigator.share) {
      navigator.share({
        title: `Join ${currentGroup?.name} on Splitr`,
        text: `Join my group to split expenses using code: ${currentGroup?.id}`,
        url: window.location.href,
      });
    } else {
      navigator.clipboard.writeText(currentGroup?.id || '');
      alert('Group code copied to clipboard!');
    }
  };

  if (!currentGroup) {
    return <div className="p-8 text-center text-gray-500">Loading group...</div>;
  }

  return (
    <div className="max-w-md mx-auto min-h-screen bg-gray-50 flex flex-col relative">
      <header className="bg-white border-b sticky top-0 z-10">
        <div className="p-4 flex items-center justify-between">
          <button onClick={() => navigate('/')} className="p-2 -ml-2 rounded-full hover:bg-gray-100">
            <ArrowLeft className="w-6 h-6 text-gray-700" />
          </button>
          <div className="flex-1 text-center">
            <h1 className="text-xl font-bold text-gray-900">{currentGroup.name}</h1>
            <p className="text-xs text-gray-500 font-mono">Code: {currentGroup.id}</p>
          </div>
          <button onClick={handleShare} className="p-2 -mr-2 rounded-full hover:bg-gray-100 text-blue-600">
            <Share2 className="w-5 h-5" />
          </button>
        </div>
        <div className="flex border-t">
          <button
            className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'expenses' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500'}`}
            onClick={() => setActiveTab('expenses')}
          >
            Expenses
          </button>
          <button
            className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'balances' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500'}`}
            onClick={() => setActiveTab('balances')}
          >
            Balances
          </button>
        </div>
      </header>

      <main className="flex-1 p-4 pb-24 overflow-y-auto">
        {activeTab === 'expenses' ? (
          <div className="space-y-3">
            {expenses.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                <Receipt className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>No expenses yet. Add one to get started!</p>
              </div>
            ) : (
              expenses.map(expense => (
                <div key={expense.id} className="bg-white p-4 rounded-xl border shadow-sm">
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="font-semibold text-gray-800">{expense.description}</h3>
                    <span className="font-bold text-gray-900">${expense.amount.toFixed(2)}</span>
                  </div>
                  <div className="text-sm text-gray-500 flex justify-between">
                    <span>Paid by {getUserName(expense.paidBy)}</span>
                    <span>{new Date(expense.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="space-y-6">
            <section>
              <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3">Your Balance</h3>
              {(() => {
                const myBalance = balances[user?.uid || '']?.netBalance || 0;
                return (
                  <div className={`p-4 rounded-xl border ${myBalance > 0 ? 'bg-green-50 border-green-200' : myBalance < 0 ? 'bg-red-50 border-red-200' : 'bg-gray-100 border-gray-200'}`}>
                    <p className="text-sm text-gray-600 mb-1">
                      {myBalance > 0 ? 'You are owed' : myBalance < 0 ? 'You owe' : 'You are settled up'}
                    </p>
                    <p className={`text-3xl font-bold ${myBalance > 0 ? 'text-green-700' : myBalance < 0 ? 'text-red-700' : 'text-gray-700'}`}>
                      ${Math.abs(myBalance).toFixed(2)}
                    </p>
                  </div>
                );
              })()}
            </section>

            <section>
              <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3">Settlement Plan</h3>
              {settlements.length === 0 ? (
                <div className="bg-white p-6 rounded-xl border text-center text-gray-500 shadow-sm">
                  Everyone is settled up!
                </div>
              ) : (
                <div className="space-y-2">
                  {settlements.map((s, i) => (
                    <div key={i} className="bg-white p-4 rounded-xl border shadow-sm flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center font-bold text-gray-600 text-xs">
                          {getUserName(s.from).charAt(0)}
                        </div>
                        <div className="text-sm">
                          <span className="font-semibold">{s.from === user?.uid ? 'You' : getUserName(s.from)}</span>
                          <span className="text-gray-500 mx-1">owes</span>
                          <span className="font-semibold">{s.to === user?.uid ? 'You' : getUserName(s.to)}</span>
                        </div>
                      </div>
                      <span className="font-bold text-gray-900">${s.amount.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section>
              <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3">Group Members</h3>
              <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
                {groupUsers.map(u => (
                  <div key={u.id} className="p-3 border-b last:border-0 flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-xs">
                      {u.name.charAt(0).toUpperCase()}
                    </div>
                    <span className="font-medium text-gray-700">{u.name} {u.id === user?.uid && '(You)'}</span>
                    <span className="ml-auto text-sm font-medium">
                      {(() => {
                        const bal = balances[u.id]?.netBalance || 0;
                        if (bal === 0) return <span className="text-gray-400">Settled</span>;
                        return <span className={bal > 0 ? 'text-green-600' : 'text-red-600'}>
                          {bal > 0 ? '+' : '-'}${Math.abs(bal).toFixed(2)}
                        </span>;
                      })()}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
      </main>

      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-20">
        <button
          onClick={() => setIsAddExpenseOpen(true)}
          className="bg-blue-600 text-white px-6 py-4 rounded-full shadow-lg shadow-blue-200 flex items-center gap-2 font-bold text-lg hover:bg-blue-700 transition-transform active:scale-95"
        >
          <Plus className="w-6 h-6" /> Add Expense
        </button>
      </div>

      {isAddExpenseOpen && (
        <AddExpenseModal
          onClose={() => setIsAddExpenseOpen(false)}
          users={groupUsers}
        />
      )}
    </div>
  );
};

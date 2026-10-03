import React, { useState } from 'react';
import { useGroup } from '../context/GroupContext';
import { useAuth } from '../context/AuthContext';
import { X } from 'lucide-react';

interface Props {
  onClose: () => void;
  users: { id: string; name: string }[];
}

export const AddExpenseModal: React.FC<Props> = ({ onClose, users }) => {
  const { addExpense, currentGroup } = useGroup();
  const { user } = useAuth();

  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [paidBy, setPaidBy] = useState(user?.uid || '');

  // Default: split equally among everyone
  const [splitMethod, setSplitMethod] = useState<'equal' | 'exact'>('equal');
  const [exactSplits, setExactSplits] = useState<Record<string, string>>({});
  const [includedUsers, setIncludedUsers] = useState<Record<string, boolean>>(
    users.reduce((acc, u) => ({ ...acc, [u.id]: true }), {})
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentGroup || !user) return;

    const totalAmount = parseFloat(amount);
    if (isNaN(totalAmount) || totalAmount <= 0 || !description.trim()) {
      alert("Please enter a valid amount and description.");
      return;
    }

    const splits: { userId: string; amount: number }[] = [];

    if (splitMethod === 'equal') {
      const activeUsers = Object.keys(includedUsers).filter(id => includedUsers[id]);
      if (activeUsers.length === 0) {
        alert("Select at least one person to split with.");
        return;
      }
      const splitAmount = Math.round((totalAmount / activeUsers.length) * 100) / 100;

      // Handle rounding error on the last person
      let sum = 0;
      activeUsers.forEach((uid, index) => {
        if (index === activeUsers.length - 1) {
          splits.push({ userId: uid, amount: totalAmount - sum });
        } else {
          splits.push({ userId: uid, amount: splitAmount });
          sum += splitAmount;
        }
      });
    } else {
      let sum = 0;
      for (const uid of users.map(u => u.id)) {
        const val = parseFloat(exactSplits[uid] || '0');
        if (val > 0) {
          splits.push({ userId: uid, amount: val });
          sum += val;
        }
      }
      if (Math.abs(sum - totalAmount) > 0.01) {
        alert(`The exact amounts must sum up to the total. Currently off by $${Math.abs(sum - totalAmount).toFixed(2)}`);
        return;
      }
    }

    await addExpense({
      groupId: currentGroup.id,
      description,
      amount: totalAmount,
      paidBy,
      splits
    });

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in">
      <div className="bg-white w-full max-w-md rounded-t-2xl sm:rounded-2xl shadow-xl flex flex-col max-h-[90vh]">
        <div className="p-4 border-b flex justify-between items-center sticky top-0 bg-white rounded-t-2xl">
          <h2 className="text-xl font-bold">Add Expense</h2>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-100">
            <X className="w-6 h-6 text-gray-500" />
          </button>
        </div>

        <div className="p-4 overflow-y-auto flex-1">
          <form id="expense-form" onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <input
                type="text"
                required
                placeholder="Dinner, Taxi, Groceries..."
                className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none text-lg"
                value={description}
                onChange={e => setDescription(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Total Amount ($)</label>
              <input
                type="number"
                required
                step="0.01"
                min="0"
                placeholder="0.00"
                className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none text-2xl font-bold"
                value={amount}
                onChange={e => setAmount(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Who Paid?</label>
              <select
                className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none"
                value={paidBy}
                onChange={e => setPaidBy(e.target.value)}
              >
                {users.map(u => (
                  <option key={u.id} value={u.id}>
                    {u.id === user?.uid ? 'Me' : u.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="border-t pt-4">
              <div className="flex justify-between items-center mb-3">
                <label className="block text-sm font-medium text-gray-700">Split Method</label>
                <div className="flex bg-gray-100 rounded-lg p-1">
                  <button
                    type="button"
                    className={`px-3 py-1 rounded-md text-sm font-medium ${splitMethod === 'equal' ? 'bg-white shadow-sm' : 'text-gray-500'}`}
                    onClick={() => setSplitMethod('equal')}
                  >
                    Equally
                  </button>
                  <button
                    type="button"
                    className={`px-3 py-1 rounded-md text-sm font-medium ${splitMethod === 'exact' ? 'bg-white shadow-sm' : 'text-gray-500'}`}
                    onClick={() => setSplitMethod('exact')}
                  >
                    Exact Amounts
                  </button>
                </div>
              </div>

              {splitMethod === 'equal' ? (
                <div className="space-y-2">
                  <p className="text-xs text-gray-500 mb-2">Select who was involved:</p>
                  {users.map(u => (
                    <label key={u.id} className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
                      <input
                        type="checkbox"
                        className="w-5 h-5 rounded text-blue-600 focus:ring-blue-500"
                        checked={includedUsers[u.id] || false}
                        onChange={e => setIncludedUsers(prev => ({ ...prev, [u.id]: e.target.checked }))}
                      />
                      <span className="font-medium text-gray-800">{u.id === user?.uid ? 'Me' : u.name}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-gray-500 mb-2">Enter exact amounts for each person:</p>
                  {users.map(u => (
                    <div key={u.id} className="flex items-center gap-3 p-2 border rounded-lg bg-gray-50">
                      <span className="font-medium text-gray-800 flex-1 truncate">{u.id === user?.uid ? 'Me' : u.name}</span>
                      <div className="relative w-32">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          className="w-full border-none shadow-sm rounded-md pl-7 pr-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="0.00"
                          value={exactSplits[u.id] || ''}
                          onChange={e => setExactSplits(prev => ({ ...prev, [u.id]: e.target.value }))}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </form>
        </div>

        <div className="p-4 border-t bg-gray-50 rounded-b-2xl">
          <button
            type="submit"
            form="expense-form"
            className="w-full bg-blue-600 text-white font-bold text-lg py-4 rounded-xl hover:bg-blue-700 active:scale-[0.98] transition-transform"
          >
            Save Expense
          </button>
        </div>
      </div>
    </div>
  );
};

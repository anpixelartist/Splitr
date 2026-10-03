export type User = {
  id: string;
  name: string;
};

export type Group = {
  id: string;
  name: string;
  members: string[]; // User IDs
  createdAt: string;
};

export type Split = {
  userId: string;
  amount: number; // Exact amount this person is responsible for
};

export type Expense = {
  id: string;
  groupId: string;
  description: string;
  amount: number;
  paidBy: string; // User ID of the person who paid
  splits: Split[];
  createdAt: string;
};

export type Balance = {
  userId: string;
  netBalance: number; // Positive means they are owed, negative means they owe
};

export type SettlementTransaction = {
  from: string; // User ID who owes money
  to: string; // User ID who is owed money
  amount: number;
};

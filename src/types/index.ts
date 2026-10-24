export type User = {
  id: string;
  name: string;
};

export type Contact = {
  id: string;   // stable UUID, used as participant ID in groups
  name: string;
};

export type Group = {
  id: string;
  name: string;
  members: string[];                             // Firebase UIDs (users with the app)
  participants?: { id: string; name: string }[]; // Named participants (no app required)
  createdBy?: string;                            // Firebase UID of the creator (admin by default)
  admins?: string[];                             // Firebase UIDs with admin privileges
  memberNames?: Record<string, string>;          // uid → display name cache (no Firestore read needed)
  claims?: Record<string, string>;
  currency?: string;                             // ISO 4217 code, chosen at creation (older groups: USD)               // participant id → uid of the member who said "that's me"
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
  paidBy: string;       // User ID of the person who paid
  splits: Split[];
  createdBy?: string;   // Firebase UID of whoever added this expense
  createdAt: string;
  editedBy?: string;    // who last edited it
  editedAt?: number;    // ms, server time
};

export type Balance = {
  userId: string;
  netBalance: number; // Positive means they are owed, negative means they owe
};

export type SettlementTransaction = {
  from: string; // User ID who owes money
  to: string;   // User ID who is owed money
  amount: number;
};

export type SettlementRecord = {
  id: string;
  groupId: string;
  from: string;        // who paid
  to: string;          // who received
  amount: number;
  recordedBy?: string; // UID of whoever tapped "settle"
  createdAt: string;
  // Confirmation by the receiver (absent on older records = confirmed)
  status?: PaymentStatus;
  recordedAt?: number;  // ms, server time: the 7-day auto-confirm counts from here
  decidedBy?: string;   // who last changed the status
  decidedAt?: number;   // ms, server time
};

export type PaymentStatus = 'pending' | 'confirmed' | 'rejected' | 'cancelled';

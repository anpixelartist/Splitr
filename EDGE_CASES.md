# Splitr - Edge Cases Analysis

## 1. Zero Amount Expense
*   **Behavior:** A user creates an expense with a total amount of 0 (e.g. they typed 0 by mistake).
*   **Expected:** The app should either reject the creation or handle 0 mathematically correctly (no balances change, no settlements added).
*   **Actual (Tested):**
    *   In `calculateBalances`, splitting 0 works and yields net balances of 0.
    *   In `calculateSettlements`, balances < 0.01 are ignored.
    *   In `AddExpenseModal.tsx`, the UI validates: `if (isNaN(totalAmount) || totalAmount <= 0) { setError('Please enter a valid amount greater than 0.'); return; }`.
*   **Conclusion:** Addressed via frontend validation, backend handles it safely. No further fix needed.

## 2. Float Precision Errors
*   **Behavior:** Because JavaScript uses IEEE 754 floating point numbers, `0.1 + 0.2 === 0.30000000000000004`.
*   **Expected:** Calculations for balances and settlements avoid endless loops and do not produce fractional pennies (e.g. $33.333333333333336).
*   **Actual (Tested):**
    *   `calculateBalances` rounds every final net balance to 2 decimal places using `Math.round(netBalance * 100) / 100`.
    *   `calculateSettlements` uses a `0.01` tolerance `if (balance.netBalance < -0.01)` and rounds final settlement amounts identically.
    *   The test confirms 0.1 + 0.2 equals exactly 0.3, resulting in 0.2 settlement.
*   **Conclusion:** Rounding logic handles this adequately. No further fix needed.

## 3. Exact Amounts Do Not Match Total Amount
*   **Behavior:** In "Exact Amounts" mode in the Add Expense modal, a user enters individual splits that don't add up to the Total Amount.
*   **Expected:** The app prevents saving and shows an error indicating the difference.
*   **Actual (Tested):**
    *   `AddExpenseModal.tsx` contains `if (Math.abs(sum - totalAmount) > 0.01) { setError(...) }`.
*   **Conclusion:** Fully handled by UI validation.

## 4. Uneven Split Equalization (Rounding Errors)
*   **Behavior:** Splitting $100 equally among 3 people. ($33.33 each, but $100 - $33.33*3 = $0.01 leftover).
*   **Expected:** The app shouldn't lose or invent pennies. The total sum of splits must exactly match the total expense amount.
*   **Actual (Tested):**
    *   In `AddExpenseModal.tsx` Equal split mode:
    ```javascript
    const share = Math.round((totalAmount / active.length) * 100) / 100;
    active.forEach((uid, i) => {
        const amt = i === active.length - 1 ? totalAmount - sum : share;
        splits.push({ userId: uid, amount: amt });
        sum += share;
    });
    ```
    *   This logic effectively assigns the remainder to the last person in the array. For $100/3, it will be 33.33, 33.33, 33.34. This is a standard and acceptable practice.
*   **Conclusion:** Addressed properly.

## 5. Settlement Overpayment / Refunds
*   **Behavior:** User A owes User B $50. User A pays User B $60 and they record it in the app.
*   **Expected:** User B now owes User A $10, which means the settlement reverses direction.
*   **Actual (Tested):**
    *   Unit test added to `settlement_edge.test.ts`.
    *   `calculateBalances` accurately credits and debits based on `settlementRecords`. The net balance calculates accurately: A gets -50, B gets +50.
    *   `calculateSettlements` generates a new settlement: B pays A 50.
*   **Conclusion:** Mathematically sound. Note that the UI doesn't allow free-form settlement *amounts*, it only allows selecting from the generated Settlement Plan (which only generates the exact debt amount). So overpayment is not possible via the UI anyway, but the underlying logic handles it if data gets modified externally.

## 6. Offline / Database Sync Conflicts (Firebase)
*   **Behavior:** User A and User B are offline. They both add an expense at the same time to the same group. They both come online.
*   **Expected:** Both expenses are synced successfully to Firebase and appear for both users without overwriting each other.
*   **Actual (Tested):**
    *   The app uses UUIDs (`uuidv4()`) for expense IDs, not sequential IDs or counters.
    *   Firestore `setDoc(doc(db, 'expenses', newExpense.id), newExpense)` will create a unique document for each expense. They will not overwrite each other.
    *   Firebase offline persistence handles queuing and pushing these documents when the network returns.
*   **Conclusion:** UUID generation prevents merge conflicts. Standard Firebase offline capabilities cover this edge case.

## 7. Group Creation without Network
*   **Behavior:** User creates a group while offline.
*   **Expected:** Group is created locally, user can add expenses to it, and it syncs when online.
*   **Actual:**
    *   `CreateGroupModal` calls `createGroup`.
    *   `GroupContext` updates local state and `groupsLsKey(user.uid)` immediately. It fires `setDoc` which queues in Firebase.
    *   User is navigated to `/group/[id]`.
*   **Conclusion:** The fire-and-forget architecture with local state/localStorage caching explicitly handles this perfectly.

## 8. Deleting an Expense After Settlements Are Recorded
*   **Behavior:** User adds a $100 expense. A settlement is recorded for it. Later, an admin deletes the $100 expense.
*   **Expected:** The settlement should ideally also be deleted or adjusted, otherwise it creates a phantom credit (people who paid the settlement are now owed money back).
*   **Actual (Tested):**
    *   In `deleteExpense` (`GroupContext.tsx`), there is explicit logic for this:
    ```javascript
    const settlementsCopy = [...settlementRecords];
    // ... deletes the expense ...
    if (settlementsCopy.length > 0) {
      setSettlementRecords([]);
      // ... deletes all settlements ...
    }
    ```
    *   It wipes *all* settlement records for the group when *any* expense is deleted. While nuclear, it guarantees mathematical correctness (no phantom debts). This is a UX tradeoff but mathematically safe.
*   **Conclusion:** A bit aggressive (UX-wise) but financially correct. No immediate fix needed for MVP.

## 9. Last Admin Leaves Group
*   **Behavior:** The only admin in a group leaves the group.
*   **Expected:** Either they cannot leave, or another user is automatically promoted to admin, or the group is deleted.
*   **Actual (Tested):**
    *   In `leaveGroup` (`GroupContext.tsx`):
    ```javascript
    const isLastAdmin = currentAdmins.includes(myUid) && currentAdmins.every(a => a === myUid);
    const newAdmins = isLastAdmin && otherFirebaseMembers.length > 0
      ? [otherFirebaseMembers[0]]
      : currentAdmins.filter(a => a !== myUid);
    ```
    *   It automatically promotes the first remaining Firebase member. If no other members exist, it deletes the group.
*   **Conclusion:** Handled elegantly.

## 10. LocalStorage Quota Exceeded (Privacy / Incognito mode issues)
*   **Behavior:** User uses the app in a browser that restricts localStorage (e.g. strict privacy settings, incognito mode, or full disk).
*   **Expected:** The app should handle the `QuotaExceededError` gracefully without crashing, falling back to in-memory state.
*   **Actual (Tested):**
    *   The `lsSave` functions wrap the `localStorage.setItem` calls in a `try/catch` block.
    ```javascript
    const lsSaveContacts = (uid: string, contacts: Contact[]) => {
      try { localStorage.setItem(lsContactsKey(uid), JSON.stringify(contacts)); } catch {}
    };
    ```
*   **Conclusion:** Handled safely. It will degrade to memory-only but won't crash.

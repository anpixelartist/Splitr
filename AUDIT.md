# Splitr — Code Audit

Date: 2026-10-23 · Scope: every tracked file at commit `b6d7f45`

> Note: Node/npm are not installed on the machine where this audit ran, so `tsc`, `oxlint` and `vitest` were **not** executed. Everything below comes from reading the source.

## ✅ Resolution status (branch `fix/audit-phases`)

Every item below is fixed except **m3, m4 and m13** (see the end). How each fix was checked:
- `npm test`: 8 unit tests (money logic).
- `npm run test:rules`: 25 security-rules tests on the Firestore emulator. I also weakened a rule on purpose to confirm the tests catch it.
- A 26-check, two-user end-to-end run of the real app against the Auth and Firestore emulators, in headless Chromium at phone and laptop sizes: create, join, expenses, settle, delete, rename, Google upgrade, sign-out, second device.
- `tsc` (now `strict`), `oxlint` (0 errors) and `vite build` all pass.

| ID | Fix |
|---|---|
| C1 | Added `firestore.rules` + `firebase.json`. Members-only reads; only admins (or the last member) can delete; joining can add only yourself; creating can't overwrite. A non-member opening a link gets a **Join** screen. |
| C2 | Deleting an expense no longer touches settlements (covered by a unit test and the e2e run). |
| C3 | Anonymous → Google now uses `linkWithPopup` (same UID). If that Google account already exists, the app asks before switching. Falls back to redirect where popups are blocked. The Google name is adopted if the user never chose one. |
| C4 | Codes are 6 chars from `crypto.getRandomValues` over a 31-symbol alphabet with no look-alikes. Taken codes are skipped when online, and the rules make overwriting impossible. |
| M1 | Snapshots are always applied, except an empty *cache* answer on first load. |
| M2 | Group state is reset on account change. All localStorage keys are per-user, and old keys are migrated. |
| M3 | Sign-out records `signed-out` and shows the login page, even after a reload. |
| M4 | Every background write reports failures with an error toast. |
| M5 | Leaving with a non-zero balance is blocked. Departed members keep their name (`memberNames` is kept). |
| M6 | A rename is written into every group's `memberNames`, with a guard against retry loops. |
| M7 | Shows a "Group not found" page. Offline with no cache, it says so. |
| M8 | Promote/demote write the full `admins` list. |
| m1, m5, m6–m12, m14–m21 | Cent-exact `splitEqually` (tested); honest comment on the greedy algorithm; selection keyed by payer→payee; full purge via server query + batched deletes (also when the last member leaves); distinct offline/not-found join errors; join code trimmed; share falls back to the clipboard with a toast; grammar; late joiners included in equal splits; `strict` TS; multi-tab persistent cache; explicit local-only mode with a banner; `test`/`test:rules`/`deploy` scripts; README + `.env.example` + DEPLOYMENT.md; `App.css` removed; dev service worker off; aria-labels. |

**Found and fixed while working:**
- **B1.** `npm run build` was failing at `b6d7f45` (`Crown` doesn't accept `title`), so the app couldn't be built for production.
- **B2.** oxlint reported 2 errors (`useMockUser` called like a hook).
- **B3.** A listener race, caught by the e2e run: expense listeners subscribed before the server confirmed membership (a new group still uploading, or a join in flight). The rules rejected them, and a rejected listener stays dead, so the other member never received updates. Listeners now wait for a confirmed membership and retry.
- **B4.** First launch while offline hung on an awaited profile write. Profile writes are now background writes.
- **B5.** Changed the data layout to subcollections (`groups/{code}/expenses`, `/settlements`) so the members-only rules are path-based and simple. No live data existed, so nothing needed migrating.

**Not done (deliberately):**
- **m3** (clock-skew in "Settled" badges): cosmetic, and fixing it needs server timestamps throughout.
- **m4** (multi-currency) and **m13** (editing expenses, adding participants later): feature work, not defects.

---

Severity key: **🔴 Critical** = data loss, security hole or wrong money · **🟠 Major** = broken feature or a user-visible incorrect state · **🟡 Minor** = edge case, polish, tech debt

---

## 🔴 Critical

### C1. No Firestore security rules — the whole database is world-readable and writable
- There is no `firestore.rules` / `firebase.json` in the repo. All "admin" checks (`isAdmin` in `src/context/GroupContext.tsx:94`) exist only on the client.
- With the public web API key, anyone can read every group, expense and settlement, add themselves to any group, delete other people's groups, or rewrite expense amounts.
- `src/pages/GroupDetails.tsx` also loads `/group/:id` for any id, with no membership check. Opening a shared link shows the group and allows adding expenses **without joining**.

### C2. Deleting any expense wipes the group's entire settlement history
- `deleteExpense` (`src/context/GroupContext.tsx:334-355`) deletes **every** settlement record, locally and in Firestore.
- Settlements record money that actually changed hands. Example: B pays A $50 to settle, and later an admin deletes an unrelated typo expense. The $50 payment disappears, and B shows as owing A again.
- The code comment says this prevents "phantom debts". That reasoning is backwards: keeping the record is what keeps balances correct.

### C3. Signing in with Google from offline mode orphans all existing data
- `ProfileModal` → `signInWithGoogle` → `signInWithPopup` (`src/context/AuthContext.tsx:134`) creates a **new** UID instead of linking the anonymous account (`linkWithPopup`).
- Every group lists the old anonymous UID in `members`, so after "Sign in with Google to sync" the user's groups, contacts and balances are gone. The UI promises the opposite.

### C4. Group ID collisions can overwrite another group
- `createGroup` (`GroupContext.tsx:244`) uses `Math.random().toString(36).substring(2, 8)` and then calls `setDoc` without checking whether the ID exists. A collision silently replaces someone else's group.
- `Math.random().toString(36)` can also return fewer than 6 characters after the `0.`, which produces short or empty codes.

---

## 🟠 Major

### M1. Snapshot listeners ignore empty results, so deletions never sync
- `GroupContext.tsx:117, 178, 197`: `if (data.length > 0) { setX(data) }`.
- If another device deletes the last expense or settlement, or you leave or lose your last group, the list never empties. The stale localStorage cache keeps bringing the deleted items back.

### M2. One account's groups stay on screen after switching accounts
- The groups effect (`GroupContext.tsx:97-134`) never clears `groups` when `user` changes. Combined with M1, the next user (who has 0 groups) keeps seeing the previous user's groups on a shared device.
- Expense and settlement localStorage keys are not scoped per user either.

### M3. Signing out of Google immediately signs you back in anonymously
- After `signOut`, `onAuthStateChanged(null)` fires. `hasExistingLocalData()` is true because `splitr_*` keys remain, so the app calls `signInAnonymously` and drops the user into a fresh empty account instead of showing the login page (`AuthContext.tsx:107-126, 141-148`).

### M4. Write failures are silently swallowed
- Every write is `.catch(() => {})` (`GroupContext.tsx:262, 302, 317, 353, …`). If a write is rejected (for example by rules or quota), the UI shows "Expense saved!" and the item then disappears on the next snapshot with no error.

### M5. Leaving a group while owing money corrupts the display
- `leaveGroup` doesn't check balances. After someone leaves, their UID is no longer in `members`, so `getUsersInGroup` drops them. The settlement plan then shows **"Unknown owes …"**, and that debt can't be attributed or settled cleanly.

### M6. Renaming yourself doesn't update groups
- `updateUserName` updates only `users/{uid}`. Every group's `memberNames` cache keeps the old name, so other members see stale names forever.

### M7. Opening a non-existent group spins forever
- `GroupDetails.tsx:121`: if the group doc doesn't exist or can't be read, the page shows "Loading group..." indefinitely, with no "not found" message and no redirect.

### M8. Legacy-group promote removes the creator's admin rights
- `promoteToAdmin` (`GroupContext.tsx:357-366`): locally it builds `[createdBy, uid]`, but remotely it calls `arrayUnion(uid)` on a missing `admins` field. Firestore ends up with `[uid]`, and the creator silently loses admin.

---

## 🟡 Minor

### Money and logic
- **m1.** The equal-split remainder isn't rounded (`AddExpenseModal.tsx:53-58`). For example, $100/3 stores `33.340000000000003`.
- **m2.** `calculateSettlements` claims "minimum number of transactions". It's a greedy heuristic, which works well but isn't guaranteed minimal. The comment should be corrected.
- **m3.** "Settled" badges compare client-generated `createdAt` strings across devices, so clock skew can mislabel expenses.
- **m4.** The currency is hard-coded to `$` everywhere.
- **m5.** `SettleModal` tracks selection by array index. If the plan changes while the modal is open (remote update), the checkmarks point at the wrong rows.

### Data lifecycle
- **m6.** `deleteGroup` deletes only the expenses and settlements currently in memory. Any that weren't loaded are orphaned in Firestore.
- **m7.** When the last member leaves, `leaveGroup` deletes the group doc but leaves its expenses and settlements behind.
- **m8.** `joinGroup` fails with "Group not found" when offline, even for valid codes.

### UX
- **m9.** The join code isn't trimmed (`Home.tsx:32`), so `" ABC123"` fails.
- **m10.** The share button: when `navigator.share` is rejected (user cancels) the promise rejection goes unhandled, and the clipboard fallback gives no "copied" toast.
- **m11.** In the settlement plan, the copy reads "You owes …" (grammar).
- **m12.** `AddExpenseModal` captures `includedUsers` at mount, so members who join while the modal is open aren't included.
- **m13.** Members and participants can't be added to a group after creation, and expenses can't be edited (feature gaps).

### Tooling and config
- **m14.** `tsconfig.app.json` has no `"strict": true`, so null-safety isn't type-checked.
- **m15.** `enableIndexedDbPersistence` is deprecated in Firebase v10+ and only works in one tab. It should be replaced with `persistentLocalCache({ tabManager: persistentMultipleTabManager() })`.
- **m16.** Firebase silently falls back to `mock-key` config, so a production deploy with missing env vars "works" but syncs nothing.
- **m17.** `package.json` has no `test` script. Tests cover only `settlement.ts`.
- **m18.** `README.md` is still the Vite template: no setup steps, no env var list, no `.env.example`.
- **m19.** `src/App.css` (184 lines) is never imported (dead file).
- **m20.** The PWA service worker is enabled in dev (`devOptions.enabled: true`), which causes stale-cache confusion while developing.
- **m21.** Icon-only buttons have no `aria-label`s (accessibility).

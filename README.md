# Splitr

Split group expenses fairly and settle up. Works on phones and laptops as an installable app (PWA), syncs in real time between members, and keeps working offline.

- **Groups:** create a group, invite people with a link or a 6-character code, and add people who don't use the app as named participants
- **Expenses:** split equally (exact to the cent) or by exact amounts
- **Balances:** see who owes whom, with a short settlement plan
- **Settle up:** record payments and share a summary image
- **Admins:** promote or revoke admins, delete expenses or the whole group
- **Accounts:** Google sign-in (same data on every device) or "continue without account" (upgrade to Google later without losing anything)

Tech: React 19 + TypeScript + Vite + Tailwind, Firebase Auth + Cloud Firestore (offline persistence), `vite-plugin-pwa`.

## Getting started

```bash
npm install
npm run dev
```

Without Firebase keys, the app runs in **local-only mode**: everything is stored in your browser and nothing can be shared. To go online for free, follow **[DEPLOYMENT.md](DEPLOYMENT.md)**.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Type-check and production build into `dist/` |
| `npm test` | Unit tests (`src/**/*.test.ts`) |
| `npm run test:rules` | Firestore security-rules tests on the emulator (needs Java 11+) |
| `npm run lint` | oxlint |
| `npm run deploy` | Build and deploy hosting + rules to Firebase (merges to `main` deploy automatically once set up, see DEPLOYMENT.md) |

## Project layout

```
src/
  context/AuthContext.tsx   sign-in, account linking, profile & contacts
  context/GroupContext.tsx  groups, expenses, settlements (Firestore + local cache)
  lib/settlement.ts         balance maths, settlement plan, cent-exact splitting
  pages/, components/       UI
firestore.rules             who can read/write what (the real security boundary)
rules-tests/                tests for the rules
firebase.json               hosting + rules + emulator config
```

### Data model (Firestore)

```
users/{uid}                          { name, contacts[] }
groups/{code}                        { name, members[], admins[], memberNames{}, participants[], claims{}, createdBy }
groups/{code}/expenses/{id}          { description, amount, paidBy, splits[], createdBy, createdAt }
groups/{code}/settlements/{id}       { from, to, amount, recordedBy, createdAt }
```

The group code doubles as the invite: any signed-in user can look up a group by its exact code and join it. Expenses and settlements are visible to members only. Expenses can't be edited; admins delete wrong ones. When someone joins, they can claim a name-only participant ("that's me"): `claims` maps participant id to their uid and every balance is read through it, so no expense is rewritten. Admins can undo a claim. Recorded payments are never removed by deleting an expense, because they're money that really changed hands.

## License

Apache-2.0, see [LICENSE](LICENSE).

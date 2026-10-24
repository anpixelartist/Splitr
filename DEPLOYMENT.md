# Deploying Splitr (free, for phones and laptops)

This guide puts Splitr online at a URL like **`https://splitr-yourname.web.app`**. Everyone in your group can open it on a phone or laptop, install it like an app, and see the same data, synced live.

**Cost: $0.** It runs on Firebase's free **Spark plan**. That plan has **no credit card and no billing account**, so you can't be charged even by accident. The worst case is that if a daily free limit is hit, the app stops syncing until the limit resets the next day (see [Free-tier limits](#free-tier-limits-and-why-20-people-fit-easily)).

| Piece | Service | Free? |
|---|---|---|
| Website + app files | Firebase Hosting | ✅ Spark plan |
| Login (Google + "continue without account") | Firebase Authentication | ✅ Spark plan |
| Database (groups, expenses, payments) | Cloud Firestore | ✅ Spark plan |
| Security | `firestore.rules` (in this repo) | ✅ |

---

## One-time setup (about 20 minutes)

You need: a Google account, Node.js 20 or newer (`node -v`), and this repo.

### 1. Create the Firebase project
1. Go to <https://console.firebase.google.com> and click **Create a project**.
2. Name it, e.g. `splitr-yourname`. The **project ID** shown under the name becomes part of your URL. Write it down.
3. Google Analytics: **turn it off** (not needed).
4. When the project opens, check the plan badge at the bottom-left. It should say **Spark (no-cost)**. If anything ever asks you to "upgrade to Blaze", say **no**.

### 2. Create the database
1. Left menu → **Build → Firestore Database → Create database**.
2. Edition: **Standard**.
3. Location: pick the one **closest to your group** (e.g. `asia-south1` (Mumbai), `europe-west1`, `us-central1`). **This can't be changed later.**
4. Choose **Start in production mode**. Our own rules replace the defaults in step 6.

### 3. Turn on sign-in
1. Left menu → **Build → Authentication → Get started**.
2. **Sign-in method** tab:
   - **Google** → Enable → choose your email as the support email → Save.
   - **Anonymous** → Enable → Save. This powers "Continue without account".

### 4. Register the web app and copy its keys
1. **Project settings** (⚙️ next to "Project Overview") → **General** → scroll to **Your apps** → click the **`</>`** (Web) icon.
2. Nickname: `splitr-web`. Leave "Firebase Hosting" unchecked (we set it up in step 6). Click **Register app**.
3. You'll see a `firebaseConfig = { ... }` block. In the repo folder run:
   ```bash
   cp .env.example .env.local
   ```
   Then copy each value into `.env.local`:
   ```ini
   VITE_FIREBASE_API_KEY=AIza...
   VITE_FIREBASE_AUTH_DOMAIN=splitr-yourname.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID=splitr-yourname
   VITE_FIREBASE_STORAGE_BUCKET=splitr-yourname.firebasestorage.app
   VITE_FIREBASE_MESSAGING_SENDER_ID=1234567890
   VITE_FIREBASE_APP_ID=1:1234567890:web:abc123
   ```
   > These keys are **not secret**. They're built into the web page and everyone can see them. What protects your data is `firestore.rules`. `.env.local` is git-ignored anyway.

### 5. Connect this folder to your project
```bash
npm install
npx firebase-tools@15 login          # opens a browser, sign in with the same Google account
npx firebase-tools@15 use --add      # pick your project, type "default" as the alias
```
This creates a small `.firebaserc` file. It's fine to commit it.

### 6. Deploy
```bash
npm run deploy
```
This builds the app and uploads three things: the website, the **security rules**, and the database index config. When it finishes it prints your URL:

```
✔  Deploy complete!
Hosting URL: https://splitr-yourname.web.app
```

### 7. Allow Google sign-in from your site (required, once)

On phones, browsers block sign-in that hops between two websites, so Splitr signs people in on the same site they opened (`splitr-yourname.web.app`). Google has to be told that site is allowed:

1. Open the [Google Cloud console credentials page](https://console.cloud.google.com/apis/credentials) and pick your project.
2. Under **OAuth 2.0 Client IDs**, open **Web client (auto created by Google Service)**.
3. Under **Authorized redirect URIs**, add both of these, then **Save**:
   - `https://splitr-yourname.web.app/__/auth/handler`
   - `https://splitr-yourname.firebaseapp.com/__/auth/handler` (usually already there)

It can take a few minutes to apply. Without it, Google shows **"Error 400: redirect_uri_mismatch"** when someone signs in.

Open your URL and you're live 🎉

---

## Automatic deploys (optional, recommended)

Once set up, every merge to `main` goes live by itself: GitHub runs lint, unit tests, the build and the security-rules tests, and deploys the site and rules only if all of them pass. It costs nothing: GitHub Actions is free for public repos, and deploying uses no Firebase quota.

One-time setup (about 10 minutes):

1. **Create a deploy key.** [Google Cloud console → IAM & Admin → Service Accounts](https://console.cloud.google.com/iam-admin/serviceaccounts) → your project → **Create service account**, name it `github-deploy`. Give it the roles **Firebase Admin** and **Service Usage Consumer**. Then open it → **Keys → Add key → Create new key → JSON**. A `.json` file downloads.
2. **Add it to GitHub.** Your repo → **Settings → Secrets and variables → Actions → Secrets → New repository secret**. Name: `FIREBASE_SERVICE_ACCOUNT`. Value: the whole contents of the `.json` file. Then **delete the downloaded file**: anyone with it can deploy to your project.
3. **Add the app config.** Same page, **Variables** tab → add six variables with the same names and values as your `.env.local`: `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`. These are public anyway (they're in the built app), so variables are fine.
4. *(Optional)* **Approve each deploy by hand.** Settings → **Environments → production → Required reviewers** → add yourself. Each deploy then waits for your click.

Deploys show under the repo's **Actions** tab. To redeploy without a code change, open **Deploy → Run workflow**. If a missing setting would produce a broken build, the run stops and names the setting instead of deploying.

**Undo a bad release:** Firebase console → **Hosting → Release history** → **Roll back** on the previous release (instant). Then revert the commit on `main` so the next deploy doesn't bring it back.

---

## Using it on phones and laptops

Send everyone the URL. Each person:

- **Android (Chrome):** open the URL → menu ⋮ → **Add to Home screen / Install app**.
- **iPhone (Safari):** open the URL → Share button → **Add to Home Screen**.
- **Laptop (Chrome / Edge):** click the install icon in the address bar, or just bookmark it.

**Accounts:** ask everyone to tap **Sign in with Google**. That way the same account works on their phone *and* laptop. "Continue without account" works too, but that profile stays on one device. People can upgrade later from **Profile → Sign in with Google** and keep all their groups.

**Groups:** create a group, then tap the **share** icon in the group header. It sends a link (`…/group/ABC234`) that opens a "Join group" screen. People can also type the 6-character code on the home screen.

**Offline:** the app opens and works offline. New expenses are saved on the device and sync automatically when the connection comes back. Joining a group needs a connection.

---

## Updating the app later

After changing code:
```bash
npm test            # app logic tests
npm run deploy      # build + upload
```
Installed apps pick up the new version automatically the next time they're opened (sometimes it takes closing and reopening once).

Only the rules changed? `npx firebase-tools@15 deploy --only firestore:rules` is faster.

---

## Free-tier limits (and why 20 people fit easily)

Spark plan quotas (check current numbers at <https://firebase.google.com/pricing>):

| Resource | Free limit | Expected use, ~20 people |
|---|---|---|
| Firestore document reads | 50,000 / day | ~3,000–10,000 / day |
| Firestore writes | 20,000 / day | < 500 / day |
| Firestore deletes | 20,000 / day | a handful |
| Firestore storage | 1 GiB | < 5 MB (an expense is ~0.5 KB) |
| Hosting storage | 10 GB | ~1 MB per deploy |
| Hosting transfer | 360 MB / day | ~1 MB per person per new version (then cached) |
| Authentication (Google + anonymous) | free | 20 users |

Why reads stay low: the app keeps an offline copy of your data, so reopening it only downloads what changed. Opening a group costs about one read per expense, plus a couple more for the security check.

**If a limit is ever hit:** syncing pauses (saves show "Couldn't save…") until the quota resets at midnight US Pacific time. Data on devices isn't lost. To see usage: Firebase console → **Firestore Database → Usage**.

**No automatic backups** on the free plan. For a group of friends that's normally fine. If you want a copy, the Firebase console lets you browse every document.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Yellow banner **"Local-only mode"** on the live site | `.env.local` was missing or incomplete when you ran `npm run deploy`. Fix it and deploy again. |
| **Google sign-in fails** with `auth/unauthorized-domain` | Authentication → **Settings → Authorized domains** → add the domain you opened the app on. `*.web.app`, `*.firebaseapp.com` and `localhost` are there by default. |
| Google shows **"Error 400: redirect_uri_mismatch"** | Step 7 is missing: add `https://<the site you opened>/__/auth/handler` to the OAuth client's *Authorized redirect URIs*. |
| You pick a Google account, come back, and **nothing changes** (or a "Google sign-in didn't finish" banner) | The app was served from somewhere other than Firebase Hosting (`*.web.app` / `*.firebaseapp.com`), so sign-in still hops between sites. Set `VITE_FIREBASE_AUTH_DOMAIN` to the domain you serve from, do step 7 for it, and deploy again. On Firebase Hosting this is automatic. |
| "Couldn't save…" / permission errors | Make sure the rules are deployed: `npx firebase-tools@15 deploy --only firestore:rules`. |
| People see an old version | Close the app fully and reopen it. On a laptop, refresh with Ctrl+Shift+R. |
| "Could not start a session" on first open | The very first launch needs internet (to create the account). After that it works offline. |

---

## Developing locally

```bash
npm run dev                # with .env.local → uses your real Firebase project
                           # without it      → "local-only mode", data stays in the browser
npm test                   # unit tests (money logic)
npm run test:rules         # security-rules tests (needs Java 11+, uses the Firestore emulator)
```

**Testing without touching real data** (needs Java):
```bash
npx firebase-tools@15 emulators:start --only auth,firestore --project demo-splitr
VITE_USE_EMULATORS=true npm run dev     # in a second terminal
```
The emulator has a fake Google sign-in, so you can test everything.

**Trying it on your phone while developing:** run `npm run dev -- --host` and open the printed `http://192.168.x.x:5173` address on a phone on the same Wi-Fi. "Continue without account" works there. For Google sign-in, add that IP under Authentication → Settings → Authorized domains.

---

## Alternatives considered

- **Vercel / Netlify / Cloudflare Pages** could host the website for free too, but you'd still need Firebase for login and the database. Hosting on Firebase keeps everything in one console, and serving the sign-in handler from the same domain makes Google sign-in more reliable on iPhones.
- **Supabase** (free tier) would mean rewriting the data layer, and free projects pause after a week without use. Not worth it here.

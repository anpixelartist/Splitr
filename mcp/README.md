# Splitr connector (MCP server)

Lets people use Splitr from AI assistants: "What do I owe in the Goa Trip group?", "Who still hasn't paid me back?". The assistant answers from their real Splitr data, with exactly the access they have in the app.

It is one remote [MCP](https://modelcontextprotocol.io) server on **Cloudflare Workers (free plan)**. Claude, ChatGPT and (partly) Gemini all connect to it the same way. Nothing here is assistant-specific.

## How it works

```
Assistant ──OAuth 2.1 (DCR / CIMD, PKCE)──▶ Worker /authorize ──▶ "Sign in with Google" (Firebase Auth, same project as the app)
    │                                              │
    │                                              └─ Firebase refresh token → stored in the OAuth grant's props (encrypted)
    │
    └──MCP (Streamable HTTP) + access token──▶ Worker /mcp
                                                   │  refresh token → ID token (securetoken.googleapis.com, cached ~55 min)
                                                   └─ Firestore REST, Authorization: Bearer <the user's ID token>
                                                          └─ firestore.rules decide what they can read and write
```

- **No Admin SDK, no service account.** Every Firestore request carries the signed-in person's own ID token, so `firestore.rules` stay the single source of truth. The connector can't see or do anything the person couldn't do in the app. `test/integration` proves this against the emulators.
- **Same numbers as the app.** Balances, the settle-up plan, claims, payment statuses and money formatting come straight from `../src/lib` (`settlement.ts`, `claims.ts`, `payments.ts`, `money.ts`) and `../src/types`. Nothing is copied.
- **Secrets at rest.** `@cloudflare/workers-oauth-provider` stores tokens only as hashes and encrypts each grant's `props` (the Firebase refresh token) with a key that only the assistant's token unwraps. Cloudflare KV holds OAuth state only.
- **Stateless MCP.** Every request builds a fresh server bound to that person (`@modelcontextprotocol/server`'s `createMcpHandler`), so no Durable Objects are needed.
- **Guest (anonymous) accounts are refused** at sign-in, with a message telling the person to switch to Google in the app first.

| File | What it does |
| --- | --- |
| `src/index.ts` | Worker entry: OAuth provider, routes, `/mcp` |
| `src/server.ts` | MCP server and the list of tools |
| `src/auth.ts` | `/authorize` consent + Google sign-in page, refresh-time checks |
| `src/token.ts` | Firebase Secure Token exchange and ID-token cache |
| `src/firestore.ts` | Thin Firestore REST client that acts as the user |
| `src/group.ts` | Loads a group like the app does; names, balances, fuzzy group matching |
| `src/tools/*.ts` | One file per tool |

## Tools

All read-only for now (annotated `readOnlyHint: true`):

| Tool | Answers |
| --- | --- |
| `list_groups` | My groups: code, currency, number of people, my net balance in each |
| `get_group_summary` | One group (name, partial name or code; asks when ambiguous): people, balances, "who pays whom" |
| `list_expenses` | Recent expenses in a group, with an optional text filter and limit |
| `my_balances` | Across all groups: who I owe and who owes me, per person, per currency |
| `list_pending_payments` | Payments waiting for me to confirm, and mine waiting on others |

Write tools (`add_expense`, `record_payment`, `confirm_payment`, `reject_payment`) come in phase 2.

## One-time setup

You need a free Cloudflare account and access to the Splitr Firebase project. Run everything from this `mcp/` folder.

```bash
cd mcp
npm install
npx wrangler login                         # opens the browser
npx wrangler kv namespace create OAUTH_KV  # copy the printed id into wrangler.toml
```

**Secrets.** These are the same values as the app's `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN` and `VITE_FIREBASE_PROJECT_ID` in `.env.local`. They stay out of the repo, as they do for the app:

```bash
npx wrangler secret put FIREBASE_API_KEY
npx wrangler secret put FIREBASE_AUTH_DOMAIN     # e.g. <project>.firebaseapp.com
npx wrangler secret put FIREBASE_PROJECT_ID
```

**Deploy:**

```bash
npm run deploy
```

Wrangler prints the address, e.g. `https://splitr-mcp.<your-subdomain>.workers.dev`. The connector URL is that address plus `/mcp`.

**Allow Google sign-in from the Worker (required, once).** Firebase console → Authentication → Settings → **Authorized domains** → Add domain → `splitr-mcp.<your-subdomain>.workers.dev` (no `https://`). Without this, the sign-in page shows `auth/unauthorized-domain`.

## Add it to an assistant

**Claude** (claude.ai, desktop and mobile apps): Settings → Connectors → **Add custom connector** → name `Splitr`, URL `https://splitr-mcp.<your-subdomain>.workers.dev/mcp` → Add → **Connect**. A window opens: check the app name and the "Access goes to" host, tap **Sign in with Google to connect Splitr**, and pick your account. Free plans allow one custom connector.

**ChatGPT:** Settings → Apps & Connectors → Advanced settings → turn on **Developer mode**, then **Create** a connector with the same URL and Authentication **OAuth**. Leave Client ID and secret empty: ChatGPT registers itself. Which plans get developer mode has changed over time; check your account.

**Gemini:** as of October 2026, support for custom remote MCP servers depends on the Gemini product. Reports describe a Connected Apps option in the Gemini app for some personal accounts, admin-added servers in Gemini Enterprise/Business (Streamable HTTP over HTTPS only, which this server uses), and Gemini CLI as a separate MCP client. Most of these reports are not from Google's own documentation, so check it before relying on Gemini.

Disconnecting in the assistant ends access. Signing out of Google everywhere, or deleting the Splitr account, makes the next refresh fail, and the assistant asks the person to reconnect.

## Local development

Needs Java 21+ for the Firestore emulator.

```bash
# Terminal 1 (repo root): emulators with the real firestore.rules
npx firebase-tools@15 emulators:start --only auth,firestore --project demo-splitr

# Terminal 2 (mcp/)
cp .dev.vars.example .dev.vars
npm run dev                                  # http://localhost:8787/mcp
npx @modelcontextprotocol/inspector          # Transport: Streamable HTTP, URL above, then "Open Auth Settings" → Quick OAuth Flow
```

The emulator's sign-in popup offers fake Google accounts. Groups made in the app with `VITE_USE_EMULATORS=true npm run dev` show up in the connector.

```bash
npm test                  # unit tests (mocked Firestore): names, claims, balances, currencies, encoding
npm run test:integration  # against the Auth + Firestore emulators: no access to other people's groups
npm run typecheck
```

## Free-tier limits

Everything stays at $0 on Cloudflare's free plan and Firebase Spark:

- **Workers:** 100,000 requests/day. A tool call is one request, and an OAuth refresh is about one an hour per connected assistant.
- **KV:** 100,000 reads and 1,000 writes/day. Writes happen only when someone connects or a token refreshes.
- **Firestore (Spark):** 50,000 document reads/day. A tool call reads the person's groups and each group's expenses and payments: roughly (groups × documents per group). A person in 5 groups of 100 expenses uses about 500 reads per overview call, so ~20 people asking a few questions a day fit comfortably.
- **Bundle:** about 270 KB gzipped, against a 3 MB limit.

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Setup
cp .env.example .env          # fill in secrets
npm install                   # installs both workspaces
npm run db:generate           # prisma generate
docker compose up -d db       # start only Postgres
npm run db:migrate            # apply schema (prisma migrate dev)
npm run db:seed               # seed initial data

# Development
npm run dev                   # server on :3000 + web on :5173 (both in parallel)
npm run dev:server            # server only
npm run dev:web               # web only

# Build
npm run build                 # builds both workspaces

# Web typecheck
npm run typecheck --workspace=web   # tsc --noEmit in web/

# Generate secrets
openssl rand -hex 32          # use for SESSION_SECRET and TOKEN_ENC_KEY
```

Tests: `npm run test --workspace=server` (pure cores: stats, income, closure, pace, invest, `investHistoryCore`, `contributionFlowCore`…) and `npm run test --workspace=web` (`radialGeometry`, `radialSlots`, `format`, `amountKeys`, `investHistory`). Both plus `npm run typecheck --workspace=web` are the correctness gate.

## Architecture

This is an npm workspaces monorepo:
- `server/` — Fastify + Prisma + PostgreSQL
- `web/` — React + Vite PWA

### Server

**Entry point**: `server/src/index.ts` — registers Fastify plugins (CORS, cookie, session), mounts route groups, and starts a `node-cron` scheduler (client-info poll every 5 min).

**Route layout**:
- `POST /api/auth/*` — register/login/logout/me (`routes/auth.ts`)
- `/api/mono/*` — Mono token CRUD, accounts list, `POST /poll` (manual sync), `POST /sync-history` (background statement import for last ≤31 days, returns 202 immediately) (`routes/mono.ts`)
- `GET|POST /mono/hook/:secret` — Monobank webhook receiver (`routes/webhook.ts`, **no** `/api` prefix — must be publicly reachable; GET is Mono's validation ping)
- `/api/transactions` — list/filter, `PATCH /:id` (recategorize), `POST /:id/income-kind`, `POST /cash` (manual cash entry), `DELETE /:id` (`routes/transactions.ts`)
- `GET /api/dashboard` + `GET /api/dashboard/daily` — aggregated cycle stats, daily series (`routes/dashboard.ts`)
- `/api/categories` — CRUD for categories and rules (`routes/categories.ts`)
- `GET /api/history/months` + `GET /api/history/months/:ym` + `GET /api/history/categories/:id?ym=` — spending history: the month axis, one month's category breakdown, and one category's series with merchants (`routes/history.ts`; maths in the pure `mono/historyCore.ts`)
- `/api/investments/*` — plan, contributions, REIT valuations, suggestions; `GET /api/investments/history` — one merged timeline across OVDP/REIT/CRYPTO; `GET|PUT|DELETE /api/investments/drafts` — the step-flow draft (one per cycle×instrument) (`routes/investments.ts`; maths in the pure `mono/investHistoryCore.ts`)
- `/api/binance/*` — status, portfolio, series, sync; `PATCH /api/binance/conversions/:id` (link a conversion to a P2P order or mark `outOfTracking`, mutually exclusive, enforced server-side) and `GET /api/binance/conversions/:id/candidates` (P2P orders eligible to link, no later than the conversion) (`routes/binance.ts`; maths in the pure `binance/binanceCore.ts`)

**Auth**: cookie-based session via `@fastify/session`, persisted in Postgres through a custom Prisma store (`sessionStore.ts`, 30-day TTL — sessions survive restarts). `requireAuth` preHandler guards all `/api/*` routes except `/api/auth`. Session stores `userId`; use `currentUserId(req)` to read it.

**Mono token security**: tokens are AES-256-GCM encrypted in the DB (`server/src/crypto.ts`). `TOKEN_ENC_KEY` must be exactly 32 bytes (64 hex chars). Encrypted format: `iv:tag:ciphertext` (all hex).

**Mono sync pipeline** (`server/src/mono/`):
1. `sync.ts` — `pollAllTokens()` calls client-info for each token, upserts accounts/jars; `syncStatements(tokenId, fromTs, toTs)` imports statement history and feeds each item to `ingestStatementItem`.
2. `routes/webhook.ts` — receives live `StatementItem` events, calls `ingestStatementItem`.
3. `ingest.ts` — idempotent, deduped by `monoId`. Resolves account, detects internal transfers (by counterIban), calls `categorize`, finds the containing cycle, creates the Transaction.
4. `categorize.ts` — applies `CategoryRule` rows ordered by `priority` (first match wins); fallback to MCC map; else `UNCATEGORIZED + needsReview=true`.
5. `cycle.ts` — `findCycleForDate`, `openCycle`, `reassignTransactionCycles`, `computeCycleStats`.

`radialTaxonomy.ts` — the wheel's category taxonomy plus `ensureRadialTaxonomy()`, an idempotent boot hook (like `ensureWheelEnvelopeCategories`) that renames `Транспорт` → `Бензин`, creates the three new transport/tech categories and fills `radialSlot` only where it is still null. It lives at boot, not in `seed.ts`, because the box never runs the seed (`tsx` is a dev dependency).

**Money invariants** (enforced everywhere, never broken):
- All amounts are `BigInt` in **kopecks** (minimum currency units). Never use `number` or `float` for money.
- `amount` sign: negative = expense, positive = income (same convention as Monobank).
- `BigInt.prototype.toJSON` is patched at startup to serialize as string — clients receive money as `string`, must parse with `BigInt()`.
- `hold: true` transactions count as spending everywhere (daily limit, `spentToday`, charts) — the money is already blocked on the card; the hourly `refreshHolds` cron reconciles amounts on settlement.

**Time invariants**: all "day" math (daily limits, days-left, day boundaries) uses Kyiv-timezone helpers from `server/src/time.ts` (`ymdInTz`, `daysBetweenInclusive`, `sameLocalDay`; tz from `env.tz`) — never server-local `Date` day boundaries. A single tracking-start cutoff lives in `server/src/trackingStart.ts` (the date tracking started) and is consumed by the dashboard, the transaction list, the startup counter and the history axis — it hides older imported statements.

**Cycle logic** (the core budget engine, `cycle.ts`):
- A cycle spans `[startDate, endDate ?? +∞)`.
- `incomeTotal` = sum of `isIncome` transactions (requires user confirmation — not set automatically on ingest).
- Envelope budgets are computed on-the-fly: `incomeTotal * pct / 100`. **Not stored** to avoid drift.
- `dailyLimit = (livingBudget − livingSpent) / daysLeft` (self-levelling).
- A new cycle is triggered when a large-salary income (≥ `cycleAnchorMin`, default 40 000 UAH) arrives and is confirmed; the previous cycle is closed (`status=CLOSED`, `endDate` set).

**Settings singleton**: `Settings` table always has exactly one row (id=1). Read via `getSettings()` from `db.ts`; cached per-request, not long-lived.

**Scheduler** (cron in `index.ts`):
- Every 5 min: `pollAllTokens()` — syncs account balances and jar (Goals) balances.
- Phase 2 TODOs: evening reminder, cycle-end push, overspend forecast.

### Web

**Entry**: `web/src/main.tsx` → `App.tsx`. Auth state from `useAuth()` in `auth.tsx` (fetches `/api/auth/me`). If no user, shows `<Login />`.

**Routing**: React Router v6, tabs: `/` (Dashboard), `/transactions`, `/settings`. Transaction Review (radial-gesture categorization, `pages/Review.tsx`) is **not a route** — it's a modal overlay opened by the tab-bar FAB or the dashboard CTA (`reviewOpen` state in `App.tsx`). The person filter (by user id) is App-level state, a view-only filter passed to Dashboard. `pages/AddCash.tsx` is orphaned (no longer imported).

**Radial categorizer**: `components/RadialPicker.tsx` — 7-sector radial menu with a second-level fan of leaf categories. Direction picks the sector, distance opens the fan. Sector order (angle, colour, icon) is hardcoded in `radialSlots.ts` and **must never be sorted from data** — muscle memory is the point. Leaves come from the DB via `Category.radialSlot`/`radialOrder`/`shortName`; `buildSlots()` groups them. All gesture math lives in the pure `radialGeometry.ts` (`resolveAim` takes and returns the sector lock, so lock-release is unit-tested). Sector ≠ Envelope: the «Відкласти» sector mixes `INVESTMENT`, `GOAL_CONTRIBUTION` and `LIVING`. Used in two places — the Review queue and `RadialSheet` opened by tapping a row in Transactions.

**Styling**: dark "Gold Money" theme, hand-written CSS in `web/src/styles.css` with design tokens as `:root` CSS variables (`--bg`, `--gold`, …) — **no Tailwind**. The design source of truth (tokens, layout, swipe physics) is `docs/design/README.md` + the HTML prototype next to it. Icons: `lucide-react`; charts: Recharts.

**API layer**: `web/src/api.ts` — thin `fetch` wrapper with `credentials: "include"`. All money fields come back as `string` (BigInt serialized). `VITE_API_BASE` env var controls the API prefix (default `/api`; in Docker, proxied by Caddy).

**Money formatting**: `web/src/format.ts` — use these helpers for all display of amounts; never format raw kopecks ad-hoc.

**Money display rule**: show the precision you accept as input. Contributions are typed without a comma, so they render as whole hryvnia; a REIT valuation is typed with kopecks, so it renders with them; account balances and cycle leftovers carry kopecks. Plans and goals are whole hryvnia. `font-variant-numeric: tabular-nums` is applied via ~10 rules in `styles.css`; inline-styled amounts (`Investments.tsx`, `ReitPortfolio.tsx`) don't have it yet.

**Shared UI primitives**: `components/AmountSheet.tsx` is the single numpad for every amount in the app — its `decimals` prop swaps the comma key for «000», so the keyboard itself says whether kopecks exist here. `components/HelpSheet.tsx` renders long help in a modal sheet (the page owns which one is open, so only one can be). `toast.tsx` provides `useToast()` for reversible destructive actions: the row disappears immediately but the server call fires only on expiry, so undo sends nothing at all. `instruments.ts` holds instrument tokens and `instrumentHelp.tsx` their long-form help — neither lives in a page any more.

**Data fetching**: TanStack Query (`@tanstack/react-query`) throughout. `components/PullToRefresh.tsx` wraps scrollable pages to trigger refetch.

**Spending history**: `pages/History.tsx` (month axis + breakdown) and `pages/HistoryCategory.tsx` (one category's series, merchants, who paid), sharing `components/MonthBars.tsx`. Entered from the Витрати header. Calendar months, not cycles — cycles float with salary dates, so they cannot carry a stable comparison axis; the dashed reference is the **current** cycle's living budget, since no monthly limit exists in the model.

**Інвестиції**: `pages/Investments.tsx` — оболонка з трьома табами (`?tab=plan|portfolio|history`), самі таби в `components/invest/`. План — дія раз на місяць (бюджет + чекліст), Портфель — те, що читаєш (драбинка, проекція, REIT, Binance), Історія — одна вісь часу на три інструменти з `GET /api/investments/history` (чисте ядро `mono/investHistoryCore.ts`). Дефолтний таб рахується з `stepsDone` і не переписує URL. Групування стрічки по місяцях — чистий `web/src/investHistory.ts` під тестами. Внесок записується покроковим флоу (`components/invest/ContributionFlow.tsx`), стан кроку живе на сервері в `ContributionDraft` (одна чернетка на цикл×інструмент) — тому вихід у INZHUR і повернення не скидають прогрес; успішний `POST /contributions` прибирає чернетку сам (внесок і видалення чернетки — одна транзакція). Купонні параметри випуску заводяться з драбинки в Портфелі, а не в шиті внеску. Конвертації Binance без привʼязки до поповнення мають дію (`components/crypto/ConversionSheet.tsx`): привʼязати до P2P-поповнення або позначити `outOfTracking` — тоді витрата USDT не тягне пул, а монети лишаються в портфелі; позначені їдуть у згорнуту групу.

### Deployment

Docker Compose: `db` (Postgres 16) → `server` (Node) → `web` (nginx static) → `caddy` (internal HTTP router) → `cloudflared` (Cloudflare Tunnel). TLS is terminated at Cloudflare's edge; Caddy runs plain HTTP on `:80` inside the Docker network with no exposed ports. `cloudflared` connects outbound to Cloudflare using `CLOUDFLARE_TUNNEL_TOKEN` and routes traffic to `http://caddy:80`. The tunnel is configured in Cloudflare Zero Trust dashboard to point the domain at `http://caddy:80`.

### Key design decisions

- **Envelope vs. Category**: independent dimensions. Category = what was spent on (Groceries, Cafe). Envelope = which budget bucket (LIVING, ENTERTAINMENT, INVESTMENT). A transaction has both.
- **isIncome requires confirmation**: `ingestStatementItem` never sets `isIncome=true` directly. The user taps "confirm income" → the route sets `isIncome=true` and potentially calls `openCycle`.
- **Jar (Goals) balances via poll, not webhook**: Monobank doesn't guarantee webhook delivery for jar events, so balances are refreshed every 5 min via `client-info`.
- **Person attribution by token**: the user who owns the token that delivered the webhook is attributed as `userId`. If both users share an account (same `monoId` from two tokens), the transaction is deduped and `userId` set to `null` + `needsReview=true`.

### Reference docs

- `SPEC.md` — full product spec (Ukrainian), phases and feature list.
- `DATA_MODEL.md` — Prisma schema rationale.
- `CATEGORY_LIMITS.md` — plan for per-category limits inside the LIVING envelope.
- `docs/design/README.md` — UI design handoff: tokens, screen specs, swipe interaction details.

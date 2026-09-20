# Handoff: Spilnyi Budget — Dashboard + Transaction Review

Спільний сімейний бюджет-трекер (Mono-style), темна тема. Українською.
Two screens in scope for this handoff: **Dashboard (home)** and **Transaction Review (Tinder-style swipe)**, plus a working bottom tab bar with a center FAB.

---

## About the Design Files

The file in this bundle — `Budget App.dc.html` — is a **design reference created in HTML**. It is a working prototype showing intended look, layout, and behavior (including real drag physics on the swipe cards). **It is not production code to copy directly.**

Your task: **recreate these designs in the existing codebase** (see Target Stack below) using its established patterns and styling approach. The prototype is HTML, and the target frontend is **React-web**, so the markup and — importantly — the pointer-based swipe physics port over almost 1:1. Use the prototype as the visual + interaction source of truth alongside this README.

## Target Stack (this project)

**Monorepo:** `/server` (Fastify backend), `/web` (React frontend), `docker-compose.yml` + `Caddyfile`.

**Frontend — `/web`:** React + Vite + TypeScript · TanStack Query (data/cache/mutations) · Recharts (charts) · React Router v6 · PWA (vite-plugin-pwa, service worker, Web Push/VAPID) · **custom CSS file** (Tailwind is in spec but styling is actually a hand-written CSS file — put the tokens below in CSS variables there, do **not** add Tailwind config).

**Backend — `/server`:** Node.js + TypeScript · Fastify · Prisma + PostgreSQL · sessions (fastify-session) + argon2 · node-cron scheduler · Monobank tokens encrypted AES-256-GCM.

**Integrations:** Monobank Personal API — webhook (realtime) + client-info polling every 5 min; НБУ API — FX rates; Stooq/Yahoo — ETF price (Phase 3, not yet built).

**Deploy:** Docker Compose (app + Postgres + Caddy); Caddy reverse-proxy with auto-HTTPS (needed for the Mono webhook).

### How this design maps onto the stack
- **Screens/components** → React function components under `/web`; primitives (Card, Pill, EnvelopeBar, ReviewCard, TabBar, Sheet). Match copy/tokens exactly.
- **Styling** → the existing custom CSS file. Define the tokens (Colors/Radius/Typography below) as `:root` CSS variables (`--bg`, `--gold`, `--income`, …) and reference them; keep the dark theme global.
- **Navigation** → React Router v6. Tabs `Дашборд`/`Витрати`/`Налашт.` as routes; Review as a route or a modal overlay (`<dialog>` / portal). FAB + dashboard CTA navigate to / open Review.
- **Data & state** → TanStack Query for all server data (balances, envelopes, pending transactions, "can spend today", overspend forecast); `useMutation` for confirm/skip categorization with optimistic update so the card pops instantly. Local UI state (which card is dragging, active tab, person filter) stays in component state.
- **Swipe** → keep the prototype's pointer-events approach (`onPointerDown/Move/Up` + `setPointerCapture`) driving a CSS transform via a ref — it already works and is the lightest option. Optional upgrade: `framer-motion` (`drag="x"`, `useMotionValue`, `useTransform` for rotation + badge opacity). Do **not** reach for react-native/reanimated — this is web.
- **Charts** → the category donut → **Recharts** `PieChart` + `Pie` (`innerRadius`/`outerRadius`, `cornerRadius`), segment `Cell` fills from the donut palette, center total via a custom label or absolutely-positioned overlay. Envelope progress bars stay plain CSS (no chart lib needed).
- **PWA** → these two screens are the core install experience; ensure they render fully offline against cached TanStack Query data. Web Push/VAPID → overspend-forecast alerts (the warning banner) are a natural push trigger.
- **Realtime** → Mono webhook creates pending transactions; the Review CTA count and stack should reflect them (invalidate the pending-transactions query on webhook-driven updates / refetch).

## Fidelity

**High-fidelity (hifi).** Final colors, typography, spacing, and interactions. Recreate the UI pixel-close using your codebase's libraries. All hex values, sizes, and copy below are exact.

---

## Design Tokens

### Colors
| Token | Hex | Use |
|---|---|---|
| bg | `#0f1117` | App background / screens |
| bg-deep | `#05070c` / `#0b0d12` | Device backdrop, review overlay bg |
| card | `#1a1d27` | Cards, sheets, pills, tab-bar bg |
| gold (accent) | `#F5A623` | Hero number, active states, CTAs, FAB, progress |
| gold-lt | `#ffbe4d` / `#ffc55a` | Gradient partner, link hover |
| green (income) | `#4CAF50` | Income amounts, confirm action, income card edge |
| green-lt | `#7fe082` | Income gradient partner |
| red (expense) | `#EF5350` | Expense amounts, skip action, warning |
| coral | `#EF6C6C` | Near-limit envelope, "Розваги" |
| text | `#EDEFF5` | Primary text |
| text-muted | `#a4a9bd` | Secondary text |
| text-dim | `#8a90a2` / `#6c7185` | Tertiary / captions |
| tab-idle | `#5b6070` | Inactive tab icon/label |
| hairline | `rgba(255,255,255,.05–.09)` | Borders, dividers |
| donut palette | `#F5A623`, `#4FC3C6`, `#7C83FF`, `#EF6C6C`, `#4b5163` | Category segments |
| person: Партнер A | `#5B8DEF` | Avatar (initial "A") |
| person: Партнер B | `#E86BA5` | Avatar (initial "B") |

### Typography
- **Body / UI:** Manrope — weights 400/500/600/700/800.
- **Numbers / display:** Space Grotesk — weights 500/600/700. Used for the hero amount, all money values, counters, status-bar time.
- Key sizes: hero number **78px/700** (letter-spacing −.02em); screen section titles **17px/800**; card merchant **22px/800**; card amount **42px/700**; body **13–15px/600–700**; captions **10.5–12px/600–700**; uppercase kickers **11–12px/700, letter-spacing .1–.12em**.

### Radius & Elevation
- Radius: cards/sheets **18px**; swipe card **26px**; icon tiles **11–20px**; pills/chips **999px**; FAB **20px**; device screen **46px**.
- Shadows: hero number `0 6px 40px rgba(245,166,35,.28)`; swipe card `0 24px 50px rgba(0,0,0,.45)`; FAB `0 10px 26px rgba(245,166,35,.4)`.
- Spacing rhythm: screen h-padding **20px**; card padding **16px** (swipe card **22px**); section gaps **~26px**; tab bar height **88px** (with bottom safe area).

---

## Screens / Views

### 1. Dashboard (home)
**Purpose:** at-a-glance "how much can I spend today", budget health, quick entry to review.
**Layout:** vertical scroll, 20px h-padding, 100px bottom padding for tab bar. Sticky status bar on top.

Components top→bottom:
1. **Header row** — kicker `СПІЛЬНИЙ БЮДЖЕТ` (uppercase, dim) + line `Липень · цикл до 31-го`. Right: **person switcher** — segmented pill (`Партнер A` / `Партнер B`); active = gold text on `rgba(245,166,35,.18)`, idle = muted on transparent. Purely a view filter toggle.
2. **Hero** (centered): label `Можна витратити сьогодні` → **`₴847`** in gold, 78px, Space Grotesk, glow shadow → sub `Залишилось 12 днів · сьогодні вже ₴153`.
3. **Warning banner** (conditional, shown when overspend forecast): `rgba(239,83,80,.10)` bg, `rgba(239,83,80,.28)` border, radius 16. Triangle-alert icon + `За прогнозом — перевитрата ₴420 до кінця циклу` (the ₴420 bold red).
4. **Review CTA** (button → opens Review): gradient `linear-gradient(100deg,#221c10,#1a1d27)`, gold border. Icon tile + `6 транзакцій на розгляді` / `Свайпни, щоб розкидати по конвертах` + chevron.
5. **Envelopes** section (`Конверти` / `цей цикл`). Two cards, each: name + `₴spent / ₴budget` (spent in white, budget muted), a track `rgba(255,255,255,.06)` h9 radius999, fill gradient, caption below.
   - **На життя** — 68%, gold gradient `#F5A623→#ffbe4d`, caption `Залишилось ₴3 800 · 68%` (₴8 200 / ₴12 000).
   - **Розваги** — 78%, coral gradient `#EF6C6C→#ff8f8f`, caption coral `Залишилось ₴900 · майже вичерпано` (₴3 100 / ₴4 000).
6. **Accounts** (`Рахунки`). Card with two rows (1px divider): `Чорна картка` `•• 4417` → `₴23 400`; `Спільний рахунок` `Банка · Партнер A + Партнер B` → `₴8 150`. Amounts Space Grotesk. Left thumbnails are simple color tiles (black card / gold gradient).
7. **Donut** (`Витрати за категоріями`). 132px conic-gradient ring, 17px-inset hole (`#1a1d27`) with centered `₴10 400` / `за цикл`. Legend right: dot + name + amount for Продукти ₴4 200 (gold), Кафе ₴2 100 (teal), Покупки ₴1 800 (indigo), Транспорт ₴1 400 (coral), Інше ₴900 (grey). Conic stops: `#F5A623 0–40.4%`, `#4FC3C6 –60.6%`, `#7C83FF –74.1%`, `#EF6C6C –91.4%`, `#4b5163 –100%`.

### 2. Transaction Review (swipe)
**Purpose:** rapidly assign pending transactions to envelopes, Tinder-style.
**Layout:** full-screen overlay `#0b0d12`, entering with a `popIn` fade+scale (.22s).

- **Header:** close (✕) button left (`#1a1d27` tile), title `Розгляд транзакцій` center, counter `{done}/{total}` right in gold. Progress bar below (gold gradient fill, `width` transitions .35s).
- **Card stack:** up to 3 cards stacked, absolutely positioned. Behind cards `translateY(i*12px) scale(1 - i*0.045)`, opacity `1 / 0.9 / 0.75`, `zIndex 40-i`, only top card interactive.
- **Card (400px tall):** header row = person avatar (colored circle w/ initial) + name + date (right). Center = envelope-colored icon tile (66px) + merchant (22px/800) + amount (42px, Space Grotesk, green if income else red). Footer above a hairline = `ЗАПРОПОНОВАНО` kicker + envelope name, and an envelope chip (tinted bg + colored text) on the right.
- **Income card variant:** distinct 6px top edge gradient `#4CAF50→#7fe082` and an upward-arrow icon. (e.g. `Зарплата +₴42 000`.)
- **Actions:** two round buttons under the stack — ✕ (red-bordered, `actNo`) and ✓ (green, `actYes`) with center caption `Свайп або тап`. Buttons trigger the same fly-off as a swipe.
- **Done state** (stack empty): green check circle, `Готово!`, `Усі транзакції розкидано по конвертах`, gold button `На дашборд` (closes overlay).

### Bottom tab bar (persistent)
Height 88px, gradient-to-`#0f1117` bg, blur. Items: **Дашборд** (home icon), **Витрати** (list icon), **＋ FAB** (center, raised −6px, gold gradient, radius 20, shadow), **Налашт.** (gear icon). Active item = gold, idle = `#5b6070`. FAB and the dashboard CTA both open Review. `Витрати` / `Налашт.` are out of scope here — prototype shows an "in development" stub.

---

## Interactions & Behavior

**Swipe physics (core interaction):**
- Pointer/touch down on top card → capture pointer, disable transition, cursor grabbing.
- Move → `transform: translate(dx, dy*0.35) rotate(dx*0.05deg)`. Show hint badges: `ПІДТВЕРДИТИ` (green, top-left, −14°) fades in with `clamp(dx/90)`; `ПІЗНІШЕ` (red, top-right, +14°) with `clamp(-dx/90)`.
- Release: if `dx > 95` → fly right (confirm); if `dx < -95` → fly left (skip/later); else spring back (`transform: ''`, transition `.32s cubic-bezier(.2,.8,.3,1)`).
- Fly-off: transition `.34s ease-in`, `translate(±560px, -50px) rotate(±22deg)`, opacity→0; after 300ms pop the card from the stack and advance the counter.
- **Stack mapping:** keep prototype pointer-events as-is, or `framer-motion` `drag="x"` + `useTransform` for rotation/badge opacity and `withSpring`-style release. Confirm/skip → TanStack `useMutation` with optimistic update; on success invalidate the pending-transactions query.

**Navigation:** tab bar switches `tab` state; FAB + dashboard CTA open the review overlay; ✕ / `На дашборд` close it and return to Дашборд. Overlay is modal (covers everything except sits above tab bar z-order).

**Confirm vs skip semantics:** confirm (right/✓) = accept the suggested envelope and file the transaction; skip/later (left/✕) = defer for manual categorization. (Prototype just pops the card; wire to real persistence.)

## State Management
- `tab`: `'dash' | 'spend' | 'settings'` — active tab.
- `reviewOpen`: boolean — review overlay visibility.
- `person`: `'a' | 'b'` — dashboard view filter (currently visual toggle).
- `cards`: array of pending transactions (removed one-by-one as reviewed).
- `total`: count for the counter; `done = total - cards.length`.
- Transaction shape: `{ id, merchant, amount (formatted string, incl. sign), date, person, personColor, initial, envelope, envColor, envBg, iconPath, amountColor, income }`.
- Real app: all server data via **TanStack Query** (pending transactions, balances, envelope budgets, "can spend today", overspend forecast — computed server-side in Fastify). Categorization confirm/skip via `useMutation` (optimistic pop). Pending list refetched/invalidated when the Mono webhook pushes new transactions.

## Assets
- **Fonts:** Manrope + Space Grotesk (Google Fonts). Bundle equivalents in-app.
- **Icons:** inline single-path SVGs (Lucide-style, 24px, stroke 1.8–2, round caps): shopping-bag, coffee, car, film, package, arrow-up (income), plus home/list/gear (tabs), check, x, chevron, alert-triangle. Use **`lucide-react`** in `/web` (matches this style directly).
- **Donut chart:** rebuild with **Recharts** (`PieChart`/`Pie`/`Cell`), not the CSS conic-gradient used in the prototype.
- No raster images or logos — all UI is code-drawn.

## Files
- `Budget App.dc.html` — the full working prototype (dashboard + swipe review + tab bar + drag physics). Open in a browser to inspect look and interactions.

## Sample copy (all Ukrainian, keep as-is for i18n keys)
Merchants: Сільпо, Кав'ярня Світ, Bolt, Зарплата, Netflix, Нова Пошта. Persons: Партнер A, Партнер B. Amounts use `₴` prefix, thin-space thousands, leading `−`/`+`.

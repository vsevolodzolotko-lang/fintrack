---
name: verify
description: Прогнати зміну FinTrack end-to-end локально — ізольована БД, реальний сервер, браузер
---

# Верифікація FinTrack end-to-end

Рецепт, що працює (перевірено 2026-07-12). Локальний Postgres уже крутиться в Docker (`fintrack-db-1`).

## Ізольована БД + сервер

```bash
docker exec fintrack-db-1 psql -U fintrack -c "CREATE DATABASE fintrack_verify;"
cd server
export DATABASE_URL="postgresql://fintrack:change-me-strong@localhost:5432/fintrack_verify?schema=public"
npx prisma db push --skip-generate     # міграцій у репо немає — тільки schema.prisma
npx tsx prisma/seed.ts                 # категорії + MCC-правила
PORT=3000 SESSION_SECRET=$(openssl rand -hex 32) TOKEN_ENC_KEY=$(openssl rand -hex 32) npx tsx src/index.ts &
```

Порт 3000 — щоб працював vite-proxy (він захардкоджений на `localhost:3000` у `web/vite.config.ts`).

## Дані через реальний API

- `POST /api/auth/register` `{email, password, displayName}` — до 2 користувачів, ставить сесійну куку (curl `-c jar`).
- Дохід: вставити позитивну транзакцію SQL-ем (`amount` в копійках, потрібні поля: source, accountId, time, description, hold, envelope, isIncome, needsReview, autoCategorized, cashbackAmount, commissionRate), потім `POST /api/transactions/:id/income-kind` `{"kind":"SALARY","startsCycle":true}` — **без `startsCycle:true` цикл не відкриється** (суми ≥ 40 000 самої по собі не достатньо; перевірено 2026-07-29).
- Витрати: `POST /api/transactions/cash` `{amount(грн!, ДОДАТНЕ — знак ставить сервер), description, envelope, time?}` — приймає минулі дати, сам знаходить цикл.
- Скрипти з `PSQL="docker exec …"` запускати через `bash file.sh`: у zsh (дефолтний шелл) така змінна не розбивається на слова → `command not found`.
- hold-транзакції API не створює — тільки SQL (`hold=true`, `cycleId` підставити select-ом з активного циклу).
- Account перед транзакціями: `INSERT INTO "Account" (id, kind, "isGoals", title, balance, "currencyCode", "isHidden")` — колонки `updatedAt` немає.

## Браузер без установки Playwright

`playwright-core` у репо **не встановлений** — ставити в скретчпад, не в проєкт: `cd <scratchpad> && npm i playwright-core --no-save`, і імпортувати абсолютним шляхом до `node_modules/playwright-core/index.mjs`. Браузер не качається — беремо кешований Chromium:

```js
import { chromium } from "playwright-core";
const exe = os.homedir() + "/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const browser = await chromium.launch({ executablePath: exe });
```

`cd web && npx vite --port 5173`, логін через форму (`input[type=email]`, `input[type=password]`, `button[type=submit]`), чекати `text=Можна витратити сьогодні`, скриншот viewport 390×1400.

## Прибирання

Загасити фонові процеси, `DROP DATABASE fintrack_verify`.

## Ґотчі

- Гроші в JSON — рядки (BigInt), у `/cash` — гривні числом.
- Дашборд ховає картку «Темп витрат» при `pace.baselineDays < 1`.
- `?person=<userId>` фільтрує лише витрати цього юзера (hold від Mono без userId випадають з person-в'ю — очікувано).

import cookie from "@fastify/cookie";
import session from "@fastify/session";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import cron from "node-cron";
import { env } from "./env.js";
import { ensureRadialTaxonomy } from "./radialTaxonomy.js";
import { getSettings, prisma } from "./db.js";
import { prismaSessionStore } from "./sessionStore.js";
import { authRoutes } from "./routes/auth.js";
import { monoRoutes } from "./routes/mono.js";
import { webhookRoutes } from "./routes/webhook.js";
import { transactionRoutes } from "./routes/transactions.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { historyRoutes } from "./routes/history.js";
import { categoryRoutes } from "./routes/categories.js";
import { cycleRoutes } from "./routes/cycles.js";
import { settingsRoutes } from "./routes/settings.js";
import { userRoutes } from "./routes/users.js";
import { investmentRoutes } from "./routes/investments.js";
import { goalRoutes } from "./routes/goals.js";
import { binanceRoutes } from "./routes/binance.js";
import { pollAllTokens, refreshHolds } from "./mono/sync.js";
import { classifyForBackfill, type IncomeKind } from "./mono/incomeCore.js";
import { binanceConfigured } from "./binance/client.js";
import { refreshCurrentPrices } from "./binance/rates.js";
import { runSync as runBinanceSync } from "./binance/sync.js";
import { TRACKING_START } from "./trackingStart.js";

// BigInt → рядок у JSON (гроші зберігають точність на клієнті).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

const app = Fastify({ logger: true, trustProxy: true });

await app.register(cors, { origin: true, credentials: true });
await app.register(cookie);
// Ліміти вмикаються точково через `config.rateLimit` на роуті (логін/реєстрація).
// Ключ — IP клієнта; trustProxy бере його з X-Forwarded-For від Caddy/Cloudflare.
await app.register(rateLimit, { global: false });
await app.register(session, {
  secret: env.sessionSecret,
  store: prismaSessionStore,
  cookie: {
    secure: false, // TLS термінується на Cloudflare, внутрішній трафік HTTP
    httpOnly: true,
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 24 * 30, // 30 днів
  },
  saveUninitialized: false,
});

app.get("/api/health", async () => ({ ok: true }));

// Публічний webhook (без /api-префікса)
await app.register(webhookRoutes, { prefix: "/mono" });

// API
await app.register(authRoutes, { prefix: "/api/auth" });
await app.register(monoRoutes, { prefix: "/api/mono" });
await app.register(transactionRoutes, { prefix: "/api/transactions" });
await app.register(dashboardRoutes, { prefix: "/api/dashboard" });
await app.register(historyRoutes, { prefix: "/api/history" });
await app.register(categoryRoutes, { prefix: "/api/categories" });
await app.register(cycleRoutes, { prefix: "/api/cycles" });
await app.register(settingsRoutes, { prefix: "/api/settings" });
await app.register(userRoutes, { prefix: "/api/users" });
await app.register(investmentRoutes, { prefix: "/api/investments" });
await app.register(goalRoutes, { prefix: "/api/goals" });
await app.register(binanceRoutes, { prefix: "/api/binance" });

// ─── Планувальник ───
// Пул client-info (баланси + банки/цілі) кожні 5 хв. Rate limit 1 req/60s на токен — ок.
cron.schedule("*/5 * * * *", () => {
  pollAllTokens().catch((e) => app.log.error({ err: e }, "poll cron failed"));
});
// Щогодини: зняти застряглі hold пере-синком виписки (Mono не шле webhook
// при фіналізації блокування). Всередині — 62с паузи між рахунками (rate limit).
cron.schedule("0 * * * *", () => {
  refreshHolds().catch((e) => app.log.error({ err: e }, "refreshHolds cron failed"));
});
// Крипто-ціни кожні 15 хв (публічний ticker, вага 4) — no-op без Binance-ключів.
cron.schedule("*/15 * * * *", () => {
  if (!binanceConfigured()) return;
  refreshCurrentPrices().catch((e) => app.log.error({ err: e }, "crypto prices cron failed"));
});
// Історія Binance раз на добу (P2P/Convert/Spot + enrichment + авто-внески).
cron.schedule("30 4 * * *", () => {
  if (!binanceConfigured()) return;
  runBinanceSync().catch((e) => app.log.error({ err: e }, "binance sync cron failed"));
});
// TODO Фаза 2: вечірнє нагадування (settings.eveningReminder), кінець циклу, прогноз перевитрати.

// Ідемпотентний фолд скасованого конверта «Розваги»: модель 70/15/15 тримає
// всі витрати в одному поті. Історичні ENTERTAINMENT-рядки → LIVING. No-op,
// коли таких рядків не лишилось (виконується на кожному старті після db push).
async function foldEntertainmentEnvelope() {
  const [tx, cat, rule] = await Promise.all([
    prisma.transaction.updateMany({ where: { envelope: "ENTERTAINMENT" }, data: { envelope: "LIVING" } }),
    prisma.category.updateMany({ where: { defaultEnvelope: "ENTERTAINMENT" }, data: { defaultEnvelope: "LIVING" } }),
    prisma.categoryRule.updateMany({ where: { resultEnvelope: "ENTERTAINMENT" }, data: { resultEnvelope: "LIVING" } }),
  ]);
  if (tx.count || cat.count || rule.count) {
    app.log.info({ tx: tx.count, cat: cat.count, rule: rule.count }, "folded ENTERTAINMENT → LIVING");
  }
}

// Разовий ідемпотентний бекфіл під модель типів надходжень (див. incomeCore.ts).
// Міграції не версіонуються (прод — prisma db push), тож зміна даних живе тут.
// Ідемпотентність: усі оновлення фільтрують incomeKind=null, тож повторний
// старт нічого не робить, а вручну розібрані надходження не переписуються.
async function backfillIncomeKinds() {
  const openers = await prisma.cycle.findMany({
    where: { triggeredByTxId: { not: null } },
    select: { triggeredByTxId: true },
  });
  const openerIds = openers.map((c) => c.triggeredByTxId!).filter(Boolean);

  const candidates = await prisma.transaction.findMany({
    where: { incomeKind: null, amount: { gt: 0n }, time: { gte: TRACKING_START } },
    select: { id: true, amount: true, envelope: true, isIncome: true },
  });

  const openerSet = new Set(openerIds);
  const setByKind = new Map<IncomeKind, string[]>();
  const requeue: string[] = [];

  for (const t of candidates) {
    const verdict = classifyForBackfill({
      amount: t.amount,
      envelope: t.envelope,
      isIncome: t.isIncome,
      opensCycle: openerSet.has(t.id),
    });
    if (verdict.action === "set") {
      const list = setByKind.get(verdict.kind) ?? [];
      list.push(t.id);
      setByKind.set(verdict.kind, list);
    } else if (verdict.action === "requeue") {
      requeue.push(t.id);
    }
  }

  for (const [kind, ids] of setByKind) {
    await prisma.transaction.updateMany({
      where: { id: { in: ids } },
      data: { incomeKind: kind },
    });
  }
  if (requeue.length) {
    await prisma.transaction.updateMany({
      where: { id: { in: requeue } },
      data: { needsReview: true },
    });
  }

  // Розібране надходження не може висіти в черзі. Стан «incomeKind є, але
  // needsReview лишився» приходив із доброкфілових рядків isIncome=true +
  // needsReview=true: бекфіл ставив їм тип, а прапорець не чіпав. Наслідок —
  // CTA рахував їх (лічильник більше не фільтрує amount<0), а черга Розгляду
  // не показувала (надходження беруться лише з incomeKind=null), тож зняти
  // прапорець не було чим. Ідемпотентно: коли таких рядків нема — no-op.
  const unflagged = await prisma.transaction.updateMany({
    where: { amount: { gt: 0n }, incomeKind: { not: null }, needsReview: true },
    data: { needsReview: false },
  });

  if (setByKind.size || requeue.length || unflagged.count) {
    app.log.info(
      {
        set: Object.fromEntries([...setByKind].map(([k, v]) => [k, v.length])),
        requeued: requeue.length,
        unflagged: unflagged.count,
      },
      "backfilled incomeKind",
    );
  }
}

// Системні цілі-конверти для колеса Розгляду: розкидати витрату в інвестиції
// чи на білу карту (Цілі). Так рух виходить із витрат (statsCore рахує лише
// LIVING). Ідемпотентно за назвою — seed на боксі не ганяється (tsx — dev-dep).
async function ensureWheelEnvelopeCategories() {
  const wanted = [
    { name: "Інвестиції", color: "#4CAF50", env: "INVESTMENT" as const },
    { name: "На білу карту", color: "#F5A623", env: "GOAL_CONTRIBUTION" as const },
  ];
  for (const c of wanted) {
    const existing = await prisma.category.findFirst({ where: { name: c.name } });
    if (!existing) {
      await prisma.category.create({
        data: { name: c.name, color: c.color, defaultEnvelope: c.env, isSystem: true },
      });
    }
  }
}

async function start() {
  await getSettings(); // гарантувати singleton налаштувань
  await foldEntertainmentEnvelope();
  await backfillIncomeKinds();
  await ensureWheelEnvelopeCategories();
  await ensureRadialTaxonomy(prisma);
  await app.listen({ host: "0.0.0.0", port: env.port });
  app.log.info(`FinTrack server on :${env.port}`);
}

start().catch((e) => {
  app.log.error(e);
  prisma.$disconnect();
  process.exit(1);
});

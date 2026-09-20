import type { Envelope, Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma, getSettings } from "../db.js";
import { requireAuth, currentUserId } from "../auth.js";
import { openCycle, reassignTransactionCycles, findCycleForDate, undoCycleOpenedBy } from "../mono/cycle.js";
import {
  effectOfKind, incomeMatchKey, INCOME_KINDS, previewSplit, suggestStartsCycle,
} from "../mono/incomeCore.js";
import { TRACKING_START } from "../trackingStart.js";

const ENVELOPES = [
  "LIVING", "INVESTMENT", "INCOME",
  "INTERNAL_TRANSFER", "GOAL_CONTRIBUTION", "UNCATEGORIZED",
] as const;

export async function transactionRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  // Список з фільтрами: envelope, categoryId, userId, min/max суми, період, needsReview, cycleId.
  app.get("/", async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const where: Prisma.TransactionWhereInput = {
      // Never show transactions older than the tracking start date.
      time: { gte: TRACKING_START },
    };

    // ENTERTAINMENT лишився значенням enum у БД (additive-only схема), але
    // фільтрувати по ньому більше нема сенсу — тому звужений кортеж, не Envelope.
    if (q.envelope && ENVELOPES.includes(q.envelope as (typeof ENVELOPES)[number])) {
      where.envelope = q.envelope as Envelope;
    } else {
      // Ховаємо лише власні транзакції рахунку-контейнера «Цілі» (внутрішня
      // кухня білої карти). Вручну позначені «На білу карту» (GOAL_CONTRIBUTION
      // на звичайному рахунку) лишаються видимими — щоб їх можна було відмінити
      // через випадаючий конверт. Досі досяжні всі через ?envelope=GOAL_CONTRIBUTION.
      const settings = await getSettings();
      if (settings.goalsAccountId) {
        where.NOT = { envelope: "GOAL_CONTRIBUTION", accountId: settings.goalsAccountId };
      }
    }
    if (q.categoryId) where.categoryId = q.categoryId;
    // userId=none — нерозподілені витрати спільного рахунку
    if (q.userId) where.userId = q.userId === "none" ? null : q.userId;
    if (q.cycleId) where.cycleId = q.cycleId;
    if (q.needsReview === "true") where.needsReview = true;
    if (q.from || q.to) {
      where.time = {};
      if (q.from) where.time.gte = new Date(q.from);
      if (q.to) where.time.lte = new Date(q.to);
    }
    if (q.minAmount || q.maxAmount) {
      // фільтр по абсолютній сумі витрат — через два діапазони знака важко, тому по amount напряму
      where.amount = {};
      if (q.minAmount) where.amount.gte = BigInt(q.minAmount);
      if (q.maxAmount) where.amount.lte = BigInt(q.maxAmount);
    }

    const take = Math.min(Number(q.limit ?? 100), 500);
    const items = await prisma.transaction.findMany({
      where,
      orderBy: { time: "desc" },
      take,
      include: { category: true, account: { select: { title: true, kind: true } }, user: { select: { displayName: true } } },
    });

    // Нерозібрані надходження отримують підказку з IncomeRule + превʼю розподілу,
    // щоб картка в Review показала суми ДО тапу. Гроші рахуються на сервері —
    // клієнт лише відображає (інваріант BigInt-копійок).
    const pending = items.filter((t) => t.amount > 0n && t.incomeKind === null);
    if (pending.length === 0) return items;

    const keys = pending
      .map((t) => incomeMatchKey(t))
      .filter((k): k is string => k !== null);
    const rules = keys.length
      ? await prisma.incomeRule.findMany({ where: { matchKey: { in: keys } } })
      : [];
    const ruleByKey = new Map(rules.map((r) => [r.matchKey, r]));

    const s = await getSettings();
    const pcts = { investment: s.pctInvestment, goals: s.pctGoals, living: s.pctLiving };

    const pendingIds = new Set(pending.map((t) => t.id));
    return items.map((t) => {
      if (!pendingIds.has(t.id)) return t;
      const key = incomeMatchKey(t);
      const rule = key ? ruleByKey.get(key) : undefined;
      const split = previewSplit(t.amount, pcts);
      return {
        ...t,
        suggestedKind: rule?.kind ?? null,
        incomePreview: {
          ...split,
          suggestsNewCycle: rule?.startsCycle ?? suggestStartsCycle(t.amount, s.cycleAnchorMin),
        },
      };
    });
  });

  // Оновити категорію / конверт / особу вручну (вечірній розбір).
  app.patch("/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = z.object({
      categoryId: z.string().nullable().optional(),
      envelope: z.enum(ENVELOPES).optional(),
      userId: z.string().nullable().optional(),
      comment: z.string().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid" });

    // Скидання категорії (— категорія —) повертає картку в чергу розгляду;
    // призначення категорії/конверта — знімає з розгляду;
    // зміна лише особи/коментаря (тап по бейджу) прапорець не чіпає.
    const needsReview =
      parsed.data.categoryId === null
        ? true
        : parsed.data.categoryId !== undefined || parsed.data.envelope !== undefined
          ? false
          : undefined;

    const tx = await prisma.transaction.update({
      where: { id },
      data: { ...parsed.data, ...(needsReview === undefined ? {} : { needsReview }) },
    });
    return tx;
  });

  // Розібрати надходження: вибір одного з 5 типів (див. incomeCore.effectOfKind).
  //  • SALARY / OTHER_INCOME — дохід, ділиться 15/15/70. Для SALARY поле
  //    startsCycle перевизначає авто-підказку за порогом cycleAnchorMin.
  //  • REFUND / CASHBACK — мінус-витрата побуту (позитивний LIVING).
  //  • SELF_TRANSFER — нейтрально.
  // Кожен ручний вибір пише/оновлює IncomeRule — підказку на майбутнє.
  app.post("/:id/income-kind", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = z.object({
      kind: z.enum(INCOME_KINDS),
      startsCycle: z.boolean().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid" });
    const { kind, startsCycle } = parsed.data;

    const tx = await prisma.transaction.findUnique({ where: { id } });
    if (!tx) return reply.code(404).send({ error: "not_found" });
    if (tx.amount <= 0n) return reply.code(400).send({ error: "not_incoming" });

    const eff = effectOfKind(kind);
    await prisma.transaction.update({
      where: { id },
      data: {
        incomeKind: kind,
        envelope: eff.envelope,
        isIncome: eff.isIncome,
        needsReview: false,
        // Повернення/кешбек лишаються без категорії: вони зменшують сумарний
        // livingSpent, а не витрати конкретної категорії (див. спек).
        categoryId: null,
      },
    });

    // Запам'ятати вибір для цього відправника — як підказку, не як автозастосування.
    const key = incomeMatchKey(tx);
    if (key) {
      const rememberStartsCycle = kind === "SALARY" ? startsCycle ?? null : null;
      await prisma.incomeRule.upsert({
        where: { matchKey: key },
        create: { matchKey: key, kind, startsCycle: rememberStartsCycle, hits: 1 },
        update: { kind, startsCycle: rememberStartsCycle, hits: { increment: 1 } },
      });
    }

    if (kind === "SALARY") {
      const s = await getSettings();
      const shouldStart = startsCycle ?? suggestStartsCycle(tx.amount, s.cycleAnchorMin);
      if (shouldStart) {
        const existing = await findCycleForDate(tx.time);
        if (!existing || existing.startDate < tx.time) {
          await openCycle(tx.time, tx.id);
          await reassignTransactionCycles(tx.time);
          return { ok: true };
        }
      }
    }

    // Не відкриває цикл — просто прив'язати до циклу, що містить дату транзакції.
    // Стосується і REFUND/CASHBACK: вони мусять потрапити в цикл, щоб зменшити
    // його livingSpent.
    const c = await findCycleForDate(tx.time);
    if (c && tx.cycleId !== c.id) {
      await prisma.transaction.update({ where: { id }, data: { cycleId: c.id } });
    }
    return { ok: true };
  });

  // Скасувати розбір надходження → повернути в чергу.
  // Якщо воно відкривало цикл — відкат циклу (попередній відновлюється).
  app.post("/:id/unconfirm-income", async (req, reply) => {
    const { id } = req.params as { id: string };
    const tx = await prisma.transaction.findUnique({ where: { id } });
    if (!tx) return reply.code(404).send({ error: "not_found" });

    await undoCycleOpenedBy(id);
    await prisma.transaction.update({
      where: { id },
      data: { incomeKind: null, isIncome: false, envelope: "INCOME", needsReview: true },
    });
    return { ok: true };
  });

  // Готівкова витрата — швидка форма «+витрата».
  app.post("/cash", async (req, reply) => {
    const parsed = z.object({
      amount: z.number().positive(),         // грн, додатне (витрата)
      categoryId: z.string().nullable().optional(),
      envelope: z.enum(ENVELOPES).default("LIVING"),
      description: z.string().min(1),
      userId: z.string().nullable().optional(),
      time: z.string().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const time = parsed.data.time ? new Date(parsed.data.time) : new Date();
    const cents = BigInt(Math.round(parsed.data.amount * 100));

    // рахунок «Готівка» — один спільний віртуальний
    const cash = await prisma.account.upsert({
      where: { id: "cash" },
      update: {},
      create: { id: "cash", kind: "CASH", title: "Готівка", currencyCode: 980 },
    });

    const cycle = await findCycleForDate(time);
    const tx = await prisma.transaction.create({
      data: {
        source: "CASH",
        accountId: cash.id,
        userId: parsed.data.userId ?? currentUserId(req),
        time,
        amount: -cents, // витрата
        currencyCode: 980,
        description: parsed.data.description,
        categoryId: parsed.data.categoryId ?? null,
        envelope: parsed.data.envelope,
        cycleId: cycle?.id ?? null,
      },
    });
    return tx;
  });

  app.delete("/:id", async (req) => {
    const { id } = req.params as { id: string };
    await prisma.transaction.delete({ where: { id } });
    return { ok: true };
  });
}

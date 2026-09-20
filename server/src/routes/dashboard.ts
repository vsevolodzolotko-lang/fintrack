import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { requireAuth } from "../auth.js";
import { computeCycleStats } from "../mono/cycle.js";
import { computePaceCore } from "../mono/paceCore.js";
import { TRACKING_START } from "../trackingStart.js";

export async function dashboardRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  // Головний дашборд: числа поточного циклу + агрегати для чартів.
  // ?person=<userId> — режим «по людині»: фільтрує витрати, дохід спільний.
  app.get("/", async (req) => {
    const q = req.query as { person?: string };
    const person = q.person || undefined;

    const cycle = await prisma.cycle.findFirst({
      where: { status: "ACTIVE" },
      orderBy: { startDate: "desc" },
    });

    const stats = cycle ? await computeCycleStats(cycle, { personUserId: person }) : null;

    // Лічильник має точно відповідати тому, що показує черга Review. Надходження
    // тепер розбираються ТАМ САМО (першими картками), тож фільтра amount<0 більше
    // нема — інакше CTA обіцяв би менше карток, ніж у черзі.
    const needsReview = await prisma.transaction.count({
      where: { needsReview: true, envelope: { not: "GOAL_CONTRIBUTION" }, time: { gte: TRACKING_START } },
    });
    // Окремо — нерозібрані надходження та їх сума: банер називає конкретні гроші
    // («600 ₴ чекає на рішення»), бо поки тип не вибраний, бюджет неповний.
    const incomeAgg = await prisma.transaction.aggregate({
      where: { needsReview: true, amount: { gt: 0n }, incomeKind: null, time: { gte: TRACKING_START } },
      _count: true,
      _sum: { amount: true },
    });
    const incomeCandidates = incomeAgg._count;
    const incomeCandidatesAmount = incomeAgg._sum.amount ?? 0n;

    const accounts = await prisma.$queryRaw<
      { id: string; kind: string; isGoals: boolean; title: string; balance: bigint; currencyCode: number }[]
    >`SELECT id, kind, "isGoals", title, balance, "currencyCode" FROM "Account" WHERE "isHidden" = false`;

    // Витрати за категоріями в поточному циклі (для pie/bar).
    const byCategory = cycle
      ? await prisma.transaction.groupBy({
          by: ["categoryId"],
          where: {
            cycleId: cycle.id,
            amount: { lt: 0n },
            // лише реальні витрати: інвестиції/цілі/перекази/дохід — не витрати
            envelope: { notIn: ["INTERNAL_TRANSFER", "GOAL_CONTRIBUTION", "INVESTMENT", "INCOME"] },
            ...(person ? { userId: person } : {}),
          },
          _sum: { amount: true },
        })
      : [];

    const categories = await prisma.category.findMany({ select: { id: true, name: true, color: true } });
    const catMap = new Map(categories.map((c) => [c.id, c]));
    const spendingByCategory = byCategory.map((g) => ({
      categoryId: g.categoryId,
      name: g.categoryId ? catMap.get(g.categoryId)?.name ?? "Інше" : "Без категорії",
      color: g.categoryId ? catMap.get(g.categoryId)?.color ?? null : null,
      amount: (g._sum.amount ?? 0n) * -1n,
    }));

    // «Хто скільки» — завжди по повному циклу, незалежно від ?person.
    // hold-транзакції ВКЛЮЧЕНО (гроші вже витрачені) — консистентно з
    // діаграмою категорій та денним лімітом (computeCycleStats).
    const byPersonRaw = cycle
      ? await prisma.transaction.groupBy({
          by: ["userId"],
          where: {
            cycleId: cycle.id,
            amount: { lt: 0n },
            envelope: { notIn: ["INTERNAL_TRANSFER", "GOAL_CONTRIBUTION", "INVESTMENT", "INCOME"] },
          },
          _sum: { amount: true },
        })
      : [];
    const byPerson = byPersonRaw.map((g) => ({
      userId: g.userId,
      spent: (g._sum.amount ?? 0n) * -1n,
    }));

    // Розбивка витрат кожної людини за категоріями — та сама база, що й byPerson
    // (повний цикл, реальні витрати), незалежно від ?person. Для розгортання
    // рядка в «Хто скільки».
    const byPersonCategoryRaw = cycle
      ? await prisma.transaction.groupBy({
          by: ["userId", "categoryId"],
          where: {
            cycleId: cycle.id,
            amount: { lt: 0n },
            envelope: { notIn: ["INTERNAL_TRANSFER", "GOAL_CONTRIBUTION", "INVESTMENT", "INCOME"] },
          },
          _sum: { amount: true },
        })
      : [];
    const byPersonCategory = byPersonCategoryRaw.map((g) => ({
      userId: g.userId,
      categoryId: g.categoryId,
      name: g.categoryId ? catMap.get(g.categoryId)?.name ?? "Інше" : "Без категорії",
      color: g.categoryId ? catMap.get(g.categoryId)?.color ?? null : null,
      amount: (g._sum.amount ?? 0n) * -1n,
    }));

    // Темп витрат — по всій історії від початку трекінгу (не лише поточний
    // цикл), спільний для обох; та сама база витрат, що й «Хто скільки».
    const paceTxs = await prisma.transaction.findMany({
      where: {
        time: { gte: TRACKING_START },
        amount: { lt: 0n },
        envelope: { notIn: ["INTERNAL_TRANSFER", "GOAL_CONTRIBUTION", "INVESTMENT", "INCOME"] },
      },
      select: { time: true, amount: true },
    });
    const pace = computePaceCore(paceTxs, new Date());

    return { cycle: stats, needsReview, incomeCandidates, incomeCandidatesAmount, accounts, spendingByCategory, byPerson, byPersonCategory, pace };
  });

  // Динаміка витрат по днях (для лінійного чарту).
  app.get("/daily", async (req) => {
    const cycle = await prisma.cycle.findFirst({ where: { status: "ACTIVE" }, orderBy: { startDate: "desc" } });
    if (!cycle) return [];
    const txs = await prisma.transaction.findMany({
      where: { cycleId: cycle.id, amount: { lt: 0n }, envelope: "LIVING" },
      select: { time: true, amount: true, envelope: true },
      orderBy: { time: "asc" },
    });
    return txs;
  });
}

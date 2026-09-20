import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { requireAuth } from "../auth.js";
import { env } from "../env.js";
import { ymdInTz } from "../time.js";
import { TRACKING_START } from "../trackingStart.js";
import { computeCycleStats } from "../mono/cycle.js";
import {
  byPerson, categoryBreakdown, livingByMonth, monthsInRange, partialKind, topMerchants, ymInTz,
} from "../mono/historyCore.js";

/** Попередній місяць для "YYYY-MM", або null якщо його немає в діапазоні. */
function prevOf(ym: string, months: string[]): string | null {
  const i = months.indexOf(ym);
  return i > 0 ? months[i - 1] : null;
}

export async function historyRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  // Вісь місяців + сума кожного. Лінія бюджету — бюджет побуту ПОТОЧНОГО
  // циклу: місячного ліміту в апці не існує, livingBudget рахується на цикл
  // від його доходу. Тому графік відповідає на «чи вклалися б ми тоді в те,
  // що плануємо зараз» — і саме так видно, що бюджет застарів.
  app.get("/months", async () => {
    const sinceYmd = ymdInTz(TRACKING_START, env.tz);
    const nowYmd = ymdInTz(new Date(), env.tz);
    const months = monthsInRange(sinceYmd, nowYmd);

    const txs = await prisma.transaction.findMany({
      where: { time: { gte: TRACKING_START }, envelope: "LIVING" },
      select: { time: true, amount: true, envelope: true, categoryId: true },
    });

    const byMonth = livingByMonth(txs, env.tz);

    const cycle = await prisma.cycle.findFirst({
      where: { status: "ACTIVE" },
      orderBy: { startDate: "desc" },
    });
    const stats = cycle ? await computeCycleStats(cycle) : null;

    return {
      since: sinceYmd,
      limit: stats ? stats.livingBudget : null,
      months: months.map((ym) => ({
        ym,
        spent: byMonth.get(ym) ?? 0n,
        partial: partialKind(ym, sinceYmd, nowYmd),
      })),
    };
  });

  // Розбивка обраного місяця. Тягнемо і попередній місяць — дельта рахується
  // в ядрі, щоб роут лишався тонким.
  app.get("/months/:ym", async (req, reply) => {
    const { ym } = req.params as { ym: string };
    if (!/^\d{4}-\d{2}$/.test(ym)) return reply.code(400).send({ error: "invalid" });

    const sinceYmd = ymdInTz(TRACKING_START, env.tz);
    const nowYmd = ymdInTz(new Date(), env.tz);
    const months = monthsInRange(sinceYmd, nowYmd);
    if (!months.includes(ym)) return reply.code(404).send({ error: "no such month" });
    const prevYm = prevOf(ym, months);

    const txs = await prisma.transaction.findMany({
      where: { time: { gte: TRACKING_START }, envelope: "LIVING" },
      select: { time: true, amount: true, envelope: true, categoryId: true },
    });

    const rows = categoryBreakdown(txs, ym, prevYm, env.tz);
    const cats = await prisma.category.findMany({ select: { id: true, name: true, color: true } });
    const byId = new Map(cats.map((c) => [c.id, c]));

    return {
      ym,
      prevYm,
      categories: rows.map((r) => ({
        categoryId: r.categoryId,
        // Рядок повернень і рядок «без категорії» обидва мають categoryId
        // null — розрізняє їх знак суми.
        name: r.categoryId
          ? byId.get(r.categoryId)?.name ?? "Видалена категорія"
          : r.spent < 0n ? "Повернення" : "Без категорії",
        color: r.categoryId ? byId.get(r.categoryId)?.color ?? null : null,
        spent: r.spent,
        delta: r.delta,
      })),
    };
  });

  // Одна категорія: та сама вісь, звужена, плюс мерчанти й хто платив за
  // обраний місяць.
  app.get("/categories/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { ym } = req.query as { ym?: string };
    if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return reply.code(400).send({ error: "invalid ym" });

    const cat = await prisma.category.findUnique({
      where: { id },
      select: { id: true, name: true, color: true },
    });
    if (!cat) return reply.code(404).send({ error: "no such category" });

    const sinceYmd = ymdInTz(TRACKING_START, env.tz);
    const nowYmd = ymdInTz(new Date(), env.tz);
    const months = monthsInRange(sinceYmd, nowYmd);

    // amount: { lt: 0n } — явно, а не покладаючись на те, що позитивні суми
    // ніколи не мають categoryId (це вірно сьогодні, але PATCH /transactions/:id
    // приймає categoryId без перевірки знаку). Без цього фільтра категоризоване
    // повернення зробило б цей бар валовим, тоді як рядок розбивки місяця
    // лишається валовим завжди — і вони розійшлися б.
    const txs = await prisma.transaction.findMany({
      where: { time: { gte: TRACKING_START }, envelope: "LIVING", categoryId: id, amount: { lt: 0n } },
      select: { time: true, amount: true, envelope: true, categoryId: true, description: true, userId: true },
    });

    const byMonth = livingByMonth(txs, env.tz);
    const inMonth = txs.filter((t) => ymInTz(t.time, env.tz) === ym);

    return {
      categoryId: cat.id,
      name: cat.name,
      color: cat.color,
      months: months.map((m) => ({ ym: m, spent: byMonth.get(m) ?? 0n, partial: partialKind(m, sinceYmd, nowYmd) })),
      merchants: topMerchants(inMonth, 5),
      byPerson: byPerson(inMonth),
    };
  });
}

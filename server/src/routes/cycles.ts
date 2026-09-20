import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, currentUserId } from "../auth.js";
import { computeCycleStats } from "../mono/cycle.js";
import { suggestBudgets, type CategoryCycleSpend } from "../mono/suggestLimits.js";
import { computeLeftoverFact, validateSplit } from "../mono/closureCore.js";

const grnToKop = (grn: number) => BigInt(Math.round(grn * 100));

// Наступний цикл після закритого: openCycle ставить endDate попереднього
// рівно в startDate нового, тож шукаємо найраніший цикл від цієї межі.
async function nextCycleAfter(closed: { id: string; endDate: Date | null }) {
  if (!closed.endDate) return null;
  return prisma.cycle.findFirst({
    where: { id: { not: closed.id }, startDate: { gte: closed.endDate } },
    orderBy: { startDate: "asc" },
  });
}

export async function cycleRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.get("/", async () =>
    prisma.cycle.findMany({
      orderBy: { startDate: "desc" },
      select: { id: true, startDate: true, endDate: true, expectedEnd: true, status: true },
    })
  );

  // Пропозиції планів: медіана по закритих циклах, грудкуватість — по циклу :id.
  app.get("/:id/suggested-budgets", async (req, reply) => {
    const { id } = req.params as { id: string };
    const target = await prisma.cycle.findUnique({ where: { id } });
    if (!target) return reply.code(404).send({ error: "cycle not found" });

    const cycles = await prisma.cycle.findMany({
      where: { OR: [{ status: "CLOSED" }, { id }] },
      orderBy: { startDate: "asc" },
      select: { id: true },
    });
    const cycleIds = cycles.map((c) => c.id);

    const categories = await prisma.category.findMany({
      where: { defaultEnvelope: "LIVING" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });

    const txs = await prisma.transaction.findMany({
      where: {
        cycleId: { in: cycleIds },
        envelope: "LIVING",
        amount: { lt: 0n },
        hold: false,
        categoryId: { not: null },
      },
      select: { cycleId: true, categoryId: true, amount: true },
    });

    const targetCycleIndex = cycleIds.indexOf(id);
    const input: CategoryCycleSpend[] = categories.map((cat) => {
      const perCycleSpent = cycleIds.map((cid) =>
        txs
          .filter((t) => t.cycleId === cid && t.categoryId === cat.id)
          .reduce((a, t) => a - t.amount, 0n)
      );
      const lastCycleTxAmounts = txs
        .filter((t) => t.cycleId === id && t.categoryId === cat.id)
        .map((t) => -t.amount);
      return { categoryId: cat.id, name: cat.name, perCycleSpent, lastCycleTxAmounts, targetCycleIndex };
    });

    const stats = await computeCycleStats(target);
    return suggestBudgets(input, stats.livingBudget);
  });

  // Прийняті значення → дефолти категорій.
  app.post("/:id/apply-budgets", async (req, reply) => {
    const parsed = z.object({
      items: z.array(
        z.object({
          categoryId: z.string(),
          plannedAmount: z.number().positive().nullable(), // грн
          reserveUpfront: z.boolean(),
        })
      ),
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid" });

    const updates = parsed.data.items.map((it) =>
      prisma.category.updateMany({
        where: { id: it.categoryId, defaultEnvelope: "LIVING" },
        data: {
          plannedAmount: it.plannedAmount != null ? BigInt(Math.round(it.plannedAmount * 100)) : null,
          reserveUpfront: it.reserveUpfront,
        },
      })
    );
    const results = await prisma.$transaction(updates);
    const totalUpdated = results.reduce((sum, r) => sum + r.count, 0);
    if (totalUpdated !== parsed.data.items.length) {
      return reply.code(400).send({ error: "some categoryIds not found or not LIVING" });
    }
    return { ok: true, updated: totalUpdated };
  });

  // Незакритий цикл = найсвіжіший CLOSED без CycleClosure, у якого є наступний.
  // Беремо лише найсвіжіший — старі закриті цикли ніколи не спливають,
  // тож бекфіл-міграція не потрібна.
  app.get("/pending-closure", async () => {
    const closed = await prisma.cycle.findFirst({
      where: { status: "CLOSED" },
      orderBy: { startDate: "desc" },
      include: { closure: true },
    });
    if (!closed || closed.closure) return null;

    const next = await nextCycleAfter(closed);
    if (!next) return null;

    const stats = await computeCycleStats(closed);
    const raw = stats.livingBudget - stats.livingSpent;
    const leftoverComputed = raw > 0n ? raw : 0n;

    // Факт: баланс побутової картки за мить до якірної ЗП нового циклу.
    const anchor = next.triggeredByTxId
      ? await prisma.transaction.findUnique({ where: { id: next.triggeredByTxId } })
      : null;
    const leftoverFact = anchor ? computeLeftoverFact(anchor.balance, anchor.amount) : null;

    return {
      cycleId: closed.id,
      startDate: closed.startDate,
      endDate: closed.endDate,
      nextCycleId: next.id,
      leftoverFact,
      leftoverComputed,
      delta: leftoverFact != null ? leftoverFact - leftoverComputed : null,
    };
  });

  // Рішення про розподіл: історія в CycleClosure + carry на наступному циклі.
  app.post("/:id/closure", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = z.object({
      leftoverAmount: z.number().min(0),   // грн, дробове (факт із копійками)
      toGoals: z.number().int().min(0),    // цілі гривні
      toInvest: z.number().int().min(0),   // цілі гривні
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid" });

    const cycle = await prisma.cycle.findUnique({ where: { id }, include: { closure: true } });
    if (!cycle) return reply.code(404).send({ error: "cycle_not_found" });
    if (cycle.closure) return reply.code(409).send({ error: "already_closed" });

    const next = await nextCycleAfter(cycle);
    if (!next) return reply.code(400).send({ error: "no_next_cycle" });

    const leftover = grnToKop(parsed.data.leftoverAmount);
    const split = validateSplit({
      leftover,
      toGoals: grnToKop(parsed.data.toGoals),
      toInvest: grnToKop(parsed.data.toInvest),
    });
    if ("error" in split) return reply.code(400).send({ error: split.error });

    await prisma.$transaction([
      prisma.cycleClosure.create({
        data: {
          cycleId: cycle.id,
          leftoverAmount: leftover,
          toGoalsAmount: split.toGoals,
          toInvestmentAmount: split.toInvest,
          toLivingAmount: split.toLiving,
          decidedById: currentUserId(req),
        },
      }),
      prisma.cycle.update({
        where: { id: next.id },
        data: {
          goalsCarryUah: split.toGoals,
          investCarryUah: split.toInvest,
          livingCarryUah: split.toLiving,
        },
      }),
    ]);
    return { ok: true };
  });

  // Переграти розподіл: знімаємо рішення і обнуляємо carry наступного циклу.
  // ovdpCarryUah не чіпаємо — він рахується окремо, в openCycle.
  app.delete("/:id/closure", async (req, reply) => {
    const { id } = req.params as { id: string };
    const cycle = await prisma.cycle.findUnique({ where: { id } });
    if (!cycle) return reply.code(404).send({ error: "cycle_not_found" });

    const next = await nextCycleAfter(cycle);
    await prisma.$transaction([
      prisma.cycleClosure.deleteMany({ where: { cycleId: id } }),
      ...(next
        ? [prisma.cycle.update({
            where: { id: next.id },
            data: { goalsCarryUah: 0n, investCarryUah: 0n, livingCarryUah: 0n },
          })]
        : []),
    ]);
    return { ok: true };
  });
}

import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma, getSettings } from "../db.js";
import { requireAuth } from "../auth.js";
import {
  computeGoalsSummary, validateAllocation, validateTransfer, computeClosedGoals,
  explainDeficit, goalDeductionFor,
  type GoalInput, type AllocationInput, type ClosedGoalInput,
} from "../mono/goalsCore.js";
import { TRACKING_START } from "../trackingStart.js";

const grnToKop = (grn: number) => BigInt(Math.round(grn * 100));

// Завантажити активні цілі + їх алокації + баланс контейнера → GoalsSummary.
async function loadSummary() {
  const s = await getSettings();
  const accountId = s.goalsAccountId ?? null;
  const container = accountId ? await prisma.account.findUnique({ where: { id: accountId } }) : null;
  const containerBalance = container?.balance ?? 0n;

  const goals = await prisma.goal.findMany({ where: { status: "ACTIVE" }, orderBy: { sortOrder: "asc" } });
  const goalIds = goals.map((g) => g.id);
  const allocs = goalIds.length
    ? await prisma.goalAllocation.findMany({ where: { goalId: { in: goalIds } }, select: { goalId: true, amount: true } })
    : [];

  const goalInputs: GoalInput[] = goals.map((g) => ({
    id: g.id, title: g.title, targetAmount: g.targetAmount, deadline: g.deadline, sortOrder: g.sortOrder,
  }));
  const allocInputs: AllocationInput[] = allocs.map((a) => ({ goalId: a.goalId, amount: a.amount }));
  const summary = computeGoalsSummary(containerBalance, goalInputs, allocInputs);
  const statusById = new Map(goals.map((g) => [g.id, g.status]));

  return {
    accountId,
    summary,
    goalsDto: summary.goals.map((g) => ({ ...g, status: statusById.get(g.id) ?? "ACTIVE" })),
  };
}

// Закриті цілі окремим запитом: у loadSummary свідомо лише ACTIVE, бо саме на
// цьому тримається рівність «відкладено = зарезервоване на картці».
// nulls: "last" обовʼязково — у Postgres DESC ставить NULL першими, і старі
// цілі без closedAt виринули б над свіжими покупками.
async function loadClosed() {
  const goals = await prisma.goal.findMany({
    where: { status: "COMPLETED" },
    orderBy: [{ closedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
  });
  const ids = goals.map((g) => g.id);
  const allocs = ids.length
    ? await prisma.goalAllocation.findMany({ where: { goalId: { in: ids } }, select: { goalId: true, amount: true } })
    : [];

  const inputs: ClosedGoalInput[] = goals.map((g) => ({
    id: g.id,
    title: g.title,
    targetAmount: g.targetAmount,
    spentAmount: g.spentAmount ?? 0n, // цілі, закриті до появи поля
    closedAt: g.closedAt,
  }));
  return computeClosedGoals(inputs, allocs.map((a) => ({ goalId: a.goalId, amount: a.amount })));
}

// Архів: цілі, які скасували, а не купили. У loadSummary їх свідомо немає —
// саме на цьому тримається повернення їхніх алокацій у вільний пул. Але з UI
// вони мають лишатись видимими, інакше ARCHIVED — глухий кут: єдиний вихід
// звідти, `reopen`, нема де натиснути.
async function loadArchived() {
  const goals = await prisma.goal.findMany({
    where: { status: "ARCHIVED" },
    orderBy: [{ createdAt: "desc" }],
  });
  const ids = goals.map((g) => g.id);
  const allocs = ids.length
    ? await prisma.goalAllocation.findMany({ where: { goalId: { in: ids } }, select: { goalId: true, amount: true } })
    : [];
  const balByGoal = new Map<string, bigint>();
  for (const a of allocs) balByGoal.set(a.goalId, (balByGoal.get(a.goalId) ?? 0n) + a.amount);

  return goals.map((g) => ({
    id: g.id,
    title: g.title,
    targetAmount: g.targetAmount,
    // Скільки було закріплено на момент скасування: рядок пояснює, звідки в
    // пулі раптом стало більше вільних грошей.
    allocated: balByGoal.get(g.id) ?? 0n,
  }));
}

// Списання з білої картки, ще не привʼязані до жодної цілі. Баланс контейнера
// вони вже зменшили, алокації — ні, тому саме вони пояснюють мінусове «Вільно».
// Свіжі перші; підсвічуємо ті, що покривають дефіцит (explainDeficit).
async function loadOutflows(accountId: string, unallocated: bigint) {
  const rows = await prisma.transaction.findMany({
    where: {
      accountId,
      envelope: "GOAL_CONTRIBUTION",
      amount: { lt: 0n },
      time: { gte: TRACKING_START },
      goalAllocation: null,
    },
    orderBy: { time: "desc" },
    take: 10,
    select: { id: true, time: true, description: true, amount: true },
  });
  const explains = explainDeficit(unallocated, rows);
  return rows.map((r) => ({ ...r, explains: explains.has(r.id) }));
}

async function goalBalance(goalId: string): Promise<bigint> {
  const rows = await prisma.goalAllocation.findMany({ where: { goalId }, select: { amount: true } });
  return rows.reduce((acc, r) => acc + r.amount, 0n);
}

export async function goalRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.get("/", async () => {
    const { accountId, summary, goalsDto } = await loadSummary();
    const closed = await loadClosed();
    const archived = await loadArchived();
    const outflows = accountId ? await loadOutflows(accountId, summary.unallocated) : [];
    return {
      container: {
        accountId,
        balance: summary.containerBalance,
        allocated: summary.allocated,
        unallocated: summary.unallocated,
      },
      goals: goalsDto,
      closed: closed.goals,
      closedSpentTotal: closed.spentTotal,
      archived,
      outflows,
    };
  });

  // Розвʼязати списання з білої картки. З цілі знімається лише те, чого не
  // покрив вільний пул (goalDeductionFor), запис привʼязується до транзакції
  // (sourceTxId), тож рядок зникає зі списку. asLiving — гроші пішли на побут:
  // транзакція стає звичайною витратою LIVING і йде в чергу Review за категорією.
  // Не автоматично: вихідний переказ може бути й покупкою цілі («Куплено»).
  app.post("/outflows/:txId/cover", async (req, reply) => {
    const { txId } = req.params as { txId: string };
    const parsed = z.object({
      goalId: z.string().optional(),
      asLiving: z.boolean().default(false),
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid" });

    const { accountId, summary, goalsDto } = await loadSummary();
    const tx = await prisma.transaction.findUnique({ where: { id: txId }, include: { goalAllocation: true } });
    if (!tx || !accountId || tx.accountId !== accountId || tx.amount >= 0n) {
      return reply.code(404).send({ error: "not_found" });
    }
    if (tx.goalAllocation) return reply.code(409).send({ error: "Це списання вже розвʼязано" });

    const deduction = goalDeductionFor(summary.unallocated, -tx.amount);
    const writes = [];
    if (deduction > 0n) {
      // одна активна ціль — береться сама; кілька — клієнт має обрати
      const goalId = parsed.data.goalId ?? (goalsDto.length === 1 ? goalsDto[0].id : undefined);
      if (!goalId) return reply.code(400).send({ error: "Оберіть ціль" });
      const goal = goalsDto.find((g) => g.id === goalId);
      if (!goal) return reply.code(404).send({ error: "Ціль не знайдено" });
      if (goal.balance < deduction) return reply.code(400).send({ error: "У цілі недостатньо коштів" });
      writes.push(prisma.goalAllocation.create({
        data: { goalId, amount: -deduction, sourceTxId: tx.id, note: tx.description },
      }));
    }
    if (parsed.data.asLiving) {
      writes.push(prisma.transaction.update({
        where: { id: tx.id },
        data: { envelope: "LIVING", categoryId: null, needsReview: true, autoCategorized: false },
      }));
    }
    if (writes.length) await prisma.$transaction(writes);
    return { ok: true, deducted: deduction };
  });

  app.post("/", async (req, reply) => {
    const parsed = z.object({
      title: z.string().min(1),
      targetAmount: z.number().positive(),
      deadline: z.string().datetime().nullable().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid" });
    const d = parsed.data;
    const accountId = (await getSettings()).goalsAccountId;
    if (!accountId) return reply.code(400).send({ error: "no_container" }); // спершу оберіть білу картку
    const last = await prisma.goal.findFirst({ where: { status: "ACTIVE" }, orderBy: { sortOrder: "desc" } });
    return prisma.goal.create({
      data: {
        accountId,
        title: d.title,
        targetAmount: grnToKop(d.targetAmount),
        deadline: d.deadline ? new Date(d.deadline) : null,
        sortOrder: (last?.sortOrder ?? -1) + 1,
      },
    });
  });

  app.patch("/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = z.object({
      title: z.string().min(1).optional(),
      targetAmount: z.number().positive().optional(),
      deadline: z.string().datetime().nullable().optional(),
      sortOrder: z.number().int().optional(),
      spentAmount: z.number().nonnegative().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid" });
    const d = parsed.data;

    // Сума покупки існує лише в закритої цілі. На активній це поле безмовно
    // з'їлося б і спливло аж на закритті — тож ловимо тут, на сервері.
    if (d.spentAmount !== undefined) {
      const g = await prisma.goal.findUnique({ where: { id } });
      if (!g) return reply.code(404).send({ error: "not_found" });
      if (g.status !== "COMPLETED") return reply.code(400).send({ error: "Сума покупки є лише в закритої цілі" });
    }

    return prisma.goal.update({
      where: { id },
      data: {
        ...(d.title !== undefined ? { title: d.title } : {}),
        ...(d.targetAmount !== undefined ? { targetAmount: grnToKop(d.targetAmount) } : {}),
        ...(d.deadline !== undefined ? { deadline: d.deadline ? new Date(d.deadline) : null } : {}),
        ...(d.sortOrder !== undefined ? { sortOrder: d.sortOrder } : {}),
        ...(d.spentAmount !== undefined ? { spentAmount: grnToKop(d.spentAmount) } : {}),
      },
    });
  });

  app.delete("/:id", async (req) => {
    const { id } = req.params as { id: string };
    await prisma.goal.update({ where: { id }, data: { status: "ARCHIVED" } });
    return { ok: true };
  });

  app.post("/:id/allocate", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = z.object({ amount: z.number() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid" });
    const amount = grnToKop(parsed.data.amount);

    const { summary } = await loadSummary();
    const bal = await goalBalance(id);
    const err = validateAllocation(summary.unallocated, bal, amount);
    if (err) return reply.code(400).send({ error: err });

    await prisma.goalAllocation.create({ data: { goalId: id, amount } });
    return { ok: true };
  });

  app.post("/transfer", async (req, reply) => {
    const parsed = z.object({
      fromGoalId: z.string(),
      toGoalId: z.string(),
      amount: z.number().positive(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid" });
    const { fromGoalId, toGoalId, amount: grn } = parsed.data;
    if (fromGoalId === toGoalId) return reply.code(400).send({ error: "same_goal" });
    const amount = grnToKop(grn);

    const fromBal = await goalBalance(fromGoalId);
    const err = validateTransfer(fromBal, amount);
    if (err) return reply.code(400).send({ error: err });

    const transferGroupId = randomUUID();
    await prisma.$transaction([
      prisma.goalAllocation.create({ data: { goalId: fromGoalId, amount: -amount, transferGroupId } }),
      prisma.goalAllocation.create({ data: { goalId: toGoalId, amount, transferGroupId } }),
    ]);
    return { ok: true };
  });

  // Закриття цілі: фіксуємо фактично витрачену суму. Алокації лишаються в історії цілі,
  // але summary бере лише ACTIVE — тож невитрачений залишок сам вертається у вільний пул
  // (`unallocated` = реальний баланс контейнера − алокації активних цілей).
  app.post("/:id/complete", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = z.object({ spentAmount: z.number().nonnegative() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Вкажіть фактично витрачену суму" });

    const goal = await prisma.goal.findUnique({ where: { id } });
    if (!goal) return reply.code(404).send({ error: "not_found" });
    if (goal.status !== "ACTIVE") return reply.code(400).send({ error: "Ціль уже закрита" });

    await prisma.goal.update({
      where: { id },
      data: { status: "COMPLETED", spentAmount: grnToKop(parsed.data.spentAmount), closedAt: new Date() },
    });
    return { ok: true };
  });

  // Повернення в активні не блокуємо навіть тоді, коли алокації цілі заганяють
  // вільний пул у мінус: гроші з картки вже пішли, а «Вернути» тиснуть саме
  // тоді, коли закрили помилково. Блокувати виправлення помилки гірше, ніж
  // показати чесний мінус — картка вміє «перевищення, звірте баланс».
  app.post("/:id/reopen", async (req, reply) => {
    const { id } = req.params as { id: string };
    const goal = await prisma.goal.findUnique({ where: { id } });
    if (!goal) return reply.code(404).send({ error: "not_found" });
    // І з COMPLETED, і з ARCHIVED: скасування — така сама помилка, яку треба
    // вміти відкотити, як і передчасне «Куплено». Без цього архів був глухим
    // кутом — ціль звідти не діставалась ні для купівлі, ні для повернення.
    if (goal.status === "ACTIVE") return reply.code(400).send({ error: "Ціль уже активна" });

    await prisma.goal.update({
      where: { id },
      data: { status: "ACTIVE", spentAmount: null, closedAt: null },
    });
    return { ok: true };
  });
}

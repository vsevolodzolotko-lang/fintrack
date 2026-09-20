import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth } from "../auth.js";
import { computeCycleStats } from "../mono/cycle.js";
import { computeInvestmentPlan, INSTRUMENT_ORDER, type InstrumentKind } from "../mono/investCore.js";
import { computeReitGrowth, type InzhurAccountFlow } from "../mono/reitCore.js";
import { computeOvdpProjection, expectedReturnUah, type OvdpRow } from "../mono/ovdpCore.js";
import { buildInvestHistory, type CryptoUnavailable } from "../mono/investHistoryCore.js";
import { computePortfolio } from "../binance/binanceCore.js";
import { loadCurrentPrices } from "../binance/rates.js";
import { binanceConfigured } from "../binance/client.js";
import { flowSteps, lotEstimate, sendAmount } from "../mono/contributionFlowCore.js";

// Розпізнавання поповнень інвестицій у Mono-транзакціях (підказка, не факт).
const INVEST_PATTERNS: { kind: InstrumentKind; needles: string[] }[] = [
  { kind: "REIT", needles: ["inzhur", "інжур"] },
  { kind: "CRYPTO", needles: ["whitebit", "white bit", "вайтбіт", "binance", "kuna"] },
  { kind: "OVDP", needles: ["овдп", "ovdp", "облігац", "icu", "дія"] },
];

function guessKind(text: string): InstrumentKind | null {
  const t = text.toLowerCase();
  for (const p of INVEST_PATTERNS) {
    if (p.needles.some((n) => t.includes(n))) return p.kind;
  }
  return null;
}

async function activeCycle() {
  return prisma.cycle.findFirst({ where: { status: "ACTIVE" }, orderBy: { startDate: "desc" } });
}

// Спільні завантажувачі БД для /plan, /reit і /history — один запит + один
// мапінг на кожен інструмент, щоб екрани не розходились у порахованому.

const toYieldBp = (p: unknown): bigint | null => (p == null ? null : BigInt(Math.round(Number(p) * 100)));

// Драбинка ОВДП: і сирі рядки (для картки /plan — id/note/quantity лишаються
// їй), і спроєктовані OvdpRow (для computeOvdpProjection/expectedReturnUah).
// Порядок обох масивів — один і той самий запит з maturityDate: "asc", тож
// /plan сміливо мапить ovdpRows[i] до ladderRows[i].
async function loadOvdpRows() {
  const rows = await prisma.investmentContribution.findMany({
    where: { kind: "OVDP", maturityDate: { not: null } },
    orderBy: { maturityDate: "asc" },
    select: {
      id: true,
      amountUah: true,
      bondCostUah: true,
      quantity: true,
      date: true,
      maturityDate: true,
      note: true,
      yieldPct: true,
      cashflows: {
        select: { date: true, kind: true, amountUah: true },
        orderBy: { date: "asc" },
      },
    },
  });

  const ovdpRows: OvdpRow[] = rows.map((r) => ({
    amountUah: r.amountUah,
    bondCostUah: r.bondCostUah,
    date: r.date,
    maturityDate: r.maturityDate,
    yieldPctBp: toYieldBp(r.yieldPct),
    cashflows: r.cashflows.map((c) => ({
      date: c.date,
      kind: c.kind as "COUPON" | "REDEMPTION",
      amountUah: c.amountUah,
    })),
  }));

  return { rows, ovdpRows };
}

// INZHUR REIT: внески + оцінки й ріст, тим самим ядром для /reit і /history.
async function loadReitGrowth() {
  const contribs = await prisma.investmentContribution.findMany({
    where: { kind: "REIT" },
    select: { date: true, amountUah: true },
  });
  const valuations = await prisma.investmentValuation.findMany({
    where: { kind: "REIT" },
    orderBy: { date: "asc" },
    select: { id: true, date: true, valueUah: true, note: true, freeUah: true, investedUah: true, dividendsUah: true },
  });

  // Рахунок INZHUR спільний з ОВДП, тож база REIT виводиться лише зі зведення:
  // облігаційні перекази — прихід на рахунок, `bondCostUah` — те, що з нього
  // пішло в папери (null → усе), купони й погашення — теж прихід кешем.
  const ovdp = await prisma.investmentContribution.findMany({
    where: { kind: "OVDP" },
    select: { date: true, amountUah: true, bondCostUah: true },
  });
  const ovdpCashflows = await prisma.ovdpCashflow.findMany({
    where: { contribution: { kind: "OVDP" } },
    select: { date: true, amountUah: true },
  });
  const now = new Date();
  const accountFlows: InzhurAccountFlow[] = [
    ...ovdp.map((o) => ({ date: o.date, inUah: o.amountUah, outUah: o.bondCostUah ?? o.amountUah })),
    // Графік купонів заведений наперед — на рахунку лежать лише вже виплачені.
    ...ovdpCashflows
      .filter((f) => f.date <= now)
      .map((f) => ({ date: f.date, inUah: f.amountUah, outUah: 0n })),
  ];

  const growth = computeReitGrowth(
    contribs.map((c) => ({ date: c.date, amountUah: c.amountUah })),
    valuations.map((v) => ({
      id: v.id, date: v.date, valueUah: v.valueUah, note: v.note, freeUah: v.freeUah,
      investedUah: v.investedUah, dividendsUah: v.dividendsUah,
    })),
    accountFlows,
  );

  return { valuations, growth };
}

export async function investmentRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  // Повний стан інвестиційного плану для оверлея.
  app.get("/plan", async () => {
    const cycle = await activeCycle();
    if (!cycle) {
      // Немає активного циклу — немає й сум, але тип `InvestTarget.flow` на
      // клієнті обовʼязковий (не `flow?`), тож послаблювати перевіркою тут
      // означало б брехати про форму даних. Нулі й той самий `steps`, що й
      // за активного циклу — PlanTab однаково рано виходить на `!data.active`.
      const binanceOn = binanceConfigured();
      return {
        active: false, cycleId: null,
        investmentBudget: 0n, incomeTotal: 0n, totalContributed: 0n, totalRemaining: 0n, stepsDone: 0,
        targets: INSTRUMENT_ORDER.map((kind) => ({
          kind, targetUah: 0n, contributedUah: 0n, remainingUah: 0n, done: false,
          flow: { sendUah: 0n, baseUah: 0n, carryUah: 0n, steps: flowSteps(kind, binanceOn), lotEstimate: null },
        })),
        cumulative: { OVDP: 0n, REIT: 0n, CRYPTO: 0n, total: 0n },
        ladder: [],
        ovdpProjection: null,
        ovdpCarryUah: 0n, investCarryUah: 0n, inzhurFreeUah: 0n,
      };
    }

    const stats = await computeCycleStats(cycle);

    const byKind = await prisma.investmentContribution.groupBy({
      by: ["kind"], where: { cycleId: cycle.id }, _sum: { amountUah: true },
    });
    const contributedByKind: Partial<Record<InstrumentKind, bigint>> = {};
    for (const g of byKind) contributedByKind[g.kind] = g._sum.amountUah ?? 0n;

    const plan = computeInvestmentPlan(
      stats.investmentBudget,
      { OVDP: cycle.pctOvdp, REIT: cycle.pctReit, CRYPTO: cycle.pctCrypto },
      contributedByKind,
      cycle.ovdpCarryUah,
    );

    // Накопичувально за весь час.
    const cumRows = await prisma.investmentContribution.groupBy({ by: ["kind"], _sum: { amountUah: true } });
    const cum: Record<string, bigint> = { OVDP: 0n, REIT: 0n, CRYPTO: 0n };
    for (const g of cumRows) cum[g.kind] = g._sum.amountUah ?? 0n;

    const { rows: ladderRows, ovdpRows } = await loadOvdpRows();
    const ovdpProjection = computeOvdpProjection(ovdpRows, new Date());
    const ladder = ladderRows.map((r, i) => ({
      ...r,
      expectedReturnUah: expectedReturnUah(ovdpRows[i]),
    }));

    // Ціна лота останньої купівлі — орієнтир для кроку «купи скільки влазить».
    // Беремо найсвіжіший внесок, де відомі і вартість паперів, і кількість.
    const priced = ladderRows
      .filter((r) => r.bondCostUah !== null && r.quantity !== null && r.quantity > 0)
      .sort((a, b) => b.date.getTime() - a.date.getTime());
    const lastUnitPrice = priced.length
      ? priced[0].bondCostUah! / BigInt(priced[0].quantity!)
      : null;
    const binanceOn = binanceConfigured();

    const latestReitVal = await prisma.investmentValuation.findFirst({
      where: { kind: "REIT" },
      orderBy: { date: "desc" },
      select: { freeUah: true },
    });

    // Орієнтир кроку 2 рахується від РЕАЛЬНО відправленої суми, коли чернетка
    // вже є, і від залишку цілі, коли флоу ще не починався. Інакше людина,
    // яка відправила менше за ціль, побачила б чужу кількість лотів.
    const drafts = await prisma.contributionDraft.findMany({ where: { cycleId: cycle.id } });

    const targetsWithFlow = plan.targets.map((t) => {
      const carry = t.kind === "OVDP" ? cycle.ovdpCarryUah : 0n;
      const send = sendAmount({ targetUah: t.targetUah, contributedUah: t.contributedUah, carryUah: carry });
      const draft = drafts.find((d) => d.kind === t.kind);
      const lotBasis = draft?.sentUah ?? send.amountUah;
      return {
        ...t,
        flow: {
          sendUah: send.amountUah,
          baseUah: send.baseUah,
          carryUah: send.carryUah,
          steps: flowSteps(t.kind, binanceOn),
          lotEstimate: t.kind === "OVDP" ? lotEstimate(lotBasis, lastUnitPrice) : null,
        },
      };
    });

    return {
      active: true,
      cycleId: cycle.id,
      investmentBudget: plan.investmentBudget,
      incomeTotal: stats ? stats.incomeTotal : 0n,
      totalContributed: plan.totalContributed,
      totalRemaining: plan.totalRemaining,
      stepsDone: plan.stepsDone,
      targets: targetsWithFlow,
      cumulative: { OVDP: cum.OVDP, REIT: cum.REIT, CRYPTO: cum.CRYPTO, total: cum.OVDP + cum.REIT + cum.CRYPTO },
      ladder,
      ovdpProjection,
      ovdpCarryUah: cycle.ovdpCarryUah,
      // Перенесення всього інвестиційного бюджету (не лише ОВДП) — потрібне
      // клієнту, щоб «15% від X» на плашці не суперечило фактичному бюджету.
      investCarryUah: stats.investCarryUah,
      inzhurFreeUah: latestReitVal?.freeUah ?? 0n,
    };
  });

  // Записати внесок (ручний або підтверджений з Mono-підказки).
  app.post("/contributions", async (req, reply) => {
    const parsed = z.object({
      kind: z.enum(["OVDP", "REIT", "CRYPTO"]),
      amountUah: z.number().positive(), // грн, додатне (переказано)
      maturityDate: z.string().optional(), // ISO — лише OVDP без графіка
      yieldPct: z.number().positive().optional(), // % річних — OVDP без графіка
      quantity: z.number().int().positive().optional(), // OVDP — к-сть облігацій
      bondCostUah: z.number().positive().optional(), // OVDP — вкладено в папери, грн
      cashflows: z
        .array(
          z.object({
            date: z.string(),
            kind: z.enum(["COUPON", "REDEMPTION"]),
            amountUah: z.number().positive(),
          }),
        )
        .optional(), // OVDP — графік виплат
      asset: z.string().optional(),
      note: z.string().optional(),
      monoTxId: z.string().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const d = parsed.data;

    const cycle = await activeCycle();
    if (!cycle) return reply.code(409).send({ error: "no_active_cycle" });

    if (d.monoTxId) {
      const dup = await prisma.investmentContribution.findUnique({ where: { monoTxId: d.monoTxId } });
      if (dup) return reply.code(409).send({ error: "already_recorded" });
    }

    const cf = d.kind === "OVDP" ? d.cashflows : undefined;
    const redemptionTs = (cf ?? [])
      .filter((c) => c.kind === "REDEMPTION")
      .map((c) => new Date(c.date).getTime());
    const maturityFromCf = redemptionTs.length ? new Date(Math.max(...redemptionTs)) : null;

    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.investmentContribution.create({
        data: {
          cycleId: cycle.id,
          kind: d.kind,
          amountUah: BigInt(Math.round(d.amountUah * 100)),
          bondCostUah:
            d.kind === "OVDP" && d.bondCostUah !== undefined ? BigInt(Math.round(d.bondCostUah * 100)) : null,
          quantity: d.kind === "OVDP" && d.quantity !== undefined ? d.quantity : null,
          source: "MANUAL",
          maturityDate: maturityFromCf ?? (d.maturityDate ? new Date(d.maturityDate) : null),
          yieldPct: d.kind === "OVDP" && !cf && d.yieldPct !== undefined ? d.yieldPct : null,
          asset: d.asset ?? null,
          note: d.note ?? null,
          monoTxId: d.monoTxId ?? null,
          ...(cf && cf.length
            ? {
                cashflows: {
                  create: cf.map((c) => ({
                    date: new Date(c.date),
                    kind: c.kind,
                    amountUah: BigInt(Math.round(c.amountUah * 100)),
                  })),
                },
              }
            : {}),
        },
      });
      // Запис закриває флоу. В одній транзакції з внеском: інакше внесок міг би
      // існувати, а клієнт побачити помилку й повторити запис.
      await tx.contributionDraft.deleteMany({ where: { cycleId: cycle.id, kind: d.kind } });
      return created;
    });

    return row;
  });

  app.delete("/contributions/:id", async (req) => {
    const { id } = req.params as { id: string };
    await prisma.investmentContribution.delete({ where: { id } });
    return { ok: true };
  });

  // Дозаповнити дохідність/дату погашення вже записаного випуску ОВДП.
  app.patch("/contributions/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = z.object({
      yieldPct: z.number().positive().optional(),
      maturityDate: z.string().optional(),
      quantity: z.number().int().positive().optional(),
      bondCostUah: z.number().positive().optional(),
      cashflows: z
        .array(
          z.object({
            date: z.string(),
            kind: z.enum(["COUPON", "REDEMPTION"]),
            amountUah: z.number().positive(),
          }),
        )
        .optional(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const d = parsed.data;

    const row = await prisma.investmentContribution.findUnique({ where: { id } });
    if (!row) return reply.code(404).send({ error: "not_found" });

    const cf = d.cashflows;
    const redemptionTs = (cf ?? [])
      .filter((c) => c.kind === "REDEMPTION")
      .map((c) => new Date(c.date).getTime());
    const maturityFromCf = redemptionTs.length ? new Date(Math.max(...redemptionTs)) : undefined;

    return prisma.$transaction(async (tx) => {
      if (cf && cf.length) await tx.ovdpCashflow.deleteMany({ where: { contributionId: id } });
      return tx.investmentContribution.update({
        where: { id },
        data: {
          ...(d.yieldPct !== undefined ? { yieldPct: d.yieldPct } : {}),
          ...(d.quantity !== undefined ? { quantity: d.quantity } : {}),
          ...(d.bondCostUah !== undefined ? { bondCostUah: BigInt(Math.round(d.bondCostUah * 100)) } : {}),
          ...(maturityFromCf
            ? { maturityDate: maturityFromCf }
            : d.maturityDate !== undefined
              ? { maturityDate: new Date(d.maturityDate) }
              : {}),
          ...(cf && cf.length
            ? {
                cashflows: {
                  create: cf.map((c) => ({
                    date: new Date(c.date),
                    kind: c.kind,
                    amountUah: BigInt(Math.round(c.amountUah * 100)),
                  })),
                },
              }
            : {}),
        },
      });
    });
  });

  // Mono-транзакції поточного циклу, схожі на поповнення інвестицій і ще не зараховані.
  app.get("/suggestions", async () => {
    const cycle = await activeCycle();
    if (!cycle) return [];

    const used = new Set(
      (await prisma.investmentContribution.findMany({
        where: { cycleId: cycle.id, monoTxId: { not: null } },
        select: { monoTxId: true },
      })).map((c) => c.monoTxId),
    );

    const txs = await prisma.transaction.findMany({
      where: { cycleId: cycle.id, amount: { lt: 0n } },
      select: { id: true, amount: true, description: true, counterName: true, time: true },
      orderBy: { time: "desc" },
      take: 100,
    });

    return txs
      .filter((t) => !used.has(t.id))
      .map((t) => ({ tx: t, guessedKind: guessKind(`${t.description} ${t.counterName ?? ""}`) }))
      .filter((x) => x.guessedKind !== null)
      .map((x) => ({
        txId: x.tx.id,
        amount: -x.tx.amount,           // додатна сума поповнення
        description: x.tx.description,
        date: x.tx.time,
        guessedKind: x.guessedKind,
      }));
  });

  // ── INZHUR REIT: ріст вартості за ручними знімками ──
  app.get("/reit", async () => {
    const { valuations, growth: g } = await loadReitGrowth();

    return {
      contributedTotal: g.contributedTotal,
      contributedAtAsOf: g.contributedAtAsOf,
      contributedAfterAsOf: g.contributedAfterAsOf,
      costBasisUah: g.costBasisUah,
      capitalGainUah: g.capitalGainUah,
      dividendsUah: g.dividendsUah,
      contributedSeries: g.contributedSeries,
      valuations,
      latestValue: g.latestValue,
      latestFreeUah: g.latestFreeUah,
      latestWorthUah: g.latestWorthUah,
      gainUah: g.gainUah,
      gainPct: g.gainPct,
      asOf: g.asOf,
    };
  });

  app.post("/reit/valuations", async (req, reply) => {
    const parsed = z.object({
      valueUah: z.number().positive(), // грн, додатне
      date: z.string().optional(),     // ISO
      note: z.string().optional(),
      freeUah: z.number().min(0).optional(),      // грн, вільні кошти на рахунку
      investedUah: z.number().min(0).optional(),  // грн, «Проінвестовано» з INZHUR
      dividendsUah: z.number().min(0).optional(), // грн, «Виплачено дивідендів»
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const d = parsed.data;

    const row = await prisma.investmentValuation.create({
      data: {
        kind: "REIT",
        valueUah: BigInt(Math.round(d.valueUah * 100)),
        date: d.date ? new Date(d.date) : new Date(),
        note: d.note ?? null,
        freeUah: BigInt(Math.round((d.freeUah ?? 0) * 100)),
        // null, а не 0: «не заносив» і «нуль» — різні стани, від першого база
        // падає назад на зведення рахунку, від другого прибуток = дивіденди.
        investedUah: d.investedUah === undefined ? null : BigInt(Math.round(d.investedUah * 100)),
        dividendsUah: d.dividendsUah === undefined ? null : BigInt(Math.round(d.dividendsUah * 100)),
      },
    });
    return row;
  });

  app.delete("/reit/valuations/:id", async (req) => {
    const { id } = req.params as { id: string };
    await prisma.investmentValuation.delete({ where: { id } });
    return { ok: true };
  });

  // ── Чернетка покрокового внеску ──
  const DRAFT_KIND = z.enum(["OVDP", "REIT", "CRYPTO"]);

  app.get("/drafts", async () => {
    const cycle = await activeCycle();
    if (!cycle) return [];
    return prisma.contributionDraft.findMany({ where: { cycleId: cycle.id } });
  });

  app.put("/drafts/:kind", async (req, reply) => {
    const kind = DRAFT_KIND.safeParse((req.params as { kind: string }).kind);
    if (!kind.success) return reply.code(400).send({ error: "bad_kind" });

    const parsed = z.object({
      step: z.number().int().min(1).max(3),
      sentUah: z.number().positive().optional(),   // грн
      boughtQty: z.number().int().positive().optional(),
      unitPriceUah: z.number().positive().optional(), // грн — ціна за штуку в момент купівлі (ОВДП, крок 2)
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const d = parsed.data;

    const cycle = await activeCycle();
    if (!cycle) return reply.code(409).send({ error: "no_active_cycle" });

    // Крок «купівля» існує лише для ОВДП (лоти) — REIT дробовий і крипта
    // записуються напряму. Без цієї пари перевірок REIT/CRYPTO застрягли б
    // на неіснуючому кроці 2, а boughtQty лежав би в чернетці, яку ніхто не читає.
    if (kind.data !== "OVDP" && d.step === 2) return reply.code(400).send({ error: "no_buy_step" });
    if (kind.data !== "OVDP" && d.boughtQty !== undefined) return reply.code(400).send({ error: "qty_not_applicable" });
    if (kind.data !== "OVDP" && d.unitPriceUah !== undefined) return reply.code(400).send({ error: "unit_price_not_applicable" });

    const existing = await prisma.contributionDraft.findUnique({
      where: { cycleId_kind: { cycleId: cycle.id, kind: kind.data } },
    });

    // Крок 2+ означає «уже відправив» — і саме sentUah крок запису показує
    // людині замість власного розрахунку. Без цієї перевірки повторний або
    // обірваний запит міг би підняти чернетку на кроці 3 без суми — шит без суми.
    if (d.step >= 2 && d.sentUah === undefined && existing?.sentUah == null) {
      return reply.code(400).send({ error: "sent_amount_required" });
    }

    const sent = d.sentUah !== undefined ? BigInt(Math.round(d.sentUah * 100)) : undefined;
    const unitPrice = d.unitPriceUah !== undefined ? BigInt(Math.round(d.unitPriceUah * 100)) : undefined;
    return prisma.contributionDraft.upsert({
      where: { cycleId_kind: { cycleId: cycle.id, kind: kind.data } },
      create: {
        cycleId: cycle.id,
        kind: kind.data,
        step: d.step,
        sentUah: sent ?? null,
        boughtQty: d.boughtQty ?? null,
        unitPriceUah: unitPrice ?? null,
      },
      update: {
        step: d.step,
        ...(sent !== undefined ? { sentUah: sent } : {}),
        ...(d.boughtQty !== undefined ? { boughtQty: d.boughtQty } : {}),
        ...(unitPrice !== undefined ? { unitPriceUah: unitPrice } : {}),
      },
    });
  });

  app.delete("/drafts/:kind", async (req, reply) => {
    const kind = DRAFT_KIND.safeParse((req.params as { kind: string }).kind);
    if (!kind.success) return reply.code(400).send({ error: "bad_kind" });
    const cycle = await activeCycle();
    if (!cycle) return { ok: true };
    // deleteMany, а не delete: скасувати те, чого немає, — не помилка.
    await prisma.contributionDraft.deleteMany({ where: { cycleId: cycle.id, kind: kind.data } });
    return { ok: true };
  });

  // ── Спільна історія трьох інструментів (таб «Історія») ──
  app.get("/history", async () => {
    const now = new Date();

    const contribRows = await prisma.investmentContribution.findMany({
      orderBy: { date: "desc" },
      select: {
        id: true, kind: true, cycleId: true, date: true, amountUah: true,
        quantity: true, source: true, note: true,
        cryptoP2POrder: { select: { assetQty: true } },
      },
    });
    const cashflowRows = await prisma.ovdpCashflow.findMany({
      where: { date: { lte: now } },
      select: { id: true, contributionId: true, date: true, kind: true, amountUah: true },
    });
    const conversionRows = await prisma.cryptoConversion.findMany({
      select: { id: true, tradeTime: true, fromAsset: true, fromAmount: true, toAsset: true, toAmount: true },
    });
    const cycleRows = await prisma.cycle.findMany({
      select: { id: true, startDate: true, ovdpCarryUah: true },
      orderBy: { startDate: "asc" },
    });

    // Купони — тим самим ядром і тим самим завантажувачем, що й проекція на
    // табі Портфель, щоб два екрани не рахували «отримано» по-різному.
    const { ovdpRows } = await loadOvdpRows();
    const projection = computeOvdpProjection(ovdpRows, now);

    // REIT — той самий loadReitGrowth/computeReitGrowth, що й у /reit.
    const { valuations: valuationRows, growth: reitGrowth } = await loadReitGrowth();

    // Крипта — рух ринку з того самого computePortfolio, що й картка Binance.
    let cryptoGainUah: bigint | null = null;
    let cryptoUnavailable: CryptoUnavailable | null = null;
    if (!binanceConfigured()) {
      cryptoUnavailable = "not_configured";
    } else {
      const orders = await prisma.cryptoP2POrder.findMany();
      const conversions = await prisma.cryptoConversion.findMany();
      if (!orders.length && !conversions.length) {
        cryptoUnavailable = "no_data";
      } else {
        const prices = await loadCurrentPrices();
        if (!prices.usdtUah) {
          cryptoUnavailable = "no_rate";
        } else {
          cryptoGainUah = computePortfolio(orders, conversions, prices.byAsset, prices.usdtUah)
            .totals.netProfitUah;
        }
      }
    }

    return buildInvestHistory({
      now,
      contributions: contribRows.map((c) => ({
        id: c.id,
        kind: c.kind,
        cycleId: c.cycleId,
        date: c.date,
        amountUah: c.amountUah,
        quantity: c.quantity,
        source: c.source,
        note: c.note,
        usdtQty: c.cryptoP2POrder ? c.cryptoP2POrder.assetQty.toString() : null,
      })),
      cashflows: cashflowRows.map((f) => ({
        id: f.id,
        contributionId: f.contributionId,
        date: f.date,
        kind: f.kind as "COUPON" | "REDEMPTION",
        amountUah: f.amountUah,
      })),
      valuations: valuationRows,
      conversions: conversionRows.map((x) => ({
        id: x.id,
        date: x.tradeTime,
        fromAsset: x.fromAsset,
        fromAmount: x.fromAmount.toString(),
        toAsset: x.toAsset,
        toAmount: x.toAmount.toString(),
      })),
      cycles: cycleRows,
      ovdpCouponsUah: projection?.couponsReceivedUah ?? 0n,
      reitGainUah: reitGrowth.gainUah,
      cryptoGainUah,
      cryptoUnavailable,
    });
  });
}

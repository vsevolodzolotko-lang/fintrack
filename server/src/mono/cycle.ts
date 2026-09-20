import type { Cycle } from "@prisma/client";
import { prisma, getSettings } from "../db.js";
import { addMonths, nextDayOfMonth } from "../time.js";
import { computeStatsCore, type CycleStats } from "./statsCore.js";
import { computeInvestmentPlan, type InstrumentKind } from "./investCore.js";

// Знайти цикл, у чий [startDate, endDate ?? +∞) потрапляє дата.
export async function findCycleForDate(date: Date): Promise<Cycle | null> {
  return prisma.cycle.findFirst({
    where: {
      startDate: { lte: date },
      OR: [{ endDate: null }, { endDate: { gt: date } }],
    },
    orderBy: { startDate: "desc" },
  });
}

// Недобір ОВДП циклу, що закривається = remainingUah його плану
// (ефективна ціль = цілогривнева база + його власний carry — ланцюжок).
// Дохід рахуємо БЕЗ якірної транзакції: на момент openCycle вона вже
// isIncome=true, але ще привʼязана до попереднього циклу (reassign — після).
async function ovdpCarryFromCycle(prev: Cycle | null, excludeTxId?: string): Promise<bigint> {
  if (!prev) return 0n;
  const inc = await prisma.transaction.aggregate({
    where: {
      cycleId: prev.id,
      isIncome: true,
      ...(excludeTxId ? { id: { not: excludeTxId } } : {}),
    },
    _sum: { amount: true },
  });
  // сирий бюджет: computeInvestmentPlan сам флорить до цілої гривні (як statsCore)
  // + investCarryUah: якщо в цей цикл влився залишок минулого місяця,
  // його інвест-бюджет був більший за голі 15% (див. statsCore).
  const investmentBudget =
    ((inc._sum.amount ?? 0n) * BigInt(prev.pctInvestment)) / 100n + prev.investCarryUah;

  const byKind = await prisma.investmentContribution.groupBy({
    by: ["kind"],
    where: { cycleId: prev.id },
    _sum: { amountUah: true },
  });
  const contributed: Partial<Record<InstrumentKind, bigint>> = {};
  for (const g of byKind) contributed[g.kind] = g._sum.amountUah ?? 0n;

  const plan = computeInvestmentPlan(
    investmentBudget,
    { OVDP: prev.pctOvdp, REIT: prev.pctReit, CRYPTO: prev.pctCrypto },
    contributed,
    prev.ovdpCarryUah,
  );
  const remaining = plan.targets.find((t) => t.kind === "OVDP")!.remainingUah;
  // захист від копійок у переносі (ціль наступного циклу має лишатись цілогривневою)
  return (remaining / 100n) * 100n;
}

// Відкрити новий цикл на «якірний» дохід (велика ЗП), закривши попередній.
export async function openCycle(startDate: Date, triggeredByTxId?: string): Promise<Cycle> {
  const s = await getSettings();

  // попередній активний цикл — знайти ДО закриття, щоб порахувати недобір ОВДП
  const prev = await prisma.cycle.findFirst({
    where: { status: "ACTIVE", startDate: { lt: startDate } },
    orderBy: { startDate: "desc" },
  });
  const ovdpCarryUah = await ovdpCarryFromCycle(prev, triggeredByTxId);

  // закрити активні цикли, що починались раніше
  await prisma.cycle.updateMany({
    where: { status: "ACTIVE", startDate: { lt: startDate } },
    data: { status: "CLOSED", endDate: startDate },
  });

  return prisma.cycle.create({
    data: {
      startDate,
      // Оцінка кінця циклу — наступна зарплата: день ЗП з налаштувань,
      // або те саме число наступного місяця, якщо день не задано.
      // Це лише база для денного ліміту; реальний кінець настає з приходом ЗП.
      expectedEnd: estimateCycleEnd(startDate, s.salaryDayOfMonth),
      triggeredByTxId,
      pctInvestment: s.pctInvestment,
      pctEntertainment: s.pctEntertainment,
      pctGoals: s.pctGoals,
      pctLiving: s.pctLiving,
      pctOvdp: s.pctOvdp,
      pctReit: s.pctReit,
      pctCrypto: s.pctCrypto,
      ovdpCarryUah,
    },
  });
}

// Оцінка дати наступної ЗП від старту циклу.
export function estimateCycleEnd(startDate: Date, salaryDayOfMonth: number | null): Date {
  return salaryDayOfMonth != null
    ? nextDayOfMonth(startDate, salaryDayOfMonth)
    : addMonths(startDate, 1);
}

// Переприв'язати транзакції (від дати) до правильного циклу за їх часом.
// Викликається після відкриття/закриття циклу.
export async function reassignTransactionCycles(fromDate: Date): Promise<void> {
  const txs = await prisma.transaction.findMany({
    where: { time: { gte: fromDate } },
    select: { id: true, time: true, cycleId: true },
  });
  for (const t of txs) {
    const c = await findCycleForDate(t.time);
    const target = c?.id ?? null;
    if (target !== t.cycleId) {
      await prisma.transaction.update({ where: { id: t.id }, data: { cycleId: target } });
    }
  }
}

// Те саме для інвест-внесків — вони теж прив'язані до циклу (за полем date).
export async function reassignContributionCycles(fromDate: Date): Promise<void> {
  const rows = await prisma.investmentContribution.findMany({
    where: { date: { gte: fromDate } },
    select: { id: true, date: true, cycleId: true },
  });
  for (const r of rows) {
    const c = await findCycleForDate(r.date);
    const target = c?.id ?? null;
    if (target !== r.cycleId) {
      await prisma.investmentContribution.update({ where: { id: r.id }, data: { cycleId: target } });
    }
  }
}

// Відкат циклу, який відкрив конкретний дохід (помилковий тап «Нова ЗП»):
// відновлює попередній цикл, видаляє помилковий і перепризначає
// транзакції та внески за датою. No-op, якщо цей tx нічого не відкривав.
export async function undoCycleOpenedBy(txId: string): Promise<void> {
  const opened = await prisma.cycle.findUnique({ where: { triggeredByTxId: txId } });
  if (!opened) return;

  // цикл, закритий у мить відкриття цього (endDate === opened.startDate) — відновити
  const prev = await prisma.cycle.findFirst({
    where: { status: "CLOSED", endDate: opened.startDate },
    orderBy: { startDate: "desc" },
  });
  if (prev) {
    // Рішення про розподіл залишку стосувалось саме цього закриття — знімаємо
    // разом із ним, інакше CTA більше ніколи не зʼявиться для цього циклу.
    await prisma.cycleClosure.deleteMany({ where: { cycleId: prev.id } });
    await prisma.cycle.update({ where: { id: prev.id }, data: { status: "ACTIVE", endDate: null } });
  }

  // видалити помилковий цикл — транзакції та внески отримають cycleId=null (SetNull)
  await prisma.cycle.delete({ where: { id: opened.id } });

  // повернути осиротілі транзакції/внески у відновлений (чи попередній) цикл
  await reassignTransactionCycles(opened.startDate);
  await reassignContributionCycles(opened.startDate);
}

// Головні обчислювані числа циклу (див. DATA_MODEL.md §Обчислювана логіка).
// personUserId — режим перегляду «по людині»: фільтруються лише витрати,
// дохід (а отже й бюджети) завжди спільний.
export async function computeCycleStats(
  cycle: Cycle,
  opts: { now?: Date; personUserId?: string } = {},
): Promise<CycleStats> {
  const { now = new Date(), personUserId } = opts;
  // hold-транзакції ВКЛЮЧЕНО: гроші вже заблоковані на картці, тож вони
  // мають зменшувати денний ліміт і показуватись у «сьогодні вже» —
  // інакше весь день на дашборді висить ₴0 (Mono фіналізує hold годинами).
  const txs = await prisma.transaction.findMany({
    where: { cycleId: cycle.id },
    select: { amount: true, envelope: true, isIncome: true, time: true, categoryId: true, userId: true },
  });
  const visible = personUserId
    ? txs.filter((t) => t.amount >= 0n || t.userId === personUserId)
    : txs;

  const contribs = await prisma.investmentContribution.aggregate({
    where: { cycleId: cycle.id },
    _sum: { amountUah: true },
  });

  // Внесено в «Цілі» цього циклу = надходження на білу карту (контейнер):
  // позитивні GOAL_CONTRIBUTION-транзакції за цикл.
  const goalsContrib = await prisma.transaction.aggregate({
    where: { cycleId: cycle.id, envelope: "GOAL_CONTRIBUTION", amount: { gt: 0n } },
    _sum: { amount: true },
  });

  const categories = await prisma.category.findMany({
    where: { defaultEnvelope: "LIVING" },
    select: { id: true, name: true, color: true, plannedAmount: true, reserveUpfront: true },
    orderBy: { name: "asc" },
  });

  return computeStatsCore(
    cycle,
    visible,
    categories,
    contribs._sum.amountUah ?? 0n,
    goalsContrib._sum.amount ?? 0n,
    now,
  );
}

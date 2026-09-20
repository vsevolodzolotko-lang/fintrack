import { daysBetweenInclusive, sameLocalDay } from "../time.js";

export interface CycleInput {
  id: string;
  startDate: Date;
  expectedEnd: Date;
  endDate: Date | null;
  pctInvestment: number;
  pctGoals: number;
  pctLiving: number;
  // Розподілений залишок мінулого циклу — додається понад відсотки.
  goalsCarryUah: bigint;
  investCarryUah: bigint;
  livingCarryUah: bigint;
}

export interface TxInput {
  amount: bigint;
  envelope: string;
  isIncome: boolean;
  time: Date;
  categoryId: string | null;
}

export interface CategoryInput {
  id: string;
  name: string;
  color: string | null;
  plannedAmount: bigint | null;
  reserveUpfront: boolean;
}

export interface CategoryStat {
  categoryId: string;
  name: string;
  color: string | null;
  spent: bigint;
  planned: bigint | null;
  reserveUpfront: boolean;
}

export interface CycleStats {
  cycleId: string;
  startDate: Date;
  expectedEnd: Date;
  endDate: Date | null;
  incomeTotal: bigint;
  investmentBudget: bigint;
  goalsBudget: bigint;
  livingBudget: bigint;
  goalsCarryUah: bigint;
  investCarryUah: bigint;
  livingCarryUah: bigint;
  livingSpent: bigint;
  goalsContributed: bigint;
  toGoals: bigint;
  investmentContributed: bigint;
  toInvest: bigint;
  daysLeft: number;
  daysElapsed: number; // день циклу сьогодні (включно), Київ
  totalDays: number; // повна довжина циклу в днях (включно)
  dailyLimit: bigint;
  spentToday: bigint;
  safeToday: bigint;
  overspendForecast: boolean;
  reservedCommitment: bigint;
  flexibleBudget: bigint;
  flexibleRemaining: bigint;
  byCategory: CategoryStat[];
}

function pct(base: bigint, p: number): bigint {
  return (base * BigInt(p)) / 100n;
}

// Бюджет інвестицій — у цілих гривнях: цілі плану цілогривневі й мають
// сумуватись рівно в бюджет (див. investCore).
function floorGrn(kop: bigint): bigint {
  return (kop / 100n) * 100n;
}

// Чиста математика циклу — без Prisma, тестується юнітами.
export function computeStatsCore(
  cycle: CycleInput,
  txs: TxInput[],
  categories: CategoryInput[],
  investmentContributed: bigint,
  goalsContributed: bigint,
  now: Date,
): CycleStats {
  let incomeTotal = 0n;
  let livingSpent = 0n;
  let livingSpentToday = 0n;
  const spentByCat = new Map<string, bigint>();
  const spentTodayByCat = new Map<string, bigint>();

  for (const t of txs) {
    if (t.isIncome) incomeTotal += t.amount;
    if (t.amount < 0n) {
      const abs = -t.amount;
      // Модель 70/15/15: усі витрати — один піт (LIVING).
      if (t.envelope === "LIVING") {
        livingSpent += abs;
        if (t.categoryId) spentByCat.set(t.categoryId, (spentByCat.get(t.categoryId) ?? 0n) + abs);
        if (sameLocalDay(t.time, now)) {
          livingSpentToday += abs;
          if (t.categoryId) spentTodayByCat.set(t.categoryId, (spentTodayByCat.get(t.categoryId) ?? 0n) + abs);
        }
      }
    } else if (t.amount > 0n && t.envelope === "LIVING") {
      // Повернення грошей / кешбек: мінус-витрата за цикл. Свідомо НЕ чіпає
      // livingSpentToday — інакше хедлайн «сьогодні» стрибав би від повернення
      // за витрату тритижневої давнини. Гроші повертаються в піт і рівно
      // розкладаються по днях, що лишились (через dailyLimit).
      // Розбивку за категоріями теж не чіпає: повернення без категорії, тож
      // Σ byCategory може бути більшою за livingSpent — це очікувано.
      livingSpent -= t.amount;
    }
  }

  const investmentBudget = floorGrn(pct(incomeTotal, cycle.pctInvestment)) + cycle.investCarryUah;
  const goalsBudget = pct(incomeTotal, cycle.pctGoals) + cycle.goalsCarryUah;
  const livingBudget = pct(incomeTotal, cycle.pctLiving) + cycle.livingCarryUah;

  // Резерв: max(оцінка, факт) по кожній reserveUpfront-категорії.
  let reservedCommitment = 0n;
  let reservedSpent = 0n;
  let reservedSpentToday = 0n;
  for (const c of categories) {
    if (!c.reserveUpfront) continue;
    const spent = spentByCat.get(c.id) ?? 0n;
    const planned = c.plannedAmount ?? 0n;
    reservedCommitment += spent > planned ? spent : planned;
    reservedSpent += spent;
    reservedSpentToday += spentTodayByCat.get(c.id) ?? 0n;
  }

  const flexibleSpent = livingSpent - reservedSpent;
  const flexibleBudget = livingBudget - reservedCommitment;
  const flexibleRemaining = flexibleBudget - flexibleSpent;

  const cycleEnd = cycle.endDate ?? cycle.expectedEnd;
  const daysLeft = Math.max(1, daysBetweenInclusive(now, cycleEnd));
  const dailyLimit = flexibleRemaining > 0n ? flexibleRemaining / BigInt(daysLeft) : 0n;
  const spentToday = livingSpentToday - reservedSpentToday;
  const safeToday = dailyLimit - spentToday;

  // Прогноз перевитрати — по гнучкому пулу.
  const daysElapsed = Math.max(1, daysBetweenInclusive(cycle.startDate, now));
  const totalDays = Math.max(1, daysBetweenInclusive(cycle.startDate, cycleEnd));
  const projected = (flexibleSpent * BigInt(totalDays)) / BigInt(daysElapsed);
  const overspendForecast = flexibleBudget > 0n && projected > flexibleBudget;

  const byCategory: CategoryStat[] = categories.map((c) => ({
    categoryId: c.id,
    name: c.name,
    color: c.color,
    spent: spentByCat.get(c.id) ?? 0n,
    planned: c.plannedAmount,
    reserveUpfront: c.reserveUpfront,
  }));

  return {
    cycleId: cycle.id,
    startDate: cycle.startDate,
    expectedEnd: cycle.expectedEnd,
    endDate: cycle.endDate,
    incomeTotal,
    investmentBudget,
    goalsBudget,
    livingBudget,
    goalsCarryUah: cycle.goalsCarryUah,
    investCarryUah: cycle.investCarryUah,
    livingCarryUah: cycle.livingCarryUah,
    livingSpent,
    goalsContributed,
    toGoals: goalsBudget - goalsContributed,
    investmentContributed,
    toInvest: investmentBudget - investmentContributed,
    daysLeft,
    daysElapsed,
    totalDays,
    dailyLimit,
    spentToday,
    safeToday,
    overspendForecast,
    reservedCommitment,
    flexibleBudget,
    flexibleRemaining,
    byCategory,
  };
}

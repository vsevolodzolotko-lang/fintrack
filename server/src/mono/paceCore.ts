import { daysBetweenInclusive, ymdInTz } from "../time.js";

// Темп витрат: середнє за день/тиждень/місяць і порівняння «зараз vs зазвичай».
// Чиста математика без Prisma — виклик передає вже відфільтровані витрати.

export interface PaceTx {
  time: Date;
  amount: bigint; // від'ємне = витрата; додатні ігноруються
}

export interface PeriodPace {
  spent: bigint; // фактично витрачено за період (до «зараз»)
  usual: bigint; // скільки було б у звичному темпі за стільки ж днів
  deltaPct: number | null; // (spent−usual)/usual ×100; null поки немає бази
}

export interface PaceStats {
  baselineDays: number; // повних днів історії до сьогодні
  avgDay: bigint;
  avgWeek: bigint;
  avgMonth: bigint;
  day: PeriodPace;
  week: PeriodPace;
  month: PeriodPace;
}

// ymd → UTC-північ цього календарного дня (для арифметики днів).
function ymdToUtc(ymd: string): Date {
  return new Date(ymd + "T00:00:00Z");
}

export function computePaceCore(txs: PaceTx[], now: Date): PaceStats | null {
  const byDay = new Map<string, bigint>();
  for (const t of txs) {
    if (t.amount >= 0n) continue;
    const ymd = ymdInTz(t.time);
    byDay.set(ymd, (byDay.get(ymd) ?? 0n) - t.amount);
  }
  if (byDay.size === 0) return null;

  const todayYmd = ymdInTz(now);
  const firstYmd = [...byDay.keys()].sort()[0];

  // База — повні дні до сьогодні (сьогодні ще триває і занизив би середнє).
  let baselineTotal = 0n;
  for (const [ymd, sum] of byDay) {
    if (ymd < todayYmd) baselineTotal += sum;
  }
  const baselineDays =
    firstYmd < todayYmd
      ? Math.max(0, daysBetweenInclusive(ymdToUtc(firstYmd), ymdToUtc(todayYmd)) - 1)
      : 0;
  const avgDay = baselineDays > 0 ? baselineTotal / BigInt(baselineDays) : 0n;

  // Сума за [fromYmd..сьогодні] включно.
  const spentSince = (fromYmd: string): bigint => {
    let s = 0n;
    for (const [ymd, sum] of byDay) {
      if (ymd >= fromYmd) s += sum;
    }
    return s;
  };

  const period = (fromYmd: string): PeriodPace => {
    const daysSoFar = daysBetweenInclusive(ymdToUtc(fromYmd), ymdToUtc(todayYmd));
    const spent = spentSince(fromYmd);
    const usual = avgDay * BigInt(daysSoFar);
    return {
      spent,
      usual,
      deltaPct: usual > 0n ? Number(((spent - usual) * 100n) / usual) : null,
    };
  };

  const todayUtc = ymdToUtc(todayYmd);
  const mondayOffset = (todayUtc.getUTCDay() + 6) % 7; // 0 = понеділок
  const weekStartYmd = ymdInTz(new Date(todayUtc.getTime() - mondayOffset * 86_400_000), "UTC");
  const monthStartYmd = todayYmd.slice(0, 8) + "01";

  return {
    baselineDays,
    avgDay,
    avgWeek: avgDay * 7n,
    avgMonth: avgDay * 30n,
    day: period(todayYmd),
    week: period(weekStartYmd),
    month: period(monthStartYmd),
  };
}

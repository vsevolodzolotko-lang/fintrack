// Чиста математика ОВДП: прибуток за графіком виплат (купони + погашення);
// беcкупонні/старі — прості відсотки. Лінійне нарощення до погашення. UTC.
const DAY_MS = 86_400_000;

export type OvdpFlowKind = "COUPON" | "REDEMPTION";

export interface OvdpCashflowLite {
  date: Date;
  kind: OvdpFlowKind;
  amountUah: bigint; // копійки, сукупно по всіх шт. на цю дату
}

export interface OvdpRow {
  amountUah: bigint; // переказано на ОВДП, копійки
  bondCostUah?: bigint | null; // вкладено в папери (принципал прибутку); null → =amountUah
  date: Date; // дата купівлі — старт нарощення
  maturityDate: Date | null; // = дата погашення (для драбинки)
  yieldPctBp: bigint | null; // стара проста модель (дохідність у б.п., 17,50% → 1750n)
  cashflows?: OvdpCashflowLite[]; // якщо є — модель за графіком
}

export interface OvdpProjection {
  investedUah: bigint;
  accruedNowUah: bigint;
  expectedUah: bigint;
  couponsReceivedUah: bigint;
  couponsUpcomingUah: bigint;
  series: { date: string; valueUah: bigint }[];
}

function daysBetween(a: Date, b: Date): number {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / DAY_MS));
}

// Принципал прибутку: вартість паперів; для старих рядків = переказане.
function principalUah(row: OvdpRow): bigint {
  return row.bondCostUah ?? row.amountUah;
}

function hasSchedule(row: OvdpRow): boolean {
  return !!row.cashflows && row.cashflows.length > 0;
}

// Повний прибуток до погашення (копійки) або null, якщо даних нема.
function gainFullUah(row: OvdpRow): bigint | null {
  if (hasSchedule(row)) {
    const inflow = row.cashflows!.reduce((s, c) => s + c.amountUah, 0n);
    return inflow - principalUah(row);
  }
  if (!row.maturityDate || !row.yieldPctBp || row.yieldPctBp <= 0n) return null;
  const daysTotal = daysBetween(row.date, row.maturityDate);
  return (principalUah(row) * row.yieldPctBp * BigInt(daysTotal)) / (10_000n * 365n);
}

export function expectedReturnUah(row: OvdpRow): bigint | null {
  const gain = gainFullUah(row);
  return gain === null ? null : principalUah(row) + gain;
}

// Лінійне нарощення: принципал до купівлі, очікуване повернення після погашення.
export function accruedAtUah(row: OvdpRow, t: Date): bigint {
  const gain = gainFullUah(row);
  const principal = principalUah(row);
  if (gain === null || !row.maturityDate) return principal;
  const daysTotal = daysBetween(row.date, row.maturityDate);
  if (daysTotal === 0) return principal + gain;
  const elapsed = Math.min(daysBetween(row.date, t), daysTotal);
  return principal + (gain * BigInt(elapsed)) / BigInt(daysTotal);
}

function qualifies(row: OvdpRow): boolean {
  return hasSchedule(row) || !!(row.maturityDate && row.yieldPctBp && row.yieldPctBp > 0n);
}

export function computeOvdpProjection(rows: OvdpRow[], now: Date): OvdpProjection | null {
  const qualified = rows.filter(qualifies);
  if (!qualified.length) return null;

  const dayKey = (d: Date) => d.toISOString().slice(0, 10);
  const keys = new Set<string>([dayKey(now)]);
  for (const r of qualified) {
    keys.add(dayKey(r.date));
    if (r.maturityDate) keys.add(dayKey(r.maturityDate));
    for (const c of r.cashflows ?? []) keys.add(dayKey(c.date));
  }
  const sorted = [...keys].sort();

  const series = sorted.map((k) => {
    const t = new Date(`${k}T00:00:00Z`);
    let value = 0n;
    for (const r of qualified) value += accruedAtUah(r, t);
    return { date: k, valueUah: value };
  });

  let couponsReceived = 0n;
  let couponsUpcoming = 0n;
  for (const r of qualified) {
    for (const c of r.cashflows ?? []) {
      if (c.kind !== "COUPON") continue;
      if (c.date.getTime() <= now.getTime()) couponsReceived += c.amountUah;
      else couponsUpcoming += c.amountUah;
    }
  }

  return {
    investedUah: qualified.reduce((s, r) => s + principalUah(r), 0n),
    accruedNowUah: qualified.reduce((s, r) => s + accruedAtUah(r, now), 0n),
    expectedUah: qualified.reduce((s, r) => s + expectedReturnUah(r)!, 0n),
    couponsReceivedUah: couponsReceived,
    couponsUpcomingUah: couponsUpcoming,
    series,
  };
}

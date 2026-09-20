// Арифметика покрокового внеску: числа, які флоу диктує людині вголос.
// Без Prisma — усе приходить аргументами (як investHistoryCore/reitCore).

export type InstrumentKind = "OVDP" | "REIT" | "CRYPTO";

export interface SendAmount {
  /** Скільки відправити зараз, копійки. Ніколи не відʼємне. */
  amountUah: bigint;
  /** Частка цього місяця (ціль мінус недобір) — для підпису «65% інвестбюджету». */
  baseUah: bigint;
  /** Недобір минулого місяця всередині цілі. */
  carryUah: bigint;
}

export interface LotEstimate {
  count: number;
  unitPriceUah: bigint;
}

/**
 * Сьогодні цю суму треба вираховувати очима з «Ціль ₴5 575 / Внесено ₴0».
 * Розклад повертаємо разом із сумою: частка без бази — це рівно та плутанина,
 * через яку два різні «15%» на дашборді читались як одне (знахідка 15).
 */
export function sendAmount(input: {
  targetUah: bigint;
  contributedUah: bigint;
  carryUah: bigint;
}): SendAmount {
  const left = input.targetUah - input.contributedUah;
  return {
    amountUah: left > 0n ? left : 0n,
    baseUah: input.targetUah - input.carryUah,
    carryUah: input.carryUah,
  };
}

/**
 * Орієнтир кроку «купи скільки влазить» — за ціною останньої купівлі.
 * Немає історії або сума не покриває й одного лота → орієнтиру немає, і крок
 * про це мовчить: краще нічого, ніж вигадане число.
 */
export function lotEstimate(sentUah: bigint, lastUnitPriceUah: bigint | null): LotEstimate | null {
  if (lastUnitPriceUah === null || lastUnitPriceUah <= 0n || sentUah <= 0n) return null;
  const count = Number(sentUah / lastUnitPriceUah); // BigInt-ділення вже обрізає вниз
  if (count < 1) return null;
  return { count, unitPriceUah: lastUnitPriceUah };
}

/**
 * Скільки кроків має флоу. ОВДП купується цілими лотами, тож між відправкою і
 * записом є окрема дія; REIT дробовий і закривається рівно; крипта з
 * підключеним ключем Binance записується сама — там флоу не потрібен узагалі.
 */
export function flowSteps(kind: InstrumentKind, binanceConfigured: boolean): 0 | 2 | 3 {
  if (kind === "OVDP") return 3;
  if (kind === "REIT") return 2;
  return binanceConfigured ? 0 : 2;
}

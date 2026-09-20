// Історія інвестицій: п'ять джерел подій в одну вісь часу + підсумок «за весь час».
// Без Prisma — усе, що потрібно, приходить аргументами (як historyCore/reitCore).

export type InstrumentKind = "OVDP" | "REIT" | "CRYPTO";
export type ContribSource = "RULE_15PCT" | "LEFTOVER" | "MANUAL" | "BINANCE";
export type InvestEventType = "CONTRIBUTION" | "COUPON" | "REDEMPTION" | "VALUATION" | "CONVERSION";
export type CryptoUnavailable = "not_configured" | "no_rate" | "no_data";

export interface CoreContribution {
  id: string;
  kind: InstrumentKind;
  cycleId: string | null;
  date: Date;
  amountUah: bigint;
  quantity: number | null;
  source: ContribSource;
  note: string | null;
  /** Куплено USDT привʼязаним P2P-ордером — підпис «→ 17,9 USDT». */
  usdtQty: string | null;
}

export interface CoreCashflow {
  id: string;
  contributionId: string;
  date: Date;
  kind: "COUPON" | "REDEMPTION";
  amountUah: bigint;
}

export interface CoreValuation {
  id: string;
  date: Date;
  valueUah: bigint;
  freeUah: bigint;
  note: string | null;
}

export interface CoreConversion {
  id: string;
  date: Date;
  fromAsset: string;
  fromAmount: string;
  toAsset: string;
  toAmount: string;
}

export interface CoreCycleLite {
  id: string;
  startDate: Date;
  /** Недобір ОВДП, перенесений У цей цикл — тобто недобір попереднього. */
  ovdpCarryUah: bigint;
}

export interface InvestEvent {
  /** `TYPE:sourceId` — унікальний ключ рядка в стрічці. */
  id: string;
  type: InvestEventType;
  kind: InstrumentKind;
  date: string; // ISO
  amountUah: bigint;
  deletable: boolean;
  quantity?: number;
  usdtQty?: string;
  freeUah?: bigint;
  note?: string;
  shortfallUah?: bigint;
  fromAsset?: string;
  fromAmount?: string;
  toAsset?: string;
  toAmount?: string;
}

export interface InvestHistorySummary {
  investedUah: bigint;
  ovdpCouponsUah: bigint;
  reitGainUah: bigint | null;
  cryptoGainUah: bigint | null;
  cryptoUnavailable: CryptoUnavailable | null;
  gainUah: bigint;
  nowUah: bigint;
}

export interface InvestHistoryInput {
  now: Date;
  contributions: CoreContribution[];
  cashflows: CoreCashflow[];
  valuations: CoreValuation[];
  conversions: CoreConversion[];
  cycles: CoreCycleLite[];
  ovdpCouponsUah: bigint;
  reitGainUah: bigint | null;
  cryptoGainUah: bigint | null;
  cryptoUnavailable: CryptoUnavailable | null;
}

export interface InvestHistoryResult {
  firstEventAt: string | null;
  summary: InvestHistorySummary;
  events: InvestEvent[];
}

/**
 * Недобір циклу i — це його ВЛАСНИЙ промах, а не накопичений борг ОВДП:
 * carry(i+1) − carry(i), де carry(n) = `ovdpCarryUah` циклу n (борг, що
 * прийшов У нього). `investCore.ts` рахує target = base + carry, тож просте
 * "взяти carry(i+1)" (як робилося раніше) вішає на другий із двох поспіль
 * пропущених місяців суму ОБОХ промахів замість його власного.
 *
 * Вішаємо різницю на останній за датою внесок ОВДП циклу i: саме там читач
 * питає «а чому не повна ціль». Якщо різниця ≤ 0 — місяць закрив ціль (або
 * навіть погасив частину боргу) — підпису немає. Якщо в циклі i не було
 * жодного внеску ОВДП — підпису теж немає: борг усе одно видно на картці
 * ОВДП у Плані, а вішати його на внесок REIT/CRYPTO того ж циклу було б
 * брехнею. Свідоме рішення власника — не "лагодь" повертаючи carry(i+1).
 */
function shortfallByContribution(
  contributions: CoreContribution[],
  cycles: CoreCycleLite[],
): Map<string, bigint> {
  const out = new Map<string, bigint>();
  const asc = [...cycles].sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  for (let i = 0; i < asc.length - 1; i++) {
    const ownShortfall = asc[i + 1].ovdpCarryUah - asc[i].ovdpCarryUah;
    if (ownShortfall <= 0n) continue;
    const ovdpOfCycle = contributions
      .filter((c) => c.kind === "OVDP" && c.cycleId === asc[i].id)
      .sort((a, b) => a.date.getTime() - b.date.getTime());
    const last = ovdpOfCycle[ovdpOfCycle.length - 1];
    if (last) out.set(last.id, ownShortfall);
  }
  return out;
}

export function buildInvestHistory(input: InvestHistoryInput): InvestHistoryResult {
  const shortfalls = shortfallByContribution(input.contributions, input.cycles);
  const events: InvestEvent[] = [];

  for (const c of input.contributions) {
    const shortfall = shortfalls.get(c.id);
    events.push({
      id: `CONTRIBUTION:${c.id}`,
      type: "CONTRIBUTION",
      kind: c.kind,
      date: c.date.toISOString(),
      amountUah: c.amountUah,
      // Видаляти можна лише те, що завели руками: авто-внесок із Binance синк
      // відтворить наступним прогоном, тож кнопка брехала б.
      deletable: c.source === "MANUAL",
      ...(c.quantity !== null ? { quantity: c.quantity } : {}),
      ...(c.usdtQty !== null ? { usdtQty: c.usdtQty } : {}),
      ...(c.note !== null ? { note: c.note } : {}),
      ...(shortfall !== undefined ? { shortfallUah: shortfall } : {}),
    });
  }

  // Купони й погашення — лише ті, що вже сталися. Майбутні живуть у проекції
  // на табі Портфель; історія показує факти, а не план.
  for (const f of input.cashflows) {
    if (f.date.getTime() > input.now.getTime()) continue;
    events.push({
      id: `${f.kind}:${f.id}`,
      type: f.kind,
      kind: "OVDP",
      date: f.date.toISOString(),
      amountUah: f.amountUah,
      deletable: false,
    });
  }

  for (const v of input.valuations) {
    events.push({
      id: `VALUATION:${v.id}`,
      type: "VALUATION",
      kind: "REIT",
      date: v.date.toISOString(),
      amountUah: v.valueUah,
      freeUah: v.freeUah,
      deletable: true,
      ...(v.note !== null ? { note: v.note } : {}),
    });
  }

  for (const x of input.conversions) {
    events.push({
      id: `CONVERSION:${x.id}`,
      type: "CONVERSION",
      kind: "CRYPTO",
      date: x.date.toISOString(),
      amountUah: 0n,
      deletable: false,
      fromAsset: x.fromAsset,
      fromAmount: x.fromAmount,
      toAsset: x.toAsset,
      toAmount: x.toAmount,
    });
  }

  events.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const investedUah = input.contributions.reduce((s, c) => s + c.amountUah, 0n);
  const gainUah =
    input.ovdpCouponsUah + (input.reitGainUah ?? 0n) + (input.cryptoGainUah ?? 0n);

  return {
    firstEventAt: events.length ? events[events.length - 1].date : null,
    summary: {
      investedUah,
      ovdpCouponsUah: input.ovdpCouponsUah,
      reitGainUah: input.reitGainUah,
      cryptoGainUah: input.cryptoGainUah,
      cryptoUnavailable: input.cryptoUnavailable,
      gainUah,
      nowUah: investedUah + gainUah,
    },
    events,
  };
}

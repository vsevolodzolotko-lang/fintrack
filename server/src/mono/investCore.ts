// Чиста математика інвестиційного плану — без Prisma, тестується юнітами.
export type InstrumentKind = "OVDP" | "REIT" | "CRYPTO";

export const INSTRUMENT_ORDER: InstrumentKind[] = ["OVDP", "REIT", "CRYPTO"];

export interface InvestPcts {
  OVDP: number;
  REIT: number;
  CRYPTO: number;
}

export interface InstrumentTarget {
  kind: InstrumentKind;
  targetUah: bigint;
  contributedUah: bigint;
  remainingUah: bigint;
  done: boolean;
}

export interface InvestmentPlanCore {
  investmentBudget: bigint; // флорений до цілої грн
  targets: InstrumentTarget[];
  stepsDone: number;
  totalContributed: bigint;
  totalRemaining: bigint; // Σ remainingUah по кроках
}

// Ціла гривня в копійках: відкинути остачу < 100.
function floorGrn(kop: bigint): bigint {
  return (kop / 100n) * 100n;
}

function pct(base: bigint, p: number): bigint {
  return (base * BigInt(p)) / 100n;
}

// Цілі — цілі гривні, що сумуються ТОЧНО в бюджет: floor для всіх, крім
// останнього інструмента; останній забирає залишок. Нампад внесків приймає
// лише цілі гривні, тож копійкова ціль була б недосяжною (вічне «Частково»).
export function computeInvestmentPlan(
  investmentBudget: bigint,
  pcts: InvestPcts,
  contributedByKind: Partial<Record<InstrumentKind, bigint>>,
  ovdpCarryUah: bigint = 0n,
): InvestmentPlanCore {
  const budget = investmentBudget > 0n ? floorGrn(investmentBudget) : 0n;

  const base: Record<InstrumentKind, bigint> = { OVDP: 0n, REIT: 0n, CRYPTO: 0n };
  let allocated = 0n;
  for (const kind of INSTRUMENT_ORDER.slice(0, -1)) {
    base[kind] = floorGrn(pct(budget, pcts[kind]));
    allocated += base[kind];
  }
  const last = INSTRUMENT_ORDER[INSTRUMENT_ORDER.length - 1];
  const rest = budget - allocated;
  base[last] = rest > 0n ? rest : 0n;

  let stepsDone = 0;
  let totalContributed = 0n;
  let totalRemaining = 0n;

  const targets: InstrumentTarget[] = INSTRUMENT_ORDER.map((kind) => {
    const carry = kind === "OVDP" && ovdpCarryUah > 0n ? ovdpCarryUah : 0n;
    const targetUah = base[kind] + carry;
    const contributedUah = contributedByKind[kind] ?? 0n;
    const diff = targetUah - contributedUah;
    const remainingUah = diff > 0n ? diff : 0n;
    const done = targetUah > 0n && contributedUah >= targetUah;
    if (done) stepsDone += 1;
    totalContributed += contributedUah;
    totalRemaining += remainingUah;
    return { kind, targetUah, contributedUah, remainingUah, done };
  });

  return { investmentBudget: budget, targets, stepsDone, totalContributed, totalRemaining };
}

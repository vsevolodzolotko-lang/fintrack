// Чиста математика закриття циклу — без Prisma, під юніти.
// Гроші всюди в копійках (BigInt), як і скрізь у проєкті.

// Фактичний залишок на побутовій картці за мить до якірної ЗП.
// Transaction.balance від Mono — баланс ПІСЛЯ операції, тож віднімаємо саму ЗП.
// null → Mono не віддав balance (стара транзакція, готівка): фолбек на розрахунок.
export function computeLeftoverFact(
  anchorBalance: bigint | null | undefined,
  anchorAmount: bigint,
): bigint | null {
  if (anchorBalance == null) return null;
  return anchorBalance - anchorAmount;
}

export interface SplitInput {
  leftover: bigint;
  toGoals: bigint;
  toInvest: bigint;
}

export interface SplitResult {
  toGoals: bigint;
  toInvest: bigint;
  toLiving: bigint;
}

export type SplitError = "negative_leftover" | "negative_part" | "over_leftover";

// Побут — не поле вводу, а автозалишок: копійки завжди осідають тут,
// тож сума трьох частин точно дорівнює залишку, без округлень.
export function validateSplit(i: SplitInput): SplitResult | { error: SplitError } {
  if (i.leftover < 0n) return { error: "negative_leftover" };
  if (i.toGoals < 0n || i.toInvest < 0n) return { error: "negative_part" };
  if (i.toGoals + i.toInvest > i.leftover) return { error: "over_leftover" };
  return {
    toGoals: i.toGoals,
    toInvest: i.toInvest,
    toLiving: i.leftover - i.toGoals - i.toInvest,
  };
}

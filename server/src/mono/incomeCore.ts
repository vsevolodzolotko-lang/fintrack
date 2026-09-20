// Чиста логіка типів надходжень — без Prisma, тестується юнітами.
// Кортеж, а не масив: z.enum() у роуті приймає його напряму, без кастів
// (той самий патерн, що ENVELOPES у routes/transactions.ts).
export const INCOME_KINDS = [
  "SALARY", "OTHER_INCOME", "REFUND", "CASHBACK", "SELF_TRANSFER",
] as const;

export type IncomeKind = (typeof INCOME_KINDS)[number];

export interface KindEffect {
  envelope: "INCOME" | "LIVING" | "INTERNAL_TRANSFER";
  isIncome: boolean;
}

// Єдине правило: надходження АБО створює зобов'язання (ділиться 15/15/70),
// АБО повертає вже витрачене. Третього не буває.
//  • INCOME + isIncome — входить в incomeTotal, звідки конверти беруть відсотки.
//  • LIVING на позитивній сумі — statsCore віднімає від livingSpent («мінус-витрата»).
//  • INTERNAL_TRANSFER — нейтрально, ніде не рахується.
export function effectOfKind(kind: IncomeKind): KindEffect {
  switch (kind) {
    case "SALARY":
    case "OTHER_INCOME":
      return { envelope: "INCOME", isIncome: true };
    case "REFUND":
    case "CASHBACK":
      return { envelope: "LIVING", isIncome: false };
    case "SELF_TRANSFER":
      return { envelope: "INTERNAL_TRANSFER", isIncome: false };
  }
}

export function createsObligations(kind: IncomeKind): boolean {
  return effectOfKind(kind).isIncome;
}

// Ціла гривня в копійках — та сама функція, що в statsCore/investCore.
function floorGrn(kop: bigint): bigint {
  return (kop / 100n) * 100n;
}

export interface SplitPreview {
  investment: bigint;
  goals: bigint;
  living: bigint;
}

// Превʼю «що станеться» для картки в Review. Інвестиційна частка флориться до
// цілої гривні — так само, як робить statsCore.investmentBudget, бо цілі плану
// цілогривневі (див. investCore). Це превʼю ВНЕСКУ саме цієї транзакції;
// фактичний бюджет циклу рахується від суми доходів, тож на кілька копійок
// може відрізнятись від суми превʼю кількох надходжень.
export function previewSplit(
  amount: bigint,
  pcts: { investment: number; goals: number; living: number },
): SplitPreview {
  if (amount <= 0n) return { investment: 0n, goals: 0n, living: 0n };
  return {
    investment: floorGrn((amount * BigInt(pcts.investment)) / 100n),
    goals: (amount * BigInt(pcts.goals)) / 100n,
    living: (amount * BigInt(pcts.living)) / 100n,
  };
}

// Підказка «це схоже на основну ЗП» — саме підказка, людина може перевизначити.
export function suggestStartsCycle(amount: bigint, cycleAnchorMin: bigint): boolean {
  return amount >= cycleAnchorMin;
}

// Ключ авто-правила: найстабільніший доступний ідентифікатор відправника.
// null = запам'ятовувати нічого (правило не створюється).
export function incomeMatchKey(tx: {
  counterEdrpou?: string | null;
  counterIban?: string | null;
  description: string;
}): string | null {
  if (tx.counterEdrpou) return `edrpou:${tx.counterEdrpou}`;
  if (tx.counterIban) return `iban:${tx.counterIban}`;
  const desc = tx.description.trim().toLowerCase().replace(/\s+/g, " ");
  return desc ? `desc:${desc}` : null;
}

export type BackfillAction =
  | { action: "set"; kind: IncomeKind }
  | { action: "requeue" }
  | { action: "skip" };

// Класифікація наявного рядка БД під нову модель (див. §Міграція наявних даних).
// opensCycle — чи ця транзакція записана в Cycle.triggeredByTxId.
export function classifyForBackfill(tx: {
  amount: bigint;
  envelope: string;
  isIncome: boolean;
  opensCycle: boolean;
}): BackfillAction {
  if (tx.amount <= 0n) return { action: "skip" };
  if (tx.envelope === "GOAL_CONTRIBUTION") return { action: "skip" };
  if (tx.envelope === "INTERNAL_TRANSFER") return { action: "set", kind: "SELF_TRANSFER" };
  if (tx.isIncome) return { action: "set", kind: tx.opensCycle ? "SALARY" : "OTHER_INCOME" };
  // Старий kind="return" писав той самий стан (isIncome=false, needsReview=false),
  // що й проігнорована через incomeThreshold дрібнота — розрізнити неможливо,
  // тож усі повертаються в чергу на переоцінку.
  return { action: "requeue" };
}

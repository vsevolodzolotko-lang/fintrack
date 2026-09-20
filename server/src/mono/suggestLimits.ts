// Детермінована евристика планів по LIVING-категоріях з історії закритих циклів.
// Без LLM і без Prisma — чиста функція (див. CATEGORY_LIMITS.md).

export interface CategoryCycleSpend {
  categoryId: string;
  name: string;
  perCycleSpent: bigint[];
  lastCycleTxAmounts: bigint[];
  targetCycleIndex: number; // index into perCycleSpent for the cycle being budgeted (:id)
}

export interface BudgetSuggestion {
  categoryId: string;
  name: string;
  spentLastCycle: bigint;
  suggestedPlan: bigint;
  reserveUpfront: boolean;
  note: string | null;
}

const HUNDRED_UAH = 10_000n;          // 100 грн у копійках
const LUMPY_MIN_SPENT = 100_000n;     // 1 000 грн
const LUMPY_MAX_TXS = 2;

function median(values: bigint[]): bigint {
  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2n;
}

const roundUp100 = (x: bigint): bigint => ((x + HUNDRED_UAH - 1n) / HUNDRED_UAH) * HUNDRED_UAH;
const roundDown100 = (x: bigint): bigint => (x / HUNDRED_UAH) * HUNDRED_UAH;

function isLumpy(txs: bigint[]): boolean {
  const total = txs.reduce((a, b) => a + b, 0n);
  if (total < LUMPY_MIN_SPENT) return false;
  if (txs.length <= LUMPY_MAX_TXS) return true;
  const maxTx = txs.reduce((a, b) => (b > a ? b : a), 0n);
  return maxTx * 10n >= total * 7n; // одна транзакція ≥ 70% витрат
}

export function suggestBudgets(cats: CategoryCycleSpend[], livingBudget: bigint): BudgetSuggestion[] {
  const out: BudgetSuggestion[] = [];
  for (const c of cats) {
    const typical = median(c.perCycleSpent);
    if (typical <= 0n) continue;
    const suggestedPlan = roundUp100(typical + typical / 10n); // +10%
    const reserveUpfront = isLumpy(c.lastCycleTxAmounts);
    out.push({
      categoryId: c.categoryId,
      name: c.name,
      spentLastCycle: c.perCycleSpent[c.targetCycleIndex] ?? 0n,
      suggestedPlan,
      reserveUpfront,
      note: reserveUpfront ? "разові великі платежі — резервуємо наперед" : null,
    });
  }

  // Вписати гнучкі плани в гнучкий бюджет (LIVING − резервні пропозиції).
  const reservedSum = out.filter((s) => s.reserveUpfront).reduce((a, s) => a + s.suggestedPlan, 0n);
  const flexBudget = livingBudget - reservedSum;
  const flexible = out.filter((s) => !s.reserveUpfront);
  const flexSum = flexible.reduce((a, s) => a + s.suggestedPlan, 0n);
  if (flexBudget > 0n && flexSum > flexBudget) {
    for (const s of flexible) {
      s.suggestedPlan = roundDown100((s.suggestedPlan * flexBudget) / flexSum);
      s.note = "зменшено, щоб вміститись у гнучкий бюджет";
    }
  }
  return out;
}

import type { Envelope } from "@prisma/client";
import { prisma } from "../db.js";

export interface CategorizeInput {
  mcc?: number | null;
  description: string;
  counterName?: string | null;
  amount: bigint; // signed
}

export interface CategorizeResult {
  categoryId: string | null;
  envelope: Envelope;
  needsReview: boolean;
  autoCategorized: boolean;
}

// Пайплайн (див. DATA_MODEL.md §Автокатегоризація):
// 1) правила за priority (перший збіг), 2) MCC→системна категорія, 3) UNCATEGORIZED.
export async function categorize(input: CategorizeInput): Promise<CategorizeResult> {
  const haystack = `${input.description} ${input.counterName ?? ""}`.toLowerCase();

  const rules = await prisma.categoryRule.findMany({
    where: { enabled: true },
    orderBy: { priority: "asc" },
    include: { resultCategory: true },
  });

  for (const r of rules) {
    if (r.mcc != null && r.mcc !== input.mcc) continue;
    if (r.merchantPattern && !haystack.includes(r.merchantPattern.toLowerCase())) continue;
    const abs = input.amount < 0n ? -input.amount : input.amount;
    if (r.amountMin != null && abs < r.amountMin) continue;
    if (r.amountMax != null && abs > r.amountMax) continue;
    return {
      categoryId: r.resultCategoryId,
      envelope: r.resultEnvelope ?? r.resultCategory.defaultEnvelope,
      needsReview: false,
      autoCategorized: true,
    };
  }

  // Немає правила, але MCC відомий → знайти системну категорію з таким же MCC-правилом
  // (у seed створюємо базові MCC-правила; тут просто позначаємо на ревʼю).
  if (input.mcc != null) {
    return { categoryId: null, envelope: "LIVING", needsReview: true, autoCategorized: false };
  }

  return { categoryId: null, envelope: "UNCATEGORIZED", needsReview: true, autoCategorized: false };
}

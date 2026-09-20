import { describe, expect, it } from "vitest";
import { suggestBudgets, type CategoryCycleSpend } from "./suggestLimits.js";

const cc = (
  categoryId: string,
  perCycleSpent: bigint[],
  lastCycleTxAmounts: bigint[],
): CategoryCycleSpend => ({
  categoryId,
  name: categoryId,
  perCycleSpent,
  lastCycleTxAmounts,
  targetCycleIndex: perCycleSpent.length - 1, // legacy tests treat the newest cycle as target
});

describe("suggestBudgets", () => {
  it("один цикл: план = витрати +10%, округлено вгору до 100 грн", () => {
    // 4 850 грн → +10% = 5 335 → вгору до 100 → 5 400
    const [s] = suggestBudgets(
      [cc("groceries", [4_850_00n], [1_000_00n, 1_850_00n, 2_000_00n])],
      70_000_00n,
    );
    expect(s.suggestedPlan).toBe(5_400_00n);
    expect(s.spentLastCycle).toBe(4_850_00n);
    expect(s.reserveUpfront).toBe(false);
  });

  it("кілька циклів: медіана (непарна кількість)", () => {
    // медіана з [3000, 5000, 4000] = 4000 → +10% = 4400
    const [s] = suggestBudgets(
      [cc("groceries", [3_000_00n, 5_000_00n, 4_000_00n], [4_000_00n])],
      70_000_00n,
    );
    expect(s.suggestedPlan).toBe(4_400_00n);
  });

  it("комуналка: один великий платіж → reserveUpfront", () => {
    const [s] = suggestBudgets([cc("utilities", [2_800_00n], [2_800_00n])], 70_000_00n);
    expect(s.reserveUpfront).toBe(true);
    expect(s.note).toContain("резерв");
  });

  it("багато дрібних транзакцій — не грудкувата", () => {
    const txs = Array.from({ length: 20 }, () => 250_00n); // 20 × 250 грн
    const [s] = suggestBudgets([cc("groceries", [5_000_00n], txs)], 70_000_00n);
    expect(s.reserveUpfront).toBe(false);
  });

  it("дрібна категорія (<1000 грн) не резервується навіть з 1 транзакцією", () => {
    const [s] = suggestBudgets([cc("misc", [600_00n], [600_00n])], 70_000_00n);
    expect(s.reserveUpfront).toBe(false);
  });

  it("нульова історія — категорію пропущено", () => {
    const out = suggestBudgets([cc("cats", [0n], [])], 70_000_00n);
    expect(out).toEqual([]);
  });

  it("spentLastCycle бере витрати саме цільового циклу, а не останнього у наборі", () => {
    // 3 циклі: 500 → 2000 → 900; ціль — середній (index=1) → spentLastCycle має бути 2000.
    const cats: CategoryCycleSpend[] = [{
      categoryId: "groceries",
      name: "groceries",
      perCycleSpent: [500_00n, 2_000_00n, 900_00n],
      lastCycleTxAmounts: [2_000_00n],
      targetCycleIndex: 1,
    }];
    const [s] = suggestBudgets(cats, 70_000_00n);
    expect(s.spentLastCycle).toBe(2_000_00n);
  });

  it("пропозиції не влазять у гнучкий бюджет → пропорційне зменшення з note", () => {
    // livingBudget 10 000; резерв: комуналка 2 800 → план 3 100 → flexBudget 6 900.
    // Гнучкі: groceries 6 000 → 6 600; cafe 3 000 → 3 300. Σ = 9 900 > 6 900.
    const out = suggestBudgets(
      [
        cc("utilities", [2_800_00n], [2_800_00n]),
        cc("groceries", [6_000_00n], [3_000_00n, 3_000_00n, 100n, 100n]),
        cc("cafe", [3_000_00n], [1_000_00n, 1_000_00n, 500_00n, 500_00n]),
      ],
      10_000_00n,
    );
    const groceries = out.find((s) => s.categoryId === "groceries")!;
    const cafe = out.find((s) => s.categoryId === "cafe")!;
    // масштаб 6900/9900: 6600 → 4600 (floor до 100), 3300 → 2300
    expect(groceries.suggestedPlan).toBe(4_600_00n);
    expect(cafe.suggestedPlan).toBe(2_300_00n);
    expect(groceries.note).toContain("зменшено");
    // резервна категорія не масштабується
    expect(out.find((s) => s.categoryId === "utilities")!.suggestedPlan).toBe(3_100_00n);
  });
});

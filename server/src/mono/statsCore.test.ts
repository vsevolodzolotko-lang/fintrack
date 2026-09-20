import { describe, expect, it } from "vitest";
import { computeStatsCore, type CategoryInput, type CycleInput, type TxInput } from "./statsCore.js";

// Усі дати — фіксований липень 2026, Київ (+03:00 влітку).
const cycle: CycleInput = {
  id: "c1",
  startDate: new Date("2026-07-06T00:00:00+03:00"),
  expectedEnd: new Date("2026-08-06T00:00:00+03:00"),
  endDate: null,
  pctInvestment: 15,
  pctGoals: 15,
  pctLiving: 70,
  goalsCarryUah: 0n,
  investCarryUah: 0n,
  livingCarryUah: 0n,
};
const NOW = new Date("2026-07-10T12:00:00+03:00"); // daysLeft = 28 (10 лип..6 серп включно)

const income = (uahKop: bigint): TxInput => ({
  amount: uahKop, envelope: "INCOME", isIncome: true,
  time: new Date("2026-07-06T09:00:00+03:00"), categoryId: null,
});
const spend = (uahKop: bigint, time: string, categoryId: string | null = null): TxInput => ({
  amount: -uahKop, envelope: "LIVING", isIncome: false, time: new Date(time), categoryId,
});
const refund = (uahKop: bigint, time: string): TxInput => ({
  amount: uahKop, envelope: "LIVING", isIncome: false, time: new Date(time), categoryId: null,
});

describe("computeStatsCore (поточна математика, без резервів)", () => {
  it("рахує бюджети конвертів з підтвердженого доходу", () => {
    const s = computeStatsCore(cycle, [income(100_000_00n)], [], 0n, 0n, NOW);
    expect(s.incomeTotal).toBe(100_000_00n);
    expect(s.livingBudget).toBe(70_000_00n);
    expect(s.goalsBudget).toBe(15_000_00n);
    expect(s.investmentBudget).toBe(15_000_00n);
  });

  it("денний ліміт = (livingBudget − livingSpent) / daysLeft", () => {
    const txs = [income(100_000_00n), spend(14_000_00n, "2026-07-07T13:00:00+03:00")];
    const s = computeStatsCore(cycle, txs, [], 0n, 0n, NOW);
    expect(s.livingSpent).toBe(14_000_00n);
    expect(s.daysLeft).toBe(28);
    expect(s.dailyLimit).toBe(2_000_00n); // 56 000 / 28
  });

  it("spentToday рахує лише витрати LIVING за київський «сьогодні»", () => {
    const txs = [
      income(100_000_00n),
      spend(300_00n, "2026-07-10T09:00:00+03:00"),  // сьогодні
      spend(500_00n, "2026-07-09T23:30:00+03:00"),  // вчора
    ];
    const s = computeStatsCore(cycle, txs, [], 0n, 0n, NOW);
    expect(s.spentToday).toBe(300_00n);
    expect(s.safeToday).toBe(s.dailyLimit - 300_00n);
  });

  it("повернення зменшує livingSpent і піднімає денний ліміт", () => {
    const txs = [
      income(100_000_00n),
      spend(14_000_00n, "2026-07-07T13:00:00+03:00"),
      refund(500_00n, "2026-07-08T10:00:00+03:00"),
    ];
    const s = computeStatsCore(cycle, txs, [], 0n, 0n, NOW);
    expect(s.livingSpent).toBe(13_500_00n);
    expect(s.dailyLimit).toBe((70_000_00n - 13_500_00n) / 28n);
  });

  it("повернення НЕ чіпає spentToday", () => {
    const txs = [
      income(100_000_00n),
      spend(300_00n, "2026-07-10T09:00:00+03:00"),
      refund(1_000_00n, "2026-07-10T11:00:00+03:00"), // сьогодні
    ];
    const s = computeStatsCore(cycle, txs, [], 0n, 0n, NOW);
    expect(s.spentToday).toBe(300_00n);          // повернення не зменшує «сьогодні»
    expect(s.livingSpent).toBe(-700_00n);        // але зменшує суму за цикл
  });

  it("повернення не потрапляє в розбивку за категоріями", () => {
    const cats: CategoryInput[] = [
      { id: "cat1", name: "Продукти", color: null, plannedAmount: null, reserveUpfront: false },
    ];
    const txs = [
      income(100_000_00n),
      spend(2_000_00n, "2026-07-07T13:00:00+03:00", "cat1"),
      refund(500_00n, "2026-07-08T10:00:00+03:00"),
    ];
    const s = computeStatsCore(cycle, txs, cats, 0n, 0n, NOW);
    expect(s.byCategory[0].spent).toBe(2_000_00n); // категорія без змін
    expect(s.livingSpent).toBe(1_500_00n);         // сума за цикл — з поверненням
  });

  it("дохід (INCOME) не плутається з поверненням", () => {
    const s = computeStatsCore(cycle, [income(600_00n)], [], 0n, 0n, NOW);
    expect(s.incomeTotal).toBe(600_00n);
    expect(s.livingSpent).toBe(0n);
    expect(s.investmentBudget).toBe(90_00n);
    expect(s.goalsBudget).toBe(90_00n);
    expect(s.livingBudget).toBe(420_00n);
  });

  it("toInvest = investmentBudget − внески", () => {
    const s = computeStatsCore(cycle, [income(100_000_00n)], [], 5_000_00n, 0n, NOW);
    expect(s.toInvest).toBe(10_000_00n);
  });

  it("toGoals = goalsBudget − внесено на білу карту", () => {
    const s = computeStatsCore(cycle, [income(100_000_00n)], [], 0n, 4_000_00n, NOW);
    expect(s.goalsBudget).toBe(15_000_00n);
    expect(s.goalsContributed).toBe(4_000_00n);
    expect(s.toGoals).toBe(11_000_00n);
  });
});

const cat = (id: string, planned: bigint | null, reserveUpfront = false): CategoryInput => ({
  id, name: id, color: null, plannedAmount: planned, reserveUpfront,
});

describe("computeStatsCore (резервна математика)", () => {
  // Дохід 100 000 грн → livingBudget 70 000. Комуналка: план 3 000, reserveUpfront.
  const utilities = cat("utilities", 3_000_00n, true);
  const groceries = cat("groceries", 20_000_00n, false);
  const base = [income(100_000_00n)];

  it("резерв тримає оцінку до оплати", () => {
    const s = computeStatsCore(cycle, base, [utilities, groceries], 0n, 0n, NOW);
    expect(s.reservedCommitment).toBe(3_000_00n);
    expect(s.flexibleBudget).toBe(67_000_00n);
    expect(s.flexibleRemaining).toBe(67_000_00n);
    expect(s.dailyLimit).toBe(67_000_00n / 28n);
  });

  it("оплата в межах оцінки не рухає денний ліміт", () => {
    const before = computeStatsCore(cycle, base, [utilities], 0n, 0n, NOW);
    const after = computeStatsCore(
      cycle,
      [...base, spend(2_800_00n, "2026-07-09T10:00:00+03:00", "utilities")],
      [utilities], 0n, 0n, NOW,
    );
    expect(after.reservedCommitment).toBe(3_000_00n); // max(3000, 2800)
    expect(after.dailyLimit).toBe(before.dailyLimit);
    expect(after.flexibleRemaining).toBe(before.flexibleRemaining);
  });

  it("перевитрата оцінки просаджує пул на різницю", () => {
    const before = computeStatsCore(cycle, base, [utilities], 0n, 0n, NOW);
    const after = computeStatsCore(
      cycle,
      [...base, spend(3_500_00n, "2026-07-09T10:00:00+03:00", "utilities")],
      [utilities], 0n, 0n, NOW,
    );
    expect(after.reservedCommitment).toBe(3_500_00n);
    expect(after.flexibleRemaining).toBe(before.flexibleRemaining - 500_00n);
  });

  it("витрата R-категорії «сьогодні» не зʼїдає safeToday", () => {
    const s = computeStatsCore(
      cycle,
      [...base,
        spend(2_800_00n, "2026-07-10T09:00:00+03:00", "utilities"), // сьогодні, зарезервовано
        spend(400_00n, "2026-07-10T10:00:00+03:00", "groceries")],  // сьогодні, гнучке
      [utilities, groceries], 0n, 0n, NOW,
    );
    expect(s.spentToday).toBe(400_00n);
    expect(s.safeToday).toBe(s.dailyLimit - 400_00n);
  });

  it("byCategory віддає spent/planned/reserveUpfront по всіх LIVING-категоріях", () => {
    const s = computeStatsCore(
      cycle,
      [...base, spend(1_200_00n, "2026-07-08T10:00:00+03:00", "groceries")],
      [utilities, groceries], 0n, 0n, NOW,
    );
    expect(s.byCategory).toEqual([
      { categoryId: "utilities", name: "utilities", color: null, spent: 0n, planned: 3_000_00n, reserveUpfront: true },
      { categoryId: "groceries", name: "groceries", color: null, spent: 1_200_00n, planned: 20_000_00n, reserveUpfront: false },
    ]);
  });

  it("без резервів математика збігається зі старою (Цикл 1)", () => {
    const txs = [...base, spend(14_000_00n, "2026-07-07T13:00:00+03:00", "groceries")];
    const s = computeStatsCore(cycle, txs, [cat("groceries", null)], 0n, 0n, NOW);
    expect(s.reservedCommitment).toBe(0n);
    expect(s.flexibleBudget).toBe(s.livingBudget);
    expect(s.dailyLimit).toBe(2_000_00n); // (70 000 − 14 000) / 28
  });

  it("overspendForecast не тригериться коли резерви більші за бюджет і немає витрат", () => {
    const overReserved = cat("utilities", 80_000_00n, true); // резерв > livingBudget (70 000)
    const s = computeStatsCore(cycle, base, [overReserved], 0n, 0n, NOW);
    expect(s.flexibleBudget).toBeLessThanOrEqual(0n);
    expect(s.overspendForecast).toBe(false);
  });
});

describe("computeStatsCore (темп циклу)", () => {
  it("віддає daysElapsed і totalDays для мітки темпу", () => {
    const s = computeStatsCore(cycle, [income(100_000_00n)], [], 0n, 0n, NOW);
    expect(s.daysElapsed).toBe(5); // 6..10 лип. включно
    expect(s.totalDays).toBe(32); // 6 лип...6 серп. включно
  });

  it("daysElapsed може перевищити totalDays, коли ЗП запізнюється", () => {
    const late = new Date("2026-08-10T12:00:00+03:00"); // після expectedEnd
    const s = computeStatsCore(cycle, [income(100_000_00n)], [], 0n, 0n, late);
    expect(s.totalDays).toBe(32);
    expect(s.daysElapsed).toBe(36); // риску клампить клієнт (100%)
  });
});

describe("investmentBudget — ціла гривня (узгодження з планом)", () => {
  it("15% від 126 383,75 = 18 957,56 → флориться до 18 957,00", () => {
    const cycle = {
      id: "c-floor", startDate: new Date("2026-07-01T00:00:00Z"),
      expectedEnd: new Date("2026-08-01T00:00:00Z"), endDate: null,
      pctInvestment: 15, pctGoals: 15, pctLiving: 70,
      goalsCarryUah: 0n, investCarryUah: 0n, livingCarryUah: 0n,
    };
    const s = computeStatsCore(
      cycle,
      [{ amount: 12_638_375n, envelope: "INCOME", isIncome: true, time: new Date("2026-07-02T10:00:00Z"), categoryId: null }],
      [], 0n, 0n, new Date("2026-07-10T12:00:00Z"),
    );
    expect(s.investmentBudget).toBe(18_957_00n);
    expect(s.toInvest).toBe(18_957_00n);
    // goals/living НЕ флоряться (поза обсягом)
    expect(s.goalsBudget).toBe(18_957_56n);
  });
});

describe("перенос залишку з минулого циклу (carry)", () => {
  const withCarry: CycleInput = {
    ...cycle,
    goalsCarryUah: 3_000_00n,
    investCarryUah: 2_000_00n,
    livingCarryUah: 240_00n,
  };

  it("carry додається ПОНАД відсотки, а не замість них", () => {
    const s = computeStatsCore(withCarry, [income(100_000_00n)], [], 0n, 0n, NOW);
    expect(s.goalsBudget).toBe(18_000_00n);      // 15 000 + 3 000
    expect(s.investmentBudget).toBe(17_000_00n); // 15 000 + 2 000
    expect(s.livingBudget).toBe(70_240_00n);     // 70 000 + 240
  });

  it("денний ліміт рахується від роздутого побуту", () => {
    const s = computeStatsCore(withCarry, [income(100_000_00n)], [], 0n, 0n, NOW);
    expect(s.daysLeft).toBe(28);
    expect(s.dailyLimit).toBe(250_857n); // 7 024 000 / 28, floor
  });

  it("toGoals/toInvest рахуються від роздутих цілей", () => {
    const s = computeStatsCore(withCarry, [income(100_000_00n)], [], 5_000_00n, 4_000_00n, NOW);
    expect(s.toGoals).toBe(14_000_00n);  // 18 000 − 4 000 внесено
    expect(s.toInvest).toBe(12_000_00n); // 17 000 − 5 000 внесено
  });

  it("carry віддається назовні для показу в UI", () => {
    const s = computeStatsCore(withCarry, [income(100_000_00n)], [], 0n, 0n, NOW);
    expect(s.goalsCarryUah).toBe(3_000_00n);
    expect(s.investCarryUah).toBe(2_000_00n);
    expect(s.livingCarryUah).toBe(240_00n);
  });

  it("нульовий carry нічого не змінює", () => {
    const s = computeStatsCore(cycle, [income(100_000_00n)], [], 0n, 0n, NOW);
    expect(s.livingBudget).toBe(70_000_00n);
    expect(s.livingCarryUah).toBe(0n);
  });
});

import { describe, expect, it } from "vitest";
import {
  computeGoalsSummary, validateAllocation, validateTransfer, computeClosedGoals, explainDeficit, goalDeductionFor,
  type GoalInput, type AllocationInput, type ClosedGoalInput,
} from "./goalsCore.js";

const goals: GoalInput[] = [
  { id: "g1", title: "Коляска", targetAmount: 10_000_00n, deadline: null, sortOrder: 0 },
  { id: "g2", title: "Телевізор", targetAmount: 20_000_00n, deadline: null, sortOrder: 1 },
];
const allocs: AllocationInput[] = [
  { goalId: "g1", amount: 7_000_00n },
  { goalId: "g2", amount: 3_000_00n },
];

describe("computeGoalsSummary", () => {
  it("рахує баланс, allocated, unallocated", () => {
    const s = computeGoalsSummary(12_000_00n, goals, allocs);
    expect(s.allocated).toBe(10_000_00n);
    expect(s.unallocated).toBe(2_000_00n); // 12000 - 10000
    expect(s.goals.find((g) => g.id === "g1")!.balance).toBe(7_000_00n);
  });

  it("progress capped at 1, reached коли balance >= target", () => {
    const s = computeGoalsSummary(30_000_00n, goals, [
      { goalId: "g1", amount: 12_000_00n }, // > target 10000
      { goalId: "g2", amount: 5_000_00n },
    ]);
    const g1 = s.goals.find((g) => g.id === "g1")!;
    expect(g1.progress).toBe(1);
    expect(g1.reached).toBe(true);
    expect(s.goals.find((g) => g.id === "g2")!.reached).toBe(false);
  });

  it("переливання (нетто-нуль) не змінює allocated/unallocated", () => {
    const s = computeGoalsSummary(12_000_00n, goals, [
      ...allocs,
      { goalId: "g1", amount: -1_000_00n },
      { goalId: "g2", amount: 1_000_00n },
    ]);
    expect(s.allocated).toBe(10_000_00n);
    expect(s.unallocated).toBe(2_000_00n);
    expect(s.goals.find((g) => g.id === "g1")!.balance).toBe(6_000_00n);
    expect(s.goals.find((g) => g.id === "g2")!.balance).toBe(4_000_00n);
  });

  // Закриття цілі = вона більше не ACTIVE, тож у computeGoalsSummary її не подають.
  // Куплено за 9 500 із відкладених 10 000: контейнер 12 000 → 2 500, ціль g1 вилітає.
  it("закрита ціль звільняє алокації → невитрачений залишок у вільному пулі", () => {
    const active = goals.filter((g) => g.id !== "g1");
    const s = computeGoalsSummary(2_500_00n, active, [
      { goalId: "g1", amount: 10_000_00n }, // алокації закритої цілі лишились в історії
      { goalId: "g2", amount: 0n },
    ].filter((a) => active.some((g) => g.id === a.goalId)));
    expect(s.allocated).toBe(0n);
    expect(s.unallocated).toBe(2_500_00n); // 2000 нерозподілених + 500 зекономлених
  });

  it("target <= 0 → progress 0, не reached", () => {
    const s = computeGoalsSummary(0n, [{ id: "g3", title: "x", targetAmount: 0n, deadline: null, sortOrder: 0 }], []);
    expect(s.goals[0].progress).toBe(0);
    expect(s.goals[0].reached).toBe(false);
  });
});

const closedGoals: ClosedGoalInput[] = [
  { id: "c1", title: "Iphone", targetAmount: 18_000_00n, spentAmount: 18_000_00n, closedAt: new Date("2026-08-04T10:00:00Z") },
  { id: "c2", title: "Візочок", targetAmount: 10_000_00n, spentAmount: 10_200_00n, closedAt: new Date("2026-08-02T10:00:00Z") },
];

describe("computeClosedGoals", () => {
  it("рахує allocated з алокацій і delta = витрачено − відкладено", () => {
    const r = computeClosedGoals(closedGoals, [{ goalId: "c2", amount: 10_000_00n }]);
    const c1 = r.goals.find((g) => g.id === "c1")!;
    const c2 = r.goals.find((g) => g.id === "c2")!;
    // На iphone не відкладали нічого — витрата пішла з вільного пулу.
    expect(c1.allocated).toBe(0n);
    expect(c1.delta).toBe(18_000_00n);
    // На візочок відкладали 10 000, доплатили 200.
    expect(c2.allocated).toBe(10_000_00n);
    expect(c2.delta).toBe(200_00n);
  });

  it("spentTotal — сума фактично витраченого, не відкладеного", () => {
    const r = computeClosedGoals(closedGoals, [{ goalId: "c2", amount: 10_000_00n }]);
    expect(r.spentTotal).toBe(28_200_00n);
  });

  it("зекономлене дає відʼємну delta", () => {
    const r = computeClosedGoals(
      [{ id: "c3", title: "Диван", targetAmount: 5_000_00n, spentAmount: 4_500_00n, closedAt: null }],
      [{ goalId: "c3", amount: 5_000_00n }],
    );
    expect(r.goals[0].delta).toBe(-500_00n);
  });

  it("рівно з відкладеного → delta нуль", () => {
    const r = computeClosedGoals(
      [{ id: "c4", title: "Крісло", targetAmount: 3_000_00n, spentAmount: 3_000_00n, closedAt: null }],
      [{ goalId: "c4", amount: 3_000_00n }],
    );
    expect(r.goals[0].delta).toBe(0n);
  });

  it("алокації чужих цілей не течуть у підсумок", () => {
    const r = computeClosedGoals(closedGoals, [
      { goalId: "c2", amount: 10_000_00n },
      { goalId: "стороння-активна-ціль", amount: 7_000_00n },
    ]);
    expect(r.goals.find((g) => g.id === "c1")!.allocated).toBe(0n);
    expect(r.spentTotal).toBe(28_200_00n);
  });

  it("порожній список → нуль і порожньо", () => {
    const r = computeClosedGoals([], []);
    expect(r.goals).toEqual([]);
    expect(r.spentTotal).toBe(0n);
  });

  it("переливання між цілями враховане в allocated нетто", () => {
    const r = computeClosedGoals(
      [{ id: "c5", title: "Стіл", targetAmount: 4_000_00n, spentAmount: 4_000_00n, closedAt: null }],
      [{ goalId: "c5", amount: 5_000_00n }, { goalId: "c5", amount: -1_000_00n }],
    );
    expect(r.goals[0].allocated).toBe(4_000_00n);
    expect(r.goals[0].delta).toBe(0n);
  });
});

describe("validateAllocation", () => {
  it("додатне понад unallocated → помилка", () => {
    expect(validateAllocation(1_000_00n, 0n, 2_000_00n)).toMatch(/нерозподілен/i);
  });
  it("від'ємне понад баланс цілі → помилка", () => {
    expect(validateAllocation(1_000_00n, 500_00n, -1_000_00n)).toMatch(/недостатньо/i);
  });
  it("нуль → помилка", () => {
    expect(validateAllocation(1_000_00n, 0n, 0n)).not.toBeNull();
  });
  it("коректне додатне і від'ємне → null", () => {
    expect(validateAllocation(1_000_00n, 0n, 1_000_00n)).toBeNull();
    expect(validateAllocation(0n, 1_000_00n, -1_000_00n)).toBeNull();
  });
});

describe("validateTransfer", () => {
  it("сума <= 0 → помилка", () => {
    expect(validateTransfer(5_000_00n, 0n)).not.toBeNull();
    expect(validateTransfer(5_000_00n, -1n)).not.toBeNull();
  });
  it("понад баланс джерела → помилка", () => {
    expect(validateTransfer(1_000_00n, 2_000_00n)).toMatch(/недостатньо/i);
  });
  it("коректне → null", () => {
    expect(validateTransfer(5_000_00n, 1_000_00n)).toBeNull();
  });
});

describe("списання з білої картки, не покриті цілями", () => {
  const out = (id: string, amount: bigint, time: string) => ({ id, amount, time: new Date(time) });

  it("explainDeficit: підсвічує найсвіжіші списання, поки їх сума не покриє дефіцит", () => {
    const rows = [
      out("old", -5_000_00n, "2026-08-01T10:00:00Z"),
      out("mid", -8_00n, "2026-09-10T10:00:00Z"),
      out("new", -12_35n, "2026-09-20T10:00:00Z"),
    ];
    // дефіцит 15,00: «new» (12,35) не покриває, «mid» (8,00) добиває; «old» — ні
    expect(explainDeficit(-15_00n, rows)).toEqual(new Set(["new", "mid"]));
  });

  it("explainDeficit: порожній набір, коли пул не в мінусі", () => {
    expect(explainDeficit(0n, [out("a", -1_00n, "2026-09-20T10:00:00Z")])).toEqual(new Set());
    expect(explainDeficit(5_00n, [out("a", -1_00n, "2026-09-20T10:00:00Z")])).toEqual(new Set());
  });

  it("explainDeficit: якщо списань замало — підсвічує всі", () => {
    const rows = [out("a", -1_00n, "2026-09-20T10:00:00Z"), out("b", -2_00n, "2026-09-21T10:00:00Z")];
    expect(explainDeficit(-10_00n, rows)).toEqual(new Set(["a", "b"]));
  });

  it("goalDeductionFor: з цілі знімається лише те, чого не покрив вільний пул", () => {
    expect(goalDeductionFor(-12_35n, 12_35n)).toBe(12_35n);  // пул в мінусі рівно на списання
    expect(goalDeductionFor(-5_00n, 12_35n)).toBe(5_00n);    // частину покрив пул
    expect(goalDeductionFor(0n, 12_35n)).toBe(0n);           // пул уже збалансований
    expect(goalDeductionFor(3_00n, 12_35n)).toBe(0n);        // вільних вистачило
    expect(goalDeductionFor(-50_00n, 12_35n)).toBe(12_35n);  // дефіцит більший за це списання
  });
});

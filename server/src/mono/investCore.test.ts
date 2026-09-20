import { describe, expect, it } from "vitest";
import { computeInvestmentPlan } from "./investCore.js";

const PCTS = { OVDP: 65, REIT: 25, CRYPTO: 10 };

describe("computeInvestmentPlan — цілі гривні, точна сума", () => {
  it("реальний кейс: 18 957,56 → 12 322 / 4 739 / 1 896, сума точно в бюджет", () => {
    const p = computeInvestmentPlan(18_957_56n, PCTS, {});
    const t = Object.fromEntries(p.targets.map((x) => [x.kind, x]));
    expect(p.investmentBudget).toBe(18_957_00n); // флорений до цілої грн
    expect(t.OVDP.targetUah).toBe(12_322_00n);   // floor(18957 × 65%)
    expect(t.REIT.targetUah).toBe(4_739_00n);    // floor(18957 × 25%)
    expect(t.CRYPTO.targetUah).toBe(1_896_00n);  // залишок: 18957 − 12322 − 4739
    expect(t.OVDP.targetUah + t.REIT.targetUah + t.CRYPTO.targetUah).toBe(p.investmentBudget);
    expect(p.targets.map((x) => x.kind)).toEqual(["OVDP", "REIT", "CRYPTO"]);
  });

  it("цілогривневий внесок закриває крок рівно (фікс «Частково» через 39 коп)", () => {
    const p = computeInvestmentPlan(18_957_56n, PCTS, { REIT: 4_739_00n, CRYPTO: 1_896_00n });
    const t = Object.fromEntries(p.targets.map((x) => [x.kind, x]));
    expect(t.REIT.done).toBe(true);
    expect(t.CRYPTO.done).toBe(true);
    expect(p.stepsDone).toBe(2);
  });

  it("done при точній рівності, remaining 0", () => {
    const p = computeInvestmentPlan(8_550_00n, PCTS, { OVDP: 5_557_00n });
    const ovdp = p.targets.find((x) => x.kind === "OVDP")!;
    expect(ovdp.targetUah).toBe(5_557_00n); // floor(8550 × 65% = 5557,50)
    expect(ovdp.done).toBe(true);
    expect(ovdp.remainingUah).toBe(0n);
  });

  it("totalRemaining = сума remainings по кроках (переплата не гасить інші)", () => {
    const p = computeInvestmentPlan(8_550_00n, PCTS, { CRYPTO: 999_00n });
    const t = Object.fromEntries(p.targets.map((x) => [x.kind, x]));
    expect(t.CRYPTO.remainingUah).toBe(0n); // переплата → clamp
    // CRYPTO = 8550 − 5557 − 2137 = 856
    expect(p.totalRemaining).toBe(5_557_00n + 2_137_00n);
  });

  it("нульовий бюджет → нульові цілі, нічого не done", () => {
    const p = computeInvestmentPlan(0n, PCTS, {});
    expect(p.targets.every((x) => x.targetUah === 0n && !x.done)).toBe(true);
    expect(p.stepsDone).toBe(0);
    expect(p.totalRemaining).toBe(0n);
  });

  it("carry додається лише до цілі OVDP", () => {
    const p = computeInvestmentPlan(18_957_00n, PCTS, {}, 850_00n);
    const t = Object.fromEntries(p.targets.map((x) => [x.kind, x]));
    expect(t.OVDP.targetUah).toBe(12_322_00n + 850_00n);
    expect(t.REIT.targetUah).toBe(4_739_00n);   // не змінилась
    expect(t.CRYPTO.targetUah).toBe(1_896_00n); // залишок від бази, ДО carry
    expect(p.totalRemaining).toBe(13_172_00n + 4_739_00n + 1_896_00n);
  });

  it("внесок покриває базу + carry → done", () => {
    const p = computeInvestmentPlan(18_957_00n, PCTS, { OVDP: 13_172_00n }, 850_00n);
    const ovdp = p.targets.find((x) => x.kind === "OVDP")!;
    expect(ovdp.done).toBe(true);
    expect(ovdp.remainingUah).toBe(0n);
  });
});

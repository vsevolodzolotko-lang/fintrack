import { describe, expect, it } from "vitest";
import {
  classifyForBackfill,
  createsObligations,
  effectOfKind,
  incomeMatchKey,
  previewSplit,
  suggestStartsCycle,
} from "./incomeCore.js";

const PCTS = { investment: 15, goals: 15, living: 70 };

describe("effectOfKind", () => {
  it("зарплата й інший дохід — дохід у конверті INCOME", () => {
    expect(effectOfKind("SALARY")).toEqual({ envelope: "INCOME", isIncome: true });
    expect(effectOfKind("OTHER_INCOME")).toEqual({ envelope: "INCOME", isIncome: true });
  });

  it("повернення й кешбек — позитивний LIVING, не дохід", () => {
    expect(effectOfKind("REFUND")).toEqual({ envelope: "LIVING", isIncome: false });
    expect(effectOfKind("CASHBACK")).toEqual({ envelope: "LIVING", isIncome: false });
  });

  it("переказ між своїми — нейтральний конверт", () => {
    expect(effectOfKind("SELF_TRANSFER")).toEqual({ envelope: "INTERNAL_TRANSFER", isIncome: false });
  });
});

describe("createsObligations", () => {
  it("зобов'язання створюють лише два типи доходу", () => {
    expect(createsObligations("SALARY")).toBe(true);
    expect(createsObligations("OTHER_INCOME")).toBe(true);
    expect(createsObligations("REFUND")).toBe(false);
    expect(createsObligations("CASHBACK")).toBe(false);
    expect(createsObligations("SELF_TRANSFER")).toBe(false);
  });
});

describe("previewSplit", () => {
  it("600 ₴ → 90 інвест / 90 цілі / 420 побут", () => {
    expect(previewSplit(600_00n, PCTS)).toEqual({
      investment: 90_00n, goals: 90_00n, living: 420_00n,
    });
  });

  it("інвестиційна частка флориться до цілої гривні (як statsCore)", () => {
    // 133 ₴ * 15% = 19,95 ₴ → 19 ₴
    expect(previewSplit(133_00n, PCTS).investment).toBe(19_00n);
  });

  it("цілі й побут — без флору, копійки лишаються", () => {
    const s = previewSplit(133_00n, PCTS);
    expect(s.goals).toBe(19_95n);
    expect(s.living).toBe(93_10n);
  });

  it("нуль і від'ємне дають нулі", () => {
    expect(previewSplit(0n, PCTS)).toEqual({ investment: 0n, goals: 0n, living: 0n });
    expect(previewSplit(-500_00n, PCTS)).toEqual({ investment: 0n, goals: 0n, living: 0n });
  });
});

describe("suggestStartsCycle", () => {
  it("сума ≥ порогу пропонує новий цикл", () => {
    expect(suggestStartsCycle(40_000_00n, 40_000_00n)).toBe(true);
    expect(suggestStartsCycle(55_000_00n, 40_000_00n)).toBe(true);
  });

  it("сума менша за поріг — у поточний цикл", () => {
    expect(suggestStartsCycle(600_00n, 40_000_00n)).toBe(false);
    expect(suggestStartsCycle(39_999_99n, 40_000_00n)).toBe(false);
  });
});

describe("incomeMatchKey", () => {
  it("ЄДРПОУ має найвищий приоритет", () => {
    expect(incomeMatchKey({ counterEdrpou: "12345678", counterIban: "UA123", description: "ЗП" }))
      .toBe("edrpou:12345678");
  });

  it("без ЄДРПОУ — IBAN", () => {
    expect(incomeMatchKey({ counterEdrpou: null, counterIban: "UA123456", description: "ЗП" }))
      .toBe("iban:UA123456");
  });

  it("без обох — нормалізований опис", () => {
    expect(incomeMatchKey({ counterEdrpou: null, counterIban: null, description: "  Кешбек  Mono " }))
      .toBe("desc:кешбек mono");
  });

  it("порожній опис без реквізитів → null (правило не створюється)", () => {
    expect(incomeMatchKey({ counterEdrpou: null, counterIban: null, description: "   " })).toBe(null);
  });
});

describe("classifyForBackfill", () => {
  it("підтверджений дохід, що відкривав цикл → SALARY", () => {
    expect(classifyForBackfill({ amount: 50_000_00n, envelope: "INCOME", isIncome: true, opensCycle: true }))
      .toEqual({ action: "set", kind: "SALARY" });
  });

  it("підтверджений дохід без циклу → OTHER_INCOME", () => {
    expect(classifyForBackfill({ amount: 3_000_00n, envelope: "INCOME", isIncome: true, opensCycle: false }))
      .toEqual({ action: "set", kind: "OTHER_INCOME" });
  });

  it("позитивний внутрішній переказ → SELF_TRANSFER", () => {
    expect(classifyForBackfill({ amount: 1_000_00n, envelope: "INTERNAL_TRANSFER", isIncome: false, opensCycle: false }))
      .toEqual({ action: "set", kind: "SELF_TRANSFER" });
  });

  it("поповнення контейнера «Цілі» не чіпаємо", () => {
    expect(classifyForBackfill({ amount: 5_000_00n, envelope: "GOAL_CONTRIBUTION", isIncome: false, opensCycle: false }))
      .toEqual({ action: "skip" });
  });

  it("непідтверджене надходження (в т.ч. старий return) → назад у чергу", () => {
    expect(classifyForBackfill({ amount: 600_00n, envelope: "INCOME", isIncome: false, opensCycle: false }))
      .toEqual({ action: "requeue" });
  });

  it("витрати не класифікуються", () => {
    expect(classifyForBackfill({ amount: -600_00n, envelope: "LIVING", isIncome: false, opensCycle: false }))
      .toEqual({ action: "skip" });
  });
});

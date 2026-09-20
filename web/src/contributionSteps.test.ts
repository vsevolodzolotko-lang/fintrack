import { describe, expect, it } from "vitest";
import { shownStep, stepLabel, totalSteps } from "./contributionSteps";

describe("totalSteps", () => {
  it("0 (крипта з ключем Binance) рахується як двокроковий вхід", () => {
    expect(totalSteps(0)).toBe(2);
  });

  it("звичайний total лишається як є", () => {
    expect(totalSteps(2)).toBe(2);
    expect(totalSteps(3)).toBe(3);
  });
});

describe("shownStep", () => {
  it("крок 3 (запис) показується як останній крок трикрокового флоу — ОВДП", () => {
    expect(shownStep(1, 3)).toBe(1);
    expect(shownStep(2, 3)).toBe(2);
    expect(shownStep(3, 3)).toBe(3);
  });

  it("крок 3 у двокроковому флоу показується як крок 2 з 2", () => {
    expect(shownStep(3, 2)).toBe(2);
  });

  it("крок 3 при total === 0 показується як крок 2 з 2", () => {
    expect(shownStep(3, 0)).toBe(2);
  });
});

describe("stepLabel", () => {
  it("три кроки ОВДП", () => {
    expect(stepLabel(1, 3)).toBe("Крок 1 з 3 · відправка");
    expect(stepLabel(2, 3)).toBe("Крок 2 з 3 · купівля");
    expect(stepLabel(3, 3)).toBe("Крок 3 з 3 · запис");
  });

  it("двокроковий інструмент на кроці 3 → «крок 2 з 2»", () => {
    expect(stepLabel(3, 2)).toBe("Крок 2 з 2 · запис");
  });

  it("steps === 0 (ручний вхід для крипти поза Binance) трактується як 2", () => {
    expect(stepLabel(1, 0)).toBe("Крок 1 з 2 · відправка");
    expect(stepLabel(3, 0)).toBe("Крок 2 з 2 · запис");
  });
});

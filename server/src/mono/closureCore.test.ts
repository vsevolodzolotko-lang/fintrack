import { describe, expect, it } from "vitest";
import {
  computeLeftoverFact,
  validateSplit,
  type SplitResult,
} from "./closureCore.js";

describe("computeLeftoverFact", () => {
  it("баланс після ЗП мінус сама ЗП = залишок на картці до неї", () => {
    // на картці лежало 5 240,00; прийшло 40 000,00 → Mono віддав balance 45 240,00
    expect(computeLeftoverFact(45_240_00n, 40_000_00n)).toBe(5_240_00n);
  });

  it("Mono не віддав balance → null (фолбек на розрахунок)", () => {
    expect(computeLeftoverFact(null, 40_000_00n)).toBeNull();
    expect(computeLeftoverFact(undefined, 40_000_00n)).toBeNull();
  });

  it("картка була в нулі → 0, а не null", () => {
    expect(computeLeftoverFact(40_000_00n, 40_000_00n)).toBe(0n);
  });
});

describe("validateSplit", () => {
  it("побут забирає автозалишок разом із копійками", () => {
    const r = validateSplit({ leftover: 5_240_37n, toGoals: 3_000_00n, toInvest: 2_000_00n });
    expect(r).toEqual({ toGoals: 3_000_00n, toInvest: 2_000_00n, toLiving: 240_37n });
  });

  it("сума трьох частин точно дорівнює залишку", () => {
    const r = validateSplit({ leftover: 5_240_37n, toGoals: 3_000_00n, toInvest: 2_000_00n }) as SplitResult;
    expect(r.toGoals + r.toInvest + r.toLiving).toBe(5_240_37n);
  });

  it("усе в цілі → побут рівно 0", () => {
    const r = validateSplit({ leftover: 3_000_00n, toGoals: 3_000_00n, toInvest: 0n });
    expect(r).toEqual({ toGoals: 3_000_00n, toInvest: 0n, toLiving: 0n });
  });

  it("нічого не розподілено → усе лишається в побуті", () => {
    const r = validateSplit({ leftover: 5_240_37n, toGoals: 0n, toInvest: 0n });
    expect(r).toEqual({ toGoals: 0n, toInvest: 0n, toLiving: 5_240_37n });
  });

  it("відʼємний залишок відхиляється", () => {
    expect(validateSplit({ leftover: -1n, toGoals: 0n, toInvest: 0n }))
      .toEqual({ error: "negative_leftover" });
  });

  it("відʼємна частина відхиляється", () => {
    expect(validateSplit({ leftover: 5_000_00n, toGoals: -100_00n, toInvest: 0n }))
      .toEqual({ error: "negative_part" });
    expect(validateSplit({ leftover: 5_000_00n, toGoals: 0n, toInvest: -100_00n }))
      .toEqual({ error: "negative_part" });
  });

  it("частини більші за залишок відхиляються", () => {
    expect(validateSplit({ leftover: 5_000_00n, toGoals: 3_000_00n, toInvest: 2_000_01n }))
      .toEqual({ error: "over_leftover" });
  });
});

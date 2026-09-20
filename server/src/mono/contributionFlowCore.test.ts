import { describe, expect, it } from "vitest";
import { flowSteps, lotEstimate, sendAmount } from "./contributionFlowCore.js";

describe("sendAmount", () => {
  it("ціль мінус внесене, з розкладом на базу й недобір", () => {
    const r = sendAmount({ targetUah: 5_575_00n, contributedUah: 0n, carryUah: 700_00n });
    expect(r.amountUah).toBe(5_575_00n);
    expect(r.baseUah).toBe(4_875_00n);
    expect(r.carryUah).toBe(700_00n);
  });

  it("без недобору база дорівнює цілі", () => {
    const r = sendAmount({ targetUah: 1_875_00n, contributedUah: 0n, carryUah: 0n });
    expect(r.baseUah).toBe(1_875_00n);
    expect(r.carryUah).toBe(0n);
  });

  it("часткове внесення зменшує суму до відправки, розклад не міняється", () => {
    const r = sendAmount({ targetUah: 5_575_00n, contributedUah: 2_000_00n, carryUah: 700_00n });
    expect(r.amountUah).toBe(3_575_00n);
    expect(r.baseUah).toBe(4_875_00n);
  });

  it("внесено більше за ціль — нуль, а не відʼємне", () => {
    const r = sendAmount({ targetUah: 1_875_00n, contributedUah: 2_000_00n, carryUah: 0n });
    expect(r.amountUah).toBe(0n);
  });
});

describe("lotEstimate", () => {
  it("рахує, скільки лотів влізе, з обрізанням униз", () => {
    // 5 575 грн за ціною 1 037,71 → 5 шт (5 188,55), решта піде у вільні
    expect(lotEstimate(5_575_00n, 1_037_71n)).toEqual({ count: 5, unitPriceUah: 1_037_71n });
  });

  it("без історії купівель орієнтиру немає", () => {
    expect(lotEstimate(5_575_00n, null)).toBeNull();
  });

  it("сума менша за один лот — орієнтиру немає", () => {
    expect(lotEstimate(500_00n, 1_037_71n)).toBeNull();
  });

  it("нульові й відʼємні входи не ламають розрахунок", () => {
    expect(lotEstimate(0n, 1_037_71n)).toBeNull();
    expect(lotEstimate(5_575_00n, 0n)).toBeNull();
  });
});

describe("flowSteps", () => {
  it("ОВДП — три кроки: відправ, купи, запиши", () => {
    expect(flowSteps("OVDP", false)).toBe(3);
    expect(flowSteps("OVDP", true)).toBe(3);
  });

  it("REIT — два кроки: сертифікати дробові, купувати «скільки влізе» не треба", () => {
    expect(flowSteps("REIT", true)).toBe(2);
  });

  it("крипта з ключем Binance флоу не потребує зовсім", () => {
    expect(flowSteps("CRYPTO", true)).toBe(0);
  });

  it("крипта без ключа — ті самі два кроки", () => {
    expect(flowSteps("CRYPTO", false)).toBe(2);
  });
});

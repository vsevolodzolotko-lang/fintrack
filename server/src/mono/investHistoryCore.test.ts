import { describe, expect, it } from "vitest";
import { buildInvestHistory, type InvestHistoryInput } from "./investHistoryCore.js";

const NOW = new Date("2026-07-20T10:00:00.000Z");

function input(over: Partial<InvestHistoryInput> = {}): InvestHistoryInput {
  return {
    now: NOW,
    contributions: [],
    cashflows: [],
    valuations: [],
    conversions: [],
    cycles: [],
    ovdpCouponsUah: 0n,
    reitGainUah: null,
    cryptoGainUah: null,
    cryptoUnavailable: "no_data",
    ...over,
  };
}

const contrib = (over: Partial<InvestHistoryInput["contributions"][number]> = {}) => ({
  id: "c1",
  kind: "OVDP" as const,
  cycleId: null as string | null,
  date: new Date("2026-06-28T09:00:00.000Z"),
  amountUah: 4_175_00n,
  quantity: 4,
  source: "MANUAL" as const,
  note: null as string | null,
  usdtQty: null as string | null,
  ...over,
});

describe("buildInvestHistory — вісь часу", () => {
  it("зливає п'ять джерел в один спадний список", () => {
    const r = buildInvestHistory(input({
      contributions: [
        contrib({ id: "c1", date: new Date("2026-06-28T09:00:00.000Z") }),
        contrib({ id: "c2", kind: "REIT", date: new Date("2026-07-12T09:00:00.000Z"), amountUah: 1_875_00n, quantity: null }),
      ],
      cashflows: [
        { id: "f1", contributionId: "c1", date: new Date("2026-06-24T00:00:00.000Z"), kind: "COUPON", amountUah: 1_030_00n },
      ],
      valuations: [
        { id: "v1", date: new Date("2026-07-12T18:00:00.000Z"), valueUah: 28_400_00n, freeUah: 0n, note: null },
      ],
      conversions: [
        { id: "x1", date: new Date("2026-06-28T10:00:00.000Z"), fromAsset: "USDT", fromAmount: "17.9", toAsset: "BTC", toAmount: "0.0071" },
      ],
    }));

    expect(r.events.map((e) => e.id)).toEqual([
      "VALUATION:v1",      // 12 лип 18:00
      "CONTRIBUTION:c2",   // 12 лип 09:00
      "CONVERSION:x1",     // 28 чер 10:00
      "CONTRIBUTION:c1",   // 28 чер 09:00
      "COUPON:f1",         // 24 чер
    ]);
    expect(r.firstEventAt).toBe(new Date("2026-06-24T00:00:00.000Z").toISOString());
  });

  it("майбутні купони й погашення у стрічку не потрапляють", () => {
    const r = buildInvestHistory(input({
      contributions: [contrib()],
      cashflows: [
        { id: "past", contributionId: "c1", date: new Date("2026-06-24T00:00:00.000Z"), kind: "COUPON", amountUah: 1_030_00n },
        { id: "soon", contributionId: "c1", date: new Date("2026-08-18T00:00:00.000Z"), kind: "COUPON", amountUah: 1_030_00n },
        { id: "end", contributionId: "c1", date: new Date("2027-02-14T00:00:00.000Z"), kind: "REDEMPTION", amountUah: 11_400_00n },
      ],
    }));

    expect(r.events.map((e) => e.id)).toEqual(["CONTRIBUTION:c1", "COUPON:past"]);
  });

  it("порожній вхід — нулі й null, без падіння", () => {
    const r = buildInvestHistory(input());
    expect(r.events).toEqual([]);
    expect(r.firstEventAt).toBeNull();
    expect(r.summary.investedUah).toBe(0n);
    expect(r.summary.nowUah).toBe(0n);
  });
});

describe("buildInvestHistory — недобір ОВДП", () => {
  it("вішає недобір наступного циклу на останній внесок ОВДП попереднього", () => {
    const r = buildInvestHistory(input({
      contributions: [
        contrib({ id: "early", cycleId: "cy1", date: new Date("2026-06-10T09:00:00.000Z") }),
        contrib({ id: "late", cycleId: "cy1", date: new Date("2026-06-28T09:00:00.000Z") }),
        contrib({ id: "next", cycleId: "cy2", date: new Date("2026-07-12T09:00:00.000Z") }),
      ],
      cycles: [
        { id: "cy1", startDate: new Date("2026-06-05T00:00:00.000Z"), ovdpCarryUah: 0n },
        { id: "cy2", startDate: new Date("2026-07-05T00:00:00.000Z"), ovdpCarryUah: 700_00n },
      ],
    }));

    const byId = new Map(r.events.map((e) => [e.id, e]));
    expect(byId.get("CONTRIBUTION:late")?.shortfallUah).toBe(700_00n);
    expect(byId.get("CONTRIBUTION:early")?.shortfallUah).toBeUndefined();
    expect(byId.get("CONTRIBUTION:next")?.shortfallUah).toBeUndefined();
  });

  it("внесок без циклу підпису не отримує", () => {
    const r = buildInvestHistory(input({
      contributions: [contrib({ id: "orphan", cycleId: null })],
      cycles: [
        { id: "cy1", startDate: new Date("2026-06-05T00:00:00.000Z"), ovdpCarryUah: 0n },
        { id: "cy2", startDate: new Date("2026-07-05T00:00:00.000Z"), ovdpCarryUah: 700_00n },
      ],
    }));
    expect(r.events[0].shortfallUah).toBeUndefined();
  });

  it("недобір іде лише на ОВДП — внесок REIT того ж циклу лишається чистим", () => {
    const r = buildInvestHistory(input({
      contributions: [
        contrib({ id: "ovdp", cycleId: "cy1", date: new Date("2026-06-10T09:00:00.000Z") }),
        contrib({ id: "reit", kind: "REIT", cycleId: "cy1", date: new Date("2026-06-28T09:00:00.000Z"), quantity: null }),
      ],
      cycles: [
        { id: "cy1", startDate: new Date("2026-06-05T00:00:00.000Z"), ovdpCarryUah: 0n },
        { id: "cy2", startDate: new Date("2026-07-05T00:00:00.000Z"), ovdpCarryUah: 700_00n },
      ],
    }));
    const byId = new Map(r.events.map((e) => [e.id, e]));
    expect(byId.get("CONTRIBUTION:ovdp")?.shortfallUah).toBe(700_00n);
    expect(byId.get("CONTRIBUTION:reit")?.shortfallUah).toBeUndefined();
  });

  it("два пропущені місяці поспіль — на кожному рядку свій власний недобір, не сума", () => {
    // cy1→cy2: перший промах (500). cy2→cy3: другий промах (700), НЕ 500+700=1200,
    // яке дав би старий "взяти carry наступного" підхід.
    const r = buildInvestHistory(input({
      contributions: [
        contrib({ id: "ovdp1", cycleId: "cy1", date: new Date("2026-05-10T09:00:00.000Z") }),
        contrib({ id: "ovdp2", cycleId: "cy2", date: new Date("2026-06-10T09:00:00.000Z") }),
        contrib({ id: "ovdp3", cycleId: "cy3", date: new Date("2026-07-10T09:00:00.000Z") }),
      ],
      cycles: [
        { id: "cy1", startDate: new Date("2026-05-05T00:00:00.000Z"), ovdpCarryUah: 0n },
        { id: "cy2", startDate: new Date("2026-06-05T00:00:00.000Z"), ovdpCarryUah: 500_00n },
        { id: "cy3", startDate: new Date("2026-07-05T00:00:00.000Z"), ovdpCarryUah: 1_200_00n },
      ],
    }));
    const byId = new Map(r.events.map((e) => [e.id, e]));
    expect(byId.get("CONTRIBUTION:ovdp1")?.shortfallUah).toBe(500_00n);
    expect(byId.get("CONTRIBUTION:ovdp2")?.shortfallUah).toBe(700_00n);
    // cy3 — останній цикл, наступного нема, підпису бути не може.
    expect(byId.get("CONTRIBUTION:ovdp3")?.shortfallUah).toBeUndefined();
  });

  it("цикл без жодного внеску ОВДП — підпису немає, сусідні цикли не змінюються", () => {
    const r = buildInvestHistory(input({
      contributions: [
        contrib({ id: "ovdp1", cycleId: "cy1", date: new Date("2026-05-10T09:00:00.000Z") }),
        // cy2 має лише REIT — жодного внеску ОВДП, хоч власний недобір (900-600=300) є.
        contrib({ id: "reit2", kind: "REIT", cycleId: "cy2", date: new Date("2026-06-15T09:00:00.000Z"), quantity: null }),
        contrib({ id: "ovdp3", cycleId: "cy3", date: new Date("2026-07-10T09:00:00.000Z") }),
      ],
      cycles: [
        { id: "cy1", startDate: new Date("2026-05-05T00:00:00.000Z"), ovdpCarryUah: 0n },
        { id: "cy2", startDate: new Date("2026-06-05T00:00:00.000Z"), ovdpCarryUah: 600_00n },
        { id: "cy3", startDate: new Date("2026-07-05T00:00:00.000Z"), ovdpCarryUah: 900_00n },
      ],
    }));
    const byId = new Map(r.events.map((e) => [e.id, e]));
    // Сусід (cy1) отримує свій недобір як завжди — відсутність внесків ОВДП у cy2 його не чіпає.
    expect(byId.get("CONTRIBUTION:ovdp1")?.shortfallUah).toBe(600_00n);
    // Власний недобір cy2 (300) нема куди повісити — і його не вішає ні на REIT, ні на cy3.
    expect(byId.get("CONTRIBUTION:reit2")?.shortfallUah).toBeUndefined();
    expect(byId.get("CONTRIBUTION:ovdp3")?.shortfallUah).toBeUndefined();
  });
});

describe("buildInvestHistory — підсумок", () => {
  it("вкладено = сума внесків усіх інструментів", () => {
    const r = buildInvestHistory(input({
      contributions: [
        contrib({ id: "a", amountUah: 4_175_00n }),
        contrib({ id: "b", kind: "REIT", amountUah: 1_875_00n, quantity: null }),
        contrib({ id: "c", kind: "CRYPTO", amountUah: 750_00n, quantity: null, source: "BINANCE" }),
      ],
    }));
    expect(r.summary.investedUah).toBe(6_800_00n);
  });

  it("прибуток складається лише з наявних доданків, «зараз» = вкладено + прибуток", () => {
    const r = buildInvestHistory(input({
      contributions: [contrib({ amountUah: 100_000_00n })],
      ovdpCouponsUah: 4_120_00n,
      reitGainUah: 3_180_00n,
      cryptoGainUah: 1_240_00n,
      cryptoUnavailable: null,
    }));
    expect(r.summary.gainUah).toBe(8_540_00n);
    expect(r.summary.nowUah).toBe(108_540_00n);
  });

  it("недоступна крипта не входить у суму і несе причину", () => {
    const r = buildInvestHistory(input({
      contributions: [contrib({ amountUah: 100_000_00n })],
      ovdpCouponsUah: 4_120_00n,
      reitGainUah: 3_180_00n,
      cryptoGainUah: null,
      cryptoUnavailable: "not_configured",
    }));
    expect(r.summary.cryptoGainUah).toBeNull();
    expect(r.summary.cryptoUnavailable).toBe("not_configured");
    expect(r.summary.gainUah).toBe(7_300_00n);
    expect(r.summary.nowUah).toBe(107_300_00n);
  });

  it("відсутні знімки REIT дають null, а не нуль", () => {
    const r = buildInvestHistory(input({ contributions: [contrib()], reitGainUah: null }));
    expect(r.summary.reitGainUah).toBeNull();
  });
});

describe("buildInvestHistory — видалення", () => {
  it("ручний внесок і знімок можна видалити, авто-внесок і похідні — ні", () => {
    const r = buildInvestHistory(input({
      contributions: [
        contrib({ id: "manual", source: "MANUAL" }),
        contrib({ id: "auto", kind: "CRYPTO", source: "BINANCE", quantity: null }),
      ],
      cashflows: [
        { id: "f1", contributionId: "manual", date: new Date("2026-06-24T00:00:00.000Z"), kind: "COUPON", amountUah: 1_030_00n },
      ],
      valuations: [{ id: "v1", date: new Date("2026-07-12T18:00:00.000Z"), valueUah: 28_400_00n, freeUah: 0n, note: null }],
      conversions: [{ id: "x1", date: new Date("2026-06-28T10:00:00.000Z"), fromAsset: "USDT", fromAmount: "17.9", toAsset: "BTC", toAmount: "0.0071" }],
    }));

    const del = Object.fromEntries(r.events.map((e) => [e.id, e.deletable]));
    expect(del["CONTRIBUTION:manual"]).toBe(true);
    expect(del["VALUATION:v1"]).toBe(true);
    expect(del["CONTRIBUTION:auto"]).toBe(false);
    expect(del["COUPON:f1"]).toBe(false);
    expect(del["CONVERSION:x1"]).toBe(false);
  });
});

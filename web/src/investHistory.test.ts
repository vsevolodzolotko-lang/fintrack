import { describe, expect, it } from "vitest";
import { filterByKind, groupByMonth } from "./investHistory";
import type { InvestEvent } from "./api";

const ev = (over: Partial<InvestEvent> & Pick<InvestEvent, "id" | "date">): InvestEvent => ({
  type: "CONTRIBUTION",
  kind: "OVDP",
  amountUah: "100000",
  deletable: true,
  ...over,
});

describe("groupByMonth", () => {
  it("групує події календарними місяцями, найновіший місяць перший", () => {
    const g = groupByMonth([
      ev({ id: "a", date: "2026-07-12T09:00:00.000Z" }),
      ev({ id: "b", date: "2026-06-28T09:00:00.000Z" }),
      ev({ id: "c", date: "2026-06-24T09:00:00.000Z" }),
    ]);
    expect(g.map((m) => m.ym)).toEqual(["2026-07", "2026-06"]);
    expect(g[1].events.map((e) => e.id)).toEqual(["b", "c"]);
  });

  it("підсумок місяця рахує лише внески", () => {
    const g = groupByMonth([
      ev({ id: "contrib", date: "2026-07-12T09:00:00.000Z", amountUah: "187500" }),
      ev({ id: "snapshot", date: "2026-07-12T18:00:00.000Z", type: "VALUATION", kind: "REIT", amountUah: "2840000" }),
      ev({ id: "coupon", date: "2026-07-05T09:00:00.000Z", type: "COUPON", amountUah: "103000" }),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0].contributedUah).toBe(187500n);
  });

  it("київська межа доби вирішує місяць", () => {
    // 21:30 UTC 31 липня — це вже 00:30 1 серпня в Києві.
    const g = groupByMonth([ev({ id: "late", date: "2026-07-31T21:30:00.000Z" })]);
    expect(g[0].ym).toBe("2026-08");
  });

  it("порожній вхід — порожній вихід", () => {
    expect(groupByMonth([])).toEqual([]);
  });
});

describe("filterByKind", () => {
  const events = [
    ev({ id: "o", date: "2026-07-12T09:00:00.000Z", kind: "OVDP" }),
    ev({ id: "r", date: "2026-07-12T09:00:00.000Z", kind: "REIT" }),
    ev({ id: "c", date: "2026-07-12T09:00:00.000Z", kind: "CRYPTO" }),
  ];

  it("null повертає все", () => {
    expect(filterByKind(events, null)).toHaveLength(3);
  });

  it("звужує до одного інструмента", () => {
    expect(filterByKind(events, "REIT").map((e) => e.id)).toEqual(["r"]);
  });
});

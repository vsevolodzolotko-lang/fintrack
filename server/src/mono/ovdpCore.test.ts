import { describe, expect, it } from "vitest";
import { accruedAtUah, computeOvdpProjection, expectedReturnUah, type OvdpRow } from "./ovdpCore.js";

const row = (over: Partial<OvdpRow> = {}): OvdpRow => ({
  amountUah: 1_132_200n, // 11 322 грн
  date: new Date("2026-07-18T00:00:00Z"),
  maturityDate: new Date("2027-01-15T00:00:00Z"), // 181 день
  yieldPctBp: 1750n, // 17,50%
  ...over,
});

describe("ovdpCore — прості відсотки", () => {
  it("контрольне число: 11 322 під 17,5% на 181 день → 12 304,53", () => {
    // interest = 1132200×1750×181/3 650 000 = 98 253 коп
    expect(expectedReturnUah(row())).toBe(1_230_453n);
  });

  it("без дати або дохідності — null", () => {
    expect(expectedReturnUah(row({ maturityDate: null }))).toBeNull();
    expect(expectedReturnUah(row({ yieldPctBp: null }))).toBeNull();
  });

  it("нарощення: до купівлі = сума, після погашення = очікуване, всередині — лінійно", () => {
    const r = row();
    expect(accruedAtUah(r, new Date("2026-07-01T00:00:00Z"))).toBe(1_132_200n);
    expect(accruedAtUah(r, new Date("2027-06-01T00:00:00Z"))).toBe(1_230_453n);
    const mid = accruedAtUah(r, new Date("2026-10-16T00:00:00Z")); // ~90/181 строку
    expect(mid).toBeGreaterThan(1_132_200n);
    expect(mid).toBeLessThan(1_230_453n);
  });

  it("серія — точки-зламини (купівлі, погашення, сьогодні), відсортовані", () => {
    const a = row();
    const b = row({ amountUah: 500_000n, date: new Date("2026-08-10T00:00:00Z"), maturityDate: new Date("2026-11-10T00:00:00Z"), yieldPctBp: 1600n });
    const p = computeOvdpProjection([a, b], new Date("2026-09-01T00:00:00Z"))!;
    expect(p.investedUah).toBe(1_632_200n);
    expect(p.expectedUah).toBe(1_230_453n + expectedReturnUah(b)!);
    const dates = p.series.map((s) => s.date);
    expect(dates).toEqual([...dates].sort());
    expect(dates).toContain("2026-09-01"); // сьогодні — окрема точка
    expect(p.accruedNowUah).toBe(accruedAtUah(a, new Date("2026-09-01T00:00:00Z")) + accruedAtUah(b, new Date("2026-09-01T00:00:00Z")));
  });

  it("рядки без даних виключаються; жодного повного → null", () => {
    expect(computeOvdpProjection([row({ yieldPctBp: null })], new Date())).toBeNull();
    const p = computeOvdpProjection([row(), row({ yieldPctBp: null, amountUah: 999_999n })], new Date("2026-09-01T00:00:00Z"))!;
    expect(p.investedUah).toBe(1_132_200n); // другий рядок не рахується
  });
});

describe("ovdpCore — купонні облігації (графік виплат)", () => {
  const buy = new Date("2026-07-21T00:00:00Z");
  const couponRow = (over: Partial<OvdpRow> = {}): OvdpRow => ({
    amountUah: 1_232_200n, // переказано 12 322
    bondCostUah: 1_141_481n, // вкладено в папери 11 414,81
    date: buy,
    maturityDate: new Date("2028-04-26T00:00:00Z"),
    yieldPctBp: null,
    cashflows: [
      { date: new Date("2026-10-28T00:00:00Z"), kind: "COUPON", amountUah: 87_175n },
      { date: new Date("2027-04-28T00:00:00Z"), kind: "COUPON", amountUah: 87_175n },
      { date: new Date("2027-10-27T00:00:00Z"), kind: "COUPON", amountUah: 87_175n },
      { date: new Date("2028-04-26T00:00:00Z"), kind: "COUPON", amountUah: 87_175n },
      { date: new Date("2028-04-26T00:00:00Z"), kind: "REDEMPTION", amountUah: 1_100_000n },
    ],
    ...over,
  });

  it("очікуване повернення = Σ надходжень; прибуток = Σ − вкладено в папери", () => {
    expect(expectedReturnUah(couponRow())).toBe(1_448_700n); // 14 487,00
    expect(expectedReturnUah(couponRow())! - 1_141_481n).toBe(307_219n); // +3 072,19
  });

  it("нарощення від принципала: день купівлі = папери, погашення = Σ надходжень, всередині — лінійно", () => {
    expect(accruedAtUah(couponRow(), buy)).toBe(1_141_481n);
    expect(accruedAtUah(couponRow(), new Date("2028-04-26T00:00:00Z"))).toBe(1_448_700n);
    const mid = accruedAtUah(couponRow(), new Date("2027-06-08T00:00:00Z"));
    expect(mid).toBeGreaterThan(1_141_481n);
    expect(mid).toBeLessThan(1_448_700n);
  });

  it("investedUah = принципал (папери), не переказане; купони отримано/попереду за now", () => {
    const p = computeOvdpProjection([couponRow()], new Date("2026-12-01T00:00:00Z"))!;
    expect(p.investedUah).toBe(1_141_481n); // папери, не 1 232 200
    expect(p.expectedUah).toBe(1_448_700n);
    expect(p.couponsReceivedUah).toBe(87_175n); // 28.10.2026 вже минув
    expect(p.couponsUpcomingUah).toBe(87_175n * 3n);
    expect(p.series.map((s) => s.date)).toContain("2026-10-28"); // дата купона — злам
  });

  it("рядок без bondCostUah/cashflows — стара проста модель незмінна", () => {
    const simple: OvdpRow = {
      amountUah: 1_132_200n,
      date: new Date("2026-07-18T00:00:00Z"),
      maturityDate: new Date("2027-01-15T00:00:00Z"),
      yieldPctBp: 1750n,
    };
    expect(expectedReturnUah(simple)).toBe(1_230_453n);
  });
});

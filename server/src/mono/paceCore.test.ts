import { describe, expect, it } from "vitest";
import { computePaceCore, type PaceTx } from "./paceCore.js";

// Фіксований липень 2026, Київ (+03:00 влітку).
// 2026-07-06 — понеділок, NOW (10 лип) — пʼятниця, 5-й день тижня, 10-й день місяця.
const NOW = new Date("2026-07-10T12:00:00+03:00");

const spend = (uahKop: bigint, time: string): PaceTx => ({
  amount: -uahKop,
  time: new Date(time),
});

// База: 3 повні дні до сьогодні (7–9 лип), разом 1 200 грн → avgDay = 400 грн.
const history: PaceTx[] = [
  spend(400_00n, "2026-07-07T10:00:00+03:00"),
  spend(600_00n, "2026-07-08T10:00:00+03:00"),
  spend(200_00n, "2026-07-09T10:00:00+03:00"),
];
const today = spend(600_00n, "2026-07-10T09:00:00+03:00");

describe("computePaceCore", () => {
  it("повертає null без транзакцій", () => {
    expect(computePaceCore([], NOW)).toBeNull();
  });

  it("avgDay — середнє за повні дні до сьогодні; тиждень/місяць — похідні", () => {
    const p = computePaceCore([...history, today], NOW)!;
    expect(p.baselineDays).toBe(3);
    expect(p.avgDay).toBe(400_00n);
    expect(p.avgWeek).toBe(2_800_00n);
    expect(p.avgMonth).toBe(12_000_00n);
  });

  it("день: сьогоднішні витрати проти avgDay", () => {
    const p = computePaceCore([...history, today], NOW)!;
    expect(p.day.spent).toBe(600_00n);
    expect(p.day.usual).toBe(400_00n);
    expect(p.day.deltaPct).toBe(50);
  });

  it("тиждень: з понеділка по сьогодні проти звичного темпу за стільки ж днів", () => {
    const p = computePaceCore([...history, today], NOW)!;
    expect(p.week.spent).toBe(1_800_00n); // 7–10 лип, все в межах пн–пт
    expect(p.week.usual).toBe(2_000_00n); // avgDay × 5 днів тижня
    expect(p.week.deltaPct).toBe(-10);
  });

  it("місяць: з 1-го числа по сьогодні проти звичного темпу", () => {
    const p = computePaceCore([...history, today], NOW)!;
    expect(p.month.spent).toBe(1_800_00n);
    expect(p.month.usual).toBe(4_000_00n); // avgDay × 10 днів місяця
    expect(p.month.deltaPct).toBe(-55);
  });

  it("коли вся історія — лише сьогодні, середніх ще немає", () => {
    const p = computePaceCore([today], NOW)!;
    expect(p.baselineDays).toBe(0);
    expect(p.avgDay).toBe(0n);
    expect(p.day.deltaPct).toBeNull();
    expect(p.week.deltaPct).toBeNull();
    expect(p.month.deltaPct).toBeNull();
  });

  it("межі дня — за Києвом, не за UTC", () => {
    const p = computePaceCore(
      [
        spend(500_00n, "2026-07-09T23:30:00+03:00"), // вчора (20:30Z)
        spend(300_00n, "2026-07-10T00:30:00+03:00"), // сьогодні (21:30Z 9-го!)
      ],
      NOW,
    )!;
    expect(p.day.spent).toBe(300_00n);
    expect(p.baselineDays).toBe(1);
    expect(p.avgDay).toBe(500_00n);
  });

  it("додатні суми (доходи) ігноруються", () => {
    const p = computePaceCore(
      [...history, { amount: 50_000_00n, time: new Date("2026-07-08T10:00:00+03:00") }],
      NOW,
    )!;
    expect(p.avgDay).toBe(400_00n);
  });
});

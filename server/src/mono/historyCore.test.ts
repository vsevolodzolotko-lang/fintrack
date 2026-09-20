import { describe, expect, it } from "vitest";
import {
  byPerson, categoryBreakdown, livingByMonth, monthsInRange, partialKind, topMerchants, ymInTz,
} from "./historyCore.js";

const TZ = "Europe/Kyiv";

/** Транзакція-заготовка: за замовчуванням витрата побуту. */
function tx(over: Partial<{
  time: Date; amount: bigint; envelope: string; categoryId: string | null; description: string;
}> = {}) {
  return {
    time: new Date("2026-07-15T10:00:00.000Z"),
    amount: -100_00n,
    envelope: "LIVING",
    categoryId: "c1",
    description: "Сільпо",
    ...over,
  };
}

describe("ymInTz", () => {
  it("бере київський місяць, а не UTC", () => {
    // 21:30 UTC 31 липня — це вже 00:30 1 серпня в Києві.
    expect(ymInTz(new Date("2026-07-31T21:30:00.000Z"), TZ)).toBe("2026-08");
  });

  it("не зсуває місяць усередині доби", () => {
    expect(ymInTz(new Date("2026-07-15T09:00:00.000Z"), TZ)).toBe("2026-07");
  });
});

describe("monthsInRange", () => {
  it("включає обидва кінці", () => {
    expect(monthsInRange("2026-07-05", "2026-08-02")).toEqual(["2026-07", "2026-08"]);
  });

  it("один місяць, коли початок і кінець у ньому ж", () => {
    expect(monthsInRange("2026-07-05", "2026-07-20")).toEqual(["2026-07"]);
  });

  it("перетинає межу року", () => {
    expect(monthsInRange("2025-11-10", "2026-02-01"))
      .toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });
});

describe("partialKind", () => {
  it("місяць початку трекінгу обрізаний зліва", () => {
    expect(partialKind("2026-07", "2026-07-05", "2026-08-02")).toBe("start");
  });

  it("поточний місяць ще триває", () => {
    expect(partialKind("2026-08", "2026-07-05", "2026-08-02")).toBe("running");
  });

  it("повний місяць посередині — не позначається", () => {
    expect(partialKind("2026-09", "2026-07-05", "2026-10-15")).toBeNull();
  });

  it("трекінг почався першого числа — місяць повний, не «start»", () => {
    expect(partialKind("2026-07", "2026-07-01", "2026-09-01")).toBeNull();
  });

  it("єдиний місяць одночасно обрізаний і триває — «start» важливіший", () => {
    // Інакше підпис сказав би «ще триває» і сховав, що половини місяця не існує.
    expect(partialKind("2026-07", "2026-07-05", "2026-07-20")).toBe("start");
  });
});

describe("livingByMonth", () => {
  it("сумує витрати побуту по київських місяцях", () => {
    const m = livingByMonth([
      tx({ time: new Date("2026-07-10T10:00:00.000Z"), amount: -300_00n }),
      tx({ time: new Date("2026-07-20T10:00:00.000Z"), amount: -200_00n }),
      tx({ time: new Date("2026-08-01T10:00:00.000Z"), amount: -150_00n }),
    ], TZ);
    expect(m.get("2026-07")).toBe(500_00n);
    expect(m.get("2026-08")).toBe(150_00n);
  });

  it("повернення зменшує місяць — те саме правило, що в statsCore", () => {
    const m = livingByMonth([
      tx({ amount: -500_00n }),
      tx({ amount: 120_00n, categoryId: null }),
    ], TZ);
    expect(m.get("2026-07")).toBe(380_00n);
  });

  it("ігнорує все, що не LIVING", () => {
    const m = livingByMonth([
      tx({ amount: -500_00n }),
      tx({ amount: -900_00n, envelope: "INVESTMENT" }),
      tx({ amount: -700_00n, envelope: "GOAL_CONTRIBUTION" }),
      tx({ amount: 50_000_00n, envelope: "INCOME" }),
    ], TZ);
    expect(m.get("2026-07")).toBe(500_00n);
  });

  it("місяць може вийти в мінус, коли повернень більше за витрати", () => {
    const m = livingByMonth([
      tx({ amount: -100_00n }),
      tx({ amount: 400_00n, categoryId: null }),
    ], TZ);
    expect(m.get("2026-07")).toBe(-300_00n);
  });
});

describe("categoryBreakdown", () => {
  const july = [
    tx({ categoryId: "food", amount: -300_00n }),
    tx({ categoryId: "food", amount: -200_00n }),
    tx({ categoryId: "car", amount: -150_00n }),
  ];
  const june = [
    tx({ time: new Date("2026-06-10T10:00:00.000Z"), categoryId: "food", amount: -400_00n }),
    tx({ time: new Date("2026-06-12T10:00:00.000Z"), categoryId: "car", amount: -100_00n }),
  ];

  it("сортує за сумою спадно", () => {
    const rows = categoryBreakdown(july, "2026-07", null, TZ);
    expect(rows.map((r) => r.categoryId)).toEqual(["food", "car"]);
    expect(rows[0].spent).toBe(500_00n);
  });

  it("дельта null, коли попереднього місяця немає", () => {
    const rows = categoryBreakdown(july, "2026-07", null, TZ);
    expect(rows.every((r) => r.delta === null)).toBe(true);
  });

  it("дельта проти попереднього місяця, зі знаком", () => {
    const rows = categoryBreakdown([...july, ...june], "2026-07", "2026-06", TZ);
    const food = rows.find((r) => r.categoryId === "food")!;
    const car = rows.find((r) => r.categoryId === "car")!;
    expect(food.delta).toBe(100_00n);   // 500 проти 400 — витратили більше
    expect(car.delta).toBe(50_00n);
  });

  it("категорія, якої цього місяця не було, у список не потрапляє", () => {
    const rows = categoryBreakdown(june, "2026-06", null, TZ);
    expect(rows.map((r) => r.categoryId)).toEqual(["food", "car"]);
  });

  it("повернення йде окремим рядком в кінці, і список сходиться до суми місяця", () => {
    const rows = categoryBreakdown([
      ...july,
      tx({ amount: 90_00n, categoryId: null }),
    ], "2026-07", null, TZ);
    const refund = rows[rows.length - 1];
    expect(refund.categoryId).toBeNull();
    expect(refund.spent).toBe(-90_00n);
    const sum = rows.reduce((a, r) => a + r.spent, 0n);
    expect(sum).toBe(650_00n - 90_00n);
  });

  it("без повернень рядка повернень немає", () => {
    const rows = categoryBreakdown(july, "2026-07", null, TZ);
    expect(rows.some((r) => r.categoryId === null)).toBe(false);
  });

  it("витрата без категорії не плутається з рядком повернень", () => {
    // categoryId null і amount < 0 — це «Без категорії», окремий рядок.
    const rows = categoryBreakdown([
      tx({ categoryId: "food", amount: -300_00n }),
      tx({ categoryId: null, amount: -80_00n }),
      tx({ categoryId: null, amount: 20_00n }),
    ], "2026-07", null, TZ);
    const uncategorised = rows.find((r) => r.categoryId === null && r.spent > 0n);
    const refund = rows.find((r) => r.categoryId === null && r.spent < 0n);
    expect(uncategorised?.spent).toBe(80_00n);
    expect(refund?.spent).toBe(-20_00n);
  });
});

describe("topMerchants", () => {
  it("схлопує однакові описи, рахує покупки й суму", () => {
    const rows = topMerchants([
      { description: "Сільпо", amount: -100_00n },
      { description: "Сільпо", amount: -50_00n },
      { description: "АТБ", amount: -200_00n },
    ], 10);
    expect(rows[0]).toEqual({ description: "АТБ", count: 1, spent: 200_00n });
    expect(rows[1]).toEqual({ description: "Сільпо", count: 2, spent: 150_00n });
  });

  it("обрізає до limit", () => {
    const rows = topMerchants([
      { description: "A", amount: -300_00n },
      { description: "B", amount: -200_00n },
      { description: "C", amount: -100_00n },
    ], 2);
    expect(rows.map((r) => r.description)).toEqual(["A", "B"]);
  });
});

describe("byPerson", () => {
  it("сумує витрати кожної людини окремо", () => {
    const rows = byPerson([
      { userId: "u1", amount: -300_00n },
      { userId: "u1", amount: -200_00n },
      { userId: "u2", amount: -100_00n },
    ]);
    const u1 = rows.find((r) => r.userId === "u1")!;
    const u2 = rows.find((r) => r.userId === "u2")!;
    expect(u1.spent).toBe(500_00n);
    expect(u2.spent).toBe(100_00n);
  });

  it("userId null — окремий рядок (спільні чи ще не розподілені)", () => {
    const rows = byPerson([
      { userId: "u1", amount: -100_00n },
      { userId: null, amount: -50_00n },
    ]);
    const shared = rows.find((r) => r.userId === null);
    expect(shared?.spent).toBe(50_00n);
  });

  it("повернення не зменшує чиюсь частку і не створює власного рядка", () => {
    const rows = byPerson([
      { userId: "u1", amount: -100_00n },
      { userId: "u1", amount: 40_00n }, // повернення
    ]);
    expect(rows).toEqual([{ userId: "u1", spent: 100_00n }]);
  });

  it("сортує за сумою спадно", () => {
    const rows = byPerson([
      { userId: "u2", amount: -100_00n },
      { userId: "u1", amount: -300_00n },
    ]);
    expect(rows.map((r) => r.userId)).toEqual(["u1", "u2"]);
  });
});

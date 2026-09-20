import { describe, expect, it } from "vitest";
import type { Category } from "./api";
import { RADIAL_SLOTS, buildSlots } from "./radialSlots";

// Поля рівно ті, що в інтерфейсі Category (web/src/api.ts) — без вигаданих.
function cat(over: Partial<Category>): Category {
  return {
    id: over.name ?? "x",
    name: "X",
    color: null,
    defaultEnvelope: "LIVING",
    plannedAmount: null,
    reserveUpfront: false,
    radialSlot: null,
    radialOrder: 100,
    shortName: null,
    ...over,
  };
}

describe("RADIAL_SLOTS", () => {
  it("описує рівно 7 секторів", () => {
    expect(RADIAL_SLOTS).toHaveLength(7);
  });

  it("не має двох секторів одного кольору — колір і є ідентичністю сектора", () => {
    const colors = RADIAL_SLOTS.map((s) => s.color);
    expect(new Set(colors).size).toBe(colors.length);
  });

  it("починається з Їжи й закінчується Відкласти — порядок = мускульна пам'ять", () => {
    expect(RADIAL_SLOTS[0].label).toBe("Їжа");
    expect(RADIAL_SLOTS[6].label).toBe("Відкласти");
  });
});

describe("buildSlots", () => {
  it("завжди повертає 7 слотів, навіть на порожньому списку", () => {
    expect(buildSlots([])).toHaveLength(7);
    expect(buildSlots([]).every((s) => s.leaves.length === 0)).toBe(true);
  });

  it("розкладає категорії по своїх слотах", () => {
    const slots = buildSlots([
      cat({ name: "Продукти", radialSlot: 0, radialOrder: 10 }),
      cat({ name: "Коти", radialSlot: 2, radialOrder: 30 }),
    ]);
    expect(slots[0].leaves.map((c) => c.name)).toEqual(["Продукти"]);
    expect(slots[2].leaves.map((c) => c.name)).toEqual(["Коти"]);
    expect(slots[1].leaves).toEqual([]);
  });

  it("сортує листи за radialOrder, а не за назвою", () => {
    const slots = buildSlots([
      cat({ name: "Ремонт транспорту", radialSlot: 1, radialOrder: 30 }),
      cat({ name: "Проїзд громадським", radialSlot: 1, radialOrder: 10 }),
      cat({ name: "Бензин", radialSlot: 1, radialOrder: 20 }),
    ]);
    expect(slots[1].leaves.map((c) => c.name)).toEqual([
      "Проїзд громадським", "Бензин", "Ремонт транспорту",
    ]);
  });

  it("при однаковому radialOrder сортує за назвою по-українськи", () => {
    const slots = buildSlots([
      cat({ name: "Ялина", radialSlot: 0, radialOrder: 100 }),
      cat({ name: "Абрикос", radialSlot: 0, radialOrder: 100 }),
    ]);
    expect(slots[0].leaves.map((c) => c.name)).toEqual(["Абрикос", "Ялина"]);
  });

  it("ігнорує категорії без слота і зі слотом поза 0..6", () => {
    const slots = buildSlots([
      cat({ name: "Нічия", radialSlot: null }),
      cat({ name: "Заблудла", radialSlot: 42 }),
    ]);
    expect(slots.flatMap((s) => s.leaves)).toEqual([]);
  });
});

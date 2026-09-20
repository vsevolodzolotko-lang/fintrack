import { describe, expect, it } from "vitest";
import { NEW_CATEGORIES, RADIAL_LEAVES, SLOT_COLORS } from "./radialTaxonomy.js";

describe("RADIAL_LEAVES", () => {
  it("описує рівно 19 листів", () => {
    expect(RADIAL_LEAVES).toHaveLength(19);
  });

  it("покриває всі 7 секторів", () => {
    const slots = new Set(RADIAL_LEAVES.map((l) => l.slot));
    expect([...slots].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("не має дублів назв", () => {
    const names = RADIAL_LEAVES.map((l) => l.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("має унікальний order у межах сектора", () => {
    for (let s = 0; s <= 6; s++) {
      const orders = RADIAL_LEAVES.filter((l) => l.slot === s).map((l) => l.order);
      expect(new Set(orders).size).toBe(orders.length);
    }
  });

  it("тримає short не довше 10 символів — далі підпис на фані не влазить", () => {
    for (const l of RADIAL_LEAVES) {
      if (l.short) expect(l.short.length).toBeLessThanOrEqual(10);
    }
  });

  it("сектор «Дитина» (4) має рівно один лист — фан там не відкривається", () => {
    expect(RADIAL_LEAVES.filter((l) => l.slot === 4)).toHaveLength(1);
  });

  it("усі нові категорії присутні серед листів", () => {
    for (const c of NEW_CATEGORIES) {
      expect(RADIAL_LEAVES.some((l) => l.name === c.name)).toBe(true);
    }
  });
});

describe("SLOT_COLORS", () => {
  it("рівно 7 кольорів — по одному на сектор", () => {
    expect(SLOT_COLORS).toHaveLength(7);
  });

  it("усі кольори різні", () => {
    expect(new Set(SLOT_COLORS).size).toBe(SLOT_COLORS.length);
  });

  it("колір кожної нової категорії дорівнює кольору слоту, куди її кладе RADIAL_LEAVES — інакше вони розсинхронізуються", () => {
    for (const c of NEW_CATEGORIES) {
      const leaf = RADIAL_LEAVES.find((l) => l.name === c.name);
      expect(leaf).toBeDefined();
      expect(c.color).toBe(SLOT_COLORS[leaf!.slot]);
    }
  });
});

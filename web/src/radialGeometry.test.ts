import { describe, expect, it } from "vitest";
import {
  DEFAULT_RADIAL, NO_AIM, aimAngle, angDist, dragAngle, leafSlotDeg,
  polar, resolveAim, slotAngle, stepDeg,
} from "./radialGeometry";

const CFG = DEFAULT_RADIAL;
const STEP = stepDeg(CFG);
// Таксономія, що поїде в прод: Дитина (слот 4) — єдиний сектор з одним листом.
const LEAVES = [2, 3, 3, 3, 1, 3, 3];

/** Вектор жесту під кутом deg (0 = вгору, за годинниковою) на дистанції r. */
function at(deg: number, r: number): [number, number] {
  const p = polar(deg, r);
  return [p.x, p.y];
}

describe("dragAngle / polar", () => {
  it("вгору = 0°, праворуч = 90°, вниз = 180°", () => {
    expect(dragAngle(0, -10)).toBeCloseTo(0);
    expect(dragAngle(10, 0)).toBeCloseTo(90);
    expect(dragAngle(0, 10)).toBeCloseTo(180);
  });

  it("polar і dragAngle взаємно обернені", () => {
    for (const deg of [0, 37, 90, 180, 260, 359]) {
      const p = polar(deg, 100);
      expect(dragAngle(p.x, p.y)).toBeCloseTo(deg, 5);
    }
  });

  it("angDist — найкоротша дуга", () => {
    expect(angDist(350, 10)).toBeCloseTo(20);
  });
});

describe("resolveAim", () => {
  it("у межах deadzone нічого не армує і скидає lock", () => {
    const r = resolveAim(...at(90, CFG.deadzonePx - 1), LEAVES, { slot: 3, leaf: 1 }, 3, CFG);
    expect(r.aim).toEqual(NO_AIM);
    expect(r.locked).toBeNull();
  });

  it("кожен сектор армується на своєму куті", () => {
    for (let i = 0; i < CFG.n; i++) {
      const r = resolveAim(...at(slotAngle(i, CFG), 90), LEAVES, NO_AIM, null, CFG);
      expect(r.aim.slot).toBe(i);
      expect(r.aim.leaf).toBeNull(); // 90px — у смузі 1-го рівня, фан ще закритий
    }
  });

  it("гістерезис тримає попередній сектор, поки новий не ближчий на 7°", () => {
    // Межа секторів 0 і 1 — на STEP/2. Кут на 2° за межу: новий ближчий лише на 4°.
    const justOver = STEP / 2 + 2;
    const sticky = resolveAim(...at(justOver, 90), LEAVES, { slot: 0, leaf: null }, null, CFG);
    expect(sticky.aim.slot).toBe(0);

    // А на 6° за межу новий ближчий на 12° — гістерезис здається.
    const beaten = resolveAim(...at(STEP / 2 + 6, 90), LEAVES, { slot: 0, leaf: null }, null, CFG);
    expect(beaten.aim.slot).toBe(1);
  });

  it("pin дає фану 104° висіти на секторі 51°", () => {
    // 55° від центру сектора 1: більше за STEP/2 (25.7°), менше за FAN/2+8 (60°).
    const phi = slotAngle(1, CFG) + 55;
    const free = resolveAim(...at(phi, 130), LEAVES, NO_AIM, null, CFG);
    expect(free.aim.slot).toBe(2); // без pin кут належить сусідові

    const pinned = resolveAim(...at(phi, 130), LEAVES, NO_AIM, 1, CFG);
    expect(pinned.aim.slot).toBe(1);
    expect(pinned.locked).toBe(1);
  });

  it("pin відпускає, коли палець пішов далі за FAN/2 + 8°", () => {
    const phi = slotAngle(1, CFG) + 120;
    const r = resolveAim(...at(phi, 130), LEAVES, NO_AIM, 1, CFG);
    expect(r.aim.slot).not.toBe(1);
    expect(r.locked).toBe(r.aim.slot);
  });

  it("pin тримається навіть коли поруч сектор з одним листом", () => {
    // Слот 3 (Покупки) залочений, кут дивиться на слот 4 (Дитина, 1 лист).
    const phi = slotAngle(3, CFG) + 55;
    const r = resolveAim(...at(phi, 130), LEAVES, NO_AIM, 3, CFG);
    expect(r.aim.slot).toBe(3);
    expect(r.aim.leaf).not.toBeNull();
  });

  it("ледь за передньою кромкою фану дає перший лист, не останній", () => {
    // Кромка фану сектора 1 — на slotAngle(1) - FAN/2. Кут на 1° раніше.
    const phi = slotAngle(1, CFG) - CFG.fanDeg / 2 - 1;
    const r = resolveAim(...at(phi, 130), LEAVES, NO_AIM, 1, CFG);
    expect(r.aim.leaf).toBe(0);
  });

  it("сектор з одним листом не фанається на жодній дистанції", () => {
    for (const r of [80, 130, 200]) {
      const got = resolveAim(...at(slotAngle(4, CFG), r), LEAVES, NO_AIM, null, CFG);
      expect(got.aim.slot).toBe(4);
      expect(got.aim.leaf).toBeNull();
      expect(got.locked).toBeNull();
    }
  });

  it("leaf лишається в межах на всій дузі фану", () => {
    const g = 1;
    const half = CFG.fanDeg / 2;
    for (let d = -half; d <= half; d += 1) {
      const r = resolveAim(...at(slotAngle(g, CFG) + d, 130), LEAVES, NO_AIM, g, CFG);
      expect(r.aim.leaf).toBeGreaterThanOrEqual(0);
      expect(r.aim.leaf).toBeLessThanOrEqual(LEAVES[g] - 1);
    }
  });
});

describe("aimAngle", () => {
  it("для сектора без листа — кут сектора", () => {
    expect(aimAngle({ slot: 2, leaf: null }, LEAVES, CFG)).toBeCloseTo(slotAngle(2, CFG));
  });

  it("для листа — центр його слота у фані", () => {
    const g = 1;
    const w = leafSlotDeg(LEAVES[g], CFG);
    const expected = slotAngle(g, CFG) - CFG.fanDeg / 2 + 1.5 * w;
    expect(aimAngle({ slot: g, leaf: 1 }, LEAVES, CFG)).toBeCloseTo(expected);
  });

  it("середній лист із трьох дивиться точно в бік сектора", () => {
    expect(aimAngle({ slot: 5, leaf: 1 }, LEAVES, CFG)).toBeCloseTo(slotAngle(5, CFG));
  });
});

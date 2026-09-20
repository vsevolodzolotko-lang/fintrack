// Чиста геометрія радіального категоризатора: без React і без DOM.
// Кути — за годинниковою від 12 години, у градусах. Координати екранні
// (x праворуч, y вниз), відносно центру кільця.
//
// Уся складність жесту живе тут, а не в обробниках подій. Handoff називає два
// баги прототипу, і обидва — про стан: (1) pin сектора не відпускався, тож
// змах-передумав файлив у первісну категорію; (2) armed-стан не скидався на
// pointerdown, тож другий жест залипав на секторі першого. Тому lock — це вхід
// і вихід resolveAim: його поведінка перевіряється тестом, а не оком.

export interface RadialConfig {
  /** Скільки секторів. */
  n: number;
  /** Кутова ширина фану листів — навмисно більша за сектор. */
  fanDeg: number;
  /** Проміжок між клинами 1-го рівня (між листами — × 1.6). */
  gapDeg: number;
  rHub: number;
  r1In: number;
  r1Out: number;
  r2In: number;
  r2Out: number;
  /** На скільки px армований клин росте назовні. */
  armedGrow: number;
  /** Ближче за це — скасування. */
  deadzonePx: number;
  /** Тримати попередній сектор, поки новий не ближчий на стільки градусів. */
  hysteresisDeg: number;
  /** Запас, у межах якого pin сектора ще тримається: fanDeg/2 + це. */
  lockSlackDeg: number;
}

export const DEFAULT_RADIAL: RadialConfig = {
  n: 7,
  fanDeg: 104,
  gapDeg: 1.4,
  rHub: 62,
  r1In: 68,
  r1Out: 112,
  r2In: 118,
  r2Out: 148,
  armedGrow: 8,
  deadzonePx: 74,
  hysteresisDeg: 7,
  lockSlackDeg: 8,
};

export interface Aim {
  slot: number | null;
  leaf: number | null;
}

export const NO_AIM: Aim = { slot: null, leaf: null };

export const stepDeg = (cfg: RadialConfig = DEFAULT_RADIAL): number => 360 / cfg.n;

export const slotAngle = (i: number, cfg: RadialConfig = DEFAULT_RADIAL): number => i * stepDeg(cfg);

export const leafSlotDeg = (leafCount: number, cfg: RadialConfig = DEFAULT_RADIAL): number =>
  cfg.fanDeg / leafCount;

export function norm360(a: number): number {
  return ((a % 360) + 360) % 360;
}

/** Найкоротша кутова відстань, 0..180. */
export function angDist(a: number, b: number): number {
  const d = Math.abs(norm360(a) - norm360(b)) % 360;
  return d > 180 ? 360 - d : d;
}

/** Кут вектора жесту: 0 = вгору, далі за годинниковою, 0..360. */
export function dragAngle(dx: number, dy: number): number {
  return norm360((Math.atan2(dx, -dy) * 180) / Math.PI);
}

/** Точка на колі радіуса r під кутом deg, відносно центру. */
export function polar(deg: number, r: number): { x: number; y: number } {
  const a = (deg * Math.PI) / 180;
  return { x: r * Math.sin(a), y: -r * Math.cos(a) };
}

/**
 * SVG-шлях клина від a0 до a1 (за годинниковою) між радіусами rIn і rOut.
 * cx/cy зсувають шлях в абсолютні координати viewBox. Це навмисно, а не
 * заради зручності: якби клини жили у <g transform="translate(...)">, то
 * CSS transform-origin армованого клина розв'язувався б у view-box
 * координатах, а сам transform — у локальних, і центр масштабування
 * поїхав би. З абсолютними координатами transform-origin: 187.5px 210px
 * означає рівно центр кільця, без здогадок про transform-box.
 */
export function wedgePath(
  a0: number, a1: number, rIn: number, rOut: number, cx = 0, cy = 0,
): string {
  const large = norm360(a1 - a0) > 180 ? 1 : 0;
  const o0 = polar(a0, rOut);
  const o1 = polar(a1, rOut);
  const i1 = polar(a1, rIn);
  const i0 = polar(a0, rIn);
  const f = (n: number) => n.toFixed(2);
  return [
    `M ${f(cx + o0.x)} ${f(cy + o0.y)}`,
    `A ${rOut} ${rOut} 0 ${large} 1 ${f(cx + o1.x)} ${f(cy + o1.y)}`,
    `L ${f(cx + i1.x)} ${f(cy + i1.y)}`,
    `A ${rIn} ${rIn} 0 ${large} 0 ${f(cx + i0.x)} ${f(cy + i0.y)}`,
    "Z",
  ].join(" ");
}

/** Куди дивиться приціл: центр сектора або центр слота листа. */
export function aimAngle(
  aim: Aim,
  leafCounts: number[],
  cfg: RadialConfig = DEFAULT_RADIAL,
): number {
  if (aim.slot === null) return 0;
  const base = slotAngle(aim.slot, cfg);
  if (aim.leaf === null) return base;
  const w = leafSlotDeg(leafCounts[aim.slot], cfg);
  return base - cfg.fanDeg / 2 + (aim.leaf + 0.5) * w;
}

export function resolveAim(
  dx: number,
  dy: number,
  leafCounts: number[],
  prev: Aim = NO_AIM,
  locked: number | null = null,
  cfg: RadialConfig = DEFAULT_RADIAL,
): { aim: Aim; locked: number | null } {
  const dist = Math.hypot(dx, dy);
  if (dist < cfg.deadzonePx) return { aim: NO_AIM, locked: null };

  const phi = dragAngle(dx, dy);
  const step = stepDeg(cfg);
  let g = Math.round(phi / step) % cfg.n;

  // Гістерезис на межі 1-го рівня: тримати попередній сектор, поки новий не
  // ближчий щонайменше на hysteresisDeg. Без цього клини блимають на межі.
  if (
    prev.slot !== null &&
    prev.slot !== g &&
    angDist(phi, slotAngle(prev.slot, cfg)) - angDist(phi, slotAngle(g, cfg)) < cfg.hysteresisDeg
  ) {
    g = prev.slot;
  }

  let leaf: number | null = null;
  let nextLocked: number | null = null;

  if (dist >= cfg.r2In) {
    // Pin перевіряється до розкладу листів, а не після: інакше сектор з одним
    // листом поруч скидав би pin і фан сусіда згортався б посеред жесту.
    if (
      locked !== null &&
      angDist(phi, slotAngle(locked, cfg)) <= cfg.fanDeg / 2 + cfg.lockSlackDeg
    ) {
      g = locked;
    }
    const count = leafCounts[g] ?? 0;
    if (count > 1) {
      nextLocked = g;
      const w = leafSlotDeg(count, cfg);
      let rel = norm360(phi - (slotAngle(g, cfg) - cfg.fanDeg / 2));
      // Ледь за передньою кромкою фану rel обертається під 360 — це «нуль»,
      // а не останній лист.
      if (rel > 300) rel = 0;
      leaf = Math.min(Math.max(Math.floor(rel / w), 0), count - 1);
    }
  }

  return { aim: { slot: g, leaf }, locked: nextLocked };
}

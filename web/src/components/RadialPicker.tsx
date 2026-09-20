import { useLayoutEffect, useRef, useState } from "react";
import type { Category, Tx, UserLite } from "../api";
import { fmtDate, fmtGrn } from "../format";
import { leafLabel, type RadialSlotView } from "../radialSlots";
import {
  DEFAULT_RADIAL, NO_AIM, aimAngle, leafSlotDeg, polar, resolveAim, slotAngle, stepDeg, wedgePath,
  type Aim,
} from "../radialGeometry";

const CFG = DEFAULT_RADIAL;
const STEP = stepDeg(CFG);
const BOX_W = 375;
const BOX_H = 420;
const CX = BOX_W / 2;   // 187.5
const CY = BOX_H / 2;   // 210
const GLYPH_R = (CFG.r1In + CFG.r1Out) / 2 - 3;   // 87
const LABEL_R = (CFG.r2In + CFG.r2Out) / 2;       // 133

// Кольори персон стабільні за порядком у /api/users: перший → синій, другий → рожевий.
const PERSON_COLORS = ["#5B8DEF", "#E86BA5"];

function rgba(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

export interface RadialPickerProps {
  tx: Tx;
  slots: RadialSlotView[];
  users: UserLite[];
  personId: string | null;   // null = не розподілено
  personTouched: boolean;    // чи чіп перемикали свідомо
  onPersonChange: (id: string | null) => void;
  onCommit: (cat: Category) => void;
  onCycle?: () => void;
  pileLayers?: number;
}

export function RadialPicker({
  tx, slots, users, personId, personTouched, onPersonChange, onCommit, onCycle,
  pileLayers = 0,
}: RadialPickerProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(1);
  const [aim, setAim] = useState<Aim>(NO_AIM);

  const boxRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x0: number; y0: number; dx: number; dy: number } | null>(null);
  const aimRef = useRef<Aim>(NO_AIM);
  const lockRef = useRef<number | null>(null);
  const movedRef = useRef(false);
  const flyingRef = useRef(false);
  const lastCoinRef = useRef(0);
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);

  // Сцена — фіксовані 375×420; на вужчому екрані масштабуємо цілком, щоб
  // піксельна математика геометрії лишалась у координатах сцени.
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () =>
      setK(Math.min(1, el.clientWidth / BOX_W, el.clientHeight / BOX_H));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const leafCounts = slots.map((s) => s.leaves.length);

  // Нова картка — чистий старт. Без цього другий жест залипає на секторі
  // першого (один із двох багів, названих у handoff).
  useLayoutEffect(() => {
    flyingRef.current = false;
    aimRef.current = NO_AIM;
    lockRef.current = null;
    dragRef.current = null;
    movedRef.current = false;
    setAim(NO_AIM);
    setDrag(null);
  }, [tx.id]);

  const armedSlot = aim.slot === null ? null : slots[aim.slot];
  const armedColor = armedSlot?.color ?? null;
  const fanSlot = aim.slot !== null && slots[aim.slot].leaves.length > 1 ? aim.slot : null;

  // Пак не виходить за deadzone: зсув обмежений ±46px, масштаб 0.5–0.62.
  // Нижче 60% deadzone лишається повного розміру з трьома рядками, щоб
  // невпевнений дотик читався.
  const mag = drag ? Math.hypot(drag.dx, drag.dy) : 0;
  const farOut = mag >= CFG.deadzonePx * 0.6;
  const clamp46 = (v: number) => Math.max(-46, Math.min(46, v));
  const hubStyle: React.CSSProperties = !drag
    ? {}
    : {
        transform: farOut
          ? `translate(${clamp46(drag.dx)}px, ${clamp46(drag.dy)}px) scale(${
              Math.max(0.5, 0.62 - mag / 1400)
            }) rotate(${drag.dx * 0.02}deg)`
          : `translate(${clamp46(drag.dx)}px, ${clamp46(drag.dy)}px)`,
        transition: dragRef.current ? "none" : "transform .3s cubic-bezier(.2,.8,.3,1), opacity .26s ease",
        ...(armedColor
          ? {
              background: `radial-gradient(120px 120px at 50% 40%, ${rgba(armedColor, 0.26)}, var(--card))`,
              borderColor: armedColor,
              boxShadow: `0 0 0 3px ${rgba(armedColor, 0.34)}, 0 0 38px ${rgba(armedColor, 0.46)}, 0 20px 44px ${rgba(armedColor, 0.34)}`,
            }
          : {}),
      };

  // Банер: що зараз під прицілом.
  let bannerText = "Тягни в сектор · тап — гортати стос";
  let bannerColor = "var(--text-dim)";
  if (drag && mag >= 8 && aim.slot === null) {
    bannerText = "Відпусти тут — скасувати";
    bannerColor = "#8a90a2";
  }
  if (aim.slot !== null && armedSlot) {
    bannerColor = armedSlot.color;
    if (aim.leaf !== null) {
      bannerText = `Відпустити → ${armedSlot.leaves[aim.leaf].name}`;
    } else {
      const more = armedSlot.leaves.length > 1 ? " · тягни далі для деталі" : "";
      bannerText = `Відпустити → ${armedSlot.label}${more}`;
    }
  }

  const commitLeaf = (slotIdx: number, leafIdx: number) => {
    const cat = slots[slotIdx].leaves[leafIdx];
    if (cat) onCommit(cat);
  };

  // Тап по сектору: один лист — файлимо; кілька — розкриваємо фан.
  const tapSlot = (i: number) => {
    const s = slots[i];
    if (s.leaves.length === 0) return;
    if (s.leaves.length === 1) commitLeaf(i, 0);
    else setAim({ slot: i, leaf: null });
  };

  // «Монетка» ₴ летить від пальця до цілі. Прибирається і по onfinish, і за
  // таймаутом: обірвана анімація інакше лишає DOM-вузол назавжди.
  const spawnCoin = (fx: number, fy: number, tox: number, toy: number, color: string) => {
    const box = boxRef.current;
    if (!box) return;
    const jx = (Math.random() - 0.5) * 26;
    const jy = (Math.random() - 0.5) * 26;
    const d = document.createElement("div");
    d.className = "radial-coin";
    d.textContent = "₴";
    d.style.left = `${fx}px`;
    d.style.top = `${fy}px`;
    d.style.fontSize = `${13 + Math.random() * 5}px`;
    d.style.color = color;
    d.style.textShadow = `0 2px 10px ${color}99`;
    box.appendChild(d);
    const kill = () => d.remove();
    const anim = d.animate(
      [
        { transform: `translate(calc(-50% + ${jx}px), calc(-50% + ${jy}px)) scale(.6)`, opacity: 0 },
        { opacity: 1, offset: 0.22 },
        { transform: `translate(calc(-50% + ${tox - fx}px), calc(-50% + ${toy - fy}px)) scale(.3)`, opacity: 0 },
      ],
      { duration: 540, easing: "cubic-bezier(.45,.05,.4,1)" },
    );
    anim.onfinish = kill;
    window.setTimeout(kill, 1000);
  };

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (flyingRef.current) return;
    const el = e.currentTarget;
    try { el.setPointerCapture(e.pointerId); } catch { /* Safari іноді відмовляє */ }
    // Скидання ОБОВ'ЯЗКОВЕ саме тут, а не лише на новій картці: другий жест по
    // тій самій картці інакше стартує з чужим прицілом.
    dragRef.current = { x0: e.clientX, y0: e.clientY, dx: 0, dy: 0 };
    aimRef.current = NO_AIM;
    lockRef.current = null;
    movedRef.current = false;
    setAim(NO_AIM);
  };

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    // Ділимо на k: жест приходить у пікселях екрана, геометрія живе в
    // координатах сцени 375×420.
    const dx = (e.clientX - d.x0) / k;
    const dy = (e.clientY - d.y0) / k;
    d.dx = dx; d.dy = dy;
    if (!movedRef.current && Math.hypot(dx, dy) > 8) movedRef.current = true;
    setDrag({ dx, dy });

    const r = resolveAim(dx, dy, leafCounts, aimRef.current, lockRef.current, CFG);
    lockRef.current = r.locked;
    if (r.aim.slot !== aimRef.current.slot || r.aim.leaf !== aimRef.current.leaf) {
      aimRef.current = r.aim;
      setAim(r.aim);
    }

    // Цівка монеток, поки ціль утримується.
    if (r.aim.slot !== null) {
      const now = performance.now();
      if (now - lastCoinRef.current > 120) {
        lastCoinRef.current = now;
        const color = slots[r.aim.slot].color;
        const t = polar(aimAngle(r.aim, leafCounts, CFG), r.aim.leaf === null ? GLYPH_R : LABEL_R);
        spawnCoin(CX + dx, CY + dy, CX + t.x, CY + t.y, color);
      }
    }
  };

  const springBack = () => {
    aimRef.current = NO_AIM;
    lockRef.current = null;
    setAim(NO_AIM);
    setDrag(null);
  };

  const fly = (slotIdx: number, leafIdx: number | null, from: { dx: number; dy: number }) => {
    if (flyingRef.current) return;
    const s = slots[slotIdx];
    const cat = leafIdx === null ? s.leaves[0] : s.leaves[leafIdx];
    if (!cat) { springBack(); return; }
    flyingRef.current = true;
    const target = { slot: slotIdx, leaf: leafIdx };
    const t = polar(aimAngle(target, leafCounts, CFG), leafIdx === null ? GLYPH_R : LABEL_R);
    for (let i = 0; i < 6; i++) {
      window.setTimeout(
        () => spawnCoin(CX + from.dx, CY + from.dy, CX + t.x, CY + t.y, s.color),
        i * 50,
      );
    }
    window.setTimeout(() => onCommit(cat), 260);
  };

  const onUp = () => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    const a = aimRef.current;
    if (a.slot !== null && slots[a.slot].leaves.length > 0) {
      // Сектор без фану комітить свій єдиний лист.
      fly(a.slot, a.leaf, { dx: d.dx, dy: d.dy });
    } else if (!movedRef.current) {
      // Тап по паку — під стос; або відкриваємо фан, якщо тап був по клину
      // (це вже робить onClick клина).
      onCycle?.();
      springBack();
    } else {
      springBack();
    }
  };

  return (
    <div className="radial-stage" ref={stageRef}>
      <div className="radial-box" ref={boxRef} style={{ ["--radial-k" as string]: k }}>
        <div
          className="radial-ambient"
          style={{
            background: armedColor
              ? `radial-gradient(circle, ${rgba(armedColor, 0.16)}, transparent 70%)`
              : "transparent",
          }}
        />

        <div className="radial-banner" style={{ color: bannerColor }}>{bannerText}</div>

        <div className="radial-person-row">
          <div className="radial-person-pill">
            {users.map((u, i) => {
              const color = PERSON_COLORS[i % PERSON_COLORS.length];
              const active = personId === u.id;
              return (
                <button
                  key={u.id}
                  className="radial-person-chip"
                  style={active ? { background: rgba(color, 0.15), borderColor: color, color } : undefined}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => onPersonChange(u.id)}
                >
                  {u.displayName}
                </button>
              );
            })}
            {/* Шлях назад у «не розподілено». Без нього помилковий тап по особі
                незворотний: старий циклер у списку ходив лише перший↔другий, і
                це одне з двох місць, де апка псувала дані. */}
            <button
              className="radial-person-chip"
              style={personId === null && personTouched
                ? { background: "rgba(255,255,255,.08)", borderColor: "var(--text-dim)", color: "var(--text-muted)" }
                : undefined}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onPersonChange(null)}
            >
              Спільне
            </button>
          </div>
        </div>

        <svg className="radial-svg" viewBox={`0 0 ${BOX_W} ${BOX_H}`}>
          <circle cx={CX} cy={CY} r={162} fill="none" stroke="rgba(255,255,255,.035)" strokeWidth={1} />

          {/* Клини 1-го рівня */}
          {slots.map((s, i) => {
            const a = slotAngle(i, CFG);
            const isArmed = aim.slot === i;
            const dim = aim.slot !== null && !isArmed;
            const fill = isArmed
              ? rgba(s.color, aim.leaf !== null ? 0.2 : 0.26)
              : dim ? "rgba(255,255,255,.014)" : "rgba(255,255,255,.04)";
            const stroke = isArmed ? s.color : "rgba(255,255,255,.055)";
            return (
              <path
                key={s.label}
                className="radial-wedge"
                d={wedgePath(
                  a - STEP / 2 + CFG.gapDeg / 2, a + STEP / 2 - CFG.gapDeg / 2,
                  CFG.r1In, CFG.r1Out, CX, CY,
                )}
                fill={fill}
                stroke={stroke}
                strokeWidth={isArmed ? 1.4 : 1}
                style={{
                  // Замість анімації атрибута d армований клин росте
                  // трансформацією: +8px назовні (112 → 120). Внутрішній
                  // радіус повзе 68 → 72.8, чого не видно за сокетом на 62.
                  transform: isArmed ? `scale(${(CFG.r1Out + CFG.armedGrow) / CFG.r1Out})` : undefined,
                  filter: isArmed ? `drop-shadow(0 0 14px ${rgba(s.color, 0.5)})` : undefined,
                }}
                onClick={() => tapSlot(i)}
              />
            );
          })}

          {/* Сокет під паком */}
          <circle
            cx={CX}
            cy={CY}
            r={CFG.rHub}
            fill="rgba(255,255,255,.015)"
            stroke="rgba(255,255,255,.055)"
            strokeWidth={1}
          />

          {/* Фан листів */}
          {fanSlot !== null && (() => {
            const s = slots[fanSlot];
            const base = slotAngle(fanSlot, CFG);
            const w = leafSlotDeg(s.leaves.length, CFG);
            const gap = CFG.gapDeg * 1.6;
            return s.leaves.map((leaf, j) => {
              const a0 = base - CFG.fanDeg / 2 + j * w;
              const isArmed = aim.leaf === j;
              const p = polar(a0 + w / 2, LABEL_R);
              const lx = CX + p.x;
              const ly = CY + p.y;
              return (
                <g key={leaf.id}>
                  <path
                    className="radial-wedge"
                    d={wedgePath(a0 + gap / 2, a0 + w - gap / 2, CFG.r2In, CFG.r2Out, CX, CY)}
                    fill={rgba(s.color, isArmed ? 0.3 : 0.08)}
                    stroke={isArmed ? s.color : rgba(s.color, 0.28)}
                    strokeWidth={isArmed ? 1.4 : 1}
                    style={{ filter: isArmed ? `drop-shadow(0 0 12px ${rgba(s.color, 0.55)})` : undefined }}
                    onClick={() => commitLeaf(fanSlot, j)}
                  />
                  <text
                    className="radial-leaf-label"
                    x={lx}
                    y={ly}
                    fill={isArmed ? "#fff" : rgba(s.color, 0.92)}
                    style={{
                      transform: isArmed ? "scale(1.16)" : undefined,
                      transformOrigin: `${lx}px ${ly}px`,
                      textShadow: isArmed ? `0 0 14px ${rgba(s.color, 0.85)}` : undefined,
                    }}
                  >
                    {leafLabel(leaf)}
                  </text>
                </g>
              );
            });
          })()}

          {aim.slot !== null && armedSlot && (() => {
            const a = aimAngle(aim, leafCounts, CFG);
            const span = aim.leaf === null
              ? STEP * 0.42
              : leafSlotDeg(armedSlot.leaves.length, CFG) * 0.42;
            const r = CFG.r2Out + 13;
            const p0 = polar(a - span / 2, r);
            const p1 = polar(a + span / 2, r);
            const f = (n: number) => n.toFixed(2);
            return (
              <path
                className="radial-compass"
                d={`M ${f(CX + p0.x)} ${f(CY + p0.y)} A ${r} ${r} 0 0 1 ${f(CX + p1.x)} ${f(CY + p1.y)}`}
                fill="none"
                stroke={armedSlot.color}
                strokeWidth={3}
                strokeLinecap="round"
                style={{ filter: `drop-shadow(0 0 10px ${rgba(armedSlot.color, 0.7)})` }}
              />
            );
          })()}
        </svg>

        {/* Гліфи секторів — DOM поверх SVG (див. коментар у CSS про foreignObject) */}
        {slots.map((s, i) => {
          const p = polar(slotAngle(i, CFG), GLYPH_R);
          const isArmed = aim.slot === i;
          const dim = aim.slot !== null && !isArmed;
          // Гліф активного сектора гасне, коли відкритий фан: інакше
          // збігається з паком.
          const hidden = isArmed && aim.leaf !== null;
          return (
            <div
              key={s.label}
              className="radial-glyph"
              style={{
                left: CX + p.x,
                top: CY + p.y,
                color: isArmed ? "#EDEFF5" : dim ? "rgba(138,144,162,.32)" : s.color,
                transform: isArmed ? "scale(1.16)" : undefined,
                opacity: hidden ? 0 : 1,
              }}
            >
              <s.Icon size={23} strokeWidth={2} />
            </div>
          );
        })}

        {/* Стос нерозібраних під паком — видно, що є що гортати */}
        {Array.from({ length: Math.min(3, Math.max(0, pileLayers)) }, (_, idx) => idx + 1)
          .reverse()
          .map((i) => (
            <div
              key={i}
              className="radial-pile"
              style={{
                transform: `translateY(${i * 9}px) scale(${1 - i * 0.06})`,
                background: i === 1 ? "#1b1e28" : "#15181f",
                opacity: 1 - i * 0.2,
              }}
            />
          ))}

        <div
          className="radial-hub"
          style={hubStyle}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        >
          <div className="radial-hub-merchant" style={{ opacity: farOut ? 0 : 1 }}>{tx.description}</div>
          <div
            className="radial-hub-amount"
            style={farOut ? { fontSize: 34, color: "#fff" } : undefined}
          >
            {fmtGrn(tx.amount)}
          </div>
          <div className="radial-hub-when" style={{ opacity: farOut ? 0 : 1 }}>{fmtDate(tx.time)}</div>
        </div>

        {drag && mag > CFG.rHub * 0.7 && armedColor && (() => {
          const r = Math.min(Math.hypot(drag.dx, drag.dy), CFG.r2Out + 12);
          const a = Math.atan2(drag.dx, -drag.dy);
          const x = r * Math.sin(a);
          const y = -r * Math.cos(a);
          return (
            <div
              className="radial-thumb"
              style={{
                transform: `translate(${x}px, ${y}px)`,
                background: armedColor,
                boxShadow: `0 0 0 5px ${rgba(armedColor, 0.16)}, 0 0 20px ${rgba(armedColor, 0.8)}`,
              }}
            />
          );
        })()}
      </div>
    </div>
  );
}

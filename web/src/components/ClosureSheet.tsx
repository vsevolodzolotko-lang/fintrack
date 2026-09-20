import { useState, type CSSProperties } from "react";
// Копійки тут значущі: залишок-факт приходить із копійками, і саме побут їх поглинає.
import { fmtGrnExact } from "../format";
import type { PendingClosure } from "../api";

interface Props {
  pending: PendingClosure;
  busy: boolean;
  onSubmit: (v: { leftoverAmount: number; toGoals: number; toInvest: number }) => void;
  onCancel: () => void;
}

const ROW: CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
};
const LBL: CSSProperties = { fontSize: 13.5, fontWeight: 700, color: "#8a90a2" };

const kopToGrnStr = (kop: string) => (Number(kop) / 100).toFixed(2);
const fmtDay = (iso: string) =>
  new Intl.DateTimeFormat("uk-UA", { day: "numeric", month: "short" }).format(new Date(iso));

// Побут — не поле вводу, а автозалишок: копійки завжди осідають тут,
// тож сума трьох частин точно дорівнює залишку.
export function ClosureSheet({ pending, busy, onSubmit, onCancel }: Props) {
  const [leftover, setLeftover] = useState(kopToGrnStr(pending.leftoverFact ?? pending.leftoverComputed));
  const [goals, setGoals] = useState("");
  const [invest, setInvest] = useState("");

  const leftoverNum = Number(leftover.replace(",", "."));
  const goalsNum = Math.trunc(Number(goals || 0));
  const investNum = Math.trunc(Number(invest || 0));
  const numsOk =
    Number.isFinite(leftoverNum) && leftoverNum >= 0 &&
    Number.isFinite(goalsNum) && goalsNum >= 0 &&
    Number.isFinite(investNum) && investNum >= 0;
  const livingKop = Math.round(leftoverNum * 100) - goalsNum * 100 - investNum * 100;
  const canSubmit = numsOk && livingKop >= 0 && !busy;

  const delta = pending.delta != null ? Number(pending.delta) : null;
  const deltaLoud = delta != null && Math.abs(delta) > 500_00;

  return (
    <div className="sheet-backdrop" onClick={onCancel}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-title">
          Залишок за {fmtDay(pending.startDate)} – {fmtDay(pending.endDate)}
        </div>

        <input
          className="sheet-input"
          inputMode="decimal"
          autoFocus
          value={leftover}
          onChange={(e) => setLeftover(e.target.value)}
        />
        <div style={{ fontSize: 12, fontWeight: 600, color: deltaLoud ? "#F5A623" : "#8a90a2" }}>
          розрахунково {fmtGrnExact(pending.leftoverComputed)}
          {delta != null && <> · різниця {delta >= 0 ? "+" : "−"}{fmtGrnExact(Math.abs(delta))}</>}
        </div>

        <div style={ROW}>
          <span style={LBL}>У цілі</span>
          <input
            className="sheet-input" style={{ width: 130, textAlign: "right" }}
            inputMode="numeric" placeholder="0"
            value={goals} onChange={(e) => setGoals(e.target.value)}
          />
        </div>
        <div style={ROW}>
          <span style={LBL}>В інвестиції</span>
          <input
            className="sheet-input" style={{ width: 130, textAlign: "right" }}
            inputMode="numeric" placeholder="0"
            value={invest} onChange={(e) => setInvest(e.target.value)}
          />
        </div>

        <div style={{ ...ROW, borderTop: "1px solid rgba(255,255,255,.07)", paddingTop: 10 }}>
          <span style={LBL}>Лишається в побуті</span>
          <span
            className="mono"
            style={{ fontSize: 17, fontWeight: 800, color: livingKop < 0 ? "#EF6C6C" : "#EDEFF5" }}
          >
            {fmtGrnExact(livingKop)}
          </span>
        </div>

        <div className="sheet-actions">
          <button className="sheet-btn ghost" onClick={onCancel}>Скасувати</button>
          <button
            className="sheet-btn primary"
            disabled={!canSubmit}
            onClick={() => onSubmit({ leftoverAmount: leftoverNum, toGoals: goalsNum, toInvest: investNum })}
          >
            {busy ? "…" : "Розподілити"}
          </button>
        </div>
      </div>
    </div>
  );
}

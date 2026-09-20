import { useState } from "react";
import { RADIAL_SLOTS } from "../radialSlots";

interface Props {
  busy: boolean;
  onCreate: (name: string, slot: number) => void;
  onCancel: () => void;
}

export function NewCategorySheet({ busy, onCreate, onCancel }: Props) {
  const [name, setName] = useState("");
  // Сектор обов'язковий: сітка колеса жорстка, і категорія без слота на ньому
  // просто не існувала б.
  const [slot, setSlot] = useState<number | null>(null);
  const canCreate = name.trim().length > 0 && slot !== null && !busy;

  return (
    <div className="sheet-backdrop" onClick={onCancel}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-title">Нова категорія</div>
        <input
          className="sheet-input"
          placeholder="Назва"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
        />
        <div className="sheet-title" style={{ fontSize: 13, color: "var(--text-muted)" }}>
          У який сектор колеса
        </div>
        <div className="radial-slot-grid">
          {RADIAL_SLOTS.map((s, i) => {
            const active = slot === i;
            return (
              <button
                key={s.label}
                className="radial-slot-btn"
                style={active
                  ? { background: `${s.color}26`, borderColor: s.color, color: s.color }
                  : undefined}
                onClick={() => setSlot(i)}
              >
                <s.Icon size={20} strokeWidth={2} color={active ? s.color : undefined} />
                {s.label}
              </button>
            );
          })}
        </div>
        <div className="sheet-actions">
          <button className="sheet-btn ghost" onClick={onCancel}>Скасувати</button>
          <button
            className="sheet-btn primary"
            disabled={!canCreate}
            onClick={() => slot !== null && onCreate(name.trim(), slot)}
          >
            {busy ? "…" : "Створити"}
          </button>
        </div>
      </div>
    </div>
  );
}

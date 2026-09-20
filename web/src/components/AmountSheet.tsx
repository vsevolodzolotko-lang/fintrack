import { useState } from "react";
import { pressPrefilled } from "../amountKeys";

// Один шит на всі суми в апці. Проп decimals — не косметика: коли він false,
// місце коми на клавіатурі займає «000», і клавіатура сама каже, чи бувають
// тут копійки. Раніше два шити виглядали однаково й уміли різне.

export interface AmountSheetProps {
  title: string;
  subtitle?: string;
  /** Контрольоване значення в гривнях, рядком: «5575» або «1037,71». */
  value: string;
  onChange: (v: string) => void;
  decimals: boolean;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
  error?: string | null;
  /** Колір великої суми; дефолт — золото. */
  accent?: string;
  quick?: { label: string; value: string }[];
  /** Підпис кнопки-відмови; дефолт — «Скасувати». Флоу з іншою семантикою
      відмови (наприклад, крок запису в ContributionFlow, де поруч є своя
      кнопка «Скасувати флоу») підставляє інший текст, щоб дві кнопки з
      коренем «Скасувати» не робили протилежні речі. */
  cancelLabel?: string;
  /** Поля конкретного виклику під сумою. */
  children?: React.ReactNode;
}

export function AmountSheet({
  title, subtitle, value, onChange, decimals, confirmLabel,
  onConfirm, onCancel, busy, error, accent, quick, cancelLabel, children,
}: AmountSheetProps) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", decimals ? "," : "000", "0", "⌫"];
  // Чи value — це ще незайманий префіл від батька. Шит монтується на кожне
  // відкриття, тож стан живе рівно стільки, скільки видно клавіатуру.
  const [pristine, setPristine] = useState(true);
  const press = (k: string) => {
    const next = pressPrefilled(value, k, decimals, pristine);
    setPristine(next.pristine);
    onChange(next.value);
  };

  return (
    <>
      <div className="amt-backdrop" onClick={onCancel} />
      <div className="amt-sheet">
        <div className="amt-grip" />

        <div>
          <div className="amt-title">{title}</div>
          {subtitle && <div className="amt-subtitle">{subtitle}</div>}
        </div>

        <div className="amt-value" style={{ color: accent ?? "var(--gold)" }}>
          ₴{value === "" ? "0" : value}
        </div>

        {quick && quick.length > 0 && (
          <div className="amt-quick">
            {quick.map((q) => (
              <button key={q.label} className="amt-quick-btn" onClick={() => onChange(q.value)}>
                {q.label}
              </button>
            ))}
          </div>
        )}

        {children}

        <div className="invest-numpad">
          {keys.map((k) => (
            <button key={k} className="invest-key" onClick={() => press(k)}>
              {k}
            </button>
          ))}
        </div>

        {error && <div className="amt-error">{error}</div>}

        <div className="sheet-actions">
          <button className="sheet-btn ghost" onClick={onCancel}>{cancelLabel ?? "Скасувати"}</button>
          <button className="sheet-btn primary" disabled={busy || value === ""} onClick={onConfirm}>
            {busy ? "…" : confirmLabel}
          </button>
        </div>
      </div>
    </>
  );
}

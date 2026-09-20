import { useState } from "react";
import { X } from "lucide-react";
import type { Category, Tx, UserLite } from "../api";
import type { RadialSlotView } from "../radialSlots";
import { RadialPicker } from "./RadialPicker";

const ENV_OPTIONS = [
  { v: "LIVING", l: "Витрати" },
  { v: "INVESTMENT", l: "Інвестиції" },
  { v: "INCOME", l: "Дохід" },
  { v: "INTERNAL_TRANSFER", l: "Переказ" },
  { v: "GOAL_CONTRIBUTION", l: "Ціль" },
  { v: "UNCATEGORIZED", l: "Без категорії" },
];

interface Props {
  tx: Tx;
  slots: RadialSlotView[];
  users: UserLite[];
  busy: boolean;
  onPick: (cat: Category, userId: string | null | undefined) => void;
  onEnvelope: (envelope: string) => void;
  onClose: () => void;
}

export function RadialSheet({ tx, slots, users, busy, onPick, onEnvelope, onClose }: Props) {
  const [personId, setPersonId] = useState<string | null>(tx.userId ?? null);
  const [touched, setTouched] = useState(false);
  // Локальний стан, а не controlled на tx.envelope: PATCH проходить, але
  // Transactions.tsx тримає sheetTx як снепшот на момент відкриття шита й не
  // передеривлює його з відповіді ["txs"], тому пропс завжди лишався б старим
  // значенням — вибір користувача «відкочувався б» назад у select одразу
  // після оновлення, ніби нічого не змінилось.
  const [envelope, setEnvelope] = useState(tx.envelope);

  return (
    <div className="radial-sheet">
      <div className="radial-sheet-head">
        <div className="radial-sheet-title">Куди рахувати</div>
        <button className="review-close" onClick={onClose} aria-label="Закрити">
          <X size={18} color="#EDEFF5" strokeWidth={2.2} />
        </button>
      </div>

      <RadialPicker
        tx={tx}
        slots={slots}
        users={users}
        personId={personId}
        personTouched={touched}
        onPersonChange={(id) => { setPersonId(id); setTouched(true); }}
        onCommit={(cat) => { if (!busy) onPick(cat, touched ? personId : undefined); }}
      />

      {/* Селект конверта пішов із рядків списку. Ручне перевизначення —
          рідкісний випадок, тому живе тут, згорнутим, а не зникає. */}
      <details className="radial-tech">
        <summary>Технічні дані</summary>
        <select
          value={envelope}
          onChange={(e) => {
            setEnvelope(e.target.value);
            onEnvelope(e.target.value);
          }}
        >
          {ENV_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
        </select>
      </details>
    </div>
  );
}

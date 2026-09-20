import { useState } from "react";
import { ArrowDownLeft, Banknote, CreditCard, RefreshCw, TrendingUp } from "lucide-react";
import type { IncomeKind, Tx } from "../api";
import { fmtDate, fmtGrn } from "../format";

interface Props {
  tx: Tx;
  onPick: (kind: IncomeKind, startsCycle?: boolean) => void;
  busy: boolean;
}

// Дві групи, візуально розділені — це і є відповідь на «щоб не було плутанини,
// з чого виникають зобов'язання». Порядок усередині груп фіксований.
const OBLIGATION_KINDS: { kind: IncomeKind; icon: typeof Banknote; label: string }[] = [
  { kind: "SALARY", icon: Banknote, label: "Зарплата" },
  { kind: "OTHER_INCOME", icon: TrendingUp, label: "Інший дохід" },
];
const NEUTRAL_KINDS: { kind: IncomeKind; icon: typeof Banknote; label: string; hint: string }[] = [
  { kind: "REFUND", icon: ArrowDownLeft, label: "Повернення грошей", hint: "борг, магазин, компенсація" },
  { kind: "CASHBACK", icon: CreditCard, label: "Кешбек і %", hint: "бонус від банку" },
  { kind: "SELF_TRANSFER", icon: RefreshCw, label: "Переказ між своїми", hint: "зі своєї карти на свою" },
];

export function IncomeCard({ tx, onPick, busy }: Props) {
  const preview = tx.incomePreview ?? null;
  // Підказка з авто-правила: чи ЗП відкриває цикл. Локальний стан — щоб
  // «навпаки» перемикалось без запиту на сервер.
  const [startsCycle, setStartsCycle] = useState(preview?.suggestsNewCycle ?? false);

  return (
    <div className="income-card">
      <div className="income-card-head">
        <div>
          <div className="income-card-kicker">надходження</div>
          <div className="income-card-desc">{tx.description}</div>
          <div className="income-card-meta">
            {fmtDate(tx.time)} · {tx.account?.title ?? ""}
          </div>
        </div>
        <div className="income-card-amount mono">{fmtGrn(tx.amount)}</div>
      </div>

      <div className="income-card-q">Що це?</div>

      <div className="income-group income-group-gold">
        <div className="income-group-label">Створює зобов'язання</div>
        {OBLIGATION_KINDS.map(({ kind, icon: Icon, label }) => (
          <button
            key={kind}
            className="income-opt"
            disabled={busy}
            onClick={() => onPick(kind, kind === "SALARY" ? startsCycle : undefined)}
          >
            <Icon size={18} color="#F5A623" strokeWidth={2.2} />
            <span className="income-opt-body">
              <span className="income-opt-label">
                {label}
                {tx.suggestedKind === kind && <span className="income-opt-star" title="так було минулого разу">⭐</span>}
              </span>
              {kind === "SALARY" ? (
                <span className="income-opt-sub">
                  {startsCycle ? "почне новий цикл" : "у поточний цикл"}
                </span>
              ) : preview ? (
                <span className="income-opt-sub">
                  {fmtGrn(preview.investment)} інвест · {fmtGrn(preview.goals)} цілі · {fmtGrn(preview.living)} побут
                </span>
              ) : null}
            </span>
          </button>
        ))}
        <button
          className="income-flip"
          disabled={busy}
          onClick={() => setStartsCycle((v) => !v)}
        >
          {startsCycle ? "ні, не відкривати цикл" : "це основна ЗП — відкрити цикл"}
        </button>
      </div>

      <div className="income-group income-group-dim">
        <div className="income-group-label">Повертає витрачене · зобов'язань не створює</div>
        {NEUTRAL_KINDS.map(({ kind, icon: Icon, label, hint }) => (
          <button key={kind} className="income-opt" disabled={busy} onClick={() => onPick(kind)}>
            <Icon size={18} color="#6c7185" strokeWidth={2.2} />
            <span className="income-opt-body">
              <span className="income-opt-label">
                {label}
                {tx.suggestedKind === kind && <span className="income-opt-star" title="так було минулого разу">⭐</span>}
              </span>
              <span className="income-opt-sub">{hint}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

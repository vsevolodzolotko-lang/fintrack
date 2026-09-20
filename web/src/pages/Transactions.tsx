import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { api, type Category, type Tx, type UserLite } from "../api";
import { iconFor } from "../catIcons";
import { RadialSheet } from "../components/RadialSheet";
import { PullToRefresh } from "../components/PullToRefresh";
import { dayLabel, fmtGrn, ymdKyiv } from "../format";
import { buildSlots } from "../radialSlots";

const PERSON_COLORS = ["var(--person-a)", "var(--person-b)"];

// Фільтр за конвертом лишився зі старої сторінки (спека це явно вимагала) —
// сектор колеса ≠ конверт, тому фільтр «показати лише перекази/цілі»
// неможливо відтворити рухом по секторах, і без списку його взагалі нема як побачити.
const ENV_OPTIONS = [
  { v: "LIVING", l: "Витрати" },
  { v: "INVESTMENT", l: "Інвестиції" },
  { v: "INCOME", l: "Дохід" },
  { v: "INTERNAL_TRANSFER", l: "Переказ" },
  { v: "GOAL_CONTRIBUTION", l: "Ціль" },
  { v: "UNCATEGORIZED", l: "Без категорії" },
];

export function Transactions() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [envelope, setEnvelope] = useState("");
  // "" = разом; "none" = нічиї (не розподілено); інакше userId.
  // "none" стає важливішим після «Спільне» в шиті: тепер нерозподілена
  // транзакція — це свідомий вибір, а не тільки стан «ще не дійшли руки».
  const [personFilter, setPersonFilter] = useState("");
  const [sheetTx, setSheetTx] = useState<Tx | null>(null);
  const [incomeTx, setIncomeTx] = useState<Tx | null>(null);
  const needsReview = params.get("needsReview") === "true";

  const query = new URLSearchParams();
  if (envelope) query.set("envelope", envelope);
  if (personFilter) query.set("userId", personFilter);
  if (needsReview) query.set("needsReview", "true");

  const { data: txs } = useQuery({
    queryKey: ["txs", envelope, personFilter, needsReview],
    queryFn: () => api.get<Tx[]>(`/transactions?${query.toString()}`),
  });
  // Той самий ключ, що в Розгляді — колесо в шиті потребує тієї ж таксономії.
  const { data: cats } = useQuery({
    queryKey: ["categories"],
    queryFn: () => api.get<Category[]>("/categories"),
  });
  const { data: users } = useQuery({ queryKey: ["users"], queryFn: () => api.get<UserLite[]>("/users") });

  const slots = useMemo(() => buildSlots(cats ?? []), [cats]);
  const catById = useMemo(
    () => new Map((cats ?? []).map((c) => [c.id, c])),
    [cats],
  );

  // Групи по київських днях; сума дня — лише витрати, щоб надходження
  // на ₴50 000 не зʼїдало підсумок.
  const days = useMemo(() => {
    const out: { ymd: string; total: number; rows: Tx[] }[] = [];
    for (const t of txs ?? []) {
      const ymd = ymdKyiv(t.time);
      let g = out.find((d) => d.ymd === ymd);
      if (!g) { g = { ymd, total: 0, rows: [] }; out.push(g); }
      g.rows.push(t);
      const n = Number(t.amount);
      if (n < 0) g.total += n;
    }
    return out;
  }, [txs]);

  const patch = useMutation({
    mutationFn: (v: { id: string; body: Record<string, unknown> }) =>
      api.patch(`/transactions/${v.id}`, v.body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["txs"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  const unconfirmIncome = useMutation({
    mutationFn: (id: string) => api.post(`/transactions/${id}/unconfirm-income`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["txs"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["invest-plan"] });
      setIncomeTx(null);
    },
  });

  return (
    <PullToRefresh>
      <div className="section-h" style={{ margin: "16px 0 12px" }}>
        <h2>Витрати</h2>
        {needsReview && <span className="chip">на розбір</span>}
        <button className="hist-link" style={{ marginLeft: "auto" }} onClick={() => navigate("/history")}>
          Історія
          <ChevronRight size={15} strokeWidth={2.4} />
        </button>
      </div>

      <div className="txseg">
        <button
          className={"txseg-btn" + (personFilter === "" ? " active" : "")}
          onClick={() => setPersonFilter("")}
        >
          Разом
        </button>
        {users?.map((u) => (
          <button
            key={u.id}
            className={"txseg-btn" + (personFilter === u.id ? " active" : "")}
            onClick={() => setPersonFilter(u.id)}
          >
            {u.displayName}
          </button>
        ))}
        <button
          className={"txseg-btn" + (personFilter === "none" ? " active" : "")}
          onClick={() => setPersonFilter("none")}
        >
          Нічиї
        </button>
      </div>

      {days.length === 0 && (
        <div style={{ textAlign: "center", color: "var(--text-dim)", fontSize: 14, fontWeight: 600, padding: "32px 0" }}>
          Транзакцій немає
        </div>
      )}

      {days.map((d) => (
        <div key={d.ymd}>
          <div className="txday">
            <span className="txday-label">{dayLabel(d.ymd)}</span>
            <span className="txday-total">{d.total !== 0 ? fmtGrn(d.total) : ""}</span>
          </div>
          {d.rows.map((t) => {
            const isPos = Number(t.amount) > 0;
            const cat = t.categoryId ? catById.get(t.categoryId) : undefined;
            const Icon = iconFor(cat?.name);
            const color = cat?.color ?? "#8a90a2";
            const personIdx = users?.findIndex((u) => u.id === t.userId) ?? -1;
            const time = new Intl.DateTimeFormat("uk-UA", {
              timeZone: "Europe/Kyiv", hour: "2-digit", minute: "2-digit",
            }).format(new Date(t.time));
            // Готівка помічається окремо: рахунок «Готівка» віртуальний
            // (id "cash", kind CASH), і в списку це важливий контекст.
            const cash = t.account?.kind === "CASH" ? " · готівка" : "";
            const meta = cat
              ? `${cat.name} · ${time}${cash}`
              : isPos ? `Надходження · ${time}` : `Тап, щоб розкидати${cash}`;
            return (
              <button
                key={t.id}
                className={"txrow" + (t.needsReview ? " tx-review-border" : "")}
                onClick={() => (isPos ? setIncomeTx(t) : setSheetTx(t))}
              >
                {cat ? (
                  <span className="txrow-glyph" style={{ background: `${color}26`, color }}>
                    <Icon size={17} strokeWidth={2.2} />
                  </span>
                ) : (
                  <span className="txrow-glyph unknown">?</span>
                )}
                <span className="txrow-body">
                  <span className="txrow-merchant">{t.description}</span>
                  <span className="txrow-meta">{meta}</span>
                </span>
                <span className="txrow-right">
                  <span className={"txrow-amount " + (isPos ? "pos" : "neg")}>{fmtGrn(t.amount)}</span>
                  {personIdx >= 0 && (
                    <span
                      className="txrow-dot"
                      style={{ background: PERSON_COLORS[personIdx % PERSON_COLORS.length] }}
                    />
                  )}
                </span>
              </button>
            );
          })}
        </div>
      ))}

      <details className="txfilters">
        <summary>Фільтри</summary>
        <select value={envelope} onChange={(e) => setEnvelope(e.target.value)}>
          <option value="">Усі типи</option>
          {ENV_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
        </select>
      </details>

      <div style={{ height: 12 }} />

      {sheetTx && cats && (
        <RadialSheet
          // key обовʼязковий: RadialSheet сіє personId/touched із tx лише при
          // монтуванні. Сьогодні шит і так закривається через setSheetTx(null),
          // але без key будь-яка майбутня зміна, що підмінить транзакцію на
          // відкритому шиті, потягне за собою чужого власника.
          key={sheetTx.id}
          tx={sheetTx}
          slots={slots}
          users={users ?? []}
          busy={patch.isPending}
          onPick={(cat, userId) => {
            patch.mutate({
              id: sheetTx.id,
              body: {
                categoryId: cat.id,
                envelope: cat.defaultEnvelope,
                ...(userId !== undefined ? { userId } : {}),
              },
            });
            setSheetTx(null);
          }}
          onEnvelope={(envelope) => patch.mutate({ id: sheetTx.id, body: { envelope } })}
          onClose={() => setSheetTx(null)}
        />
      )}

      {incomeTx && (
        <div className="sheet-backdrop" onClick={() => setIncomeTx(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-title">{incomeTx.description}</div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 600 }}>
              {fmtGrn(incomeTx.amount)} · надходження
            </div>
            {incomeTx.incomeKind !== null && (
              <div style={{ fontSize: 13, color: "var(--text-dim)", fontWeight: 600 }}>
                Повернути в Розгляд? Якщо воно відкривало цикл — цикл скасується,
                попередній відновиться.
              </div>
            )}
            <div className="sheet-actions">
              <button className="sheet-btn ghost" onClick={() => setIncomeTx(null)}>Закрити</button>
              {incomeTx.incomeKind !== null && (
                <button
                  className="sheet-btn primary"
                  disabled={unconfirmIncome.isPending}
                  onClick={() => unconfirmIncome.mutate(incomeTx.id)}
                >
                  Розібрати заново
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </PullToRefresh>
  );
}

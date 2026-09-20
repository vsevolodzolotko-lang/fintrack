import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, type HistoryMonthDetail, type HistoryMonths } from "../api";
import { MonthBars } from "../components/MonthBars";
import { PullToRefresh } from "../components/PullToRefresh";
import { fmtGrn, ymGenitive, ymShort } from "../format";

const MONTH_FULL = [
  "Січень", "Лютий", "Березень", "Квітень", "Травень", "Червень",
  "Липень", "Серпень", "Вересень", "Жовтень", "Листопад", "Грудень",
];

function monthTitle(ym: string): string {
  return `${MONTH_FULL[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
}

/** Дельта завжди з базою: «−₴2 700» саме по собі нічого не означає. */
function deltaLabel(delta: number, prevYm: string): string {
  return `${delta > 0 ? "+" : ""}${fmtGrn(delta)} · проти ${ymGenitive(prevYm)}`;
}

const deltaColor = (n: number) => (n > 0 ? "var(--expense)" : "var(--green)");

export function History() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const { data: months } = useQuery({
    queryKey: ["history-months"],
    queryFn: () => api.get<HistoryMonths>("/history/months"),
  });

  // Вибір місяця живе в ?ym=, а не в useState: перехід у категорію — це
  // окремий Route, він розмонтовує History, і локальний стан не пережив би
  // повернення назад — «Назад» відкривало б завжди останній місяць, а не
  // той, з якого зайшли. URL переживає розмонтування сам.
  const selected = searchParams.get("ym") ?? months?.months[months.months.length - 1]?.ym ?? null;
  // replace: одне натискання «Назад» має піти з екрана історії, а не
  // прогортати по одному записі на кожен обраний місяць.
  const setSelected = (ym: string) => setSearchParams({ ym }, { replace: true });

  const { data: detail } = useQuery({
    queryKey: ["history-month", selected],
    queryFn: () => api.get<HistoryMonthDetail>(`/history/months/${selected}`),
    enabled: !!selected,
  });

  const cur = months?.months.find((m) => m.ym === selected);

  return (
    <PullToRefresh>
      <div className="section-h" style={{ margin: "16px 0 12px" }}>
        <h2>Історія витрат</h2>
      </div>

      {months && months.months.length === 0 && (
        <div style={{ textAlign: "center", color: "var(--text-dim)", fontSize: 14, fontWeight: 600, padding: "32px 0" }}>
          Витрат ще немає
        </div>
      )}

      {months && selected && cur && (
        <>
          <div className="hist-month-card">
            <div className="hist-month-name">{monthTitle(selected)}</div>
            <div className="hist-month-sum">{fmtGrn(cur.spent)}</div>
            {(() => {
              // Дельту рахуємо з осі, а не з розбивки: тут вона про місяць
              // цілком, а не про суму категорій.
              const i = months.months.findIndex((m) => m.ym === selected);
              const prev = i > 0 ? months.months[i - 1] : null;
              if (!prev) {
                return (
                  <div className="hist-month-delta" style={{ color: "var(--text-dim)" }}>
                    з {months.since.slice(8)}.{months.since.slice(5, 7)} · порівняння зʼявиться наступного місяця
                  </div>
                );
              }
              const d = Number(cur.spent) - Number(prev.spent);
              return (
                <div className="hist-month-delta" style={{ color: deltaColor(d) }}>
                  {deltaLabel(d, prev.ym)}
                </div>
              );
            })()}
          </div>

          <MonthBars
            months={months.months}
            limit={months.limit}
            selected={selected}
            onSelect={setSelected}
          />
          <div className="hist-caption">
            {months.limit != null
              ? `пунктир — поточний бюджет побуту ${fmtGrn(months.limit)} · червоні — понад нього`
              : "активного циклу немає, тож лінії бюджету теж"}
            {cur.partial === "start" && ` · ${ymShort(selected)} неповний: трекінг із ${months.since.slice(8)} числа`}
            {cur.partial === "running" && ` · ${ymShort(selected)} ще триває`}
          </div>

          <div className="section-h" style={{ margin: "20px 0 4px" }}>
            <h2 style={{ fontSize: 15 }}>На що пішло</h2>
          </div>

          <div className="hist-rows">
            {detail?.categories.map((c) => {
              const d = c.delta == null ? null : Number(c.delta);
              return (
                <button
                  key={`${c.categoryId ?? "none"}-${c.name}`}
                  className="hist-row"
                  disabled={!c.categoryId}
                  onClick={() => c.categoryId && navigate(`/history/category/${c.categoryId}?ym=${selected}`)}
                >
                  <span className="hist-row-swatch" style={{ background: c.color ?? "var(--text-dim)" }} />
                  <span className="hist-row-name">{c.name}</span>
                  {d !== null && d !== 0 && (
                    <span className="hist-row-delta" style={{ color: deltaColor(d) }}>
                      {d > 0 ? "+" : ""}{fmtGrn(d)}
                    </span>
                  )}
                  <span className="hist-row-sum">{fmtGrn(c.spent)}</span>
                </button>
              );
            })}
          </div>
        </>
      )}

      <div style={{ height: 12 }} />
    </PullToRefresh>
  );
}

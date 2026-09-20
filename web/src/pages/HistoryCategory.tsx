import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import { api, type HistoryCategoryDetail, type HistoryMonths, type UserLite } from "../api";
import { MonthBars } from "../components/MonthBars";
import { PullToRefresh } from "../components/PullToRefresh";
import { fmtGrn, ymGenitive } from "../format";

const PERSON_COLORS = ["var(--person-a)", "var(--person-b)"];

export function HistoryCategory() {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const ym = params.get("ym") ?? "";

  const { data } = useQuery({
    queryKey: ["history-category", id, ym],
    queryFn: () => api.get<HistoryCategoryDetail>(`/history/categories/${id}?ym=${ym}`),
    enabled: !!id && !!ym,
  });
  const { data: users } = useQuery({ queryKey: ["users"], queryFn: () => api.get<UserLite[]>("/users") });
  // Той самий запит, що й батьківський екран (та сам queryKey — на переході з
  // History дані вже в кеші). Потрібен лише заради `since`: без нього немає
  // де взяти число, з якого почався трекінг, для підпису «неповний».
  const { data: monthsMeta } = useQuery({
    queryKey: ["history-months"],
    queryFn: () => api.get<HistoryMonths>("/history/months"),
  });

  const personTotal = (data?.byPerson ?? []).reduce((a, p) => a + Number(p.spent), 0);

  return (
    <PullToRefresh>
      <div style={{ margin: "16px 0 8px" }}>
        <button className="hist-back" onClick={() => navigate(`/history?ym=${ym}`)}>
          <ChevronLeft size={18} strokeWidth={2.4} />
          Назад
        </button>
      </div>

      {data && (
        <>
          <div className="section-h" style={{ margin: "0 0 12px" }}>
            <h2>{data.name}</h2>
          </div>

          <MonthBars months={data.months} selected={ym} />
          <div className="hist-caption">
            витрати по місяцях · вибрано {ymGenitive(ym)}
            {/* Ті самі дві причини неповноти, що на батьківському екрані: цей
                екран якраз про те, щоб ставити ліміт із факту, і серпень без
                штрихування поруч із липнем читався б як звичайний місяць. */}
            {data.months.find((m) => m.ym === ym)?.partial === "start" && monthsMeta &&
              ` · неповний: трекінг із ${monthsMeta.since.slice(8)} числа`}
            {data.months.find((m) => m.ym === ym)?.partial === "running" && " · ще триває"}
          </div>

          <div className="section-h" style={{ margin: "20px 0 4px" }}>
            <h2 style={{ fontSize: 15 }}>Де саме</h2>
          </div>
          <div className="hist-rows">
            {data.merchants.length === 0 && (
              <div style={{ color: "var(--text-dim)", fontSize: 13, fontWeight: 600, padding: "10px 2px" }}>
                Цього місяця покупок не було
              </div>
            )}
            {data.merchants.map((m) => (
              <div key={m.description} className="hist-row" style={{ cursor: "default" }}>
                <span className="hist-row-name">{m.description}</span>
                <span className="hist-row-delta" style={{ color: "var(--text-dim)" }}>{m.count}×</span>
                <span className="hist-row-sum">{fmtGrn(m.spent)}</span>
              </div>
            ))}
            {(() => {
              // Список — топ-5, тож решта покупок мусить бути названа сумою.
              // Інакше мерчанти не сходяться з витратою категорії за місяць —
              // та сама причина, з якої повернення отримали власний рядок.
              const monthSpent = Number(data.months.find((m) => m.ym === ym)?.spent ?? 0);
              const shown = data.merchants.reduce((a, m) => a + Number(m.spent), 0);
              const rest = monthSpent - shown;
              if (rest <= 0) return null;
              return (
                <div className="hist-row" style={{ cursor: "default" }}>
                  <span className="hist-row-name" style={{ color: "var(--text-dim)" }}>Решта</span>
                  <span className="hist-row-sum">{fmtGrn(rest)}</span>
                </div>
              );
            })()}
          </div>

          {/* Чекаємо users: поки запит не завантажився, findIndex теж дав би
              -1 для будь-кого — і людину з реальним userId підписало б
              «Спільне». Це гірше за порожній екран на мить, бо каже неправду
              про те, хто платив. */}
          {personTotal > 0 && users && (
            <>
              <div className="section-h" style={{ margin: "20px 0 4px" }}>
                <h2 style={{ fontSize: 15 }}>Хто платив</h2>
              </div>
              <div className="hist-person-bar">
                {data.byPerson.map((p) => {
                  const idx = users.findIndex((u) => u.id === p.userId);
                  // userId null — свідомо спільні або ще не розподілені.
                  const color = idx >= 0 ? PERSON_COLORS[idx % PERSON_COLORS.length] : "var(--text-dim)";
                  return (
                    <span
                      key={p.userId ?? "none"}
                      style={{ width: `${(Number(p.spent) / personTotal) * 100}%`, background: color }}
                    />
                  );
                })}
              </div>
              <div className="hist-person-legend">
                {data.byPerson.map((p) => {
                  const idx = users.findIndex((u) => u.id === p.userId);
                  const name = idx >= 0 ? users[idx].displayName : "Спільне";
                  return (
                    <span key={p.userId ?? "none"}>
                      {name} {Math.round((Number(p.spent) / personTotal) * 100)}%
                    </span>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}

      <div style={{ height: 12 }} />
    </PullToRefresh>
  );
}

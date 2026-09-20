import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, ChevronDown, ChevronRight, PiggyBank, TrendingUp } from "lucide-react";
import { Cell, Pie, PieChart } from "recharts";
import { api, type Dashboard as Dash, type InvestmentPlanResponse, type InvestTarget, type PendingClosure, type UserLite } from "../api";
import { fmtGrn, fmtGrnExact, fmtUAH, pct } from "../format";
import { PullToRefresh } from "../components/PullToRefresh";
import { GoalsCard } from "../components/GoalsCard";
import { ClosureCta } from "../components/ClosureCta";
import { ClosureSheet } from "../components/ClosureSheet";
import { INSTRUMENT_META } from "../instruments";

const DONUT_PALETTE = ["#F5A623", "#4FC3C6", "#7C83FF", "#EF6C6C", "#4b5163"];

interface Props {
  onOpenReview: () => void;
}

// Дашборд завжди показує спільні цифри; перегляд по людині — у «Витратах».
export function Dashboard({ onOpenReview }: Props) {
  const navigate = useNavigate();
  const { data: plan } = useQuery({
    queryKey: ["invest-plan"],
    queryFn: () => api.get<InvestmentPlanResponse>("/investments/plan"),
  });
  const { data: users } = useQuery({
    queryKey: ["users"],
    queryFn: () => api.get<UserLite[]>("/users"),
  });
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api.get<Dash>("/dashboard"),
    refetchInterval: 30_000,
  });
  const qc = useQueryClient();
  const [closureOpen, setClosureOpen] = useState(false);
  const { data: pendingClosure } = useQuery({
    queryKey: ["pending-closure"],
    queryFn: () => api.get<PendingClosure | null>("/cycles/pending-closure"),
  });
  const saveClosure = useMutation({
    mutationFn: (v: { leftoverAmount: number; toGoals: number; toInvest: number }) =>
      api.post(`/cycles/${pendingClosure!.cycleId}/closure`, v),
    onSuccess: () => {
      setClosureOpen(false);
      qc.invalidateQueries({ queryKey: ["pending-closure"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["invest-plan"] });
    },
  });

  if (isLoading) return <div className="center" style={{ color: "#6c7185", fontSize: 14, fontWeight: 600 }}>Завантаження…</div>;
  if (!data) return null;

  const c = data.cycle;

  const spendingData = data.spendingByCategory
    .map((s, i) => ({
      name: s.name,
      value: Math.abs(Number(s.amount)) / 100,
      color: s.color ?? DONUT_PALETTE[i % DONUT_PALETTE.length],
    }))
    .sort((a, b) => b.value - a.value);
  const totalSpent = spendingData.reduce((sum, d) => sum + d.value, 0);

  const catRows = c
    ? c.byCategory
        .filter((b) => b.planned != null || Number(b.spent) > 0)
        .sort((a, b) => Math.abs(Number(b.spent)) - Math.abs(Number(a.spent)))
    : [];
  const livingPct = c ? pct(c.livingSpent, c.livingBudget) : 0;
  const livingLeft = c ? Number(c.livingBudget) - Number(c.livingSpent) : 0;
  const livingNearLimit = livingPct >= 75;
  // Повернення (позитивний LIVING) віднімаються від витрат циклу і можуть
  // перекрити їх повністю — тоді «витрачено» від'ємне.
  const livingOverReturned = c != null && Number(c.livingSpent) < 0;

  return (
    <PullToRefresh>
      {/* порожній стікі-бар: верхній відступ + градієнтний фейд контенту при скролі */}
      <div style={{
        position: "sticky", top: 0, zIndex: 20,
        height: 54, background: "linear-gradient(#0f1117 60%, rgba(15,17,23,0))",
        margin: "0 -20px",
      }} />

      {/* залишок минулого циклу — доки не розподілено, бюджети нижче без нього */}
      {pendingClosure && (
        <ClosureCta
          leftover={pendingClosure.leftoverFact ?? pendingClosure.leftoverComputed}
          onOpen={() => setClosureOpen(true)}
        />
      )}
      {closureOpen && pendingClosure && (
        <ClosureSheet
          pending={pendingClosure}
          busy={saveClosure.isPending}
          onSubmit={(v) => saveClosure.mutate(v)}
          onCancel={() => setClosureOpen(false)}
        />
      )}

      {/* hero */}
      {c ? (
        <div className="hero">
          <div className="hero-label">Можна витратити сьогодні</div>
          <div className={"hero-num" + (Number(c.safeToday) < 0 ? " neg" : "")}>
            {fmtGrn(c.safeToday)}
          </div>
          <div className="hero-sub">
            Залишилось {c.daysLeft} дн. · сьогодні вже {fmtGrn(c.spentToday)}
          </div>
          {Number(c.reservedCommitment) > 0 && (
            <div className="hero-sub" style={{ marginTop: 2 }}>
              Зарезервовано на рахунки: {fmtUAH(c.reservedCommitment)}
            </div>
          )}
        </div>
      ) : (
        <div style={{ textAlign: "center", padding: "32px 0", color: "#6c7185", fontSize: 14, fontWeight: 600 }}>
          Немає активного циклу.<br />Підтвердіть дохід (велику ЗП), щоб почати.
        </div>
      )}

      {/* warning banner */}
      {c?.overspendForecast && (
        <div className="warn-banner" style={{ marginTop: 8 }}>
          <AlertTriangle size={20} color="#EF5350" strokeWidth={2} style={{ flexShrink: 0 }} />
          <div className="warn-banner-text">
            За прогнозом — перевитрата до кінця циклу. Час економити.
          </div>
        </div>
      )}

      {/* нерозібрані надходження → Розгляд (перші картки черги) */}
      {data.incomeCandidates > 0 && (
        <button
          type="button"
          className="warn-banner"
          style={{ marginTop: 8, background: "rgba(245,166,35,.10)", borderColor: "rgba(245,166,35,.28)", width: "100%", textAlign: "left", cursor: "pointer" }}
          onClick={onOpenReview}
        >
          <AlertTriangle size={20} color="#F5A623" strokeWidth={2} style={{ flexShrink: 0 }} />
          <div className="warn-banner-text" style={{ color: "#ffe0a0", flex: 1 }}>
            {fmtGrn(data.incomeCandidatesAmount)} чекає на рішення — бюджет неповний
          </div>
          <ChevronRight size={18} color="#F5A623" strokeWidth={2.2} style={{ flexShrink: 0 }} />
        </button>
      )}

      {/* review CTA */}
      {data.needsReview > 0 && (
        <button className="review-cta" style={{ marginTop: 12 }} onClick={onOpenReview}>
          <div className="review-cta-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#F5A623" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m3 17 2 2 4-4M3 7l2 2 4-4M13 6h8M13 12h8M13 18h8" />
            </svg>
          </div>
          <div style={{ flex: 1 }}>
            <div className="review-cta-title">{data.needsReview} транзакцій на розгляді</div>
            <div className="review-cta-sub">Розкидай по категоріях і людях</div>
          </div>
          <ChevronRight size={20} color="#F5A623" strokeWidth={2.2} />
        </button>
      )}

      {/* витрати: бар циклу 70% + ліміти категорій */}
      {c && (
        <>
          <div className="section-h">
            <h2>Витрати</h2>
            <span>цей цикл</span>
          </div>
          <div className="card">
            <div className="env-header">
              <span className="env-name">На життя</span>
              <span className="env-amounts">
                {/* Повернення можуть перевищити витрати циклу → livingSpent < 0.
                    «−14 335 грн витрачено» читається як баг, тож показуємо 0,
                    а надлишок пояснюємо окремим рядком нижче. */}
                <span className="env-amounts-spent">{fmtUAH(livingOverReturned ? 0 : c.livingSpent)}</span> / {fmtUAH(c.livingBudget)}
              </span>
            </div>
            <div className="env-track">
              <div
                className="env-fill"
                style={{
                  width: `${livingPct}%`,
                  background: livingNearLimit
                    ? "linear-gradient(90deg, #EF6C6C, #ff8f8f)"
                    : "linear-gradient(90deg, #F5A623, #ffbe4d)",
                }}
              />
              <div className="env-tick" style={{ left: `${Math.min(100, Math.round((c.daysElapsed / c.totalDays) * 100))}%` }} />
            </div>
            {livingLeft < 0 ? (
              <div className="env-caption-warn">Перевитрата {fmtGrn(-livingLeft)} · бюджет пробито</div>
            ) : livingNearLimit ? (
              <div className="env-caption-warn">Залишилось {fmtGrn(livingLeft)} · майже вичерпано</div>
            ) : (
              <div className="env-caption">Залишилось {fmtGrn(livingLeft)} · {livingPct}%</div>
            )}
            {livingOverReturned && (
              <div style={{ fontSize: 11.5, fontWeight: 600, color: "#4CAF50", marginTop: 4 }}>
                повернень на {fmtGrnExact(-Number(c.livingSpent))} понад витрати — вони збільшили ліміт
              </div>
            )}
            {Number(c.livingCarryUah) > 0 && (
              <div style={{ fontSize: 11.5, fontWeight: 600, color: "#F5A623", marginTop: 4 }}>
                з них {fmtGrnExact(c.livingCarryUah)} перенесено з минулого місяця
              </div>
            )}
            {catRows.length > 0 && (
              <div style={{ marginTop: 12 }}>
                {catRows.map((b) => (
                  <CatLimitRow key={b.categoryId} stat={b} />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* темп витрат: зараз vs зазвичай (середні від початку трекінгу) */}
      {data.pace && data.pace.baselineDays >= 1 && (
        <>
          <div className="section-h">
            <h2>Темп витрат</h2>
            <span>зараз · зазвичай</span>
          </div>
          <div className="card">
            <PaceRow label="Сьогодні" p={data.pace.day} first />
            <PaceRow label="Цей тиждень" p={data.pace.week} />
            <PaceRow label="Цей місяць" p={data.pace.month} />
            <div className="muted small" style={{ marginTop: 10, fontWeight: 600 }}>
              У середньому <span style={{ whiteSpace: "nowrap" }}>{fmtGrn(data.pace.avgDay)}/день</span> ·{" "}
              <span style={{ whiteSpace: "nowrap" }}>{fmtGrn(data.pace.avgWeek)}/тижд</span> ·{" "}
              <span style={{ whiteSpace: "nowrap" }}>{fmtGrn(data.pace.avgMonth)}/міс</span>
            </div>
          </div>
        </>
      )}

      {/* «Хто скільки» — завжди повний цикл, незалежно від фільтра */}
      {data.byPerson.length > 0 && users && users.length > 0 && (
        <>
          <div className="section-h">
            <h2>Хто скільки</h2>
            <span>цей цикл</span>
          </div>
          <div className="card">
            <WhoSpent byPerson={data.byPerson} byPersonCategory={data.byPersonCategory} users={users} />
          </div>
        </>
      )}

      {/* «Інвестиції цього місяця» → сторінка плану; чипи показують статус чекліста */}
      {c && plan?.active && (
        <button className="invest-month-card" onClick={() => navigate("/investments")}>
          <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
            <div style={{ width: 44, height: 44, borderRadius: 13, background: "rgba(76,175,80,.16)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <TrendingUp size={22} color="#4CAF50" strokeWidth={2} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>Інвестиції цього місяця</div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "#8a90a2", marginTop: 2 }}>Чекліст на день зарплати</div>
            </div>
            <div className="mono" style={{ fontSize: 17, fontWeight: 700, color: "#4CAF50" }}>{fmtGrn(plan.investmentBudget)}</div>
          </div>
          <FundBar contributed={plan.totalContributed} budget={plan.investmentBudget} color="#4CAF50" />
          <div style={{ marginTop: 8, fontSize: 12, fontWeight: 600, color: "#8a90a2", textAlign: "left" }}>
            {Number(plan.totalRemaining) > 0
              ? <>Залишилось закинути <b style={{ color: "#EDEFF5" }}>{fmtGrn(plan.totalRemaining)}</b></>
              : "Все внесено ✓"}
          </div>
          {Number(c.investCarryUah) > 0 && (
            <div style={{ marginTop: 4, fontSize: 11.5, fontWeight: 600, color: "#F5A623", textAlign: "left" }}>
              з них {fmtGrnExact(c.investCarryUah)} перенесено з минулого місяця
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
            {plan.targets.map((t) => (
              <InvestChip key={t.kind} t={t} />
            ))}
            <div style={{ flex: 1 }} />
            <ChevronRight size={18} color="#4CAF50" strokeWidth={2.2} />
          </div>
        </button>
      )}

      {/* «Цілі цього місяця»: 15% доходу → закинути на білу карту */}
      {c && Number(c.goalsBudget) > 0 && (
        <GoalsMonthCard budget={c.goalsBudget} contributed={c.goalsContributed} remaining={c.toGoals} carry={c.goalsCarryUah} />
      )}

      {/* goals */}
      <div style={{ marginTop: 12 }}>
        <GoalsCard />
      </div>

      {/* accounts */}
      {data.accounts.length > 0 && (
        <>
          <div className="section-h"><h2>Рахунки</h2></div>
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            {data.accounts.map((a, i) => (
              <div key={a.id}>
                {i > 0 && <div className="divider" />}
                <div className="account-row">
                  <div
                    className="account-thumb"
                    style={{
                      background: a.kind === "CARD"
                        ? (i === 0 ? "#05060a" : "linear-gradient(135deg,#F5A623,#d98a10)")
                        : "rgba(79,195,198,.18)",
                      border: a.kind === "CARD" && i === 0 ? "1px solid rgba(255,255,255,.09)" : "none",
                    }}
                  />
                  <div style={{ flex: 1 }}>
                    <div className="account-name">{a.title}</div>
                    <div className="account-sub">{a.kind === "JAR" ? "Банка" : a.kind === "CASH" ? "Готівка" : "Картка"}</div>
                  </div>
                  <div className="account-balance mono">{fmtUAH(a.balance)}</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* spending donut */}
      {spendingData.length > 0 && (
        <>
          <div className="section-h"><h2>Витрати за категоріями</h2></div>
          <div className="card">
            <div className="donut-section">
              <div className="donut-wrap">
                <PieChart width={132} height={132} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                  <Pie
                    data={spendingData}
                    dataKey="value"
                    cx={66}
                    cy={66}
                    innerRadius={46}
                    outerRadius={63}
                    paddingAngle={0}
                    startAngle={90}
                    endAngle={-270}
                    stroke="none"
                  >
                    {spendingData.map((entry, index) => (
                      <Cell key={index} fill={entry.color} />
                    ))}
                  </Pie>
                </PieChart>
                <div className="donut-center">
                  <div className="donut-center-amount mono">{fmtGrn(totalSpent * 100)}</div>
                  <div className="donut-center-label">за цикл</div>
                </div>
              </div>
              <div className="donut-legend">
                {spendingData.map((d, i) => (
                  <div key={i} className="donut-legend-row">
                    <span className="donut-legend-dot" style={{ background: d.color }} />
                    <span className="donut-legend-name">{d.name}</span>
                    <span className="donut-legend-amount mono">{fmtGrn(d.value * 100)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      <div style={{ height: 12 }} />
    </PullToRefresh>
  );
}

// Розподіл витрат циклу між людьми: двоколірний бар часток + рядки з аварками.
// Кольори персон стабільні за порядком у /api/users (перший → синій, другий → рожевий).
const PERSON_SEG_COLORS = ["var(--person-a)", "var(--person-b)"];

function WhoSpent({
  byPerson,
  byPersonCategory,
  users,
}: {
  byPerson: Dash["byPerson"];
  byPersonCategory: Dash["byPersonCategory"];
  users: UserLite[];
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const spentOf = (userId: string | null) =>
    Number(byPerson.find((p) => p.userId === userId)?.spent ?? 0);

  // Топ-5 категорій людини за спаданням + «Інше» (решта однією сумою).
  const catsOf = (userId: string) => {
    const mine = byPersonCategory
      .filter((c) => c.userId === userId && Number(c.amount) > 0)
      .map((c) => ({ name: c.name, color: c.color, amount: Number(c.amount) }))
      .sort((a, b) => b.amount - a.amount);
    const top = mine.slice(0, 5);
    const restSum = mine.slice(5).reduce((s, c) => s + c.amount, 0);
    const max = top.length ? top[0].amount : 1;
    return { top, restSum, max };
  };

  const unassigned = spentOf(null);
  const rows = [
    ...users.map((u, i) => ({
      key: u.id,
      userId: u.id as string | null,
      name: u.displayName,
      initial: u.displayName.charAt(0).toUpperCase(),
      badgeClass: `person-badge p${i % 2}`,
      color: PERSON_SEG_COLORS[i % PERSON_SEG_COLORS.length],
      spent: spentOf(u.id),
      dim: false,
      expandable: true,
    })),
    ...(unassigned > 0
      ? [{ key: "unassigned", userId: null as string | null, name: "Не розподілено", initial: "?", badgeClass: "person-badge unassigned", color: "var(--text-dim)", spent: unassigned, dim: true, expandable: false }]
      : []),
  ];
  const total = rows.reduce((s, r) => s + r.spent, 0);
  if (total <= 0) return <div className="muted small">У цьому циклі ще немає витрат</div>;

  return (
    <>
      <div style={{ display: "flex", height: 10, borderRadius: 999, overflow: "hidden", gap: 2 }}>
        {rows.filter((r) => r.spent > 0).map((r) => (
          <div key={r.key} style={{ width: `${(r.spent / total) * 100}%`, background: r.color }} />
        ))}
      </div>
      <div style={{ marginTop: 15, display: "flex", flexDirection: "column", gap: 12 }}>
        {rows.map((r) => {
          const isOpen = expanded === r.userId;
          const cats = r.expandable && r.userId ? catsOf(r.userId) : null;
          const canExpand = r.expandable && cats != null && cats.top.length > 0;
          return (
            <div key={r.key} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button
                type="button"
                onClick={canExpand ? () => setExpanded(isOpen ? null : r.userId) : undefined}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  background: "none", border: "none", padding: 0, width: "100%",
                  cursor: canExpand ? "pointer" : "default", textAlign: "left", color: "inherit",
                }}
              >
                <span className={r.badgeClass}>{r.initial}</span>
                <span style={{ flex: 1, fontSize: 13.5, fontWeight: 700, color: r.dim ? "#8a90a2" : "var(--text)" }}>
                  {r.name}
                </span>
                <span className="mono" style={{ fontSize: 14, fontWeight: 600, color: r.dim ? "#8a90a2" : "var(--text)" }}>
                  {fmtUAH(r.spent)}
                </span>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#6c7185", width: 40, textAlign: "right" }}>
                  {r.dim ? "" : `${Math.round((r.spent / total) * 100)}%`}
                </span>
                {canExpand ? (
                  isOpen
                    ? <ChevronDown size={16} color="#6c7185" strokeWidth={2.2} />
                    : <ChevronRight size={16} color="#6c7185" strokeWidth={2.2} />
                ) : (
                  <span style={{ width: 16 }} />
                )}
              </button>
              {isOpen && cats && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingLeft: 34 }}>
                  {cats.top.map((c, ci) => (
                    <div key={ci} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 999, background: c.color ?? "var(--text-dim)", flexShrink: 0 }} />
                      <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600, color: "var(--text)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {c.name}
                      </span>
                      <div style={{ width: 60, height: 6, borderRadius: 999, background: "rgba(255,255,255,.06)", overflow: "hidden", flexShrink: 0 }}>
                        <div style={{ width: `${(c.amount / cats.max) * 100}%`, height: "100%", background: c.color ?? "var(--text-dim)" }} />
                      </div>
                      <span className="mono" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text)", width: 72, textAlign: "right" }}>
                        {fmtUAH(c.amount)}
                      </span>
                    </div>
                  ))}
                  {cats.restSum > 0 && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 999, background: "var(--text-dim)", flexShrink: 0 }} />
                      <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600, color: "#8a90a2" }}>Інше</span>
                      <div style={{ width: 60, flexShrink: 0 }} />
                      <span className="mono" style={{ fontSize: 12.5, fontWeight: 600, color: "#8a90a2", width: 72, textAlign: "right" }}>
                        {fmtUAH(cats.restSum)}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

// Рядок темпу: факт за період · «зазвичай» у тому ж темпі · дельта.
// Менше ніж зазвичай — зелене, більше — червоне; ±5% вважаємо «як зазвичай».
function PaceRow({ label, p, first }: { label: string; p: import("../api").PeriodPace; first?: boolean }) {
  const d = p.deltaPct;
  const flat = d != null && Math.abs(d) <= 5;
  return (
    <div style={{
      display: "flex", alignItems: "baseline", gap: 8,
      padding: first ? "2px 0 8px" : "8px 0",
      borderTop: first ? "none" : "1px solid var(--hairline)",
    }}>
      <span className="env-name" style={{ fontSize: 14, flex: 1 }}>{label}</span>
      <span className="mono" style={{ fontSize: 14, fontWeight: 600 }}>{fmtGrn(p.spent)}</span>
      <span className="muted small" style={{ fontWeight: 600 }}>· {fmtGrn(p.usual)}</span>
      {d != null && (
        <span
          className={flat ? "muted" : d > 0 ? "neg" : "pos"}
          style={{ fontSize: 12.5, fontWeight: 700, width: 52, textAlign: "right" }}
        >
          {flat ? "≈" : d > 0 ? `+${d}%` : `−${Math.abs(d)}%`}
        </span>
      )}
    </div>
  );
}

function CatLimitRow({ stat }: { stat: import("../api").CategoryStat }) {
  const hasPlan = stat.planned != null;
  const p = hasPlan ? pct(stat.spent, stat.planned!) : 0;
  const over = hasPlan && Number(stat.spent) >= Number(stat.planned);
  const warn = hasPlan && !over && p >= 80;
  const fill = over ? "#EF5350" : warn ? "#FFB74D" : "linear-gradient(90deg, #F5A623, #ffbe4d)";
  return (
    <div style={{ padding: "10px 0", borderTop: "1px solid var(--hairline)" }}>
      <div className="env-header">
        <span className="env-name" style={{ fontSize: 14 }}>
          {stat.name}
          {stat.reserveUpfront && (
            <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, letterSpacing: ".06em",
              color: "#4FC3C6", border: "1px solid rgba(79,195,198,.35)", borderRadius: 6, padding: "1px 5px" }}>
              РЕЗЕРВ
            </span>
          )}
        </span>
        <span className="env-amounts">
          <span className="env-amounts-spent" style={{ color: over ? "#EF5350" : undefined }}>
            {fmtUAH(stat.spent)}
          </span>
          {" / "}
          {hasPlan ? fmtUAH(stat.planned) : "без плану"}
        </span>
      </div>
      {hasPlan && (
        <div className="env-track" style={{ marginTop: 6 }}>
          <div className="env-fill" style={{ width: `${p}%`, background: fill }} />
        </div>
      )}
    </div>
  );
}

// Чип інструмента в картці «Інвестиції цього місяця»: галочка = ціль місяця внесена
function InvestChip({ t }: { t: InvestTarget }) {
  const m = INSTRUMENT_META[t.kind];
  return (
    <span
      style={{
        display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 999,
        background: t.done ? m.color + "1E" : "rgba(255,255,255,.04)",
        border: `1px solid ${t.done ? m.color + "55" : "rgba(255,255,255,.06)"}`,
      }}
    >
      {t.done ? (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={m.color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      ) : (
        <span style={{ width: 9, height: 9, borderRadius: "50%", border: "1.6px solid #5b6070" }} />
      )}
      <span style={{ fontSize: 11.5, fontWeight: 700, color: t.done ? "var(--text)" : "#8a90a2" }}>{m.short}</span>
    </span>
  );
}

// Прогрес-бар поповнення (внесено / ціль); зеленіє, коли ціль закрита.
function FundBar({ contributed, budget, color }: { contributed: string; budget: string; color: string }) {
  const done = Number(contributed) >= Number(budget) && Number(budget) > 0;
  const w = Number(budget) > 0 ? Math.min(100, (Number(contributed) / Number(budget)) * 100) : 0;
  return (
    <div style={{ marginTop: 12, height: 8, background: "rgba(255,255,255,.07)", borderRadius: 999, overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${w}%`, borderRadius: 999,
        background: done ? "linear-gradient(90deg,#4CAF50,#7bd47f)" : `linear-gradient(90deg,${color},${color}bb)` }} />
    </div>
  );
}

// «Цілі цього місяця»: 15% доходу треба закинути на білу карту.
// Прогрес-бар зеленіє, коли ціль поповнення закрита.
function GoalsMonthCard({ budget, contributed, remaining, carry }: { budget: string; contributed: string; remaining: string; carry: string }) {
  const done = Number(remaining) <= 0;
  const accent = "#F5A623";
  return (
    <div className="invest-month-card" style={{ marginTop: 12, cursor: "default" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
        <div style={{ width: 44, height: 44, borderRadius: 13, background: "rgba(245,166,35,.16)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <PiggyBank size={22} color={accent} strokeWidth={2} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>Цілі цього місяця</div>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: "#8a90a2", marginTop: 2 }}>Закинь на білу карту</div>
        </div>
        <div className="mono" style={{ fontSize: 17, fontWeight: 700, color: accent }}>{fmtGrn(budget)}</div>
      </div>
      <FundBar contributed={contributed} budget={budget} color={accent} />
      <div style={{ marginTop: 8, fontSize: 12, fontWeight: 600, color: done ? "#4CAF50" : "#8a90a2" }}>
        {done
          ? "Закинуто ✓"
          : <>Залишилось закинути <b style={{ color: "#EDEFF5" }}>{fmtGrn(remaining)}</b> на білу карту</>}
      </div>
      {Number(carry) > 0 && (
        <div style={{ marginTop: 4, fontSize: 11.5, fontWeight: 600, color: "#F5A623" }}>
          з них {fmtGrnExact(carry)} перенесено з минулого місяця
        </div>
      )}
    </div>
  );
}

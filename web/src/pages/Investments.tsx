import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { api, type InvestmentPlanResponse, type InvestHistoryResponse } from "../api";
import { PullToRefresh } from "../components/PullToRefresh";
import { PlanTab, investPctLabel } from "../components/invest/PlanTab";
import { PortfolioTab } from "../components/invest/PortfolioTab";
import { HistoryTab } from "../components/invest/HistoryTab";

type Tab = "plan" | "portfolio" | "history";
const TABS: { key: Tab; label: string }[] = [
  { key: "plan", label: "План" },
  { key: "portfolio", label: "Портфель" },
  { key: "history", label: "Історія" },
];

// Київський час — інакше подія біля межі місяця в дорозі підписує заголовок
// невірним місяцем відносно того ж групування у стрічці Історії. Модульна
// константа, як прийнято в web/src/format.ts.
const KYIV_MONTH_SHORT_YEAR = new Intl.DateTimeFormat("uk-UA", {
  timeZone: "Europe/Kyiv",
  month: "short",
  year: "numeric",
});

function fmtSince(iso: string | null): string {
  if (!iso) return "";
  return `з ${KYIV_MONTH_SHORT_YEAR.format(new Date(iso)).replace(/ р\.$/, "")}`;
}

export function Investments() {
  const [params, setParams] = useSearchParams();
  const { data: plan } = useQuery({
    queryKey: ["invest-plan"],
    queryFn: () => api.get<InvestmentPlanResponse>("/investments/plan"),
  });

  // Дефолт рахується з даних і НЕ переписує URL: інакше зміна stepsDone
  // під час сесії смикала б адресу під користувачем.
  const raw = params.get("tab");
  const explicit = TABS.some((t) => t.key === raw) ? (raw as Tab) : null;
  const tab: Tab = explicit ?? (plan?.active && plan.stepsDone >= 3 ? "portfolio" : "plan");

  // `/history` — найважчий роут в апці (десяток запитів у БД +, за наявного
  // ключа Binance, вихідний HTTP-виклик по курс), і на табі Портфель він ще й
  // змагається за той самий виклик курсів із крипто-карткою. Тягнемо його лише
  // коли таб дійсно відкрито — HistoryTab робить запит з тим самим ключем
  // ["invest-history"], тож дані нікуди не губляться, лише не тягнуться дарма.
  const { data: history } = useQuery({
    queryKey: ["invest-history"],
    queryFn: () => api.get<InvestHistoryResponse>("/investments/history"),
    enabled: tab === "history",
  });

  const headerNote =
    tab === "plan" ? investPctLabel(plan)
    : tab === "portfolio" ? "за весь час"
    : fmtSince(history?.firstEventAt ?? null);

  return (
    <PullToRefresh>
      <div style={{
        position: "sticky", top: 0, zIndex: 20,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        height: 54, background: "linear-gradient(#0f1117 60%, rgba(15,17,23,0))",
        margin: "0 -20px", padding: "0 26px",
      }}>
        <span style={{ fontFamily: "'Space Grotesk', system-ui", fontWeight: 600, fontSize: 15 }}>Інвестиції</span>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-dim)" }}>{headerNote}</span>
      </div>

      <div className="seg">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={"seg-btn" + (tab === t.key ? " active" : "")}
            onClick={() => setParams({ tab: t.key }, { replace: true })}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "plan" && <PlanTab />}
      {tab === "portfolio" && <PortfolioTab />}
      {tab === "history" && <HistoryTab />}
    </PullToRefresh>
  );
}

// Таб «План»: те, що робиш раз на місяць у день зарплати.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Info } from "lucide-react";
import { api, type InstrumentKind, type InvestmentPlanResponse, type InvestTarget, type InvestSuggestion, type ContributionDraft } from "../../api";
import { fmtGrn, fmtGrnExact } from "../../format";
import { HelpButton, HelpSheet } from "../HelpSheet";
import { INSTRUMENT_META } from "../../instruments";
import { INSTRUMENT_INFO } from "../../instrumentHelp";
import { shownStep, totalSteps } from "../../contributionSteps";
import { ContributionFlow } from "./ContributionFlow";
import { pctWidth } from "./pctWidth";

// База відсотка з'являється лише за активного циклу — доки його нема,
// ділити нічого й лишається стара форма без цифри («15% доходу»).
// Коли з минулого циклу щось перенесено в інвестиційний бюджет, «15% від X»
// саме по собі більше не дорівнює бюджету — перенесення називаємо тим самим
// словом, що й у StepCard, замість мовчазної розбіжності (знахідка 15).
export function investPctLabel(data: InvestmentPlanResponse | undefined): string {
  if (!data?.active) return "15% доходу";
  const carry = Number(data.investCarryUah);
  return carry !== 0
    ? `15% від ${fmtGrn(data.incomeTotal)} + ${fmtGrn(data.investCarryUah)} перенесено`
    : `15% від ${fmtGrn(data.incomeTotal)}`;
}

export function PlanTab() {
  const { data, isLoading } = useQuery({
    queryKey: ["invest-plan"],
    queryFn: () => api.get<InvestmentPlanResponse>("/investments/plan"),
  });

  const qc = useQueryClient();
  const { data: suggestions } = useQuery({
    queryKey: ["invest-suggestions"],
    queryFn: () => api.get<InvestSuggestion[]>("/investments/suggestions"),
  });
  const [dismissed, setDismissed] = useState<Record<string, boolean>>({});
  // Помилка від «Зарахувати» — на картку, а не глобально: у двох карток
  // одночасно можуть висіти різні підказки Mono.
  const [suggestionError, setSuggestionError] = useState<Partial<Record<InstrumentKind, string>>>({});
  // Яка довідка відкрита. Стан на сторінці, а не в картці — тому відкритою
  // може бути тільки одна, і домовлятись картками про це не треба.
  const [help, setHelp] = useState<InstrumentKind | null>(null);

  const { data: drafts } = useQuery({
    queryKey: ["invest-drafts"],
    queryFn: () => api.get<ContributionDraft[]>("/investments/drafts"),
  });
  const [flowKind, setFlowKind] = useState<InstrumentKind | null>(null);
  // Тільки для входу з банера — id транзакції, яку записуваний внесок має
  // нести (знахідка 1 фінального рев'ю). `startFlow` (звичайний вхід із
  // кнопки «Почати») завжди чистить його, щоб чужий id не просочився в
  // ручний внесок, відкритий після банера тим самим інструментом.
  const [flowMonoTxId, setFlowMonoTxId] = useState<string | null>(null);

  const startFlow = (kind: InstrumentKind) => {
    setFlowMonoTxId(null);
    setFlowKind(kind);
  };
  // Банер Mono: переказ уже стався, тож кроки 1-2 у реальності пройдені —
  // вдавати їх було б брехнею. Ставимо чернетку одразу на крок запису.
  const acceptSuggestion = async (kind: InstrumentKind, s: InvestSuggestion) => {
    setSuggestionError((e) => ({ ...e, [kind]: undefined }));
    try {
      const draft = await api.put<ContributionDraft>(`/investments/drafts/${kind}`, {
        step: 3,
        sentUah: Math.round(Number(s.amount) / 100),
      });
      // Пишемо відповідь PUT напряму в кеш замість invalidateQueries: рефетч
      // асинхронний, тож шит міг відкритись і рендернути крок 1 ще на один
      // цикл, поки нова чернетка не долетіла (знахідка 2 фінального рев'ю).
      qc.setQueryData<ContributionDraft[]>(["invest-drafts"], (old) => [
        ...(old ?? []).filter((d) => d.kind !== kind),
        draft,
      ]);
      qc.invalidateQueries({ queryKey: ["invest-plan"] });
      setFlowMonoTxId(s.txId);
      setFlowKind(kind);
    } catch {
      setSuggestionError((e) => ({ ...e, [kind]: "Не вдалося зарахувати підказку. Спробуй ще раз." }));
    }
  };

  const suggestionFor = (kind: InstrumentKind): InvestSuggestion | undefined =>
    suggestions?.find((s) => s.guessedKind === kind && !dismissed[s.txId]);

  if (isLoading || !data) {
    return <div style={{ textAlign: "center", padding: "40px 0", color: "#6c7185", fontWeight: 600 }}>Завантаження…</div>;
  }
  if (!data.active) {
    return (
      <div style={{ textAlign: "center", padding: "40px 0", color: "#6c7185", fontSize: 14, fontWeight: 600 }}>
        Немає активного циклу.<br />Підтвердіть дохід, щоб побачити план.
      </div>
    );
  }

  const pctLabel = investPctLabel(data);

  return (
    <>
      {/* budget summary */}
      <div style={{
        marginTop: 18, padding: 20, borderRadius: 20,
        background: "linear-gradient(150deg, #22201a, #1a1d27 60%)",
        border: "1px solid rgba(245,166,35,.22)",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#a4a9bd" }}>Відкласти цього місяця</div>
          <div style={{ padding: "4px 10px", background: "rgba(245,166,35,.16)", borderRadius: 999, fontSize: 11, fontWeight: 800, color: "#F5A623" }}>
            {pctLabel}
          </div>
        </div>
        <div style={{ fontFamily: "'Space Grotesk', system-ui", fontWeight: 700, fontSize: 40, lineHeight: 1, color: "#F5A623", marginTop: 10 }}>
          {fmtGrn(data.investmentBudget)}
        </div>
        <div style={{ marginTop: 16, height: 8, background: "rgba(255,255,255,.07)", borderRadius: 999, overflow: "hidden" }}>
          <div style={{ height: "100%", width: pctWidth(data.totalContributed, data.investmentBudget), background: "linear-gradient(90deg, #F5A623, #ffbe4d)", borderRadius: 999 }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 9, fontSize: 12.5, fontWeight: 600, color: "#8a90a2" }}>
          <span>Внесено <b style={{ color: "#EDEFF5" }}>{fmtGrn(data.totalContributed)}</b></span>
          <span>Лишилось {fmtGrn(data.totalRemaining)}</span>
        </div>
      </div>

      {/* checklist */}
      <div style={{ marginTop: 26, display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: "#EDEFF5" }}>Чекліст на зарплату</div>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: "#6c7185" }}>{data.stepsDone}/3</div>
      </div>
      {data.targets.map((t) => (
        <StepCard
          key={t.kind}
          t={t}
          carryUah={t.kind === "OVDP" ? data.ovdpCarryUah : undefined}
          inzhurFreeUah={t.kind === "OVDP" || t.kind === "REIT" ? data.inzhurFreeUah : undefined}
          suggestion={suggestionFor(t.kind)}
          suggestionError={suggestionError[t.kind]}
          draft={drafts?.find((d) => d.kind === t.kind) ?? null}
          onStart={() => startFlow(t.kind)}
          onConfirmSuggestion={(s) => acceptSuggestion(t.kind, s)}
          onDismiss={(txId) => setDismissed((d) => ({ ...d, [txId]: true }))}
          onHelp={() => setHelp(t.kind)}
        />
      ))}

      {help && (
        <HelpSheet title={INSTRUMENT_META[help].label} onClose={() => setHelp(null)}>
          {INSTRUMENT_INFO[help]}
        </HelpSheet>
      )}

      {flowKind && (
        <ContributionFlow
          kind={flowKind}
          monoTxId={flowMonoTxId ?? undefined}
          onClose={() => { setFlowKind(null); setFlowMonoTxId(null); }}
        />
      )}
    </>
  );
}

function StepCard({
  t, suggestion, suggestionError, carryUah, inzhurFreeUah, draft, onConfirmSuggestion, onDismiss, onStart, onHelp,
}: {
  t: InvestTarget;
  suggestion?: InvestSuggestion;
  suggestionError?: string;
  carryUah?: string;
  inzhurFreeUah?: string;
  draft: ContributionDraft | null;
  onConfirmSuggestion: (s: InvestSuggestion) => void;
  onDismiss: (txId: string) => void;
  onStart: () => void;
  onHelp: () => void;
}) {
  const m = INSTRUMENT_META[t.kind];
  const partial = !t.done && Number(t.contributedUah) > 0;
  const statusText = t.done ? "✓ Внесено" : partial ? "Частково" : "Треба";
  const statusColor = t.done ? "#4CAF50" : partial ? m.color : "#6c7185";
  const statusBg = t.done ? "rgba(76,175,80,.14)" : partial ? m.color + "1E" : "rgba(255,255,255,.05)";
  // Крипта з підключеним ключем Binance (flow.steps === 0) пише внесок сама
  // при синку — банер не має пропонувати дію, якої для цієї цілі не існує
  // (той самий рядок нижче вже каже, що робити).
  const showBanner = !t.done && !!suggestion && t.flow.steps !== 0;
  // Банер Mono-підказки більше не ховає кнопку флоу: якщо підказка вгадала не
  // ту суму, раніше єдиним виходом було натиснути «Ні» й сподіватись, що
  // кнопка зʼявиться. «Зарахувати» і так веде на крок запису того самого флоу.
  return (
    <div className="invest-step" style={{ position: "relative", borderColor: t.done ? "rgba(76,175,80,.28)" : "rgba(255,255,255,.05)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
        <div style={{ width: 46, height: 46, borderRadius: 13, background: m.tileBg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={m.color} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d={m.iconPath} />
          </svg>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 800, color: "#EDEFF5" }}>{m.label}</div>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: "#8a90a2", marginTop: 2 }}>Ціль {fmtGrn(t.targetUah)}</div>
          {Number(carryUah) > 0 && (
            <div style={{ fontSize: 11.5, fontWeight: 600, color: "#F5A623", marginTop: 2 }}>
              з них {fmtGrn(carryUah)} перенесено з минулого місяця
            </div>
          )}
        </div>
        <HelpButton onClick={onHelp} />
        <div style={{ padding: "5px 11px", borderRadius: 999, fontSize: 11.5, fontWeight: 800, color: statusColor, background: statusBg, whiteSpace: "nowrap" }}>
          {statusText}
        </div>
      </div>
      <div className="invest-step-track">
        <div style={{ height: "100%", width: pctWidth(t.contributedUah, t.targetUah), background: m.color, borderRadius: 999 }} />
      </div>
      <div style={{ marginTop: 7, fontSize: 11.5, fontWeight: 600, color: "#6c7185" }}>
        Внесено {fmtGrn(t.contributedUah)} з {fmtGrn(t.targetUah)}
      </div>

      {!t.done && Number(inzhurFreeUah) > 0 && (
        <div style={{ marginTop: 10, fontSize: 11.5, fontWeight: 600, color: m.color, lineHeight: 1.4 }}>
          На рахунку INZHUR вже є вільні {fmtGrnExact(inzhurFreeUah)} — підуть у наступну купівлю
        </div>
      )}

      {showBanner && suggestion && (
        <div style={{ marginTop: 13, padding: 13, background: "rgba(79,195,198,.09)", border: "1px solid rgba(79,195,198,.3)", borderRadius: 14 }}>
          <div style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
            <Info size={18} color="#4FC3C6" strokeWidth={2} style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "#c8d6d7", lineHeight: 1.4 }}>
              Схоже, ти поповнив <b style={{ color: "#EDEFF5" }}>{m.label} на {fmtGrn(suggestion.amount)}</b> · з Mono
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button onClick={() => onConfirmSuggestion(suggestion)} style={{ flex: 1, padding: 10, background: "#4FC3C6", color: "#05201f", border: "none", borderRadius: 11, fontSize: 12.5, fontWeight: 800, cursor: "pointer" }}>
              Зарахувати
            </button>
            <button onClick={() => onDismiss(suggestion.txId)} style={{ padding: "10px 14px", background: "none", color: "#6c7185", border: "none", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
              Ні
            </button>
          </div>
          {suggestionError && (
            <div style={{ marginTop: 10, fontSize: 12.5, fontWeight: 700, color: "var(--expense)" }}>
              {suggestionError}
            </div>
          )}
        </div>
      )}

      {!t.done && (t.flow.steps === 0 ? (
        <>
          <div style={{ marginTop: 13, fontSize: 11.5, fontWeight: 600, color: m.color, lineHeight: 1.4 }}>
            Ключ Binance підключено — внесок запишеться сам, щойно синк побачить угоду
          </div>
          {/* Синк ловить лише Binance — WhiteBit і Kuna теж підказує /suggestions,
              але автозаписом не підхопить (знахідка 4 фінального рев'ю). Тихіший
              за головні кнопки інших карток: провідний шлях тут — автоматичний. */}
          <button
            onClick={onStart}
            style={{ display: "block", marginTop: 8, padding: 0, background: "none", border: "none", color: "#6c7185", fontSize: 11.5, fontWeight: 700, textDecoration: "underline", cursor: "pointer" }}
          >
            {draft
              ? `Продовжити вручну — крок ${shownStep(draft.step, t.flow.steps)} з ${totalSteps(t.flow.steps)}`
              : "Купив не на Binance? Записати вручну"}
          </button>
        </>
      ) : (
        <button
          onClick={onStart}
          style={{ width: "100%", marginTop: 13, minHeight: 44, padding: 11, background: "rgba(255,255,255,.04)", color: m.color, border: "1px solid rgba(255,255,255,.05)", borderRadius: 12, fontSize: 13, fontWeight: 800, cursor: "pointer" }}
        >
          {draft
            ? `Продовжити — крок ${shownStep(draft.step, t.flow.steps)} з ${totalSteps(t.flow.steps)}`
            : `Почати — ${t.flow.steps} кроки, ≈2 хв`}
        </button>
      ))}
    </div>
  );
}

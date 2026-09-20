// Покроковий внесок (знахідка 25). Один шит, що показує рівно один крок, і
// стан якого живе на сервері: між «відправив» і «записав» людина виходить в
// INZHUR, і памʼять вкладки цього не переживає.
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy } from "lucide-react";
import {
  api,
  type ContributionDraft,
  type ContributionDraftInput,
  type InstrumentKind,
  type InvestContributionInput,
  type InvestmentPlanResponse,
} from "../../api";
import { fmtGrn } from "../../format";
import { INSTRUMENT_META } from "../../instruments";
import { stepLabel, totalSteps } from "../../contributionSteps";
import { AmountSheet } from "../AmountSheet";

export function ContributionFlow({
  kind, monoTxId, onClose,
}: {
  kind: InstrumentKind;
  /**
   * Тільки для входу з банера Mono-підказки: переказ уже стався, і саме цю
   * транзакцію записуваний внесок має нести (`already_recorded` 409 на
   * повторний тап живий лише доти, доки id доїжджає до `POST /contributions`).
   * Не переживає вихід із застосунку — і це нормально: цей вхід за
   * визначенням «переказ уже стався, запиши зараз», а не «продовжи пізніше».
   */
  monoTxId?: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const m = INSTRUMENT_META[kind];

  const { data: plan } = useQuery({
    queryKey: ["invest-plan"],
    queryFn: () => api.get<InvestmentPlanResponse>("/investments/plan"),
  });
  const { data: drafts } = useQuery({
    queryKey: ["invest-drafts"],
    queryFn: () => api.get<ContributionDraft[]>("/investments/drafts"),
  });
  const draftsLoading = drafts === undefined;

  const draft = drafts?.find((d) => d.kind === kind) ?? null;
  const step = draft?.step ?? 1;

  const [qty, setQty] = useState<string>(draft?.boughtQty ? String(draft.boughtQty) : "");
  const [unitPrice, setUnitPrice] = useState<string>(
    draft?.unitPriceUah ? String(Number(draft.unitPriceUah) / 100).replace(".", ",") : "",
  );
  const [amount, setAmount] = useState<string>("");
  const [maturity, setMaturity] = useState("");
  const [yieldPct, setYieldPct] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Сума на кроці запису сіється з `sentUah` рівно раз. Чернетка приходить
  // асинхронно (`GET /investments/drafts`), тож на першому рендері `draft`
  // ще може бути `null` — ефект чекає, поки `sentUah` стане відомим, і лише
  // тоді підставляє початкове значення. Далі поле повністю під користувачем:
  // попередній варіант рахував фолбек «якщо порожнє — бери sentUah» щоразу
  // при рендері, і сума пружинила назад щоразу, коли людина стирала все поле.
  const seededAmountRef = useRef(false);
  useEffect(() => {
    if (!seededAmountRef.current && draft?.sentUah != null) {
      setAmount(String(Math.round(Number(draft.sentUah) / 100)));
      seededAmountRef.current = true;
    }
  }, [draft?.sentUah]);

  // Усі числа флоу рахує сервер (`contributionFlowCore` під тестами) і віддає
  // в `target.flow` — тут жодної арифметики, лише показ. Сума до відправки
  // перераховується щоразу, поки ти на кроці 1: якщо між заходами прийшла
  // друга частина зарплати, ціль уже інша.
  const flow = plan?.targets.find((t) => t.kind === kind)?.flow ?? null;
  const toSendUah = flow?.sendUah ?? "0";

  const saveDraft = useMutation({
    mutationFn: (v: ContributionDraftInput) => api.put(`/investments/drafts/${kind}`, v),
    // `/plan` рахує `flow.lotEstimate` від чернетки (`sentUah`), тож зміна
    // кроку тут має інвалідовувати і план, інакше орієнтир на кроці 2
    // лишається зі старою відправленою сумою.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invest-drafts"] });
      qc.invalidateQueries({ queryKey: ["invest-plan"] });
    },
    onError: () => setError("Не вдалося зберегти крок. Спробуй ще раз."),
  });

  const dropDraft = useMutation({
    mutationFn: () => api.del(`/investments/drafts/${kind}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invest-drafts"] });
      qc.invalidateQueries({ queryKey: ["invest-plan"] });
      onClose();
    },
    onError: () => setError("Не вдалося скасувати флоу. Спробуй ще раз."),
  });

  const record = useMutation({
    mutationFn: (v: InvestContributionInput) => api.post("/investments/contributions", v),
    onSuccess: () => {
      // Чернетку прибирає сервер; нам лишається освіжити те, що її показує.
      qc.invalidateQueries({ queryKey: ["invest-drafts"] });
      qc.invalidateQueries({ queryKey: ["invest-plan"] });
      qc.invalidateQueries({ queryKey: ["invest-history"] });
      qc.invalidateQueries({ queryKey: ["invest-suggestions"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      onClose();
    },
    onError: () => setError("Не вдалося зберегти внесок. Спробуй ще раз."),
  });

  const copy = () => {
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(String(Math.round(Number(toSendUah) / 100)))
      .then(() => setCopied(true))
      // Відмова в дозволі або незахищений контекст — не подія для користувача,
      // але й не причина для unhandled rejection у консолі.
      .catch(() => {});
  };

  // «Немає чернетки» і «чернетка ще вантажиться» — це не одне й те саме.
  // Поки `["invest-drafts"]` у дорозі, `draft` тимчасово `null`, і без цього
  // застереження крок 1 показав би живу кнопку «Відправив ₴X» із сьогоднішнім
  // числом із плану — а тап по ній перезаписав би реально відправлену суму,
  // яку могла вже нести чернетка з банера Mono-підказки.
  if (draftsLoading) {
    return (
      <>
        <div className="amt-backdrop" onClick={onClose} />
        <div className="flow-sheet">
          <div className="amt-grip" />
          <div style={{ textAlign: "center", padding: "40px 0", color: "#6c7185", fontWeight: 600 }}>Завантаження…</div>
        </div>
      </>
    );
  }

  // ── Крок 3: запис. Це AmountSheet — той самий нумпад, що всюди. ──
  if (step === 3) {
    const sent = draft?.sentUah ?? null;
    const num = (s: string) => Number((s || "0").replace(",", "."));

    return (
      <AmountSheet
        title={`Внести в ${m.label}`}
        subtitle="Відправлена сума, не вартість лотів — підставили за тебе"
        value={amount}
        onChange={setAmount}
        decimals={false}
        accent={m.color}
        confirmLabel={`Зафіксувати ${fmtGrn(num(amount) * 100)}`}
        onConfirm={() => {
          const uah = num(amount);
          if (!uah) { setError("Сума має бути більшою за нуль"); return; }
          setError(null);
          // Ціна за штуку (крок 2) × к-сть — орієнтир для НАСТУПНОГО місяця
          // (`lotEstimate` рахує від `bondCostUah` минулих внесків). Обидва
          // необовʼязкові, тож рахуємо, лише коли відомі обидва.
          const bondCostUah = kind === "OVDP" && draft?.unitPriceUah != null && draft?.boughtQty
            ? (Number(draft.unitPriceUah) / 100) * draft.boughtQty
            : undefined;
          record.mutate({
            kind,
            amountUah: uah,
            quantity: kind === "OVDP" && draft?.boughtQty ? draft.boughtQty : undefined,
            bondCostUah,
            maturityDate: kind === "OVDP" && maturity ? maturity : undefined,
            yieldPct: kind === "OVDP" && num(yieldPct) > 0 ? num(yieldPct) : undefined,
            monoTxId,
          });
        }}
        onCancel={onClose}
        // AmountSheet сам показує «Скасувати», а поруч, у children, стоїть
        // «Скасувати флоу» (видаляє чернетку) — дві кнопки з тим самим
        // коренем не можуть означати протилежне. Тут «Скасувати» лише
        // закриває шит без видалення чернетки, тож підпис — «Закрити»,
        // як і на кроках 1-2.
        cancelLabel="Закрити"
        busy={record.isPending}
        error={error}
      >
        <div className="flow-done-row">
          <Check size={15} color="#4CAF50" strokeWidth={2.6} />
          Відправив на {kind === "CRYPTO" ? "Binance" : "INZHUR"} {sent !== null ? fmtGrn(sent) : "—"}
        </div>
        {kind === "OVDP" && draft?.boughtQty && (
          <div className="flow-done-row">
            <Check size={15} color="#4CAF50" strokeWidth={2.6} />
            Купив облігації · {draft.boughtQty} шт
          </div>
        )}

        {kind === "OVDP" && (
          <>
            <label className="flow-field">
              <span>Дата погашення</span>
              <input type="date" value={maturity} onChange={(e) => setMaturity(e.target.value)} />
            </label>
            <label className="flow-field">
              <span>Дохідність, % річних</span>
              <input
                type="text" inputMode="decimal" placeholder="напр. 17,5" value={yieldPct}
                onChange={(e) => setYieldPct(e.target.value.replace(/[^0-9.,]/g, "").replace(".", ","))}
              />
            </label>
          </>
        )}

        <div className="flow-exit">
          <button className="flow-cancel" onClick={() => dropDraft.mutate()}>Скасувати флоу</button>
        </div>
      </AmountSheet>
    );
  }

  // ── Кроки 1-2: власна обгортка, нумпад тут не потрібен. ──
  return (
    <>
      <div className="amt-backdrop" onClick={onClose} />
      <div className="flow-sheet">
        <div className="amt-grip" />
        <div className="flow-step-label">{stepLabel(step, flow?.steps ?? 3)}</div>
        <div className="flow-title">Внести в {m.label}</div>

        {step === 1 ? (
          <>
            <div className="flow-amount" style={{ color: m.color }}>{fmtGrn(toSendUah)}</div>
            {navigator.clipboard && (
              <button className="flow-copy" onClick={copy}>
                <Copy size={15} strokeWidth={2.2} />
                {copied ? "Скопійовано" : "Копіювати суму"}
              </button>
            )}
            <div className="flow-breakdown">
              {fmtGrn(flow?.baseUah ?? "0")} — {kind === "OVDP" ? "65" : kind === "REIT" ? "25" : "10"}% інвестбюджету
              {Number(flow?.carryUah ?? 0) > 0 && <> · {fmtGrn(flow!.carryUah)} недобір за минулий місяць</>}
            </div>

            <div className="flow-next">
              <div className="flow-next-title">Що буде далі</div>
              {kind === "OVDP" && (
                <div className="flow-next-row">
                  <span className="flow-next-num">2</span>
                  Купиш облігацій, скільки влазить
                </div>
              )}
              <div className="flow-next-row">
                <span className="flow-next-num">{totalSteps(flow?.steps ?? 3)}</span>
                Запишеш <b style={{ color: "var(--text)" }}>{fmtGrn(toSendUah)}</b> — саме відправлену суму
              </div>
            </div>

            <button
              className="flow-primary"
              style={{ background: m.color }}
              disabled={saveDraft.isPending || Number(toSendUah) <= 0}
              onClick={() => saveDraft.mutate({
                step: kind === "OVDP" ? 2 : 3,
                sentUah: Math.round(Number(toSendUah) / 100),
              })}
            >
              Відправив {fmtGrn(toSendUah)}
            </button>
            <div className="flow-hint">Можна виходити в {kind === "CRYPTO" ? "Binance" : "INZHUR"} — крок збережеться</div>
          </>
        ) : (
          <>
            <div className="flow-breakdown" style={{ marginTop: 14 }}>
              Відправлено <b style={{ color: "var(--text)" }}>{draft?.sentUah ? fmtGrn(draft.sentUah) : "—"}</b>
              {flow?.lotEstimate && (
                <> · влізе ≈{flow.lotEstimate.count} шт по ~{fmtGrn(flow.lotEstimate.unitPriceUah)} (ціна останньої купівлі)</>
              )}
            </div>

            <label className="flow-field">
              <span>Скільки купив, шт</span>
              <input
                type="text" inputMode="numeric" placeholder="необовʼязково" value={qty}
                onChange={(e) => setQty(e.target.value.replace(/[^0-9]/g, ""))}
              />
            </label>

            {/* Необовʼязково: те саме число, що INZHUR показує в момент купівлі.
                Живить `bondCostUah` наступного внеску (крок 3), а він — орієнтир
                «влізе ≈X шт» для НАСТУПНОГО місяця (lotEstimate рахує з минулого). */}
            <label className="flow-field">
              <span>Ціна за штуку, ₴</span>
              <input
                type="text" inputMode="decimal" placeholder="необовʼязково, напр. 1037,71" value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value.replace(/[^0-9.,]/g, "").replace(".", ","))}
              />
            </label>

            <button
              className="flow-primary"
              style={{ background: m.color }}
              disabled={saveDraft.isPending}
              onClick={() => saveDraft.mutate({
                step: 3,
                boughtQty: qty ? Number(qty) : undefined,
                unitPriceUah: unitPrice ? Number(unitPrice.replace(",", ".")) : undefined,
              })}
            >
              Купив, далі
            </button>
          </>
        )}

        {error && <div className="amt-error">{error}</div>}

        <div className="flow-exit">
          <button className="flow-close" onClick={onClose}>Закрити</button>
          <button className="flow-cancel" onClick={() => dropDraft.mutate()}>Скасувати флоу</button>
        </div>
      </div>
    </>
  );
}

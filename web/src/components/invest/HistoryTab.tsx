// Таб «Історія»: одна вісь часу на три інструменти (знахідка 26). До неї
// відповіді на «скільки я вклав за весь час і коли» не було з жодного екрана.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type InstrumentKind, type InvestEvent, type InvestHistoryResponse } from "../../api";
import { fmtGrn, fmtGrnExact } from "../../format";
import { INSTRUMENT_META } from "../../instruments";
import { filterByKind, groupByMonth } from "../../investHistory";
import { useToast } from "../../toast";
import { HistoryEventSheet } from "./HistoryEventSheet";

const CHIPS: { key: InstrumentKind | null; label: string }[] = [
  { key: null, label: "Усі" },
  { key: "OVDP", label: "ОВДП" },
  { key: "REIT", label: "REIT" },
  { key: "CRYPTO", label: "Крипта" },
];

const CRYPTO_REASON: Record<string, string> = {
  not_configured: "ключ Binance не підключено",
  no_rate: "нема курсу USDT/UAH",
  no_data: "ще нема угод",
};

// Це PWA, пара мандрує — часовий пояс браузера не збігається з часовим поясом
// програми. Групування стрічки по місяцях (investHistory.ts) пришпилене до
// Києва, тож і мітка дня рядка має рахувати там само, інакше вечірня подія
// біля межі місяця показує «31 лип.» у групі «Серпень». Модульна константа —
// той самий патерн, що в web/src/format.ts.
const KYIV_DAY_MONTH = new Intl.DateTimeFormat("uk-UA", {
  timeZone: "Europe/Kyiv",
  day: "2-digit",
  month: "short",
});

function fmtDay(iso: string): string {
  return KYIV_DAY_MONTH.format(new Date(iso));
}

/** Прибуток/збиток зі знаком: fmtGrn сам ставить «−» для відʼємних, тож тут
 * лишається додати «+» для додатних — інакше вихід «+−₴16» на просіданні. */
function signGrn(v: string | number | bigint): string {
  return Number(v) > 0 ? `+${fmtGrn(v)}` : fmtGrn(v);
}

/** Колір за знаком, а не зашитий зелений — REIT реально йде в мінус. */
function plColor(v: string | number | bigint): string {
  const n = Number(v);
  return n > 0 ? "#4CAF50" : n < 0 ? "#EF6C6C" : "#8a90a2";
}

/** Назва події словом — правило «жодного голого числа» (знахідка 27). */
function rowTitle(e: InvestEvent): string {
  const name = INSTRUMENT_META[e.kind].label;
  return e.type === "CONVERSION" ? `${name} · обмін` : name;
}

function rowNote(e: InvestEvent): string {
  const day = fmtDay(e.date);
  switch (e.type) {
    case "CONTRIBUTION": {
      const bits = [day, "внесок"];
      if (e.quantity) bits.push(`${e.quantity} шт`);
      if (e.usdtQty) bits.push(`→ ${e.usdtQty} USDT`);
      if (e.shortfallUah) bits.push(`недобір ${fmtGrn(e.shortfallUah)}`);
      return bits.join(" · ");
    }
    case "COUPON": return `${day} · купон`;
    case "REDEMPTION": return `${day} · погашення`;
    case "VALUATION": return `${day} · знімок вартості`;
    case "CONVERSION": return `${day} · ${e.fromAmount} ${e.fromAsset} → ${e.toAmount} ${e.toAsset}`;
  }
}

function rowAmount(e: InvestEvent): string {
  if (e.type === "CONVERSION") return "";
  if (e.type === "VALUATION") return fmtGrnExact(e.amountUah);
  if (e.type === "COUPON" || e.type === "REDEMPTION") return `+${fmtGrn(e.amountUah)}`;
  return fmtGrn(e.amountUah);
}

export function HistoryTab() {
  const [kind, setKind] = useState<InstrumentKind | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["invest-history"],
    queryFn: () => api.get<InvestHistoryResponse>("/investments/history"),
  });

  const qc = useQueryClient();
  const { showToast } = useToast();
  const [open, setOpen] = useState<InvestEvent | null>(null);
  // Поки тост висить, рядок не має повертатися рефетчем — набір тримає таб,
  // провайдер тоста про списки нічого не знає (той самий патерн, що в ReitPortfolio).
  const [pendingDelete, setPendingDelete] = useState<Set<string>>(new Set());

  const delMut = useMutation({
    mutationFn: (e: InvestEvent) =>
      e.type === "VALUATION"
        ? api.del(`/investments/reit/valuations/${e.id.split(":")[1]}`)
        : api.del(`/investments/contributions/${e.id.split(":")[1]}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invest-history"] });
      qc.invalidateQueries({ queryKey: ["invest-plan"] });
      qc.invalidateQueries({ queryKey: ["reit-growth"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onSettled: (_d, _e, ev) => {
      setPendingDelete((s) => { const n = new Set(s); n.delete(ev.id); return n; });
    },
  });

  const askDelete = (e: InvestEvent) => {
    setOpen(null);
    setPendingDelete((s) => new Set(s).add(e.id));
    showToast({
      text: e.type === "VALUATION" ? "Знімок видалено" : "Внесок видалено",
      actionLabel: "Скасувати",
      onAction: () => setPendingDelete((s) => { const n = new Set(s); n.delete(e.id); return n; }),
      onExpire: () => delMut.mutate(e),
    });
  };

  if (isLoading || !data) {
    return <div style={{ textAlign: "center", padding: "40px 0", color: "#6c7185", fontWeight: 600 }}>Завантаження…</div>;
  }

  const s = data.summary;
  const visible = filterByKind(data.events, kind).filter((e) => !pendingDelete.has(e.id));
  const groups = groupByMonth(visible);

  return (
    <>
      <div className="ih-summary">
        <div style={{ fontSize: 13, fontWeight: 700, color: "#8a90a2" }}>Вкладено за весь час</div>
        <div className="ih-summary-total">{fmtGrn(s.investedUah)}</div>
        <div className="ih-summary-line">
          <b style={{ color: plColor(s.gainUah) }}>{signGrn(s.gainUah)}</b> · зараз {fmtGrn(s.nowUah)}
        </div>
        <div className="ih-summary-line">
          купони ОВДП {fmtGrn(s.ovdpCouponsUah)}
          {" · "}REIT {s.reitGainUah === null
            ? "— нема знімків"
            : <b style={{ color: plColor(s.reitGainUah) }}>{signGrn(s.reitGainUah)}</b>}
          {" · "}крипта {s.cryptoGainUah === null
            ? `— ${CRYPTO_REASON[s.cryptoUnavailable ?? "no_data"]}`
            : <b style={{ color: plColor(s.cryptoGainUah) }}>{signGrn(s.cryptoGainUah)}</b>}
        </div>
      </div>

      <div className="ih-chips">
        {CHIPS.map((c) => (
          <button
            key={c.label}
            className={"ih-chip" + (kind === c.key ? " active" : "")}
            onClick={() => setKind(c.key)}
          >
            {c.label}
          </button>
        ))}
      </div>

      {groups.length === 0 ? (
        <div className="ih-empty">
          {data.events.length === 0
            ? "Ще нічого не записано. Внески, купони й знімки вартості зʼявляться тут."
            : "За цим фільтром подій немає. Спробуй «Усі»."}
        </div>
      ) : groups.map((g) => (
        <div key={g.ym}>
          <div className="ih-month">
            <span className="ih-month-name">{g.label}</span>
            <span className="ih-month-sum">внески {fmtGrn(g.contributedUah)}</span>
          </div>
          <div className="ih-list">
            {g.events.map((e) => (
              <button key={e.id} className="ih-row" onClick={() => setOpen(e)}>
                <span className="ih-dot" style={{ background: INSTRUMENT_META[e.kind].color }} />
                <span className="ih-row-main">
                  <span className="ih-row-title" style={{ display: "block" }}>{rowTitle(e)}</span>
                  <span className="ih-row-note" style={{ display: "block" }}>{rowNote(e)}</span>
                </span>
                <span className="ih-row-amount">{rowAmount(e)}</span>
              </button>
            ))}
          </div>
        </div>
      ))}

      {open && <HistoryEventSheet event={open} onClose={() => setOpen(null)} onDelete={() => askDelete(open)} />}
    </>
  );
}

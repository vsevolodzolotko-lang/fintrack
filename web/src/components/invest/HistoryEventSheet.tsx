// Деталі однієї події історії. Видаляти можна лише те, що завели руками:
// авто-внесок із Binance синк відтворить, а купон — похідна від випуску ОВДП.
import type { InvestEvent } from "../../api";
import { fmtGrn, fmtGrnExact } from "../../format";
import { INSTRUMENT_META } from "../../instruments";

const TYPE_LABEL: Record<InvestEvent["type"], string> = {
  CONTRIBUTION: "Внесок",
  COUPON: "Купон",
  REDEMPTION: "Погашення",
  VALUATION: "Знімок вартості",
  CONVERSION: "Обмін",
};

// Київський час — той самий рядок дати має відповідати групі місяця у стрічці
// (HistoryTab), а не часовому поясу браузера в дорозі. Модульна константа,
// як прийнято в web/src/format.ts.
const KYIV_DAY_MONTH_LONG_YEAR = new Intl.DateTimeFormat("uk-UA", {
  timeZone: "Europe/Kyiv",
  day: "2-digit",
  month: "long",
  year: "numeric",
});

function fmtFull(iso: string): string {
  return KYIV_DAY_MONTH_LONG_YEAR.format(new Date(iso));
}

export function HistoryEventSheet({ event, onClose, onDelete }: {
  event: InvestEvent;
  onClose: () => void;
  onDelete: () => void;
}) {
  const m = INSTRUMENT_META[event.kind];
  const rows: { label: string; value: string }[] = [
    { label: "Коли", value: fmtFull(event.date) },
    { label: "Інструмент", value: m.label },
  ];
  if (event.type === "VALUATION") {
    rows.push({ label: "Вартість сертифікатів", value: fmtGrnExact(event.amountUah) });
    if (event.freeUah && Number(event.freeUah) > 0) {
      rows.push({ label: "Вільні на рахунку", value: fmtGrnExact(event.freeUah) });
    }
  } else if (event.type === "CONVERSION") {
    rows.push({ label: "Віддано", value: `${event.fromAmount} ${event.fromAsset}` });
    rows.push({ label: "Отримано", value: `${event.toAmount} ${event.toAsset}` });
  } else {
    // Купон і погашення в стрічці показані з «+» (рядок-подія — надходження),
    // тож шит має друкувати те саме число, інакше «+₴1 030» у стрічці й
    // «₴1 030» у шиті читаються як дві різні суми.
    const amount = event.type === "COUPON" || event.type === "REDEMPTION"
      ? `+${fmtGrn(event.amountUah)}`
      : fmtGrn(event.amountUah);
    rows.push({ label: "Сума", value: amount });
    if (event.quantity) rows.push({ label: "Кількість", value: `${event.quantity} шт` });
    if (event.usdtQty) rows.push({ label: "Куплено", value: `${event.usdtQty} USDT` });
    if (event.shortfallUah) rows.push({ label: "Недобір місяця", value: fmtGrn(event.shortfallUah) });
  }
  if (event.note) rows.push({ label: "Нотатка", value: event.note });

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 75, background: "rgba(5,7,12,.6)" }} />
      <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 76, maxWidth: "var(--app-max)", margin: "0 auto", background: "#171a24", borderTop: "1px solid rgba(255,255,255,.09)", borderRadius: "26px 26px 0 0", padding: "10px 22px calc(28px + env(safe-area-inset-bottom))", animation: "sheetUp .28s cubic-bezier(.2,.8,.3,1)" }}>
        <div style={{ width: 40, height: 5, background: "rgba(255,255,255,.18)", borderRadius: 999, margin: "0 auto 16px" }} />
        <div style={{ fontSize: 15, fontWeight: 800, color: "#EDEFF5" }}>{TYPE_LABEL[event.type]}</div>
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 9 }}>
          {rows.map((r) => (
            <div key={r.label} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#8a90a2" }}>{r.label}</span>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: "#EDEFF5", fontVariantNumeric: "tabular-nums", textAlign: "right" }}>{r.value}</span>
            </div>
          ))}
        </div>
        {event.deletable ? (
          <button onClick={onDelete} style={{ width: "100%", marginTop: 18, minHeight: 44, padding: 13, background: "rgba(239,108,108,.12)", color: "#EF6C6C", border: "1px solid rgba(239,108,108,.3)", borderRadius: 13, fontSize: 14, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>
            Видалити
          </button>
        ) : (
          <div style={{ marginTop: 16, fontSize: 11.5, fontWeight: 600, color: "#6c7185", lineHeight: 1.4 }}>
            {event.type === "CONTRIBUTION"
              ? "Прийшло із синку Binance — видалення тут нічого не дасть, наступний синк запише його знову."
              : "Похідна подія: береться з випуску ОВДП або з історії Binance."}
          </div>
        )}
        <button onClick={onClose} style={{ width: "100%", marginTop: 10, minHeight: 44, padding: 13, background: "none", color: "#8a90a2", border: "none", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
          Закрити
        </button>
      </div>
    </>
  );
}

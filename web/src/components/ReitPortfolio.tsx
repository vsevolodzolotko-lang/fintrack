// INZHUR REIT: ріст вартості за ручними знімками (API немає — вводимо руками).
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, type ReitGrowthResponse } from "../api";
import { fmtGrn, fmtGrnExact } from "../format";
import { AmountSheet } from "./AmountSheet";
import { HelpButton, HelpSheet } from "./HelpSheet";
const ACCENT = "#4FC3C6";
const TILE_BG = "rgba(79,195,198,.14)";
const CONTRIB = "#8a90a2";
const GREEN = "#4CAF50";
const RED = "#EF6C6C";

function plColor(v: string | null): string {
  const n = Number(v ?? 0);
  return n > 0 ? GREEN : n < 0 ? RED : "#8a90a2";
}

function signGrnExact(v: string | null): string {
  if (v === null) return "—";
  return Number(v) > 0 ? `+${fmtGrnExact(v)}` : fmtGrnExact(v);
}

function fmtDay(iso: string): string {
  return new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "short" }).format(new Date(iso));
}

// Об'єднує серію внесків і знімки в одну вісь часу для графіка.
function chartData(p: ReitGrowthResponse): { t: number; label: string; contributed: number | null; value: number | null }[] {
  const map = new Map<number, { contributed: number | null; value: number | null }>();
  for (const s of p.contributedSeries) {
    const t = new Date(s.date).getTime();
    map.set(t, { contributed: Number(s.cumulativeUah) / 100, value: map.get(t)?.value ?? null });
  }
  for (const v of p.valuations) {
    const t = new Date(v.date).getTime();
    const prev = map.get(t);
    map.set(t, { contributed: prev?.contributed ?? null, value: Number(v.valueUah) / 100 });
  }
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, val]) => ({ t, label: fmtDay(new Date(t).toISOString()), ...val }));
}

export function ReitPortfolio() {
  const qc = useQueryClient();
  const { data: p } = useQuery({
    queryKey: ["reit-growth"],
    queryFn: () => api.get<ReitGrowthResponse>("/investments/reit"),
  });

  const [sheet, setSheet] = useState<
    { amount: string; invested: string; dividends: string; free: string; date: string } | null
  >(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [help, setHelp] = useState(false);

  const addMut = useMutation({
    mutationFn: (v: { valueUah: number; investedUah?: number; dividendsUah?: number; freeUah?: number; date?: string }) =>
      api.post("/investments/reit/valuations", v),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reit-growth"] });
      setSheet(null);
      setAddError(null);
    },
    onError: () => setAddError("Не вдалося зберегти. Спробуй ще раз."),
  });

  const num = (v: string) => Number((v || "0").replace(",", "."));
  const amountNum = sheet ? num(sheet.amount) : 0;
  const investedNum = sheet ? num(sheet.invested) : 0;
  const dividendsNum = sheet ? num(sheet.dividends) : 0;
  const freeNum = sheet ? num(sheet.free) : 0;

  const data = p ? chartData(p) : [];
  // Оцінка застаріла: після неї були внески, яких сертифікати ще не бачили.
  const stale = !!p && Number(p.contributedAfterAsOf) > 0;

  return (
    <>
      <div style={{ marginTop: 26, display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: "#EDEFF5" }}>Inzhur REIT</div>
          <div style={{ marginTop: 2, fontSize: 11.5, fontWeight: 600, color: "#6c7185" }}>
            {p?.asOf ? `оцінка від ${fmtDay(p.asOf)}` : "ручні знімки вартості"}
          </div>
        </div>
        <HelpButton onClick={() => setHelp(true)} />
        <button
          onClick={() => { setAddError(null); setSheet({ amount: "", invested: "", dividends: "", free: "", date: "" }); }}
          aria-label="Оновити вартість INZHUR"
          style={{ width: 38, height: 38, display: "flex", alignItems: "center", justifyContent: "center", background: TILE_BG, border: "none", borderRadius: 12, cursor: "pointer" }}
        >
          <Plus size={18} color={ACCENT} strokeWidth={2.4} />
        </button>
      </div>

      {!p || (p.valuations.length === 0 && Number(p.contributedTotal) === 0) ? (
        <div style={{ marginTop: 12, padding: 18, background: "#1a1d27", border: "1px dashed rgba(255,255,255,.1)", borderRadius: 18, fontSize: 12.5, fontWeight: 600, color: "#6c7185", lineHeight: 1.5, textAlign: "center" }}>
          Ще немає даних. Додай перший знімок поточної вартості портфеля INZHUR кнопкою «+».
        </div>
      ) : (
        <>
          {/* hero: прибуток */}
          <div style={{ marginTop: 12, padding: 20, borderRadius: 20, background: "linear-gradient(150deg, #16262a, #1a1d27 60%)", border: "1px solid rgba(79,195,198,.22)" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#a4a9bd" }}>Прибуток</div>
            <div style={{ fontFamily: "'Space Grotesk', system-ui", fontWeight: 700, fontSize: 40, lineHeight: 1, color: plColor(p.gainUah), marginTop: 10 }}>
              {signGrnExact(p.gainUah)}
              {p.gainPct !== null && (
                <span style={{ fontSize: 18, marginLeft: 10, color: plColor(p.gainUah) }}>
                  {p.gainPct > 0 ? "+" : ""}{p.gainPct.toFixed(1)}%
                </span>
              )}
            </div>
            {/* Підпис називає саме базу прибутку — скільки пішло в сертифікати,
                а не скільки переказано: інакше три числа в рядку не сходяться. */}
            <div style={{ marginTop: 9, fontSize: 12.5, fontWeight: 600, color: "#8a90a2" }}>
              {p.costBasisUah !== null ? (
                <>
                  У сертифікатах <b style={{ color: "#EDEFF5" }}>{fmtGrnExact(p.costBasisUah)}</b>
                  {p.latestValue !== null && (
                    <> · коштують <b style={{ color: "#EDEFF5" }}>{fmtGrnExact(p.latestValue)}</b></>
                  )}
                </>
              ) : (
                <>
                  Вклав <b style={{ color: "#EDEFF5" }}>{fmtGrn(p.contributedTotal)}</b>
                  {p.latestValue !== null && (
                    <> · сертифікати <b style={{ color: "#EDEFF5" }}>{fmtGrnExact(p.latestValue)}</b></>
                  )}
                </>
              )}
            </div>
            {/* Під реінвестом дивіденд стає сертифікатами й піднімає «Проінвестовано»
                разом із вартістю — у капіталізацію не входить. Тож розклад показує
                обидві половини заробітку окремо, як це робить і сам INZHUR. */}
            {Number(p.dividendsUah) > 0 && p.capitalGainUah !== null && (
              <div style={{ marginTop: 6, fontSize: 11.5, fontWeight: 600, color: "#6c7185" }}>
                капіталізація <b style={{ color: plColor(p.capitalGainUah) }}>{signGrnExact(p.capitalGainUah)}</b>
                {" · "}дивіденди <b style={{ color: GREEN }}>+{fmtGrnExact(p.dividendsUah)}</b>
              </div>
            )}
            {p.costBasisUah === null && p.asOf && (
              <div style={{ marginTop: 6, fontSize: 11.5, fontWeight: 600, color: RED }}>
                прибуток не рахується: вільних на рахунку більше, ніж заведено грошей — схоже, якийсь переказ у INZHUR не записаний
              </div>
            )}
            {stale && (
              <div style={{ marginTop: 6, fontSize: 11.5, fontWeight: 600, color: ACCENT }}>
                після оцінки довнесено {fmtGrn(p.contributedAfterAsOf)} — усього вклав {fmtGrn(p.contributedTotal)}; онови вартість у INZHUR
              </div>
            )}
            {Number(p.latestFreeUah) > 0 && (
              <div style={{ marginTop: 6, fontSize: 11.5, fontWeight: 600, color: "#6c7185" }}>
                на рахунку вільні {fmtGrnExact(p.latestFreeUah)} — спільний кеш з ОВДП, ще не розміщені
              </div>
            )}
          </div>

          {/* графік росту */}
          {data.length > 1 && (
            <div style={{ marginTop: 12, padding: "16px 8px 8px", background: "#1a1d27", border: "1px solid rgba(255,255,255,.05)", borderRadius: 18 }}>
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={data} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#6c7185" }} axisLine={false} tickLine={false} />
                  <YAxis hide />
                  <Tooltip
                    contentStyle={{ background: "#171a24", border: "1px solid rgba(255,255,255,.1)", borderRadius: 10, fontSize: 12 }}
                    labelStyle={{ color: "#a4a9bd" }}
                    formatter={(val: number, name: string) => [fmtGrn(Math.round(val * 100)), name === "value" ? "вартість" : "вкладено"]}
                  />
                  <Line type="monotone" dataKey="contributed" stroke={CONTRIB} strokeWidth={2} dot={false} connectNulls strokeDasharray="4 4" />
                  <Line type="monotone" dataKey="value" stroke={ACCENT} strokeWidth={2.4} dot={{ r: 3, fill: ACCENT }} connectNulls />
                </LineChart>
              </ResponsiveContainer>
              <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 4, fontSize: 11, fontWeight: 700 }}>
                <span style={{ color: CONTRIB }}>— вкладено</span>
                <span style={{ color: ACCENT }}>— вартість</span>
              </div>
            </div>
          )}
        </>
      )}

      {/* аркуш вводу вартості */}
      {sheet && (
        <AmountSheet
          title="Поточна вартість INZHUR"
          subtitle="Три числа з екрана «Деталі» фонду Inzhur REIT"
          value={sheet.amount}
          onChange={(v) => setSheet((s) => (s ? { ...s, amount: v } : s))}
          decimals
          accent={ACCENT}
          confirmLabel={`Зберегти ${fmtGrnExact(Math.round(amountNum * 100))}`}
          onConfirm={() => {
            // Нуль тут — не сума, а порожня дія: сервер відхиляє нульову
            // вартість, тож ловимо це як помилку вводу, а не мовчазний неуспіх
            // (стара форма не пускала далі кнопку саме на цьому випадку).
            if (!Number.isFinite(amountNum) || amountNum <= 0) { setAddError("Вартість має бути більшою за нуль"); return; }
            setAddError(null);
            addMut.mutate({
              valueUah: amountNum,
              // Порожнє поле не те саме, що нуль: без «Проінвестовано» база
              // падає назад на зведення рахунку, а не стає нульовою.
              investedUah: sheet.invested.trim() === "" ? undefined : investedNum,
              dividendsUah: sheet.dividends.trim() === "" ? undefined : dividendsNum,
              freeUah: freeNum > 0 ? freeNum : undefined,
              date: sheet.date || undefined,
            });
          }}
          onCancel={() => { setSheet(null); setAddError(null); }}
          busy={addMut.isPending}
          error={addError}
        >
          <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 15px", marginTop: 10, background: "#1e222e", border: "1px solid rgba(255,255,255,.06)", borderRadius: 13 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#a4a9bd" }}>Дата (необов'язково)</span>
            <input type="date" value={sheet.date} onChange={(e) => setSheet((s) => (s ? { ...s, date: e.target.value } : s))} style={{ background: "transparent", border: "none", color: ACCENT, fontSize: 13.5, fontWeight: 700, fontFamily: "inherit" }} />
          </label>

          <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 15px", marginTop: 10, background: "#1e222e", border: "1px solid rgba(255,255,255,.06)", borderRadius: 13 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#a4a9bd" }}>Проінвестовано</span>
            <input
              type="text" inputMode="decimal" placeholder="0"
              value={sheet.invested}
              onChange={(e) => setSheet((s) => (s ? { ...s, invested: e.target.value.replace(/[^0-9.,]/g, "").replace(".", ",") } : s))}
              style={{ background: "transparent", border: "none", color: ACCENT, fontSize: 13.5, fontWeight: 700, fontFamily: "inherit", textAlign: "right", width: 110, outline: "none" }}
            />
          </label>

          <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 15px", marginTop: 10, background: "#1e222e", border: "1px solid rgba(255,255,255,.06)", borderRadius: 13 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#a4a9bd" }}>Виплачено дивідендів</span>
            <input
              type="text" inputMode="decimal" placeholder="0"
              value={sheet.dividends}
              onChange={(e) => setSheet((s) => (s ? { ...s, dividends: e.target.value.replace(/[^0-9.,]/g, "").replace(".", ",") } : s))}
              style={{ background: "transparent", border: "none", color: ACCENT, fontSize: 13.5, fontWeight: 700, fontFamily: "inherit", textAlign: "right", width: 110, outline: "none" }}
            />
          </label>

          <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 15px", marginTop: 10, background: "#1e222e", border: "1px solid rgba(255,255,255,.06)", borderRadius: 13 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#a4a9bd" }}>Вільні кошти на рахунку</span>
            <input
              type="text" inputMode="decimal" placeholder="0"
              value={sheet.free}
              onChange={(e) => setSheet((s) => (s ? { ...s, free: e.target.value.replace(/[^0-9.,]/g, "").replace(".", ",") } : s))}
              style={{ background: "transparent", border: "none", color: ACCENT, fontSize: 13.5, fontWeight: 700, fontFamily: "inherit", textAlign: "right", width: 110, outline: "none" }}
            />
          </label>
        </AmountSheet>
      )}

      {/* довідка: навіщо це і що натискати */}
      {help && (
        <HelpSheet title="Навіщо це і що натискати" onClose={() => setHelp(false)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div>
              В INZHUR немає API, тож застосунок не бачить твій портфель сам. Щоб трекати, як росте вкладене, ти <b style={{ color: "#EDEFF5" }}>раз на період</b> (напр. після нарахування дивідендів) заносиш поточну вартість вручну.
            </div>
            <div>
              <b style={{ color: ACCENT }}>Кнопка «+»</b> — відкриває ввід. Відкрий у INZHUR фонд <b style={{ color: "#EDEFF5" }}>Inzhur REIT → «Деталі»</b> і перепиши три числа звідти: <b style={{ color: "#EDEFF5" }}>«Вартість активу»</b> і <b style={{ color: "#EDEFF5" }}>«Проінвестовано»</b> з блоку «Інформація про актив», та <b style={{ color: "#EDEFF5" }}>«Виплачено дивідендів»</b> з блоку «Дивіденди та капіталізація». Четверте поле, «вільні кошти» на рахунку, — необов'язкове. Не бери «Поточна вартість портфелю»: якщо купуєш через INZHUR ще й ОВДП, та цифра містить облігації.
            </div>
            <div>
              <b style={{ color: "#EDEFF5" }}>Що покаже.</b> <b style={{ color: GREEN }}>Прибуток</b> = (вартість − проінвестовано) + виплачені дивіденди. Дві половини рахуються окремо, бо в тебе <b style={{ color: "#EDEFF5" }}>реінвестування</b>: виплачений дивіденд одразу купує нові сертифікати й тим самим піднімає «Проінвестовано» разом із вартістю — тобто в капіталізацію він не входить і без окремого числа заробіток був би невидимий. Картка показує розклад тим самим рядком, що й INZHUR.
            </div>
            <div>
              <b style={{ color: "#EDEFF5" }}>Чому саме «Проінвестовано», а не сума переказів.</b> Переказ і вкладене — різні числа: що не влізло в цілий сертифікат, лишається на рахунку вільними, і порівняння з переказом малювало б збиток на рівному місці. Обидва числа беруться з одного екрана в один момент, тож між ними не буває розбіжності дат. Вільний залишок на прибуток не впливає взагалі — навіть попри те, що він спільний з ОВДП.
            </div>
            <div>
              Усе рахується <b style={{ color: "#EDEFF5" }}>станом на дату знімка</b>: внески після неї в прибуток не входять — сертифікатів на них у тій оцінці ще нема. Про них буде окремий рядок із нагадуванням оновити вартість. Графік показує вкладене проти вартості сертифікатів; показовим стає з другого знімка.
            </div>
            <div style={{ color: "#8a90a2" }}>
              <b style={{ color: "#a4a9bd" }}>Помилковий знімок</b> можна виправити в табі «Історія» — тап по рядку, «Видалити».
            </div>
          </div>
        </HelpSheet>
      )}
    </>
  );
}

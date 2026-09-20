// Таб «Портфель»: драбинка ОВДП, крипто й REIT — стан капіталу, а не план місяця.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, type InstrumentKind, type InvestmentPlanResponse } from "../../api";
import { fmtGrn, fmtGrnExact } from "../../format";
import { CryptoPortfolio } from "../CryptoPortfolio";
import { ReitPortfolio } from "../ReitPortfolio";
import { INSTRUMENT_META } from "../../instruments";
import { pctWidth } from "./pctWidth";

function monthsUntil(iso: string): number {
  const d = new Date(iso), now = new Date();
  return Math.max(0, Math.round((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * 30)));
}

const OVDP_COLOR = "#F5A623";

/**
 * Насиченість замість світлофора (знахідка 17). Близьке погашення — це добре:
 * гроші звільняються. Червоний у решті апки означає перевитрату, тож у драбинці
 * колір більше не несе тривоги — лише «це ОВДП», а близькість читається яскравістю.
 */
function ladderOpacity(i: number, n: number): number {
  return 1 - 0.65 * (i / Math.max(1, n - 1));
}

function fmtMaturity(iso: string): string {
  return new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso));
}

export function PortfolioTab() {
  const { data, isLoading } = useQuery({
    queryKey: ["invest-plan"],
    queryFn: () => api.get<InvestmentPlanResponse>("/investments/plan"),
  });

  const qc = useQueryClient();
  const [ladderEdit, setLadderEdit] = useState<{
    id: string; yield: string; maturity: string;
    couponMode: boolean; qty: string; unitPrice: string;
    couponPerBond: string; nominalPerBond: string; couponDates: string[];
    // Знято при відкритті й більше не змінюється: чи випуск уже мав графік.
    // Поки true, перемикач режиму не показуємо — «купонний → простий» на
    // випуску з графіком лишав би дату погашення внеску розсинхронізованою з
    // ovdpProjection (сервер не чіпає наявні OvdpCashflow при простому PATCH,
    // але перезаписує maturityDate самого внеску).
    hasGraph: boolean;
  } | null>(null);
  const [ladderError, setLadderError] = useState<string | null>(null);

  const patchMut = useMutation({
    mutationFn: (v: {
      id: string; yieldPct?: number; maturityDate?: string;
      quantity?: number; bondCostUah?: number;
      cashflows?: { date: string; kind: "COUPON" | "REDEMPTION"; amountUah: number }[];
    }) =>
      api.patch(`/investments/contributions/${v.id}`, {
        yieldPct: v.yieldPct, maturityDate: v.maturityDate,
        quantity: v.quantity, bondCostUah: v.bondCostUah, cashflows: v.cashflows,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invest-plan"] });
      setLadderEdit(null);
      setLadderError(null);
    },
    // Без цього серверна відмова (400 на невалідних cashflows, 404, мережа) була
    // тихою — шит просто стояв, ніби нічого не сталося.
    onError: () => setLadderError("Не вдалося зберегти. Перевір поля і спробуй ще раз."),
  });

  return (
    <>
      {isLoading || !data ? (
        <div style={{ textAlign: "center", padding: "40px 0", color: "#6c7185", fontWeight: 600 }}>Завантаження…</div>
      ) : !data.active ? (
        <div style={{ textAlign: "center", padding: "28px 0", color: "#6c7185", fontSize: 13, fontWeight: 600 }}>
          Ще нема даних по циклах — але портфелі нижче живуть своїм життям.
        </div>
      ) : (
        <>
          {/* cumulative */}
          <div style={{ marginTop: 26, fontSize: 17, fontWeight: 800, color: "#EDEFF5" }}>Всього вкладено</div>
          <div style={{ marginTop: 12, padding: 18, background: "#1a1d27", border: "1px solid rgba(255,255,255,.05)", borderRadius: 18 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#8a90a2" }}>За весь час</span>
              <span style={{ fontFamily: "'Space Grotesk', system-ui", fontSize: 26, fontWeight: 700, color: "#EDEFF5" }}>{fmtGrn(data.cumulative.total)}</span>
            </div>
            <div style={{ marginTop: 14, display: "flex", height: 10, borderRadius: 999, overflow: "hidden", gap: 2 }}>
              <div style={{ width: pctWidth(data.cumulative.OVDP, data.cumulative.total), background: "#F5A623" }} />
              <div style={{ width: pctWidth(data.cumulative.REIT, data.cumulative.total), background: "#4FC3C6" }} />
              <div style={{ width: pctWidth(data.cumulative.CRYPTO, data.cumulative.total), background: "#7C83FF" }} />
            </div>
            <div style={{ marginTop: 15, display: "flex", flexDirection: "column", gap: 11 }}>
              {(["OVDP", "REIT", "CRYPTO"] as InstrumentKind[]).map((k) => (
                <div key={k} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ width: 9, height: 9, borderRadius: 3, background: INSTRUMENT_META[k].color }} />
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: "#c5c9d6" }}>{INSTRUMENT_META[k].label}</span>
                  <span style={{ fontFamily: "'Space Grotesk', system-ui", fontSize: 13.5, fontWeight: 600, color: "#EDEFF5" }}>{fmtGrn(data.cumulative[k])}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ladder */}
          <div style={{ marginTop: 26, fontSize: 17, fontWeight: 800, color: "#EDEFF5" }}>Драбинка ОВДП</div>
          <div style={{ marginTop: 4, fontSize: 12.5, fontWeight: 600, color: "#6c7185", lineHeight: 1.4 }}>
            Погашення рознесені в часі — гроші звільняються рівномірно
          </div>
          <div style={{ marginTop: 12, background: "#1a1d27", border: "1px solid rgba(255,255,255,.05)", borderRadius: 18, overflow: "hidden" }}>
            {data.ladder.length === 0 ? (
              <div style={{ padding: 20, fontSize: 12.5, fontWeight: 600, color: "#6c7185", textAlign: "center" }}>
                Ще немає випусків. Купи перший ОВДП і вкажи дату погашення.
              </div>
            ) : (() => {
              const nowTs = Date.now();
              const upcoming = data.ladder.filter((l) => new Date(l.maturityDate).getTime() >= nowTs);
              const matured = data.ladder.filter((l) => new Date(l.maturityDate).getTime() < nowTs);
              const ladderRows = [...upcoming, ...matured];
              return ladderRows.map((l, i) => {
                const isMatured = i >= upcoming.length;
                const isFirstUpcoming = !isMatured && i === 0;
                const dotOpacity = isMatured ? 0.3 : ladderOpacity(i, upcoming.length);
                return (
                  <div
                    key={l.id}
                    onClick={() => setLadderEdit({
                      id: l.id,
                      yield: l.yieldPct ? String(Number(l.yieldPct)).replace(".", ",") : "",
                      maturity: l.maturityDate.slice(0, 10),
                      couponMode: l.cashflows.length > 0,
                      qty: l.quantity != null ? String(l.quantity) : "",
                      unitPrice: l.bondCostUah && l.quantity ? String(Math.round(Number(l.bondCostUah) / l.quantity) / 100).replace(".", ",") : "",
                      // Купон/шт із наявного графіка не відновлюємо: OvdpCashflow зберігає
                      // сукупну суму на дату, а не суму на облігацію — точно поділити
                      // назад неможливо (к-сть купонних виплат на дату теж не фіксована).
                      // Поле лишається порожнім; людина вписує його, якщо перезаводить графік.
                      couponPerBond: "",
                      nominalPerBond: "",
                      couponDates: l.cashflows.filter((c) => c.kind === "COUPON").map((c) => c.date.slice(0, 10)),
                      hasGraph: l.cashflows.length > 0,
                    })}
                    style={{ display: "flex", alignItems: "center", padding: "13px 16px", borderBottom: "1px solid rgba(255,255,255,.04)", cursor: "pointer", opacity: isMatured ? 0.55 : 1 }}
                  >
                    <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 9 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: OVDP_COLOR, opacity: dotOpacity }} />
                      <div>
                        <div style={{ fontSize: 13.5, fontWeight: 700, color: "#EDEFF5" }}>{fmtMaturity(l.maturityDate)}</div>
                        <div style={{ fontSize: 11, fontWeight: 600, color: "#8a90a2" }}>{isMatured ? "погашено" : `через ${monthsUntil(l.maturityDate)} міс`}</div>
                        {isFirstUpcoming && l.expectedReturnUah && (
                          <div style={{ fontSize: 11, fontWeight: 600, color: OVDP_COLOR }}>
                            звільниться {fmtGrn(l.expectedReturnUah)}
                          </div>
                        )}
                        {!isFirstUpcoming && l.expectedReturnUah && (
                          <div style={{ fontSize: 11, fontWeight: 600, color: OVDP_COLOR }}>
                            повернеться ≈ {fmtGrn(l.expectedReturnUah)}{l.yieldPct ? ` · ${Number(l.yieldPct)}%` : ""}
                          </div>
                        )}
                        {!l.expectedReturnUah && (
                          <div style={{ fontSize: 11, fontWeight: 600, color: "#6c7185" }}>тапни — додай дохідність</div>
                        )}
                        {l.quantity != null && (
                          <div style={{ fontSize: 11, fontWeight: 600, color: "#8a90a2" }}>×{l.quantity} шт</div>
                        )}
                        {l.cashflows.length > 0 && (
                          <div style={{ marginTop: 3, fontSize: 10.5, fontWeight: 600, color: "#6c7185", lineHeight: 1.5 }}>
                            {l.cashflows.map((c, ci) => (
                              <div key={ci}>
                                {fmtMaturity(c.date).replace(/ р\.$/, "")} · {c.kind === "COUPON" ? "купон" : "погашення"} {fmtGrn(c.amountUah)}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <span style={{ fontFamily: "'Space Grotesk', system-ui", fontSize: 13.5, fontWeight: 600, color: "#EDEFF5" }}>{fmtGrn(l.amountUah)}</span>
                  </div>
                );
              });
            })()}
          </div>
          {data.ladder.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 11, fontWeight: 600, color: "#6c7185", textAlign: "center" }}>
              насиченість = близькість погашення
            </div>
          )}

          {data.ovdpProjection && (
            <>
              <div style={{ marginTop: 10, fontSize: 12.5, fontWeight: 600, color: "#8a90a2" }}>
                У паперах <b style={{ color: "#EDEFF5" }}>{fmtGrn(data.ovdpProjection.investedUah)}</b> → повернеться ≈ <b style={{ color: "#F5A623" }}>{fmtGrn(data.ovdpProjection.expectedUah)}</b> (+{fmtGrn(BigInt(data.ovdpProjection.expectedUah) - BigInt(data.ovdpProjection.investedUah))})
              </div>
              {(Number(data.ovdpProjection.couponsReceivedUah) > 0 || Number(data.ovdpProjection.couponsUpcomingUah) > 0) && (
                <div style={{ marginTop: 4, fontSize: 12, fontWeight: 600, color: "#6c7185" }}>
                  Купонів отримано <b style={{ color: "#EDEFF5" }}>{fmtGrn(data.ovdpProjection.couponsReceivedUah)}</b> · попереду {fmtGrn(data.ovdpProjection.couponsUpcomingUah)}
                </div>
              )}
              {data.ovdpProjection.series.length > 1 && (() => {
                const chartData = data.ovdpProjection.series.map((s) => ({ label: fmtMaturity(s.date).replace(/ р\.$/, ""), date: s.date, v: Number(s.valueUah) / 100 }));
                const todayKey = new Date().toISOString().slice(0, 10);
                const todayLabel = chartData.find((p) => p.date === todayKey)?.label;
                const couponKeys = new Set(
                  data.ladder.flatMap((l) => l.cashflows.filter((c) => c.kind === "COUPON").map((c) => c.date.slice(0, 10))),
                );
                const couponLabels = chartData.filter((p) => couponKeys.has(p.date)).map((p) => p.label);
                return (
                  <div style={{ marginTop: 10, padding: "16px 8px 8px", background: "#1a1d27", border: "1px solid rgba(255,255,255,.05)", borderRadius: 18 }}>
                    <ResponsiveContainer width="100%" height={150}>
                      <LineChart data={chartData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                        <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#6c7185" }} axisLine={false} tickLine={false} />
                        <YAxis hide domain={["dataMin", "dataMax"]} />
                        {todayLabel && <ReferenceLine x={todayLabel} stroke="rgba(255,255,255,.25)" strokeDasharray="4 4" />}
                        {couponLabels.map((lb) => (
                          <ReferenceLine key={lb} x={lb} stroke="rgba(245,166,35,.28)" strokeDasharray="2 3" />
                        ))}
                        <Tooltip
                          contentStyle={{ background: "#171a24", border: "1px solid rgba(255,255,255,.1)", borderRadius: 10, fontSize: 12 }}
                          labelStyle={{ color: "#a4a9bd" }}
                          formatter={(val: number) => [fmtGrn(Math.round(val * 100)), "нараховано"]}
                        />
                        <Line type="linear" dataKey="v" stroke="#F5A623" strokeWidth={2.2} dot={{ r: 3, fill: "#F5A623" }} />
                      </LineChart>
                    </ResponsiveContainer>
                    <div style={{ textAlign: "center", marginTop: 4, fontSize: 11, fontWeight: 700, color: "#6c7185" }}>очікуване нарощення · купони — амбер-пунктир · сьогодні — сірий</div>
                  </div>
                );
              })()}
            </>
          )}
        </>
      )}

      <ReitPortfolio />
      {/* Крипто-портфель з Binance — незалежний від циклу */}
      <CryptoPortfolio />

      {ladderEdit && (
        <>
          <div onClick={() => { setLadderEdit(null); setLadderError(null); }} style={{ position: "fixed", inset: 0, zIndex: 75, background: "rgba(5,7,12,.6)" }} />
          <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 76, maxWidth: "var(--app-max)", margin: "0 auto", background: "#171a24", borderTop: "1px solid rgba(255,255,255,.09)", borderRadius: "26px 26px 0 0", padding: "10px 22px calc(28px + env(safe-area-inset-bottom))", animation: "sheetUp .28s cubic-bezier(.2,.8,.3,1)" }}>
            <div style={{ width: 40, height: 5, background: "rgba(255,255,255,.18)", borderRadius: 999, margin: "0 auto 16px" }} />
            <div style={{ fontSize: 15, fontWeight: 800, color: "#EDEFF5" }}>Випуск ОВДП</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#8a90a2", marginTop: 2 }}>
              {ladderEdit.couponMode ? "К-сть, ціна й графік купонів — точний розрахунок повернення" : "Дохідність і дата погашення — для очікуваного повернення"}
            </div>

            {/* Перемикач лише для випуску без графіка. З графіком couponMode
                зафіксовано true при відкритті (див. коментар у стейті) — тут
                нема кнопки, якою можна було б перемкнути назад у просту ставку. */}
            {!ladderEdit.hasGraph && (
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                {([["Проста ставка", false], ["Купонна облігація", true]] as const).map(([label, on]) => (
                  <button
                    key={String(on)}
                    onClick={() => setLadderEdit((s) => (s ? { ...s, couponMode: on } : s))}
                    style={{
                      flex: 1, minHeight: 44, borderRadius: 11, border: "1px solid rgba(255,255,255,.06)",
                      background: ladderEdit.couponMode === on ? "rgba(245,166,35,.16)" : "#1e222e",
                      color: ladderEdit.couponMode === on ? OVDP_COLOR : "#8a90a2",
                      fontFamily: "inherit", fontSize: 12.5, fontWeight: 700, cursor: "pointer",
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}

            <label className="flow-field">
              <span>Дата погашення</span>
              <input type="date" value={ladderEdit.maturity}
                onChange={(e) => setLadderEdit((s) => (s ? { ...s, maturity: e.target.value } : s))} />
            </label>

            {!ladderEdit.couponMode ? (
              <label className="flow-field">
                <span>Дохідність, % річних</span>
                <input type="text" inputMode="decimal" placeholder="напр. 17,5" value={ladderEdit.yield}
                  onChange={(e) => setLadderEdit((s) => (s ? { ...s, yield: e.target.value.replace(/[^0-9.,]/g, "").replace(".", ",") } : s))} />
              </label>
            ) : (
              <>
                <div style={{ display: "flex", gap: 8 }}>
                  <label className="flow-field" style={{ flex: 1 }}>
                    <span>К-сть</span>
                    <input type="text" inputMode="numeric" placeholder="11" value={ladderEdit.qty}
                      onChange={(e) => setLadderEdit((s) => (s ? { ...s, qty: e.target.value.replace(/[^0-9]/g, "") } : s))}
                      style={{ width: 60 }} />
                  </label>
                  <label className="flow-field" style={{ flex: 1 }}>
                    <span>Ціна/шт</span>
                    <input type="text" inputMode="decimal" placeholder="1037,71" value={ladderEdit.unitPrice}
                      onChange={(e) => setLadderEdit((s) => (s ? { ...s, unitPrice: e.target.value.replace(/[^0-9.,]/g, "").replace(".", ",") } : s))}
                      style={{ width: 90 }} />
                  </label>
                </div>

                <div style={{ display: "flex", gap: 8 }}>
                  <label className="flow-field" style={{ flex: 1 }}>
                    <span>Купон/шт</span>
                    <input type="text" inputMode="decimal" placeholder="79,25" value={ladderEdit.couponPerBond}
                      onChange={(e) => setLadderEdit((s) => (s ? { ...s, couponPerBond: e.target.value.replace(/[^0-9.,]/g, "").replace(".", ",") } : s))}
                      style={{ width: 80 }} />
                  </label>
                  <label className="flow-field" style={{ flex: 1 }}>
                    <span>Номінал/шт</span>
                    <input type="text" inputMode="decimal" placeholder="1000" value={ladderEdit.nominalPerBond}
                      onChange={(e) => setLadderEdit((s) => (s ? { ...s, nominalPerBond: e.target.value.replace(/[^0-9.,]/g, "").replace(".", ",") } : s))}
                      style={{ width: 80 }} />
                  </label>
                </div>

                <div style={{ marginTop: 12, padding: "10px 15px", background: "#1e222e", border: "1px solid rgba(255,255,255,.06)", borderRadius: 13 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#a4a9bd", marginBottom: 6 }}>Дати купонів</div>
                  {ladderEdit.couponDates.map((cd, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: i ? 6 : 0 }}>
                      <input type="date" value={cd}
                        onChange={(e) => setLadderEdit((s) => (s ? { ...s, couponDates: s.couponDates.map((x, j) => (j === i ? e.target.value : x)) } : s))}
                        style={{ flex: 1, background: "transparent", border: "none", color: "#F5A623", fontSize: 13.5, fontWeight: 700, fontFamily: "inherit" }} />
                      <button onClick={() => setLadderEdit((s) => (s ? { ...s, couponDates: s.couponDates.filter((_, j) => j !== i) } : s))}
                        style={{ background: "none", border: "none", color: "#6c7185", fontSize: 18, fontWeight: 700, cursor: "pointer", padding: "0 4px" }}>×</button>
                    </div>
                  ))}
                  <button onClick={() => setLadderEdit((s) => (s ? { ...s, couponDates: [...s.couponDates, ""] } : s))}
                    style={{ marginTop: 8, minHeight: 44, background: "none", border: "none", color: "#F5A623", fontSize: 12.5, fontWeight: 800, cursor: "pointer" }}>+ купон</button>
                </div>

                {(() => {
                  const num = (s: string) => Number((s || "0").replace(",", "."));
                  const qty = Math.round(num(ladderEdit.qty));
                  const bondCost = num(ladderEdit.unitPrice) * qty;
                  const dates = ladderEdit.couponDates.filter(Boolean).length;
                  const inflow = num(ladderEdit.couponPerBond) * qty * dates + num(ladderEdit.nominalPerBond) * qty;
                  // couponPerBond/nominalPerBond порожні за задумом при відкритті наявного
                  // випуску — без цієї умови прев'ю рендерилось би з «повернеться ≈ ₴0»
                  // (фінальний огляд, п.2).
                  if (!qty || !bondCost || !inflow) return null;
                  return (
                    <div style={{ marginTop: 8, fontSize: 12, fontWeight: 700, color: "#8a90a2", textAlign: "center" }}>
                      У папери {fmtGrnExact(Math.round(bondCost * 100))} → повернеться ≈ {fmtGrnExact(Math.round(inflow * 100))}
                      {inflow > bondCost && <b style={{ color: OVDP_COLOR }}> (+{fmtGrnExact(Math.round((inflow - bondCost) * 100))})</b>}
                    </div>
                  );
                })()}
              </>
            )}

            {ladderError && <div className="amt-error">{ladderError}</div>}

            <button
              onClick={() => {
                const num = (s: string) => Number((s || "0").replace(",", "."));
                if (!ladderEdit.couponMode) {
                  const y = num(ladderEdit.yield);
                  setLadderError(null);
                  patchMut.mutate({ id: ladderEdit.id, yieldPct: y > 0 ? y : undefined, maturityDate: ladderEdit.maturity || undefined });
                  return;
                }
                const qty = Math.round(num(ladderEdit.qty));
                const unitPrice = num(ladderEdit.unitPrice);
                const couponPerBond = num(ladderEdit.couponPerBond);
                const nominalPerBond = num(ladderEdit.nominalPerBond);
                const dates = ladderEdit.couponDates.filter(Boolean);
                if (!qty || !unitPrice || !ladderEdit.maturity || dates.length === 0) {
                  setLadderError("Заповни к-сть, ціну, дати купонів і дату погашення.");
                  return;
                }
                // Купон/шт порожнє за задумом при відкритті наявного графіка (не
                // відновлюється із сукупної суми на дату) — без цієї перевірки в
                // сервер летів би 0, і той відхиляв би запит мовчки для шита.
                if (!couponPerBond) {
                  setLadderError("Купон/шт порожнє — щоб перезаписати графік купонів, введи суму купона на одну облігацію.");
                  return;
                }
                if (!nominalPerBond) {
                  setLadderError("Номінал/шт не може бути порожнім — вкажи номінал однієї облігації.");
                  return;
                }
                setLadderError(null);
                patchMut.mutate({
                  id: ladderEdit.id,
                  quantity: qty,
                  bondCostUah: +(unitPrice * qty).toFixed(2),
                  maturityDate: ladderEdit.maturity,
                  cashflows: [
                    ...dates.map((date) => ({ date, kind: "COUPON" as const, amountUah: +(couponPerBond * qty).toFixed(2) })),
                    { date: ladderEdit.maturity, kind: "REDEMPTION" as const, amountUah: +(nominalPerBond * qty).toFixed(2) },
                  ],
                });
              }}
              disabled={patchMut.isPending}
              style={{ width: "100%", marginTop: 14, minHeight: 44, padding: 16, background: "#F5A623", color: "#10130a", border: "none", borderRadius: 15, fontSize: 15, fontWeight: 800, cursor: "pointer" }}
            >
              Зберегти
            </button>
          </div>
        </>
      )}
    </>
  );
}

// Крипто-портфель з Binance: хедлайн — рух ринку (gross), окремо розклад входу (спред P2P + комісії) і net.
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Info, RefreshCw, TriangleAlert } from "lucide-react";
import { Area, AreaChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  api,
  type BinanceStatus,
  type CryptoBalanceIssue,
  type CryptoConversionRow,
  type CryptoPortfolioResponse,
  type CryptoSeriesResponse,
} from "../api";
import { fmtGrn, fmtRelDate, pct } from "../format";
import { ConversionSheet } from "./crypto/ConversionSheet";
import { fmtQty } from "./crypto/fmtQty";

const ACCENT = "#7C83FF";
const GREEN = "#4CAF50";
const RED = "#EF6C6C";
const ASSET_COLORS: Record<string, string> = {
  BTC: "#F5A623",
  ETH: "#8A9BF5",
  USDT: "#4FC3C6",
};

// Причина розбіжності — пил і комісії відсіяні на сервері, лишились справжні випадки.
const ISSUE_HINT: Record<CryptoBalanceIssue["kind"], string> = {
  UNTRACKED: "цих монет трекінг не бачив — купівля пройшла поза P2P і Convert",
  SHORTFALL: "монет на Binance менше, ніж у трекінгу — схоже, продано або виведено поза апкою",
  SURPLUS: "монет більше, ніж у трекінгу — частину куплено до того, як синк почав бачити історію",
};

function fmtDayShort(iso: string): string {
  return new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "short" }).format(new Date(iso));
}

function signGrn(v: string): string {
  return Number(v) > 0 ? `+${fmtGrn(v)}` : fmtGrn(v);
}

// Копійки-рядок зі зміненим знаком: спред/inputLoss зберігаються як «втрата» (плюс = втратив),
// а в UI показуємо як вплив на твою користь (плюс = вигода входу).
function neg(v: string): string {
  return String(-BigInt(v));
}

function plColor(v: string): string {
  const n = Number(v);
  return n > 0 ? GREEN : n < 0 ? RED : "#8a90a2";
}

export function CryptoPortfolio() {
  const qc = useQueryClient();
  const { data: status } = useQuery({
    queryKey: ["binance-status"],
    queryFn: () => api.get<BinanceStatus>("/binance/status"),
    refetchInterval: (q) => (q.state.data?.syncing ? 3000 : false),
  });

  const { data: p } = useQuery({
    queryKey: ["crypto-portfolio"],
    queryFn: () => api.get<CryptoPortfolioResponse>("/binance/portfolio"),
    enabled: !!status?.configured,
  });

  const { data: series } = useQuery({
    queryKey: ["crypto-series"],
    queryFn: () => api.get<CryptoSeriesResponse>("/binance/series"),
    enabled: !!status?.configured && !!p && !p.empty,
  });

  const syncMut = useMutation({
    mutationFn: () => api.post("/binance/sync", {}),
    onSettled: () => qc.invalidateQueries({ queryKey: ["binance-status"] }),
  });

  // По завершенню синку — оновити портфель і чекліст (авто-внески «Крипта»)
  const wasSyncing = useRef(false);
  useEffect(() => {
    if (wasSyncing.current && status && !status.syncing) {
      qc.invalidateQueries({ queryKey: ["crypto-portfolio"] });
      qc.invalidateQueries({ queryKey: ["invest-plan"] });
      qc.invalidateQueries({ queryKey: ["binance-status"] });
    }
    wasSyncing.current = !!status?.syncing;
  }, [status, qc]);

  const [showBreakdown, setShowBreakdown] = useState(false);
  const [info, setInfo] = useState(false);
  const [openConv, setOpenConv] = useState<CryptoConversionRow | null>(null);
  const [showTracked, setShowTracked] = useState(false);
  const orphans = p?.orphanConversions?.filter((c) => !c.outOfTracking) ?? [];
  const marked = p?.orphanConversions?.filter((c) => c.outOfTracking) ?? [];

  if (!status) return null;

  if (!status.configured) {
    return (
      <>
        <SectionTitle syncing={false} />
        <div style={{ marginTop: 12, padding: 18, background: "#1a1d27", border: "1px dashed rgba(255,255,255,.1)", borderRadius: 18, fontSize: 12.5, fontWeight: 600, color: "#6c7185", lineHeight: 1.5 }}>
          Binance не підключено. Додай read-only ключ у <b style={{ color: "#a4a9bd" }}>.env</b> (BINANCE_API_KEY / BINANCE_API_SECRET) і перезапусти сервер — історія P2P та конвертацій підтягнеться сама.
        </div>
      </>
    );
  }

  const syncing = status.syncing || syncMut.isPending;
  const restrictionsBad = status.restrictions !== null && !status.restrictions.ok;

  return (
    <>
      <SectionTitle
        syncing={syncing}
        keyMasked={status.keyMasked}
        lastSyncAt={status.lastSyncAt}
        onSync={() => syncMut.mutate()}
        onInfo={() => setInfo((v) => !v)}
        infoActive={info}
      />

      {info && (
        <div style={{ marginTop: 12, padding: 16, background: "rgba(124,131,255,.07)", border: "1px solid rgba(124,131,255,.28)", borderRadius: 16, fontSize: 12.5, fontWeight: 600, color: "#c8cbe0", lineHeight: 1.5 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <Info size={17} color={ACCENT} strokeWidth={2.2} style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontSize: 13.5, fontWeight: 800, color: "#EDEFF5" }}>Звідки дані і як рахується</div>
          </div>
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
            <div>Дані тягнуться з <b style={{ color: "#EDEFF5" }}>Binance read-only API</b>: P2P-покупки USDT і конвертації. Синк — автоматичний (ціни що 15 хв) або кнопкою поруч.</div>
            <div><b style={{ color: "#EDEFF5" }}>«Прибуток · рух ринку»</b> — зміна вартості активів від моменту входу. <b style={{ color: "#EDEFF5" }}>«Розклад входу»</b> — скільки з'їли P2P-спреди та комісії; разом вони дають чистий результат.</div>
            <div>Крива під карткою — <b style={{ color: "#EDEFF5" }}>рух ринку по днях</b>: вартість портфеля за історичними цінами Binance мінус ефективний вхід.</div>
            <div style={{ color: "#8a90a2" }}>Binance P2P API віддає лише ~6 місяців історії — старіші покупки запиши вручну; бейдж розбіжності балансу підкаже, якщо щось не затрековано.</div>
          </div>
        </div>
      )}

      {restrictionsBad && (
        <Banner color={RED}>
          Проблема з API-ключем: {status.restrictions?.error ?? "ключ має права на торгівлю чи виведення. Потрібен ключ лише з «Enable Reading»."}
        </Banner>
      )}
      {status.lastError && !syncing && (
        <Banner color={RED}>Останній синк впав: {status.lastError}</Banner>
      )}

      {!p || p.empty ? (
        <div style={{ marginTop: 12, padding: 18, background: "#1a1d27", border: "1px solid rgba(255,255,255,.05)", borderRadius: 18, fontSize: 12.5, fontWeight: 600, color: "#6c7185", textAlign: "center" }}>
          {syncing ? "Синхронізація історії…" : "Ще немає даних. Натисни синк, щоб підтягнути історію з Binance."}
        </div>
      ) : p.ratesUnavailable || !p.totals ? (
        <Banner color="#F5A623">Немає курсу USDT/UAH — вартість портфеля тимчасово недоступна.</Banner>
      ) : (
        <>
          {/* hero: net P&L */}
          <div style={{ marginTop: 12, padding: 20, borderRadius: 20, background: "linear-gradient(150deg, #1d1e2e, #1a1d27 60%)", border: "1px solid rgba(124,131,255,.22)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#a4a9bd" }}>Прибуток · рух ринку</div>
              {p.totals.flags.spreadUnknown && (
                <span style={{ padding: "4px 10px", background: "rgba(245,166,35,.16)", borderRadius: 999, fontSize: 10.5, fontWeight: 800, color: "#F5A623" }}>
                  спред не всюди розраховано
                </span>
              )}
            </div>
            <div style={{ fontFamily: "'Space Grotesk', system-ui", fontWeight: 700, fontSize: 40, lineHeight: 1, color: plColor(p.totals.grossProfitUah), marginTop: 10 }}>
              {signGrn(p.totals.grossProfitUah)}
            </div>
            <div style={{ marginTop: 9, fontSize: 12.5, fontWeight: 600, color: "#8a90a2" }}>
              На вході <b style={{ color: "#EDEFF5" }}>{fmtGrn(p.totals.effectiveInvestedUah)}</b> · зараз <b style={{ color: "#EDEFF5" }}>{fmtGrn(p.totals.currentValueUah)}</b>
            </div>

            {/* breakdown */}
            <button onClick={() => setShowBreakdown((v) => !v)} style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 14, padding: 0, background: "none", border: "none", color: ACCENT, fontSize: 12.5, fontWeight: 800, cursor: "pointer" }}>
              Розклад входу
              <ChevronDown size={15} strokeWidth={2.5} style={{ transform: showBreakdown ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
            </button>
            {showBreakdown && (
              <div style={{ marginTop: 10, padding: "12px 14px", background: "rgba(255,255,255,.03)", borderRadius: 13, display: "flex", flexDirection: "column", gap: 8 }}>
                <BreakdownRow label="Заплатив (кеш)" value={fmtGrn(p.totals.contributionUah)} />
                <BreakdownRow label="Вартість активів на вході" value={fmtGrn(p.totals.effectiveInvestedUah)} />
                <BreakdownRow
                  label={`Вигода/втрата входу (${pct(neg(p.totals.inputLossUah), p.totals.contributionUah)}%)`}
                  value={signGrn(neg(p.totals.inputLossUah))}
                  valueColor={plColor(neg(p.totals.inputLossUah))}
                  strong
                />
                <div style={{ fontSize: 11.5, fontWeight: 600, color: "#6c7185", lineHeight: 1.4, paddingLeft: 2 }}>
                  {p.totals.flags.spreadUnknown ? "спред не всюди розраховано" : `P2P-спред ${signGrn(neg(p.totals.spreadUah))}`}
                  {" · комісії "}{signGrn(neg(p.totals.feesUah))}
                  {p.totals.flags.feesIncomplete && " · частина без курсу"}
                </div>
                <div style={{ height: 1, background: "rgba(255,255,255,.06)", margin: "2px 0" }} />
                <BreakdownRow
                  label="Разом із входом"
                  value={signGrn(p.totals.netProfitUah)}
                  valueColor={plColor(p.totals.netProfitUah)}
                  strong
                />
                <div style={{ fontSize: 11.5, fontWeight: 600, color: "#6c7185", lineHeight: 1.4 }}>
                  рух ринку {signGrn(p.totals.grossProfitUah)} + вхід {signGrn(neg(p.totals.inputLossUah))}
                </div>
              </div>
            )}
          </div>

          {series && !series.empty && !series.ratesUnavailable && series.days.length > 1 && (() => {
            const data = series.days.map((d) => ({ label: fmtDayShort(d.date), v: Number(d.grossUah) / 100 }));
            const vals = data.map((d) => d.v);
            const mx = Math.max(...vals), mn = Math.min(...vals);
            const off = mx <= 0 ? 0 : mn >= 0 ? 1 : mx / (mx - mn);
            return (
              <div style={{ marginTop: 12, padding: "16px 8px 8px", background: "#1a1d27", border: "1px solid rgba(255,255,255,.05)", borderRadius: 18 }}>
                <ResponsiveContainer width="100%" height={160}>
                  <AreaChart data={data} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="grossFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset={off} stopColor={GREEN} stopOpacity={0.22} />
                        <stop offset={off} stopColor={RED} stopOpacity={0.22} />
                      </linearGradient>
                      <linearGradient id="grossStroke" x1="0" y1="0" x2="0" y2="1">
                        <stop offset={off} stopColor={GREEN} />
                        <stop offset={off} stopColor={RED} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#6c7185" }} axisLine={false} tickLine={false} />
                    <YAxis hide />
                    <ReferenceLine y={0} stroke="rgba(255,255,255,.18)" strokeDasharray="4 4" />
                    <Tooltip
                      contentStyle={{ background: "#171a24", border: "1px solid rgba(255,255,255,.1)", borderRadius: 10, fontSize: 12 }}
                      labelStyle={{ color: "#a4a9bd" }}
                      formatter={(val: number) => [fmtGrn(Math.round(val * 100)), "рух ринку"]}
                    />
                    <Area type="monotone" dataKey="v" stroke="url(#grossStroke)" strokeWidth={2.2} fill="url(#grossFill)" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
                <div style={{ textAlign: "center", marginTop: 4, fontSize: 11, fontWeight: 700, color: "#6c7185" }}>рух ринку по днях</div>
              </div>
            );
          })()}

          {/* asset positions */}
          <div style={{ marginTop: 12, background: "#1a1d27", border: "1px solid rgba(255,255,255,.05)", borderRadius: 18, overflow: "hidden" }}>
            {p.assets?.map((a) => (
              <div key={a.asset} style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 16px", borderBottom: "1px solid rgba(255,255,255,.04)" }}>
                <span style={{ width: 9, height: 9, borderRadius: 3, background: ASSET_COLORS[a.asset] ?? ACCENT }} />
                <span style={{ fontSize: 13.5, fontWeight: 800, color: "#EDEFF5", width: 48 }}>{a.asset}</span>
                <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600, color: "#8a90a2" }}>{fmtQty(a.qty)}</span>
                <span style={{ fontFamily: "'Space Grotesk', system-ui", fontSize: 13.5, fontWeight: 600, color: "#EDEFF5" }}>{fmtGrn(a.valueUah)}</span>
              </div>
            ))}
            {p.reconciliation?.mismatch && (
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "11px 16px", fontSize: 11.5, fontWeight: 600, color: "#F5A623", lineHeight: 1.45 }}>
                <TriangleAlert size={14} style={{ flexShrink: 0, marginTop: 2 }} />
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {p.reconciliation.issues.map((i) => (
                    <div key={i.asset}>
                      <b style={{ color: "#EDEFF5" }}>{i.asset}</b>{" "}
                      {i.kind === "UNTRACKED"
                        ? `${fmtQty(i.actualQty)} на Binance не затрековано`
                        : `затрековано ${fmtQty(i.trackedQty)}, на Binance ${fmtQty(i.actualQty)}`}
                      <span style={{ color: "#8a90a2" }}> · ≈{i.diffValueUsdt} USDT · {ISSUE_HINT[i.kind]}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {p.totals.flags.untrackedUsdtSource && (
              <div style={{ padding: "11px 16px", fontSize: 11.5, fontWeight: 600, color: "#6c7185", lineHeight: 1.4 }}>
                Частина конвертацій витратила USDT поза затрекуваною історією.
              </div>
            )}
          </div>

          {orphans.length > 0 && (
            <>
              <div className="orph-title">Куплено не з відомого поповнення</div>
              <div className="orph-why">
                Binance віддає лише пів року історії — усе старіше треба привʼязати або позначити руками.
              </div>
              <div className="orph-list">
                {orphans.map((c) => (
                  <button key={c.id} className="orph-row" onClick={() => setOpenConv(c)}>
                    <span style={{ flex: 1 }}>
                      {fmtDayShort(c.tradeTime)} · {fmtQty(c.fromAmount)} USDT → {fmtQty(c.toAmount)} {c.toAsset}
                    </span>
                    <ChevronDown size={14} strokeWidth={2.5} style={{ transform: "rotate(-90deg)", opacity: .6 }} />
                  </button>
                ))}
              </div>
            </>
          )}

          {marked.length > 0 && (
            <>
              <button className="orph-group" onClick={() => setShowTracked((v) => !v)}>
                <ChevronDown size={14} strokeWidth={2.5} style={{ transform: showTracked ? "none" : "rotate(-90deg)" }} />
                Поза трекінгом · {marked.length}
              </button>
              {showTracked && (
                <div className="orph-list">
                  {marked.map((c) => (
                    <button key={c.id} className="orph-row" onClick={() => setOpenConv(c)}>
                      <span style={{ flex: 1 }}>
                        {fmtDayShort(c.tradeTime)} · {fmtQty(c.fromAmount)} USDT → {fmtQty(c.toAmount)} {c.toAsset}
                      </span>
                      <ChevronDown size={14} strokeWidth={2.5} style={{ transform: "rotate(-90deg)", opacity: .6 }} />
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}

      {openConv && (
        <ConversionSheet
          conversion={openConv}
          onClose={() => setOpenConv(null)}
          canMarkOutOfTracking={!!p?.totals?.flags.untrackedUsdtSource}
        />
      )}
    </>
  );
}

function SectionTitle({ syncing, keyMasked, lastSyncAt, onSync, onInfo, infoActive }: {
  syncing: boolean;
  keyMasked?: string | null;
  lastSyncAt?: string | null;
  onSync?: () => void;
  onInfo?: () => void;
  infoActive?: boolean;
}) {
  return (
    <div style={{ marginTop: 26, display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: "#EDEFF5" }}>Крипта · Binance</div>
        <div style={{ marginTop: 2, fontSize: 11.5, fontWeight: 600, color: "#6c7185" }}>
          {keyMasked ? `ключ ${keyMasked}` : "не підключено"}
          {lastSyncAt ? ` · синк ${fmtRelDate(lastSyncAt)}` : ""}
        </div>
      </div>
      {onInfo && (
        <button
          onClick={onInfo}
          aria-label="Що це і як рахується"
          style={{ width: 38, height: 38, display: "flex", alignItems: "center", justifyContent: "center", background: infoActive ? "rgba(124,131,255,.14)" : "rgba(255,255,255,.04)", border: "none", borderRadius: 12, cursor: "pointer" }}
        >
          <Info size={17} color={infoActive ? ACCENT : "#8a90a2"} strokeWidth={2.2} />
        </button>
      )}
      {onSync && (
        <button
          onClick={onSync}
          disabled={syncing}
          aria-label="Синхронізувати з Binance"
          style={{ width: 38, height: 38, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(124,131,255,.14)", border: "none", borderRadius: 12, cursor: syncing ? "default" : "pointer" }}
        >
          <RefreshCw size={17} color={ACCENT} strokeWidth={2.2} style={syncing ? { animation: "ptr-spin 1s linear infinite" } : undefined} />
        </button>
      )}
    </div>
  );
}

function Banner({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 12, padding: "12px 14px", background: `${color}17`, border: `1px solid ${color}45`, borderRadius: 14, fontSize: 12.5, fontWeight: 600, color, lineHeight: 1.4 }}>
      {children}
    </div>
  );
}

function BreakdownRow({ label, value, strong, valueColor }: { label: string; value: string; strong?: boolean; valueColor?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, fontWeight: strong ? 800 : 600, color: strong ? "#EDEFF5" : "#a4a9bd" }}>
      <span>{label}</span>
      <span style={{ fontFamily: "'Space Grotesk', system-ui", color: valueColor }}>{value}</span>
    </div>
  );
}

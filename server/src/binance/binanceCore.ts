// Чиста математика Binance-модуля — без Prisma і fetch, тестується юнітами.
import { Decimal } from "@prisma/client/runtime/library";

const DAY_MS = 24 * 3_600_000;
const WINDOW_30D_MS = 30 * DAY_MS;
// Допуск на пил/комісії при звʼязуванні конверсії з P2P-ордером
const CAPACITY_TOLERANCE = new Decimal("0.995");

// ─── Гроші ───

// Binance віддає суми десятковими рядками; у копійки — лише стрінговою математикою.
export function uahToKopecks(s: string | number): bigint {
  const str = String(s).trim();
  const m = /^(\d+)(?:\.(\d+))?$/.exec(str);
  if (!m) throw new Error(`Bad decimal amount: "${str}"`);
  const [, whole, frac = ""] = m;
  const cents = (frac + "00").slice(0, 2);
  let kop = BigInt(whole) * 100n + BigInt(cents);
  if (frac.length > 2 && frac.charCodeAt(2) >= 53 /* '5' */) kop += 1n;
  return kop;
}

export function decToKopecks(d: Decimal): bigint {
  return BigInt(d.mul(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0));
}

// ─── Вікна бекфілу (P2P і Convert обмежені 30 днями на запит) ───

export interface TimeWindow {
  start: number;
  end: number;
}

export function planWindows(fromMs: number, toMs: number, windowMs = WINDOW_30D_MS): TimeWindow[] {
  const windows: TimeWindow[] = [];
  for (let start = fromMs; start < toMs; start += windowMs) {
    windows.push({ start, end: Math.min(start + windowMs, toMs) });
  }
  return windows;
}

// ─── Маппери сирих відповідей API → рядки БД ───
// SAPI історично нестрогий щодо string/number — приймаємо обидва.

export interface RawP2PRow {
  orderNumber: string;
  tradeType: string;
  asset: string;
  fiat: string;
  amount: string | number;
  totalPrice: string | number;
  unitPrice: string | number;
  commission?: string | number;
  orderStatus: string;
  createTime: number;
  counterPartNickName?: string;
  [k: string]: unknown;
}

export interface RawConvertRow {
  orderId: string | number;
  orderStatus?: string;
  fromAsset: string;
  fromAmount: string | number;
  toAsset: string;
  toAmount: string | number;
  createTime: number;
  [k: string]: unknown;
}

export interface RawSpotTradeRow {
  id: number;
  price: string | number;
  qty: string | number;
  quoteQty: string | number;
  commission: string | number;
  commissionAsset: string;
  time: number;
  isBuyer: boolean;
  [k: string]: unknown;
}

export interface MappedP2POrder {
  orderNumber: string;
  asset: string;
  fiat: string;
  assetQty: Decimal;
  fiatAmountUah: bigint;
  unitPriceUah: Decimal;
  commissionUsdt: Decimal;
  counterparty: string | null;
  tradeTime: Date;
}

export interface MappedConversion {
  source: "CONVERT" | "SPOT";
  externalId: string;
  symbol: string | null;
  spotTradeId: bigint | null;
  fromAsset: string;
  fromAmount: Decimal;
  toAsset: string;
  toAmount: Decimal;
  feeAsset: string | null;
  feeAmount: Decimal;
  feeUsdt: Decimal | null;
  mktPriceUsdt: Decimal | null;
  tradeTime: Date;
}

export function isRelevantP2PRow(row: RawP2PRow): boolean {
  return row.orderStatus === "COMPLETED" && row.tradeType === "BUY" && row.fiat === "UAH";
}

export function mapP2PRow(row: RawP2PRow): MappedP2POrder {
  return {
    orderNumber: String(row.orderNumber),
    asset: row.asset,
    fiat: row.fiat,
    assetQty: new Decimal(String(row.amount)),
    fiatAmountUah: uahToKopecks(row.totalPrice),
    unitPriceUah: new Decimal(String(row.unitPrice)),
    commissionUsdt: new Decimal(String(row.commission ?? 0)),
    counterparty: row.counterPartNickName ?? null,
    tradeTime: new Date(row.createTime),
  };
}

export function mapConvertRow(row: RawConvertRow): MappedConversion {
  return {
    source: "CONVERT",
    externalId: String(row.orderId),
    symbol: null,
    spotTradeId: null,
    fromAsset: row.fromAsset,
    fromAmount: new Decimal(String(row.fromAmount)),
    toAsset: row.toAsset,
    toAmount: new Decimal(String(row.toAmount)),
    feeAsset: null,
    feeAmount: new Decimal(0),
    feeUsdt: null, // implicit fee — рахується при enrichment через kline-ціну
    mktPriceUsdt: null,
    tradeTime: new Date(row.createTime),
  };
}

export function isRelevantSpotRow(row: RawSpotTradeRow, symbol: string): boolean {
  return row.isBuyer === true && symbol.endsWith("USDT");
}

export function mapSpotRow(row: RawSpotTradeRow, symbol: string): MappedConversion {
  const baseAsset = symbol.slice(0, -"USDT".length);
  const price = new Decimal(String(row.price));
  const qty = new Decimal(String(row.qty));
  const commission = new Decimal(String(row.commission));
  const feeInBase = row.commissionAsset === baseAsset;

  let feeUsdt: Decimal | null = null;
  if (row.commissionAsset === "USDT") feeUsdt = commission;
  else if (feeInBase) feeUsdt = commission.mul(price);
  // інший актив (BNB тощо) — потрібен курс на момент угоди, заповнить enrichment

  return {
    source: "SPOT",
    externalId: `${symbol}#${row.id}`,
    symbol,
    spotTradeId: BigInt(row.id),
    fromAsset: "USDT",
    fromAmount: new Decimal(String(row.quoteQty)),
    toAsset: baseAsset,
    toAmount: feeInBase ? qty.sub(commission) : qty,
    feeAsset: row.commissionAsset ?? null,
    feeAmount: commission,
    feeUsdt,
    mktPriceUsdt: price,
    tradeTime: new Date(row.time),
  };
}

// ─── Звʼязування конверсій з P2P-ордерами ───

export interface CoreP2POrder {
  id: string;
  orderNumber: string;
  assetQty: Decimal;
  fiatAmountUah: bigint;
  commissionUsdt: Decimal;
  tradeTime: Date;
  marketRateUah: Decimal | null;
}

export interface CoreConversion {
  id: string;
  source: "CONVERT" | "SPOT";
  fromAmount: Decimal;
  toAsset: string;
  toAmount: Decimal;
  feeUsdt: Decimal | null;
  mktPriceUsdt: Decimal | null;
  usdtUahRate: Decimal | null;
  tradeTime: Date;
  p2pOrderId: string | null;
  /** Витрачені USDT куплені поза вікном історії Binance — підтверджено вручну.
      Необовʼязкове: Prisma-рядки поле мають завжди, а фікстури тестів — ні. */
  outOfTracking?: boolean;
}

/**
 * Скільки USDT у кожному поповненні ще не витрачено. Позначені «поза трекінгом»
 * конвертації залишок не зменшують: їхні USDT прийшли не з цього поповнення.
 */
export function orderRemaining(
  orders: CoreP2POrder[],
  conversions: CoreConversion[],
): Map<string, Decimal> {
  const remaining = new Map<string, Decimal>(
    orders.map((o) => [o.id, o.assetQty.sub(o.commissionUsdt)]),
  );
  for (const c of conversions) {
    if (c.outOfTracking) continue;
    if (c.p2pOrderId && remaining.has(c.p2pOrderId)) {
      remaining.set(c.p2pOrderId, remaining.get(c.p2pOrderId)!.sub(c.fromAmount));
    }
  }
  return remaining;
}

/**
 * Поповнення, до яких можна привʼязати цю конвертацію: з вільним залишком і не
 * пізніші за неї (купити USDT після того, як їх витратив, неможливо).
 * Найближчі за часом — першими: у типовому випадку потрібний саме перший.
 */
export function candidateOrders(
  conversion: CoreConversion,
  orders: CoreP2POrder[],
  conversions: CoreConversion[],
): { order: CoreP2POrder; remaining: Decimal }[] {
  const remaining = orderRemaining(orders, conversions);
  return orders
    .filter((o) => o.tradeTime.getTime() <= conversion.tradeTime.getTime())
    .map((o) => ({ order: o, remaining: remaining.get(o.id) ?? new Decimal(0) }))
    .filter((c) => c.remaining.gt(0))
    .sort((a, b) => b.order.tradeTime.getTime() - a.order.tradeTime.getTime());
}

// Конверсія лягає на найновіший P2P-ордер за попередні `windowMs`,
// у якого ще лишилось достатньо USDT. Повертає призначення лише для НЕпривʼязаних конверсій.
export function groupConversions(
  orders: CoreP2POrder[],
  conversions: CoreConversion[],
  windowMs = DAY_MS,
): Map<string, string | null> {
  const remaining = orderRemaining(orders, conversions);

  const result = new Map<string, string | null>();
  const pending = conversions
    // Позначена «поза трекінгом» лишається без привʼязки навмисно: інакше
    // наступний синк привʼязав би її до випадкового ордера й тим самим зняв
    // позначку, яку людина поставила руками.
    .filter((c) => !c.p2pOrderId && !c.outOfTracking)
    .sort((a, b) => a.tradeTime.getTime() - b.tradeTime.getTime());

  for (const c of pending) {
    const t = c.tradeTime.getTime();
    const candidates = orders
      .filter((o) => {
        const dt = t - o.tradeTime.getTime();
        return dt >= 0 && dt <= windowMs;
      })
      .sort((a, b) => b.tradeTime.getTime() - a.tradeTime.getTime());

    let assigned: string | null = null;
    for (const o of candidates) {
      const rem = remaining.get(o.id)!;
      if (rem.gte(c.fromAmount.mul(CAPACITY_TOLERANCE))) {
        assigned = o.id;
        const left = rem.sub(c.fromAmount);
        remaining.set(o.id, left.isNegative() ? new Decimal(0) : left);
        break;
      }
    }
    result.set(c.id, assigned);
  }
  return result;
}

// ─── P&L ───

export interface PnlFlags {
  spreadUnknown: boolean;
  feesIncomplete: boolean;
  priceMissing: boolean;
}

export interface InvestmentPnl {
  contributionUah: bigint;
  spreadUah: bigint;
  feesUah: bigint;
  inputLossUah: bigint;
  effectiveInvestedUah: bigint;
  currentValueUah: bigint;
  netProfitUah: bigint;
  grossProfitUah: bigint;
  leftoverUsdt: Decimal;
  flags: PnlFlags;
}

export function convFeeUsdt(c: CoreConversion): { fee: Decimal | null; incomplete: boolean } {
  if (c.feeUsdt) return { fee: c.feeUsdt, incomplete: false };
  if (c.source === "CONVERT" && c.mktPriceUsdt) {
    // Convert без явної комісії — вона зашита в курс: implicit fee = from − to×ринкова ціна
    const implicit = c.fromAmount.sub(c.toAmount.mul(c.mktPriceUsdt));
    return { fee: implicit.isNegative() ? new Decimal(0) : implicit, incomplete: false };
  }
  return { fee: null, incomplete: true };
}

// Вартість активів у USDT + залишок USDT; активи без ціни — у flag priceMissing.
function valueUsdt(
  conversions: CoreConversion[],
  leftoverUsdt: Decimal,
  prices: Map<string, Decimal>,
): { value: Decimal; priceMissing: boolean } {
  let value = leftoverUsdt;
  let priceMissing = false;
  for (const c of conversions) {
    const price = prices.get(c.toAsset);
    if (!price) {
      priceMissing = true;
      continue;
    }
    value = value.add(c.toAmount.mul(price));
  }
  return { value, priceMissing };
}

export function computeInvestmentPnl(
  order: CoreP2POrder,
  conversions: CoreConversion[],
  prices: Map<string, Decimal>,
  usdtUahNow: Decimal,
): InvestmentPnl {
  const contributionUah = order.fiatAmountUah;

  const spreadUnknown = order.marketRateUah === null;
  const spreadUah = spreadUnknown
    ? 0n
    : contributionUah - decToKopecks(order.assetQty.mul(order.marketRateUah!));

  let feesUahDec = new Decimal(0);
  let feesIncomplete = false;
  for (const c of conversions) {
    const { fee, incomplete } = convFeeUsdt(c);
    if (incomplete) {
      feesIncomplete = true;
      continue;
    }
    feesUahDec = feesUahDec.add(fee!.mul(c.usdtUahRate ?? usdtUahNow));
  }
  const feesUah = decToKopecks(feesUahDec);

  const spent = conversions.reduce((s, c) => s.add(c.fromAmount), new Decimal(0));
  const rawLeftover = order.assetQty.sub(order.commissionUsdt).sub(spent);
  const leftoverUsdt = rawLeftover.isNegative() ? new Decimal(0) : rawLeftover;

  const { value, priceMissing } = valueUsdt(conversions, leftoverUsdt, prices);
  const currentValueUah = decToKopecks(value.mul(usdtUahNow));

  const inputLossUah = spreadUah + feesUah;
  const effectiveInvestedUah = contributionUah - inputLossUah;
  const netProfitUah = currentValueUah - contributionUah;
  const grossProfitUah = currentValueUah - effectiveInvestedUah; // ≡ net + inputLoss

  return {
    contributionUah,
    spreadUah,
    feesUah,
    inputLossUah,
    effectiveInvestedUah,
    currentValueUah,
    netProfitUah,
    grossProfitUah,
    leftoverUsdt,
    flags: { spreadUnknown, feesIncomplete, priceMissing },
  };
}

// ─── Портфель ───

export interface AssetPosition {
  asset: string;
  qty: Decimal;
  priceUsdt: Decimal | null;
  valueUah: bigint;
}

export interface PortfolioTotals {
  contributionUah: bigint;
  effectiveInvestedUah: bigint;
  currentValueUah: bigint;
  netProfitUah: bigint;
  grossProfitUah: bigint;
  inputLossUah: bigint;
  spreadUah: bigint;
  feesUah: bigint;
}

export interface PortfolioFlags extends PnlFlags {
  untrackedUsdtSource: boolean;
}

export interface PortfolioInvestment<O extends CoreP2POrder, C extends CoreConversion> {
  order: O;
  conversions: C[];
  pnl: InvestmentPnl;
}

export interface Portfolio<O extends CoreP2POrder = CoreP2POrder, C extends CoreConversion = CoreConversion> {
  totals: PortfolioTotals;
  assets: AssetPosition[];
  investments: PortfolioInvestment<O, C>[];
  orphanConversions: C[];
  flags: PortfolioFlags;
}

export function computePortfolio<O extends CoreP2POrder, C extends CoreConversion>(
  orders: O[],
  conversions: C[],
  prices: Map<string, Decimal>,
  usdtUahNow: Decimal,
): Portfolio<O, C> {
  const byOrder = new Map<string, C[]>();
  const orphanConversions: C[] = [];
  for (const c of conversions) {
    // outOfTracking виграє навіть якщо p2pOrderId досі стоїть (сьогодні PATCH
    // це не дозволяє — обидва поля взаємовиключні, — але ядро саме мусить
    // тримати інваріант: позначена конвертація не рахує ні у витрати ордера,
    // ні в його fee/P&L, тож їй тут не місце.
    if (c.p2pOrderId && !c.outOfTracking) {
      const list = byOrder.get(c.p2pOrderId) ?? [];
      list.push(c);
      byOrder.set(c.p2pOrderId, list);
    } else {
      orphanConversions.push(c);
    }
  }

  const investments: PortfolioInvestment<O, C>[] = orders.map((order) => {
    const convs = byOrder.get(order.id) ?? [];
    return { order, conversions: convs, pnl: computeInvestmentPnl(order, convs, prices, usdtUahNow) };
  });

  // Позиції по активах — з УСІХ конверсій (включно з orphan)
  const qtyByAsset = new Map<string, Decimal>();
  for (const c of conversions) {
    qtyByAsset.set(c.toAsset, (qtyByAsset.get(c.toAsset) ?? new Decimal(0)).add(c.toAmount));
  }

  // Глобальний пул USDT: куплено (net комісій) мінус витрачено всіма конверсіями.
  // Відʼємний = конверсії витратили USDT поза затрекуваною історією (старші 6 міс) → clamp + прапорець.
  const bought = orders.reduce((s, o) => s.add(o.assetQty).sub(o.commissionUsdt), new Decimal(0));
  // Позначені «поза трекінгом» витрати з пулу виключені: їхні USDT куплені до
  // того, як синк почав бачити історію, тож вимагати їх у пулі — вимагати
  // неможливого. Монети ці конвертації дають (див. qtyByAsset вище), витрату — ні.
  const spent = conversions.reduce((s, c) => (c.outOfTracking ? s : s.add(c.fromAmount)), new Decimal(0));
  const pool = bought.sub(spent);
  const untrackedUsdtSource = pool.isNegative();
  const usdtPool = untrackedUsdtSource ? new Decimal(0) : pool;

  let totalValueUsdt = usdtPool;
  let priceMissing = false;
  const assets: AssetPosition[] = [];
  for (const [asset, qty] of qtyByAsset) {
    const price = prices.get(asset) ?? null;
    if (price) totalValueUsdt = totalValueUsdt.add(qty.mul(price));
    else priceMissing = true;
    assets.push({
      asset,
      qty,
      priceUsdt: price,
      valueUah: price ? decToKopecks(qty.mul(price).mul(usdtUahNow)) : 0n,
    });
  }
  assets.push({
    asset: "USDT",
    qty: usdtPool,
    priceUsdt: new Decimal(1),
    valueUah: decToKopecks(usdtPool.mul(usdtUahNow)),
  });

  const contributionUah = orders.reduce((s, o) => s + o.fiatAmountUah, 0n);
  const spreadUah = investments.reduce((s, i) => s + i.pnl.spreadUah, 0n);
  const feesUah = investments.reduce((s, i) => s + i.pnl.feesUah, 0n);
  const inputLossUah = spreadUah + feesUah;
  const effectiveInvestedUah = contributionUah - inputLossUah;
  const currentValueUah = decToKopecks(totalValueUsdt.mul(usdtUahNow));
  const netProfitUah = currentValueUah - contributionUah;
  const grossProfitUah = currentValueUah - effectiveInvestedUah;

  return {
    totals: {
      contributionUah,
      effectiveInvestedUah,
      currentValueUah,
      netProfitUah,
      grossProfitUah,
      inputLossUah,
      spreadUah,
      feesUah,
    },
    assets,
    investments,
    orphanConversions,
    flags: {
      spreadUnknown: investments.some((i) => i.pnl.flags.spreadUnknown),
      feesIncomplete: investments.some((i) => i.pnl.flags.feesIncomplete),
      priceMissing: priceMissing || investments.some((i) => i.pnl.flags.priceMissing),
      untrackedUsdtSource,
    },
  };
}

// Звірка крипто-внеску з Mono-витратою: єдиний надійний сигнал — сума + час
// (Mono не віддає counterIban/name для P2P). Серед кандидатів із точно тією ж
// сумою у вікні ±windowMs повертаємо id найближчого за часом; інакше null.
export function pickMonoExpenseMatch(
  contribution: { amountUah: bigint; date: Date },
  candidates: { id: string; amount: bigint; time: Date }[],
  windowMs: number,
): string | null {
  const target = -contribution.amountUah; // витрата = від'ємна сума fiat-ноги
  const t0 = contribution.date.getTime();
  const matched = candidates
    .filter((c) => c.amount === target && Math.abs(c.time.getTime() - t0) <= windowMs)
    .sort((a, b) => Math.abs(a.time.getTime() - t0) - Math.abs(b.time.getTime() - t0));
  return matched[0]?.id ?? null;
}

// ─── Звірка затрекуваного портфеля з реальними балансами Binance ───

// Пороги: розбіжність вважається справжньою, лише якщо вона і дорога, і помітна.
// Комісії P2P, яких API не віддає, та пил від конверсій дають центові розходження —
// на залишку в чверть долара вони виглядають як 80% похибки, тож відносного порогу
// самого по собі мало.
const RECONCILE_MIN_DIFF_USDT = new Decimal(1); // дешевші розбіжності — пил
const RECONCILE_REL_TOLERANCE = new Decimal("0.05"); // 5% від більшої зі сторін

export type BalanceIssueKind = "UNTRACKED" | "SHORTFALL" | "SURPLUS";

export interface BalanceIssue {
  asset: string;
  kind: BalanceIssueKind;
  trackedQty: Decimal;
  actualQty: Decimal;
  diffValueUsdt: Decimal;
}

// Гаманці Binance в одну мапу актив → кількість. Simple Earn Flexible віддає
// позиції як LD-префікс (LDUSDT) — зводимо до базового активу, але лише коли
// залишок є серед відомих (інакше LDO перетворився б на «O»).
export function mergeWalletBalances(
  rows: { asset: string; qty: Decimal }[],
  knownAssets: Iterable<string> = [],
): Map<string, Decimal> {
  const known = new Set(knownAssets);
  const out = new Map<string, Decimal>();
  for (const r of rows) {
    if (r.qty.isZero() || r.qty.isNegative()) continue;
    const stripped = r.asset.startsWith("LD") ? r.asset.slice(2) : null;
    const asset = stripped && known.has(stripped) ? stripped : r.asset;
    out.set(asset, (out.get(asset) ?? new Decimal(0)).add(r.qty));
  }
  return out;
}

// Порівнює затрековані позиції з фактичними балансами. Повертає лише розбіжності,
// які варто показувати: оцінювані в USDT, дорожчі за RECONCILE_MIN_DIFF_USDT і
// більші за RECONCILE_REL_TOLERANCE. Активи без ціни пропускаємо — оцінити їх
// нічим, а гадати означає світити бейджем даремно.
// walletsPartial=true (частина гаманців недоступна) глушить SHORTFALL: «на Binance
// менше» тоді може означати просто непрочитаний гаманець.
export function reconcileBalances(opts: {
  tracked: { asset: string; qty: Decimal }[];
  actual: Map<string, Decimal>;
  prices: Map<string, Decimal>;
  walletsPartial?: boolean;
}): { mismatch: boolean; issues: BalanceIssue[] } {
  const { tracked, actual, prices, walletsPartial } = opts;
  const trackedQty = new Map(tracked.map((t) => [t.asset, t.qty]));
  const priceOf = (asset: string): Decimal | null =>
    asset === "USDT" ? new Decimal(1) : prices.get(asset) ?? null;

  const issues: BalanceIssue[] = [];
  for (const asset of new Set([...trackedQty.keys(), ...actual.keys()])) {
    const t = trackedQty.get(asset) ?? new Decimal(0);
    const a = actual.get(asset) ?? new Decimal(0);
    const diff = t.sub(a).abs();
    if (diff.isZero()) continue;

    const price = priceOf(asset);
    if (!price) continue; // нічим оцінити — не шумимо

    const diffValueUsdt = diff.mul(price);
    if (diffValueUsdt.lt(RECONCILE_MIN_DIFF_USDT)) continue;

    const larger = Decimal.max(t, a);
    if (larger.isZero() || diff.div(larger).lte(RECONCILE_REL_TOLERANCE)) continue;

    const kind: BalanceIssueKind = t.isZero() ? "UNTRACKED" : t.gt(a) ? "SHORTFALL" : "SURPLUS";
    if (kind === "SHORTFALL" && walletsPartial) continue;

    issues.push({ asset, kind, trackedQty: t, actualQty: a, diffValueUsdt });
  }

  issues.sort((x, y) => y.diffValueUsdt.cmp(x.diffValueUsdt));
  return { mismatch: issues.length > 0, issues };
}

// ─── Денна серія gross P&L («рух ринку») ───

export function dayKeyUTC(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export interface GrossSeriesPoint {
  date: string; // "YYYY-MM-DD" UTC
  grossUah: bigint;
}

// Відновлює по днях кількості активів і ефективний вхід; вартість — за денними
// close. Останній день (todayKey) оцінюється живими цінами, тож остання точка
// збігається з computePortfolio().totals.grossProfitUah (закріплено юнітом).
export function computeGrossSeries(
  orders: CoreP2POrder[],
  conversions: CoreConversion[],
  dailyByAsset: Map<string, Map<string, Decimal>>,
  dailyUsdtUah: Map<string, Decimal>,
  live: { byAsset: Map<string, Decimal>; usdtUah: Decimal },
  todayKey: string,
): GrossSeriesPoint[] {
  type Ev = { t: number; apply: () => void };
  let usdtPool = new Decimal(0);
  const qty = new Map<string, Decimal>();
  let effInvested = 0n;
  // Сума fee×rate по кожному ордеру, накопичена в Decimal — округлюємо ОКРЕМОЮ
  // дельтою при кожній події, як computeInvestmentPnl (сума-потім-round), інакше
  // 2+ конверсії на одному ордері можуть розійтись із computePortfolio на копійку.
  const feeAcc = new Map<string, Decimal>();

  const events: Ev[] = [];
  for (const o of orders) {
    events.push({
      t: o.tradeTime.getTime(),
      apply: () => {
        usdtPool = usdtPool.add(o.assetQty).sub(o.commissionUsdt);
        const spread = o.marketRateUah === null
          ? 0n
          : o.fiatAmountUah - decToKopecks(o.assetQty.mul(o.marketRateUah));
        effInvested += o.fiatAmountUah - spread;
      },
    });
  }
  for (const c of conversions) {
    events.push({
      t: c.tradeTime.getTime(),
      apply: () => {
        // Той самий виняток, що в computePortfolio: позначена конвертація дає
        // монети, але не витрачає затрекувані USDT. Без цього остання точка
        // серії розійшлася б із grossProfitUah на картці.
        if (!c.outOfTracking) usdtPool = usdtPool.sub(c.fromAmount);
        qty.set(c.toAsset, (qty.get(c.toAsset) ?? new Decimal(0)).add(c.toAmount));
        if (c.p2pOrderId) {
          const { fee } = convFeeUsdt(c);
          if (fee) {
            const prev = feeAcc.get(c.p2pOrderId) ?? new Decimal(0);
            const next = prev.add(fee.mul(c.usdtUahRate ?? live.usdtUah));
            feeAcc.set(c.p2pOrderId, next);
            effInvested -= decToKopecks(next) - decToKopecks(prev); // дельта округленої суми по ордеру
          }
        }
      },
    });
  }
  if (!events.length) return [];
  events.sort((a, b) => a.t - b.t);

  const DAY = 86_400_000;
  const firstDayMs = Math.floor(events[0].t / DAY) * DAY;
  const lastClose = new Map<string, Decimal>(); // carry-forward
  let lastUah: Decimal | null = null;
  const points: GrossSeriesPoint[] = [];

  let ei = 0;
  for (let ms = firstDayMs; ; ms += DAY) {
    const key = dayKeyUTC(ms);
    const isToday = key === todayKey;
    // застосувати всі події цього дня (і раніші)
    while (ei < events.length && dayKeyUTC(events[ei].t) <= key) events[ei++].apply();

    const uahRate: Decimal | null = isToday ? live.usdtUah : (dailyUsdtUah.get(key) ?? lastUah);
    if (uahRate) lastUah = uahRate;

    if (uahRate) {
      let valueUsdt = usdtPool.isNegative() ? new Decimal(0) : usdtPool;
      for (const [asset, q] of qty) {
        const close = isToday
          ? (live.byAsset.get(asset) ?? null) // сьогодні: лише жива ціна, без carry-forward — як computePortfolio
          : (dailyByAsset.get(asset)?.get(key) ?? lastClose.get(asset) ?? null);
        if (!close) continue; // priceMissing — актив пропускається, як у computePortfolio
        lastClose.set(asset, close);
        valueUsdt = valueUsdt.add(q.mul(close));
      }
      const valueUah = decToKopecks(valueUsdt.mul(uahRate));
      points.push({ date: key, grossUah: valueUah - effInvested });
    }

    if (key >= todayKey) break;
  }
  return points;
}

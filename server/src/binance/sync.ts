// Оркестрація синку Binance: бекфіл історії, enrichment курсів, звʼязування, авто-внески.
// Тонкий IO-шар — вся логіка в binanceCore.ts.
import { prisma } from "../db.js";
import { env } from "../env.js";
import { findCycleForDate } from "../mono/cycle.js";
import {
  groupConversions,
  isRelevantP2PRow,
  isRelevantSpotRow,
  mapConvertRow,
  mapP2PRow,
  mapSpotRow,
  pickMonoExpenseMatch,
  planWindows,
} from "./binanceCore.js";
import {
  BinanceClient,
  BinanceError,
  binanceConfigured,
  getBinanceClient,
} from "./client.js";
import { klineCloseAt } from "./rates.js";

const DAY_MS = 24 * 3_600_000;
const HISTORY_MS = 180 * DAY_MS; // P2P API віддає максимум 6 місяців
const OVERLAP_MS = 3 * DAY_MS; // перекриття з минулим синком — дедуп по unique ключах
const CONVERT_PAUSE_MS = 1500; // tradeFlow важкий (UID 3000) — пауза між вікнами

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

let syncing = false;
let restrictionsOkAt = 0;

// Лінія відліку: угоди раніше BINANCE_SYNC_FROM не імпортуються
// (аналог tracking-start для Mono-транзакцій).
function syncFloorMs(): number {
  if (!env.binance.syncFrom) return 0;
  const t = Date.parse(env.binance.syncFrom);
  return Number.isNaN(t) ? 0 : t;
}

export function isSyncing(): boolean {
  return syncing;
}

// Fail-fast, якщо ключ має зайві права. Успіх кешується на 24 години.
export async function assertReadOnlyKey(client: BinanceClient): Promise<void> {
  if (Date.now() - restrictionsOkAt < DAY_MS) return;
  const r = await client.getApiRestrictions();
  if (r.enableWithdrawals || r.enableSpotAndMarginTrading) {
    throw new BinanceError(
      "Binance API ключ має права на торгівлю/виведення — потрібен ключ лише з Enable Reading",
      0,
    );
  }
  if (r.enableReading === false) {
    throw new BinanceError("Binance API ключ без Enable Reading", 0);
  }
  restrictionsOkAt = Date.now();
}

async function syncP2P(client: BinanceClient, now: number, full?: boolean) {
  const latest = await prisma.cryptoP2POrder.aggregate({ _max: { tradeTime: true } });
  const from = Math.max(
    syncFloorMs(),
    !full && latest._max.tradeTime
      ? latest._max.tradeTime.getTime() - OVERLAP_MS
      : now - HISTORY_MS,
  );

  for (const w of planWindows(from, now)) {
    try {
      for (let page = 1; ; page += 1) {
        const res = await client.getP2PBuyHistory({
          startTimestamp: w.start,
          endTimestamp: w.end,
          page,
        });
        const rows = res.data ?? [];
        for (const raw of rows.filter(isRelevantP2PRow)) {
          const m = mapP2PRow(raw);
          await prisma.cryptoP2POrder.upsert({
            where: { orderNumber: m.orderNumber },
            update: {},
            create: m,
          });
        }
        if (rows.length < 100) break;
      }
    } catch (e) {
      if (e instanceof BinanceError && e.httpStatus === 418) throw e;
      console.error(`[binance] P2P window ${new Date(w.start).toISOString()} failed:`, e);
    }
  }
}

async function syncConvert(client: BinanceClient, now: number, full?: boolean) {
  const latest = await prisma.cryptoConversion.aggregate({
    where: { source: "CONVERT" },
    _max: { tradeTime: true },
  });
  const from = Math.max(
    syncFloorMs(),
    !full && latest._max.tradeTime
      ? latest._max.tradeTime.getTime() - OVERLAP_MS
      : now - HISTORY_MS,
  );

  for (const w of planWindows(from, now)) {
    try {
      const res = await client.getConvertHistory({ startTime: w.start, endTime: w.end });
      const list = (res.list ?? []).filter(
        (r) => r.fromAsset === "USDT" && (r.orderStatus === undefined || r.orderStatus === "SUCCESS"),
      );
      if ((res.list ?? []).length === 1000) {
        console.warn("[binance] convert window hit 1000-row limit, можлива неповна історія");
      }
      for (const raw of list) {
        const m = mapConvertRow(raw);
        await prisma.cryptoConversion.upsert({
          where: { source_externalId: { source: m.source, externalId: m.externalId } },
          update: {},
          create: m,
        });
      }
    } catch (e) {
      if (e instanceof BinanceError && e.httpStatus === 418) throw e;
      console.error(`[binance] convert window ${new Date(w.start).toISOString()} failed:`, e);
    }
    await sleep(CONVERT_PAUSE_MS);
  }
}

async function syncSpot(client: BinanceClient) {
  for (const symbol of env.binance.spotSymbols) {
    try {
      const latest = await prisma.cryptoConversion.aggregate({
        where: { source: "SPOT", symbol },
        _max: { spotTradeId: true },
      });
      let fromId = latest._max.spotTradeId ? Number(latest._max.spotTradeId) + 1 : 0;

      for (;;) {
        const trades = await client.getMyTrades({ symbol, fromId });
        const floor = syncFloorMs();
        for (const raw of trades.filter((t) => isRelevantSpotRow(t, symbol) && t.time >= floor)) {
          const m = mapSpotRow(raw, symbol);
          await prisma.cryptoConversion.upsert({
            where: { source_externalId: { source: m.source, externalId: m.externalId } },
            update: {},
            create: m,
          });
        }
        if (trades.length < 1000) break;
        fromId = trades[trades.length - 1].id + 1;
      }
    } catch (e) {
      if (e instanceof BinanceError && e.httpStatus === 418) throw e;
      console.error(`[binance] spot ${symbol} failed:`, e);
    }
  }
}

// Заповнити відсутні курси/комісії (лише NULL-поля — ідемпотентно).
async function enrich() {
  const orders = await prisma.cryptoP2POrder.findMany({ where: { marketRateUah: null } });
  for (const o of orders) {
    const rate = await klineCloseAt("USDTUAH", o.tradeTime.getTime());
    if (rate) {
      await prisma.cryptoP2POrder.update({ where: { id: o.id }, data: { marketRateUah: rate } });
    }
  }

  const convs = await prisma.cryptoConversion.findMany({
    where: {
      OR: [{ usdtUahRate: null }, { mktPriceUsdt: null }, { feeUsdt: null }],
    },
  });
  for (const c of convs) {
    const t = c.tradeTime.getTime();
    const data: Record<string, unknown> = {};

    if (!c.usdtUahRate) {
      const r = await klineCloseAt("USDTUAH", t);
      if (r) data.usdtUahRate = r;
    }
    if (!c.mktPriceUsdt && c.source === "CONVERT") {
      const p = await klineCloseAt(`${c.toAsset}USDT`, t);
      if (p) data.mktPriceUsdt = p;
    }
    // Комісія в сторонньому активі (BNB тощо) — конвертуємо за курсом на момент угоди
    if (!c.feeUsdt && c.source === "SPOT" && c.feeAsset && !c.feeAmount.isZero()) {
      const p = await klineCloseAt(`${c.feeAsset}USDT`, t);
      if (p) data.feeUsdt = c.feeAmount.mul(p);
    }
    if (Object.keys(data).length) {
      await prisma.cryptoConversion.update({ where: { id: c.id }, data });
    }
  }
}

// Привʼязати нові конверсії до P2P-ордерів (24h-вікно, по залишку USDT).
async function group() {
  const orders = await prisma.cryptoP2POrder.findMany({ orderBy: { tradeTime: "asc" } });
  const conversions = await prisma.cryptoConversion.findMany({ orderBy: { tradeTime: "asc" } });
  const assignment = groupConversions(orders, conversions);
  for (const [convId, orderId] of assignment) {
    if (orderId) {
      await prisma.cryptoConversion.update({ where: { id: convId }, data: { p2pOrderId: orderId } });
    }
  }
}

// Авто-внесок «Крипта» на кожен P2P BUY — чекліст 65/25/10 закривається сам.
async function createContributions() {
  const orders = await prisma.cryptoP2POrder.findMany({ where: { contributionId: null } });
  for (const o of orders) {
    const cycle = await findCycleForDate(o.tradeTime);
    await prisma.$transaction(async (tx) => {
      const contribution = await tx.investmentContribution.create({
        data: {
          kind: "CRYPTO",
          source: "BINANCE",
          amountUah: o.fiatAmountUah,
          date: o.tradeTime,
          asset: o.asset,
          note: `Binance P2P #${o.orderNumber}`,
          cycleId: cycle?.id ?? null,
        },
      });
      await tx.cryptoP2POrder.update({
        where: { id: o.id },
        data: { contributionId: contribution.id },
      });
    });
  }
}

// Авто-звірка крипто-внесків із Mono-витратами (fiat-нога P2P-купівлі).
// Зв'язує за сумою+часом і виводить витрату з витрат/розгляду → INVESTMENT.
// Покриває й наявні внески без monoTxId (бекфіл). No-op без збігу.
const RECONCILE_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

async function reconcileMonoExpenses() {
  const contribs = await prisma.investmentContribution.findMany({
    where: { kind: "CRYPTO", monoTxId: null },
  });
  for (const c of contribs) {
    const from = new Date(c.date.getTime() - RECONCILE_WINDOW_MS);
    const to = new Date(c.date.getTime() + RECONCILE_WINDOW_MS);
    const cands = await prisma.transaction.findMany({
      where: { source: "MONO", amount: -c.amountUah, time: { gte: from, lte: to } },
      select: { id: true, amount: true, time: true },
    });
    if (cands.length === 0) continue;
    // не чіпати витрати, вже прив'язані до іншого внеску
    const linked = new Set(
      (await prisma.investmentContribution.findMany({
        where: { monoTxId: { in: cands.map((t) => t.id) } },
        select: { monoTxId: true },
      })).map((x) => x.monoTxId),
    );
    const free = cands.filter((t) => !linked.has(t.id));
    const matchId = pickMonoExpenseMatch({ amountUah: c.amountUah, date: c.date }, free, RECONCILE_WINDOW_MS);
    if (!matchId) continue;
    await prisma.$transaction([
      prisma.investmentContribution.update({ where: { id: c.id }, data: { monoTxId: matchId } }),
      prisma.transaction.update({ where: { id: matchId }, data: { envelope: "INVESTMENT", needsReview: false } }),
    ]);
  }
}

export interface SyncResult {
  p2pOrders: number;
  conversions: number;
}

// opts.client — інʼєкція для тестів (стаб історії; публічні klines/prices лишаються реальними)
export async function runSync(opts?: { full?: boolean; client?: BinanceClient }): Promise<SyncResult> {
  if (!opts?.client && !binanceConfigured()) throw new BinanceError("Binance не сконфігуровано", 0);
  if (syncing) throw new BinanceError("Синк уже виконується", 0);
  syncing = true;
  try {
    const client = opts?.client ?? getBinanceClient();
    await assertReadOnlyKey(client);
    const now = Date.now();

    await syncP2P(client, now, opts?.full);
    await syncConvert(client, now, opts?.full);
    await syncSpot(client);
    await enrich();
    await group();
    await createContributions();
    await reconcileMonoExpenses();

    await prisma.binanceSyncState.upsert({
      where: { id: 1 },
      update: { lastSyncAt: new Date(), lastError: null },
      create: { id: 1, lastSyncAt: new Date(), lastError: null },
    });
    return {
      p2pOrders: await prisma.cryptoP2POrder.count(),
      conversions: await prisma.cryptoConversion.count(),
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await prisma.binanceSyncState
      .upsert({
        where: { id: 1 },
        update: { lastError: message },
        create: { id: 1, lastError: message },
      })
      .catch(() => {});
    throw e;
  } finally {
    syncing = false;
  }
}

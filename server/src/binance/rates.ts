// Ринкові курси: історичні (klines) для спреду, поточні (ticker) для current value.
import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "../db.js";
import { BinanceError, binanceConfigured, getPublicBinanceClient } from "./client.js";
import { dayKeyUTC } from "./binanceCore.js";

const HOUR_MS = 3_600_000;
const PRICE_STALE_MS = 5 * 60_000;

// Кеш (symbol, година) → close; enrichment бекфілу бʼє в одні й ті самі свічки
const klineCache = new Map<string, Decimal | null>();

// Close 1h-свічки, що містить timeMs. null = свічки нема (пара не існувала/делістнута).
export async function klineCloseAt(symbol: string, timeMs: number): Promise<Decimal | null> {
  const bucket = Math.floor(timeMs / HOUR_MS) * HOUR_MS;
  const key = `${symbol}@${bucket}`;
  if (klineCache.has(key)) return klineCache.get(key)!;

  let close: Decimal | null = null;
  try {
    const klines = await getPublicBinanceClient().getKlines({
      symbol,
      interval: "1h",
      startTime: bucket,
      limit: 1,
    });
    const k = klines[0];
    if (k && k[0] === bucket) close = new Decimal(k[4]);
  } catch (e) {
    if (e instanceof BinanceError && e.httpStatus === 418) throw e;
    close = null; // невідома пара/помилка — спред просто не порахується
  }
  klineCache.set(key, close);
  return close;
}

// Оновити CryptoPrice для всіх утримуваних активів + USDTUAH.
export async function refreshCurrentPrices(): Promise<void> {
  if (!binanceConfigured()) return;

  const held = await prisma.cryptoConversion.findMany({
    select: { toAsset: true },
    distinct: ["toAsset"],
  });
  const symbols = [
    ...new Set([...held.map((h) => `${h.toAsset}USDT`), "USDTUAH"]),
  ].filter((s) => s !== "USDTUSDT");

  const prices = await getPublicBinanceClient().getPrices(symbols);
  for (const p of prices) {
    await prisma.cryptoPrice.upsert({
      where: { symbol: p.symbol },
      update: { price: new Decimal(p.price) },
      create: { symbol: p.symbol, price: new Decimal(p.price) },
    });
  }
}

export interface CurrentPrices {
  byAsset: Map<string, Decimal>; // ціна активу в USDT
  usdtUah: Decimal | null;
  asOf: Date | null;
}

// Прочитати останні ціни з БД; якщо застарілі — best-effort оновлення (stale ок).
export async function loadCurrentPrices(): Promise<CurrentPrices> {
  let rows = await prisma.cryptoPrice.findMany();
  const newest = rows.reduce<Date | null>(
    (m, r) => (m && m > r.updatedAt ? m : r.updatedAt),
    null,
  );
  if (binanceConfigured() && (!newest || Date.now() - newest.getTime() > PRICE_STALE_MS)) {
    try {
      await refreshCurrentPrices();
      rows = await prisma.cryptoPrice.findMany();
    } catch {
      // віддаємо що є, pricesAsOf покаже вік
    }
  }

  const byAsset = new Map<string, Decimal>();
  let usdtUah: Decimal | null = null;
  let asOf: Date | null = null;
  for (const r of rows) {
    if (r.symbol === "USDTUAH") usdtUah = r.price;
    else if (r.symbol.endsWith("USDT")) byAsset.set(r.symbol.slice(0, -4), r.price);
    if (!asOf || r.updatedAt > asOf) asOf = r.updatedAt;
  }
  return { byAsset, usdtUah, asOf };
}

// Денні close від fromMs (1 запит, ≤1000 свічок ≈ 2,7 роки). Кеш 1 год.
const dailyCache = new Map<string, { fetchedAt: number; map: Map<string, Decimal> }>();
const DAILY_LIMIT = 1000;

export async function dailyCloses(symbol: string, fromMs: number): Promise<Map<string, Decimal>> {
  const key = `${symbol}@${Math.floor(fromMs / 86_400_000)}`;
  const hit = dailyCache.get(key);
  if (hit && Date.now() - hit.fetchedAt < HOUR_MS) return hit.map;

  const map = new Map<string, Decimal>();
  try {
    const klines = await getPublicBinanceClient().getKlines({
      symbol,
      interval: "1d",
      startTime: fromMs,
      limit: DAILY_LIMIT,
    });
    for (const k of klines) map.set(dayKeyUTC(k[0]), new Decimal(k[4]));
  } catch (e) {
    if (e instanceof BinanceError && e.httpStatus === 418) throw e;
    // невідома пара/помилка — серія просто буде без цього активу
  }
  dailyCache.set(key, { fetchedAt: Date.now(), map });
  return map;
}

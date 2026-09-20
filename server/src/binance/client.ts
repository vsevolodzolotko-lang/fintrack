// Read-only клієнт Binance REST API. HMAC-SHA256 підпис, backoff на 429, abort на 418.
// Ключ має бути лише з "Enable Reading" — гард у sync.ts через getApiRestrictions().
import { createHmac } from "node:crypto";
import { env } from "../env.js";
import type { RawConvertRow, RawP2PRow, RawSpotTradeRow } from "./binanceCore.js";

const BASE = "https://api.binance.com";
const RECV_WINDOW = 10_000;
const MAX_ATTEMPTS = 3;

export class BinanceError extends Error {
  code?: number;
  httpStatus: number;

  constructor(message: string, httpStatus: number, code?: number) {
    super(message);
    this.name = "BinanceError";
    this.httpStatus = httpStatus;
    this.code = code;
  }
}

export function sign(secret: string, query: string): string {
  return createHmac("sha256", secret).update(query).digest("hex");
}

export interface BinanceConfig {
  apiKey: string;
  apiSecret: string;
  baseUrl?: string;
  sleep?: (ms: number) => Promise<void>;
}

export interface ApiRestrictions {
  enableReading?: boolean;
  enableWithdrawals?: boolean;
  enableSpotAndMarginTrading?: boolean;
  ipRestrict?: boolean;
  [k: string]: unknown;
}

export interface P2PHistoryResponse {
  code?: string;
  data?: RawP2PRow[];
  total?: number;
}

export interface ConvertHistoryResponse {
  list?: RawConvertRow[];
  startTime?: number;
  endTime?: number;
}

export interface AccountBalancesResponse {
  balances?: { asset: string; free: string; locked: string }[];
}

export interface FundingAsset {
  asset: string;
  free: string;
  locked?: string;
  freeze?: string;
  withdrawing?: string;
}

export interface TickerPrice {
  symbol: string;
  price: string;
}

// Kline: [openTime, open, high, low, close, volume, closeTime, ...]
export type Kline = [number, string, string, string, string, string, number, ...unknown[]];

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class BinanceClient {
  private timeOffset = 0;

  constructor(private cfg: BinanceConfig) {}

  private get base() {
    return this.cfg.baseUrl ?? BASE;
  }

  private async request<T>(
    path: string,
    params: Record<string, string | number | undefined>,
    signed: boolean,
    method: "GET" | "POST" = "GET",
  ): Promise<T> {
    let resyncedTime = false;

    for (let attempt = 1; ; attempt += 1) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined) qs.set(k, String(v));
      }
      if (signed) {
        qs.set("recvWindow", String(RECV_WINDOW));
        qs.set("timestamp", String(Date.now() + this.timeOffset));
        qs.set("signature", sign(this.cfg.apiSecret, qs.toString()));
      }
      const query = qs.toString();
      // Binance приймає параметри в query-string і для POST — тіло не потрібне.
      const url = `${this.base}${path}${query ? `?${query}` : ""}`;
      const res = await fetch(url, {
        method,
        headers: signed ? { "X-MBX-APIKEY": this.cfg.apiKey } : undefined,
      });

      if (res.ok) return (await res.json()) as T;

      const body = (await res.json().catch(() => ({}))) as { code?: number; msg?: string };

      if (res.status === 418) {
        throw new BinanceError(`Binance IP ban: ${body.msg ?? ""}`, 418, body.code);
      }
      if (res.status === 429 && attempt < MAX_ATTEMPTS) {
        const retryAfter = Number(res.headers.get("Retry-After")) || 0;
        const backoff = Math.max(retryAfter * 1000, 1000 * 2 ** (attempt - 1));
        await (this.cfg.sleep ?? defaultSleep)(backoff);
        continue;
      }
      if (body.code === -1021 && !resyncedTime) {
        // Годинник розʼїхався з сервером — ресинк і один повтор
        const { serverTime } = (await fetch(`${this.base}/api/v3/time`).then((r) =>
          r.json(),
        )) as { serverTime: number };
        this.timeOffset = serverTime - Date.now();
        resyncedTime = true;
        continue;
      }
      throw new BinanceError(
        `Binance API ${res.status}${body.code ? ` [${body.code}]` : ""}: ${body.msg ?? ""}`,
        res.status,
        body.code,
      );
    }
  }

  getApiRestrictions(): Promise<ApiRestrictions> {
    return this.request("/sapi/v1/account/apiRestrictions", {}, true);
  }

  // Історія P2P-покупок. Вікно ≤30 днів, rows ≤100, історія доступна лише за 6 місяців.
  getP2PBuyHistory(opts: {
    startTimestamp?: number;
    endTimestamp?: number;
    page?: number;
  }): Promise<P2PHistoryResponse> {
    return this.request(
      "/sapi/v1/c2c/orderMatch/listUserOrderHistory",
      { tradeType: "BUY", rows: 100, ...opts },
      true,
    );
  }

  // Історія Binance Convert. startTime/endTime обовʼязкові, вікно ≤30 днів. Вага UID 3000.
  getConvertHistory(opts: {
    startTime: number;
    endTime: number;
    limit?: number;
  }): Promise<ConvertHistoryResponse> {
    return this.request("/sapi/v1/convert/tradeFlow", { limit: 1000, ...opts }, true);
  }

  // Спот-угоди по символу. Бекфіл — курсором fromId (вікно startTime+endTime обмежене 24h).
  getMyTrades(opts: { symbol: string; fromId?: number; limit?: number }): Promise<RawSpotTradeRow[]> {
    return this.request("/api/v3/myTrades", { limit: 1000, ...opts }, true);
  }

  getAccountBalances(): Promise<AccountBalancesResponse> {
    return this.request("/api/v3/account", { omitZeroBalances: "true" }, true);
  }

  // Funding-гаманець — саме туди P2P зачисляє куплене; у /api/v3/account його немає.
  getFundingBalances(): Promise<FundingAsset[]> {
    return this.request("/sapi/v1/asset/get-funding-asset", {}, true, "POST");
  }

  getPrices(symbols: string[]): Promise<TickerPrice[]> {
    return this.request("/api/v3/ticker/price", { symbols: JSON.stringify(symbols) }, false);
  }

  getKlines(opts: {
    symbol: string;
    interval: string;
    startTime?: number;
    limit?: number;
  }): Promise<Kline[]> {
    return this.request("/api/v3/klines", { ...opts }, false);
  }
}

export function binanceConfigured(): boolean {
  return Boolean(env.binance.apiKey && env.binance.apiSecret);
}

let singleton: BinanceClient | null = null;

export function getBinanceClient(): BinanceClient {
  if (!binanceConfigured()) {
    throw new BinanceError("Binance API не сконфігуровано (BINANCE_API_KEY/SECRET)", 0);
  }
  singleton ??= new BinanceClient({ apiKey: env.binance.apiKey, apiSecret: env.binance.apiSecret });
  return singleton;
}

// Для публічних endpoint-ів (klines, ticker) — працює і без ключів.
export function getPublicBinanceClient(): BinanceClient {
  if (binanceConfigured()) return getBinanceClient();
  singleton ??= new BinanceClient({ apiKey: "", apiSecret: "" });
  return singleton;
}

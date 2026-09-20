import { afterEach, describe, expect, it, vi } from "vitest";
import { BinanceClient, BinanceError, sign } from "./client.js";

// Канонічний вектор з офіційної документації Binance (SIGNED endpoint example)
const DOC_SECRET = "NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j";
const DOC_QUERY =
  "symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559";
const DOC_SIG = "c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71";

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function makeClient(fetchMock: typeof fetch) {
  vi.stubGlobal("fetch", fetchMock);
  return new BinanceClient({
    apiKey: "test-key",
    apiSecret: DOC_SECRET,
    sleep: async () => {}, // без реальних пауз у тестах
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("sign", () => {
  it("reproduces the official docs HMAC-SHA256 vector", () => {
    expect(sign(DOC_SECRET, DOC_QUERY)).toBe(DOC_SIG);
  });
});

describe("BinanceClient", () => {
  it("sends X-MBX-APIKEY and appends timestamp + signature to signed requests", async () => {
    const calls: { url: string; headers: Headers }[] = [];
    const client = makeClient(async (input, init) => {
      calls.push({ url: String(input), headers: new Headers(init?.headers) });
      return jsonResponse({ enableReading: true });
    });

    await client.getApiRestrictions();

    expect(calls).toHaveLength(1);
    const url = new URL(calls[0].url);
    expect(url.pathname).toBe("/sapi/v1/account/apiRestrictions");
    expect(url.searchParams.get("timestamp")).toMatch(/^\d+$/);
    expect(url.searchParams.get("recvWindow")).toBe("10000");
    const sig = url.searchParams.get("signature")!;
    const query = url.search.slice(1).replace(/&signature=[0-9a-f]+$/, "");
    expect(sig).toBe(sign(DOC_SECRET, query));
    expect(calls[0].headers.get("X-MBX-APIKEY")).toBe("test-key");
  });

  it("does not sign public endpoints", async () => {
    const calls: string[] = [];
    const client = makeClient(async (input) => {
      calls.push(String(input));
      return jsonResponse([{ symbol: "USDTUAH", price: "43.00" }]);
    });

    await client.getPrices(["USDTUAH"]);
    expect(calls[0]).not.toContain("signature=");
    expect(calls[0]).toContain(encodeURIComponent('["USDTUAH"]'));
  });

  it("retries on 429 with backoff, then succeeds", async () => {
    let n = 0;
    const client = makeClient(async () => {
      n += 1;
      if (n < 3) return jsonResponse({ code: -1003, msg: "Too much weight" }, 429);
      return jsonResponse([]);
    });

    await expect(client.getMyTrades({ symbol: "BTCUSDT" })).resolves.toEqual([]);
    expect(n).toBe(3);
  });

  it("gives up after max retries on persistent 429", async () => {
    const client = makeClient(async () => jsonResponse({ code: -1003, msg: "banned soon" }, 429));
    await expect(client.getMyTrades({ symbol: "BTCUSDT" })).rejects.toThrow(BinanceError);
  });

  it("resyncs server time and retries once on -1021", async () => {
    let n = 0;
    let timeCalled = false;
    const client = makeClient(async (input) => {
      const url = String(input);
      if (url.includes("/api/v3/time")) {
        timeCalled = true;
        return jsonResponse({ serverTime: Date.now() + 12_000 });
      }
      n += 1;
      if (n === 1)
        return jsonResponse({ code: -1021, msg: "Timestamp outside of recvWindow" }, 400);
      return jsonResponse({ balances: [] });
    });

    await expect(client.getAccountBalances()).resolves.toEqual({ balances: [] });
    expect(timeCalled).toBe(true);
    expect(n).toBe(2);
  });

  it("aborts immediately on 418 (IP ban) without retrying", async () => {
    let n = 0;
    const client = makeClient(async () => {
      n += 1;
      return jsonResponse({ code: -1003, msg: "banned" }, 418);
    });

    await expect(client.getMyTrades({ symbol: "BTCUSDT" })).rejects.toMatchObject({
      httpStatus: 418,
    });
    expect(n).toBe(1);
  });

  it("surfaces Binance error code and message", async () => {
    const client = makeClient(async () =>
      jsonResponse({ code: -2015, msg: "Invalid API-key, IP, or permissions for action." }, 401),
    );
    await expect(client.getApiRestrictions()).rejects.toMatchObject({
      code: -2015,
      httpStatus: 401,
    });
  });
});

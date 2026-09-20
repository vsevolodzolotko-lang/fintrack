import { describe, expect, it } from "vitest";
import { Decimal } from "@prisma/client/runtime/library";
import {
  candidateOrders,
  computeGrossSeries,
  computeInvestmentPnl,
  computePortfolio,
  dayKeyUTC,
  decToKopecks,
  groupConversions,
  orderRemaining,
  isRelevantP2PRow,
  isRelevantSpotRow,
  mapConvertRow,
  mapP2PRow,
  mapSpotRow,
  mergeWalletBalances,
  pickMonoExpenseMatch,
  planWindows,
  reconcileBalances,
  uahToKopecks,
  type CoreConversion,
  type CoreP2POrder,
} from "./binanceCore.js";

const D = (s: string | number) => new Decimal(s);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 5, 1, 10, 0, 0); // 2026-06-01T10:00Z

function order(over: Partial<CoreP2POrder> = {}): CoreP2POrder {
  return {
    id: "o1",
    orderNumber: "20512345",
    assetQty: D("40.35"),
    fiatAmountUah: 1806_00n,
    commissionUsdt: D(0),
    tradeTime: new Date(T0),
    marketRateUah: D("42.00"),
    ...over,
  };
}

function conv(over: Partial<CoreConversion> = {}): CoreConversion {
  return {
    id: "c1",
    source: "SPOT",
    fromAmount: D("40"),
    toAsset: "BTC",
    toAmount: D("0.00040000"),
    feeUsdt: D("0.04"),
    mktPriceUsdt: D("100000"),
    usdtUahRate: D("42.00"),
    tradeTime: new Date(T0 + HOUR),
    p2pOrderId: null,
    ...over,
  };
}

describe("uahToKopecks", () => {
  it("parses decimal strings via string math", () => {
    expect(uahToKopecks("1806.00")).toBe(1806_00n);
    expect(uahToKopecks("44.75")).toBe(44_75n);
    expect(uahToKopecks("100")).toBe(100_00n);
    expect(uahToKopecks("0.5")).toBe(50n);
  });

  it("rounds sub-kopeck digits half-up", () => {
    expect(uahToKopecks("1.005")).toBe(101n);
    expect(uahToKopecks("1.004")).toBe(100n);
  });

  it("throws on malformed input", () => {
    expect(() => uahToKopecks("")).toThrow();
    expect(() => uahToKopecks("abc")).toThrow();
    expect(() => uahToKopecks("1,5")).toThrow();
  });
});

describe("decToKopecks", () => {
  it("rounds once at the kopeck boundary", () => {
    expect(decToKopecks(D("1806.004"))).toBe(1806_00n);
    expect(decToKopecks(D("1806.005"))).toBe(1806_01n);
    expect(decToKopecks(D("-3.005"))).toBe(-3_01n); // half away from zero
  });
});

describe("planWindows", () => {
  it("splits a range into ≤30-day windows covering the whole span", () => {
    const w = planWindows(0, 75 * DAY);
    expect(w).toEqual([
      { start: 0, end: 30 * DAY },
      { start: 30 * DAY, end: 60 * DAY },
      { start: 60 * DAY, end: 75 * DAY },
    ]);
  });

  it("single window when span fits", () => {
    expect(planWindows(T0, T0 + DAY)).toEqual([{ start: T0, end: T0 + DAY }]);
  });

  it("empty when from >= to", () => {
    expect(planWindows(T0, T0)).toEqual([]);
  });
});

describe("P2P mapping", () => {
  const raw = {
    orderNumber: "20512345",
    advNo: "11",
    tradeType: "BUY",
    asset: "USDT",
    fiat: "UAH",
    fiatSymbol: "₴",
    amount: "40.35",
    totalPrice: "1806.00",
    unitPrice: "44.75",
    orderStatus: "COMPLETED",
    createTime: T0,
    commission: "0.05",
    counterPartNickName: "seller1",
  };

  it("filters to completed UAH buys only", () => {
    expect(isRelevantP2PRow(raw)).toBe(true);
    expect(isRelevantP2PRow({ ...raw, orderStatus: "CANCELLED" })).toBe(false);
    expect(isRelevantP2PRow({ ...raw, fiat: "EUR" })).toBe(false);
    expect(isRelevantP2PRow({ ...raw, tradeType: "SELL" })).toBe(false);
  });

  it("maps amounts: fiat → kopecks, qty/commission → Decimal", () => {
    const m = mapP2PRow(raw);
    expect(m.orderNumber).toBe("20512345");
    expect(m.fiatAmountUah).toBe(1806_00n);
    expect(m.assetQty.toFixed(8)).toBe("40.35000000");
    expect(m.unitPriceUah.toString()).toBe("44.75");
    expect(m.commissionUsdt.toString()).toBe("0.05");
    expect(m.counterparty).toBe("seller1");
    expect(m.tradeTime.getTime()).toBe(T0);
  });
});

describe("Convert mapping", () => {
  it("maps tradeFlow row with implicit fee left for enrichment", () => {
    const m = mapConvertRow({
      quoteId: "q",
      orderId: 987654,
      orderStatus: "SUCCESS",
      fromAsset: "USDT",
      fromAmount: "150.5",
      toAsset: "ETH",
      toAmount: "0.042",
      ratio: "0.000279",
      inverseRatio: "3583.3",
      createTime: T0,
    });
    expect(m.source).toBe("CONVERT");
    expect(m.externalId).toBe("987654");
    expect(m.fromAmount.toString()).toBe("150.5");
    expect(m.toAmount.toString()).toBe("0.042");
    expect(m.feeUsdt).toBeNull();
    expect(m.mktPriceUsdt).toBeNull();
  });
});

describe("Spot mapping", () => {
  const raw = {
    id: 123456,
    orderId: 1,
    price: "100000.00",
    qty: "0.00040000",
    quoteQty: "40.00",
    commission: "0.00000040",
    commissionAsset: "BTC",
    time: T0,
    isBuyer: true,
    isMaker: false,
  };

  it("keeps only buys on USDT-quoted pairs", () => {
    expect(isRelevantSpotRow(raw, "BTCUSDT")).toBe(true);
    expect(isRelevantSpotRow({ ...raw, isBuyer: false }, "BTCUSDT")).toBe(false);
    expect(isRelevantSpotRow(raw, "BTCEUR")).toBe(false);
  });

  it("nets commission from toAmount when fee is in base asset, converts fee to USDT at trade price", () => {
    const m = mapSpotRow(raw, "BTCUSDT");
    expect(m.source).toBe("SPOT");
    expect(m.externalId).toBe("BTCUSDT#123456");
    expect(m.spotTradeId).toBe(123456n);
    expect(m.toAsset).toBe("BTC");
    expect(m.toAmount.toFixed(8)).toBe("0.00039960"); // qty − fee(BTC)
    expect(m.fromAmount.toString()).toBe("40");
    expect(m.feeUsdt!.toFixed(2)).toBe("0.04"); // 0.0000004 × 100000
    expect(m.mktPriceUsdt!.toString()).toBe("100000");
  });

  it("fee in USDT passes through; fee in BNB left null for later enrichment", () => {
    const usdtFee = mapSpotRow({ ...raw, commission: "0.04", commissionAsset: "USDT" }, "BTCUSDT");
    expect(usdtFee.toAmount.toFixed(8)).toBe("0.00040000"); // qty не чіпається
    expect(usdtFee.feeUsdt!.toString()).toBe("0.04");

    const bnbFee = mapSpotRow({ ...raw, commission: "0.0001", commissionAsset: "BNB" }, "BTCUSDT");
    expect(bnbFee.feeUsdt).toBeNull();
    expect(bnbFee.feeAsset).toBe("BNB");
  });
});

describe("groupConversions", () => {
  it("attaches a conversion to the nearest preceding order within 24h", () => {
    const g = groupConversions([order()], [conv()]);
    expect(g.get("c1")).toBe("o1");
  });

  it("orphans conversions outside the window or before any order", () => {
    const g = groupConversions(
      [order()],
      [
        conv({ id: "late", tradeTime: new Date(T0 + DAY + HOUR) }),
        conv({ id: "before", tradeTime: new Date(T0 - HOUR) }),
      ],
    );
    expect(g.get("late")).toBeNull();
    expect(g.get("before")).toBeNull();
  });

  it("prefers the newest candidate order, falls back by remaining USDT capacity", () => {
    const o1 = order({ id: "o1", orderNumber: "1", assetQty: D("100"), tradeTime: new Date(T0) });
    const o2 = order({ id: "o2", orderNumber: "2", assetQty: D("50"), tradeTime: new Date(T0 + 2 * HOUR) });
    const g = groupConversions(
      [o1, o2],
      [
        conv({ id: "cA", fromAmount: D("50"), tradeTime: new Date(T0 + 3 * HOUR) }), // → o2 (новіший, вміщає)
        conv({ id: "cB", fromAmount: D("50"), tradeTime: new Date(T0 + 4 * HOUR) }), // o2 вичерпаний → o1
        conv({ id: "cC", fromAmount: D("60"), tradeTime: new Date(T0 + 5 * HOUR) }), // o1 лишилось 50 < 60 → orphan
      ],
    );
    expect(g.get("cA")).toBe("o2");
    expect(g.get("cB")).toBe("o1");
    expect(g.get("cC")).toBeNull();
  });

  it("allows ~0.5% dust tolerance over remaining capacity", () => {
    const g = groupConversions(
      [order({ assetQty: D("40") })],
      [conv({ fromAmount: D("40.1") })], // 40.1 ≤ 40 / 0.995
    );
    expect(g.get("c1")).toBe("o1");
  });

  it("keeps prior explicit assignments and their capacity effect", () => {
    const o1 = order({ assetQty: D("40") });
    const attached = conv({ id: "cOld", fromAmount: D("40"), p2pOrderId: "o1" });
    const g = groupConversions([o1], [attached, conv({ id: "cNew", fromAmount: D("30") })]);
    expect(g.has("cOld")).toBe(false); // вже привʼязана — не чіпаємо
    expect(g.get("cNew")).toBeNull(); // capacity o1 зʼїдена cOld
  });
});

describe("computeInvestmentPnl", () => {
  const prices = new Map([["BTC", D("105000")]]);
  const uahNow = D("43.00");

  it("computes net/gross/inputLoss with the identity net = gross − inputLoss", () => {
    const r = computeInvestmentPnl(order(), [conv({ p2pOrderId: "o1" })], prices, uahNow);
    // спред: 180600 − round(40.35 × 42.00 × 100) = 180600 − 169470 = 11130
    expect(r.spreadUah).toBe(111_30n);
    // комісія: 0.04 USDT × 42.00 = 1.68 грн
    expect(r.feesUah).toBe(1_68n);
    expect(r.inputLossUah).toBe(112_98n);
    expect(r.effectiveInvestedUah).toBe(1806_00n - 112_98n);
    // value: 0.0004 BTC × 105000 = 42 USDT; leftover 40.35 − 40 = 0.35 USDT; (42 + 0.35) × 43
    expect(r.currentValueUah).toBe(decToKopecks(D("42.35").mul(uahNow)));
    expect(r.netProfitUah).toBe(r.currentValueUah - 1806_00n);
    expect(r.grossProfitUah - r.inputLossUah).toBe(r.netProfitUah);
    expect(r.flags).toEqual({ spreadUnknown: false, feesIncomplete: false, priceMissing: false });
  });

  it("USDT-only investment (no conversions) values the leftover", () => {
    const r = computeInvestmentPnl(order(), [], prices, uahNow);
    expect(r.leftoverUsdt.toString()).toBe("40.35");
    expect(r.currentValueUah).toBe(decToKopecks(D("40.35").mul(uahNow)));
    expect(r.feesUah).toBe(0n);
  });

  it("null market rate → spreadUnknown, spread treated as 0, identity preserved", () => {
    const r = computeInvestmentPnl(order({ marketRateUah: null }), [conv()], prices, uahNow);
    expect(r.flags.spreadUnknown).toBe(true);
    expect(r.spreadUah).toBe(0n);
    expect(r.inputLossUah).toBe(r.feesUah);
    expect(r.grossProfitUah - r.inputLossUah).toBe(r.netProfitUah);
  });

  it("CONVERT implicit fee = (from − to×mktPrice) × usdtUahRate", () => {
    const c = conv({
      source: "CONVERT",
      fromAmount: D("42"),
      toAmount: D("0.00040000"),
      feeUsdt: null,
      mktPriceUsdt: D("104000"), // 0.0004 × 104000 = 41.6 → implicit fee 0.4 USDT
      usdtUahRate: D("42.00"),
    });
    const r = computeInvestmentPnl(order(), [c], prices, uahNow);
    expect(r.feesUah).toBe(decToKopecks(D("0.4").mul(D("42.00"))));
    expect(r.flags.feesIncomplete).toBe(false);
  });

  it("missing fee data (BNB без курсу) → feesIncomplete", () => {
    const r = computeInvestmentPnl(
      order(),
      [conv({ feeUsdt: null, mktPriceUsdt: null })],
      prices,
      uahNow,
    );
    expect(r.flags.feesIncomplete).toBe(true);
    expect(r.grossProfitUah - r.inputLossUah).toBe(r.netProfitUah);
  });

  it("missing price for toAsset → priceMissing, its value excluded", () => {
    const r = computeInvestmentPnl(order(), [conv({ toAsset: "SOL" })], new Map(), uahNow);
    expect(r.flags.priceMissing).toBe(true);
    // рахується лише leftover USDT
    expect(r.currentValueUah).toBe(decToKopecks(D("0.35").mul(uahNow)));
  });

  it("negative leftover clamps to zero", () => {
    const r = computeInvestmentPnl(
      order({ assetQty: D("30") }),
      [conv({ fromAmount: D("40") })],
      prices,
      uahNow,
    );
    expect(r.leftoverUsdt.toString()).toBe("0");
  });
});

describe("computePortfolio", () => {
  const prices = new Map([
    ["BTC", D("105000")],
    ["ETH", D("3500")],
  ]);
  const uahNow = D("43.00");

  it("aggregates positions, counts orphans, totals keep the identity", () => {
    const orders = [order()];
    const convs = [
      conv({ p2pOrderId: "o1" }),
      conv({
        id: "orphan",
        toAsset: "ETH",
        fromAmount: D("35"),
        toAmount: D("0.01"),
        tradeTime: new Date(T0 - 10 * DAY),
        p2pOrderId: null,
      }),
    ];
    const p = computePortfolio(orders, convs, prices, uahNow);

    const btc = p.assets.find((a) => a.asset === "BTC")!;
    expect(btc.qty.toFixed(8)).toBe("0.00040000");
    const eth = p.assets.find((a) => a.asset === "ETH")!;
    expect(eth.qty.toString()).toBe("0.01");

    // глобальний пул USDT: 40.35 − (40 + 35) < 0 → clamp + флаг
    const usdt = p.assets.find((a) => a.asset === "USDT")!;
    expect(usdt.qty.toString()).toBe("0");
    expect(p.flags.untrackedUsdtSource).toBe(true);

    expect(p.investments).toHaveLength(1);
    expect(p.orphanConversions).toHaveLength(1);
    expect(p.totals.netProfitUah).toBe(p.totals.grossProfitUah - p.totals.inputLossUah);
    // current value включає orphan ETH
    const expectedValue = decToKopecks(
      D("0.0004").mul(D("105000")).add(D("0.01").mul(D("3500"))).mul(uahNow),
    );
    expect(p.totals.currentValueUah).toBe(expectedValue);
  });

  it("positive leftover pool shows as USDT position without the flag", () => {
    const p = computePortfolio([order()], [conv({ p2pOrderId: "o1" })], prices, uahNow);
    const usdt = p.assets.find((a) => a.asset === "USDT")!;
    expect(usdt.qty.toString()).toBe("0.35");
    expect(p.flags.untrackedUsdtSource).toBe(false);
  });
});

describe("pickMonoExpenseMatch", () => {
  const DAY = 86_400_000;
  const contribution = { amountUah: 189_600n, date: new Date("2026-07-15T12:00:00Z") };

  it("matches an expense of exactly the fiat amount within the window", () => {
    const cands = [
      { id: "a", amount: -189_600n, time: new Date("2026-07-15T14:00:00Z") },
      { id: "b", amount: -50_000n, time: new Date("2026-07-15T12:30:00Z") },
    ];
    expect(pickMonoExpenseMatch(contribution, cands, 2 * DAY)).toBe("a");
  });

  it("prefers the nearest in time among equal-amount candidates", () => {
    const cands = [
      { id: "far", amount: -189_600n, time: new Date("2026-07-16T20:00:00Z") },
      { id: "near", amount: -189_600n, time: new Date("2026-07-15T11:00:00Z") },
    ];
    expect(pickMonoExpenseMatch(contribution, cands, 2 * DAY)).toBe("near");
  });

  it("ignores amount mismatches and out-of-window candidates", () => {
    const cands = [
      { id: "wrongAmt", amount: -189_500n, time: new Date("2026-07-15T12:00:00Z") },
      { id: "tooOld", amount: -189_600n, time: new Date("2026-07-10T12:00:00Z") },
    ];
    expect(pickMonoExpenseMatch(contribution, cands, 2 * DAY)).toBeNull();
  });

  it("returns null when there are no candidates", () => {
    expect(pickMonoExpenseMatch(contribution, [], 2 * DAY)).toBeNull();
  });
});

describe("computeGrossSeries", () => {
  const day = (k: string) => Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10), 10);

  it("dayKeyUTC — UTC-день", () => {
    expect(dayKeyUTC(Date.UTC(2026, 5, 1, 0, 0, 1))).toBe("2026-06-01");
    expect(dayKeyUTC(Date.UTC(2026, 5, 1, 23, 59, 59))).toBe("2026-06-01");
  });

  it("рахує gross по днях: комісія одразу, далі рух ринку", () => {
    // купив 40.35 USDT за 1806,00 (ринок 42.00 → спред 111,30);
    // конвертнув 20 USDT → 0.0004 BTC, fee 0.1 USDT (rate 42 → 4,20 грн)
    const o = order({ tradeTime: new Date(day("2026-06-01")) }); // 1806_00n, qty 40.35, mkt 42
    const c: CoreConversion = {
      id: "c1", source: "SPOT", fromAmount: D(20), toAsset: "BTC", toAmount: D("0.0004"),
      feeUsdt: D("0.1"), mktPriceUsdt: D(50_000), usdtUahRate: D(42),
      tradeTime: new Date(day("2026-06-01")), p2pOrderId: "o1",
    };
    const btc = new Map([["2026-06-01", D(50_000)], ["2026-06-02", D(60_000)]]);
    const uah = new Map([["2026-06-01", D(42)], ["2026-06-02", D(42)]]);
    const live = { byAsset: new Map([["BTC", D(60_000)]]), usdtUah: D(42) };

    const s = computeGrossSeries([o], [c], new Map([["BTC", btc]]), uah, live, "2026-06-03");
    // effInvested = 1806,00 − 111,30 (спред) − 4,20 (fee) = 1690,50
    // день1: value = (20.35 + 0.0004×50000)×42 = 40.35×42 = 1694,70 → gross 4,20 (комісія «повертається» в gross)
    expect(s[0]).toEqual({ date: "2026-06-01", grossUah: 4_20n });
    // день2: BTC 60000 → value = (20.35+24)×42 = 1862,70 → gross 172,20
    expect(s[1]).toEqual({ date: "2026-06-02", grossUah: 172_20n });
    // день3 (сьогодні): живі ціни ті самі, carry-forward не потрібен
    expect(s[2]).toEqual({ date: "2026-06-03", grossUah: 172_20n });
  });

  it("carry-forward close і пропуск активу без жодної ціни", () => {
    // order 1806,00 / 40.35 USDT / mkt 42 → effInvested = 1806,00 − 111,30 = 1694,70 (169470n),
    // фіксовано на весь тест (обидві конверсії з fee 0).
    // conv1: 20 USDT → 0.0004 BTC; conv2: 5 USDT → 1 XXX (ціни на XXX нема НІКОЛИ).
    const o = order({ tradeTime: new Date(day("2026-06-01")) });
    const c1: CoreConversion = { id: "c1", source: "SPOT", fromAmount: D(20), toAsset: "BTC", toAmount: D("0.0004"), feeUsdt: D(0), mktPriceUsdt: null, usdtUahRate: D(42), tradeTime: new Date(day("2026-06-01")), p2pOrderId: "o1" };
    const c2: CoreConversion = { id: "c2", source: "SPOT", fromAmount: D(5), toAsset: "XXX", toAmount: D(1), feeUsdt: D(0), mktPriceUsdt: null, usdtUahRate: D(42), tradeTime: new Date(day("2026-06-01")), p2pOrderId: "o1" };
    // close є лише на 06-01; 06-02 навмисно відсутній, а todayKey — аж 06-03,
    // тож 06-02 обробляється ІСТОРИЧНОЮ гілкою і мусить занести carry-forward 50000.
    const btc = new Map([["2026-06-01", D(50_000)]]);
    const uah = new Map([["2026-06-01", D(42)], ["2026-06-02", D(42)]]);
    // сьогоднішня жива ціна навмисно ІНША за історичні closes — щоб гілки не могли випадково збігтись.
    const live = { byAsset: new Map([["BTC", D(55_000)]]), usdtUah: D(42) };
    const s = computeGrossSeries([o], [c1, c2], new Map([["BTC", btc]]), uah, live, "2026-06-03");

    expect(s).toHaveLength(3);
    // пул після подій дня1: 40.35 − 20 − 5 = 15.35 USDT; qty BTC 0.0004, XXX 1 (без ціни — ігнорується)
    // день1 (історична гілка): close BTC = 50000 (явний) → (15.35 + 0.0004×50000)×42 = 35.35×42 = 1484,70 → 148470n
    // gross = 148470 − 169470 = −21000n (−210,00 грн — XXX з'їв 5 USDT без жодної ціни)
    expect(s[0]).toEqual({ date: "2026-06-01", grossUah: -210_00n });
    // день2 (історична гілка): close BTC відсутній у мапі → carry-forward 50000 (той самий вхід, що й день1)
    expect(s[1]).toEqual({ date: "2026-06-02", grossUah: -210_00n });
    // день3 (сьогодні): жива ціна BTC 55000 (без carry-forward) → (15.35 + 0.0004×55000)×42 = 37.35×42 = 1568,70 → 156870n
    // gross = 156870 − 169470 = −12600n
    expect(s[2]).toEqual({ date: "2026-06-03", grossUah: -126_00n });
  });

  it("сьогодні: утриманий актив без живої ціни пропускається (priceMissing), а не carry-forward зі вчора", () => {
    // BTC мав close вчора (50000, потрапив у lastClose), але сьогоднішній live-фід
    // його не віддав — має збігтись із computePortfolio (актив виключено), а не
    // тягнути вчорашній close, ніби нічого не змінилось.
    const o = order({ tradeTime: new Date(day("2026-06-01")) });
    const c: CoreConversion = { id: "c1", source: "SPOT", fromAmount: D(20), toAsset: "BTC", toAmount: D("0.0004"), feeUsdt: D(0), mktPriceUsdt: null, usdtUahRate: D(42), tradeTime: new Date(day("2026-06-01")), p2pOrderId: "o1" };
    const btc = new Map([["2026-06-01", D(50_000)]]);
    const uah = new Map([["2026-06-01", D(42)]]);
    const live = { byAsset: new Map<string, Decimal>(), usdtUah: D(42) }; // BTC відсутній у сьогоднішньому live-фіді
    const s = computeGrossSeries([o], [c], new Map([["BTC", btc]]), uah, live, "2026-06-02");
    const p = computePortfolio([o], [c], live.byAsset, live.usdtUah);

    expect(s).toHaveLength(2);
    expect(s[0]).toEqual({ date: "2026-06-01", grossUah: 0n }); // день купівлі — рух ринку ще нульовий
    expect(s[1].date).toBe("2026-06-02");
    expect(s[1].grossUah).toBe(p.totals.grossProfitUah); // сьогодні = computePortfolio (BTC виключено, без carry-forward)
  });

  it("ІНВАРІАНТ (стрес): 2 конверсії на одному ордері з fee рівно 0,005₴ кожна — sum-then-round", () => {
    // Округлення 0,005₴×2 «наосліп» по конверсії дало б 1коп+1коп=2коп; правильно — 1коп
    // (0,005+0,005=0,01₴ округлено ОДИН раз). Якщо computeGrossSeries округлює commit
    // per-conversion замість per-order, ця точка розійдеться з computePortfolio.
    const o = order({ tradeTime: new Date(day("2026-06-01")) });
    const mkConv = (id: string): CoreConversion => ({
      id, source: "SPOT", fromAmount: D(10), toAsset: "BTC", toAmount: D("0.0002"),
      feeUsdt: D("0.00025"), mktPriceUsdt: D(50_000), usdtUahRate: D(20),
      tradeTime: new Date(day("2026-06-01")), p2pOrderId: "o1",
    });
    const c1 = mkConv("c1");
    const c2 = mkConv("c2");
    const live = { byAsset: new Map([["BTC", D(50_000)]]), usdtUah: D(20) };

    const s = computeGrossSeries([o], [c1, c2], new Map(), new Map(), live, "2026-06-01");
    const p = computePortfolio([o], [c1, c2], live.byAsset, live.usdtUah);

    expect(s).toHaveLength(1);
    expect(s[0].grossUah).toBe(p.totals.grossProfitUah);
  });

  it("ІНВАРІАНТ: остання точка = computePortfolio().totals.grossProfitUah", () => {
    const o = order({ tradeTime: new Date(day("2026-06-01")) });
    const c: CoreConversion = { id: "c1", source: "SPOT", fromAmount: D(20), toAsset: "BTC", toAmount: D("0.0004"), feeUsdt: D("0.1"), mktPriceUsdt: D(50_000), usdtUahRate: D(42), tradeTime: new Date(day("2026-06-01")), p2pOrderId: "o1" };
    const live = { byAsset: new Map([["BTC", D(57_321)]]), usdtUah: D("41.87") };
    const s = computeGrossSeries([o], [c], new Map([["BTC", new Map([["2026-06-01", D(50_000)]])]]), new Map([["2026-06-01", D(42)]]), live, "2026-06-02");
    const p = computePortfolio([o], [c], live.byAsset, live.usdtUah);
    expect(s[s.length - 1].grossUah).toBe(p.totals.grossProfitUah);
  });

  it("порожні вхідні → порожня серія", () => {
    expect(computeGrossSeries([], [], new Map(), new Map(), { byAsset: new Map(), usdtUah: D(42) }, "2026-06-01")).toEqual([]);
  });

  it("ІНВАРІАНТ тримається і з позначеною конвертацією", () => {
    const o = order({ id: "o1", assetQty: D("100"), fiatAmountUah: 4_000_00n, tradeTime: new Date(day("2026-06-01")) });
    const tracked: CoreConversion = {
      id: "c1", source: "SPOT", fromAmount: D("100"), toAsset: "BTC", toAmount: D("0.001"),
      feeUsdt: D(0), mktPriceUsdt: D(60_000), usdtUahRate: D(41),
      tradeTime: new Date(day("2026-06-01")), p2pOrderId: "o1",
    };
    const marked: CoreConversion = {
      id: "c2", source: "SPOT", fromAmount: D("50"), toAsset: "ETH", toAmount: D("0.02"),
      feeUsdt: D(0), mktPriceUsdt: D(3_000), usdtUahRate: D(41),
      tradeTime: new Date(day("2026-06-02")), p2pOrderId: null, outOfTracking: true,
    };
    const live = { byAsset: new Map([["BTC", D(60_000)], ["ETH", D(3_000)]]), usdtUah: D(41) };

    const s = computeGrossSeries([o], [tracked, marked], new Map(), new Map(), live, "2026-06-02");
    const p = computePortfolio([o], [tracked, marked], live.byAsset, live.usdtUah);
    expect(s[s.length - 1].grossUah).toBe(p.totals.grossProfitUah);
  });
});

describe("outOfTracking: конвертація поза вікном історії", () => {
  // Куплено 100 USDT, витрачено 150: 50 із них — із давніших покупок,
  // яких синк уже не бачить. Саме цей випадок робив пул мінусовим.
  const orders = [order({ id: "o1", assetQty: D("100"), fiatAmountUah: 4_000_00n })];
  const tracked = conv({ id: "c1", fromAmount: D("100"), toAsset: "BTC", toAmount: D("0.001"), p2pOrderId: "o1" });
  const older = conv({ id: "c2", fromAmount: D("50"), toAsset: "ETH", toAmount: D("0.02"), p2pOrderId: null });
  const prices = new Map([["BTC", D(60_000)], ["ETH", D(3_000)]]);
  const uah = D(41);

  it("без позначки пул мінусовий і прапорець піднятий", () => {
    const p = computePortfolio(orders, [tracked, older], prices, uah);
    expect(p.flags.untrackedUsdtSource).toBe(true);
    expect(p.assets.find((a) => a.asset === "USDT")!.qty.toString()).toBe("0");
  });

  it("позначена конвертація не тягне пул, і прапорець гасне", () => {
    const p = computePortfolio(orders, [tracked, { ...older, outOfTracking: true }], prices, uah);
    expect(p.flags.untrackedUsdtSource).toBe(false);
    expect(p.assets.find((a) => a.asset === "USDT")!.qty.toString()).toBe("0");
  });

  it("монети позначеної конвертації лишаються в портфелі", () => {
    const p = computePortfolio(orders, [tracked, { ...older, outOfTracking: true }], prices, uah);
    expect(p.assets.find((a) => a.asset === "ETH")!.qty.toString()).toBe("0.02");
  });

  it("ІНВАРІАНТ: решта тоталсів на тих самих даних не зрушила", () => {
    const before = computePortfolio(orders, [tracked, older], prices, uah);
    const after = computePortfolio(orders, [tracked, { ...older, outOfTracking: true }], prices, uah);
    expect(after.totals.contributionUah).toBe(before.totals.contributionUah);
    expect(after.totals.spreadUah).toBe(before.totals.spreadUah);
    expect(after.totals.feesUah).toBe(before.totals.feesUah);
    expect(after.totals.inputLossUah).toBe(before.totals.inputLossUah);
    expect(after.totals.effectiveInvestedUah).toBe(before.totals.effectiveInvestedUah);
    // currentValue навмисно НЕ звірено тут: на цій фікстурі пул 0 і до, і після
    // позначки (100 куплено, 100+50 витрачено — clamp у нуль в обох випадках),
    // тож порівняння тут було б no-op. Напрямок «позначка може вивести пул у
    // профіцит» перевіряє «ІНВАРІАНТ: позначка може вивести пул у профіцит —
    // задокументована поведінка (рішення власника, п.1)» нижче — там 80/50
    // замість 100/50, і пул дійсно рухається з 0 у 20.
  });
});

describe("outOfTracking: позначка виводить пул у профіцит (рішення власника)", () => {
  it("ІНВАРІАНТ: позначка може вивести пул у профіцит — задокументована поведінка (рішення власника, п.1)", () => {
    // Куплено 100 USDT. 80 привʼязано до цього ж поповнення (реальна витрата
    // звідси). Ще 50 — orphan, але насправді ЗМІШАНЕ джерело: частина тих USDT
    // теж прийшла з цього поповнення, частина — зі старішої, незатрекованої
    // покупки. Позначка «поза трекінгом» виключає ВЕСЬ orphan.fromAmount, а не
    // лише незатрековану частку, тож після неї пул виглядає як 100 − 80 = 20 —
    // профіцит, якого купівля не давала. Це прямий наслідок рішення власника
    // не чіпати формулу пулу (п.1 фінального огляду): замінити перебір точним
    // розподілом ми не можемо (Binance не каже, яка частка orphan звідки), тож
    // єдиний захист — UI не пропонує позначку, коли пояснювати нічого
    // (ConversionSheet ховає кнопку без дефіциту, canMarkOutOfTracking).
    // Цей тест не дає перебору стати випадковим числом: цифра саме 20/false,
    // а не «якесь позитивне значення».
    const orders = [order({ id: "o1", assetQty: D("100"), fiatAmountUah: 4_000_00n })];
    const tracked = conv({ id: "c1", fromAmount: D("80"), toAsset: "BTC", toAmount: D("0.001"), p2pOrderId: "o1" });
    const orphan = conv({ id: "c2", fromAmount: D("50"), toAsset: "ETH", toAmount: D("0.02"), p2pOrderId: null });
    const prices = new Map([["BTC", D(60_000)], ["ETH", D(3_000)]]);
    const uah = D(41);

    const before = computePortfolio(orders, [tracked, orphan], prices, uah);
    expect(before.assets.find((a) => a.asset === "USDT")!.qty.toString()).toBe("0");
    expect(before.flags.untrackedUsdtSource).toBe(true);

    const after = computePortfolio(orders, [tracked, { ...orphan, outOfTracking: true }], prices, uah);
    expect(after.assets.find((a) => a.asset === "USDT")!.qty.toString()).toBe("20");
    expect(after.flags.untrackedUsdtSource).toBe(false);
  });
});

describe("groupConversions і позначені конвертації", () => {
  it("не привʼязує позначену конвертацію, навіть коли вільний ордер є", () => {
    const orders = [order({ id: "o1", assetQty: D("100"), tradeTime: new Date("2026-07-01T10:00:00Z") })];
    const marked = conv({
      id: "c1", fromAmount: D("10"), p2pOrderId: null, outOfTracking: true,
      tradeTime: new Date("2026-07-01T12:00:00Z"),
    });
    const assignment = groupConversions(orders, [marked]);
    expect(assignment.get("c1")).toBeUndefined();
  });
});

describe("orderRemaining", () => {
  it("віддає залишок після врахування вже привʼязаних витрат", () => {
    const orders = [order({ id: "o1", assetQty: D("100"), commissionUsdt: D("1") })];
    const linked = conv({ id: "c1", fromAmount: D("60"), p2pOrderId: "o1" });
    const rem = orderRemaining(orders, [linked]);
    expect(rem.get("o1")!.toString()).toBe("39"); // 100 − 1 комісія − 60
  });

  it("позначена конвертація залишок не зменшує", () => {
    const orders = [order({ id: "o1", assetQty: D("100"), commissionUsdt: D("0") })];
    const marked = conv({ id: "c1", fromAmount: D("60"), p2pOrderId: "o1", outOfTracking: true });
    expect(orderRemaining(orders, [marked]).get("o1")!.toString()).toBe("100");
  });
});

describe("candidateOrders", () => {
  const target = conv({ id: "c1", fromAmount: D("10"), p2pOrderId: null, tradeTime: new Date("2026-07-10T12:00:00Z") });

  it("не пускає ордер, пізніший за конвертацію", () => {
    const orders = [
      order({ id: "before", assetQty: D("50"), tradeTime: new Date("2026-07-09T10:00:00Z") }),
      order({ id: "after", assetQty: D("50"), tradeTime: new Date("2026-07-11T10:00:00Z") }),
    ];
    const got = candidateOrders(target, orders, [target]);
    expect(got.map((c) => c.order.id)).toEqual(["before"]);
  });

  it("не пускає ордер без вільного залишку", () => {
    const orders = [order({ id: "full", assetQty: D("10"), commissionUsdt: D("0"), tradeTime: new Date("2026-07-09T10:00:00Z") })];
    const eats = conv({ id: "c0", fromAmount: D("10"), p2pOrderId: "full", tradeTime: new Date("2026-07-09T11:00:00Z") });
    expect(candidateOrders(target, orders, [eats, target])).toEqual([]);
  });

  it("найближчий за часом — першим", () => {
    const orders = [
      order({ id: "old", assetQty: D("50"), tradeTime: new Date("2026-07-01T10:00:00Z") }),
      order({ id: "near", assetQty: D("50"), tradeTime: new Date("2026-07-09T10:00:00Z") }),
    ];
    const got = candidateOrders(target, orders, [target]);
    expect(got.map((c) => c.order.id)).toEqual(["near", "old"]);
  });
});

describe("mergeWalletBalances", () => {
  it("складає Spot і Funding в одну позицію", () => {
    const m = mergeWalletBalances([
      { asset: "USDT", qty: D("0.24") },
      { asset: "USDT", qty: D("17") },
      { asset: "BTC", qty: D("0.0006") },
    ]);
    expect(m.get("USDT")!.toString()).toBe("17.24");
    expect(m.get("BTC")!.toString()).toBe("0.0006");
  });

  it("LD-префікс Simple Earn зводить до базового активу — але лише для відомих", () => {
    const m = mergeWalletBalances(
      [
        { asset: "LDUSDT", qty: D("10") },
        { asset: "USDT", qty: D("5") },
        { asset: "LDO", qty: D("3") },
      ],
      ["USDT", "BTC"],
    );
    expect(m.get("USDT")!.toString()).toBe("15");
    expect(m.get("LDO")!.toString()).toBe("3"); // не перетворюється на «O»
  });

  it("нулі й відʼємні відкидає", () => {
    const m = mergeWalletBalances([{ asset: "BNB", qty: D(0) }, { asset: "SOL", qty: D(-1) }]);
    expect(m.size).toBe(0);
  });
});

describe("reconcileBalances", () => {
  const prices = new Map([["BTC", D(65_000)], ["ETH", D(2_000)]]);

  it("пил і комісія P2P не флагаються: 0,44 затрековано vs 0,24 факт", () => {
    const r = reconcileBalances({
      tracked: [{ asset: "USDT", qty: D("0.44") }],
      actual: new Map([["USDT", D("0.24")]]),
      prices,
    });
    expect(r.mismatch).toBe(false);
    expect(r.issues).toEqual([]);
  });

  it("точний збіг → тихо", () => {
    const r = reconcileBalances({
      tracked: [{ asset: "BTC", qty: D("0.00062743") }, { asset: "USDT", qty: D("0.44") }],
      actual: new Map([["BTC", D("0.00062743")], ["USDT", D("0.44")]]),
      prices,
    });
    expect(r.mismatch).toBe(false);
  });

  it("справжній недобір: продано пів позиції BTC", () => {
    const r = reconcileBalances({
      tracked: [{ asset: "BTC", qty: D("0.001") }],
      actual: new Map([["BTC", D("0.0005")]]),
      prices,
    });
    expect(r.mismatch).toBe(true);
    expect(r.issues[0]).toMatchObject({ asset: "BTC", kind: "SHORTFALL" });
  });

  it("незатрекуваний актив дорожче 1 USDT → флаг", () => {
    const r = reconcileBalances({
      tracked: [],
      actual: new Map([["ETH", D("0.01")]]),
      prices,
    });
    expect(r.issues[0]).toMatchObject({ asset: "ETH", kind: "UNTRACKED" });
  });

  it("надлишок на Binance (покупки поза трекінгом) → SURPLUS", () => {
    const r = reconcileBalances({
      tracked: [{ asset: "USDT", qty: D("10") }],
      actual: new Map([["USDT", D("60")]]),
      prices,
    });
    expect(r.issues[0]).toMatchObject({ kind: "SURPLUS" });
  });

  it("великий за відсотком, але дешевий розрив — тихо (5% і 1 USDT разом)", () => {
    const r = reconcileBalances({
      tracked: [{ asset: "ETH", qty: D("0.0004") }],
      actual: new Map([["ETH", D("0.0001")]]), // 75%, але ≈0,6 USDT
      prices,
    });
    expect(r.mismatch).toBe(false);
  });

  it("дорогий, але в межах 5% — тихо", () => {
    const r = reconcileBalances({
      tracked: [{ asset: "BTC", qty: D("1") }],
      actual: new Map([["BTC", D("0.98")]]), // 2%, але 1300 USDT
      prices,
    });
    expect(r.mismatch).toBe(false);
  });

  it("актив без ціни не флагається — оцінити нічим", () => {
    const r = reconcileBalances({
      tracked: [],
      actual: new Map([["DOGE", D("1000")]]),
      prices,
    });
    expect(r.mismatch).toBe(false);
  });

  it("walletsPartial глушить SHORTFALL, але не UNTRACKED", () => {
    const r = reconcileBalances({
      tracked: [{ asset: "BTC", qty: D("0.001") }],
      actual: new Map([["ETH", D("0.01")]]),
      prices,
      walletsPartial: true,
    });
    expect(r.issues.map((i) => i.kind)).toEqual(["UNTRACKED"]);
  });

  it("сортує розбіжності за вартістю", () => {
    const r = reconcileBalances({
      tracked: [{ asset: "BTC", qty: D("0.01") }, { asset: "ETH", qty: D("1") }],
      actual: new Map([["BTC", D("0.005")], ["ETH", D("0.5")]]),
      prices,
    });
    expect(r.issues.map((i) => i.asset)).toEqual(["ETH", "BTC"]); // 1000 > 325
  });
});

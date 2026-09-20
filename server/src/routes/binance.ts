// Binance-модуль: статус інтеграції, ручний синк, крипто-портфель з P&L.
import type { FastifyInstance } from "fastify";
import type { CryptoConversion } from "@prisma/client";
import { z } from "zod";
import { Decimal } from "@prisma/client/runtime/library";
import { requireAuth } from "../auth.js";
import { prisma } from "../db.js";
import { env } from "../env.js";
import {
  candidateOrders,
  computeGrossSeries,
  computePortfolio,
  dayKeyUTC,
  mergeWalletBalances,
  reconcileBalances,
  type BalanceIssueKind,
} from "../binance/binanceCore.js";
import {
  BinanceError,
  binanceConfigured,
  getBinanceClient,
} from "../binance/client.js";
import { dailyCloses, loadCurrentPrices } from "../binance/rates.js";
import { isSyncing, runSync } from "../binance/sync.js";

// Кеш перевірки прав ключа для /status (жива перевірка — раз на добу)
let restrictionsCache: { checkedAt: number; payload: Record<string, unknown> } | null = null;
const DAY_MS = 24 * 3_600_000;

// Спільний маппер конвертації для /portfolio і PATCH — тримає одну форму
// відповіді (CryptoConversionRow на клієнті) і не світить internal-поля
// (externalId, spotTradeId, feeAmount, symbol).
const convOut = (c: CryptoConversion) => ({
  id: c.id,
  source: c.source,
  fromAmount: c.fromAmount.toString(),
  toAsset: c.toAsset,
  toAmount: c.toAmount.toString(),
  feeUsdt: c.feeUsdt?.toString() ?? null,
  tradeTime: c.tradeTime,
  outOfTracking: c.outOfTracking,
});

export async function binanceRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.get("/status", async () => {
    const configured = binanceConfigured();
    const state = await prisma.binanceSyncState.findUnique({ where: { id: 1 } });

    let restrictions: Record<string, unknown> | null = null;
    if (configured) {
      if (restrictionsCache && Date.now() - restrictionsCache.checkedAt < DAY_MS) {
        restrictions = restrictionsCache.payload;
      } else {
        try {
          const r = await getBinanceClient().getApiRestrictions();
          restrictions = {
            ok: !r.enableWithdrawals && !r.enableSpotAndMarginTrading && r.enableReading !== false,
            enableReading: r.enableReading ?? null,
            enableWithdrawals: r.enableWithdrawals ?? null,
            enableSpotAndMarginTrading: r.enableSpotAndMarginTrading ?? null,
            checkedAt: new Date().toISOString(),
          };
          restrictionsCache = { checkedAt: Date.now(), payload: restrictions };
        } catch (e) {
          restrictions = {
            ok: false,
            error: e instanceof Error ? e.message : String(e),
            checkedAt: new Date().toISOString(),
          };
        }
      }
    }

    return {
      configured,
      keyMasked: configured ? `····${env.binance.apiKey.slice(-4)}` : null,
      restrictions,
      syncing: isSyncing(),
      lastSyncAt: state?.lastSyncAt ?? null,
      lastError: state?.lastError ?? null,
      counts: {
        p2pOrders: await prisma.cryptoP2POrder.count(),
        conversions: await prisma.cryptoConversion.count(),
      },
    };
  });

  // Фоновий синк — UI полить /status до завершення (патерн mono sync-history).
  app.post("/sync", async (req, reply) => {
    if (!binanceConfigured()) return reply.code(409).send({ error: "not_configured" });
    if (isSyncing()) return reply.code(409).send({ error: "sync_in_progress" });

    const { full } = (req.body ?? {}) as { full?: boolean };
    runSync({ full }).catch((e) => {
      req.log.error({ err: e }, "binance sync failed");
    });
    return reply.code(202).send({ started: true });
  });

  app.get("/portfolio", async () => {
    const configured = binanceConfigured();
    const state = await prisma.binanceSyncState.findUnique({ where: { id: 1 } });
    const orders = await prisma.cryptoP2POrder.findMany({ orderBy: { tradeTime: "desc" } });
    const conversions = await prisma.cryptoConversion.findMany({ orderBy: { tradeTime: "asc" } });

    // Читає кеш CryptoPrice; освіження — best-effort і no-op без ключів
    const prices = await loadCurrentPrices();

    if (!orders.length && !conversions.length) {
      return { configured, lastSyncAt: state?.lastSyncAt ?? null, pricesAsOf: prices.asOf, empty: true };
    }
    if (!prices.usdtUah) {
      // без курсу UAH портфель не оцінити — віддаємо сирі дані з прапорцем
      return {
        configured,
        lastSyncAt: state?.lastSyncAt ?? null,
        pricesAsOf: prices.asOf,
        empty: false,
        ratesUnavailable: true,
      };
    }

    const p = computePortfolio(orders, conversions, prices.byAsset, prices.usdtUah);

    // Баланси Binance — reconciliation-рядок (не джерело P&L)
    let reconciliation: {
      balances: { asset: string; qty: string }[];
      mismatch: boolean;
      issues: {
        asset: string;
        kind: BalanceIssueKind;
        trackedQty: string;
        actualQty: string;
        diffValueUsdt: string;
      }[];
      walletsPartial: boolean;
    } | null = null;
    try {
      const client = getBinanceClient();
      const acc = await client.getAccountBalances();
      const rows = (acc.balances ?? []).map((b) => ({
        asset: b.asset,
        qty: new Decimal(b.free).add(new Decimal(b.locked || "0")),
      }));

      // Funding — окремий гаманець (P2P зачисляє туди). Недоступний → SHORTFALL глушиться.
      let walletsPartial = false;
      try {
        for (const f of await client.getFundingBalances()) {
          rows.push({
            asset: f.asset,
            qty: new Decimal(f.free)
              .add(new Decimal(f.locked || "0"))
              .add(new Decimal(f.freeze || "0")),
          });
        }
      } catch {
        walletsPartial = true;
      }

      const actual = mergeWalletBalances(rows, p.assets.map((a) => a.asset));
      // Ціни для активів, яких немає серед затрекуваних, — щоб зважити «не затрековано».
      const priced = new Map(prices.byAsset);
      const unpriced = [...actual.keys()].filter((a) => a !== "USDT" && !priced.has(a));
      if (unpriced.length) {
        try {
          for (const t of await client.getPrices(unpriced.map((a) => `${a}USDT`))) {
            priced.set(t.symbol.slice(0, -"USDT".length), new Decimal(t.price));
          }
        } catch {
          // невідомі символи — активи просто лишаються без оцінки і не флагаються
        }
      }

      const { mismatch, issues } = reconcileBalances({
        tracked: p.assets,
        actual,
        prices: priced,
        walletsPartial,
      });
      reconciliation = {
        balances: [...actual].map(([asset, qty]) => ({ asset, qty: qty.toString() })),
        mismatch,
        issues: issues.map((i) => ({
          asset: i.asset,
          kind: i.kind,
          trackedQty: i.trackedQty.toString(),
          actualQty: i.actualQty.toString(),
          diffValueUsdt: i.diffValueUsdt.toFixed(2),
        })),
        walletsPartial,
      };
    } catch {
      // не критично — портфель працює і без reconciliation
    }

    return {
      configured,
      lastSyncAt: state?.lastSyncAt ?? null,
      pricesAsOf: prices.asOf,
      empty: false,
      ratesUnavailable: false,
      usdtUahRate: prices.usdtUah.toString(),
      totals: { ...p.totals, flags: p.flags },
      assets: p.assets
        .filter((a) => !a.qty.isZero() || a.asset === "USDT")
        .map((a) => ({
          asset: a.asset,
          qty: a.qty.toString(),
          priceUsdt: a.priceUsdt?.toString() ?? null,
          valueUah: a.valueUah,
        })),
      investments: p.investments.map((i) => ({
        id: i.order.id,
        orderNumber: i.order.orderNumber,
        tradeTime: i.order.tradeTime,
        usdtQty: i.order.assetQty.toString(),
        unitPriceUah: i.order.unitPriceUah.toString(),
        marketRateUah: i.order.marketRateUah?.toString() ?? null,
        contributionUah: i.pnl.contributionUah,
        currentValueUah: i.pnl.currentValueUah,
        netProfitUah: i.pnl.netProfitUah,
        grossProfitUah: i.pnl.grossProfitUah,
        inputLossUah: i.pnl.inputLossUah,
        spreadUah: i.pnl.spreadUah,
        feesUah: i.pnl.feesUah,
        effectiveInvestedUah: i.pnl.effectiveInvestedUah,
        leftoverUsdt: i.pnl.leftoverUsdt.toString(),
        flags: i.pnl.flags,
        conversions: i.conversions.map(convOut),
      })),
      orphanConversions: p.orphanConversions.map(convOut),
      reconciliation,
    };
  });

  // Денна крива gross P&L («рух ринку») — історичні ціни з klines, кеш 1 год.
  app.get("/series", async () => {
    const configured = binanceConfigured();
    const orders = await prisma.cryptoP2POrder.findMany({ orderBy: { tradeTime: "asc" } });
    const conversions = await prisma.cryptoConversion.findMany({ orderBy: { tradeTime: "asc" } });
    if (!orders.length && !conversions.length) return { configured, empty: true, days: [] };

    const prices = await loadCurrentPrices();
    if (!prices.usdtUah) return { configured, empty: false, ratesUnavailable: true, days: [] };

    const times = [...orders.map((o) => o.tradeTime.getTime()), ...conversions.map((c) => c.tradeTime.getTime())];
    const fromMs = Math.floor(Math.min(...times) / 86_400_000) * 86_400_000;
    const assets = [...new Set(conversions.map((c) => c.toAsset))].filter((a) => a !== "USDT");

    const dailyByAsset = new Map<string, Map<string, Decimal>>();
    for (const a of assets) dailyByAsset.set(a, await dailyCloses(`${a}USDT`, fromMs));
    const dailyUsdtUah = await dailyCloses("USDTUAH", fromMs);

    const days = computeGrossSeries(
      orders, conversions, dailyByAsset, dailyUsdtUah,
      { byAsset: prices.byAsset, usdtUah: prices.usdtUah },
      dayKeyUTC(Date.now()),
    );
    return { configured, empty: false, ratesUnavailable: false, days };
  });

  // Привʼязати конвертацію до поповнення або підтвердити, що її USDT куплені
  // поза вікном історії. Взаємно виключні: два різні пояснення одного факту
  // суперечили б одне одному, тож кожне знімає інше.
  app.patch("/conversions/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = z.object({
      p2pOrderId: z.string().min(1).nullable().optional(),
      outOfTracking: z.boolean().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const d = parsed.data;
    if (d.p2pOrderId === undefined && d.outOfTracking === undefined) {
      return reply.code(400).send({ error: "nothing_to_change" });
    }

    const conv = await prisma.cryptoConversion.findUnique({ where: { id } });
    if (!conv) return reply.code(404).send({ error: "not_found" });

    if (d.p2pOrderId) {
      const order = await prisma.cryptoP2POrder.findUnique({ where: { id: d.p2pOrderId } });
      if (!order) return reply.code(404).send({ error: "order_not_found" });
      // Той самий інваріант, що в списку кандидатів: купити USDT після того, як
      // їх витратив, неможливо. Без цієї перевірки запит обійшов би пікер.
      if (order.tradeTime.getTime() > conv.tradeTime.getTime()) {
        return reply.code(400).send({ error: "order_after_conversion" });
      }
    }

    const updated = await prisma.cryptoConversion.update({
      where: { id },
      data: {
        ...(d.p2pOrderId !== undefined
          ? { p2pOrderId: d.p2pOrderId, ...(d.p2pOrderId ? { outOfTracking: false } : {}) }
          : {}),
        ...(d.outOfTracking !== undefined
          ? { outOfTracking: d.outOfTracking, ...(d.outOfTracking ? { p2pOrderId: null } : {}) }
          : {}),
      },
    });
    return convOut(updated);
  });

  // Поповнення, до яких можна привʼязати цю конвертацію.
  app.get("/conversions/:id/candidates", async (req, reply) => {
    const { id } = req.params as { id: string };
    const conv = await prisma.cryptoConversion.findUnique({ where: { id } });
    if (!conv) return reply.code(404).send({ error: "not_found" });

    const orders = await prisma.cryptoP2POrder.findMany({ orderBy: { tradeTime: "asc" } });
    const conversions = await prisma.cryptoConversion.findMany();
    return candidateOrders(conv, orders, conversions)
      .slice(0, 10) // більше десяти сусідніх поповнень людині не поміщається в голову
      .map((c) => ({
        id: c.order.id,
        tradeTime: c.order.tradeTime,
        fiatAmountUah: c.order.fiatAmountUah,
        assetQty: c.order.assetQty.toString(),
        remainingQty: c.remaining.toString(),
      }));
  });
}

export { BinanceError };

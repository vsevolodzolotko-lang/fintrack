import { describe, expect, it } from "vitest";
import {
  computeReitGrowth,
  type InzhurAccountFlow,
  type ReitContribution,
  type ReitValuation,
} from "./reitCore.js";

const c = (iso: string, amount: bigint): ReitContribution => ({ date: new Date(iso), amountUah: amount });
const v = (id: string, iso: string, value: bigint, free: bigint = 0n): ReitValuation =>
  ({ id, date: new Date(iso), valueUah: value, freeUah: free, note: null, investedUah: null, dividendsUah: null });

// Знімок із трьома числами з екрана «Деталі» в INZHUR.
const vi = (
  id: string, iso: string, value: bigint, invested: bigint, dividends: bigint, free: bigint = 0n,
): ReitValuation =>
  ({ id, date: new Date(iso), valueUah: value, freeUah: free, note: null, investedUah: invested, dividendsUah: dividends });

describe("computeReitGrowth", () => {
  it("вільний залишок — нерозміщений кеш, а не збиток (реальний кейс INZHUR)", () => {
    // переказано 4 739; у сертифікати пішло 4 735,67; 3,33 лишились вільними
    const g = computeReitGrowth(
      [c("2026-07-16", 4_739_00n)],
      [v("v1", "2026-07-18", 4_723_28n, 3_33n)],
    );
    expect(g.latestValue).toBe(4_723_28n);
    expect(g.latestFreeUah).toBe(3_33n);
    expect(g.latestWorthUah).toBe(4_726_61n); // довідково лишається
    expect(g.costBasisUah).toBe(4_735_67n);
    expect(g.gainUah).toBe(-12_39n);          // 472328 − 473567
    expect(g.gainPct).toBeCloseTo(-0.2616, 3);
  });

  it("ОВДП-хвіст у вільних НЕ зрушує прибуток REIT", () => {
    // Переказано 822 під ОВДП, облігації ще не куплені — гроші лежать вільними
    // разом із REIT-лишком 3,33. Прибуток REIT має бути тим самим, що й без них.
    const withOvdpTail = computeReitGrowth(
      [c("2026-07-16", 4_739_00n)],
      [v("v1", "2026-07-18", 4_723_28n, 3_33n + 822_00n)],
      [f("2026-07-17", 822_00n, 0n)],
    );
    const alone = computeReitGrowth([c("2026-07-16", 4_739_00n)], [v("v1", "2026-07-18", 4_723_28n, 3_33n)]);
    expect(withOvdpTail.costBasisUah).toBe(alone.costBasisUah);
    expect(withOvdpTail.gainUah).toBe(alone.gainUah);
    expect(withOvdpTail.latestWorthUah).toBe(4_723_28n + 3_33n + 822_00n);
  });

  it("накопичувальна серія внесків відсортована за датою", () => {
    const g = computeReitGrowth(
      [c("2026-06-01", 10_000_00n), c("2026-05-01", 10_000_00n)],
      [],
    );
    expect(g.contributedSeries.map((p) => p.cumulativeUah)).toEqual([10_000_00n, 20_000_00n]);
    expect(g.contributedSeries[0].date).toBe(new Date("2026-05-01").toISOString());
  });

  it("найновіший знімок за датою — джерело вартості", () => {
    const g = computeReitGrowth(
      [c("2026-05-01", 10_000_00n)],
      [v("old", "2026-05-10", 10_500_00n), v("new", "2026-06-10", 12_000_00n, 50_00n)],
    );
    expect(g.latestValue).toBe(12_000_00n);
    expect(g.costBasisUah).toBe(9_950_00n); // 10 000 переказано, 50 лишились вільними
    expect(g.gainUah).toBe(2_050_00n);
    expect(g.asOf).toBe(new Date("2026-06-10").toISOString());
  });

  it("без знімків — усе null, серія лишається", () => {
    const g = computeReitGrowth([c("2026-05-01", 10_000_00n)], []);
    expect(g.latestValue).toBeNull();
    expect(g.latestFreeUah).toBeNull();
    expect(g.latestWorthUah).toBeNull();
    expect(g.gainUah).toBeNull();
    expect(g.gainPct).toBeNull();
    expect(g.asOf).toBeNull();
  });

  it("без внесків — нульова база, gainPct null", () => {
    const g = computeReitGrowth([], [v("v1", "2026-06-15", 500_00n, 0n)]);
    expect(g.costBasisUah).toBe(0n);
    expect(g.gainUah).toBe(500_00n);
    expect(g.gainPct).toBeNull();
  });
});

describe("computeReitGrowth — база прибутку прив'язана до дати оцінки", () => {
  it("внески ПІСЛЯ знімка не читаються як збиток", () => {
    // Реальний кейс: оцінка від 03 серп. (6 670,70), а 27 серп. довнесено 2 351.
    // Стара формула давала −2 397,30; чесна цифра — рух ціни сертифікатів.
    const g = computeReitGrowth(
      [c("2026-07-16", 6_717_00n), c("2026-08-27", 2_351_00n)],
      [v("v1", "2026-08-03", 6_670_70n, 0n)],
    );
    expect(g.contributedTotal).toBe(9_068_00n);   // «Вклав» лишається повним
    expect(g.contributedAtAsOf).toBe(6_717_00n);  // база прибутку — станом на знімок
    expect(g.contributedAfterAsOf).toBe(2_351_00n);
    expect(g.gainUah).toBe(-46_30n);
    expect(g.gainPct).toBeCloseTo(-0.689, 2);
  });

  it("внесок у той самий календарний день, що й знімок, входить у базу", () => {
    // Знімок приходить з датою без часу (00:00), внесок — вдень. За Києвом це
    // один день, тож гроші вже в оцінці й база має їх містити.
    const g = computeReitGrowth(
      [c("2026-08-03T14:30:00+03:00", 1_000_00n)],
      [v("v1", "2026-08-03", 1_010_00n)],
    );
    expect(g.contributedAtAsOf).toBe(1_000_00n);
    expect(g.contributedAfterAsOf).toBe(0n);
    expect(g.gainUah).toBe(10_00n);
  });

  it("без знімків — база й хвіст null/нуль", () => {
    const g = computeReitGrowth([c("2026-05-01", 10_000_00n)], []);
    expect(g.contributedAtAsOf).toBeNull();
    expect(g.contributedAfterAsOf).toBe(0n);
  });

  it("усі внески після знімка — база нуль, gainPct null", () => {
    const g = computeReitGrowth(
      [c("2026-09-01", 5_000_00n)],
      [v("v1", "2026-08-03", 1n)],
    );
    expect(g.contributedAtAsOf).toBe(0n);
    expect(g.contributedAfterAsOf).toBe(5_000_00n);
    expect(g.gainPct).toBeNull();
  });
});

// Рух по рахунку INZHUR поза REIT: перекази під ОВДП і купони — це `inUah`,
// гроші, що стали облігаціями — `outUah`.
const f = (iso: string, inUah: bigint, outUah: bigint): InzhurAccountFlow =>
  ({ date: new Date(iso), inUah, outUah });

describe("computeReitGrowth — база = зведення рахунку INZHUR", () => {
  it("реальний кейс: лишок від купівлі не читається як збиток", () => {
    // Заведено в INZHUR до 03.08: REIT 4 739 + 1 978, ОВДП 12 322 + 5 144.
    // В облігації пішло 11 414,81 + 5 431,20. Вільними лежить 633,49.
    // ⇒ в сертифікати пішло 6 703,50, коштують 6 670,70 → −32,80.
    const g = computeReitGrowth(
      [c("2026-07-17", 4_739_00n), c("2026-07-31", 1_978_00n), c("2026-08-27", 2_351_00n)],
      [v("v1", "2026-08-03", 6_670_70n, 633_49n)],
      [f("2026-07-21", 12_322_00n, 11_414_81n), f("2026-07-31", 5_144_00n, 5_431_20n)],
    );
    expect(g.costBasisUah).toBe(6_703_50n);
    expect(g.gainUah).toBe(-32_80n);
    expect(g.gainPct).toBeCloseTo(-0.489, 2);
    expect(g.contributedTotal).toBe(9_068_00n);
    expect(g.contributedAfterAsOf).toBe(2_351_00n);
  });

  it("рухи ПІСЛЯ знімка не впливають на базу", () => {
    const base = computeReitGrowth(
      [c("2026-07-17", 1_000_00n)],
      [v("v1", "2026-08-03", 900_00n, 100_00n)],
      [],
    );
    const withLater = computeReitGrowth(
      [c("2026-07-17", 1_000_00n)],
      [v("v1", "2026-08-03", 900_00n, 100_00n)],
      [f("2026-08-27", 6_113_00n, 6_056_40n)],
    );
    expect(base.costBasisUah).toBe(900_00n);
    expect(base.gainUah).toBe(0n);
    expect(withLater.costBasisUah).toBe(base.costBasisUah);
    expect(withLater.gainUah).toBe(base.gainUah);
  });

  it("купон ОВДП на рахунку не малює прибутку REIT", () => {
    // Купон приходить кешем: росте і `inUah`, і вільні — база не зрушила.
    const g = computeReitGrowth(
      [c("2026-07-17", 1_000_00n)],
      [v("v1", "2026-08-03", 900_00n, 100_00n + 250_00n)],
      [f("2026-08-01", 250_00n, 0n)],
    );
    expect(g.costBasisUah).toBe(900_00n);
    expect(g.gainUah).toBe(0n);
  });

  it("дивіденд REIT, що лежить кешем, читається як прибуток", () => {
    // Дивіденди ніде не записані: вони просто збільшують вільні, тим самим
    // зменшуючи базу — тобто проявляються прибутком, не чекаючи реінвесту.
    const g = computeReitGrowth(
      [c("2026-07-17", 1_000_00n)],
      [v("v1", "2026-08-03", 900_00n, 100_00n + 30_00n)],
      [],
    );
    expect(g.costBasisUah).toBe(870_00n);
    expect(g.gainUah).toBe(30_00n);
  });

  it("реінвест дивіденда не змінює прибутку — лише переставляє його з кешу в активи", () => {
    const inCash = computeReitGrowth(
      [c("2026-07-17", 1_000_00n)],
      [v("v1", "2026-08-03", 900_00n, 130_00n)],
      [],
    );
    const reinvested = computeReitGrowth(
      [c("2026-07-17", 1_000_00n)],
      [v("v2", "2026-08-04", 930_00n, 100_00n)],
      [],
    );
    expect(reinvested.gainUah).toBe(inCash.gainUah);
  });

  it("суперечливі дані (база від'ємна) — прибуток null, а не вигадане число", () => {
    // Незаписаний переказ у INZHUR: вільних більше, ніж заведено грошей.
    const g = computeReitGrowth(
      [c("2026-07-17", 1_000_00n)],
      [v("v1", "2026-08-03", 900_00n, 5_000_00n)],
      [],
    );
    expect(g.costBasisUah).toBeNull();
    expect(g.gainUah).toBeNull();
    expect(g.gainPct).toBeNull();
  });
});

describe("computeReitGrowth — «Проінвестовано» зі знімка як база", () => {
  it("реальний екран INZHUR: капіталізація + виплачені дивіденди", () => {
    // Вартість активу 9 079,32 · Проінвестовано 9 072,46 · Виплачено дивідендів 32,97
    const g = computeReitGrowth(
      [c("2026-07-17", 4_739_00n), c("2026-07-31", 1_978_00n), c("2026-08-27", 2_351_00n)],
      [vi("v1", "2026-08-27", 9_079_32n, 9_072_46n, 32_97n)],
    );
    expect(g.costBasisUah).toBe(9_072_46n);
    expect(g.capitalGainUah).toBe(6_86n);
    expect(g.dividendsUah).toBe(32_97n);
    expect(g.gainUah).toBe(39_83n);
    expect(g.gainPct).toBeCloseTo(0.439, 2);
  });

  it("«Проінвестовано» б'є зведення рахунку — рухи по ОВДП більше не впливають", () => {
    const withNoise = computeReitGrowth(
      [c("2026-07-17", 4_739_00n)],
      [vi("v1", "2026-08-03", 4_800_00n, 4_700_00n, 10_00n, 500_00n)],
      [f("2026-07-21", 12_322_00n, 11_414_81n)],
    );
    expect(withNoise.costBasisUah).toBe(4_700_00n);
    expect(withNoise.gainUah).toBe(110_00n); // 100 капіталізації + 10 дивідендів
  });

  it("дивіденди необов'язкові — без них лишається капіталізація", () => {
    const g = computeReitGrowth(
      [c("2026-07-17", 1_000_00n)],
      [{ id: "v1", date: new Date("2026-08-03"), valueUah: 1_050_00n, freeUah: 0n, note: null, investedUah: 1_000_00n, dividendsUah: null }],
    );
    expect(g.capitalGainUah).toBe(50_00n);
    expect(g.dividendsUah).toBe(0n);
    expect(g.gainUah).toBe(50_00n);
  });

  it("старий знімок без «Проінвестовано» падає назад на зведення рахунку", () => {
    const g = computeReitGrowth(
      [c("2026-07-16", 4_739_00n)],
      [v("v1", "2026-07-18", 4_723_28n, 3_33n)],
    );
    expect(g.costBasisUah).toBe(4_735_67n);
    expect(g.capitalGainUah).toBe(-12_39n);
    expect(g.dividendsUah).toBe(0n);
    expect(g.gainUah).toBe(-12_39n);
  });

  it("нульове «Проінвестовано» — не плутати з відсутнім", () => {
    // Усе продано: база 0, прибуток = самі дивіденди, відсоток без бази null.
    const g = computeReitGrowth([c("2026-07-16", 1_000_00n)], [vi("v1", "2026-08-03", 0n, 0n, 42_00n)]);
    expect(g.costBasisUah).toBe(0n);
    expect(g.gainUah).toBe(42_00n);
    expect(g.gainPct).toBeNull();
  });
});

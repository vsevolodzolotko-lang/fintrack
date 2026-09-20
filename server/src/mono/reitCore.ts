// Чиста математика росту REIT-портфеля — без Prisma, тестується юнітами.
import { ymdInTz } from "../time.js";

export interface ReitContribution {
  date: Date;
  amountUah: bigint;
}

export interface ReitValuation {
  id: string;
  date: Date;
  valueUah: bigint;          // «Вартість активу» з екрана «Деталі» в INZHUR
  investedUah: bigint | null; // «Проінвестовано» звідти ж; null — знімок до появи поля
  dividendsUah: bigint | null;// «Виплачено дивідендів», накопичувально; null — не заносили
  freeUah: bigint;            // вільні кошти на рахунку INZHUR
  note: string | null;
}

/** Рух по рахунку INZHUR поза REIT: `inUah` — гроші, що прийшли на рахунок
 *  (перекази під ОВДП, купони, погашення); `outUah` — гроші, що стали
 *  облігаціями. Потрібні, щоб вивести, скільки з рахунку пішло в сертифікати. */
export interface InzhurAccountFlow {
  date: Date;
  inUah: bigint;
  outUah: bigint;
}

export interface ReitSeriesPoint {
  date: string; // ISO
  cumulativeUah: bigint;
}

export interface ReitGrowth {
  contributedTotal: bigint;
  contributedAtAsOf: bigint | null;   // перекази під REIT станом на дату знімка
  contributedAfterAsOf: bigint;       // довнесено після знімка — ще не в оцінці
  costBasisUah: bigint | null;        // скільки вкладено в сертифікати — база прибутку
  capitalGainUah: bigint | null;      // рух ціни: вартість − вкладено
  dividendsUah: bigint;               // виплачені дивіденди накопичувально
  contributedSeries: ReitSeriesPoint[];
  latestValue: bigint | null;    // активи останнього знімка
  latestFreeUah: bigint | null;  // вільні кошти останнього знімка
  latestWorthUah: bigint | null; // активи + вільні = повна вартість
  gainUah: bigint | null;        // capitalGainUah + dividendsUah
  gainPct: number | null;
  asOf: string | null;
}

export function computeReitGrowth(
  contributions: ReitContribution[],
  valuations: ReitValuation[],
  accountFlows: InzhurAccountFlow[] = [],
): ReitGrowth {
  const byDateAsc = [...contributions].sort((a, b) => a.date.getTime() - b.date.getTime());
  let running = 0n;
  const contributedSeries: ReitSeriesPoint[] = byDateAsc.map((c) => {
    running += c.amountUah;
    return { date: c.date.toISOString(), cumulativeUah: running };
  });
  const contributedTotal = running;

  const valsAsc = [...valuations].sort((a, b) => a.date.getTime() - b.date.getTime());
  const latest = valsAsc.length ? valsAsc[valsAsc.length - 1] : null;
  const latestValue = latest ? latest.valueUah : null;
  const latestFreeUah = latest ? latest.freeUah : null;
  const latestWorthUah = latest ? latest.valueUah + latest.freeUah : null;
  const asOf = latest ? latest.date.toISOString() : null;

  // База прибутку — внески СТАНОМ НА дату знімка, не за всю історію. Знімок
  // вартості не може містити грошей, надісланих після нього, тож порівняння з
  // повним «Вклав» показувало б кожен свіжий внесок як збиток тієї ж величини.
  // Порівняння — по календарному дню Києва: знімок приходить із датою без часу
  // (00:00), а внесок того ж дня вже сидить в оцінці.
  let contributedAtAsOf: bigint | null = null;
  let contributedAfterAsOf = 0n;
  if (latest) {
    const asOfYmd = ymdInTz(latest.date);
    contributedAtAsOf = 0n;
    for (const c of byDateAsc) {
      if (ymdInTz(c.date) <= asOfYmd) contributedAtAsOf += c.amountUah;
      else contributedAfterAsOf += c.amountUah;
    }
  }

  // База прибутку — НЕ переказано під REIT, а скільки з рахунку реально пішло в
  // сертифікати. Різниця не косметична: переказ, що не влазить у цілий
  // сертифікат, лишається вільними, і порівняння з переказом малювало б збиток
  // на рівному місці. Для ОВДП це розрізнення вже є полем `bondCostUah`, у REIT
  // такого числа нема — тож виводимо його зведенням рахунку INZHUR:
  //
  //   у сертифікати = (перекази REIT + прихід поза REIT) − пішло в облігації − вільні
  //
  // Вільний залишок спільний з ОВДП, але приписувати його комусь і не треба:
  // віднімається весь прихід і додається назад усе вже розміщене. Дивіденди REIT
  // ніде не записані — вони збільшують вільні, тим самим зменшуючи базу, тобто
  // самі проявляються прибутком, не чекаючи реінвесту.
  let costBasisUah: bigint | null = null;
  if (latest && latest.investedUah !== null) {
    // INZHUR показує «Проінвестовано» поруч із «Вартістю активу» на одному
    // екрані — тобто база приходить із джерела, в той самий момент, що й
    // вартість. Ніяких припущень про повноту записів вона не потребує.
    costBasisUah = latest.investedUah;
  } else if (latest && contributedAtAsOf !== null) {
    // Знімки до появи поля: базу доводиться виводити зведенням рахунку INZHUR,
    // спільного з ОВДП. Переказ, що не влазить у цілий сертифікат, лишається
    // вільними, тож порівняння з переказом малювало б збиток на рівному місці:
    //
    //   у сертифікати = (перекази REIT + прихід поза REIT) − в облігації − вільні
    let basis = contributedAtAsOf - latest.freeUah;
    for (const fl of accountFlows) {
      if (ymdInTz(fl.date) <= ymdInTz(latest.date)) basis += fl.inUah - fl.outUah;
    }
    // Від'ємна база означає суперечливі дані (незаписаний переказ у INZHUR або
    // виведення з рахунку) — тоді чесніше не показати нічого, ніж намалювати
    // прибуток із грошей, походження яких застосунок не знає.
    costBasisUah = basis < 0n ? null : basis;
  }

  // Під реінвестом дивіденд перетворюється на сертифікати й піднімає
  // «Проінвестовано» разом із вартістю — тобто в капіталізацію не входить.
  // Тож зароблене видно, лише якщо додати виплачені дивіденди окремо.
  const dividendsUah = latest?.dividendsUah ?? 0n;
  const capitalGainUah =
    latestValue === null || costBasisUah === null ? null : latestValue - costBasisUah;
  const gainUah = capitalGainUah === null ? null : capitalGainUah + dividendsUah;
  const gainPct =
    gainUah === null || !costBasisUah
      ? null
      : (Number(gainUah) / Number(costBasisUah)) * 100;

  return {
    contributedTotal,
    contributedAtAsOf,
    contributedAfterAsOf,
    costBasisUah,
    capitalGainUah,
    dividendsUah,
    contributedSeries,
    latestValue,
    latestFreeUah,
    latestWorthUah,
    gainUah,
    gainPct,
    asOf,
  };
}

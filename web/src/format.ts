// Гроші приходять як рядок (BigInt) у копійках. Формат у грн.
export function fmtUAH(cents: string | number | bigint | null | undefined): string {
  if (cents == null) return "—";
  const n = Number(cents);
  const uah = n / 100;
  return new Intl.NumberFormat("uk-UA", {
    style: "currency",
    currency: "UAH",
    maximumFractionDigits: 0,
  }).format(uah);
}

// "₴847" формат для hero та великих чисел (без trailing символу)
export function fmtGrn(cents: string | number | bigint | null | undefined): string {
  if (cents == null) return "—";
  const n = Number(cents);
  const uah = Math.round(n / 100);
  const abs = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 }).format(Math.abs(uah));
  if (uah < 0) return `−₴${abs}`;
  return `₴${abs}`;
}

// Це PWA, пара мандрує — часовий пояс браузера не збігається з часовим поясом
// програми. `fmtDate` (картка Розгляду й колесо) і `fmtRelDate` мають рахувати
// в Києві, як і решта дат у проєкті, інакше картка на колесі й рядок списку
// показують різний час/дату однієї транзакції за кордоном.
const KYIV_DATETIME = new Intl.DateTimeFormat("uk-UA", {
  timeZone: "Europe/Kyiv",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

const KYIV_MONTH_DAY = new Intl.DateTimeFormat("uk-UA", {
  timeZone: "Europe/Kyiv",
  day: "numeric",
  month: "short",
});

export function fmtDate(iso: string): string {
  return KYIV_DATETIME.format(new Date(iso));
}

// Короткий день у Києві («4 серп.») — для рядків, де важливе «коли», а не час.
export function fmtDayKyiv(iso: string): string {
  return KYIV_MONTH_DAY.format(new Date(iso));
}

export function fmtRelDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Сьогодні";
  if (diffDays === 1) return "Вчора";
  if (diffDays < 7) return `${diffDays} дн. тому`;
  return KYIV_MONTH_DAY.format(d);
}

export function pct(part: string | number, total: string | number): number {
  const p = Number(part);
  const t = Number(total);
  if (!t) return 0;
  // Нижня межа теж потрібна: повернення можуть перевищити витрати циклу
  // (livingSpent іде в мінус) — від'ємна ширина ламала прогрес-бар,
  // браузер ігнорував width і смуга малювалась повною.
  return Math.max(0, Math.min(100, Math.round((p / t) * 100)));
}

// "₴4 723,28" — з копійками, коли вони не нульові (для знімків INZHUR).
export function fmtGrnExact(cents: string | number | bigint | null | undefined): string {
  if (cents == null) return "—";
  const n = Number(cents) / 100;
  const abs = new Intl.NumberFormat("uk-UA", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Math.abs(n));
  return n < 0 ? `−₴${abs}` : `₴${abs}`;
}

// Усе «денне» в проєкті рахується в київському часі (див. server/src/time.ts).
// Групи днів у списку Витрат — не виняток. Наявний fmtRelDate рахує різницю в
// мілісекундах, а не по межі доби, тому для груп він не годиться.
const KYIV_YMD = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Kyiv",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// Це PWA, пара мандрує — часовий пояс браузера не збігається з часовим поясом програми.
// Явно виставляємо Київ як для групувального ключа, так і для мітки дня.
const KYIV_DAY_MONTH = new Intl.DateTimeFormat("uk-UA", {
  timeZone: "Europe/Kyiv",
  day: "numeric",
  month: "short",
});

const MONTH_SHORT = ["січ", "лют", "бер", "кві", "тра", "чер", "лип", "сер", "вер", "жов", "лис", "гру"];

// Називний скорочений («лип») не годиться там, де речення керує родовим
// відмінком («проти липня», «вибрано липня» — саме назва місяця, а не
// скорочення). Дві таблиці, бо це різні слова, а не одне зі суфіксом.
const MONTH_GENITIVE = [
  "січня", "лютого", "березня", "квітня", "травня", "червня",
  "липня", "серпня", "вересня", "жовтня", "листопада", "грудня",
];

/** "2026-07" → "лип" */
export function ymShort(ym: string): string {
  return MONTH_SHORT[Number(ym.slice(5, 7)) - 1] ?? ym;
}

/** "2026-07" → "липня" (родовий відмінок, для «проти …» і «вибрано …»). */
export function ymGenitive(ym: string): string {
  return MONTH_GENITIVE[Number(ym.slice(5, 7)) - 1] ?? ym;
}

/** Київський день ISO-часу як "YYYY-MM-DD" — стабільний ключ групи. */
export function ymdKyiv(iso: string): string {
  return KYIV_YMD.format(new Date(iso));
}

/** Підпис групи днів: «Сьогодні» / «Вчора» / «12 лип». */
export function dayLabel(ymd: string, todayYmd: string = ymdKyiv(new Date().toISOString())): string {
  if (ymd === todayYmd) return "Сьогодні";
  const [y, m, d] = todayYmd.split("-").map(Number);
  const prev = new Date(Date.UTC(y, m - 1, d - 1));
  const yesterday = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}-${String(prev.getUTCDate()).padStart(2, "0")}`;
  if (ymd === yesterday) return "Вчора";
  const [yy, mm, dd] = ymd.split("-").map(Number);
  return KYIV_DAY_MONTH
    .format(new Date(Date.UTC(yy, mm - 1, dd)))
    .replace(/\.$/, "");
}

import { ymdInTz } from "../time.js";

// Чиста арифметика історії витрат: без Prisma й без Fastify, за тим самим
// патерном, що statsCore/paceCore/closureCore. Роут дістає транзакції, ядро
// рахує — тож усе тут перевіряється тестами, а не оком на графіку.

export interface HistoryTx {
  time: Date;
  amount: bigint;
  envelope: string;
  categoryId: string | null;
}

export interface BreakdownRow {
  categoryId: string | null;
  spent: bigint;
  delta: bigint | null;
}

export interface MerchantRow {
  description: string;
  count: number;
  spent: bigint;
}

export interface PersonRow {
  userId: string | null;
  spent: bigint;
}

/** Київський місяць як "YYYY-MM". */
export function ymInTz(d: Date, tz: string): string {
  return ymdInTz(d, tz).slice(0, 7);
}

/** Місяці від sinceYmd до nowYmd включно, без пропусків. */
export function monthsInRange(sinceYmd: string, nowYmd: string): string[] {
  const out: string[] = [];
  let [y, m] = sinceYmd.slice(0, 7).split("-").map(Number);
  const [ey, em] = nowYmd.slice(0, 7).split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

/**
 * Чому місяць неповний. Два різні випадки, і плутати їх не можна: місяць
 * початку трекінгу обрізаний зліва (липень «дешевий» не тому, що ощадливі, а
 * тому, що його перші чотири дні не рахувались), а поточний ще триває.
 * Коли обидва разом — «start» важливіший, бо він про відсутні дані, а не про
 * ще не прожитий час.
 */
export function partialKind(
  ym: string, sinceYmd: string, nowYmd: string,
): "start" | "running" | null {
  if (ym === sinceYmd.slice(0, 7) && !sinceYmd.endsWith("-01")) return "start";
  if (ym === nowYmd.slice(0, 7)) return "running";
  return null;
}

/**
 * Чиста витрата побуту по місяцях. Правило дослівно те саме, що в
 * statsCore.ts:97-118 — витрати LIVING мінус повернення й кешбек усередині
 * LIVING. Якщо тут порахувати валом, історія й дашборд назвуть різні числа
 * про той самий місяць.
 */
export function livingByMonth(txs: HistoryTx[], tz: string): Map<string, bigint> {
  const out = new Map<string, bigint>();
  for (const t of txs) {
    if (t.envelope !== "LIVING") continue;
    const ym = ymInTz(t.time, tz);
    // amount уже зі знаком: витрата від'ємна, повернення додатне.
    out.set(ym, (out.get(ym) ?? 0n) - t.amount);
  }
  return out;
}

/**
 * Розбивка місяця: категорії за валовими витратами, плюс окремий рядок
 * повернень у кінці. Повернення приходять без категорії, тож розкидати їх по
 * рядках нема куди — але й сховати не можна, інакше список не зійдеться до
 * суми місяця просто над ним.
 */
export function categoryBreakdown(
  txs: HistoryTx[], ym: string, prevYm: string | null, tz: string,
): BreakdownRow[] {
  const cur = new Map<string, bigint>();
  const prev = new Map<string, bigint>();
  let refunds = 0n;

  for (const t of txs) {
    if (t.envelope !== "LIVING") continue;
    const m = ymInTz(t.time, tz);
    if (m !== ym && m !== prevYm) continue;
    if (t.amount > 0n) {
      if (m === ym) refunds += t.amount;
      continue;
    }
    // Ключ "" — витрати без категорії; рядок повернень тримається окремо.
    const key = t.categoryId ?? "";
    const bucket = m === ym ? cur : prev;
    bucket.set(key, (bucket.get(key) ?? 0n) + -t.amount);
  }

  const rows: BreakdownRow[] = [...cur.entries()]
    .map(([key, spent]) => ({
      categoryId: key === "" ? null : key,
      spent,
      delta: prevYm === null ? null : spent - (prev.get(key) ?? 0n),
    }))
    .sort((a, b) => (b.spent > a.spent ? 1 : b.spent < a.spent ? -1 : 0));

  if (refunds !== 0n) rows.push({ categoryId: null, spent: -refunds, delta: null });
  return rows;
}

/** Топ мерчантів за сумою: скільки разів купували і на скільки. */
export function topMerchants(
  txs: { description: string; amount: bigint }[], limit: number,
): MerchantRow[] {
  const acc = new Map<string, { count: number; spent: bigint }>();
  for (const t of txs) {
    if (t.amount >= 0n) continue;
    const cur = acc.get(t.description) ?? { count: 0, spent: 0n };
    acc.set(t.description, { count: cur.count + 1, spent: cur.spent + -t.amount });
  }
  return [...acc.entries()]
    .map(([description, v]) => ({ description, ...v }))
    .sort((a, b) => (b.spent > a.spent ? 1 : b.spent < a.spent ? -1 : 0))
    .slice(0, limit);
}

/**
 * Скільки витратила кожна людина. userId null — спільні витрати або ще не
 * розподілені. Рахуємо лише витрати (amount < 0n): повернення не мають
 * зменшувати чиюсь частку, тож не враховуються тут узагалі — так само, як
 * topMerchants ігнорує їх для мерчантів.
 */
export function byPerson(
  txs: { userId: string | null; amount: bigint }[],
): PersonRow[] {
  const acc = new Map<string | null, bigint>();
  for (const t of txs) {
    if (t.amount >= 0n) continue;
    acc.set(t.userId, (acc.get(t.userId) ?? 0n) + -t.amount);
  }
  return [...acc.entries()]
    .map(([userId, spent]) => ({ userId, spent }))
    .sort((a, b) => (b.spent > a.spent ? 1 : b.spent < a.spent ? -1 : 0));
}

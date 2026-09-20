import { env } from "./env.js";

// Хелпери для розрахунку днів/меж у часовому поясі Kyiv.
// Використовуємо Intl для отримання «локальної» дати без зовнішніх залежностей.

export function ymdInTz(d: Date, tz = env.tz): string {
  // → "2026-07-06"
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  return parts; // en-CA дає формат YYYY-MM-DD
}

// Кількість календарних днів між двома датами (за локальним днем у tz), включно.
export function daysBetweenInclusive(from: Date, to: Date, tz = env.tz): number {
  const a = Date.parse(ymdInTz(from, tz) + "T00:00:00Z");
  const b = Date.parse(ymdInTz(to, tz) + "T00:00:00Z");
  const diff = Math.round((b - a) / 86_400_000);
  return diff + 1;
}

// Чи належать дві дати одному локальному дню.
export function sameLocalDay(a: Date, b: Date, tz = env.tz): boolean {
  return ymdInTz(a, tz) === ymdInTz(b, tz);
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}

// Наступне входження числа місяця СТРОГО після дати (за локальним днем у tz),
// з обрізанням для коротких місяців (день 31 у вересні → 30 вер).
// Повертає UTC-північ — у Києві це той самий календарний день.
export function nextDayOfMonth(after: Date, day: number, tz = env.tz): Date {
  const [y, m, d] = ymdInTz(after, tz).split("-").map(Number);
  const clamped = (yy: number, mm: number) =>
    Math.min(day, new Date(Date.UTC(yy, mm, 0)).getUTCDate());
  if (clamped(y, m) > d) return new Date(Date.UTC(y, m - 1, clamped(y, m)));
  const [y2, m2] = m === 12 ? [y + 1, 1] : [y, m + 1];
  return new Date(Date.UTC(y2, m2 - 1, clamped(y2, m2)));
}

// Додати календарні місяці, зберігши число місяця (з обрізанням для коротших
// місяців: 31 січ + 1 міс → 28/29 лют). Час доби зберігається (UTC).
export function addMonths(d: Date, months: number): Date {
  const day = d.getUTCDate();
  const target = new Date(d.getTime());
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target;
}

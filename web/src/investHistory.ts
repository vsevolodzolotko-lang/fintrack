// Групування стрічки інвестицій по календарних місяцях. Робиться ПІСЛЯ фільтра:
// підзаголовок місяця має відповідати тому, що видно на екрані.
import type { InstrumentKind, InvestEvent } from "./api";

const TZ = "Europe/Kyiv";

export interface InvestMonthGroup {
  ym: string;              // "2026-07"
  label: string;           // "Липень"
  contributedUah: bigint;  // сума лише внесків цього місяця
  events: InvestEvent[];   // спадна за датою
}

// У проєкті прийнято не створювати Intl.DateTimeFormat на кожен виклик
// (див. web/src/format.ts) — модульні константи замість цього.
const KYIV_YEAR_MONTH = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ, year: "numeric", month: "2-digit",
});
const KYIV_MONTH_LONG = new Intl.DateTimeFormat("uk-UA", { month: "long", timeZone: TZ });

/** Київський «рік-місяць» події — межа доби місцева, не UTC. */
function ymInKyiv(iso: string): string {
  const parts = KYIV_YEAR_MONTH.formatToParts(new Date(iso));
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  return `${y}-${m}`;
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const name = KYIV_MONTH_LONG.format(new Date(Date.UTC(y, m - 1, 15)));
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function filterByKind(events: InvestEvent[], kind: InstrumentKind | null): InvestEvent[] {
  return kind === null ? events : events.filter((e) => e.kind === kind);
}

export function groupByMonth(events: InvestEvent[]): InvestMonthGroup[] {
  const byYm = new Map<string, InvestEvent[]>();
  for (const e of events) {
    const ym = ymInKyiv(e.date);
    const list = byYm.get(ym);
    if (list) list.push(e);
    else byYm.set(ym, [e]);
  }
  return [...byYm.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([ym, list]) => ({
      ym,
      label: monthLabel(ym),
      contributedUah: list
        .filter((e) => e.type === "CONTRIBUTION")
        .reduce((s, e) => s + BigInt(e.amountUah), 0n),
      events: list,
    }));
}

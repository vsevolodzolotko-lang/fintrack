/** Ширина заповненої частини смужки прогресу, «0%»…«100%». */
export function pctWidth(part: string, whole: string): string {
  const p = Number(part), w = Number(whole);
  if (!w) return "0%";
  return `${Math.min(100, (p / w) * 100)}%`;
}

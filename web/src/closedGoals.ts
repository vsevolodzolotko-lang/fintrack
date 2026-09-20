import { fmtGrn } from "./format";

// Підпис «звідки гроші» під рядком закритої цілі: скільки на неї відкладали і
// чи збіглося це з фактичною витратою.
//
// Порядок галузок значущий. allocated === 0 перевіряється ПЕРШОЮ, бо інакше
// вона потрапила б у delta > 0 і дала б «₴0 відкладено + ₴18 000 з вільного» —
// формально правду, яку неприємно читати.
export function originCaption(spentKop: string | bigint, allocatedKop: string | bigint): string {
  const spent = BigInt(spentKop);
  const allocated = BigInt(allocatedKop);

  if (allocated === 0n) return "не з відкладеного";

  const delta = spent - allocated;
  if (delta > 0n) return `${fmtGrn(allocated)} відкладено + ${fmtGrn(delta)} з вільного`;
  if (delta < 0n) return `${fmtGrn(allocated)} відкладено, ${fmtGrn(-delta)} повернулось`;
  return "рівно з відкладеного";
}

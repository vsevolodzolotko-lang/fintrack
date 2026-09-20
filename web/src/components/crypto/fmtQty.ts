// Форматування кількості криптоактиву. Власний модуль, бо CryptoPortfolio.tsx
// і ConversionSheet.tsx (яку картка ж і імпортує) обидва потребують цю функцію —
// експорт із CryptoPortfolio.tsx створював би імпортний цикл.

// "0.00040000" → "0.0004", "40.35000000" → "40.35"
export function fmtQty(q: string): string {
  const n = Number(q);
  if (!n) return "0";
  return n.toLocaleString("uk-UA", { maximumFractionDigits: 8 });
}

// Токени інструментів: назва, колір, іконка. Живуть окремо від сторінки, бо
// Dashboard їх теж читає — а сторінка, що імпортує зі сторінки, це рівно те,
// як кольори інструментів починають розʼїжджатись між екранами.
import type { InstrumentKind } from "./api";

export const INSTRUMENT_META: Record<InstrumentKind, { label: string; short: string; color: string; tileBg: string; iconPath: string }> = {
  OVDP: {
    label: "ОВДП", short: "ОВДП", color: "#F5A623", tileBg: "rgba(245,166,35,.14)",
    iconPath: "M3 22h18 M6 18V10 M10 18V10 M14 18V10 M18 18V10 M2 8l10-5 10 5 M2 8h20",
  },
  REIT: {
    label: "Inzhur REIT", short: "REIT", color: "#4FC3C6", tileBg: "rgba(79,195,198,.14)",
    iconPath: "M4 22V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v17 M15 10h4a1 1 0 0 1 1 1v11 M4 22h18 M8 8h.01 M8 12h.01 M8 16h.01 M11 8h.01 M11 12h.01 M11 16h.01",
  },
  CRYPTO: {
    label: "Крипта", short: "Крипта", color: "#7C83FF", tileBg: "rgba(124,131,255,.14)",
    iconPath: "M11.8 19.1c4.9.9 6.1-6 1.2-6.9m-1.2 6.9L5.9 18m5.9 1.1-.4 2m1.6-8.9c4.9.9 6.1-6 1.2-6.9m-1.2 6.9-3.9-.7m5.1-6.2L8.3 4.3m5.9 1 .3-2M7.5 20.4 10.6 2.6",
  },
};

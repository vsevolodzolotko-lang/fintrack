// Довгі тексти довідки інструментів. Окремо від instruments.ts, бо це JSX:
// Dashboard читає лише токени й не має тягнути за собою розмітку.
import type { InstrumentKind } from "./api";

const COMMON_INFO = "Цілі рахуються від 15% доходу циклу в цілих гривнях і сумуються точно в бюджет.";

export const INSTRUMENT_INFO: Record<InstrumentKind, React.ReactNode> = {
  OVDP: (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div><b style={{ color: "#F5A623" }}>Держоблігації.</b> Купуються цілими лотами (~1 000+ грн за штуку) — рівно в ціль не влучиш, і це нормально.</div>
      <div><b style={{ color: "#EDEFF5" }}>Ціль</b> = 65% інвестбюджету місяця + недобір минулого місяця (амбер-рядок «перенесено»).</div>
      <div><b style={{ color: "#EDEFF5" }}>Як робити:</b> тисни «Почати» на картці — флоу проведе по кроках і сам підставить суму. <b style={{ color: "#EDEFF5" }}>Внесок = скільки відправив</b>, не вартість лотів: різницю з ціллю чесно перенесе в наступний місяць.</div>
      <div>Вкажи <b style={{ color: "#EDEFF5" }}>дохідність % річних</b> (INZHUR показує при купівлі) — з'явиться очікуване повернення і крива нарощення. Прості відсотки — орієнтир, не оферта.</div>
      <div style={{ color: "#8a90a2" }}>{COMMON_INFO}</div>
    </div>
  ),
  REIT: (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div><b style={{ color: "#4FC3C6" }}>Inzhur REIT.</b> Сертифікати дробові (від 10 грн) — ціль закривається рівно.</div>
      <div><b style={{ color: "#EDEFF5" }}>Ціль</b> = 25% інвестбюджету. Тисни «Почати» — флоу проведе: закинь на INZHUR, купи сертифікати, запиши. <b style={{ color: "#EDEFF5" }}>Внесок = скільки відправив.</b></div>
      <div>Ріст вартості — нижче в блоці «Inzhur REIT» (ручні знімки, бо API в INZHUR немає).</div>
      <div style={{ color: "#8a90a2" }}>{COMMON_INFO}</div>
    </div>
  ),
  CRYPTO: (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div><b style={{ color: "#7C83FF" }}>Крипта.</b> Ціль = 10% інвестбюджету.</div>
      <div>Купуй USDT через Binance P2P: з підключеним read-only ключем угоди підтягуються самі й внесок записується автоматично; без ключа — запиши вручну.</div>
      <div>Прибуток і витрати входу — в блоці «Крипта · Binance» нижче.</div>
      <div style={{ color: "#8a90a2" }}>{COMMON_INFO}</div>
    </div>
  ),
};

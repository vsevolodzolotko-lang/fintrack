// Конвенція нумерації кроків покрокового внеску. Раніше жила дублем у
// ContributionFlow.tsx (`stepLabel`) і PlanTab.tsx (кнопка «Продовжити») —
// обидва рахували «показаний крок» по-своєму, і тестом до неї не дотягнутись,
// бо обидві копії сиділи всередині компонентів.
//
// flow.steps === 0 означає «крипта з ключем Binance — флоу штатно не
// потрібен», а не «кроків нуль»: для ручного входу (знахідка 4 фінального
// рев'ю) той самий флоу двокроковий, тож тут це нормалізується один раз.
export function totalSteps(total: number): number {
  return total === 0 ? 2 : total;
}

/** Крок 3 завжди означає «запис» — показується як останній крок флоу. */
export function shownStep(step: number, total: number): number {
  const t = totalSteps(total);
  return step === 3 ? t : step;
}

/** Підпис у шапці шита: «Крок 2 з 3 · купівля». */
export function stepLabel(step: number, total: number): string {
  const t = totalSteps(total);
  const shown = shownStep(step, total);
  const name = step === 1 ? "відправка" : step === 2 ? "купівля" : "запис";
  return `Крок ${shown} з ${t} · ${name}`;
}

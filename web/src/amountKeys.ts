// Логіка клавіш нумпада сум. Чиста функція, бо саме тут живуть усі гілки:
// два шити раніше мали дві власні копії цього, і жодна не була перевірена.
//
// decimals керує тим, чи існує кома. Коли її немає, її місце на клавіатурі
// займає «000» — і відсутність коми починає означати «тут копійок не буває»
// замість «недоробили».

const MAX_LEN = 7;

export function pressKey(value: string, key: string, decimals: boolean): string {
  if (key === "⌫") return value.slice(0, -1);

  if (key === ",") {
    if (!decimals) return value;
    // Кома потребує цілої частини перед собою і буває лише одна.
    if (value === "" || value.includes(",")) return value;
    return value + ",";
  }

  if (key === "000") {
    if (decimals) return value;
    // «000» на порожньому полі дало б «000» — це не сума, а нуль.
    if (value === "") return value;
    return clamp(value + "000");
  }

  const [, dec] = value.split(",");
  // Після коми — максимум дві цифри.
  if (dec !== undefined) return dec.length >= 2 ? value : value + key;

  // Провідний нуль не накопичується: «0» + «5» = «5».
  return clamp((value === "0" ? "" : value) + key);
}

// Префіл — підказка, а не значення: перша ж набрана цифра починає суму з нуля.
// Без цього готове «0,00» (баланс цілі в шиті «Куплено») було тупиком: після
// коми вже два знаки, тож pressKey глушив кожну цифру, і залишався тільки ⌫.
// ⌫ і кома правлять сам префіл — саме для цього їх і тиснуть.
// «000» дописує нулі: це множник до вже набраного, а не нова сума.
export function pressPrefilled(
  value: string,
  key: string,
  decimals: boolean,
  pristine: boolean,
): { value: string; pristine: boolean } {
  const isDigit = key.length === 1 && key >= "0" && key <= "9";
  const base = pristine && isDigit ? "" : value;
  return { value: pressKey(base, key, decimals), pristine: false };
}

function clamp(v: string): string {
  return v.length > MAX_LEN ? v.slice(0, MAX_LEN) : v;
}

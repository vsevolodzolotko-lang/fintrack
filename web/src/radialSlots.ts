import {
  Baby, Car, Film, House, ShoppingBag, ShoppingBasket, TrendingUp,
  type LucideIcon,
} from "lucide-react";
import type { Category } from "./api";

/**
 * Сім секторів колеса. ПОРЯДОК ЗАШИТИЙ І НІКОЛИ НЕ СОРТУЄТЬСЯ З ДАНИХ:
 * індекс = кут = i * 360/7, і мускульна пам'ять на цей порядок — весь сенс
 * взаємодії. Сектор ≠ бюджетний конверт: у «Відкласти» разом сидять
 * INVESTMENT, GOAL_CONTRIBUTION і LIVING.
 */
export const RADIAL_SLOTS: { label: string; color: string; Icon: LucideIcon }[] = [
  { label: "Їжа", color: "#4CAF50", Icon: ShoppingBasket },
  { label: "Транспорт", color: "#03A9F4", Icon: Car },
  { label: "Дім", color: "#9C78EF", Icon: House },
  { label: "Покупки", color: "#5C6BC0", Icon: ShoppingBag },
  { label: "Дитина", color: "#F06292", Icon: Baby },
  { label: "Радість", color: "#FF9800", Icon: Film },
  { label: "Відкласти", color: "#F5A623", Icon: TrendingUp },
];

export interface RadialSlotView {
  label: string;
  color: string;
  Icon: LucideIcon;
  leaves: Category[];
}

/** Розкладає категорії по секторах. Завжди 7 елементів, порядок листів стабільний. */
export function buildSlots(cats: Category[]): RadialSlotView[] {
  return RADIAL_SLOTS.map((s, i) => ({
    ...s,
    leaves: cats
      .filter((c) => c.radialSlot === i)
      .sort((a, b) => (a.radialOrder - b.radialOrder) || a.name.localeCompare(b.name, "uk")),
  }));
}

/** Підпис листа на фані: коротка форма, якщо є. */
export function leafLabel(c: Category): string {
  return c.shortName ?? c.name;
}

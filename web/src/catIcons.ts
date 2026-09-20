import {
  Baby, Bus, Cat, Coffee, Film, Fuel, HeartPulse, House, Laptop, Package,
  PiggyBank, Plug, Repeat, Shirt, ShoppingBasket, Sparkles, TrendingUp, Wrench,
  type LucideIcon,
} from "lucide-react";

// Іконки КАТЕГОРІЙ (34px кружки в списку Витрат). Не плутати з іконками
// СЕКТОРІВ у radialSlots.ts — це різні набори різного призначення.
export const CAT_ICON: Record<string, LucideIcon> = {
  "Продукти": ShoppingBasket,
  "Кафе і ресторани": Coffee,
  "Проїзд громадським": Bus,
  "Бензин": Fuel,
  "Ремонт транспорту": Wrench,
  "Комуналка і звʼязок": Plug,
  "Медицина": HeartPulse,
  "Одяг": Shirt,
  "Техніка": Laptop,
  "Дім і побут": House,
  "Дитина": Baby,
  "Розваги": Film,
  "Підписки": Repeat,
  "Коти": Cat,
  "Косметика": Sparkles,
  "Інше": Package,
  "Інвестиції": TrendingUp,
  "На білу карту": PiggyBank,
};

export function iconFor(name: string | null | undefined): LucideIcon {
  return (name && CAT_ICON[name]) || Package;
}

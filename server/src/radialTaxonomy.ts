import type { PrismaClient } from "@prisma/client";

// Таксономія радіального категоризатора. Сектори (кут, колір, іконка) зашиті
// у web/src/radialSlots.ts — тут лише прив'язка категорій до слотів.
// Слоти: 0 Їжа · 1 Транспорт · 2 Дім · 3 Покупки · 4 Дитина · 5 Радість · 6 Відкласти
export const RADIAL_LEAVES: { name: string; slot: number; order: number; short?: string }[] = [
  { name: "Продукти", slot: 0, order: 10 },
  { name: "Кафе і ресторани", slot: 0, order: 20, short: "Кафе" },

  { name: "Проїзд громадським", slot: 1, order: 10, short: "Проїзд" },
  { name: "Бензин", slot: 1, order: 20 },
  { name: "Ремонт транспорту", slot: 1, order: 30, short: "Ремонт" },

  { name: "Дім і побут", slot: 2, order: 10, short: "Побут" },
  { name: "Комуналка і звʼязок", slot: 2, order: 20, short: "Комуналка" },
  { name: "Коти", slot: 2, order: 30 },

  { name: "Одяг", slot: 3, order: 10 },
  { name: "Техніка", slot: 3, order: 20 },
  { name: "Медицина", slot: 3, order: 30 },
  // Створена вручну, не сідом — тому її немає в NEW_CATEGORIES: хук її не
  // створює, лише дає слот, якщо вона є. На свіжій БД цей рядок просто нічого
  // не знайде, і це нормально.
  { name: "Подарунки", slot: 3, order: 40 },

  { name: "Дитина", slot: 4, order: 10 },

  { name: "Розваги", slot: 5, order: 10 },
  { name: "Підписки", slot: 5, order: 20 },
  { name: "Косметика", slot: 5, order: 30 },

  { name: "Інвестиції", slot: 6, order: 10 },
  { name: "На білу карту", slot: 6, order: 20, short: "Біла карта" },
  { name: "Інше", slot: 6, order: 30 },
];

// Кольори секторів колеса — дублюють web/src/radialSlots.ts (джерело істини
// для дизайну), бо сервер не імпортує web-код. Індекс = слот, той самий
// порядок, що й у RADIAL_SLOTS: тримати два масиви синхронними вручну,
// тест нижче звіряє NEW_CATEGORIES проти цього масиву.
// 0 Їжа · 1 Транспорт · 2 Дім · 3 Покупки · 4 Дитина · 5 Радість · 6 Відкласти
export const SLOT_COLORS: string[] = [
  "#4CAF50", "#03A9F4", "#9C78EF", "#5C6BC0", "#F06292", "#FF9800", "#F5A623",
];

// Категорій із цими назвами в БД ще немає — «Транспорт» розпадається на три
// листи, «Техніка» відділяється від «Одягу». Колір — колір сектора, у який
// їх кладе RADIAL_LEAVES (не вигадуємо окремий відтінок на категорію).
export const NEW_CATEGORIES: { name: string; color: string }[] = [
  { name: "Проїзд громадським", color: SLOT_COLORS[1] },
  { name: "Ремонт транспорту", color: SLOT_COLORS[1] },
  { name: "Техніка", color: SLOT_COLORS[3] },
];

// MCC, які після перейменування «Транспорт» → «Бензин» показують не туди:
// громадський транспорт і таксі — це «Проїзд громадським», не заправка.
const MCC_TO_TRANSIT = [4111, 4121];

/**
 * Ідемпотентно приводить категорії до таксономії колеса. Викликається на
 * старті сервера, а не з seed.ts: сід на боксі не ганяється, бо tsx —
 * dev-залежність (той самий мотив, що в ensureWheelEnvelopeCategories).
 */
export async function ensureRadialTaxonomy(prisma: PrismaClient): Promise<void> {
  // 1. «Транспорт» стає назвою сектора, тому категорією бути не може.
  //    Rename, а не міграція транзакцій: id стабільний, історія на місці,
  //    MCC-правила АЗС лишаються валідними. Пропускаємо, якщо «Бензин» уже є —
  //    інакше після ручного створення вийшов би дубль.
  const petrol = await prisma.category.findFirst({ where: { name: "Бензин" } });
  if (!petrol) {
    // На Category.name немає @unique — теоретично можуть існувати дві
    // категорії «Транспорт» (ручне створення, чужий баг). updateMany
    // перейменував би обидві в один прохід і дав дубль «Бензину», якого
    // цей хук якраз має уникати. Рахуємо перед рейнеймом і рейнеймимо
    // лише коли рівно один рядок — інакше пропускаємо й попереджаємо.
    const transportCount = await prisma.category.count({ where: { name: "Транспорт" } });
    if (transportCount === 1) {
      await prisma.category.updateMany({
        where: { name: "Транспорт" },
        data: { name: "Бензин" },
      });
    } else if (transportCount > 1) {
      console.warn(
        `ensureRadialTaxonomy: знайдено ${transportCount} категорій «Транспорт» — рейнейм у «Бензин» пропущено, розберіться вручну`,
      );
    }
  }

  // 2. Створити відсутні категорії.
  for (const c of NEW_CATEGORIES) {
    const existing = await prisma.category.findFirst({ where: { name: c.name } });
    if (!existing) {
      await prisma.category.create({
        data: { name: c.name, color: c.color, defaultEnvelope: "LIVING", isSystem: true },
      });
    }
  }

  // 3. Проставити слоти — лише де radialSlot ще null, щоб не перетирати
  //    категорію, яку користувач сам переніс в інший сектор.
  for (const l of RADIAL_LEAVES) {
    await prisma.category.updateMany({
      where: { name: l.name, radialSlot: null },
      data: { radialSlot: l.slot, radialOrder: l.order, shortName: l.short ?? null },
    });
  }

  // 4. Колір категорії — похідна від сектора, а не дані користувача (жоден
  //    UI не дає користувачу задати колір: він проставляється лише при
  //    створенні категорії й читається для відображення). Тому перезаписати
  //    його на колір сектора безпечно завжди, для будь-якої категорії з
  //    radialSlot. where одразу виключає рядки з уже правильним кольором —
  //    ідемпотентність за побудовою: другий прогін не знайде що оновлювати.
  for (let slot = 0; slot < SLOT_COLORS.length; slot++) {
    await prisma.category.updateMany({
      // color — String? Nullable, тож `color: { not: X }` у Prisma компілюється
      // в SQL із трьохзначною логікою: NULL <> X дає NULL, не true, і рядки з
      // color IS NULL випадають з вибірки мовчки. Явний OR з null ловить і їх —
      // інакше категорія, якій щойно призначили слот (крок 3), могла лишитись
      // без кольору назавжди.
      where: { radialSlot: slot, OR: [{ color: null }, { color: { not: SLOT_COLORS[slot] } }] },
      data: { color: SLOT_COLORS[slot] },
    });
  }

  // 5. Перевісити MCC громадського транспорту й таксі з «Бензину» на «Проїзд».
  const transit = await prisma.category.findFirst({ where: { name: "Проїзд громадським" } });
  const fuel = await prisma.category.findFirst({ where: { name: "Бензин" } });
  if (transit && fuel) {
    await prisma.categoryRule.updateMany({
      where: { mcc: { in: MCC_TO_TRANSIT }, resultCategoryId: fuel.id },
      data: { resultCategoryId: transit.id },
    });
  }
}

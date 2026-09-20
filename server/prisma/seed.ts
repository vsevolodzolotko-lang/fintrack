import { PrismaClient, type Envelope } from "@prisma/client";

const prisma = new PrismaClient();

// Перейменування для вже засіяної БД: UPDATE за старою назвою, id стабільний.
const RENAMES: { from: string; to: string }[] = [
  { from: "Здоровʼя", to: "Медицина" },
  { from: "Діти", to: "Дитина" },
];

// Базові категорії + MCC-правила автокатегоризації (українські реалії).
const CATEGORIES: { key: string; name: string; color: string; env: Envelope }[] = [
  { key: "groceries", name: "Продукти", color: "#4CAF50", env: "LIVING" },
  { key: "cafe", name: "Кафе і ресторани", color: "#FF9800", env: "LIVING" },
  { key: "transport", name: "Транспорт", color: "#03A9F4", env: "LIVING" },
  { key: "utilities", name: "Комуналка і звʼязок", color: "#607D8B", env: "LIVING" },
  { key: "health", name: "Медицина", color: "#E91E63", env: "LIVING" },
  { key: "clothing", name: "Одяг", color: "#9C27B0", env: "LIVING" },
  { key: "home", name: "Дім і побут", color: "#795548", env: "LIVING" },
  { key: "kids", name: "Дитина", color: "#FFC107", env: "LIVING" },
  { key: "fun", name: "Розваги", color: "#F44336", env: "LIVING" },
  { key: "subscriptions", name: "Підписки", color: "#3F51B5", env: "LIVING" },
  { key: "misc", name: "Інше", color: "#9E9E9E", env: "LIVING" },
  { key: "cats", name: "Коти", color: "#8D6E63", env: "LIVING" },
  { key: "cosmetics", name: "Косметика", color: "#F06292", env: "LIVING" },
];

// MCC → категорія
const MCC_RULES: { mcc: number; cat: string; env?: Envelope; priority?: number }[] = [
  { mcc: 5411, cat: "groceries" },      // супермаркети
  { mcc: 5499, cat: "groceries" },      // продуктові
  { mcc: 5812, cat: "cafe" },           // ресторани
  { mcc: 5814, cat: "cafe" },           // фастфуд
  { mcc: 5813, cat: "fun" },            // бари
  { mcc: 5541, cat: "transport" },      // АЗС
  { mcc: 5542, cat: "transport" },      // АЗС автомат
  { mcc: 4111, cat: "transport" },      // транспорт
  { mcc: 4121, cat: "transport" },      // таксі
  { mcc: 5912, cat: "health" },         // аптеки
  { mcc: 8011, cat: "health" },         // лікарі
  { mcc: 5651, cat: "clothing" },       // одяг
  { mcc: 5691, cat: "clothing" },       // одяг
  { mcc: 5641, cat: "kids" },           // дитячий одяг
  { mcc: 5945, cat: "kids" },           // іграшки
  { mcc: 5200, cat: "home" },           // товари для дому
  { mcc: 5211, cat: "home" },           // будматеріали
  { mcc: 7832, cat: "fun" },            // кіно
  { mcc: 5815, cat: "subscriptions" },  // цифровий контент
  { mcc: 4899, cat: "utilities" },      // ТБ/інтернет
  { mcc: 4814, cat: "utilities" },      // телеком
  { mcc: 5995, cat: "cats" },           // зоомагазини
  { mcc: 742, cat: "cats" },            // 0742 ветеринари (числово 742)
  { mcc: 5977, cat: "cosmetics" },      // косметика
  { mcc: 7230, cat: "cosmetics" },      // перукарні/бʼюті
  { mcc: 7298, cat: "cosmetics" },      // спа
];

async function main() {
  await prisma.settings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });

  for (const r of RENAMES) {
    await prisma.category.updateMany({ where: { name: r.from }, data: { name: r.to } });
  }

  const idByKey = new Map<string, string>();
  for (const c of CATEGORIES) {
    const existing = await prisma.category.findFirst({ where: { name: c.name } });
    const row = existing
      ? existing
      : await prisma.category.create({
          data: { name: c.name, color: c.color, defaultEnvelope: c.env, isSystem: true },
        });
    idByKey.set(c.key, row.id);
  }

  for (const r of MCC_RULES) {
    const catId = idByKey.get(r.cat)!;
    const exists = await prisma.categoryRule.findFirst({ where: { mcc: r.mcc } });
    if (exists) continue;
    await prisma.categoryRule.create({
      data: {
        priority: r.priority ?? 50,
        mcc: r.mcc,
        resultCategoryId: catId,
        resultEnvelope: r.env ?? null,
      },
    });
  }

  console.log(`Seeded ${CATEGORIES.length} categories, ${MCC_RULES.length} MCC rules.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });

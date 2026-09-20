# FinTrack — модель даних

Принципи:
- Усі суми — `BigInt` у **мінімальних одиницях** (копійки/центи). Ніяких float для грошей.
- Знак `amount`: **від'ємний = витрата**, додатний = надходження (як у Mono).
- Валюта — ISO 4217 числовий (`980`=UAH, `840`=USD). Базова — UAH.
- Час зберігаємо в UTC; цикли/ліміти рахуємо в `Europe/Kyiv`.
- Конверт (`envelope`) і категорія (`category`) — **два незалежні виміри**: категорія =
  «на що» (продукти, кафе), конверт = «з якого бюджету» (побут/розваги/…).

## ER — сутності та зв'язки

```
User 1──* MonoToken 1──* Account 1──* Transaction *──1 Category
User 1──* PushSubscription                         *──1 Cycle
Account(kind=JAR, isGoals) ──* Goal 1──* GoalAllocation *──0..1 Transaction
Cycle 1──1 CycleClosure                  GoalAllocation ──0..1 transferGroupId
Cycle 1──* InvestmentContribution
CategoryRule (глобальні правила автокатегоризації)
Holding 1──* PriceSnapshot        FxRate (курс НБУ)      Settings (singleton)
Notification (лог сповіщень)
```

## Prisma-схема

```prisma
// ─────────── Користувачі та доступ ───────────
model User {
  id            String   @id @default(cuid())
  email         String   @unique
  passwordHash  String
  displayName   String
  createdAt     DateTime @default(now())

  monoTokens    MonoToken[]
  pushSubs      PushSubscription[]
  transactions  Transaction[]        // хто витратив (nullable з боку транзакції)
}

model MonoToken {
  id            String   @id @default(cuid())
  ownerId       String
  owner         User     @relation(fields: [ownerId], references: [id])
  tokenEnc      String   // AES-GCM шифр персонального токена
  clientId      String?  // з client-info
  clientName    String?
  webhookSecret String   @default(cuid()) // у шляху webhook: /mono/hook/:secret
  lastPolledAt  DateTime?
  createdAt     DateTime @default(now())

  accounts      Account[]
}

// ─────────── Рахунки (mono + віртуальні) ───────────
enum AccountKind { CARD JAR CASH }

model Account {
  id            String      @id @default(cuid())
  monoId        String?     @unique       // id рахунку/банки з Mono
  monoTokenId   String?
  monoToken     MonoToken?  @relation(fields: [monoTokenId], references: [id])
  kind          AccountKind
  isGoals       Boolean     @default(false) // банка-контейнер «Цілі»
  title         String
  currencyCode  Int         @default(980)
  iban          String?
  maskedPan     String[]    @default([])
  balance       BigInt      @default(0)     // останній відомий баланс
  createdAt     DateTime    @default(now())

  transactions  Transaction[]
  goals         Goal[]
}

// ─────────── Транзакції ───────────
enum TxSource   { MONO CASH }
enum Envelope   { LIVING ENTERTAINMENT INVESTMENT INCOME INTERNAL_TRANSFER GOAL_CONTRIBUTION UNCATEGORIZED }

model Transaction {
  id             String    @id @default(cuid())
  monoId         String?   @unique          // StatementItem.id → дедуп між токенами
  source         TxSource
  accountId      String
  account        Account   @relation(fields: [accountId], references: [id])
  userId         String?                    // хто витратив; null = спільна/невідомо
  user           User?     @relation(fields: [userId], references: [id])

  time           DateTime
  amount         BigInt                     // signed, копійки
  currencyCode   Int       @default(980)
  operationAmt   BigInt?                    // у валюті операції
  balance        BigInt?                    // баланс рахунку після операції (Mono)
  description    String
  comment        String?
  mcc            Int?
  originalMcc    Int?
  counterName    String?
  counterIban    String?
  counterEdrpou  String?
  cashbackAmount BigInt    @default(0)
  commissionRate BigInt    @default(0)
  hold           Boolean   @default(false)  // не остаточна (авторизація)

  categoryId     String?
  category       Category? @relation(fields: [categoryId], references: [id])
  envelope       Envelope  @default(UNCATEGORIZED)
  isIncome       Boolean   @default(false)  // підтверджений дохід (запускає правило)
  needsReview    Boolean   @default(false)  // невпевнена категорія / конверт / особа
  autoCategorized Boolean  @default(false)

  cycleId        String?
  cycle          Cycle?    @relation(fields: [cycleId], references: [id])
  goalAllocation GoalAllocation?

  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  @@index([time])
  @@index([cycleId, envelope])
  @@index([userId])
  @@index([categoryId])
}

// ─────────── Категорії та правила ───────────
model Category {
  id              String   @id @default(cuid())
  name            String
  icon            String?
  color           String?
  parentId        String?
  parent          Category?  @relation("CatTree", fields: [parentId], references: [id])
  children        Category[] @relation("CatTree")
  defaultEnvelope Envelope   @default(LIVING)
  isSystem        Boolean    @default(false)

  transactions    Transaction[]
  rules           CategoryRule[]
}

// правила застосовуються за priority (менше = раніше); перший збіг виграє
model CategoryRule {
  id               String   @id @default(cuid())
  priority         Int      @default(100)
  mcc              Int?                     // збіг за MCC
  merchantPattern  String?                  // ILIKE по description/counterName
  amountMin        BigInt?
  amountMax        BigInt?
  resultCategoryId String
  resultCategory   Category @relation(fields: [resultCategoryId], references: [id])
  resultEnvelope   Envelope?                // якщо null → defaultEnvelope категорії
  enabled          Boolean  @default(true)
  createdAt        DateTime @default(now())

  @@index([priority])
}

// ─────────── Бюджетні цикли ───────────
enum CycleStatus { ACTIVE CLOSED }

model Cycle {
  id             String      @id @default(cuid())
  startDate      DateTime                     // прихід основної частини доходу
  expectedEnd    DateTime                     // start + період (для денного ліміту)
  endDate        DateTime?                    // фактичний кінець (коли відкрито наступний)
  status         CycleStatus @default(ACTIVE)
  triggeredByTxId String?    @unique

  // знімок відсотків на момент циклу (правила можуть змінюватись)
  pctInvestment  Int         @default(15)
  pctEntertainment Int       @default(15)
  pctLiving      Int         @default(70)

  transactions   Transaction[]
  contributions  InvestmentContribution[]
  closure        CycleClosure?

  @@index([startDate])
}
// incomeTotal, *Budget — обчислювані (див. нижче), не зберігаємо, щоб не розсинхронити.

model CycleClosure {
  id                String   @id @default(cuid())
  cycleId           String   @unique
  cycle             Cycle    @relation(fields: [cycleId], references: [id])
  leftoverAmount    BigInt                     // невитрачений побут
  toGoalsAmount     BigInt   @default(0)
  toInvestmentAmount BigInt  @default(0)
  decidedById       String?
  decidedAt         DateTime @default(now())
}

// ─────────── Цілі (в банці «Цілі») ───────────
enum GoalStatus { ACTIVE COMPLETED ARCHIVED }

model Goal {
  id            String    @id @default(cuid())
  accountId     String                        // банка-контейнер (isGoals=true)
  account       Account   @relation(fields: [accountId], references: [id])
  title         String
  description   String?
  targetAmount  BigInt
  deadline      DateTime?
  status        GoalStatus @default(ACTIVE)
  sortOrder     Int        @default(0)
  createdAt     DateTime   @default(now())

  allocations   GoalAllocation[]
}
// currentAmount = sum(allocations.amount); progress = current/target;
// completed коли current >= target.

model GoalAllocation {
  id              String   @id @default(cuid())
  goalId          String
  goal            Goal     @relation(fields: [goalId], references: [id])
  amount          BigInt                       // signed: + внесок, − вивід/переказ
  sourceTxId      String?  @unique             // транзакція-поповнення банки
  sourceTx        Transaction? @relation(fields: [sourceTxId], references: [id])
  transferGroupId String?                      // переказ між цілями = 2 записи (±)
  note            String?
  createdAt       DateTime @default(now())

  @@index([goalId])
  @@index([transferGroupId])
}

// ─────────── Інвестиції ───────────
enum ContribSource { RULE_15PCT LEFTOVER MANUAL }

model InvestmentContribution {
  id            String        @id @default(cuid())
  cycleId       String?
  cycle         Cycle?        @relation(fields: [cycleId], references: [id])
  amountUah     BigInt
  amountUsd     BigInt?                        // якщо купували в USD
  date          DateTime      @default(now())
  source        ContribSource @default(MANUAL)
  note          String?
}

// Фаза 3 — вартість портфеля
model Holding {
  id          String  @id @default(cuid())
  ticker      String  @unique                  // напр. VOO / CSPX
  quantity    Decimal @default(0)
  avgPriceUsd Decimal @default(0)
  snapshots   PriceSnapshot[]
}
model PriceSnapshot {
  id        String   @id @default(cuid())
  holdingId String
  holding   Holding  @relation(fields: [holdingId], references: [id])
  date      DateTime
  priceUsd  Decimal
  @@unique([holdingId, date])
}
model FxRate {
  id        String   @id @default(cuid())
  code      Int                                // 840 = USD
  date      DateTime
  rateToUah Decimal
  @@unique([code, date])
}

// ─────────── Сповіщення ───────────
enum NotifType { INCOME_ARRIVED DAILY_LIMIT_EXCEEDED OVERSPEND_FORECAST CYCLE_END EVENING_REVIEW }

model PushSubscription {
  id       String @id @default(cuid())
  userId   String
  user     User   @relation(fields: [userId], references: [id])
  endpoint String @unique
  p256dh   String
  auth     String
}
model Notification {
  id           String    @id @default(cuid())
  type         NotifType
  userId       String?                          // null = обом
  payload      Json
  sentAt       DateTime  @default(now())
  readAt       DateTime?
  actionAt     DateTime?
}

// ─────────── Налаштування (singleton) ───────────
model Settings {
  id                 Int     @id @default(1)
  pctInvestment      Int     @default(15)
  pctEntertainment   Int     @default(15)
  pctLiving          Int     @default(70)
  incomeThreshold    BigInt  @default(500000)   // ≥5000грн → кандидат у дохід
  cycleAnchorMin     BigInt  @default(4000000)  // ≥40000грн → відкриває цикл (налаштовується)
  cyclePeriodDays    Int     @default(31)
  eveningReminder    String  @default("21:00")
  timezone           String  @default("Europe/Kyiv")
  baseCurrency       Int     @default(980)
}
```

## Обчислювана логіка (не зберігаємо — рахуємо, щоб не розсинхронити)

### Приналежність до циклу
Транзакція належить циклу, у чий `[startDate, endDate ?? +∞)` потрапляє `time`.

### Доходи та бюджети конвертів (кумулятивно за цикл)
```
incomeTotal(cycle)        = Σ tx.amount   де tx.isIncome && tx.cycleId=cycle
investmentBudget(cycle)   = incomeTotal * pctInvestment / 100
entertainmentBudget(cycle)= incomeTotal * pctEntertainment / 100
livingBudget(cycle)       = incomeTotal * pctLiving / 100
```
Менші частини доходу теж `isIncome` → просто додає до `incomeTotal` (бюджети ростуть).
**Велику** частину (≥ `cycleAnchorMin`) обробляємо як тригер нового циклу.

### Витрати по конвертах
```
livingSpent(cycle)        = Σ |tx.amount|  де envelope=LIVING && amount<0 && cycle
entertainmentSpent(cycle) = Σ |tx.amount|  де envelope=ENTERTAINMENT && amount<0 && cycle
```

### Денний ліміт на побут (самовирівнювання)
```
daysLeft   = max(1, днів від сьогодні до (endDate ?? expectedEnd) включно, у Kyiv)
dailyLimit = max(0, (livingBudget − livingSpent)) / daysLeft
spentToday = Σ |tx.amount| де envelope=LIVING && amount<0 && date(tx)=сьогодні
safeToday  = dailyLimit − spentToday        // головна цифра дашборду
```

### «Треба відкласти/купити» (після підтвердження доходу)
```
toInvest        = investmentBudget − Σ InvestmentContribution.amountUah(cycle)
toEntertainment = entertainmentBudget − (переказано в розваги за цикл)
```

### Прогноз перевитрати (для превентивного пушу)
```
runRate   = livingSpent / днів_що_минули_в_циклі
projected = runRate * усього_днів_у_циклі
якщо projected > livingBudget → OVERSPEND_FORECAST
```

### Детекція доходу (правила + підтвердження)
Вхідна (`amount>0`) транзакція на CARD, не внутрішній переказ:
- `amount ≥ incomeThreshold` → `needsReview=true`, кандидат у дохід (пуш на підтвердження).
- Підтвердження користувачем → `isIncome=true`, перерахунок бюджетів.
- `amount ≥ cycleAnchorMin` і немає активного релевантного циклу → **відкрити новий цикл**
  (закрити попередній: `endDate = startDate_new − 1s`, `status=CLOSED`, порахувати leftover).

### Внутрішні перекази / поповнення «Цілей»
Якщо `counterIban`/рахунок-отримувач — власний рахунок або банка «Цілі»:
- `envelope=INTERNAL_TRANSFER` (не дохід, не витрата бюджету);
- переказ у банку «Цілі» → створити чернетку `GoalAllocation` (пуш: «розподіли між цілями»).

### Закриття циклу
При відкритті нового: `leftover = max(0, livingBudget − livingSpent)` попереднього.
Якщо `>0` → пуш `CYCLE_END`, користувач вручну ділить `leftover` між
`toGoalsAmount` та `toInvestmentAmount` → `CycleClosure` +
(`InvestmentContribution` та/або `GoalAllocation`).

### Автокатегоризація (пайплайн на вхідну транзакцію)
```
1. Правила CategoryRule за priority: перший збіг (mcc / merchantPattern ILIKE / amount range)
   → categoryId + envelope(resultEnvelope ?? category.defaultEnvelope), autoCategorized=true.
2. Немає збігу, але MCC відомий → мапа MCC→категорія (системна), needsReview=true.
3. Нічого → envelope=UNCATEGORIZED, needsReview=true → у вечірній розбір.
```

### Атрибуція особи
`userId = власник токена`, чий webhook доставив транзакцію. Якщо той самий `monoId`
приходить від обох токенів → дедуп, `userId=null`, `needsReview=true`. Готівка — `userId`
з форми. Завжди перевизначувано вручну.

## Крайові випадки
- **Повернення (refund)**: `amount>0` з тим самим мерчантом/категорією → не дохід;
  зменшує `Spent` відповідного конверта (бо amount додатний → у сумі |amount| не входить;
  окремо: refund зараховуємо як від'ємну витрату в тому ж конверті).
- **Hold-транзакції**: показуємо, але денний ліміт рахуємо по фактичних (`hold=false`);
  оновлюємо коли прийде фінальна (той самий потік, mono надсилає оновлення).
- **Мультивалютна витрата**: `amount` у валюті рахунку (UAH), `operationAmt` — оригінал.
- **Скасований/подвійний webhook**: дедуп за `monoId` (unique) робить вставку ідемпотентною.
```

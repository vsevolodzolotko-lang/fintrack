import { prisma } from "../db.js";
import { decryptToken } from "../crypto.js";
import { getClientInfo, getStatement, type MonoClientInfo } from "./client.js";
import { ingestStatementItem } from "./ingest.js";

// Синхронізувати рахунки/банки токена з client-info (створити/оновити Account).
export async function syncAccounts(tokenId: string, info?: MonoClientInfo) {
  const token = await prisma.monoToken.findUnique({ where: { id: tokenId } });
  if (!token) return;
  const ci = info ?? (await getClientInfo(decryptToken(token.tokenEnc)));

  await prisma.monoToken.update({
    where: { id: tokenId },
    data: { clientId: ci.clientId, clientName: ci.name, lastPolledAt: new Date() },
  });

  for (const a of ci.accounts) {
    await prisma.account.upsert({
      where: { monoId: a.id },
      update: {
        balance: BigInt(a.balance),
        currencyCode: a.currencyCode,
        iban: a.iban,
        maskedPan: a.maskedPan ?? [],
        // isHidden is intentionally excluded — user-set flag must not be overwritten by sync
      },
      create: {
        monoId: a.id,
        monoTokenId: tokenId,
        kind: "CARD",
        title: `${a.type} ${a.currencyCode === 980 ? "UAH" : a.currencyCode}`,
        currencyCode: a.currencyCode,
        iban: a.iban,
        maskedPan: a.maskedPan ?? [],
        balance: BigInt(a.balance),
      },
    });
  }

  for (const j of ci.jars ?? []) {
    await prisma.account.upsert({
      where: { monoId: j.id },
      update: { balance: BigInt(j.balance), title: j.title },
      create: {
        monoId: j.id,
        monoTokenId: tokenId,
        kind: "JAR",
        isGoals: true, // банки трактуємо як контейнер «Цілі»
        title: j.title,
        currencyCode: j.currencyCode,
        balance: BigInt(j.balance),
      },
    });
  }
}

// Періодичний пул: оновити баланси/банки по всіх токенах.
// Rate limit 1 req/60s на токен — тому пул рідше, ніж раз на хвилину на токен.
export async function pollAllTokens() {
  const tokens = await prisma.monoToken.findMany();
  for (const t of tokens) {
    try {
      await syncAccounts(t.id);
    } catch (e) {
      // напр. MONO_RATE_LIMIT — пропускаємо до наступного тіку
      console.warn(`poll token ${t.id} failed:`, (e as Error).message);
    }
  }
}

// Зняти застряглі hold: Mono НЕ шле webhook при фіналізації блокування,
// тож поки висять hold-транзакції — переопитуємо виписку за їхнє вікно
// (ingestStatementItem при дублі monoId оновить hold і суми).
// Вікно обмежене maxAgeDays, щоб не ганяти 31-денні виписки щогодини.
export async function refreshHolds(maxAgeDays = 10): Promise<void> {
  const oldest = await prisma.transaction.findFirst({
    where: { hold: true, source: "MONO" },
    orderBy: { time: "asc" },
    select: { time: true },
  });
  if (!oldest) return;
  const now = Math.floor(Date.now() / 1000);
  const fromTs = Math.max(
    Math.floor(oldest.time.getTime() / 1000) - 3600,
    now - maxAgeDays * 86_400,
  );
  const tokens = await prisma.monoToken.findMany({ select: { id: true } });
  for (const t of tokens) {
    await syncStatements(t.id, fromTs, now);
  }
}

// Завантажити виписку за весь tokenId за period днів.
// Запускати в background — між рахунками чекаємо 62с (rate limit 1 req/60s).
export async function syncStatements(tokenId: string, fromTs: number, toTs: number): Promise<number> {
  const token = await prisma.monoToken.findUnique({ where: { id: tokenId } });
  if (!token) return 0;
  const rawToken = decryptToken(token.tokenEnc);

  const accounts = await prisma.account.findMany({
    where: { monoTokenId: tokenId, monoId: { not: null } },
    select: { monoId: true },
  });

  let total = 0;
  for (let i = 0; i < accounts.length; i++) {
    const monoId = accounts[i].monoId!;
    if (i > 0) await new Promise((r) => setTimeout(r, 62_000)); // rate limit
    try {
      const items = await getStatement(rawToken, monoId, fromTs, toTs);
      for (const item of items) {
        const result = await ingestStatementItem(monoId, item);
        if (result?.created) total++;
      }
    } catch (e) {
      console.warn(`syncStatements account ${monoId} failed:`, (e as Error).message);
    }
  }
  return total;
}

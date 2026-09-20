import type { Envelope, IncomeKind } from "@prisma/client";
import { prisma, getSettings } from "../db.js";
import { categorize } from "./categorize.js";
import { findCycleForDate } from "./cycle.js";
import type { MonoStatementItem } from "./client.js";

// Ідемпотентна обробка StatementItem (з webhook або з пулу виписки).
// Дедуп за monoId. Повертає створену/існуючу транзакцію (id) або null, якщо дубль.
export async function ingestStatementItem(
  monoAccountId: string,
  item: MonoStatementItem
): Promise<{ id: string; created: boolean } | null> {
  const account = await prisma.account.findUnique({ where: { monoId: monoAccountId } });
  if (!account) {
    // невідомий рахунок — можливо, ще не синхронізували client-info
    return null;
  }

  // дедуп; повторний item з тим самим id — зазвичай фіналізація hold:
  // блокування зняли, у виписці прийшло остаточне списання. Оновлюємо
  // hold і грошові поля (сума при списанні може відрізнятись від блокування),
  // категоризацію/особу не чіпаємо — їх могли вже виправити вручну.
  const existing = await prisma.transaction.findUnique({ where: { monoId: item.id } });
  if (existing) {
    if (existing.hold && !(item.hold ?? false)) {
      await prisma.transaction.update({
        where: { id: existing.id },
        data: {
          hold: false,
          amount: BigInt(item.amount),
          operationAmt: BigInt(item.operationAmount ?? 0),
          balance: BigInt(item.balance ?? 0),
          cashbackAmount: BigInt(item.cashbackAmount ?? 0),
          commissionRate: BigInt(item.commissionRate ?? 0),
        },
      });
    }
    return { id: existing.id, created: false };
  }

  const amount = BigInt(item.amount);
  const time = new Date(item.time * 1000);
  const settings = await getSettings();

  // особа — власник токена рахунку (може бути null для CASH/спільних)
  const monoToken = account.monoTokenId
    ? await prisma.monoToken.findUnique({ where: { id: account.monoTokenId } })
    : null;
  let userId = monoToken?.ownerId ?? null;

  // внутрішній переказ? (отримувач — власний рахунок)
  let isInternal = false;
  if (item.counterIban) {
    const own = await prisma.account.findFirst({ where: { iban: item.counterIban } });
    if (own) isInternal = true;
  }

  let envelope: Envelope = "UNCATEGORIZED";
  let categoryId: string | null = null;
  let needsReview = false;
  let autoCategorized = false;
  let isIncome = false;

  let incomeKind: IncomeKind | null = null;

  if (settings.goalsAccountId && account.id === settings.goalsAccountId) {
    // Рахунок-контейнер «Цілі»: нічого не категоризуємо, не рахуємо як побут/дохід.
    envelope = "GOAL_CONTRIBUTION";
  } else if (isInternal) {
    envelope = "INTERNAL_TRANSFER";
    // Переказ між своїми рахунками — єдиний тип, що визначається без питань
    // (по counterIban), тож у черзі не висить.
    if (amount > 0n) incomeKind = "SELF_TRANSFER";
  } else if (amount > 0n) {
    // Надходження → у чергу на вибір типу. Порогу НЕМА свідомо: колишній
    // settings.incomeThreshold (5 000 ₴) ховав дрібні надходження з черги,
    // через що вони лишались isIncome=false і не давали зобов'язань 15/15/70.
    envelope = "INCOME";
    needsReview = true;
  } else {
    // витрата → автокатегоризація
    const cat = await categorize({
      mcc: item.mcc,
      description: item.description,
      counterName: item.counterName,
      amount,
    });
    categoryId = cat.categoryId;
    envelope = cat.envelope;
    needsReview = cat.needsReview;
    autoCategorized = cat.autoCategorized;

    // Спільний рахунок (2+ картки): API Monobank не каже, чия картка платила
    // (перевірено 2026-07-12, див. спеку) — атрибуція лише вручну в Review.
    if (account.maskedPan.length > 1) {
      userId = null;
      needsReview = true;
    }
  }

  const cycle = await findCycleForDate(time);

  const tx = await prisma.transaction.create({
    data: {
      monoId: item.id,
      source: "MONO",
      accountId: account.id,
      userId,
      time,
      amount,
      currencyCode: item.currencyCode,
      operationAmt: BigInt(item.operationAmount ?? 0),
      balance: BigInt(item.balance ?? 0),
      description: item.description,
      comment: item.comment ?? null,
      mcc: item.mcc,
      originalMcc: item.originalMcc,
      counterName: item.counterName ?? null,
      counterIban: item.counterIban ?? null,
      counterEdrpou: item.counterEdrpou ?? null,
      cashbackAmount: BigInt(item.cashbackAmount ?? 0),
      commissionRate: BigInt(item.commissionRate ?? 0),
      hold: item.hold ?? false,
      categoryId,
      envelope,
      isIncome,
      incomeKind,
      needsReview,
      autoCategorized,
      cycleId: cycle?.id ?? null,
    },
  });

  // оновити останній відомий баланс рахунку
  if (item.balance != null) {
    await prisma.account.update({
      where: { id: account.id },
      data: { balance: BigInt(item.balance) },
    });
  }

  return { id: tx.id, created: true };
}

import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { encryptToken } from "../crypto.js";
import { env } from "../env.js";
import { requireAuth, currentUserId } from "../auth.js";
import { getClientInfo, setWebhook } from "../mono/client.js";
import { syncAccounts, pollAllTokens, syncStatements } from "../mono/sync.js";

// Керування Mono-токенами (з автентифікацією). Префікс /api/mono.
export async function monoRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  // Додати персональний токен: перевірити, зашифрувати, синхронізувати, повісити webhook.
  app.post("/tokens", async (req, reply) => {
    const parsed = z.object({ token: z.string().min(10) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid" });
    const userId = currentUserId(req);

    // валідуємо токен реальним запитом
    let info;
    try {
      info = await getClientInfo(parsed.data.token);
    } catch (e) {
      return reply.code(400).send({ error: "mono_token_invalid", detail: (e as Error).message });
    }

    const created = await prisma.monoToken.create({
      data: {
        ownerId: userId,
        tokenEnc: encryptToken(parsed.data.token),
        clientId: info.clientId,
        clientName: info.name,
        // Секрет у публічному шляху вебхука — криптовипадковий, не cuid зі схеми.
        webhookSecret: randomBytes(24).toString("hex"),
      },
    });

    await syncAccounts(created.id, info);

    // зареєструвати webhook
    const webHookUrl = `${env.publicBaseUrl}/mono/hook/${created.webhookSecret}`;
    try {
      await setWebhook(parsed.data.token, webHookUrl);
    } catch (e) {
      req.log.warn({ err: e }, "setWebhook failed (можна повторити пізніше)");
    }

    return { id: created.id, clientName: info.name, webHookUrl };
  });

  app.get("/tokens", async (req) => {
    const userId = currentUserId(req);
    const tokens = await prisma.monoToken.findMany({
      where: { ownerId: userId },
      select: { id: true, clientName: true, lastPolledAt: true, createdAt: true },
    });
    return tokens;
  });

  app.delete("/tokens/:id", async (req) => {
    const { id } = req.params as { id: string };
    await prisma.monoToken.deleteMany({ where: { id, ownerId: currentUserId(req) } });
    return { ok: true };
  });

  // Рахунки (карти + банки)
  app.get("/accounts", async () => {
    return prisma.account.findMany({
      select: {
        id: true, kind: true, isGoals: true, title: true,
        currencyCode: true, balance: true, maskedPan: true,
      },
    });
  });

  // Ручний пул (оновити баланси/банки зараз)
  app.post("/poll", async () => {
    await pollAllTokens();
    return { ok: true };
  });

  // Імпорт виписки за останні N днів (запускається у фоні, відразу повертає 202)
  app.post("/sync-history", async (req, reply) => {
    const parsed = z.object({ days: z.number().int().min(1).max(31).default(30) }).safeParse(req.body);
    const days = parsed.success ? parsed.data.days : 30;
    const toTs = Math.floor(Date.now() / 1000);
    const fromTs = toTs - days * 86400;

    const tokens = await prisma.monoToken.findMany({ where: { ownerId: currentUserId(req) } });
    // запускаємо у фоні — не чекаємо завершення
    for (const t of tokens) {
      syncStatements(t.id, fromTs, toTs).then((n) => {
        console.log(`syncStatements token ${t.id}: imported ${n} txs`);
      }).catch((e) => console.error("syncStatements failed:", e));
    }
    return reply.code(202).send({ ok: true, message: `Синхронізація запущена (до ${days} днів)` });
  });
}

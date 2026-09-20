import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { ingestStatementItem } from "../mono/ingest.js";
import type { MonoStatementItem } from "../mono/client.js";

// Публічні webhook-ендпоінти Monobank (без автентифікації, захист — секрет у шляху).
// Реєструється з префіксом /mono.
export async function webhookRoutes(app: FastifyInstance) {
  // Mono валідує URL GET-запитом — маємо відповісти 200.
  app.get("/hook/:secret", async (req, reply) => {
    const { secret } = req.params as { secret: string };
    const token = await prisma.monoToken.findUnique({ where: { webhookSecret: secret } });
    if (!token) return reply.code(404).send();
    return reply.code(200).send({ ok: true });
  });

  app.post("/hook/:secret", async (req, reply) => {
    const { secret } = req.params as { secret: string };
    const token = await prisma.monoToken.findUnique({ where: { webhookSecret: secret } });
    if (!token) return reply.code(404).send();

    const body = req.body as {
      type?: string;
      data?: { account?: string; statementItem?: MonoStatementItem };
    };

    if (body?.type === "StatementItem" && body.data?.account && body.data.statementItem) {
      try {
        await ingestStatementItem(body.data.account, body.data.statementItem);
      } catch (e) {
        // не повертаємо помилку Mono, щоб уникнути ретраїв-штормів; логуємо
        req.log.error({ err: e }, "webhook ingest failed");
      }
    }
    // Завжди 200 — Mono очікує підтвердження отримання.
    return reply.code(200).send({ ok: true });
  });
}

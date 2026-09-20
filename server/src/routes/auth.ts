import argon2 from "argon2";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth } from "../auth.js";

const credsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

// Підбір пароля: логін і реєстрація — не більше 10 спроб на хвилину з однієї IP.
// Решта API за сесією, там ліміт не потрібен.
const authRateLimit = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };

export async function authRoutes(app: FastifyInstance) {
  // Реєстрація дозволена лише поки користувачів < 2 (застосунок на двох).
  app.post("/register", authRateLimit, async (req, reply) => {
    const parsed = credsSchema.extend({ displayName: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const count = await prisma.user.count();
    if (count >= 2) return reply.code(403).send({ error: "registration_closed" });

    const { email, password, displayName } = parsed.data;
    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) return reply.code(409).send({ error: "email_taken" });

    const passwordHash = await argon2.hash(password);
    const user = await prisma.user.create({ data: { email, passwordHash, displayName } });
    req.session.userId = user.id;
    return { id: user.id, email: user.email, displayName: user.displayName };
  });

  app.post("/login", authRateLimit, async (req, reply) => {
    const parsed = credsSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid" });

    const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    if (!user || !(await argon2.verify(user.passwordHash, parsed.data.password))) {
      return reply.code(401).send({ error: "invalid_credentials" });
    }
    req.session.userId = user.id;
    return { id: user.id, email: user.email, displayName: user.displayName };
  });

  app.post("/logout", async (req) => {
    await new Promise<void>((resolve) => req.session.destroy(() => resolve()));
    return { ok: true };
  });

  app.get("/me", { preHandler: requireAuth }, async (req) => {
    const user = await prisma.user.findUnique({
      where: { id: req.session.userId! },
      select: { id: true, email: true, displayName: true },
    });
    return user;
  });
}

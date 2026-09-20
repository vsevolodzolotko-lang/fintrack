import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { requireAuth } from "../auth.js";

export async function userRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  // Пара користувачів — для перемикача «хто витратив» на фронті.
  app.get("/", async () => {
    return prisma.user.findMany({
      select: { id: true, displayName: true },
      orderBy: { createdAt: "asc" },
    });
  });
}

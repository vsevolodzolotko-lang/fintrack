import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma, getSettings } from "../db.js";
import { requireAuth } from "../auth.js";
import { estimateCycleEnd } from "../mono/cycle.js";

export async function settingsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.get("/", async () => getSettings());

  app.patch("/", async (req, reply) => {
    const parsed = z.object({
      salaryDayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
      goalsAccountId: z.string().nullable().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid" });
    const { salaryDayOfMonth, goalsAccountId } = parsed.data;

    if (goalsAccountId != null) {
      const acc = await prisma.account.findUnique({ where: { id: goalsAccountId } });
      if (!acc) return reply.code(400).send({ error: "unknown_account" });
    }

    await getSettings(); // гарантує існування рядка id=1
    const s = await prisma.settings.update({
      where: { id: 1 },
      data: {
        ...(salaryDayOfMonth !== undefined ? { salaryDayOfMonth } : {}),
        ...(goalsAccountId !== undefined ? { goalsAccountId } : {}),
      },
    });

    // Переоцінка кінця циклу лише коли міняли день ЗП.
    if (salaryDayOfMonth !== undefined) {
      const active = await prisma.cycle.findFirst({ where: { status: "ACTIVE" }, orderBy: { startDate: "desc" } });
      if (active) {
        await prisma.cycle.update({
          where: { id: active.id },
          data: { expectedEnd: estimateCycleEnd(active.startDate, salaryDayOfMonth) },
        });
      }
    }
    return s;
  });
}

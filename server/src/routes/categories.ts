import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth } from "../auth.js";

const ENVELOPES = [
  "LIVING", "INVESTMENT", "INCOME",
  "INTERNAL_TRANSFER", "GOAL_CONTRIBUTION", "UNCATEGORIZED",
] as const;

export async function categoryRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.get("/", async () => prisma.category.findMany({ orderBy: { name: "asc" } }));

  app.post("/", async (req, reply) => {
    const parsed = z.object({
      name: z.string().min(1),
      icon: z.string().optional(),
      color: z.string().optional(),
      defaultEnvelope: z.enum(ENVELOPES).default("LIVING"),
      parentId: z.string().nullable().optional(),
      plannedAmount: z.number().positive().nullable().optional(), // грн
      reserveUpfront: z.boolean().optional(),
      radialSlot: z.number().int().min(0).max(6).nullable().optional(),
      radialOrder: z.number().int().optional(),
      shortName: z.string().nullable().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid" });
    const d = parsed.data;
    return prisma.category.create({
      data: {
        name: d.name,
        icon: d.icon,
        color: d.color,
        defaultEnvelope: d.defaultEnvelope,
        parentId: d.parentId ?? null,
        plannedAmount: d.plannedAmount != null ? BigInt(Math.round(d.plannedAmount * 100)) : null,
        reserveUpfront: d.reserveUpfront ?? false,
        radialSlot: d.radialSlot ?? null,
        radialOrder: d.radialOrder ?? 100,
        shortName: d.shortName ?? null,
      },
    });
  });

  app.patch("/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = z.object({
      name: z.string().min(1).optional(),
      color: z.string().optional(),
      plannedAmount: z.number().positive().nullable().optional(), // грн; null = скинути план
      reserveUpfront: z.boolean().optional(),
      radialSlot: z.number().int().min(0).max(6).nullable().optional(),
      radialOrder: z.number().int().optional(),
      shortName: z.string().nullable().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid" });
    const d = parsed.data;
    return prisma.category.update({
      where: { id },
      data: {
        ...(d.name !== undefined ? { name: d.name } : {}),
        ...(d.color !== undefined ? { color: d.color } : {}),
        ...(d.plannedAmount !== undefined
          ? { plannedAmount: d.plannedAmount != null ? BigInt(Math.round(d.plannedAmount * 100)) : null }
          : {}),
        ...(d.reserveUpfront !== undefined ? { reserveUpfront: d.reserveUpfront } : {}),
        ...(d.radialSlot !== undefined ? { radialSlot: d.radialSlot } : {}),
        ...(d.radialOrder !== undefined ? { radialOrder: d.radialOrder } : {}),
        ...(d.shortName !== undefined ? { shortName: d.shortName } : {}),
      },
    });
  });

  // Видалити категорію: її транзакції повертаються в розбір (needsReview),
  // MCC-правила зникають каскадно, categoryId у транзакцій — SetNull (схема).
  app.delete("/:id", async (req) => {
    const { id } = req.params as { id: string };
    await prisma.$transaction([
      prisma.transaction.updateMany({ where: { categoryId: id }, data: { needsReview: true } }),
      prisma.category.delete({ where: { id } }),
    ]);
    return { ok: true };
  });

  // Правила автокатегоризації
  app.get("/rules", async () =>
    prisma.categoryRule.findMany({ orderBy: { priority: "asc" }, include: { resultCategory: true } })
  );

  app.post("/rules", async (req, reply) => {
    const parsed = z.object({
      priority: z.number().int().default(100),
      mcc: z.number().int().nullable().optional(),
      merchantPattern: z.string().nullable().optional(),
      amountMin: z.number().nullable().optional(),
      amountMax: z.number().nullable().optional(),
      resultCategoryId: z.string(),
      resultEnvelope: z.enum(ENVELOPES).nullable().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid" });
    const d = parsed.data;
    return prisma.categoryRule.create({
      data: {
        priority: d.priority,
        mcc: d.mcc ?? null,
        merchantPattern: d.merchantPattern ?? null,
        amountMin: d.amountMin != null ? BigInt(Math.round(d.amountMin * 100)) : null,
        amountMax: d.amountMax != null ? BigInt(Math.round(d.amountMax * 100)) : null,
        resultCategoryId: d.resultCategoryId,
        resultEnvelope: d.resultEnvelope ?? null,
      },
    });
  });

  app.delete("/rules/:id", async (req) => {
    const { id } = req.params as { id: string };
    await prisma.categoryRule.delete({ where: { id } });
    return { ok: true };
  });
}

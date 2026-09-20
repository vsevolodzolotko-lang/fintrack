import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

// Singleton налаштувань (id=1). Створює дефолт, якщо немає.
export async function getSettings() {
  return prisma.settings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });
}

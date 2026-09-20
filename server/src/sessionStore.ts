import type { SessionStore } from "@fastify/session";
import { prisma } from "./db.js";

const TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 днів

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const prismaSessionStore = {
  get(sessionId: string, callback: (err: Error | null, session?: any) => void) {
    prisma.session
      .findFirst({ where: { id: sessionId, expiresAt: { gt: new Date() } } })
      .then((s: { data: string } | null) => callback(null, s ? JSON.parse(s.data) : null))
      .catch((e: Error) => callback(e));
  },

  set(sessionId: string, session: any, callback: (err?: Error) => void) {
    const expiresAt = new Date(Date.now() + TTL_MS);
    prisma.session
      .upsert({
        where: { id: sessionId },
        update: { data: JSON.stringify(session), expiresAt },
        create: { id: sessionId, data: JSON.stringify(session), expiresAt },
      })
      .then(() => callback())
      .catch((e: Error) => callback(e));
  },

  destroy(sessionId: string, callback: (err?: Error) => void) {
    prisma.session
      .deleteMany({ where: { id: sessionId } })
      .then(() => callback())
      .catch((e: Error) => callback(e));
  },
} as unknown as SessionStore;

import type { FastifyReply, FastifyRequest } from "fastify";

// Розширення типів сесії
declare module "@fastify/session" {
  interface FastifySessionObject {
    userId?: string;
  }
}

// preHandler: вимагає автентифікації
export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  if (!req.session.userId) {
    reply.code(401).send({ error: "unauthorized" });
  }
}

export function currentUserId(req: FastifyRequest): string {
  const id = req.session.userId;
  if (!id) throw new Error("no session");
  return id;
}

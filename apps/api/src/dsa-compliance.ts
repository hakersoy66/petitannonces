import { randomUUID } from "node:crypto";
import { prisma } from "@pa/database";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

export async function registerDsaComplianceRoutes(app: FastifyInstance) {
  app.post("/dsa/notices", async (request, reply) => {
    const parsed = z.object({
      reporterEmail: z.string().email().optional(),
      targetType: z.enum(["LISTING","USER","MESSAGE","STORE","OTHER"]),
      targetId: z.string().min(1).max(120),
      contentUrl: z.string().url().optional(),
      legalBasis: z.string().trim().max(1000).optional(),
      explanation: z.string().trim().min(20).max(5000),
      goodFaithDeclaration: z.literal(true),
    }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_notice", details: parsed.error.flatten() });
    const id = randomUUID();
    const reference = `DSA-${Date.now().toString(36).toUpperCase()}-${id.slice(0, 6).toUpperCase()}`;
    const d = parsed.data;
    await prisma.$executeRawUnsafe(`INSERT INTO "DsaIllegalContentNotice" ("id","reference","reporterEmail","targetType","targetId","contentUrl","legalBasis","explanation","goodFaithDeclaration") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE)`, id, reference, d.reporterEmail ?? null, d.targetType, d.targetId, d.contentUrl ?? null, d.legalBasis ?? null, d.explanation);
    return reply.code(201).send({ notice: { id, reference, status: "RECEIVED" } });
  });

  app.get("/dsa/notices/:reference", async (request, reply) => {
    const parsed = z.object({ reference: z.string().min(5).max(100) }).safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_reference" });
    const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT "reference","status","decision","decisionReason","receivedAt","decidedAt" FROM "DsaIllegalContentNotice" WHERE "reference"=$1 LIMIT 1`, parsed.data.reference);
    if (!rows[0]) return reply.code(404).send({ error: "notice_not_found" });
    return reply.send({ notice: rows[0] });
  });
}

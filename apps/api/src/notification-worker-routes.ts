import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { processNotificationOutbox } from "./notification-worker.js";

export async function registerNotificationWorkerRoutes(app: FastifyInstance) {
  app.post("/internal/notifications/deliver", async (request, reply) => {
    const configured = process.env.INTERNAL_CRON_SECRET;
    if (!configured) return reply.code(503).send({ error: "internal_cron_not_configured" });
    const supplied = request.headers["x-internal-cron-secret"];
    if (typeof supplied !== "string" || supplied !== configured) return reply.code(401).send({ error: "unauthorized" });
    const parsed = z.object({ batchSize: z.number().int().min(1).max(100).optional() }).safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const result = await processNotificationOutbox(parsed.data.batchSize);
    return reply.send(result);
  });
}

import net from "node:net";
import { prisma } from "@pa/database";
import type { FastifyInstance } from "fastify";

async function checkDatabase() {
  const startedAt = Date.now();
  await prisma.$queryRaw`SELECT 1`;
  return { ok: true, latencyMs: Date.now() - startedAt };
}

async function checkRedisTcp() {
  const raw = process.env.REDIS_URL;
  if (!raw) return { ok: true, skipped: true };
  const url = new URL(raw);
  const host = url.hostname;
  const port = Number(url.port || 6379);
  const startedAt = Date.now();

  return await new Promise<{ ok: boolean; latencyMs?: number; error?: string }>((resolve) => {
    const socket = net.createConnection({ host, port });
    const finish = (result: { ok: boolean; latencyMs?: number; error?: string }) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(1200);
    socket.once("connect", () => finish({ ok: true, latencyMs: Date.now() - startedAt }));
    socket.once("timeout", () => finish({ ok: false, error: "timeout" }));
    socket.once("error", (error) => finish({ ok: false, error: error.message }));
  });
}

export async function registerHealthRoutes(app: FastifyInstance) {
  app.get("/health/live", async () => ({
    status: "ok",
    service: "petitannonces-api",
    version: process.env.APP_VERSION ?? "dev",
    timestamp: new Date().toISOString(),
  }));

  app.get("/health/ready", async (_request, reply) => {
    const checks: Record<string, unknown> = {};
    let ready = true;

    try {
      checks.database = await checkDatabase();
    } catch (error) {
      ready = false;
      checks.database = { ok: false, error: error instanceof Error ? error.message : "unknown_error" };
    }

    const redis = await checkRedisTcp();
    checks.redis = redis;
    if (!redis.ok && process.env.REQUIRE_REDIS_READY === "true") ready = false;

    return reply.code(ready ? 200 : 503).send({
      status: ready ? "ready" : "not_ready",
      service: "petitannonces-api",
      version: process.env.APP_VERSION ?? "dev",
      checks,
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/health", async (_request, reply) => reply.redirect("/health/ready"));
}

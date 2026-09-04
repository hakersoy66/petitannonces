import cookie from "@fastify/cookie";
import Fastify from "fastify";
import { registerAccountRoutes } from "./account.js";
import { registerAuthRoutes } from "./auth.js";
import { registerListingRoutes } from "./listings.js";
import { requireAdminRoles } from "./rbac.js";
import { registerSecurityRoutes } from "./security.js";

const app = Fastify({
  logger: true,
  trustProxy: true,
  bodyLimit: 1024 * 1024,
});

await app.register(cookie);

app.get("/health", async () => ({
  status: "ok",
  service: "petitannonces-api",
  timestamp: new Date().toISOString(),
}));

await registerAuthRoutes(app);
await registerAccountRoutes(app);
await registerSecurityRoutes(app);
await registerListingRoutes(app);

app.get(
  "/admin/session-check",
  { preHandler: requireAdminRoles(["SUPER_ADMIN", "ADMIN", "MODERATOR", "SUPPORT", "FINANCE", "COMPLIANCE", "MARKETING"]) },
  async () => ({ authorized: true }),
);

const port = Number(process.env.API_PORT ?? 4000);

try {
  await app.listen({ port, host: "0.0.0.0" });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

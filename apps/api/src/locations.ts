import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { lookupFrenchPostalCode } from "./geocoding.js";

export async function registerLocationRoutes(app: FastifyInstance) {
  app.get("/locations/postal-code/:postalCode", async (request, reply) => {
    const parsed = z.object({ postalCode: z.string().regex(/^\d{5}$/) }).safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_postal_code" });
    const cities = await lookupFrenchPostalCode(parsed.data.postalCode);
    if (!cities.length) return reply.code(404).send({ error: "postal_code_not_found", cities: [] });
    return reply.send({ postalCode: parsed.data.postalCode, cities });
  });
}

import { createHmac } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdminRoles } from "./rbac.js";

// CDA partner UAT is intentionally isolated from publication.
// Never embed provider credentials in an HTTP response, browser bundle, or source control.
const CDA_UAT_BASE = "https://annonces-preprod.i-cad.fr/";
const consumerId = 21;
const adminOnly = requireAdminRoles(["SUPER_ADMIN", "ADMIN", "COMPLIANCE"]);
const cdaEnabled = () => process.env.CDA_UAT_ENABLED === "true";
const cdaReady = () => cdaEnabled() && Boolean(process.env.CDA_SECRET?.trim());

const professionalNumber = z.object({
  proNumberType: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  proNumber: z.string().trim().min(6).max(15),
}).superRefine(({ proNumberType, proNumber }, ctx) => {
  const valid = proNumberType === 1 ? /^\d{14,15}$/.test(proNumber)
    : proNumberType === 4 ? /^W\d{9}$/.test(proNumber)
    : /^[A-Za-z0-9]{6}$/.test(proNumber);
  if (!valid) ctx.addIssue({ code: "custom", message: "invalid_professional_identifier", path: ["proNumber"] });
});

const identification = z.object({
  isInsert: z.boolean(),
  insert: z.string().trim().min(8).max(30).optional(),
  tatou: z.string().trim().min(4).max(30).optional(),
}).refine(v => v.isInsert ? Boolean(v.insert && !v.tatou) : Boolean(v.tatou && !v.insert), {
  message: "choose_one_identification_method",
});

const animal = z.object({
  identification,
  species: z.union([z.literal(1), z.literal(2)]), // CDA handles dogs and cats only.
  sex: z.enum(["M", "F"]),
  birthDate: z.string().trim().min(4).max(20),
  isLoofLof: z.boolean(),
  race: z.string().trim().min(1).max(120),
});

const owner = z.discriminatedUnion("type", [
  z.object({ type: z.literal(1), firstName: z.string().trim().min(1).max(100), lastName: z.string().trim().min(1).max(100) }),
  z.object({
    type: z.literal(2),
    proNumberType: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    proNumber: z.string().trim().min(6).max(15),
    numberOfBreedingFemale: z.number().int().min(0).max(100000).optional(),
    numberOfLitter: z.number().int().min(0).max(100000).optional(),
  }),
]);

const checkData = z.object({
  operationType: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  data: z.object({ animal, owner }),
}).superRefine(({ operationType, data }, ctx) => {
  const isIndividual = data.owner.type === 1;
  if (isIndividual && operationType !== 1) ctx.addIssue({code:"custom",message:"private_persons_cannot_sell",path:["operationType"]});
  if (data.owner.type === 2) {
    const professional = professionalNumber.safeParse(data.owner);
    if (!professional.success) ctx.addIssue({code:"custom",message:"invalid_professional_identifier",path:["data","owner","proNumber"]});
    if (operationType === 3 && (data.owner.numberOfBreedingFemale === undefined || data.owner.numberOfLitter === undefined)) {
      ctx.addIssue({code:"custom",message:"breeding_counts_required",path:["data","owner"]});
    }
  }
});

type CdaResponse = {
  success: boolean;
  data?: { id?: string; tel?: string; mail?: string };
  error?: number;
  message?: string;
};

function encode64(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

function signJwt(payload: Record<string, unknown>) {
  const secret = process.env.CDA_SECRET?.trim();
  if (!secret) throw new Error("cda_not_configured");
  const header = encode64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = encode64(JSON.stringify(payload));
  const bodyToSign = header + "." + body;
  const signature = createHmac("sha256", secret).update(bodyToSign).digest("base64url");
  return bodyToSign + "." + signature;
}

async function callCda(path: "checkPro" | "checkData" | "contactValidation" | "ownerValidation", payload: Record<string, unknown>): Promise<CdaResponse> {
  if (!cdaReady()) throw new Error("cda_not_configured");
  const response = await fetch(new URL(path, CDA_UAT_BASE), {
    method: "POST",
    headers: { "content-type": "application/json", "accept": "application/json" },
    body: JSON.stringify({token: signJwt({ consumerId, ...payload })}),
    signal: AbortSignal.timeout(12000),
    redirect: "error",
  });
  if (!response.ok) return { success: false, error: response.status === 403 ? 403 : 503, message: "Le service CDA n'est pas disponible." };
  const result: unknown = await response.json();
  const parsed = z.object({
    success: z.boolean(),
    data: z.object({ id:z.string().uuid().optional(), tel:z.string().max(100).optional(), mail:z.string().max(200).optional() }).passthrough().optional(),
    error: z.number().int().optional(),
    message: z.string().max(1000).optional(),
  }).safeParse(result);
  if (!parsed.success) return { success:false, error:503, message:"Réponse du service CDA invalide." };
  const { success, error, message } = parsed.data;
  return { success, error, message, data: parsed.data.data && {
    id: parsed.data.data.id, tel: parsed.data.data.tel, mail: parsed.data.data.mail,
  }};
}

const id = z.object({ id: z.string().uuid() });
const contact = z.object({ id:z.string().uuid(), contactType:z.union([z.literal(1),z.literal(2)]), scope:z.enum(["professional","listing"]) });
const code = z.object({ id:z.string().uuid(), code:z.string().trim().min(4).max(12), scope:z.enum(["professional","listing"]) });

// Simple per-host backstop for accidental bursts during UAT. All endpoints are
// administrator-only, and production deployment cannot switch this on implicitly.
const recentCalls = new Map<string, number>();
function permit(key: string) {
  const now = Date.now();
  if ((recentCalls.get(key) ?? 0) > now - 3000) return false;
  recentCalls.set(key, now);
  if (recentCalls.size > 1000) recentCalls.clear();
  return true;
}

export function registerCdaPreproductionRoutes(app: FastifyInstance) {
  app.get("/admin/integrations/cda-uat", { preHandler: adminOnly }, async () => ({
    available: cdaReady(), environment: "preproduction", consumerId,
    supportedSpecies: ["chien", "chat"], productionPublicationEnabled: false,
  }));

  app.post("/admin/integrations/cda-uat/check-pro", { preHandler: adminOnly }, async (request, reply) => {
    const parsed = professionalNumber.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_professional_identifier" });
    if (!cdaReady()) return reply.code(503).send({ error:"cda_not_configured" });
    if (!permit(request.ip)) return reply.code(429).send({ error:"cda_rate_limit" });
    try { return reply.send(await callCda("checkPro", parsed.data)); }
    catch { return reply.code(502).send({ error: "cda_unavailable" }); }
  });

  app.post("/admin/integrations/cda-uat/check-data", { preHandler: adminOnly }, async (request, reply) => {
    const parsed = checkData.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_animal_verification_data", issues: parsed.error.issues.map(x => x.message) });
    if (!cdaReady()) return reply.code(503).send({ error:"cda_not_configured" });
    if (!permit(request.ip)) return reply.code(429).send({ error:"cda_rate_limit" });
    try { return reply.send(await callCda("checkData", parsed.data)); }
    catch { return reply.code(502).send({ error: "cda_unavailable" }); }
  });

  app.post("/admin/integrations/cda-uat/contact", { preHandler: adminOnly }, async (request, reply) => {
    const parsed = contact.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    if (parsed.data.scope === "professional" && parsed.data.contactType !== 1) {
      return reply.code(422).send({ error:"professional_email_only" });
    }
    if (!cdaReady()) return reply.code(503).send({ error:"cda_not_configured" });
    if (!permit(request.ip)) return reply.code(429).send({ error:"cda_rate_limit" });
    try { return reply.send(await callCda("contactValidation", { data: { id:parsed.data.id, contactType:parsed.data.contactType } })); }
    catch { return reply.code(502).send({ error:"cda_unavailable" }); }
  });

  app.post("/admin/integrations/cda-uat/validate", { preHandler: adminOnly }, async (request, reply) => {
    const parsed = code.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    if (!cdaReady()) return reply.code(503).send({ error:"cda_not_configured" });
    if (!permit(request.ip)) return reply.code(429).send({ error:"cda_rate_limit" });
    try { return reply.send(await callCda("ownerValidation", { data: { id:parsed.data.id, code:parsed.data.code } })); }
    catch { return reply.code(502).send({ error:"cda_unavailable" }); }
  });
}

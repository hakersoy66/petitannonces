import { createHmac } from "node:crypto";
import { prisma } from "@pa/database";
import type { FastifyInstance } from "fastify";
import { enforceAuthRateLimit } from "./auth-rate-limit.js";
import { z } from "zod";
import { checkData } from "./cda-uat.js";
import { requireListingUser } from "./listing-auth.js";

// Preparation is deliberately not a CDA approval. No live-animal listing may
// be published until official production access and the full workflow exist.
// Store a keyed fingerprint only: no owner's name, microchip, tattoo or DOB.
const paramsSchema = z.object({ id: z.string().min(1).max(100) });
const MAX_PREPARATION_AGE_DAYS = 30;
const ALLOWED = new Map([["chiens", 1], ["chats", 2]] as const);

export function cdaListingCategory(species: number, slug: string): boolean {
  return ALLOWED.get(slug as "chiens" | "chats") === species;
}

export function cdaListingFingerprint(key: string, listingId: string, sellerId: string, payload: z.infer<typeof checkData>): string {
  if (!key) throw new Error("cda_preparation_key_unavailable");
  return createHmac("sha256", key)
    .update(JSON.stringify({ listingId, sellerId, operationType: payload.operationType, data: payload.data }))
    .digest("hex");
}

export async function ensureCdaListingSchema() {
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "CdaListingPreparation" (
    "listingId" TEXT PRIMARY KEY REFERENCES "Listing"("id") ON DELETE CASCADE,
    "sellerId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "categoryId" TEXT NOT NULL REFERENCES "Category"("id"),
    "species" SMALLINT NOT NULL CHECK ("species" IN (1,2)),
    "operationType" SMALLINT NOT NULL CHECK ("operationType" BETWEEN 1 AND 4),
    "payloadFingerprint" VARCHAR(64) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PREPARED' CHECK ("status" = 'PREPARED'),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "expiresAt" TIMESTAMPTZ NOT NULL
  )`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "CdaListingPreparation_seller_idx"
    ON "CdaListingPreparation" ("sellerId", "updatedAt" DESC)`);
  // Retain only current preparations; never accumulate expired identity fingerprints.
  await prisma.$executeRawUnsafe(`DELETE FROM "CdaListingPreparation" WHERE "expiresAt" < NOW()`);
}

type Preparation = {
  listingId: string;
  species: number;
  operationType: number;
  status: "PREPARED";
  updatedAt: Date;
  expiresAt: Date;
};

async function eligibleListing(id: string, sellerId: string) {
  return prisma.listing.findFirst({
    where: { id, sellerId, status: "DRAFT" },
    select: { id: true, sellerId: true, categoryId: true, category: { select: { slug: true, domain: true } } },
  });
}

export async function registerCdaListingRoutes(app: FastifyInstance) {
  await ensureCdaListingSchema();

  app.get("/listings/:id/cda", async (request, reply) => {
    const user = await requireListingUser(request, reply); if (!user) return;
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_listing_id" });
    const listing = await eligibleListing(params.data.id, user.id);
    if (!listing) return reply.code(404).send({ error: "draft_not_found" });
    if (listing.category.domain !== "ANIMAL" || !ALLOWED.has(listing.category.slug as "chiens" | "chats"))
      return reply.code(422).send({ error: "cda_dogs_cats_only" });

    const rows = await prisma.$queryRawUnsafe<Preparation[]>(
      `SELECT "listingId","species","operationType","status","updatedAt","expiresAt"
       FROM "CdaListingPreparation"
       WHERE "listingId"=$1 AND "sellerId"=$2 AND "categoryId"=$3 AND "expiresAt">NOW() LIMIT 1`,
      listing.id, user.id, listing.categoryId,
    );
    const row = rows[0];
    return reply.send({
      status: row ? "PREPARED" : "NOT_STARTED",
      // Prepared locally is NEVER a verified ownership or publication claim.
      verified: false,
      officialVerificationAvailable: false,
      productionPublicationEnabled: false,
      ...(row ? { operationType: row.operationType, species: row.species, preparedAt: row.updatedAt, expiresAt: row.expiresAt } : {}),
    });
  });

  app.post("/listings/:id/cda/prepare", async (request, reply) => {
    const user = await requireListingUser(request, reply); if (!user) return;
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_listing_id" });
    const listing = await eligibleListing(params.data.id, user.id);
    if (!listing) return reply.code(404).send({ error: "draft_not_found" });
    if (listing.category.domain !== "ANIMAL" || !ALLOWED.has(listing.category.slug as "chiens" | "chats"))
      return reply.code(422).send({ error: "cda_dogs_cats_only" });
    const body = checkData.safeParse(request.body);
    if (!body.success) return reply.code(400).send({
      error: "invalid_cda_data", issues: body.error.issues.map(issue => ({ path: issue.path, code: issue.message })),
    });
    if (!cdaListingCategory(body.data.data.animal.species, listing.category.slug))
      return reply.code(422).send({ error: "animal_species_category_mismatch" });
    if (body.data.data.owner.type === 2 && user.kind !== "PROFESSIONNEL")
      return reply.code(403).send({ error: "professional_account_required" });
    // Never persist secrets or raw I-CAD identity data. This record is a
    // non-authorizing preparation; production verification must recheck.
    const key = process.env.ADMIN_CONFIG_ENCRYPTION_KEY;
    if (!key) return reply.code(503).send({ error: "cda_preparation_unavailable" });
    if (!(await enforceAuthRateLimit({request, reply, action:"cda_listing_prepare", identity:user.id,
      limit:12, windowMs:15*60*1000, blockMs:15*60*1000}))) return;
    const digest = cdaListingFingerprint(key, listing.id, user.id, body.data);
    const expiresAt = new Date(Date.now() + MAX_PREPARATION_AGE_DAYS * 86_400_000);
    const written = await prisma.$executeRawUnsafe(`INSERT INTO "CdaListingPreparation"
      ("listingId","sellerId","categoryId","species","operationType","payloadFingerprint","expiresAt")
      SELECT "id","sellerId","categoryId",$4,$5,$6,$7
      FROM "Listing" WHERE "id"=$1 AND "sellerId"=$2 AND "categoryId"=$3 AND "status"='DRAFT'
      ON CONFLICT ("listingId") DO UPDATE SET
      "sellerId"=EXCLUDED."sellerId","categoryId"=EXCLUDED."categoryId",
      "species"=EXCLUDED."species","operationType"=EXCLUDED."operationType",
      "payloadFingerprint"=EXCLUDED."payloadFingerprint",
      "status"='PREPARED',"updatedAt"=NOW(),"expiresAt"=EXCLUDED."expiresAt"`,
      listing.id, user.id, listing.categoryId, body.data.data.animal.species, body.data.operationType, digest, expiresAt,
    );
    if (!written) return reply.code(409).send({ error: "draft_changed" });
    return reply.send({
      prepared: true, verified: false, status: "PREPARED", expiresAt,
      productionPublicationEnabled: false,
      nextStep: "await_official_cda_production_access",
    });
  });

  app.post("/listings/:id/cda/verify", async (request, reply) => {
    const user = await requireListingUser(request, reply); if (!user) return;
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_listing_id" });
    if (!await eligibleListing(params.data.id, user.id)) return reply.code(404).send({ error: "draft_not_found" });
    // Never fall back to UAT for public accounts. Add the production provider
    // contract and verified consent/OTP state machine only after I-CAD approval.
    return reply.code(503).send({ error: "cda_production_not_authorized", verified: false });
  });
}

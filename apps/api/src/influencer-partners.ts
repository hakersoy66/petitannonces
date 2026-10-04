import { prisma } from '@pa/database';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdminRoles } from './rbac.js';

const access = requireAdminRoles(['SUPER_ADMIN', 'ADMIN', 'MARKETING']);
const platform = z.enum(['instagram', 'tiktok', 'youtube', 'facebook']);
const partnerStatus = z.enum(['PROSPECT', 'NEGOTIATING', 'PARTNER', 'ARCHIVED']);
const campaignStatus = z.enum(['DRAFT', 'NEGOTIATING', 'SCHEDULED', 'ACTIVE', 'COMPLETED', 'CANCELLED']);
const paymentStatus = z.enum(['UNPAID', 'PENDING', 'PAID']);
const url = z.union([z.string().trim().url().refine(x => /^https:\/\//.test(x)), z.literal('')]);
const partnerFields = z.object({
  platform: platform.optional(), handle: z.string().trim().toLowerCase().regex(/^@?[a-z0-9._-]{2,38}$/).optional(),
  email: z.union([z.string().trim().email(), z.literal('')]).optional(),
  followers: z.number().int().min(0).max(1000000000).optional(),
  averageViews: z.number().int().min(0).max(1000000000).optional(),
  franceAudiencePercent: z.number().min(0).max(100).nullable().optional(),
  suggestedFeeMinor: z.number().int().min(0).max(100000000).optional(),
  notes: z.string().trim().max(4000).optional(), status: partnerStatus.optional(),
});
const campaignFields = z.object({
  title: z.string().trim().min(3).max(160).optional(),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{2,49}$/).optional(),
  status: campaignStatus.optional(),
  deliverables: z.string().trim().max(1500).optional(),
  contentUrl: url.optional(),
  feeMinor: z.number().int().min(0).max(100000000).optional(),
  paymentStatus: paymentStatus.optional(),
  publishedAt: z.union([z.string().datetime({ offset: true }), z.literal('')]).optional(),
  reportedViews: z.number().int().min(0).max(1000000000).optional(),
  reportedLikes: z.number().int().min(0).max(1000000000).optional(),
  proofUrl: url.optional(),
  notes: z.string().trim().max(4000).optional(),
});
const idSchema = z.object({ id: z.string().uuid() });
const slugSchema = z.object({ slug: z.string().regex(/^[a-z0-9][a-z0-9-]{2,49}$/) });

type Row = Record<string, unknown>;
const int = (value: unknown) => Number(value ?? 0);
function serialize(row: Row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === 'bigint' ? Number(value) : value]));
}
const partnerColumns: Record<string, string> = {
  platform: 'platform', handle: 'handle', email: 'email', followers: 'followers',
  averageViews: 'averageViews', franceAudiencePercent: 'franceAudiencePercent',
  suggestedFeeMinor: 'suggestedFeeMinor', notes: 'notes', status: 'status',
};
const campaignColumns: Record<string, string> = {
  title: 'title', slug: 'slug', status: 'status', deliverables: 'deliverables',
  contentUrl: 'contentUrl', feeMinor: 'feeMinor', paymentStatus: 'paymentStatus',
  publishedAt: 'publishedAt', reportedViews: 'reportedViews', reportedLikes: 'reportedLikes',
  proofUrl: 'proofUrl', notes: 'notes',
};
function updateSql(table: string, columns: Record<string, string>, id: string, data: Record<string, unknown>) {
  const entries = Object.entries(data).filter(([k, v]) => k in columns && v !== undefined);
  if (!entries.length) return null;
  const values = entries.map(([k, v]) => (k === 'email' || k === 'contentUrl' || k === 'proofUrl' || k === 'publishedAt') && v === '' ? null : v);
  const sets = entries.map(([k], i) => `"${columns[k]}"=$${i + 1}`);
  const sql = `UPDATE "${table}" SET ${sets.join(', ')}, "updatedAt"=NOW() WHERE "id"=$${entries.length + 1} RETURNING *`;
  return { sql, params: [...values, id] };
}

// Attribution : seuls les événements présents dans SiteAnalyticsSession (soumis au consentement)
// sont employés; nouveaux comptes et annonces sont estimés sur une fenêtre de 30 jours.
const campaignReport = `
SELECT c.*, p."handle" AS "partnerHandle", p."platform" AS "platform",
 (SELECT COUNT(DISTINCT s."visitorId")::int FROM "SiteAnalyticsSession" s
  WHERE s."trafficCampaign" = 'inf-' || c."slug") AS "visitorsConsented",
 (SELECT COUNT(DISTINCT s."userId")::int FROM "SiteAnalyticsSession" s
  JOIN "User" u ON u."id"=s."userId"
  WHERE s."trafficCampaign"='inf-' || c."slug" AND s."userId" IS NOT NULL
    AND u."createdAt" >= (s."startedAt" AT TIME ZONE 'UTC') - INTERVAL '1 hour'
    AND u."createdAt" <= (s."startedAt" AT TIME ZONE 'UTC') + INTERVAL '30 days') AS "registrationsEstimated",
 (SELECT COUNT(DISTINCT l."id")::int FROM "SiteAnalyticsSession" s
   JOIN "Listing" l ON l."sellerId"=s."userId"
   WHERE s."trafficCampaign"='inf-' || c."slug" AND s."userId" IS NOT NULL
     AND l."publishedAt" IS NOT NULL
     AND l."publishedAt" >= (s."startedAt" AT TIME ZONE 'UTC')
     AND l."publishedAt" <= (s."startedAt" AT TIME ZONE 'UTC') + INTERVAL '30 days') AS "publishedListingsEstimated"
FROM "InfluencerCampaign" c JOIN "InfluencerPartner" p ON p."id"=c."partnerId"
ORDER BY c."createdAt" DESC`;

export async function registerInfluencerPartnerRoutes(app: FastifyInstance) {
  app.get('/admin/influencers', { preHandler: access }, async () => {
    const partners = await prisma.$queryRawUnsafe<Row[]>('SELECT * FROM "InfluencerPartner" ORDER BY "createdAt" DESC');
    const campaigns = await prisma.$queryRawUnsafe<Row[]>(campaignReport);
    const safeCampaigns = campaigns.map(serialize);
    return {
      partners: partners.map(serialize), campaigns: safeCampaigns,
      summary: {
        partners: partners.length, campaigns: safeCampaigns.length,
        budgetMinor: safeCampaigns.reduce((n, x) => n + int(x.feeMinor), 0),
        clicksRaw: safeCampaigns.reduce((n, x) => n + int(x.clickCount), 0),
        visitorsConsented: safeCampaigns.reduce((n, x) => n + int(x.visitorsConsented), 0),
        registrationsEstimated: safeCampaigns.reduce((n, x) => n + int(x.registrationsEstimated), 0),
        publishedListingsEstimated: safeCampaigns.reduce((n, x) => n + int(x.publishedListingsEstimated), 0),
      },
      definitions: {
        clicksRaw: 'Clics bruts; robots et consultations répétées possibles. Aucune IP enregistrée.',
        visitorsConsented: 'Visiteurs distincts par campagne parmi les sessions Analytics consenties, non dédupliqués entre campagnes.',
        registrationsEstimated: 'Comptes créés à proximité de leur première visite attribuée (30 jours); estimation et non preuve de causalité.',
        publishedListingsEstimated: 'Annonces publiées dans les 30 jours suivant une session attribuée; estimation.',
        paymentStatus: 'Statut administratif uniquement; aucun virement déclenché.',
      },
    };
  });
  app.post('/admin/influencers', { preHandler: access }, async (request, reply) => {
    const parsed = partnerFields.extend({ platform: platform, handle: z.string().trim().toLowerCase().regex(/^@?[a-z0-9._-]{2,38}$/) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_partner', details: parsed.error.flatten() });
    const x = parsed.data;
    try {
      const rows = await prisma.$queryRawUnsafe<Row[]>(`INSERT INTO "InfluencerPartner" ("platform","handle","email","followers","averageViews","franceAudiencePercent","suggestedFeeMinor","notes","status") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        x.platform, x.handle.replace(/^@/, ''), x.email || null, x.followers ?? 0, x.averageViews ?? 0,
        x.franceAudiencePercent ?? null, x.suggestedFeeMinor ?? 0, x.notes ?? null, x.status ?? 'PROSPECT');
      return reply.code(201).send({ partner: serialize(rows[0] ?? {}) });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2010') return reply.code(409).send({ error: 'partner_conflict_or_db_error' });
      throw error;
    }
  });
  app.patch('/admin/influencers/:id', { preHandler: access }, async (request, reply) => {
    const params = idSchema.safeParse(request.params), body = partnerFields.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'invalid_partner' });
    const x: Record<string, unknown> = { ...body.data };
    if (typeof x.handle === 'string') x.handle = x.handle.replace(/^@/, '');
    const change = updateSql('InfluencerPartner', partnerColumns, params.data.id, x);
    if (!change) return reply.code(400).send({ error: 'no_changes' });
    const rows = await prisma.$queryRawUnsafe<Row[]>(change.sql, ...change.params);
    if (!rows.length) return reply.code(404).send({ error: 'partner_not_found' });
    return { partner: serialize(rows[0]!) };
  });
  app.post('/admin/influencers/:id/campaigns', { preHandler: access }, async (request, reply) => {
    const params = idSchema.safeParse(request.params), body = campaignFields.extend({ title: z.string().trim().min(3).max(160), slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{2,49}$/) }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'invalid_campaign' });
    const x = body.data;
    const rows = await prisma.$queryRawUnsafe<Row[]>('SELECT "id" FROM "InfluencerPartner" WHERE "id"=$1', params.data.id);
    if (!rows.length) return reply.code(404).send({ error: 'partner_not_found' });
    try {
      const inserted = await prisma.$queryRawUnsafe<Row[]>(`INSERT INTO "InfluencerCampaign" ("partnerId","title","slug","status","deliverables","feeMinor","paymentStatus","notes") VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        params.data.id, x.title, x.slug, 'DRAFT', x.deliverables ?? null, x.feeMinor ?? 0, 'UNPAID', x.notes ?? null);
      return reply.code(201).send({ campaign: serialize(inserted[0] ?? {}) });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2010') return reply.code(409).send({ error: 'campaign_slug_conflict_or_db_error' });
      throw error;
    }
  });
  app.patch('/admin/influencer-campaigns/:id', { preHandler: access }, async (request, reply) => {
    const params = idSchema.safeParse(request.params), body = campaignFields.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'invalid_campaign' });
    const change = updateSql('InfluencerCampaign', campaignColumns, params.data.id, body.data);
    if (!change) return reply.code(400).send({ error: 'no_changes' });
    const rows = await prisma.$queryRawUnsafe<Row[]>(change.sql, ...change.params);
    if (!rows.length) return reply.code(404).send({ error: 'campaign_not_found' });
    return { campaign: serialize(rows[0]!) };
  });
  // Le lien /r/:slug consigne uniquement un compteur agrégé, jamais l'IP, les cookies ou le user-agent.
  app.get('/partners/resolve/:slug', async (request, reply) => {
    const params = slugSchema.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: 'not_found' });
    const rows = await prisma.$queryRawUnsafe<Row[]>(`UPDATE "InfluencerCampaign" c SET "clickCount"=c."clickCount"+1
      FROM "InfluencerPartner" p WHERE c."partnerId"=p."id" AND c."slug"=$1 AND c."status"='ACTIVE' AND p."status"<>'ARCHIVED'
      RETURNING c."slug",p."platform"`, params.data.slug);
    reply.header('Cache-Control', 'no-store, max-age=0');
    if (!rows.length) return reply.code(404).send({ error: 'campaign_not_active' });
    return { source: String(rows[0]?.platform ?? 'instagram'), medium: 'influencer', campaign: `inf-${params.data.slug}` };
  });
}

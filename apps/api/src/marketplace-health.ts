import { prisma } from '@pa/database';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdminRoles } from './rbac.js';

const roles = ['SUPER_ADMIN', 'ADMIN', 'FINANCE', 'MARKETING', 'SUPPORT', 'MODERATOR', 'COMPLIANCE'] as const;
const fields = ['visitors','sessions','registrations','listings','importedListings','publishedListings','buyerMessages','sellerMessages','buyerConversations','paidOrders','gmvMinor'] as const;
type Field = typeof fields[number];
type ReportDay = {day: string} & Record<Field,number>;
// Business timestamps are UTC without a timezone; traffic sessions are timestamptz.
// Normalize all dates to the Europe/Paris calendar day.
const reportSql = [
  "WITH dates AS (SELECT generate_series((NOW() AT TIME ZONE 'Europe/Paris')::date - (($1::int * 2) - 1), (NOW() AT TIME ZONE 'Europe/Paris')::date, interval '1 day')::date AS day)," ,
  "traffic AS (SELECT (s.\"startedAt\" AT TIME ZONE 'Europe/Paris')::date AS day, COUNT(DISTINCT s.\"visitorId\")::int AS visitors, COUNT(*)::int AS sessions FROM \"SiteAnalyticsSession\" s WHERE s.\"startedAt\" >= NOW() - (($1::int * 2 + 2) * interval '1 day') GROUP BY 1),",
  "registrations AS (SELECT (u.\"createdAt\" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Paris')::date AS day,COUNT(*)::int AS registrations FROM \"User\" u WHERE u.\"createdAt\" >= (NOW() AT TIME ZONE 'UTC') - (($1::int * 2 + 2) * interval '1 day') GROUP BY 1),",
  "ads AS (SELECT (l.\"createdAt\" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Paris')::date AS day, COUNT(*)::int AS listings, COUNT(*) FILTER (WHERE EXISTS(SELECT 1 FROM \"ListingImportLog\" li WHERE li.\"listingId\"=l.\"id\"))::int AS imported FROM \"Listing\" l WHERE l.\"createdAt\" >= (NOW() AT TIME ZONE 'UTC') - (($1::int * 2 + 2) * interval '1 day') GROUP BY 1),",
  "published AS (SELECT (l.\"publishedAt\" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Paris')::date AS day,COUNT(*)::int AS published FROM \"Listing\" l WHERE l.\"publishedAt\" >= (NOW() AT TIME ZONE 'UTC') - (($1::int * 2 + 2) * interval '1 day') GROUP BY 1),",
  "messages AS (SELECT (m.\"createdAt\" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Paris')::date AS day,COUNT(*) FILTER (WHERE m.\"senderId\"=c.\"buyerId\")::int AS buyer_messages,COUNT(*) FILTER(WHERE m.\"senderId\"=c.\"sellerId\")::int AS seller_messages,COUNT(DISTINCT CASE WHEN m.\"senderId\"=c.\"buyerId\" THEN c.\"id\" END)::int AS buyer_chats FROM \"Message\" m JOIN \"Conversation\" c ON c.\"id\"=m.\"conversationId\" WHERE m.\"createdAt\" >= (NOW() AT TIME ZONE 'UTC') - (($1::int * 2 + 2) * interval '1 day') GROUP BY 1),",
  "paid AS (SELECT (o.\"paidAt\" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Paris')::date AS day,COUNT(*)::int AS orders,COALESCE(SUM(o.\"totalAmountMinor\"),0)::bigint AS gross FROM \"MarketplaceOrder\" o WHERE o.\"paidAt\" >= (NOW() AT TIME ZONE 'UTC') - (($1::int * 2 + 2) * interval '1 day') GROUP BY 1)" ,
  "SELECT to_char(d.day,'YYYY-MM-DD') AS day,COALESCE(t.visitors,0)::int AS visitors,COALESCE(t.sessions,0)::int AS sessions,COALESCE(r.registrations,0)::int AS registrations,COALESCE(a.listings,0)::int AS listings,COALESCE(a.imported,0)::int AS \"importedListings\",COALESCE(p.published,0)::int AS \"publishedListings\",COALESCE(m.buyer_messages,0)::int AS \"buyerMessages\",COALESCE(m.seller_messages,0)::int AS \"sellerMessages\",COALESCE(m.buyer_chats,0)::int AS \"buyerConversations\",COALESCE(o.orders,0)::int AS \"paidOrders\",COALESCE(o.gross,0)::bigint AS \"gmvMinor\" FROM dates d LEFT JOIN traffic t USING(day) LEFT JOIN registrations r USING(day) LEFT JOIN ads a USING(day) LEFT JOIN published p USING(day) LEFT JOIN messages m USING(day) LEFT JOIN paid o USING(day) ORDER BY d.day"
].join('\n');

function aggregate(rows: ReportDay[]) {
  const result = {} as Record<Field, number>;
  for (const field of fields) result[field] = rows.reduce((sum, day) => sum + day[field], 0);
  return result;
}

export async function registerMarketplaceHealthRoutes(app: FastifyInstance) {
  app.get('/admin/analytics/marketplace-health', {preHandler: requireAdminRoles([...roles])}, async (request, reply) => {
    const parsed = z.object({days: z.coerce.number().int().refine(x => x === 7 || x === 30).default(7)}).safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({error: 'invalid_period'});
    const days = parsed.data.days;
    const raw = await prisma.$queryRawUnsafe<Array<Record<string,unknown>>>(reportSql, days);
    const series = raw.map(row => {
      const item = {day: String(row.day)} as ReportDay;
      for (const field of fields) item[field] = Number(row[field] ?? 0);
      return item;
    });
    const currentSeries = series.slice(days);
    return reply.send({
      days, timezone: 'Europe/Paris', includesToday: true,
      period: {start: currentSeries[0]?.day ?? null, end: currentSeries.at(-1)?.day ?? null},
      current: aggregate(currentSeries), previous: aggregate(series.slice(0, days)),
      today: currentSeries.at(-1) ?? null, series: currentSeries,
      definitions: {
        audience: 'Audience first-party mesurée avec consentement; un visiteur peut revenir plusieurs jours.',
        imports: 'Import si une trace ListingImportLog est liée à l’annonce.',
        conversations: 'Discussions distinctes avec message envoyé par un acheteur pendant la période.',
        purchases: 'Uniquement commandes payées sur la plateforme; ventes externes non mesurées.',
        attribution: 'Mesures d’activité indépendantes, pas un tunnel de conversion individuel.'
      }
    });
  });
}

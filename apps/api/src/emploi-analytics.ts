import { prisma } from "@pa/database";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdminRoles } from "./rbac.js";

const roles=["SUPER_ADMIN","ADMIN","MARKETING"] as const;
type Day={day:string;searches:number;applyClicks:number;resourceClicks:number;visitors:number;registrations:number};
const reportSql=[
 "WITH d AS (SELECT generate_series((NOW() AT TIME ZONE 'Europe/Paris')::date-($1::int-1),(NOW() AT TIME ZONE 'Europe/Paris')::date,interval '1 day')::date AS day),",
 "ev AS (SELECT (\"createdAt\" AT TIME ZONE 'Europe/Paris')::date AS day,count(*) FILTER(WHERE \"event\"='JOB_SEARCHED')::int AS searches,count(*) FILTER(WHERE \"event\"='JOB_APPLY_CLICKED')::int AS apply_clicks,count(*) FILTER(WHERE \"event\"='JOB_RESOURCE_CLICKED')::int AS resource_clicks FROM \"SiteAnalyticsEvent\" WHERE \"createdAt\">=NOW()-($1::int+2)*interval '1 day' AND \"event\" IN ('JOB_SEARCHED','JOB_APPLY_CLICKED','JOB_RESOURCE_CLICKED') GROUP BY 1),",
 "ss AS (SELECT (\"startedAt\" AT TIME ZONE 'Europe/Paris')::date AS day,COUNT(DISTINCT \"visitorId\")::int AS visitors FROM \"SiteAnalyticsSession\" WHERE \"startedAt\">=NOW()-($1::int+2)*interval '1 day' AND (\"landingPath\" LIKE '/categorie/emploi%' OR \"currentPath\" LIKE '/categorie/emploi%' OR \"currentPath\" LIKE '/emploi/metiers/%') GROUP BY 1),",
 "registrations AS (SELECT (u.\"createdAt\" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Paris')::date AS day,COUNT(DISTINCT u.\"id\")::int AS registrations FROM \"User\" u JOIN \"SiteAnalyticsSession\" s ON s.\"userId\"=u.\"id\" WHERE u.\"createdAt\">=(NOW() AT TIME ZONE 'UTC')-($1::int+2)*interval '1 day' AND (s.\"landingPath\" LIKE '/categorie/emploi%' OR s.\"currentPath\" LIKE '/categorie/emploi%') GROUP BY 1)",
 "SELECT to_char(d.day,'YYYY-MM-DD') AS day,COALESCE(ev.searches,0)::int AS searches,COALESCE(ev.apply_clicks,0)::int AS \"applyClicks\",COALESCE(ev.resource_clicks,0)::int AS \"resourceClicks\",COALESCE(ss.visitors,0)::int AS visitors,COALESCE(registrations.registrations,0)::int AS registrations FROM d LEFT JOIN ev USING(day) LEFT JOIN ss USING(day) LEFT JOIN registrations USING(day) ORDER BY d.day"
].join("\n");

export async function registerEmploiAnalyticsRoutes(app:FastifyInstance){
 app.get("/admin/analytics/emploi",{preHandler:requireAdminRoles([...roles])},async(req,reply)=>{
  const parsed=z.object({days:z.coerce.number().int().refine(x=>x===7||x===30).default(7)}).safeParse(req.query);
  if(!parsed.success)return reply.code(400).send({error:"invalid_period"});
  const days=parsed.data.days;
  const rows=await prisma.$queryRawUnsafe<Array<Day>>(reportSql,days);
  const series=rows.map(x=>({day:String(x.day),searches:Number(x.searches||0),applyClicks:Number(x.applyClicks||0),resourceClicks:Number(x.resourceClicks||0),visitors:Number(x.visitors||0),registrations:Number(x.registrations||0)}));
  const sum=(field:keyof Omit<Day,"day">)=>series.reduce((total,x)=>total+x[field],0);
  // Aggregate broad job families only; never return individual search queries.
  const [sectors,departments,activeCount]=await Promise.all([
   prisma.$queryRawUnsafe<Array<{label:string;count:number}>>("SELECT CASE WHEN LOWER(\"query\") ~ '(develop|informat|web|programme)' THEN 'Informatique' WHEN LOWER(\"query\") ~ '(chauff|conduct|livr|transport)' THEN 'Transport' WHEN LOWER(\"query\") ~ '(vende|vente|commercial|boutique)' THEN 'Commerce' WHEN LOWER(\"query\") ~ '(cuisin|restaura|serveur|hotel)' THEN 'Restauration' WHEN LOWER(\"query\") ~ '(secr|assist|admin|comptab)' THEN 'Administratif' WHEN LOWER(\"query\") ~ '(macon|maçon|chantier|batiment|bâtiment)' THEN 'BTP' WHEN LOWER(\"query\") ~ '(soins|infirm|santé|aide.soi)' THEN 'Santé' ELSE 'Autres métiers' END AS label, COUNT(*)::int AS count FROM \"SavedSearch\" WHERE \"alertEnabled\"=TRUE AND \"filters\"->>'kind'='FRANCE_TRAVAIL_EMPLOI' GROUP BY 1 ORDER BY 2 DESC LIMIT 8"),
   prisma.$queryRawUnsafe<Array<{department:string;count:number}>>("SELECT \"filters\"->>'departement' AS department,COUNT(*)::int AS count FROM \"SavedSearch\" WHERE \"alertEnabled\"=TRUE AND \"filters\"->>'kind'='FRANCE_TRAVAIL_EMPLOI' AND COALESCE(\"filters\"->>'departement','')<>'' GROUP BY 1 ORDER BY 2 DESC LIMIT 8"),
   prisma.$queryRawUnsafe<Array<{count:number}>>("SELECT COUNT(*)::int AS count FROM \"SavedSearch\" WHERE \"alertEnabled\"=TRUE AND \"filters\"->>'kind'='FRANCE_TRAVAIL_EMPLOI'")
  ]);
  return reply.header("cache-control","private, no-store").send({
   days,timezone:"Europe/Paris",series,emploiAlerts:{active:Number(activeCount[0]?.count??0),sectors,departments},
   totals:{visitors:sum("visitors"),searches:sum("searches"),applyClicks:sum("applyClicks"),resourceClicks:sum("resourceClicks"),registrations:sum("registrations")},
   caveats:{
    searches:"Seules les recherches des visiteurs ayant accepté les cookies analytiques sont suivies.",
    clicks:"Clics vers les offres, pas candidatures soumises ni embauches confirmées.",
    registrations:"Inscriptions associées à une session Emploi ; corrélation, pas causalité.",
    visitors:"Somme quotidienne sans déduplication entre plusieurs jours."
   }
  });
 });
}

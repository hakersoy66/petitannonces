import type { FastifyInstance } from 'fastify';
import { prisma } from '@pa/database';
import { z } from 'zod';
import { requireAdminRoles } from './rbac.js';
import { queueAdminRoleEmail } from './transactional-email.js';
import { sendHostingerSmtpOnly } from './email-provider.js';

type Row = Record<string, unknown>;
const admin = requireAdminRoles(['SUPER_ADMIN','ADMIN','MARKETING']);
const platform = z.enum(['instagram','tiktok','youtube','facebook']);
const applicationSchema = z.object({
  platform,
  handle: z.string().trim().toLowerCase().regex(/^@?[a-z0-9._-]{2,38}$/),
  email: z.string().trim().toLowerCase().email().max(180),
  followers: z.number().int().min(0).max(1000000000),
  averageViews: z.number().int().min(0).max(1000000000),
  franceAudiencePercent: z.number().min(0).max(100).nullable(),
  requestedFeeMinor: z.number().int().min(0).max(100000000),
  mediaKitUrl: z.union([z.string().trim().url().max(900).refine(v=>v.startsWith('https://')),z.literal('')]),
  message: z.string().trim().max(1800),
  consent: z.literal(true),
  website: z.string().max(150).default(''),
}).strict();

const reviews = z.object({
  status: z.enum(['APPROVED','REJECTED']),
  note: z.string().trim().max(1200).default('')
}).strict();
const applicationsLimit = new Map<string,{count:number;start:number}>();
const LIMIT_MS = 60*60*1000;
function serialize(row: Row){return Object.fromEntries(Object.entries(row).map(([k,v])=>[k,typeof v==='bigint'?Number(v):v]));}
function limited(key:string){
  const now=Date.now();
  if(applicationsLimit.size>3000)for(const [k,v] of applicationsLimit)if(now-v.start>LIMIT_MS)applicationsLimit.delete(k);
  const last=applicationsLimit.get(key);
  if(!last||now-last.start>LIMIT_MS){applicationsLimit.set(key,{start:now,count:1});return false;}
  last.count++;
  return last.count>3;
}
export async function registerInfluencerApplicationRoutes(app:FastifyInstance){
  app.post('/partners/applications',async(request,reply)=>{
    reply.header('Cache-Control','no-store');
    const origin=request.headers.origin;
    const allowedOrigin=origin==='https://petitannonces.fr' || (process.env.NODE_ENV!=='production' && /^http:\/\/(?:localhost|127\.0\.0\.1):3000$/.test(origin??''));
    if(!allowedOrigin)return reply.code(403).send({error:'origin_invalide'});
    if(Number(request.headers['content-length']??0)>16000)return reply.code(413).send({error:'requete_trop_longue'});
    const parsed=applicationSchema.safeParse(request.body);
    if(!parsed.success)return reply.code(400).send({error:'informations_invalides'});
    const x=parsed.data;
    if(x.website)return reply.code(202).send({ok:true}); // honeypot
    if(limited(request.ip))return reply.code(429).send({error:'trop_de_demandes'});
    const handle=x.handle.replace(/^@/,'');
    try{
      const inserted=await prisma.$queryRawUnsafe<Row[]>(`INSERT INTO "InfluencerApplication"
        ("platform","handle","email","followers","averageViews","franceAudiencePercent","requestedFeeMinor","mediaKitUrl","message")
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING "id"`,
        x.platform,handle,x.email,x.followers,x.averageViews,x.franceAudiencePercent,x.requestedFeeMinor,x.mediaKitUrl||null,x.message||null);
      try {
        await queueAdminRoleEmail({
          roles:['SUPER_ADMIN','ADMIN','MARKETING'],eventKind:'INFLUENCER_APPLICATION_RECEIVED',
          title:'Nouvelle candidature influenceur',
          body:`Une nouvelle candidature ${x.platform} (@${handle}) est en attente. Consultez les audiences déclarées et la proposition de rémunération dans le panneau marketing avant de prendre une décision.`,
          actionUrl:'https://admin.petitannonces.fr/influenceurs',
          metadata:{applicationId:String(inserted[0]?.id??''),type:'influencer_application'}
        });
      } catch(error) {request.log.error({err:error},'influencer_application_admin_notification_failed');}
      return reply.code(201).send({ok:true,reference:String(inserted[0]?.id??'')});
    }catch(error){
      if((error as {code?:string}).code==='P2010')return reply.code(409).send({error:'candidature_deja_recue'});
      throw error;
    }
  });

  app.get('/admin/influencer-applications',{preHandler:admin},async()=>{
    const rows=await prisma.$queryRawUnsafe<Row[]>(`SELECT * FROM "InfluencerApplication" ORDER BY "createdAt" DESC LIMIT 200`);
    return {applications:rows.map(serialize)};
  });
  app.patch('/admin/influencer-applications/:id',{preHandler:admin},async(request,reply)=>{
    const p=z.object({id:z.string().uuid()}).safeParse(request.params);
    const b=reviews.safeParse(request.body);
    if(!p.success||!b.success)return reply.code(400).send({error:'invalid_request'});
    const {status,note}=b.data;
    const changed=await prisma.$transaction(async(tx)=>{
      // Update conditional prevents two admins reviewing the same request twice.
      const rows=await tx.$queryRawUnsafe<Row[]>(`UPDATE "InfluencerApplication"
        SET "status"=$1,"reviewNote"=$2,"reviewedAt"=NOW()
        WHERE "id"=$3 AND "status"='PENDING' RETURNING *`,status,note||null,p.data.id);
      if(!rows.length)return null;
      const row=rows[0]!;
      if(status==='APPROVED'){
        await tx.$executeRawUnsafe(`INSERT INTO "InfluencerPartner"
          ("platform","handle","email","followers","averageViews","franceAudiencePercent","suggestedFeeMinor","notes","status")
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'PROSPECT')
          ON CONFLICT ("platform","handle") DO UPDATE SET
             "email"=COALESCE("InfluencerPartner"."email",EXCLUDED."email"),
             "updatedAt"=NOW()`,
          row.platform,row.handle,row.email,row.followers,row.averageViews,row.franceAudiencePercent,
          row.requestedFeeMinor,'Candidature acceptée; statistiques fournies par le créateur à vérifier.');
      }
      return row;
    });
    if(!changed)return reply.code(409).send({error:'already_reviewed_or_missing'});
    let emailSent=true;
    if(status==='APPROVED'){
      const destination=String(changed.email??'');
      try {
        await sendHostingerSmtpOnly({to:destination,
          subject:'Bienvenue dans le programme partenaires Petit Annonces',
          text:'Votre candidature a été acceptée. Vous pouvez consulter les propositions dans votre espace privé : https://petitannonces.fr/espace-partenaire . Utilisez votre e-mail pour recevoir un code de connexion unique.',
          html:'<p>Votre candidature au programme partenaires <strong>Petit Annonces</strong> a été acceptée.</p><p><a href="https://petitannonces.fr/espace-partenaire">Ouvrir mon espace partenaire</a></p><p>Connectez-vous avec votre adresse e-mail et un code unique.</p>'});
      }catch(error){emailSent=false;request.log.error({err:error},'influencer_approval_email_failed')}
    }
    return {ok:true,status,emailSent};
  });
}

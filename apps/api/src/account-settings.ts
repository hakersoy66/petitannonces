import { createHash } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { prisma } from "@pa/database";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

const SESSION_COOKIE = "pa_session";
function sha256(value:string){return createHash("sha256").update(value).digest("hex");}
async function requireUserWithSession(request:FastifyRequest,reply:FastifyReply){const token=request.cookies[SESSION_COOKIE];if(!token){reply.code(401).send({error:"unauthenticated"});return null;}const session=await prisma.session.findUnique({where:{tokenHash:sha256(token)},include:{user:{include:{profile:true}}}});if(!session||session.revokedAt||session.expiresAt<=new Date()||session.user.status!=="ACTIVE"){reply.code(401).send({error:"unauthenticated"});return null;}return{session,user:session.user};}

const preferencesSchema=z.object({
  inAppMessages:z.boolean(),inAppOffers:z.boolean(),inAppListingUpdates:z.boolean(),
  emailMessages:z.boolean(),emailOffers:z.boolean(),emailListingUpdates:z.boolean(),emailMarketing:z.boolean(),
  pushMessages:z.boolean(),pushOffers:z.boolean(),pushListingUpdates:z.boolean(),
});
type PreferenceRow=z.infer<typeof preferencesSchema>&{userId:string};
const defaultPrefs={inAppMessages:true,inAppOffers:true,inAppListingUpdates:true,emailMessages:true,emailOffers:true,emailListingUpdates:true,emailMarketing:false,pushMessages:true,pushOffers:true,pushListingUpdates:true};

export async function registerAccountSettingsRoutes(app:FastifyInstance){
  app.get("/account/settings",async(request,reply)=>{const auth=await requireUserWithSession(request,reply);if(!auth)return;const[preferences,sessions]=await Promise.all([
    prisma.$queryRaw<PreferenceRow[]>`SELECT "userId","inAppMessages","inAppOffers","inAppListingUpdates","emailMessages","emailOffers","emailListingUpdates","emailMarketing","pushMessages","pushOffers","pushListingUpdates" FROM "UserNotificationPreference" WHERE "userId"=${auth.user.id} LIMIT 1`,
    prisma.session.findMany({where:{userId:auth.user.id,revokedAt:null,expiresAt:{gt:new Date()}},select:{id:true,userAgent:true,createdAt:true,lastSeenAt:true,expiresAt:true,tokenHash:true},orderBy:{lastSeenAt:"desc"},take:20}),
  ]);const prefs=preferences[0]??{userId:auth.user.id,...defaultPrefs};return reply.send({user:{id:auth.user.id,email:auth.user.email,kind:auth.user.kind,emailVerified:Boolean(auth.user.emailVerifiedAt),profile:auth.user.profile},preferences:prefs,sessions:sessions.map(({tokenHash,...session})=>({...session,current:tokenHash===auth.session.tokenHash}))});});

  app.put("/account/notification-preferences",async(request,reply)=>{const auth=await requireUserWithSession(request,reply);if(!auth)return;const parsed=preferencesSchema.safeParse(request.body);if(!parsed.success)return reply.code(400).send({error:"invalid_request",details:parsed.error.flatten()});const p=parsed.data;await prisma.$executeRaw`
    INSERT INTO "UserNotificationPreference" ("userId","inAppMessages","inAppOffers","inAppListingUpdates","emailMessages","emailOffers","emailListingUpdates","emailMarketing","pushMessages","pushOffers","pushListingUpdates","updatedAt")
    VALUES (${auth.user.id},${p.inAppMessages},${p.inAppOffers},${p.inAppListingUpdates},${p.emailMessages},${p.emailOffers},${p.emailListingUpdates},${p.emailMarketing},${p.pushMessages},${p.pushOffers},${p.pushListingUpdates},NOW())
    ON CONFLICT ("userId") DO UPDATE SET "inAppMessages"=EXCLUDED."inAppMessages","inAppOffers"=EXCLUDED."inAppOffers","inAppListingUpdates"=EXCLUDED."inAppListingUpdates","emailMessages"=EXCLUDED."emailMessages","emailOffers"=EXCLUDED."emailOffers","emailListingUpdates"=EXCLUDED."emailListingUpdates","emailMarketing"=EXCLUDED."emailMarketing","pushMessages"=EXCLUDED."pushMessages","pushOffers"=EXCLUDED."pushOffers","pushListingUpdates"=EXCLUDED."pushListingUpdates","updatedAt"=NOW()`;return reply.send({saved:true,preferences:p});});

  app.post("/account/change-password",async(request,reply)=>{const auth=await requireUserWithSession(request,reply);if(!auth)return;const parsed=z.object({currentPassword:z.string().min(1).max(128),newPassword:z.string().min(10).max(128)}).safeParse(request.body);if(!parsed.success)return reply.code(400).send({error:"invalid_request"});const valid=await verify(auth.user.passwordHash,parsed.data.currentPassword);if(!valid)return reply.code(401).send({error:"invalid_current_password"});if(parsed.data.currentPassword===parsed.data.newPassword)return reply.code(400).send({error:"new_password_must_differ"});const passwordHash=await hash(parsed.data.newPassword,{algorithm:2,memoryCost:19456,timeCost:2,parallelism:1});await prisma.$transaction([prisma.user.update({where:{id:auth.user.id},data:{passwordHash}}),prisma.session.updateMany({where:{userId:auth.user.id,id:{not:auth.session.id},revokedAt:null},data:{revokedAt:new Date()}})]);return reply.send({changed:true,otherSessionsRevoked:true});});
  app.post("/account/sessions/revoke-others",async(request,reply)=>{const auth=await requireUserWithSession(request,reply);if(!auth)return;const result=await prisma.session.updateMany({where:{userId:auth.user.id,id:{not:auth.session.id},revokedAt:null},data:{revokedAt:new Date()}});return reply.send({revoked:result.count});});
}

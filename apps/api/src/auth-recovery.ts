import { createHash, randomBytes } from "node:crypto";
import { hash } from "@node-rs/argon2";
import { prisma } from "@pa/database";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { enforceAuthRateLimit } from "./auth-rate-limit.js";
import { passwordResetActionUrl, queueTransactionalEmail } from "./transactional-email.js";

const RESET_TTL_MS=1000*60*30;
function sha256(value:string){return createHash("sha256").update(value).digest("hex")}function newOpaqueToken(bytes=32){return randomBytes(bytes).toString("base64url")}
async function hashPassword(password:string){return hash(password,{algorithm:2,memoryCost:19456,timeCost:2,parallelism:1})}

export async function registerAuthRecoveryRoutes(app:FastifyInstance){
 app.post("/auth/forgot-password",async(request,reply)=>{const body=z.object({email:z.string().trim().toLowerCase().email()}).safeParse(request.body);if(!body.success)return reply.code(400).send({error:"invalid_request"});if(!await enforceAuthRateLimit({request,reply,action:"FORGOT_PASSWORD",identity:body.data.email,limit:3,windowMs:15*60*1000,blockMs:15*60*1000}))return;const user=await prisma.user.findUnique({where:{email:body.data.email}});if(!user)return reply.send({requested:true});const token=newOpaqueToken();await prisma.passwordResetToken.updateMany({where:{userId:user.id,usedAt:null},data:{usedAt:new Date()}});await prisma.passwordResetToken.create({data:{userId:user.id,tokenHash:sha256(token),expiresAt:new Date(Date.now()+RESET_TTL_MS)}});await queueTransactionalEmail({userId:user.id,eventKind:"AUTH_PASSWORD_RESET",title:"Réinitialisez votre mot de passe",body:"Vous avez demandé la réinitialisation de votre mot de passe Petit Annonces. Ce lien est valable 30 minutes. Si vous n’êtes pas à l’origine de cette demande, ignorez cet e-mail.",actionUrl:passwordResetActionUrl(token),metadata:{purpose:"PASSWORD_RESET"}});return reply.send({requested:true,cooldownSeconds:300,...(process.env.NODE_ENV!=="production"?{devResetToken:token}:{})})});
 app.post("/auth/reset-password",async(request,reply)=>{const body=z.object({token:z.string().min(20),password:z.string().min(10).max(128)}).safeParse(request.body);if(!body.success)return reply.code(400).send({error:"invalid_request"});if(!await enforceAuthRateLimit({request,reply,action:"RESET_PASSWORD",limit:10,windowMs:15*60*1000,blockMs:15*60*1000}))return;const record=await prisma.passwordResetToken.findUnique({where:{tokenHash:sha256(body.data.token)}});if(!record||record.usedAt||record.expiresAt<=new Date())return reply.code(400).send({error:"invalid_or_expired_token"});const passwordHash=await hashPassword(body.data.password);await prisma.$transaction([prisma.passwordResetToken.update({where:{id:record.id},data:{usedAt:new Date()}}),prisma.user.update({where:{id:record.userId},data:{passwordHash,failedLoginAttempts:0,lockedUntil:null}}),prisma.session.updateMany({where:{userId:record.userId,revokedAt:null},data:{revokedAt:new Date()}})]);return reply.send({reset:true})})
}

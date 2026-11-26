import {prisma} from "@pa/database";
import type {FastifyReply} from "fastify";
export type AdminUserPermissions={publicationBlocked:boolean;messagingBlocked:boolean;importBlocked:boolean;storeCreationBlocked:boolean;listingCap:number|null};
export const defaultUserPermissions:AdminUserPermissions={publicationBlocked:false,messagingBlocked:false,importBlocked:false,storeCreationBlocked:false,listingCap:null};
export async function getAdminUserPermissions(userId:string){
 const rows=await prisma.$queryRaw<AdminUserPermissions[]>`SELECT "publicationBlocked","messagingBlocked","importBlocked","storeCreationBlocked","listingCap" FROM "AdminUserPermission" WHERE "userId"=${userId}`;
 return rows[0]??{...defaultUserPermissions};
}
export async function enforceAdminUserPermission(userId:string,key:Exclude<keyof AdminUserPermissions,"listingCap">,reply:FastifyReply){
 const permissions=await getAdminUserPermissions(userId);
 if(!permissions[key])return true;
 reply.code(403).send({error:"admin_user_permission_restricted",permission:key,message:"Cette fonctionnalité est temporairement restreinte par l’administration. Contactez l’assistance."});
 return false;
}

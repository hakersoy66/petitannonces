import {prisma} from "@pa/database";
export type CommercialPermission={salesBlocked:boolean;storeCap:number|null};
export async function getCommercialPermission(userId:string):Promise<CommercialPermission>{
 const rows=await prisma.$queryRaw<CommercialPermission[]>`SELECT "salesBlocked","storeCap" FROM "AdminCommercialPermission" WHERE "userId"=${userId}`;
 return rows[0]??{salesBlocked:false,storeCap:null};
}
export async function sellerSalesAllowed(userId:string){
 const rows=await prisma.$queryRaw<Array<{allowed:boolean}>>`SELECT (u."status"='ACTIVE' AND NOT COALESCE(p."salesBlocked",FALSE)) AS allowed FROM "User" u LEFT JOIN "AdminCommercialPermission" p ON p."userId"=u."id" WHERE u."id"=${userId}`;
 return rows[0]?.allowed===true;
}

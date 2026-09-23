import { prisma } from '@pa/database';
const rows = await prisma.$queryRawUnsafe<any[]>(`
  SELECT "id","userId","platform","nativeToken","deviceLabel","isActive","lastSeenAt","createdAt","updatedAt"
  FROM "PushSubscription"
  WHERE "platform"='ANDROID' AND "isActive"=TRUE AND "nativeToken" IS NOT NULL
  ORDER BY "lastSeenAt" DESC NULLS LAST, "updatedAt" DESC, "createdAt" DESC
  LIMIT 5
`);
console.log('active_android_sample=', rows.length);
for (const [i,r] of rows.entries()) {
  const token=String(r.nativeToken||'');
  console.log(JSON.stringify({index:i+1,id:r.id,userId:r.userId,tokenType:/^(ExponentPushToken|ExpoPushToken)\[.+\]$/.test(token)?'expo':'other',tokenLen:token.length,deviceLabel:r.deviceLabel??null,lastSeenAt:r.lastSeenAt,updatedAt:r.updatedAt}));
}
await prisma.$disconnect();

import { randomUUID } from "node:crypto";
import { prisma } from "@pa/database";
import { managedTransactionalCopy } from "./admin-notifications.js";

export async function queueTransactionalEmail(args: {
  userId: string;
  eventKind: string;
  title: string;
  body: string;
  actionUrl: string;
  metadata?: Record<string, unknown>;
}) {
  const copy = await managedTransactionalCopy(args.eventKind, { title: args.title, body: args.body });
  await prisma.$executeRawUnsafe(
    `INSERT INTO "NotificationDeliveryOutbox" ("id","userId","notificationId","eventKind","channel","payload") VALUES ($1,$2,NULL,$3,'EMAIL',$4::jsonb)`,
    randomUUID(),
    args.userId,
    args.eventKind,
    JSON.stringify({
      title: copy.title,
      body: copy.body,
      actionUrl: args.actionUrl,
      metadata: { ...(args.metadata ?? {}), transactional: true },
    }),
  );
}

export function verificationActionUrl(token: string, next?: string | null) {
  const base = `/verifier-email?token=${encodeURIComponent(token)}`;
  if (!next || !next.startsWith("/") || next.startsWith("//")) return base;
  return `${base}&next=${encodeURIComponent(next)}`;
}

export function passwordResetActionUrl(token: string) {
  return `/reinitialiser-mot-de-passe?token=${encodeURIComponent(token)}`;
}

export function nativeVerificationActionUrl(token: string) {
  return `/app/verify-email?token=${encodeURIComponent(token)}`;
}

export function nativePasswordResetActionUrl(token: string) {
  return `/app/reset-password?token=${encodeURIComponent(token)}`;
}


export type AdminNotificationRole="SUPER_ADMIN"|"ADMIN"|"MODERATOR"|"SUPPORT"|"FINANCE"|"COMPLIANCE"|"MARKETING";

export async function queueAdminRoleEmail(args:{
  roles:AdminNotificationRole[];
  eventKind:string;
  title:string;
  body:string;
  actionUrl:string;
  metadata?:Record<string,unknown>;
}){
  const recipients=await prisma.user.findMany({
    where:{status:"ACTIVE",roles:{some:{role:{in:args.roles}}}},
    select:{id:true},
    take:50,
  });
  for(const recipient of recipients){
    await queueTransactionalEmail({
      userId:recipient.id,
      eventKind:args.eventKind,
      title:args.title,
      body:args.body,
      actionUrl:args.actionUrl,
      metadata:args.metadata,
    });
  }
  return recipients.length;
}

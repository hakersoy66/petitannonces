import { randomUUID } from "node:crypto";
import { prisma } from "@pa/database";

export async function queueTransactionalEmail(args: {
  userId: string;
  eventKind: string;
  title: string;
  body: string;
  actionUrl: string;
  metadata?: Record<string, unknown>;
}) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "NotificationDeliveryOutbox" ("id","userId","notificationId","eventKind","channel","payload") VALUES ($1,$2,NULL,$3,'EMAIL',$4::jsonb)`,
    randomUUID(),
    args.userId,
    args.eventKind,
    JSON.stringify({
      title: args.title,
      body: args.body,
      actionUrl: args.actionUrl,
      metadata: { ...(args.metadata ?? {}), transactional: true },
    }),
  );
}

export function verificationActionUrl(token: string) {
  return `/verifier-email?token=${encodeURIComponent(token)}`;
}

export function passwordResetActionUrl(token: string) {
  return `/reinitialiser-mot-de-passe?token=${encodeURIComponent(token)}`;
}

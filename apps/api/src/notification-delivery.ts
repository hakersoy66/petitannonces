import { randomUUID } from "node:crypto";
import { prisma } from "@pa/database";

type EventKind = "MESSAGE" | "OFFER" | "LISTING";
type NotificationKind = "MESSAGE" | "OFFER" | "LISTING" | "SYSTEM" | "WALLET" | "SECURITY" | "SEARCH";

type PreferenceRow = {
  inAppMessages: boolean;
  inAppOffers: boolean;
  inAppListingUpdates: boolean;
  emailMessages: boolean;
  emailOffers: boolean;
  emailListingUpdates: boolean;
  pushMessages: boolean;
  pushOffers: boolean;
  pushListingUpdates: boolean;
};

const defaults: PreferenceRow = {
  inAppMessages: true,
  inAppOffers: true,
  inAppListingUpdates: true,
  emailMessages: true,
  emailOffers: true,
  emailListingUpdates: true,
  pushMessages: true,
  pushOffers: true,
  pushListingUpdates: true,
};

async function getPreferences(userId: string): Promise<PreferenceRow> {
  const rows = await prisma.$queryRawUnsafe<PreferenceRow[]>(`
    SELECT "inAppMessages","inAppOffers","inAppListingUpdates",
           "emailMessages","emailOffers","emailListingUpdates",
           "pushMessages","pushOffers","pushListingUpdates"
    FROM "UserNotificationPreference" WHERE "userId"=$1 LIMIT 1`, userId);
  return rows[0] ?? defaults;
}

function enabledFor(kind: EventKind, channel: "IN_APP" | "EMAIL" | "PUSH", p: PreferenceRow) {
  const suffix = kind === "MESSAGE" ? "Messages" : kind === "OFFER" ? "Offers" : "ListingUpdates";
  const prefix = channel === "IN_APP" ? "inApp" : channel === "EMAIL" ? "email" : "push";
  return p[`${prefix}${suffix}` as keyof PreferenceRow] === true;
}

export async function deliverUserEvent(args: {
  userId: string;
  eventKind: EventKind;
  notificationKind?: NotificationKind;
  title: string;
  body: string;
  actionUrl?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const prefs = await getPreferences(args.userId);
  const metadata = args.metadata ?? {};
  let notificationId: string | null = null;

  if (enabledFor(args.eventKind, "IN_APP", prefs)) {
    notificationId = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO "UserNotification" ("id","userId","kind","title","body","actionUrl","metadata") VALUES ($1,$2,$3::"NotificationKind",$4,$5,$6,$7::jsonb)`,
      notificationId,
      args.userId,
      args.notificationKind ?? args.eventKind,
      args.title,
      args.body,
      args.actionUrl ?? null,
      JSON.stringify(metadata),
    );
  }

  const payload = JSON.stringify({ title: args.title, body: args.body, actionUrl: args.actionUrl ?? null, metadata });
  for (const channel of ["EMAIL", "PUSH"] as const) {
    if (!enabledFor(args.eventKind, channel, prefs)) continue;
    await prisma.$executeRawUnsafe(
      `INSERT INTO "NotificationDeliveryOutbox" ("id","userId","notificationId","eventKind","channel","payload") VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
      randomUUID(),
      args.userId,
      notificationId,
      args.eventKind,
      channel,
      payload,
    );
  }

  return {
    inApp: enabledFor(args.eventKind, "IN_APP", prefs),
    emailQueued: enabledFor(args.eventKind, "EMAIL", prefs),
    pushQueued: enabledFor(args.eventKind, "PUSH", prefs),
  };
}

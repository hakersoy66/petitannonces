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

type CategoryPreferenceRow={messages:boolean;offers:boolean;orders:boolean;savedSearches:boolean;security:boolean;favorites:boolean};
const categoryDefaults:CategoryPreferenceRow={messages:true,offers:true,orders:true,savedSearches:true,security:true,favorites:true};

async function getPreferences(userId: string): Promise<PreferenceRow> {
  const rows = await prisma.$queryRawUnsafe<PreferenceRow[]>(`
    SELECT "inAppMessages","inAppOffers","inAppListingUpdates",
           "emailMessages","emailOffers","emailListingUpdates",
           "pushMessages","pushOffers","pushListingUpdates"
    FROM "UserNotificationPreference" WHERE "userId"=$1 LIMIT 1`, userId);
  return rows[0] ?? defaults;
}

async function getCategoryPreferences(userId:string):Promise<CategoryPreferenceRow>{
  const rows=await prisma.$queryRawUnsafe<CategoryPreferenceRow[]>(`SELECT "messages","offers","orders","savedSearches","security","favorites" FROM "NotificationPreference" WHERE "userId"=$1 LIMIT 1`,userId).catch(()=>[]);
  return rows[0]??categoryDefaults;
}

function categoryEnabled(args:{eventKind:EventKind;notificationKind?:NotificationKind;metadata?:Record<string,unknown>},p:CategoryPreferenceRow){
  const kind=args.notificationKind??args.eventKind;
  const marker=String(args.metadata?.source??args.metadata?.purpose??"").toUpperCase();
  const marketplaceOrderEvent=Boolean(args.metadata?.orderId||args.metadata?.shipmentStatus||args.metadata?.payoutStatus||args.metadata?.refundStatus||args.metadata?.refundId||args.metadata?.caseUpdate||args.metadata?.protectionStatus);
  if(marketplaceOrderEvent)return p.orders;
  if(kind==="MESSAGE")return p.messages;
  if(kind==="SEARCH")return p.savedSearches;
  if(marker.includes("FAVORITE")||marker.includes("FOLLOWED"))return p.favorites;
  if(kind==="OFFER")return p.offers;
  if(kind==="WALLET"||kind==="LISTING")return p.orders;
  if(kind==="SECURITY"||kind==="SYSTEM")return p.security;
  return true;
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
  transactional?: boolean;
  dedupeKey?: string | null;
  suppressEmail?: boolean;
  forcePush?: boolean;
  forceInApp?: boolean;
}) {
  const [prefs,categoryPrefs] = await Promise.all([getPreferences(args.userId),getCategoryPreferences(args.userId)]);
  const transactional=args.transactional===true||args.metadata?.transactional===true;
  const categoryAllowed=categoryEnabled(args,categoryPrefs);
  const metadata = {...(args.metadata ?? {}),...(transactional?{transactional:true}:{})};
  const dedupeKey=(args.dedupeKey??"").trim().slice(0,240)||null;
  let notificationId: string | null = null;
  const inAppEnabled=args.forceInApp===true||(categoryAllowed&&enabledFor(args.eventKind,"IN_APP",prefs));

  if (inAppEnabled) {
    if(dedupeKey){
      const candidate=randomUUID();
      const inserted=await prisma.$queryRawUnsafe<Array<{id:string}>>(
        `INSERT INTO "UserNotification" ("id","userId","kind","title","body","actionUrl","metadata","dedupeKey") VALUES ($1,$2,$3::"NotificationKind",$4,$5,$6,$7::jsonb,$8) ON CONFLICT ("userId","dedupeKey") WHERE "dedupeKey" IS NOT NULL DO NOTHING RETURNING "id"`,
        candidate,args.userId,args.notificationKind ?? args.eventKind,args.title,args.body,args.actionUrl ?? null,JSON.stringify(metadata),dedupeKey,
      );
      notificationId=inserted[0]?.id??null;
      if(!notificationId){
        const existing=await prisma.$queryRawUnsafe<Array<{id:string}>>(`SELECT "id" FROM "UserNotification" WHERE "userId"=$1 AND "dedupeKey"=$2 LIMIT 1`,args.userId,dedupeKey);
        notificationId=existing[0]?.id??null;
      }
    }else{
      notificationId = randomUUID();
      await prisma.$executeRawUnsafe(
        `INSERT INTO "UserNotification" ("id","userId","kind","title","body","actionUrl","metadata") VALUES ($1,$2,$3::"NotificationKind",$4,$5,$6,$7::jsonb)`,
        notificationId,args.userId,args.notificationKind ?? args.eventKind,args.title,args.body,args.actionUrl ?? null,JSON.stringify(metadata),
      );
    }
  }

  const payload = JSON.stringify({ title: args.title, body: args.body, actionUrl: args.actionUrl ?? null, metadata });
  const pushEnabled=args.forcePush===true||(categoryAllowed&&enabledFor(args.eventKind,"PUSH",prefs));
  for (const channel of ["EMAIL", "PUSH"] as const) {
    if (channel === "EMAIL" && args.suppressEmail) continue;
    if(channel==="EMAIL"&&!categoryAllowed&&!transactional)continue;
    if (channel==="EMAIL" ? (!transactional&&!enabledFor(args.eventKind, channel, prefs)) : !pushEnabled) continue;
    if(dedupeKey){
      await prisma.$executeRawUnsafe(
        `INSERT INTO "NotificationDeliveryOutbox" ("id","userId","notificationId","eventKind","channel","payload","dedupeKey") VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7) ON CONFLICT ("userId","channel","dedupeKey") WHERE "dedupeKey" IS NOT NULL DO NOTHING`,
        randomUUID(),args.userId,notificationId,args.eventKind,channel,payload,dedupeKey,
      );
    }else{
      await prisma.$executeRawUnsafe(
        `INSERT INTO "NotificationDeliveryOutbox" ("id","userId","notificationId","eventKind","channel","payload") VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
        randomUUID(),args.userId,notificationId,args.eventKind,channel,payload,
      );
    }
  }

  return {
    inApp: inAppEnabled,
    emailQueued: transactional||(categoryAllowed&&enabledFor(args.eventKind, "EMAIL", prefs)),
    pushQueued: pushEnabled,
  };
}

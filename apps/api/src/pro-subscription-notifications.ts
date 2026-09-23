import { prisma } from "@pa/database";
import { deliverUserEvent } from "./notification-delivery.js";

const ACTION_URL = "/espace-pro/abonnement";
const REMINDER_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
const WORKER_INTERVAL_MS = 6 * 60 * 60 * 1000;

function frDate(value: Date | string | null | undefined) {
  if (!value) return "la date prévue";
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "la date prévue";
  return new Intl.DateTimeFormat("fr-FR", { dateStyle:"long", timeZone:"Europe/Paris" }).format(date);
}

async function send(args: {
  userId: string;
  title: string;
  body: string;
  dedupeKey: string;
  metadata?: Record<string, unknown>;
}) {
  return deliverUserEvent({
    userId: args.userId,
    eventKind: "LISTING",
    notificationKind: "SYSTEM",
    title: args.title,
    body: args.body,
    actionUrl: ACTION_URL,
    transactional: true,
    dedupeKey: args.dedupeKey,
    metadata: { source:"PRO_SUBSCRIPTION", ...(args.metadata ?? {}) },
  });
}

export async function notifyProPlanChanged(args: {
  userId: string;
  subscriptionId: string;
  previousPlan: string;
  nextPlan: string;
  effectiveAt?: Date | string | null;
  dedupeToken?: string | null;
}) {
  const effective = args.effectiveAt ? frDate(args.effectiveAt) : null;
  return send({
    userId: args.userId,
    title: "Votre formule Pro a été mise à jour",
    body: effective
      ? `Votre formule passe de ${args.previousPlan} à ${args.nextPlan}. La modification prend effet le ${effective}.`
      : `Votre formule passe de ${args.previousPlan} à ${args.nextPlan}. Les nouveaux droits sont maintenant disponibles.`,
    dedupeKey: `pro-subscription:plan:${args.subscriptionId}:${args.nextPlan}:${args.dedupeToken ?? effective ?? "now"}`,
    metadata: { subscriptionId:args.subscriptionId, previousPlan:args.previousPlan, nextPlan:args.nextPlan, effectiveAt:args.effectiveAt ?? null },
  });
}

export async function notifyProPlanChangeScheduled(args: {
  userId: string;
  subscriptionId: string;
  previousPlan: string;
  nextPlan: string;
  effectiveAt: Date | string;
}) {
  return send({
    userId: args.userId,
    title: "Changement de formule programmé",
    body: `Votre formule ${args.previousPlan} reste active jusqu’au ${frDate(args.effectiveAt)}. La formule ${args.nextPlan} prendra ensuite le relais automatiquement.`,
    dedupeKey: `pro-subscription:plan-scheduled:${args.subscriptionId}:${args.nextPlan}:${new Date(args.effectiveAt).toISOString()}`,
    metadata: { subscriptionId:args.subscriptionId, previousPlan:args.previousPlan, nextPlan:args.nextPlan, effectiveAt:new Date(args.effectiveAt).toISOString() },
  });
}

export async function notifyProPlanChangeCancelled(args: { userId:string; subscriptionId:string; planName:string; scheduleId:string }) {
  return send({
    userId: args.userId,
    title: "Changement de formule annulé",
    body: `Le changement programmé a été annulé. Votre formule ${args.planName} reste inchangée.`,
    dedupeKey: `pro-subscription:plan-schedule-cancelled:${args.scheduleId}`,
    metadata: { subscriptionId:args.subscriptionId, scheduleId:args.scheduleId, planName:args.planName },
  });
}

export async function notifyProCancellationScheduled(args: { userId:string; subscriptionId:string; planName:string; effectiveAt?:Date|string|null }) {
  return send({
    userId: args.userId,
    title: "Résiliation de votre abonnement Pro programmée",
    body: `Votre formule ${args.planName} reste active jusqu’au ${frDate(args.effectiveAt)}. Elle ne sera pas renouvelée après cette date.`,
    dedupeKey: `pro-subscription:cancel:${args.subscriptionId}:${args.effectiveAt ? new Date(args.effectiveAt).toISOString() : "period-end"}`,
    metadata: { subscriptionId:args.subscriptionId, planName:args.planName, effectiveAt:args.effectiveAt ?? null },
  });
}

export async function notifyProReactivated(args: { userId:string; subscriptionId:string; planName:string; currentPeriodEnd?:Date|string|null }) {
  return send({
    userId: args.userId,
    title: "Votre abonnement Pro est réactivé",
    body: `La résiliation programmée a été annulée. Votre formule ${args.planName} continuera à se renouveler normalement${args.currentPeriodEnd ? ` après le ${frDate(args.currentPeriodEnd)}` : ""}.`,
    dedupeKey: `pro-subscription:reactivated:${args.subscriptionId}:${args.currentPeriodEnd ? new Date(args.currentPeriodEnd).toISOString() : "active"}`,
    metadata: { subscriptionId:args.subscriptionId, planName:args.planName, currentPeriodEnd:args.currentPeriodEnd ?? null },
  });
}

export async function notifyProPaymentFailed(args: { userId:string; subscriptionId:string; planName:string; invoiceId?:string|null }) {
  return send({
    userId: args.userId,
    title: "Paiement de votre abonnement Pro à régulariser",
    body: `Le paiement de votre formule ${args.planName} n’a pas abouti. Mettez à jour votre moyen de paiement pour éviter une interruption de vos fonctionnalités professionnelles.`,
    dedupeKey: `pro-subscription:payment-failed:${args.invoiceId ?? args.subscriptionId}`,
    metadata: { subscriptionId:args.subscriptionId, planName:args.planName, invoiceId:args.invoiceId ?? null },
  });
}

export async function notifyProPaymentRecovered(args: { userId:string; subscriptionId:string; planName:string; invoiceId?:string|null }) {
  return send({
    userId: args.userId,
    title: "Paiement de votre abonnement Pro confirmé",
    body: `Le paiement de votre formule ${args.planName} est régularisé. Votre abonnement est de nouveau en règle.`,
    dedupeKey: `pro-subscription:payment-recovered:${args.invoiceId ?? args.subscriptionId}`,
    metadata: { subscriptionId:args.subscriptionId, planName:args.planName, invoiceId:args.invoiceId ?? null },
  });
}

export async function runProSubscriptionReminderSweep() {
  const now = new Date();
  const until = new Date(now.getTime() + REMINDER_WINDOW_MS);
  const rows = await prisma.professionalSubscription.findMany({
    where: {
      currentPeriodEnd: { gt:now, lte:until },
      OR: [
        { status:"TRIALING" },
        { status:"ACTIVE", externalProvider:"stripe", cancelAtPeriodEnd:false },
      ],
    },
    include: { plan:true },
    orderBy: { currentPeriodEnd:"asc" },
    take: 300,
  });
  let queued = 0;
  for (const row of rows) {
    if (!row.currentPeriodEnd) continue;
    const isTrial = row.status === "TRIALING";
    await send({
      userId: row.userId,
      title: isTrial ? "Votre période d’essai Pro se termine bientôt" : "Renouvellement de votre abonnement Pro dans quelques jours",
      body: isTrial
        ? `Votre essai de la formule ${row.plan.name} se termine le ${frDate(row.currentPeriodEnd)}. Consultez votre abonnement pour choisir la suite.`
        : `Votre formule ${row.plan.name} sera renouvelée automatiquement le ${frDate(row.currentPeriodEnd)}. Vous pouvez consulter votre formule et votre moyen de paiement depuis votre Espace Pro.`,
      dedupeKey: `pro-subscription:${isTrial ? "trial-ending" : "renewal"}:${row.id}:${row.currentPeriodEnd.toISOString()}`,
      metadata: { subscriptionId:row.id, planName:row.plan.name, currentPeriodEnd:row.currentPeriodEnd.toISOString(), reminder:isTrial ? "TRIAL_ENDING" : "RENEWAL" },
    });
    queued += 1;
  }
  return { checked:rows.length, queued };
}

export function startProSubscriptionReminderWorker(log?:{info:(value:unknown,message?:string)=>void;error:(value:unknown,message?:string)=>void}) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const result = await runProSubscriptionReminderSweep();
      if (result.queued) log?.info(result, "pro subscription reminders queued");
    } catch (error) {
      log?.error({error}, "pro subscription reminder sweep failed");
    } finally {
      running = false;
    }
  };
  const first = setTimeout(()=>void run(), 90_000);
  first.unref();
  const timer = setInterval(()=>void run(), WORKER_INTERVAL_MS);
  timer.unref();
  return timer;
}

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { prisma } from "@pa/database";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { requireAdminRoles } from "./rbac.js";

const EXPECTED_PACKAGE = "fr.petitannonces.petitannoncesapp";
const ROOT = process.env.PA_ANDROID_FIREBASE_UPLOAD_DIR ?? "/var/www/petitannonces/shared/android-firebase/admin-upload";
const GOOGLE_SERVICES = `${ROOT}/google-services.json`;
const SERVICE_ACCOUNT = `${ROOT}/firebase-service-account.json`;
const FCM_MARKER = "/var/www/petitannonces/shared/android-firebase/fcm-v1-configured";
const MAX_JSON_BYTES = 512 * 1024;

async function actorId(request: FastifyRequest) {
  const token = request.cookies.pa_session;
  if (!token) return null;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const session = await prisma.session.findUnique({ where: { tokenHash }, select: { userId: true, revokedAt: true, expiresAt: true } });
  if (!session || session.revokedAt || session.expiresAt <= new Date()) return null;
  return session.userId;
}

async function audit(request: FastifyRequest, action: string, entityId: string, metadata: Record<string, unknown>) {
  const actor = await actorId(request);
  if (!actor) return;
  await prisma.$executeRawUnsafe(
    `INSERT INTO "AdminAuditEvent" ("id","actorUserId","action","entityType","entityId","metadata") VALUES ($1,$2,$3,'MOBILE_RELEASE',$4,$5::jsonb)`,
    randomUUID(), actor, action, entityId, JSON.stringify(metadata),
  ).catch(() => undefined);
}

async function exists(path: string) {
  try { await stat(path); return true; } catch { return false; }
}

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(path, "utf8");
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}

function googleServicesInfo(value: Record<string, unknown>) {
  const projectInfo = value.project_info && typeof value.project_info === "object" ? value.project_info as Record<string, unknown> : {};
  const projectId = typeof projectInfo.project_id === "string" ? projectInfo.project_id.trim() : "";
  const clients = Array.isArray(value.client) ? value.client : [];
  const packages = clients.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const clientInfo = (entry as Record<string, unknown>).client_info;
    if (!clientInfo || typeof clientInfo !== "object") return [];
    const android = (clientInfo as Record<string, unknown>).android_client_info;
    if (!android || typeof android !== "object") return [];
    const pkg = (android as Record<string, unknown>).package_name;
    return typeof pkg === "string" && pkg.trim() ? [pkg.trim()] : [];
  });
  return { projectId, packages };
}

function serviceAccountInfo(value: Record<string, unknown>) {
  const type = typeof value.type === "string" ? value.type : "";
  const projectId = typeof value.project_id === "string" ? value.project_id.trim() : "";
  const clientEmail = typeof value.client_email === "string" ? value.client_email.trim() : "";
  const privateKey = typeof value.private_key === "string" ? value.private_key : "";
  const tokenUri = typeof value.token_uri === "string" ? value.token_uri : "";
  return { type, projectId, clientEmail, privateKey, tokenUri };
}

async function saveJsonAtomic(path: string, value: Record<string, unknown>) {
  const raw = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(raw, "utf8") > MAX_JSON_BYTES) throw new Error("json_too_large");
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${randomUUID()}.tmp`;
  await writeFile(tmp, raw, { encoding: "utf8", mode: 0o600 });
  await rename(tmp, path);
}

async function statusPayload() {
  const [google, service, fcmConfigured] = await Promise.all([readJson(GOOGLE_SERVICES), readJson(SERVICE_ACCOUNT), exists(FCM_MARKER)]);
  const g = google ? googleServicesInfo(google) : { projectId: "", packages: [] as string[] };
  const s = service ? serviceAccountInfo(service) : { projectId: "", clientEmail: "", type: "", privateKey: "", tokenUri: "" };
  const googleValid = Boolean(google && g.projectId && g.packages.includes(EXPECTED_PACKAGE));
  const serviceValid = Boolean(service && s.type === "service_account" && s.projectId && s.clientEmail && s.privateKey.includes("BEGIN PRIVATE KEY") && s.tokenUri.startsWith("https://"));
  const sameProject = Boolean(googleValid && serviceValid && g.projectId === s.projectId);
  return {
    expectedPackage: EXPECTED_PACKAGE,
    googleServices: { uploaded: Boolean(google), valid: googleValid, projectId: googleValid ? g.projectId : null, packageMatched: g.packages.includes(EXPECTED_PACKAGE) },
    serviceAccount: { uploaded: Boolean(service), valid: serviceValid, projectId: serviceValid ? s.projectId : null, clientEmail: serviceValid ? s.clientEmail : null },
    sameProject,
    readyForEas: googleValid && serviceValid && sameProject,
    fcmV1Configured: fcmConfigured,
  };
}

export async function registerAdminMobileReleaseRoutes(app: FastifyInstance) {
  const guard = requireAdminRoles(["SUPER_ADMIN"]);

  app.get("/admin/mobile-release/firebase", { preHandler: guard }, async (_request, reply) => {
    return reply.send(await statusPayload());
  });

  app.post("/admin/mobile-release/firebase/google-services", { preHandler: guard, bodyLimit: MAX_JSON_BYTES }, async (request, reply) => {
    const value = request.body;
    if (!value || typeof value !== "object" || Array.isArray(value)) return reply.code(400).send({ error: "invalid_json_file" });
    const data = value as Record<string, unknown>;
    const info = googleServicesInfo(data);
    if (!info.projectId) return reply.code(422).send({ error: "firebase_project_id_missing" });
    if (!info.packages.includes(EXPECTED_PACKAGE)) return reply.code(422).send({ error: "android_package_mismatch", expectedPackage: EXPECTED_PACKAGE });
    const service = await readJson(SERVICE_ACCOUNT);
    if (service) {
      const serviceInfo = serviceAccountInfo(service);
      if (serviceInfo.projectId && serviceInfo.projectId !== info.projectId) return reply.code(409).send({ error: "firebase_project_mismatch", existingProjectId: serviceInfo.projectId });
    }
    try { await saveJsonAtomic(GOOGLE_SERVICES, data); } catch (error) { return reply.code(error instanceof Error && error.message === "json_too_large" ? 413 : 500).send({ error: "firebase_file_save_failed" }); }
    await audit(request, "FIREBASE_GOOGLE_SERVICES_UPLOADED", "google-services.json", { projectId: info.projectId, packageName: EXPECTED_PACKAGE });
    return reply.send(await statusPayload());
  });

  app.post("/admin/mobile-release/firebase/service-account", { preHandler: guard, bodyLimit: MAX_JSON_BYTES }, async (request, reply) => {
    const value = request.body;
    if (!value || typeof value !== "object" || Array.isArray(value)) return reply.code(400).send({ error: "invalid_json_file" });
    const data = value as Record<string, unknown>;
    const info = serviceAccountInfo(data);
    if (info.type !== "service_account" || !info.projectId || !info.clientEmail || !info.privateKey.includes("BEGIN PRIVATE KEY") || !info.tokenUri.startsWith("https://")) {
      return reply.code(422).send({ error: "invalid_firebase_service_account" });
    }
    const google = await readJson(GOOGLE_SERVICES);
    if (!google) return reply.code(409).send({ error: "google_services_required_first" });
    const googleInfo = googleServicesInfo(google);
    if (googleInfo.projectId !== info.projectId) return reply.code(409).send({ error: "firebase_project_mismatch", googleServicesProjectId: googleInfo.projectId });
    try { await saveJsonAtomic(SERVICE_ACCOUNT, data); } catch (error) { return reply.code(error instanceof Error && error.message === "json_too_large" ? 413 : 500).send({ error: "firebase_file_save_failed" }); }
    await audit(request, "FIREBASE_SERVICE_ACCOUNT_UPLOADED", "firebase-service-account.json", { projectId: info.projectId, clientEmail: info.clientEmail });
    return reply.send(await statusPayload());
  });

  app.delete("/admin/mobile-release/firebase/:kind", { preHandler: guard }, async (request, reply) => {
    const kind = String((request.params as { kind?: string }).kind ?? "");
    const target = kind === "google-services" ? GOOGLE_SERVICES : kind === "service-account" ? SERVICE_ACCOUNT : null;
    if (!target) return reply.code(400).send({ error: "invalid_file_kind" });
    await unlink(target).catch(() => undefined);
    await audit(request, "FIREBASE_CREDENTIAL_FILE_REMOVED", kind, {});
    return reply.send(await statusPayload());
  });
}
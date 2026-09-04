import { createHash, randomBytes } from "node:crypto";
import { hash } from "@node-rs/argon2";
import { prisma } from "@pa/database";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

const EMAIL_TOKEN_TTL_MS = 1000 * 60 * 60 * 24;

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function newOpaqueToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

function onlyDigits(value: string) {
  return value.replace(/\D/g, "");
}

function luhnValid(value: string) {
  const digits = onlyDigits(value);
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let n = Number(digits[i]);
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}

const schema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(10).max(128),
  displayName: z.string().trim().min(2).max(80),
  legalName: z.string().trim().min(2).max(180),
  tradeName: z.string().trim().max(180).optional(),
  phone: z.string().trim().min(6).max(30).optional(),
  siren: z.string().trim().optional(),
  siret: z.string().trim().optional(),
  websiteUrl: z.string().url().max(500).optional().or(z.literal("")),
  city: z.string().trim().max(120).optional(),
  postalCode: z.string().trim().max(16).optional(),
}).refine((data) => data.siren || data.siret, { message: "siren_or_siret_required" });

export async function registerProfessionalRegistrationRoutes(app: FastifyInstance) {
  app.post("/auth/register/pro", async (request, reply) => {
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });

    const existing = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    if (existing) return reply.code(409).send({ error: "email_already_registered" });

    const siren = parsed.data.siren ? onlyDigits(parsed.data.siren) : undefined;
    const siret = parsed.data.siret ? onlyDigits(parsed.data.siret) : undefined;
    if (siren && (siren.length !== 9 || !luhnValid(siren))) return reply.code(400).send({ error: "invalid_siren" });
    if (siret && (siret.length !== 14 || !luhnValid(siret))) return reply.code(400).send({ error: "invalid_siret" });
    if (siren && siret && !siret.startsWith(siren)) return reply.code(400).send({ error: "siret_siren_mismatch" });

    const verificationToken = newOpaqueToken();
    const passwordHash = await hash(parsed.data.password, { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 });

    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: parsed.data.email,
          passwordHash,
          kind: "PROFESSIONNEL",
          profile: {
            create: {
              displayName: parsed.data.displayName,
              phone: parsed.data.phone,
              locale: "fr-FR",
              countryCode: "FR",
            },
          },
          business: {
            create: {
              legalName: parsed.data.legalName,
              tradeName: parsed.data.tradeName || undefined,
              siren,
              siret,
              headquartersCity: parsed.data.city,
              headquartersPostalCode: parsed.data.postalCode,
              verificationStatus: "PENDING",
            },
          },
        },
        select: { id: true, email: true, kind: true, status: true },
      });

      await tx.emailVerificationToken.create({
        data: { userId: created.id, tokenHash: sha256(verificationToken), expiresAt: new Date(Date.now() + EMAIL_TOKEN_TTL_MS) },
      });
      return created;
    });

    return reply.code(201).send({
      user,
      verificationRequired: true,
      professionalVerificationPending: true,
      ...(process.env.NODE_ENV !== "production" ? { devVerificationToken: verificationToken } : {}),
    });
  });
}

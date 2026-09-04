import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.ts";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required");
}

const adapter = new PrismaPg({ connectionString });

declare global {
  var __petitannoncesPrisma: PrismaClient | undefined;
}

export const prisma = globalThis.__petitannoncesPrisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalThis.__petitannoncesPrisma = prisma;
}

export * from "../generated/prisma/client.ts";

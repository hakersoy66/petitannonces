import { randomUUID } from "node:crypto";
import { prisma } from "@pa/database";

export const WELCOME_PA_CREDITS = 20;

export async function grantWelcomeCredits(userId: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `INSERT INTO "PromotionCreditWallet" ("id","userId","balance") VALUES ($1,$2,0) ON CONFLICT ("userId") DO NOTHING`,
      randomUUID(),
      userId,
    );

    const wallets = await tx.$queryRawUnsafe<Array<{ id: string; balance: number }>>(
      `SELECT "id","balance" FROM "PromotionCreditWallet" WHERE "userId"=$1 LIMIT 1`,
      userId,
    );
    const wallet = wallets[0];
    if (!wallet) throw new Error("wallet_creation_failed");

    const inserted = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO "PromotionCreditTransaction" ("id","walletId","type","amount","referenceType","referenceId","metadata")
       VALUES ($1,$2,'GRANT',$3,'WELCOME_BONUS',$4,$5::jsonb)
       ON CONFLICT DO NOTHING
       RETURNING "id"`,
      randomUUID(),
      wallet.id,
      WELCOME_PA_CREDITS,
      userId,
      JSON.stringify({ label: "Bonus de bienvenue", nonCash: true, platformOnly: true }),
    );

    if (inserted[0]) {
      await tx.$executeRawUnsafe(
        `UPDATE "PromotionCreditWallet" SET "balance"="balance"+$1,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$2`,
        WELCOME_PA_CREDITS,
        wallet.id,
      );
    }

    const updated = await tx.$queryRawUnsafe<Array<{ id: string; balance: number }>>(
      `SELECT "id","balance" FROM "PromotionCreditWallet" WHERE "id"=$1 LIMIT 1`,
      wallet.id,
    );

    return { walletId: wallet.id, balance: updated[0]?.balance ?? wallet.balance, granted: Boolean(inserted[0]) };
  });
}

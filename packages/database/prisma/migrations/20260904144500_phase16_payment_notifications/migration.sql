CREATE OR REPLACE FUNCTION "pa_order_paid_lifecycle"()
RETURNS trigger AS $$
BEGIN
  IF NEW."status" = 'PAID' AND OLD."status" IS DISTINCT FROM NEW."status" THEN
    UPDATE "Listing"
      SET "status" = 'SOLD', "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = NEW."listingId" AND "status" = 'PUBLISHED';

    INSERT INTO "UserNotification" ("id","userId","kind","title","body","actionUrl","metadata","createdAt")
    VALUES (
      md5(random()::text || clock_timestamp()::text || NEW."buyerId"),
      NEW."buyerId",
      'ORDER',
      'Paiement confirmé',
      'Votre paiement est confirmé. Le vendeur peut maintenant préparer votre colis.',
      '/commandes/' || NEW."id",
      jsonb_build_object('orderId', NEW."id", 'orderNumber', NEW."orderNumber", 'event', 'PAYMENT_CONFIRMED'),
      CURRENT_TIMESTAMP
    );

    INSERT INTO "UserNotification" ("id","userId","kind","title","body","actionUrl","metadata","createdAt")
    VALUES (
      md5(random()::text || clock_timestamp()::text || NEW."sellerId"),
      NEW."sellerId",
      'ORDER',
      'Vous avez réalisé une vente !',
      'Le paiement de la commande est confirmé. Préparez maintenant l’envoi avec Sendcloud.',
      '/commandes/' || NEW."id",
      jsonb_build_object('orderId', NEW."id", 'orderNumber', NEW."orderNumber", 'event', 'SALE_CONFIRMED'),
      CURRENT_TIMESTAMP
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "trg_order_paid_lifecycle" ON "MarketplaceOrder";
CREATE TRIGGER "trg_order_paid_lifecycle"
AFTER UPDATE OF "status" ON "MarketplaceOrder"
FOR EACH ROW
EXECUTE FUNCTION "pa_order_paid_lifecycle"();

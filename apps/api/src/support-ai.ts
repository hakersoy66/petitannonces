import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@pa/database";
import { getRuntimeIntegration } from "./admin-control.js";

const CATEGORIES=new Set(["ACCOUNT","LISTING","PAYMENT","ORDER","SHIPPING","DISPUTE","PROFESSIONAL","COMPLIANCE","SAFETY","OTHER"]);
const HUMAN_REVIEW=new Set(["DISPUTE","COMPLIANCE","SAFETY"]);

export async function ensureSupportFaqSchema(){
 await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "SupportFaq" ("id" TEXT PRIMARY KEY,"slug" TEXT NOT NULL UNIQUE,"category" "SupportTicketCategory" NOT NULL,"question" TEXT NOT NULL,"answer" TEXT NOT NULL,"sourceTicketId" TEXT UNIQUE,"published" BOOLEAN NOT NULL DEFAULT TRUE,"sortOrder" INTEGER NOT NULL DEFAULT 0,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "SupportFaq_sourceTicketId_fkey" FOREIGN KEY ("sourceTicketId") REFERENCES "SupportTicket"("id") ON DELETE SET NULL)`);
 await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "SupportFaq_category_published_idx" ON "SupportFaq"("category","published","sortOrder")`);
 const seeds=[
  ["faq-seed-account-create","creer-compte-particulier","ACCOUNT","Comment créer un compte sur Petit Annonces ?","Pour créer un compte, ouvrez la page Inscription puis choisissez Particulier. Renseignez les informations demandées, votre adresse e-mail et votre mot de passe, acceptez les conditions puis validez. Une fois le compte créé, un écran de confirmation s’affiche et vous êtes dirigé vers Mon compte. Un e-mail de confirmation peut également être envoyé afin de sécuriser votre adresse e-mail."],
  ["faq-seed-account-member","devenir-membre","ACCOUNT","Comment devenir membre de Petit Annonces ?","Allez sur Inscription, choisissez Particulier si vous utilisez Petit Annonces à titre personnel, complétez le formulaire puis créez votre compte. Après la création, vous accédez directement à votre espace Mon compte où vous pouvez gérer votre profil, vos annonces, vos favoris, vos notifications, vos adresses, votre sécurité et vos paramètres."],
  ["faq-seed-account-email","verifier-mon-adresse-email","ACCOUNT","Comment vérifier mon adresse e-mail ?","Après votre inscription, ouvrez l’e-mail de confirmation envoyé par Petit Annonces et utilisez le lien de vérification. Si vous ne le trouvez pas, vérifiez les courriers indésirables puis demandez un nouvel envoi depuis votre compte."],
  ["faq-seed-account-dashboard","gerer-mon-compte","ACCOUNT","Que puis-je gérer depuis Mon compte ?","L’espace Mon compte regroupe vos principales actions : Mes annonces, Favoris, Recherches enregistrées, Notifications, Activité, Profil et vérification, Sécurité, Adresses, Paramètres, Portefeuille et IBAN & versements lorsque vous vendez via la marketplace. Sur mobile, ces sections sont accessibles depuis le menu Compte."],
  ["faq-seed-address","ajouter-adresse","ACCOUNT","Comment ajouter ou modifier mon adresse ?","Ouvrez Mon compte > Adresses. Vous pouvez ajouter une nouvelle adresse manuellement ou utiliser Ma position actuelle pour demander la localisation de votre appareil. Si vous autorisez l’accès, Petit Annonces tente de remplir automatiquement l’adresse, le code postal, la ville et la région. Vérifiez toujours les informations détectées avant d’enregistrer. Une adresse existante peut ensuite être modifiée depuis sa carte."],
  ["faq-seed-account-password","mot-de-passe-oublie","ACCOUNT","J’ai oublié mon mot de passe, que faire ?","Depuis la page Connexion, ouvrez Mot de passe oublié puis renseignez l’adresse e-mail associée à votre compte. Si l’adresse est reconnue, un e-mail de réinitialisation est envoyé. Le lien de réinitialisation est temporaire afin de protéger votre compte. Choisissez ensuite un nouveau mot de passe suffisamment long et unique."],
  ["faq-seed-pro-open","ouvrir-compte-pro","PROFESSIONAL","Comment ouvrir un compte professionnel sur Petit Annonces ?","Sur la page Inscription, choisissez Professionnel. Le parcours Pro commence par la saisie de votre numéro SIRET à 14 chiffres. Petit Annonces vérifie le SIRET auprès du registre officiel des entreprises françaises. Si l’entreprise est active et que le numéro est valide, les informations disponibles comme la raison sociale, le SIREN, le SIRET, l’adresse, la ville, le code postal et le code NAF sont récupérées automatiquement. Vous complétez ensuite les informations du responsable du compte et vos identifiants de connexion, puis vous choisissez le nom de votre boutique. À la fin du parcours, le compte professionnel, le profil entreprise et la boutique sont créés ensemble et vous êtes dirigé vers l’Espace Pro."],
  ["faq-seed-pro-siret","verification-siret-boutique","PROFESSIONAL","Comment fonctionne la vérification SIRET ?","Lors d’une inscription professionnelle, saisissez votre SIRET à 14 chiffres dans l’étape de vérification. Petit Annonces interroge le registre officiel des entreprises afin de vérifier que l’établissement existe et qu’il est actif. Si le contrôle réussit, les informations de l’entreprise sont préremplies automatiquement et le statut de vérification professionnelle est enregistré comme vérifié. Si le SIRET n’est pas reconnu, est incomplet ou correspond à un établissement inactif, vous ne pouvez pas passer à l’étape suivante tant que le problème n’est pas corrigé."],
  ["faq-seed-pro-store","creer-boutique-pro","PROFESSIONAL","Comment créer ma boutique professionnelle ?","Lors de la création d’un compte Pro, une étape Boutique vous permet de choisir le nom de votre boutique avant la fin de l’inscription. Après création, ouvrez Espace Pro > Ma boutique pour ajouter votre logo, votre image de couverture, votre description, vos coordonnées et votre site si nécessaire. Vous pouvez également associer ou retirer vos annonces actives directement depuis l’écran de gestion de la boutique."],
  ["faq-seed-listing-create","deposer-annonce","LISTING","Comment déposer une annonce sur Petit Annonces ?","Connectez-vous puis cliquez sur Déposer une annonce. Le dépôt se fait avec un assistant en plusieurs étapes. Vous choisissez d’abord la catégorie, puis vous renseignez les informations principales de l’annonce. Selon la catégorie, Petit Annonces peut demander des champs spécifiques, par exemple les caractéristiques du produit, des informations véhicule ou les données énergétiques pour l’immobilier. Vous ajoutez ensuite vos photos, votre prix, les informations de livraison ou de remise, puis vous vérifiez le récapitulatif avant publication. Une fois envoyée, l’annonce peut être publiée immédiatement ou passer par une étape de vérification selon le cas."],
  ["faq-seed-listing-steps","etapes-depot-annonce","LISTING","Quelles sont les étapes du formulaire de dépôt d’annonce ?","Le formulaire de dépôt est organisé en 5 étapes afin d’éviter un formulaire trop long. Le parcours couvre la catégorie et le type d’annonce, les informations et caractéristiques, les photos, le prix et les modalités de remise ou livraison, puis la vérification finale avant envoi. Les boutons Suivant et Précédent permettent de passer d’une étape à l’autre avec une transition visuelle. Une annonce commencée peut aussi être conservée comme brouillon afin d’être reprise plus tard."],
  ["faq-seed-listing-photos","ajouter-photos-annonce","LISTING","Comment ajouter des photos à mon annonce ?","Dans l’étape Photos du dépôt d’annonce, vous pouvez choisir des images depuis la galerie de votre appareil. Sur mobile, Petit Annonces ne vous oblige pas à ouvrir l’appareil photo : la sélection de la galerie reste disponible et une action séparée peut être utilisée pour prendre une photo. Les formats courants comme JPEG, PNG, WebP, AVIF, HEIC et HEIF sont pris en charge. Vous pouvez également réorganiser les photos avant la publication lorsque l’interface le permet."],
  ["faq-seed-listing-edit","modifier-annonce","LISTING","Comment modifier une annonce déjà créée ?","Ouvrez Mon compte > Mes annonces. Repérez l’annonce concernée puis ouvrez le menu Plus si l’action Modifier n’est pas affichée directement. Sélectionnez Modifier pour revenir au formulaire de l’annonce et mettre à jour les informations autorisées. Selon le statut de l’annonce, certaines actions peuvent varier : une annonce publiée peut aussi être mise en pause, boostée ou marquée comme vendue, tandis qu’un brouillon peut être repris et complété avant publication."],
  ["faq-seed-listing-credit-boost","utiliser-credit-pour-booster","LISTING","Comment utiliser mon crédit Petit Annonces pour booster une annonce ?","Ouvrez Mon compte > Mes annonces puis choisissez Booster sur une annonce publiée. Votre solde Petit Annonces est vérifié automatiquement : s’il couvre le prix de la mise en avant, le montant est prélevé directement sur votre crédit et le boost est activé sans ouvrir de paiement externe. Vous pouvez vérifier votre solde et son historique dans Mon compte > Portefeuille."],

  ["faq-seed-listing-draft","reprendre-brouillon","LISTING","Comment reprendre un brouillon d’annonce ?","Allez dans Mon compte > Mes annonces. Les annonces enregistrées en brouillon affichent une action Continuer. Sélectionnez-la pour reprendre le dépôt à l’endroit où vous l’aviez laissé. Vous pouvez compléter les champs manquants, ajouter les photos nécessaires puis poursuivre jusqu’à la dernière étape avant publication."],
  ["faq-seed-listing-moderation","annonce-en-verification","LISTING","Pourquoi mon annonce est-elle en cours de vérification ?","Certaines annonces passent par une vérification avant leur publication afin de protéger la communauté et de vérifier leur conformité. Vous pouvez suivre son statut dans Mes annonces. Si une modification est nécessaire, une notification vous indiquera quoi corriger."],
  ["faq-seed-payment-payout","versement-vendeur-delai","PAYMENT","Quand un vendeur reçoit-il son versement ?","Le montant net vendeur devient éligible au versement au 21e jour après la livraison, sous réserve qu’aucun litige, retour ou remboursement ne soit en cours. La période de protection acheteur de 48 heures est incluse dans ce délai. Le suivi est disponible dans IBAN & versements."],
  ["faq-seed-iban","ajouter-iban","PAYMENT","Comment ajouter mon IBAN pour recevoir mes ventes ?","Ouvrez Mon compte > IBAN & versements. Sélectionnez Ajouter mon IBAN puis suivez la procédure de vérification bancaire affichée. Les coordonnées bancaires sont traitées par le prestataire de paiement sécurisé et ne sont pas stockées en clair par Petit Annonces. Le panneau indique si votre identité, votre compte bancaire et vos versements sont prêts ou encore à compléter."],
  ["faq-seed-order-protection","protection-acheteur","ORDER","Comment fonctionne la protection acheteur ?","Après la livraison, une période de protection permet de signaler un problème depuis la commande. Un litige, retour ou remboursement en cours bloque automatiquement le versement au vendeur jusqu’au traitement du dossier."],
  ["faq-seed-shipping-label","preparer-mon-envoi","SHIPPING","Comment préparer l’envoi d’une vente ?","Depuis la commande concernée, utilisez le bouton Préparer mon envoi lorsque l’expédition est disponible. Suivez ensuite les instructions affichées et conservez le suivi de livraison dans la commande."],
  ["faq-seed-listing-delete","supprimer-annonce","LISTING","Comment supprimer définitivement une annonce ?","Ouvrez Mon compte > Mes annonces, repérez l’annonce concernée puis utilisez l’action Supprimer. Confirmez la suppression uniquement si vous ne souhaitez plus conserver l’annonce. Si l’annonce est liée à une transaction, un litige ou une opération en cours, certaines actions peuvent être limitées jusqu’à la fin du traitement."],
  ["faq-seed-listing-duplicate","annonce-en-double","LISTING","Pourquoi Petit Annonces refuse une annonce en double ?","Petit Annonces peut bloquer la création d’une annonce lorsqu’une annonce très similaire existe déjà sur le même compte. Vérifiez d’abord Mes annonces et vos brouillons. Si l’annonce existe déjà, modifiez ou reprenez l’annonce existante plutôt que d’en créer une seconde."],
  ["faq-seed-listing-import","importer-annonce-existante","LISTING","Comment importer une annonce existante ?","Lorsque l’outil d’import est disponible dans votre espace, ouvrez Importer une annonce puis indiquez l’URL de l’annonce source. Vérifiez toujours les photos, le titre, la description, le prix et la catégorie avant publication. Si l’import s’arrête avant la fin, reprenez le brouillon créé plutôt que de relancer plusieurs imports identiques."],
  ["faq-seed-order-unpaid","acheteur-paiement-non-finalise","ORDER","L’acheteur n’a pas terminé son paiement, est-ce une vente ?","Non. Une tentative de commande dont le paiement n’est pas confirmé ne constitue pas une vente. Aucun montant ne doit être considéré comme encaissé et l’annonce ne doit pas être comptée comme vendue pour cette seule tentative. Le support vérifie le statut réel de la commande avant de confirmer la situation."],
  ["faq-seed-messaging-start","message-vendeur-conversation","OTHER","Pourquoi une conversation ne démarre-t-elle pas après avoir contacté un vendeur ?","Vérifiez d’abord que vous êtes connecté, puis réessayez depuis le bouton Contacter de l’annonce. Consultez ensuite Messages pour voir si la conversation existe déjà. Si le bouton semble fonctionner mais qu’aucune conversation n’apparaît, répondez dans votre ticket : le support peut vérifier la conversation et ses derniers événements côté système."],
  ["faq-seed-pwa-notifications","notifications-pwa","ACCOUNT","Pourquoi je ne reçois pas les notifications sur mobile ou PWA ?","Vérifiez que les notifications sont autorisées dans Petit Annonces et dans les réglages du navigateur ou du téléphone. Sur une PWA installée, vérifiez aussi que l’application n’est pas privée d’autorisations ou limitée par un mode économie d’énergie. Le support peut contrôler l’état des derniers envois et distinguer un message accepté, livré ou en erreur."],
  ["faq-seed-credit-nonwithdrawable","credit-petit-annonces","PAYMENT","À quoi sert le crédit Petit Annonces ?","Le crédit Petit Annonces sert aux services internes de la plateforme, par exemple certaines mises en avant lorsqu’elles sont proposées. Il ne correspond pas à un solde bancaire retirable. Votre solde et ses mouvements sont visibles dans Mon compte > Portefeuille."],
  ["faq-seed-vacances-availability","vacances-disponibilite-dates","OTHER","Comment vérifier si un hébergement Vacances est disponible ?","Ouvrez Vacances, choisissez la destination, la date d’arrivée, la date de départ et le nombre de voyageurs puis lancez Vérifier les disponibilités. Les annonces Petit Annonces utilisent leur calendrier de réservation. Pour les hôtels partenaires, la disponibilité et le tarif sont vérifiés auprès du fournisseur lorsque le service temps réel est disponible."],
  ["faq-seed-hotel-partner","hotel-partenaire-reservation","OTHER","Comment fonctionne une réservation d’hôtel partenaire ?","Les hôtels partenaires sont affichés séparément des annonces Vacances classiques. Après le choix des dates et des voyageurs, Petit Annonces vérifie le tarif et la disponibilité du fournisseur avant de permettre la préparation d’une réservation. Une sélection d’hôtel sans tarif confirmé ne doit pas être considérée comme une réservation confirmée."],
  ["faq-seed-google-login","connexion-google-expiree","ACCOUNT","Que faire si la connexion Google expire ou échoue ?","Revenez à l’écran Connexion puis relancez Connexion avec Google une seule fois. Si la demande expire de nouveau, évitez de multiplier les tentatives, vérifiez que les cookies et fenêtres de connexion sont autorisés puis utilisez votre connexion e-mail si elle est disponible. Le support peut vérifier l’état du compte sans vous demander votre mot de passe Google."],
  ["faq-seed-shipping-tracking","suivi-colis-retard","SHIPPING","Le suivi de mon colis ne bouge plus, que faire ?","Ouvrez la commande et vérifiez le dernier événement de suivi ainsi que le transporteur indiqué. Un délai entre deux scans n’indique pas automatiquement une perte. Si le statut passe à anomalie, retour ou colis perdu, poursuivez votre demande de support afin qu’un agent vérifie la transaction avant toute décision de remboursement ou de versement."],
  ["faq-seed-safety-scam","messages-suspects","SAFETY","Que faire si un message ou un utilisateur me paraît suspect ?","Ne communiquez jamais votre mot de passe, un code OTP, vos codes de récupération ou vos coordonnées bancaires complètes. Utilisez les fonctions de signalement et de blocage disponibles sur Petit Annonces, et ouvrez une demande de support si vous pensez que votre compte ou une transaction est à risque."]
 ];
 for(const [id,slug,category,question,answer] of seeds){await prisma.$executeRawUnsafe(`INSERT INTO "SupportFaq" ("id","slug","category","question","answer","sortOrder") VALUES ($1,$2,$3::"SupportTicketCategory",$4,$5,10) ON CONFLICT ("id") DO NOTHING`,id,slug,category,question,answer)}
}
function slugify(v:string){const b=v.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,72)||"question";return `${b}-${createHash("sha1").update(v).digest("hex").slice(0,8)}`}
function redact(v:string){return v.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,"[e-mail]").replace(/(?:\+33|0)[1-9](?:[ .-]?\d{2}){4}/g,"[téléphone]").replace(/\b(?:SUP|CMD|ORD|PA|ANN)[-_ ]?[A-Z0-9-]{5,}\b/gi,"[référence]").replace(/\b[A-F0-9]{8}-[A-F0-9-]{20,}\b/gi,"[identifiant]").replace(/\s+/g," ").trim()}
async function runtimeAi(){const c=await getRuntimeIntegration("openai");const apiKey=(c?.enabled?c.secrets.apiKey:process.env.OPENAI_API_KEY)?.trim();const model=String(c?.enabled?(c.config.supportModel??c.config.model??""):(process.env.AI_SUPPORT_MODEL?.trim()||process.env.OPENAI_MODEL?.trim()||"")).trim();return apiKey&&model?{apiKey,model}:null}
async function callAi(input:string,max_output_tokens=650){const ai=await runtimeAi();if(!ai)return null;try{const r=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{authorization:`Bearer ${ai.apiKey}`,"content-type":"application/json"},body:JSON.stringify({model:ai.model,input,max_output_tokens}),signal:AbortSignal.timeout(12000)});if(!r.ok)return null;const p=await r.json() as any;const direct=typeof p.output_text==="string"?p.output_text:null;const nested=Array.isArray(p.output)?p.output.flatMap((i:any)=>Array.isArray(i?.content)?i.content:[]).find((x:any)=>x?.type==="output_text")?.text:null;return String(direct??nested??"").trim()||null}catch{return null}}
export async function listSupportFaqs(category?:string,q?:string){await ensureSupportFaqSchema();const cat=category&&CATEGORIES.has(category)?category:null;const query=(q??"").trim();return prisma.$queryRawUnsafe<Array<{id:string;slug:string;category:string;question:string;answer:string;sortOrder:number}>>(`SELECT "id","slug","category"::text,"question","answer","sortOrder" FROM "SupportFaq" WHERE "published"=TRUE AND ($1::text IS NULL OR "category"::text=$1) AND ($2::text='' OR "question" ILIKE '%'||$2||'%' OR "answer" ILIKE '%'||$2||'%') ORDER BY "sortOrder" DESC,"updatedAt" DESC LIMIT 80`,cat,query)}
type SupportOrderContext={
 orderId:string;
 orderNumber:string;
 orderStatus:string;
 paidAt:Date|null;
 paymentStatus:string|null;
 refundStatus:string|null;
 shipmentStatus:string|null;
 shipmentCarrier:string|null;
 estimatedDeliveryAt:Date|null;
 deliveredAt:Date|null;
 payoutStatus:string|null;
 payoutAvailableAt:Date|null;
 payoutPaidAt:Date|null;
 listingStatus:string|null;
 listingTitle:string|null;
 customerRole:"BUYER"|"SELLER";
};

type SupportSystemContext={
 userId:string|null;
 accountStatus:string|null;
 accountKind:string|null;
 emailVerified:boolean|null;
 lockedUntil:Date|null;
 verificationTokenActive:boolean|null;
 verificationTokenExpiresAt:Date|null;
 verificationMailStatus:string|null;
 verificationMailDeliveryStatus:string|null;
 verificationMailProvider:string|null;
 verificationMailSentAt:Date|null;
 verificationMailError:boolean;
 passwordResetTokenActive:boolean|null;
 passwordResetTokenExpiresAt:Date|null;
 passwordResetMailStatus:string|null;
 passwordResetMailDeliveryStatus:string|null;
 passwordResetMailSentAt:Date|null;
 passwordResetMailError:boolean;
 listingId:string|null;
 listingTitle:string|null;
 listingStatus:string|null;
 listingPublishedAt:Date|null;
 listingExpiresAt:Date|null;
 listingModerationStatus:string|null;
 businessVerificationStatus:string|null;
 storeStatus:string|null;
 storeVerified:boolean|null;
 subscriptionStatus:string|null;
 subscriptionTrialEndsAt:Date|null;
 siteCreditBalanceMinor:number|null;
 publishedListingCount:number|null;
};

type SupportActivityContext={
 recentListings:Array<{title:string|null;status:string;city:string|null;publishedAt:Date|null;updatedAt:Date}>;
 recentTickets:Array<{reference:string;category:string;subject:string;status:string;lastMessageAt:Date}>;
 creditTransactions:Array<{type:string;amountMinor:number;referenceType:string|null;createdAt:Date}>;
 promotions:Array<{title:string|null;status:string;startsAt:Date|null;endsAt:Date|null;source:string|null}>;
 conversation:{status:string;messageCount:number;lastMessageAt:Date|null;lastMessageFrom:string|null}|null;
 notifications:Array<{kind:string;title:string;readAt:Date|null;createdAt:Date}>;
 deliveries:Array<{eventKind:string;channel:string;status:string;deliveryStatus:string|null;provider:string|null;sentAt:Date|null;hasError:boolean;createdAt:Date}>;
 vacationReservations:Array<{role:string;title:string|null;city:string|null;checkIn:Date;checkOut:Date;status:string;grandTotalMinor:number|null;currency:string}>;
 hbxBookings:Array<{hotelName:string|null;city:string|null;providerReference:string|null;clientReference:string;checkIn:Date;checkOut:Date;status:string;environment:string;currency:string|null;total:number|null}>;
};


function extractOrderReference(value:string){
 const match=value.match(/\bPA-[A-Z0-9]+-[A-Z0-9]+\b/i);
 return match?.[0]?.toUpperCase()??null;
}

function frDate(value:Date|null){
 if(!value)return null;
 try{return new Intl.DateTimeFormat("fr-FR",{dateStyle:"long",timeZone:"Europe/Paris"}).format(new Date(value))}catch{return null}
}

async function getSupportOrderContext(ticketId:string,subject:string,body:string):Promise<SupportOrderContext|null>{
 const tickets=await prisma.$queryRawUnsafe<Array<{userId:string|null;orderId:string|null}>>(
   `SELECT "userId","orderId" FROM "SupportTicket" WHERE "id"=$1 LIMIT 1`,
   ticketId,
 ).catch(()=>[]);
 const ticket=tickets[0];
 if(!ticket?.userId)return null;

 let orderNumber=extractOrderReference(`${subject} ${body}`);
 if(!orderNumber&&!ticket.orderId){
  const history=await prisma.$queryRawUnsafe<Array<{body:string}>>(
   `SELECT "body" FROM "SupportTicketMessage" WHERE "ticketId"=$1 AND "internalNote"=FALSE ORDER BY "createdAt" DESC LIMIT 12`,
   ticketId,
  ).catch(()=>[]);
  orderNumber=history.map(x=>extractOrderReference(x.body)).find((x):x is string=>Boolean(x))??null;
 }
 if(!orderNumber&&!ticket.orderId)return null;

 const rows=await prisma.$queryRawUnsafe<SupportOrderContext[]>(`
   SELECT o."id" AS "orderId",
          o."orderNumber",
          o."status"::text AS "orderStatus",
          o."paidAt",
          p."status"::text AS "paymentStatus",
          rf."status"::text AS "refundStatus",
          sh."status"::text AS "shipmentStatus",
          sh."carrier" AS "shipmentCarrier",
          sh."estimatedDeliveryAt",
          sh."deliveredAt",
          po."status"::text AS "payoutStatus",
          po."availableAt" AS "payoutAvailableAt",
          po."paidAt" AS "payoutPaidAt",
          l."status"::text AS "listingStatus",
          l."title" AS "listingTitle",
          CASE WHEN o."buyerId"=$2 THEN 'BUYER' ELSE 'SELLER' END AS "customerRole"
   FROM "MarketplaceOrder" o
   LEFT JOIN "Listing" l ON l."id"=o."listingId"
   LEFT JOIN LATERAL (
     SELECT mp."status"
     FROM "MarketplacePayment" mp
     WHERE mp."orderId"=o."id"
     ORDER BY mp."createdAt" DESC
     LIMIT 1
   ) p ON TRUE
   LEFT JOIN LATERAL (
     SELECT mr."status"
     FROM "MarketplaceRefund" mr
     WHERE mr."orderId"=o."id"
     ORDER BY mr."createdAt" DESC
     LIMIT 1
   ) rf ON TRUE
   LEFT JOIN LATERAL (
     SELECT ms."status",ms."carrier",ms."estimatedDeliveryAt",ms."deliveredAt"
     FROM "MarketplaceShipment" ms
     WHERE ms."orderId"=o."id"
     ORDER BY ms."createdAt" DESC
     LIMIT 1
   ) sh ON TRUE
   LEFT JOIN "MarketplacePayout" po ON po."orderId"=o."id"
   WHERE (o."buyerId"=$1 OR o."sellerId"=$1)
     AND (
       ($2::text IS NOT NULL AND o."id"=$2)
       OR ($3::text IS NOT NULL AND o."orderNumber"=$3)
     )
   ORDER BY CASE WHEN $2::text IS NOT NULL AND o."id"=$2 THEN 0 ELSE 1 END
   LIMIT 1
 `,ticket.userId,ticket.orderId,orderNumber);
 return rows[0]??null;
}

async function getSupportSystemContext(ticketId:string):Promise<SupportSystemContext|null>{
 const rows=await prisma.$queryRawUnsafe<SupportSystemContext[]>(`
  SELECT
    t."userId",
    u."status"::text AS "accountStatus",
    u."kind"::text AS "accountKind",
    (u."emailVerifiedAt" IS NOT NULL) AS "emailVerified",
    u."lockedUntil",
    CASE WHEN evt."id" IS NULL THEN NULL ELSE (evt."usedAt" IS NULL AND evt."expiresAt">CURRENT_TIMESTAMP) END AS "verificationTokenActive",
    evt."expiresAt" AS "verificationTokenExpiresAt",
    mail."status" AS "verificationMailStatus",
    mail."deliveryStatus" AS "verificationMailDeliveryStatus",
    mail."provider" AS "verificationMailProvider",
    mail."sentAt" AS "verificationMailSentAt",
    CASE WHEN mail."lastError" IS NOT NULL OR mail."providerError" IS NOT NULL THEN TRUE ELSE FALSE END AS "verificationMailError",
    CASE WHEN prt."id" IS NULL THEN NULL ELSE (prt."usedAt" IS NULL AND prt."expiresAt">CURRENT_TIMESTAMP) END AS "passwordResetTokenActive",
    prt."expiresAt" AS "passwordResetTokenExpiresAt",
    resetmail."status" AS "passwordResetMailStatus",
    resetmail."deliveryStatus" AS "passwordResetMailDeliveryStatus",
    resetmail."sentAt" AS "passwordResetMailSentAt",
    CASE WHEN resetmail."lastError" IS NOT NULL OR resetmail."providerError" IS NOT NULL THEN TRUE ELSE FALSE END AS "passwordResetMailError",
    l."id" AS "listingId",
    l."title" AS "listingTitle",
    l."status"::text AS "listingStatus",
    l."publishedAt" AS "listingPublishedAt",
    lc."expiresAt" AS "listingExpiresAt",
    mc."status"::text AS "listingModerationStatus",
    bp."verificationStatus"::text AS "businessVerificationStatus",
    st."status"::text AS "storeStatus",
    st."isVerified" AS "storeVerified",
    ps."status"::text AS "subscriptionStatus",
    ps."trialEndsAt" AS "subscriptionTrialEndsAt",
    COALESCE((SELECT w."balanceMinor" FROM "SiteCreditWallet" w WHERE w."userId"=t."userId" LIMIT 1),0)::int AS "siteCreditBalanceMinor",
    (SELECT COUNT(*)::int FROM "Listing" pl WHERE pl."sellerId"=t."userId" AND pl."status"='PUBLISHED') AS "publishedListingCount"
  FROM "SupportTicket" t
  LEFT JOIN "User" u ON u."id"=t."userId"
  LEFT JOIN LATERAL (
    SELECT e."id",e."usedAt",e."expiresAt"
    FROM "EmailVerificationToken" e
    WHERE e."userId"=t."userId"
    ORDER BY e."createdAt" DESC
    LIMIT 1
  ) evt ON TRUE
  LEFT JOIN LATERAL (
    SELECT o."status",o."deliveryStatus",o."provider",o."sentAt",o."lastError",o."providerError"
    FROM "NotificationDeliveryOutbox" o
    WHERE o."userId"=t."userId"
      AND o."eventKind"='AUTH_VERIFY_EMAIL'
      AND o."channel"='EMAIL'
    ORDER BY o."createdAt" DESC
    LIMIT 1
  ) mail ON TRUE
  LEFT JOIN LATERAL (
    SELECT p."id",p."usedAt",p."expiresAt"
    FROM "PasswordResetToken" p
    WHERE p."userId"=t."userId"
    ORDER BY p."createdAt" DESC
    LIMIT 1
  ) prt ON TRUE
  LEFT JOIN LATERAL (
    SELECT o."status",o."deliveryStatus",o."sentAt",o."lastError",o."providerError"
    FROM "NotificationDeliveryOutbox" o
    WHERE o."userId"=t."userId"
      AND o."eventKind"='AUTH_PASSWORD_RESET'
      AND o."channel"='EMAIL'
    ORDER BY o."createdAt" DESC
    LIMIT 1
  ) resetmail ON TRUE
  LEFT JOIN "Listing" l
    ON l."id"=t."listingId"
   AND l."sellerId"=t."userId"
  LEFT JOIN "ListingLifecycle" lc ON lc."listingId"=l."id"
  LEFT JOIN LATERAL (
    SELECT m."status"
    FROM "ModerationCase" m
    WHERE m."targetType"='LISTING'
      AND m."targetId"=l."id"
    ORDER BY m."createdAt" DESC
    LIMIT 1
  ) mc ON TRUE
  LEFT JOIN "BusinessProfile" bp ON bp."userId"=t."userId"
  LEFT JOIN LATERAL (
    SELECT s."status",s."isVerified"
    FROM "Store" s
    WHERE s."ownerId"=t."userId"
    ORDER BY s."updatedAt" DESC
    LIMIT 1
  ) st ON TRUE
  LEFT JOIN LATERAL (
    SELECT psub."status",psub."trialEndsAt"
    FROM "ProfessionalSubscription" psub
    WHERE psub."userId"=t."userId"
    ORDER BY psub."updatedAt" DESC
    LIMIT 1
  ) ps ON TRUE
  WHERE t."id"=$1
  LIMIT 1
 `,ticketId).catch(()=>[]);
 return rows[0]??null;
}

async function getSupportActivityContext(ticketId:string):Promise<SupportActivityContext|null>{
 const tickets=await prisma.$queryRawUnsafe<Array<{userId:string|null;conversationId:string|null}>>(`SELECT "userId","conversationId" FROM "SupportTicket" WHERE "id"=$1 LIMIT 1`,ticketId).catch(()=>[]);
 const ticket=tickets[0];if(!ticket?.userId)return null;const userId=ticket.userId;
 const [recentListings,recentTickets,creditTransactions,promotions,conversationRows,notifications,deliveries,vacationReservations,hbxBookings]=await Promise.all([
  prisma.$queryRawUnsafe<Array<any>>(`SELECT "title","status"::text,"city","publishedAt","updatedAt" FROM "Listing" WHERE "sellerId"=$1 ORDER BY "updatedAt" DESC LIMIT 5`,userId).catch(()=>[]),
  prisma.$queryRawUnsafe<Array<any>>(`SELECT "reference","category"::text,"subject","status"::text,"lastMessageAt" FROM "SupportTicket" WHERE "userId"=$1 AND "id"<>$2 ORDER BY "lastMessageAt" DESC LIMIT 5`,userId,ticketId).catch(()=>[]),
  prisma.$queryRawUnsafe<Array<any>>(`SELECT tx."type"::text,tx."amountMinor",tx."referenceType",tx."createdAt" FROM "SiteCreditTransaction" tx JOIN "SiteCreditWallet" w ON w."id"=tx."walletId" WHERE w."userId"=$1 ORDER BY tx."createdAt" DESC LIMIT 8`,userId).catch(()=>[]),
  prisma.$queryRawUnsafe<Array<any>>(`SELECT l."title",p."status"::text,p."startsAt",p."endsAt",p."source"::text FROM "ListingPromotion" p JOIN "Listing" l ON l."id"=p."listingId" WHERE p."userId"=$1 ORDER BY p."createdAt" DESC LIMIT 6`,userId).catch(()=>[]),
  ticket.conversationId?prisma.$queryRawUnsafe<Array<any>>(`SELECT c."status"::text,COUNT(m."id")::int AS "messageCount",c."lastMessageAt",(SELECT CASE WHEN lm."senderId"=$2 THEN 'CLIENT' ELSE 'INTERLOCUTEUR' END FROM "Message" lm WHERE lm."conversationId"=c."id" ORDER BY lm."createdAt" DESC LIMIT 1) AS "lastMessageFrom" FROM "Conversation" c LEFT JOIN "Message" m ON m."conversationId"=c."id" WHERE c."id"=$1 AND (c."buyerId"=$2 OR c."sellerId"=$2) GROUP BY c."id" LIMIT 1`,ticket.conversationId,userId).catch(()=>[]):Promise.resolve([]),
  prisma.$queryRawUnsafe<Array<any>>(`SELECT "kind"::text,"title","readAt","createdAt" FROM "UserNotification" WHERE "userId"=$1 ORDER BY "createdAt" DESC LIMIT 8`,userId).catch(()=>[]),
  prisma.$queryRawUnsafe<Array<any>>(`SELECT "eventKind","channel"::text,"status"::text,"deliveryStatus","provider","sentAt",("lastError" IS NOT NULL OR "providerError" IS NOT NULL) AS "hasError","createdAt" FROM "NotificationDeliveryOutbox" WHERE "userId"=$1 ORDER BY "createdAt" DESC LIMIT 8`,userId).catch(()=>[]),
  prisma.$queryRawUnsafe<Array<any>>(`SELECT CASE WHEN vr."guestId"=$1 THEN 'VOYAGEUR' ELSE 'HOTE' END AS "role",l."title",l."city",vr."checkIn",vr."checkOut",vr."status"::text,vr."grandTotalMinor",vr."currency" FROM "VacationReservationRequest" vr LEFT JOIN "Listing" l ON l."id"=vr."listingId" WHERE vr."guestId"=$1 OR vr."hostId"=$1 ORDER BY vr."createdAt" DESC LIMIT 5`,userId).catch(()=>[]),
  prisma.$queryRawUnsafe<Array<any>>(`SELECT "hotelName","city","providerReference","clientReference","checkIn","checkOut","status","environment","currency","total" FROM "HbxHotelBooking" WHERE "userId"=$1 ORDER BY "createdAt" DESC LIMIT 5`,userId).catch(()=>[]),
 ]);
 return{recentListings,recentTickets,creditTransactions,promotions,conversation:conversationRows[0]??null,notifications,deliveries,vacationReservations,hbxBookings};
}

function activityContextText(ctx:SupportActivityContext|null){
 if(!ctx)return "Aucune activité récente vérifiée disponible.";const out:string[]=[];
 if(ctx.recentListings.length)out.push(`Annonces récentes: ${ctx.recentListings.map(x=>`${redact(x.title??"Sans titre")} [${x.status}]${x.city?` à ${redact(x.city)}`:""}, mise à jour ${frDate(x.updatedAt)??"récemment"}`).join(" | ")}.`);
 if(ctx.recentTickets.length)out.push(`Demandes support récentes: ${ctx.recentTickets.map(x=>`${x.reference} [${x.category}/${x.status}] ${redact(x.subject).slice(0,120)}`).join(" | ")}.`);
 if(ctx.creditTransactions.length)out.push(`Mouvements de crédit récents: ${ctx.creditTransactions.map(x=>`${x.type} ${(Number(x.amountMinor)/100).toFixed(2)} EUR${x.referenceType?` (${x.referenceType})`:""} le ${frDate(x.createdAt)??"date récente"}`).join(" | ")}.`);
 if(ctx.promotions.length)out.push(`Mises en avant récentes: ${ctx.promotions.map(x=>`${redact(x.title??"Annonce")} [${x.status}]${x.endsAt?`, fin ${frDate(x.endsAt)}`:""}`).join(" | ")}.`);
 if(ctx.conversation)out.push(`Conversation liée: statut=${ctx.conversation.status}, messages=${ctx.conversation.messageCount}, dernier message=${ctx.conversation.lastMessageFrom??"inconnu"}, dernière activité=${frDate(ctx.conversation.lastMessageAt)??"inconnue"}.`);
 if(ctx.notifications.length)out.push(`Notifications récentes: ${ctx.notifications.map(x=>`${redact(x.title).slice(0,100)} [${x.readAt?"lue":"non lue"}]`).join(" | ")}.`);
 if(ctx.deliveries.length)out.push(`Livraisons de notifications/e-mails récentes: ${ctx.deliveries.map(x=>`${x.eventKind}/${x.channel}: file=${x.status}, remise=${x.deliveryStatus??"inconnue"}, fournisseur=${x.provider??"inconnu"}, erreur=${x.hasError?"oui":"non"}`).join(" | ")}.`);
 if(ctx.vacationReservations.length)out.push(`Réservations Vacances récentes: ${ctx.vacationReservations.map(x=>`${x.role} ${redact(x.title??"Hébergement")} [${x.status}] du ${frDate(x.checkIn)??"?"} au ${frDate(x.checkOut)??"?"}${x.grandTotalMinor!=null?`, total ${(Number(x.grandTotalMinor)/100).toFixed(2)} ${x.currency}`:""}`).join(" | ")}.`);
 if(ctx.hbxBookings.length)out.push(`Réservations hôtels partenaires récentes: ${ctx.hbxBookings.map(x=>`${redact(x.hotelName??"Hôtel")} [${x.status}/${x.environment}] du ${frDate(x.checkIn)??"?"} au ${frDate(x.checkOut)??"?"}${x.providerReference?`, réf. ${x.providerReference}`:""}`).join(" | ")}.`);
 return out.length?out.join("\n"):"Aucune activité récente vérifiée disponible.";
}

function systemContextText(ctx:SupportSystemContext|null){
 if(!ctx)return "Aucun contexte système vérifié disponible.";
 const values:string[]=[];
 values.push(`Compte: statut=${ctx.accountStatus??"inconnu"}, type=${ctx.accountKind??"inconnu"}, e-mail vérifié=${ctx.emailVerified===true?"oui":ctx.emailVerified===false?"non":"inconnu"}.`);
 if(ctx.siteCreditBalanceMinor!=null)values.push(`Crédit Petit Annonces disponible=${(Number(ctx.siteCreditBalanceMinor)/100).toFixed(2)} EUR; annonces publiées=${Number(ctx.publishedListingCount??0)}.`);
 if(ctx.lockedUntil&&new Date(ctx.lockedUntil)>new Date())values.push(`Compte temporairement verrouillé jusqu’au ${frDate(ctx.lockedUntil)??"délai indiqué dans le compte"}.`);
 if(ctx.emailVerified===false){
  values.push(`Lien de vérification actif=${ctx.verificationTokenActive===true?"oui":ctx.verificationTokenActive===false?"non":"inconnu"}${ctx.verificationTokenExpiresAt?`, expiration=${frDate(ctx.verificationTokenExpiresAt)}`:""}.`);
  values.push(`Dernier e-mail de vérification: file=${ctx.verificationMailStatus??"aucune trace"}, remise fournisseur=${ctx.verificationMailDeliveryStatus??"inconnue"}, erreur=${ctx.verificationMailError?"oui":"non"}${ctx.verificationMailSentAt?`, envoyé=${frDate(ctx.verificationMailSentAt)}`:""}.`);
 }
 if(ctx.passwordResetMailStatus||ctx.passwordResetTokenActive!==null){
  values.push(`Dernière réinitialisation mot de passe: lien actif=${ctx.passwordResetTokenActive===true?"oui":ctx.passwordResetTokenActive===false?"non":"inconnu"}${ctx.passwordResetTokenExpiresAt?`, expiration=${frDate(ctx.passwordResetTokenExpiresAt)}`:""}; e-mail file=${ctx.passwordResetMailStatus??"aucune trace"}, remise fournisseur=${ctx.passwordResetMailDeliveryStatus??"inconnue"}, erreur=${ctx.passwordResetMailError?"oui":"non"}${ctx.passwordResetMailSentAt?`, envoyé=${frDate(ctx.passwordResetMailSentAt)}`:""}.`);
 }
 if(ctx.listingId){
  values.push(`Annonce liée au ticket: statut=${ctx.listingStatus??"inconnu"}, modération=${ctx.listingModerationStatus??"aucun dossier"}, expiration=${frDate(ctx.listingExpiresAt)??"non renseignée"}.`);
 }
 if(ctx.accountKind==="PROFESSIONNEL"){
  values.push(`Compte Pro: vérification entreprise=${ctx.businessVerificationStatus??"inconnue"}, boutique=${ctx.storeStatus??"absente"}, boutique vérifiée=${ctx.storeVerified===true?"oui":ctx.storeVerified===false?"non":"inconnu"}, abonnement=${ctx.subscriptionStatus??"aucun"}${ctx.subscriptionTrialEndsAt?`, fin essai=${frDate(ctx.subscriptionTrialEndsAt)}`:""}.`);
 }
 return values.join("\n");
}

function verifiedSystemReply(category:string,body:string,ctx:SupportSystemContext|null){
 if(!ctx)return null;
 const text=body.toLocaleLowerCase("fr-FR");

 const asksPasswordReset=/(mot de passe|password).*(oubli|reset|réinitial|reinitial)|(?:oubli|reset|réinitial|reinitial).*(mot de passe|password)/i.test(text);
 if(category==="ACCOUNT"&&asksPasswordReset){
  if(ctx.passwordResetMailStatus==="SENT"){
   if(ctx.passwordResetMailDeliveryStatus==="DELIVERED")return "Nous avons vérifié votre demande de réinitialisation : le dernier e-mail est indiqué comme livré par le fournisseur. Le lien est temporaire ; utilisez le message le plus récent.";
   if(ctx.passwordResetMailDeliveryStatus==="ACCEPTED")return "Nous avons vérifié votre demande de réinitialisation : le dernier e-mail a été accepté par le serveur d’envoi, mais cela ne confirme pas forcément son affichage dans votre boîte de réception. Vérifiez aussi les dossiers Spam/Indésirables et utilisez uniquement le message le plus récent.";
   return "Nous avons vérifié votre demande de réinitialisation : le dernier e-mail est marqué comme envoyé, sans confirmation certaine de remise dans la boîte de réception. Vérifiez les courriers indésirables et utilisez uniquement le lien le plus récent.";
  }
  if(ctx.passwordResetMailStatus==="FAILED"||ctx.passwordResetMailError)return "Nous avons vérifié votre demande de réinitialisation : le dernier envoi a rencontré une erreur. Relancez « Mot de passe oublié » ; si le problème persiste, un agent doit vérifier l’envoi.";
  if(ctx.passwordResetMailStatus==="PENDING"||ctx.passwordResetMailStatus==="PROCESSING")return "Votre demande de réinitialisation est bien enregistrée et l’e-mail est encore dans la file d’envoi. Il n’est pas nécessaire de multiplier les demandes.";
  if(ctx.passwordResetTokenActive===true)return "Une demande de réinitialisation active existe sur votre compte, mais aucun envoi d’e-mail récent n’est confirmé dans notre file de livraison. Un nouvel envoi depuis « Mot de passe oublié » est recommandé.";
 }
 const asksEmail=/e[- ]?mail|mail|confirmation|confirmer|vérif|verif|activation|activer/.test(text);
 const asksLogin=/connexion|connecter|login|mot de passe|accès au compte|acces au compte/.test(text);
 if(category==="ACCOUNT"&&asksLogin&&ctx.lockedUntil&&new Date(ctx.lockedUntil)>new Date())return `Nous avons vérifié votre compte : il est temporairement verrouillé jusqu’au ${frDate(ctx.lockedUntil)??"délai indiqué par le système"}. Attendez la fin du verrouillage avant de réessayer.`;
 if(category==="ACCOUNT"&&asksLogin&&ctx.accountStatus==="PENDING_VERIFICATION"&&!ctx.emailVerified)return "Nous avons vérifié votre compte : la connexion est bloquée tant que l’adresse e-mail n’est pas confirmée. Utilisez le lien de vérification reçu ou demandez un nouvel envoi depuis l’écran de connexion.";
 if(category==="ACCOUNT"&&asksEmail){
  if(ctx.emailVerified===true)return "Votre adresse e-mail est déjà vérifiée et votre compte est actif sur ce point.";
  if(ctx.emailVerified===false){
   if(ctx.verificationMailStatus==="SENT"){
    if(ctx.verificationMailDeliveryStatus==="DELIVERED")return "Votre compte attend encore la validation de l’adresse e-mail. Le dernier e-mail de vérification est indiqué comme livré par le fournisseur, mais le lien n’a pas encore été utilisé.";
    if(ctx.verificationMailDeliveryStatus==="ACCEPTED")return "Votre compte attend encore la validation de l’adresse e-mail. Le dernier e-mail a bien été accepté par le serveur d’envoi ; cela confirme l’envoi, mais pas sa présence dans la boîte de réception. Vérifiez aussi les courriers indésirables et l’onglet Promotions.";
    return "Votre compte attend encore la validation de l’adresse e-mail. Le dernier e-mail de vérification est marqué comme envoyé, mais nous n’avons pas de confirmation de remise dans la boîte de réception.";
   }
   if(ctx.verificationMailStatus==="FAILED"||ctx.verificationMailError)return "Votre compte attend encore la validation de l’adresse e-mail et le dernier envoi présente une erreur. Utilisez « Renvoyer l’e-mail de vérification » ; si le problème continue, un agent doit vérifier l’envoi.";
   if(ctx.verificationMailStatus==="PENDING"||ctx.verificationMailStatus==="PROCESSING")return "Votre compte attend encore la validation de l’adresse e-mail et le message de vérification est encore dans la file d’envoi. Il n’est pas nécessaire de recréer un compte.";
   return "Votre compte attend encore la validation de l’adresse e-mail, mais aucun envoi de vérification récent n’est visible dans le système. Utilisez « Renvoyer l’e-mail de vérification ».";
  }
 }

 const asksSiteCredit=/(crédit|credit|solde).*(boost|booster|promotion|mise en avant|visibilit|payer)|(?:boost|booster|promotion|mise en avant|visibilit|payer).*(crédit|credit|solde)/i.test(text);
 if((category==="LISTING"||category==="PAYMENT"||category==="ACCOUNT")&&asksSiteCredit&&ctx.siteCreditBalanceMinor!=null){
  const balance=Number(ctx.siteCreditBalanceMinor);
  const formatted=new Intl.NumberFormat("fr-FR",{style:"currency",currency:"EUR"}).format(balance/100);
  if(balance>0)return `Nous avons vérifié votre compte : votre crédit Petit Annonces disponible est bien de ${formatted}. Pour l’utiliser sur une annonce publiée, ouvrez Mon compte > Mes annonces > Booster. Si le prix de la mise en avant est inférieur ou égal à votre solde, le crédit est utilisé automatiquement avant tout paiement externe.`;
  return "Nous avons vérifié votre compte : votre crédit Petit Annonces disponible est actuellement de 0,00 €. Vous pouvez consulter les mouvements et les options de rechargement dans Mon compte > Portefeuille.";
 }

 if(category==="LISTING"&&ctx.listingId){
  if(ctx.listingStatus==="PUBLISHED")return "Nous avons vérifié l’annonce liée à cette demande : elle est actuellement publiée.";
  if(ctx.listingStatus==="PENDING")return `Nous avons vérifié l’annonce liée à cette demande : elle est en attente de vérification${ctx.listingModerationStatus?` (dossier de modération : ${ctx.listingModerationStatus})`:""}.`;
  if(ctx.listingStatus==="DRAFT")return "Nous avons vérifié l’annonce liée à cette demande : elle est encore enregistrée comme brouillon et n’est pas publiée.";
  if(ctx.listingStatus==="EXPIRED")return "Nous avons vérifié l’annonce liée à cette demande : elle est expirée. Vous pouvez la renouveler depuis Mes annonces si l’option est disponible.";
  if(ctx.listingStatus==="SOLD")return "Nous avons vérifié l’annonce liée à cette demande : elle est marquée comme vendue.";
  if(ctx.listingStatus==="SUSPENDED")return "Nous avons vérifié l’annonce liée à cette demande : elle est suspendue. Une vérification humaine est nécessaire avant de préciser la décision ou de modifier son statut.";
 }

 if(category==="PROFESSIONAL"&&ctx.accountKind==="PROFESSIONNEL"){
  if(ctx.businessVerificationStatus==="REJECTED")return "Nous avons vérifié votre compte Pro : la vérification de l’entreprise est indiquée comme refusée. Une vérification humaine est nécessaire avant de modifier ce statut ou de demander de nouvelles pièces.";
  if(ctx.businessVerificationStatus==="SUSPENDED"||ctx.storeStatus==="SUSPENDED")return "Nous avons vérifié votre espace Pro : le profil entreprise ou la boutique est actuellement suspendu. Une vérification humaine est nécessaire pour préciser la cause et les étapes de réactivation.";
  if(ctx.businessVerificationStatus==="PENDING")return "Votre compte professionnel existe bien, mais la vérification de l’entreprise est encore en attente. La boutique peut rester en brouillon tant que cette étape n’est pas terminée.";
  if(ctx.subscriptionStatus==="PAST_DUE")return "Votre compte Pro est identifié, mais l’abonnement est en retard de paiement. Certaines fonctions peuvent rester limitées tant que la situation n’est pas régularisée.";
  if(ctx.subscriptionStatus==="EXPIRED"||ctx.subscriptionStatus==="CANCELED")return `Votre compte Pro existe, mais l’abonnement est actuellement ${ctx.subscriptionStatus==="EXPIRED"?"expiré":"annulé"}. Vérifiez la rubrique Abonnement dans l’Espace Pro pour les options disponibles.`;
  if(ctx.businessVerificationStatus==="VERIFIED"&&ctx.storeStatus==="ACTIVE")return "Votre entreprise est vérifiée et votre boutique professionnelle est active.";
  if(ctx.businessVerificationStatus==="VERIFIED"&&ctx.storeStatus==="DRAFT")return "Votre entreprise est vérifiée, mais votre boutique est encore en brouillon. Vérifiez les informations de la boutique et les éventuelles étapes restantes dans l’Espace Pro.";
 }
 return null;
}

function verifiedOrderReply(order:SupportOrderContext){
 const paymentCaptured=["AUTHORIZED","CAPTURED","PARTIALLY_REFUNDED","REFUNDED"].includes(String(order.paymentStatus));
 const unpaid=!order.paidAt&&!paymentCaptured;
 const role=order.customerRole;

 if(order.orderStatus==="CANCELED"&&unpaid){
  if(role==="SELLER"){
   const listing=order.listingStatus==="PUBLISHED"
    ?" Votre annonce reste publiée et disponible à la vente."
    :"";
   return `Nous avons vérifié la transaction ${order.orderNumber}. L’acheteur n’a pas finalisé le paiement : aucun montant n’a été encaissé. Il s’agit d’une tentative d’achat expirée, pas d’une vente. Elle ne doit pas être comptabilisée ni affichée comme vente dans votre espace vendeur.${listing}`;
  }
  return `Nous avons vérifié la transaction ${order.orderNumber}. Le paiement n’a pas été finalisé et aucun montant n’a été encaissé. La tentative d’achat a donc été annulée automatiquement. Aucun remboursement n’est nécessaire.`;
 }

 if(order.orderStatus==="PENDING_PAYMENT"&&unpaid){
  return role==="BUYER"
   ?`La transaction ${order.orderNumber} est encore en attente de paiement. Tant que le paiement n’est pas confirmé, aucune vente n’est enregistrée côté vendeur.`
   :`La transaction ${order.orderNumber} n’est pas encore une vente : le paiement de l’acheteur n’est pas confirmé et elle ne doit pas apparaître dans vos ventes.`;
 }

 if(order.refundStatus==="PENDING"||order.refundStatus==="PROCESSING"){
  return role==="BUYER"
   ?`Nous avons vérifié la transaction ${order.orderNumber} : un remboursement est actuellement en cours de traitement. Le système ne l’indique pas encore comme terminé.`
   :`Nous avons vérifié la transaction ${order.orderNumber} : un remboursement est actuellement en cours de traitement. Le versement vendeur ne doit pas être considéré comme définitif tant que ce traitement n’est pas terminé.`;
 }

 if(order.shipmentStatus==="LOST"||order.shipmentStatus==="EXCEPTION"){
  return `Nous avons vérifié la transaction ${order.orderNumber} : l’expédition présente un incident (${order.shipmentStatus==="LOST"?"colis indiqué comme perdu":"anomalie de transport"}). Une vérification humaine est nécessaire avant toute conclusion sur le remboursement ou le versement.`;
 }

 if(order.shipmentStatus==="RETURNED"){
  return `Nous avons vérifié la transaction ${order.orderNumber} : le colis est indiqué comme retourné. Une vérification du retour est nécessaire avant de confirmer un remboursement ou un versement vendeur.`;
 }

 if(["PAID","PROCESSING"].includes(order.orderStatus)&&paymentCaptured){
  return role==="SELLER"
   ?`Le paiement de la transaction ${order.orderNumber} est confirmé. Cette commande constitue bien une vente ; vous pouvez maintenant suivre la commande et préparer l’expédition.`
   :`Le paiement de la transaction ${order.orderNumber} est confirmé. La commande est enregistrée et le vendeur peut préparer l’expédition.`;
 }

 if(order.orderStatus==="SHIPPED"){
  return role==="SELLER"
   ?`La transaction ${order.orderNumber} est enregistrée comme expédiée. Vous pouvez suivre son acheminement depuis la commande.`
   :`Votre commande ${order.orderNumber} est enregistrée comme expédiée. Le suivi est disponible depuis la commande.`;
 }

 if(order.orderStatus==="DELIVERED"){
  return role==="SELLER"
   ?`La commande ${order.orderNumber} est indiquée comme livrée. Le versement vendeur reste soumis à la période de protection et aux éventuels retours ou litiges.`
   :`La commande ${order.orderNumber} est indiquée comme livrée. Vérifiez le produit depuis votre commande et utilisez la protection acheteur si vous constatez un problème.`;
 }

 if(order.orderStatus==="COMPLETED"){
  if(role==="SELLER"){
   if(order.payoutStatus==="PAID")return `La transaction ${order.orderNumber} est terminée et le versement vendeur est indiqué comme payé dans le système.`;
   if(order.payoutStatus==="PROCESSING")return `La transaction ${order.orderNumber} est terminée et le versement vendeur est actuellement en cours de traitement.`;
   if(order.payoutStatus==="PENDING")return `La transaction ${order.orderNumber} est terminée. Le versement vendeur est en attente${order.payoutAvailableAt?` et devient disponible à partir du ${frDate(order.payoutAvailableAt)}`:""}, sous réserve qu’aucun litige, retour ou remboursement ne soit en cours.`;
   if(order.payoutStatus==="BLOCKED")return `La transaction ${order.orderNumber} est terminée, mais le versement vendeur est actuellement bloqué. Une vérification humaine est nécessaire pour confirmer la cause exacte avant toute action.`;
   if(order.payoutStatus==="FAILED")return `La transaction ${order.orderNumber} est terminée, mais la tentative de versement vendeur est indiquée comme échouée. Une vérification humaine est nécessaire avant une nouvelle tentative.`;
   return `La transaction ${order.orderNumber} est terminée. Aucun statut de versement final n’est encore confirmé dans le système.`;
  }
  return `La transaction ${order.orderNumber} est terminée et la confirmation de commande a été enregistrée.`;
 }

 if(order.orderStatus==="REFUNDED"||order.paymentStatus==="REFUNDED"){
  return role==="BUYER"
   ?`La transaction ${order.orderNumber} est indiquée comme remboursée. Le délai d’apparition du remboursement dépend ensuite de votre établissement bancaire.`
   :`La transaction ${order.orderNumber} est indiquée comme remboursée et ne doit pas être comptabilisée comme une vente nette.`;
 }

 if(order.orderStatus==="DISPUTED"){
  return `La transaction ${order.orderNumber} fait l’objet d’un litige. Une vérification humaine est nécessaire avant toute conclusion sur le paiement, le remboursement ou le versement.`;
 }

 return null;
}

export async function createAiSupportReply(args:{ticketId:string;category:string;subject:string;body:string}){
 await ensureSupportFaqSchema();
 const faq=await listSupportFaqs(args.category);
 const context=faq.slice(0,8).map(x=>`Q: ${x.question}\nR: ${x.answer}`).join("\n\n");
 const previousMessages=await prisma.$queryRawUnsafe<Array<{authorType:string;body:string}>>(
   `SELECT "authorType"::text AS "authorType","body"
    FROM "SupportTicketMessage"
    WHERE "ticketId"=$1 AND "internalNote"=FALSE
    ORDER BY "createdAt" DESC
    LIMIT 10`,
   args.ticketId,
 ).catch(()=>[]);
 const conversationContext=previousMessages.reverse().map(m=>{
   const who=m.authorType==="CUSTOMER"?"Client":m.authorType==="AGENT"?"Agent":"Assistant";
   return `${who}: ${redact(m.body).slice(0,1000)}`;
 }).join("\n");

 const [orderContext,systemContext,activityContext]=await Promise.all([
   getSupportOrderContext(args.ticketId,args.subject,args.body).catch(()=>null),
   getSupportSystemContext(args.ticketId).catch(()=>null),
   getSupportActivityContext(args.ticketId).catch(()=>null),
 ]);
 const categoryRequiresHuman=HUMAN_REVIEW.has(args.category);
 const paymentCaptured=orderContext?["AUTHORIZED","CAPTURED","PARTIALLY_REFUNDED","REFUNDED"].includes(String(orderContext.paymentStatus)):false;
 const ambiguousFinancial=Boolean(
   orderContext
   && orderContext.orderStatus==="CANCELED"
   && (Boolean(orderContext.paidAt)||paymentCaptured)
   && !["REFUNDED","SUCCEEDED"].includes(String(orderContext.refundStatus??orderContext.paymentStatus))
 );
 const listingRequiresHuman=Boolean(systemContext?.listingStatus==="SUSPENDED");
 const operationalRequiresHuman=Boolean(
   orderContext
   && (
     orderContext.refundStatus==="FAILED"
     || ["LOST","EXCEPTION","RETURNED"].includes(String(orderContext.shipmentStatus))
     || ["FAILED","BLOCKED"].includes(String(orderContext.payoutStatus))
   )
 );
 const proRequiresHuman=Boolean(systemContext?.businessVerificationStatus==="REJECTED"||systemContext?.businessVerificationStatus==="SUSPENDED"||systemContext?.storeStatus==="SUSPENDED");
 const requiresHuman=categoryRequiresHuman||ambiguousFinancial||orderContext?.orderStatus==="DISPUTED"||listingRequiresHuman||operationalRequiresHuman||proRequiresHuman;
 const verifiedOrder=!requiresHuman&&orderContext?verifiedOrderReply(orderContext):null;
 const verifiedSystem=!requiresHuman?verifiedSystemReply(args.category,`${args.subject} ${args.body}`,systemContext):null;
 const verifiedReply=verifiedOrder||verifiedSystem;

 const orderSystemText=orderContext
  ?`Commande vérifiée: ${orderContext.orderNumber}; rôle client=${orderContext.customerRole}; commande=${orderContext.orderStatus}; paiement=${orderContext.paymentStatus??"inconnu"}; remboursement=${orderContext.refundStatus??"aucun"}; expédition=${orderContext.shipmentStatus??"aucune"}; transporteur=${orderContext.shipmentCarrier??"inconnu"}; livraison estimée=${frDate(orderContext.estimatedDeliveryAt)??"inconnue"}; livré=${frDate(orderContext.deliveredAt)??"non"}; versement vendeur=${orderContext.payoutStatus??"aucun"}; versement disponible=${frDate(orderContext.payoutAvailableAt)??"inconnu"}; versement payé=${frDate(orderContext.payoutPaidAt)??"non"}; annonce=${orderContext.listingStatus??"inconnue"}.`
  :"Aucune commande liée vérifiée.";

 const input=`Tu es l’assistant du service client de Petit Annonces, plateforme française de petites annonces. Tu dois d’abord raisonner à partir des données système vérifiées ci-dessous, puis répondre au client.

Règles impératives :
- Réponds directement à la question dès la première phrase.
- Utilise l’historique du ticket et ne redemande jamais une information déjà fournie.
- Les données système vérifiées ont priorité sur une supposition ou sur une FAQ générique.
- Ne parle que des données appartenant au client et fournies dans le contexte vérifié.
- Si aucune donnée vérifiée n’existe pour un point précis, dis-le clairement au lieu d’inventer.
- Une tentative de paiement non finalisée n’est jamais une vente côté vendeur.
- N’invente jamais paiement, remboursement, expédition, versement, modération, vérification de compte ou statut Pro.
- Pour un e-mail marqué ACCEPTED, dis qu’il a été accepté par le serveur d’envoi, pas qu’il a forcément été livré dans la boîte de réception.
- Pour un e-mail marqué DELIVERED, tu peux dire que le fournisseur l’indique comme livré.
- Pour une annonce suspendue, un litige, une incohérence financière, un remboursement ambigu, un versement bloqué ou une question de sécurité/conformité, demande une vérification humaine.
- Ne demande jamais mot de passe, code OTP, code de secours, numéro complet de carte ou coordonnées bancaires complètes.
- Structure la réponse de façon utile : réponse directe, puis ce qui a été vérifié si cela aide, puis 1 à 3 actions concrètes maximum.
- Lorsque le système contient une cause probable et vérifiée, explique-la simplement au lieu de donner une FAQ générique.
- Si une action a déjà réussi dans le système, ne demande pas au client de la recommencer.
- Si une action est encore en attente, indique son état et évite de faire multiplier les tentatives.
- Si un ancien ticket traite déjà du même problème, utilise ce contexte sans demander au client d’ouvrir une nouvelle demande.
- Si une notification ou un e-mail est en erreur, précise qu’un nouvel essai peut être nécessaire ; s’il est DELIVERED, ne demande pas un renvoi par défaut.
- Pour les annonces, tiens compte du statut réel, des promotions récentes et du crédit disponible avant de proposer une action.
- Pour les réservations Vacances ou hôtels partenaires, distingue toujours demande, confirmation, annulation et simple vérification de disponibilité.
- Ne promets aucun remboursement, versement, publication, réactivation ou décision.
- N’utilise un montant, une date, un statut, une référence ou un nom d’hôtel que s’il apparaît dans les données vérifiées.
- N’expose jamais de donnée technique interne, token, clé API, identifiant de session ou détail fournisseur inutile au client.
- Réponds en français naturel et professionnel. Vise environ 120 à 280 mots quand le dossier nécessite une explication ; reste plus court si la réponse est évidente.
${requiresHuman?"- Ce dossier nécessite une revue humaine : explique ce qui est déjà vérifié, mais ne présente aucune conclusion définitive sur la décision ou les fonds. Précise qu’un agent poursuivra dans ce même ticket.":""}

Catégorie: ${args.category}
Sujet: ${redact(args.subject)}
Dernier message client: ${redact(args.body)}

Historique récent:
${conversationContext||"Aucun historique supplémentaire."}

Données système vérifiées du compte:
${systemContextText(systemContext)}

Données transactionnelles vérifiées:
${orderSystemText}

Activité récente vérifiée du compte:
${activityContextText(activityContext)}

Conclusion système déjà déterminée, si disponible:
${verifiedReply??"Aucune conclusion déterministe supplémentaire."}

FAQ disponibles:
${context||"Aucune FAQ pertinente."}`;

 const generated=await callAi(input,1200);
 const normalizeMatch=(value:string)=>value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("fr-FR").replace(/[^a-z0-9]+/g," ").trim();
 const normalized=normalizeMatch(`${args.subject} ${args.body}`);const userTokens=new Set(normalized.split(/\s+/).filter(w=>w.length>=4));
 const relevant=faq.map(x=>{const hay=normalizeMatch(`${x.question} ${x.answer}`);const tokens=new Set(hay.split(/\s+/).filter(w=>w.length>=4));let score=0;for(const token of userTokens){if(tokens.has(token))score+=2;else if(token.length>=6&&hay.includes(token))score+=1}const nq=normalizeMatch(x.question);if(nq&&normalized.includes(nq))score+=8;return{x,score}}).sort((a,b)=>b.score-a.score)[0];
 const faqFallback=relevant&&relevant.score>0
  ?`${relevant.x.answer}\n\nSi le problème persiste, répondez directement dans ce ticket : le support conservera l’historique et vérifiera les données déjà disponibles sans vous demander de tout recommencer.`
  :null;
 const humanFallback=requiresHuman
  ?"Merci pour votre message. Les données système indiquent que ce dossier nécessite une vérification humaine avant toute conclusion. Un agent va poursuivre l’examen directement dans cette demande ; vous n’avez pas besoin de renvoyer les mêmes informations."
  :"Merci pour votre message. Les données système disponibles ne permettent pas de confirmer la cause sans risque d’erreur. Votre demande est transmise à un agent ; vous n’avez pas besoin de renvoyer les mêmes informations.";
 const finalRequiresHuman=requiresHuman||(!verifiedReply&&!generated&&!faqFallback);
 const text=(generated||verifiedReply||faqFallback||humanFallback).slice(0,6000);
 const updated=await prisma.$queryRawUnsafe<Array<{id:string}>>(
   `UPDATE "SupportTicket"
    SET "firstResponseAt"=COALESCE("firstResponseAt",CURRENT_TIMESTAMP),
        "lastMessageAt"=CURRENT_TIMESTAMP,
        "status"=$1::"SupportTicketStatus",
        "updatedAt"=CURRENT_TIMESTAMP
    WHERE "id"=$2 AND "status"<>'CLOSED'
    RETURNING "id"`,
   finalRequiresHuman?"PENDING_INTERNAL":"PENDING_CUSTOMER",
   args.ticketId,
 );
 const mode=generated?(verifiedReply?"ai-verified-system":"ai-system"):verifiedReply?"verified-system":faqFallback?"faq":"human-handoff";
 if(!updated.length)return{answered:false,mode,requiresHuman:finalRequiresHuman};
 await prisma.$executeRawUnsafe(
   `INSERT INTO "SupportTicketMessage" ("id","ticketId","authorType","body") VALUES ($1,$2,'SYSTEM',$3)`,
   randomUUID(),args.ticketId,text,
 );
 return{answered:true,mode,requiresHuman:finalRequiresHuman};
}

export async function publishFaqFromResolvedTicket(ticketId:string){await ensureSupportFaqSchema();const tickets=await prisma.$queryRawUnsafe<Array<{id:string;category:string;subject:string}>>(`SELECT "id","category"::text,"subject" FROM "SupportTicket" WHERE "id"=$1 LIMIT 1`,ticketId);const ticket=tickets[0];if(!ticket)return null;const messages=await prisma.$queryRawUnsafe<Array<{authorType:string;body:string}>>(`SELECT "authorType"::text,"body" FROM "SupportTicketMessage" WHERE "ticketId"=$1 AND "internalNote"=FALSE ORDER BY "createdAt" ASC`,ticketId);const customer=messages.filter(m=>m.authorType==="CUSTOMER").map(m=>redact(m.body)).join("\n").slice(0,5000);const solution=messages.filter(m=>m.authorType==="AGENT"||m.authorType==="SYSTEM").map(m=>redact(m.body)).join("\n").slice(-7000);if(!customer||!solution)return null;const prompt=`Transforme ce ticket résolu en une FAQ publique de Petit Annonces. Réponds STRICTEMENT en JSON valide avec les clés question et answer. La question doit être générale et courte. La réponse doit être utile en 2 à 6 phrases. Supprime ou généralise tout nom, e-mail, téléphone, adresse précise, identifiant, numéro d’annonce/commande/ticket et donnée personnelle. N’invente rien. Catégorie: ${ticket.category}. Sujet: ${redact(ticket.subject)}. Question utilisateur: ${customer}. Solution apportée: ${solution}`;const generated=await callAi(prompt,500);let question=redact(ticket.subject).replace(/\[[^\]]+\]/g,"").trim();let answer=redact(solution).slice(0,1800);if(generated){try{const j=JSON.parse(generated.replace(/^```json\s*/i,"").replace(/```$/,""));if(typeof j.question==="string"&&typeof j.answer==="string"){question=redact(j.question).slice(0,220);answer=redact(j.answer).slice(0,2200)}}catch{}}if(question.length<8||answer.length<20)return null;const old=await prisma.$queryRawUnsafe<Array<{id:string}>>(`SELECT "id" FROM "SupportFaq" WHERE "sourceTicketId"=$1 LIMIT 1`,ticketId);if(old[0]){await prisma.$executeRawUnsafe(`UPDATE "SupportFaq" SET "category"=$1::"SupportTicketCategory","question"=$2,"answer"=$3,"published"=TRUE,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$4`,ticket.category,question,answer,old[0].id);return old[0].id}const id=randomUUID();await prisma.$executeRawUnsafe(`INSERT INTO "SupportFaq" ("id","slug","category","question","answer","sourceTicketId") VALUES ($1,$2,$3::"SupportTicketCategory",$4,$5,$6)`,id,slugify(question),ticket.category,question,answer,ticketId);return id}
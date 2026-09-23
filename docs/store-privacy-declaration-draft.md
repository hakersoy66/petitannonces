# Store privacy / Data Safety — draft technique

> **Ne pas soumettre tel quel.** Ce document est un inventaire technique de départ. Les réponses finales App Store Privacy et Google Play Data Safety doivent couvrir l’application publiée **et** les traitements backend/tiers réellement actifs.

## Ce qui est déjà vérifié côté app native
- Pas de SDK publicitaire visible dans `apps/mobile/package.json`.
- Pas de SDK Meta/Facebook Ads, Google Mobile Ads ou équivalent visible.
- `expo-notifications` est utilisé pour les notifications push.
- `expo-image-picker` est utilisé pour caméra / photothèque.
- `expo-secure-store` stocke localement le token de session de manière sécurisée.
- `expo-web-browser` ouvre les flux web nécessaires (paiements autorisés, factures, etc.).
- Android bloque explicitement `RECORD_AUDIO`.
- L’application ne demande pas actuellement de permission GPS précise dans sa configuration Expo.

## Données probablement collectées par la fonctionnalité Petit Annonces
À confirmer contre le backend, les logs et chaque fournisseur tiers avant soumission.

| Catégorie | Exemples dans Petit Annonces | Finalité probable |
|---|---|---|
| Informations de contact | e-mail, prénom/nom, téléphone, adresse de livraison, ville/code postal | Compte, transaction, livraison, support |
| Identifiants | identifiant utilisateur, identifiant de session, token push, identifiant de commande | Authentification, sécurité, notifications, fonctionnement |
| Contenu utilisateur | titres/descriptions d’annonces, photos, messages, offres, avis, tickets support | Fonctionnement de la marketplace |
| Historique d’achats | commandes, paiements, remboursements, réservations, statut de transaction | Transaction, support, fraude/comptabilité |
| Activité dans l’app | favoris, recherches enregistrées, vues/performances d’annonces, interactions | Fonctionnement, personnalisation, analytics produit |
| Localisation approximative / lieu fourni | ville, code postal, adresse d’annonce ou livraison | Recherche locale, annonce, livraison |
| Fichiers/documents | CSV importé par un compte Pro, images de boutique/annonce | Import et publication |
| Données de sécurité | sessions, événements de sécurité, signaux de risque/modération | Prévention fraude, sécurité |

## Faits backend vérifiés le 11 septembre 2026
- **Push natif** : `PushSubscription` conserve, lié au compte, le token natif, la plateforme iOS/Android, un libellé d’appareil et le user-agent.
- **Sendcloud / livraison** : lors de la création d’une étiquette, Petit Annonces transmet les données nécessaires d’expéditeur et de destinataire : nom, adresse, code postal, ville, pays, téléphone et e-mail lorsqu’ils sont disponibles, ainsi que la référence de commande et les caractéristiques du colis.
- **IP / sécurité** : l’IP est utilisée pour rate-limit, modération/anti-abus et preuve d’acceptation légale. Plusieurs tables conservent une empreinte SHA-256 (souvent salée) plutôt que l’IP en clair.
- **Logs HTTP** : nginx conserve un access log contenant l’adresse réseau ; la rotation serveur actuelle est quotidienne avec 14 rotations.
- **Analytics web/PWA** : le backend web/PWA conserve visitorId, sessionId, chemin, événements PWA/web-vitals et un hash du user-agent ; ce module utilise la session cookie web et n’est pas appelé par l’app native actuelle.
- **Sessions** : le backend conserve un hash du token de session et le user-agent associé ; le token opaque brut reste côté client.

## Points qui nécessitent une réponse exacte avant formulaire Store

### 1. Adresse IP et logs serveur
Vérifié : l’adresse IP intervient dans les contrôles de sécurité/rate-limit et certains enregistrements légaux/modération ; les enregistrements applicatifs utilisent principalement des hashes, tandis que le journal d’accès nginx conserve l’adresse réseau avec une rotation quotidienne sur 14 rotations. Déterminer dans les formulaires Store la catégorie exacte applicable à cette collecte technique.

### 2. Paiements
L’app ne doit pas être décrite comme collectant les numéros de carte si ceux-ci sont saisis directement chez Stripe / le prestataire et ne transitent jamais par Petit Annonces. En revanche, l’historique de transaction, les montants, identifiants de paiement et statuts sont stockés côté plateforme et doivent être déclarés dans la catégorie appropriée.

### 3. Sendcloud / transporteurs
Vérifié : la création d’étiquette peut transmettre nom, adresse lignes 1/2, code postal, ville, pays, téléphone et e-mail de l’expéditeur/destinataire, ainsi que la référence de commande, poids/dimensions du colis et éventuel point relais. Qualifier ce transfert comme nécessaire à l’exécution de la livraison dans les formulaires Store.

### 4. Expo Push / APNs / FCM
Vérifié côté PA : token push natif, plateforme, libellé d’appareil et user-agent sont stockés en base et liés au compte pour délivrer les notifications. La déclaration finale doit encore être rapprochée de la configuration EAS/APNs/FCM réellement utilisée dans l’artefact signé.

### 5. Stripe / fournisseur marketplace
Vérifier les données envoyées à chaque prestataire de paiement actif (e-mail, références de commande, montant, métadonnées) et leur qualification en tant que processor/service provider selon les définitions Apple/Google.

### 6. Analytics / diagnostics
Aucun SDK analytics/crash tiers n’est visible dans le package native actuel, mais les métriques backend et logs doivent être audités. Si Sentry, Firebase Analytics, Crashlytics ou équivalent est ajouté avant release, refaire entièrement cette section.

## App Store Privacy — catégories à examiner
Probables catégories à cocher, sous réserve de l’audit final :
- Contact Info: Name, Email Address, Phone Number, Physical Address.
- User Content: Photos, Other User Content (annonces/messages/avis).
- Purchases: Purchase History.
- Identifiers: User ID; éventuellement Device ID selon qualification du token/appareil.
- Usage Data: Product Interaction si les vues/interactions liées à l’utilisateur sont conservées.
- Location: Coarse Location si ville/code postal/IP sont qualifiés comme données de localisation collectées.

À **ne pas** cocher automatiquement sans preuve : precise GPS location, contacts/address book, health, fitness, browsing history, advertising data, sensitive info.

Pour chaque type retenu, confirmer :
1. collected or not;
2. linked to identity or not;
3. used for tracking or not;
4. purposes (App Functionality, Analytics, Product Personalization, Fraud Prevention/Security, etc.).

## Google Play Data Safety — catégories à examiner
Probables types à déclarer, sous réserve de l’audit final :
- Personal info: name, email, address, phone.
- App activity: app interactions / search-related activity si conservée.
- Photos and videos: photos publiées.
- Messages: communications in-app.
- Financial info: purchase history; ne pas déclarer les données de carte comme collectées par PA si elles ne transitent pas par PA.
- Device or other IDs: push/device identifiers selon qualification.
- Location: approximate location si la donnée répond à la définition Google.
- Files and docs: imports Pro si cela entre dans le périmètre du formulaire.

Pour chaque type, confirmer : collected, shared, ephemeral, required/optional, et purposes.

## Sécurité / suppression
- Trafic API : HTTPS en production.
- Suppression de compte : demande disponible dans l’app (`Confidentialité & compte`).
- Export de données : demande disponible dans l’app.
- URL de confidentialité : https://petitannonces.fr/confidentialite
- Assistance : https://petitannonces.fr/assistance

## Gate avant soumission
Aucune réponse App Privacy / Data Safety ne doit être publiée avant :
1. connexion du projet EAS et validation de la build Preview finale ;
2. inventaire des SDK réellement embarqués dans l’artefact signé ;
3. audit des champs envoyés à Stripe, Sendcloud, push et tout autre tiers actif ;
4. vérification de la durée de conservation des IP/logs ;
5. vérification que la politique de confidentialité publique décrit les mêmes traitements.

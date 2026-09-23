# Petit Annonces — fiche Store FR (draft release)

> Mis à jour le 12 septembre 2026. Le code, les exports production et les ressources Store sont prêts. Les identifiants de production App Store / Play Store et le projet EAS doivent encore être reliés aux consoles avant soumission.

## App Store — Français

**Nom (14/30)**  
Petit Annonces

**Sous-titre (28/30)**  
Achetez et vendez simplement

**Texte promotionnel (152 caractères, limite 170)**  
Achetez, vendez et échangez en toute simplicité. Messagerie, favoris, offres, suivi de commande et outils Pro dans une expérience pensée pour la France.

**Mots-clés (85 bytes, limite 100)**  
`petites annonces,occasion,vente,achat,immobilier,voiture,emploi,services,vacances,pro`

**Description**

Petit Annonces vous permet d’acheter, vendre, louer et proposer des services partout en France depuis une application simple et moderne.

Trouvez rapidement ce que vous cherchez parmi de nombreuses catégories : véhicules, immobilier, électronique, mode, maison et jardin, emploi, services, animaux, enfants et bébé, vacances et bien plus encore.

Avec Petit Annonces, vous pouvez :
- publier et gérer vos annonces ;
- ajouter des photos depuis votre galerie ou votre appareil photo ;
- enregistrer vos favoris et vos recherches ;
- recevoir des alertes lorsqu’une nouvelle annonce correspond à vos critères ;
- contacter les vendeurs grâce à la messagerie intégrée ;
- envoyer, accepter, refuser ou négocier une offre ;
- suivre vos achats et vos ventes ;
- consulter le suivi de livraison lorsque celui-ci est disponible ;
- gérer les demandes de réservation pour les annonces Vacances ;
- consulter le profil, les évaluations et les autres annonces d’un vendeur.

Les professionnels disposent également d’un espace dédié pour gérer leur entreprise, leurs boutiques, leurs annonces, leurs statistiques et leurs imports.

La sécurité et la transparence font partie de l’expérience Petit Annonces : gestion des sessions, double authentification, centre de notifications, réputation, outils de signalement et assistance sont accessibles depuis votre compte.

Certaines fonctions dépendent du type d’annonce, du vendeur, de la zone géographique ou de la disponibilité du service concerné.

**URL de confidentialité**  
https://petitannonces.fr/confidentialite

**URL d’assistance**  
https://petitannonces.fr/assistance

**URL de suppression de compte (Google Play)**  
https://petitannonces.fr/supprimer-mon-compte

**URL publique de suppression du compte / Google Play**  
https://petitannonces.fr/supprimer-mon-compte

**URL marketing proposée**  
https://petitannonces.fr/

## Google Play — Français

**Nom de l’application (14/30)**  
Petit Annonces

**Description courte (57/80)**  
Achetez, vendez et échangez facilement partout en France.

**Description complète**

Petit Annonces simplifie les petites annonces en France. Achetez, vendez, louez ou proposez des services depuis une application moderne conçue pour les particuliers comme pour les professionnels.

DÉCOUVREZ DES ANNONCES
Parcourez les véhicules, l’immobilier, l’électronique, la mode, la maison et le jardin, l’emploi, les services, les animaux, l’univers enfants et bébé, les vacances et de nombreuses autres catégories.

PUBLIEZ FACILEMENT
Ajoutez vos photos, complétez les informations adaptées à la catégorie et gérez vos annonces directement depuis votre compte.

ÉCHANGEZ EN TOUTE SIMPLICITÉ
Utilisez la messagerie intégrée pour contacter un vendeur. Selon l’annonce, vous pouvez aussi envoyer une offre, recevoir une contre-offre et retrouver l’historique de vos échanges.

SUIVEZ VOTRE ACTIVITÉ
Retrouvez vos favoris, vos recherches enregistrées, vos alertes, vos commandes, vos ventes, vos réservations et vos notifications dans des espaces dédiés.

PROFILS ET RÉPUTATION
Consultez les informations publiques du vendeur, ses évaluations, ses badges et ses autres annonces.

OUTILS POUR LES PROFESSIONNELS
Les comptes professionnels peuvent gérer leur entreprise, leurs boutiques, leurs annonces, leurs statistiques, leurs imports et leurs ventes depuis l’application.

VACANCES
Les annonces Vacances peuvent proposer une disponibilité, des demandes de réservation et, lorsque cela s’applique, un acompte lié au séjour.

Petit Annonces intègre également des outils de sécurité du compte, de gestion des sessions, de double authentification, de confidentialité, de signalement et d’assistance.

Certaines fonctionnalités peuvent varier selon la catégorie, le vendeur, la zone géographique et les services disponibles.

## Google Play — correctif de conformité historique

Le rejet du 10 avril 2026 concernait une URL de politique de confidentialité invalide. La fiche Play doit utiliser exactement `https://petitannonces.fr/confidentialite`. La page est publique, retourne HTTP 200 et affiche explicitement la politique de confidentialité et les droits RGPD. L’URL externe de suppression de compte est `https://petitannonces.fr/supprimer-mon-compte`.

## App Review / Play Review notes

### Message proposé pour l’équipe de revue
Petit Annonces est une marketplace de petites annonces destinée à la France. Les utilisateurs peuvent publier des annonces, contacter des vendeurs, négocier des offres, gérer leurs commandes et, selon l’annonce, payer des biens physiques ou des services consommés hors de l’application.

La version Store ne propose pas de paiement Stripe externe pour les achats numériques consommés dans l’application : achat de crédit PA, prolongation payante d’annonce, boosts/promotions et souscription Pro externe sont désactivés par configuration dans la build Store.

Les paiements externes encore disponibles dans l’application concernent les transactions de marketplace portant sur des biens physiques et les acomptes de séjours Vacances, c’est-à-dire des biens ou services consommés en dehors de l’application.

Pour la revue, fournir dans App Store Connect / Play Console un compte de test dédié permettant d’accéder aux fonctions authentifiées. **Ne jamais stocker ses identifiants dans ce fichier ou dans le dépôt Git.**

### Points à signaler pendant la revue
- La permission Push n’est demandée qu’après une action explicite de l’utilisateur.
- La caméra / photothèque sont utilisées pour ajouter des images à une annonce ou à une boutique.
- Le microphone n’est pas demandé par l’application Android.
- La suppression de compte et la demande d’export des données sont disponibles dans `Confidentialité & compte`.
- La ressource publique de suppression demandée par Google Play est `https://petitannonces.fr/supprimer-mon-compte`.
- Les paiements de biens physiques / séjours ouvrent un navigateur sécurisé puis reviennent dans l’application via un deep-link dédié.

## Texte « Nouveautés » proposé
Une nouvelle expérience Petit Annonces : navigation modernisée, messagerie et offres améliorées, suivi des commandes, recherches enregistrées, notifications, outils Vacances et nouvel espace professionnel. Cette version apporte également de nombreuses améliorations de sécurité, de stabilité et de performance.

## Assets encore nécessaires avant soumission
- Captures iPhone réelles issues de la build Preview validée.
- Captures Android réelles issues de la build Preview validée.
- Le support iPad est désactivé pour cette première release iOS ; aucune série iPad n’est donc attendue pour cette version.
- Feature graphic Google Play.
- Vérification finale de l’icône / adaptive icon sur appareils clairs et sombres.
- Compte de revue dédié créé dans l’environnement production, sans données personnelles réelles.

## Références officielles utilisées
- Apple App Store Connect — App information / Platform version information.
- Apple App Review Guidelines §3.1.3(e) et §3.1.3(g).
- Google Play Console — Create and set up your app / Metadata.
- Google Play Payments policy et Data Safety.

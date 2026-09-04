# Petit Annonces 2.0 — France / EU Compliance Baseline

> Engineering checklist, not legal advice. Final production texts and regulated workflows should be reviewed by qualified French/EU counsel and the selected payment provider.

## GDPR / CNIL

- Privacy-by-design and data minimisation
- Legal-basis inventory per processing purpose
- Consent records where consent is the basis
- Cookie/traceur consent management
- User data-access/export workflow
- Rectification workflow
- Erasure/account deletion workflow with lawful retention exceptions
- Retention/deletion schedule
- Processor/subprocessor register and DPAs
- Security incident procedure
- DPIA process for high-risk processing
- Access controls and auditability

## Digital Services Act (DSA)

- Easy-to-use illegal-content/listing reporting mechanism
- Moderation case tracking
- Statements/reasons for relevant moderation decisions
- Appeal/internal complaint workflow where applicable
- Terms/policy transparency for restrictions and moderation
- Trader traceability/verification fields for professional sellers
- Advertising/sponsored-content transparency
- Contact-point and operational compliance records as applicable to platform status

## GPSR / Product safety

For product listings where the regime applies:

- Manufacturer data
- EU responsible person where required
- Product/model identifiers
- Relevant warnings/safety information
- Ability to prevent publication when required safety data is missing
- Product-safety report workflow
- Recall/unsafe-product workflow
- Ability to identify affected listings/sellers/buyers
- Safety-contact operational process
- Preserve evidence of takedown/notification actions

## Consumer protection — professional sellers

Keep B2C flows distinct from C2C flows.

- Clearly identify professional seller status
- Pre-contract consumer information
- Price/fees/shipping transparency before payment
- Withdrawal/cancellation workflow when legally applicable
- Return/refund workflow
- Legal guarantee/support information where applicable
- Order confirmation and durable transaction records
- Consumer mediation information for Petit Annonces' own professional obligations where applicable

## DAC7 / seller reporting

Create the data model early for potentially reportable sellers/activities:

- legal name
- primary address/country
- date of birth or business registration data as required
- tax residence
- TIN and jurisdiction where required
- VAT number where relevant
- financial account/provider identifiers where required
- transaction counts
- consideration/gross amount by reporting period
- fees/commissions withheld
- due diligence/reportability status
- reporting/export audit trail

Exact reportability and exclusions must be implemented against the current French tax authority specifications before launch.

## Payments / KYC

- Use a licensed marketplace PSP
- PSP handles regulated custody/KYC/payment account obligations per contract
- Webhooks are verified and idempotent
- Do not store raw payment card data
- Reconciliation and immutable transaction records
- Clear refund/dispute/chargeback states

## Accessibility

- Accessibility as a design-system requirement
- Keyboard navigation
- Visible focus states
- Semantic structure/labels
- Contrast checks
- Screen-reader-compatible forms and errors
- Accessible authentication and checkout
- Alternative text for meaningful imagery
- Accessibility statement/process appropriate to applicable rules

## Required policy/product pages before production

- Mentions légales
- CGU
- CGV for Petit Annonces paid services
- Politique de confidentialité
- Politique cookies
- Règlement des annonces
- Produits / contenus interdits ou restreints
- Politique de modération
- Signalement et contestation
- Protection acheteur
- Paiements / remboursements
- Professionnels / vendeurs
- Sécurité des produits
- DAC7 information
- Médiation de la consommation
- Accessibilité

## Engineering rule

Compliance is implemented as domain logic and auditable workflows, not only as footer pages.

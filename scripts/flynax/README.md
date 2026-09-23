# Flynax → Petit Annonces migration kit

This kit is deliberately dry-run first. Do not point DNS at the new app as part of migration.

## 1. Inspect the old Flynax database
Copy `scripts/flynax/inspect-flynax.php` to the old Flynax server and run it from CLI with database environment variables:

```bash
FLYNAX_DB_DSN='mysql:host=127.0.0.1;dbname=...' \
FLYNAX_DB_USER='...' FLYNAX_DB_PASS='...' FLYNAX_DB_PREFIX='fl_' \
php inspect-flynax.php > flynax-schema.json
```

The file contains table/column names and row counts only; it does not dump passwords or secrets.

## 2. Produce a normalized export
After the schema is reviewed, prepare these NDJSON files in one directory:

- `users.ndjson`
- `categories.ndjson`
- `listings.ndjson`
- `media.ndjson`

Accepted normalized shapes:

```json
{"legacyId":"123","email":"member@example.fr","displayName":"Jean","firstName":"Jean","lastName":"Dupont","phone":"...","createdAt":"2025-01-01T12:00:00Z","kind":"PARTICULIER"}
{"legacyId":"4","name":"Téléphones","parentLegacyId":"1","slug":"telephones"}
{"legacyId":"567","sellerLegacyId":"123","categoryLegacyId":"4","title":"iPhone","description":"...","priceMinor":29900,"city":"Paris","postalCode":"75001","createdAt":"2025-03-01T12:00:00Z","publishedAt":"2025-03-02T12:00:00Z","status":"PUBLISHED"}
{"legacyId":"900","listingLegacyId":"567","source":"/absolute/path/photo.jpg","mimeType":"image/jpeg","sortOrder":0,"isCover":true}
```

`source` may also be an HTTPS URL. Private/local network URLs are not fetched.

## 3. Category map
Generate `category-map.json` mapping old category IDs to new Petit Annonces slugs:

```json
{"4":"smartphones","15":"voitures"}
```

Start from `scripts/flynax/category-map.example.json`.

## 4. Dry run
From the new server/repository:

```bash
set -a; source /var/www/petitannonces/shared/.env; set +a
cd /var/www/petitannonces/current/apps/api
pnpm exec tsx scripts/flynax-migrate.ts \
  --input /secure/path/flynax-export \
  --category-map /secure/path/category-map.json
```

Dry run validates duplicates, category mappings, users, listings and media without modifying the database or object storage.

## 5. Apply
Only after reviewing the report:

```bash
pnpm exec tsx scripts/flynax-migrate.ts \
  --input /secure/path/flynax-export \
  --category-map /secure/path/category-map.json \
  --apply
```

Safety properties:
- Existing emails are reused, never overwritten.
- Existing migrated legacy IDs are detected through a migration ledger.
- Old password hashes are never copied.
- Newly created legacy users receive a random Argon2 password unknown to everyone and must use password reset for first login.
- Imported listings default to `DRAFT` unless `--preserve-published` is explicitly supplied.
- Media is copied to the configured Petit Annonces object storage and verified before being marked READY.
- `--apply` is required for writes; default is dry-run.

## Password reset communication
Do not mass-send reset emails until the final cutover plan is approved. Once users are migrated, the existing “Mot de passe oublié” flow can issue a fresh one-time reset token to the verified email address.

## 6. Generate a category-map draft
After `categories.ndjson` exists, the new server can suggest mappings against the live Petit Annonces category tree:

```bash
cd /var/www/petitannonces/current/apps/api
pnpm exec tsx scripts/flynax-category-map.ts \
  --input /secure/path/flynax-export/categories.ndjson \
  --output /secure/path/category-map.suggested.json
```

Mappings with low confidence remain for manual review. Never apply a suggested category map without reviewing it.

## 7. Config-driven read-only export
`scripts/flynax/export-flynax.php` converts an old Flynax database to the normalized NDJSON format. First run `inspect-flynax.php`, then copy and edit `export-map.example.json` so every table/column name matches the actual old database schema. The example column names are placeholders and must not be assumed correct for every Flynax installation.

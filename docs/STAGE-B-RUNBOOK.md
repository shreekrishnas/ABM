# Stage B runbook: client ownership and per-client company websites

**Status: prepared and tested, NOT approved.** Nothing here has been run against production. Every step
marked **(write)** changes production and needs explicit approval first. Steps marked (read-only) only read.

- Production now: `9ff52b2` (Stage A), deployment `dpl_CNS5rbRDimMDC6CTcWbyTrYANyVd`, live since 23 Nov 2026 14:22 UTC.
- Earlier rollback target: `18a8065`, deployment `dpl_BNXcRfiSuZMtB6NLGAtgYQsqaWsg` (kept).
- Database: Supabase project `hwygiosehqgbuecislnt` (ap-south-1, Free plan), Postgres 17.11, app schema `abm`
  (71 tables, about 28 MB; no functions, triggers, row-level security policies or extension types).
  The app connects as the role `abm_app`.

## 0. What Stage B changes

**Code:** `9ff52b2 → 86676ab`, a fast-forward of 8 commits (62 files; no package, environment, Vercel or CI
changes). It ships together with the commit that adds this runbook and its scripts, which changes no app code.

| Commit | What |
|---|---|
| `a7bc6d2` | Campaigns, LinkedIn senders and website visits belong to one client; no cross-client writes |
| `6297674` | Contract step for per-client company websites (the database part is migration 2) |
| `2dc0ec1` | Keeps agent worktrees out of the repository |
| `0f9b17f` | Email readiness: one checklist per client; sending holds an incomplete client and says why |
| `05b3de5` | Vega and scope: per-client steps; platform records only for full Super Admins |
| `605cb03` | Apollo through the shared retry helper; the visitor list is read fully or says it wasn't |
| `ea948ae` | A stopped company says why and offers its next step; stopped companies in the list |
| `86676ab` | Email readiness: a client without a client record is not treated as stopped |

**Database: two migrations.** Neither changes or deletes any existing value. They add columns and indexes,
fill the new columns, and drop two old indexes and two old defaults.

1. `20261123100000_client_ownership`
   - Adds an owner (`sellerId`) to campaigns, sender profiles and website visits.
   - Fills it in from the existing data.
   - Makes campaign and sender names unique per client instead of across all clients.
2. `20261123110000_account_domain_contract`
   - Drops the old global unique index on a company's website (`Account_domain_key`). The per-client
     index `Account_sellerId_domain_key` has been in place since 15 Nov.
   - Removes the leftover database default client (`'manch'`) on `Account.sellerId` and `ImportBatch.sellerId`.

**Order is mandatory: migration 1 before the Stage B code.** The Stage B code reads the new owner
columns, and would fail on every campaign, sender or visit query without them.

## 1. Preflight results (read-only, 23 Nov 2026, about 14:30 UTC)

| Check | Result |
|---|---|
| Rows | Account 11, Campaign 2, SenderProfile 2, WebVisit 289, ImportBatch 3, Contact 75, Journey 15 |
| Campaign backfill | `cmvqchzsz0000if08angkei56` "Manch – Pharma – Q4 2026" → manch. `cmvz3l4rh0000lh0871yn1uvo` "trilliant digital" → no owner (no remaining uses) |
| Sender backfill | `cmvqci42e0001if08srj1hcoz` → manch. `cmvz3ln9y0001lh08vs4q55ut` → no owner (no remaining uses) |
| Visit backfill | 1 visit matched to a company → manch; 288 unmatched Apollo visits → manch (latest Apollo fetch); 0 left without an owner |
| Name conflicts after backfill | 0 campaigns, 0 senders |
| Website conflicts | 0 websites held twice in one client; 0 websites shared between clients |
| Objects the migrations create | none exist yet (no `sellerId` on Campaign, SenderProfile or WebVisit; none of the 5 new indexes) |
| Objects the migrations drop | `Campaign_name_key`, `SenderProfile_name_key`, `Account_domain_key` all exist |
| Defaults | `Account.sellerId` and `ImportBatch.sellerId` default to `'manch'`; 0 rows without a client |
| Migration history | `_prisma_migrations` has 42 rows (latest `20261115120000_account_unique_per_client`, checksum `manual`). 11 later migrations were applied through Supabase without a history row. **Never run `prisma migrate deploy` against production**: it would try to apply those 11 again. |

The two unowned records were created on 2 Nov, the day the Trilliant Digital client was added. Their
imports and journeys were removed with Trilliant Digital's companies on 23 Nov. **Decision needed (step 4):**
assign them to `trilliant-digital`, or leave them unowned (then only a full Super Admin sees them).

## 2. Applying the migrations before the code is safe for the running app

The running code is `9ff52b2`, and it was checked on a database with both migrations applied.

- **Code reading (9ff52b2):**
  - Campaigns and senders are looked up by name with `findUnique`. That's a plain lookup, which still
    works without the global unique index.
  - They're created without an owner, which is allowed: the new column accepts empty values.
  - Nothing upserts or connects campaigns or senders by name.
  - Every company and import is created with its client named (`src/lib/pipeline/ingest.ts`), so nothing
    relies on the `'manch'` default.
  - Companies are looked up by client and website, which is the index that stays.
- **Tests, run locally on 23 Nov (section 7 has the details):**

  | Check | Result |
  |---|---|
  | 9ff52b2 full test suite, with both migrations applied first | **650/650** |
  | 9ff52b2 production build and browser journeys, migrations applied on top of seeded data | **27/27** |
  | The exact Supabase payloads (appendices A to C), in schema `abm` with production-like rows (`scripts/migration-payload-test.sh`) | both migrations pass |
  | Upgrade, rollback and re-apply through Prisma (`scripts/migration-test.sh`) | both pass |

  In the payload test, both migrations apply. A second apply is refused as a whole (migration 1) or
  harmless (migration 2). Each rollback refuses unsafe states without changing anything, rolls back, is
  safe to repeat, and re-applies.
- **Locks:**
  - The migrations take short locks on Campaign, SenderProfile, WebVisit (migration 1) and Account and
    ImportBatch (migration 2). These are small tables, so the locks last milliseconds.
  - The payload sets `lock_timeout = 5s`. If something holds a lock, the migration stops as a whole
    instead of queueing behind it; just run it again.
- **One behaviour difference while 9ff52b2 runs on the new schema:**
  - The database no longer stops two campaigns (or senders) having the same name; the app's own
    name check still does.
  - This matters only in the minutes between migration 1 and the Stage B code going live.

## 3. Backup

### 3.1 Why a backup has to be taken by hand

- Supabase backs up only Pro, Team and Enterprise projects (Supabase docs, "Database Backups").
  This project is on the Free plan, so there is no Supabase backup to restore.
- Before Stage B, take a backup yourself and confirm it, using one of the two methods below.

### 3.2 Method A: `scripts/backup-abm.sh` (recommended; no Docker)

You need:

- **PostgreSQL client tools 17 or newer** (`pg_dump`, `pg_restore`, `psql`). The script refuses older ones.
  - macOS: `brew install postgresql@17`
  - Windows: the EDB installer, "Command Line Tools" only (run the script from Git Bash or WSL)
  - Linux: `postgresql-client-17` from apt.postgresql.org
- **The Session pooler connection string:** Supabase → project → **Connect** → **Session pooler** (port 5432).
  - The transaction pooler (6543) can't run `pg_dump`.
  - The direct connection needs IPv6.

```sh
export ABM_DB_URL='postgresql://postgres.hwygiosehqgbuecislnt:<password>@aws-<n>-ap-south-1.pooler.supabase.com:5432/postgres'
scripts/backup-abm.sh
# OK: backups/abm-<UTC time>.dump holds 71 tables and N rows, the same as the live database.
```

The script:

- dumps schema `abm` (custom format);
- counts the rows of every table inside the file, and in the live database right after;
- prints **OK** only if every table and count match;
- writes `.counts`, `.live` and `.sha256` next to the dump;
- never writes to the database. `backups/` is git-ignored.

**Confirm the backup:** send the OK line (tables and rows, no data). It is compared with a read-only count
of production taken at the same moment. Never paste the connection string or the backup into chat.
Keep a copy of the `.dump` off your computer.

### 3.3 Method B: the Supabase CLI (official; needs Docker)

```sh
supabase db dump --db-url "$ABM_DB_URL" -f roles.sql --role-only
supabase db dump --db-url "$ABM_DB_URL" -f schema.sql
supabase db dump --db-url "$ABM_DB_URL" -f data.sql --use-copy --data-only
```

This is a whole-project backup as plain SQL, which can be restored into a new Supabase project
(docs: "Backup and Restore using the CLI").

### 3.4 Restore (only if needed; never into production without approval)

Into a **new** Supabase project, or a local Postgres 17, for inspection or full recovery:

```sh
pg_restore --no-owner --no-privileges --exit-on-error --dbname "$TARGET_URL" backups/abm-<stamp>.dump
```

Then check the restore and get the database ready for the app:

- **Check:** run the counts query from `scripts/backup-abm.sh` against the target and compare with the
  `.counts` file. They must be identical.
- **Before the app connects to it:** create the login role `abm_app`. Then run the two grant migrations
  (`prisma/migrations/20261028190000_grant_app_role`, `…20261030090000_default_grants`) with
  `SET search_path TO abm;` first.
- **No extensions needed:** the schema uses no extension types or functions.

### 3.5 Execution-day safety copy **(write, part of the Stage B approval)**

These are small copies in a separate schema, made just before migration 1. They're not a schema
migration, so run them with `execute_sql` and leave them out of the migration list. The app can't see
them (no grants), and the health check looks only at schema `abm`. Drop the schema after 7 good days.

```sql
CREATE SCHEMA IF NOT EXISTS abm_backup_stage_b;
CREATE TABLE abm_backup_stage_b."Campaign"      AS TABLE abm."Campaign";
CREATE TABLE abm_backup_stage_b."SenderProfile" AS TABLE abm."SenderProfile";
CREATE TABLE abm_backup_stage_b."WebVisit"      AS TABLE abm."WebVisit";
CREATE TABLE abm_backup_stage_b."ImportBatch"   AS TABLE abm."ImportBatch";
CREATE TABLE abm_backup_stage_b."Account_keys"  AS SELECT id, "sellerId", domain FROM abm."Account";
```

## 4. Execution (each **(write)** step needs approval)

**Window:**

- Any quiet time outside 01:45–03:30 UTC (the daily check runs at 02:00 UTC).
- Allow about 30 minutes.

**Pause rule:** stop and report at any check that doesn't match.

### Step 0 (read-only): pre-check

- Production is still `9ff52b2` (git and Vercel).
- AI is paused; no open background jobs; 0 approved drafts.
- **State query** (appendix V) returns:
  - `owner_columns=none`
  - `old_indexes=Account_domain_key,Campaign_name_key,SenderProfile_name_key`
  - `new_indexes=none`
  - `client_defaults` both `'manch'::text`
  - `recorded=none`
  - rows as in section 1, or the difference explained
- The preflight conflict checks (section 1) are still 0.

### Step 1: backup taken and confirmed (section 3)

### Step 2 **(write)**: safety copy (3.5)

### Step 3 **(write)**: migration 1

- Supabase `apply_migration`:
  - name `client_ownership`
  - query: **appendix A**, exactly as `scripts/supabase-migration-sql.sh 20261123100000_client_ownership` prints it
- Then check with the **state query**:
  - `owner_columns=Campaign,SenderProfile,WebVisit`
  - `old_indexes=Account_domain_key`
  - `new_indexes` lists all 5
  - `recorded=20261123100000_client_ownership`
  - rows unchanged
- Then check with the **owner query** (appendix V):
  - campaigns `{"manch": 1, "(none)": 1}`
  - senders `{"manch": 1, "(none)": 1}`
  - visits `{"manch": 289}`
- `scripts/smoke-auth.sh https://abm-chi.vercel.app` passes; no runtime errors.
  This is 9ff52b2 running on the new schema.

### Step 4 **(write, your decision)**: the two unowned Trilliant Digital records

Either run **appendix D**, which assigns them to `trilliant-digital`, or leave them unowned.

### Step 5 **(write)**: migration 2

- Supabase `apply_migration`:
  - name `account_domain_contract`
  - query: **appendix B**
- Then check with the **state query**:
  - `old_indexes=none`
  - `client_defaults=Account=none,ImportBatch=none`
  - `recorded` lists both migrations
  - rows unchanged
- Smoke test as in step 3.

### Step 6 **(write)**: Stage B code

First, the commit to push must hold nothing beyond what was tested:

```sh
git log --oneline -1 sprint/stabilization             # the commit that adds this runbook (parent chain: 86676ab)
git diff --stat 86676ab sprint/stabilization          # must show only docs/, scripts/ and .gitignore
git push origin sprint/stabilization:refs/heads/claude/clever-noether-kff67l   # fast-forward from 9ff52b2; Vercel deploys it
```

Then check:

- Vercel READY for that commit, and the production alias serving it.
- GitHub Actions "Checks" green.
- `scripts/smoke-auth.sh` passes; no runtime errors.
- AI still paused; no new jobs, drafts or emails.

### Step 7 (you, signed in, about 5 minutes)

- Campaigns and senders: each client sees only its own. As a full Super Admin with no client picked,
  you also see the unowned ones (if left).
- Website visitors show under Manch.
- Settings shows the **Email readiness** checklist for the client in view.
- The Companies list has the **Stopped** filter; a stopped company says why and what to do next.
- Sign out everywhere still ends your other sessions.

### Step 8 (read-only): watch

- Runtime errors at +15 minutes and +1 hour.
- The next 02:00 UTC daily check: steps and queue hand-off recorded, nothing processed while AI is paused.

## 5. Rollback

| Problem | Do this | Time |
|---|---|---|
| Stage B code misbehaves | **R1:** Vercel → Deployments → `dpl_CNS5rbRDimMDC6CTcWbyTrYANyVd` → Instant Rollback. The database stays migrated; 9ff52b2 is tested on it (section 2). | about 1 min |
| A migration must be undone | **R1 first** (the Stage B code needs the new columns). Then **(write)** `apply_migration` with **appendix C2** (migration 2 rollback), then **C1** (migration 1 rollback). Check with the state query: it returns the step 0 values. | about 2 min |
| Data needs restoring | **(write)** From the safety copy (3.5) or the backup (3.4). The migrations change no existing values, so this is for the unexpected only. | depends |

What the rollback scripts do:

- They refuse, and change nothing, when undoing would break data:
  - two clients now hold the same website (migration 2);
  - two campaigns or senders now share a name (migration 1). Rename one first.
- Each removes its own `_prisma_migrations` row.
- Supabase's own migration list keeps its entries; that list is only a record.
- Each is safe to run twice.
- Rolling back migration 1 drops the owner columns and so loses the owners set since. Nothing else is lost.

## 6. Not part of Stage B (separate approval)

- Record the 11 Supabase-applied migrations in `_prisma_migrations`, so the history matches the database.
- Regular backups: run `scripts/backup-abm.sh` weekly, or move to Supabase Pro (daily backups, 7 days).
- "Clear account data": show the count and offer an export before deleting.

## 7. Evidence log (23 Nov 2026, local tests, never production)

- **Compatibility** (9ff52b2 on the Stage B schema):
  - A database was built with 9ff52b2's migrations, then the two Stage B migrations were applied as files.
    The 9ff52b2 full test suite passed: 80 files, 650/650.
  - Separately, the browser-journey database was seeded by 9ff52b2. The Stage B migrations were applied
    on top of that data (1 of the 2 seeded campaigns got an owner). The 9ff52b2 production build passed,
    and so did its browser journeys: 27/27.
- **Production procedure:**
  - `scripts/migration-payload-test.sh` passed for both migrations in schema `abm`, with the same SQL as
    appendices A to D. The script output is byte-identical to the tested payloads.
  - `scripts/migration-test.sh` passed for both migrations.
- **Stage B build:**
  - The deploy gate (design tokens, plus 14 files and 101 rule checks with no database reachable, as on Vercel) passed.
  - `next build` passed.
  - The full suite (675/675) and browser journeys (27/27) passed at the end of the sprint.
- **Backup procedure** (local Postgres 16 with the same tools):
  - `scripts/backup-abm.sh` reported OK: 70 tables, 9,575 rows.
  - `pg_restore --no-owner --no-privileges --exit-on-error` into an empty database gave identical counts,
    217/217 indexes and 53/53 foreign keys, and the checksum matched.
  - Removing one row afterwards was detected by the comparison.
- **Stage A, in production:**
  - `scripts/smoke-auth.sh https://abm-chi.vercel.app` passed 11/11.
  - Health was ok, with no runtime errors since the deploy.

## Appendix V: verification queries (read-only)

**State query** (works before and after every step):

```sql
select
 (select coalesce(string_agg(table_name, ',' order by table_name), 'none') from information_schema.columns where table_schema='abm' and column_name='sellerId' and table_name in ('Campaign','SenderProfile','WebVisit')) as owner_columns,
 (select coalesce(string_agg(indexname, ',' order by indexname), 'none') from pg_indexes where schemaname='abm' and indexname in ('Account_domain_key','Campaign_name_key','SenderProfile_name_key')) as old_indexes,
 (select coalesce(string_agg(indexname, ',' order by indexname), 'none') from pg_indexes where schemaname='abm' and indexname in ('Campaign_sellerId_name_key','SenderProfile_sellerId_name_key','Campaign_sellerId_idx','SenderProfile_sellerId_idx','WebVisit_sellerId_occurredAt_idx')) as new_indexes,
 (select string_agg(table_name || '=' || coalesce(column_default, 'none'), ',' order by table_name) from information_schema.columns where table_schema='abm' and column_name='sellerId' and table_name in ('Account','ImportBatch')) as client_defaults,
 (select coalesce(string_agg(migration_name, ',' order by migration_name), 'none') from abm."_prisma_migrations" where migration_name in ('20261123100000_client_ownership','20261123110000_account_domain_contract')) as recorded,
 json_build_object('Account', (select count(*) from abm."Account"), 'Campaign', (select count(*) from abm."Campaign"), 'SenderProfile', (select count(*) from abm."SenderProfile"), 'WebVisit', (select count(*) from abm."WebVisit"), 'ImportBatch', (select count(*) from abm."ImportBatch")) as rows_now;
```

Production returned this on 23 Nov 2026 (the step 0 values): `owner_columns=none`,
`old_indexes=Account_domain_key,Campaign_name_key,SenderProfile_name_key`, `new_indexes=none`,
`client_defaults=Account='manch'::text,ImportBatch='manch'::text`, `recorded=none`,
rows `{"Account":11,"Campaign":2,"SenderProfile":2,"WebVisit":289,"ImportBatch":3}`.

**Owner query** (only after migration 1):

```sql
select
 (select json_object_agg(coalesce("sellerId", '(none)'), n) from (select "sellerId", count(*) n from abm."Campaign" group by 1) x) as campaigns,
 (select json_object_agg(coalesce("sellerId", '(none)'), n) from (select "sellerId", count(*) n from abm."SenderProfile" group by 1) x) as senders,
 (select json_object_agg(coalesce("sellerId", '(none)'), n) from (select "sellerId", count(*) n from abm."WebVisit" group by 1) x) as visits;
```

## Appendix A: Migration 1, apply (Supabase apply_migration, name client_ownership)

Generated by `scripts/supabase-migration-sql.sh 20261123100000_client_ownership` (regenerate it; it must be identical).

```sql
SET search_path TO abm;
SET lock_timeout = '5s';
-- S-4: campaigns, LinkedIn sender profiles and website visits belong to a client.
-- Each client sees and uses only its own; names are unique within a client, not across clients.
-- Backward compatible with the code before it: that code reads campaigns and senders by name or id and
-- creates them without an owner (allowed: the column is nullable). Rollback: prisma/rollbacks/.

-- 1. Owner columns.
ALTER TABLE "Campaign" ADD COLUMN "sellerId" TEXT;
ALTER TABLE "SenderProfile" ADD COLUMN "sellerId" TEXT;
ALTER TABLE "WebVisit" ADD COLUMN "sellerId" TEXT;

-- 2. Campaigns and senders: the one client whose journeys or imports use it. One used by several
--    clients, or by none, stays without an owner (only a full Super Admin sees it) for a person to sort out.
WITH uses AS (
  SELECT j."campaignId" AS id, a."sellerId" FROM "Journey" j
    JOIN "Contact" ct ON ct."id" = j."contactId" JOIN "Account" a ON a."id" = ct."accountId"
  UNION
  SELECT b."campaignId", b."sellerId" FROM "ImportBatch" b WHERE b."campaignId" IS NOT NULL AND b."sellerId" IS NOT NULL
), one AS (SELECT id, MIN("sellerId") AS "sellerId" FROM uses GROUP BY id HAVING COUNT(DISTINCT "sellerId") = 1)
UPDATE "Campaign" c SET "sellerId" = one."sellerId" FROM one WHERE one.id = c."id" AND c."sellerId" IS NULL;

WITH uses AS (
  SELECT j."senderId" AS id, a."sellerId" FROM "Journey" j
    JOIN "Contact" ct ON ct."id" = j."contactId" JOIN "Account" a ON a."id" = ct."accountId"
  UNION
  SELECT b."senderId", b."sellerId" FROM "ImportBatch" b WHERE b."senderId" IS NOT NULL AND b."sellerId" IS NOT NULL
), one AS (SELECT id, MIN("sellerId") AS "sellerId" FROM uses GROUP BY id HAVING COUNT(DISTINCT "sellerId") = 1)
UPDATE "SenderProfile" s SET "sellerId" = one."sellerId" FROM one WHERE one.id = s."id" AND s."sellerId" IS NULL;

-- 3. Website visits: the company's client when the visit is matched to a company. Apollo's list of
--    visitors not matched to a company belongs to the client that pulls it (the latest Apollo fetch).
UPDATE "WebVisit" v SET "sellerId" = a."sellerId" FROM "Account" a WHERE a."id" = v."accountId" AND v."sellerId" IS NULL;
UPDATE "WebVisit" v SET "sellerId" = (SELECT j."sellerId" FROM "BackgroundJob" j WHERE j."kind" = 'apollo_fetch' ORDER BY j."createdAt" DESC LIMIT 1)
  WHERE v."sellerId" IS NULL AND v."accountId" IS NULL AND v."source" = 'apollo';

-- 4. Names unique per client instead of across all clients.
CREATE UNIQUE INDEX "Campaign_sellerId_name_key" ON "Campaign"("sellerId", "name");
CREATE UNIQUE INDEX "SenderProfile_sellerId_name_key" ON "SenderProfile"("sellerId", "name");
DROP INDEX "Campaign_name_key";
DROP INDEX "SenderProfile_name_key";

-- 5. Lookups by client.
CREATE INDEX "Campaign_sellerId_idx" ON "Campaign"("sellerId");
CREATE INDEX "SenderProfile_sellerId_idx" ON "SenderProfile"("sellerId");
CREATE INDEX "WebVisit_sellerId_occurredAt_idx" ON "WebVisit"("sellerId", "occurredAt");
INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
SELECT gen_random_uuid()::text, 'manual', '20261123100000_client_ownership', now(), now(), 1
WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name = '20261123100000_client_ownership');
```

## Appendix B: Migration 2, apply (Supabase apply_migration, name account_domain_contract)

Generated by `scripts/supabase-migration-sql.sh 20261123110000_account_domain_contract` (regenerate it; it must be identical).

```sql
SET search_path TO abm;
SET lock_timeout = '5s';
-- P0-1 contract: a company's website is unique within its client only, so two clients can each hold the
-- same company. The per-client index ("Account_sellerId_domain_key") has been in place since the expand
-- step (20261115120000); this drops the old global one. Also removes the leftover database default
-- client on Account and ImportBatch: the app always names the client (the schema has no default).
-- Production check before writing this (read-only): 686 companies, no website held twice in a client.
-- Rollback: prisma/rollbacks/20261123110000_account_domain_contract.sql
DROP INDEX IF EXISTS "Account_domain_key";
ALTER TABLE "Account" ALTER COLUMN "sellerId" DROP DEFAULT;
ALTER TABLE "ImportBatch" ALTER COLUMN "sellerId" DROP DEFAULT;
INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
SELECT gen_random_uuid()::text, 'manual', '20261123110000_account_domain_contract', now(), now(), 1
WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name = '20261123110000_account_domain_contract');
```

## Appendix C1: Migration 1, rollback (only after rolling the code back)

Generated by `scripts/supabase-migration-sql.sh 20261123100000_client_ownership --rollback` (regenerate it; it must be identical).

```sql
SET search_path TO abm;
SET lock_timeout = '5s';
-- Rollback of migration 20261123100000_client_ownership (S-4). Run in the app's schema
-- (production: SET search_path TO abm;). Restores global name uniqueness and drops the owner columns.
-- Refuses if two campaigns or two senders now share a name (two clients each made one): the old
-- global unique index can't be rebuilt then, so rename one first. The deployed code must be rolled
-- back first: code that filters by client needs the columns.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Campaign" GROUP BY "name" HAVING COUNT(*) > 1)
     OR EXISTS (SELECT 1 FROM "SenderProfile" GROUP BY "name" HAVING COUNT(*) > 1) THEN
    RAISE EXCEPTION 'Two campaigns or senders share a name (different clients): rename one before rolling back';
  END IF;
END $$;
DROP INDEX IF EXISTS "WebVisit_sellerId_occurredAt_idx";
DROP INDEX IF EXISTS "SenderProfile_sellerId_idx";
DROP INDEX IF EXISTS "Campaign_sellerId_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "Campaign_name_key" ON "Campaign"("name");
CREATE UNIQUE INDEX IF NOT EXISTS "SenderProfile_name_key" ON "SenderProfile"("name");
DROP INDEX IF EXISTS "Campaign_sellerId_name_key";
DROP INDEX IF EXISTS "SenderProfile_sellerId_name_key";
ALTER TABLE "WebVisit" DROP COLUMN IF EXISTS "sellerId";
ALTER TABLE "SenderProfile" DROP COLUMN IF EXISTS "sellerId";
ALTER TABLE "Campaign" DROP COLUMN IF EXISTS "sellerId";
-- Forget the migration so a later `prisma migrate deploy` applies it again.
DO $$
BEGIN
  IF to_regclass('"_prisma_migrations"') IS NOT NULL THEN
    DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261123100000_client_ownership';
  END IF;
END $$;
```

## Appendix C2: Migration 2, rollback (before C1)

Generated by `scripts/supabase-migration-sql.sh 20261123110000_account_domain_contract --rollback` (regenerate it; it must be identical).

```sql
SET search_path TO abm;
SET lock_timeout = '5s';
-- Rollback of migration 20261123110000_account_domain_contract. Run in the app's schema (production:
-- SET search_path TO abm;). Restores the global unique website index and the old defaults. Refuses if
-- two clients now hold the same website (the global index can't be rebuilt then).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Account" WHERE "domain" IS NOT NULL GROUP BY "domain" HAVING COUNT(*) > 1) THEN
    RAISE EXCEPTION 'Two clients now hold the same company website: the global unique index cannot be restored';
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "Account_domain_key" ON "Account"("domain");
ALTER TABLE "Account" ALTER COLUMN "sellerId" SET DEFAULT 'manch';
ALTER TABLE "ImportBatch" ALTER COLUMN "sellerId" SET DEFAULT 'manch';
DO $$
BEGIN
  IF to_regclass('"_prisma_migrations"') IS NOT NULL THEN
    DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261123110000_account_domain_contract';
  END IF;
END $$;
```

## Appendix D: assign the two unowned Trilliant Digital records (your decision; execute_sql)

```sql
UPDATE abm."Campaign"      SET "sellerId" = 'trilliant-digital' WHERE id = 'cmvz3l4rh0000lh0871yn1uvo' AND "sellerId" IS NULL;
UPDATE abm."SenderProfile" SET "sellerId" = 'trilliant-digital' WHERE id = 'cmvz3ln9y0001lh08vs4q55ut' AND "sellerId" IS NULL;
```

Then the owner query shows `trilliant-digital: 1` for campaigns and senders. To undo it, set them back to `NULL`.

## Appendix S: smoke test

`scripts/smoke-auth.sh https://abm-chi.vercel.app` makes 11 read-only checks:

- health;
- a signed-out page, and an ended session's page;
- the sign-in page;
- a server action while signed out, and one with an ended session;
- any other write with an ended session;
- the API without a key.

Nothing is signed in and no action runs. It exits 0 only when every check passes.

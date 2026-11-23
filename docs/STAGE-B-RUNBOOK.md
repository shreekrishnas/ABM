# Stage B runbook: client ownership and per-client company websites

**Status: prepared and tested, NOT approved.** Nothing here has been run against production. Every step
marked **(write)** changes production and needs explicit approval first. Steps marked (read-only) only read.

**Production:**
- Running `9ff52b2` (Stage A), deployment `dpl_CNS5rbRDimMDC6CTcWbyTrYANyVd`, live since 23 Nov 2026 14:22 UTC.
- Rollback target: deployment `dpl_BNXcRfiSuZMtB6NLGAtgYQsqaWsg` (`18a8065`), kept.

**Where the Stage B history is kept:**
- GitHub branch `backup/stage-b-2026-11-23`. Its tip adds `git.deploymentEnabled: {"backup/*": false}` to
  `vercel.json`, so pushing it creates no Vercel deployment. That was checked: none was created.
- A standalone git bundle with the full history (no base commit needed).

**Database:**
- Supabase project `hwygiosehqgbuecislnt` (ap-south-1, Free plan), Postgres 17.11.
- App schema `abm`: 71 tables, about 28 MB. No functions, triggers, row-level security policies or extension types.
- The app connects as the role `abm_app`.

## 0. What Stage B changes

**Code:** a fast-forward from `9ff52b2` to the head of `sprint/stabilization`. That's 8 feature commits, plus
this runbook with its scripts, plus the Apollo owner fix (last row). No package, environment, Vercel or CI changes.

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
| `e6e2554` | This runbook and its scripts (no app code) |
| (head) | Apollo's website visitors belong to one client, set explicitly. Migration 1 no longer guesses their owner. |

**Database: two migrations.** Neither changes or deletes any existing value. They add columns and indexes,
fill the new columns, and drop two old indexes and two old defaults.

1. `20261123100000_client_ownership`
   - Adds an owner (`sellerId`) to campaigns, sender profiles and website visits.
   - Fills it in where the data proves it:
     - a campaign or sender used by exactly one client;
     - a visit matched to a company.
   - Makes campaign and sender names unique per client instead of across all clients.
   - Visits that match no company stay unowned: who owns Apollo's visitor list is not guessed by the
     migration. Step 3b assigns them, with the evidence in section 1.
2. `20261123110000_account_domain_contract`
   - Drops the old global unique index on a company's website (`Account_domain_key`). The per-client
     index `Account_sellerId_domain_key` has been in place since 15 Nov.
   - Removes the leftover database default client (`'manch'`) on `Account.sellerId` and `ImportBatch.sellerId`.

**Order is mandatory: migration 1 before the Stage B code.** The Stage B code reads the new owner
columns, and would fail on every campaign, sender or visit query without them.

## 1. Preflight results (read-only, 23 Nov 2026)

| Check | Result |
|---|---|
| Rows | Account 11, Campaign 2, SenderProfile 2, WebVisit 289, ImportBatch 3, Contact 75, Journey 15 |
| Campaign backfill | `cmvqchzsz0000if08angkei56` "Manch – Pharma – Q4 2026" → manch. `cmvz3l4rh0000lh0871yn1uvo` "trilliant digital" → no owner (no remaining uses) |
| Sender backfill | `cmvqci42e0001if08srj1hcoz` → manch. `cmvz3ln9y0001lh08vs4q55ut` → no owner (no remaining uses) |
| Visit backfill | 1 visit matched to a Manch company → manch. 288 Apollo visits matching no company → no owner until step 3b. |
| Name conflicts after backfill | 0 campaigns, 0 senders |
| Website conflicts | 0 websites held twice in one client; 0 websites shared between clients |
| Objects the migrations create | none exist yet (no `sellerId` on Campaign, SenderProfile or WebVisit; none of the 5 new indexes) |
| Objects the migrations drop | `Campaign_name_key`, `SenderProfile_name_key`, `Account_domain_key` all exist |
| Defaults | `Account.sellerId` and `ImportBatch.sellerId` default to `'manch'`; 0 rows without a client |
| Migration history | `_prisma_migrations` has 42 rows (latest `20261115120000_account_unique_per_client`, checksum `manual`). 11 later migrations were applied through Supabase without a history row. **Never run `prisma migrate deploy` against production**: it would try to apply those 11 again. |

**The two Trilliant Digital records:**

- Campaign "trilliant digital" and sender "Suryanarayana Valluri" were created on 2 Nov, the day the
  client was added.
- Their imports and journeys were removed with Trilliant Digital's companies on 23 Nov.
- **Decision (23 Nov): leave them unowned.** Don't delete or reassign them; only a full Super Admin sees them.

**The 288 Apollo visits matching no company are Manch's website visitors.** Ownership was checked against the
record of each visitor pull, not taken from who fetched last:

- **The Apollo account:** there is one Apollo key and one website-visitor list for the platform.
- **15 Nov 07:44 UTC** (Super Admin, in Manch). This pull recorded 270 of the visits (269 unmatched, plus
  the matched one).
  - Every one of its 277 companies was checked against Manch's website, `https://manchtech.com/en/`.
  - Apollo had visit dates to manchtech.com for 265 of them.
  - 0 had visited only another tracked website.
- **4 Nov 04:54 UTC.** This pull recorded the other 19 visits, from the same Apollo list. 12 of those 19
  companies are among the 15 Nov companies checked against manchtech.com.
- **No other client is involved:**
  - Every Apollo fetch (5, all on 15 Nov) ran in Manch.
  - The one matched visit is a Manch company.
  - No pull ever used another client's website: Wipro 3D and Nicsphere have none on record, and
    `trilliantdigital.com` was never the tracked site.
- **Residual:** about 12 companies from 15 Nov, and the 7 seen only on 4 Nov, have no per-site visit date
  from Apollo. They're on the same list, whose only tracked site is manchtech.com.

**Production note:** the daily visitor pull has failed since 22 Nov 02:37 UTC ("Unknown seller
nicsphere"). The current code throws for a client without an Account Brain. Stage B's `clientForSite`
fixes this. Nothing was lost; the pull resumes after Stage B.

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
  | 9ff52b2 full test suite, with both migrations applied first | 650/650 |
  | 9ff52b2 production build and browser journeys, migrations applied on top of seeded data | 27/27 |
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

## 3. Backup (you run it; about 5 minutes)

Supabase backs up only Pro, Team and Enterprise projects, so this Free-plan project has no Supabase
backup. Two scripts do it:

- `scripts/backup-abm.sh` makes the backup and compares every table's row count with the live database.
  It only reads.
- `scripts/verify-backup.sh` restores it into a new, isolated PostgreSQL 17 database on your computer, then
  checks rows, tables, indexes and foreign keys against production at backup time.

**The password is never typed into a command.** You type it at a hidden prompt. It isn't stored, logged or
shown, and it isn't visible to other users of the computer.

### 3.1 One-time setup

PostgreSQL 17 tools (client tools are enough for the backup; the check also needs a local server):

- **macOS:**
  - `brew install postgresql@17`
  - `export PATH="$(brew --prefix postgresql@17)/bin:$PATH"`
  - `brew services start postgresql@17`
- **Windows:** the EDB installer, PostgreSQL 17 with its server. Run the scripts from Git Bash or WSL.
- **Linux:** `postgresql-17` from apt.postgresql.org.
- **Server alternative (Docker):** `docker run --rm -d --name abm-verify -p 54317:5432 -e POSTGRES_PASSWORD=verify postgres:17`

The scripts come from the repo (branch `backup/stage-b-2026-11-23`, folder `scripts/`).

### 3.2 Take the backup

1. Supabase → project → **Connect** → **Session pooler**. Copy the string and **delete the `:[YOUR-PASSWORD]`
   part**, so it reads `postgresql://postgres.hwygiosehqgbuecislnt@aws-<n>-ap-south-1.pooler.supabase.com:5432/postgres`.
   The transaction pooler (6543) can't run `pg_dump`.
2. In the repo folder:

   ```sh
   export ABM_DB_URL='postgresql://postgres.hwygiosehqgbuecislnt@aws-<n>-ap-south-1.pooler.supabase.com:5432/postgres'
   scripts/backup-abm.sh
   # Database password (not shown):          ← type the database password here
   # OK: backups/abm-<UTC time>.dump holds 71 tables and N rows, the same as the live database.
   ```

   It writes `backups/abm-<time>.dump`, with `.counts`, `.live`, `.schema` and `.sha256` beside it.
   `backups/` is git-ignored.

### 3.3 Verify it in an isolated PostgreSQL 17 database

```sh
VERIFY_DB_URL='postgresql://postgres@localhost:5432/postgres' scripts/verify-backup.sh backups/abm-<time>.dump
# Docker server: VERIFY_DB_URL='postgresql://postgres:verify@localhost:54317/postgres'
# OK: restored into an isolated PostgreSQL 17 database: 71 tables, N rows, 216 indexes, 53 foreign keys (all valid), the same as the live database at backup time.
```

Production had 71 tables, 216 indexes and 53 foreign keys at the final preflight (23 Nov 16:35 UTC). The
row total grows a little with every sign-in and audit entry.

How the check works:

- It refuses any server that isn't local.
- It checks the file's checksum.
- It creates its own database, `abm_restore_check_<time>`, and drops it afterwards. `KEEP=1` keeps it.

### 3.4 Confirm

- Send only the two OK lines. They're compared with a read-only count of production at that moment.
- Keep the `.dump` somewhere safe, off your computer.
- Never paste the connection string, the password or the backup into chat.

**Supabase CLI alternative (official; needs Docker):**

```sh
supabase db dump --db-url "$ABM_DB_URL" -f roles.sql --role-only
supabase db dump --db-url "$ABM_DB_URL" -f schema.sql
supabase db dump --db-url "$ABM_DB_URL" -f data.sql --use-copy --data-only
```

### 3.5 Restore (only if needed; never into production without approval)

Into a **new** Supabase project, or a local Postgres 17, for inspection or full recovery:

```sh
pg_restore --no-owner --no-privileges --exit-on-error --dbname "$TARGET_URL" backups/abm-<stamp>.dump
```

- **Check:** run `scripts/verify-backup.sh` against a local copy first.
- **Before the app connects to it:** create the login role `abm_app`. Then run the two grant migrations
  (`prisma/migrations/20261028190000_grant_app_role`, `…20261030090000_default_grants`) with
  `SET search_path TO abm;` first.
- **No extensions needed:** the schema uses no extension types or functions.

### 3.6 Execution-day safety copy **(write, part of the Stage B approval)**

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
- **Apollo:**
  - still 288 Apollo visits matching no company;
  - no Apollo fetch or pull since 15 Nov in any client but Manch (the **Apollo query**, appendix V).

### Step 1: backup taken and verified (section 3)

### Step 2 **(write)**: safety copy (3.6)

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
  - visits `{"manch": 1, "(none)": 288}`
- `scripts/smoke-auth.sh https://abm-chi.vercel.app` passes; no runtime errors.

### Step 3b **(write)**: assign the 288 Apollo visits to Manch

- Run **appendix E** with `execute_sql`.
- It refuses, changing nothing, unless exactly 288 such visits are waiting.
- Owner query afterwards: visits `{"manch": 289}`.
- If you'd rather not, skip this step: the visits stay unowned and only a full Super Admin sees them.

### Step 4: the two Trilliant Digital records

Nothing to run (decision: leave unowned).

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
git log --oneline -1 sprint/stabilization              # the head named in the approval request
git diff --stat 9ff52b2 sprint/stabilization           # what Stage B ships (no package, env, Vercel or CI files)
git push origin sprint/stabilization:refs/heads/claude/clever-noether-kff67l   # fast-forward from 9ff52b2; Vercel deploys it
```

Then check:

- Vercel READY for that commit, and the production alias serving it.
- GitHub Actions "Checks" green.
- `scripts/smoke-auth.sh` passes; no runtime errors.
- AI still paused; no new jobs, drafts or emails.

### Step 7 (you, signed in, about 5 minutes)

- Campaigns and senders: each client sees only its own. As a full Super Admin with no client picked,
  you also see the two unowned Trilliant Digital records.
- Website visitors show under Manch.
- In Trilliant Digital, "Fetch website visitors from Apollo" says the visitors belong to Manch and starts
  nothing.
- Settings shows the **Email readiness** checklist for the client in view.
- The Companies list has the **Stopped** filter; a stopped company says why and what to do next.
- Sign out everywhere still ends your other sessions.

### Step 8 (read-only): watch

- Runtime errors at +15 minutes and +1 hour.
- The next 02:00 UTC daily check: steps and queue hand-off recorded, and the visitor pull runs for Manch
  again. Nothing is processed while AI is paused.

**Recommended config (before step 6):** set `APOLLO_VISITOR_SITE=https://manchtech.com/en/` in Vercel
(Production). This names the owner of Apollo's visitor list explicitly. Without it the owner is the default
client: `ACTIVE_SELLER` if that's set in Vercel, else `manch`. The environment values couldn't be read from
here. After the next 02:00 UTC daily check, the visitor pull's record should show
`site: https://manchtech.com/en/`.

## 5. Rollback

| Problem | Do this | Time |
|---|---|---|
| Stage B code misbehaves | **R1:** Vercel → Deployments → `dpl_CNS5rbRDimMDC6CTcWbyTrYANyVd` → Instant Rollback. The database stays migrated; 9ff52b2 is tested on it (section 2). | about 1 min |
| Step 3b must be undone | **(write)** `UPDATE abm."WebVisit" SET "sellerId" = NULL WHERE source = 'apollo' AND "accountId" IS NULL AND "sellerId" = 'manch';` | seconds |
| A migration must be undone | **R1 first** (the Stage B code needs the new columns). Then **(write)** `apply_migration` with **appendix C2** (migration 2 rollback), then **C1** (migration 1 rollback). Check with the state query: it returns the step 0 values. | about 2 min |
| Data needs restoring | **(write)** From the safety copy (3.6) or the backup (3.5). The migrations change no existing values, so this is for the unexpected only. | depends |

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
- Add `"backup/*": false` to `git.deploymentEnabled` in the production `vercel.json`. Then any future
  `backup/*` branch can never deploy, whatever its own files say.

## 7. Evidence log (23 Nov 2026, local tests unless marked)

- **Compatibility** (9ff52b2 on the Stage B schema):
  - A database was built with 9ff52b2's migrations, then the two Stage B migrations were applied as files.
    The 9ff52b2 full test suite passed: 80 files, 650/650.
  - Separately, the browser-journey database was seeded by 9ff52b2. The Stage B migrations were applied on
    top of that data. The 9ff52b2 production build passed, and so did its browser journeys: 27/27.
  - The later change to migration 1 removed one backfill statement; the schema is unchanged.
- **Production procedure:**
  - `scripts/migration-payload-test.sh` passed for both migrations, current version, in schema `abm`, with
    the same SQL as appendices A to C. The script output is byte-identical to the appendices.
  - `scripts/migration-test.sh` passed for both, current version. Its fixtures include an Apollo fetch by
    another client, which the migration now ignores.
- **Apollo owner fix:**
  - 5 new tests (`tests/apollo-owner.test.ts`). 3 of them fail on the previous code and pass on the fix.
  - With the fix:
    - full suite 86 files, 680/680;
    - `next build` passed;
    - browser journeys 27/27;
    - typecheck clean;
    - migration and payload tests passed for both migrations.
- **Stage B deploy gate:** design tokens, plus 14 files and 101 rule checks with no database reachable,
  as on Vercel. Passed.
- **Backup scripts** (local PostgreSQL 16):
  - `backup-abm.sh` was run with the password typed at the prompt. It reported OK: 71 tables. The password
    appeared in no output or file.
  - `verify-backup.sh` restored the backup into a new database: 71 tables, all rows, 218 indexes and
    53 valid foreign keys, all identical to the source.
  - Three failures were caught: a tampered row count, a modified backup file, and a non-local server.
- **Stage A, in production:** `scripts/smoke-auth.sh https://abm-chi.vercel.app` passed 11/11. Health ok;
  no runtime errors since the deploy.
- **Stage B history:**
  - Branch `backup/stage-b-2026-11-23` pushed at 16:15 UTC. Vercel created no deployment for it.
  - Production branch unchanged at `9ff52b2`.
  - The standalone bundle (2.8 MB, 271 commits) cloned from the file alone, and `fsck` was clean.

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

**Owner query** (only after migration 1):

```sql
select
 (select json_object_agg(coalesce("sellerId", '(none)'), n) from (select "sellerId", count(*) n from abm."Campaign" group by 1) x) as campaigns,
 (select json_object_agg(coalesce("sellerId", '(none)'), n) from (select "sellerId", count(*) n from abm."SenderProfile" group by 1) x) as senders,
 (select json_object_agg(coalesce("sellerId", '(none)'), n) from (select "sellerId", count(*) n from abm."WebVisit" group by 1) x) as visits;
```

**Apollo query** (step 0; expect 288 visits, no fetch since 15 Nov, and only the failing daily pulls):

```sql
select
 (select count(*) from abm."WebVisit" where source = 'apollo' and "accountId" is null) as apollo_visits_without_company,
 (select coalesce(json_agg(json_build_object('at', to_char("createdAt",'YYYY-MM-DD HH24:MI'), 'client', "sellerId") order by "createdAt"), '[]') from abm."BackgroundJob" where kind = 'apollo_fetch' and "createdAt" > '2026-11-15 08:00') as fetches_since_15_nov,
 (select coalesce(json_agg(json_build_object('at', to_char("createdAt",'YYYY-MM-DD HH24:MI'), 'outcome', outcome, 'site', data->>'site') order by "createdAt"), '[]') from abm."PipelineEvent" where step = 'apollo.visitors' and "createdAt" > '2026-11-15 08:00') as pulls_since_15_nov;
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

-- 3. Website visits: the company's client when the visit is matched to a company. A visit not matched to a
--    company stays without an owner (only a full Super Admin sees it): whose website Apollo's visitor list
--    tracks is not guessed here, and never from who last fetched it. A person assigns those visits, with the
--    evidence, as a separate step.
UPDATE "WebVisit" v SET "sellerId" = a."sellerId" FROM "Account" a WHERE a."id" = v."accountId" AND v."sellerId" IS NULL;

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

## Appendix E: assign the 288 Apollo visits to Manch (step 3b; execute_sql)

The evidence is in section 1. The step refuses, and changes nothing, unless exactly 288 such visits are
waiting.

```sql
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM abm."WebVisit" WHERE source = 'apollo' AND "accountId" IS NULL AND "sellerId" IS NULL;
  IF n <> 288 THEN
    RAISE EXCEPTION 'Expected 288 Apollo visits with no company and no owner, found %: check before assigning', n;
  END IF;
  UPDATE abm."WebVisit" SET "sellerId" = 'manch' WHERE source = 'apollo' AND "accountId" IS NULL AND "sellerId" IS NULL;
END $$;
```

## Appendix S: smoke test

`scripts/smoke-auth.sh https://abm-chi.vercel.app` makes 11 read-only checks:

- health;
- a signed-out page, and an ended session's page;
- the sign-in page;
- a server action while signed out, and one with an ended session;
- any other write with an ended session;
- the API without a key.

Nothing is signed in and no action runs. It exits 0 only when every check passes.

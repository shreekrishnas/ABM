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

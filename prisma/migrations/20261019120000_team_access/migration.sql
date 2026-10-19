-- Team access: users with status and Super Admin entitlement, client workspaces, assignments, audit log.
ALTER TABLE "User" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'active';
ALTER TABLE "User" ADD COLUMN "superAdmin" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserClient" (
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserClient_pkey" PRIMARY KEY ("userId","clientId")
);
ALTER TABLE "UserClient" ADD CONSTRAINT "UserClient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserClient" ADD CONSTRAINT "UserClient_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AuditEntry" (
    "id" TEXT NOT NULL,
    "actorEmail" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "clientId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditEntry_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AuditEntry_createdAt_idx" ON "AuditEntry"("createdAt");

-- Starting team (approved list). Pending people sign in to "no client assigned yet".
INSERT INTO "Client" ("id", "name") VALUES ('manch', 'Manch') ON CONFLICT ("id") DO NOTHING;

INSERT INTO "User" ("id", "name", "email", "role", "status", "superAdmin") VALUES
  ('usr_shreekrishna', 'ShreeKrishna Basri', 'shreekrishna.basri@trilliantdigital.com', 'admin', 'active', true),
  ('usr_prabith',      'Prabith Gowda',      'prabith.g@trilliantdigital.com',          'rep',   'active', false),
  ('usr_ankitha',      'Ankitha B N',        'ankitha.bn@trilliantdigital.com',         'rep',   'active', false),
  ('usr_vandhyashree', 'Vandhyashree H S',   'vandhyashree.hs@trilliantdigital.com',    'rep',   'active', false),
  ('usr_apoorva',      'Apoorva Ganapule',   'apoorva.ganapule@trilliantdigital.com',   'rep',   'active', false),
  ('usr_vidhyashree',  'Vidhyashree K C',    'vidhyashree.kc@trilliantdigital.com',     'rep',   'active', false),
  ('usr_amrutha',      'Amrutha KV',         'amrutha.kv@trilliantdigital.com',         'rep',   'active', false),
  ('usr_bhargava',     'Bhargava B',         'bhargava.b@trilliantdigital.com',         'rep',   'active', false)
ON CONFLICT ("email") DO UPDATE SET "name" = EXCLUDED."name", "status" = 'active', "superAdmin" = EXCLUDED."superAdmin";

INSERT INTO "UserClient" ("userId", "clientId")
SELECT u."id", 'manch' FROM "User" u
WHERE u."email" IN ('shreekrishna.basri@trilliantdigital.com', 'prabith.g@trilliantdigital.com', 'ankitha.bn@trilliantdigital.com', 'vandhyashree.hs@trilliantdigital.com')
ON CONFLICT DO NOTHING;

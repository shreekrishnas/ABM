-- Which clients a Super Admin covers. Empty = every client (all existing Super Admins keep full access).
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "superAdminClients" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

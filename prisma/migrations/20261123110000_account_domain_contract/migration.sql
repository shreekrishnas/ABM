-- P0-1 contract: a company's website is unique within its client only, so two clients can each hold the
-- same company. The per-client index ("Account_sellerId_domain_key") has been in place since the expand
-- step (20261115120000); this drops the old global one. Also removes the leftover database default
-- client on Account and ImportBatch: the app always names the client (the schema has no default).
-- Production check before writing this (read-only): 686 companies, no website held twice in a client.
-- Rollback: prisma/rollbacks/20261123110000_account_domain_contract.sql
DROP INDEX IF EXISTS "Account_domain_key";
ALTER TABLE "Account" ALTER COLUMN "sellerId" DROP DEFAULT;
ALTER TABLE "ImportBatch" ALTER COLUMN "sellerId" DROP DEFAULT;

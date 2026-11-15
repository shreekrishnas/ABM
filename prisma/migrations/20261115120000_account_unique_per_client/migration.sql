-- P0-1 (expand): a company's website is unique per client, so two clients can each hold the same company.
-- Additive only: the old global index "Account_domain_key" stays until the contract step, so the
-- previous code keeps working. No rows are changed.
CREATE UNIQUE INDEX IF NOT EXISTS "Account_sellerId_domain_key" ON "Account"("sellerId", "domain");

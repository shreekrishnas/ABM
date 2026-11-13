-- The brief each email was written from (why this person, why now, why us, the ask).
ALTER TABLE "Draft" ADD COLUMN IF NOT EXISTS "brief" JSONB;

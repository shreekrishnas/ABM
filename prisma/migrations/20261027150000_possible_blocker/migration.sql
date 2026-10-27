-- Bad news reported by one source only goes to a person instead of ruling the company out.
ALTER TYPE "ReviewType" ADD VALUE IF NOT EXISTS 'possible_blocker';

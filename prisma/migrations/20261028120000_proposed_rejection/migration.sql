-- Rules that would rule a company out only propose it; a person approves the rejection.
ALTER TYPE "ReviewType" ADD VALUE IF NOT EXISTS 'proposed_rejection';

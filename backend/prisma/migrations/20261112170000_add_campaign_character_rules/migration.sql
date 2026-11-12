-- The house rules a campaign's characters are built by. Null means the defaults.
ALTER TABLE "Campaign" ADD COLUMN "characterRules" JSONB;

-- Add resident draft tracking fields to maintenance_items.
-- New status value DRAFT is added to MaintenanceStatus enum.
-- These changes are additive — no data backfill needed.
--
-- NOTE: Prisma does not snake_case field names unless @map is used,
-- so column identifiers stay camelCase and need to be double-quoted.
-- This script also cleans up any snake_case columns left behind from
-- an earlier failed run.

ALTER TYPE "MaintenanceStatus" ADD VALUE IF NOT EXISTS 'DRAFT';

-- Clean up orphan snake_case columns from a previous failed attempt.
ALTER TABLE maintenance_items
  DROP COLUMN IF EXISTS submitted_at,
  DROP COLUMN IF EXISTS cancelled_at,
  DROP COLUMN IF EXISTS abandoned_at,
  DROP COLUMN IF EXISTS last_step_completed,
  DROP COLUMN IF EXISTS triage_answers;

ALTER TABLE maintenance_items
  ADD COLUMN IF NOT EXISTS "submittedAt"       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "cancelledAt"       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "abandonedAt"       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "lastStepCompleted" INTEGER,
  ADD COLUMN IF NOT EXISTS "triageAnswers"     JSONB;

-- Existing rows had no draft phase — flag them as submitted at createdAt
-- so reports that filter by submittedAt still surface them.
UPDATE maintenance_items SET "submittedAt" = "createdAt" WHERE "submittedAt" IS NULL;

-- Phone for the organization, surfaced in resident emergency popups.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS phone TEXT;

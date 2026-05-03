-- Add resident draft tracking fields to maintenance_items.
-- New status value DRAFT is added to MaintenanceStatus enum.
-- These changes are additive — no data backfill needed.

ALTER TYPE "MaintenanceStatus" ADD VALUE IF NOT EXISTS 'DRAFT';

ALTER TABLE maintenance_items
  ADD COLUMN IF NOT EXISTS submitted_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS abandoned_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_step_completed INTEGER,
  ADD COLUMN IF NOT EXISTS triage_answers      JSONB;

-- Existing rows had no draft phase — flag them as submitted at created_at
-- so reports that filter by submitted_at still surface them.
UPDATE maintenance_items SET submitted_at = created_at WHERE submitted_at IS NULL;

-- Phone for the organization, surfaced in resident emergency popups.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS phone TEXT;

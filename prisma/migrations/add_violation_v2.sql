-- Add v2 fields to lease_violations
ALTER TABLE lease_violations
  ADD COLUMN IF NOT EXISTS resident_name       TEXT,
  ADD COLUMN IF NOT EXISTS violation_type      TEXT,
  ADD COLUMN IF NOT EXISTS other_description   TEXT,
  ADD COLUMN IF NOT EXISTS escalation_level    TEXT NOT NULL DEFAULT 'FLAGGED',
  ADD COLUMN IF NOT EXISTS resolved_type       TEXT,
  ADD COLUMN IF NOT EXISTS resolved_note       TEXT,
  ADD COLUMN IF NOT EXISTS resolved_by_id      TEXT;

CREATE INDEX IF NOT EXISTS lease_violations_escalation_level_idx ON lease_violations(escalation_level);

-- Backfill violationType from category where possible
UPDATE lease_violations SET violation_type = CASE
  WHEN category ILIKE '%messy%'                         THEN 'MESSY'
  WHEN category ILIKE '%odor%'                          THEN 'BAD_ODOR'
  WHEN category ILIKE '%smok%'                          THEN 'SMOKING'
  WHEN category ILIKE '%guest%'                         THEN 'UNAUTHORIZED_GUESTS'
  WHEN category ILIKE '%pet%'                           THEN 'PETS'
  WHEN category ILIKE '%food%'                          THEN 'OPEN_FOOD'
  WHEN category ILIKE '%pest%' OR category ILIKE '%bug%' THEN 'PESTS'
  WHEN category ILIKE '%flame%' OR category ILIKE '%candle%' THEN 'OPEN_FLAMES'
  WHEN category ILIKE '%appliance%' OR category ILIKE '%kitchen%' THEN 'KITCHEN_APPLIANCES'
  WHEN category ILIKE '%lithium%' OR category ILIKE '%battery%' THEN 'LITHIUM_BATTERIES'
  WHEN category ILIKE '%modif%' OR category ILIKE '%paint%' OR category ILIKE '%hole%' THEN 'MODIFICATIONS'
  WHEN category ILIKE '%drug%'                          THEN 'DRUG_PARAPHERNALIA'
  WHEN category ILIKE '%weapon%'                        THEN 'WEAPONS'
  WHEN category ILIKE '%noise%'                         THEN 'NOISE'
  ELSE 'OTHER'
END
WHERE violation_type IS NULL AND category IS NOT NULL;

-- Create violation_timeline_entries
CREATE TABLE IF NOT EXISTS violation_timeline_entries (
  id             TEXT        PRIMARY KEY,
  violation_id   TEXT        NOT NULL REFERENCES lease_violations(id),
  action_type    TEXT        NOT NULL,
  date           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  method         TEXT,
  notes          TEXT,
  logged_by_id   TEXT,
  logged_by_name TEXT        NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS violation_timeline_entries_violation_id_idx ON violation_timeline_entries(violation_id);

-- Create violation_photos
CREATE TABLE IF NOT EXISTS violation_photos (
  id               TEXT        PRIMARY KEY,
  violation_id     TEXT        NOT NULL REFERENCES lease_violations(id),
  timeline_entry_id TEXT       REFERENCES violation_timeline_entries(id),
  url              TEXT        NOT NULL,
  key              TEXT        NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS violation_photos_violation_id_idx ON violation_photos(violation_id);

-- Seed FLAGGED timeline entries for existing violations (best-effort, idempotent via DO block)
DO $$
DECLARE
  v RECORD;
  new_id TEXT;
BEGIN
  FOR v IN
    SELECT id, created_at, reported_by_id, COALESCE(reported_by_name, 'System') AS reporter
    FROM lease_violations
    WHERE NOT EXISTS (
      SELECT 1 FROM violation_timeline_entries e WHERE e.violation_id = lease_violations.id
    )
    AND deleted_at IS NULL
  LOOP
    new_id := gen_random_uuid()::text;
    INSERT INTO violation_timeline_entries (id, violation_id, action_type, date, logged_by_id, logged_by_name, created_at)
    VALUES (new_id, v.id, 'FLAGGED', v.created_at, v.reported_by_id, v.reporter, v.created_at);
  END LOOP;
END $$;

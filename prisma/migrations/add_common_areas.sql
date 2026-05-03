-- Per-property common-area labels for the resident maintenance flow.
-- Defaults to an empty array; the resident wizard supplies generic
-- fallbacks when no overrides are set.

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS "commonAreas" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

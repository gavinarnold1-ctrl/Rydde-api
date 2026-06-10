-- Migration: Adaptive state — satisfaction scores, task source/category, occupants
-- Run this manually against your Neon database (after 001_add_supplies.sql)

-- 1. Satisfaction check-ins (weekly card + session-start chips)
CREATE TABLE IF NOT EXISTS satisfaction_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
  source TEXT NOT NULL DEFAULT 'weekly' CHECK (source IN ('weekly', 'session')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_satisfaction_household
  ON satisfaction_scores(household_id, created_at DESC);

-- 2. Task provenance: engine-generated vs manually logged
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'engine'
  CHECK (source IN ('engine', 'manual'));

-- Backfill: manual logs were previously marked via engine_version
UPDATE tasks SET source = 'manual' WHERE engine_version = 'manual';

-- 3. Impact-hierarchy category (engine v3 classifies each task it generates)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS category TEXT
  CHECK (category IN ('reset', 'cycle', 'visible', 'hygiene', 'detail'));

-- 4. Occupants — entropy-rate prior for the engine
ALTER TABLE spaces ADD COLUMN IF NOT EXISTS adults INTEGER;
ALTER TABLE spaces ADD COLUMN IF NOT EXISTS kids INTEGER;
ALTER TABLE spaces ADD COLUMN IF NOT EXISTS pets INTEGER;

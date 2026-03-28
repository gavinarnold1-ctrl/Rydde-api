-- Migration: Add supplies table for cleaning inventory
-- Run this manually against your Neon database

CREATE TABLE IF NOT EXISTS supplies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  is_custom BOOLEAN DEFAULT false,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(household_id, name)
);

CREATE INDEX IF NOT EXISTS idx_supplies_household ON supplies(household_id);

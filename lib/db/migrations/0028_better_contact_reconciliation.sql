-- Existing timed_out jobs have already been counted against consumed credits.
-- A null accounting_state preserves that legacy distinction until provider proof
-- permits reconciling them. New jobs use 'reserved' from creation.
ALTER TABLE better_contact_jobs
  ADD COLUMN IF NOT EXISTS accounting_state TEXT;
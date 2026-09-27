-- Applied alongside the Drizzle schema on databases using explicit migrations.
ALTER TABLE social_schedules ADD COLUMN IF NOT EXISTS last_assigned_at TIMESTAMP;
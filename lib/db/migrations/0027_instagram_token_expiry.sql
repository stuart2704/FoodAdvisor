ALTER TABLE social_accounts
  ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ;
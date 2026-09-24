CREATE TABLE IF NOT EXISTS social_accounts (
    id UUID PRIMARY KEY,
    platform TEXT NOT NULL,
    page_id TEXT,
    display_name TEXT,
    access_token TEXT NOT NULL,
    access_token_iv TEXT NOT NULL,
    access_token_tag TEXT NOT NULL,
    refresh_token TEXT,
    restaurant_id TEXT REFERENCES restaurants(place_id),
    status TEXT NOT NULL DEFAULT 'connected',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS social_posts (
    id UUID PRIMARY KEY,
    restaurant_id TEXT REFERENCES restaurants(place_id),
    platform TEXT NOT NULL,
    content TEXT NOT NULL,
    media_url TEXT,
    status TEXT NOT NULL,
    scheduled_for TIMESTAMP,
    published_at TIMESTAMP,
    error_message TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    provider_post_id TEXT,
    idempotency_key TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS social_schedules (
    id UUID PRIMARY KEY,
    restaurant_id TEXT REFERENCES restaurants(place_id),
    platform TEXT NOT NULL,
    frequency TEXT NOT NULL,
    time_of_day TEXT NOT NULL,
    enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS social_logs (
    id UUID PRIMARY KEY,
    post_id UUID,
    account_id UUID,
    restaurant_id TEXT REFERENCES restaurants(place_id),
    platform TEXT NOT NULL,
    event TEXT NOT NULL,
    status TEXT NOT NULL,
    message TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS social_schedule_assignment_unique
  ON social_schedules (COALESCE(restaurant_id, '__brand__'), platform, frequency, time_of_day);
CREATE UNIQUE INDEX IF NOT EXISTS social_posts_idempotency_key_unique
  ON social_posts (idempotency_key);
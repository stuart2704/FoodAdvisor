CREATE TABLE IF NOT EXISTS social_accounts (
    id UUID PRIMARY KEY,
    platform TEXT NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    restaurant_id UUID,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS social_posts (
    id UUID PRIMARY KEY,
    restaurant_id UUID,
    platform TEXT NOT NULL,
    content TEXT NOT NULL,
    media_url TEXT,
    status TEXT NOT NULL,
    scheduled_for TIMESTAMP,
    published_at TIMESTAMP,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS social_schedules (
    id UUID PRIMARY KEY,
    restaurant_id UUID,
    platform TEXT NOT NULL,
    frequency TEXT NOT NULL,
    time_of_day TEXT NOT NULL,
    enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
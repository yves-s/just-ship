-- Telegram bot user state (active workspace + pending ticket data)
CREATE TABLE IF NOT EXISTS telegram_bot_state (
  chat_id BIGINT PRIMARY KEY,
  active_workspace_id TEXT,
  pending_data JSONB,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Media group photo buffer (for multiple photos sent together)
CREATE TABLE IF NOT EXISTS telegram_media_group_buffer (
  media_group_id TEXT PRIMARY KEY,
  chat_id BIGINT NOT NULL,
  file_ids TEXT[] NOT NULL DEFAULT '{}',
  caption TEXT,
  processed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS (defense-in-depth; Edge Function uses service_role_key so RLS is bypassed)
ALTER TABLE telegram_bot_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_media_group_buffer ENABLE ROW LEVEL SECURITY;

-- Policies allow service role full access (used by Edge Function)
-- No public policies needed (all access via authenticated Edge Function)
CREATE POLICY "service_role_full_access" ON telegram_bot_state
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "service_role_full_access" ON telegram_media_group_buffer
  FOR ALL USING (true) WITH CHECK (true);

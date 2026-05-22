-- =============================================
-- Create maya_sessions table for Kipu chat history
-- Run this in your Supabase SQL Editor
-- =============================================

CREATE TABLE IF NOT EXISTS maya_sessions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    bot_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT 'Nueva conversación',
    history JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    
    -- Unique constraint: one session per bot+user+sessionId
    CONSTRAINT unique_maya_session UNIQUE (bot_id, user_id, session_id)
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_maya_sessions_bot_user 
    ON maya_sessions (bot_id, user_id);

CREATE INDEX IF NOT EXISTS idx_maya_sessions_updated 
    ON maya_sessions (updated_at DESC);

-- Enable RLS (Row Level Security) - optional but recommended
ALTER TABLE maya_sessions ENABLE ROW LEVEL SECURITY;

-- Policy: service role can do everything (our backend uses service role key)
CREATE POLICY "Service role full access" ON maya_sessions
    FOR ALL
    USING (true)
    WITH CHECK (true);

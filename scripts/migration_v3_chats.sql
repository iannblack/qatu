-- =============================================
-- KIPU Migration v3 — WhatsApp Chats Section
-- Run this in Supabase SQL Editor
-- =============================================

-- 1. WA_MESSAGES — stores ALL WhatsApp messages
CREATE TABLE IF NOT EXISTS wa_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bot_id TEXT NOT NULL,
    chat_jid TEXT NOT NULL,
    message_id TEXT NOT NULL,
    from_me BOOLEAN NOT NULL DEFAULT FALSE,
    sender_jid TEXT,
    content TEXT,
    message_type TEXT DEFAULT 'text',
    media_url TEXT,
    quoted_message_id TEXT,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status TEXT DEFAULT 'sent',
    raw_key JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_wa_msg UNIQUE(bot_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_wam_chat ON wa_messages(bot_id, chat_jid, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_wam_ts ON wa_messages(bot_id, timestamp DESC);

ALTER TABLE wa_messages ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY "service_wam" ON wa_messages FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. WA_CHATS — denormalized chat list
CREATE TABLE IF NOT EXISTS wa_chats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bot_id TEXT NOT NULL,
    chat_jid TEXT NOT NULL,
    chat_name TEXT,
    phone_number TEXT,
    is_group BOOLEAN DEFAULT FALSE,
    last_message TEXT,
    last_message_at TIMESTAMPTZ,
    last_message_from_me BOOLEAN DEFAULT FALSE,
    unread_count INTEGER DEFAULT 0,
    is_bot_paused BOOLEAN DEFAULT FALSE,
    pinned BOOLEAN DEFAULT FALSE,
    archived BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_wa_chat UNIQUE(bot_id, chat_jid)
);

CREATE INDEX IF NOT EXISTS idx_wac_list ON wa_chats(bot_id, archived, last_message_at DESC);

ALTER TABLE wa_chats ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY "service_wac" ON wa_chats FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 3. WA_CONTACTS — persistent contact names
CREATE TABLE IF NOT EXISTS wa_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bot_id TEXT NOT NULL,
    jid TEXT NOT NULL,
    phone_number TEXT,
    push_name TEXT,
    verified_name TEXT,
    profile_pic_url TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_wa_contact UNIQUE(bot_id, jid)
);

ALTER TABLE wa_contacts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY "service_wacon" ON wa_contacts FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ═══════════════════════════════════════════════════════════════════════
-- Migration: Add Meta Cloud API columns to bot_configs
-- Date: 2026-05-20
-- Context: Provider abstraction — cada tienda puede elegir su transporte
--          de mensajería: Baileys (default) o Meta Cloud API (oficial).
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE bot_configs
    ADD COLUMN IF NOT EXISTS messaging_provider TEXT DEFAULT 'baileys',
    ADD COLUMN IF NOT EXISTS meta_phone_number_id TEXT,
    ADD COLUMN IF NOT EXISTS meta_access_token TEXT,
    ADD COLUMN IF NOT EXISTS meta_waba_id TEXT,
    ADD COLUMN IF NOT EXISTS meta_connected BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS meta_connected_at TIMESTAMPTZ;

-- Index para que el webhook handler resuelva el bot por phone_number_id
-- en O(log n) en vez de full table scan. Critical para latencia <100ms.
CREATE INDEX IF NOT EXISTS idx_bot_configs_meta_phone_number_id
    ON bot_configs (meta_phone_number_id)
    WHERE meta_phone_number_id IS NOT NULL;

-- Constraint: si messaging_provider = 'meta', meta_phone_number_id NO null.
-- Soft constraint vía CHECK — Supabase permite NULL hasta que se setea.
ALTER TABLE bot_configs
    DROP CONSTRAINT IF EXISTS bot_configs_meta_provider_requires_phone_id;
ALTER TABLE bot_configs
    ADD CONSTRAINT bot_configs_meta_provider_requires_phone_id
    CHECK (
        messaging_provider != 'meta'
        OR meta_phone_number_id IS NOT NULL
    );

COMMENT ON COLUMN bot_configs.messaging_provider IS
    'WhatsApp transport: baileys (unofficial multi-device) | meta (Cloud API official).';
COMMENT ON COLUMN bot_configs.meta_phone_number_id IS
    'Meta Cloud API: numeric phone number ID (not the phone itself).';
COMMENT ON COLUMN bot_configs.meta_access_token IS
    'Meta Cloud API: System User permanent token with whatsapp_business_messaging scope.';
COMMENT ON COLUMN bot_configs.meta_waba_id IS
    'Meta Cloud API: WhatsApp Business Account ID (audit, not used in send path).';

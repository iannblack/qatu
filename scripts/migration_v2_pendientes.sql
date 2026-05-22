-- =============================================
-- KIPU Migration v2 — Complete Schema
-- Run this in Supabase SQL Editor
-- Safe to re-run (uses IF NOT EXISTS everywhere)
-- Date: 2026-04-17
-- =============================================

-- ═══════════════════════════════════════════════
-- 1. LEARNED_KNOWLEDGE
-- ═══════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS learned_knowledge (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    bot_id TEXT NOT NULL,
    tipo TEXT NOT NULL DEFAULT 'otro',
    pregunta TEXT,
    respuesta TEXT,
    resumen TEXT,
    status TEXT NOT NULL DEFAULT 'pending_confirmation',
    source_phone TEXT,
    confirmed_at TIMESTAMPTZ,
    rejected_at TIMESTAMPTZ,
    rejected_by TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lk_bot ON learned_knowledge (bot_id);
CREATE INDEX IF NOT EXISTS idx_lk_bot_status ON learned_knowledge (bot_id, status);

ALTER TABLE learned_knowledge ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY "service_lk" ON learned_knowledge FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ═══════════════════════════════════════════════
-- 2. POSTVENTA_TICKETS
-- ═══════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS postventa_tickets (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    bot_id TEXT NOT NULL,
    order_id TEXT,
    order_code TEXT,
    phone TEXT,
    customer_name TEXT,
    producto TEXT,
    estado_ticket TEXT DEFAULT 'vencido',
    ventana_reclamo_hasta TIMESTAMPTZ,
    tipo_caso TEXT,
    solucion_aplicada TEXT,
    fecha_solucion TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pv_bot ON postventa_tickets (bot_id);

ALTER TABLE postventa_tickets ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY "service_pv" ON postventa_tickets FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ═══════════════════════════════════════════════
-- 3. NOTIFICATIONS — add missing columns
-- Fields used by code: bot_id, user_id, type, title, message, data (jsonb), is_read, resolved_action, resolved_at, created_at
-- ═══════════════════════════════════════════════

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS resolved_action TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

-- ═══════════════════════════════════════════════
-- 4. BUSINESS_INFO — add missing columns
-- ═══════════════════════════════════════════════

ALTER TABLE business_info ADD COLUMN IF NOT EXISTS payment_methods_structured JSONB DEFAULT '[]'::jsonb;
ALTER TABLE business_info ADD COLUMN IF NOT EXISTS shipping_config JSONB;
ALTER TABLE business_info ADD COLUMN IF NOT EXISTS learned_faqs JSONB DEFAULT '[]'::jsonb;

-- ═══════════════════════════════════════════════
-- 5. ORDERS — add missing columns for partial payments + delivery spec
-- ═══════════════════════════════════════════════

ALTER TABLE orders ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pago_pendiente';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_code TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS bot_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_name TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_last_name TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_phone TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS items TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS total NUMERIC DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS monto_pagado NUMERIC DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS monto_pendiente NUMERIC DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_cost NUMERIC DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS especificacion_recojo TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS no_spec_confirmed BOOLEAN DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS fecha_pago TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS estado_envio TEXT DEFAULT 'por_crear';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_number TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS timestamp TIMESTAMPTZ DEFAULT now();
ALTER TABLE orders ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- ═══════════════════════════════════════════════
-- 6. LEADS — ensure updated_at exists for 48h expiry cron
-- ═══════════════════════════════════════════════

ALTER TABLE leads ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- ═══════════════════════════════════════════════
-- 7. BOT_CONFIGS — ensure metadata column exists
-- ═══════════════════════════════════════════════

ALTER TABLE bot_configs ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

-- ═══════════════════════════════════════════════
-- 8. CHAT_HISTORY — ensure history jsonb column exists
-- ═══════════════════════════════════════════════

ALTER TABLE chat_history ADD COLUMN IF NOT EXISTS history JSONB DEFAULT '[]'::jsonb;
ALTER TABLE chat_history ADD COLUMN IF NOT EXISTS needs_follow_up BOOLEAN DEFAULT false;
ALTER TABLE chat_history ADD COLUMN IF NOT EXISTS bot_paused BOOLEAN DEFAULT false;
ALTER TABLE chat_history ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ;
ALTER TABLE chat_history ADD COLUMN IF NOT EXISTS pause_reason TEXT;

-- ═══════════════════════════════════════════════
-- 9. MAYA_SESSIONS (if not already created)
-- ═══════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS maya_sessions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    bot_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT 'Nueva conversación',
    history JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT unique_maya_session UNIQUE (bot_id, user_id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_ms_bot_user ON maya_sessions (bot_id, user_id);
CREATE INDEX IF NOT EXISTS idx_ms_updated ON maya_sessions (updated_at DESC);

ALTER TABLE maya_sessions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY "service_ms" ON maya_sessions FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ═══════════════════════════════════════════════
-- 10. CADENCES — ensure columns exist
-- ═══════════════════════════════════════════════

ALTER TABLE cadences ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'ACTIVE';
ALTER TABLE cadences ADD COLUMN IF NOT EXISTS steps JSONB DEFAULT '[]'::jsonb;
ALTER TABLE cadences ADD COLUMN IF NOT EXISTS current_step_index INTEGER DEFAULT 0;

-- ═══════════════════════════════════════════════
-- VERIFY (run these queries to check)
-- ═══════════════════════════════════════════════

-- SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'notifications' ORDER BY ordinal_position;
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'orders' ORDER BY ordinal_position;
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'learned_knowledge' ORDER BY ordinal_position;
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'business_info' AND column_name IN ('payment_methods_structured', 'shipping_config', 'learned_faqs');

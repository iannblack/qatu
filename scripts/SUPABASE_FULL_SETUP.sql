-- =================================================================
-- KIPU / MAYA — Supabase Full Setup (idempotente)
-- Aplicalo entero en el SQL Editor de Supabase.
-- Todo usa IF NOT EXISTS → se puede re-correr las veces que quieras.
-- Orden: extensiones → tablas base → columnas extra → índices → RLS.
-- =================================================================

-- ═══════════════════════════════════════════════
-- 0. EXTENSIONES
-- ═══════════════════════════════════════════════
CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- gen_random_uuid()

-- ═══════════════════════════════════════════════
-- 1. USERS
-- ═══════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS users (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password TEXT,
    name TEXT,
    phone TEXT,
    plan TEXT DEFAULT 'free',
    tutorial_shown BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS tutorial_shown BOOLEAN DEFAULT FALSE;

-- ═══════════════════════════════════════════════
-- 2. BOT_CONFIGS
-- ═══════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS bot_configs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id TEXT NOT NULL,
    bot_name TEXT,
    system_prompt TEXT,
    phone_number TEXT,
    owner_phone TEXT,
    advanced_config JSONB DEFAULT '{}'::jsonb,
    metadata JSONB DEFAULT '{}'::jsonb,
    tienda JSONB DEFAULT '{}'::jsonb,
    operacion JSONB DEFAULT '{}'::jsonb,
    kapso_phone_number_id TEXT,
    products JSONB DEFAULT '[]'::jsonb,
    categoria_config JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);
ALTER TABLE bot_configs ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
ALTER TABLE bot_configs ADD COLUMN IF NOT EXISTS advanced_config JSONB DEFAULT '{}'::jsonb;
ALTER TABLE bot_configs ADD COLUMN IF NOT EXISTS operacion JSONB DEFAULT '{}'::jsonb;
ALTER TABLE bot_configs ADD COLUMN IF NOT EXISTS tienda JSONB DEFAULT '{}'::jsonb;
ALTER TABLE bot_configs ADD COLUMN IF NOT EXISTS products JSONB DEFAULT '[]'::jsonb;
ALTER TABLE bot_configs ADD COLUMN IF NOT EXISTS categoria_config JSONB DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_bc_user ON bot_configs (user_id);

-- ═══════════════════════════════════════════════
-- 3. BUSINESS_INFO
-- ═══════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS business_info (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    bot_id TEXT NOT NULL,
    business_name TEXT,
    products JSONB DEFAULT '[]'::jsonb,
    payment_methods TEXT,
    payment_methods_structured JSONB DEFAULT '[]'::jsonb,
    shipping_config JSONB,
    learned_faqs JSONB DEFAULT '[]'::jsonb,
    base_conocimiento JSONB DEFAULT '{}'::jsonb,
    handoff_config JSONB DEFAULT '{}'::jsonb,
    pagos_parciales BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE business_info ADD COLUMN IF NOT EXISTS payment_methods_structured JSONB DEFAULT '[]'::jsonb;
ALTER TABLE business_info ADD COLUMN IF NOT EXISTS shipping_config JSONB;
ALTER TABLE business_info ADD COLUMN IF NOT EXISTS learned_faqs JSONB DEFAULT '[]'::jsonb;
ALTER TABLE business_info ADD COLUMN IF NOT EXISTS base_conocimiento JSONB DEFAULT '{}'::jsonb;
ALTER TABLE business_info ADD COLUMN IF NOT EXISTS handoff_config JSONB DEFAULT '{}'::jsonb;
ALTER TABLE business_info ADD COLUMN IF NOT EXISTS pagos_parciales BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_bi_bot ON business_info (bot_id);

-- ═══════════════════════════════════════════════
-- 4. LEADS — tabla principal del CRM
-- ═══════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS leads (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    bot_id TEXT NOT NULL,
    phone TEXT NOT NULL,
    channel TEXT DEFAULT 'whatsapp',
    contact_name TEXT,
    last_message TEXT,
    lead_score INTEGER DEFAULT 0,
    score_level TEXT DEFAULT 'FRIO',
    score_signals JSONB DEFAULT '[]'::jsonb,
    score_objections JSONB DEFAULT '[]'::jsonb,
    etapa_pipeline TEXT DEFAULT 'exploracion',
    temperatura_lead TEXT DEFAULT 'tibio',
    temperatura TEXT DEFAULT 'tibio',
    estado_clasificacion TEXT DEFAULT 'lead_nuevo',
    confianza_clasificacion TEXT DEFAULT 'baja',
    ticket_id TEXT,
    escalado_humano BOOLEAN DEFAULT FALSE,
    estado_conversacion TEXT DEFAULT 'abierta',
    consulta_inicial TEXT,
    comentarios TEXT DEFAULT '-',
    motivo_escalacion TEXT,
    motivo_perdida TEXT DEFAULT '-',
    motivo_no_compra TEXT DEFAULT '-',
    valor_potencial TEXT DEFAULT '-',
    producto_interes TEXT DEFAULT '-',
    sentimiento TEXT DEFAULT 'neutro',
    num_mensajes INTEGER DEFAULT 0,
    duracion_ciclo_horas TEXT DEFAULT '-',
    analysis JSONB,
    datos_extraidos JSONB DEFAULT '{}'::jsonb,
    accion_requerida TEXT DEFAULT 'actualizar_crm',
    tipo_caso TEXT,
    subtipo TEXT,
    estado_resolucion TEXT,
    cadence_opt_out BOOLEAN DEFAULT FALSE,
    needs_follow_up BOOLEAN DEFAULT FALSE,
    deleted BOOLEAN DEFAULT FALSE,
    archived BOOLEAN DEFAULT FALSE,
    enriched_phone JSONB,
    health_score INTEGER,
    order_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_interaction TIMESTAMPTZ,
    CONSTRAINT unique_lead UNIQUE (bot_id, phone)
);

-- Columnas idempotentes (por si la tabla ya existía sin alguna)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS channel TEXT DEFAULT 'whatsapp';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS contact_name TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_message TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS lead_score INTEGER DEFAULT 0;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS score_level TEXT DEFAULT 'FRIO';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS score_signals JSONB DEFAULT '[]'::jsonb;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS score_objections JSONB DEFAULT '[]'::jsonb;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS etapa_pipeline TEXT DEFAULT 'exploracion';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS temperatura_lead TEXT DEFAULT 'tibio';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS temperatura TEXT DEFAULT 'tibio';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS estado_clasificacion TEXT DEFAULT 'lead_nuevo';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS confianza_clasificacion TEXT DEFAULT 'baja';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ticket_id TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS escalado_humano BOOLEAN DEFAULT FALSE;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS estado_conversacion TEXT DEFAULT 'abierta';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS consulta_inicial TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS comentarios TEXT DEFAULT '-';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS motivo_escalacion TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS motivo_perdida TEXT DEFAULT '-';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS motivo_no_compra TEXT DEFAULT '-';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS valor_potencial TEXT DEFAULT '-';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS producto_interes TEXT DEFAULT '-';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS sentimiento TEXT DEFAULT 'neutro';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS num_mensajes INTEGER DEFAULT 0;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS duracion_ciclo_horas TEXT DEFAULT '-';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS analysis JSONB;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS datos_extraidos JSONB DEFAULT '{}'::jsonb;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS accion_requerida TEXT DEFAULT 'actualizar_crm';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS tipo_caso TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS subtipo TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS estado_resolucion TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS cadence_opt_out BOOLEAN DEFAULT FALSE;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS needs_follow_up BOOLEAN DEFAULT FALSE;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS deleted BOOLEAN DEFAULT FALSE;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT FALSE;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS enriched_phone JSONB;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS health_score INTEGER;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS order_id TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE leads ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_interaction TIMESTAMPTZ;

-- Forzar defaults "sanos" en filas viejas (para que $ne:true funcione bien)
UPDATE leads SET deleted = FALSE WHERE deleted IS NULL;
UPDATE leads SET archived = FALSE WHERE archived IS NULL;
UPDATE leads SET estado_clasificacion = 'lead_nuevo' WHERE estado_clasificacion IS NULL;

CREATE INDEX IF NOT EXISTS idx_leads_bot ON leads (bot_id);
CREATE INDEX IF NOT EXISTS idx_leads_bot_phone ON leads (bot_id, phone);
CREATE INDEX IF NOT EXISTS idx_leads_bot_updated ON leads (bot_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_pipeline ON leads (bot_id, etapa_pipeline);

-- ═══════════════════════════════════════════════
-- 5. ORDERS
-- ═══════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS orders (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    bot_id TEXT NOT NULL,
    phone TEXT,
    customer_name TEXT,
    customer_last_name TEXT,
    customer_phone TEXT,
    dni TEXT,
    items TEXT,
    products JSONB DEFAULT '[]'::jsonb,
    cantidad_total INTEGER DEFAULT 0,
    total NUMERIC DEFAULT 0,
    monto_pagado NUMERIC DEFAULT 0,
    monto_pendiente NUMERIC DEFAULT 0,
    status TEXT DEFAULT 'pago_pendiente',
    estado_envio TEXT DEFAULT 'por_crear',
    order_code TEXT,
    tracking_number TEXT,
    especificacion_recojo TEXT,
    no_spec_confirmed BOOLEAN DEFAULT FALSE,
    fecha_pago TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    archived BOOLEAN DEFAULT FALSE,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pago_pendiente';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_code TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS bot_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_name TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_last_name TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_phone TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS dni TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS items TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS products JSONB DEFAULT '[]'::jsonb;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cantidad_total INTEGER DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS total NUMERIC DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS monto_pagado NUMERIC DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS monto_pendiente NUMERIC DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_cost NUMERIC DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS especificacion_recojo TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS no_spec_confirmed BOOLEAN DEFAULT FALSE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS fecha_pago TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS estado_envio TEXT DEFAULT 'por_crear';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_number TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT FALSE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS timestamp TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE orders ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

UPDATE orders SET archived = FALSE WHERE archived IS NULL;

CREATE INDEX IF NOT EXISTS idx_orders_bot ON orders (bot_id);
CREATE INDEX IF NOT EXISTS idx_orders_bot_phone ON orders (bot_id, phone);
CREATE INDEX IF NOT EXISTS idx_orders_bot_status ON orders (bot_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_bot_envio ON orders (bot_id, estado_envio);
CREATE INDEX IF NOT EXISTS idx_orders_bot_ts ON orders (bot_id, timestamp DESC);

-- ═══════════════════════════════════════════════
-- 6. NOTIFICATIONS
-- ═══════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS notifications (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    bot_id TEXT NOT NULL,
    user_id TEXT,
    type TEXT NOT NULL,
    title TEXT,
    message TEXT,
    data JSONB DEFAULT '{}'::jsonb,
    is_read BOOLEAN DEFAULT FALSE,
    read BOOLEAN DEFAULT FALSE,
    resolved_action TEXT,
    resolved_at TIMESTAMPTZ,
    lead_phone TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS resolved_action TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS lead_phone TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read BOOLEAN DEFAULT FALSE;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_notif_bot ON notifications (bot_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_bot_type ON notifications (bot_id, type);

-- ═══════════════════════════════════════════════
-- 7. CHAT_HISTORY
-- ═══════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS chat_history (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    key TEXT UNIQUE NOT NULL,
    history JSONB DEFAULT '[]'::jsonb,
    needs_follow_up BOOLEAN DEFAULT FALSE,
    bot_paused BOOLEAN DEFAULT FALSE,
    paused_at TIMESTAMPTZ,
    pause_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE chat_history ADD COLUMN IF NOT EXISTS history JSONB DEFAULT '[]'::jsonb;
ALTER TABLE chat_history ADD COLUMN IF NOT EXISTS needs_follow_up BOOLEAN DEFAULT FALSE;
ALTER TABLE chat_history ADD COLUMN IF NOT EXISTS bot_paused BOOLEAN DEFAULT FALSE;
ALTER TABLE chat_history ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ;
ALTER TABLE chat_history ADD COLUMN IF NOT EXISTS pause_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_ch_key ON chat_history (key);

-- ═══════════════════════════════════════════════
-- 8. CADENCES (follow-up scheduler)
-- ═══════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS cadences (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    bot_id TEXT NOT NULL,
    phone TEXT,
    channel TEXT DEFAULT 'whatsapp',
    type TEXT,
    status TEXT DEFAULT 'ACTIVE',
    steps JSONB DEFAULT '[]'::jsonb,
    current_step_index INTEGER DEFAULT 0,
    score_at_creation INTEGER,
    product_context TEXT,
    product_category TEXT,
    is_from_ad BOOLEAN DEFAULT FALSE,
    order_data JSONB,
    last_lead_message_at TIMESTAMPTZ,
    reactivation_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE cadences ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'ACTIVE';
ALTER TABLE cadences ADD COLUMN IF NOT EXISTS steps JSONB DEFAULT '[]'::jsonb;
ALTER TABLE cadences ADD COLUMN IF NOT EXISTS current_step_index INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_cad_bot_phone ON cadences (bot_id, phone);

-- ═══════════════════════════════════════════════
-- 9. CONVERSATIONS (analytics raw)
-- ═══════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS conversations (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    bot_id TEXT NOT NULL,
    phone TEXT,
    user_message TEXT,
    bot_response TEXT,
    response_time_ms INTEGER,
    had_fallback BOOLEAN DEFAULT FALSE,
    channel TEXT DEFAULT 'whatsapp',
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conv_bot_ts ON conversations (bot_id, timestamp DESC);

-- ═══════════════════════════════════════════════
-- 10. ALERTS_LOG
-- ═══════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS alerts_log (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    bot_id TEXT NOT NULL,
    type TEXT,
    message TEXT,
    lead_phone TEXT,
    read BOOLEAN DEFAULT FALSE,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE alerts_log ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;

-- ═══════════════════════════════════════════════
-- 11. LEARNED_KNOWLEDGE (sistema de aprendizaje)
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
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lk_bot ON learned_knowledge (bot_id);
CREATE INDEX IF NOT EXISTS idx_lk_bot_status ON learned_knowledge (bot_id, status);

-- ═══════════════════════════════════════════════
-- 12. POSTVENTA_TICKETS
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
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pv_bot ON postventa_tickets (bot_id);

-- ═══════════════════════════════════════════════
-- 13. MAYA_SESSIONS (historial del chat interno de Maya)
-- ═══════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS maya_sessions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    bot_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT 'Nueva conversación',
    history JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_maya_session UNIQUE (bot_id, user_id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_ms_bot_user ON maya_sessions (bot_id, user_id);
CREATE INDEX IF NOT EXISTS idx_ms_updated ON maya_sessions (updated_at DESC);

-- ═══════════════════════════════════════════════
-- 14. WA_MESSAGES (sección Chats — todos los mensajes)
-- ═══════════════════════════════════════════════
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

CREATE INDEX IF NOT EXISTS idx_wam_chat ON wa_messages (bot_id, chat_jid, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_wam_ts ON wa_messages (bot_id, timestamp DESC);

-- ═══════════════════════════════════════════════
-- 15. WA_CHATS (lista de chats denormalizada)
-- ═══════════════════════════════════════════════
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
    archived_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_wa_chat UNIQUE(bot_id, chat_jid)
);

ALTER TABLE wa_chats ADD COLUMN IF NOT EXISTS archived_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_wac_list ON wa_chats (bot_id, archived, last_message_at DESC);

-- ═══════════════════════════════════════════════
-- 16. WA_CONTACTS (nombres persistentes)
-- ═══════════════════════════════════════════════
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

-- ═══════════════════════════════════════════════
-- 17. SCHEDULED_MESSAGES (cron de cadencias)
-- ═══════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS scheduled_messages (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    bot_id TEXT NOT NULL,
    phone TEXT,
    channel TEXT DEFAULT 'whatsapp',
    message TEXT,
    scheduled_for TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sm_pending ON scheduled_messages (status, scheduled_for);

-- ═══════════════════════════════════════════════
-- 18. ROW LEVEL SECURITY — abrir a service role
-- ═══════════════════════════════════════════════

DO $$ BEGIN
    ALTER TABLE users ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "service_users" ON users FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE bot_configs ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "service_bc" ON bot_configs FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE business_info ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "service_bi" ON business_info FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "service_leads" ON leads FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "service_orders" ON orders FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "service_notif" ON notifications FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE chat_history ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "service_ch" ON chat_history FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE cadences ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "service_cad" ON cadences FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "service_conv" ON conversations FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE alerts_log ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "service_al" ON alerts_log FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE learned_knowledge ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "service_lk" ON learned_knowledge FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE postventa_tickets ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "service_pv" ON postventa_tickets FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE maya_sessions ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "service_ms" ON maya_sessions FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE wa_messages ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "service_wam" ON wa_messages FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE wa_chats ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "service_wac" ON wa_chats FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE wa_contacts ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "service_wacon" ON wa_contacts FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE scheduled_messages ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "service_sm" ON scheduled_messages FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ═══════════════════════════════════════════════
-- 19. VERIFICACIÓN
-- ═══════════════════════════════════════════════
-- Corré esto para verificar que todo está en orden:
--
-- SELECT table_name FROM information_schema.tables
--  WHERE table_schema = 'public'
--  ORDER BY table_name;
--
-- SELECT column_name, data_type, column_default
--   FROM information_schema.columns
--  WHERE table_name = 'leads'
--  ORDER BY ordinal_position;
--
-- SELECT column_name, data_type, column_default
--   FROM information_schema.columns
--  WHERE table_name = 'orders'
--  ORDER BY ordinal_position;
--
-- SELECT COUNT(*) FROM leads WHERE deleted IS NOT NULL;
-- SELECT COUNT(*) FROM leads WHERE archived IS NOT NULL;

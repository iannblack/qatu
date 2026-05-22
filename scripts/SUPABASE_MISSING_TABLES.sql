-- =================================================================
-- KIPU — Tablas que el código usa pero no estaban creadas
-- Ejecutar en Supabase SQL Editor (Dashboard > SQL Editor > New Query)
-- IDEMPOTENTE: se puede correr múltiples veces sin romper nada.
-- =================================================================
-- Este script complementa SUPABASE_FULL_SETUP.sql con tres tablas que
-- el código referencia pero no estaban incluidas en el setup base:
--
--   1. crm_tickets       → mapeo phone+bot_id → KBR-xxxxx
--   2. cleanup_exports   → snapshot del cron quincenal de limpieza
--   3. processed_webhooks → dedupe de webhooks de Kapso por message_id
-- =================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ═══════════════════════════════════════════════
-- 1. CRM_TICKETS
-- ═══════════════════════════════════════════════
-- Persiste el ticket KBR-xxxxx que ve el emprendedor en el CRM, asociado
-- al teléfono normalizado del cliente y al bot. routes.ts:4615+ inserta
-- una fila por (phone, bot_id) la primera vez que se genera el ticket
-- y lo reusa en llamadas siguientes.
--
-- Nota de mapeo (db.service.ts FIELD_MAP):
--   nombre  (Mongo) → name        (columna)
--   from    (Mongo) → phone       (columna)
--   botId   (Mongo) → bot_id      (columna)

CREATE TABLE IF NOT EXISTS crm_tickets (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    ticket TEXT NOT NULL,
    phone TEXT NOT NULL,
    name TEXT,
    bot_id TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_crm_ticket UNIQUE (bot_id, phone)
);

CREATE INDEX IF NOT EXISTS idx_crm_tickets_bot ON crm_tickets (bot_id);
CREATE INDEX IF NOT EXISTS idx_crm_tickets_ticket ON crm_tickets (ticket);

DO $$ BEGIN
    ALTER TABLE crm_tickets ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "service_crm_tickets" ON crm_tickets FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ═══════════════════════════════════════════════
-- 2. CLEANUP_EXPORTS
-- ═══════════════════════════════════════════════
-- Cada 14 días el cron de routes.ts:5575+ recolecta tickets vencidos
-- (leads ganados/perdidos/vencidos, orders completadas/canceladas,
-- postventa fuera de ventana de reclamo) y guarda un snapshot JSONB
-- antes de borrarlos de las tablas principales. El emprendedor descarga
-- el respaldo como Excel desde el panel.
--
-- Nota: leads_data/orders_data/postventa_data son arrays de las filas
-- originales en JSONB para reconstruir el Excel a demanda.

CREATE TABLE IF NOT EXISTS cleanup_exports (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    bot_id TEXT NOT NULL,
    period_from TIMESTAMPTZ,
    period_to TIMESTAMPTZ,
    leads_count INTEGER DEFAULT 0,
    orders_count INTEGER DEFAULT 0,
    postventa_count INTEGER DEFAULT 0,
    leads_data JSONB DEFAULT '[]'::jsonb,
    orders_data JSONB DEFAULT '[]'::jsonb,
    postventa_data JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cleanup_exports_bot
    ON cleanup_exports (bot_id, created_at DESC);

DO $$ BEGIN
    ALTER TABLE cleanup_exports ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "service_cleanup_exports" ON cleanup_exports FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ═══════════════════════════════════════════════
-- 3. PROCESSED_WEBHOOKS
-- ═══════════════════════════════════════════════
-- Deduplicación de webhooks de Kapso. Cada vez que llega un webhook,
-- el handler insert-or-fail por message_id; si ya existe, ignora el
-- request (Kapso reentrega webhooks ante timeouts).
--
-- IMPORTANTE: la columna se llama `message_id` (no `id`) porque
-- db.service.ts:288 hace `delete mapped.id` antes de insertar
-- (asume que `id` siempre es UUID auto-generado). Sin esto, el
-- message id provisto por el caller se descartaba silenciosamente
-- y la dedupe nunca matcheaba.
--
-- El código en src/api/kapso.webhook.ts debe llamar:
--     .findOne({ messageId: msgIdToLock })
--     .insertOne({ messageId: msgIdToLock, createdAt: new Date() })
-- (Mongo→snake mapping en FIELD_MAP: messageId → message_id)

CREATE TABLE IF NOT EXISTS processed_webhooks (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    message_id TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_processed_webhook UNIQUE (message_id)
);

CREATE INDEX IF NOT EXISTS idx_processed_webhooks_msg
    ON processed_webhooks (message_id);
CREATE INDEX IF NOT EXISTS idx_processed_webhooks_created
    ON processed_webhooks (created_at);

DO $$ BEGIN
    ALTER TABLE processed_webhooks ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "service_processed_webhooks" ON processed_webhooks FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Limpieza automática: webhooks > 7 días no aportan a la dedupe
-- (Kapso no reentrega después de minutos). Función opcional para
-- agendar via pg_cron o llamar manualmente.
CREATE OR REPLACE FUNCTION cleanup_old_processed_webhooks()
RETURNS void AS $$
BEGIN
    DELETE FROM processed_webhooks
    WHERE created_at < NOW() - INTERVAL '7 days';
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════
-- 4. VERIFICACIÓN
-- ═══════════════════════════════════════════════
DO $$
DECLARE
    required_tables TEXT[] := ARRAY['crm_tickets', 'cleanup_exports', 'processed_webhooks'];
    tbl TEXT;
    missing TEXT[] := ARRAY[]::TEXT[];
BEGIN
    FOREACH tbl IN ARRAY required_tables LOOP
        IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                       WHERE table_schema = 'public' AND table_name = tbl) THEN
            missing := array_append(missing, tbl);
        END IF;
    END LOOP;

    IF array_length(missing, 1) IS NOT NULL THEN
        RAISE EXCEPTION 'Faltan tablas: %', missing;
    ELSE
        RAISE NOTICE 'OK: crm_tickets, cleanup_exports, processed_webhooks creadas.';
    END IF;
END
$$;

SELECT
    table_name,
    (SELECT COUNT(*) FROM information_schema.columns c
        WHERE c.table_schema = 'public' AND c.table_name = t.table_name) AS columns
FROM (VALUES ('crm_tickets'), ('cleanup_exports'), ('processed_webhooks')) AS t(table_name);

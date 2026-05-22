-- =================================================================
-- KIPU — Migración Supabase para soportar el workflow completo
-- Ejecutar en Supabase SQL Editor (Dashboard > SQL Editor > New Query)
-- IDEMPOTENTE: se puede correr múltiples veces sin romper nada.
-- =================================================================
-- Este script asume que YA corriste:
--   • scripts/SUPABASE_FULL_SETUP.sql        (esquema base completo)
--   • supabase_profile_g_e1.sql              (bucket profile-photos + cols users)
-- y solo agrega lo que falta para el workflow nuevo:
--   1. Columnas pickup_* y ready_for_pickup_at en `orders` (PASO 11)
--   2. Defaults sanos para campos críticos del flujo
--   3. Verificación de tablas requeridas
-- =================================================================

-- ═══════════════════════════════════════════════
-- 0. EXTENSIONES (idempotente)
-- ═══════════════════════════════════════════════
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ═══════════════════════════════════════════════
-- 1. ORDERS — columnas nuevas para Recojo en tienda (PASO 11)
-- ═══════════════════════════════════════════════
-- pickup_address / pickup_hours: copiados desde la sucursal seleccionada al
-- crear la orden, así el mensaje "listo para recojo" sale completo aunque
-- después se cambie la config de envíos.
-- ready_for_pickup_at: timestamp del momento en que el emprendedor marca
-- la orden como "listo_recojo" desde el panel.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_address TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_hours TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ready_for_pickup_at TIMESTAMPTZ;

-- Asegurar que estado_envio acepte el nuevo valor 'listo_recojo'.
-- La columna es TEXT sin CHECK constraint, así que no requiere alteración.
-- Solo dejamos un comentario informativo en el catálogo.
COMMENT ON COLUMN orders.estado_envio IS
    'Estados válidos: por_crear | creado | empacado | en_transito | en_camino | listo_recojo | entregado';

-- ═══════════════════════════════════════════════
-- 2. NOTIFICATIONS — comentario sobre tipos válidos
-- ═══════════════════════════════════════════════
-- Tipos que el flujo nuevo emite a la tabla notifications:
--   • HANDOFF             → bandeja "Derivación Humana"
--   • PAYMENT             → bandeja "Pagos" (PAYMENT_RECEIPT del bot)
--   • SHIPPING_QUOTE      → bandeja "Tarifas Variables"
--   • LEARNING_PROPOSAL   → propuesta de aprendizaje desde chat manual
-- La columna es TEXT sin constraint, no requiere ALTER.

COMMENT ON COLUMN notifications.type IS
    'Tipos: HANDOFF | PAYMENT | SHIPPING_QUOTE | LEARNING_PROPOSAL';

-- ═══════════════════════════════════════════════
-- 3. LEADS — etapa_pipeline + temperatura (Etapa 0 del spec)
-- ═══════════════════════════════════════════════
-- El spec dice que CRM se actualiza dinámicamente. Las columnas ya existen
-- en SUPABASE_FULL_SETUP.sql, pero verificamos defaults sanos por si la
-- tabla `leads` se creó sin ellas en ambientes viejos.

ALTER TABLE leads ADD COLUMN IF NOT EXISTS etapa_pipeline TEXT DEFAULT 'exploracion';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS temperatura TEXT DEFAULT 'tibio';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS producto_interes TEXT DEFAULT '-';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS datos_extraidos JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN leads.etapa_pipeline IS
    'Etapas: exploracion | interes_activo | cotizacion_enviada | ganado | perdido';
COMMENT ON COLUMN leads.temperatura IS
    'Niveles: frio | tibio | caliente';

-- ═══════════════════════════════════════════════
-- 4. ORDERS — DNI + customer_last_name (PASO 6 del spec)
-- ═══════════════════════════════════════════════
-- El nuevo PASO 6 pide Apellidos+Nombre+Celular+DNI. Ya existen en
-- SUPABASE_FULL_SETUP.sql, verificamos por idempotencia.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_name TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_last_name TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_phone TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS dni TEXT;

-- ═══════════════════════════════════════════════
-- 5. BUSINESS_INFO — shipping_config con regiones por sucursal (E10)
-- ═══════════════════════════════════════════════
-- shipping_config es JSONB libre, ya soporta:
--   • store_pickup_locations[] con {id, name, address, hours, region, maya_note}
--   • groups[] con {departments[], cost_strategy, fixed_cost, free_threshold,
--                   payment_timing, variable_agencies_text, ...}
-- No requiere ALTER. Solo se documenta.

COMMENT ON COLUMN business_info.shipping_config IS
    'JSONB. Estructura: { store_pickup_enabled, store_pickup_locations[{id,name,address,hours,region,maya_note}], groups[{id,departments[],cost_strategy(fixed|free|free_above_threshold|variable),fixed_cost,free_threshold,payment_timing,payment_partial_note,variable_agencies_text,delivery_eta,extra_specs}] }';

-- ═══════════════════════════════════════════════
-- 6. RLS — confirmar que las nuevas filas siguen las policies existentes
-- ═══════════════════════════════════════════════
-- SUPABASE_FULL_SETUP.sql ya creó policies "service_*" en todas las tablas.
-- Los ALTER ADD COLUMN no las afectan. No necesitamos hacer nada acá.

-- ═══════════════════════════════════════════════
-- 7. VERIFICACIÓN — corré esto al final
-- ═══════════════════════════════════════════════

-- a) Confirmar que las tablas críticas del workflow existen
DO $$
DECLARE
    required_tables TEXT[] := ARRAY[
        'users', 'bot_configs', 'business_info',
        'leads', 'orders', 'notifications',
        'chat_history', 'cadences', 'conversations',
        'alerts_log', 'learned_knowledge', 'postventa_tickets',
        'maya_sessions', 'wa_messages', 'wa_chats', 'wa_contacts',
        'scheduled_messages'
    ];
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
        RAISE EXCEPTION 'Faltan tablas: %. Corré scripts/SUPABASE_FULL_SETUP.sql primero.', missing;
    ELSE
        RAISE NOTICE '✅ Todas las tablas del workflow existen.';
    END IF;
END
$$;

-- b) Confirmar que las columnas nuevas del PASO 11 existen
SELECT
    'orders pickup columns' AS check_name,
    column_name,
    data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'orders'
  AND column_name IN ('pickup_address', 'pickup_hours', 'ready_for_pickup_at',
                      'estado_envio', 'tracking_number', 'dni',
                      'customer_name', 'customer_last_name', 'customer_phone')
ORDER BY column_name;

-- c) Confirmar que el bucket profile-photos existe
SELECT
    'profile-photos bucket' AS check_name,
    public,
    file_size_limit,
    array_to_string(allowed_mime_types, ', ') AS allowed_mime_types
FROM storage.buckets
WHERE id = 'profile-photos';

-- d) Confirmar policies de RLS críticas
SELECT
    tablename,
    policyname,
    cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('orders', 'leads', 'notifications', 'learned_knowledge')
ORDER BY tablename, policyname;

-- e) Conteos rápidos por tabla (sanity check)
DO $$
DECLARE
    tbl TEXT;
    cnt INT;
BEGIN
    FOR tbl IN
        SELECT unnest(ARRAY[
            'users', 'bot_configs', 'business_info',
            'leads', 'orders', 'notifications', 'learned_knowledge'
        ])
    LOOP
        EXECUTE format('SELECT COUNT(*) FROM %I', tbl) INTO cnt;
        RAISE NOTICE '📊 %: % registros', tbl, cnt;
    END LOOP;
END
$$;

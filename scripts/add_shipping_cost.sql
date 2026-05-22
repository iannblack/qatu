-- ============================================================================
-- Migración: columnas faltantes detectadas por scripts/check-schema-coverage.mjs
-- ============================================================================
-- Sin estas columnas, Supabase/PostgREST devuelve:
--   "Could not find the '<col>' column of '<tabla>' in the schema cache"
-- y el dashboard muestra un toast rojo aunque la acción haya tenido efecto
-- parcial. En el caso de Tarifa Variable, además dejaba el bot pausado para
-- el cliente.
--
-- Ejecutar UNA VEZ en Supabase Dashboard → SQL Editor.
-- Es idempotente (IF NOT EXISTS), seguro de re-correr.
-- ============================================================================

-- orders: campos de pickup en tienda + recojo
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_address      TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_hours        TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ready_for_pickup_at TIMESTAMPTZ;

-- orders: pagos parciales
ALTER TABLE orders ADD COLUMN IF NOT EXISTS monto_adelanto      NUMERIC DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS monto_restante      NUMERIC DEFAULT 0;

-- orders: costo de envío variable (Tarifa Variable / Opción C)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_cost       NUMERIC DEFAULT 0;

-- orders: campos para el cálculo correcto de monto_pagado/pendiente según
-- payment_timing del envío (upfront / partial / on_delivery), y para mostrar
-- correctamente el TIER 3 (Logística) del CRM Ventas.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS subtotal_producto    NUMERIC DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_timing       TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS region               TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS zona_envio           TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS courier              TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS metodo_pago          TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS costo_envio          NUMERIC DEFAULT 0;

-- wa_chats: motivo del archivado (dedup R-15)
ALTER TABLE wa_chats ADD COLUMN IF NOT EXISTS archived_reason   TEXT;

-- Forzar refresh del schema cache de PostgREST (Supabase) para que el cliente
-- vea las nuevas columnas inmediatamente, sin esperar el reload automático.
NOTIFY pgrst, 'reload schema';

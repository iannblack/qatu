-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Migración: columnas de auditoría para soft-delete                         ║
-- ║ Fecha: 2026-05-16                                                         ║
-- ║                                                                            ║
-- ║ Motivo: el endpoint DELETE /api/orders/:botId/:orderId y                  ║
-- ║ DELETE /api/leads/:leadId guardan `archived_at`/`archived_by`             ║
-- ║ y `deleted_at`/`deleted_by` para trazabilidad. Las columnas no            ║
-- ║ estaban en el schema (orders/leads solo tenían el booleano).              ║
-- ║                                                                            ║
-- ║ El código YA funciona sin esta migración (hace fallback sin metadata).    ║
-- ║ Aplicar esta SQL es OPCIONAL — sirve para recuperar el audit trail       ║
-- ║ y eliminar el warning del fallback en logs.                               ║
-- ║                                                                            ║
-- ║ Idempotente: se puede correr varias veces sin efecto adverso.             ║
-- ║                                                                            ║
-- ║ Cómo aplicar:                                                             ║
-- ║   1. Supabase Dashboard → SQL Editor                                      ║
-- ║   2. Pegar este archivo y ejecutar                                        ║
-- ║   3. Listo. El próximo DELETE va a guardar quien y cuando archivó.        ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- ── orders: audit de soft-delete ────────────────────────────────────────────
ALTER TABLE orders ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS archived_by TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_archived_at ON orders (archived_at)
    WHERE archived = TRUE;

-- ── leads: audit de soft-delete ─────────────────────────────────────────────
ALTER TABLE leads ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS deleted_by TEXT;

CREATE INDEX IF NOT EXISTS idx_leads_deleted_at ON leads (deleted_at)
    WHERE deleted = TRUE;

-- Refrescar el schema cache de PostgREST (Supabase). Sin esto, las nuevas
-- columnas pueden tardar ~1 min en estar visibles vía la API REST.
NOTIFY pgrst, 'reload schema';

-- Verificación (output esperado: 4 filas, una por cada columna nueva)
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE (table_name = 'orders' AND column_name IN ('archived_at', 'archived_by'))
   OR (table_name = 'leads'  AND column_name IN ('deleted_at',  'deleted_by'))
ORDER BY table_name, column_name;

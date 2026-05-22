-- ════════════════════════════════════════════════════════════════════════
-- MIGRACIÓN: assigned_to en tablas de trabajo (Fase 2.1)
-- Fecha:     2026-05-18
-- Propósito: Cada lead/chat/orden/notif puede ser asignado a UN miembro
--            del equipo. Cuando el dueño/supervisor está logueado, ve
--            todo. Cuando un vendedor está logueado, ve solo lo que
--            tiene `assigned_to = <su id en team_members>`.
--
--            El valor 'NULL' significa "sin asignar" → visible para
--            owner/supervisor, INVISIBLE para vendedores. Los leads
--            existentes (pre-migración) quedan como NULL y deben ser
--            asignados desde la UI (Fase 2.2) o por una regla automática
--            futura (round-robin, asignar al que tiene menos carga, etc.).
--
-- Aplicar en: Supabase SQL Editor. Idempotente (IF NOT EXISTS en todo).
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. LEADS ───────────────────────────────────────────────────────────
ALTER TABLE leads
    ADD COLUMN IF NOT EXISTS assigned_to UUID;
CREATE INDEX IF NOT EXISTS idx_leads_assigned_to
    ON leads(assigned_to)
    WHERE assigned_to IS NOT NULL;
-- Index compuesto botId + assigned_to — el patrón más común de query
-- (un vendedor pide sus leads dentro de su tienda).
CREATE INDEX IF NOT EXISTS idx_leads_bot_assigned
    ON leads(bot_id, assigned_to);

-- ── 2. WA_CHATS ────────────────────────────────────────────────────────
ALTER TABLE wa_chats
    ADD COLUMN IF NOT EXISTS assigned_to UUID;
CREATE INDEX IF NOT EXISTS idx_wa_chats_assigned_to
    ON wa_chats(assigned_to)
    WHERE assigned_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wa_chats_bot_assigned
    ON wa_chats(bot_id, assigned_to);

-- ── 3. ORDERS ──────────────────────────────────────────────────────────
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS assigned_to UUID;
CREATE INDEX IF NOT EXISTS idx_orders_assigned_to
    ON orders(assigned_to)
    WHERE assigned_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_bot_assigned
    ON orders(bot_id, assigned_to);

-- ── 4. NOTIFICATIONS ───────────────────────────────────────────────────
-- Las notificaciones (pagos pendientes, handoffs, cotizaciones) se asignan
-- a quien va a actuar sobre ellas. Por defecto van al owner; si el lead
-- ya tiene un assigned_to, se propaga automáticamente (lo hacemos en el
-- código del bot-manager, no en un trigger, para mantener visibilidad).
ALTER TABLE notifications
    ADD COLUMN IF NOT EXISTS assigned_to UUID;
CREATE INDEX IF NOT EXISTS idx_notifications_assigned_to
    ON notifications(assigned_to)
    WHERE assigned_to IS NOT NULL;

-- ── 5. (Opcional) FK de integridad referencial ─────────────────────────
-- Idealmente assigned_to debería ser FK a team_members(id) con
-- ON DELETE SET NULL (si borrás un vendedor, sus leads quedan "sin
-- asignar" en lugar de romperse). Lo dejamos COMENTADO porque la
-- conexión hace lookup costoso en updates masivos; agregarlo después
-- si querés el extra de integridad:
--
-- ALTER TABLE leads          ADD CONSTRAINT IF NOT EXISTS leads_assigned_fk
--   FOREIGN KEY (assigned_to) REFERENCES team_members(id) ON DELETE SET NULL;
-- ALTER TABLE wa_chats       ADD CONSTRAINT IF NOT EXISTS wa_chats_assigned_fk
--   FOREIGN KEY (assigned_to) REFERENCES team_members(id) ON DELETE SET NULL;
-- ALTER TABLE orders         ADD CONSTRAINT IF NOT EXISTS orders_assigned_fk
--   FOREIGN KEY (assigned_to) REFERENCES team_members(id) ON DELETE SET NULL;
-- ALTER TABLE notifications  ADD CONSTRAINT IF NOT EXISTS notifs_assigned_fk
--   FOREIGN KEY (assigned_to) REFERENCES team_members(id) ON DELETE SET NULL;

-- ── 6. Verificación ───────────────────────────────────────────────────
-- Después de correr, confirmá:
--   SELECT column_name
--   FROM information_schema.columns
--   WHERE table_name IN ('leads','wa_chats','orders','notifications')
--     AND column_name = 'assigned_to';
-- Deberían salir 4 filas.

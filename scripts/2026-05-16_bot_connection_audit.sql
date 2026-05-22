-- =====================================================================
-- 2026-05-16 · Audit de conexión multi-número (pantalla "Conexiones")
-- =====================================================================
-- Pantalla nueva del dashboard que lista TODOS los bots de un usuario y
-- muestra el estado en vivo de cada uno (conectado / conectando /
-- desconectado), el teléfono enlazado, los mensajes recibidos hoy y la
-- razón de la última desconexión.
--
-- El backend (`updateBotStatus` en `bot-manager.ts`) ya escribe estos
-- campos en cada cambio de estado del socket. Sin estas columnas, los
-- UPDATE tiran "Could not find the 'last_connected_at' column" y la
-- reconexión falla silenciosamente.
--
-- IDEMPOTENTE — `IF NOT EXISTS` en cada `ADD COLUMN`. Seguro de correr
-- N veces sin efectos secundarios.
--
-- Aplicar desde Supabase SQL Editor con role = service_role.
-- =====================================================================

ALTER TABLE bot_configs
    ADD COLUMN IF NOT EXISTS last_connected_at      TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS last_disconnect_at     TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS last_disconnect_reason TEXT        NULL,
    ADD COLUMN IF NOT EXISTS connected_phone        TEXT        NULL;

-- Índice opcional para ordenar la lista de Conexiones por última actividad
-- de conexión (muestra primero los que se conectaron más recientemente).
-- No es crítico — la tabla es pequeña por usuario (≤ N tiendas) — pero
-- ayuda en UI con muchas tiendas.
CREATE INDEX IF NOT EXISTS bot_configs_last_connected_idx
    ON bot_configs (user_id, last_connected_at DESC NULLS LAST);

-- =====================================================================
-- Verificación post-aplicación (opcional, devuelve la fila por columna):
--
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'bot_configs'
--   AND column_name IN ('last_connected_at', 'last_disconnect_at',
--                       'last_disconnect_reason', 'connected_phone')
-- ORDER BY column_name;
-- =====================================================================

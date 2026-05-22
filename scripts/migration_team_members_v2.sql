-- ════════════════════════════════════════════════════════════════════════
-- MIGRACIÓN: agrega password_hash a team_members (Fase 1.4)
-- Fecha:     2026-05-18
-- Propósito: Almacenar el password bcryptado del miembro que aceptó su
--            invitación. NO se reutiliza la tabla `users` (que es para
--            dueños) — los miembros tienen su propio espacio en
--            team_members y un JWT distinguible por el flag isTeamMember.
--
-- Aplicar en: Supabase SQL Editor. Idempotente.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE team_members
    ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- Marca cuándo el miembro entró por última vez (útil para "última actividad"
-- en el panel del dueño).
ALTER TABLE team_members
    ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

-- Verificación:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'team_members'
--     AND column_name IN ('password_hash', 'last_login_at');

-- ════════════════════════════════════════════════════════════════════════
-- MIGRACIÓN: team_members + roles + invitaciones
-- Fecha:     2026-05-18
-- Propósito: Habilitar equipos de venta multi-usuario en una cuenta Qhatu.
--            El dueño (owner_user_id = el userId que paga la suscripción)
--            invita miembros con rol 'supervisor' o 'vendedor'. Los
--            supervisores ven todo lo del owner; los vendedores ven sólo
--            lo que tienen asignado (assigned_to se agrega en Fase 2).
--
-- Aplicar en: Supabase SQL Editor (orden: copiar todo y ejecutar).
-- Idempotente: las dos veces que se corra produce el mismo resultado.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. Tabla principal: miembros del equipo ─────────────────────────────
CREATE TABLE IF NOT EXISTS team_members (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Dueño de la cuenta (= userId del que paga la suscripción).
    -- TODO miembro vive bajo el paraguas de un owner.
    owner_user_id   UUID NOT NULL,

    -- userId real del miembro en Supabase auth.users.
    -- NULL hasta que el miembro acepta la invitación y crea su password.
    -- Cuando deja de ser NULL, el JWT del miembro puede usarse para
    -- autenticarse y el middleware lo resuelve via team_members.
    auth_user_id    UUID UNIQUE,

    -- Identidad
    email           TEXT NOT NULL,
    name            TEXT NOT NULL,
    phone           TEXT,

    -- Rol — define los permisos:
    --   'supervisor' → ve toda la data del owner (igual que el owner pero
    --                  sin permisos de billing/borrar cuenta)
    --   'vendedor'   → ve solo leads/chats/orders donde assigned_to = su id
    role            TEXT NOT NULL CHECK (role IN ('supervisor', 'vendedor')),

    -- Cargo libre cuando el dueño eligió "Otro:..." en el dropdown
    cargo_custom    TEXT,

    -- Lifecycle:
    --   'invited'  → tiene un invite_token activo, todavía no aceptó
    --   'active'   → aceptó la invitación, tiene auth_user_id, puede loguear
    --   'disabled' → el dueño lo deshabilitó (no puede loguear, no aparece
    --                en filtros pero su histórico de leads sigue vivo)
    status          TEXT NOT NULL DEFAULT 'invited'
                    CHECK (status IN ('invited', 'active', 'disabled')),

    -- Token de invitación (random 32 bytes hex). Se usa en
    -- /panel#invite/<token> para que el vendedor cree su password.
    -- Se borra (NULL) cuando status pasa a 'active'.
    invite_token        TEXT,
    invite_expires_at   TIMESTAMPTZ,

    -- Auditoría básica
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    accepted_at     TIMESTAMPTZ,

    -- Un email no puede repetirse dentro del equipo de un mismo owner.
    -- Pero el MISMO email SÍ podría aparecer en equipos de owners distintos
    -- (raro pero válido: el mismo vendedor freelance trabaja para 2 tiendas).
    UNIQUE (owner_user_id, email)
);

-- Índices para queries frecuentes
CREATE INDEX IF NOT EXISTS idx_team_members_owner ON team_members(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_team_members_auth_user ON team_members(auth_user_id) WHERE auth_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_team_members_status ON team_members(owner_user_id, status);
CREATE INDEX IF NOT EXISTS idx_team_members_invite_token ON team_members(invite_token) WHERE invite_token IS NOT NULL;

-- ── 2. Trigger para mantener updated_at automáticamente ─────────────────
CREATE OR REPLACE FUNCTION trg_team_members_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS team_members_updated_at ON team_members;
CREATE TRIGGER team_members_updated_at
    BEFORE UPDATE ON team_members
    FOR EACH ROW EXECUTE FUNCTION trg_team_members_updated_at();

-- ── 3. Audit log (para Fase 4.2 — lo creamos ahora vacío) ───────────────
-- Registra cambios sensibles: invitaciones, cambios de rol, deshabilitaciones,
-- reasignaciones de leads. El frontend ya puede empezar a escribir aquí
-- aunque la UI de visualización venga después.
CREATE TABLE IF NOT EXISTS team_audit (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id   UUID NOT NULL,
    actor_user_id   UUID NOT NULL,         -- quién hizo la acción
    target_member_id UUID,                 -- a quién/qué afectó (si aplica)
    action          TEXT NOT NULL,         -- 'invite', 'role_change', 'disable',
                                           -- 'reassign_lead', etc.
    meta            JSONB,                 -- payload libre
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_team_audit_owner ON team_audit(owner_user_id, created_at DESC);

-- ── 4. (Defer a Fase 2) Columna assigned_to en tablas de trabajo ────────
-- Esta migración la corremos en Fase 2 (ahora no es necesaria).
-- Documentación aquí solo para referencia:
--
-- ALTER TABLE leads          ADD COLUMN IF NOT EXISTS assigned_to UUID;
-- ALTER TABLE wa_chats       ADD COLUMN IF NOT EXISTS assigned_to UUID;
-- ALTER TABLE orders         ADD COLUMN IF NOT EXISTS assigned_to UUID;
-- ALTER TABLE notifications  ADD COLUMN IF NOT EXISTS assigned_to UUID;
-- CREATE INDEX IF NOT EXISTS idx_leads_assigned ON leads(assigned_to);
-- ... etc.

-- ── 5. Verificación ─────────────────────────────────────────────────────
-- Después de correr, ejecutá esto para confirmar:
--   SELECT count(*) FROM team_members;       -- debería devolver 0
--   SELECT count(*) FROM team_audit;         -- debería devolver 0
--   \d team_members                          -- ver schema completo

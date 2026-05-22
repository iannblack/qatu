-- ════════════════════════════════════════════════════════════════════════
-- MIGRACIÓN: Row-Level Security (Fase 4.1)
-- Fecha:     2026-05-18
-- Propósito: Cinturón + tirantes en Supabase. Aunque toda la API del
--            backend de Node ya filtra por `owner_user_id` / `bot_id` /
--            `assigned_to`, las RLS protegen el bypass directo via
--            anon/authenticated key (e.g. si alguien intenta consultar
--            Supabase desde el frontend con la anon key).
--
-- Modelo de acceso:
--   - service_role  → BYPASS RLS (lo usa el backend de Node, que ya hace
--                      sus propios checks de autorización).
--   - authenticated → solo lee/escribe filas donde `auth.uid()` matchea
--                      el `user_id` (owner) o el `owner_user_id` (member).
--                      ⚠ No usamos esta vía hoy — el frontend siempre habla
--                      con Node, no con Supabase directo. Las policies
--                      están escritas defensivas por si más adelante
--                      cambia eso.
--   - anon          → SIN acceso a ninguna tabla del módulo Equipo.
--
-- Aplicar en: Supabase SQL Editor o con `node scripts/apply-migration.mjs
--             scripts/2026-05-18_rls_team_security.sql`.
--             Idempotente — re-aplicar no rompe nada.
--
-- Rollback:   las policies se pueden borrar individualmente con
--             `DROP POLICY ...` (o desactivar RLS con `ALTER TABLE ...
--             DISABLE ROW LEVEL SECURITY`).
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. TEAM_MEMBERS ────────────────────────────────────────────────────
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS team_members_select_owner ON team_members;
CREATE POLICY team_members_select_owner ON team_members
    FOR SELECT
    TO authenticated
    USING (owner_user_id = auth.uid());

DROP POLICY IF EXISTS team_members_select_self ON team_members;
CREATE POLICY team_members_select_self ON team_members
    FOR SELECT
    TO authenticated
    USING (auth_user_id = auth.uid());

DROP POLICY IF EXISTS team_members_modify_owner ON team_members;
CREATE POLICY team_members_modify_owner ON team_members
    FOR ALL
    TO authenticated
    USING (owner_user_id = auth.uid())
    WITH CHECK (owner_user_id = auth.uid());

-- ── 2. TEAM_AUDIT ──────────────────────────────────────────────────────
-- Solo el owner puede leer el audit log. Nadie (excepto service_role)
-- puede escribir directamente — los inserts pasan SIEMPRE por el backend.
ALTER TABLE team_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_audit FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS team_audit_select_owner ON team_audit;
CREATE POLICY team_audit_select_owner ON team_audit
    FOR SELECT
    TO authenticated
    USING (owner_user_id = auth.uid());

-- ── 3. LEADS — scoping por bot_configs.user_id ─────────────────────────
-- La tabla leads NO tiene user_id propia (lo derivamos vía bot_id). Para
-- RLS hacemos un EXISTS contra bot_configs. Esto es más costoso que un
-- eq directo, pero solo se activa cuando alguien intenta saltarse el
-- backend (que ya tiene scoping aplicado).
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS leads_select_owner_or_assigned ON leads;
CREATE POLICY leads_select_owner_or_assigned ON leads
    FOR SELECT
    TO authenticated
    USING (
        -- (a) Owner del bot dueño del lead
        EXISTS (
            SELECT 1 FROM bot_configs bc
            WHERE bc.id = leads.bot_id AND bc.user_id = auth.uid()
        )
        OR
        -- (b) Team member asignado al lead
        EXISTS (
            SELECT 1 FROM team_members tm
            WHERE tm.id = leads.assigned_to AND tm.auth_user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS leads_modify_owner ON leads;
CREATE POLICY leads_modify_owner ON leads
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM bot_configs bc
            WHERE bc.id = leads.bot_id AND bc.user_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM bot_configs bc
            WHERE bc.id = leads.bot_id AND bc.user_id = auth.uid()
        )
    );

-- ── 4. WA_CHATS — mismo patrón que leads ───────────────────────────────
ALTER TABLE wa_chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE wa_chats FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wa_chats_select_owner_or_assigned ON wa_chats;
CREATE POLICY wa_chats_select_owner_or_assigned ON wa_chats
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM bot_configs bc
            WHERE bc.id = wa_chats.bot_id AND bc.user_id = auth.uid()
        )
        OR
        EXISTS (
            SELECT 1 FROM team_members tm
            WHERE tm.id = wa_chats.assigned_to AND tm.auth_user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS wa_chats_modify_owner ON wa_chats;
CREATE POLICY wa_chats_modify_owner ON wa_chats
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM bot_configs bc
            WHERE bc.id = wa_chats.bot_id AND bc.user_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM bot_configs bc
            WHERE bc.id = wa_chats.bot_id AND bc.user_id = auth.uid()
        )
    );

-- ── 5. ORDERS — mismo patrón ───────────────────────────────────────────
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS orders_select_owner_or_assigned ON orders;
CREATE POLICY orders_select_owner_or_assigned ON orders
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM bot_configs bc
            WHERE bc.id = orders.bot_id AND bc.user_id = auth.uid()
        )
        OR
        EXISTS (
            SELECT 1 FROM team_members tm
            WHERE tm.id = orders.assigned_to AND tm.auth_user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS orders_modify_owner ON orders;
CREATE POLICY orders_modify_owner ON orders
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM bot_configs bc
            WHERE bc.id = orders.bot_id AND bc.user_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM bot_configs bc
            WHERE bc.id = orders.bot_id AND bc.user_id = auth.uid()
        )
    );

-- ── 6. NOTIFICATIONS ──────────────────────────────────────────────────
-- La tabla notifications SÍ tiene user_id propio (es el owner). Aplicamos
-- el patrón estándar.
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notifications_select_owner_or_assigned ON notifications;
CREATE POLICY notifications_select_owner_or_assigned ON notifications
    FOR SELECT
    TO authenticated
    USING (
        user_id = auth.uid()
        OR
        EXISTS (
            SELECT 1 FROM team_members tm
            WHERE tm.id = notifications.assigned_to AND tm.auth_user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS notifications_modify_owner ON notifications;
CREATE POLICY notifications_modify_owner ON notifications
    FOR ALL
    TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- ── 7. Verificación ───────────────────────────────────────────────────
-- Después de aplicar, ejecutá:
--
-- SELECT tablename, rowsecurity, forcerowsecurity
-- FROM   pg_tables
-- WHERE  tablename IN ('team_members','team_audit','leads','wa_chats','orders','notifications');
--
-- Deberían salir 6 filas con rowsecurity=true.
--
-- Y para listar las policies:
-- SELECT schemaname, tablename, policyname, cmd, roles
-- FROM   pg_policies
-- WHERE  tablename IN ('team_members','team_audit','leads','wa_chats','orders','notifications')
-- ORDER  BY tablename, policyname;

-- ── 8. Nota sobre service_role ─────────────────────────────────────────
-- El backend de Node usa la SERVICE_ROLE_KEY que ignora RLS por diseño.
-- Eso es correcto: el backend ya filtra todo via _mergeAssignedToScope.
-- Las policies acá solo blindan accesos directos via anon/authenticated.
-- Si en el futuro queremos exponer Supabase directo al frontend (raro en
-- este proyecto), las policies ya estarían listas.

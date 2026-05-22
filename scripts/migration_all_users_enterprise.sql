-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║ Migración: subir TODOS los usuarios al plan Enterprise               ║
-- ║ Fecha: 2026-05-01                                                    ║
-- ║ Razón: política temporal de "mes de prueba gratis". Todos los        ║
-- ║   emprendedores reciben Enterprise hasta que habilitemos la          ║
-- ║   facturación real. Coordinado con el cambio en auth.service.ts     ║
-- ║   `registerUser` que ahora crea usuarios nuevos también con          ║
-- ║   plan='enterprise', y con el rechazo del endpoint                   ║
-- ║   POST /api/auth/change-plan en routes.ts.                          ║
-- ║ Aplicar en: https://app.supabase.com/project/<ref>/sql               ║
-- ║ Idempotente: solo toca filas que NO estén ya en enterprise.          ║
-- ╚══════════════════════════════════════════════════════════════════════╝

-- 1. Ampliar el CHECK constraint para que acepte 'enterprise'.
--    El schema histórico tenía CHECK (plan IN ('starter','pro','business'))
--    sin contemplar Enterprise. Sin esto, el UPDATE de abajo falla con:
--    ERROR 23514: violates check constraint "users_plan_check".
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_plan_check;

ALTER TABLE users ADD CONSTRAINT users_plan_check
    CHECK (plan IS NULL OR LOWER(plan) IN ('starter', 'pro', 'business', 'enterprise'));

-- 2. Subir a Enterprise a todos los usuarios que no estén ya ahí
UPDATE users
SET plan = 'enterprise',
    plan_changed_at = NOW(),
    updated_at = NOW()
WHERE plan IS NULL OR LOWER(plan) <> 'enterprise';

-- 3. Verificación: confirmá que el resultado es 100% enterprise
SELECT
    COALESCE(plan, '(null)') AS plan,
    COUNT(*) AS users
FROM users
GROUP BY plan
ORDER BY users DESC;
-- Esperado: una sola fila con plan='enterprise' y N usuarios.

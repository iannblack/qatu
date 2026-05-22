-- Migration: columnas que el backend espera pero que faltan en Supabase.
--
-- Contexto: varios endpoints intentan persistir campos que no existen en la
-- BD. Los handlers están parcheados para no crashear (log warning y degradar),
-- pero esos campos terminan siendo no-ops hasta que apliques esta migración.
--
-- Aplicar desde el SQL Editor de Supabase (proyecto jkkdiuwrdajywukhgajq):
-- https://app.supabase.com/project/jkkdiuwrdajywukhgajq/sql

-- 1) users.tutorial_shown — usada por POST /auth/tutorial y /auth/me.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS tutorial_shown boolean DEFAULT false;

-- Marca como "ya visto" a usuarios existentes para que no se les dispare el
-- onboarding al próximo login. Los nuevos tendrán DEFAULT false y verán el
-- tutorial la primera vez.
UPDATE users SET tutorial_shown = true WHERE tutorial_shown IS NULL;

-- 2) alerts_log.read_at — timestamp de lectura usada por
--    PUT /notifications/:botId/read-all. El flag `read` ya existe; sin esta
--    columna el timestamp se pierde pero el flag sí se marca.
ALTER TABLE alerts_log
    ADD COLUMN IF NOT EXISTS read_at timestamptz;

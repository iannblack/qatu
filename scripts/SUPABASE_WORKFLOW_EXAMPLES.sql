-- =================================================================
-- WORKFLOW EXAMPLES — agrega columnas para cachear ejemplos generados
-- por LLM ("lo que el bot probablemente respondería al cliente").
-- Idempotente: se puede correr múltiples veces sin daño.
-- =================================================================

-- Columnas en workflow_nodes para cachear el ejemplo generado
ALTER TABLE workflow_nodes
    ADD COLUMN IF NOT EXISTS example_message       TEXT,
    ADD COLUMN IF NOT EXISTS example_generated_at  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS example_inputs_hash   TEXT;

-- Timestamp en bot_configs para invalidar ejemplos cuando cambia la config
-- (productos, pagos, envíos, identidad). Se actualiza desde el backend en
-- los endpoints de save. Si example_generated_at < config_updated_at → stale.
ALTER TABLE bot_configs
    ADD COLUMN IF NOT EXISTS config_updated_at TIMESTAMPTZ DEFAULT NOW();

-- Para los bots existentes, sembramos config_updated_at con el último
-- updated_at conocido para que los nuevos ejemplos no se vean como "stale"
-- hasta que el dueño realmente edite algo.
UPDATE bot_configs
SET config_updated_at = COALESCE(updated_at, NOW())
WHERE config_updated_at IS NULL;

-- Verificación
SELECT
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'workflow_nodes'
  AND column_name LIKE 'example_%'
ORDER BY column_name;
-- Esperado: 3 filas (example_generated_at, example_inputs_hash, example_message)

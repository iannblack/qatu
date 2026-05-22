-- =================================================================
-- KIPU — Tablas del Workflow Mindmap (idempotente)
-- Ejecutar SOLO si el panel de workflow falla con error de tabla
-- inexistente. En producción estas tablas suelen ya existir porque
-- las creó alguna migración anterior. Este script es seguro de
-- ejecutar en cualquier momento — solo crea lo faltante.
-- =================================================================

-- ═══════════════════════════════════════════════
-- workflow_nodes — Nodos del mindmap (BPMN-style)
-- ═══════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS workflow_nodes (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    bot_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT 'Paso',
    description TEXT DEFAULT '',
    -- start_end (pill) | step | process | condition (diamond) | handoff | config_requirement | action | note
    node_type TEXT NOT NULL DEFAULT 'step',
    -- generic (auto-seed) | custom (user-edited) | learned (LLM-extracted, pending confirmation) | imported
    source TEXT NOT NULL DEFAULT 'custom',
    status TEXT NOT NULL DEFAULT 'active',
    order_index INTEGER DEFAULT 0,
    position_x INTEGER DEFAULT 0,
    position_y INTEGER DEFAULT 0,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE workflow_nodes ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
ALTER TABLE workflow_nodes ADD COLUMN IF NOT EXISTS position_x INTEGER DEFAULT 0;
ALTER TABLE workflow_nodes ADD COLUMN IF NOT EXISTS position_y INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_wf_nodes_bot ON workflow_nodes (bot_id);
CREATE INDEX IF NOT EXISTS idx_wf_nodes_bot_source ON workflow_nodes (bot_id, source);
CREATE INDEX IF NOT EXISTS idx_wf_nodes_bot_status ON workflow_nodes (bot_id, status);

-- ═══════════════════════════════════════════════
-- workflow_edges — Conexiones entre nodos
-- ═══════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS workflow_edges (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    bot_id TEXT NOT NULL,
    from_node_id UUID NOT NULL,
    to_node_id UUID NOT NULL,
    label TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wf_edges_bot ON workflow_edges (bot_id);
CREATE INDEX IF NOT EXISTS idx_wf_edges_from ON workflow_edges (bot_id, from_node_id);
CREATE INDEX IF NOT EXISTS idx_wf_edges_to ON workflow_edges (bot_id, to_node_id);

-- ═══════════════════════════════════════════════
-- RLS — abierta a service role (igual que las demás tablas)
-- ═══════════════════════════════════════════════
DO $$ BEGIN
    ALTER TABLE workflow_nodes ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "service_wf_nodes" ON workflow_nodes FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE workflow_edges ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "service_wf_edges" ON workflow_edges FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ═══════════════════════════════════════════════
-- Verificación
-- ═══════════════════════════════════════════════
SELECT
    'workflow_nodes' AS tabla,
    COUNT(*) AS filas,
    COUNT(*) FILTER (WHERE source = 'generic') AS auto_seed,
    COUNT(*) FILTER (WHERE source = 'custom') AS user_edited,
    COUNT(*) FILTER (WHERE source = 'imported') AS imported
FROM workflow_nodes
UNION ALL
SELECT 'workflow_edges', COUNT(*), 0, 0, 0 FROM workflow_edges;

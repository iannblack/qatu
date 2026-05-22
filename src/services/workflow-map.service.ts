/**
 * workflow-map.service.ts — CRUD + prompt serialization for the Qhatu
 * workflow mind map (nodes + edges). Two tables in Supabase:
 *   - workflow_nodes: { id, bot_id, title, description, node_type,
 *                       source, status, order_index, position_x,
 *                       position_y, metadata, created_at, updated_at }
 *   - workflow_edges: { id, bot_id, from_node_id, to_node_id, label }
 *
 * Nodes with source='generic' are seeded on first read when a bot has
 * no map yet, mirroring the 7-step generic workflow baked into
 * bot-manager.ts. Learned nodes land with status='pending_confirmation'
 * until the emprendedor approves them in the UI.
 */

import { getSupabaseClient } from './db.service'

export interface WorkflowNode {
    id: string
    bot_id: string
    title: string
    description: string
    // Classic BPMN-ish vocabulary used by the visual editor:
    //   start_end          — stadium (pill) · entrypoint / closing message
    //   step / process     — rectangle · a Qhatu action or bot message
    //   condition          — diamond · branch point with Yes/No/custom labels
    //   handoff            — double-line rectangle · waits on a human
    //   config_requirement — dashed rectangle · external integration dependency
    //   action / note      — legacy aliases, kept for existing rows
    node_type: 'start_end' | 'step' | 'process' | 'condition' | 'handoff' | 'config_requirement' | 'action' | 'note'
    source: 'generic' | 'custom' | 'learned'
    status: 'active' | 'pending_confirmation' | 'archived'
    order_index: number
    position_x: number
    position_y: number
    metadata: Record<string, any>
    created_at?: string
    updated_at?: string
    // Computed at read time: live data pulled from the bot's real config
    // (products / shipping / payment methods) for nodes whose metadata
    // declares `feeds_from`. Frontend renders these as n8n-style chips.
    live?: WorkflowNodeLive | null
}

export interface WorkflowNodeLive {
    type: 'products' | 'shipping' | 'payments'
    summary: string
    chips: Array<{ icon: string; label: string; meta?: string }>
}

export interface WorkflowEdge {
    id: string
    bot_id: string
    from_node_id: string
    to_node_id: string
    label: string
}

// Workflow genérico de 10 pasos. Usado como seed cuando un bot no tiene mapa
// todavía; luego el emprendedor puede editarlos libremente y se flipean a
// source='custom' al primer edit. 180px de gap vertical deja lugar para los
// chips de live-data que se pintan debajo del header de cada nodo.
// Espaciado vertical entre nodos del workflow (en px). Cambia este valor para
// ajustar la separación de bots NUEVOS. Para bots ya existentes corre la SQL
// UPDATE de workflow_nodes con el mismo multiplicador.
// Stable seed keys used to wire edges after insertion. The seed insert
// returns auto-generated IDs, so we build a key→id map by matching the
// `metadata.seed_key` we set here, then create the edges below.
interface SeedNodeSpec extends Omit<WorkflowNode, 'id' | 'bot_id' | 'created_at' | 'updated_at'> {
    metadata: { seed_key: string; [k: string]: any }
}

// Mermaid-style BPMN seed. Positions are all zero so the frontend runs
// dagre on first load, producing a clean top-to-bottom layout. When the
// merchant drags a node, the new position persists via PUT /nodes/:id.
const GENERIC_SEED: SeedNodeSpec[] = [
    {
        title: "Cliente escribe: 'Hola'",
        description: "Punto de entrada del flujo. Cualquier mensaje entrante del cliente dispara este workflow.",
        node_type: 'start_end', source: 'generic', status: 'active',
        order_index: 1, position_x: 0, position_y: 0,
        metadata: { seed_key: 'start' }
    },
    {
        title: 'Saludo inicial',
        description: 'Responde con: "Hola, bienvenido a [nombre de la tienda], ¿en qué puedo ayudarte?". Reemplaza el nombre por el de la tienda cargada. NO ofrezcas productos todavía — espera que el cliente pregunte.',
        node_type: 'step', source: 'generic', status: 'active',
        order_index: 2, position_x: 0, position_y: 0,
        metadata: { seed_key: 'greet' }
    },
    {
        title: 'Cliente pregunta por productos',
        description: 'El cliente menciona interés en productos o pide el catálogo. Esto detona la lógica de presentación de productos.',
        node_type: 'step', source: 'generic', status: 'active',
        order_index: 3, position_x: 0, position_y: 0,
        metadata: { seed_key: 'ask_products' }
    },
    {
        title: 'Ofrecer catálogo',
        description: 'Qhatu presenta el catálogo con nombre y precio de cada producto (chips en vivo desde tu configuración).',
        node_type: 'step', source: 'generic', status: 'active',
        order_index: 4, position_x: 0, position_y: 0,
        metadata: { seed_key: 'offer_catalog', feeds_from: 'products', display_bullets: [] }
    },
    {
        title: '¿Catálogo tiene 3 o menos productos?',
        description: 'Decisión automática basada en el catálogo cargado. Si hay 3 o menos productos, muéstralos todos. Si hay más, muestra solo los top 3 según CRM.',
        node_type: 'condition', source: 'generic', status: 'active',
        order_index: 5, position_x: 0, position_y: 0,
        metadata: { seed_key: 'decision_catalog_size' }
    },
    {
        title: 'Mostrar todos los productos',
        description: 'Lista todos los productos del catálogo con nombre + precio + beneficio clave.',
        node_type: 'step', source: 'generic', status: 'active',
        order_index: 6, position_x: 0, position_y: 0,
        metadata: { seed_key: 'show_all', feeds_from: 'products' }
    },
    {
        title: 'Mostrar productos más vendidos según CRM',
        description: 'Muestra los 3 productos top-seller según los pedidos históricos del bot. Ofrece mostrar el catálogo completo al final.',
        node_type: 'step', source: 'generic', status: 'active',
        order_index: 7, position_x: 0, position_y: 0,
        metadata: { seed_key: 'show_top', feeds_from: 'products' }
    },
    {
        title: '¿Qué hace el cliente?',
        description: 'Decisión basada en la intención del cliente: pregunta por varios productos, un producto específico, o decide comprar. Las dos primeras ramas regresan aquí hasta que decida comprar.',
        node_type: 'condition', source: 'generic', status: 'active',
        order_index: 8, position_x: 0, position_y: 0,
        metadata: { seed_key: 'decision_client_action' }
    },
    {
        title: 'Responder dudas varios productos',
        description: 'Responde preguntas que comparan o cubren varios productos del catálogo. Al terminar, vuelve a la decisión "¿Qué hace el cliente?".',
        node_type: 'step', source: 'generic', status: 'active',
        order_index: 9, position_x: 0, position_y: 0,
        metadata: { seed_key: 'resolve_multi' }
    },
    {
        title: 'Responder dudas producto específico',
        description: 'Responde preguntas sobre un producto individual (precio, características, stock). Al terminar, vuelve a la decisión "¿Qué hace el cliente?".',
        node_type: 'step', source: 'generic', status: 'active',
        order_index: 10, position_x: 0, position_y: 0,
        metadata: { seed_key: 'resolve_single' }
    },
    {
        title: "Requiere conexión activa 'Configura tu Qhatu'",
        description: "Dependencia: los siguientes pasos requieren que el emprendedor haya configurado envíos y métodos de pago en 'Configura tu Qhatu'. Sin eso, los nodos conectados no pueden ejecutarse — Qhatu emite HANDOFF_SUGERIDO.",
        node_type: 'config_requirement', source: 'generic', status: 'active',
        order_index: 11, position_x: 0, position_y: 0,
        metadata: { seed_key: 'config_requirement' }
    },
    {
        title: 'Mostrar opciones de envío + métodos de pago del envío',
        description: 'Presenta TODAS las opciones configuradas: sucursales de recojo (con nombre y dirección) y grupos de envío (con regiones cubiertas, tarifa, modalidad de pago — contraentrega / previo / parcial — ETA y courier). NO resumas ni omitas ninguna.',
        node_type: 'step', source: 'generic', status: 'active',
        order_index: 12, position_x: 0, position_y: 0,
        metadata: { seed_key: 'show_shipping', feeds_from: 'shipping' }
    },
    {
        title: '¿Tipo de tarifa del envío?',
        description: 'Decisión basada en el grupo de envío aplicable a la zona del cliente. Si la tarifa es fija, salta directo a solicitar datos. Si requiere cotización manual, avisa al cliente y emite SHIPPING_QUOTE_REQUEST.',
        node_type: 'condition', source: 'generic', status: 'active',
        order_index: 13, position_x: 0, position_y: 0,
        metadata: { seed_key: 'decision_rate_type' }
    },
    {
        title: "Qhatu: 'Nos comunicaremos con el equipo para cotizar tu envío, ya volvemos contigo'",
        description: "Mensaje literal que Qhatu envía al cliente cuando la tarifa es variable. Tras enviarlo, se emite SHIPPING_QUOTE_REQUEST y la conversación queda pausada hasta que el emprendedor responda.",
        node_type: 'step', source: 'generic', status: 'active',
        order_index: 14, position_x: 0, position_y: 0,
        metadata: { seed_key: 'msg_quote_wait' }
    },
    {
        title: 'HANDOFF: Equipo cotiza manualmente',
        description: 'El emprendedor recibe una notificación de tarifa variable, calcula el costo y responde con el monto. Solo entonces se reanuda la conversación con el cliente.',
        node_type: 'handoff', source: 'generic', status: 'active',
        order_index: 15, position_x: 0, position_y: 0,
        metadata: { seed_key: 'handoff_quote' }
    },
    {
        title: 'Enviar cotización + resumen al cliente',
        description: "Qhatu envía el costo cotizado junto con un resumen del pedido: 'ya calculé tu envío. Subtotal: S/X · Envío: S/Y · Total: S/Z. ¿Confirmas tu pedido?'",
        node_type: 'step', source: 'generic', status: 'active',
        order_index: 16, position_x: 0, position_y: 0,
        metadata: { seed_key: 'send_quote' }
    },
    {
        title: 'Solicitar datos del cliente: Apellido · Nombre · Celular · DNI + resumen de productos y cantidades',
        description: 'Solicita los 4 datos en ORDEN: apellido, nombre, celular (9 dígitos), DNI (8 dígitos). Incluye un resumen breve del pedido (producto + cantidad + subtotal) antes de las opciones.',
        node_type: 'step', source: 'generic', status: 'active',
        order_index: 17, position_x: 0, position_y: 0,
        metadata: { seed_key: 'request_data' }
    },
    {
        title: 'Mostrar métodos de pago configurados por el emprendedor',
        description: 'Lista los métodos de pago activos con sus instrucciones literales (Yape, Plin, transferencia, etc.). NUNCA inventes números de cuenta.',
        node_type: 'step', source: 'generic', status: 'active',
        order_index: 18, position_x: 0, position_y: 0,
        metadata: { seed_key: 'show_payment_methods', feeds_from: 'payments' }
    },
    {
        title: 'Cliente realiza el pago + envía foto del comprobante',
        description: 'El cliente paga por el método elegido y envía una captura o foto del comprobante (Yape/transferencia). Qhatu detecta la imagen y emite PAYMENT_RECEIPT con el monto y método.',
        node_type: 'step', source: 'generic', status: 'active',
        order_index: 19, position_x: 0, position_y: 0,
        metadata: { seed_key: 'client_pays' }
    },
    {
        title: "Qhatu: 'Déjanos confirmar tu pago'",
        description: "Mensaje literal que Qhatu envía tras recibir el comprobante, mientras el emprendedor valida manualmente el pago.",
        node_type: 'step', source: 'generic', status: 'active',
        order_index: 20, position_x: 0, position_y: 0,
        metadata: { seed_key: 'msg_wait_conf' }
    },
    {
        title: 'HANDOFF: Emprendedor confirma el pago vía notificación',
        description: 'El emprendedor recibe una notificación con el comprobante y marca el pago como confirmado (o rechazado) desde el panel.',
        node_type: 'handoff', source: 'generic', status: 'active',
        order_index: 21, position_x: 0, position_y: 0,
        metadata: { seed_key: 'handoff_conf' }
    },
    {
        title: '¿Pago confirmado?',
        description: 'Decisión basada en la respuesta del emprendedor. Si confirma, cierre exitoso. Si rechaza, el flujo vuelve al paso de pago para que el cliente reintente.',
        node_type: 'condition', source: 'generic', status: 'active',
        order_index: 22, position_x: 0, position_y: 0,
        metadata: { seed_key: 'decision_paid' }
    },
    {
        title: "Qhatu: 'Muchas gracias por tu compra. Te iremos informando sobre el proceso de envío'",
        description: "Mensaje literal de cierre. El pedido entra al Kanban de envíos para gestión por parte del emprendedor.",
        node_type: 'start_end', source: 'generic', status: 'active',
        order_index: 23, position_x: 0, position_y: 0,
        metadata: { seed_key: 'end' }
    }
]

// Edge list: [fromKey, toKey, label]. Labels drive the Yes/No/custom
// routing in the visual editor. Dashed dependency edges (from config
// requirement nodes) are detected automatically by source type.
const GENERIC_SEED_EDGES: Array<[string, string, string]> = [
    ['start', 'greet', ''],
    ['greet', 'ask_products', ''],
    ['ask_products', 'offer_catalog', ''],
    ['offer_catalog', 'decision_catalog_size', ''],
    ['decision_catalog_size', 'show_all', 'Sí'],
    ['decision_catalog_size', 'show_top', 'No'],
    ['show_all', 'decision_client_action', ''],
    ['show_top', 'decision_client_action', ''],
    ['decision_client_action', 'resolve_multi', 'Pregunta por varios productos'],
    ['decision_client_action', 'resolve_single', 'Pregunta por un producto'],
    ['decision_client_action', 'show_shipping', 'Decide comprar'],
    ['resolve_multi', 'decision_client_action', ''],   // loop back
    ['resolve_single', 'decision_client_action', ''],  // loop back
    ['config_requirement', 'show_shipping', ''],        // dashed (dep from source type)
    ['show_shipping', 'decision_rate_type', ''],
    ['decision_rate_type', 'request_data', 'Tarifa fija'],
    ['decision_rate_type', 'msg_quote_wait', 'Requiere cotización'],
    ['msg_quote_wait', 'handoff_quote', ''],
    ['handoff_quote', 'send_quote', ''],
    ['send_quote', 'request_data', ''],
    ['request_data', 'show_payment_methods', ''],
    ['show_payment_methods', 'client_pays', ''],
    ['client_pays', 'msg_wait_conf', ''],
    ['msg_wait_conf', 'handoff_conf', ''],
    ['handoff_conf', 'decision_paid', ''],
    ['decision_paid', 'client_pays', 'No'],   // loop back on payment rejection
    ['decision_paid', 'end', 'Sí']
]

// ─── Read ────────────────────────────────────────────────────────────

const SOURCE_RANK: Record<string, number> = { custom: 3, learned: 2, imported: 2, generic: 1 }

/** seed_keys ya editados por el usuario — el auto-seed no debe recrearlos. */
function userOwnedSeedKeys(nodes: WorkflowNode[]): Set<string> {
    const keys = new Set<string>()
    for (const n of nodes) {
        if (n.source === 'custom' || n.source === 'learned') {
            const k = n.metadata?.seed_key
            if (typeof k === 'string' && k) keys.add(k)
        }
    }
    return keys
}

/** Si hay custom + generic con el mismo seed_key, conserva el de mayor rank. */
function dedupeNodesBySeedKey(nodes: WorkflowNode[]): WorkflowNode[] {
    const byKey = new Map<string, WorkflowNode>()
    const withoutKey: WorkflowNode[] = []
    for (const n of nodes) {
        const key = n.metadata?.seed_key
        if (!key || typeof key !== 'string') {
            withoutKey.push(n)
            continue
        }
        const prev = byKey.get(key)
        if (!prev || (SOURCE_RANK[n.source] || 0) > (SOURCE_RANK[prev.source] || 0)) {
            byKey.set(key, n)
        }
    }
    const deduped = [...withoutKey, ...byKey.values()]
    if (deduped.length < nodes.length) {
        console.log(`[workflow-map] deduped ${nodes.length - deduped.length} node(s) by seed_key (custom > learned > generic)`)
    }
    return deduped
}

export async function getWorkflowMap(botId: string): Promise<{ nodes: WorkflowNode[]; edges: WorkflowEdge[] }> {
    const supabase = getSupabaseClient()

    const { data: nodes, error: nErr } = await supabase
        .from('workflow_nodes')
        .select('*')
        .eq('bot_id', botId)
        .neq('status', 'archived')
        .order('order_index', { ascending: true })
    if (nErr) throw nErr

    // Auto-seed on first access so the user lands on a populated canvas.
    if (!nodes || nodes.length === 0) {
        await seedGenericWorkflow(botId)
        return getWorkflowMap(botId)
    }

    // Auto-cleanup: detectamos duplicados por `metadata.seed_key`. Si el mismo
    // seed_key aparece más de una vez en los nodos source='generic', es un
    // remanente de un seed concurrente anterior (antes del mutex per-bot).
    // Disparamos un re-seed que borra todos los generic y recrea el seed actual.
    const allNodes = (nodes || []) as WorkflowNode[]
    const ownedSeedKeys = userOwnedSeedKeys(allNodes)
    const genericNodes = allNodes.filter((n) => n.source === 'generic')
    const seedKeyCounts = new Map<string, number>()
    for (const n of genericNodes) {
        const key = n.metadata?.seed_key
        if (key) seedKeyCounts.set(key, (seedKeyCounts.get(key) || 0) + 1)
    }
    const hasDuplicates = Array.from(seedKeyCounts.values()).some(c => c > 1)
    if (hasDuplicates) {
        const dupes = Array.from(seedKeyCounts.entries()).filter(([_, c]) => c > 1)
        console.log(`[getWorkflowMap] bot=${botId} detected duplicated seed_keys: ${JSON.stringify(dupes)}. Auto-cleaning...`)
        await seedGenericWorkflow(botId)
        return getWorkflowMap(botId)
    }

    // Auto-migrar seeds obsoletos al esquema consolidado (productos/envíos/
    // pagos/datos en un solo nodo con bullets). Si vemos un seed_key del
    // esquema viejo (un nodo por opción), regeneramos. Esto evita que el
    // usuario tenga que pulsar manualmente "Regenerar" cuando hacemos un
    // cambio estructural en el seed builder.
    const OBSOLETE_SEED_KEYS = new Set([
        'offer_single', 'list_all', 'ask_interest', 'pick_product',
        'request_data_apellido', 'request_data_nombre', 'request_data_celular', 'request_data_dni'
    ])
    const OBSOLETE_PREFIXES = ['shipping_pickup_', 'shipping_group_', 'payment_method_']
    const hasObsolete = genericNodes.some((n: any) => {
        const k = n.metadata?.seed_key
        if (!k) return false
        if (OBSOLETE_SEED_KEYS.has(k)) return true
        return OBSOLETE_PREFIXES.some(p => typeof k === 'string' && k.startsWith(p))
    })
    if (hasObsolete) {
        console.log(`[getWorkflowMap] bot=${botId} detected obsolete seed schema. Regenerating with consolidated bullets...`)
        await seedGenericWorkflow(botId)
        return getWorkflowMap(botId)
    }

    // Auto-migrar contenido obsoleto: títulos con placeholder
    // {nombre_negocio} sin reemplazar, o nodos sin display_bullets cuando
    // la nueva versión los inyecta. Esto cubre el caso donde el schema
    // ya está correcto pero el title/description fueron generados con
    // una versión anterior del seed builder.
    const startNode = genericNodes.find((n: any) => n.metadata?.seed_key === 'start')
    const offerCatalog = genericNodes.find((n: any) => n.metadata?.seed_key === 'offer_catalog')
    const askShipping = genericNodes.find((n: any) => n.metadata?.seed_key === 'ask_shipping_method')
    const showPayments = genericNodes.find((n: any) => n.metadata?.seed_key === 'show_payment_methods')
    const reqCustomer = genericNodes.find((n: any) => n.metadata?.seed_key === 'request_customer_data')
    const greetNode = ownedSeedKeys.has('greet')
        ? undefined
        : genericNodes.find((n: any) => n.metadata?.seed_key === 'greet')
    const hasOldContent =
        (!ownedSeedKeys.has('start') && startNode && /\{nombre_negocio\}/.test(startNode.title || '')) ||
        (greetNode && !Array.isArray(greetNode.metadata?.display_bullets)) ||
        (!ownedSeedKeys.has('offer_catalog') && offerCatalog && !Array.isArray(offerCatalog.metadata?.display_bullets)) ||
        (!ownedSeedKeys.has('ask_shipping_method') && askShipping && !Array.isArray(askShipping.metadata?.display_bullets)) ||
        (!ownedSeedKeys.has('show_payment_methods') && showPayments && !Array.isArray(showPayments.metadata?.display_bullets)) ||
        (!ownedSeedKeys.has('request_customer_data') && reqCustomer && !Array.isArray(reqCustomer.metadata?.display_bullets))
    if (hasOldContent) {
        console.log(`[getWorkflowMap] bot=${botId} detected outdated content (placeholder or missing bullets). Regenerating...`)
        await seedGenericWorkflow(botId)
        return getWorkflowMap(botId)
    }

    // Auto-migrar por versión: si los nodos generic tienen seed_version
    // menor que la actual del builder, regeneramos. Esto es el mecanismo
    // robusto para forzar refresh cuando cambiamos el formato de bullets
    // (regiones, payment_timing, instrucciones literales, etc.) sin tocar
    // el schema de seed_keys. La versión actual está hardcoded aquí —
    // cualquier subida en buildConfigDrivenSeed (SEED_VERSION) debe
    // reflejarse acá también.
    const CURRENT_SEED_VERSION = 6
    const versionsSeen = genericNodes
        .map((n: any) => Number(n.metadata?.seed_version) || 0)
    const minVersion = versionsSeen.length > 0 ? Math.min(...versionsSeen) : 0
    if (minVersion < CURRENT_SEED_VERSION) {
        console.log(`[getWorkflowMap] bot=${botId} seed_version=${minVersion} < ${CURRENT_SEED_VERSION}. Regenerating...`)
        await seedGenericWorkflow(botId)
        return getWorkflowMap(botId)
    }

    const dedupedNodes = dedupeNodesBySeedKey(allNodes)
    const nodeIds = dedupedNodes.map(n => n.id)
    let edges: WorkflowEdge[] = []
    if (nodeIds.length > 0) {
        const { data: edgeRows, error: eErr } = await supabase
            .from('workflow_edges')
            .select('*')
            .eq('bot_id', botId)
        if (eErr) throw eErr
        // Filter to edges whose endpoints still exist & belong to this bot.
        edges = (edgeRows || []).filter((e: WorkflowEdge) => nodeIds.includes(e.from_node_id) && nodeIds.includes(e.to_node_id))
    }

    // Enrich nodes that declare feeds_from with live data from the bot's
    // actual configuration (products, shipping, payments). This makes the
    // mind map reflect what's really been set up, n8n-style.
    const enrichedNodes = await enrichNodesWithLiveData(botId, dedupedNodes)
    return { nodes: enrichedNodes, edges }
}

// ─── Live enrichment ───────────────────────────────────────────────

async function enrichNodesWithLiveData(botId: string, nodes: WorkflowNode[]): Promise<WorkflowNode[]> {
    const needs = new Set(nodes.map(n => n.metadata?.feeds_from).filter(Boolean))
    if (needs.size === 0) return nodes

    const supabase = getSupabaseClient()
    // Fetch only what's required. Both products (from business_info) and
    // shipping/payments (from bot_configs.operacion) may apply.
    const [bizRes, botRes] = await Promise.all([
        needs.has('products')
            ? supabase.from('business_info').select('products').eq('bot_id', botId).maybeSingle()
            : Promise.resolve({ data: null }),
        (needs.has('shipping') || needs.has('payments'))
            ? supabase.from('bot_configs').select('operacion').eq('id', botId).maybeSingle()
            : Promise.resolve({ data: null })
    ])

    const products: any[] = (bizRes as any)?.data?.products || []
    const operacion: any = (botRes as any)?.data?.operacion || {}
    const shipping: any = operacion.shippingConfig || null
    const paymentMethods: any[] = Array.isArray(operacion.metodos_pago) ? operacion.metodos_pago : []

    return nodes.map(n => {
        const feedsFrom = n.metadata?.feeds_from
        if (!feedsFrom) return n
        let live: WorkflowNodeLive | null = null

        if (feedsFrom === 'products') {
            if (products.length === 0) {
                live = { type: 'products', summary: 'Sin productos configurados', chips: [] }
            } else {
                const sample = products.slice(0, 4).map((p: any) => ({
                    icon: '📦',
                    label: String(p.name || p.nombre || 'Sin nombre').slice(0, 40),
                    meta: p.price ? `S/ ${p.price}` : undefined
                }))
                if (products.length > 4) sample.push({ icon: '➕', label: `+${products.length - 4} más`, meta: undefined })
                live = { type: 'products', summary: `${products.length} producto${products.length === 1 ? '' : 's'} en catálogo`, chips: sample }
            }
        } else if (feedsFrom === 'shipping') {
            if (!shipping || !shipping.cost_strategy) {
                live = { type: 'shipping', summary: 'Sin configuración de envíos', chips: [] }
            } else {
                const strategyLabel: Record<string, string> = {
                    free: 'Envío gratis',
                    free_above_threshold: `Gratis desde S/ ${shipping.free_threshold || '—'}`,
                    fixed: 'Tarifa fija por zona',
                    variable: 'Tarifa variable'
                }
                const chips: Array<{ icon: string; label: string; meta?: string }> = [
                    { icon: '🚚', label: strategyLabel[shipping.cost_strategy] || shipping.cost_strategy }
                ]
                if (shipping.delivery_eta) chips.push({ icon: '⏱', label: String(shipping.delivery_eta).slice(0, 60) })
                if (shipping.store_pickup_enabled) chips.push({ icon: '🏬', label: 'Recojo en tienda' })
                const paymentTimingLabel: Record<string, string> = {
                    upfront: 'Pago total al crear',
                    partial: 'Pago parcial',
                    on_delivery: 'Contraentrega'
                }
                if (shipping.payment_timing) chips.push({ icon: '💳', label: paymentTimingLabel[shipping.payment_timing] || shipping.payment_timing })
                if (shipping.variable_agencies_text) chips.push({ icon: '🏢', label: String(shipping.variable_agencies_text).slice(0, 60) })
                live = { type: 'shipping', summary: strategyLabel[shipping.cost_strategy] || 'Envíos configurados', chips }
            }
        } else if (feedsFrom === 'payments') {
            if (paymentMethods.length === 0) {
                live = { type: 'payments', summary: 'Sin métodos de pago', chips: [] }
            } else {
                const chips = paymentMethods.slice(0, 5).map((m: any) => ({
                    icon: methodIcon(m.tipo || m.type),
                    label: String(m.nombre || m.name || m.metodo || m.tipo || 'Método').slice(0, 40),
                    meta: (m.instrucciones || m.instructions) ? String(m.instrucciones || m.instructions).slice(0, 50) : undefined
                }))
                if (paymentMethods.length > 5) chips.push({ icon: '➕', label: `+${paymentMethods.length - 5} más`, meta: undefined })
                live = { type: 'payments', summary: `${paymentMethods.length} método${paymentMethods.length === 1 ? '' : 's'} de pago`, chips }
            }
        }
        return { ...n, live }
    })
}

function methodIcon(tipo?: string): string {
    const t = (tipo || '').toString().toLowerCase()
    if (t.includes('yape') || t.includes('plin')) return '📱'
    if (t.includes('transfer')) return '🏦'
    if (t.includes('efectivo') || t.includes('cash')) return '💵'
    if (t.includes('tarjeta') || t.includes('card')) return '💳'
    return '💰'
}

// Builds a workflow adapted to the bot's REAL configuration. If the config
// is missing (no products / no shipping / no payments), falls back to generic
// seeds for those steps. This replaces the old one-size-fits-all flowchart
// that asked silly things like "¿Catálogo tiene 3 o menos productos?" when
// the user already configured 1 product.
export async function buildConfigDrivenSeed(botId: string): Promise<{ nodes: SeedNodeSpec[]; edges: Array<[string, string, string]> }> {
    const supabase = getSupabaseClient()
    const [bizRes, botRes] = await Promise.all([
        supabase.from('business_info').select('products,faqs,payment_methods_structured,shipping_config').eq('bot_id', botId).maybeSingle(),
        supabase.from('bot_configs').select('bot_name,tienda,operacion').eq('id', botId).maybeSingle()
    ])
    const biz: any = (bizRes as any).data || {}
    const bot: any = (botRes as any).data || {}
    const products: any[] = Array.isArray(biz.products) ? biz.products : []
    const paymentMethods: any[] = Array.isArray(biz.payment_methods_structured)
        ? biz.payment_methods_structured.filter((m: any) => m.activo !== false)
        : []
    const shippingConfig: any = bot.operacion?.shippingConfig || biz.shipping_config || {}
    const shippingGroups: any[] = Array.isArray(shippingConfig.groups) ? shippingConfig.groups : []
    const pickupLocs: any[] = Array.isArray(shippingConfig.store_pickup_locations) ? shippingConfig.store_pickup_locations : []
    const storeName: string = bot.tienda?.nombre || bot.bot_name || 'tu tienda'

    console.log(`[buildConfigDrivenSeed] bot=${botId}`, {
        products: products.length,
        paymentMethods: paymentMethods.length,
        shippingGroups: shippingGroups.length,
        pickupLocs: pickupLocs.length,
        cost_strategy: shippingConfig.cost_strategy,
        operacionKeys: Object.keys(bot.operacion || {}),
        shippingConfigKeys: Object.keys(shippingConfig)
    })

    const nodes: SeedNodeSpec[] = []
    const edges: Array<[string, string, string]> = []
    let orderIdx = 1
    // Fase actual: el wrapper addNode la auto-inyecta en metadata.phase si
    // la spec no la trae explícita. El frontend usa esto para agrupar nodos
    // en swimlanes de color por fase del flujo.
    let currentPhase: string = 'bienvenida'
    // Versión del seed builder. Cuando cambiamos el formato de los bullets
    // o la estructura de los nodos, bumpamos este número y getWorkflowMap
    // detecta workflows con versión menor → regenera. Esto evita que el
    // dueño quede con un workflow desactualizado tras una mejora.
    const SEED_VERSION = 6
    const addNode = (spec: Omit<SeedNodeSpec, 'order_index' | 'position_x' | 'position_y' | 'source' | 'status'>) => {
        const meta = (spec as any).metadata || {}
        if (!meta.phase) meta.phase = currentPhase
        meta.seed_version = SEED_VERSION
        nodes.push({ ...(spec as any), metadata: meta, order_index: orderIdx++, position_x: 0, position_y: 0, source: 'generic', status: 'active' } as SeedNodeSpec)
    }

    // ── BIENVENIDA ────────────────────────────────────────────
    // Usamos el nombre REAL del negocio en todos los lugares — antes
    // dejábamos el placeholder {nombre_negocio} y nunca se reemplazaba.
    currentPhase = 'bienvenida'
    addNode({
        title: `Cliente escribe a ${storeName}`,
        description: 'Entrada del flujo. Cualquier mensaje del cliente dispara el workflow.',
        node_type: 'start_end',
        metadata: { seed_key: 'start' }
    })
    addNode({
        title: 'Saludo inicial',
        description: `Qhatu responde: "¡Hola! 😊 Bienvenido a ${storeName}. ¿En qué puedo ayudarte hoy?". No ofrece productos todavía, espera que el cliente pregunte.`,
        node_type: 'step',
        metadata: {
            seed_key: 'greet',
            display_bullets: [
                `Saluda al cliente con el nombre del negocio: "${storeName}"`,
                `Pregunta abierta: "¿En qué puedo ayudarte hoy?"`,
                `No ofrece productos hasta que el cliente pregunte`
            ]
        }
    })
    edges.push(['start', 'greet', ''])

    // ── PRODUCTOS (catálogo completo configurado) ─────────────────────
    // Mostramos hasta 15 productos con precio y descripción real. El
    // resto va al "+ N más" para no saturar el nodo. Detalles completos
    // en la description del nodo (visible en el side panel).
    currentPhase = 'productos'
    addNode({
        title: 'Cliente pregunta por productos',
        description: 'El cliente muestra interés en los productos del catálogo.',
        node_type: 'step',
        metadata: { seed_key: 'ask_products' }
    })
    edges.push(['greet', 'ask_products', ''])
    if (products.length === 0) {
        addNode({
            title: 'No hay productos configurados',
            description: 'Qhatu responde "déjame consultar con el equipo" y emite HANDOFF_SUGERIDO. Agrega productos en "Configura tu Qhatu → Productos" para desbloquear este paso.',
            node_type: 'handoff',
            metadata: { seed_key: 'no_products', feeds_from: 'products' }
        })
        edges.push(['ask_products', 'no_products', ''])
    } else {
        const PRODUCTS_INLINE = 15
        // Bullets: uno por producto. Formato compacto para que sea legible
        // en el nodo: "Nombre — S/ Precio — descripción corta".
        const productBullets = products.slice(0, PRODUCTS_INLINE).map((p: any) => {
            const name  = (p.name || p.nombre || 'Producto').toString().trim()
            const price = p.price || p.precio
            const desc  = (p.description || p.descripcion || '').toString().trim()
            const priceStr = price ? `S/ ${price}` : 'Consultar precio'
            // Truncar descripción a 50 chars para que el bullet no se haga gigante;
            // la descripción completa aparece en el side panel del nodo.
            const descShort = desc.length > 50 ? desc.slice(0, 50).trim() + '…' : desc
            return descShort ? `${name} — ${priceStr} — ${descShort}` : `${name} — ${priceStr}`
        })
        if (products.length > PRODUCTS_INLINE) {
            productBullets.push(`+ ${products.length - PRODUCTS_INLINE} producto${products.length - PRODUCTS_INLINE === 1 ? '' : 's'} más en el catálogo`)
        }
        // La description del side panel lleva el catálogo completo formateado.
        const fullCatalogText = products.map((p: any, i: number) => {
            const name  = (p.name || p.nombre || 'Producto').toString().trim()
            const price = p.price || p.precio
            const desc  = (p.description || p.descripcion || '').toString().trim()
            const priceStr = price ? `S/ ${price}` : 'Consultar precio'
            return `${i + 1}. ${name} — ${priceStr}${desc ? `\n   ${desc}` : ''}`
        }).join('\n')
        addNode({
            title: 'Ofrecer catálogo',
            description: `Qhatu presenta el catálogo de ${storeName} (${products.length} producto${products.length === 1 ? '' : 's'}) y espera la elección del cliente. Si pregunta por uno específico, responde con sus detalles. Si pregunta por varios, los lista todos.\n\nCATÁLOGO COMPLETO:\n${fullCatalogText}`,
            node_type: 'step',
            metadata: {
                seed_key: 'offer_catalog',
                feeds_from: 'products',
                display_bullets: productBullets
            }
        })
        edges.push(['ask_products', 'offer_catalog', ''])

        // ── Foto del producto — opt-in: solo si hay productos con imageUrl ─
        // Si el emprendedor cargó al menos una foto en el wizard, el bot va
        // a mandarla cuando el cliente la pida ("muéstrame", "foto", etc.).
        // El nodo refleja eso visualmente en el workflow para que el dueño
        // sepa que la capacidad existe (y sepa por qué pasa cuando ocurra).
        const productsWithPhoto = products.filter((p: any) =>
            p && (p.imageUrl || p.image_url) && String(p.imageUrl || p.image_url).trim().length > 0
        )
        if (productsWithPhoto.length > 0) {
            const photoBullets = productsWithPhoto.slice(0, 8).map((p: any) => {
                const name = (p.name || p.nombre || 'Producto').toString().trim()
                return `${name} — 📸 foto cargada`
            })
            if (productsWithPhoto.length > 8) {
                photoBullets.push(`+ ${productsWithPhoto.length - 8} producto${productsWithPhoto.length - 8 === 1 ? '' : 's'} más con foto`)
            }
            const totalWithoutPhoto = products.length - productsWithPhoto.length
            const sinFotoNota = totalWithoutPhoto > 0
                ? `\n\nNOTA: ${totalWithoutPhoto} producto${totalWithoutPhoto === 1 ? '' : 's'} del catálogo NO tiene${totalWithoutPhoto === 1 ? '' : 'n'} foto cargada. Si el cliente la pide para uno de esos, Qhatu responde con el detalle de texto.`
                : ''
            addNode({
                title: 'Mostrar foto del producto',
                description: `Cuando el cliente pide ver una imagen (ej. "muéstrame", "tienes foto", "puedo ver"), Qhatu envía por WhatsApp la foto del producto que mencionó.\n\nProductos con foto cargada (${productsWithPhoto.length} de ${products.length}):${sinFotoNota}`,
                node_type: 'step',
                metadata: {
                    seed_key: 'send_product_photo',
                    feeds_from: 'products',
                    display_bullets: photoBullets,
                    triggered_by: 'photo_request'
                }
            })
            edges.push(['offer_catalog', 'send_product_photo', 'Cliente pide foto'])
            edges.push(['send_product_photo', 'ask_shipping_method', 'Cliente elige producto'])
            // Mantenemos también el path directo (sin foto) para no romper la
            // ruta canónica del flujo cuando el cliente no pide imagen.
            edges.push(['offer_catalog', 'ask_shipping_method', 'Cliente elige producto'])
        } else {
            edges.push(['offer_catalog', 'ask_shipping_method', 'Cliente elige producto'])
        }
    }

    // ── ENVÍOS (estructura jerárquica: pickup → grupos por región) ─────
    // El nodo principal "Opciones de envío" lista cada opción concreta:
    //   • Sucursal de recojo (con nombre + dirección)
    //   • Grupo por región: "Lima Metropolitana — Tarifa fija S/ 15 (24h)"
    //   • Cobertura sin grupo: "Otras regiones — cotización manual"
    // Detalles completos (payment_timing, agencias, notas) van en la
    // description del nodo. La regla mostrar región explícitamente es
    // crítica: el dueño debe ver QUÉ departamentos cubre cada grupo.
    currentPhase = 'envio'
    const FIRST_DATA_KEY = 'request_customer_data'
    const hasAnyShipping = shippingGroups.length > 0 || pickupLocs.length > 0 || shippingConfig.cost_strategy
    // Map de códigos de departamento a nombre legible (mismo que bot-manager).
    const DEPT_NAMES: Record<string, string> = {
        amazonas: 'Amazonas', ancash: 'Áncash', apurimac: 'Apurímac',
        arequipa: 'Arequipa', ayacucho: 'Ayacucho', cajamarca: 'Cajamarca',
        callao: 'Callao', cusco: 'Cusco', huancavelica: 'Huancavelica',
        huanuco: 'Huánuco', ica: 'Ica', junin: 'Junín',
        la_libertad: 'La Libertad', lambayeque: 'Lambayeque',
        lima_metropolitana: 'Lima Metropolitana', lima_provincias: 'Lima Provincias',
        loreto: 'Loreto', madre_de_dios: 'Madre de Dios', moquegua: 'Moquegua',
        pasco: 'Pasco', piura: 'Piura', puno: 'Puno',
        san_martin: 'San Martín', tacna: 'Tacna', tumbes: 'Tumbes', ucayali: 'Ucayali'
    }
    const deptListOf = (codes: any): string => {
        if (!Array.isArray(codes) || codes.length === 0) return ''
        const names = codes.map(c => DEPT_NAMES[c] || c)
        if (names.length <= 3) return names.join(', ')
        return `${names.slice(0, 3).join(', ')} +${names.length - 3}`
    }
    const strategyLabel = (g: any): string => {
        if (g.cost_strategy === 'free') return 'gratis'
        if (g.cost_strategy === 'fixed') return g.fixed_cost > 0 ? `S/ ${g.fixed_cost}` : 'tarifa fija'
        if (g.cost_strategy === 'free_above_threshold') return g.free_threshold > 0 ? `gratis desde S/ ${g.free_threshold}` : 'gratis sobre umbral'
        if (g.cost_strategy === 'variable') return 'cotización manual'
        return g.cost_strategy || 'envío'
    }
    const paymentTimingLabel = (t: string): string => {
        if (t === 'upfront')     return 'pago total'
        if (t === 'partial')     return 'pago parcial'
        if (t === 'on_delivery') return 'contraentrega'
        return ''
    }

    if (!hasAnyShipping) {
        addNode({
            title: 'Coordinar envío',
            description: 'Sin envíos configurados. Qhatu pide datos del cliente y escala al emprendedor para coordinar manualmente. Configura tu logística en "Configura tu Qhatu → Envíos".',
            node_type: 'step',
            metadata: { seed_key: 'ask_shipping_method', feeds_from: 'shipping' }
        })
        addNode({
            title: 'HANDOFF: coordinar envío manual',
            description: 'Qhatu escala al emprendedor para definir cómo se entregará el pedido.',
            node_type: 'handoff',
            metadata: { seed_key: 'handoff_no_shipping' }
        })
        edges.push(['ask_shipping_method', 'handoff_no_shipping', ''])
        edges.push(['handoff_no_shipping', FIRST_DATA_KEY, ''])
    } else {
        const shippingBullets: string[] = []
        // 1. Sucursales de pickup primero (recojo en tienda).
        pickupLocs.slice(0, 6).forEach((l: any) => {
            if (!(l?.address || '').trim()) return
            const name = (l.name || 'Sucursal').toString().trim()
            const addr = (l.address || '').toString().trim()
            const addrShort = addr.length > 50 ? addr.slice(0, 50).trim() + '…' : addr
            shippingBullets.push(`Recojo · ${name} — ${addrShort}`)
        })
        // 2. Grupos de envío a domicilio con regiones específicas.
        // Prefijo "Envío a domicilio" para distinguir claramente de los
        // pickups (recojo en tienda) — los grupos siempre representan
        // delivery, no recojo. Si hay payment_timing lo agregamos al final.
        let needsHandoffQuote = false
        shippingGroups.slice(0, 8).forEach((g: any, i: number) => {
            if (!g || !g.cost_strategy) return
            const regs   = deptListOf(g.departments)
            const cost   = strategyLabel(g)
            const eta    = (g.delivery_eta || '').toString().trim()
            const timing = paymentTimingLabel(g.payment_timing)
            const region = regs || `Grupo ${i + 1}`
            const head   = `Envío a domicilio · ${region} · ${cost}`
            const withEta = eta ? `${head} (${eta})` : head
            const full   = timing ? `${withEta} · ${timing}` : withEta
            if (g.cost_strategy === 'variable') {
                needsHandoffQuote = true
                shippingBullets.push(`${full} → cotización manual`)
            } else {
                shippingBullets.push(full)
            }
        })
        // 3. ETA global como fallback si no hay grupos pero sí cost_strategy.
        if (shippingBullets.length === 0 && shippingConfig.cost_strategy) {
            const fakeGroup = {
                cost_strategy: shippingConfig.cost_strategy,
                fixed_cost: shippingConfig.fixed_cost,
                free_threshold: shippingConfig.free_threshold
            }
            const cost = strategyLabel(fakeGroup)
            const eta = (shippingConfig.delivery_eta || '').toString().trim()
            shippingBullets.push(eta ? `Envío a domicilio · ${cost} (${eta})` : `Envío a domicilio · ${cost}`)
        }

        // Description con detalle COMPLETO de cada grupo.
        const detailedGroups = shippingGroups.map((g: any, i: number) => {
            const regs = deptListOf(g.departments) || '(sin regiones)'
            const cost = strategyLabel(g)
            const lines = [`[Grupo ${i + 1}] Regiones: ${regs}`, `  · Costo: ${cost}`]
            if (g.delivery_eta) lines.push(`  · ETA: ${g.delivery_eta}`)
            if (g.payment_timing === 'upfront') lines.push(`  · Cobro: total al crear el pedido`)
            else if (g.payment_timing === 'partial') lines.push(`  · Cobro: parcial${g.payment_partial_pct ? ` (${g.payment_partial_pct}%)` : ''}${g.payment_partial_note ? ` — ${g.payment_partial_note}` : ''}`)
            else if (g.payment_timing === 'on_delivery') lines.push(`  · Cobro: contraentrega`)
            if (g.variable_agencies_text) lines.push(`  · Agencias: ${g.variable_agencies_text}`)
            if (g.extra_specs) lines.push(`  · Notas: ${g.extra_specs}`)
            return lines.join('\n')
        }).join('\n\n')
        const detailedPickups = pickupLocs.filter((l: any) => l?.address)
            .map((l: any, i: number) => `[Sucursal ${i + 1}] ${l.name || 'Sin nombre'}\n  · Dirección: ${l.address}${l.region ? `\n  · Región: ${l.region}` : ''}`)
            .join('\n\n')
        const fullShippingText = [
            detailedPickups ? `RECOJO EN TIENDA:\n${detailedPickups}` : '',
            detailedGroups ? `ENVÍO POR REGIÓN:\n${detailedGroups}` : '',
            shippingConfig.delivery_eta && !shippingGroups.length ? `ETA general: ${shippingConfig.delivery_eta}` : ''
        ].filter(Boolean).join('\n\n')

        addNode({
            title: 'Opciones de envío',
            description: `Qhatu pregunta al cliente cómo quiere recibir el pedido y matchea su región con la configuración. Si su región no está cubierta, escala al emprendedor.\n\n${fullShippingText}`,
            node_type: 'step',
            metadata: {
                seed_key: 'ask_shipping_method',
                feeds_from: 'shipping',
                display_bullets: shippingBullets
            }
        })

        if (needsHandoffQuote) {
            addNode({
                title: 'Cotización manual del envío',
                description: 'Qhatu responde "voy a calcular tu envío y te confirmo en breve", emite SHIPPING_QUOTE_REQUEST y pausa la conversación hasta que el emprendedor envíe el monto.',
                node_type: 'handoff',
                metadata: { seed_key: 'handoff_quote' }
            })
            edges.push(['ask_shipping_method', 'handoff_quote', 'Tarifa variable'])
            edges.push(['handoff_quote', FIRST_DATA_KEY, ''])
            edges.push(['ask_shipping_method', FIRST_DATA_KEY, 'Tarifa definida'])
        } else {
            edges.push(['ask_shipping_method', FIRST_DATA_KEY, ''])
        }
    }

    // ── DATOS DEL CLIENTE — un solo nodo con bullets por campo ──────────
    // Cada campo (apellido, nombre, celular, DNI) se pide secuencialmente
    // pero todos viven dentro del mismo nodo. Los bullets muestran la
    // pregunta literal que Qhatu hace al cliente, así el dueño ve el guion.
    currentPhase = 'datos'
    const dataFields: Array<{ field: string; prompt: string }> = [
        { field: 'Apellido', prompt: '"¿Me das tu apellido?"' },
        { field: 'Nombre',   prompt: '"¿Cuál es tu nombre?"' },
        { field: 'Celular',  prompt: '"¿Cuál es tu número de celular? (9 dígitos)"' },
        { field: 'DNI',      prompt: '"¿Me compartes tu DNI? (8 dígitos)"' }
    ]
    addNode({
        title: 'Solicitar datos del cliente',
        description: 'Qhatu pide los datos uno por uno, valida el formato de cada respuesta y solo avanza al siguiente cuando el actual está OK. Si el cliente da varios datos juntos, los captura igual.',
        node_type: 'step',
        metadata: {
            seed_key: 'request_customer_data',
            display_bullets: dataFields.map(f => `${f.field}: ${f.prompt}`)
        }
    })

    // ── PAGOS — un solo nodo con bullets de cada método configurado ─────
    // Bullet = "Nombre (tipo): instrucciones cortas". Description = lista
    // completa con instrucciones literales para que el dueño verifique
    // que coinciden con lo que el bot enviará al cliente.
    currentPhase = 'pago'
    if (paymentMethods.length === 0) {
        addNode({
            title: 'Sin métodos de pago — HANDOFF',
            description: 'No hay métodos de pago configurados. Qhatu escala al emprendedor. Configura tus métodos en "Configura tu Qhatu → Pagos".',
            node_type: 'handoff',
            metadata: { seed_key: 'show_payment_methods', feeds_from: 'payments' }
        })
        edges.push(['request_customer_data', 'show_payment_methods', ''])
        edges.push(['show_payment_methods', 'client_pays', ''])
    } else {
        const PAYMENTS_INLINE = 8
        // Truncar instrucciones para el bullet inline; full en description.
        const paymentBullets = paymentMethods.slice(0, PAYMENTS_INLINE).map((m: any) => {
            const name  = (m.nombre || m.metodo || 'Método').toString().trim()
            const tipo  = (m.tipo || '').toString().trim()
            const instr = (m.instrucciones || '').toString().trim()
            const head  = tipo ? `${name} (${tipo})` : name
            const instrShort = instr.length > 50 ? instr.slice(0, 50).trim() + '…' : instr
            return instrShort ? `${head}: ${instrShort}` : head
        })
        if (paymentMethods.length > PAYMENTS_INLINE) {
            paymentBullets.push(`+ ${paymentMethods.length - PAYMENTS_INLINE} método${paymentMethods.length - PAYMENTS_INLINE === 1 ? '' : 's'} más`)
        }
        // Description con instrucciones literales completas — Qhatu las
        // copia tal cual al cliente, sin inventar números de cuenta.
        const fullPaymentsText = paymentMethods.map((m: any, i: number) => {
            const name  = (m.nombre || m.metodo || 'Método').toString().trim()
            const tipo  = (m.tipo || '').toString().trim()
            const instr = (m.instrucciones || '').toString().trim()
            const head  = tipo ? `${name} (${tipo})` : name
            return `${i + 1}. ${head}${instr ? `\n   Instrucciones: ${instr}` : ''}`
        }).join('\n\n')
        addNode({
            title: 'Mostrar métodos de pago',
            description: `Qhatu presenta los ${paymentMethods.length} método${paymentMethods.length === 1 ? '' : 's'} configurado${paymentMethods.length === 1 ? '' : 's'} y espera que el cliente elija. Envía las instrucciones LITERALES del método elegido — NUNCA inventa números de cuenta.\n\nMÉTODOS CONFIGURADOS:\n${fullPaymentsText}`,
            node_type: 'step',
            metadata: {
                seed_key: 'show_payment_methods',
                feeds_from: 'payments',
                display_bullets: paymentBullets
            }
        })
        edges.push(['request_customer_data', 'show_payment_methods', ''])
        edges.push(['show_payment_methods', 'client_pays', ''])
    }
    addNode({
        title: 'Cliente paga + envía comprobante',
        description: 'El cliente realiza el pago siguiendo las instrucciones literales del método elegido y envía la foto/captura del comprobante. Qhatu detecta la imagen y emite PAYMENT_RECEIPT con los datos del pedido.',
        node_type: 'step',
        metadata: { seed_key: 'client_pays' }
    })
    addNode({
        title: 'Verificación manual del pago',
        description: `Qhatu le dice al cliente: "estamos verificando tu pago, te confirmaremos en breve". El comprobante aparece en el dashboard de ${storeName} para que el emprendedor confirme o rechace desde ahí.`,
        node_type: 'handoff',
        metadata: { seed_key: 'verify_payment' }
    })
    // ── CIERRE ───────────────────────────────────────────────
    currentPhase = 'cierre'
    addNode({ title: '¿Pago confirmado?', description: 'Decisión basada en la acción del emprendedor: confirma → cierre exitoso. Rechaza → el cliente debe enviar nuevo comprobante.', node_type: 'condition', metadata: { seed_key: 'payment_confirmed' } })
    addNode({ title: 'Cierre de la venta', description: `Qhatu confirma al cliente: "¡Gracias por tu compra en ${storeName}! Te informaremos sobre el proceso de envío." El pedido aparece en "Envíos por Crear" del CRM.`, node_type: 'start_end', metadata: { seed_key: 'end' } })

    edges.push(['client_pays', 'verify_payment', ''])
    edges.push(['verify_payment', 'payment_confirmed', ''])
    edges.push(['payment_confirmed', 'end', 'Sí'])
    edges.push(['payment_confirmed', 'client_pays', 'No — reintentar'])

    return { nodes, edges }
}

// Per-bot mutex para serializar seedGenericWorkflow. Sin esto, dos llamadas
// concurrentes (ej. auto-seed desde getWorkflowMap + regenerate desde el save
// de productos) ambas ven "0 generic nodes", deletean nada, y cada una inserta
// los nodos duplicados del seed → terminan con el workflow en columnas duplicadas.
// columnas. La mutex garantiza que solo UN seed corre por bot a la vez.
const _seedLocks: Map<string, Promise<void>> = new Map()

export async function seedGenericWorkflow(botId: string): Promise<void> {
    // Si ya hay un seed corriendo para este bot, espera a que termine.
    const inFlight = _seedLocks.get(botId)
    if (inFlight) {
        console.log(`[seedGenericWorkflow] bot=${botId} waiting for in-flight seed to finish`)
        return inFlight
    }

    const work = (async () => {
        const supabase = getSupabaseClient()

        // 1. Borrar TODOS los nodos generic + sus edges atómicamente, ANTES
        //    de insertar los nuevos. Sin este wipe, llamadas repetidas
        //    acumulan seeds (cada llamada agregaba sus nodos al lado de
        //    los anteriores, produciendo el workflow en columnas duplicadas).
        const { data: existingGenerics } = await supabase
            .from('workflow_nodes')
            .select('id')
            .eq('bot_id', botId)
            .eq('source', 'generic')
        const existingIds = (existingGenerics || []).map((n: any) => n.id)
        if (existingIds.length > 0) {
            await supabase.from('workflow_edges').delete().eq('bot_id', botId).in('from_node_id', existingIds)
            await supabase.from('workflow_edges').delete().eq('bot_id', botId).in('to_node_id', existingIds)
            await supabase.from('workflow_nodes').delete().eq('bot_id', botId).in('id', existingIds)
            console.log(`[seedGenericWorkflow] bot=${botId} wiped ${existingIds.length} stale generic nodes before re-seed`)
        }

        // Nodos custom/learned del usuario: no recrear su seed_key al re-seed.
        // Sin esto, editar "Saludo inicial" (greet) y luego regenerar dejaba
        // un greet generic nuevo encima del custom — la UI mostraba el genérico.
        const { data: preservedNodes } = await supabase
            .from('workflow_nodes')
            .select('id, metadata, source')
            .eq('bot_id', botId)
            .in('source', ['custom', 'learned'])
            .neq('status', 'archived')
        const preservedKeys = new Set<string>()
        const keyToId: Record<string, string> = {}
        for (const row of (preservedNodes || []) as any[]) {
            const key = row?.metadata?.seed_key
            if (typeof key === 'string' && key) {
                preservedKeys.add(key)
                keyToId[key] = row.id
            }
        }
        if (preservedKeys.size > 0) {
            console.log(`[seedGenericWorkflow] bot=${botId} preserving user-owned seed_keys: ${Array.from(preservedKeys).join(', ')}`)
        }

        // 2. Build config-driven seed. Falls back to generic structure if config is empty.
        let seed: { nodes: SeedNodeSpec[]; edges: Array<[string, string, string]> }
        try {
            seed = await buildConfigDrivenSeed(botId)
        } catch (e) {
            console.warn('[workflow-map] buildConfigDrivenSeed failed, using generic fallback:', e)
            seed = { nodes: GENERIC_SEED, edges: GENERIC_SEED_EDGES }
        }
        const rows = seed.nodes
            .filter(n => {
                const key = n.metadata?.seed_key
                return !key || !preservedKeys.has(key)
            })
            .map(n => ({ ...n, bot_id: botId }))

        if (rows.length > 0) {
            // Insert nodes and capture their generated IDs. We need both `id` and
            // `metadata.seed_key` to resolve edges by key (the seed defines them
            // as [fromKey, toKey, label] tuples, not sequential order).
            const { data: inserted, error } = await supabase
                .from('workflow_nodes')
                .insert(rows)
                .select('id, metadata')
            if (error) throw error
            for (const row of (inserted || []) as any[]) {
                const key = row?.metadata?.seed_key
                if (key) keyToId[key] = row.id
            }
        }

        const edges = seed.edges
            .map(([fromKey, toKey, label]) => {
                const from = keyToId[fromKey]
                const to = keyToId[toKey]
                if (!from || !to) return null
                return { bot_id: botId, from_node_id: from, to_node_id: to, label }
            })
            .filter(Boolean) as Array<{ bot_id: string; from_node_id: string; to_node_id: string; label: string }>

        if (edges.length === 0) return

        const { data: existingEdges } = await supabase
            .from('workflow_edges')
            .select('from_node_id, to_node_id')
            .eq('bot_id', botId)
        const existingPairs = new Set(
            (existingEdges || []).map((e: any) => `${e.from_node_id}>${e.to_node_id}`)
        )
        const newEdges = edges.filter(e => !existingPairs.has(`${e.from_node_id}>${e.to_node_id}`))
        if (newEdges.length === 0) return
        const { error: eErr } = await supabase.from('workflow_edges').insert(newEdges)
        if (eErr) console.warn('[workflow-map] seed edges failed:', eErr.message)
    })()

    _seedLocks.set(botId, work)
    try {
        await work
    } finally {
        _seedLocks.delete(botId)
    }
}

// ─── Nodes CRUD ──────────────────────────────────────────────────────

export async function createNode(botId: string, input: Partial<WorkflowNode>): Promise<WorkflowNode> {
    const supabase = getSupabaseClient()
    const row = {
        bot_id: botId,
        title: (input.title || 'Nuevo paso').slice(0, 200),
        description: input.description || '',
        node_type: input.node_type || 'step',
        source: input.source || 'custom',
        status: input.status || 'active',
        order_index: input.order_index ?? 999,
        position_x: input.position_x ?? 400,
        position_y: input.position_y ?? 400,
        metadata: input.metadata || {}
    }
    const { data, error } = await supabase.from('workflow_nodes').insert(row).select().single()
    if (error) throw error
    return data as WorkflowNode
}

export async function updateNode(botId: string, nodeId: string, patch: Partial<WorkflowNode>): Promise<WorkflowNode> {
    const supabase = getSupabaseClient()
    const allowed: Record<string, any> = {}
    const fields: Array<keyof WorkflowNode> = ['title', 'description', 'node_type', 'source', 'status', 'order_index', 'position_x', 'position_y', 'metadata']
    for (const f of fields) if (patch[f] !== undefined) allowed[f] = patch[f]
    // Editing content promotes generic → custom so re-seed no longer wipes it.
    if (patch.title !== undefined || patch.description !== undefined || patch.node_type !== undefined) {
        if (patch.source === undefined || patch.source === 'generic') {
            allowed.source = 'custom'
        }
    }
    const { data, error } = await supabase.from('workflow_nodes')
        .update(allowed)
        .eq('id', nodeId)
        .eq('bot_id', botId)
        .select().single()
    if (error) throw error
    return data as WorkflowNode
}

export async function deleteNode(botId: string, nodeId: string): Promise<void> {
    const supabase = getSupabaseClient()
    const { error } = await supabase.from('workflow_nodes')
        .delete()
        .eq('id', nodeId)
        .eq('bot_id', botId)
    if (error) throw error
}

// ─── Edges CRUD ──────────────────────────────────────────────────────

export async function createEdge(botId: string, fromNodeId: string, toNodeId: string, label: string = ''): Promise<WorkflowEdge> {
    if (fromNodeId === toNodeId) throw new Error('Un nodo no puede conectarse consigo mismo')
    const supabase = getSupabaseClient()
    const { data, error } = await supabase.from('workflow_edges')
        .insert({ bot_id: botId, from_node_id: fromNodeId, to_node_id: toNodeId, label })
        .select().single()
    if (error) {
        // Duplicate edge → treat as idempotent success
        if ((error as any).code === '23505') {
            const { data: existing } = await supabase.from('workflow_edges').select('*')
                .eq('from_node_id', fromNodeId).eq('to_node_id', toNodeId).single()
            if (existing) return existing as WorkflowEdge
        }
        throw error
    }
    return data as WorkflowEdge
}

export async function updateEdge(botId: string, edgeId: string, patch: { label?: string }): Promise<WorkflowEdge> {
    const supabase = getSupabaseClient()
    const allowed: Record<string, any> = {}
    if (patch.label !== undefined) allowed.label = String(patch.label).slice(0, 120)
    const { data, error } = await supabase.from('workflow_edges')
        .update(allowed)
        .eq('id', edgeId)
        .eq('bot_id', botId)
        .select().single()
    if (error) throw error
    return data as WorkflowEdge
}

export async function deleteEdge(botId: string, edgeId: string): Promise<void> {
    const supabase = getSupabaseClient()
    const { error } = await supabase.from('workflow_edges')
        .delete()
        .eq('id', edgeId)
        .eq('bot_id', botId)
    if (error) throw error
}

// ─── Config → Workflow sync helpers ─────────────────────────────────
//
// When the entrepreneur saves shipping or payment config, we rewrite the
// description of the matching generic workflow node so the mind map shows
// the actual configuration (not just the placeholder text). The node is
// found by metadata.feeds_from so title edits don't break the link.

const DEPT_NAME_MAP: Record<string, string> = {
    amazonas: 'Amazonas', ancash: 'Áncash', apurimac: 'Apurímac', arequipa: 'Arequipa',
    ayacucho: 'Ayacucho', cajamarca: 'Cajamarca', callao: 'Callao', cusco: 'Cusco',
    huancavelica: 'Huancavelica', huanuco: 'Huánuco', ica: 'Ica', junin: 'Junín',
    la_libertad: 'La Libertad', lambayeque: 'Lambayeque', lima_metropolitana: 'Lima Metropolitana',
    lima_provincias: 'Lima (Provincias)', loreto: 'Loreto', madre_de_dios: 'Madre de Dios',
    moquegua: 'Moquegua', pasco: 'Pasco', piura: 'Piura', puno: 'Puno',
    san_martin: 'San Martín', tacna: 'Tacna', tumbes: 'Tumbes', ucayali: 'Ucayali'
}

function buildShippingDescription(shipping: any): string {
    if (!shipping) return 'Si aplica, calcula o pregunta por el destino y entrega el costo según la configuración de envíos.'
    const lines: string[] = []

    const groups: any[] = Array.isArray(shipping.groups) ? shipping.groups : []
    if (groups.length > 0) {
        lines.push(`Grupos configurados (${groups.length}):`)
        groups.forEach((g: any, i: number) => {
            const deptNames = (Array.isArray(g.departments) ? g.departments : [])
                .map((code: string) => DEPT_NAME_MAP[code] || code)
            const deptLabel = deptNames.length === 0
                ? '(sin regiones)'
                : deptNames.length > 4
                    ? `${deptNames.slice(0, 4).join(', ')} +${deptNames.length - 4} más`
                    : deptNames.join(', ')
            let costLabel = ''
            if (g.cost_strategy === 'fixed') costLabel = `Tarifa fija S/ ${Number(g.fixed_cost || 0).toFixed(2)}`
            else if (g.cost_strategy === 'free') costLabel = 'Envío gratis'
            else if (g.cost_strategy === 'free_above_threshold') costLabel = `Gratis desde S/ ${Number(g.free_threshold || 0).toFixed(2)}`
            else if (g.cost_strategy === 'variable') costLabel = 'Tarifa variable (cotización manual)'
            const payMap: Record<string, string> = { upfront: 'Pago total al crear', partial: 'Pago parcial', on_delivery: 'Contraentrega' }
            const payLabel = payMap[g.payment_timing] || ''
            const etaLabel = g.delivery_eta ? String(g.delivery_eta).trim() : ''
            const parts = [costLabel, payLabel, etaLabel].filter(Boolean).join(' · ')
            lines.push(`• Grupo ${i + 1} — ${deptLabel}${parts ? ` → ${parts}` : ''}`)
        })
    } else if (shipping.cost_strategy) {
        const strategyLabel: Record<string, string> = {
            free: 'Envío gratis', free_above_threshold: `Gratis desde S/ ${shipping.free_threshold || '—'}`,
            fixed: 'Tarifa fija', variable: 'Tarifa variable (cotización manual)'
        }
        lines.push(strategyLabel[shipping.cost_strategy] || shipping.cost_strategy)
    } else {
        return 'Si aplica, calcula o pregunta por el destino y entrega el costo según la configuración de envíos.'
    }

    const locs: any[] = Array.isArray(shipping.store_pickup_locations) ? shipping.store_pickup_locations : []
    if (shipping.store_pickup_enabled && locs.length > 0) {
        const descLocs = locs.map((l: any, i: number) => {
            const lbl = l.name ? l.name : `Sucursal ${i + 1}`
            return `${lbl}${l.address ? ` (${l.address})` : ''}`
        }).join(', ')
        lines.push(`Recojo en tienda: ${descLocs}`)
    } else if (shipping.store_pickup_enabled && shipping.store_pickup_address) {
        lines.push(`Recojo en tienda: ${shipping.store_pickup_address}`)
    }

    return lines.join('\n')
}

function buildPaymentsDescription(methods: any[]): string {
    const active = (Array.isArray(methods) ? methods : []).filter((m: any) => m && (m.activo !== false))
    if (active.length === 0) {
        return 'Al recibir comprobante, añade [PAYMENT_RECEIPT: {amount, method}]. Informa próximos pasos.'
    }
    const lines = [`Métodos de pago activos (${active.length}):`]
    for (const m of active) {
        const name = (m.nombre || m.metodo || m.name || m.tipo || 'Método').toString().trim()
        const tipo = (m.tipo || m.type || '').toString().trim()
        const instr = (m.instrucciones || m.instructions || '').toString().trim()
        let line = `• ${name}`
        if (tipo && tipo.toLowerCase() !== name.toLowerCase()) line += ` (${tipo})`
        if (instr) line += ` — ${instr.slice(0, 80)}${instr.length > 80 ? '…' : ''}`
        lines.push(line)
    }
    lines.push('Al recibir comprobante, añade [PAYMENT_RECEIPT: {amount, method}] y confirma próximos pasos.')
    return lines.join('\n')
}

// Find the first active workflow node for `botId` whose metadata.feeds_from
// matches the given feed ("shipping" | "payments"). Returns null if none.
async function findFeedNode(botId: string, feed: 'shipping' | 'payments'): Promise<{ id: string; source: string } | null> {
    const supabase = getSupabaseClient()
    const { data, error } = await supabase
        .from('workflow_nodes')
        .select('id, source, metadata, order_index')
        .eq('bot_id', botId)
        .order('order_index', { ascending: true })
    if (error || !Array.isArray(data)) return null
    const hit = data.find((n: any) => n?.metadata?.feeds_from === feed)
    return hit ? { id: hit.id, source: hit.source } : null
}

// Ensure the workflow exists for this bot. Normally getWorkflowMap() auto-seeds
// on first access, but the user might save shipping/payments before ever
// opening the workflow view or sending a message. Trigger the seed here so
// the sync helpers always have a node to update.
async function ensureWorkflowSeeded(botId: string): Promise<void> {
    const supabase = getSupabaseClient()
    // Fetch one row explicitly — earlier versions used `head: true` which never
    // returned data and caused repeated seeding on every sync call.
    const { data, error } = await supabase
        .from('workflow_nodes')
        .select('id')
        .eq('bot_id', botId)
        .limit(1)
    if (error) return
    if (!data || data.length === 0) {
        try { await seedGenericWorkflow(botId) } catch (_) { /* ignore */ }
    }
}

// Sync the saved shipping config into the workflow. Regenera todos los nodos
// generic (source='generic') con la config nueva — los nodos custom del usuario
// (source='custom' o 'learned') se preservan. Esto garantiza que el workflow
// refleje SIEMPRE la configuración real: regiones, payment_timing, ETA,
// agencias, sucursales de pickup, todo. Antes solo actualizaba la description
// y los bullets del nodo quedaban desactualizados.
export async function syncShippingToWorkflow(botId: string, _shipping: any): Promise<void> {
    try {
        await seedGenericWorkflow(botId)
    } catch (e: any) {
        console.warn('[workflow-sync] syncShippingToWorkflow failed:', e?.message || e)
    }
}

// Same idea para payments — regenera para que cada método aparezca con su
// nombre + tipo + instrucciones literales en los bullets del nodo.
export async function syncPaymentsToWorkflow(botId: string, _methods: any[]): Promise<void> {
    try {
        await seedGenericWorkflow(botId)
    } catch (e: any) {
        console.warn('[workflow-sync] syncPaymentsToWorkflow failed:', e?.message || e)
    }
}

// ─── Learning hook (called from notification confirmation flow) ──────

export async function addLearnedNode(botId: string, title: string, description: string, metadata: Record<string, any> = {}): Promise<WorkflowNode> {
    return createNode(botId, {
        title, description,
        node_type: 'step',
        source: 'learned',
        status: 'pending_confirmation',
        order_index: 900,
        position_x: 500,
        position_y: 500,
        metadata: { ...metadata, learned_at: new Date().toISOString() }
    })
}

// ─── Prompt serialization — consumed by bot-manager.ts ──────────────

export async function serializeMapToPrompt(botId: string): Promise<string> {
    let map
    try {
        map = await getWorkflowMap(botId)
    } catch (e) {
        console.warn('[workflow-map] serialize failed, falling back:', (e as any)?.message || e)
        return ''
    }
    const nodes = (map.nodes || []).filter(n => n.status === 'active')
    if (nodes.length === 0) return ''

    const byId: Record<string, WorkflowNode> = {}
    nodes.forEach(n => { byId[n.id] = n })

    const outgoing: Record<string, WorkflowEdge[]> = {}
    for (const e of map.edges) {
        if (!byId[e.from_node_id] || !byId[e.to_node_id]) continue
        if (!outgoing[e.from_node_id]) outgoing[e.from_node_id] = []
        outgoing[e.from_node_id].push(e)
    }

    const sorted = [...nodes].sort((a, b) => (a.order_index - b.order_index) || a.title.localeCompare(b.title))
    let text = `\n\nWORKFLOW DEL KIPU (definido por el emprendedor en el mapa mental — máxima prioridad):\n`
    sorted.forEach((n, i) => {
        text += `\n${i + 1}. ${n.title}`
        if (n.description?.trim()) text += `\n   ${n.description.trim()}`
        // Inject live data so the bot knows about actual products, shipping
        // strategy and payment methods configured by the emprendedor.
        if (n.live) {
            text += `\n   Data: ${n.live.summary}`
            if (n.live.chips && n.live.chips.length > 0) {
                const items = n.live.chips
                    .map(c => c.meta ? `${c.label} (${c.meta})` : c.label)
                    .join(', ')
                text += `\n   Detalle: ${items}`
            }
        }
        const outs = outgoing[n.id] || []
        if (outs.length > 0) {
            const links = outs
                .map(e => `"${byId[e.to_node_id].title}"${e.label ? ` (${e.label})` : ''}`)
                .join(', ')
            text += `\n   → Siguiente: ${links}`
        }
    })

    const pending = (map.nodes || []).filter(n => n.status === 'pending_confirmation')
    if (pending.length > 0) {
        text += `\n\n[NODOS APRENDIDOS PENDIENTES — úsalos con cautela, el emprendedor aún no los confirmó]:`
        pending.forEach(n => { text += `\n- ${n.title}: ${n.description}` })
    }
    return text
}

// ─── Read helper for bot-manager: returns whether a map exists ──────

export async function botHasWorkflowMap(botId: string): Promise<boolean> {
    const supabase = getSupabaseClient()
    const { count, error } = await supabase.from('workflow_nodes')
        .select('id', { count: 'exact', head: true })
        .eq('bot_id', botId)
        .eq('status', 'active')
    if (error) return false
    return (count ?? 0) > 0
}

// ═══════════════════════════════════════════════════════════════════════════
// Import desde documento (PDF / DOCX)
// ═══════════════════════════════════════════════════════════════════════════
//
// Recibe un buffer ya VALIDADO (magic bytes + extensión + size — ver
// src/utils/file-security.ts), extrae el texto, le pide al LLM que derive
// nodos+edges del workflow descrito, y reemplaza el workflow actual. Tiene
// caps duros para evitar abuso y validación estricta del JSON de salida.

const IMPORT_DOC_MAX_TEXT_CHARS = 50_000   // tope de input al LLM (cost guard)
const IMPORT_DOC_MAX_NODES = 60            // tope de nodos creables por import
const IMPORT_DOC_MAX_EDGES = 200           // tope de edges creables por import
const IMPORT_DOC_NODE_TYPES = new Set(['start_end', 'step', 'process', 'condition', 'handoff', 'config_requirement', 'action', 'note'])

interface ParsedNode {
    tempId: string
    title: string
    description: string
    node_type: string
    order_index: number
}

interface ParsedEdge {
    fromTempId: string
    toTempId: string
    label: string
}

async function extractTextFromDocument(buffer: Buffer, kind: 'pdf' | 'docx'): Promise<string> {
    if (kind === 'pdf') {
        // pdf-parse@2.x cambió de función default a clase `PDFParse`.
        // Convertir Buffer → Uint8Array para evitar incompatibilidades con
        // pdfjs-dist (que internamente usa typed arrays).
        const pdfMod = await import('pdf-parse') as any
        const PDFParse = pdfMod.PDFParse || pdfMod.default?.PDFParse || pdfMod.default
        if (!PDFParse) throw new Error('pdf-parse: no se pudo cargar el constructor PDFParse.')
        const data = new Uint8Array(buffer)
        const parser = new PDFParse({ data })
        try {
            const result = await parser.getText()
            return String(result?.text || '').trim()
        } finally {
            try { await parser.destroy?.() } catch { /* best-effort */ }
        }
    }
    if (kind === 'docx') {
        const mammothMod = await import('mammoth') as any
        const mammoth = mammothMod.default || mammothMod
        const result = await mammoth.extractRawText({ buffer })
        return String(result?.value || '').trim()
    }
    throw new Error('Tipo de documento no soportado.')
}

function parseAndValidateLLMOutput(rawJson: string): { nodes: ParsedNode[]; edges: ParsedEdge[] } {
    let parsed: any
    try {
        parsed = JSON.parse(rawJson)
    } catch {
        throw new Error('El modelo no devolvió un JSON válido.')
    }
    if (!parsed || typeof parsed !== 'object') {
        throw new Error('Respuesta del modelo malformada.')
    }
    const rawNodes = Array.isArray(parsed.nodes) ? parsed.nodes : []
    const rawEdges = Array.isArray(parsed.edges) ? parsed.edges : []
    if (rawNodes.length === 0) {
        throw new Error('El documento no contiene un workflow reconocible (no se identificaron pasos).')
    }
    if (rawNodes.length > IMPORT_DOC_MAX_NODES) {
        throw new Error(`El documento describe demasiados pasos (${rawNodes.length}). Máximo ${IMPORT_DOC_MAX_NODES}.`)
    }
    if (rawEdges.length > IMPORT_DOC_MAX_EDGES) {
        throw new Error(`El documento tiene demasiadas conexiones (${rawEdges.length}). Máximo ${IMPORT_DOC_MAX_EDGES}.`)
    }

    const seenIds = new Set<string>()
    const nodes: ParsedNode[] = []
    for (const n of rawNodes) {
        if (!n || typeof n !== 'object') continue
        const tempId = String(n.id || n.tempId || '').trim()
        if (!tempId || seenIds.has(tempId)) continue
        seenIds.add(tempId)
        const node_type = IMPORT_DOC_NODE_TYPES.has(String(n.node_type)) ? String(n.node_type) : 'step'
        nodes.push({
            tempId,
            title: String(n.title || 'Paso sin título').slice(0, 200),
            description: String(n.description || '').slice(0, 2000),
            node_type,
            order_index: Number.isFinite(Number(n.order_index)) ? Number(n.order_index) : nodes.length,
        })
    }
    if (nodes.length === 0) {
        throw new Error('El modelo no devolvió nodos válidos.')
    }

    const edges: ParsedEdge[] = []
    for (const e of rawEdges) {
        if (!e || typeof e !== 'object') continue
        const fromTempId = String(e.from || e.from_node_id || e.fromTempId || '').trim()
        const toTempId = String(e.to || e.to_node_id || e.toTempId || '').trim()
        if (!fromTempId || !toTempId || fromTempId === toTempId) continue
        if (!seenIds.has(fromTempId) || !seenIds.has(toTempId)) continue
        edges.push({
            fromTempId,
            toTempId,
            label: String(e.label || '').slice(0, 120),
        })
    }
    return { nodes, edges }
}

/**
 * Importa un workflow descrito en un PDF o Word. Reemplaza el workflow actual
 * del bot con la estructura derivada por el LLM.
 *
 * SEGURIDAD: el caller DEBE haber validado el buffer con
 * `validateDocumentUpload()` ANTES de llamar acá. Esta función confía en que:
 *  - El buffer es PDF o DOCX real (magic bytes verificados)
 *  - El tamaño está bajo el cap
 *  - El nombre ya está sanitizado
 *  - El usuario tiene permiso sobre `botId` (verificado en el endpoint con el
 *    middleware de auth + lookup de bot_configs.userId)
 *
 * Esta función agrega:
 *  - Cap del texto extraído (no mandamos megas al LLM)
 *  - Validación estricta del JSON de salida (fields, tipos, longitudes)
 *  - Caps en cantidad de nodos/edges
 *  - Reemplazo transaccional (delete viejo + insert nuevo) — si insert falla,
 *    el workflow puede quedar parcial; el caller debe reintentar.
 */
export async function importWorkflowFromDocument(opts: {
    botId: string
    buffer: Buffer
    kind: 'pdf' | 'docx'
}): Promise<{ nodesCreated: number; edgesCreated: number }> {
    const { botId, buffer, kind } = opts

    // 1. Extraer texto
    let extracted = await extractTextFromDocument(buffer, kind)
    if (!extracted) {
        throw new Error('No se pudo extraer texto del documento. ¿Está protegido o vacío?')
    }
    if (extracted.length > IMPORT_DOC_MAX_TEXT_CHARS) {
        extracted = extracted.substring(0, IMPORT_DOC_MAX_TEXT_CHARS)
        console.log(`[ImportDoc] texto truncado a ${IMPORT_DOC_MAX_TEXT_CHARS} chars (original más largo)`)
    }

    // 2. Llamar al LLM con schema JSON estricto
    const { default: OpenAIClient } = await import('openai') as any
    const openai = new OpenAIClient({ apiKey: process.env.OPENAI_API_KEY })
    const systemPrompt = `Eres un analista que convierte la descripción textual de un workflow de atención de un bot de WhatsApp en un grafo estructurado.
Tu salida DEBE ser un objeto JSON con exactamente estas dos claves:
  - "nodes": array de nodos (máximo ${IMPORT_DOC_MAX_NODES})
  - "edges": array de conexiones entre nodos (máximo ${IMPORT_DOC_MAX_EDGES})

Cada nodo tiene:
  { "id": "<id corto único, ej: 'n1'>", "title": "<máx 80 chars>", "description": "<máx 500 chars>", "node_type": "<uno de: start_end | step | condition | handoff | config_requirement>", "order_index": <entero> }

Cada edge tiene:
  { "from": "<id de nodo>", "to": "<id de nodo>", "label": "<máx 60 chars, opcional>" }

Reglas:
  • Crea exactamente UN nodo "start_end" inicial (saludo) y UNO final (cierre).
  • Usa "condition" para decisiones del cliente (ej. "¿quiere envío o recojo?").
  • Usa "handoff" cuando el bot deriva a un humano.
  • Usa "config_requirement" para pasos que dependen de integraciones externas (ej. cotización Shalom).
  • El resto son "step" (mensajes informativos, captura de datos, etc.).
  • Los ids deben ser únicos. Las edges solo pueden referenciar ids existentes.
  • NO inventes pasos que no estén en el documento. Si el documento es ambiguo, pon menos nodos antes que más.
  • Devuelve SOLO el JSON, sin markdown, sin explicación.`

    const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Documento (PDF/Word) del emprendedor:\n\n---\n${extracted}\n---\n\nDevuelve el JSON con nodes y edges.` }
        ],
        max_tokens: 4000,
        temperature: 0.1,
    })
    const raw = completion?.choices?.[0]?.message?.content || '{}'
    const { nodes, edges } = parseAndValidateLLMOutput(raw)

    // 3. Reemplazar workflow actual
    const supabase = getSupabaseClient()
    // Delete edges primero (FK), luego nodes
    await supabase.from('workflow_edges').delete().eq('bot_id', botId)
    await supabase.from('workflow_nodes').delete().eq('bot_id', botId)

    // Insertar nodos en orden, capturando mapping tempId → uuid real.
    // Posición = (0, 0) intencional: el editor del dashboard detecta este
    // estado vía `needsAutoLayout(nodes)` (mindmap.js:657) y dispara su
    // layout Dagre jerárquico (rankDir TB, nodeSep 140, rankSep 180), que
    // arma el grafo basado en las EDGES — no en el orden de inserción —
    // y persiste las posiciones calculadas. Para 15+ nodos esto da un
    // layout limpio y legible. Si setearamos una grilla acá, dagre no
    // se dispararía y las flechas se cruzarían en zigzag.
    const idMap: Record<string, string> = {}
    let nodesCreated = 0
    for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i]
        const created = await createNode(botId, {
            title: n.title,
            description: n.description,
            node_type: n.node_type as WorkflowNode['node_type'],
            source: 'custom',
            status: 'active',
            order_index: n.order_index,
            position_x: 0,
            position_y: 0,
            metadata: { imported_from: 'document' },
        })
        idMap[n.tempId] = created.id
        nodesCreated++
    }

    // Insertar edges
    let edgesCreated = 0
    for (const e of edges) {
        const fromUuid = idMap[e.fromTempId]
        const toUuid = idMap[e.toTempId]
        if (!fromUuid || !toUuid) continue
        try {
            await createEdge(botId, fromUuid, toUuid, e.label)
            edgesCreated++
        } catch (err: any) {
            // Skip duplicates / FK errors silently — no debemos abortar todo
            // el import por una edge problemática.
            console.warn(`[ImportDoc] edge skip (${e.fromTempId}→${e.toTempId}):`, err?.message || err)
        }
    }

    return { nodesCreated, edgesCreated }
}

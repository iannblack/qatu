// ═══════════════════════════════════════════════════════════════════════════
// workflow-example.service.ts
// ───────────────────────────────────────────────────────────────────────────
// Genera y cachea un "ejemplo de respuesta al cliente" por nodo del workflow.
// El bot real (bot-manager.ts) NO usa esta función — solo es UX del editor:
// muestra al dueño una aproximación de lo que el LLM diría en cada paso.
//
// Cache en BD (workflow_nodes.example_message + inputs_hash + generated_at):
//   - Si el hash de inputs sigue válido y no hay config_updated_at posterior,
//     se devuelve el cacheado.
//   - Si cambió title/description/config relevante → re-genera.
//
// Rate limit en memoria: 5 generaciones por bot por minuto. Suficiente para
// uso normal de un dueño abriendo nodos. Si se excede → error claro 429.
// ═══════════════════════════════════════════════════════════════════════════
import OpenAI from 'openai'
import crypto from 'crypto'
import { getSupabaseClient } from './db.service'

// ─── In-memory rate limiter ────────────────────────────────────────────────
const RATE_WINDOW_MS = 60_000
const RATE_MAX_OPS = 5
const rateLimitMap = new Map<string, number[]>()

function checkRateLimit(botId: string): boolean {
    const now = Date.now()
    const list = (rateLimitMap.get(botId) || []).filter(t => now - t < RATE_WINDOW_MS)
    if (list.length >= RATE_MAX_OPS) {
        rateLimitMap.set(botId, list)
        return false
    }
    list.push(now)
    rateLimitMap.set(botId, list)
    return true
}

// ─── Tipos ─────────────────────────────────────────────────────────────────
export interface ExampleResult {
    example: string | null
    inputsHash: string
    generatedAt: Date
    error?: string
}

export interface GetExampleResult {
    example: string | null
    cached: boolean
    generatedAt: string | null
    error?: string
}

// ─── Helpers privados ──────────────────────────────────────────────────────

// Hash determinístico de los inputs relevantes para el ejemplo. Si alguno
// cambia (título del nodo, descripción, type, nombre tienda, productos top,
// métodos de pago, shipping config), el hash difiere y se regenera.
function computeInputsHash(parts: Record<string, string>): string {
    const concat = Object.entries(parts)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join('|')
    return crypto.createHash('sha256').update(concat).digest('hex')
}

interface BotContext {
    storeName: string
    rubro: string
    products: any[]
    productsList: string
    payments: string
    shippingSummary: string
}

async function loadBotContext(botId: string): Promise<BotContext> {
    const supabase = getSupabaseClient()
    const [botRes, bizRes] = await Promise.all([
        supabase.from('bot_configs').select('bot_name,tienda').eq('id', botId).maybeSingle(),
        supabase.from('business_info').select('products,payment_methods_structured,shipping_config').eq('bot_id', botId).maybeSingle()
    ])
    const bot: any = (botRes as any).data || {}
    const biz: any = (bizRes as any).data || {}

    const storeName: string = bot.tienda?.nombre || bot.bot_name || 'la tienda'
    const rubro: string = bot.tienda?.rubro || 'general'
    const products: any[] = Array.isArray(biz.products) ? biz.products.slice(0, 3) : []
    const productsList = products.length > 0
        ? products.map(p => {
            const name = p.name || p.nombre || 'Producto'
            const price = p.price ?? p.precio
            return price !== undefined && price !== null
                ? `${name} (S/ ${price})`
                : name
        }).join(', ')
        : 'sin productos configurados aún'
    const paymentsArr: any[] = Array.isArray(biz.payment_methods_structured)
        ? biz.payment_methods_structured.filter((m: any) => m.activo !== false)
        : []
    const payments = paymentsArr.length > 0
        ? paymentsArr.map((m: any) => m.nombre || m.metodo).filter(Boolean).join(', ')
        : 'sin métodos configurados aún'
    const sc = biz.shipping_config || {}
    const shippingSummary = (() => {
        const groups = Array.isArray(sc.groups) ? sc.groups.length : 0
        const pickup = Array.isArray(sc.store_pickup_locations)
            ? sc.store_pickup_locations.filter((l: any) => (l?.address || '').trim().length > 0).length
            : 0
        if (groups === 0 && pickup === 0) return 'sin envíos configurados'
        const parts = []
        if (groups > 0) parts.push(`${groups} grupo${groups > 1 ? 's' : ''} de envío`)
        if (pickup > 0) parts.push(`${pickup} sucursal${pickup > 1 ? 'es' : ''} de recojo`)
        return parts.join(' + ')
    })()

    return { storeName, rubro, products, productsList, payments, shippingSummary }
}

function buildHashFromInputs(node: any, ctx: BotContext): string {
    return computeInputsHash({
        title: node.title || '',
        description: node.description || '',
        node_type: node.node_type || '',
        storeName: ctx.storeName,
        productsSummary: JSON.stringify(ctx.products).slice(0, 100),
        payments: ctx.payments,
        shipping: ctx.shippingSummary
    })
}

function buildPrompt(node: any, ctx: BotContext): string {
    return `Eres el bot de WhatsApp del negocio "${ctx.storeName}".
Contexto del negocio:
- Rubro: ${ctx.rubro}
- Productos principales: ${ctx.productsList}
- Métodos de pago: ${ctx.payments}
- Envíos: ${ctx.shippingSummary}

Estás en este paso de la conversación:
- Tipo: ${node.node_type}
- Título: ${node.title}
- Instrucción: ${node.description || '(sin instrucción detallada)'}

Genera UN SOLO mensaje de ejemplo que enviarías al cliente en este paso.
- Tono natural, cálido, peruano (usa "tú" no "usted").
- Incluye emojis con moderación si aplica al contexto.
- Si el paso requiere datos del cliente, asume valores de ejemplo realistas.
- NO incluyas explicaciones, solo el mensaje literal.
- Máximo 3 líneas.`
}

// ─── API pública ───────────────────────────────────────────────────────────

// Genera un ejemplo nuevo (ignora cache) y lo persiste. Respeta rate limit.
export async function generateExampleForNode(
    botId: string,
    nodeId: string
): Promise<ExampleResult> {
    if (!checkRateLimit(botId)) {
        return {
            example: null, inputsHash: '', generatedAt: new Date(),
            error: 'rate_limit_exceeded'
        }
    }

    const supabase = getSupabaseClient()
    const { data: node, error: nodeErr } = await supabase
        .from('workflow_nodes')
        .select('id,title,description,node_type,metadata')
        .eq('id', nodeId)
        .eq('bot_id', botId)
        .maybeSingle()
    if (nodeErr || !node) {
        return {
            example: null, inputsHash: '', generatedAt: new Date(),
            error: 'node_not_found'
        }
    }

    let ctx: BotContext
    try {
        ctx = await loadBotContext(botId)
    } catch (e: any) {
        return {
            example: null, inputsHash: '', generatedAt: new Date(),
            error: 'context_load_failed: ' + (e?.message || 'unknown')
        }
    }

    const prompt = buildPrompt(node, ctx)
    const inputsHash = buildHashFromInputs(node, ctx)

    let example = ''
    try {
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 200,
            temperature: 0.7
        })
        example = (completion.choices[0]?.message?.content || '').trim()
    } catch (e: any) {
        console.warn('[workflow-example] OpenAI error:', e?.message)
        return {
            example: null, inputsHash: '', generatedAt: new Date(),
            error: 'openai_failed: ' + (e?.message || 'unknown')
        }
    }

    if (!example) {
        return {
            example: null, inputsHash: '', generatedAt: new Date(),
            error: 'empty_response'
        }
    }

    const generatedAt = new Date()
    const { error: updErr } = await supabase
        .from('workflow_nodes')
        .update({
            example_message: example,
            example_generated_at: generatedAt.toISOString(),
            example_inputs_hash: inputsHash
        })
        .eq('id', nodeId)
        .eq('bot_id', botId)
    if (updErr) {
        console.warn('[workflow-example] DB update failed:', updErr.message)
        // Devolvemos el ejemplo igual — no se cachea pero sirve para esta sesión.
    }

    return { example, inputsHash, generatedAt }
}

// Lee el cache si está vigente (hash actual coincide y config no cambió),
// si no, regenera. Devuelve el ejemplo + flag cached.
export async function getOrGenerateExample(
    botId: string,
    nodeId: string
): Promise<GetExampleResult> {
    const supabase = getSupabaseClient()
    const { data: node, error } = await supabase
        .from('workflow_nodes')
        .select('id,title,description,node_type,metadata,example_message,example_generated_at,example_inputs_hash')
        .eq('id', nodeId)
        .eq('bot_id', botId)
        .maybeSingle()
    if (error || !node) {
        return { example: null, cached: false, generatedAt: null, error: 'node_not_found' }
    }

    const hasCache = !!(node.example_message && node.example_inputs_hash && node.example_generated_at)
    if (hasCache) {
        try {
            const ctx = await loadBotContext(botId)
            const expectedHash = buildHashFromInputs(node, ctx)
            const hashMatches = expectedHash === node.example_inputs_hash
            const stale = await isExampleStale(botId, node.example_generated_at)
            if (hashMatches && !stale) {
                return {
                    example: node.example_message,
                    cached: true,
                    generatedAt: node.example_generated_at
                }
            }
        } catch (e: any) {
            // si falla la validación de cache, simplemente regeneramos
            console.warn('[workflow-example] cache validation failed:', e?.message)
        }
    }

    // (Re)generate
    const r = await generateExampleForNode(botId, nodeId)
    if (r.error) {
        // Si regeneración falló pero tenemos cache viejo, devolverlo como fallback.
        if (hasCache) {
            return {
                example: node.example_message,
                cached: true,
                generatedAt: node.example_generated_at,
                error: r.error
            }
        }
        return { example: null, cached: false, generatedAt: null, error: r.error }
    }
    return {
        example: r.example,
        cached: false,
        generatedAt: r.generatedAt.toISOString()
    }
}

async function isExampleStale(botId: string, generatedAt: string | null): Promise<boolean> {
    if (!generatedAt) return true
    const supabase = getSupabaseClient()
    const { data, error } = await supabase
        .from('bot_configs')
        .select('config_updated_at')
        .eq('id', botId)
        .maybeSingle()
    if (error || !data || !(data as any).config_updated_at) return false
    const cfgTs = new Date((data as any).config_updated_at).getTime()
    const genTs = new Date(generatedAt).getTime()
    return cfgTs > genTs
}

// Limpia el cache de un nodo. Llamar tras editar title/description.
export async function clearExampleCache(botId: string, nodeId: string): Promise<void> {
    const supabase = getSupabaseClient()
    await supabase
        .from('workflow_nodes')
        .update({
            example_message: null,
            example_generated_at: null,
            example_inputs_hash: null
        })
        .eq('id', nodeId)
        .eq('bot_id', botId)
}

// Dispara el "config_updated_at = now()" para que todos los ejemplos del bot
// queden marcados como stale. Llamar desde los endpoints de save de productos,
// shipping, payments, identidad.
export async function touchBotConfigUpdatedAt(botId: string): Promise<void> {
    const supabase = getSupabaseClient()
    await supabase
        .from('bot_configs')
        .update({ config_updated_at: new Date().toISOString() })
        .eq('id', botId)
}

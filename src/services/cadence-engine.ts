/**
 * cadence-engine.ts — Automated Cadence System (Supabase)
 * 
 * Two parallel cadences:
 * A) LEAD_FOLLOWUP: pre-sale nurturing based on lead score (hot vs cold)
 * B) POST_SALE: post-purchase sequence from delivery date
 * 
 * All cadences are automatic. Owner can only pause from dashboard.
 */

import { getDB, ObjectId } from './db.service'

// ════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════

export type CadenceType = 'LEAD_FOLLOWUP' | 'POST_SALE' | 'THINKING_IT_OVER'
export type CadenceStatus = 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'OPTED_OUT' | 'ARCHIVED'
export type StepStatus = 'PENDING' | 'SENT' | 'SKIPPED'

export interface CadenceStep {
    stepId: string
    label: string
    delayMs: number
    scheduledFor: Date
    status: StepStatus
    promptTemplate: string
    sentAt?: Date
    sentText?: string
}

export interface Cadence {
    id?: string
    bot_id: string
    phone: string
    channel: string
    type: CadenceType
    status: CadenceStatus
    score_at_creation: number
    product_context: string
    product_category: string
    is_from_ad: boolean
    steps: CadenceStep[]
    current_step_index: number
    order_data?: {
        orderId?: string
        items: string
        name: string
        deliveryDate?: Date
        isConsumable?: boolean
    }
    created_at: Date | string
    updated_at: Date | string
    completed_at?: Date | string | null
    last_lead_message_at?: Date | string | null
    reactivation_count: number
}

// ════════════════════════════════════════════════
// CONSTANTS
// ════════════════════════════════════════════════

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const FEEDBACK_DELAY_BY_CATEGORY: Record<string, number> = {
    'alimentos': 1, 'reposteria': 1, 'restaurante': 1,
    'ropa': 5, 'accesorios': 5, 'electronicos': 10,
    'hogar': 7, 'skincare': 17, 'belleza': 17,
    'suplementos': 25, 'salud': 25, 'servicios': 0, 'default': 5,
}

// ════════════════════════════════════════════════
// OPT-OUT DETECTION
// ════════════════════════════════════════════════

const OPT_OUT_PATTERNS = [
    /\b(para|stop|basta|no\s+me\s+escribas|no\s+me\s+mandes|dejen\s+de\s+escribir|no\s+quiero\s+más|cancelar?\s+mensajes?|desuscribir)/i,
    /\b(unsubscribe|opt[\s-]?out)\b/i,
]

export function checkOptOut(text: string): boolean {
    return OPT_OUT_PATTERNS.some(p => p.test(text))
}

// ════════════════════════════════════════════════
// "LO PENSARÉ" DETECTION — triggers 5h follow-up cadence
// ════════════════════════════════════════════════

// Frases que expresan "dame tiempo / te digo luego" en el español usado por
// clientes peruanos. Cubre las variaciones más comunes sin ser tan laxas como
// para capturar "pensaré si tengo dinero mañana" (mantenemos el verbo pensar
// en infinitivo o presente ligado a la decisión del pedido).
// Nota: JavaScript `\b` no aplica después de caracteres acentuados (é, á, etc.)
// porque el word-boundary de JS es solo ASCII. Usamos (?!\w) como cierre para
// que "lo pensaré" matchee igual que "lo pensare".
const THINKING_IT_OVER_PATTERNS = [
    /\blo\s+pensar[eé](?!\w)/i,
    /\blo\s+voy\s+a\s+pensar(?!\w)/i,
    /\bd[ée]jame\s+pensar(?:lo)?(?!\w)/i,
    /\bd[ée]jame\s+ver(?:lo)?(?!\w)/i,
    /\bme\s+lo\s+pienso(?!\w)/i,
    /\btengo\s+que\s+pensarlo(?!\w)/i,
    /\blo\s+consultar[eé](?!\w)/i,
    /\bte\s+(?:digo|aviso|confirmo)\s+(?:luego|despu[eé]s|m[aá]s\s+tarde|ma[ñn]ana)(?!\w)/i,
]

export function detectThinkingItOver(text: string): boolean {
    if (!text) return false
    return THINKING_IT_OVER_PATTERNS.some(p => p.test(text))
}

// ════════════════════════════════════════════════
// PRODUCT CATEGORY DETECTION
// ════════════════════════════════════════════════

const CATEGORY_KEYWORDS: Record<string, RegExp> = {
    'alimentos': /comida|alimento|snack|galleta|pan|cereal|café|te\b|bebida|jugo/i,
    'reposteria': /torta|pastel|cupcake|brownie|postre|dulce|cheesecake|panetón/i,
    'restaurante': /menú|plato|cena|almuerzo|comida|sushi|pizza|hamburguesa/i,
    'ropa': /polo|camisa|pantalón|vestido|falda|ropa|jean|short|blusa|casaca/i,
    'accesorios': /collar|pulsera|arete|anillo|bolso|cartera|reloj|lente|gorra/i,
    'electronicos': /celular|laptop|tablet|audífono|cargador|cable|parlante|cámara/i,
    'hogar': /mueble|silla|mesa|cojín|cortina|lámpara|decoración|alfombra/i,
    'skincare': /crema|sérum|protector|mascarilla|tónico|limpiador|skincare/i,
    'belleza': /maquillaje|labial|base|polvo|rímel|shampoo|acondicionador/i,
    'suplementos': /vitamina|proteína|suplemento|colágeno|omega|magnesio/i,
    'salud': /medicamento|pastilla|jarabe|termómetro|tensiómetro/i,
    'servicios': /servicio|consulta|sesión|clase|curso|taller|asesoría/i,
}

export function getProductCategory(productName: string): string {
    const lower = productName.toLowerCase()
    for (const [cat, regex] of Object.entries(CATEGORY_KEYWORDS)) {
        if (regex.test(lower)) return cat
    }
    return 'default'
}

// ════════════════════════════════════════════════
// CADENCE CREATION — LEAD FOLLOWUP
// ════════════════════════════════════════════════

export function createLeadFollowupSteps(score: number, isFromAd: boolean, productContext: string, now: Date): CadenceStep[] {
    const isHot = score >= 51 || isFromAd
    if (isHot) {
        return [
            { stepId: 'HOT_H1', label: 'Recomendación personalizada + foto', delayMs: 2 * HOUR, scheduledFor: new Date(now.getTime() + 2 * HOUR), status: 'PENDING', promptTemplate: 'hot_recommendation' },
            { stepId: 'HOT_D1', label: 'Contenido de valor (tip de uso)', delayMs: 1 * DAY, scheduledFor: new Date(now.getTime() + 1 * DAY), status: 'PENDING', promptTemplate: 'hot_value_content' },
            { stepId: 'HOT_D3', label: 'Prueba social / testimonial', delayMs: 3 * DAY, scheduledFor: new Date(now.getTime() + 3 * DAY), status: 'PENDING', promptTemplate: 'hot_social_proof' },
            { stepId: 'HOT_D7', label: 'Oferta suave / descuento limitado', delayMs: 7 * DAY, scheduledFor: new Date(now.getTime() + 7 * DAY), status: 'PENDING', promptTemplate: 'hot_soft_offer' },
            { stepId: 'HOT_CLOSE', label: 'Mensaje de cierre', delayMs: 10 * DAY, scheduledFor: new Date(now.getTime() + 10 * DAY), status: 'PENDING', promptTemplate: 'closing_message' },
        ]
    } else {
        return [
            { stepId: 'COLD_D1', label: 'Contenido educativo', delayMs: 1 * DAY, scheduledFor: new Date(now.getTime() + 1 * DAY), status: 'PENDING', promptTemplate: 'cold_educational' },
            { stepId: 'COLD_D5', label: 'Nuevo ángulo del producto', delayMs: 5 * DAY, scheduledFor: new Date(now.getTime() + 5 * DAY), status: 'PENDING', promptTemplate: 'cold_new_angle' },
            { stepId: 'COLD_D14', label: 'Oferta o novedad del catálogo', delayMs: 14 * DAY, scheduledFor: new Date(now.getTime() + 14 * DAY), status: 'PENDING', promptTemplate: 'cold_offer' },
            { stepId: 'COLD_D28', label: 'Último intento', delayMs: 28 * DAY, scheduledFor: new Date(now.getTime() + 28 * DAY), status: 'PENDING', promptTemplate: 'cold_last_attempt' },
            { stepId: 'COLD_CLOSE', label: 'Mensaje de cierre', delayMs: 32 * DAY, scheduledFor: new Date(now.getTime() + 32 * DAY), status: 'PENDING', promptTemplate: 'closing_message' },
        ]
    }
}

// ════════════════════════════════════════════════
// CADENCE CREATION — POST-SALE
// ════════════════════════════════════════════════

export function createPostSaleSteps(deliveryDate: Date, productCategory: string, isConsumable: boolean): CadenceStep[] {
    const d = deliveryDate.getTime()
    const feedbackDelay = (FEEDBACK_DELAY_BY_CATEGORY[productCategory] ?? 5) * DAY

    const steps: CadenceStep[] = [
        { stepId: 'PS_CONFIRM', label: 'Confirmación de pedido', delayMs: 0, scheduledFor: new Date(), status: 'PENDING', promptTemplate: 'ps_order_confirmed' },
        { stepId: 'PS_SHIPPING', label: 'Pedido en camino', delayMs: -1 * DAY, scheduledFor: new Date(d - 1 * DAY), status: 'PENDING', promptTemplate: 'ps_shipping_update' },
        { stepId: 'PS_DELIVERY', label: '¿Llegó todo bien?', delayMs: 0, scheduledFor: new Date(d), status: 'PENDING', promptTemplate: 'ps_delivery_check' },
        { stepId: 'PS_USAGE', label: 'Check de uso', delayMs: 2 * DAY, scheduledFor: new Date(d + 2 * DAY), status: 'PENDING', promptTemplate: 'ps_usage_check' },
        { stepId: 'PS_FEEDBACK', label: 'Solicitud de feedback', delayMs: feedbackDelay, scheduledFor: new Date(d + feedbackDelay), status: 'PENDING', promptTemplate: 'ps_feedback_request' },
        { stepId: 'PS_CROSSELL', label: 'Cross-sell contextual', delayMs: 17 * DAY, scheduledFor: new Date(d + 17 * DAY), status: 'PENDING', promptTemplate: 'ps_crosssell' },
    ]

    if (isConsumable) {
        steps.push({ stepId: 'PS_REORDER', label: 'Recordatorio de recompra', delayMs: 30 * DAY, scheduledFor: new Date(d + 30 * DAY), status: 'PENDING', promptTemplate: 'ps_reorder' })
    }

    steps.push({ stepId: 'PS_WINBACK', label: 'Win-back', delayMs: 75 * DAY, scheduledFor: new Date(d + 75 * DAY), status: 'PENDING', promptTemplate: 'ps_winback' })
    return steps
}

// ════════════════════════════════════════════════
// CADENCE DB OPERATIONS
// ════════════════════════════════════════════════

export async function createCadence(
    botId: string, from: string, channel: string, type: CadenceType,
    score: number, productContext: string, isFromAd: boolean,
    orderData?: Cadence['order_data']
): Promise<string> {
    const db = getDB()
    const now = new Date()

    // Don't create duplicate active cadence of same type
    const existing = await db.collection('cadences').findOne({
        botId, phone: from, type,
        status: { $in: ['ACTIVE', 'PAUSED'] }
    })
    if (existing) {
        console.log(`[Cadence] Skipping — already has active ${type} for ${from}`)
        return existing._id.toString()
    }

    const category = getProductCategory(productContext)

    let steps: CadenceStep[]
    if (type === 'LEAD_FOLLOWUP') {
        steps = createLeadFollowupSteps(score, isFromAd, productContext, now)
    } else {
        const deliveryDate = orderData?.deliveryDate || new Date(now.getTime() + 3 * DAY)
        const isConsumable = orderData?.isConsumable || /consumible|recurrente|recarga|repuesto/i.test(productContext)
        steps = createPostSaleSteps(deliveryDate as Date, category, isConsumable)
    }

    const cadence = {
        botId, phone: from, channel, type,
        status: 'ACTIVE',
        scoreAtCreation: score,
        productContext,
        productCategory: category,
        isFromAd,
        steps,
        currentStepIndex: 0,
        orderData,
        createdAt: now,
        updatedAt: now,
        lastLeadMessageAt: now,
        reactivationCount: 0,
    }

    const result = await db.collection('cadences').insertOne(cadence)
    console.log(`[Cadence] Created ${type} for ${from} (${steps.length} steps, category: ${category})`)
    return result.insertedId.toString()
}

// One-shot 5h follow-up disparado cuando el cliente dice "lo pensaré".
// Un solo step, gated a horario comercial (8am–6pm) por isWithinBusinessHours
// al momento de enviarse, y marcado para NUNCA crear una segunda cadencia del
// mismo tipo para el mismo cliente (unique per botId+phone history).
export async function createThinkingItOverCadence(botId: string, from: string, channel: string): Promise<string | null> {
    const db = getDB()
    const now = new Date()

    // One-shot por (botId, phone): si ya existe cualquier THINKING_IT_OVER
    // (active, paused, completed o archived), no creamos otra.
    const existing = await db.collection('cadences').findOne({
        botId, phone: from, type: 'THINKING_IT_OVER'
    })
    if (existing) {
        return null
    }

    const scheduledFor = new Date(now.getTime() + 5 * HOUR)
    const steps: CadenceStep[] = [{
        stepId: 'THINK_5H',
        label: 'Seguimiento tras "lo pensaré"',
        delayMs: 5 * HOUR,
        scheduledFor,
        status: 'PENDING',
        promptTemplate: 'thinking_it_over'
    }]

    const cadence = {
        botId, phone: from, channel,
        type: 'THINKING_IT_OVER',
        status: 'ACTIVE',
        scoreAtCreation: 0,
        productContext: '',
        productCategory: 'default',
        isFromAd: false,
        steps,
        currentStepIndex: 0,
        createdAt: now,
        updatedAt: now,
        lastLeadMessageAt: now,
        reactivationCount: 0,
    }

    const result = await db.collection('cadences').insertOne(cadence)
    console.log(`[Cadence] Created THINKING_IT_OVER for ${from} (scheduled ${scheduledFor.toISOString()})`)
    return result.insertedId.toString()
}

export async function pauseAllCadences(botId: string, from: string): Promise<number> {
    const db = getDB()
    const result = await db.collection('cadences').updateMany(
        { botId, phone: from, status: 'ACTIVE' },
        { $set: { status: 'PAUSED', updatedAt: new Date() } }
    )
    return result.modifiedCount
}

export async function resumeCadencesAfterSilence(botId: string, from: string): Promise<number> {
    const db = getDB()
    const result = await db.collection('cadences').updateMany(
        { botId, phone: from, status: 'PAUSED' },
        { $set: { status: 'ACTIVE', updatedAt: new Date() } }
    )
    return result.modifiedCount
}

export async function optOutAllCadences(botId: string, from: string): Promise<number> {
    const db = getDB()
    const result = await db.collection('cadences').updateMany(
        { botId, phone: from, status: { $in: ['ACTIVE', 'PAUSED'] } },
        { $set: { status: 'OPTED_OUT', updatedAt: new Date(), completedAt: new Date() } }
    )
    await db.collection('leads').updateOne(
        { botId, phone: from },
        { $set: { cadenceOptOut: true, updatedAt: new Date() } }
    )
    return result.modifiedCount
}

export async function archiveCadence(cadenceId: string): Promise<void> {
    const db = getDB()
    await db.collection('cadences').updateOne(
        { _id: new ObjectId(cadenceId) },
        { $set: { status: 'ARCHIVED', updatedAt: new Date(), completedAt: new Date() } }
    )
    const cadence = await db.collection('cadences').findOne({ _id: new ObjectId(cadenceId) })
    if (cadence) {
        await db.collection('leads').updateOne(
            { botId: cadence.botId, phone: cadence.phone },
            { $set: { status: 'Archivado', updatedAt: new Date() } }
        )
    }
}

export async function updateLeadMessageTime(botId: string, from: string): Promise<void> {
    const db = getDB()
    await db.collection('cadences').updateMany(
        { botId, phone: from, status: { $in: ['ACTIVE', 'PAUSED'] } },
        { $set: { lastLeadMessageAt: new Date(), updatedAt: new Date() } }
    )
}

// ════════════════════════════════════════════════
// CADENCE STEP PROCESSOR
// ════════════════════════════════════════════════

export async function getPendingCadenceSteps(): Promise<Array<{ cadence: any, step: CadenceStep, stepIndex: number }>> {
    const db = getDB()
    const now = new Date()

    const activeCadences = await db.collection('cadences').find({
        status: 'ACTIVE'
    }).toArray()

    const pending: Array<{ cadence: any, step: CadenceStep, stepIndex: number }> = []

    for (const cadence of activeCadences) {
        // THINKING_IT_OVER es un one-shot de 5h gateado a horario comercial.
        // Usa su propia lógica y no el silence gate de 24h de los demás tipos.
        if (cadence.type === 'THINKING_IT_OVER') {
            const step = cadence.steps?.[0] as CadenceStep | undefined
            if (!step || step.status !== 'PENDING') continue
            if (new Date(step.scheduledFor) > now) continue
            // Solo dentro de horario comercial (8am–6pm por default).
            if (!isWithinBusinessHours()) continue
            pending.push({ cadence, step, stepIndex: 0 })
            continue
        }

        if (cadence.lastLeadMessageAt) {
            const silenceMs = now.getTime() - new Date(cadence.lastLeadMessageAt).getTime()
            if (silenceMs < 24 * HOUR) continue
        }

        for (let i = 0; i < cadence.steps.length; i++) {
            const step = cadence.steps[i] as CadenceStep
            if (step.status !== 'PENDING') continue

            if (new Date(step.scheduledFor) <= now) {
                if (i > 0) {
                    const prev = cadence.steps[i - 1] as CadenceStep
                    if (prev.status === 'PENDING') break
                    if (prev.status === 'SENT' && prev.sentAt) {
                        const sentTime = new Date(prev.sentAt).getTime()
                        const lastMsg = cadence.lastLeadMessageAt ? new Date(cadence.lastLeadMessageAt).getTime() : 0
                        if (lastMsg < sentTime) {
                            if (!step.stepId.includes('CLOSE') && !step.stepId.includes('LAST')) break
                        }
                    }
                }

                const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
                const sentToday = cadence.steps.some((s: CadenceStep) =>
                    s.status === 'SENT' && s.sentAt && new Date(s.sentAt) >= today
                )
                if (sentToday) break

                pending.push({ cadence, step, stepIndex: i })
                break
            }
            break
        }
    }

    return pending
}

export async function markStepSent(cadenceId: string, stepIndex: number, sentText: string): Promise<void> {
    const db = getDB()
    const now = new Date()

    const cadence = await db.collection('cadences').findOne({ _id: new ObjectId(cadenceId) })
    if (!cadence) return

    const steps = cadence.steps as CadenceStep[]
    steps[stepIndex].status = 'SENT'
    steps[stepIndex].sentAt = now as any
    steps[stepIndex].sentText = sentText

    await db.collection('cadences').updateOne(
        { _id: new ObjectId(cadenceId) },
        { $set: { steps, currentStepIndex: stepIndex + 1, updatedAt: now } }
    )

    const allDone = steps.every((s: CadenceStep) => s.status !== 'PENDING')
    if (allDone) {
        await db.collection('cadences').updateOne(
            { _id: new ObjectId(cadenceId) },
            { $set: { status: 'COMPLETED', completedAt: now, updatedAt: now } }
        )
        console.log(`[Cadence] Completed cadence ${cadenceId}`)
    }
}

// ════════════════════════════════════════════════
// GEMINI PROMPT TEMPLATES
// ════════════════════════════════════════════════

export function generateCadencePrompt(step: CadenceStep, cadence: any, customerName: string): string {
    const product = cadence.productContext || cadence.product_context || 'el producto'
    const name = customerName || 'amigo/a'
    const orderItems = cadence.orderData?.items || cadence.order_data?.items || product

    const templates: Record<string, string> = {
        'hot_recommendation': `El cliente "${name}" mostró alto interés en "${product}". Escribe UN mensaje corto recomendándole ese producto específico, mencionando por qué es buena opción. Incluye una pregunta para seguir la conversación. NO menciones que es un mensaje automático. Sé natural y cordial. Máximo 3 líneas.`,
        'hot_value_content': `El cliente "${name}" consultó sobre "${product}" pero no ha comprado. Envía un tip de uso, beneficio clave o dato interesante sobre ese tipo de producto. NO vendas directamente. Agrega valor. Si existe alguna reseña positiva de otros clientes, menciónala. Máximo 3 líneas.`,
        'hot_social_proof': `El cliente "${name}" está evaluando "${product}". Escribe un mensaje breve mencionando que otros clientes han comprado ese producto recientemente y están satisfechos. Puedes inventar un testimonial realista y positivo. NO seas agresivo con la venta. Máximo 3 líneas.`,
        'hot_soft_offer': `El cliente "${name}" no ha comprado "${product}" después de varios días. Ofrécele un beneficio suave: descuento limitado, envío gratis, o un incentivo. Hazlo sonar exclusivo y con urgencia leve ("hasta hoy", "últimas unidades"). Máximo 3 líneas.`,
        'cold_educational': `El cliente "${name}" consultó sobre "${product}" pero no mostró mucho interés. Envía contenido educativo: un beneficio poco conocido del producto, un tip de uso, o información útil relacionada. NO vendas. Solo genera curiosidad. Máximo 3 líneas.`,
        'cold_new_angle': `El cliente "${name}" consultó sobre "${product}" hace unos días. Presenta el producto desde un ángulo diferente: otro beneficio, otro caso de uso, combinación con otro producto. Máximo 3 líneas.`,
        'cold_offer': `Han pasado 2 semanas desde que "${name}" consultó por "${product}". Hazle saber de alguna novedad o promoción relacionada. Sé casual, no invasivo. Máximo 3 líneas.`,
        'cold_last_attempt': `Último intento de contactar a "${name}" que consultó por "${product}" hace un mes. Pregunta amablemente si sigue buscando ese tipo de producto y ofrécete a ayudar. Sé breve y respetuoso. Máximo 2 líneas.`,
        'closing_message': `Escribe un mensaje de cierre respetuoso para "${name}" que consultó por "${product}" pero no compró. Dile que cierras la conversación por ahora pero que estás disponible cuando lo necesite. Usa un tono cálido y positivo. Incluye un emoji. Máximo 2 líneas.`,
        'ps_order_confirmed': `El cliente "${name}" acaba de comprar: ${orderItems}. Escribe un mensaje de confirmación de pedido breve y entusiasta. Incluye que le avisarás cuando salga el envío. Usa emoji ✅📦. Máximo 3 líneas.`,
        'ps_shipping_update': `El pedido de "${name}" (${orderItems}) está en camino. Escribe un mensaje breve avisando que ya se envió y que llegará pronto. Ofrece que te escriba si tiene dudas. Usa emoji 📦. Máximo 2 líneas.`,
        'ps_delivery_check': `Hoy es el día estimado de entrega del pedido de "${name}" (${orderItems}). Pregunta brevemente si llegó todo bien. Sé amable. Máximo 2 líneas.`,
        'ps_usage_check': `"${name}" recibió "${orderItems}" hace 2-3 días. Pregunta cómo le va con el producto. Si tiene alguna duda de uso, ofrécete a ayudar. Máximo 2 líneas.`,
        'ps_feedback_request': `Pide feedback a "${name}" sobre su compra de "${orderItems}". Usa emojis como opciones rápidas: 😍 Excelente  😊 Bien  😐 Regular  😕 Mal. Mantén el tono casual. Máximo 3 líneas.`,
        'ps_crosssell': `"${name}" compró "${orderItems}" hace unas semanas. Sugiere UN solo producto complementario que combine bien. No ofrezcas catálogo completo. Pregunta si le interesa ver ese producto. Máximo 3 líneas.`,
        'ps_reorder': `"${name}" compró "${orderItems}" hace aproximadamente un mes. Es un producto recurrente/consumible. Pregunta amablemente si ya necesita otro. Sé casual. Máximo 2 líneas.`,
        'ps_winback': `"${name}" nos compró "${orderItems}" hace tiempo. Escribe un mensaje breve mencionando que tienes novedades que podrían interesarle. Pregunta si quiere que le cuentes. Usa un emoji 🎁. Máximo 2 líneas.`,
        'thinking_it_over': `"${name}" te dijo hace unas horas que se lo iba a pensar sobre "${product}" y aún no ha respondido. Escribe UN mensaje breve, cálido y SIN presión que cumpla TODAS estas reglas:
- NO hagas ninguna pregunta (ni "¿pudiste pensarlo?", ni "¿en qué te ayudo?", ni similares).
- NO le pidas una decisión ni un avance.
- Solo recuérdale que sigues disponible cuando esté listo/a, a su ritmo.
- Tono de amigo que dice "tranqui, sin apuro", no de vendedor haciendo seguimiento.
- Máximo 2 líneas. Puedes usar 1 emoji suave (😊 o 💛). No saludes con "Hola" si ya hubo conversación previa el mismo día.`,
    }

    return templates[step.promptTemplate] || `Escribe un mensaje de seguimiento corto y natural para "${name}" sobre "${product}". Máximo 2 líneas.`
}

// ════════════════════════════════════════════════
// BUSINESS HOURS CHECK
// ════════════════════════════════════════════════

export function isWithinBusinessHours(schedule?: string): boolean {
    if (!schedule) return true
    const now = new Date()
    const hour = now.getHours()
    const timeMatch = schedule.match(/(\d{1,2})(?::?\d{2})?\s*(?:am|AM)?\s*[-–a]\s*(\d{1,2})(?::?\d{2})?\s*(?:pm|PM)?/i)
    if (timeMatch) {
        const startH = parseInt(timeMatch[1])
        let endH = parseInt(timeMatch[2])
        if (/pm/i.test(schedule) && endH < 12) endH += 12
        if (startH > endH) endH += 12
        return hour >= startH && hour <= endH
    }
    return hour >= 8 && hour <= 21
}

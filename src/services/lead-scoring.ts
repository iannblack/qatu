/**
 * Motor de Lead Scoring Automático
 * Calcula puntos acumulativos por señales conversacionales.
 * El score determina el comportamiento del bot y triggers de escalación.
 */

// ─── Signal Scoring Table ───

export type ScoreLevel = 'FRIO' | 'TIBIO' | 'CALIENTE' | 'LISTO'

export interface ScoreSignal {
    signal: string
    points: number
    timestamp: Date
}

export interface ScoreResult {
    deltaScore: number
    signals: ScoreSignal[]
    newTotal: number
    level: ScoreLevel
}

export interface EscalationTrigger {
    reason: string
    severity: 'high' | 'critical'
    detail: string
}

// ─── Positive Signal Patterns ───

const POSITIVE_SIGNALS: Array<{ signal: string; points: number; patterns: RegExp[] }> = [
    {
        signal: 'pregunta_producto_especifico',
        points: 15,
        patterns: [
            /(?:tienes?|vende[sn]?|ofrece[sn]?|hay)\s+.{3,}/i,
            /(?:me\s+interesa|quiero\s+(?:saber|ver|conocer)\s+(?:sobre|de|el|la|los|las))\s+.{3,}/i,
            /(?:cuéntame|dime)\s+(?:sobre|de|del|de\s+la)\s+/i,
        ]
    },
    {
        signal: 'pregunta_precio_disponibilidad',
        points: 20,
        patterns: [
            /(?:cuánto|cuanto|precio|costo|vale|costar|cobr)/i,
            /(?:disponib|hay\s+en\s+stock|queda[n]?\s+|tienen?\s+disponible)/i,
            /(?:a\s+cuánto|a\s+cuanto|qué\s+precio|que\s+precio)/i,
        ]
    },
    {
        signal: 'pregunta_envio_delivery',
        points: 15,
        patterns: [
            /(?:envío|envio|delivery|entreg|despacho|llega|recib)/i,
            /(?:mand[ae]n?\s+a|llega\s+(?:a|hasta)|hacen\s+envío)/i,
            /(?:costo\s+(?:de\s+)?envío|cuánto\s+(?:el\s+)?envío)/i,
        ]
    },
    {
        signal: 'solicito_fotos_videos',
        points: 10,
        patterns: [
            /(?:foto|image[ns]|video|ver\s+(?:el|la|los|las|más)|muéstr|muestr)/i,
            /(?:tienes?\s+foto|mándame|envíame|pásame)\s+(?:una?\s+)?(?:foto|imagen)/i,
        ]
    },
    {
        signal: 'compartio_direccion_ubicacion',
        points: 20,
        patterns: [
            /(?:mi\s+dirección|mi\s+direccion|mi\s+ubicación|mi\s+ubicacion|vivo\s+en|estoy\s+en|queda\s+en)/i,
            /(?:av\.\s|calle\s|jirón\s|jiron\s|urbanización\s|urb\.\s|mz\.\s|lt\.\s)/i,
        ]
    },
    {
        signal: 'menciono_presupuesto',
        points: 20,
        patterns: [
            /(?:mi\s+presupuesto|tengo\s+(?:para|hasta)\s+\d|puedo\s+(?:pagar|gastar)\s+(?:hasta\s+)?\d)/i,
            /(?:dispuesto\s+a\s+pagar|presupuesto\s+(?:de|es)\s+)/i,
        ]
    },
    {
        signal: 'referido_cliente',
        points: 15,
        patterns: [
            /(?:me\s+(?:recomendó|recomendo|refirió|refirio|dijo|pasó|paso)\s+(?:un|una|mi)\s+(?:amig|conocid|familiar))/i,
            /(?:vine\s+(?:de\s+parte|por?\s+recomendación)|de\s+parte\s+de)/i,
        ]
    },
]

// ─── NLP Urgency Signals ───

const NLP_URGENCY: Array<{ signal: string; points: number; patterns: RegExp[] }> = [
    {
        signal: 'urgencia_temporal',
        points: 15,
        patterns: [
            /(?:lo\s+necesito\s+hoy|para\s+(?:hoy|mañana|manana|esta\s+(?:tarde|noche))|es\s+urgente|cuanto\s+antes|lo\s+antes\s+posible|de\s+urgencia)/i,
            /(?:lo\s+(?:ocupo|requiero)\s+(?:ya|urgente|para\s+hoy))/i,
        ]
    },
    {
        signal: 'decision_compra',
        points: 10,
        patterns: [
            /(?:me\s+lo\s+llevo|lo\s+quiero|lo\s+pido|lo\s+compro|me\s+lo\s+quedo|lo\s+tomo|quiero\s+(?:uno|una|pedirlo|comprarlo|ordenar))/i,
            /(?:va,?\s+(?:dámelo|damelo|lo\s+llevo)|listo,?\s+(?:va|lo\s+llevo))/i,
            /(?:cómo\s+(?:pago|te\s+pago)|paso\s+el\s+(?:pago|yape|plin))/i,
        ]
    },
]

// ─── Negative Signal Patterns ───

const NEGATIVE_SIGNALS: Array<{ signal: string; points: number; patterns: RegExp[] }> = [
    {
        signal: 'solo_viendo',
        points: -5,
        patterns: [
            /(?:solo\s+(?:estoy\s+)?(?:viendo|mirando|preguntando|consultando)|después|despues|por\s+curiosidad|nada\s+más|luego\s+(?:te\s+)?(?:digo|aviso|confirmo))/i,
        ]
    },
    {
        signal: 'objecion_precio',
        points: -10,
        patterns: [
            /(?:es\s+gratis|está\s+(?:muy\s+)?caro|esta\s+(?:muy\s+)?caro|no\s+tengo\s+presupuesto|muy\s+(?:caro|costoso)|fuera\s+de\s+(?:mi\s+)?presupuesto|no\s+me\s+alcanza)/i,
        ]
    },
]

// ─── Escalation Patterns ───

const ANGER_PATTERNS = [
    /(?:pésimo|pesimo|horrible|malísim|malisim|inútil|inutil|estafa|robo|engaño|engano|basura|asco)/i,
    /(?:no\s+sirv[eo]|qué\s+(?:asco|horror)|me\s+(?:est[aá]n?\s+)?(?:robando|estafando|engañando))/i,
    /(?:voy\s+a\s+(?:denunciar|reportar|reclamar)|esto\s+es\s+(?:una?\s+)?(?:estafa|robo|fraude))/i,
]

const HUMAN_REQUEST_PATTERNS = [
    /(?:quiero\s+hablar\s+con\s+(?:una?\s+)?(?:persona|humano|alguien|dueñ[oa]|encargad[oa]|gerente|vendedor))/i,
    /(?:pásame\s+con|pasame\s+con|comunícame\s+con|conectame\s+con|necesito\s+(?:hablar\s+con\s+)?(?:una?\s+)?persona)/i,
    /(?:no\s+(?:quiero|quier)\s+(?:hablar\s+con\s+)?(?:un\s+)?(?:bot|robot|máquina|maquina))/i,
]

const COMPETITOR_PATTERNS = [
    /(?:en\s+(?:otra|otro)\s+(?:tienda|lado|sitio|negocio)\s+(?:está|esta|vi|me\s+(?:cobran|ofrecen))\s+(?:más\s+)?(?:barato|menos|mejor))/i,
    /(?:la\s+competencia|otro\s+(?:proveedor|vendedor)|mejor\s+(?:oferta|precio)\s+(?:en\s+)?(?:otro|otra))/i,
]

// ─────────────────────────────────
// Core Functions
// ─────────────────────────────────

/**
 * Calculate score delta from a single message
 */
export function calculateSignalScore(
    text: string,
    currentScore: number,
    channel: string,
    isFirstMessage: boolean,
    responseTimeMs?: number,
    isFromAd?: boolean,
): ScoreResult {
    const signals: ScoreSignal[] = []
    let delta = 0
    const now = new Date()

    // First message bonus
    if (isFirstMessage) {
        delta += 5
        signals.push({ signal: 'primer_mensaje', points: 5, timestamp: now })
    }

    // Channel base scores
    if (isFromAd) {
        delta += 10
        signals.push({ signal: 'click_to_whatsapp_ad', points: 10, timestamp: now })
    }

    if (!text) {
        const newTotal = Math.max(0, currentScore + delta)
        return { deltaScore: delta, signals, newTotal, level: classifyLead(newTotal) }
    }

    // Check positive signals
    for (const sig of POSITIVE_SIGNALS) {
        if (sig.patterns.some(p => p.test(text))) {
            delta += sig.points
            signals.push({ signal: sig.signal, points: sig.points, timestamp: now })
        }
    }

    // Check NLP urgency/decision
    for (const sig of NLP_URGENCY) {
        if (sig.patterns.some(p => p.test(text))) {
            delta += sig.points
            signals.push({ signal: sig.signal, points: sig.points, timestamp: now })
        }
    }

    // Check negative signals
    for (const sig of NEGATIVE_SIGNALS) {
        if (sig.patterns.some(p => p.test(text))) {
            delta += sig.points
            signals.push({ signal: sig.signal, points: sig.points, timestamp: now })
        }
    }

    // Response time bonus (< 1 hour between messages = high urgency)
    if (responseTimeMs && responseTimeMs < 3600000) {
        delta += 10
        signals.push({ signal: 'respuesta_rapida', points: 10, timestamp: now })
    }

    // Referral detection
    if (/(?:de\s+parte\s+de|me\s+(?:recomend|refir))/i.test(text)) {
        delta += 15
        signals.push({ signal: 'referido', points: 15, timestamp: now })
    }

    const newTotal = Math.max(0, currentScore + delta)
    return { deltaScore: delta, signals, newTotal, level: classifyLead(newTotal) }
}

/**
 * Classify lead by score thresholds
 */
export function classifyLead(score: number): ScoreLevel {
    if (score >= 76) return 'LISTO'
    if (score >= 51) return 'CALIENTE'
    if (score >= 21) return 'TIBIO'
    return 'FRIO'
}

/**
 * Generate behavior prompt injection based on score level
 */
export function getScoreBehaviorPrompt(level: ScoreLevel, signals: string[]): string {
    const hasUrgency = signals.includes('urgencia_temporal')
    const hasDecision = signals.includes('decision_compra')

    switch (level) {
        case 'FRIO':
            return `\n\n[COMPORTAMIENTO LEAD SCORING — NIVEL FRÍO]
El cliente está en fase exploratoria. REGLAS:
- NO ofrezcas precios directamente a menos que los pida.
- Comparte contenido de valor: tips, cómo elegir bien, beneficios del producto.
- Haz preguntas abiertas para entender su necesidad.
- Sé amigable y sin presión. No intentes cerrar todavía.
- Objetivo: generar confianza y despertar interés.`

        case 'TIBIO':
            return `\n\n[COMPORTAMIENTO LEAD SCORING — NIVEL TIBIO]
El cliente muestra interés real pero aún no decide. REGLAS:
- Comparte fotos del producto consultado si es posible.
- Menciona testimonios: "Muchos clientes nos eligen por..." o "Es uno de los más pedidos".
- Responde con detalle y muestra expertise.
- Ofrece responder cualquier duda.
- Si pregunta precio, responde y agrega el valor diferencial.
- Objetivo: construir confianza con prueba social.`

        case 'CALIENTE':
            return `\n\n[COMPORTAMIENTO LEAD SCORING — NIVEL CALIENTE]
El cliente está muy interesado, cerca de comprar. REGLAS:
- Haz ofertas directas y claras.
- Crea urgencia suave: "¿Te lo reservo?", "Solo me quedan [X]", "Si confirmas hoy, te llega mañana".
- Facilita el proceso: métodos de pago, envío, plazos.
- Elimina fricciones proactivamente.
${hasUrgency ? '- DETECTADO: El cliente tiene urgencia. Prioriza rapidez y tiempos de entrega.' : ''}
- Objetivo: resolver las últimas dudas y cerrar.`

        case 'LISTO':
            return `\n\n[COMPORTAMIENTO LEAD SCORING — NIVEL LISTO]
El cliente está listo para comprar o ya decidió. REGLAS:
- Intenta cierre inmediato: confirmar pedido, Total, método de pago, dirección.
- No hagas más preguntas innecesarias. El cliente ya sabe lo que quiere.
- Si hay handoff a humano: "Te paso con [dueño/a] para coordinarlo directamente 🤝"
${hasDecision ? '- DETECTADO: El cliente ya expresó intención de compra. Confirma el pedido directamente.' : ''}
- Objetivo: cerrar la venta YA.`

        default:
            return ''
    }
}

/**
 * Check if escalation to human is needed
 */
export function checkEscalationTriggers(
    text: string,
    currentScore: number,
    objectionHistory: string[],
    mentionedCompetitors: string[],
): EscalationTrigger[] {
    const triggers: EscalationTrigger[] = []
    if (!text) return triggers

    // Score 75+ → escalate
    if (currentScore >= 75) {
        triggers.push({
            reason: 'score_alto',
            severity: 'high',
            detail: `Score alcanzó ${currentScore} puntos — Lead LISTO para cierre`
        })
    }

    // Anger/frustration
    if (ANGER_PATTERNS.some(p => p.test(text))) {
        triggers.push({
            reason: 'frustacion_detectada',
            severity: 'critical',
            detail: 'Cliente expresó frustración o enojo'
        })
    }

    // Explicit human request
    if (HUMAN_REQUEST_PATTERNS.some(p => p.test(text))) {
        triggers.push({
            reason: 'solicita_humano',
            severity: 'critical',
            detail: 'Cliente pidió hablar con una persona'
        })
    }

    // Repeated objection (same objection 2+ times)
    const currentObjections = NEGATIVE_SIGNALS
        .filter(s => s.patterns.some(p => p.test(text)))
        .map(s => s.signal)

    for (const obj of currentObjections) {
        const prevCount = objectionHistory.filter(h => h === obj).length
        if (prevCount >= 1) { // This is the 2nd+ time
            triggers.push({
                reason: 'objecion_repetida',
                severity: 'high',
                detail: `Objeción "${obj}" repetida ${prevCount + 1} veces`
            })
        }
    }

    // Competitor mention
    if (COMPETITOR_PATTERNS.some(p => p.test(text))) {
        triggers.push({
            reason: 'competidor_mencionado',
            severity: 'high',
            detail: 'Cliente mencionó a un competidor o comparó precios'
        })
    }

    return triggers
}

/**
 * Format escalation alert for WhatsApp owner notification
 */
export function formatEscalationAlert(
    triggers: EscalationTrigger[],
    from: string,
    score: number,
    level: ScoreLevel,
    lastMessage: string,
): string {
    const phone = from.split('@')[0]
    const preview = lastMessage.length > 80 ? lastMessage.substring(0, 80) + '...' : lastMessage

    const triggerLines = triggers.map(t => {
        const icon = t.severity === 'critical' ? '🚨' : '🔥'
        return `${icon} ${t.detail}`
    }).join('\n')

    return `🔥 Lead caliente: ${phone} en WhatsApp
Score: ${score} puntos — Nivel: ${level}
Último mensaje: "${preview}"

${triggerLines}

El bot sigue respondiendo, pero este lead necesita tu atención. Respóndele directamente para cerrar.`
}

/**
 * WhatsApp Interactive Buttons (Quick Reply) — implementación experimental.
 *
 * Baileys conecta a WhatsApp Web personal, NO a Cloud API. Los botones de
 * Quick Reply ("WhatsApp Business buttons") se enviaban históricamente por
 * `buttonsMessage` (deprecated por Meta) y `listMessage` (también deprecated).
 *
 * En 2024-2025 se descubrió que se puede enviar `interactiveMessage` con
 * `nativeFlowMessage` envuelto en `viewOnceMessage`, y la mayoría de
 * clientes WhatsApp modernos (Android + iOS recientes) lo renderizan
 * como botones reales. Clientes desactualizados ven solo el texto.
 *
 * Riesgos:
 *  - No es API oficial; Meta puede deprecar en cualquier momento.
 *  - Uso masivo puede gatillar baneo del número.
 *  - Algunos clientes muestran el texto crudo en lugar del botón.
 *
 * Por eso siempre usamos un FALLBACK a texto numerado plano: si el envío
 * interactivo falla o el cliente no responde con button-reply, todo
 * sigue funcionando como conversación normal.
 */

// `proto` viene del namespace de Baileys. Lo usamos para construir el
// payload del InteractiveMessage exactamente como WhatsApp Business API.
import { proto, generateWAMessageFromContent } from 'baileys'

export interface ParsedButtons {
    /** Texto antes de las opciones numeradas (la pregunta principal). */
    body: string
    /** Texto después de las opciones (cierre tipo "Responde con el número…"). */
    footer: string
    /** Lista de opciones extraídas, máximo 3 (límite WhatsApp para quick_reply). */
    buttons: Array<{ id: string; text: string }>
}

/**
 * Normaliza la respuesta del bot para CONTEXTOS DE OPCIONES (envío, pago,
 * confirmación de pedido, etc.). El LLM a veces ignora la instrucción de
 * usar "1.", "2.", "3." y devuelve bullets "•" — generalmente porque copia
 * de mensajes anteriores del historial. Este post-procesador detecta el
 * contexto por keywords del header y re-numera los bullets a "1.", "2.",
 * "3." para que el frontend del tester y el parser de WhatsApp puedan
 * renderizarlos como botones reales.
 *
 * Regla clave: SOLO aplica en contextos de OPCIONES SELECCIONABLES, no en
 * el PASO 4 (5 datos personales) que es input de texto libre — sus bullets
 * deben quedar como bullets (renderiza como lista plana, no botones).
 *
 * Detecta contexto por sustring del texto (case-insensitive):
 *   - Envío: "opción de envío", "opciones de envío", "tenemos las siguientes opciones de envío"
 *   - Pago:  "métodos de pago", "datos para el pago", "¿cómo prefieres pagar"
 *   - Confirm: "¿confirmas tu pedido", "deseas confirmar", "¿confirmas el pedido"
 *
 * Patrones de bullet reconocidos (al inicio de línea con espacio opcional):
 *   "• texto", "· texto", "- texto" (NO "* texto" para evitar markdown bold)
 *
 * También sustituye los closers genéricos por el closer canónico para que
 * el parser de buttons tenga "footer" claro.
 */
const OPTION_CONTEXT_KEYWORDS = [
    'opción de envío',
    'opciones de envío',
    'opcion de envio',
    'opciones de envio',
    '¿cómo prefieres pagar',
    'como prefieres pagar',
    'métodos de pago',
    'metodos de pago',
    'datos para el pago',
    'datos para realizar el pago',
    '¿confirmas tu pedido',
    'deseas confirmar el pedido'
]

const PERSONAL_DATA_KEYWORDS = [
    'necesito los siguientes datos',
    'compártelos en ese orden',
    'compartelos en ese orden'
]

export function normalizeOptionsResponse(text: string): string {
    if (!text || typeof text !== 'string') return text
    const lower = text.toLowerCase()

    // No aplicar si es PASO 4 (datos personales) — los bullets se quedan como bullets.
    if (PERSONAL_DATA_KEYWORDS.some(k => lower.includes(k))) return text

    // No aplicar si no es contexto de opciones seleccionables.
    if (!OPTION_CONTEXT_KEYWORDS.some(k => lower.includes(k))) return text

    const lines = text.split(/\r?\n/)
    // Acepta sólo bullet chars reales (•, ·) o un guión simple "-" al inicio.
    // NO incluye em/en dash (—, –) porque suelen aparecer dentro del texto
    // (ej. "Lima — S/15") y NO son bullets.
    const bulletRe = /^(\s*)(?:[•·]|-)\s+(.+?)\s*$/
    let bulletCount = 0
    const newLines = lines.map(line => {
        // Skip si la línea ya empieza con un dígito (numerado existente).
        if (/^\s*\d/.test(line)) return line
        const m = line.match(bulletRe)
        if (!m) return line
        bulletCount++
        return `${m[1]}${bulletCount}. ${m[2]}`
    })

    if (bulletCount === 0) return text

    let out = newLines.join('\n')

    // Reemplazar closers vagos por el canónico para que el frontend detecte footer.
    const closerCanonical = 'Responde con el número o el nombre de la opción.'
    const closerPatterns = [
        /¿\s*Cu(?:á|a)l\s+(?:opci[oó]n)?\s*prefieres\s*\??/gi,
        /¿\s*Confirmas\s*\??/gi,
        /¿\s*Cu(?:á|a)l\s+eliges\s*\??/gi,
        /¿\s*Cu(?:á|a)l\s+te\s+gustar(?:í|i)a\s*\??/gi
    ]
    let replacedCloser = false
    for (const re of closerPatterns) {
        if (re.test(out)) {
            out = out.replace(re, closerCanonical)
            replacedCloser = true
            break
        }
    }

    // Si no había closer canónico ni reemplazo, agrégalo al final.
    if (!replacedCloser && !out.toLowerCase().includes('responde con el número') && !out.toLowerCase().includes('responde con el numero')) {
        out = out.trimEnd() + '\n\n' + closerCanonical
    }

    return out
}

/**
 * Parsea un texto que ya tiene formato "pregunta + opciones numeradas + cierre"
 * para extraer body, buttons y footer separados.
 *
 * Reconoce estos patrones de líneas de opción (al inicio de línea, ignorando
 * espacios):
 *   "1. Texto"
 *   "1) Texto"
 *   "1- Texto"
 * Hasta 9 opciones (1-9). Las > 3 se ignoran porque WhatsApp solo soporta
 * 3 botones quick_reply en pantalla.
 *
 * Devuelve null si:
 *  - No detecta al menos 2 opciones (no vale la pena hacer botones).
 *  - Las opciones detectadas no son consecutivas (1, 2, 3) — heurística para
 *    evitar falsos positivos como listas dentro de un párrafo.
 */
export function parseNumberedOptions(text: string): ParsedButtons | null {
    text = text.replace(/[\u200B-\u200F\u2060-\u2064\uFEFF]/g, "");
    if (!text || typeof text !== 'string') return null
    const lines = text.split(/\r?\n/)
    // Buscamos líneas que arrancan con N. / N) / N- (con espacios opcionales)
    const optionRegex = /^\s*(\d{1,2})[.)-]\s+(.+?)\s*$/
    type Hit = { lineIdx: number; num: number; text: string }
    const hits: Hit[] = []
    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(optionRegex)
        if (m) hits.push({ lineIdx: i, num: parseInt(m[1], 10), text: m[2].trim() })
    }
    if (hits.length < 1) return null
    // Verificar que sean consecutivas empezando en 1.
    for (let i = 0; i < hits.length; i++) {
        if (hits[i].num !== i + 1) return null
    }
    // Solo tomamos los primeros 3 como botones (limit WhatsApp). Si hay >3
    // no usamos modo botón porque no se puede ofrecer todas las opciones —
    // mejor texto plano numerado para no engañar al cliente.
    if (hits.length > 3) return null

    const firstOptIdx = hits[0].lineIdx
    const lastOptIdx  = hits[hits.length - 1].lineIdx
    // Body: todas las líneas antes de la primera opción (sin trailing blanks).
    const bodyLines = lines.slice(0, firstOptIdx).filter(l => l.trim().length > 0)
    // Footer: todas las líneas después de la última opción (sin leading blanks).
    const footerLines = lines.slice(lastOptIdx + 1).filter(l => l.trim().length > 0)

    const body = bodyLines.join('\n').trim()
    const footer = footerLines.join('\n').trim()

    if (!body) return null // sin pregunta antes de las opciones, no es válido

    return {
        body,
        footer,
        buttons: hits.map((h, i) => ({
            id: `qr_${i + 1}`,                  // id interno del botón
            text: h.text.length > 20 ? h.text.slice(0, 19) + '…' : h.text  // WA limita a 20 chars
        }))
    }
}

/**
 * Envía un InteractiveMessage con botones quick_reply. Devuelve true si
 * el envío llegó al socket OK; false si falló (caller debe hacer fallback
 * a texto plano).
 *
 * IMPORTANTE: aunque devuelva true, NO garantiza que el cliente vea los
 * botones renderizados — depende de la versión de WhatsApp del cliente.
 * Si no responde con button-reply, eventualmente escribirá texto y el
 * flujo seguirá normal.
 */
export async function sendInteractiveButtons(
    socket: any,
    jid: string,
    parsed: ParsedButtons
): Promise<{ ok: boolean; messageId?: string }> {
    try {
        const buttons = parsed.buttons.map(b => ({
            name: 'quick_reply',
            buttonParamsJson: JSON.stringify({
                display_text: b.text,
                id: b.id
            })
        }))

        const interactiveMessage = proto.Message.InteractiveMessage.create({
            body: proto.Message.InteractiveMessage.Body.create({ text: parsed.body }),
            footer: parsed.footer
                ? proto.Message.InteractiveMessage.Footer.create({ text: parsed.footer })
                : undefined,
            nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
                buttons
            })
        })

        // Envolvemos en viewOnceMessage — necesario para que WhatsApp procese
        // interactiveMessage en chats personales (sin esto, lo descarta como
        // "solo Business API"). Es un truco conocido de la comunidad Baileys.
        const wrappedMessage = {
            viewOnceMessage: {
                message: {
                    interactiveMessage
                }
            }
        }

        const wamsg = generateWAMessageFromContent(jid, wrappedMessage, {
            userJid: socket.user?.id
        })

        // wamsg.key.id es `string | null | undefined` según los types de Baileys.
        // Si llega `null` (no debería en la práctica, pero tipo lo permite) lo
        // colapsamos a undefined para no propagar `null` al call-site.
        const messageId = wamsg.key.id ?? undefined
        await socket.relayMessage(jid, wamsg.message, { messageId })
        return { ok: true, messageId }
    } catch (e: any) {
        console.warn('[whatsapp-buttons] sendInteractiveButtons failed:', e?.message || e)
        return { ok: false }
    }
}

/**
 * Detecta si un mensaje entrante es respuesta a un botón interactivo y
 * extrae el texto que el cliente "tappeó". Devuelve null si no es una
 * respuesta de botón (el caller sigue como mensaje de texto normal).
 *
 * Cubre los 3 tipos de respuesta interactiva que envían los clientes:
 *  - buttonsResponseMessage   (botón clásico, casi obsoleto)
 *  - templateButtonReplyMessage  (template button)
 *  - interactiveResponseMessage  (nativeFlowMessage quick_reply — el actual)
 */
export function extractButtonResponseText(msgContent: any): string | null {
    if (!msgContent || typeof msgContent !== 'object') return null

    // Quick-reply moderno (nativeFlowMessage). El cliente devuelve un
    // interactiveResponseMessage con nativeFlowResponseMessage que trae
    // el `paramsJson` con {display_text, id} del botón tappeado.
    const ir = msgContent.interactiveResponseMessage
    if (ir) {
        const nf = ir.nativeFlowResponseMessage
        if (nf?.paramsJson) {
            try {
                const params = JSON.parse(nf.paramsJson)
                return params?.display_text || params?.id || null
            } catch (_) {
                /* fallthrough */
            }
        }
        // Algunos clientes mandan el body con el texto del botón directamente.
        if (ir.body?.text) return ir.body.text.toString().trim() || null
    }

    // Botón clásico (deprecated pero todavía funciona en algunos lugares).
    const br = msgContent.buttonsResponseMessage
    if (br?.selectedDisplayText) return br.selectedDisplayText
    if (br?.selectedButtonId) return br.selectedButtonId

    // Template button reply.
    const tr = msgContent.templateButtonReplyMessage
    if (tr?.selectedDisplayText) return tr.selectedDisplayText
    if (tr?.selectedId) return tr.selectedId

    return null
}

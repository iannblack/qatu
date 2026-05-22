// Meta Cloud API (WhatsApp Business Platform) — provider OFICIAL.
// Reemplaza el path Baileys per-bot cuando bot.messagingProvider === 'meta'.
// Credenciales son per-bot (no globales): cada tienda registra su propio
// `metaPhoneNumberId` + `metaAccessToken` (System User permanent token con
// scope `whatsapp_business_messaging`) durante el onboarding.
//
// Docs: https://developers.facebook.com/docs/whatsapp/cloud-api
import axios, { AxiosError } from 'axios'

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v21.0'
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`

export interface MetaCreds {
    phoneNumberId: string        // id numérico del número del bot en Meta
    accessToken: string          // System User permanent token
}

export interface MetaSendResult {
    ok: boolean
    messageId?: string
    error?: string
    rateLimited?: boolean
}

// Normaliza un teléfono al formato esperado por Meta (sólo dígitos, sin +).
// Acepta JIDs estilo Baileys (`5198765432@s.whatsapp.net`) y los pela.
function normalizePhone(to: string): string {
    if (!to) return ''
    const stripped = String(to).split('@')[0]
    return stripped.replace(/\D/g, '')
}

// Helper común para todos los POST a /messages — captura el error de Meta y
// devuelve un MetaSendResult uniforme. Meta devuelve códigos específicos
// (130429 rate limit, 131056 unsupported message type, etc.); los exponemos
// como `rateLimited:true` para que el retry layer del bot-manager los
// re-encole en vez de reintentar inmediatamente.
async function postMessage(creds: MetaCreds, payload: any): Promise<MetaSendResult> {
    if (!creds?.phoneNumberId || !creds?.accessToken) {
        return { ok: false, error: 'Missing Meta credentials (phoneNumberId or accessToken)' }
    }
    const url = `${GRAPH_BASE}/${creds.phoneNumberId}/messages`
    try {
        const { data } = await axios.post(url, payload, {
            headers: {
                Authorization: `Bearer ${creds.accessToken}`,
                'Content-Type': 'application/json',
            },
            timeout: 15_000,
        })
        const messageId = data?.messages?.[0]?.id
        return { ok: true, messageId }
    } catch (e: any) {
        const err = e as AxiosError<any>
        const status = err.response?.status
        const body = err.response?.data
        const code = body?.error?.code
        const subcode = body?.error?.error_subcode
        const message = body?.error?.message || err.message
        const rateLimited = code === 130429 || code === 131048 || status === 429
        console.warn(`[MetaCloud] sendMessage failed status=${status} code=${code}/${subcode}: ${message}`)
        return { ok: false, error: `Meta ${status || ''} ${code || ''}: ${message}`, rateLimited }
    }
}

// ── Parse opciones numeradas desde texto del LLM ──────────────────
// Extrae body, buttons (id + title) y footer de un texto con formato:
//   "Texto del mensaje...
//    1. Opcion A
//    2. Opcion B
//    Responde con..."
// Devuelve null si no detecta al menos 1 opcion o >3 opciones.
function parseNumberedOptionsFromText(text: string): { body: string; buttons: Array<{ id: string; title: string }>; footer: string } | null {
    if (!text || typeof text !== 'string') return null
    // Strip zero-width chars
    text = text.replace(/[\u200B-\u200F\u2060-\u2064\uFEFF]/g, "").trim()
    
    const lines = text.split(/\r?\n/)
    const optionRegex = /^\s*(\d{1,2})[.)-]\s+(.+?)\s*$/
    
    const hits: { lineIdx: number; num: number; text: string }[] = []
    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(optionRegex)
        if (m) hits.push({ lineIdx: i, num: parseInt(m[1], 10), text: m[2].trim() })
    }
    
    if (hits.length < 1) return null
    // Must be consecutive starting from 1
    for (let i = 0; i < hits.length; i++) {
        if (hits[i].num !== i + 1) return null
    }
    if (hits.length > 3) return null
    
    const firstOptIdx = hits[0].lineIdx
    const lastOptIdx = hits[hits.length - 1].lineIdx
    
    // Body: lines before first option
    const bodyLines = lines.slice(0, firstOptIdx).filter(l => l.trim().length > 0)
    // Footer: lines after last option
    const footerLines = lines.slice(lastOptIdx + 1).filter(l => l.trim().length > 0)
    
    const body = bodyLines.join('\n').trim()
    const footer = footerLines.join('\n').trim()
    
    if (!body) return null
    
    // Strip markdown bold from body (interactive body doesn't support it)
    const cleanBody = body.replace(/\*([^*]+)\*/g, '$1').replace(/__([^_]+)__/g, '$1')
    const cleanFooter = footer.replace(/\*([^*]+)\*/g, '$1').replace(/__([^_]+)__/g, '$1')
    
    return {
        body: cleanBody,
        buttons: hits.map((h, i) => ({
            id: `qr_${Date.now().toString(36)}_${i + 1}`,
            title: h.text.length > 20 ? h.text.slice(0, 19) + '\u2026' : h.text
        })),
        footer: cleanFooter
    }
}

class MetaCloudService {
    // ────────── SEND ──────────
    async sendText(creds: MetaCreds, to: string, text: string): Promise<MetaSendResult> {
        const phone = normalizePhone(to)
        if (!phone) return { ok: false, error: 'Invalid recipient phone' }
        if (!text || !text.trim()) return { ok: false, error: 'Empty message body' }
        return postMessage(creds, {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: phone,
            type: 'text',
            text: { body: text, preview_url: false },
        })
    }

    async sendImage(creds: MetaCreds, to: string, imageUrl: string, caption?: string): Promise<MetaSendResult> {
        const phone = normalizePhone(to)
        if (!phone) return { ok: false, error: 'Invalid recipient phone' }
        if (!imageUrl) return { ok: false, error: 'Missing imageUrl' }
        return postMessage(creds, {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: phone,
            type: 'image',
            image: { link: imageUrl, caption: caption || undefined },
        })
    }

    async sendDocument(creds: MetaCreds, to: string, url: string, filename: string, caption?: string): Promise<MetaSendResult> {
        const phone = normalizePhone(to)
        if (!phone) return { ok: false, error: 'Invalid recipient phone' }
        return postMessage(creds, {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: phone,
            type: 'document',
            document: { link: url, filename, caption: caption || undefined },
        })
    }

    async sendAudio(creds: MetaCreds, to: string, url: string): Promise<MetaSendResult> {
        const phone = normalizePhone(to)
        if (!phone) return { ok: false, error: 'Invalid recipient phone' }
        return postMessage(creds, {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: phone,
            type: 'audio',
            audio: { link: url },
        })
    }

    // Marca como leído un mensaje entrante — recomendado por Meta para que el
    // cliente vea el doble check azul (mejora UX y signals de engagement).
    async markRead(creds: MetaCreds, messageId: string): Promise<void> {
        if (!messageId) return
        try {
            await postMessage(creds, {
                messaging_product: 'whatsapp',
                status: 'read',
                message_id: messageId,
            })
        } catch (_) { /* best-effort */ }
    }

    // ────────── HEALTHCHECK ──────────
    // Verifica que las credenciales funcionen golpeando el endpoint del número.
    // Útil al guardar credenciales en el dashboard antes de marcar la tienda
    // como "Meta conectada".
    // ────────── INTERACTIVE BUTTONS ──────────
    // Envia botones quick-reply via WhatsApp Cloud API interactive messages.
    // Meta permite hasta 3 botones, cada uno con title <= 20 chars.
    async sendInteractiveButtons(
        creds: MetaCreds,
        to: string,
        body: string,
        buttons: Array<{ id: string; title: string }>,
        footer?: string
    ): Promise<MetaSendResult> {
        const phone = normalizePhone(to)
        if (!phone) return { ok: false, error: 'Invalid recipient phone' }
        if (!body || !body.trim()) return { ok: false, error: 'Empty interactive body' }
        if (!buttons || buttons.length === 0) return { ok: false, error: 'No buttons provided' }
        if (buttons.length > 3) buttons = buttons.slice(0, 3)
        const safeBody = body.slice(0, 1024)
        const safeFooter = footer ? footer.slice(0, 60) : undefined
        return postMessage(creds, {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: phone,
            type: 'interactive',
            interactive: {
                type: 'button',
                body: { text: safeBody },
                ...(safeFooter ? { footer: { text: safeFooter } } : {}),
                action: {
                    buttons: buttons.map(b => ({
                        type: 'reply',
                        reply: { id: b.id, title: b.title.slice(0, 20) }
                    }))
                }
            }
        })
    }

    // Smart send: detecta opciones numeradas en el texto y envia
    // botones interactivos en lugar de texto plano.
    // Requiere que exista parseNumberedOptionsFromText() en el mismo archivo.
    async sendSmartText(
        creds: MetaCreds,
        to: string,
        text: string,
        options?: { forceText?: boolean }
    ): Promise<MetaSendResult> {
        if (options?.forceText || !text) {
            return this.sendText(creds, to, text || '')
        }
        const parsed = parseNumberedOptionsFromText(text)
        if (parsed && parsed.buttons.length >= 1 && parsed.buttons.length <= 3) {
            return this.sendInteractiveButtons(creds, to, parsed.body, parsed.buttons, parsed.footer)
        }
        return this.sendText(creds, to, text)
    }

    async healthCheck(creds: MetaCreds): Promise<{ ok: boolean, error?: string, displayPhoneNumber?: string, verifiedName?: string }> {
        if (!creds?.phoneNumberId || !creds?.accessToken) {
            return { ok: false, error: 'Missing credentials' }
        }
        try {
            const { data } = await axios.get(`${GRAPH_BASE}/${creds.phoneNumberId}`, {
                headers: { Authorization: `Bearer ${creds.accessToken}` },
                params: { fields: 'display_phone_number,verified_name,quality_rating' },
                timeout: 10_000,
            })
            return {
                ok: true,
                displayPhoneNumber: data?.display_phone_number,
                verifiedName: data?.verified_name,
            }
        } catch (e: any) {
            const err = e as AxiosError<any>
            const msg = err.response?.data?.error?.message || err.message
            return { ok: false, error: msg }
        }
    }
}

export const metaCloudService = new MetaCloudService()

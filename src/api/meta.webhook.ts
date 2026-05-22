// Webhook OFICIAL Meta Cloud API — recibe mensajes entrantes de WhatsApp
// Business Platform y los enruta al bot dueño del `phone_number_id` que
// emite el evento.
//
// Setup en Meta Developers:
//   1. App → WhatsApp → Configuration → Webhook
//   2. Callback URL: https://<DOMAIN>/api/webhook/meta
//   3. Verify token: el valor de process.env.META_VERIFY_TOKEN
//   4. Subscribe to field: `messages`
//   5. App Secret en Settings → Basic → guardarlo en META_APP_SECRET
//
// El POST llega firmado en `X-Hub-Signature-256: sha256=<hex>` con HMAC-SHA256
// del raw body usando META_APP_SECRET. Si la firma no valida → 401.
import { Request, Response } from 'express'
import crypto from 'crypto'
import { botManager } from '../services/bot-manager'
import { getDB } from '../services/db.service'

// Dedupe in-memory: Meta puede reintentar el mismo webhook si tarda >20s
// en responder 200. Guardamos los IDs procesados por 10 minutos.
const processingLocks = new Set<string>()

// ─────────────────────────── GET handshake ───────────────────────────
// Meta hace un GET con ?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...
// Si el verify_token coincide con META_VERIFY_TOKEN respondemos con el challenge
// en texto plano (sin JSON, sin comillas) — Meta valida que el bytes-to-bytes
// match exacto y si no, el subscription falla en silencio en el dashboard.
export const metaWebhookVerify = (req: Request, res: Response) => {
    const mode = req.query['hub.mode']
    const token = req.query['hub.verify_token']
    const challenge = req.query['hub.challenge']
    const expected = process.env.META_VERIFY_TOKEN

    if (!expected) {
        console.error('[MetaWebhook] META_VERIFY_TOKEN no está configurado en .env')
        res.status(500).send('Verify token not configured on server')
        return
    }
    if (mode === 'subscribe' && token === expected) {
        console.log('[MetaWebhook] ✅ Webhook verified by Meta')
        res.status(200).send(String(challenge || ''))
        return
    }
    console.warn(`[MetaWebhook] ❌ Verify failed (mode=${mode}, token match=${token === expected})`)
    res.status(403).send('Verification failed')
}

// ─────────────────────────── HMAC verification ───────────────────────────
// Necesitamos el raw body original — Express con express.json() ya parseó el
// JSON, así que en app.ts montamos express.json({ verify }) para stashear el
// raw Buffer en req.rawBody. Si rawBody no está disponible, fallback a
// JSON.stringify(req.body) (menos seguro pero permite testing).
function verifySignature(req: Request): boolean {
    const appSecret = process.env.META_APP_SECRET
    if (!appSecret) {
        // En dev sin signature puede ser útil — log loud pero no bloqueamos.
        console.warn('[MetaWebhook] ⚠️ META_APP_SECRET no configurado. Saltando verificación de firma (NO USAR EN PROD).')
        return true
    }
    const signature = req.headers['x-hub-signature-256']
    if (!signature || typeof signature !== 'string' || !signature.startsWith('sha256=')) {
        return false
    }
    const rawBody: Buffer | undefined = (req as any).rawBody
    const payload = rawBody ? rawBody : Buffer.from(JSON.stringify(req.body || {}), 'utf8')
    const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(payload).digest('hex')
    // timingSafeEqual requiere mismo length — si differ, return false sin throw
    if (signature.length !== expected.length) return false
    try {
        return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    } catch (_) {
        return false
    }
}

// ─────────────────────────── POST handler ───────────────────────────
// Estructura típica del payload (Meta Cloud API):
// {
//   object: 'whatsapp_business_account',
//   entry: [{
//     id: '<WABA_ID>',
//     changes: [{
//       field: 'messages',
//       value: {
//         messaging_product: 'whatsapp',
//         metadata: { phone_number_id, display_phone_number },
//         contacts: [{ profile: { name }, wa_id }],
//         messages: [{ from, id, timestamp, type, text: { body } | image | audio | ... }]
//       }
//     }]
//   }]
// }
export const metaWebhookHandler = async (req: Request, res: Response) => {
    // 1) Validar firma SIEMPRE antes de procesar — protege contra payloads
    // forjados desde IPs públicas. Meta firma con HMAC-SHA256 del raw body.
    if (!verifySignature(req)) {
        console.warn('[MetaWebhook] ❌ Firma inválida — rechazando webhook')
        res.status(401).send('Invalid signature')
        return
    }

    // 2) Responder 200 INMEDIATAMENTE — Meta da timeout a 20s y reintenta,
    // procesamos el mensaje asincrónicamente.
    res.status(200).send('OK')

    try {
        const body = req.body
        if (!body || body.object !== 'whatsapp_business_account' || !Array.isArray(body.entry)) {
            console.log('[MetaWebhook] Payload no reconocido como whatsapp_business_account, ignorando')
            return
        }

        // Procesamos cada mensaje en background.
        setImmediate(async () => {
            const db = getDB()
            for (const entry of body.entry) {
                if (!Array.isArray(entry.changes)) continue
                for (const change of entry.changes) {
                    // Solo nos interesa el field 'messages' — ignoramos statuses
                    // (delivered/read receipts) por ahora. Si querés trackear
                    // delivery rate, change.value.statuses[] existe.
                    if (change.field !== 'messages') continue
                    const value = change.value
                    if (!value?.messages || !Array.isArray(value.messages)) continue
                    const phoneNumberId = value?.metadata?.phone_number_id
                    if (!phoneNumberId) {
                        console.warn('[MetaWebhook] Mensaje sin phone_number_id en metadata, ignorando')
                        continue
                    }

                    // Buscar el bot dueño del número.
                    const bot = await db.collection('bot_configs').findOne({
                        $or: [
                            { metaPhoneNumberId: String(phoneNumberId) },
                            { metaPhoneNumberId: Number(phoneNumberId) },
                        ],
                    })
                    if (!bot) {
                        console.warn(`[MetaWebhook] Sin bot registrado para phone_number_id=${phoneNumberId}`)
                        continue
                    }
                    const botId = String(bot._id || bot.id)

                    for (const msg of value.messages) {
                        // Dedupe por messageId — Meta reintenta si no respondiste 200.
                        const msgId = String(msg.id || '')
                        const dedupKey = msgId || crypto.createHash('md5')
                            .update(`${msg.from}_${msg.timestamp}_${msg.type}`).digest('hex')
                        if (processingLocks.has(dedupKey)) {
                            console.log(`[MetaWebhook] Mensaje ${dedupKey} ya en lock de memoria — saltando`)
                            continue
                        }
                        processingLocks.add(dedupKey)
                        setTimeout(() => processingLocks.delete(dedupKey), 10 * 60_000)

                        const alreadyDone = await db.collection('processed_webhooks').findOne({ messageId: dedupKey })
                        if (alreadyDone) {
                            console.log(`[MetaWebhook] Mensaje ${dedupKey} ya procesado (DB) — saltando`)
                            continue
                        }
                        await db.collection('processed_webhooks').insertOne({ messageId: dedupKey, createdAt: new Date() })

                        // Extraer texto según tipo. Si es media (image/audio/document/sticker)
                        // y tiene caption, usamos eso. Si no, dejamos placeholder
                        // que el LLM va a manejar como "el cliente mandó una foto".
                        const type = String(msg.type || 'text')
                        let text = ''
                        switch (type) {
                            case 'text':
                                text = msg.text?.body || ''
                                break
                            case 'image':
                                text = msg.image?.caption || '[Imagen]'
                                break
                            case 'audio':
                            case 'voice':
                                text = '[Audio]'
                                break
                            case 'document':
                                text = msg.document?.caption || `[Documento: ${msg.document?.filename || 'archivo'}]`
                                break
                            case 'video':
                                text = msg.video?.caption || '[Video]'
                                break
                            case 'sticker':
                                text = '[Sticker]'
                                break
                            case 'location':
                                text = `[Ubicación: ${msg.location?.latitude},${msg.location?.longitude}]`
                                break
                            case 'button':
                                text = msg.button?.text || msg.button?.payload || ''
                                break
                            case 'interactive':
                                text = msg.interactive?.button_reply?.title
                                    || msg.interactive?.list_reply?.title
                                    || msg.interactive?.button_reply?.id
                                    || msg.interactive?.list_reply?.id
                                    || ''
                                break
                            default:
                                text = `[${type}]`
                        }

                        const fromPhone = String(msg.from || '')
                        if (!fromPhone) continue

                        console.log(`[MetaWebhook] Procesando mensaje ${msgId.slice(0,12)}... bot=${botId} from=${fromPhone} type=${type}`)

                        try {
                            await botManager.processExternalMessage({
                                botId,
                                from: fromPhone,
                                text: text || `[${type}]`,
                                platform: 'meta',
                                externalId: String(phoneNumberId),
                            })
                        } catch (procErr: any) {
                            console.error(`[MetaWebhook] processExternalMessage falló para bot ${botId}:`, procErr?.message || procErr)
                        }
                    }
                }
            }
        })
    } catch (error: any) {
        console.error('[MetaWebhook] Error crítico en handler:', error?.message || error)
    }
}

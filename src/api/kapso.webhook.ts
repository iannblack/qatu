import { Request, Response } from 'express'
import { botManager } from '../services/bot-manager'
import { getDB } from '../services/db.service'
import { appendFileSync } from 'fs'
import crypto from 'crypto'

// Bloqueo en memoria temporal para evitar Race Conditions de retries ultra-rápidos de Kapso
const processingLocks = new Set<string>();

/**
 * Endpoint para recibir webhooks de Kapso (mensajes de WhatsApp)
 * Formato Kapso standard
 */
export const kapsoWebhookHandler = async (req: Request, res: Response) => {
    try {
        try {
            appendFileSync('kapso_debug.log', `\n[${new Date().toISOString()}] REQ.BODY:\n${JSON.stringify(req.body, null, 2)}\n`);
        } catch (fileErr) {
            console.warn('[KapsoWebhook] Could not write to kapso_debug.log', fileErr);
        }
        
        const { event, data } = req.body

        // Reconocimiento Universal del formato
        const messagesToProcess: any[] = [];

        if (req.body.message && req.body.message.from && req.body.message.kapso) {
            // Formato Kapso Directo (Sandbox / API v2)
            messagesToProcess.push({
                id: req.body.message.id,
                phone_number_id: req.query.phone || req.query.phoneNumberId || req.body.message.kapso?.recipient_id,
                from: req.body.message.from,
                text: req.body.message.text?.body || req.body.message.kapso?.content || '',
                type: req.body.message.type || 'text',
                isKapsoNative: true
            });
        } else if (event === 'whatsapp.message.received' && data) {
            // Formato Kapso aplanado
            messagesToProcess.push({
                id: data.message?.id || data.id, // Extract ID to avoid duplicates!
                phone_number_id: data.phone_number_id || data.metadata?.phone_number_id,
                from: data.contact?.phone_number || data.contact?.wa_id || data.message?.from,
                text: data.message?.text?.body || '',
                type: data.message?.type || 'text'
            });
        } else if (req.body.object === 'whatsapp_business_account' && req.body.entry) {
            // Formato Meta Cloud API Raw
            for (const entry of req.body.entry) {
                if (!entry.changes) continue;
                for (const change of entry.changes) {
                    if (change.field === 'messages' && change.value.messages) {
                        const metadata = change.value.metadata;
                        for (const msg of change.value.messages) {
                            if (msg.type !== 'text' && msg.type !== 'audio' && msg.type !== 'image') continue; // Ignorar statuses
                            messagesToProcess.push({
                                id: msg.id, // Extract ID for deduplication
                                phone_number_id: metadata?.phone_number_id,
                                from: msg.from,
                                text: msg.text?.body || '',
                                type: msg.type
                            });
                        }
                    }
                }
            }
        } else {
            console.log(`[KapsoWebhook] Ignorando evento no soportado: ${event || req.body.object}`);
        }

        // RESPONDER 200 OK INMEDIATAMENTE para que Kapso no vuelva a re-intentar el webhook por timeout
        res.status(200).send('OK')

        // E16chats: validación defensiva del payload de Kapso. Antes pasábamos
        // cualquier mensaje al bot sin validar — esto causaba que conversaciones
        // sintéticas / status updates / mensajes outbound aparecieran como chats
        // entrantes nuevos. Reglas:
        //   • Debe tener `from` en formato de número (al menos 8 dígitos).
        //   • Debe tener texto o ser media reconocida (audio/image/document).
        //   • `from` no debe coincidir con `phone_number_id` (sería el bot
        //     mensajeándose a sí mismo).
        //   • `direction === 'outbound'` se descarta antes (línea 114).
        const isValidKapsoMessage = (msg: any) => {
            const fromDigits = String(msg.from || '').replace(/\D/g, '')
            if (fromDigits.length < 8) return false
            const phoneIdDigits = String(msg.phone_number_id || '').replace(/\D/g, '')
            if (phoneIdDigits.length >= 8 && fromDigits === phoneIdDigits) return false
            const allowedTypes = new Set(['text', 'audio', 'image', 'video', 'document', 'sticker'])
            if (!allowedTypes.has(String(msg.type || 'text'))) return false
            const hasText = !!(msg.text && String(msg.text).trim())
            const isMedia = ['audio', 'image', 'video', 'document', 'sticker'].includes(String(msg.type))
            if (!hasText && !isMedia) return false
            return true
        }
        const filteredMessages = messagesToProcess.filter(isValidKapsoMessage)
        if (filteredMessages.length !== messagesToProcess.length) {
            console.warn(`[KapsoWebhook] ${messagesToProcess.length - filteredMessages.length} mensaje(s) descartado(s) por validación`)
        }

        // Procesar mensajes extraídos de forma asíncrona
        setTimeout(async () => {
            try {
                const db = getDB()
                for (const msg of filteredMessages) {
                    // 1. Detección inteligente del ID del número
                    let kapsoIdStr = msg.phone_number_id ? String(msg.phone_number_id) : null;
                    
                    if (!kapsoIdStr) {
                        const botFallback = await db.collection('bot_configs').findOne({ platform: 'kapso' });
                        if (botFallback) {
                            kapsoIdStr = botFallback.kapsoPhoneNumberId;
                        }
                    }

                    if (!kapsoIdStr) {
                        console.warn('[KapsoWebhook] No se pudo determinar el ID del número');
                        continue;
                    }

                    // 2. Evitar procesar el mismo mensaje duplicado (Race conditions de Webhook Retries)
                    // Si Kapso no provee ID, generamos un hash único basado en el mensaje y emisor para deduplicar
                    const msgIdToLock = msg.id || crypto.createHash('md5').update(`${msg.from}_${msg.text}`).digest('hex');
                    
                    if (processingLocks.has(msgIdToLock)) {
                        console.log(`[KapsoWebhook] ALERTA: Mensaje ${msgIdToLock} bloqueado en memoria (Retry muy rápido). Ignorando.`);
                        continue;
                    }

                    // Bloquear in-memory para esta instancia de NodeJS temporalmente (por si DB es lenta)
                    processingLocks.add(msgIdToLock);
                    setTimeout(() => processingLocks.delete(msgIdToLock), 10 * 60 * 1000); // limpiar en 10 min

                    const alreadyProcessed = await db.collection('processed_webhooks').findOne({ messageId: msgIdToLock });
                    if (alreadyProcessed) {
                        console.log(`[KapsoWebhook] Mensaje ${msgIdToLock} ya procesado en DB. Ignorando.`);
                        continue;
                    }
                    await db.collection('processed_webhooks').insertOne({ messageId: msgIdToLock, createdAt: new Date() });

                    // 3. Ignorar mensajes enviados por el bot
                    if (req.body.message?.kapso?.direction === 'outbound' || req.body.message?.direction === 'outbound') {
                        continue;
                    }

                    console.log(`[KapsoWebhook] Procesando mensaje de ${msg.from} para KapsoID: ${kapsoIdStr}`)
                    
                    // 4. Buscar el bot por su ID de Kapso
                    const bot = await db.collection('bot_configs').findOne({ 
                        $or: [
                            { kapsoPhoneNumberId: kapsoIdStr },
                            { kapsoPhoneNumberId: Number(kapsoIdStr) }
                        ] 
                    });

                    if (bot) {
                        // El proceso pasa a manager donde invoca ChatGPT (esto tarda unos segundos)
                        await botManager.processExternalMessage({
                            botId: bot._id.toString(),
                            from: String(msg.from),
                            text: msg.text || '[Mensaje sin texto]',
                            platform: 'kapso',
                            externalId: kapsoIdStr
                        })
                    }
                }
            } catch (bgError) {
                console.error('[KapsoWebhook] Error en procesamiento asíncrono:', bgError)
            }
        }, 0)

    } catch (error: any) {
        console.error('[KapsoWebhook] Error crítico procesando webhook:', error)
        if (!res.headersSent) {
            res.status(500).json({ error: 'Internal Server Error' })
        }
    }
}

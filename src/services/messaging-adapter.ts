/**
 * D-12: Messaging Adapter Pattern
 *
 * Abstraction layer that decouples Qhatu's business logic from the WhatsApp provider.
 * Currently wraps Baileys (unofficial). Designed for future migration to official API
 * (360dialog, Twilio, Gupshup, Wati, or Meta Cloud API directly).
 *
 * Usage: Replace direct Baileys calls with MessagingAdapter methods.
 * To migrate: implement a new class (e.g. TwilioAdapter) and swap in the factory.
 *
 * Risks of current Baileys implementation:
 *   - Ban risk: Meta can ban numbers without notice (ToS violation)
 *   - No SLA: if Meta changes protocol, Baileys breaks until community patches
 *   - No templates: can't send proactive messages after 24h window
 *   - No verified badge: no green checkmark for business accounts
 *   - Legal: SaaS charging subscriptions on unofficial API is fragile
 */

export interface MessagingAdapter {
    /** Unique identifier for this provider */
    readonly provider: string

    /** Connect/authenticate with the messaging service */
    connect(config: ConnectionConfig): Promise<void>

    /** Send a text message */
    sendText(to: string, text: string): Promise<SendResult>

    /** Send a media message (image, document, etc.) */
    sendMedia?(to: string, media: MediaPayload): Promise<SendResult>

    /** Register handler for incoming messages */
    onMessage(handler: (msg: IncomingMessage) => Promise<void>): void

    /** Register handler for connection status changes */
    onStatusChange(handler: (status: ConnectionStatus) => void): void

    /** Disconnect and clean up */
    disconnect(): Promise<void>

    /** Get current connection status */
    getStatus(): ConnectionStatus
}

export interface ConnectionConfig {
    /** Bot/session identifier */
    botId: string
    /** Provider-specific credentials */
    credentials?: Record<string, string>
    /** Session directory for file-based auth (Baileys) */
    sessionDir?: string
    /** Webhook URL for cloud-based providers */
    webhookUrl?: string
    /** API key for BSP providers */
    apiKey?: string
    /** Phone number ID for Meta Cloud API */
    phoneNumberId?: string
}

export interface SendResult {
    success: boolean
    messageId?: string
    error?: string
}

export interface MediaPayload {
    type: 'image' | 'document' | 'audio' | 'video'
    data: Buffer | string // Buffer for inline, string for URL
    mimeType?: string
    filename?: string
    caption?: string
}

export interface IncomingMessage {
    from: string           // sender phone/JID
    text: string           // message text content
    timestamp: Date
    messageId?: string
    pushName?: string      // sender display name
    audioData?: Buffer
    imageData?: Buffer
    isGroup?: boolean
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

// ═══════════════════════════════════════════════════════════════
// BAILEYS ADAPTER — Current implementation (unofficial)
// ═══════════════════════════════════════════════════════════════

/**
 * BaileysAdapter wraps the current Baileys integration.
 * This is the adapter to replace when migrating to an official API.
 *
 * Migration effort estimate:
 *   - 360dialog: ~2-3 days (REST API, LATAM-friendly, straightforward)
 *   - Twilio: ~3-5 days (more robust but more complex setup)
 *   - Meta Cloud API direct: ~4-7 days (requires Business Manager approval)
 */
export class BaileysAdapter implements MessagingAdapter {
    readonly provider = 'baileys'
    private socket: any = null
    private status: ConnectionStatus = 'disconnected'
    private messageHandler: ((msg: IncomingMessage) => Promise<void>) | null = null
    private statusHandler: ((status: ConnectionStatus) => void) | null = null

    async connect(config: ConnectionConfig): Promise<void> {
        // Baileys connection is managed by BotManager.createSession()
        // This adapter delegates to the existing implementation
        this.status = 'connecting'
        this.statusHandler?.('connecting')
    }

    async sendText(to: string, text: string): Promise<SendResult> {
        if (!this.socket || this.status !== 'connected') {
            return { success: false, error: 'Not connected' }
        }
        try {
            const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`
            const result = await this.socket.sendMessage(jid, { text })
            return { success: true, messageId: result?.key?.id }
        } catch (e: any) {
            return { success: false, error: e.message }
        }
    }

    async sendMedia(to: string, media: MediaPayload): Promise<SendResult> {
        if (!this.socket || this.status !== 'connected') {
            return { success: false, error: 'Not connected' }
        }
        try {
            const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`
            const msg: any = {}
            if (media.type === 'image') {
                msg.image = media.data
                if (media.caption) msg.caption = media.caption
            } else if (media.type === 'document') {
                msg.document = media.data
                msg.mimetype = media.mimeType || 'application/pdf'
                if (media.filename) msg.fileName = media.filename
            }
            const result = await this.socket.sendMessage(jid, msg)
            return { success: true, messageId: result?.key?.id }
        } catch (e: any) {
            return { success: false, error: e.message }
        }
    }

    onMessage(handler: (msg: IncomingMessage) => Promise<void>): void {
        this.messageHandler = handler
    }

    onStatusChange(handler: (status: ConnectionStatus) => void): void {
        this.statusHandler = handler
    }

    async disconnect(): Promise<void> {
        if (this.socket) {
            try { await this.socket.logout() } catch { /* may already be closed */ }
            this.socket = null
        }
        this.status = 'disconnected'
        this.statusHandler?.('disconnected')
    }

    getStatus(): ConnectionStatus {
        return this.status
    }

    // Internal: called by BotManager to inject the Baileys socket
    _setSocket(socket: any): void {
        this.socket = socket
        this.status = 'connected'
        this.statusHandler?.('connected')
    }

    _setStatus(status: ConnectionStatus): void {
        this.status = status
        this.statusHandler?.(status)
    }
}

// ═══════════════════════════════════════════════════════════════
// PLACEHOLDER: Official API Adapter (for future migration)
// ═══════════════════════════════════════════════════════════════

/**
 * Example adapter for 360dialog / Meta Cloud API.
 * Uncomment and implement when ready to migrate.
 *
 * class OfficialWhatsAppAdapter implements MessagingAdapter {
 *     readonly provider = '360dialog' // or 'meta_cloud' or 'twilio'
 *
 *     async connect(config: ConnectionConfig): Promise<void> {
 *         // Set up webhook receiver + authenticate with BSP API
 *     }
 *
 *     async sendText(to: string, text: string): Promise<SendResult> {
 *         // POST to BSP REST API with message payload
 *     }
 *
 *     // ... etc
 * }
 */

// ═══════════════════════════════════════════════════════════════
// FACTORY — swap provider here when migrating
// ═══════════════════════════════════════════════════════════════

export function createMessagingAdapter(provider?: string): MessagingAdapter {
    // When ready to migrate, change this to return OfficialWhatsAppAdapter
    switch (provider) {
        // case '360dialog': return new OfficialWhatsAppAdapter()
        // case 'twilio': return new TwilioAdapter()
        default:
            return new BaileysAdapter()
    }
}

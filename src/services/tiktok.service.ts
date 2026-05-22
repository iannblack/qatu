import axios from 'axios'

/**
 * TikTok Business Messaging Integration
 * 
 * Flow:
 * 1. User clicks "Connect TikTok" → redirected to TikTok OAuth
 * 2. User authorizes → callback receives code → exchanged for access token
 * 3. Webhook receives incoming DMs → routed to bot-manager
 * 4. Bot-manager generates AI response → sent back via TikTok API
 */

const TIKTOK_AUTH_URL = 'https://www.tiktok.com/v2/auth/authorize/'
const TIKTOK_TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/'
const TIKTOK_API = 'https://open.tiktokapis.com/v2'

export class TikTokService {
    private clientKey: string
    private clientSecret: string
    private verifyToken: string
    private webhookBaseUrl: string

    constructor() {
        this.clientKey = process.env.TIKTOK_CLIENT_KEY || ''
        this.clientSecret = process.env.TIKTOK_CLIENT_SECRET || ''
        this.verifyToken = process.env.TIKTOK_VERIFY_TOKEN || 'kipu_tt_verify_2026'
        this.webhookBaseUrl = process.env.WEBHOOK_BASE_URL || ''
    }

    /**
     * Generate TikTok OAuth URL
     */
    getOAuthURL(botId: string): string {
        const redirectUri = `${this.webhookBaseUrl}/api/auth/tiktok/callback`
        const scopes = 'user.info.basic,message.send,message.read'

        return `${TIKTOK_AUTH_URL}?` +
            `client_key=${this.clientKey}` +
            `&redirect_uri=${encodeURIComponent(redirectUri)}` +
            `&scope=${encodeURIComponent(scopes)}` +
            `&response_type=code` +
            `&state=${botId}`
    }

    /**
     * Exchange auth code for access token
     */
    async handleOAuthCallback(code: string): Promise<{
        accessToken: string
        refreshToken: string
        openId: string
        expiresIn: number
    }> {
        const redirectUri = `${this.webhookBaseUrl}/auth/tiktok/callback`

        const res = await axios.post(TIKTOK_TOKEN_URL, new URLSearchParams({
            client_key: this.clientKey,
            client_secret: this.clientSecret,
            code,
            grant_type: 'authorization_code',
            redirect_uri: redirectUri
        }).toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        })

        const data = res.data.data || res.data
        if (!data.access_token) {
            throw new Error(`TikTok OAuth failed: ${JSON.stringify(res.data)}`)
        }

        return {
            accessToken: data.access_token,
            refreshToken: data.refresh_token || '',
            openId: data.open_id || '',
            expiresIn: data.expires_in || 86400
        }
    }

    /**
     * Refresh access token
     */
    async refreshAccessToken(refreshToken: string): Promise<{
        accessToken: string
        refreshToken: string
        expiresIn: number
    }> {
        const res = await axios.post(TIKTOK_TOKEN_URL, new URLSearchParams({
            client_key: this.clientKey,
            client_secret: this.clientSecret,
            grant_type: 'refresh_token',
            refresh_token: refreshToken
        }).toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        })

        const data = res.data.data || res.data
        return {
            accessToken: data.access_token,
            refreshToken: data.refresh_token || refreshToken,
            expiresIn: data.expires_in || 86400
        }
    }

    /**
     * Send a text message via TikTok Business Messaging API
     */
    async sendMessage(conversationId: string, text: string, accessToken: string): Promise<void> {
        try {
            await axios.post(`${TIKTOK_API}/business/message/send/`, {
                conversation_id: conversationId,
                message: {
                    type: 'text',
                    text
                }
            }, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            })
            console.log(`[TikTok] Message sent to conversation ${conversationId}`)
        } catch (err: any) {
            console.error(`[TikTok] Send error:`, err.response?.data || err.message)
            throw err
        }
    }

    /**
     * Parse incoming webhook payload
     */
    parseWebhook(body: any): Array<{
        senderId: string
        conversationId: string
        text: string
        timestamp: number
    }> {
        const messages: Array<{
            senderId: string
            conversationId: string
            text: string
            timestamp: number
        }> = []

        // TikTok webhook structure
        const events = body.events || body.data || []
        for (const event of Array.isArray(events) ? events : [events]) {
            if (event.type === 'receive_message' || event.event === 'receive_message') {
                const msg = event.message || event.content || {}
                messages.push({
                    senderId: event.sender?.open_id || event.from_user_id || '',
                    conversationId: event.conversation_id || event.conversation?.id || '',
                    text: msg.text || msg.content || '',
                    timestamp: event.create_time || Date.now()
                })
            }
        }

        return messages
    }

    /**
     * Verify webhook (TikTok uses a different mechanism)
     */
    verifyWebhook(body: any): string | null {
        // TikTok sends a challenge in the body during registration
        if (body.challenge) {
            console.log(`[TikTok] Webhook verified with challenge`)
            return body.challenge
        }
        return null
    }

    /**
     * Check if service is configured
     */
    isConfigured(): boolean {
        return !!(this.clientKey && this.clientSecret && this.webhookBaseUrl)
    }
}

export const tiktokService = new TikTokService()

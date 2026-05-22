import axios from 'axios'

/**
 * Instagram Messaging Integration via Meta Graph API
 * 
 * Flow:
 * 1. User clicks "Connect Instagram" → redirected to Meta OAuth
 * 2. User authorizes → callback receives code → exchanged for access token
 * 3. Webhook receives incoming DMs → routed to bot-manager
 * 4. Bot-manager generates AI response → sent back via Graph API
 */

const GRAPH_API = 'https://graph.facebook.com/v21.0'

export class InstagramService {
    private appId: string
    private appSecret: string
    private verifyToken: string
    private webhookBaseUrl: string

    constructor() {
        this.appId = process.env.META_APP_ID || ''
        this.appSecret = process.env.META_APP_SECRET || ''
        this.verifyToken = process.env.META_VERIFY_TOKEN || 'kipu_ig_verify_2026'
        this.webhookBaseUrl = process.env.WEBHOOK_BASE_URL || ''
    }

    /**
     * Generate Meta OAuth URL for Instagram login
     */
    getOAuthURL(botId: string): string {
        const redirectUri = `${this.webhookBaseUrl}/api/auth/instagram/callback`
        const scopes = [
            'instagram_basic',
            'instagram_manage_messages',
            'pages_show_list',
            'pages_manage_metadata',
            'pages_messaging'
        ].join(',')

        return `https://www.facebook.com/v21.0/dialog/oauth?` +
            `client_id=${this.appId}` +
            `&redirect_uri=${encodeURIComponent(redirectUri)}` +
            `&scope=${scopes}` +
            `&state=${botId}` +
            `&response_type=code`
    }

    /**
     * Exchange auth code for long-lived access token
     */
    async handleOAuthCallback(code: string): Promise<{
        accessToken: string
        igUserId: string
        pageName: string
        pageId: string
    }> {
        const redirectUri = `${this.webhookBaseUrl}/auth/instagram/callback`

        // Step 1: Exchange code for short-lived token
        const tokenRes = await axios.get(`${GRAPH_API}/oauth/access_token`, {
            params: {
                client_id: this.appId,
                client_secret: this.appSecret,
                redirect_uri: redirectUri,
                code
            }
        })
        const shortToken = tokenRes.data.access_token

        // Step 2: Exchange for long-lived token (60 days)
        const longTokenRes = await axios.get(`${GRAPH_API}/oauth/access_token`, {
            params: {
                grant_type: 'fb_exchange_token',
                client_id: this.appId,
                client_secret: this.appSecret,
                fb_exchange_token: shortToken
            }
        })
        const longToken = longTokenRes.data.access_token

        // Step 3: Get user's Pages
        const pagesRes = await axios.get(`${GRAPH_API}/me/accounts`, {
            params: { access_token: longToken }
        })
        const page = pagesRes.data.data?.[0]
        if (!page) throw new Error('No Facebook Page found. Link a Page to your account.')

        const pageAccessToken = page.access_token
        const pageId = page.id
        const pageName = page.name

        // Step 4: Get Instagram Business Account ID linked to Page
        const igRes = await axios.get(`${GRAPH_API}/${pageId}`, {
            params: {
                fields: 'instagram_business_account',
                access_token: pageAccessToken
            }
        })
        const igUserId = igRes.data.instagram_business_account?.id
        if (!igUserId) throw new Error('No Instagram Business Account linked to this Page.')

        // Step 5: Subscribe page to webhook messaging events
        try {
            await axios.post(`${GRAPH_API}/${pageId}/subscribed_apps`, null, {
                params: {
                    subscribed_fields: 'messages,messaging_postbacks',
                    access_token: pageAccessToken
                }
            })
            console.log(`[Instagram] Page ${pageName} subscribed to messaging webhooks`)
        } catch (err: any) {
            console.warn(`[Instagram] Could not subscribe to webhooks:`, err.response?.data || err.message)
        }

        return {
            accessToken: pageAccessToken,
            igUserId,
            pageName,
            pageId
        }
    }

    /**
     * Send a text message via Instagram Graph API
     */
    async sendMessage(recipientId: string, text: string, accessToken: string): Promise<void> {
        try {
            await axios.post(`${GRAPH_API}/me/messages`, {
                recipient: { id: recipientId },
                message: { text }
            }, {
                params: { access_token: accessToken }
            })
            console.log(`[Instagram] Message sent to ${recipientId}`)
        } catch (err: any) {
            console.error(`[Instagram] Send error:`, err.response?.data || err.message)
            throw err
        }
    }

    /**
     * Verify webhook subscription (GET challenge)
     */
    verifyWebhook(mode: string, token: string, challenge: string): string | null {
        if (mode === 'subscribe' && token === this.verifyToken) {
            console.log(`[Instagram] Webhook verified`)
            return challenge
        }
        return null
    }

    /**
     * Parse incoming webhook payload and extract messages
     */
    parseWebhook(body: any): Array<{
        senderId: string
        recipientId: string
        text: string
        timestamp: number
    }> {
        const messages: Array<{
            senderId: string
            recipientId: string
            text: string
            timestamp: number
        }> = []

        if (body.object !== 'instagram' && body.object !== 'page') return messages

        for (const entry of body.entry || []) {
            for (const event of entry.messaging || []) {
                if (event.message && !event.message.is_echo) {
                    messages.push({
                        senderId: event.sender.id,
                        recipientId: event.recipient.id,
                        text: event.message.text || '',
                        timestamp: event.timestamp
                    })
                }
            }
        }

        return messages
    }

    /**
     * Check if service is configured
     */
    isConfigured(): boolean {
        return !!(this.appId && this.appSecret && this.webhookBaseUrl)
    }
}

export const instagramService = new InstagramService()

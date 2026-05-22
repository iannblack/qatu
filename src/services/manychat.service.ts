import axios, { AxiosInstance } from 'axios'

/**
 * ManyChat API Integration Service
 * 
 * Handles Instagram & TikTok DMs through ManyChat as middleware.
 * ManyChat manages OAuth/platform complexity; we use their API for messaging.
 * 
 * Flow:
 * 1. ManyChat webhook sends incoming DM data → /api/webhook/manychat
 * 2. Bot processes message through AI (handleMessage)
 * 3. AI response sent back via ManyChat sendContent API
 */

const MANYCHAT_API = 'https://api.manychat.com'

interface ManyChatSubscriber {
    id: string
    page_id: string
    first_name: string
    last_name: string
    name: string
    gender: string
    profile_pic: string
    locale: string
    language: string
    timezone: string
    live_chat_url: string
    last_input_text: string
    phone: string
    email: string
    ig_username: string
    ig_id: number
    whatsapp_phone: string
    subscribed: string
    last_interaction: string
    last_seen: string
    is_followup_enabled: boolean
    custom_fields: Array<{ id: number; name: string; type: string; value: any }>
    tags: Array<{ id: number; name: string }>
}

interface ManyChatPageInfo {
    id: number | null
    name: string
    category: string | null
    is_pro: boolean
    timezone: string
}

export class ManyChatService {
    private apiKey: string
    private client: AxiosInstance

    constructor() {
        this.apiKey = process.env.MANYCHAT_API_KEY || ''
        this.client = axios.create({
            baseURL: MANYCHAT_API,
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        })
    }

    /**
     * Check if service is configured with a valid API key
     */
    isConfigured(): boolean {
        return !!this.apiKey
    }

    /**
     * Get ManyChat page info (health check)
     */
    async getPageInfo(): Promise<ManyChatPageInfo | null> {
        try {
            const res = await this.client.get('/fb/page/getInfo')
            if (res.data.status === 'success') {
                return res.data.data
            }
            console.error('[ManyChat] getPageInfo error:', res.data)
            return null
        } catch (err: any) {
            console.error('[ManyChat] getPageInfo failed:', err.response?.data || err.message)
            return null
        }
    }

    /**
     * Get subscriber info by ID
     */
    async getSubscriberInfo(subscriberId: number): Promise<ManyChatSubscriber | null> {
        try {
            const res = await this.client.get('/fb/subscriber/getInfo', {
                params: { subscriber_id: subscriberId }
            })
            if (res.data.status === 'success') {
                return res.data.data
            }
            return null
        } catch (err: any) {
            console.error('[ManyChat] getSubscriberInfo error:', err.response?.data || err.message)
            return null
        }
    }

    /**
     * Find subscriber by email or phone
     */
    async findSubscriber(email?: string, phone?: string): Promise<ManyChatSubscriber | null> {
        try {
            const params: any = {}
            if (email) params.email = email
            else if (phone) params.phone = phone
            else return null

            const res = await this.client.get('/fb/subscriber/findBySystemField', { params })
            if (res.data.status === 'success') {
                return res.data.data
            }
            return null
        } catch (err: any) {
            console.error('[ManyChat] findSubscriber error:', err.response?.data || err.message)
            return null
        }
    }

    /**
     * Send text content to a subscriber via ManyChat
     * This is the primary method to reply to DMs on Instagram/TikTok
     */
    async sendTextMessage(subscriberId: number, text: string, messageTag?: string): Promise<boolean> {
        try {
            // ManyChat Dynamic Block data format
            const data = {
                version: 'v2',
                content: {
                    messages: [
                        {
                            type: 'text',
                            text: text
                        }
                    ]
                }
            }

            const payload: any = {
                subscriber_id: subscriberId,
                data,
                message_tag: messageTag || 'ACCOUNT_UPDATE'
            }

            const res = await this.client.post('/fb/sending/sendContent', payload)
            if (res.data.status === 'success') {
                console.log(`[ManyChat] ✅ Message sent to subscriber ${subscriberId}`)
                return true
            }

            console.error('[ManyChat] sendContent failed:', res.data)
            return false
        } catch (err: any) {
            const errData = err.response?.data
            // Handle 24h window restriction gracefully
            if (errData?.code === 3011) {
                console.warn(`[ManyChat] ⚠️ Can't send to ${subscriberId}: outside 24h window. Needs message tag or OTN.`)
            } else {
                console.error('[ManyChat] sendTextMessage error:', errData || err.message)
            }
            return false
        }
    }

    /**
     * Send a ManyChat flow/automation to a subscriber
     */
    async sendFlow(subscriberId: number, flowNamespace: string): Promise<boolean> {
        try {
            const res = await this.client.post('/fb/sending/sendFlow', {
                subscriber_id: subscriberId,
                flow_ns: flowNamespace
            })
            return res.data.status === 'success'
        } catch (err: any) {
            console.error('[ManyChat] sendFlow error:', err.response?.data || err.message)
            return false
        }
    }

    /**
     * Add a tag to a subscriber (useful for lead scoring sync)
     */
    async addTag(subscriberId: number, tagName: string): Promise<boolean> {
        try {
            const res = await this.client.post('/fb/subscriber/addTagByName', {
                subscriber_id: subscriberId,
                tag_name: tagName
            })
            return res.data.status === 'success'
        } catch (err: any) {
            console.error('[ManyChat] addTag error:', err.response?.data || err.message)
            return false
        }
    }

    /**
     * Remove a tag from a subscriber
     */
    async removeTag(subscriberId: number, tagName: string): Promise<boolean> {
        try {
            const res = await this.client.post('/fb/subscriber/removeTagByName', {
                subscriber_id: subscriberId,
                tag_name: tagName
            })
            return res.data.status === 'success'
        } catch (err: any) {
            console.error('[ManyChat] removeTag error:', err.response?.data || err.message)
            return false
        }
    }

    /**
     * Set a custom field value on a subscriber (CRM sync)
     */
    async setCustomField(subscriberId: number, fieldName: string, fieldValue: any): Promise<boolean> {
        try {
            const res = await this.client.post('/fb/subscriber/setCustomFieldByName', {
                subscriber_id: subscriberId,
                field_name: fieldName,
                field_value: fieldValue
            })
            return res.data.status === 'success'
        } catch (err: any) {
            console.error('[ManyChat] setCustomField error:', err.response?.data || err.message)
            return false
        }
    }

    /**
     * Get all tags configured in ManyChat
     */
    async getTags(): Promise<Array<{ id: number; name: string }>> {
        try {
            const res = await this.client.get('/fb/page/getTags')
            if (res.data.status === 'success') {
                return res.data.data || []
            }
            return []
        } catch (err: any) {
            console.error('[ManyChat] getTags error:', err.response?.data || err.message)
            return []
        }
    }

    /**
     * Get all flows configured in ManyChat
     */
    async getFlows(): Promise<Array<{ ns: string; name: string }>> {
        try {
            const res = await this.client.get('/fb/page/getFlows')
            if (res.data.status === 'success') {
                return res.data.data?.flows || []
            }
            return []
        } catch (err: any) {
            console.error('[ManyChat] getFlows error:', err.response?.data || err.message)
            return []
        }
    }

    /**
     * Sync lead score level as a ManyChat tag
     * Removes old level tags and adds the current one
     */
    async syncLeadScoreTag(subscriberId: number, scoreLevel: string): Promise<void> {
        const levelTags = ['FRIO', 'TIBIO', 'CALIENTE', 'COMPRADOR']
        try {
            // Remove all level tags first
            for (const tag of levelTags) {
                if (tag !== scoreLevel) {
                    await this.removeTag(subscriberId, `Qhatu_${tag}`)
                }
            }
            // Add current level tag
            await this.addTag(subscriberId, `Qhatu_${scoreLevel}`)
            console.log(`[ManyChat] Lead score synced: subscriber ${subscriberId} → ${scoreLevel}`)
        } catch (err: any) {
            console.error('[ManyChat] syncLeadScoreTag error:', err.message)
        }
    }
}

export const manychatService = new ManyChatService()

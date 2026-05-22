import axios from 'axios'

const KAPSO_API_BASE = 'https://api.kapso.ai/platform/v1'

// Helper to get headers dynamically
const getHeaders = () => {
    const apiKey = process.env.KAPSO_API_KEY
    if (!apiKey) {
        console.warn('[KapsoService] Warning: KAPSO_API_KEY is not defined in .env')
    }
    return {
        'X-API-Key': apiKey,
        'Authorization': `Bearer ${apiKey}`, // Sending both for compatibility as per docs
        'Content-Type': 'application/json'
    }
}

export interface KapsoPhoneNumber {
    id: string
    name: string
    phone_number: string
    status: string
}

class KapsoService {
    async listPhoneNumbers(): Promise<KapsoPhoneNumber[]> {
        try {
            const response = await axios.get(`${KAPSO_API_BASE}/whatsapp/phone_numbers`, {
                headers: getHeaders()
            })
            return response.data.data || []
        } catch (error: any) {
            console.error('[KapsoService] Error listing phone numbers:', error.response?.data || error.message)
            throw new Error('Error al listar números de Kapso')
        }
    }

    async createSetupLink(customerId: string): Promise<string> {
        try {
            const response = await axios.post(`${KAPSO_API_BASE}/customers/${customerId}/setup_links`, {
                setup_link: {}
            }, {
                headers: getHeaders()
            })
            return response.data.data?.url || ''
        } catch (error: any) {
            console.error('[KapsoService] Error creating setup link:', error.response?.data || error.message)
            throw new Error('Error al crear link de conexión en Kapso')
        }
    }

    async setupWebhook(phoneNumberId: string, webhookUrl: string): Promise<void> {
        try {
            await axios.post(`${KAPSO_API_BASE}/whatsapp/phone_numbers/${phoneNumberId}/webhooks`, {
                whatsapp_webhook: {
                    url: webhookUrl,
                    kind: 'kapso',
                    events: [
                        'whatsapp.message.received',
                        'whatsapp.message.sent'
                    ]
                }
            }, {
                headers: getHeaders()
            })
        } catch (error: any) {
            console.error('[KapsoService] Error setting up webhook:', error.response?.data || error.message)
            throw new Error('Error al configurar webhook en Kapso')
        }
    }

    async syncLead(tableId: string, leadData: any): Promise<void> {
        try {
            await axios.post(`${KAPSO_API_BASE}/database/tables/${tableId}/rows`, {
                row: leadData
            }, {
                headers: getHeaders()
            })
        } catch (error: any) {
            console.error('[KapsoService] Error syncing lead:', error.response?.data || error.message)
        }
    }

    async sendMessage(phoneNumberId: string, to: string, text: string): Promise<void> {
        try {
            await axios.post(`https://api.kapso.ai/meta/whatsapp/${phoneNumberId}/messages`, {
                messaging_product: 'whatsapp',
                to,
                type: 'text',
                text: { body: text }
            }, {
                headers: getHeaders()
            })
        } catch (error: any) {
            console.error('[KapsoService] Error sending message via Kapso:', error.response?.data || error.message)
        }
    }
}

export const kapsoService = new KapsoService()

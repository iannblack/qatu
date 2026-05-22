/**
 * apify.service.ts — Lead enrichment via Apify WhatsApp Scraper
 * 
 * Polls/manages the Apify WhatsApp Messages Scraper actor to get sender info
 * (real phone numbers, sender names) and enriches our CRM leads.
 */

import { ApifyClient } from 'apify-client';

const ACTOR_ID = 'extremescrapes/whatsapp-messages-scraper';

let apifyClient: ApifyClient | null = null;
let latestRunId: string | null = null;
let isRunning = false;

// In-memory cache: maps various keys to sender info
// Keys: senderNumber, chatId, or normalized phone
const senderCache: Map<string, { senderNumber: string; senderName: string; timestamp: number }> = new Map();

function getClient(): ApifyClient | null {
    if (apifyClient) return apifyClient;
    const token = process.env.APIFY_API_TOKEN;
    if (!token) {
        console.log('[Apify] No APIFY_API_TOKEN configured, lead enrichment disabled');
        return null;
    }
    apifyClient = new ApifyClient({ token });
    return apifyClient;
}

/**
 * Start the Apify WhatsApp scraper actor.
 * Returns the run ID (user must scan QR in Apify logs).
 */
export async function startApifyActor(): Promise<{ runId: string; logUrl: string } | null> {
    const client = getClient();
    if (!client) return null;

    try {
        console.log('[Apify] Starting WhatsApp scraper actor...');
        const run = await client.actor(ACTOR_ID).call({
            instruction: "Scan QR code in the Log tab to connect WhatsApp"
        });
        latestRunId = run.id;
        isRunning = true;
        const logUrl = `https://console.apify.com/storage/datasets/${run.defaultDatasetId}`;
        console.log(`[Apify] ✅ Actor started — Run ID: ${run.id}`);
        console.log(`[Apify] 📊 Dataset: ${logUrl}`);
        return { runId: run.id, logUrl };
    } catch (e: any) {
        console.error('[Apify] Error starting actor:', e.message);
        return null;
    }
}

/**
 * Poll the latest Apify run dataset for new messages.
 * Extracts sender info and caches it for lead enrichment.
 */
export async function pollApifyDataset(): Promise<number> {
    const client = getClient();
    if (!client || !latestRunId) return 0;

    try {
        const run = await client.run(latestRunId).get();
        if (!run?.defaultDatasetId) return 0;

        const { items } = await client.dataset(run.defaultDatasetId).listItems();
        let newEntries = 0;

        for (const item of items) {
            const msg = item as any;
            if (!msg.senderNumber) continue;

            // Normalize phone number (remove + prefix, spaces)
            const phone = normalizePhone(msg.senderNumber);
            const senderInfo = {
                senderNumber: phone,
                senderName: msg.senderName || '',
                timestamp: msg.timestamp || Date.now() / 1000
            };

            // Cache by multiple keys for flexible matching
            if (phone && !senderCache.has(phone)) {
                senderCache.set(phone, senderInfo);
                newEntries++;
            }
            if (msg.chatId && !senderCache.has(msg.chatId)) {
                senderCache.set(msg.chatId, senderInfo);
            }
            // Also cache the raw senderNumber as-is
            if (msg.senderNumber && !senderCache.has(msg.senderNumber)) {
                senderCache.set(msg.senderNumber, senderInfo);
            }
        }

        if (newEntries > 0) {
            console.log(`[Apify] 📥 ${newEntries} new sender(s) cached. Total: ${senderCache.size}`);
        }
        return newEntries;
    } catch (e: any) {
        console.error('[Apify] Poll error:', e.message);
        return 0;
    }
}

/**
 * Look up sender info for a given phone/LID from Apify cache.
 * Returns { senderNumber, senderName } or null if not found.
 */
export function lookupSenderInfo(fromId: string): { senderNumber: string; senderName: string } | null {
    // Try exact match first
    if (senderCache.has(fromId)) return senderCache.get(fromId)!;

    // Try without @lid or @s.whatsapp.net suffix
    const cleanId = fromId.split('@')[0];
    if (senderCache.has(cleanId)) return senderCache.get(cleanId)!;

    // Try matching by partial phone similarity
    for (const [key, info] of senderCache.entries()) {
        if (cleanId.includes(info.senderNumber) || info.senderNumber.includes(cleanId)) {
            return info;
        }
    }

    return null;
}

/**
 * Manually add sender info (e.g., from an external webhook or manual input).
 */
export function addSenderInfo(phoneOrId: string, senderNumber: string, senderName: string): void {
    const normalized = normalizePhone(senderNumber);
    const info = { senderNumber: normalized, senderName, timestamp: Date.now() / 1000 };
    senderCache.set(phoneOrId, info);
    senderCache.set(normalized, info);
}

/**
 * Get stats about the enrichment cache.
 */
export function getApifyCacheStats(): { size: number; isRunning: boolean; latestRunId: string | null } {
    return { size: senderCache.size, isRunning, latestRunId };
}

/**
 * Start periodic polling (every 30 seconds).
 */
let pollInterval: NodeJS.Timeout | null = null;

export function startApifyPolling(intervalMs: number = 30000): void {
    if (pollInterval) return;
    pollInterval = setInterval(async () => {
        if (latestRunId) await pollApifyDataset();
    }, intervalMs);
    console.log(`[Apify] 🔄 Auto-polling started every ${intervalMs / 1000}s`);
}

export function stopApifyPolling(): void {
    if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
        console.log('[Apify] Polling stopped');
    }
}

// ─── Helpers ─────────────────────────────────

function normalizePhone(phone: string): string {
    return phone.replace(/[^0-9]/g, '');
}

/**
 * db.service.ts — Supabase adapter with MongoDB-compatible API
 * 
 * Provides collection().findOne(), find().toArray(), insertOne(), updateOne(),
 * updateMany(), deleteOne(), countDocuments(), distinct(), aggregate() wrappers
 * so that routes.ts and bot-manager.ts require minimal changes.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js'

let supabase: SupabaseClient

// ─── Field name mapping: MongoDB camelCase → Supabase snake_case ───
const FIELD_MAP: Record<string, string> = {
    _id: 'id', userId: 'user_id', botId: 'bot_id', botName: 'bot_name',
    systemPrompt: 'system_prompt', phoneNumber: 'phone_number',
    ownerPhone: 'owner_phone', advancedConfig: 'advanced_config',
    kapsoPhoneNumberId: 'kapso_phone_number_id',
    // Meta Cloud API (oficial WhatsApp Business Platform).
    // Cuando bot.messagingProvider === 'meta', el send/receive va por
    // graph.facebook.com en vez de Baileys. Credenciales son per-bot:
    // - metaPhoneNumberId: id del número en Meta (no el teléfono — un id numérico)
    // - metaAccessToken: System User permanent token con scope whatsapp_business_messaging
    // - metaWabaId: id del WhatsApp Business Account (opcional, audit)
    messagingProvider: 'messaging_provider',
    metaPhoneNumberId: 'meta_phone_number_id',
    metaAccessToken: 'meta_access_token',
    metaWabaId: 'meta_waba_id',
    metaConnected: 'meta_connected',
    metaConnectedAt: 'meta_connected_at',
    createdAt: 'created_at', updatedAt: 'updated_at',
    completedAt: 'completed_at', base_conocimiento: 'base_conocimiento',
    categoria_config: 'categoria_config',
    // leads
    leadScore: 'lead_score', scoreLevel: 'score_level',
    scoreSignals: 'score_signals', scoreObjections: 'score_objections',
    estado_clasificacion: 'estado_clasificacion',
    interes_general: 'interes_general', intencion_compra: 'intencion_compra',
    producto_interes: 'producto_interes', urgencia: 'urgencia',
    canal_origen: 'canal_origen', resumen_conversacion: 'resumen_conversacion',
    contactName: 'contact_name', lastMessage: 'last_message',
    enrichedPhone: 'enriched_phone',
    cadenceOptOut: 'cadence_opt_out', health_score: 'health_score',
    estado_resolucion: 'estado_resolucion', orderId: 'order_id',
    // leads — CRM 16-field structure
    ticketId: 'ticket_id', temperatura: 'temperatura',
    escaladoHumano: 'escalado_humano', estadoConversacion: 'estado_conversacion',
    consultaInicial: 'consulta_inicial', comentarios: 'comentarios',
    motivoEscalacion: 'motivo_escalacion', duracionCicloHoras: 'duracion_ciclo_horas',
    motivoPerdida: 'motivo_perdida', numMensajes: 'num_mensajes',
    sentimiento: 'sentimiento',
    assignedTo: 'assigned_to',
    // orders
    customerName: 'customer_name', customerLastName: 'customer_last_name',
    customerPhone: 'customer_phone',
    // conversations
    userMessage: 'user_message', botResponse: 'bot_response',
    responseTime_ms: 'response_time_ms', hadFallback: 'had_fallback',
    botPaused: 'bot_paused',
    // chat_history
    needsFollowUp: 'needs_follow_up', pausedAt: 'paused_at',
    pauseReason: 'pause_reason', lastInteraction: 'last_interaction',
    // alerts
    leadPhone: 'lead_phone', readAt: 'read_at',
    // cadences
    scoreAtCreation: 'score_at_creation', productContext: 'product_context',
    productCategory: 'product_category', isFromAd: 'is_from_ad',
    currentStepIndex: 'current_step_index', orderData: 'order_data',
    lastLeadMessageAt: 'last_lead_message_at', reactivationCount: 'reactivation_count',
    // scheduled_messages
    scheduledFor: 'scheduled_for', sentAt: 'sent_at',
    // business_info
    paymentMethods: 'payment_methods', fileName: 'file_name',
    fileUri: 'file_uri', mimeType: 'mime_type', handoffConfig: 'handoff_config',
    // crm_tickets
    nombre: 'name',
    businessName: 'business_name',
    from: 'phone',
    // G E1 — Profile/Settings: foto + plan tracking en users
    photoUrl: 'photo_url', planChangedAt: 'plan_changed_at',
    // sprint 1: orders / notifications
    orderCode: 'order_code', montoAdelanto: 'monto_adelanto',
    montoRestante: 'monto_restante', trackingNumber: 'tracking_number',
    isRead: 'is_read',
    resolvedAction: 'resolved_action', resolvedAt: 'resolved_at',
    // maya_sessions
    sessionId: 'session_id',
    // wa_messages
    chatJid: 'chat_jid', messageId: 'message_id', fromMe: 'from_me',
    senderJid: 'sender_jid', messageType: 'message_type', mediaUrl: 'media_url',
    quotedMessageId: 'quoted_message_id', rawKey: 'raw_key',
    // wa_chats (phoneNumber + lastMessage already mapped above)
    chatName: 'chat_name', isGroup: 'is_group',
    lastMessageAt: 'last_message_at',
    lastMessageFromMe: 'last_message_from_me', unreadCount: 'unread_count',
    isBotPaused: 'is_bot_paused',
    archivedReason: 'archived_reason',
    // soft-delete audit (orders, leads). Las columnas pueden no existir aún
    // en Supabase — el endpoint correspondiente hace fallback sin metadata.
    archivedAt: 'archived_at', archivedBy: 'archived_by',
    deletedAt: 'deleted_at', deletedBy: 'deleted_by',
    // bot_configs — audit de conexión multi-número (pantalla "Conexiones").
    // Si la columna no está en Supabase, el UPDATE de updateBotStatus va a
    // tirar el mismo "Could not find the X column" — ahí se aplica el SQL
    // de scripts/2026-05-16_bot_connection_audit.sql.
    lastConnectedAt: 'last_connected_at',
    lastDisconnectAt: 'last_disconnect_at',
    lastDisconnectReason: 'last_disconnect_reason',
    connectedPhone: 'connected_phone',
    // wa_contacts
    pushName: 'push_name', verifiedName: 'verified_name', profilePicUrl: 'profile_pic_url',
    // orders extra
    montoPagado: 'monto_pagado', montoPendiente: 'monto_pendiente',
    especificacionRecojo: 'especificacion_recojo', noSpecConfirmed: 'no_spec_confirmed',
    estadoEnvio: 'estado_envio', fechaPago: 'fecha_pago',
    shippingCourier: 'shipping_courier', shippingAgency: 'shipping_agency',
    deliveryEta: 'delivery_eta', shippingNotes: 'shipping_notes',
    shippedAt: 'shipped_at', deliveredAt: 'delivered_at',
    // orders — fields for correct payment-timing & TIER 3 logística
    subtotalProducto: 'subtotal_producto',
    shippingCost: 'shipping_cost',
    paymentTiming: 'payment_timing',
    zonaEnvio: 'zona_envio',
    metodoPago: 'metodo_pago',
    costoEnvio: 'costo_envio',
    // PASO 11 — pickup (recojo en tienda)
    pickupAddress: 'pickup_address', pickupHours: 'pickup_hours',
    readyForPickupAt: 'ready_for_pickup_at',
    pickedUpAt: 'picked_up_at',
    // E11: método de entrega elegido por el cliente ('pickup' | 'delivery')
    // — separa el tablero de Recojo en tienda del tablero de Envíos
    deliveryMethod: 'delivery_method', pickupBranchName: 'pickup_branch_name',
    // learned_knowledge
    sourcePhone: 'source_phone', confirmedAt: 'confirmed_at',
    rejectedAt: 'rejected_at', rejectedBy: 'rejected_by',
}

const REVERSE_MAP: Record<string, string> = {}
for (const [k, v] of Object.entries(FIELD_MAP)) REVERSE_MAP[v] = k

function toSnake(field: string): string {
    // Handle dot-notation like 'advancedConfig.level1'
    if (field.includes('.')) {
        const parts = field.split('.')
        // For JSONB nested paths, only map the root
        const root = FIELD_MAP[parts[0]] || parts[0]
        // Supabase uses -> for JSONB access
        return root
    }
    return FIELD_MAP[field] || field
}

function mapDocToSnake(doc: any): any {
    if (!doc || typeof doc !== 'object') return doc
    if (Array.isArray(doc)) return doc.map(mapDocToSnake)
    const mapped: any = {}
    for (const [k, v] of Object.entries(doc)) {
        const newKey = toSnake(k)
        mapped[newKey] = v
    }
    return mapped
}

function mapDocToCamel(doc: any): any {
    if (!doc || typeof doc !== 'object') return doc
    if (Array.isArray(doc)) return doc.map(mapDocToCamel)
    const mapped: any = {}
    for (const [k, v] of Object.entries(doc)) {
        const newKey = REVERSE_MAP[k] || k
        // Always include _id for backward compat
        if (k === 'id') {
            mapped['_id'] = v
            mapped['id'] = v
        }
        if (k === 'phone') {
            mapped['phone'] = v
            mapped['from'] = v
        }
        if (k === 'name') {
            mapped['name'] = v
            mapped['nombre'] = v
        }
        mapped[newKey] = v
    }
    return mapped
}

// ─── ObjectId compatibility: supports `new ObjectId(id)` and string comparison ───
export class ObjectId {
    private id: string
    constructor(id?: string) { this.id = id || '' }
    toString(): string { return this.id }
    valueOf(): string { return this.id }
    toJSON(): string { return this.id }
    equals(other: any): boolean { return this.id === String(other) }
}

// ─── Table name mapping ───
// MongoDB collection names map directly to Supabase table names (already snake_case)

// ─── Query builder that mimics MongoDB API ───

class FindCursor {
    private tableName: string
    private filter: any
    private sortField: string | null = null
    private sortAsc: boolean = true
    private limitCount: number | null = null
    private projection: any = null

    constructor(tableName: string, filter: any, projection?: any) {
        this.tableName = tableName
        this.filter = filter
        this.projection = projection
    }

    sort(spec: any): FindCursor {
        const key = Object.keys(spec)[0]
        this.sortField = toSnake(key)
        this.sortAsc = spec[key] === 1
        return this
    }

    limit(n: number): FindCursor {
        this.limitCount = n
        return this
    }

    async toArray(): Promise<any[]> {
        let query = supabase.from(this.tableName).select('*')
        query = applyFilter(query, this.filter)
        if (this.sortField) query = query.order(this.sortField, { ascending: this.sortAsc })
        if (this.limitCount) query = query.limit(this.limitCount)
        const { data, error } = await query
        if (error) { console.error(`[DB] toArray error on ${this.tableName}:`, error.message); return [] }
        return (data || []).map(mapDocToCamel)
    }
}

function coerceValue(v: any): any {
    if (v instanceof ObjectId) return v.toString()
    if (v instanceof Date) return v.toISOString()
    return v
}

// Transient network errors bubbling up from undici/fetch tend to resolve on
// a quick retry. We wrap each DB operation in a small retry loop so a single
// "fetch failed" blip doesn't kill the WhatsApp handler.
function isTransientDbError(err: any): boolean {
    const msg = String(err?.message || err?.details || err || '')
    return msg.includes('fetch failed')
        || msg.includes('ConnectTimeoutError')
        || msg.includes('ECONNRESET')
        || msg.includes('ETIMEDOUT')
        || msg.includes('socket hang up')
        || msg.includes('UND_ERR_CONNECT_TIMEOUT')
        || msg.includes('getaddrinfo')
        || msg.includes('upstream request timeout')
        || msg.includes('upstream connect error')
        || msg.includes('connection termination')
}

// ─── Circuit breaker para outages prolongados de Supabase ─────────
// Cuando Supabase REST API tiene un Cloudflare 522 sostenido, el código
// dispara CIENTOS de retries simultáneos por segundo (cada mensaje, cada
// notification poll, cada wa_chats lookup, etc.). Eso flooded el pool de
// HTTP de Node y mantenía al server CPU-saturado durante minutos incluso
// después de que Supabase volviera. Para evitar eso:
//
//   1. Contamos errores transitorios consecutivos en una ventana de 10s.
//   2. Si llegamos a 8+ errores en esa ventana → abrimos el "circuito"
//      por 30s. Durante ese tiempo, todas las nuevas queries fallan
//      INMEDIATAMENTE con `CIRCUIT_OPEN` (sin tocar la red).
//   3. Tras los 30s probamos UNA query. Si pasa → cerramos el circuito.
//      Si falla → otros 30s de circuito abierto.
//
// Resultado: en outage de Supabase el server queda RESPONSIVO (puede seguir
// sirviendo el dashboard), y al volver Supabase el flow se restablece sin
// pile-up de retries.
type CircuitState = 'closed' | 'open' | 'half_open'
const circuitBreaker = {
    state: 'closed' as CircuitState,
    failureCount: 0,
    failureWindowStart: 0,
    openedAt: 0,
    FAILURE_THRESHOLD: 8,
    FAILURE_WINDOW_MS: 10_000,
    OPEN_DURATION_MS: 30_000
}

function shouldRejectFromCircuit(): boolean {
    if (circuitBreaker.state !== 'open') return false
    const elapsed = Date.now() - circuitBreaker.openedAt
    if (elapsed >= circuitBreaker.OPEN_DURATION_MS) {
        // Pasamos a half_open para probar 1 query
        circuitBreaker.state = 'half_open'
        console.warn(`[DB Circuit] ⏱️  ${Math.round(elapsed / 1000)}s en open → transición a half_open (probando 1 query)`)
        return false
    }
    return true
}

function recordCircuitSuccess(): void {
    if (circuitBreaker.state === 'half_open') {
        console.log(`[DB Circuit] ✅ half_open query OK → cerrando circuito (Supabase recuperado)`)
    }
    circuitBreaker.state = 'closed'
    circuitBreaker.failureCount = 0
    circuitBreaker.failureWindowStart = 0
}

function recordCircuitFailure(): void {
    const now = Date.now()
    // Si el circuito YA está abierto, no hacemos nada — los errores que
    // siguen llegando son requests inflight que arrancaron antes del reject.
    // Sin este early-return, cada uno volvía a loguear "ABRIENDO circuito" y
    // spammeaba la consola con cientos de líneas idénticas.
    if (circuitBreaker.state === 'open') {
        return
    }
    if (circuitBreaker.state === 'half_open') {
        // Falló la probe → reabrir el circuito
        circuitBreaker.state = 'open'
        circuitBreaker.openedAt = now
        console.warn(`[DB Circuit] ❌ half_open probe falló → circuito ABIERTO otra vez por ${circuitBreaker.OPEN_DURATION_MS / 1000}s`)
        return
    }
    // Si la ventana de fallos expiró, reset
    if (now - circuitBreaker.failureWindowStart > circuitBreaker.FAILURE_WINDOW_MS) {
        circuitBreaker.failureCount = 1
        circuitBreaker.failureWindowStart = now
        return
    }
    circuitBreaker.failureCount++
    if (circuitBreaker.failureCount >= circuitBreaker.FAILURE_THRESHOLD) {
        circuitBreaker.state = 'open'
        circuitBreaker.openedAt = now
        console.warn(`[DB Circuit] 🔴 ${circuitBreaker.failureCount} errores transitorios en ${circuitBreaker.FAILURE_WINDOW_MS / 1000}s → ABRIENDO circuito (rechazando queries por ${circuitBreaker.OPEN_DURATION_MS / 1000}s para evitar cascada).`)
    }
}

async function withDbRetry<T>(label: string, fn: () => Promise<T>, attempts = 2): Promise<T> {
    // ─── Circuit breaker check ───
    if (shouldRejectFromCircuit()) {
        const err: any = new Error('CIRCUIT_OPEN: Supabase está caído, query rechazada para evitar cascada')
        err.code = 'CIRCUIT_OPEN'
        throw err
    }

    let lastErr: any
    for (let i = 0; i < attempts; i++) {
        try {
            const result = await fn()
            recordCircuitSuccess()
            return result
        } catch (err) {
            lastErr = err
            if (!isTransientDbError(err)) throw err
            recordCircuitFailure()
            // Si el circuito acaba de abrir, no reintentamos — fail rápido.
            if (circuitBreaker.state === 'open') {
                throw err
            }
            if (i < attempts - 1) {
                const delay = 400 * (i + 1)
                console.warn(`[DB] transient error on ${label} (attempt ${i + 1}/${attempts}), retrying in ${delay}ms:`, (err as any)?.message || err)
                await new Promise(r => setTimeout(r, delay))
            }
        }
    }
    throw lastErr
}

function applyFilter(query: any, filter: any): any {
    if (!filter || Object.keys(filter).length === 0) return query
    for (const [key, value] of Object.entries(filter)) {
        const col = toSnake(key)
        if (value === null || value === undefined) continue
        if (value instanceof ObjectId) {
            query = query.eq(col, value.toString())
        } else if (typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
            const ops = value as any
            if (ops.$gte !== undefined) query = query.gte(col, coerceValue(ops.$gte))
            if (ops.$gt !== undefined) query = query.gt(col, coerceValue(ops.$gt))
            if (ops.$lte !== undefined) query = query.lte(col, coerceValue(ops.$lte))
            if (ops.$lt !== undefined) query = query.lt(col, coerceValue(ops.$lt))
            if (ops.$in !== undefined) query = query.in(col, (ops.$in as any[]).map(coerceValue))
            if (ops.$ne !== undefined) query = query.neq(col, coerceValue(ops.$ne))
            if (ops.$exists === false) query = query.is(col, null)
        } else {
            query = query.eq(col, coerceValue(value))
        }
    }
    return query
}

class Collection {
    private name: string
    constructor(name: string) { this.name = name }

    find(filter: any = {}, options?: any): FindCursor {
        return new FindCursor(this.name, filter, options?.projection)
    }

    async findOne(filter: any = {}, options?: any): Promise<any> {
        const { data, error } = await withDbRetry(`findOne(${this.name})`, async () => {
            let query: any = supabase.from(this.name).select('*')
            query = applyFilter(query, filter)
            const res = await query.limit(1).maybeSingle()
            if (res.error && isTransientDbError(res.error)) throw res.error
            return res
        })
        if (error) { console.error(`[DEBUG][DB] findOne(${this.name}) ERROR:`, error.message, '| filter:', JSON.stringify(filter).substring(0, 200)); return null }
        if (!data) console.log(`[DEBUG][DB] findOne(${this.name}) → null | filter:`, JSON.stringify(filter).substring(0, 150))
        return data ? mapDocToCamel(data) : null
    }

    async insertOne(doc: any): Promise<{ insertedId: string }> {
        const mapped = mapDocToSnake(doc)
        // Remove _id if present (Supabase auto-generates UUID)
        delete mapped.id
        console.log(`[DEBUG][DB] insertOne(${this.name}) keys:`, Object.keys(mapped).join(','))
        const { data, error } = await supabase.from(this.name).insert(mapped).select('id').single()
        if (error) {
            console.error(`[DEBUG][DB] insertOne(${this.name}) FAILED:`, error.message, '| Payload keys:', Object.keys(mapped).join(','))
            throw new Error(`insertOne(${this.name}): ${error.message}`)
        }
        console.log(`[DEBUG][DB] insertOne(${this.name}) OK, id:`, data!.id)
        return { insertedId: data!.id }
    }

    async updateOne(filter: any, update: any, options?: { upsert?: boolean }): Promise<{ modifiedCount: number }> {
        const setData = update.$set || update
        const mapped = mapDocToSnake(setData)
        // Handle dot-notation JSONB updates (e.g. 'advancedConfig.level1')
        const jsonbUpdates: Record<string, any> = {}
        for (const [key, value] of Object.entries(setData)) {
            if (key.includes('.')) {
                const parts = key.split('.')
                const rootSnake = toSnake(parts[0])
                if (!jsonbUpdates[rootSnake]) jsonbUpdates[rootSnake] = null // mark for merge
                // We'll handle via fetch-merge-update below
            }
        }

        // If there are dot-notation updates, fetch current, merge, and update
        if (Object.keys(jsonbUpdates).length > 0) {
            const current = await this.findOne(filter)
            if (current) {
                for (const [key, value] of Object.entries(setData)) {
                    if (key.includes('.')) {
                        const parts = key.split('.')
                        const rootCamel = parts[0]
                        const rootSnake = toSnake(rootCamel)
                        const currentVal = current[rootCamel] || {}
                        // Build nested path
                        let target = currentVal
                        for (let i = 1; i < parts.length - 1; i++) {
                            if (!target[parts[i]]) target[parts[i]] = {}
                            target = target[parts[i]]
                        }
                        target[parts[parts.length - 1]] = value
                        mapped[rootSnake] = currentVal
                    }
                }
            }
            // Remove dot-notation keys from mapped
            for (const k of Object.keys(mapped)) {
                if (k.includes('.')) delete mapped[k]
            }
        }

        delete mapped.id // Never update the PK

        if (options?.upsert) {
            // Try update first, if no rows affected, insert
            const { data, error } = await withDbRetry(`updateOne-upsert(${this.name})`, async () => {
                let query = supabase.from(this.name).update(mapped)
                query = applyFilter(query, filter)
                const res = await query.select('id')
                if (res.error && isTransientDbError(res.error)) throw res.error
                return res
            })
            if (error && error.code !== 'PGRST116') throw new Error(`updateOne(${this.name}): ${error.message}`)
            if (!data || data.length === 0) {
                // Insert with filter values merged
                const insertDoc = { ...mapDocToSnake(filter), ...mapped }
                delete insertDoc.id
                await withDbRetry(`insert-upsert(${this.name})`, async () => {
                    const res = await supabase.from(this.name).insert(insertDoc)
                    if (res.error && isTransientDbError(res.error)) throw res.error
                    return res
                })
            }
            return { modifiedCount: 1 }
        }

        const { data, error } = await withDbRetry(`updateOne(${this.name})`, async () => {
            let query = supabase.from(this.name).update(mapped)
            query = applyFilter(query, filter)
            const res = await query.select('id')
            if (res.error && isTransientDbError(res.error)) throw res.error
            return res
        })
        if (error) {
            console.error(`[DEBUG][DB] updateOne(${this.name}) FAILED:`, error.message, '| filter:', JSON.stringify(filter).substring(0, 150), '| update keys:', Object.keys(mapped).join(','))
            throw new Error(`updateOne(${this.name}): ${error.message}`)
        }
        if ((data?.length || 0) === 0) console.log(`[DEBUG][DB] updateOne(${this.name}) matched 0 rows | filter:`, JSON.stringify(filter).substring(0, 150))
        return { modifiedCount: data?.length || 0 }
    }

    async updateMany(filter: any, update: any): Promise<{ modifiedCount: number }> {
        const setData = update.$set || update
        const mapped = mapDocToSnake(setData)
        delete mapped.id

        const { data, error } = await withDbRetry(`updateMany(${this.name})`, async () => {
            let query = supabase.from(this.name).update(mapped)
            query = applyFilter(query, filter)
            const res = await query.select('id')
            if (res.error && isTransientDbError(res.error)) throw res.error
            return res
        })
        if (error) {
            console.error(`[DEBUG][DB] updateMany(${this.name}) FAILED:`, error.message, '| filter:', JSON.stringify(filter).substring(0, 150))
            throw new Error(`updateMany(${this.name}): ${error.message}`)
        }
        console.log(`[DEBUG][DB] updateMany(${this.name}) modified ${data?.length || 0} rows`)
        return { modifiedCount: data?.length || 0 }
    }

    async deleteOne(filter: any): Promise<{ deletedCount: number }> {
        let query = supabase.from(this.name).delete()
        query = applyFilter(query, filter)
        const { data, error } = await query.select('id').maybeSingle()
        if (error) {
            console.error(`[DEBUG][DB] deleteOne(${this.name}) FAILED:`, error.message, '| filter:', JSON.stringify(filter).substring(0, 150))
            throw new Error(`deleteOne(${this.name}): ${error.message}`)
        }
        return { deletedCount: data ? 1 : 0 }
    }

    async deleteMany(filter: any): Promise<{ deletedCount: number }> {
        let query = supabase.from(this.name).delete()
        query = applyFilter(query, filter)
        const { data, error } = await query.select('id')
        if (error) {
            console.error(`[DEBUG][DB] deleteMany(${this.name}) FAILED:`, error.message, '| filter:', JSON.stringify(filter).substring(0, 150))
            throw new Error(`deleteMany(${this.name}): ${error.message}`)
        }
        return { deletedCount: data?.length || 0 }
    }

    async countDocuments(filter: any = {}): Promise<number> {
        let query = supabase.from(this.name).select('id', { count: 'exact', head: true })
        query = applyFilter(query, filter)
        const { count, error } = await query
        if (error) { console.error(`[DB] countDocuments error on ${this.name}:`, error.message); return 0 }
        return count || 0
    }

    async distinct(field: string, filter: any = {}): Promise<any[]> {
        const col = toSnake(field)
        let query = supabase.from(this.name).select(col)
        query = applyFilter(query, filter)
        const { data, error } = await query
        if (error) { console.error(`[DB] distinct error on ${this.name}:`, error.message); return [] }
        const unique = new Set((data || []).map((d: any) => d[col]))
        return Array.from(unique)
    }

    aggregate(pipeline: any[]): { toArray: () => Promise<any[]> } {
        // Aggregations are done in-memory: fetch all matching data, then process
        return {
            toArray: async () => {
                // Find $match stage
                const matchStage = pipeline.find(s => s.$match)
                const filter = matchStage?.$match || {}
                
                let query = supabase.from(this.name).select('*')
                query = applyFilter(query, filter)
                const { data, error } = await query
                if (error || !data) return []

                const docs = data.map(mapDocToCamel)

                // Process $group stage
                const groupStage = pipeline.find(s => s.$group)
                if (!groupStage) return docs

                const groupBy = groupStage.$group._id
                const groups: Record<string, any> = {}

                for (const doc of docs) {
                    let groupKey: any
                    if (typeof groupBy === 'string' && groupBy.startsWith('$')) {
                        groupKey = doc[groupBy.slice(1)]
                    } else if (typeof groupBy === 'object') {
                        // Handle $hour, $dayOfWeek expressions
                        const expr = Object.values(groupBy)[0] as string
                        const field = expr.startsWith('$') ? expr.slice(1) : expr
                        const val = doc[field]
                        const date = val ? new Date(val) : null
                        const op = Object.keys(groupBy)[0]
                        if (op === '$hour' && date) groupKey = date.getHours()
                        else if (op === '$dayOfWeek' && date) groupKey = date.getDay() + 1
                        else groupKey = val
                    } else {
                        groupKey = groupBy
                    }

                    const k = String(groupKey)
                    if (!groups[k]) {
                        groups[k] = { _id: groupKey }
                        for (const [alias, op] of Object.entries(groupStage.$group)) {
                            if (alias === '_id') continue
                            groups[k][alias] = 0
                        }
                    }
                    for (const [alias, op] of Object.entries(groupStage.$group)) {
                        if (alias === '_id') continue
                        if ((op as any).$sum !== undefined) {
                            const sumExpr = (op as any).$sum
                            groups[k][alias] += sumExpr === 1 ? 1 : (doc[sumExpr?.slice?.(1)] || 0)
                        }
                    }
                }

                const result = Object.values(groups)

                // Handle $sort stage
                const sortStage = pipeline.find(s => s.$sort)
                if (sortStage) {
                    const sortKey = Object.keys(sortStage.$sort)[0]
                    const sortDir = sortStage.$sort[sortKey]
                    result.sort((a: any, b: any) => sortDir === -1 ? b[sortKey] - a[sortKey] : a[sortKey] - b[sortKey])
                }

                return result
            }
        }
    }

    async createIndex(_spec: any, _options?: any): Promise<void> {
        // No-op: indexes are created in SQL migration
    }
}

// ─── DB interface that mimics MongoDB's Db ───
class SupabaseDB {
    collection(name: string): Collection {
        return new Collection(name)
    }
}

const dbInstance = new SupabaseDB()

export async function connectDB(): Promise<SupabaseDB> {
    if (supabase) return dbInstance

    const url = process.env.SUPABASE_URL || ''
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

    if (!url || !key) {
        throw new Error('[DB] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in .env')
    }

    supabase = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false }
    })

    // Test connection
    const { count, error } = await supabase.from('users').select('*', { count: 'exact', head: true })
    if (error) {
        console.error('[DB] ❌ Supabase connection failed:', error.message)
        throw error
    }

    console.log(`[DB] ✅ Conectado a Supabase | Usuarios en DB: ${count ?? 0}`)
    return dbInstance
}

export function getDB(): SupabaseDB {
    if (!supabase) throw new Error('Database not initialized. Call connectDB() first.')
    return dbInstance
}

// Export raw client for services that need it directly
export function getSupabaseClient(): SupabaseClient {
    if (!supabase) throw new Error('Supabase not initialized')
    return supabase
}

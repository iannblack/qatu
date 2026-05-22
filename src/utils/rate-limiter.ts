/**
 * rate-limiter.ts — limitador de tasa por clave, ventana deslizante, in-memory.
 *
 * Diseñado para protección de endpoints sensibles (uploads, login, password
 * reset) sin agregar dependencias nuevas al proyecto. Usa un Map keyed por
 * lo que decida el caller (típicamente userId, IP, o una combinación).
 *
 * Limitaciones conocidas:
 *   • Estado in-memory por proceso. KIPU corre en un solo container Docker
 *     (ver DEPLOY.md), así que basta. Si en el futuro se escala horizontal,
 *     migrar a Redis con la misma API pública.
 *   • No persiste entre reinicios — un atacante recupera el cupo tras
 *     cada deploy. Para uploads esto no es crítico; para login lo sería.
 *
 * Limpieza pasiva: cada `checkRateLimit` filtra timestamps fuera de la
 * ventana. Hay además un timer global cada 10 min que purga entradas
 * vacías para que el Map no crezca indefinidamente con usuarios one-shot.
 */

import type { Request, Response, NextFunction } from 'express'

interface Bucket {
    timestamps: number[]
}

const buckets: Map<string, Bucket> = new Map()

export interface RateLimitDecision {
    allowed: boolean
    used: number          // hits dentro de la ventana actual (incluye el actual si allowed)
    limit: number
    retryAfterSec: number // 0 si allowed
    resetAt: Date         // cuando el hit más viejo dentro de la ventana expira
}

/**
 * Chequea (y opcionalmente registra) un hit para `key` dentro de la ventana.
 * Si registrar=true (default) y allowed=true, agrega un timestamp al bucket.
 * Si !allowed, NO se agrega — los rechazos no consumen cupo adicional.
 */
export function checkRateLimit(key: string, opts: {
    max: number
    windowMs: number
    record?: boolean
}): RateLimitDecision {
    const { max, windowMs, record = true } = opts
    const now = Date.now()
    const windowStart = now - windowMs

    const bucket = buckets.get(key)
    const fresh = bucket ? bucket.timestamps.filter(t => t > windowStart) : []

    if (fresh.length >= max) {
        const oldest = fresh[0]
        const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000))
        // Persistir el array filtrado (limpieza pasiva)
        if (bucket) bucket.timestamps = fresh
        return {
            allowed: false,
            used: fresh.length,
            limit: max,
            retryAfterSec,
            resetAt: new Date(oldest + windowMs),
        }
    }

    if (record) fresh.push(now)
    if (bucket) bucket.timestamps = fresh
    else buckets.set(key, { timestamps: fresh })

    return {
        allowed: true,
        used: fresh.length,
        limit: max,
        retryAfterSec: 0,
        resetAt: new Date(now + windowMs),
    }
}

/**
 * Factory para Express middleware. Si la key resulta vacía/null, deja pasar
 * (fail-open) — esto solo debería ocurrir si el caller arma mal el keyFn,
 * preferimos servicio funcional a denial accidental.
 */
export function createRateLimitMiddleware(opts: {
    keyFn: (req: Request) => string | null
    max: number
    windowMs: number
    label?: string
    message?: string  // mensaje en español al cliente cuando se bloquea
}) {
    const { keyFn, max, windowMs, label, message } = opts
    const tag = label ? `[RateLimit:${label}]` : '[RateLimit]'
    return (req: Request, res: Response, next: NextFunction) => {
        const key = keyFn(req)
        if (!key) return next()
        const decision = checkRateLimit(key, { max, windowMs })
        if (!decision.allowed) {
            const minutes = Math.ceil(decision.retryAfterSec / 60)
            const humanWait = minutes <= 1
                ? `${decision.retryAfterSec} segundos`
                : `${minutes} minutos`
            const msg = message
                ? message.replace('{retry}', humanWait).replace('{limit}', String(max))
                : `Has alcanzado el límite de ${max} solicitudes por hora. Intenta de nuevo en ${humanWait}.`
            console.warn(`${tag} blocked key=${key.substring(0, 80)} (used=${decision.used}/${decision.limit}, retry in ${decision.retryAfterSec}s)`)
            res.set('Retry-After', String(decision.retryAfterSec))
            res.set('X-RateLimit-Limit', String(decision.limit))
            res.set('X-RateLimit-Remaining', '0')
            res.set('X-RateLimit-Reset', String(Math.floor(decision.resetAt.getTime() / 1000)))
            return res.status(429).json({ error: msg, retryAfterSec: decision.retryAfterSec })
        }
        // Headers informativos cuando sí pasa
        res.set('X-RateLimit-Limit', String(decision.limit))
        res.set('X-RateLimit-Remaining', String(Math.max(0, decision.limit - decision.used)))
        res.set('X-RateLimit-Reset', String(Math.floor(decision.resetAt.getTime() / 1000)))
        next()
    }
}

// Limpieza periódica: cada 10 min, eliminar entradas cuyos timestamps
// estén completamente vencidos. Mantiene el Map acotado en uso prolongado.
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000
const MAX_TRACKED_WINDOW_MS = 24 * 60 * 60 * 1000 // ningún rate limit usa ventana > 24h en este proyecto
setInterval(() => {
    const now = Date.now()
    const cutoff = now - MAX_TRACKED_WINDOW_MS
    let pruned = 0
    for (const [key, bucket] of buckets.entries()) {
        const fresh = bucket.timestamps.filter(t => t > cutoff)
        if (fresh.length === 0) {
            buckets.delete(key)
            pruned++
        } else if (fresh.length !== bucket.timestamps.length) {
            bucket.timestamps = fresh
        }
    }
    if (pruned > 0) console.log(`[RateLimit] cleanup: ${pruned} entrada(s) sin tráfico reciente eliminadas`)
}, CLEANUP_INTERVAL_MS).unref()  // unref: no bloquea shutdown del proceso

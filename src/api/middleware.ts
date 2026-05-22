import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { verifyToken } from '../services/auth.service'

// AuthRequest ampliado para Fase 1.5 — incluye el contexto del equipo
// cuando el JWT es de un miembro (vendedor/supervisor) en lugar de un owner.
export interface AuthRequest extends Request {
    // Owner = userId del dueño (paga la suscripción)
    // Member = el id del team_member (NO el owner)
    // req.userId siempre apunta al que hizo el request — del owner o member.
    userId?: string
    userEmail?: string
    file?: any
    // Campos NUEVOS — set solo cuando el JWT viene de /api/team/login o
    // /api/team/invite/:token/accept. Para JWTs viejos de owner quedan
    // undefined (queries siguen funcionando como antes).
    isTeamMember?: boolean
    ownerUserId?: string        // dueño bajo el que vive el miembro
    teamRole?: 'supervisor' | 'vendedor'
    memberId?: string           // id en la tabla team_members
}

// Helper: obtiene el "scope owner" del request — el userId que debe usarse
// para las queries multi-tenant en bot_configs, leads, etc.
//   - Si es un owner directo  → req.userId
//   - Si es un team member    → req.ownerUserId
// Todas las queries que hoy hacen `.eq('userId', req.userId)` deberían
// migrar a `.eq('userId', resolveOwnerUserId(req))` para soportar miembros.
// En Fase 2 hacemos ese rollout.
export function resolveOwnerUserId(req: AuthRequest): string | undefined {
    if (req.isTeamMember && req.ownerUserId) return req.ownerUserId
    return req.userId
}

export async function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Token requerido' })
    }

    try {
        const token = authHeader.split(' ')[1]
        // Usamos verifyToken para la validación de firma (mantiene el comportamiento
        // existente), pero también decodificamos el payload completo para extraer
        // los campos opcionales de team member.
        const decoded = verifyToken(token)
        const raw: any = jwt.decode(token) || {}

        // Reject old MongoDB 24-char hex strings to force re-login for Supabase UUIDs
        if (decoded.userId && typeof decoded.userId === 'string' && decoded.userId.length === 24 && !decoded.userId.includes('-')) {
            return res.status(401).json({ error: 'Sesión obsoleta. Por favor, inicia sesión nuevamente.' })
        }

        req.userId = decoded.userId
        req.userEmail = decoded.email

        // Team member context (solo si el token lo trae)
        if (raw && raw.isTeamMember === true) {
            req.isTeamMember = true
            req.ownerUserId = String(raw.ownerUserId || '')
            req.teamRole = raw.role === 'supervisor' ? 'supervisor' : 'vendedor'
            req.memberId = String(raw.userId || decoded.userId || '')
        }

        next()
    } catch {
        return res.status(401).json({ error: 'Token inválido o expirado' })
    }
}

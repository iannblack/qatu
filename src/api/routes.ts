import { Router, Request, Response } from 'express'
import { registerUser, loginUser, loginOrRegisterWithGoogle, changePassword, updateProfile, changePlan, VALID_PLANS } from '../services/auth.service'
import { botManager, invalidatePromptCache, invalidateStaticPromptCache, invalidateInteractionModeCache, invalidateBotConfigCache, invalidateBusinessInfoCache, PE_DEPT_NAMES } from '../services/bot-manager'
import { getDB, ObjectId } from '../services/db.service'
import { authMiddleware, AuthRequest, resolveOwnerUserId } from './middleware'
import multer from 'multer'
// OpenAI-based analysis is handled in catalog-analyzer.service.ts
import { analyzeCatalogFile, analyzeCatalogUrl, mergeCatalogAnalyses, regenerateCategoryFollowups } from '../services/catalog-analyzer.service'
import { unlinkSync } from 'fs'
import { instagramService } from '../services/instagram.service'
import { tiktokService } from '../services/tiktok.service'
import { manychatService } from '../services/manychat.service'
import { metaWebhookVerify, metaWebhookHandler } from './meta.webhook'
import { metaCloudService } from '../services/meta-cloud.service'
import { kipuAnalyze, kipuOnboarding, kipuUnlockCheck, kipuRentabilidad, kipuInventario, kipuMetas } from '../services/kipu-analytics'
import { handleKipuChatInteraction } from '../services/maya-chat.service'
import { getWorkflowMap, createNode as wfCreateNode, updateNode as wfUpdateNode, deleteNode as wfDeleteNode, createEdge as wfCreateEdge, updateEdge as wfUpdateEdge, deleteEdge as wfDeleteEdge, addLearnedNode, syncShippingToWorkflow, syncPaymentsToWorkflow, seedGenericWorkflow, importWorkflowFromDocument } from '../services/workflow-map.service'
import { getOrGenerateExample, generateExampleForNode, clearExampleCache, touchBotConfigUpdatedAt } from '../services/workflow-example.service'
import { ALLOWED_DOCUMENT_MIME_TYPES, ALLOWED_DOCUMENT_EXTENSIONS, MAX_DOCUMENT_BYTES, validateDocumentUpload } from '../utils/file-security'
import { createRateLimitMiddleware } from '../utils/rate-limiter'
import { getSupabaseClient as _wfSupa } from '../services/db.service'
import { startApifyActor, pollApifyDataset, getApifyCacheStats, startApifyPolling, addSenderInfo } from '../services/apify.service'
import * as XLSX from 'xlsx'

const upload = multer({ dest: 'uploads/' })

// G E1: separate in-memory upload for profile photos. Memory storage avoids
// writing the buffer to disk before forwarding it to Supabase Storage.
// Limit: 5 MB. Allowed mime types validated in the handler.
const profilePhotoUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }
})

// ─── Workflow document import — multer hardened ─────────────────────────
// Capas de defensa:
//   • storage: memoryStorage — el archivo NUNCA toca disco con un nombre
//     controlado por el cliente (evita path traversal y escritura de
//     ejecutables al filesystem del server).
//   • limits.fileSize: 10 MB hard cap — bloquea DoS por archivos enormes.
//   • limits.files: 1 — un solo archivo, no array.
//   • limits.fields: 5 — bloquea form-bombing.
//   • limits.headerPairs: 100 — bloquea header-bombing.
//   • fileFilter: rechaza temprano (sin gastar memoria) por mime+ext.
//   • Validación adicional por magic bytes corre en el handler tras recibir
//     el buffer completo (multer no nos da acceso al buffer dentro del filter).
const workflowDocUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: MAX_DOCUMENT_BYTES,
        files: 1,
        fields: 5,
        headerPairs: 100,
    },
    fileFilter: (_req, file, cb) => {
        const declaredMime = String(file.mimetype || '').toLowerCase().split(';')[0].trim()
        const ext = ('.' + (String(file.originalname || '').split('.').pop() || '')).toLowerCase()
        if (!ALLOWED_DOCUMENT_MIME_TYPES.has(declaredMime) || !ALLOWED_DOCUMENT_EXTENSIONS.has(ext)) {
            return cb(new Error('Solo se aceptan archivos PDF (.pdf) o Word (.docx).'))
        }
        cb(null, true)
    }
})

// Rate limit: 10 imports por hora por usuario. Se aplica ANTES de multer
// para que el rebote de un usuario abusivo no consuma memoria parseando el
// archivo. Per-userId (no per-IP) — un mismo emprendedor desde el celular y
// la laptop comparte cupo, que es lo correcto.
const workflowDocRateLimit = createRateLimitMiddleware({
    keyFn: (req) => {
        const userId = (req as AuthRequest).userId
        return userId ? `workflow_import_doc:${userId}` : null
    },
    max: 10,
    windowMs: 60 * 60 * 1000,
    label: 'workflow_import_doc',
    message: 'Has alcanzado el límite de {limit} importaciones de workflow por hora. Intenta de nuevo en {retry}.'
})

const router = Router()

// Helper: after any config save, resume the bot on every conversation so the emprendedor
// doesn't need to reconnect WhatsApp to see the changes take effect. Runs in background.
async function resumeAllBotChatsAfterConfig(botId: string) {
    // Drop the cached systemText so the next WhatsApp message rebuilds it
    // with the updated config (products, shipping, payments, workflow, etc.).
    try { invalidatePromptCache(botId) } catch { /* best-effort */ }
    // También invalidamos los caches resilient de bot_configs/business_info
    // para que el siguiente mensaje vea la config recién guardada SIN
    // esperar al TTL de 60s. Si la DB está caída, el cache stale sigue
    // siendo el fallback (no perdemos la red de seguridad).
    try { invalidateBotConfigCache(botId) } catch { /* best-effort */ }
    try { invalidateBusinessInfoCache(botId) } catch { /* best-effort */ }
    try {
        const db = getDB()
        const pausedChats = await db.collection('wa_chats').find({ botId, isBotPaused: true }).toArray()
        if (!pausedChats || pausedChats.length === 0) return
        for (const chat of pausedChats) {
            const jid = chat.chatJid
            if (!jid) continue
            await db.collection('chat_history').updateOne(
                { key: `${botId}_${jid}` },
                { $set: { botPaused: false, pausedAt: null, pauseReason: null } }
            )
            await db.collection('wa_chats').updateOne(
                { botId, chatJid: jid },
                { $set: { isBotPaused: false } }
            )
        }
        console.log(`[Config] Bot ${botId} auto-resumed on ${pausedChats.length} conversation(s) after config save`)
    } catch (e) {
        console.error('[Config] Error auto-resuming bot:', e)
    }
}

// ==================== HEALTH ====================
// Usado por nginx/Docker HEALTHCHECK y monitores externos. No requiere auth.
router.get('/health', async (_req: Request, res: Response) => {
    try {
        const db = getDB()
        // Ping ligero a Supabase para confirmar que la BD responde
        await db.collection('users').countDocuments({})
        res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() })
    } catch (err: any) {
        res.status(503).json({ status: 'degraded', error: err.message })
    }
})

// ==================== AUTH ====================

router.post('/auth/register', async (req: AuthRequest, res: Response) => {
    try {
        const { email, password, name, businessName } = req.body
        if (!email || !password || !name || !businessName) {
            return res.status(400).json({ error: 'Todos los campos son requeridos' })
        }
        const result = await registerUser(email, password, name, businessName)
        res.json(result)
    } catch (error: any) {
        res.status(400).json({ error: error.message })
    }
})

router.post('/auth/login', async (req: AuthRequest, res: Response) => {
    try {
        const { email, password } = req.body
        if (!email || !password) {
            return res.status(400).json({ error: 'Email y contraseña requeridos' })
        }
        // Login unificado: probamos primero como owner (tabla `users`). Si
        // falla por "no encontramos cuenta", caemos a /team/login (tabla
        // team_members). Así el miembro y el dueño usan el mismo form de
        // login sin tener que elegir "soy vendedor".
        try {
            const result = await loginUser(email, password)
            return res.json(result)
        } catch (ownerErr: any) {
            const msg = String(ownerErr?.message || '')
            // Si el error es "no existe esa cuenta", probamos como miembro.
            // Si es "contraseña incorrecta" del owner, NO probamos como
            // miembro (le devolvemos el error tal cual al usuario).
            if (!/no encontramos|no existe|register|regístrate/i.test(msg)) {
                throw ownerErr
            }

            const supa = _wfSupa()
            const { data: member } = await supa
                .from('team_members')
                .select('id, name, email, role, status, password_hash, owner_user_id')
                .eq('email', String(email).trim().toLowerCase())
                .eq('status', 'active')
                .maybeSingle()
            if (!member || !member.password_hash) {
                // Ni owner ni miembro — devolvemos el error original del owner.
                throw ownerErr
            }
            const bcrypt = (await import('bcryptjs')).default
            const ok = await bcrypt.compare(String(password), member.password_hash)
            if (!ok) {
                return res.status(401).json({ error: 'Contraseña incorrecta. Inténtalo de nuevo' })
            }
            try {
                await supa.from('team_members')
                    .update({ last_login_at: new Date().toISOString() })
                    .eq('id', member.id)
            } catch (_) {}
            // Audit del login (Fase 4.2)
            try {
                await supa.from('team_audit').insert({
                    owner_user_id: member.owner_user_id,
                    actor_user_id: member.id,
                    target_member_id: member.id,
                    action: 'member_login',
                    meta: {
                        via: 'auth_login_unified',
                        email: member.email,
                        role: member.role,
                        ip: req.ip || (req.headers['x-forwarded-for'] as string) || null,
                        ua: (req.headers['user-agent'] as string)?.slice(0, 200) || null,
                    },
                })
            } catch (_) { /* best-effort */ }
            const jwt = (await import('jsonwebtoken')).default
            const JWT_SECRET = process.env.JWT_SECRET!
            const tokenJwt = jwt.sign(
                {
                    userId: member.id,
                    email: member.email,
                    isTeamMember: true,
                    ownerUserId: member.owner_user_id,
                    role: member.role,
                },
                JWT_SECRET,
                { expiresIn: '30d' }
            )
            return res.json({
                user: {
                    _id: member.id,
                    email: member.email,
                    name: member.name,
                    role: member.role,
                    isTeamMember: true,
                },
                token: tokenJwt,
            })
        }
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

// ─── Google Sign-In ───
// El frontend llama GET /auth/google/config al cargar el login para saber si
// Google Sign-In está disponible (depende de GOOGLE_CLIENT_ID en .env).
// Si no está configurado → null, el botón muestra mensaje de "no disponible".
router.get('/auth/google/config', (_req: AuthRequest, res: Response) => {
    res.json({ clientId: process.env.GOOGLE_CLIENT_ID || null })
})

// El frontend obtiene un id_token de Google Identity Services y lo manda acá.
// Acá: validamos el token contra Google, y hacemos login o registro automático.
router.post('/auth/google', async (req: AuthRequest, res: Response) => {
    try {
        const { idToken } = req.body
        if (!idToken) return res.status(400).json({ error: 'idToken requerido' })
        const result = await loginOrRegisterWithGoogle(idToken)
        // Mismo shape que /auth/login y /auth/register para que el frontend
        // pueda reusar el mismo handler de éxito.
        res.json({ ...result.user, token: result.token, isNew: result.isNew })
    } catch (error: any) {
        console.error('[AUTH:Google]', error?.message || error)
        res.status(401).json({ error: error.message || 'Error en Google Sign-In' })
    }
})

// TODO: parseBusinessText not yet implemented
// router.post('/analytics/parse-business', authMiddleware, async (req: AuthRequest, res: Response) => {
//     try {
//         const { text } = req.body
//         if (!text) return res.status(400).json({ error: 'Text required' })
//         const parsed = await parseBusinessText(text)
//         res.json(parsed)
//     } catch (error: any) {
//         res.status(500).json({ error: error.message })
//     }
// })

router.get('/auth/me', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()

        // Team member path: el JWT trae isTeamMember:true y memberId.
        // Mismo shape que /auth/profile para que el frontend tenga drop-in
        // compatibility. El businessName/plan/photoUrl los hereda del owner.
        if (req.isTeamMember && req.memberId) {
            const supa = _wfSupa()
            const { data: member } = await supa
                .from('team_members')
                .select('id, name, email, phone, role, cargo_custom, last_login_at')
                .eq('id', req.memberId)
                .maybeSingle()
            if (!member) return res.status(404).json({ error: 'Miembro no encontrado' })
            let ownerData: any = {}
            try {
                const owner = await db.collection('users').findOne({ _id: new ObjectId(req.ownerUserId!) })
                ownerData = {
                    businessName: owner?.businessName || owner?.business_name || 'Qhatu',
                    plan: owner?.plan || 'enterprise',
                    photoUrl: owner?.photoUrl || null,
                }
            } catch (_) { /* fallback */ }
            return res.json({
                _id: member.id,
                email: member.email,
                name: member.name,
                phone: member.phone || '',
                isTeamMember: true,
                role: member.role,
                cargoCustom: member.cargo_custom || '',
                ownerUserId: req.ownerUserId,
                businessName: ownerData.businessName,
                plan: ownerData.plan,
                photoUrl: ownerData.photoUrl,
                tutorial_shown: true,  // miembros no ven tutorial
            })
        }

        const user = await db.collection('users').findOne(
            { _id: new ObjectId(req.userId) },
            { projection: { password: 0 } }
        )
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' })
        // db.service.findOne ignora `projection` — lo strippeamos aquí para no filtrar el hash
        const { password: _pw, ...safeUser } = user
        res.json(safeUser)
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

router.post('/auth/tutorial', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const { completed } = req.body
        try {
            await db.collection('users').updateOne(
                { _id: new ObjectId(req.userId) },
                { $set: { tutorial_shown: completed } }
            )
        } catch (e: any) {
            // La columna tutorial_shown puede no existir en Supabase (ver
            // scripts/migration_missing_columns.sql). No es fatal: el frontend
            // también usa un flag en localStorage como fallback primario.
            console.warn(`[/auth/tutorial] columna tutorial_shown no disponible: ${e.message}`)
        }
        res.json({ success: true })
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

// ==================== G E1 — PROFILE / SETTINGS ====================
// All four endpoints (GET profile, PUT profile, PUT password, POST photo,
// GET plans, POST change-plan) operate on the authenticated user's own
// document — there's no admin scope here. The photo upload streams the
// in-memory buffer to Supabase Storage bucket 'profile-photos' and saves
// the public URL on the user document. Plan changes are persisted directly
// (not gated by billing — entrepreneur is contacted manually for invoicing).

router.get('/auth/profile', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()

        // Si el JWT es de un miembro del equipo, no busca en `users` (no
        // existe ahí). Devuelve el perfil del miembro + datos del owner
        // (businessName, plan, photoUrl) para que el dashboard muestre la
        // tienda como contexto.
        if (req.isTeamMember && req.memberId) {
            const supa = _wfSupa()
            const { data: member } = await supa
                .from('team_members')
                .select('id, name, email, phone, role, cargo_custom, last_login_at, created_at')
                .eq('id', req.memberId)
                .maybeSingle()
            if (!member) return res.status(404).json({ error: 'Miembro no encontrado' })

            // Owner data (read-only, para mostrar la tienda en el header)
            let ownerData: any = {}
            try {
                const owner = await db.collection('users').findOne({ _id: new ObjectId(req.ownerUserId!) })
                ownerData = {
                    businessName: owner?.businessName || owner?.business_name || 'Qhatu',
                    plan: owner?.plan || 'enterprise',
                }
            } catch (_) { /* fallback */ }

            return res.json({
                _id: member.id,
                email: member.email,
                name: member.name,
                phone: member.phone || '',
                isTeamMember: true,
                role: member.role,
                cargoCustom: member.cargo_custom || '',
                ownerUserId: req.ownerUserId,
                businessName: ownerData.businessName,
                plan: ownerData.plan,
                photoUrl: null,
            })
        }

        const user = await db.collection('users').findOne({ _id: new ObjectId(req.userId) })
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' })
        const { password: _pw, ...safe } = user
        res.json(safe)
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

router.put('/auth/profile', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const { name, businessName } = req.body || {}
        await updateProfile(req.userId!, { name, businessName })
        const db = getDB()
        const user = await db.collection('users').findOne({ _id: new ObjectId(req.userId) })
        const { password: _pw, ...safe } = user || {}
        res.json({ success: true, user: safe })
    } catch (error: any) {
        res.status(400).json({ error: error.message })
    }
})

router.put('/auth/password', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const { currentPassword, newPassword } = req.body || {}
        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'Contraseña actual y nueva son requeridas' })
        }
        await changePassword(req.userId!, currentPassword, newPassword)
        res.json({ success: true })
    } catch (error: any) {
        res.status(400).json({ error: error.message })
    }
})

router.post('/auth/profile/photo', authMiddleware, profilePhotoUpload.single('photo'), async (req: AuthRequest, res: Response) => {
    try {
        const file = (req as any).file
        if (!file || !file.buffer) return res.status(400).json({ error: 'Archivo requerido (campo "photo")' })

        const ALLOWED_MIME = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']
        if (!ALLOWED_MIME.includes(file.mimetype)) {
            return res.status(400).json({ error: 'Formato no soportado. Usa JPG, PNG, WebP o GIF.' })
        }

        const supa = _wfSupa()
        const ext = (file.originalname?.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'jpg'
        // Fixed key per user (avatar.<ext>) — overwrites the previous photo
        // and keeps storage usage at one file per user. Cache-bust via the
        // query string we attach to the URL after upload so the browser
        // re-fetches even though the path is stable.
        const key = `${req.userId}/avatar.${ext}`

        const { error: upErr } = await supa.storage
            .from('profile-photos')
            .upload(key, file.buffer, {
                contentType: file.mimetype,
                upsert: true,
                cacheControl: '3600'
            })
        if (upErr) {
            console.error('[/auth/profile/photo] upload error:', upErr)
            return res.status(500).json({ error: `No se pudo subir la foto: ${upErr.message}` })
        }

        const { data: urlData } = supa.storage.from('profile-photos').getPublicUrl(key)
        const publicUrl = urlData?.publicUrl || ''
        const cacheBusted = publicUrl ? `${publicUrl}?t=${Date.now()}` : ''

        await updateProfile(req.userId!, { photoUrl: cacheBusted })

        res.json({ success: true, photoUrl: cacheBusted })
    } catch (error: any) {
        console.error('[/auth/profile/photo] error:', error)
        res.status(500).json({ error: error.message || 'Error subiendo foto' })
    }
})

// ════════════════════════════════════════════════════════════════════════
// EQUIPO DE VENTAS — CRUD de miembros del equipo
// ────────────────────────────────────────────────────────────────────────
// Multi-tenant: cada owner_user_id solo ve/edita su propio equipo. El
// authMiddleware ya valida el JWT y setea req.userId; lo usamos como
// owner_user_id en todas las queries.
//
// Tabla: team_members (ver scripts/migration_team_members.sql).
// Roles: 'supervisor' (ve todo el data del owner) | 'vendedor' (ve solo
// leads/chats asignados — assigned_to se sumará en Fase 2).
// ════════════════════════════════════════════════════════════════════════

// Helper: deriva el origin del request actual (http://localhost:3009 en
// dev, https://tukipu.com en prod). Lo usamos para que los links de
// invitación apunten al host correcto según desde dónde se generaron,
// sin depender de WEBHOOK_BASE_URL (que está cableado a producción).
function _inviteOrigin(req: Request): string {
    const fromOrigin = req.get('origin')
    if (fromOrigin) return fromOrigin
    const referer = req.get('referer')
    if (referer) {
        try { return new URL(referer).origin } catch (_) { /* fall through */ }
    }
    // Último recurso: armar desde host + protocol. Si está detrás de un
    // proxy (Nginx), Express respeta X-Forwarded-Proto si trust proxy está
    // activo (`app.set('trust proxy', true)`).
    return `${req.protocol}://${req.get('host')}`
}

// Helpers de scoping del módulo Equipo. Bloquean a los vendedores (que no
// deberían poder ver ni manejar el equipo). Los supervisores pueden listar
// pero no crear/editar/borrar. El owner real es el que puede todo.
// El scope se calcula con `resolveOwnerUserId(req)` para que un supervisor
// vea miembros bajo SU owner (no bajo su propio id).
function _teamScopeUserId(req: AuthRequest): string | undefined {
    return req.isTeamMember ? req.ownerUserId : req.userId
}
function _canManageTeam(req: AuthRequest): boolean {
    // Solo el owner real puede crear/editar/borrar miembros.
    return !req.isTeamMember
}
function _canViewTeam(req: AuthRequest): boolean {
    // Owner y supervisor pueden listar; vendedores no — ellos no necesitan
    // ver el equipo completo, sólo saber a quién está asignado cada lead
    // (eso viene resuelto en `assignedToName` dentro de la propia card).
    if (!req.isTeamMember) return true
    return req.teamRole === 'supervisor'
}

// GET /api/team — listar miembros del equipo del owner logueado
router.get('/team', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        if (!_canViewTeam(req)) {
            return res.status(403).json({ error: 'No tenés permisos para ver el equipo' })
        }
        const scopeUserId = _teamScopeUserId(req)
        const supa = _wfSupa()
        const { data, error } = await supa
            .from('team_members')
            .select('id, email, name, phone, role, cargo_custom, status, invite_token, invite_expires_at, created_at, accepted_at')
            .eq('owner_user_id', scopeUserId)
            .order('created_at', { ascending: true })
        if (error) throw new Error(error.message)

        const members = (data || []).map((m: any) => ({
            id: m.id,
            email: m.email,
            name: m.name,
            phone: m.phone || '',
            role: m.role,
            cargoCustom: m.cargo_custom || '',
            status: m.status,
            inviteToken: m.invite_token || null,
            inviteExpiresAt: m.invite_expires_at,
            createdAt: m.created_at,
            acceptedAt: m.accepted_at,
        }))
        res.json({ members })
    } catch (e: any) {
        console.error('[GET /team]', e?.message || e)
        res.status(500).json({ error: e?.message || 'Error listando equipo' })
    }
})

// POST /api/team — crear un miembro nuevo (status='invited' + token)
// Body: { name, email, phone?, role: 'supervisor'|'vendedor', cargoCustom? }
router.post('/team', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        if (!_canManageTeam(req)) {
            return res.status(403).json({ error: 'Solo el dueño puede agregar miembros al equipo' })
        }
        const scopeUserId = _teamScopeUserId(req)
        const { name, email, phone, role, cargoCustom } = req.body || {}
        if (!name || !String(name).trim()) return res.status(400).json({ error: 'Nombre requerido' })
        if (!email || !String(email).trim()) return res.status(400).json({ error: 'Email requerido' })
        if (!['supervisor', 'vendedor'].includes(role)) {
            return res.status(400).json({ error: 'Rol inválido (supervisor o vendedor)' })
        }

        const supa = _wfSupa()

        // Verificar que el email no esté repetido dentro del equipo del owner.
        const { data: existing } = await supa
            .from('team_members')
            .select('id')
            .eq('owner_user_id', scopeUserId)
            .eq('email', email.trim().toLowerCase())
            .maybeSingle()
        if (existing) {
            return res.status(409).json({ error: 'Ese email ya está en tu equipo' })
        }

        // Generar invite token (32 bytes hex = 64 chars) + expira en 7 días.
        const crypto = await import('node:crypto')
        const inviteToken = crypto.randomBytes(32).toString('hex')
        const inviteExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

        const { data, error } = await supa
            .from('team_members')
            .insert({
                owner_user_id: scopeUserId,
                email: String(email).trim().toLowerCase(),
                name: String(name).trim(),
                phone: phone ? String(phone).trim() : null,
                role,
                cargo_custom: cargoCustom ? String(cargoCustom).trim() : null,
                status: 'invited',
                invite_token: inviteToken,
                invite_expires_at: inviteExpiresAt,
            })
            .select('id, invite_token')
            .single()
        if (error) throw new Error(error.message)

        // Construimos el link de invitación usando el host real del request.
        // Antes usábamos process.env.WEBHOOK_BASE_URL pero eso genera links
        // de producción (https://tukipu.com/...) cuando se corre en local,
        // y el vendedor no puede acceder. Ahora respeta el origin del que
        // hizo el request → localhost en dev, tukipu.com en prod.
        const inviteUrl = `${_inviteOrigin(req)}/panel#invite/${data.invite_token}`

        // Audit
        try {
            await supa.from('team_audit').insert({
                owner_user_id: scopeUserId,
                actor_user_id: req.userId,
                target_member_id: data.id,
                action: 'invite',
                meta: { email, role },
            })
        } catch (_) { /* audit es best-effort */ }

        res.json({ success: true, id: data.id, inviteUrl, inviteToken: data.invite_token })
    } catch (e: any) {
        console.error('[POST /team]', e?.message || e)
        res.status(500).json({ error: e?.message || 'Error creando miembro' })
    }
})

// PUT /api/team/:id — editar nombre / phone / rol / cargo del miembro
// Body: { name?, phone?, role?, cargoCustom? }  (email NO se edita por
// seguridad — si necesita cambiarlo, hay que dar de baja y volver a invitar)
router.put('/team/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        if (!_canManageTeam(req)) {
            return res.status(403).json({ error: 'Solo el dueño puede editar miembros del equipo' })
        }
        const scopeUserId = _teamScopeUserId(req)
        const id = req.params.id as string
        const { name, phone, role, cargoCustom } = req.body || {}

        const update: any = { updated_at: new Date().toISOString() }
        if (typeof name === 'string') update.name = name.trim()
        if (typeof phone === 'string') update.phone = phone.trim() || null
        if (role !== undefined) {
            if (!['supervisor', 'vendedor'].includes(role)) {
                return res.status(400).json({ error: 'Rol inválido' })
            }
            update.role = role
        }
        if (typeof cargoCustom === 'string') update.cargo_custom = cargoCustom.trim() || null

        const supa = _wfSupa()
        const { data, error } = await supa
            .from('team_members')
            .update(update)
            .eq('id', id)
            .eq('owner_user_id', scopeUserId) // ← multi-tenant guard
            .select('id, role')
            .maybeSingle()
        if (error) throw new Error(error.message)
        if (!data) return res.status(404).json({ error: 'Miembro no encontrado' })

        // Audit si cambió el rol
        if (role !== undefined) {
            try {
                await supa.from('team_audit').insert({
                    owner_user_id: scopeUserId,
                    actor_user_id: req.userId,
                    target_member_id: id,
                    action: 'role_change',
                    meta: { new_role: role },
                })
            } catch (_) {}
        }

        res.json({ success: true })
    } catch (e: any) {
        console.error('[PUT /team/:id]', e?.message || e)
        res.status(500).json({ error: e?.message || 'Error actualizando miembro' })
    }
})

// DELETE /api/team/:id — eliminar miembro (hard delete si está 'invited',
// soft delete a 'disabled' si ya está 'active' para preservar histórico).
router.delete('/team/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        if (!_canManageTeam(req)) {
            return res.status(403).json({ error: 'Solo el dueño puede eliminar miembros del equipo' })
        }
        const scopeUserId = _teamScopeUserId(req)
        const id = req.params.id as string
        const supa = _wfSupa()

        // Saber el status actual para decidir hard vs soft delete.
        const { data: existing } = await supa
            .from('team_members')
            .select('id, status, email')
            .eq('id', id)
            .eq('owner_user_id', scopeUserId)
            .maybeSingle()
        if (!existing) return res.status(404).json({ error: 'Miembro no encontrado' })

        if (existing.status === 'active') {
            // Soft delete — preserva el lookup del histórico de leads.
            const { error } = await supa
                .from('team_members')
                .update({
                    status: 'disabled',
                    invite_token: null,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', id)
                .eq('owner_user_id', scopeUserId)
            if (error) throw new Error(error.message)
        } else {
            // Hard delete — nunca aceptó la invitación, no hay nada que preservar.
            const { error } = await supa
                .from('team_members')
                .delete()
                .eq('id', id)
                .eq('owner_user_id', scopeUserId)
            if (error) throw new Error(error.message)
        }

        try {
            await supa.from('team_audit').insert({
                owner_user_id: scopeUserId,
                actor_user_id: req.userId,
                target_member_id: id,
                action: existing.status === 'active' ? 'disable' : 'delete',
                meta: { email: existing.email, previous_status: existing.status },
            })
        } catch (_) {}

        res.json({ success: true, mode: existing.status === 'active' ? 'disabled' : 'deleted' })
    } catch (e: any) {
        console.error('[DELETE /team/:id]', e?.message || e)
        res.status(500).json({ error: e?.message || 'Error eliminando miembro' })
    }
})

// POST /api/team/:id/regenerate-invite — generar un nuevo token (útil si
// se venció o el miembro no lo recibió bien).
router.post('/team/:id/regenerate-invite', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        if (!_canManageTeam(req)) {
            return res.status(403).json({ error: 'Solo el dueño puede regenerar invitaciones' })
        }
        const scopeUserId = _teamScopeUserId(req)
        const id = req.params.id as string
        const supa = _wfSupa()

        const { data: existing } = await supa
            .from('team_members')
            .select('id, status, email')
            .eq('id', id)
            .eq('owner_user_id', scopeUserId)
            .maybeSingle()
        if (!existing) return res.status(404).json({ error: 'Miembro no encontrado' })
        if (existing.status === 'active') {
            return res.status(400).json({ error: 'El miembro ya activó su cuenta — no necesita invitación' })
        }

        const crypto = await import('node:crypto')
        const inviteToken = crypto.randomBytes(32).toString('hex')
        const inviteExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

        const { error } = await supa
            .from('team_members')
            .update({
                invite_token: inviteToken,
                invite_expires_at: inviteExpiresAt,
                status: 'invited', // por si estaba 'disabled' y lo re-invitan
                updated_at: new Date().toISOString(),
            })
            .eq('id', id)
            .eq('owner_user_id', scopeUserId)
        if (error) throw new Error(error.message)

        const inviteUrl = `${_inviteOrigin(req)}/panel#invite/${inviteToken}`

        // Audit (Fase 4.2)
        try {
            await supa.from('team_audit').insert({
                owner_user_id: scopeUserId,
                actor_user_id: req.userId,
                target_member_id: id,
                action: 'regenerate_invite',
                meta: { email: existing.email },
            })
        } catch (_) { /* best-effort */ }

        res.json({ success: true, inviteUrl, inviteToken })
    } catch (e: any) {
        console.error('[POST /team/:id/regenerate-invite]', e?.message || e)
        res.status(500).json({ error: e?.message || 'Error regenerando invitación' })
    }
})

// GET /api/team/audit — log de auditoría del equipo (Fase 4.2).
// Devuelve las últimas N entradas con info del actor + miembro afectado.
// Solo owner y supervisor pueden consultarlo.
router.get('/team/audit', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        if (!_canViewTeam(req)) {
            return res.status(403).json({ error: 'No tenés permisos para ver el log de auditoría' })
        }
        const scopeUserId = _teamScopeUserId(req)
        const limit = Math.min(parseInt((req.query.limit as string) || '100', 10) || 100, 500)
        const action = (req.query.action as string) || ''
        const supa = _wfSupa()

        let q = supa
            .from('team_audit')
            .select('id, owner_user_id, actor_user_id, target_member_id, action, meta, created_at')
            .eq('owner_user_id', scopeUserId)
            .order('created_at', { ascending: false })
            .limit(limit)
        if (action) q = q.eq('action', action)
        const { data: entries, error } = await q
        if (error) throw new Error(error.message)

        // Enriquecimiento: nombre del miembro afectado para que el UI no
        // tenga que hacer N lookups. Una sola query agregada por IDs únicos.
        const memberIds = Array.from(new Set((entries || [])
            .map((e: any) => e.target_member_id)
            .filter(Boolean)))
        const namesById: Record<string, string> = {}
        if (memberIds.length > 0) {
            const { data: members } = await supa
                .from('team_members')
                .select('id, name, email')
                .in('id', memberIds)
            for (const m of (members || [])) {
                namesById[String(m.id)] = m.name || m.email || ''
            }
        }

        res.json({
            entries: (entries || []).map((e: any) => ({
                id: e.id,
                action: e.action,
                actorUserId: e.actor_user_id,
                targetMemberId: e.target_member_id,
                targetMemberName: e.target_member_id ? (namesById[String(e.target_member_id)] || null) : null,
                meta: e.meta || {},
                createdAt: e.created_at,
            })),
        })
    } catch (e: any) {
        console.error('[GET /team/audit]', e?.message || e)
        res.status(500).json({ error: e?.message || 'Error leyendo log de auditoría' })
    }
})

// ════════════════════════════════════════════════════════════════════════
// INVITACIONES — flujo público (el miembro NO tiene token JWT todavía)
// ────────────────────────────────────────────────────────────────────────
// GET  /api/team/invite/:token          → valida el token, devuelve info
//                                          del owner + datos pre-cargados
//                                          del miembro (NO el email completo
//                                          ni datos sensibles del owner).
// POST /api/team/invite/:token/accept   → recibe { password }, hashea con
//                                          bcrypt, marca al miembro activo
//                                          y devuelve un JWT que el frontend
//                                          guarda en localStorage para login.
//
// Los endpoints NO usan authMiddleware (el miembro no tiene JWT aún).
// La seguridad viene del token random de 32 bytes en la URL — sin él, no
// hay forma de aceptar una invitación. El token expira en 7 días.
// ════════════════════════════════════════════════════════════════════════

router.get('/team/invite/:token', async (req: Request, res: Response) => {
    try {
        const token = String(req.params.token || '').trim()
        if (!token || token.length < 32) {
            return res.status(400).json({ error: 'Token inválido' })
        }
        const supa = _wfSupa()
        const { data: member, error } = await supa
            .from('team_members')
            .select('id, name, email, role, cargo_custom, status, invite_expires_at, owner_user_id')
            .eq('invite_token', token)
            .maybeSingle()
        if (error) throw new Error(error.message)
        if (!member) return res.status(404).json({ error: 'Invitación no encontrada o ya usada' })
        if (member.status === 'active') {
            return res.status(410).json({ error: 'Esta invitación ya fue activada. Iniciá sesión normalmente.' })
        }
        if (member.invite_expires_at && new Date(member.invite_expires_at) < new Date()) {
            return res.status(410).json({ error: 'La invitación expiró. Pedile al dueño que te genere una nueva.' })
        }

        // Datos del owner — solo el nombre del negocio, sin email ni nada
        // sensible. El miembro debe saber a qué tienda lo invitan.
        const db = getDB()
        const { ObjectId: _Oid } = await import('../services/db.service')
        let ownerInfo: any = {}
        try {
            const owner = await db.collection('users').findOne({ _id: new _Oid(String(member.owner_user_id)) })
            ownerInfo = {
                businessName: owner?.businessName || owner?.business_name || 'Qhatu',
                ownerName: (owner?.name || '').split(' ')[0] || '',
            }
        } catch (_) {
            ownerInfo = { businessName: 'Qhatu', ownerName: '' }
        }

        res.json({
            valid: true,
            member: {
                name: member.name,
                email: member.email,
                role: member.role,
                cargoCustom: member.cargo_custom || '',
            },
            owner: ownerInfo,
        })
    } catch (e: any) {
        console.error('[GET /team/invite/:token]', e?.message || e)
        res.status(500).json({ error: e?.message || 'Error validando invitación' })
    }
})

router.post('/team/invite/:token/accept', async (req: Request, res: Response) => {
    try {
        const token = String(req.params.token || '').trim()
        const { password } = req.body || {}
        if (!token || token.length < 32) {
            return res.status(400).json({ error: 'Token inválido' })
        }
        if (!password) return res.status(400).json({ error: 'Contraseña requerida' })

        const supa = _wfSupa()
        const { data: member, error: findErr } = await supa
            .from('team_members')
            .select('id, name, email, role, status, invite_expires_at, owner_user_id')
            .eq('invite_token', token)
            .maybeSingle()
        if (findErr) throw new Error(findErr.message)
        if (!member) return res.status(404).json({ error: 'Invitación no encontrada' })
        if (member.status === 'active') {
            return res.status(410).json({ error: 'Esta invitación ya fue usada. Iniciá sesión normalmente.' })
        }
        if (member.invite_expires_at && new Date(member.invite_expires_at) < new Date()) {
            return res.status(410).json({ error: 'La invitación expiró. Pedile al dueño una nueva.' })
        }

        // Validación de fortaleza — misma política que el registro del owner
        // (validatePasswordStrength en auth.service.ts): mínimo 10 chars,
        // mayúscula + minúscula + número + caracter especial, score zxcvbn ≥3.
        // El frontend ya valida con feedback en tiempo real, pero hacemos
        // defense-in-depth: alguien podría hacer POST directo al endpoint.
        const { validatePasswordStrength } = await import('../lib/passwordValidator')
        const pw = String(password)
        const pwCheck = validatePasswordStrength(pw, [member.email, member.name])
        if (!pwCheck.valid) {
            return res.status(400).json({ error: pwCheck.message || 'Contraseña inválida' })
        }

        const bcrypt = (await import('bcryptjs')).default
        const passwordHash = await bcrypt.hash(pw, 10)

        const { error: updErr } = await supa
            .from('team_members')
            .update({
                password_hash: passwordHash,
                status: 'active',
                invite_token: null,
                invite_expires_at: null,
                accepted_at: new Date().toISOString(),
                last_login_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            })
            .eq('id', member.id)
        if (updErr) throw new Error(updErr.message)

        // Audit
        try {
            await supa.from('team_audit').insert({
                owner_user_id: member.owner_user_id,
                actor_user_id: member.owner_user_id,    // el owner es responsable de la invitación
                target_member_id: member.id,
                action: 'invite_accepted',
                meta: { member_email: member.email, role: member.role },
            })
        } catch (_) {}

        // Generar JWT idéntico al de login normal pero con flag isTeamMember
        // y memberId/ownerUserId. El authMiddleware sigue funcionando (lee
        // `userId` del token), pero un nuevo `resolveTeamContext` middleware
        // (Fase 1.5) lo va a diferenciar para filtrar data por rol.
        const jwt = (await import('jsonwebtoken')).default
        const JWT_SECRET = process.env.JWT_SECRET!
        const tokenJwt = jwt.sign(
            {
                userId: member.id,            // memberId actúa como userId para el middleware
                email: member.email,
                isTeamMember: true,
                ownerUserId: member.owner_user_id,
                role: member.role,
            },
            JWT_SECRET,
            { expiresIn: '30d' }
        )

        res.json({
            success: true,
            token: tokenJwt,
            user: {
                _id: member.id,
                email: member.email,
                name: member.name,
                role: member.role,
                isTeamMember: true,
                businessName: '',   // el frontend lo llena con /auth/profile
            },
        })
    } catch (e: any) {
        console.error('[POST /team/invite/:token/accept]', e?.message || e)
        res.status(500).json({ error: e?.message || 'Error aceptando invitación' })
    }
})

// POST /api/team/login — login del miembro del equipo (separado del
// /auth/login del owner para evitar mezclar dos backings de password).
router.post('/team/login', async (req: Request, res: Response) => {
    try {
        const { email, password } = req.body || {}
        if (!email || !password) return res.status(400).json({ error: 'Email y password requeridos' })

        const supa = _wfSupa()
        const { data: member, error } = await supa
            .from('team_members')
            .select('id, name, email, role, status, password_hash, owner_user_id')
            .eq('email', String(email).trim().toLowerCase())
            .eq('status', 'active')
            .maybeSingle()
        if (error) throw new Error(error.message)
        if (!member || !member.password_hash) {
            return res.status(401).json({ error: 'Email o contraseña incorrectos' })
        }

        const bcrypt = (await import('bcryptjs')).default
        const ok = await bcrypt.compare(String(password), member.password_hash)
        if (!ok) return res.status(401).json({ error: 'Email o contraseña incorrectos' })

        // last_login_at — best-effort, no abortamos si falla
        try {
            await supa.from('team_members')
                .update({ last_login_at: new Date().toISOString() })
                .eq('id', member.id)
        } catch (_) {}

        // Audit del login (Fase 4.2)
        try {
            await supa.from('team_audit').insert({
                owner_user_id: member.owner_user_id,
                actor_user_id: member.id,           // el actor es el propio miembro
                target_member_id: member.id,
                action: 'member_login',
                meta: {
                    email: member.email,
                    role: member.role,
                    ip: req.ip || (req.headers['x-forwarded-for'] as string) || null,
                    ua: (req.headers['user-agent'] as string)?.slice(0, 200) || null,
                },
            })
        } catch (_) { /* best-effort */ }

        const jwt = (await import('jsonwebtoken')).default
        const JWT_SECRET = process.env.JWT_SECRET!
        const tokenJwt = jwt.sign(
            {
                userId: member.id,
                email: member.email,
                isTeamMember: true,
                ownerUserId: member.owner_user_id,
                role: member.role,
            },
            JWT_SECRET,
            { expiresIn: '30d' }
        )

        res.json({
            success: true,
            token: tokenJwt,
            user: {
                _id: member.id,
                email: member.email,
                name: member.name,
                role: member.role,
                isTeamMember: true,
            },
        })
    } catch (e: any) {
        console.error('[POST /team/login]', e?.message || e)
        res.status(500).json({ error: e?.message || 'Error iniciando sesión' })
    }
})

// ════════════════════════════════════════════════════════════════════════
// ASIGNACIÓN — leads / chats / orders pueden tener un assigned_to UUID
// que apunta a team_members.id. Solo owner/supervisor pueden asignar
// (vendedores no pueden reasignar leads ni los suyos ni los de otros).
// Cuando se asigna un lead, propagamos el assigned_to a:
//   • wa_chats con el mismo phone+botId
//   • orders abiertos del mismo phone+botId
// para que el vendedor vea el "paquete completo" del cliente sin que el
// owner tenga que asignar 3 cosas distintas a mano.
// ════════════════════════════════════════════════════════════════════════

function _isOwnerOrSupervisor(req: AuthRequest): boolean {
    if (!req.isTeamMember) return true                  // owner directo
    return req.teamRole === 'supervisor'
}

// Fase 2.3 — scoping por assigned_to:
//   vendedor  → solo filas con assigned_to = su memberId (NULL = invisible)
//   owner/supervisor → sin filtro, salvo ?memberId= opcional en query
function _mergeAssignedToScope(filter: Record<string, any>, req: AuthRequest): Record<string, any> {
    const out = { ...filter }
    if (req.isTeamMember && req.teamRole === 'vendedor' && req.memberId) {
        out.assignedTo = req.memberId
        return out
    }
    const memberId = typeof req.query?.memberId === 'string' ? req.query.memberId.trim() : ''
    if (memberId) out.assignedTo = memberId
    return out
}

// PATCH /api/leads/:id/assign — body: { memberId | null }
// Body: { memberId: "<uuid>" }   → asigna
// Body: { memberId: null }       → des-asigna ("Sin asignar")
router.patch('/leads/:id/assign', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        if (!_isOwnerOrSupervisor(req)) {
            return res.status(403).json({ error: 'Solo el dueño o un supervisor pueden asignar leads' })
        }
        const leadId = req.params.id as string
        const memberId = req.body?.memberId ?? null
        const supa = _wfSupa()

        // Validar que el lead pertenece al scope del owner.
        // OJO: la tabla `leads` NO tiene `user_id` propia — la pertenencia
        // se deriva vía `bot_id → bot_configs.user_id`. Antes hacíamos
        // `.select('..., user_id')` lo que rompía la query silenciosamente
        // y caía a "Lead no encontrado".
        const scopeUserId = req.isTeamMember ? req.ownerUserId : req.userId

        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(leadId)
        let lead: any = null
        if (isUuid) {
            const r = await supa
                .from('leads')
                .select('id, phone, bot_id, ticket_id')
                .eq('id', leadId)
                .maybeSingle()
            if (r.error) {
                console.error(`[PATCH /leads/${leadId}/assign] select error:`, r.error.message)
            }
            lead = r.data
        }
        if (!lead) {
            // Fallback: ticket_id (ej. "LD-A10D10" o "#LD-A10D10")
            const ticketGuess = leadId.replace(/^#/, '')
            const r2 = await supa
                .from('leads')
                .select('id, phone, bot_id, ticket_id')
                .eq('ticket_id', ticketGuess)
                .order('updated_at', { ascending: false })
                .limit(1)
                .maybeSingle()
            lead = r2.data
        }
        if (!lead) {
            console.warn(`[PATCH /leads/${leadId}/assign] lead no encontrado (uuid=${isUuid}, scope=${scopeUserId})`)
            return res.status(404).json({ error: 'Lead no encontrado' })
        }

        // Validar ownership: lead.bot_id → bot_configs.user_id === scopeUserId.
        const { data: ownerBot } = await supa
            .from('bot_configs')
            .select('id, user_id')
            .eq('id', lead.bot_id)
            .maybeSingle()
        if (!ownerBot || String(ownerBot.user_id) !== String(scopeUserId)) {
            return res.status(403).json({ error: 'Este lead no pertenece a tu cuenta' })
        }

        // Si memberId no es null, validar que ese miembro existe Y pertenece
        // al owner (evita asignar leads a vendedores de OTROS dueños).
        // Aceptamos también `invited` para pre-asignación: cuando el miembro
        // acepte la invitación verá los leads que ya tenía asignados.
        if (memberId) {
            const { data: member } = await supa
                .from('team_members')
                .select('id, status')
                .eq('id', memberId)
                .eq('owner_user_id', scopeUserId)
                .maybeSingle()
            if (!member) return res.status(404).json({ error: 'Miembro del equipo no encontrado' })
            if (member.status === 'disabled') {
                return res.status(400).json({ error: 'Ese miembro está deshabilitado. No puede recibir asignaciones.' })
            }
        }

        // Actualizar el lead — usamos lead.id (UUID real) en lugar del leadId
        // del request, que puede haber sido un ticket_id en el fallback.
        const { error: lerr } = await supa
            .from('leads')
            .update({ assigned_to: memberId, updated_at: new Date().toISOString() })
            .eq('id', lead.id)
        if (lerr) throw new Error(lerr.message)

        // Propagar al wa_chat (mismo phone+botId).
        // Las cards del chat después pasan a verse en la lista del vendedor.
        if (lead.phone && lead.bot_id) {
            try {
                await supa
                    .from('wa_chats')
                    .update({ assigned_to: memberId, updated_at: new Date().toISOString() })
                    .eq('bot_id', lead.bot_id)
                    .eq('chat_jid', lead.phone)
            } catch (_) { /* non-fatal */ }
        }

        // Propagar a orders ACTIVOS del cliente (no a los cerrados, para no
        // re-asignar histórico). Cambios masivos del histórico se hacen
        // manualmente desde el panel.
        if (lead.phone && lead.bot_id) {
            try {
                await supa
                    .from('orders')
                    .update({ assigned_to: memberId, updated_at: new Date().toISOString() })
                    .eq('bot_id', lead.bot_id)
                    .eq('phone', lead.phone)
                    .not('status', 'in', '(completado,cancelado,pagado,entregado_pago_pendiente)')
            } catch (_) { /* non-fatal */ }
        }

        // Audit
        try {
            await supa.from('team_audit').insert({
                owner_user_id: scopeUserId,
                actor_user_id: req.userId,
                target_member_id: memberId,
                action: memberId ? 'reassign_lead' : 'unassign_lead',
                meta: { lead_id: leadId, phone: lead.phone, bot_id: lead.bot_id },
            })
        } catch (_) {}

        res.json({ success: true })
    } catch (e: any) {
        console.error('[PATCH /leads/:id/assign]', e?.message || e)
        res.status(500).json({ error: e?.message || 'Error asignando lead' })
    }
})

// PATCH /api/chats/:botId/:chatJid/assign — asigna un chat (y su lead) a
// un miembro. Convenience endpoint para asignar directamente desde la
// pantalla de Chats sin tener que buscar el lead asociado.
router.patch('/chats/:botId/:chatJid/assign', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        if (!_isOwnerOrSupervisor(req)) {
            return res.status(403).json({ error: 'Solo el dueño o un supervisor pueden asignar chats' })
        }
        const botId = req.params.botId as string
        const chatJid = decodeURIComponent(req.params.chatJid as string)
        const memberId = req.body?.memberId ?? null
        const supa = _wfSupa()
        const scopeUserId = req.isTeamMember ? req.ownerUserId : req.userId

        // Validar que el bot pertenece al owner
        const { data: bot } = await supa
            .from('bot_configs')
            .select('id, user_id')
            .eq('id', botId)
            .maybeSingle()
        if (!bot || String(bot.user_id) !== String(scopeUserId)) {
            return res.status(403).json({ error: 'Este bot no pertenece a tu cuenta' })
        }

        if (memberId) {
            const { data: member } = await supa
                .from('team_members')
                .select('id, status')
                .eq('id', memberId)
                .eq('owner_user_id', scopeUserId)
                .maybeSingle()
            if (!member || member.status !== 'active') {
                return res.status(400).json({ error: 'Miembro inválido o inactivo' })
            }
        }

        // Asignar el chat
        await supa
            .from('wa_chats')
            .update({ assigned_to: memberId, updated_at: new Date().toISOString() })
            .eq('bot_id', botId)
            .eq('chat_jid', chatJid)

        // Propagar al lead asociado (phone = chatJid)
        await supa
            .from('leads')
            .update({ assigned_to: memberId, updated_at: new Date().toISOString() })
            .eq('bot_id', botId)
            .eq('phone', chatJid)

        // Audit
        try {
            await supa.from('team_audit').insert({
                owner_user_id: scopeUserId,
                actor_user_id: req.userId,
                target_member_id: memberId,
                action: memberId ? 'reassign_chat' : 'unassign_chat',
                meta: { bot_id: botId, chat_jid: chatJid },
            })
        } catch (_) {}

        res.json({ success: true })
    } catch (e: any) {
        console.error('[PATCH /chats/:botId/:chatJid/assign]', e?.message || e)
        res.status(500).json({ error: e?.message || 'Error asignando chat' })
    }
})

router.get('/auth/plans', authMiddleware, async (_req: AuthRequest, res: Response) => {
    // Catálogo estático de planes. Fuente de verdad: KIPU_Planes_de_Suscripcion.pdf
    // Precios en soles peruanos (S/), incluyen IGV. Renovación mensual automática.
    res.json({
        plans: [
            {
                id: 'starter',
                name: 'Starter',
                tagline: 'Empieza a vender por WhatsApp con tu primera tienda.',
                badge: null,
                prices: { monthly: 89, yearly: 999, currency: 'S/' },
                priceLabels: { monthly: 'S/ 89', yearly: 'S/ 999' },
                priceSuffix: { monthly: '/mes', yearly: '/año' },
                yearlySavings: 69,
                features: [
                    '1 tienda Qhatu activa',
                    'WhatsApp como canal único',
                    '100 conversaciones IA / mes',
                    '1 producto · 1 método de pago',
                    'Envío con configuración única',
                    'CRM Leads y Ventas (Tier 1–2)',
                    'Soporte por correo (48 h hábiles)',
                    '1 semana de prueba gratuita'
                ]
            },
            {
                id: 'pro',
                name: 'Pro',
                tagline: 'Crece con multi-canal, CRM completo y analytics.',
                badge: 'Más popular',
                prices: { monthly: 249, yearly: 2799, currency: 'S/' },
                priceLabels: { monthly: 'S/ 249', yearly: 'S/ 2,799' },
                priceSuffix: { monthly: '/mes', yearly: '/año' },
                yearlySavings: 189,
                features: [
                    '1 tienda · WhatsApp + Instagram',
                    '400 conversaciones IA / mes',
                    '5 productos · 2 métodos de pago',
                    'Envío personalizado por región',
                    'CRM completo (Leads · Ventas · Postventa)',
                    'Analytics de Leads + embudo de conversión',
                    'Pagos parciales habilitados',
                    'Sandbox end-to-end · soporte 24 h'
                ]
            },
            {
                id: 'business',
                name: 'Business',
                tagline: 'Para negocios consolidados con alto volumen y multi-tienda.',
                badge: null,
                prices: { monthly: 499, yearly: 5699, currency: 'S/' },
                priceLabels: { monthly: 'S/ 499', yearly: 'S/ 5,699' },
                priceSuffix: { monthly: '/mes', yearly: '/año' },
                yearlySavings: 289,
                features: [
                    '3 tiendas · WhatsApp + IG + TikTok',
                    '1,000 conversaciones IA / mes',
                    '30 productos · métodos de pago ilimitados',
                    'Personalidad de Maya configurable',
                    'Importación URL / Shopify / Instagram',
                    'Recojo en tienda habilitado',
                    'Analytics completos + export Excel',
                    'Capacitación 1 h · soporte 12 h prioritario'
                ]
            },
            {
                id: 'enterprise',
                name: 'Enterprise',
                tagline: 'Operación a escala con onboarding presencial y asesor directo.',
                badge: null,
                prices: { monthly: 1299, yearly: 14999, currency: 'S/' },
                priceLabels: { monthly: 'S/ 1,299', yearly: 'S/ 14,999' },
                priceSuffix: { monthly: '/mes', yearly: '/año' },
                yearlySavings: 589,
                features: [
                    '10 tiendas · todos los canales',
                    '10,000 conversaciones IA / mes',
                    '500 productos por tienda',
                    'Workflows 100 % personalizados por marca',
                    'Múltiples locales con recojo en tienda',
                    'Onboarding presencial en Lima',
                    'Asesor + línea directa de WhatsApp',
                    'Todo lo del plan Business incluido'
                ]
            }
        ],
        billingNotes: {
            taxes: 'Precios en soles peruanos (S/) e IGV incluido.',
            renewal: 'Facturación mensual con renovación automática.',
            trial: '1 semana de prueba gratuita en cualquier plan.',
            yearlyHint: 'El plan anual te ahorra hasta 2 meses al año.'
        },
        valid: VALID_PLANS
    })
})

// Política temporal (mes de prueba gratis): todos los usuarios están en
// Enterprise y los downgrades están deshabilitados. Defensa server-side
// para que un cliente que llame con curl/Postman tampoco pueda bajar de
// plan. El frontend muestra un popup gracioso cuando se hace click en
// cualquier plan que no sea el actual; este 403 es la red defensiva.
const PLAN_DOWNGRADE_DISABLED_ERROR = {
    error: 'Por ahora no podés cambiar de plan. Todos los usuarios disfrutan del plan Enterprise durante el periodo de prueba.',
    code: 'PLAN_DOWNGRADE_DISABLED'
}

router.post('/auth/change-plan', authMiddleware, async (_req: AuthRequest, res: Response) => {
    return res.status(403).json(PLAN_DOWNGRADE_DISABLED_ERROR)
})

// Legacy endpoint — mantenido para no romper frontends viejos.
router.post('/auth/request-plan-change', authMiddleware, async (_req: AuthRequest, res: Response) => {
    return res.status(403).json(PLAN_DOWNGRADE_DISABLED_ERROR)
})


// ==================== BOTS ====================

router.get('/bots', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        // Si es team member, resolvemos al ownerUserId (los bots pertenecen
        // al dueño, no al vendedor). resolveOwnerUserId() vuelve req.userId
        // para owners y req.ownerUserId para miembros.
        const scopeUserId = req.isTeamMember ? req.ownerUserId : req.userId
        const bots = await db.collection('bot_configs')
            .find({ userId: scopeUserId })
            .sort({ createdAt: -1 })
            .toArray()

        // ── Enriquecimiento por bot para la pantalla "Conexiones" ──
        // Incluye estado en vivo + teléfono conectado + conteo de mensajes
        // recibidos hoy. El conteo se hace con UNA query agregada para no
        // disparar N queries (un user puede tener N tiendas). Si la tabla
        // wa_messages no existe en algún esquema viejo, el conteo cae a 0
        // sin abortar la respuesta entera.
        const botIds = bots.map((b: any) => b._id?.toString()).filter(Boolean)
        const todayStart = new Date()
        todayStart.setHours(0, 0, 0, 0)
        const msgCountByBot: Record<string, number> = {}
        if (botIds.length > 0) {
            try {
                const recentMsgs = await db.collection('wa_messages').find({
                    botId: { $in: botIds },
                    fromMe: false,
                    timestamp: { $gte: todayStart }
                }).toArray()
                for (const m of recentMsgs) {
                    const k = String(m.botId)
                    msgCountByBot[k] = (msgCountByBot[k] || 0) + 1
                }
            } catch (e: any) {
                // wa_messages opcional — si no existe, todos quedan en 0.
                console.warn('[GET /bots] wa_messages count skip:', e?.message || e)
            }
        }

        for (const bot of bots) {
            const botId = bot._id?.toString()
            const live = botManager.getStatus(botId)
            bot.liveStatus = live
            // Teléfono conectado: preferimos lo persistido en bot_configs,
            // pero si el socket está vivo y conocemos el JID, usamos eso
            // (más fresco que la última conexión si el bot fue reconectado
            // con otro número manualmente).
            const liveJid = botManager.getConnectedJid(botId)
            const livePhone = liveJid ? String(liveJid).split('@')[0].split(':')[0] : ''
            bot.phoneNumber = livePhone || bot.connectedPhone || ''
            bot.msgCountToday = msgCountByBot[botId] || 0
        }

        res.json(bots)
    } catch (error: any) {
        console.error('[GET /bots] ERROR:', error.message)
        res.status(500).json({ error: error.message })
    }
})

router.post('/bots', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        console.log('[DEBUG][POST /bots] Creating bot:', req.body.botName || req.body.tienda?.nombre, 'userId:', (req as any).userId)
        const payload = req.body;
        if (!payload.botName && !payload.tienda?.nombre) {
            return res.status(400).json({ error: 'Nombre del bot requerido' })
        }

        const db = getDB()
        // Spread payload.metadata FIRST y los defaults canónicos al final —
        // así parentTiendaId / tiendaGroupId (modal Conexiones multi-número
        // por tienda) y otros campos custom se preservan sin pisar los
        // campos canónicos (registro_completo, fecha_registro, etc.).
        const botConfig = {
            userId: req.userId,
            botName: payload.botName || payload.tienda?.nombre,
            tienda: payload.tienda || {},
            operacion: payload.operacion || {},
            categoria_config: payload.categoria_config || {},
            base_conocimiento: payload.base_conocimiento || { fuente: 'manual', bloques: [] },
            products: Array.isArray(payload.products) ? payload.products : [],
            metadata: {
                ...(payload.metadata || {}),
                registro_completo: false,
                paso_actual: payload.metadata?.paso_actual || 1,
                fecha_registro: new Date(),
                ultima_modificacion: new Date()
            },
            systemPrompt: payload.systemPrompt || 'Eres un asistente de ventas amigable y profesional para PYMEs peruanas. Responde siempre en español de manera natural y concisa.',
            greeting: payload.greeting || '¡Hola! 👋 Gracias por escribirnos. ¿En qué puedo ayudarte?',
            status: 'disconnected',
            phoneNumber: '',
            createdAt: new Date()
        }

        const result = await db.collection('bot_configs').insertOne(botConfig)
        const newBotId = result.insertedId.toString()
        console.log('[DEBUG][POST /bots] Bot created with ID:', newBotId)

        // Create business_info record so configuration UI loads immediately
        console.log('[DEBUG][POST /bots] Creating business_info for botId:', newBotId)
        await db.collection('business_info').insertOne({
            botId: newBotId,
            description: '',
            products: Array.isArray(payload.products) ? payload.products : [],
            paymentMethods: '',
            schedule: '',
            faqs: '',
            fileUri: null,
            fileName: null,
            createdAt: new Date()
        })

        res.json({ ...botConfig, _id: result.insertedId })
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

// ═══════════════════════════════════════════════════════════
// GENERATE AI PROMPT — Uses OpenAI to create a custom prompt from onboarding data
// ═══════════════════════════════════════════════════════════
router.post('/bots/generate-prompt', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const {
            botName, category, businessDescription, clientDescription, botPersonality,
            products, tone, ownerName, hasDelivery, hasStore,
            shippingScope, paymentMethods, schedule, faqs,
            categoryConfig, extraContext
        } = req.body

        if (!botName || !category) {
            return res.status(400).json({ error: 'botName y category son requeridos' })
        }

        const OpenAI = (await import('openai')).default
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

        let contextBlock = `
DATOS DEL NEGOCIO RECOPILADOS EN EL ONBOARDING:
- Nombre del negocio: ${botName}
- Categoría: ${category}
- Dueño/Responsable: ${ownerName || 'No especificado'}
- Tono deseado: ${tone || 'amigable'}
- Tiene delivery: ${hasDelivery ? 'Sí' : 'No'}
- Tiene tienda física: ${hasStore ? 'Sí' : 'No'}
- Alcance de envío: ${shippingScope || 'local'}`

        if (businessDescription) contextBlock += `\n- Descripción del negocio: ${businessDescription}`
        if (clientDescription) contextBlock += `\n- Perfil de clientes: ${clientDescription}`
        if (botPersonality) contextBlock += `\n- Personalidad e Instrucciones de Comportamiento: ${botPersonality}`
        if (paymentMethods) contextBlock += `\n- Métodos de pago: ${paymentMethods}`
        if (schedule) contextBlock += `\n- Horario: ${schedule}`

        if (products && products.length > 0) {
            contextBlock += `\n\nPRODUCTOS/SERVICIOS (${products.length} items):`
            for (const p of products.slice(0, 15)) {
                contextBlock += `\n- ${p.name}: ${p.description || ''} | Precio: ${p.price || 'Consultar'}`
            }
            if (products.length > 15) contextBlock += `\n... y ${products.length - 15} productos más.`
        }

        if (faqs && Array.isArray(faqs) && faqs.length > 0) {
            contextBlock += `\n\nPREGUNTAS FRECUENTES:`
            for (const faq of faqs.slice(0, 10)) {
                contextBlock += `\n- ${faq}`
            }
        }

        if (categoryConfig) contextBlock += `\n\nCONFIG ESPECÍFICA DE CATEGORÍA: ${JSON.stringify(categoryConfig)}`
        if (extraContext) contextBlock += `\n\nCONTEXTO ADICIONAL: ${extraContext}`

        const metaPrompt = `Eres un experto en diseño de prompts para chatbots de ventas por WhatsApp en Latinoamérica.

Tu tarea: Genera un SYSTEM PROMPT completo y detallado para un bot de ventas de WhatsApp basándote en TODA la información del negocio proporcionada.

${contextBlock}

REQUISITOS DEL PROMPT QUE DEBES GENERAR:
1. IDENTIDAD: El bot se llama "Qhatu" y es el asistente virtual de "${botName}". ${botPersonality ? `Su personalidad y estilo de comunicación OBLIGATORIO es: "${botPersonality}" (Prioriza esto sobre otras reglas tonales).` : `Personalidad según tono "${tone || 'amigable'}".`}
2. FLUJO DE VENTA: Crea un flujo de pedido paso a paso adaptado a la categoría "${category}". Incluye: saludo con opciones numeradas, toma de pedido, personalización, upselling inteligente (máx 2 sugerencias), resumen con precios y total, método de pago, confirmación.
3. REGLAS DE VENTA: No inventar productos/precios, usar solo el catálogo, ofrecer alternativas si algo no está disponible, siempre cerrar con siguiente paso.
4. CONTEXTO: Incorpora la descripción del negocio y el perfil de clientes naturalmente.
5. TONO: Ajusta el lenguaje al tono elegido. Incluye emojis si es casual/amigable.
6. IDIOMA: Todo en español.
7. ${hasDelivery ? 'Incluye flujo de delivery (dirección, zona, costo estimado).' : 'No tiene delivery.'}
8. ${hasStore ? 'Incluye opción de visita/recojo en tienda.' : 'Solo venta online.'}
9. Si el cliente quiere hablar con una persona, indica que puede pedir "Hablar con alguien".

FORMATO: Devuelve SOLO el system prompt, sin explicaciones ni markdown. Empieza directamente con "Eres Kipu..."`

        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: 'user', content: metaPrompt }],
            max_tokens: 2048,
            temperature: 0.7
        })

        const generatedPrompt = completion.choices[0]?.message?.content || ''
        if (!generatedPrompt) {
            return res.status(500).json({ error: 'No se pudo generar el prompt' })
        }

        console.log(`[API] ✅ Prompt generado con IA para "${botName}" (${generatedPrompt.length} chars)`)
        res.json({ prompt: generatedPrompt })

    } catch (error: any) {
        console.error('[API] Error generando prompt con IA:', error)
        res.status(500).json({ error: error.message })
    }
})

// ═══════════════════════════════════════════════════════════
// SHIPPING MODULE
// ═══════════════════════════════════════════════════════════
import { cotizarOlva, getProvinciasOlva, getDistritosOlva, cotizarShalom, buscarAgenciasShalom, getShippingConfig, saveShippingConfig } from '../services/shipping.service'

router.get('/shipping/ubigeo/provincias/:departmentId', async (req: AuthRequest, res: Response) => {
    const data = await getProvinciasOlva(req.params.departmentId as string);
    res.json(data);
});

router.get('/shipping/ubigeo/distritos/:provinceId', async (req: AuthRequest, res: Response) => {
    const data = await getDistritosOlva(req.params.provinceId as string);
    res.json(data);
});

router.post('/shipping/olva/cotizar', async (req: AuthRequest, res: Response) => {
    const result = await cotizarOlva(req.body);
    res.json(result);
});

router.get('/shipping/shalom/agencias', async (req: AuthRequest, res: Response) => {
    const q = req.query.q as string || '';
    const agencias = await buscarAgenciasShalom(q);
    res.json(agencias);
});

router.post('/shipping/shalom/cotizar', async (req: AuthRequest, res: Response) => {
    const result = await cotizarShalom(req.body as any);
    res.json(result);
});

router.get('/shipping/config/:botId', authMiddleware, async (req: AuthRequest, res: Response) => {
    const config = await getShippingConfig(req.params.botId as string);
    res.json(config);
});

router.post('/shipping/config/:botId', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const botId = req.params.botId as string
        await saveShippingConfig(botId, req.body);
        // Mirror the saved config into the "Cotizar envío" workflow node so the
        // mind map shows the real groups/pickup branches instead of the seed text.
        // Fire-and-forget to keep the save response fast.
        syncShippingToWorkflow(botId, req.body).catch(() => {})
        touchBotConfigUpdatedAt(botId).catch(() => {})
        resumeAllBotChatsAfterConfig(botId).catch(() => {})
        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});


// ═══════════════════════════════════════════════════════════
// IMPROVE RULE — Uses OpenAI to rewrite dynamic AI rules
// ═══════════════════════════════════════════════════════════
router.post('/bots/:id/improve-rule', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const { rule } = req.body
        if (!rule) {
            return res.status(400).json({ error: 'La indicación es requerida' })
        }

        const OpenAI = (await import('openai')).default
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

        const prompt = `Eres un experto ingeniero de prompts. El usuario te dará una instrucción o regla informal para su bot de atención al cliente en WhatsApp.
Tu tarea es reescribir esta instrucción de manera profesional, clara y directa, como una directiva estricta de "System Prompt" que el asistente de IA deba seguir de forma incondicional. No añadas saludos, ni introducciones, ni comillas extra. Devuelve SOLO la regla mejorada.

Regla original del usuario:
"${rule}"

Regla optimizada:`

        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 300,
            temperature: 0.7
        })

        const improvedRule = completion.choices[0]?.message?.content?.trim() || ''
        
        if (!improvedRule) {
            return res.status(500).json({ error: 'No se pudo mejorar la indicación' })
        }

        res.json({ improvedRule })

    } catch (error: any) {
        console.error('[API] Error improving rule:', error)
        res.status(500).json({ error: error.message })
    }
})

router.put('/bots/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const payload = req.body;
        const db = getDB()
        const botId = req.params.id as string

        const bot = await db.collection('bot_configs').findOne({
            _id: new ObjectId(botId),
            userId: req.userId
        })
        if (!bot) return res.status(404).json({ error: 'Bot no encontrado' })

        const update: any = {}

        // --- Merge payload fields over existing nested structure ---
        // ⚠️ PROTECCIÓN DE NOMBRE: tienda.nombre se filtra fuera. El nombre del
        // negocio solo se cambia vía PUT /business/:botId/identity. Sin esto,
        // los wizards ("Configurar" en la card, onboarding largo) cargan
        // wiz-bot-name con bot.botName actual y al guardar lo persisten —
        // si en una sesión anterior Maya infirió otro nombre desde el catálogo
        // (ej. "Tienda de Café Especializado" para productos de cafetera),
        // el wizard lo re-persiste cada vez que se guarda config.
        if (payload.tienda) {
            const incomingTienda = { ...payload.tienda }
            delete incomingTienda.nombre
            update.tienda = { ...(bot.tienda || {}), ...incomingTienda }
        }
        if (payload.operacion) update.operacion = { ...(bot.operacion || {}), ...payload.operacion }

        // Use full replacement for category_config to avoid shallow merge issues with nested objects
        if (payload.categoria_config) update.categoria_config = payload.categoria_config

        // Save products array from wizard
        if (Array.isArray(payload.products)) update.products = payload.products

        // Save base de conocimiento
        if (payload.base_conocimiento) update.base_conocimiento = payload.base_conocimiento

        if (payload.metadata) {
            update.metadata = {
                ...(bot.metadata || {}),
                ...payload.metadata,
                ultima_modificacion: new Date()
            }
        } else {
            update.metadata = bot.metadata || {}
            update.metadata.ultima_modificacion = new Date()
        }

        if (payload.systemPrompt) update.systemPrompt = payload.systemPrompt
        if (payload.greeting) update.greeting = payload.greeting
        // ⚠️ payload.botName intencionalmente IGNORADO: ver comentario arriba.
        // El renombre legítimo va exclusivamente por PUT /business/:botId/identity,
        // que también invalida la cache del system-prompt y dispara regenerate.

        // Support dot-notated advancedConfig fields (e.g. panelFinancieroEnabled toggle)
        for (const key of Object.keys(payload)) {
            if (key.startsWith('advancedConfig.')) {
                update[key] = payload[key]
            }
        }

        await db.collection('bot_configs').updateOne(
            { _id: new ObjectId(botId) },
            { $set: update }
        )

        // Invalidar cache del system-prompt si cambia algo que afecta al
        // comportamiento del bot — el más obvio es interactionMode (formato
        // de respuestas), pero también operacion.* puede cambiar los datos
        // del prompt (envíos, pagos, horario). Mejor invalidar siempre que
        // toquemos operacion.
        if (payload.operacion) {
            try { invalidateStaticPromptCache(botId) } catch (_) { /* opcional */ }
            // Invalidar también el cache del modo de interacción para que
            // el siguiente envío saliente decida correctamente entre
            // botones interactivos y texto plano.
            try { invalidateInteractionModeCache(botId) } catch (_) { /* opcional */ }
        }

        resumeAllBotChatsAfterConfig(botId).catch(() => {})

        res.json({ message: 'Bot actualizado', update })
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

router.delete('/bots/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const botId = req.params.id as string
        const bot = await db.collection('bot_configs').findOne({
            _id: new ObjectId(botId),
            userId: req.userId
        })
        if (!bot) return res.status(404).json({ error: 'Bot no encontrado' })

        // fullCleanup=true al borrar el bot — sin esto las credenciales viejas
        // quedaban en disco y si el usuario después creaba un bot nuevo y le
        // tocaba el mismo botId UUID por casualidad, había conflict.
        await botManager.stopSession(botId, true)
        await db.collection('bot_configs').deleteOne({ _id: new ObjectId(botId) })
        await db.collection('business_info').deleteOne({ botId })
        // Limpieza de notificaciones huérfanas: si no las borrás acá, el panel
        // de notifs sigue mostrando handoffs/pagos/cotizaciones de una tienda
        // que ya no existe — el botón de "Ingresar al chat" rompe porque el bot
        // ya no está, y el contador queda inflado.
        const notifDel = await db.collection('notifications').deleteMany({ userId: req.userId, botId })
        console.log(`[DELETE /bots/${botId}] cleaned ${notifDel?.deletedCount ?? 0} orphan notifications`)

        res.json({ message: 'Bot eliminado' })
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

// Save advanced editor settings (called by bot editor "Guardar Cambios")
router.put('/bots/:id/advanced', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const botId = req.params.id as string
        const bot = await db.collection('bot_configs').findOne({
            _id: new ObjectId(botId),
            userId: req.userId
        })
        if (!bot) return res.status(404).json({ error: 'Bot no encontrado' })

        const { botPrompt, advanced } = req.body
        const update: any = {}

        if (botPrompt) update.systemPrompt = botPrompt
        if (advanced) update.editorConfig = advanced

        update['metadata.ultima_modificacion'] = new Date()

        await db.collection('bot_configs').updateOne(
            { _id: new ObjectId(botId) },
            { $set: update }
        )

        res.json({ success: true, message: 'Configuración avanzada guardada' })
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

// ==================== WHATSAPP CONNECTION ====================

router.post('/bots/:id/connect', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const botId = req.params.id as string
        const bot = await db.collection('bot_configs').findOne({
            _id: new ObjectId(botId),
            userId: req.userId
        })
        if (!bot) return res.status(404).json({ error: 'Bot no encontrado' })

        // Onboarding validation: products + payment methods are OBLIGATORY before connecting (doc sec 2.1)
        const bizInfo = await db.collection('business_info').findOne({ botId })
        const hasProducts = (bizInfo?.products?.length > 0) || (bot.products?.length > 0)
        const hasPayments = (bizInfo?.payment_methods_structured?.some((m: any) => m.activo !== false)) ||
            (bizInfo?.paymentMethods && bizInfo.paymentMethods.trim().length > 0) ||
            (bot.operacion?.metodos_pago?.length > 0)

        if (!hasProducts) {
            return res.status(400).json({ error: 'Debes configurar al menos un producto antes de conectar WhatsApp. Ve a Mi Qhatu → Productos.' })
        }
        if (!hasPayments) {
            return res.status(400).json({ error: 'Debes configurar al menos un método de pago antes de conectar WhatsApp. Ve a Mi Qhatu → Pagos.' })
        }

        await botManager.createSession(botId)
        res.json({ message: 'Conectando... Escanea el QR' })
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

router.get('/bots/:id/qr', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const botId = req.params.id as string
        const status = botManager.getStatus(botId)

        if (status === 'connected') {
            return res.json({ status: 'connected', qr: null })
        }

        const qrBuffer = botManager.getQR(botId)
        if (!qrBuffer) {
            return res.json({ status, qr: null })
        }

        const qrBase64 = `data:image/png;base64,${qrBuffer.toString('base64')}`
        res.json({ status, qr: qrBase64 })
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

// Alias semántico: la pantalla "Conexiones" tiene un botón "Reconectar" que
// debe arrancar el socket de un bot que ya tiene credenciales en disco —
// internamente hace lo mismo que /connect. Lo separamos en un endpoint
// distinto porque (a) la UX es diferente (no muestra el modal de QR si las
// creds están vivas, salta directo a "Conectando..."), (b) NO valida
// products/payments (esas validaciones son para PRIMERA conexión, no para
// reanudar una sesión que ya estuvo activa).
router.post('/bots/:id/reconnect', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const botId = req.params.id as string
        const bot = await db.collection('bot_configs').findOne({
            _id: new ObjectId(botId),
            userId: req.userId
        })
        if (!bot) return res.status(404).json({ error: 'Bot no encontrado' })

        await botManager.createSession(botId)
        res.json({ message: 'Reconectando...' })
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

router.post('/bots/:id/disconnect', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const botId = req.params.id as string
        const bot = await db.collection('bot_configs').findOne({
            _id: new ObjectId(botId),
            userId: req.userId
        })
        if (!bot) return res.status(404).json({ error: 'Bot no encontrado' })

        // Capturamos el status PREVIO para reportar si pudimos hacer logout
        // contra WhatsApp (que es lo que retira el bot de "Dispositivos
        // vinculados" del móvil). Si el bot ya estaba desconectado/limbo, no
        // podemos notificar a WhatsApp y el cliente deberá borrarlo manual.
        const wasConnected = botManager.getStatus(botId) === 'connected'

        // fullCleanup=true: borra credenciales locales + actualiza status='disconnected'.
        // Sin eso, las keys que WhatsApp revoca al hacer logout quedaban en disco y
        // al reiniciar el server intentaban reconectarse causando "conflict 1/3" infinito
        // (ghost sessions). El disconnect ahora es full reset.
        await botManager.stopSession(botId, true)
        res.json({
            message: 'Desconectado',
            unlinkedFromWhatsApp: wasConnected,
            hint: wasConnected
                ? 'El bot fue retirado de "Dispositivos vinculados" automáticamente.'
                : 'Para retirar el bot de "Dispositivos vinculados", abrí WhatsApp en el móvil → Configuración → Dispositivos vinculados → Eliminar la sesión manualmente.'
        })
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

router.get('/bots/:id/status', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const botId = req.params.id as string
        const status = botManager.getStatus(botId)
        res.json({ status })
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

// ==================== KIPU TESTER ====================
router.post('/bots/:id/test-chat', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const { text, simulateReceipt, reset } = req.body;
        const botId = req.params.id as string;
        const db = getDB();
        console.log('[DEBUG][POST /test-chat] botId:', botId, 'text:', (text || '').substring(0, 80), 'reset:', !!reset)

        // Use a designated identifier for UI testing
        const mockSender = `tester_${req.userId}`;
        
        // Support clearing testing context History
        if (reset) {
            await db.collection('chat_history').deleteOne({ key: `${botId}_${mockSender}` });
            // Cleanup dummy orders created by tester to not pollute DB
            const testOrders = await db.collection('orders').find({ botId, phone: mockSender }).toArray();
            for (const o of testOrders) await db.collection('orders').deleteOne({ _id: o._id });
            await db.collection('leads').deleteOne({ botId, phone: mockSender });
            // Clean up the mirrored WA messages/chat row so the tester stays a clean sandbox.
            await db.collection('wa_messages').deleteMany({ botId, chatJid: mockSender }).catch(() => {});
            await db.collection('wa_chats').deleteOne({ botId, chatJid: mockSender }).catch(() => {});
            // Limpiar notifs creadas por tests anteriores que pudieran haber dejado
            // SHIPPING_QUOTE / HANDOFF / PAYMENT_RECEIPT colgadas para este sender.
            // El wrapper Supabase no soporta filtrar por paths JSONB (data.phone),
            // así que filtramos en memoria.
            try {
                const stale = await db.collection('notifications').find({
                    botId,
                    type: { $in: ['SHIPPING_QUOTE', 'HANDOFF', 'PAYMENT_RECEIPT'] }
                }).toArray();
                for (const n of (stale || [])) {
                    if (n?.data?.phone === mockSender) {
                        await db.collection('notifications').deleteOne({ _id: n._id }).catch(() => {});
                    }
                }
            } catch (_) { /* non-fatal */ }
            return res.json({ success: true, message: 'Test conversation cleared' });
        }
        
        // Make the simulated request
        const AIResponse = await botManager.simulateContactMessage(botId, text || '', mockSender, simulateReceipt === true);

        // Sandbox gap detection: check config completeness and propose changes (doc sec 8)
        const bizInfo = await db.collection('business_info').findOne({ botId });
        const botDoc = await db.collection('bot_configs').findOne({ _id: new ObjectId(botId) });
        // B-8: configGaps reestructurado con 4 campos (doc v3.0 Instrucción #9)
        interface ConfigGap { gap: string; reason: string; action: string; location: string }
        const gaps: ConfigGap[] = [];

        if (!bizInfo?.products?.length && !botDoc?.products?.length) {
            gaps.push({
                gap: 'No hay productos configurados',
                reason: 'Sin productos, Qhatu no puede informar precios ni cerrar ventas — hará handoff en cada consulta.',
                action: 'Agregar al menos 1 producto con nombre, precio y stock.',
                location: 'Mi Qhatu → Productos → Agregar producto'
            });
        } else if (bizInfo?.products?.length > 0) {
            // Check for products missing weight (critical for Shalom shipping)
            const sinPeso = bizInfo.products.filter((p: any) => !p.peso && !p.weight);
            if (sinPeso.length > 0) {
                gaps.push({
                    gap: `${sinPeso.length} producto(s) sin peso configurado: ${sinPeso.map((p: any) => p.name).join(', ')}`,
                    reason: 'Sin peso, Qhatu no puede calcular tarifas de Shalom y tendrá que hacer handoff en cada venta — el flujo se rompe.',
                    action: 'Configurar peso en gramos y dimensiones en cm para cada producto.',
                    location: `Mi Qhatu → Productos → editar cada producto → campo Peso`
                });
            }
        }
        if (!bizInfo?.paymentMethods?.trim() && !bizInfo?.payment_methods_structured?.length && !botDoc?.operacion?.metodos_pago?.length) {
            gaps.push({
                gap: 'No hay métodos de pago configurados',
                reason: 'Sin métodos de pago, Qhatu no puede indicar cómo pagar al cerrar una venta — el cliente abandona.',
                action: 'Configurar al menos 1 método de pago (Yape, Plin, transferencia, etc.).',
                location: 'Mi Qhatu → Pagos → Agregar método'
            });
        }
        if (!botDoc?.operacion?.envios && !bizInfo?.shippingConfig) {
            gaps.push({
                gap: 'No hay envíos configurados',
                reason: 'Sin opciones de envío, Qhatu no puede cotizar ni cerrar pedidos con envío — hará handoff.',
                action: 'Configurar al menos 1 opción: delivery local, Shalom, Olva o recojo en tienda.',
                location: 'Mi Qhatu → Envíos → Configurar'
            });
        }
        if (!bizInfo?.faqs?.trim()) {
            gaps.push({
                gap: 'No hay políticas ni FAQs configuradas',
                reason: 'Si un cliente pregunta por devoluciones, garantías u horarios, Qhatu hará handoff porque no tiene esa información.',
                action: 'Escribir políticas de devolución, cambio, garantía y preguntas frecuentes.',
                location: 'Mi Qhatu → Políticas y FAQs'
            });
        }
        if (!botDoc?.operacion?.horario) {
            gaps.push({
                gap: 'No hay horario de atención configurado',
                reason: 'Sin horario, Qhatu no puede informar cuándo se verifican pagos ni gestionar expectativas fuera de horario.',
                action: 'Configurar horario de atención (días y horas).',
                location: 'Mi Qhatu → Operación → Horario'
            });
        }

        res.json({ success: true, response: AIResponse, configGaps: gaps.length > 0 ? gaps : null });
    } catch (e: any) {
        console.error('[API] Error simulating bot:', e);
        res.status(500).json({ error: e.message || 'Error simulating bot' });
    }
});

// ═══════════════════════════════════════════════════════════
// ==================== MAYA CHAT CONFIG ====================
// ═══════════════════════════════════════════════════════════

router.post('/bots/:id/maya-chat', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB();
        const botId = req.params.id as string;
        const { chatHistory, catalogAnalysis } = req.body;
        console.log('[DEBUG][POST /maya-chat] botId:', botId, 'historyLen:', chatHistory?.length || 0, 'hasCatalog:', !!catalogAnalysis)

        // Validar bot prop
        const bot = await db.collection('bot_configs').findOne({
            _id: new ObjectId(botId),
            userId: req.userId
        });
        console.log('[DEBUG][POST /maya-chat] bot found:', !!bot, bot ? bot.botName : 'N/A')
        
        if (!bot) return res.status(404).json({ error: 'Bot no encontrado' });

        const businessInfo = await db.collection('business_info').findOne({ botId });

        // Traducir el estado real del bot a la "Estructura Genérica V2" para Qhatu
        // Para que OpenAI entienda más rápido qué tiene y qué modificar
        
        const internalState = {
            identidad: {
                nombre_empresa: bot.botName || '',
                descripcion: businessInfo?.description || '',
                rubro: bot.tienda?.rubro || '',
                audiencia: bot.metadata?.audiencia || ''
            },
            personalidad: {
                tono: bot.metadata?.tone || 'amigable',
                nivel_formalidad: bot.metadata?.formalidad || '',
                usa_emojis: bot.metadata?.usa_emojis !== false,
                prompt_sistema: bot.systemPrompt || ''
            },
            catalogo: {
                productos: businessInfo?.products || []
            },
            envio: {
                tipo_entrega: Array.isArray(bot.operacion?.envios?.tipo_entrega) ? bot.operacion.envios.tipo_entrega : [],
                zonas_cobertura: bot.operacion?.envios?.zonas || [],
                zonas_reglas: Array.isArray(bot.operacion?.envios?.zonas_reglas) ? bot.operacion.envios.zonas_reglas : [],
                costo_envio: bot.operacion?.envios?.costo_fijo || 0,
                instrucciones_especiales: bot.operacion?.envios?.costo_variable_politica || '',
                cost_strategy: bot.operacion?.envios?.cost_strategy || '',
                couriers: Array.isArray(bot.operacion?.envios?.couriers) ? bot.operacion.envios.couriers : [],
                cobertura: bot.operacion?.envios?.cobertura || '',
                tiempos_entrega: bot.operacion?.envios?.tiempos_entrega || '',
                envio_gratis_politica: bot.operacion?.envios?.envio_gratis_politica || ''
            },
            pagos: {
                metodos: bot.operacion?.metodos_pago || [],
                acepta_contra_entrega: false
            },
            reglas_especiales: bot.faqs || [] 
        };

        // If catalogAnalysis was provided, inject it as additional context for Qhatu
        let enrichedHistory = chatHistory || [];
        if (catalogAnalysis && catalogAnalysis.products) {
            // IMPORTANTE: NO truncamos productos al persistir. Solo limitamos
            // la MUESTRA que se envía al LLM como contexto (para no explotar
            // el token budget). El catálogo completo se persiste por separado
            // vía PUT /business/:botId — ver maya-chat.js pioConfirmAndSave.
            const totalProducts = catalogAnalysis.products.length;
            // Para >50 productos, mandamos solo nombre+precio (compactado)
            // de los primeros 100 para que Qhatu entienda el rango sin saturar.
            const sample = totalProducts > 50
                ? catalogAnalysis.products.slice(0, 100).map((p: any) => ({
                    name: p.name,
                    price: p.price
                }))
                : catalogAnalysis.products;
            const catalogContext = `[SYSTEM CONTEXT — Catalog Analysis Results]\n` +
                `Business: ${catalogAnalysis.business_name || 'Desconocido'}\n` +
                `Category: ${catalogAnalysis.business_category || 'nicho'}\n` +
                `Summary: ${catalogAnalysis.business_summary || ''}\n` +
                `Products found: ${totalProducts}\n` +
                `${totalProducts > 50 ? `Products sample (first 100 of ${totalProducts}, name+price only): ` : 'Products: '}${JSON.stringify(sample)}\n` +
                (catalogAnalysis.knowledge_blocks?.length > 0 ? `Knowledge blocks: ${JSON.stringify(catalogAnalysis.knowledge_blocks)}\n` : '') +
                (catalogAnalysis.payment_methods?.length > 0 ? `Payment methods detected: ${catalogAnalysis.payment_methods.join(', ')}\n` : '') +
                (catalogAnalysis.has_delivery ? `Has delivery: yes\n` : '') +
                `[END CATALOG CONTEXT — Please integrate all these products and business info into the configuration. NOTE: the COMPLETE catalog of ${totalProducts} products is persisted separately in business_info; do NOT truncate when storing.]`;

            enrichedHistory = [...enrichedHistory, { role: 'user', content: catalogContext }];
            console.log(`[Qhatu] Injected catalog analysis: ${totalProducts} products (sample of ${sample.length}), category: ${catalogAnalysis.business_category}`);
        }

        const mayaRawResponse = await handleKipuChatInteraction(botId, req.userId!, enrichedHistory, internalState);
        
        // --- Traducir la configuración JSON de vuelta a la Arquitectura real de la DB de Qhatu ---
        const newConf = mayaRawResponse.configuracion || {};
        
        const promptFromQhatu = newConf.personalidad?.prompt_sistema || newConf.personalidad?.instrucciones_adicionales || '';
        
        // SAFETY NET: If the user's last message was a long workflow/prompt (>200 chars)
        // but Qhatu didn't put it in prompt_sistema, force-save it directly
        const lastUserMessage = (chatHistory || []).filter((m: any) => m.role === 'user').pop();
        const lastUserText = lastUserMessage?.content || '';
        // Strip the attachment data to get clean text
        const cleanUserText = lastUserText.split('\n[Adjunto')[0].trim();
        
        let finalPromptSistema = promptFromQhatu;
        if (cleanUserText.length > 200 && promptFromQhatu.length < cleanUserText.length * 0.3) {
            // Qhatu likely summarized or misclassified the prompt — force override
            console.log(`[Qhatu Debug] SAFETY NET ACTIVATED: User sent ${cleanUserText.length} chars but prompt_sistema only has ${promptFromQhatu.length}. Force-saving user text as systemPrompt.`);
            // Append the user's raw text to whatever existing prompt there is
            const existingPrompt = internalState.personalidad?.prompt_sistema || '';
            finalPromptSistema = existingPrompt ? existingPrompt + '\n\n' + cleanUserText : cleanUserText;
        }

        // 1. Actualizar bot_configs
        const updateBotPayload: any = {};
        // ⚠️ Intencionalmente NO actualizamos botName desde la respuesta de Maya.
        // Si lo hacemos, Maya "ayuda" inventando nombres a partir de los productos
        // del catálogo (ej: tienda creada como "Rodrigo SaC", tras chatear con
        // Maya quedaba renombrada a "Tienda de Café Especializado" porque vio
        // que el producto era una cafetera). El nombre del negocio lo controla
        // EXCLUSIVAMENTE el usuario vía el modal de identidad
        // (PUT /business/:botId/identity). Maya puede seguir actualizando rubro,
        // descripción, systemPrompt, productos — pero no el nombre.
        if (newConf.identidad?.rubro) updateBotPayload['tienda.rubro'] = newConf.identidad.rubro;
        
        // prompt_sistema es EL CEREBRO del bot — siempre actualizarlo si existe
        if (finalPromptSistema) updateBotPayload.systemPrompt = finalPromptSistema;
        
        if (newConf.personalidad?.tono) updateBotPayload['metadata.tone'] = newConf.personalidad.tono;
        
        // Actualizar Operación de pagos (importante mantenerlos como array de objetos)
        if (newConf.pagos?.metodos) updateBotPayload['operacion.metodos_pago'] = newConf.pagos.metodos;
        
        // Actualizar Operación de envío (merge-preservar)
        // Cada turno de Qhatu reescribe este objeto. Si el LLM devuelve campos
        // vacíos (típico en turnos conversacionales tipo "sí"/"ok" donde solo
        // confirma), antes esto borraba la config previa. Ahora cada campo se
        // preserva salvo que Qhatu envíe un valor no-vacío explícito. Solo se
        // escribe el payload si al menos un campo queda con data.
        if (newConf.envio) {
            const nv = newConf.envio;
            const cur = bot.operacion?.envios || {};
            const hasItems = (x: any) => Array.isArray(x) && x.length > 0;
            const hasText = (x: any) => typeof x === 'string' && x.trim().length > 0;

            const tipoEntrega = hasItems(nv.tipo_entrega) ? nv.tipo_entrega : (Array.isArray(cur.tipo_entrega) ? cur.tipo_entrega : []);
            const zonasReglas = hasItems(nv.zonas_reglas) ? nv.zonas_reglas : (Array.isArray(cur.zonas_reglas) ? cur.zonas_reglas : []);
            const couriersList = hasItems(nv.couriers) ? nv.couriers : (Array.isArray(cur.couriers) ? cur.couriers : []);
            const zonasCobertura = hasItems(nv.zonas_cobertura) ? nv.zonas_cobertura : (Array.isArray(cur.zonas) ? cur.zonas : []);
            const costStrategy = hasText(nv.cost_strategy) ? nv.cost_strategy.toString() : (cur.cost_strategy || '');
            const costoFijo = typeof nv.costo_envio === 'number' && nv.costo_envio > 0
                ? nv.costo_envio
                : (typeof cur.costo_fijo === 'number' ? cur.costo_fijo : 0);
            const costoVariablePolitica = hasText(nv.instrucciones_especiales) ? nv.instrucciones_especiales : (cur.costo_variable_politica || '');
            const cobertura = hasText(nv.cobertura) ? nv.cobertura : (cur.cobertura || '');
            const tiemposEntrega = hasText(nv.tiempos_entrega) ? nv.tiempos_entrega : (cur.tiempos_entrega || '');
            const envioGratisPolitica = hasText(nv.envio_gratis_politica) ? nv.envio_gratis_politica : (cur.envio_gratis_politica || '');

            const anyData = tipoEntrega.length > 0 || zonasReglas.length > 0 || couriersList.length > 0
                || !!costStrategy || !!cobertura || !!tiemposEntrega || !!envioGratisPolitica
                || zonasCobertura.length > 0 || costoFijo > 0 || !!costoVariablePolitica;

            if (anyData) {
                updateBotPayload['operacion.envios'] = {
                    tipo_entrega: tipoEntrega,
                    hace_envios: tipoEntrega.length > 0 || zonasReglas.length > 0 || !!costStrategy,
                    zonas: zonasCobertura,
                    zonas_reglas: zonasReglas,
                    costo_fijo: costoFijo,
                    costo_variable_politica: costoVariablePolitica,
                    cost_strategy: costStrategy,
                    couriers: couriersList,
                    cobertura: cobertura,
                    tiempos_entrega: tiemposEntrega,
                    envio_gratis_politica: envioGratisPolitica
                };
                console.log(`[Qhatu Debug] operacion.envios updated — cost_strategy=${costStrategy} zonas=${zonasReglas.length} couriers=${couriersList.length}`);
            } else {
                console.log('[Qhatu Debug] operacion.envios skipped — Qhatu response had no populated shipping fields; preserving current DB state.');
            }
            // Save Shalom/carrier config to advancedConfig
            if (newConf.envio.carriers || newConf.envio.shalom_origin) {
                updateBotPayload['advancedConfig.delivery.carriers'] = newConf.envio.carriers || [];
                if (newConf.envio.shalom_origin?.id) {
                    updateBotPayload['advancedConfig.delivery.shalom'] = {
                        originId: newConf.envio.shalom_origin.id,
                        originName: newConf.envio.shalom_origin.nombre || ''
                    };
                    // Also save to shipping config for bot-manager access
                    updateBotPayload['advancedConfig.delivery.shalom_origin_id'] = newConf.envio.shalom_origin.id;
                }
                // Set courier mode based on carriers
                const carriers = newConf.envio.carriers || [];
                if (carriers.includes('shalom') && carriers.includes('olva')) {
                    updateBotPayload['advancedConfig.delivery.courier_mode'] = 'ambos';
                } else if (carriers.includes('shalom')) {
                    updateBotPayload['advancedConfig.delivery.courier_mode'] = 'shalom';
                } else if (carriers.includes('olva')) {
                    updateBotPayload['advancedConfig.delivery.courier_mode'] = 'olva';
                }
            }
        }

        // Metadata extra
        updateBotPayload['metadata.audiencia'] = newConf.identidad?.audiencia || '';
        updateBotPayload['metadata.formalidad'] = newConf.personalidad?.nivel_formalidad || '';
        updateBotPayload['metadata.usa_emojis'] = newConf.personalidad?.usa_emojis;

        console.log(`[Qhatu Debug] SAVING systemPrompt: ${(updateBotPayload.systemPrompt || '').length} chars`);

        if (Object.keys(updateBotPayload).length > 0) {
            updateBotPayload.updatedAt = new Date();
            await db.collection('bot_configs').updateOne(
                { _id: new ObjectId(botId) },
                { $set: updateBotPayload }
            );
            console.log(`[Qhatu Debug] bot_configs UPDATED successfully for ${botId}`);
        }

        // 2. Actualizar business_info
        const updateBizPayload: any = {};
        if (newConf.identidad?.descripcion) updateBizPayload.description = newConf.identidad.descripcion;

        // Preservar el catálogo COMPLETO cuando viene catalogAnalysis del
        // import de productos. Antes Qhatu recibía solo 50 productos como
        // muestra y devolvía esos 50 en newConf.catalogo.productos, lo que
        // sobrescribía el catálogo guardado dejando al usuario con 50/1000.
        // Ahora: si llega catalogAnalysis con productos, esos son la fuente
        // de verdad y NO dejamos que el LLM los reduzca.
        if (catalogAnalysis && Array.isArray(catalogAnalysis.products) && catalogAnalysis.products.length > 0) {
            updateBizPayload.products = catalogAnalysis.products;
            console.log(`[Qhatu] Persisting full catalog from catalogAnalysis: ${catalogAnalysis.products.length} products (LLM output ignored)`);
        } else if (newConf.catalogo?.productos) {
            // Solo confiar en el LLM para productos cuando no vino catalogAnalysis
            // (ej. el usuario está editando el catálogo conversacionalmente).
            // Pero NO sobreescribir si la lista del LLM es más corta que la
            // existente — eso suele ser un alucinamiento por context truncation.
            const existingBiz = await db.collection('business_info').findOne({ botId });
            const existingCount = existingBiz?.products?.length || 0;
            const llmCount = newConf.catalogo.productos.length;
            if (llmCount >= existingCount || existingCount === 0) {
                updateBizPayload.products = newConf.catalogo.productos;
            } else {
                console.warn(`[Qhatu] LLM returned ${llmCount} products but DB has ${existingCount}. Skipping overwrite to preserve catalog.`);
            }
        }

        if (newConf.reglas_especiales) {
            updateBizPayload.faqs = Array.isArray(newConf.reglas_especiales)
                ? newConf.reglas_especiales.map((r: any) => typeof r === 'string' ? r : (r.regla || JSON.stringify(r))).join('\n')
                : JSON.stringify(newConf.reglas_especiales);
        }

        if (Object.keys(updateBizPayload).length > 0) {
            updateBizPayload.updatedAt = new Date();
            await db.collection('business_info').updateOne(
                { botId },
                { $set: updateBizPayload },
                { upsert: true }
            );
        }

        resumeAllBotChatsAfterConfig(botId).catch(() => {})

        res.json({
            message: mayaRawResponse.mensaje_maya,
            syncedState: newConf
        });

    } catch (e: any) {
        console.error('[API] Error in Qhatu Chat Endpoint:', e);
        res.status(500).json({ error: e.message || 'Error comunicándose con Qhatu' });
    }
});

// Clears a single configuration section from the bot. Used by the trash
// button on each card in the Configuración sidebar (Mi Qhatu).
router.post('/bots/:id/clear-section/:section', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB();
        const botId = req.params.id as string;
        const section = String(req.params.section || '').toLowerCase();

        const bot = await db.collection('bot_configs').findOne({
            _id: new ObjectId(botId),
            userId: req.userId
        });
        if (!bot) return res.status(404).json({ error: 'Bot no encontrado' });

        const botUpdate: any = { updatedAt: new Date() };
        const bizUpdate: any = { updatedAt: new Date() };

        switch (section) {
            case 'identidad':
                botUpdate['tienda.rubro'] = '';
                botUpdate['metadata.audiencia'] = '';
                bizUpdate.description = '';
                break;
            case 'workflow':
            case 'personalidad':
                botUpdate.systemPrompt = '';
                botUpdate['metadata.tone'] = 'amigable';
                botUpdate['metadata.formalidad'] = '';
                break;
            case 'productos':
                bizUpdate.products = [];
                break;
            case 'envios':
            case 'envíos':
                botUpdate['operacion.envios'] = {
                    tipo_entrega: [],
                    hace_envios: false,
                    zonas: [],
                    zonas_reglas: [],
                    costo_fijo: 0,
                    costo_variable_politica: ''
                };
                botUpdate['advancedConfig.delivery'] = {};
                break;
            case 'pagos':
                botUpdate['operacion.metodos_pago'] = [];
                bizUpdate.payment_methods_structured = [];
                bizUpdate.paymentMethods = '';
                break;
            case 'reglas':
            case 'reglas_especiales':
                bizUpdate.faqs = '';
                break;
            default:
                return res.status(400).json({ error: `Sección desconocida: ${section}` });
        }

        await db.collection('bot_configs').updateOne(
            { _id: new ObjectId(botId) },
            { $set: botUpdate }
        );
        await db.collection('business_info').updateOne(
            { botId },
            { $set: bizUpdate },
            { upsert: true }
        );

        res.json({ success: true, section });
    } catch (e: any) {
        console.error('[Clear Section] error:', e.message);
        res.status(500).json({ error: e.message || 'Error eliminando sección' });
    }
});

// ==================== MAYA CHAT SESSIONS ====================

router.get('/bots/:id/maya-sessions', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB();
        const botId = req.params.id as string;

        const bot = await db.collection('bot_configs').findOne({
            _id: new ObjectId(botId),
            userId: req.userId
        });
        if (!bot) return res.status(404).json({ error: 'Bot no encontrado' });

        const sessions = await db.collection('maya_sessions')
            .find({ botId, userId: req.userId }, { projection: { sessionId: 1, title: 1, updatedAt: 1, _id: 0 } })
            .sort({ updatedAt: -1 })
            .limit(20)
            .toArray();

        res.json(sessions);
    } catch (e: any) {
        console.error('[Qhatu Sessions] List error:', e.message);
        res.status(500).json({ error: 'Error loading sessions' });
    }
});

router.get('/bots/:id/maya-sessions/:sessionId', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB();
        const botId = req.params.id as string;
        const sessionId = req.params.sessionId as string;

        const session = await db.collection('maya_sessions').findOne({
            botId,
            userId: req.userId,
            sessionId
        });

        if (!session) return res.status(404).json({ error: 'Session not found' });
        res.json(session);
    } catch (e: any) {
        console.error('[Qhatu Sessions] Get error:', e.message);
        res.status(500).json({ error: 'Error loading session' });
    }
});

router.delete('/bots/:id/maya-sessions/:sessionId', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB();
        const botId = req.params.id as string;
        const sessionId = req.params.sessionId as string;

        const bot = await db.collection('bot_configs').findOne({
            _id: new ObjectId(botId),
            userId: req.userId
        });
        if (!bot) return res.status(404).json({ error: 'Bot no encontrado' });

        const result = await db.collection('maya_sessions').deleteOne({
            botId, userId: req.userId, sessionId
        });
        if (result.deletedCount === 0) return res.status(404).json({ error: 'Session not found' });
        res.json({ success: true });
    } catch (e: any) {
        console.error('[Qhatu Sessions] Delete error:', e.message);
        res.status(500).json({ error: 'Error deleting session' });
    }
});

router.post('/bots/:id/maya-sessions', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB();
        const botId = req.params.id as string;
        const { sessionId, title, history } = req.body;

        if (!sessionId || !title) {
            return res.status(400).json({ error: 'sessionId and title required' });
        }

        const bot = await db.collection('bot_configs').findOne({
            _id: new ObjectId(botId),
            userId: req.userId
        });
        if (!bot) return res.status(404).json({ error: 'Bot no encontrado' });

        await db.collection('maya_sessions').updateOne(
            { botId, userId: req.userId, sessionId },
            {
                $set: {
                    botId,
                    userId: req.userId,
                    sessionId,
                    title,
                    history: history || [],
                    updatedAt: new Date()
                },
                $setOnInsert: {
                    createdAt: new Date()
                }
            },
            { upsert: true }
        );

        res.json({ success: true });
    } catch (e: any) {
        console.error('[Qhatu Sessions] Save error:', e.message);
        res.status(500).json({ error: 'Error saving session' });
    }
});


// ==================== SALES DATA (Panel Financiero) ====================

router.get('/bots/:id/sales', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const botId = req.params.id as string

        // Verify bot ownership
        const bot = await db.collection('bot_configs').findOne({
            _id: new ObjectId(botId),
            userId: req.userId
        })
        if (!bot) return res.status(404).json({ error: 'Bot no encontrado' })

        // Build date filter
        const filter: any = { botId }
        if (req.query.start || req.query.end) {
            filter.timestamp = {}
            if (req.query.start) filter.timestamp.$gte = new Date(req.query.start as string)
            if (req.query.end) filter.timestamp.$lte = new Date(req.query.end as string)
        }

        const orders = await db.collection('orders')
            .find(filter)
            .sort({ timestamp: -1 })
            .toArray()

        // Normalize fields for frontend consumption
        const sales = orders.map(o => ({
            _id: o._id,
            total: parseFloat(o.total) || 0,
            items: o.items || '',
            productName: o.items || '',
            quantity: 1,
            clientPhone: o.customerPhone || o.from || '',
            clientId: o.from || '',
            createdAt: o.timestamp || o.createdAt,
            date: o.timestamp || o.createdAt
        }))

        res.json(sales)
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

// ==================== BUSINESS INFO ====================

router.get('/business/:botId', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const botId = req.params.botId as string
        console.log('[DEBUG][GET /business] botId:', botId)
        const info = await db.collection('business_info').findOne({ botId }) || { botId, description: '', products: [], paymentMethods: '', schedule: '', faqs: '', fileUri: null, fileName: null }
        console.log('[DEBUG][GET /business] Found:', { hasInfo: !!info, products: info.products?.length || 0, hasFaqs: !!info.faqs })

        // Sync: if business_info has no products, pull from bot_configs
        if (!info.products || info.products.length === 0) {
            const bot = await db.collection('bot_configs').findOne({ _id: new ObjectId(botId) })
            if (bot?.products?.length > 0) {
                info.products = bot.products
                // Persist sync so future reads are consistent
                await db.collection('business_info').updateOne({ botId }, { $set: { products: bot.products } }, { upsert: true })
            }
        }

        // Normalize product names (fix Undefined)
        if (info.products?.length > 0) {
            info.products = info.products.map((p: any) => ({
                ...p,
                name: p.name || p.nombre || p.product_name || p.titulo || 'Producto sin nombre',
                price: p.price ?? p.precio ?? 0,
                // Fallback de stock = 0 (no 10): los productos arrancan sin
                // unidades hasta que el usuario configure el inventario. El 10
                // anterior era un "10 mágico" que mostraba inventario falso en
                // el dashboard y confundía: el dueño veía "10 en stock" pero la
                // base no tenía nada — venta cae y el bot vendía aire.
                stock: p.stock ?? 0,
                peso: p.peso ?? p.weight ?? null,           // EN-10: peso del producto (kg)
                dimensiones: p.dimensiones ?? p.dimensions ?? null, // EN-10: dimensiones (LxWxH cm)
                descripcion: p.description ?? p.descripcion ?? ''
            }))
        }

        res.json(info)
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

// POST /api/business/:botId/product-photo — sube foto de un producto a
// Supabase Storage (bucket `product-photos`) y devuelve la URL pública.
// El frontend usa esta URL para previsualizar la imagen y persistirla en
// business_info.products[].imageUrl, que después el bot lee para mandar
// la foto cuando el cliente la pida en WhatsApp.
router.post('/business/:botId/product-photo', authMiddleware, profilePhotoUpload.single('photo'), async (req: AuthRequest, res: Response) => {
    try {
        const file = (req as any).file
        const botId = req.params.botId as string
        const productId = String(req.body?.productId || '').trim() || `prod_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        if (!file || !file.buffer) return res.status(400).json({ error: 'Archivo requerido (campo "photo")' })

        const ALLOWED_MIME = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
        if (!ALLOWED_MIME.includes(file.mimetype)) {
            return res.status(400).json({ error: 'Formato no soportado. Usa JPG, PNG o WebP.' })
        }

        // Verificar que el bot pertenezca al usuario antes de aceptar el upload.
        const db = getDB()
        const bot = await db.collection('bot_configs').findOne({ _id: new ObjectId(botId), userId: req.userId })
        if (!bot) return res.status(404).json({ error: 'Bot no encontrado' })

        const supa = _wfSupa()
        const ext = (file.originalname?.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'jpg'
        // Key estable por producto → reupload sobrescribe la foto vieja.
        const safeProductId = productId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60)
        const key = `${botId}/${safeProductId}.${ext}`

        // El bucket se llama `product-photos` (debe existir y ser público).
        // Si no existe, intentamos crear el bucket public on the fly.
        try {
            await supa.storage.createBucket('product-photos', { public: true }).catch(() => {})
        } catch (_) { /* ya existe, ignoramos */ }

        const { error: upErr } = await supa.storage
            .from('product-photos')
            .upload(key, file.buffer, {
                contentType: file.mimetype,
                upsert: true,
                cacheControl: '3600'
            })
        if (upErr) {
            console.error('[/business/product-photo] upload error:', upErr)
            return res.status(500).json({ error: `No se pudo subir la foto: ${upErr.message}` })
        }

        const { data: urlData } = supa.storage.from('product-photos').getPublicUrl(key)
        const publicUrl = urlData?.publicUrl || ''
        // Cache-bust con timestamp para que el navegador re-fetch la foto.
        const cacheBusted = publicUrl ? `${publicUrl}?t=${Date.now()}` : ''

        res.json({ success: true, imageUrl: cacheBusted, productId: safeProductId })
    } catch (error: any) {
        console.error('[/business/product-photo] error:', error)
        res.status(500).json({ error: error.message || 'Error subiendo foto' })
    }
})

router.post('/business/:botId/upload', authMiddleware, upload.single('catalog'), async (req: AuthRequest, res: Response) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No se subió ningún archivo' })

        const mimeType = req.file.mimetype
        const filePath = req.file.path

        // Limpiar archivo temporal
        try { unlinkSync(filePath) } catch { /* ignore */ }

        const db = getDB()
        await db.collection('business_info').updateOne(
            { botId: req.params.botId as string },
            {
                $set: {
                    fileName: req.file.originalname,
                    mimeType,
                    updatedAt: new Date()
                }
            },
            { upsert: true }
        )

        res.json({ message: 'Catálogo subido exitosamente', fileName: req.file.originalname })
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

// ==================== ADVANCED CONFIG (Parte B) ====================

router.get('/advanced-config/:botId', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const bot = await db.collection('bot_configs').findOne({
            _id: new ObjectId(req.params.botId as string),
            userId: req.userId
        })
        if (!bot) return res.status(404).json({ error: 'Bot no encontrado' })
        const cfg = bot.advancedConfig || { level1: null, level2: null, level3: null }
        res.json(cfg)
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

router.put('/advanced-config/:botId', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const { level, data } = req.body
        if (!level || !data) return res.status(400).json({ error: 'level and data required' })

        const bot = await db.collection('bot_configs').findOne({
            _id: new ObjectId(req.params.botId as string),
            userId: req.userId
        })
        if (!bot) return res.status(404).json({ error: 'Bot no encontrado' })

        const updateKey = `advancedConfig.level${level}`
        await db.collection('bot_configs').updateOne(
            { _id: new ObjectId(req.params.botId as string) },
            { $set: { [updateKey]: { ...data, completedAt: new Date() } } }
        )
        res.json({ success: true, level, message: `Nivel ${level} guardado` })
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

// ==================== CADENCE MANAGEMENT ====================

router.get('/cadences/:botId', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const botId = req.params.botId as string

        // Verify bot ownership
        const bot = await db.collection('bot_configs').findOne({
            _id: new ObjectId(botId),
            userId: req.userId
        })
        if (!bot) return res.status(404).json({ error: 'Bot no encontrado' })

        const cadences = await db.collection('cadences')
            .find({ botId })
            .sort({ updatedAt: -1 })
            .limit(100)
            .toArray()

        res.json(cadences)
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

router.patch('/cadences/:cadenceId/pause', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const cadenceId = req.params.cadenceId as string

        const cadence = await db.collection('cadences').findOne({ _id: new ObjectId(cadenceId) })
        if (!cadence) return res.status(404).json({ error: 'Cadencia no encontrada' })

        // Verify ownership through bot
        const bot = await db.collection('bot_configs').findOne({
            _id: new ObjectId(cadence.botId),
            userId: req.userId
        })
        if (!bot) return res.status(403).json({ error: 'Sin permiso' })

        await db.collection('cadences').updateOne(
            { _id: new ObjectId(cadenceId) },
            { $set: { status: 'PAUSED', updatedAt: new Date() } }
        )

        res.json({ success: true, message: 'Cadencia pausada' })
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

router.patch('/cadences/:cadenceId/resume', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const cadenceId = req.params.cadenceId as string

        const cadence = await db.collection('cadences').findOne({ _id: new ObjectId(cadenceId) })
        if (!cadence) return res.status(404).json({ error: 'Cadencia no encontrada' })

        const bot = await db.collection('bot_configs').findOne({
            _id: new ObjectId(cadence.botId),
            userId: req.userId
        })
        if (!bot) return res.status(403).json({ error: 'Sin permiso' })

        await db.collection('cadences').updateOne(
            { _id: new ObjectId(cadenceId) },
            { $set: { status: 'ACTIVE', updatedAt: new Date() } }
        )

        res.json({ success: true, message: 'Cadencia reanudada' })
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

// ==================== CATALOG AI ANALYSIS ====================


router.post('/catalog/analyze', authMiddleware, upload.array('catalogs', 5), async (req: AuthRequest, res: Response) => {
    try {
        const files = req.files as any[]
        if (files && files.length > 0) {
            // Multi-file upload analysis
            console.log(`[CatalogAnalyze] Analyzing ${files.length} file(s)...`)
            const analyses = []
            const fileNames: string[] = []

            for (const file of files) {
                try {
                    console.log(`[CatalogAnalyze] → ${file.originalname} (${file.mimetype})`)
                    const analysis = await analyzeCatalogFile(file.path, file.mimetype, file.originalname)
                    analyses.push(analysis)
                    fileNames.push(file.originalname)
                } catch (fileErr: any) {
                    console.error(`[CatalogAnalyze] Error on ${file.originalname}:`, fileErr.message)
                } finally {
                    try { unlinkSync(file.path) } catch { /* ignore */ }
                }
            }

            if (analyses.length === 0) {
                return res.status(500).json({ error: 'No se pudo analizar ninguno de los archivos' })
            }

            // Merge all analyses into one
            const merged = mergeCatalogAnalyses(analyses)
            console.log(`[CatalogAnalyze] Merged ${analyses.length} analyses → ${merged.products.length} products total`)

            res.json({
                success: true,
                source: 'files',
                fileNames,
                filesAnalyzed: analyses.length,
                filesTotal: files.length,
                analysis: merged
            })
        } else if (req.body?.url) {
            // URL analysis
            const url = req.body.url
            console.log(`[CatalogAnalyze] Analyzing URL: ${url}`)

            const analysis = await analyzeCatalogUrl(url)

            res.json({
                success: true,
                source: 'url',
                url,
                analysis
            })
        } else {
            res.status(400).json({ error: 'Debes enviar archivos o una URL para analizar' })
        }
    } catch (error: any) {
        console.error('[CatalogAnalyze] Error:', error.message)
        res.status(500).json({ error: 'Error al analizar el catálogo: ' + error.message })
    }
})

// ═══ Structured Payment Methods CRUD (Instrucción #5) ═══
// E20: Aprendizaje sin BD de Qhatu — concatena la respuesta del emprendedor a
// la descripción del producto seleccionado (o a un campo general). El catálogo
// ya está inyectado al system prompt del bot, así que en el siguiente turno
// Qhatu tiene la info y no vuelve a hacer handoff por la misma pregunta.
router.post('/business/:botId/learn-from-handoff', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const botId = req.params.botId as string
        const { productIndex, answer } = req.body || {}
        if (typeof answer !== 'string' || !answer.trim()) {
            return res.status(400).json({ error: 'answer es obligatorio' })
        }

        const bot = await db.collection('bot_configs').findOne({ _id: new ObjectId(botId), userId: (req as any).userId })
        if (!bot) return res.status(404).json({ error: 'Bot no encontrado' })

        const businessInfo = await db.collection('business_info').findOne({ botId })
        const products = Array.isArray(businessInfo?.products) ? [...businessInfo.products] : []
        const trimmed = answer.trim()
        const stamp = new Date().toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' })
        const learnedTag = `\n[Aprendido ${stamp}] ${trimmed}`

        if (typeof productIndex === 'number' && productIndex >= 0 && productIndex < products.length) {
            const p = { ...products[productIndex] }
            p.description = (p.description || '').toString() + learnedTag
            products[productIndex] = p
            await db.collection('business_info').updateOne(
                { botId },
                { $set: { products, updatedAt: new Date() } },
                { upsert: true }
            )
        } else {
            // Aprendizaje general — lo guardamos en businessInfo.faqs para que
            // Qhatu lo vea como conocimiento transversal a todos los productos.
            const currentFaqs = (businessInfo?.faqs || '').toString()
            const newFaqs = currentFaqs ? `${currentFaqs}\n\n${learnedTag.trim()}` : learnedTag.trim()
            await db.collection('business_info').updateOne(
                { botId },
                { $set: { faqs: newFaqs, updatedAt: new Date() } },
                { upsert: true }
            )
        }

        // Invalida la caché del system prompt del bot para que el próximo
        // mensaje vea el conocimiento nuevo sin esperar al TTL.
        try { invalidateStaticPromptCache(botId) } catch (_) { /* opcional */ }

        res.json({ success: true })
    } catch (error: any) {
        console.error('[learn-from-handoff]', error)
        res.status(500).json({ error: error.message || 'Error guardando aprendizaje' })
    }
})

// Regenerate category-specific qualifying questions Qhatu asks after listing
// products in a category (e.g. Polos -> "¿modelo en mente?", "¿uso diario o
// entreno?"). Uses already-saved products in business_info; no need to
// re-upload the original catalog file. Cheap targeted LLM call.
router.post('/business/:botId/regenerate-category-followups', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const botId = req.params.botId as string

        const bot = await db.collection('bot_configs').findOne({ _id: new ObjectId(botId), userId: (req as any).userId })
        if (!bot) return res.status(404).json({ error: 'Bot no encontrado' })

        const businessInfo = await db.collection('business_info').findOne({ botId })
        const products = Array.isArray(businessInfo?.products) ? businessInfo.products : []
        if (products.length === 0) {
            return res.status(400).json({ error: 'No hay productos configurados para este bot' })
        }

        const summary = (businessInfo?.business_summary || '').toString()
        const followups = await regenerateCategoryFollowups(products, summary)

        await db.collection('business_info').updateOne(
            { botId },
            { $set: { category_followups: followups, updatedAt: new Date() } },
            { upsert: true }
        )

        try { invalidateStaticPromptCache(botId) } catch (_) { /* opcional */ }

        res.json({ success: true, category_followups: followups, generated_for_categories: Object.keys(followups).length })
    } catch (error: any) {
        console.error('[regenerate-category-followups]', error)
        res.status(500).json({ error: error.message || 'Error regenerando preguntas calificadoras' })
    }
})

router.put('/business/:botId/payment-methods', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const botId = req.params.botId as string
        const { methods } = req.body
        // methods: [{ nombre, tipo, instrucciones, activo }]

        const bot = await db.collection('bot_configs').findOne({ _id: new ObjectId(botId), userId: (req as any).userId })
        if (!bot) return res.status(404).json({ error: 'Bot no encontrado' })

        // Validate: at least one active method
        const activeMethods = (methods || []).filter((m: any) => m.activo !== false)
        if (activeMethods.length === 0) return res.status(400).json({ error: 'Configura al menos un método de pago activo' })

        // Validate required fields for active methods
        for (const m of activeMethods) {
            if (!m.nombre?.trim() || !m.tipo?.trim()) {
                return res.status(400).json({ error: `El método "${m.nombre || 'sin nombre'}" necesita nombre y tipo` })
            }
        }

        await db.collection('business_info').updateOne(
            { botId },
            { $set: { payment_methods_structured: methods, updatedAt: new Date() } },
            { upsert: true }
        )

        // Also update the flat string version for backward compat
        const flatMethods = activeMethods.map((m: any) => `${m.nombre} (${m.tipo}): ${m.instrucciones}`).join('\n')
        await db.collection('business_info').updateOne({ botId }, { $set: { paymentMethods: flatMethods } })

        // Update bot_configs too
        await db.collection('bot_configs').updateOne(
            { _id: new ObjectId(botId) },
            { $set: { 'operacion.metodos_pago': activeMethods.map((m: any) => ({ metodo: m.nombre, tipo: m.tipo, instrucciones: m.instrucciones })) } }
        )

        // Mirror the active payment methods into the "Confirmación de pago"
        // workflow node description. Fire-and-forget so the response stays fast.
        syncPaymentsToWorkflow(botId, activeMethods).catch(() => {})
        // Marca la config como actualizada → ejemplos LLM cacheados quedan stale.
        touchBotConfigUpdatedAt(botId).catch(() => {})

        resumeAllBotChatsAfterConfig(botId).catch(() => {})

        res.json({ ok: true, methods })
    } catch (err: any) {
        res.status(500).json({ error: err.message })
    }
})

router.put('/business/:botId', authMiddleware, async (req: AuthRequest, res: Response) => {
    const t0 = Date.now()
    try {
        const { description, products, paymentMethods, schedule, faqs } = req.body
        const db = getDB()
        const botId = req.params.botId as string
        const productCount = Array.isArray(products) ? products.length : 0
        console.log(`[DEBUG][PUT /business] botId=${botId} products=${productCount} bodyKB=${(JSON.stringify(req.body).length / 1024).toFixed(1)}`)

        // Verificar que el bot pertenece al usuario
        const bot = await db.collection('bot_configs').findOne({
            _id: new ObjectId(botId),
            userId: req.userId
        })
        if (!bot) {
            console.warn(`[DEBUG][PUT /business] bot not found for userId=${req.userId} botId=${botId}`)
            return res.status(404).json({ error: 'Bot no encontrado' })
        }

        const beforeUpdate = Date.now()
        await db.collection('business_info').updateOne(
            { botId },
            {
                $set: {
                    botId,
                    description: description || '',
                    products: products || [],
                    paymentMethods: paymentMethods || '',
                    schedule: schedule || '',
                    faqs: faqs || '',
                    updatedAt: new Date()
                }
            },
            { upsert: true }
        )
        console.log(`[DEBUG][PUT /business] business_info update OK in ${Date.now() - beforeUpdate}ms`)

        resumeAllBotChatsAfterConfig(botId).catch(() => {})
        // Marca config como actualizada → ejemplos LLM cacheados quedan stale
        // (cambió products/payments/etc.).
        touchBotConfigUpdatedAt(botId).catch(() => {})

        res.json({ message: 'Información del negocio actualizada' })
        console.log(`[DEBUG][PUT /business] response sent, total ${Date.now() - t0}ms`)
    } catch (error: any) {
        console.error(`[DEBUG][PUT /business] FAILED after ${Date.now() - t0}ms:`, error?.message || error)
        res.status(500).json({ error: error.message })
    }
})

// ==================== ANALYTICS DATE HELPER ====================

function getAnalyticsDateRange(query: any): { startDate: Date, endDate: Date, prevStartDate: Date, days: number } {
    const days = parseInt(query.days as string) || 7
    const offset = parseInt(query.offset as string) || 0 // 0 = current, -1 = previous, etc.

    const now = new Date()
    const endDate = new Date(now)
    endDate.setDate(endDate.getDate() + (offset * days))
    // If offset is 0, endDate is now; if offset is -1, endDate is 'days' ago

    const startDate = new Date(endDate)
    startDate.setDate(startDate.getDate() - days)

    // Previous period for comparison
    const prevStartDate = new Date(startDate)
    prevStartDate.setDate(prevStartDate.getDate() - days)

    return { startDate, endDate, prevStartDate, days }
}

// ==================== ANALYTICS OVERVIEW ====================

router.get('/analytics/overview', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const botIdParam = (req.query.botId as string) || ''
        const ownerUserId = resolveOwnerUserId(req)

        // Get all user's bots
        const userBots = await db.collection('bot_configs')
            .find({ userId: ownerUserId })
            .toArray()

        if (userBots.length === 0) {
            return res.json(emptyAnalytics())
        }

        // Determine which botIds to query
        const botIds = botIdParam
            ? [botIdParam]
            : userBots.map(b => b._id.toString())

        const botFilter = botIdParam
            ? { botId: botIdParam }
            : { botId: { $in: botIds } }

        const now = new Date()
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())

        // --- Conversations ---
        const totalConversations = await db.collection('conversations')
            .countDocuments(botFilter)

        const todayConversations = await db.collection('conversations')
            .countDocuments({ ...botFilter, timestamp: { $gte: todayStart } })

        const uniqueContacts = await db.collection('conversations')
            .distinct('from', botFilter)
        const uniqueContactsCount = uniqueContacts.length

        // New vs returning contacts
        const contactCounts = await db.collection('conversations').aggregate([
            { $match: botFilter },
            { $group: { _id: '$from', count: { $sum: 1 } } }
        ]).toArray()
        const newContacts = contactCounts.filter(c => c.count === 1).length
        const recurringContacts = contactCounts.filter(c => c.count > 1).length

        // Hourly activity from conversations
        const hourlyActivity = await db.collection('conversations').aggregate([
            { $match: botFilter },
            { $group: { _id: { $hour: '$timestamp' }, count: { $sum: 1 } } },
            { $sort: { count: -1 } }
        ]).toArray()
        const peakHour = hourlyActivity.length > 0 ? `${hourlyActivity[0]._id}:00` : 'N/A'

        // Daily activity (day of week)
        const dailyActivity = await db.collection('conversations').aggregate([
            { $match: botFilter },
            { $group: { _id: { $dayOfWeek: '$timestamp' }, count: { $sum: 1 } } },
            { $sort: { count: -1 } }
        ]).toArray()
        const days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
        const peakDay = dailyActivity.length > 0 ? days[(dailyActivity[0]._id - 1) % 7] : 'N/A'

        // --- Orders (sales) — scoped por vendedor cuando aplica ---
        const orders = await db.collection('orders').find(_mergeAssignedToScope(botFilter, req)).toArray()
        const totalOrders = orders.length
        const totalRevenue = orders.reduce((sum: number, o: any) =>
            sum + (parseFloat(o.total) || 0), 0)
        const avgTicket = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0

        // G&L Error 18: tasa de conversión solo cuenta órdenes confirmadas
        // (status=completado), no pedidos abiertos ni cancelados.
        const completedOrdersCount = orders.filter((o: any) => o.status === 'completado').length
        const conversionRate = uniqueContactsCount > 0
            ? ((completedOrdersCount / uniqueContactsCount) * 100).toFixed(1)
            : '0.0'

        // Top products from orders
        const productCounts: Record<string, { count: number, revenue: number }> = {}
        orders.forEach((o: any) => {
            const item = o.items || 'Otros'
            if (!productCounts[item]) productCounts[item] = { count: 0, revenue: 0 }
            productCounts[item].count++
            productCounts[item].revenue += parseFloat(o.total) || 0
        })
        const topProducts = Object.entries(productCounts)
            .sort((a, b) => b[1].count - a[1].count)
            .slice(0, 5)
            .map(([name, data]) => ({ name, count: data.count, revenue: Math.round(data.revenue) }))

        // --- Leads + AI Analysis Intelligence — scoped por vendedor ---
        const leads = await db.collection('leads').find(_mergeAssignedToScope(botFilter, req)).toArray()
        const totalLeads = leads.length

        const hotLeads = leads.filter((l: any) =>
            (l.analysis?.scores?.conversion || 0) > 70).length
        const warmLeads = leads.filter((l: any) => {
            const score = l.analysis?.scores?.conversion || 0
            return score >= 30 && score <= 70
        }).length
        const coldLeads = totalLeads - hotLeads - warmLeads

        // Extract product interests from lead analysis
        const interestCounts: Record<string, number> = {}
        const occasionCounts: Record<string, number> = {}
        const sentimentCounts: Record<string, number> = { Positivo: 0, Neutral: 0, Negativo: 0 }
        const frictionCounts: Record<string, number> = {}
        const channelCounts: Record<string, number> = {}

        leads.forEach((l: any) => {
            const analysis = l.analysis
            if (!analysis) return

            // Product interests
            const productos = analysis.intereses?.productos || []
            productos.forEach((p: string) => {
                interestCounts[p] = (interestCounts[p] || 0) + 1
            })

            // Occasions
            const ocasion = analysis.contexto?.ocasion
            if (ocasion && ocasion !== 'No detectado') {
                occasionCounts[ocasion] = (occasionCounts[ocasion] || 0) + 1
            }

            // Sentiment
            const tono = analysis.sentimiento?.tono
            if (tono && sentimentCounts[tono] !== undefined) {
                sentimentCounts[tono]++
            }

            // Frictions
            const objeciones = analysis.frictions?.objeciones || []
            objeciones.forEach((obj: string) => {
                frictionCounts[obj] = (frictionCounts[obj] || 0) + 1
            })

            // Channel origin
            const origen = analysis.canal?.origen || 'WhatsApp'
            channelCounts[origen] = (channelCounts[origen] || 0) + 1
        })

        const topInterests = Object.entries(interestCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([name, count]) => ({ name, count }))

        const topOccasions = Object.entries(occasionCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([name, count]) => ({ name, count }))

        const topFrictions = Object.entries(frictionCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([name, count]) => ({ name, count }))

        // --- Funnel ---
        const received = uniqueContactsCount
        const responded = Math.min(totalConversations, uniqueContactsCount)
        const qualified = totalLeads
        const negotiation = hotLeads + warmLeads
        const closed = totalOrders

        // --- Automation metrics ---
        const escalatedCount = await db.collection('conversations')
            .countDocuments({ ...botFilter, escalated: true })
        const unansweredCount = await db.collection('conversations')
            .countDocuments({ ...botFilter, unanswered: true })
        const automationRate = totalConversations > 0
            ? Math.round(((totalConversations - escalatedCount) / totalConversations) * 100)
            : 0

        // --- Alerts count ---
        const alertsCount = await db.collection('alerts_log')
            .countDocuments(botFilter)

        res.json({
            scorecard: {
                totalConversations,
                todayConversations,
                conversionRate,
                totalRevenue,
                avgTicket,
                automationRate,
                avgResponseTime: '< 3s'
            },
            funnel: { received, responded, qualified, negotiation, closed },
            panels: {
                chat: { total: totalConversations, newContacts, recurringContacts },
                sales: { conversions: totalOrders, totalValue: totalRevenue, avgTicket },
                automation: { noHumanRate: automationRate, escalations: escalatedCount, unanswered: unansweredCount }
            },
            intelligence: {
                topProducts,
                topInterests,
                topOccasions,
                topFrictions,
                sentiment: sentimentCounts,
                channels: channelCounts,
                peakHour,
                peakDay,
                leadBreakdown: { hot: hotLeads, warm: warmLeads, cold: coldLeads },
                alertsTriggered: alertsCount
            }
        })
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

// ==================== KIPU ANALYTICS ENGINE ====================

// P-00: Full AI analysis of business metrics
router.post('/analytics/kipu-analyze', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const { botId, question } = req.body
        if (!botId) return res.status(400).json({ error: 'botId required' })

        const result = await kipuAnalyze(botId, req.userId!, question)
        res.json(result)
    } catch (error: any) {
        console.error('[KipuAnalyze] Error:', error.message)
        res.status(500).json({ error: error.message || 'Error en análisis KIPU' })
    }
})

// P-01: Onboarding assistant — next step guidance
router.post('/analytics/kipu-onboarding', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const { botId } = req.body
        if (!botId) return res.status(400).json({ error: 'botId required' })

        const result = await kipuOnboarding(botId, req.userId!)
        res.json(result)
    } catch (error: any) {
        console.error('[KipuOnboarding] Error:', error.message)
        res.status(500).json({ error: error.message || 'Error en onboarding KIPU' })
    }
})

// P-02: Metric unlock evaluation after save
router.post('/analytics/kipu-unlock', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const { botId, savedFields } = req.body
        if (!botId || !Array.isArray(savedFields)) {
            return res.status(400).json({ error: 'botId y savedFields (array) requeridos' })
        }

        const result = await kipuUnlockCheck(botId, req.userId!, savedFields)
        res.json({ success: true, result })
    } catch (error: any) {
        console.error('[KipuUnlock] Error:', error.message)
        res.status(500).json({ error: error.message || 'Error evaluando métricas desbloqueadas' })
    }
})

// Helper: map errores conocidos a status codes semánticos para que el front
// distinga "configura esto primero" (409) o "servicio IA saturado" (503) de un
// error real (500). Cuando es un error esperado, devolvemos una respuesta
// estable con flags para que el dashboard renderice un banner en vez de un toast.
function mapKipuAnalyticsError(error: any, res: Response, fallbackMsg: string) {
    const msg: string = error?.message || fallbackMsg
    if (/Configuraci[oó]n .* requerida/i.test(msg)) {
        return res.status(409).json({ success: false, requiresConfig: true, error: msg })
    }
    if (/429|Too Many Requests|quota|rate.?limit/i.test(msg)) {
        return res.status(503).json({ success: false, quotaExceeded: true, error: 'Servicio de IA temporalmente saturado. Intenta de nuevo en unos minutos.' })
    }
    return res.status(500).json({ error: msg })
}

// P-03: Rentabilidad Real Engine
router.get('/analytics/rentabilidad/:botId', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const botId = req.params.botId as string
        if (!botId) return res.status(400).json({ error: 'botId requerido' })

        const result = await kipuRentabilidad(botId, req.userId!)
        res.json({ success: true, result })
    } catch (error: any) {
        console.error('[KipuRentabilidad] Error:', error.message)
        return mapKipuAnalyticsError(error, res, 'Error calculando rentabilidad')
    }
})

// P-04: Inventario y Stock Engine
router.get('/analytics/inventario/:botId', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const botId = req.params.botId as string
        if (!botId) return res.status(400).json({ error: 'botId requerido' })

        const result = await kipuInventario(botId, req.userId!)
        res.json({ success: true, result })
    } catch (error: any) {
        console.error('[KipuInventario] Error:', error.message)
        return mapKipuAnalyticsError(error, res, 'Error calculando inventario')
    }
})

// P-05: Metas y Crecimiento Engine
router.get('/analytics/metas/:botId', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const botId = req.params.botId as string
        if (!botId) return res.status(400).json({ error: 'botId requerido' })

        const result = await kipuMetas(botId, req.userId!)
        res.json({ success: true, result })
    } catch (error: any) {
        console.error('[KipuMetas] Error:', error.message)
        return mapKipuAnalyticsError(error, res, 'Error calculando metas y proyecciones')
    }
})

// ==================== ANALYTICS PREDICTIONS ====================

router.get('/analytics/predictions', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const botIdParam = (req.query.botId as string) || ''
        const ownerUserId = resolveOwnerUserId(req)

        const userBots = await db.collection('bot_configs')
            .find({ userId: ownerUserId }).toArray()

        if (userBots.length === 0) {
            return res.json({ trends: [], topOccasions: [], inventoryAlerts: [] })
        }

        const botIds = botIdParam ? [botIdParam] : userBots.map(b => b._id.toString())
        const botFilter = botIdParam ? { botId: botIdParam } : { botId: { $in: botIds } }

        // Get last 30 days and previous 30 days for trend comparison
        const now = new Date()
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
        const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000)

        const recentLeads = await db.collection('leads')
            .find(_mergeAssignedToScope({ ...botFilter, updatedAt: { $gte: thirtyDaysAgo } }, req)).toArray()
        const prevLeads = await db.collection('leads')
            .find(_mergeAssignedToScope({ ...botFilter, updatedAt: { $gte: sixtyDaysAgo, $lt: thirtyDaysAgo } }, req)).toArray()

        const recentOrders = await db.collection('orders')
            .find(_mergeAssignedToScope({ ...botFilter, timestamp: { $gte: thirtyDaysAgo } }, req)).toArray()
        const prevOrders = await db.collection('orders')
            .find(_mergeAssignedToScope({ ...botFilter, timestamp: { $gte: sixtyDaysAgo, $lt: thirtyDaysAgo } }, req)).toArray()

        // Product trends from lead interests
        const recentInterests: Record<string, number> = {}
        const prevInterests: Record<string, number> = {}

        recentLeads.forEach((l: any) => {
            (l.analysis?.intereses?.productos || []).forEach((p: string) => {
                recentInterests[p] = (recentInterests[p] || 0) + 1
            })
        })
        prevLeads.forEach((l: any) => {
            (l.analysis?.intereses?.productos || []).forEach((p: string) => {
                prevInterests[p] = (prevInterests[p] || 0) + 1
            })
        })

        // Calculate trends
        const allProducts = new Set([...Object.keys(recentInterests), ...Object.keys(prevInterests)])
        const trends = Array.from(allProducts).map(product => {
            const recent = recentInterests[product] || 0
            const prev = prevInterests[product] || 0
            const change = prev > 0 ? Math.round(((recent - prev) / prev) * 100) : (recent > 0 ? 100 : 0)
            // Find sales for this product
            const productSales = recentOrders.filter((o: any) =>
                (o.items || '').toLowerCase().includes(product.toLowerCase())
            ).length
            const prevProductSales = prevOrders.filter((o: any) =>
                (o.items || '').toLowerCase().includes(product.toLowerCase())
            ).length

            return {
                name: product,
                consultasRecientes: recent,
                consultasPrevias: prev,
                changePct: change,
                ventasRecientes: productSales,
                ventasPrevias: prevProductSales
            }
        }).sort((a, b) => b.consultasRecientes - a.consultasRecientes).slice(0, 8)

        // Occasion predictions
        const occasionCounts: Record<string, number> = {}
        recentLeads.forEach((l: any) => {
            const ocasion = l.analysis?.contexto?.ocasion
            if (ocasion && ocasion !== 'No detectado') {
                occasionCounts[ocasion] = (occasionCounts[ocasion] || 0) + 1
            }
        })
        const topOccasions = Object.entries(occasionCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([name, count]) => ({ name, count }))

        // Inventory alerts: products with high demand but low conversion
        const inventoryAlerts = trends
            .filter(t => t.consultasRecientes > 2 && t.ventasRecientes < t.consultasRecientes * 0.3)
            .map(t => ({
                product: t.name,
                consultas: t.consultasRecientes,
                ventas: t.ventasRecientes,
                alert: `Alta demanda de ${t.name} (${t.consultasRecientes} consultas) pero baja conversión (${t.ventasRecientes} ventas). Revisar disponibilidad o precio.`
            }))

        res.json({ trends, topOccasions, inventoryAlerts })
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

// ==================== MI NEGOCIO HOY (Executive Summary) ====================

router.get('/analytics/negocio-hoy', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const botIdParam = (req.query.botId as string) || ''
        const ownerUserId = resolveOwnerUserId(req)

        const userBots = await db.collection('bot_configs')
            .find({ userId: ownerUserId }).toArray()

        if (userBots.length === 0) {
            return res.json({
                estado: 'sin_bots',
                kpis: { revenue_dia: 0, num_pedidos: 0, ticket_promedio: 0, tasa_conversion: 0 },
                variacion_vs_ayer: { revenue: '0%', pedidos: '0%' },
                alerta_principal: {
                    tipo: 'info',
                    titulo: 'Qhatu en espera',
                    detalle: 'Crea tu primer bot para empezar a recibir datos.',
                    accion: 'Ve a "Crea tu Qhatu" y configura tu primer asistente.'
                }
            })
        }

        const botIds = botIdParam ? [botIdParam] : userBots.map(b => b._id.toString())
        const botFilter = botIdParam ? { botId: botIdParam } : { botId: { $in: botIds } }

        const now = new Date()
        const { startDate: todayStart, endDate: periodEnd, prevStartDate: yesterdayStart } = getAnalyticsDateRange(req.query)

        // ─── TODAY data ─── (scoped por vendedor cuando aplica)
        const todayOrders = await db.collection('orders')
            .find(_mergeAssignedToScope({ ...botFilter, timestamp: { $gte: todayStart, $lt: periodEnd } }, req)).toArray()
        const todayConversations = await db.collection('conversations')
            .countDocuments({ ...botFilter, timestamp: { $gte: todayStart, $lt: periodEnd } })
        const todayLeads = await db.collection('leads')
            .find(_mergeAssignedToScope({ ...botFilter, updatedAt: { $gte: todayStart, $lt: periodEnd } }, req)).toArray()

        // ─── YESTERDAY data ───
        const yesterdayOrders = await db.collection('orders')
            .find(_mergeAssignedToScope({ ...botFilter, timestamp: { $gte: yesterdayStart, $lt: todayStart } }, req)).toArray()
        const yesterdayConversations = await db.collection('conversations')
            .countDocuments({ ...botFilter, timestamp: { $gte: yesterdayStart, $lt: todayStart } })

        // ─── KPIs ───
        const revenue_dia = parseFloat(todayOrders.reduce((sum: number, o: any) =>
            sum + (parseFloat(o.total) || 0), 0).toFixed(2))
        const num_pedidos = todayOrders.length
        const ticket_promedio = num_pedidos > 0
            ? parseFloat((revenue_dia / num_pedidos).toFixed(2))
            : 0
        const tasa_conversion = todayConversations > 0
            ? parseFloat(((num_pedidos / todayConversations) * 100).toFixed(1))
            : 0

        // ─── VARIACIÓN VS AYER ───
        const yesterdayRevenue = yesterdayOrders.reduce((sum: number, o: any) =>
            sum + (parseFloat(o.total) || 0), 0)
        const yesterdayPedidos = yesterdayOrders.length

        const revenueVar = yesterdayRevenue > 0
            ? Math.round(((revenue_dia - yesterdayRevenue) / yesterdayRevenue) * 100)
            : (revenue_dia > 0 ? 100 : 0)
        const pedidosVar = yesterdayPedidos > 0
            ? Math.round(((num_pedidos - yesterdayPedidos) / yesterdayPedidos) * 100)
            : (num_pedidos > 0 ? 100 : 0)

        const fmtVar = (v: number) => v > 0 ? `+${v}%` : `${v}%`

        // ─── ALERTA PRINCIPAL (priority detection) ───
        let alerta_principal: { tipo: string, titulo: string, detalle: string, accion: string }

        if (todayConversations === 0) {
            // No conversations at all
            const horaActual = now.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Lima' })
            alerta_principal = {
                tipo: 'info',
                titulo: 'Qhatu en espera',
                detalle: `Son las ${horaActual} y aún no hay conversaciones. Tu bot está activo y listo.`,
                accion: 'Comparte tu link de WhatsApp o publica en redes para generar tráfico.'
            }
        } else if (revenue_dia === 0 && num_pedidos === 0) {
            // Conversations but no sales
            const topInterest = todayLeads.length > 0
                ? (() => {
                    const interests: Record<string, number> = {}
                    todayLeads.forEach((l: any) => {
                        (l.analysis?.intereses?.productos || []).forEach((p: string) => {
                            interests[p] = (interests[p] || 0) + 1
                        })
                    })
                    const sorted = Object.entries(interests).sort((a, b) => b[1] - a[1])
                    return sorted.length > 0 ? sorted[0][0] : null
                })()
                : null

            alerta_principal = {
                tipo: 'warning',
                titulo: 'Sin ventas aún hoy',
                detalle: `Tienes ${todayConversations} conversaciones pero ninguna venta cerrada.${topInterest ? ` El producto más consultado es "${topInterest}".` : ''}`,
                accion: topInterest
                    ? `Revisa disponibilidad y precio de "${topInterest}" — los clientes lo buscan pero no compran.`
                    : 'Revisa si tu bot tiene precios claros y un flujo de cierre de pedido efectivo.'
            }
        } else {
            // We have sales — find the most impactful alert

            // Priority 1: Trending product without stock / low conversion
            const interestCounts: Record<string, number> = {}
            const salesCounts: Record<string, number> = {}
            todayLeads.forEach((l: any) => {
                (l.analysis?.intereses?.productos || []).forEach((p: string) => {
                    interestCounts[p] = (interestCounts[p] || 0) + 1
                })
            })
            todayOrders.forEach((o: any) => {
                const item = o.items || ''
                if (item) salesCounts[item] = (salesCounts[item] || 0) + 1
            })

            let trendingNoStock: string | null = null
            for (const [product, queries] of Object.entries(interestCounts).sort((a, b) => b[1] - a[1])) {
                if (queries >= 3 && (!salesCounts[product] || salesCounts[product] < queries * 0.2)) {
                    trendingNoStock = product
                    break
                }
            }

            // Priority 2: VIP customer at risk (returning customer who chatted but didn't buy today)
            const previousCustomers = await db.collection('orders')
                .distinct('from', { ...botFilter, timestamp: { $lt: todayStart } })
            const todayChatters = await db.collection('conversations')
                .distinct('from', { ...botFilter, timestamp: { $gte: todayStart } })
            const vipAtRisk = todayChatters.filter((c: string) =>
                previousCustomers.includes(c) && !todayOrders.some((o: any) => o.from === c)
            )

            // Priority 3: Dominant no-buy reason
            const frictionCounts: Record<string, number> = {}
            todayLeads.forEach((l: any) => {
                (l.analysis?.frictions?.objeciones || []).forEach((f: string) => {
                    frictionCounts[f] = (frictionCounts[f] || 0) + 1
                })
            })
            const topFriction = Object.entries(frictionCounts).sort((a, b) => b[1] - a[1])[0]

            // Priority 4: Funnel bottleneck
            const hotLeads = todayLeads.filter((l: any) => (l.analysis?.scores?.conversion || 0) > 70).length
            const funnelBottleneck = hotLeads > 3 && num_pedidos < hotLeads * 0.5

            if (trendingNoStock) {
                const queries = interestCounts[trendingNoStock]
                const sales = salesCounts[trendingNoStock] || 0
                alerta_principal = {
                    tipo: 'danger',
                    titulo: `"${trendingNoStock}" tiene alta demanda pero baja conversión`,
                    detalle: `${queries} consultas hoy pero solo ${sales} ventas. Posible problema de stock o precio.`,
                    accion: `Verifica stock y precio de "${trendingNoStock}". Si está agotado, desactívalo para evitar frustración.`
                }
            } else if (vipAtRisk.length > 0) {
                alerta_principal = {
                    tipo: 'warning',
                    titulo: `${vipAtRisk.length} cliente${vipAtRisk.length > 1 ? 's' : ''} VIP escribi${vipAtRisk.length > 1 ? 'eron' : 'ó'} sin comprar`,
                    detalle: `Clientes que ya compraron antes consultaron hoy pero no cerraron venta.`,
                    accion: 'Revisa sus conversaciones y envía un mensaje personalizado para recuperarlos.'
                }
            } else if (topFriction && topFriction[1] >= 2) {
                alerta_principal = {
                    tipo: 'warning',
                    titulo: `Motivo de no-compra dominante: "${topFriction[0]}"`,
                    detalle: `${topFriction[1]} clientes mencionaron esta objeción hoy.`,
                    accion: `Ajusta tu pitch o precio para abordar "${topFriction[0]}" directamente.`
                }
            } else if (funnelBottleneck) {
                alerta_principal = {
                    tipo: 'warning',
                    titulo: `${hotLeads} leads calientes no cerraron`,
                    detalle: `Tienes leads con alta intención de compra que no completaron el pedido.`,
                    accion: 'Revisa si el flujo de cierre del bot es claro. Considera agregar una promoción express.'
                }
            } else {
                // All good — positive alert
                const emoji = revenue_dia > yesterdayRevenue ? '🚀' : '✅'
                alerta_principal = {
                    tipo: 'info',
                    titulo: `${emoji} Día en marcha: ${num_pedidos} venta${num_pedidos > 1 ? 's' : ''} cerrada${num_pedidos > 1 ? 's' : ''}`,
                    detalle: `Revenue S/${revenue_dia.toFixed(2)} con ticket promedio S/${ticket_promedio.toFixed(2)}.`,
                    accion: revenue_dia > yesterdayRevenue
                        ? '¡Vas mejor que ayer! Mantén el ritmo.'
                        : 'Sigue respondiendo rápido — cada conversación cuenta.'
                }
            }
        }

        // Determine estado
        let estado = 'activo'
        if (todayConversations === 0) estado = 'en_espera'
        else if (num_pedidos === 0) estado = 'sin_ventas'

        res.json({
            estado,
            kpis: {
                revenue_dia,
                num_pedidos,
                ticket_promedio,
                tasa_conversion
            },
            variacion_vs_ayer: {
                revenue: fmtVar(revenueVar),
                pedidos: fmtVar(pedidosVar)
            },
            alerta_principal,
            meta: {
                conversaciones_hoy: todayConversations,
                leads_hoy: todayLeads.length,
                hora_consulta: now.toISOString()
            }
        })
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

// ==================== VENTAS Y RENTABILIDAD ====================

router.get('/analytics/ventas-rentabilidad', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const botIdParam = (req.query.botId as string) || ''
        const periodo = (req.query.periodo as string) || 'semana' // dia|semana|mes
        const ownerUserId = resolveOwnerUserId(req)

        const userBots = await db.collection('bot_configs')
            .find({ userId: ownerUserId }).toArray()

        if (userBots.length === 0) {
            return res.json({
                periodo_activo: periodo,
                kpis: {
                    revenue_total: { valor: 0, variacion: '0%' },
                    num_pedidos: { valor: 0, variacion: '0%' },
                    ticket_promedio: { valor: 0, variacion: '—' },
                    revenue_x_conversacion: { valor: 0, variacion: '0%' }
                },
                serie_temporal: [],
                dia_pico: null,
                dashboard: null
            })
        }

        const botIds = botIdParam ? [botIdParam] : userBots.map(b => b._id.toString())
        const botFilter = botIdParam ? { botId: botIdParam } : { botId: { $in: botIds } }

        const now = new Date()
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())

        // Calculate period boundaries
        let periodStart: Date, prevPeriodStart: Date, prevPeriodEnd: Date, chartDays: number

        if (periodo === 'dia') {
            periodStart = todayStart
            prevPeriodStart = new Date(todayStart)
            prevPeriodStart.setDate(prevPeriodStart.getDate() - 1)
            prevPeriodEnd = todayStart
            chartDays = 7
        } else if (periodo === 'mes') {
            periodStart = new Date(now.getFullYear(), now.getMonth(), 1)
            prevPeriodStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
            prevPeriodEnd = periodStart
            chartDays = 30
        } else {
            // semana (default)
            const dayOfWeek = now.getDay()
            periodStart = new Date(todayStart)
            periodStart.setDate(periodStart.getDate() - dayOfWeek)
            prevPeriodStart = new Date(periodStart)
            prevPeriodStart.setDate(prevPeriodStart.getDate() - 7)
            prevPeriodEnd = periodStart
            chartDays = 7
        }

        // ─── CURRENT period data ─── (orders scoped por vendedor)
        const currentOrders = await db.collection('orders')
            .find(_mergeAssignedToScope({ ...botFilter, timestamp: { $gte: periodStart } }, req)).toArray()
        const currentConversations = await db.collection('conversations')
            .countDocuments({ ...botFilter, timestamp: { $gte: periodStart } })

        // ─── PREVIOUS period data ───
        const prevOrders = await db.collection('orders')
            .find(_mergeAssignedToScope({ ...botFilter, timestamp: { $gte: prevPeriodStart, $lt: prevPeriodEnd } }, req)).toArray()
        const prevConversations = await db.collection('conversations')
            .countDocuments({ ...botFilter, timestamp: { $gte: prevPeriodStart, $lt: prevPeriodEnd } })

        // ─── KPI calculations ───
        const revenue_total = parseFloat(currentOrders.reduce((sum: number, o: any) =>
            sum + (parseFloat(o.total) || 0), 0).toFixed(2))
        const num_pedidos = currentOrders.length
        const ticket_promedio = num_pedidos > 0
            ? parseFloat((revenue_total / num_pedidos).toFixed(2))
            : 0
        const revenue_x_conv = currentConversations > 0
            ? parseFloat((revenue_total / currentConversations).toFixed(2))
            : 0

        // Previous period KPIs for comparison
        const prevRevenue = prevOrders.reduce((sum: number, o: any) =>
            sum + (parseFloat(o.total) || 0), 0)
        const prevPedidos = prevOrders.length
        const prevTicket = prevPedidos > 0 ? prevRevenue / prevPedidos : 0
        const prevRevConv = prevConversations > 0 ? prevRevenue / prevConversations : 0

        const calcVar = (curr: number, prev: number): string => {
            if (prev === 0 && curr === 0) return '0%'
            if (prev === 0) return curr > 0 ? '+100%' : '0%'
            const pct = Math.round(((curr - prev) / prev) * 100)
            return pct > 0 ? `+${pct}%` : `${pct}%`
        }

        // ─── TIME SERIES ───
        const serie_temporal: { fecha: string, revenue: number }[] = []
        let dia_pico: { fecha: string, revenue: number } | null = null

        for (let i = chartDays - 1; i >= 0; i--) {
            const dayStart = new Date(todayStart)
            dayStart.setDate(dayStart.getDate() - i)
            const dayEnd = new Date(dayStart)
            dayEnd.setDate(dayEnd.getDate() + 1)

            const dayRevenue = parseFloat(
                currentOrders
                    .concat(i >= (chartDays - Math.ceil((now.getTime() - periodStart.getTime()) / 86400000))
                        ? [] : []) // include all orders for chart range
                    .filter((o: any) => {
                        const d = new Date(o.timestamp)
                        return d >= dayStart && d < dayEnd
                    })
                    .reduce((sum: number, o: any) => sum + (parseFloat(o.total) || 0), 0)
                    .toFixed(2)
            )

            // For chart, query all orders in the chart range (not just period)
            const allDayOrders = await db.collection('orders')
                .find({ ...botFilter, timestamp: { $gte: dayStart, $lt: dayEnd } }).toArray()
            const allDayRevenue = parseFloat(
                allDayOrders.reduce((sum: number, o: any) => sum + (parseFloat(o.total) || 0), 0).toFixed(2)
            )

            const fechaStr = dayStart.toISOString().split('T')[0]
            serie_temporal.push({ fecha: fechaStr, revenue: allDayRevenue })

            if (!dia_pico || allDayRevenue > dia_pico.revenue) {
                dia_pico = { fecha: fechaStr, revenue: allDayRevenue }
            }
        }

        // If peak is 0, set to null
        if (dia_pico && dia_pico.revenue === 0) dia_pico = null

        // ─── Dashboard Ventas Analytics (UI enriquecida) ───
        const vista = (req.query.vista as string) || 'semanal'
        const startOfWeekSunday = (base: Date) => {
            const t = new Date(base.getFullYear(), base.getMonth(), base.getDate())
            const dow = t.getDay()
            t.setDate(t.getDate() - dow)
            t.setHours(0, 0, 0, 0)
            return t
        }
        const inRange = (o: any, start: Date, end: Date) => {
            const d = new Date(o.timestamp).getTime()
            return d >= start.getTime() && d < end.getTime()
        }
        const sumRev = (list: any[], start: Date, end: Date) => parseFloat(
            list.filter((o) => inRange(o, start, end))
                .reduce((s: number, o: any) => s + (parseFloat(o.total) || 0), 0)
                .toFixed(2)
        )

        const eightWeeksAgo = new Date(todayStart)
        eightWeeksAgo.setDate(eightWeeksAgo.getDate() - 56)
        const ordersDash = await db.collection('orders')
            .find(
                { ...botFilter, timestamp: { $gte: eightWeeksAgo } },
                { projection: { timestamp: 1, total: 1, items: 1, customerName: 1, customerPhone: 1, phone: 1, status: 1 } }
            )
            .toArray()

        const curWeekStart = startOfWeekSunday(now)
        const curWeekEnd = new Date(curWeekStart)
        curWeekEnd.setDate(curWeekEnd.getDate() + 7)
        const prevWeekStart = new Date(curWeekStart)
        prevWeekStart.setDate(prevWeekStart.getDate() - 7)
        const prevWeekEnd = new Date(curWeekStart)

        const semanaActual = sumRev(ordersDash, curWeekStart, curWeekEnd)
        const semanaPasada = sumRev(ordersDash, prevWeekStart, prevWeekEnd)
        const varSemPct = semanaPasada > 0
            ? Math.round(((semanaActual - semanaPasada) / semanaPasada) * 100)
            : (semanaActual > 0 ? 100 : 0)

        let ultimaMs: number | null = null
        ordersDash.forEach((o: any) => {
            const t = new Date(o.timestamp).getTime()
            if (!ultimaMs || t > ultimaMs) ultimaMs = t
        })
        const ultimaRel = ultimaMs
            ? (() => {
                const mins = Math.floor((Date.now() - ultimaMs) / 60000)
                if (mins < 1) return 'hace instantes'
                if (mins < 60) return `hace ${mins} min`
                const hrs = Math.floor(mins / 60)
                if (hrs < 24) return `hace ${hrs} h`
                return `hace ${Math.floor(hrs / 24)} d`
            })()
            : null

        let botDoc: any = null
        if (botIdParam) {
            try {
                botDoc = await db.collection('bot_configs').findOne({ _id: new ObjectId(botIdParam), userId: req.userId })
            } catch {
                botDoc = null
            }
        }
        const botNombre = botDoc ? (botDoc.name || botDoc.botName || 'Tu bot') : (userBots[0] ? (userBots[0].name || userBots[0].botName || 'Tu bot') : 'Tu bot')

        const monthStartDash = new Date(now.getFullYear(), now.getMonth(), 1)
        const monthEndDash = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
        const diasMes = monthEndDash.getDate()
        const diaHoy = now.getDate()
        const diasRestantes = Math.max(0, diasMes - diaHoy)
        const monthEndOpen = new Date(now.getFullYear(), now.getMonth() + 1, 1)
        const monthOrdersDash = ordersDash.filter((o) => inRange(o, monthStartDash, monthEndOpen))
        const acumMes = parseFloat(monthOrdersDash.reduce((s: number, o: any) => s + (parseFloat(o.total) || 0), 0).toFixed(2))
        const metaCfg = botDoc?.advancedConfig?.level2?.metaMensual
            ? parseFloat(String(botDoc.advancedConfig.level2.metaMensual)) || 0
            : 0
        const mesNombre = now.toLocaleDateString('es-PE', { month: 'long' })
        const proyeccionMes = diaHoy > 0 ? Math.round((acumMes / diaHoy) * diasMes) : 0
        let insightMeta = 'Configura una meta mensual en el bot (avanzado) para ver proyección.'
        if (metaCfg > 0) {
            const pctM = Math.round((acumMes / metaCfg) * 100)
            if (pctM >= 85) insightMeta = 'Vas bien. Refuerza fin de semana para cerrar el mes fuerte.'
            else if (pctM >= 50) insightMeta = 'Ritmo aceptable — empuja conversiones en horario pico.'
            else insightMeta = 'Vas debajo de meta — revisa follow-up y carrito abandonado.'
        } else if (acumMes > 0) {
            insightMeta = 'Sin meta fijada: usa el ritmo del mes pasado como referencia.'
        }

        const pedidosSemana = ordersDash.filter((o) => inRange(o, curWeekStart, curWeekEnd)).length
        const pedidosCompletadosSemana = ordersDash.filter((o) =>
            inRange(o, curWeekStart, curWeekEnd) && String(o.status || '').toLowerCase() === 'completado'
        ).length

        const prodMap = new Map<string, { u: number, r: number }>()
        ordersDash.filter((o) => inRange(o, curWeekStart, curWeekEnd)).forEach((o: any) => {
            const key = (o.items && String(o.items).trim()) ? String(o.items).trim().slice(0, 80) : 'Otros'
            const row = prodMap.get(key) || { u: 0, r: 0 }
            row.u += 1
            row.r += parseFloat(o.total) || 0
            prodMap.set(key, row)
        })
        const productosTop = [...prodMap.entries()]
            .sort((a, b) => b[1].r - a[1].r)
            .slice(0, 5)
            .map(([nombre, v]) => ({ nombre, unidades: v.u, revenue: Math.round(v.r * 100) / 100 }))

        const cliMap = new Map<string, { name: string, n: number, r: number }>()
        ordersDash.filter((o) => inRange(o, monthStartDash, monthEndOpen)).forEach((o: any) => {
            const phone = String(o.customerPhone || o.phone || '').split('@')[0] || 'anon'
            const name = (o.customerName && String(o.customerName).trim()) || 'Cliente'
            const row = cliMap.get(phone) || { name, n: 0, r: 0 }
            row.n += 1
            row.r += parseFloat(o.total) || 0
            if (name && name !== 'Cliente') row.name = name
            cliMap.set(phone, row)
        })
        const clientesTop = [...cliMap.entries()]
            .sort((a, b) => b[1].r - a[1].r)
            .slice(0, 5)
            .map(([_, v]) => ({
                nombre: v.name,
                compras: v.n,
                total: Math.round(v.r * 100) / 100,
                etiqueta: v.n >= 2 ? 'repetidor' : 'nuevo'
            }))

        // Histórico según vista
        const histLabels: string[] = []
        const histValues: number[] = []
        const histSubLabels: string[] = []
        if (vista === 'mensual') {
            for (let i = 5; i >= 0; i--) {
                const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
                const end = new Date(d.getFullYear(), d.getMonth() + 1, 1)
                histLabels.push(d.toLocaleDateString('es-PE', { month: 'short' }))
                histSubLabels.push(d.toLocaleDateString('es-PE', { year: '2-digit' }))
                histValues.push(sumRev(ordersDash, d, end))
            }
        } else if (vista === 'anual') {
            for (let i = 3; i >= 0; i--) {
                const y = now.getFullYear() - i
                const d = new Date(y, 0, 1)
                const end = new Date(y + 1, 0, 1)
                histLabels.push(String(y))
                histSubLabels.push('anual')
                histValues.push(sumRev(ordersDash, d, end))
            }
        } else {
            for (let i = 7; i >= 0; i--) {
                const ref = new Date(curWeekStart)
                ref.setDate(ref.getDate() - i * 7)
                const wkS = startOfWeekSunday(ref)
                const wkE = new Date(wkS)
                wkE.setDate(wkE.getDate() + 7)
                const idx = 8 - i
                histLabels.push(`S${idx}`)
                histSubLabels.push(wkS.toLocaleDateString('es-PE', { day: '2-digit', month: 'short' }))
                histValues.push(sumRev(ordersDash, wkS, wkE))
            }
        }
        const histTotal = parseFloat(histValues.reduce((a, b) => a + b, 0).toFixed(2))
        const histProm = histValues.length ? histTotal / histValues.length : 0
        const mejorIdx = histValues.length ? histValues.reduce((bestI, v, i, arr) => (v > arr[bestI] ? i : bestI), 0) : 0

        const dashboard = {
            bot_nombre: botNombre,
            semana: {
                total: semanaActual,
                prev_total: semanaPasada,
                variacion_pct: varSemPct,
                ultima_venta: ultimaRel,
                badge: varSemPct > 0 ? `+${varSemPct}%` : `${varSemPct}%`
            },
            meta_mes: metaCfg > 0 ? {
                mes_label: mesNombre.charAt(0).toUpperCase() + mesNombre.slice(1),
                meta: metaCfg,
                actual: acumMes,
                dias_restantes: diasRestantes,
                proyeccion: proyeccionMes,
                insight: insightMeta,
                pct: Math.min(100, Math.round((acumMes / metaCfg) * 100))
            } : {
                mes_label: mesNombre.charAt(0).toUpperCase() + mesNombre.slice(1),
                meta: 0,
                actual: acumMes,
                dias_restantes: diasRestantes,
                proyeccion: proyeccionMes,
                insight: insightMeta,
                pct: 0
            },
            agente: {
                nombre: botNombre,
                cerradas: pedidosCompletadosSemana,
                total: pedidosSemana
            },
            productos: productosTop,
            clientes: clientesTop,
            historico: {
                vista,
                labels: histLabels,
                sub_labels: histSubLabels,
                values: histValues,
                promedio: Math.round(histProm * 100) / 100,
                total: histTotal,
                mejor_idx: mejorIdx,
                esta_semana: semanaActual,
                variacion_vs_prev: varSemPct
            }
        }

        res.json({
            periodo_activo: periodo,
            kpis: {
                revenue_total: { valor: revenue_total, variacion: calcVar(revenue_total, prevRevenue) },
                num_pedidos: { valor: num_pedidos, variacion: calcVar(num_pedidos, prevPedidos) },
                ticket_promedio: {
                    valor: ticket_promedio,
                    variacion: num_pedidos === 0 ? '—' : calcVar(ticket_promedio, prevTicket)
                },
                revenue_x_conversacion: {
                    valor: revenue_x_conv,
                    variacion: currentConversations === 0 ? '—' : calcVar(revenue_x_conv, prevRevConv)
                }
            },
            serie_temporal,
            dia_pico,
            dashboard
        })
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

// ==================== RECLAMOS (Analytics tab — leads post-venta abiertos) ====================
router.get('/analytics/reclamos', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const botIdParam = (req.query.botId as string) || ''
        const ownerUserId = resolveOwnerUserId(req)
        const userBots = await db.collection('bot_configs').find({ userId: ownerUserId }).toArray()
        if (userBots.length === 0) {
            return res.json({
                resumen: { abiertos: 0, urgentes: 0, resueltos_hoy: 0 },
                reclamos: []
            })
        }
        const botIds = botIdParam ? [botIdParam] : userBots.map(b => b._id.toString())
        if (botIdParam) {
            const ok = userBots.some(b => b._id.toString() === botIdParam)
            if (!ok) return res.status(403).json({ error: 'Bot no autorizado' })
        }
        const botFilter = botIdParam ? { botId: botIdParam } : { botId: { $in: botIds } }

        const since = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000)
        const raw = await db.collection('leads').find(_mergeAssignedToScope({
            ...botFilter,
            estado_clasificacion: { $in: ['post_venta_operativa', 'post_venta_soporte'] },
            updatedAt: { $gte: since }
        }, req)).sort({ updatedAt: -1 }).limit(250).toArray()

        const leads = raw.filter((l: any) => l?.deleted !== true && l?.archived !== true)

        const startOfToday = new Date()
        startOfToday.setHours(0, 0, 0, 0)

        const isResuelto = (l: any) =>
            l?.analysis?.bot_performance?.containment === true
            || String(l?.estado || '').toLowerCase() === 'resuelto'

        const tipoLabel = (l: any): string => {
            const t = String(l.tipo_caso || l.tipoCaso || '')
            const map: Record<string, string> = {
                solicitud_devolucion: 'Devolución',
                solicitud_cambio: 'Cambio de producto',
                reclamo_calidad: 'Sabor / calidad',
                problema_envio: 'Retraso entrega',
                producto_danado: 'Producto dañado',
                reclamo: 'Reclamo'
            }
            if (map[t]) return map[t]
            const sub = l.datos_extraidos?.subcategoria_problema || l.motivoEscalacion || l.motivo_escalacion
            if (sub && String(sub).trim()) return String(sub).trim().slice(0, 80)
            if (t) return t.replace(/_/g, ' ')
            return 'Post-venta'
        }

        const relTime = (d: Date | string | null | undefined): string => {
            if (!d) return '—'
            const ms = Date.now() - new Date(d).getTime()
            if (ms < 0) return 'ahora'
            const mins = Math.floor(ms / 60000)
            if (mins < 1) return 'hace instantes'
            if (mins < 60) return `hace ${mins} min`
            const hrs = Math.floor(mins / 60)
            if (hrs < 24) return `hace ${hrs}h`
            const days = Math.floor(hrs / 24)
            if (days < 7) return `hace ${days}d`
            return `hace ${Math.floor(days / 7)} sem`
        }

        const orderIds = [...new Set(
            leads.map((l: any) => l.order_id || l.orderId || l.datos_extraidos?.order_id).filter(Boolean).map(String)
        )]
        const orderTotals: Record<string, number> = {}
        if (orderIds.length > 0) {
            const oids: ObjectId[] = []
            for (const id of orderIds) {
                try { oids.push(new ObjectId(id)) } catch { /* skip invalid */ }
            }
            if (oids.length > 0) {
                const orders = await db.collection('orders').find(
                    { _id: { $in: oids } },
                    { projection: { total: 1 } }
                ).toArray()
                orders.forEach((o: any) => {
                    orderTotals[o._id.toString()] = parseFloat(o.total) || 0
                })
            }
        }

        const sugerenciaIA = (nombre: string, tipo: string): string => {
            const n = nombre.split(/\s+/)[0] || 'cliente'
            if (/dañ|rot|mal estado|aplastic/i.test(tipo)) {
                return `Hola ${n}, lamentamos mucho el estado en que llegó tu pedido. No es el estándar que mereces. Queremos resolverlo hoy: podemos enviarte un reemplazo sin costo o un reembolso parcial — ¿cuál prefieres? Gracias por avisarnos.`
            }
            if (/retras|tarde|demor/i.test(tipo)) {
                return `Hola ${n}, te pedimos disculpas por el retraso en la entrega. Entendemos que afectó tus planes. Queremos compensarte con un descuento en tu próximo pedido o prioridad express sin costo — te parece bien que coordinemos con logística?`
            }
            if (/sabor|calidad/i.test(tipo)) {
                return `Hola ${n}, gracias por tu feedback sobre el producto. Nos importa que quedes conforme. ¿Podemos ofrecerte un reemplazo o un vale para tu próxima compra? Quedamos atentos a tu respuesta.`
            }
            return `Hola ${n}, gracias por contactarnos. Lamentamos las molestias y queremos dejarlo resuelto cuanto antes. ¿Podemos llamarte o escribirte por este mismo canal para coordinar la mejor solución para ti?`
        }

        const reclamos = leads.filter((l: any) => !isResuelto(l)).map((l: any) => {
            const phoneClean = (l.from || l.phone || '').split('@')[0] || ''
            const contactName = l.contactName || l.contact_name
                || l.datos_extraidos?.nombre_contacto
                || phoneClean
                || 'Cliente'
            const oid = l.order_id || l.orderId || l.datos_extraidos?.order_id
            const monto = oid ? (orderTotals[String(oid)] || 0) : (parseFloat(l.valor_potencial) || 0)
            const urg = (l.datos_extraidos?.nivel_urgencia || l.analysis?.datos_extraidos?.nivel_urgencia) === 'alta'
            let estado: 'urgente' | 'en_revision' | 'nuevo' = 'nuevo'
            let estado_label = 'Nuevo'
            if (urg) {
                estado = 'urgente'
                estado_label = 'Urgente'
            } else if (l.estado_clasificacion === 'post_venta_soporte') {
                estado = 'en_revision'
                estado_label = 'En revisión'
            }
            const tipo = tipoLabel(l)
            const mensaje = String(
                l.post_venta?.ultimo_mensaje_cliente
                || l.datos_extraidos?.descripcion_problema
                || l.motivoQueja
                || l.motivo_escalacion
                || l.motivoEscalacion
                || l.datos_extraidos?.subcategoria_problema
                || 'El cliente describió un inconveniente con su pedido; revisa el hilo en CRM para el detalle completo.'
            ).trim().slice(0, 1200)

            const shortId = String(l._id || '').slice(-4).toUpperCase()
            return {
                id: l._id.toString(),
                codigo: `#RC-${shortId}`,
                cliente: contactName,
                iniciales: contactName.split(/\s+/).filter(Boolean).map((w: string) => w[0]).join('').slice(0, 2).toUpperCase() || 'CL',
                tipo,
                estado,
                estado_label,
                tiempo: relTime(l.updatedAt || l.createdAt),
                monto_pedido: Math.round(monto * 100) / 100,
                mensaje,
                respuesta_sugerida: sugerenciaIA(contactName, tipo),
                botId: l.botId
            }
        })

        const resueltosHoy = leads.filter((l: any) => isResuelto(l) && new Date(l.updatedAt || l.createdAt) >= startOfToday).length

        res.json({
            resumen: {
                abiertos: reclamos.length,
                urgentes: reclamos.filter((r: any) => r.estado === 'urgente').length,
                resueltos_hoy: resueltosHoy
            },
            reclamos
        })
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

// ==================== REVENUE EVOLUTION ANALYSIS (AN-04 — doc sec 7.2) ====================
router.get('/analytics/revenue-evolution/:botId', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const botId = req.params.botId as string
        const days = parseInt(req.query.days as string) || 30

        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
        const orders = await db.collection('orders').find(_mergeAssignedToScope({
            botId, timestamp: { $gte: since }, status: { $nin: ['cancelado'] }
        }, req)).sort({ timestamp: 1 }).toArray()

        // Group by day
        const dailyRevenue: Record<string, number> = {}
        orders.forEach((o: any) => {
            const day = new Date(o.timestamp).toISOString().split('T')[0]
            dailyRevenue[day] = (dailyRevenue[day] || 0) + (parseFloat(o.total) || 0)
        })

        const series = Object.entries(dailyRevenue).map(([date, revenue]) => ({ date, revenue }))
        const totalRevenue = series.reduce((sum, s) => sum + s.revenue, 0)
        const avgDaily = series.length > 0 ? totalRevenue / series.length : 0

        // Calculate trend (simple: compare first half vs second half)
        const midpoint = Math.floor(series.length / 2)
        const firstHalf = series.slice(0, midpoint).reduce((s, d) => s + d.revenue, 0)
        const secondHalf = series.slice(midpoint).reduce((s, d) => s + d.revenue, 0)
        const trend = firstHalf > 0 ? ((secondHalf - firstHalf) / firstHalf * 100).toFixed(1) : '0'

        res.json({
            periodo: `${days} días`,
            total_revenue: totalRevenue,
            promedio_diario: Math.round(avgDaily * 100) / 100,
            tendencia: `${parseFloat(trend) >= 0 ? '+' : ''}${trend}%`,
            serie: series,
            resumen: parseFloat(trend) >= 0
                ? `El revenue muestra tendencia positiva (+${trend}%) en los últimos ${days} días. Promedio diario: S/${avgDaily.toFixed(2)}.`
                : `El revenue muestra tendencia negativa (${trend}%) en los últimos ${days} días. Promedio diario: S/${avgDaily.toFixed(2)}.`
        })
    } catch (err: any) {
        res.status(500).json({ error: err.message })
    }
})

// ==================== EMBUDO Y CONVERSIÓN ====================

router.get('/analytics/embudo-conversion', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const botIdParam = (req.query.botId as string) || ''
        const ownerUserId = resolveOwnerUserId(req)

        const userBots = await db.collection('bot_configs')
            .find({ userId: ownerUserId }).toArray()

        if (userBots.length === 0) {
            return res.json({
                embudo: {
                    exploracion: { cantidad: 0, tasa: '0%' },
                    interes: { cantidad: 0, tasa: '0%' },
                    intencion: { cantidad: 0, tasa: '0%' },
                    venta_cerrada: { cantidad: 0, tasa: '0%' }
                },
                cuello_botella: null,
                mensajes_promedio_para_cerrar: 0,
                motivos_no_compra: [],
                revenue_perdido_total: 0,
                muestra_pequena: true
            })
        }

        const botIds = botIdParam ? [botIdParam] : userBots.map(b => b._id.toString())
        const botFilter = botIdParam ? { botId: botIdParam } : { botId: { $in: botIds } }

        const now = new Date()
        const { startDate, endDate, days } = getAnalyticsDateRange(req.query)

        // ─── Raw data ─── (leads/orders scoped por vendedor; conversations
        // no tiene assigned_to, así que se cuenta como total del bot).
        const conversations = await db.collection('conversations')
            .find({ ...botFilter, timestamp: { $gte: startDate, $lt: endDate } }).toArray()
        const leads = await db.collection('leads')
            .find(_mergeAssignedToScope({ ...botFilter, updatedAt: { $gte: startDate, $lt: endDate } }, req)).toArray()
        const orders = await db.collection('orders')
            .find(_mergeAssignedToScope({ ...botFilter, timestamp: { $gte: startDate, $lt: endDate } }, req)).toArray()

        const totalConvos = conversations.length
        const muestra_pequena = totalConvos < 20

        // ─── FUNNEL: 4 stages (use AI etapa_embudo or fallback to score-based) ───
        // Stage 1: Exploración (all conversations)
        const exploracion = totalConvos

        // Stage 2: Interés (leads classified as interés+ by AI)
        const interes = leads.filter((l: any) => {
            if (l.analysis?.etapa_embudo) {
                return ['interes', 'intencion', 'venta_cerrada'].includes(l.analysis.etapa_embudo)
            }
            return (l.analysis?.intereses?.productos || []).length > 0 ||
                (l.analysis?.scores?.conversion || 0) > 20
        }).length

        // Stage 3: Intención (leads classified as intención+ by AI)
        const intencion = leads.filter((l: any) => {
            if (l.analysis?.etapa_embudo) {
                return ['intencion', 'venta_cerrada'].includes(l.analysis.etapa_embudo)
            }
            return (l.analysis?.scores?.conversion || 0) > 50
        }).length

        // Stage 4: Venta cerrada
        const venta_cerrada = orders.length

        const pct = (n: number, total: number) => total > 0 ? `${Math.round((n / total) * 100)}%` : '0%'

        const embudo = {
            exploracion: { cantidad: exploracion, tasa: '100%' },
            interes: { cantidad: interes, tasa: pct(interes, exploracion) },
            intencion: { cantidad: intencion, tasa: pct(intencion, exploracion) },
            venta_cerrada: { cantidad: venta_cerrada, tasa: pct(venta_cerrada, exploracion) }
        }

        // ─── CUELLO DE BOTELLA ───
        const drops = [
            { etapa: 'exploracion_a_interes', drop: exploracion - interes, from: 'exploración', to: 'interés' },
            { etapa: 'interes_a_intencion', drop: interes - intencion, from: 'interés', to: 'intención' },
            { etapa: 'intencion_a_venta', drop: intencion - venta_cerrada, from: 'intención', to: 'venta cerrada' }
        ]
        const biggestDrop = drops.sort((a, b) => b.drop - a.drop)[0]

        const recomendaciones: Record<string, string> = {
            'exploracion_a_interes': 'Tu bot necesita enganchar más rápido — muestra productos destacados en el primer mensaje.',
            'interes_a_intencion': 'Los clientes preguntan pero no piden precio — automatiza ofertas cuando detectes interés.',
            'intencion_a_venta': 'Tienes compradores que no cierran — simplifica el proceso de pago y confirma disponibilidad al instante.'
        }

        const cuello_botella = totalConvos > 0 ? {
            etapa: biggestDrop.etapa,
            drop_cantidad: biggestDrop.drop,
            drop_porcentaje: pct(biggestDrop.drop, exploracion),
            recomendacion: recomendaciones[biggestDrop.etapa] || 'Revisa el flujo de conversación de tu bot.'
        } : null

        // ─── MENSAJES PROMEDIO PARA CERRAR ───
        let mensajes_promedio = 0
        if (orders.length > 0) {
            const orderFroms = orders.map((o: any) => o.from)
            const closedConvos = conversations.filter((c: any) => orderFroms.includes(c.from))
            if (closedConvos.length > 0) {
                const totalMsgs = closedConvos.reduce((sum: number, c: any) =>
                    sum + (c.messageCount || c.messages?.length || 5), 0)
                mensajes_promedio = Math.round(totalMsgs / closedConvos.length)
            }
        }

        // ─── MOTIVOS DE NO-COMPRA ───
        const motivoKeywords: Record<string, string[]> = {
            'precio_alto': ['caro', 'precio', 'costoso', 'barato', 'descuento', 'presupuesto', 'muy caro'],
            'producto_no_disponible': ['no hay', 'agotado', 'sin stock', 'no tienen', 'no disponible'],
            'solo_explorando': ['solo veo', 'después', 'luego', 'solo pregunto', 'estoy viendo', 'consultando'],
            'overwhelm_opciones': ['muchas opciones', 'no sé cuál', 'confuso', 'indeciso', 'tantas'],
            'desconfianza': ['seguro', 'estafa', 'confiable', 'garantía', 'real', 'verdad'],
            'logistica_envio': ['envío', 'delivery', 'demora', 'llegar', 'despacho', 'recoger'],
            'metodo_pago': ['pago', 'yape', 'plin', 'tarjeta', 'transferencia', 'efectivo', 'cómo pago']
        }

        const motivoCounts: Record<string, number> = {}
        Object.keys(motivoKeywords).forEach(k => { motivoCounts[k] = 0 })

        // Analyze frictions from leads — prefer structured objeciones, fallback to keyword matching
        leads.forEach((l: any) => {
            const objeciones = l.analysis?.frictions?.objeciones || []

            // Direct match with standardized keys (from new AI analysis)
            let matched = false
            for (const obj of objeciones) {
                const key = obj.toLowerCase().replace(/\s+/g, '_')
                if (motivoCounts[key] !== undefined) {
                    motivoCounts[key]++
                    matched = true
                }
            }

            // Fallback: keyword-based analysis for older leads
            if (!matched) {
                const tags = l.analysis?.tags || []
                const allText = [...objeciones, ...tags].join(' ').toLowerCase()
                for (const [motivo, keywords] of Object.entries(motivoKeywords)) {
                    if (keywords.some(kw => allText.includes(kw))) {
                        motivoCounts[motivo]++
                    }
                }
            }
        })

        // Non-buying conversations (convos without orders)
        const buyerFroms = new Set(orders.map((o: any) => o.from))
        const nonBuyerLeads = leads.filter((l: any) => !buyerFroms.has(l.from))

        // Calculate ticket promedio for revenue perdido
        const totalRevenue = orders.reduce((sum: number, o: any) => sum + (parseFloat(o.total) || 0), 0)
        const ticketPromedio = orders.length > 0 ? totalRevenue / orders.length : 0

        const totalAbandons = Object.values(motivoCounts).reduce((a, b) => a + b, 0) || 1

        const motivos_no_compra = Object.entries(motivoCounts)
            .map(([motivo, frecuencia]) => ({
                motivo,
                frecuencia,
                porcentaje: `${Math.round((frecuencia / totalAbandons) * 100)}%`,
                revenue_perdido: parseFloat((frecuencia * ticketPromedio).toFixed(2))
            }))
            .sort((a, b) => b.frecuencia - a.frecuencia)

        const revenue_perdido_total = parseFloat(
            motivos_no_compra.reduce((sum, m) => sum + m.revenue_perdido, 0).toFixed(2)
        )

        // Label mapping for frontend
        const motivoLabels: Record<string, string> = {
            'precio_alto': 'Precio alto',
            'producto_no_disponible': 'Producto no disponible',
            'solo_explorando': 'Solo explorando',
            'overwhelm_opciones': 'Muchas opciones / indecisión',
            'desconfianza': 'Desconfianza',
            'logistica_envio': 'Logística / envío',
            'metodo_pago': 'Método de pago'
        }

        const motivos_con_label = motivos_no_compra.map(m => ({
            ...m,
            label: motivoLabels[m.motivo] || m.motivo
        }))

        res.json({
            embudo,
            cuello_botella,
            mensajes_promedio_para_cerrar: mensajes_promedio,
            motivos_no_compra: motivos_con_label,
            revenue_perdido_total,
            muestra_pequena,
            meta: {
                total_conversaciones: totalConvos,
                total_leads: leads.length,
                total_ordenes: orders.length,
                periodo_dias: 30
            }
        })
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

// ==================== CATÁLOGO E INVENTARIO ====================

router.get('/analytics/catalogo-inventario', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const botIdParam = (req.query.botId as string) || ''
        const ownerUserId = resolveOwnerUserId(req)

        const userBots = await db.collection('bot_configs')
            .find({ userId: ownerUserId }).toArray()

        if (userBots.length === 0) {
            return res.json({
                top_productos: [],
                demanda_no_satisfecha: [],
                tendencias: [],
                catalogo_pequeno: true
            })
        }

        const botIds = botIdParam ? [botIdParam] : userBots.map(b => b._id.toString())
        const botFilter = botIdParam ? { botId: botIdParam } : { botId: { $in: botIds } }

        const now = new Date()
        const { startDate, endDate, days } = getAnalyticsDateRange(req.query)

        // ─── Raw data ─── (scoped por vendedor cuando aplica)
        const leads = await db.collection('leads')
            .find(_mergeAssignedToScope({ ...botFilter, updatedAt: { $gte: startDate, $lt: endDate } }, req)).toArray()
        const orders = await db.collection('orders')
            .find(_mergeAssignedToScope({ ...botFilter, timestamp: { $gte: startDate, $lt: endDate } }, req)).toArray()

        // Get catalog products from bot configs
        const allProducts: Set<string> = new Set()
        userBots.forEach((bot: any) => {
            const products = bot.catalogProducts || bot.productos || []
            products.forEach((p: any) => {
                const name = typeof p === 'string' ? p : (p.nombre || p.name || '')
                if (name) allProducts.add(name.toLowerCase().trim())
            })
        })

        const catalogo_pequeno = allProducts.size < 3

        // ─── TOP 5 PRODUCTS ───
        const productStats: Record<string, { consultas: number, ventas: number, revenue: number }> = {}

        // Count product interests from leads
        leads.forEach((l: any) => {
            const productos = l.analysis?.intereses?.productos || []
            productos.forEach((p: any) => {
                const name = (typeof p === 'string' ? p : (p.nombre || p.name || '')).toLowerCase().trim()
                if (!name) return
                if (!productStats[name]) productStats[name] = { consultas: 0, ventas: 0, revenue: 0 }
                productStats[name].consultas++
            })
        })

        // Count sales from orders
        orders.forEach((o: any) => {
            const items = o.items || o.productos || []
            items.forEach((item: any) => {
                const name = (typeof item === 'string' ? item : (item.nombre || item.name || item.product || '')).toLowerCase().trim()
                if (!name) return
                if (!productStats[name]) productStats[name] = { consultas: 0, ventas: 0, revenue: 0 }
                productStats[name].ventas += (item.cantidad || item.qty || 1)
                productStats[name].revenue += parseFloat(item.precio || item.price || item.total || o.total || '0') * (item.cantidad || item.qty || 1)
            })
            // If no items detail, use order product name
            if (items.length === 0 && o.product) {
                const name = o.product.toLowerCase().trim()
                if (!productStats[name]) productStats[name] = { consultas: 0, ventas: 0, revenue: 0 }
                productStats[name].ventas++
                productStats[name].revenue += parseFloat(o.total || '0')
            }
        })

        const top_productos = Object.entries(productStats)
            .map(([nombre, stats]) => {
                const conversion = stats.consultas > 0
                    ? Math.round((stats.ventas / stats.consultas) * 100)
                    : 0
                return {
                    nombre: nombre.charAt(0).toUpperCase() + nombre.slice(1),
                    consultas: stats.consultas,
                    ventas: stats.ventas,
                    revenue: parseFloat(stats.revenue.toFixed(2)),
                    conversion: `${conversion}%`,
                    alerta_baja_conversion: stats.consultas >= 3 && conversion < 20
                }
            })
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, 5)

        // ─── DEMANDA NO SATISFECHA ───
        const demandCounts: Record<string, number> = {}

        leads.forEach((l: any) => {
            const productos = l.analysis?.intereses?.productos || []
            productos.forEach((p: any) => {
                const name = (typeof p === 'string' ? p : (p.nombre || p.name || '')).toLowerCase().trim()
                if (!name) return
                // Check if NOT in catalog
                if (!allProducts.has(name)) {
                    demandCounts[name] = (demandCounts[name] || 0) + 1
                }
            })

            // Also check tags/frictions for unmet demand
            const tags = l.analysis?.tags || []
            tags.forEach((tag: string) => {
                if (tag.toLowerCase().includes('no disponible') || tag.toLowerCase().includes('sin stock')) {
                    const prodMention = tag.replace(/no disponible|sin stock/gi, '').trim()
                    if (prodMention) {
                        demandCounts[prodMention] = (demandCounts[prodMention] || 0) + 1
                    }
                }
            })
        })

        const demanda_no_satisfecha = Object.entries(demandCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([term]) => term.charAt(0).toUpperCase() + term.slice(1))

        // ─── TENDENCIAS EMERGENTES ───
        const thisWeekStart = new Date(now)
        thisWeekStart.setDate(thisWeekStart.getDate() - 7)
        const lastWeekStart = new Date(thisWeekStart)
        lastWeekStart.setDate(lastWeekStart.getDate() - 7)

        const thisWeekLeads = leads.filter((l: any) => new Date(l.updatedAt) >= thisWeekStart)
        const lastWeekLeads = leads.filter((l: any) => {
            const d = new Date(l.updatedAt)
            return d >= lastWeekStart && d < thisWeekStart
        })

        const countProductMentions = (leadSet: any[]) => {
            const counts: Record<string, number> = {}
            leadSet.forEach((l: any) => {
                const productos = l.analysis?.intereses?.productos || []
                productos.forEach((p: any) => {
                    const name = (typeof p === 'string' ? p : (p.nombre || p.name || '')).toLowerCase().trim()
                    if (name) counts[name] = (counts[name] || 0) + 1
                })
            })
            return counts
        }

        const thisWeekCounts = countProductMentions(thisWeekLeads)
        const lastWeekCounts = countProductMentions(lastWeekLeads)

        const tendencias = Object.entries(thisWeekCounts)
            .map(([producto, thisCount]) => {
                const lastCount = lastWeekCounts[producto] || 0
                let variacion: string
                if (lastCount === 0) {
                    variacion = thisCount > 0 ? '+100%' : '0%'
                } else {
                    const pct = Math.round(((thisCount - lastCount) / lastCount) * 100)
                    variacion = pct > 0 ? `+${pct}%` : `${pct}%`
                }
                return {
                    producto: producto.charAt(0).toUpperCase() + producto.slice(1),
                    variacion_consultas: variacion,
                    consultas_semana: thisCount,
                    alerta_sin_stock: !allProducts.has(producto)
                }
            })
            .filter(t => t.variacion_consultas.startsWith('+') && t.variacion_consultas !== '+0%')
            .sort((a, b) => b.consultas_semana - a.consultas_semana)
            .slice(0, 6)

        res.json({
            top_productos,
            demanda_no_satisfecha,
            tendencias,
            catalogo_pequeno,
            meta: {
                productos_en_catalogo: allProducts.size,
                total_leads: leads.length,
                total_ordenes: orders.length
            }
        })
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

// ==================== CLIENTES Y RETENCIÓN ====================

router.get('/analytics/clientes-retencion', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const botIdParam = (req.query.botId as string) || ''
        const ownerUserId = resolveOwnerUserId(req)

        const userBots = await db.collection('bot_configs')
            .find({ userId: ownerUserId }).toArray()

        if (userBots.length === 0) {
            return res.json({
                segmentacion: { nuevos_hoy: 0, recurrentes_hoy: 0, ratio: '0%/0%' },
                vip_champions: [],
                recompra: { a_30_dias: '0%', a_60_dias: '0%', a_90_dias: '0%' },
                sentimiento: { score: 0.5, label: 'Sin datos', color: '#888' }
            })
        }

        const botIds = botIdParam ? [botIdParam] : userBots.map(b => b._id.toString())
        const botFilter = botIdParam ? { botId: botIdParam } : { botId: { $in: botIds } }

        const now = new Date()
        const { startDate, endDate, days } = getAnalyticsDateRange(req.query)
        const todayStart = startDate

        // ─── All orders (for VIP + recompra) ───
        const allOrders = await db.collection('orders')
            .find(_mergeAssignedToScope(botFilter, req)).toArray()
        const todayConvos = await db.collection('conversations')
            .find({ ...botFilter, timestamp: { $gte: todayStart } }).toArray()

        // ─── SEGMENTACIÓN ───
        const todayFroms = new Set(todayConvos.map((c: any) => c.from))
        const historicalBuyers = new Set(allOrders
            .filter((o: any) => new Date(o.timestamp) < todayStart)
            .map((o: any) => o.from))

        let nuevos_hoy = 0, recurrentes_hoy = 0
        todayFroms.forEach(from => {
            if (historicalBuyers.has(from)) recurrentes_hoy++
            else nuevos_hoy++
        })

        const totalHoy = nuevos_hoy + recurrentes_hoy
        const ratio = totalHoy > 0
            ? `${Math.round((nuevos_hoy / totalHoy) * 100)}%/${Math.round((recurrentes_hoy / totalHoy) * 100)}%`
            : '0%/0%'

        // ─── VIP CHAMPIONS ───
        const clientStats: Record<string, { compras: number, monto: number, ultima: Date, from: string }> = {}

        allOrders.forEach((o: any) => {
            const from = o.from || 'unknown'
            if (!clientStats[from]) {
                clientStats[from] = { compras: 0, monto: 0, ultima: new Date(0), from }
            }
            clientStats[from].compras++
            clientStats[from].monto += parseFloat(o.total || '0')
            const orderDate = new Date(o.timestamp)
            if (orderDate > clientStats[from].ultima) clientStats[from].ultima = orderDate
        })

        const daysSince = (d: Date) => Math.floor((now.getTime() - d.getTime()) / 86400000)

        const getStatus = (c: { compras: number, monto: number, ultima: Date }) => {
            if (daysSince(c.ultima) > 30) return 'En riesgo'
            if (c.compras > 5 || c.monto > 500) return 'Champion'
            if (c.compras >= 2) return 'Leal'
            return 'Nuevo'
        }

        const vip_champions = Object.values(clientStats)
            .sort((a, b) => b.monto - a.monto)
            .slice(0, 5)
            .map(c => {
                const shortId = c.from.replace('@s.whatsapp.net', '').slice(-6)
                return {
                    alias: `Cliente #${shortId}`,
                    compras: c.compras,
                    monto_total: parseFloat(c.monto.toFixed(2)),
                    ultima_compra: c.ultima.toISOString().split('T')[0],
                    status: getStatus(c)
                }
            })

        // ─── RECOMPRA ───
        const calcRecompra = (daysAgo: number) => {
            const windowStart = new Date(now)
            windowStart.setDate(windowStart.getDate() - daysAgo * 2)
            const windowMid = new Date(now)
            windowMid.setDate(windowMid.getDate() - daysAgo)

            // Buyers from daysAgo*2 to daysAgo
            const earlyBuyers = new Set(
                allOrders.filter((o: any) => {
                    const d = new Date(o.timestamp)
                    return d >= windowStart && d < windowMid
                }).map((o: any) => o.from)
            )

            if (earlyBuyers.size === 0) return '0%'

            // How many of them bought again after windowMid
            const repeatBuyers = allOrders.filter((o: any) => {
                const d = new Date(o.timestamp)
                return d >= windowMid && earlyBuyers.has(o.from)
            })
            const uniqueRepeat = new Set(repeatBuyers.map((o: any) => o.from))

            return `${Math.round((uniqueRepeat.size / earlyBuyers.size) * 100)}%`
        }

        const recompra = {
            a_30_dias: calcRecompra(30),
            a_60_dias: calcRecompra(60),
            a_90_dias: calcRecompra(90)
        }

        // ─── SENTIMIENTO ───
        const recentLeads = await db.collection('leads')
            .find({ ...botFilter, updatedAt: { $gte: startDate, $lt: endDate } }).toArray()

        let sentimentSum = 0, sentimentCount = 0
        recentLeads.forEach((l: any) => {
            // Prefer the new sentimiento.score (0-1 float), fallback to old fields
            const score = l.analysis?.sentimiento?.score ?? l.analysis?.scores?.sentiment ?? l.analysis?.sentiment ?? null
            if (score !== null && typeof score === 'number') {
                sentimentSum += score
                sentimentCount++
            }
        })

        const sentScore = sentimentCount > 0 ? parseFloat((sentimentSum / sentimentCount).toFixed(2)) : 0.5
        let sentLabel: string, sentColor: string

        if (sentScore >= 0.9) { sentLabel = 'Muy Positivo'; sentColor = '#34C759' }
        else if (sentScore >= 0.7) { sentLabel = 'Positivo'; sentColor = '#30d158' }
        else if (sentScore >= 0.5) { sentLabel = 'Neutral'; sentColor = '#FFD60A' }
        else if (sentScore >= 0.3) { sentLabel = 'Negativo'; sentColor = '#FF9500' }
        else { sentLabel = 'Muy Negativo'; sentColor = '#FF3B30' }

        if (sentimentCount === 0) {
            sentLabel = 'Sin datos suficientes'
            sentColor = '#888'
        }

        res.json({
            segmentacion: { nuevos_hoy, recurrentes_hoy, ratio },
            vip_champions,
            recompra,
            sentimiento: { score: sentScore, label: sentLabel, color: sentColor },
            insight_recurrentes: recurrentes_hoy === 0 && totalHoy > 0
                ? 'Hoy todos son nuevos — oportunidad de activar protocolo de retención.'
                : null,
            meta: {
                clientes_unicos: Object.keys(clientStats).length,
                total_ordenes: allOrders.length,
                leads_7d: recentLeads.length
            }
        })
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

// ==================== CANALES Y COMPETENCIA ====================

router.get('/analytics/canales-competencia', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const botIdParam = (req.query.botId as string) || ''
        const ownerUserId = resolveOwnerUserId(req)

        const userBots = await db.collection('bot_configs')
            .find({ userId: ownerUserId }).toArray()

        if (userBots.length === 0) {
            return res.json({
                canales: { whatsapp: { activo: false }, instagram: { activo: false }, tiktok: { activo: false } },
                mejor_canal: null,
                content_mayor_conversion: { formato: null, conversaciones_generadas: 0 },
                menciones_competidores: [],
                total_menciones: 0
            })
        }

        const botIds = botIdParam ? [botIdParam] : userBots.map(b => b._id.toString())
        const botFilter = botIdParam ? { botId: botIdParam } : { botId: { $in: botIds } }

        const now = new Date()
        const { startDate, endDate, days } = getAnalyticsDateRange(req.query)

        const leads = await db.collection('leads')
            .find(_mergeAssignedToScope({ ...botFilter, updatedAt: { $gte: startDate, $lt: endDate } }, req)).toArray()
        const orders = await db.collection('orders')
            .find(_mergeAssignedToScope({ ...botFilter, timestamp: { $gte: startDate, $lt: endDate } }, req)).toArray()

        // ─── Detect active channels from bot configs ───
        const channelStatus: Record<string, boolean> = { whatsapp: false, instagram: false, tiktok: false }
        userBots.forEach((bot: any) => {
            if (bot.connected || bot.status === 'connected') channelStatus.whatsapp = true
            if (bot.instagramConnected || bot.channels?.instagram) channelStatus.instagram = true
            if (bot.tiktokConnected || bot.channels?.tiktok) channelStatus.tiktok = true
        })
        // WhatsApp is always active if there are bots
        if (userBots.length > 0) channelStatus.whatsapp = true

        // ─── Build per-channel metrics ───
        const channelData: Record<string, any> = {}
        const channelKeys = ['whatsapp', 'instagram', 'tiktok']

        channelKeys.forEach(ch => {
            if (!channelStatus[ch]) {
                channelData[ch] = { activo: false }
                return
            }

            const chLeads = leads.filter((l: any) => {
                const source = (l.source || l.canal || l.channel || 'whatsapp').toLowerCase()
                return source.includes(ch) || (ch === 'whatsapp' && !source.includes('instagram') && !source.includes('tiktok'))
            })

            const chOrders = orders.filter((o: any) => {
                const source = (o.source || o.canal || o.channel || 'whatsapp').toLowerCase()
                return source.includes(ch) || (ch === 'whatsapp' && !source.includes('instagram') && !source.includes('tiktok'))
            })

            const conversaciones = chLeads.length
            const ventas = chOrders.length
            const conversion = conversaciones > 0 ? Math.round((ventas / conversaciones) * 100) : 0
            const totalRevenue = chOrders.reduce((sum: number, o: any) => sum + (o.total || o.amount || 0), 0)
            const ticketPromedio = ventas > 0 ? (totalRevenue / ventas) : 0

            channelData[ch] = {
                activo: true,
                conversaciones,
                ventas,
                conversion: `${conversion}%`,
                ticket_promedio: ticketPromedio.toFixed(2),
                tiempo_respuesta: ch === 'whatsapp' ? '3s' : '5s' // Bot response time
            }
        })

        // ─── Best channel by conversion ───
        let mejorCanal: string | null = null
        let mejorConversion = -1
        Object.entries(channelData).forEach(([ch, data]) => {
            if (data.activo) {
                const conv = parseInt(data.conversion) || 0
                if (conv > mejorConversion) {
                    mejorConversion = conv
                    mejorCanal = ch
                }
            }
        })

        // ─── Content format analysis ───
        const formatCounts: Record<string, { total: number, converted: number }> = {
            'Video': { total: 0, converted: 0 },
            'Foto': { total: 0, converted: 0 },
            'Reel': { total: 0, converted: 0 },
            'Historia': { total: 0, converted: 0 },
            'Directo': { total: 0, converted: 0 }
        }

        leads.forEach((l: any) => {
            const source = (l.source || l.contentType || l.referral || '').toLowerCase()
            let format = 'Directo'
            if (source.includes('reel')) format = 'Reel'
            else if (source.includes('story') || source.includes('historia')) format = 'Historia'
            else if (source.includes('video') || source.includes('tiktok')) format = 'Video'
            else if (source.includes('foto') || source.includes('post') || source.includes('photo')) format = 'Foto'

            formatCounts[format].total++
            if (l.analysis?.scores?.buying_intention > 0.5 || l.converted) {
                formatCounts[format].converted++
            }
        })

        let bestFormat: any = { formato: null, conversaciones_generadas: 0 }
        Object.entries(formatCounts).forEach(([fmt, data]) => {
            if (data.converted > bestFormat.conversaciones_generadas && fmt !== 'Directo') {
                bestFormat = { formato: fmt, conversaciones_generadas: data.converted }
            }
        })
        // If only Directo has conversions, use it
        if (!bestFormat.formato && formatCounts['Directo'].converted > 0) {
            bestFormat = { formato: 'Directo', conversaciones_generadas: formatCounts['Directo'].converted }
        }

        // ─── Competitor mentions ───
        const competitorMap: Record<string, { freq: number, context: string }> = {}

        leads.forEach((l: any) => {
            // New structured format: analysis.competitors.mentioned[] + analysis.competitors.context
            const competitorsObj = l.analysis?.competitors || {}
            const competitorsList = competitorsObj.mentioned || competitorsObj || l.analysis?.competidores || []
            const globalCtx = competitorsObj.context || 'neutral'

            if (Array.isArray(competitorsList)) {
                competitorsList.forEach((c: any) => {
                    const name = typeof c === 'string' ? c : (c.nombre || c.name || '')
                    const ctx = typeof c === 'string' ? globalCtx : (c.contexto || c.context || globalCtx)
                    if (name) {
                        const key = name.toLowerCase().trim()
                        if (!competitorMap[key]) {
                            competitorMap[key] = { freq: 0, context: ctx }
                        }
                        competitorMap[key].freq++
                    }
                })
            }

            // Also use content_source for content analysis
            const contentSrc = l.analysis?.content_source || 'directo'
            if (contentSrc !== 'directo') {
                // Map content_source to format names
                const srcMap: Record<string, string> = { 'video': 'Video', 'foto': 'Foto', 'reel': 'Reel', 'historia': 'Historia' }
                const formatName = srcMap[contentSrc] || 'Directo'
                // This data is already counted above but we note the source
            }

            // Also scan tags for competitor-related mentions
            const tags = l.analysis?.tags || []
            tags.forEach((tag: string) => {
                const lower = tag.toLowerCase()
                if (lower.includes('compet') || lower.includes('marca') || lower.includes('vs ')) {
                    const cleaned = tag.replace(/competencia|competidor|marca|vs /gi, '').trim()
                    if (cleaned && cleaned.length > 2) {
                        const key = cleaned.toLowerCase()
                        if (!competitorMap[key]) {
                            competitorMap[key] = { freq: 0, context: 'comparacion' }
                        }
                        competitorMap[key].freq++
                    }
                }
            })
        })

        const menciones_competidores = Object.entries(competitorMap)
            .map(([nombre, data]) => ({
                nombre: nombre.charAt(0).toUpperCase() + nombre.slice(1),
                frecuencia: data.freq,
                contexto: data.context
            }))
            .sort((a, b) => b.frecuencia - a.frecuencia)
            .slice(0, 8)

        const total_menciones = menciones_competidores.reduce((sum, m) => sum + m.frecuencia, 0)

        res.json({
            canales: channelData,
            mejor_canal: mejorCanal,
            content_mayor_conversion: bestFormat,
            menciones_competidores,
            total_menciones
        })
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

// ==================== RENDIMIENTO KIPU ====================

router.get('/analytics/rendimiento-kipu', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const botIdParam = (req.query.botId as string) || ''
        const ownerUserId = resolveOwnerUserId(req)

        const userBots = await db.collection('bot_configs')
            .find({ userId: ownerUserId }).toArray()

        if (userBots.length === 0) {
            return res.json({
                guru_score: { score: 0, label: 'Sin datos', color: '#888', tendencia: '0', componentes: { contencion: 0, velocidad: 0, sentimiento: 0, fallback_inv: 0 } },
                operativas: { tasa_contencion: '0%', tiempo_primera_respuesta: '—', tasa_upselling: '0%', fallback_rate: '0%' },
                faqs_sin_respuesta: [],
                productos_sin_info: [],
                alerta: null
            })
        }

        const botIds = botIdParam ? [botIdParam] : userBots.map(b => b._id.toString())
        const botFilter = botIdParam ? { botId: botIdParam } : { botId: { $in: botIds } }

        const now = new Date()
        const sevenDaysAgo = new Date(now)
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
        const fourteenDaysAgo = new Date(now)
        fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14)

        // ─── Raw data ─── (leads/orders scoped por vendedor cuando aplica)
        const conversations = await db.collection('conversations')
            .find({ ...botFilter, timestamp: { $gte: fourteenDaysAgo } }).toArray()
        const leads = await db.collection('leads')
            .find(_mergeAssignedToScope({ ...botFilter, updatedAt: { $gte: sevenDaysAgo } }, req)).toArray()
        const orders = await db.collection('orders')
            .find(_mergeAssignedToScope({ ...botFilter, timestamp: { $gte: sevenDaysAgo } }, req)).toArray()

        const thisWeekConvos = conversations.filter((c: any) => new Date(c.timestamp) >= sevenDaysAgo)
        const lastWeekConvos = conversations.filter((c: any) => {
            const d = new Date(c.timestamp)
            return d >= fourteenDaysAgo && d < sevenDaysAgo
        })

        const totalConvos = thisWeekConvos.length

        // ─── OPERATIONAL METRICS (uses real bot_performance data) ───

        // 1. Contención: use bot_performance.containment from leads
        const leadsWithPerf = leads.filter((l: any) => l.analysis?.bot_performance)
        const containedLeads = leadsWithPerf.filter((l: any) => l.analysis.bot_performance.containment === true).length
        const escalated = thisWeekConvos.filter((c: any) => c.escalated || c.handoff || c.humanTakeover).length
        const contencionRaw = leadsWithPerf.length > 0
            ? (containedLeads / leadsWithPerf.length) * 100
            : (totalConvos > 0 ? ((totalConvos - escalated) / totalConvos) * 100 : 85)
        const tasa_contencion = Math.round(contencionRaw)

        // 2. Tiempo primera respuesta (use real responseTime_ms from conversations)
        const responseTimes = thisWeekConvos
            .map((c: any) => c.responseTime_ms)
            .filter((t: any) => typeof t === 'number' && t > 0)
        let avgResponseTime = 3 // default 3 seconds
        if (responseTimes.length > 0) {
            avgResponseTime = Math.round((responseTimes.reduce((a: number, b: number) => a + b, 0) / responseTimes.length) / 1000)
        }

        // 3. Upselling rate (use bot_performance.upselling_detected from leads)
        const leadsWithUpsell = leadsWithPerf.filter((l: any) => l.analysis.bot_performance.upselling_detected === true).length
        const upsellRate = leadsWithPerf.length > 0
            ? Math.round((leadsWithUpsell / leadsWithPerf.length) * 100)
            : (orders.length > 0 ? Math.round((orders.filter((o: any) => o.upsell || (o.items && o.items.length > 1)).length / orders.length) * 100) : 0)

        // 4. Fallback rate (use hadFallback from conversations + bot_performance.fallback_used from leads)
        const convoFallbacks = thisWeekConvos.filter((c: any) => c.hadFallback === true).length
        const leadFallbacks = leadsWithPerf.filter((l: any) => l.analysis.bot_performance.fallback_used === true).length
        const totalFallbacks = Math.max(convoFallbacks, leadFallbacks) // use the higher count
        const fallbackRate = totalConvos > 0 ? Math.round((totalFallbacks / totalConvos) * 100) : 5
        const fallbackRateCapped = Math.min(fallbackRate, 100)

        // ─── GURU SCORE ───
        const normalize = (val: number, min: number, max: number) =>
            Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100))

        const contencionScore = normalize(tasa_contencion, 0, 100)
        const velocidadScore = normalize(Math.max(0, 30 - avgResponseTime), 0, 30) // lower is better, max 30s
        // Use the new sentimiento.score (0-1 float) from AI analysis
        const sentimentScores = leads
            .map((l: any) => l.analysis?.sentimiento?.score ?? l.analysis?.scores?.sentiment ?? l.analysis?.sentiment)
            .filter((s: any) => typeof s === 'number')
        const avgSentiment = sentimentScores.length > 0
            ? sentimentScores.reduce((a: number, b: number) => a + b, 0) / sentimentScores.length
            : 0.5
        const sentimientoScore = avgSentiment * 100
        const fallbackInvScore = (1 - fallbackRateCapped / 100) * 100

        const guruScore = Math.round(
            contencionScore * 0.35 +
            velocidadScore * 0.25 +
            sentimientoScore * 0.20 +
            fallbackInvScore * 0.20
        )

        // Guru Score label & color
        let guruLabel: string, guruColor: string
        if (guruScore >= 90) { guruLabel = 'Excelente'; guruColor = '#34C759' }
        else if (guruScore >= 76) { guruLabel = 'Muy bueno'; guruColor = '#30d158' }
        else if (guruScore >= 61) { guruLabel = 'Bueno'; guruColor = '#FFD60A' }
        else if (guruScore >= 41) { guruLabel = 'En desarrollo'; guruColor = '#FF9500' }
        else { guruLabel = 'Crítico'; guruColor = '#FF3B30' }

        // Trend vs last week
        const lastWeekTotal = lastWeekConvos.length
        const lastEscalated = lastWeekConvos.filter((c: any) => c.escalated || c.handoff || c.humanTakeover).length
        const lastContencion = lastWeekTotal > 0 ? ((lastWeekTotal - lastEscalated) / lastWeekTotal) * 100 : 85
        const lastFallbacks = lastWeekConvos.filter((c: any) => c.fallback || c.noAnswer || c.unknownQuery).length
        const lastFallbackRate = lastWeekTotal > 0 ? (lastFallbacks / lastWeekTotal) * 100 : 5
        const lastGuruScore = Math.round(
            normalize(lastContencion, 0, 100) * 0.35 +
            velocidadScore * 0.25 + // assume similar speed
            sentimientoScore * 0.20 + // approximate
            (1 - lastFallbackRate / 100) * 100 * 0.20
        )

        const tendencia = guruScore - lastGuruScore
        const tendenciaStr = tendencia > 0 ? `+${tendencia}` : `${tendencia}`

        // ─── ALERT if score dropped >10 ───
        let alerta = null
        if (tendencia < -10) {
            const components = [
                { name: 'Contención', current: contencionScore, label: 'contencion' },
                { name: 'Velocidad', current: velocidadScore, label: 'velocidad' },
                { name: 'Sentimiento', current: sentimientoScore, label: 'sentimiento' },
                { name: 'Fallback', current: fallbackInvScore, label: 'fallback_inv' }
            ]
            const worst = components.sort((a, b) => a.current - b.current)[0]
            alerta = {
                tipo: 'danger',
                mensaje: `Guru Score bajó ${Math.abs(tendencia)} puntos. Componente más afectado: ${worst.name}.`,
                componente: worst.label
            }
        } else if (fallbackRateCapped > 20) {
            alerta = {
                tipo: 'warning',
                mensaje: 'Fallback rate > 20% — revisa el prompt de tu Qhatu y agrega respuestas a las preguntas frecuentes.',
                componente: 'fallback_inv'
            }
        }

        // ─── FAQs SIN RESPUESTA ───
        const faqCounts: Record<string, { freq: number, type: string }> = {}

        leads.forEach((l: any) => {
            // Use bot_performance.unanswered_questions (from new AI analysis)
            const unanswered = l.analysis?.bot_performance?.unanswered_questions || []
            unanswered.forEach((q: string) => {
                if (!faqCounts[q]) faqCounts[q] = { freq: 0, type: 'Entrenar respuesta' }
                faqCounts[q].freq++
            })

            // Also use frictions and tags
            const frictions = l.analysis?.frictions?.objeciones || []
            const tags = l.analysis?.tags || []

            frictions.forEach((f: string) => {
                if (!faqCounts[f]) faqCounts[f] = { freq: 0, type: 'Entrenar respuesta' }
                faqCounts[f].freq++
            })

            tags.forEach((tag: string) => {
                const lower = tag.toLowerCase()
                if (lower.includes('sin respuesta') || lower.includes('no sabe') || lower.includes('fallback')) {
                    const cleanTag = tag.replace(/sin respuesta|fallback/gi, '').trim() || tag
                    if (!faqCounts[cleanTag]) faqCounts[cleanTag] = { freq: 0, type: 'Entrenar respuesta' }
                    faqCounts[cleanTag].freq++
                }
                if (lower.includes('precio') || lower.includes('costo')) {
                    if (!faqCounts[tag]) faqCounts[tag] = { freq: 0, type: 'Agregar al catálogo' }
                    faqCounts[tag].freq++
                }
                if (lower.includes('envío') || lower.includes('política') || lower.includes('garantía')) {
                    if (!faqCounts[tag]) faqCounts[tag] = { freq: 0, type: 'Configurar política' }
                    faqCounts[tag].freq++
                }
            })
        })

        const faqs_sin_respuesta = Object.entries(faqCounts)
            .map(([pregunta, data]) => ({
                pregunta: pregunta.charAt(0).toUpperCase() + pregunta.slice(1),
                frecuencia: data.freq,
                accion: data.type
            }))
            .sort((a, b) => b.frecuencia - a.frecuencia)
            .slice(0, 5)

        // ─── PRODUCTOS SIN INFO ───
        const catalogProducts = new Set<string>()
        userBots.forEach((bot: any) => {
            const prods = bot.catalogProducts || bot.productos || []
            prods.forEach((p: any) => {
                const name = typeof p === 'string' ? p : (p.nombre || p.name || '')
                if (name) catalogProducts.add(name.toLowerCase().trim())
            })
        })

        const queriedProducts = new Set<string>()
        leads.forEach((l: any) => {
            const prods = l.analysis?.intereses?.productos || []
            prods.forEach((p: any) => {
                const name = (typeof p === 'string' ? p : (p.nombre || p.name || '')).toLowerCase().trim()
                if (name && !catalogProducts.has(name)) {
                    queriedProducts.add(name)
                }
            })
        })

        const productos_sin_info = [...queriedProducts]
            .slice(0, 8)
            .map(p => p.charAt(0).toUpperCase() + p.slice(1))

        res.json({
            guru_score: {
                score: guruScore,
                label: guruLabel,
                color: guruColor,
                tendencia: tendenciaStr,
                componentes: {
                    contencion: Math.round(contencionScore),
                    velocidad: Math.round(velocidadScore),
                    sentimiento: Math.round(sentimientoScore),
                    fallback_inv: Math.round(fallbackInvScore)
                }
            },
            operativas: {
                tasa_contencion: `${tasa_contencion}%`,
                tiempo_primera_respuesta: `${avgResponseTime}s`,
                tasa_upselling: `${upsellRate}%`,
                fallback_rate: `${fallbackRateCapped}%`
            },
            faqs_sin_respuesta,
            productos_sin_info,
            alerta
        })
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

function emptyAnalytics() {
    return {
        scorecard: {
            totalConversations: 0, todayConversations: 0,
            conversionRate: '0.0', totalRevenue: 0,
            avgTicket: 0, automationRate: 0, avgResponseTime: '< 3s'
        },
        funnel: { received: 0, responded: 0, qualified: 0, negotiation: 0, closed: 0 },
        panels: {
            chat: { total: 0, newContacts: 0, recurringContacts: 0 },
            sales: { conversions: 0, totalValue: 0, avgTicket: 0 },
            automation: { noHumanRate: 0, escalations: 0, unanswered: 0 }
        },
        intelligence: {
            topProducts: [], topInterests: [], topOccasions: [],
            topFrictions: [], sentiment: { Positivo: 0, Neutral: 0, Negativo: 0 },
            channels: {}, peakHour: 'N/A', peakDay: 'N/A',
            leadBreakdown: { hot: 0, warm: 0, cold: 0 },
            alertsTriggered: 0
        }
    }
}

// ==================== METRICS ====================

router.get('/metrics/:botId', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const botId = req.params.botId as string

        // Verificar propiedad
        const bot = await db.collection('bot_configs').findOne({
            _id: new ObjectId(botId),
            userId: req.userId
        })
        if (!bot) return res.status(404).json({ error: 'Bot no encontrado' })

        const today = new Date()
        today.setHours(0, 0, 0, 0)

        const todayConversations = await db.collection('conversations')
            .countDocuments({ botId, timestamp: { $gte: today } })

        const totalConversations = await db.collection('conversations')
            .countDocuments({ botId })

        const uniqueContacts = await db.collection('conversations')
            .distinct('from', { botId })

        res.json({
            todayConversations,
            totalConversations,
            uniqueContacts: uniqueContacts.length,
            status: botManager.getStatus(botId)
        })
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})


// ==================== ORDERS ====================
router.get('/orders/:botId', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const botId = req.params.botId as string
        const ownerUserId = resolveOwnerUserId(req)

        const bot = await db.collection('bot_configs').findOne({
            _id: new ObjectId(botId),
            userId: ownerUserId
        })
        if (!bot) return res.status(404).json({ error: 'Bot no encontrado' })

        const orders = await db.collection('orders')
            .find(_mergeAssignedToScope({ botId }, req))
            .sort({ timestamp: -1 })
            .toArray()

        res.json(orders)
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

// ==================== LEADS ====================
router.get('/leads/:botId', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const botId = req.params.botId as string

        // Verificar propiedad del bot
        const bot = await db.collection('bot_configs').findOne({
            _id: new ObjectId(botId),
            userId: req.userId
        })
        if (!bot) return res.status(404).json({ error: 'Bot no encontrado' })

        const leads = await db.collection('leads')
            .find({ botId })
            .sort({ updatedAt: -1 })
            .toArray()

        // Get conversation counts per lead and total orders for conversion rate
        const [conversationCounts, totalOrders] = await Promise.all([
            db.collection('conversations').aggregate([
                { $match: { botId } },
                { $group: { _id: '$from', count: { $sum: 1 } } }
            ]).toArray(),
            db.collection('orders').countDocuments({ botId })
        ])

        const convMap: Record<string, number> = {}
        conversationCounts.forEach((c: any) => { convMap[c._id] = c.count })

        const enrichedLeads = leads.map(lead => ({
            ...lead,
            conversationCount: convMap[lead.from] || 0
        }))

        res.json({
            leads: enrichedLeads,
            totalOrders,
            totalLeads: leads.length
        })
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

// ==================== SOFT-DELETE LEAD ====================
// Spec Qhatu: "Ningún ticket se borra. Todos migran de Abierto a Vencido y permanecen
// consultables." Por eso este endpoint NO ejecuta DELETE físico sobre la fila —
// marca el lead como deleted=true para ocultarlo del CRM, pero la información
// queda en la BD para auditoría y futuros exports a Excel.
router.delete('/leads/:leadId', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const leadId = req.params.leadId as string
        const lead = await db.collection('leads').findOne({ _id: new ObjectId(leadId) })
        if (!lead) return res.status(404).json({ error: 'Lead no encontrado' })
        const bot = await db.collection('bot_configs').findOne({ _id: new ObjectId(lead.botId), userId: req.userId })
        if (!bot) return res.status(403).json({ error: 'No autorizado' })

        // Soft-delete defensivo: ver comentario análogo en /orders/:botId/:orderId DELETE.
        // La tabla `leads` puede no tener `deleted_at`/`deleted_by` en esquemas
        // viejos — reintentamos sin metadata si PostgREST se queja.
        try {
            await db.collection('leads').updateOne(
                { _id: new ObjectId(leadId) },
                { $set: { deleted: true, deletedAt: new Date(), deletedBy: req.userId, etapa_pipeline: 'vencido', updatedAt: new Date() } }
            )
        } catch (writeErr: any) {
            const msg = String(writeErr?.message || '')
            if (/Could not find the .*column|column .* does not exist/i.test(msg)) {
                console.warn(`[CRM] leads.archive sin columnas deletedAt/By — reintentando sin metadata. (${msg})`)
                await db.collection('leads').updateOne(
                    { _id: new ObjectId(leadId) },
                    { $set: { deleted: true, etapa_pipeline: 'vencido', updatedAt: new Date() } }
                )
            } else {
                throw writeErr
            }
        }
        console.log(`[CRM] 📦 Lead ${leadId} archivado (soft-delete) por usuario ${req.userId}`)
        res.json({ status: 'archived' })
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

// ==================== RADAR DE PROSPECTOS ====================
router.get('/analytics/radar/:botId', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const botId = req.params.botId as string
        const ownerUserId = resolveOwnerUserId(req)

        const bot = await db.collection('bot_configs').findOne({ _id: new ObjectId(botId), userId: ownerUserId })
        if (!bot) return res.status(404).json({ error: 'Bot no encontrado' })

        const allLeads = await db.collection('leads')
            .find(_mergeAssignedToScope({ botId }, req), {
                projection: {
                    from: 1,
                    contactName: 1,
                    datos_extraidos: 1,
                    name: 1,
                    channel: 1,
                    lastMessage: 1,
                    updatedAt: 1,
                    createdAt: 1,
                    leadScore: 1,
                    scoreLevel: 1,
                    etapa_pipeline: 1,
                    temperatura_lead: 1,
                    motivo_no_compra: 1,
                    valor_potencial: 1,
                    analysis: 1
                }
            })
            .sort({ updatedAt: -1 })
            .toArray()

        // G&L Error 18: tasa de conversión solo cuenta ventas REALMENTE confirmadas
        // (pago verificado = status 'completado'), nunca pedidos abiertos o cancelados.
        // Antes contábamos cualquier orden creada — eso inflaba la tasa cuando Qhatu
        // emitía ORDER_CLOSED pero el cliente todavía no había pagado o terminó
        // cancelando. Ahora la tasa refleja conversión real de embudo.
        const totalOrders = await db.collection('orders').countDocuments(_mergeAssignedToScope({
            botId,
            status: 'completado',
            archived: { $ne: true }
        }, req))
        const totalLeads = allLeads.length

        // ─── Pipeline Stage Counts (for funnel) ───
        const stages = ['exploracion', 'interes_activo', 'cotizacion_enviada', 'ganado', 'perdido']
        const pipelineCounts: Record<string, number> = {}
        stages.forEach(s => { pipelineCounts[s] = 0 })

        allLeads.forEach(l => {
            const etapa = l.etapa_pipeline || 'exploracion'
            if (pipelineCounts[etapa] !== undefined) {
                pipelineCounts[etapa]++
            } else {
                pipelineCounts['exploracion']++
            }
        })

        // ─── KPIs ───
        const now = new Date()
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())

        const calientes = allLeads.filter(l => l.temperatura_lead === 'caliente').length
        const nuevosHoy = allLeads.filter(l => new Date(l.createdAt) >= todayStart).length
        const conversionRate = totalLeads > 0 ? ((totalOrders / totalLeads) * 100).toFixed(1) : '0.0'

        // Revenue perdido: sum valor_potencial where etapa_pipeline === 'perdido'
        const revenuePerdido = allLeads
            .filter(l => l.etapa_pipeline === 'perdido' && l.valor_potencial)
            .reduce((sum, l) => sum + (typeof l.valor_potencial === 'number' ? l.valor_potencial : parseFloat(l.valor_potencial) || 0), 0)

        // ─── Motivos de No-Compra ───
        const motivosMap: Record<string, number> = {}
        allLeads.forEach(l => {
            if (l.motivo_no_compra && l.motivo_no_compra !== 'null') {
                const motivo = l.motivo_no_compra.toLowerCase().trim()
                motivosMap[motivo] = (motivosMap[motivo] || 0) + 1
            }
        })
        const motivos = Object.entries(motivosMap)
            .map(([motivo, count]) => ({ motivo, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10)

        // ─── Leads list (for Kanban cards) ───
        const leads = allLeads.map(l => ({
            _id: l._id,
            from: l.from,
            name: l.contactName || l.datos_extraidos?.nombre_contacto || l.name || l.from?.split('@')[0] || 'Lead',
            channel: l.channel || 'whatsapp',
            lastMessage: l.lastMessage || '',
            updatedAt: l.updatedAt,
            createdAt: l.createdAt,
            leadScore: l.leadScore || 0,
            scoreLevel: l.scoreLevel || 'FRIO',
            etapa_pipeline: l.etapa_pipeline || 'exploracion',
            temperatura_lead: l.temperatura_lead || 'tibio',
            motivo_no_compra: l.motivo_no_compra || null,
            valor_potencial: l.valor_potencial || null
        }))

        res.json({
            kpis: {
                calientes,
                nuevos_hoy: nuevosHoy,
                conversion_rate: conversionRate,
                revenue_perdido: revenuePerdido
            },
            pipeline: pipelineCounts,
            motivos,
            leads,
            totalLeads,
            totalOrders
        })
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

// ==================== CRM CLASSIFICATION MODULES ====================

// ─── MODULE A: LEADS (Nuevos y Recurrentes) ───
router.get('/crm/leads/:botId', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const botId = req.params.botId as string

        const ownerUserId = resolveOwnerUserId(req)
        const bot = await db.collection('bot_configs').findOne({ _id: new ObjectId(botId), userId: ownerUserId })
        if (!bot) return res.status(404).json({ error: 'Bot no encontrado' })

        // Accept either `from`/`to` (ISO date strings from the calendar range picker)
        // or legacy `days` number. Calendar range takes precedence when provided.
        const fromRaw = (req.query.from as string) || ''
        const toRaw = (req.query.to as string) || ''
        const fromDate = fromRaw ? new Date(fromRaw) : null
        const toDate = toRaw ? new Date(toRaw) : null
        const days = parseInt(req.query.days as string) || 7
        const since = fromDate && !isNaN(fromDate.getTime())
            ? fromDate
            : new Date(Date.now() - days * 24 * 60 * 60 * 1000)
        const until = toDate && !isNaN(toDate.getTime())
            ? new Date(toDate.getTime() + 24 * 60 * 60 * 1000 - 1) // include full "to" day
            : null
        const rangeFilter: any = { $gte: since }
        if (until) rangeFilter.$lte = until

        // Get leads classified as lead_nuevo or lead_recurrente.
        // NOTE: `deleted`/`archived` are filtered in-memory below, NOT in the DB
        // query, because Supabase's `.neq('deleted', true)` excludes rows where
        // `deleted IS NULL` (3-valued SQL logic). Most active leads never had
        // those flags explicitly set, so filtering them in DB hides every lead.
        const leads = await db.collection('leads').find(_mergeAssignedToScope({
            botId,
            estado_clasificacion: { $in: ['lead_nuevo', 'lead_recurrente'] },
            updatedAt: rangeFilter
        }, req)).sort({ updatedAt: -1 }).toArray()

        // Also include leads without classification (NULL estado_clasificacion)
        const unclassifiedLeads = await db.collection('leads').find(_mergeAssignedToScope({
            botId,
            estado_clasificacion: { $exists: false },
            updatedAt: rangeFilter
        }, req)).sort({ updatedAt: -1 }).toArray()

        const allLeads = [...leads, ...unclassifiedLeads].filter(
            l => l?.deleted !== true && l?.archived !== true
        )
        // E19 / E21: Deduplicate by the client's REAL phone number, not by the
        // raw JID. WhatsApp can deliver the same client under different JIDs
        // (`xxx@s.whatsapp.net`, `yyy@lid`, etc.), so deduping only by JID
        // leaves multiple tickets per client. We extract the last 9 digits
        // (Peruvian mobile length) as the canonical identity and keep the
        // newest row per client (allLeads is already sorted by updatedAt DESC).
        const lastDigits = (val: string | undefined) => {
            if (!val) return ''
            const digits = String(val).split('@')[0].replace(/\D/g, '')
            return digits.length >= 9 ? digits.slice(-9) : digits
        }
        const seen = new Set<string>()
        const uniqueLeads = allLeads.filter(l => {
            const phoneKey = lastDigits(l.phone || l.from)
            const key = phoneKey || `__noid_${l._id}`
            if (seen.has(key)) return false
            seen.add(key)
            return true
        })

        // KPIs
        const totalLeads = uniqueLeads.length
        const recurrentes = uniqueLeads.filter(l => l.estado_clasificacion === 'lead_recurrente').length
        const tasaReactivacion = totalLeads > 0 ? Math.round((recurrentes / totalLeads) * 100) : 0

        // SLA: average response time from conversations
        const convos = await db.collection('conversations').find({
            botId, timestamp: { $gte: since }
        }).toArray()
        const responseTimes = convos.map((c: any) => c.responseTime_ms).filter((t: any) => typeof t === 'number' && t > 0)
        const avgResponseMs = responseTimes.length > 0 ? responseTimes.reduce((a: number, b: number) => a + b, 0) / responseTimes.length : 3000
        const slaSeconds = Math.round(avgResponseMs / 1000)

        // Build a JID → real-phone map so the CRM shows the client's actual
        // WhatsApp number instead of the opaque @lid identifier. wa_chats now
        // stores senderPn/participantPn in phone_number; fall back to the JID
        // local part for classic @s.whatsapp.net chats.
        const waChatsForBot = await db.collection('wa_chats')
            .find({ botId })
            .toArray()
            .catch(() => [])
        const phoneMap = new Map<string, string>()
        for (const wc of waChatsForBot) {
            if (wc.chatJid && wc.phoneNumber) phoneMap.set(wc.chatJid, wc.phoneNumber)
        }
        const resolvePrettyPhone = (jid: string | undefined) => {
            if (!jid) return ''
            const mapped = phoneMap.get(jid)
            if (mapped) return mapped
            const localPart = jid.split('@')[0] || ''
            return jid.endsWith('@lid') ? '' : localPart
        }

        // Resolver nombre + iniciales del miembro asignado en cada lead.
        // El frontend usa esto para pintar el badge del avatar SIN pedir
        // `/team` — clave para vendedores, que ya no pueden listar el
        // equipo completo del owner.
        const assignedIds = Array.from(new Set(
            uniqueLeads.map(l => String(l.assignedTo || l.assigned_to || ''))
                       .filter(id => id && id !== 'null')
        ))
        const memberMap = new Map<string, { name: string; initials: string }>()
        if (assignedIds.length > 0) {
            try {
                const supa = _wfSupa()
                const { data: members } = await supa
                    .from('team_members')
                    .select('id, name')
                    .in('id', assignedIds)
                for (const m of (members || [])) {
                    const name = String(m.name || '').trim() || 'Vendedor'
                    const initials = name.split(/\s+/).map(s => s[0] || '').join('').slice(0, 2).toUpperCase()
                    memberMap.set(String(m.id), { name, initials })
                }
            } catch (_) { /* fallback: campos vacíos */ }
        }

        // Pipeline Data
        const leadsArray = uniqueLeads.map(l => {
            const assignedTo = l.assignedTo || l.assigned_to || null
            const memInfo = assignedTo ? memberMap.get(String(assignedTo)) : null
            return ({
            _id: l._id,
            from: l.from,
            assignedTo,
            assignedToName: memInfo?.name || null,
            assignedToInitials: memInfo?.initials || null,
            contacto: l.contactName || l.datos_extraidos?.nombre_contacto || l.name || resolvePrettyPhone(l.from) || 'Anónimo',
            numero: resolvePrettyPhone(l.from),
            tipo: l.estado_clasificacion === 'lead_recurrente' ? '🔄 Recurrente' : '🆕 Nuevo',
            origen: l.datos_extraidos?.origen || l.analysis?.canal?.origen || 'whatsapp',
            interes: l.datos_extraidos?.producto_interes || l.analysis?.intereses?.productos?.[0] || '—',
            productos: l.analysis?.intereses?.productos || [],
            monto: l.valor_potencial || l.datos_extraidos?.monto_estimado || 0,
            lastMessage: l.lastMessage || '',
            ultima_interaccion: l.updatedAt,
            score: l.leadScore || 0,
            scoreLevel: l.scoreLevel || 'FRIO',
            etapa_pipeline: l.etapa_pipeline || 'exploracion',
            tags: l.analysis?.tags || [],
            frictions: l.analysis?.frictions || {},
            contexto: l.analysis?.contexto || {},
            // ═══ CRM 16-Field Structure ═══
            // Tier 1 — ¿A quién atiendo primero?
            ticket_id: l.ticketId || `#${(l._id || '').toString().substring(0, 6).toUpperCase()}`,
            fecha_creacion: l.createdAt, // Tier 1 per doc maestro v2.0 sec 5.3.1
            temperatura: l.temperatura || (l.scoreLevel === 'CALIENTE' || l.scoreLevel === 'LISTO' ? 'caliente' : l.scoreLevel === 'TIBIO' ? 'tibio' : 'frio'),
            producto_interes: l.producto_interes || l.datos_extraidos?.producto_interes || l.analysis?.intereses?.productos?.[0] || null,
            fecha_ultimo_contacto: l.updatedAt,
            escalado_humano: l.escaladoHumano || false,
            estado_conversacion: l.estadoConversacion || 'abierta',
            // Tier 2 — ¿Cómo lo atiendo?
            canal: l.channel || 'whatsapp',
            consulta_inicial: l.consultaInicial || l.lastMessage || null,
            fecha_primer_contacto: l.createdAt,
            comentarios: l.comentarios || null,
            // Tier 3 — ¿Qué puedo mejorar?
            motivo_escalacion: l.motivoEscalacion || null,
            duracion_ciclo_horas: l.duracionCicloHoras || null,
            motivo_perdida: l.motivoPerdida || l.motivo_no_compra || null,
            num_mensajes: l.numMensajes || 0,
            sentimiento: l.sentimiento || (l.analysis?.sentimiento?.tono || 'neutro').toLowerCase(),
            // ╔══════════════════════════════════════════════════════════════════╗
            // ║ PENDIENTE A-4 · Expiración de Leads a 48 horas                ║
            // ║ Adjuntar evidencia del mecanismo exacto:                       ║
            // ║   - Si es cron: nombre del job, frecuencia, archivo            ║
            // ║   - Si es trigger de BD: definición del trigger                ║
            // ║   - Si es on-demand (como aquí): función y dónde se llama      ║
            // ║   - Cómo se calcula "última interacción" (updatedAt vs otro)   ║
            // ║ Criterio: ticket vencido aparece SIN intervención del          ║
            // ║ emprendedor. Adjuntar ejemplo con timestamps.                  ║
            // ╚══════════════════════════════════════════════════════════════════╝
            // Ticket lifecycle: Abierto/Vencido
            // Vencido if: (1) lead converted to sale (ganado) or (2) 48h since last interaction
            estado_ticket: (() => {
                if (l.etapa_pipeline === 'ganado' || l.etapa_pipeline === 'compro') return 'vencido'
                if (l.etapa_pipeline === 'perdido') return 'vencido'
                const rawDate = l.updatedAt ?? l.createdAt ?? null
                if (!rawDate) return 'abierto'
                const lastInteraction = new Date(rawDate)
                if (isNaN(lastInteraction.getTime())) return 'abierto'
                const hoursSinceInteraction = (Date.now() - lastInteraction.getTime()) / (1000 * 60 * 60)
                return hoursSinceInteraction > 48 ? 'vencido' : 'abierto'
            })(),
        })
        })

        res.json({
            kpis: {
                volumen_leads: totalLeads,
                tasa_reactivacion: `${tasaReactivacion}%`,
                tiempo_respuesta_sla: `${slaSeconds}s`,
                leads_hoy: uniqueLeads.filter(l => {
                    const d = new Date(l.updatedAt)
                    const today = new Date()
                    return d.toDateString() === today.toDateString()
                }).length
            },
            leads: leadsArray,
            periodo_dias: days
        })
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

// ─── UPDATE LEAD STAGE ───
router.put('/crm/leads/:botId/:leadId/stage', authMiddleware, async (req: AuthRequest, res: Response) => {
    // AN-08: Etapa de funnel es valor derivado de Analytics — bloquear edicion manual (doc sec 7, v3 #13.1)
    return res.status(403).json({ error: 'La etapa del funnel es clasificada automáticamente por Analytics. No se puede editar manualmente desde el CRM.' })
    /* Original code preserved for reference:
    try {
        const db = getDB()
        const botId = req.params.botId as string
        const leadId = req.params.leadId as string
        const { stage, reason } = req.body

        const bot = await db.collection('bot_configs').findOne({ _id: new ObjectId(botId), userId: req.userId })
        if (!bot) return res.status(404).json({ error: 'Bot no encontrado' })

        const validStages = ['exploracion', 'interes_activo', 'cotizacion_enviada', 'ganado', 'perdido'];
        if (!validStages.includes(stage)) {
            return res.status(400).json({ error: 'Etapa no válida' })
        }

        const updateData: any = { etapa_pipeline: stage, updatedAt: new Date() };
        if (stage === 'perdido' && reason) {
            updateData.motivo_no_compra = reason;
        }

        await db.collection('leads').updateOne(
            { _id: new ObjectId(leadId), botId },
            { $set: updateData }
        )

        res.json({ success: true, message: 'Etapa actualizada' })
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
    */
})

// ─── UPDATE LEAD COMMENT (Tier 2) ───
router.put('/crm/leads/:botId/:leadId/comment', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const botId = req.params.botId as string
        const leadId = req.params.leadId as string
        const { comentarios } = req.body

        const bot = await db.collection('bot_configs').findOne({ _id: new ObjectId(botId), userId: req.userId })
        if (!bot) return res.status(404).json({ error: 'Bot no encontrado' })

        await db.collection('leads').updateOne(
            { _id: new ObjectId(leadId), botId },
            { $set: { comentarios: comentarios || '', updatedAt: new Date() } }
        )

        res.json({ success: true, message: 'Comentario guardado' })
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

// ─── UPDATE LEAD LOSS REASON (Tier 3) ───
router.put('/crm/leads/:botId/:leadId/loss-reason', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const botId = req.params.botId as string
        const leadId = req.params.leadId as string
        const { motivo_perdida } = req.body

        const bot = await db.collection('bot_configs').findOne({ _id: new ObjectId(botId), userId: req.userId })
        if (!bot) return res.status(404).json({ error: 'Bot no encontrado' })

        const validReasons = ['Precio muy alto', 'No respondió', 'Compró en otro lado', 'Solo preguntaba', 'Producto no disponible', 'Otro']
        if (motivo_perdida && !validReasons.includes(motivo_perdida)) {
            return res.status(400).json({ error: 'Motivo no válido', valid: validReasons })
        }

        await db.collection('leads').updateOne(
            { _id: new ObjectId(leadId), botId },
            { $set: { motivoPerdida: motivo_perdida || null, updatedAt: new Date() } }
        )

        res.json({ success: true, message: 'Motivo de pérdida actualizado' })
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

// ─── MODULE B: VENTAS ACTIVAS ───
router.get('/crm/ventas/:botId', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const botId = req.params.botId as string
        const fromRaw = (req.query.from as string) || ''
        const toRaw = (req.query.to as string) || ''
        const fromDate = fromRaw ? new Date(fromRaw) : null
        const toDate = toRaw ? new Date(toRaw) : null
        const days = parseInt(req.query.days as string) || 30 // defaults to 30 for CRM Ventas

        const ownerUserId = resolveOwnerUserId(req)
        const bot = await db.collection('bot_configs').findOne({ _id: new ObjectId(botId), userId: ownerUserId })
        if (!bot) return res.status(404).json({ error: 'Bot no encontrado' })

        const since = fromDate && !isNaN(fromDate.getTime())
            ? fromDate
            : new Date(Date.now() - days * 24 * 60 * 60 * 1000)
        const until = toDate && !isNaN(toDate.getTime())
            ? new Date(toDate.getTime() + 24 * 60 * 60 * 1000 - 1)
            : null
        const rangeFilter: any = { $gte: since }
        if (until) rangeFilter.$lte = until

        const orders = await db.collection('orders').find(_mergeAssignedToScope({
            botId,
            timestamp: rangeFilter,
            archived: { $ne: true }
        }, req)).sort({ timestamp: -1 }).toArray()

        // Spec Qhatu: derivar `has_postventa` para que el frontend pueda mostrar
        // Tipo de Estado = "Postventa" cuando una venta tiene un ticket de
        // postventa abierto (en gestión, no resuelto).
        // Una sola query agregada por todos los orderIds para evitar N+1.
        const orderIds = orders.map(o => o._id?.toString()).filter(Boolean)
        const openPostventaSet = new Set<string>()
        if (orderIds.length > 0) {
            try {
                const pvAll = await db.collection('postventa_tickets').find({ botId }).toArray()
                for (const pv of pvAll) {
                    const oid = (pv.orderId || pv.order_id || '').toString()
                    if (oid && pv.estado_ticket !== 'resuelto') openPostventaSet.add(oid)
                }
            } catch (_) { /* ignore — flag falls back a false */ }
        }
        for (const o of orders) {
            o.has_postventa = openPostventaSet.has(o._id?.toString() || '')
        }

        // 1. Calculate KPIs (exclude 'perdido')
        let ventasPeriodo = 0;
        let pedidosCerrados = 0;
        let pagosPendientes = 0;

        orders.forEach(o => {
            if (o.status !== 'perdido') {
                const total = parseFloat(o.total) || 0;
                ventasPeriodo += total;
                pedidosCerrados++;

                if (o.status === 'entregado_pago_pendiente') {
                    pagosPendientes += total;
                }
            }
        });

        const ticketPromedio = pedidosCerrados > 0 ? ventasPeriodo / pedidosCerrados : 0;

        // 2. Group orders
        // Resolve every order's customer_phone against the real pushed phone
        // (from wa_chats.phone_number, populated via senderPn/participantPn).
        // Fixes Ventas showing the @lid identifier instead of the client's
        // actual WhatsApp number.
        const waChatsMap = new Map<string, string>()
        try {
            const waChats = await db.collection('wa_chats').find({ botId }).toArray()
            for (const wc of waChats) {
                if (wc.chatJid && wc.phoneNumber) waChatsMap.set(wc.chatJid, wc.phoneNumber)
            }
        } catch (_) { /* ignore */ }
        for (const o of orders) {
            const looksLikeLid = /^\d+$/.test(o.customerPhone || '') && (o.phone || '').endsWith('@lid')
            if ((!o.customerPhone || looksLikeLid) && o.phone) {
                const mapped = waChatsMap.get(o.phone)
                if (mapped) o.customerPhone = mapped
                else if (!(o.phone || '').endsWith('@lid')) o.customerPhone = (o.phone || '').split('@')[0]
            }
        }

        const porPreparar = orders.filter(o => o.status !== 'entregado_pago_pendiente' && o.status !== 'completado' && o.status !== 'perdido');
        const porCobrar = orders.filter(o => o.status === 'entregado_pago_pendiente');
        const completados = orders.filter(o => o.status === 'completado');

        // E22: incluir como "pendiente de cierre" los leads que ya están en
        // etapa_pipeline=ganado pero todavía no tienen una orden persistida
        // en la colección `orders` (caso típico: Qhatu marcó la conversación
        // como ganada pero el [ORDER_CLOSED] no se persistió correctamente,
        // o el emprendedor todavía no confirmó el pago). Antes estos leads
        // aparecían en CRM Leads como "Tipo de Estado = Venta" pero la
        // pestaña Ventas mostraba "No se encontraron ventas" — esto los
        // expone para que el emprendedor cierre el ciclo manualmente.
        const ordersPhoneSet = new Set(orders.map((o: any) => (o.phone || '').toString()))
        const leadsGanadosSinOrden = await db.collection('leads').find(_mergeAssignedToScope({
            botId,
            etapa_pipeline: 'ganado',
            updatedAt: { $gte: since }
        }, req)).sort({ updatedAt: -1 }).toArray()
        const pendienteCierre = leadsGanadosSinOrden
            .filter((l: any) => !ordersPhoneSet.has((l.phone || '').toString()))
            .map((l: any) => ({
                _id: l._id,
                ticket_id: l.ticketId || (l._id ? `#${String(l._id).replace(/-/g, '').substring(0, 6).toUpperCase()}` : ''),
                phone: l.phone,
                customerPhone: l.phone?.split('@')[0] || '',
                customerName: l.contactName || l.name || 'Sin nombre',
                items: l.producto_interes || '—',
                total: 0,
                status: 'pendiente_confirmacion',
                estado_envio: 'por_confirmar',
                timestamp: l.updatedAt || l.createdAt,
                pendiente_cierre: true
            }))

        // 3. Goal Math (Advanced Config -> Meta Mensual)
        let metaMes = null;
        if (bot.advancedConfig?.level2?.metaMensual) {
            const meta = parseFloat(bot.advancedConfig.level2.metaMensual) || 0;
            if (meta > 0) {
                const firstDayMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
                const monthOrders = await db.collection('orders').find({
                    botId,
                    timestamp: { $gte: firstDayMonth },
                    status: { $ne: 'perdido' }
                }).toArray();

                const monthVentas = monthOrders.reduce((sum, o) => sum + (parseFloat(o.total) || 0), 0);

                metaMes = {
                    meta,
                    actual: monthVentas,
                    porcentaje: Math.min(Math.round((monthVentas / meta) * 100), 100)
                };
            }
        }

        res.json({
            kpis: {
                ventas_periodo: ventasPeriodo,
                pedidos_cerrados: pedidosCerrados,
                ticket_promedio: ticketPromedio,
                pagos_pendientes: pagosPendientes
            },
            meta_mes: metaMes,
            pedidos: {
                por_preparar: [...pendienteCierre, ...porPreparar],
                por_cobrar: porCobrar,
                completados: completados
            },
            periodo_dias: days
        })
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

// ─── UPDATE ORDER STATUS (with lifecycle transitions + WA notifications) ───
router.put('/orders/:botId/:orderId/status', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const botId = req.params.botId as string
        const orderId = req.params.orderId as string
        const { status, estado_envio } = req.body

        const bot = await db.collection('bot_configs').findOne({ _id: new ObjectId(botId), userId: req.userId })
        if (!bot) return res.status(404).json({ error: 'Bot no encontrado' })

        const order = await db.collection('orders').findOne({ _id: new ObjectId(orderId), botId })
        if (!order) return res.status(404).json({ error: 'Orden no encontrada' })

        const updateData: any = { status, updatedAt: new Date() }
        if (estado_envio) updateData.estado_envio = estado_envio

        await db.collection('orders').updateOne(
            { _id: new ObjectId(orderId), botId },
            { $set: updateData }
        )

        // ═══ WhatsApp notifications on shipping transitions ═══
        const customerPhone = order.customerPhone || order.phone
        const customerName = order.customerName || 'Cliente'
        const orderCode = order.orderCode || order.ticket_id || ''

        if (customerPhone) {
            try {
                if (estado_envio === 'en_proceso' || status === 'en_proceso') {
                    await botManager.sendTextMessage(botId, customerPhone,
                        `📦 ¡${customerName}! Tu pedido ${orderCode} ha sido despachado y está en camino. Te avisaremos cuando llegue.`
                    )
                    console.log(`[Lifecycle] 📦 WA enviado a ${customerPhone}: pedido en proceso`)
                } else if (estado_envio === 'entregado' || status === 'completado') {
                    await botManager.sendTextMessage(botId, customerPhone,
                        `✅ ¡${customerName}! Tu pedido ${orderCode} ha sido entregado. ¡Gracias por tu compra! Si necesitas algo, estamos aquí para ayudarte.`
                    )
                    console.log(`[Lifecycle] ✅ WA enviado a ${customerPhone}: pedido entregado`)

                    // ═══ AUTO-TRANSITION: Entregado → Post-Venta ═══
                    try {
                        const existingPV = await db.collection('leads').findOne({
                            botId, phone: customerPhone,
                            estado_clasificacion: { $in: ['post_venta_operativa', 'post_venta_soporte'] }
                        })
                        if (!existingPV) {
                            await db.collection('leads').updateOne(
                                { botId, phone: customerPhone },
                                {
                                    $set: {
                                        estado_clasificacion: 'post_venta_operativa',
                                        etapa_pipeline: 'ganado',
                                        updatedAt: new Date(),
                                        fecha_compra_original: order.timestamp,
                                        producto_relacionado: order.items || 'Múltiples',
                                        subtipo: 'operativa',
                                        estado: 'pendiente'
                                    }
                                },
                                { upsert: true }
                            )
                            console.log(`[Lifecycle] 🔄 Lead ${customerPhone} → Post-Venta automático`)
                        }
                    } catch (pvErr) {
                        console.error('[Lifecycle] Error creando Post-Venta:', pvErr)
                    }
                }
            } catch (waErr) {
                console.error('[Lifecycle] Error enviando WA de transición:', waErr)
            }
        }

        res.json({ success: true, message: 'Estado del pedido actualizado' })
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

// ─── SHIP ORDER — move from "Por crear" to "En tránsito" with courier/agency details ───
// Captures the shipping info the entrepreneur entered in the Envíos modal and
// notifies the client on WhatsApp with a tailored message per courier type.
router.put('/orders/:botId/:orderId/ship', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const botId = req.params.botId as string
        const orderId = req.params.orderId as string
        const { courier, agency, trackingNumber, deliveryEta, notes } = req.body || {}

        const bot = await db.collection('bot_configs').findOne({ _id: new ObjectId(botId), userId: req.userId })
        if (!bot) return res.status(404).json({ error: 'Bot no encontrado' })

        const order = await db.collection('orders').findOne({ _id: new ObjectId(orderId), botId })
        if (!order) return res.status(404).json({ error: 'Orden no encontrada' })

        const courierClean = String(courier || '').trim()
        const agencyClean = String(agency || '').trim()
        const trackingClean = String(trackingNumber || '').trim()
        const etaClean = String(deliveryEta || '').trim()
        const notesClean = String(notes || '').trim()

        await db.collection('orders').updateOne(
            { _id: new ObjectId(orderId), botId },
            {
                $set: {
                    status: 'en_proceso',
                    estado_envio: 'en_transito',
                    shippingCourier: courierClean,
                    shippingAgency: agencyClean,
                    trackingNumber: trackingClean,
                    deliveryEta: etaClean,
                    shippingNotes: notesClean,
                    shippedAt: new Date(),
                    updatedAt: new Date()
                }
            }
        )

        // Build a human message for the client with only the fields the entrepreneur filled in.
        // Resolución del JID: priorizamos `phone` (que normalmente ES el chat
        // JID con @lid o @s.whatsapp.net) sobre `customerPhone` (que suele ser
        // los 9 dígitos que el cliente escribió, sin @). Si neither tiene @,
        // asumimos s.whatsapp.net.
        let customerJid = ''
        const phoneField = String(order.phone || '').trim()
        const custPhoneField = String(order.customerPhone || '').trim()
        if (phoneField.includes('@')) customerJid = phoneField
        else if (custPhoneField.includes('@')) customerJid = custPhoneField
        else if (phoneField) customerJid = `${phoneField.replace(/\D/g, '')}@s.whatsapp.net`
        else if (custPhoneField) customerJid = `${custPhoneField.replace(/\D/g, '')}@s.whatsapp.net`

        const customerName = (order.customerName || 'Hola').trim()
        const orderCode = order.orderCode || ''

        let notified = false
        let notifyReason = 'unknown'
        const botStatus = botManager.getStatus(botId)
        console.log(`[Ship] orderId=${orderId} customerJid="${customerJid}" botStatus=${botStatus} phone="${phoneField}" customerPhone="${custPhoneField}"`)

        if (!customerJid) {
            notifyReason = 'no_jid'
            console.warn(`[Ship] ⚠️  No pude resolver JID del cliente para orden ${orderCode}. order.phone="${phoneField}" customerPhone="${custPhoneField}"`)
        } else if (botStatus !== 'connected') {
            notifyReason = `bot_${botStatus}`
            console.warn(`[Ship] ⚠️  Bot no conectado (status=${botStatus}) — no puedo enviar WhatsApp a ${customerJid}.`)
        } else {
            try {
                const lines: string[] = []
                lines.push(`📦 ¡${customerName}! Tu pedido${orderCode ? ' ' + orderCode : ''} ya fue despachado.`)
                if (courierClean) lines.push(`Courier: ${courierClean}`)
                if (agencyClean) lines.push(`Agencia de recojo: ${agencyClean}`)
                if (trackingClean) lines.push(`Número de guía: ${trackingClean}`)
                if (etaClean) lines.push(`Entrega estimada: ${etaClean}`)
                if (notesClean) lines.push(notesClean)
                lines.push('Cualquier consulta, escribinos por acá. ¡Gracias por tu compra!')
                const sent = await botManager.sendTextMessage(botId, customerJid, lines.join('\n'))
                if (sent) {
                    notified = true
                    notifyReason = 'sent'
                    console.log(`[Ship] ✅ WA enviado a ${customerJid}: pedido ${orderCode} en tránsito`)
                } else {
                    notifyReason = 'send_failed'
                    console.warn(`[Ship] ❌ sendTextMessage retornó false para ${customerJid} — Baileys probablemente perdió el socket o la sesión criptográfica del peer está rota.`)
                }
            } catch (waErr: any) {
                notifyReason = 'send_threw'
                console.error('[Ship] ❌ Error enviando WA al cliente:', waErr?.message || waErr)
            }
        }

        res.json({
            success: true,
            notified,
            notifyReason,
            message: notified ? 'Envío registrado y cliente notificado' : 'Envío registrado, pero NO se pudo notificar al cliente por WhatsApp'
        })
    } catch (error: any) {
        console.error('[Ship] Error:', error.message)
        res.status(500).json({ error: error.message })
    }
})

// ─── SOFT-DELETE ORDER (archive) — removes from Kanban/CRM but keeps row for audit ───
// Same pattern as /leads/:leadId soft-delete: mark archived=true instead of DELETE.
router.delete('/orders/:botId/:orderId', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const botId = req.params.botId as string
        const orderId = req.params.orderId as string

        const bot = await db.collection('bot_configs').findOne({ _id: new ObjectId(botId), userId: req.userId })
        if (!bot) return res.status(404).json({ error: 'Bot no encontrado' })

        // Soft-delete defensivo: intentamos primero con metadata de auditoría
        // (archivedAt/archivedBy). Si las columnas no existen en Supabase
        // (esquemas viejos) reintentamos sin metadata. El audit queda igual
        // en el `console.log` de abajo. Patrón análogo al de
        // `/notifications/:id/quote` con `shipping_cost`.
        let result = { modifiedCount: 0 }
        try {
            result = await db.collection('orders').updateOne(
                { _id: new ObjectId(orderId), botId },
                { $set: { archived: true, archivedAt: new Date(), archivedBy: req.userId, updatedAt: new Date() } }
            )
        } catch (writeErr: any) {
            const msg = String(writeErr?.message || '')
            // PostgREST no encuentra la columna → reintento sin metadata.
            if (/Could not find the .*column|column .* does not exist/i.test(msg)) {
                console.warn(`[CRM] orders.archive sin columnas archivedAt/By — reintentando sin metadata. (${msg})`)
                result = await db.collection('orders').updateOne(
                    { _id: new ObjectId(orderId), botId },
                    { $set: { archived: true, updatedAt: new Date() } }
                )
            } else {
                throw writeErr
            }
        }
        if (result.modifiedCount === 0) return res.status(404).json({ error: 'Pedido no encontrado' })

        console.log(`[CRM] 📦 Order ${orderId} archivado (soft-delete) por usuario ${req.userId}`)
        res.json({ status: 'archived' })
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

// ─── MODULE C: POST-VENTA (Operativa y Soporte) ───
router.get('/crm/postventa/:botId', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const botId = req.params.botId as string
        const fromRaw = (req.query.from as string) || ''
        const toRaw = (req.query.to as string) || ''
        const fromDate = fromRaw ? new Date(fromRaw) : null
        const toDate = toRaw ? new Date(toRaw) : null
        const days = parseInt(req.query.days as string) || 30

        const ownerUserId = resolveOwnerUserId(req)
        const bot = await db.collection('bot_configs').findOne({ _id: new ObjectId(botId), userId: ownerUserId })
        if (!bot) return res.status(404).json({ error: 'Bot no encontrado' })

        const since = fromDate && !isNaN(fromDate.getTime())
            ? fromDate
            : new Date(Date.now() - days * 24 * 60 * 60 * 1000)
        const until = toDate && !isNaN(toDate.getTime())
            ? new Date(toDate.getTime() + 24 * 60 * 60 * 1000 - 1)
            : null
        const rangeFilter: any = { $gte: since }
        if (until) rangeFilter.$lte = until

        // NOTE: filter `deleted/archived` in-memory, NOT in the DB query.
        // Supabase's `.neq('col', true)` excludes rows where the column is NULL
        // (3-valued logic), and most leads never have those flags set, so they
        // get hidden incorrectly from the postventa dashboard.
        const postVentaRaw = await db.collection('leads').find(_mergeAssignedToScope({
            botId,
            estado_clasificacion: { $in: ['post_venta_operativa', 'post_venta_soporte'] },
            updatedAt: rangeFilter
        }, req)).sort({ updatedAt: -1 }).toArray()
        const postVenta = postVentaRaw.filter((l: any) => l?.deleted !== true && l?.archived !== true)

        // KPIs
        const operativos = postVenta.filter(l => l.estado_clasificacion === 'post_venta_operativa')
        const soporte = postVenta.filter(l => l.estado_clasificacion === 'post_venta_soporte')

        // Deflection rate: % resolved by bot (containment)
        const withContainment = postVenta.filter(l => l.analysis?.bot_performance?.containment !== undefined)
        const contained = withContainment.filter(l => l.analysis?.bot_performance?.containment === true).length
        const deflectionRate = withContainment.length > 0 ? Math.round((contained / withContainment.length) * 100) : 0

        // Distribution
        const distribucion = {
            operativa: operativos.length,
            soporte: soporte.length,
            pct_operativa: postVenta.length > 0 ? Math.round((operativos.length / postVenta.length) * 100) : 0,
            pct_soporte: postVenta.length > 0 ? Math.round((soporte.length / postVenta.length) * 100) : 0
        }

        // Resolution time (approximate from updatedAt - createdAt)
        const resTimes = postVenta
            .filter(l => l.createdAt && l.updatedAt)
            .map(l => new Date(l.updatedAt).getTime() - new Date(l.createdAt).getTime())
            .filter(t => t > 0)
        const avgResolutionMs = resTimes.length > 0 ? resTimes.reduce((a, b) => a + b, 0) / resTimes.length : 0
        const avgResolutionHours = Math.round(avgResolutionMs / (1000 * 60 * 60) * 10) / 10

        // Map each lead to the full row shape the frontend expects.
        // The dashboard uses many of these fields for filtering, ordering and
        // rendering (Tier 1 / Tier 2 columns), so we pass through the lead
        // document's relevant attributes.
        const tabla = postVenta.map((l: any) => {
            const phoneClean = (l.from || l.phone || '').split('@')[0]
            const contactName = l.contactName || l.contact_name
                || l.datos_extraidos?.nombre_contacto
                || phoneClean
                || 'Anónimo'
            const tipoCaso = l.tipo_caso || l.tipoCaso
            const subtipo = l.subtipo
                || (tipoCaso === 'solicitud_devolucion' ? 'devolucion'
                  : tipoCaso === 'solicitud_cambio'    ? 'cambio'
                  : tipoCaso ? 'reclamo' : '')
            const asuntoBase = l.datos_extraidos?.subcategoria_problema
                || l.motivoEscalacion || l.motivo_escalacion
                || (tipoCaso ? tipoCaso.replace(/_/g, ' ') : '')
                || ''
            return {
                _id: l._id,
                contacto: contactName,
                nombre: contactName,
                numero: phoneClean,
                from: l.from || l.phone,
                phone: l.phone,
                order_id: l.order_id || l.orderId || l.datos_extraidos?.order_id || '—',
                ticket_id: l.ticketId || l.ticket_id || `#${(l._id || '').toString().substring(0, 6).toUpperCase()}`,
                subcategoria: l.estado_clasificacion === 'post_venta_soporte' ? '🔴 Soporte' : '🟡 Operativa',
                subtipo,
                tipo_caso: tipoCaso || '',
                asunto: asuntoBase || '—',
                producto_relacionado: l.producto_relacionado || l.productoRelacionado || l.producto_interes || l.productoInteres || '—',
                tipo_producto: l.tipo_producto || l.tipoProducto || l.producto_interes || '—',
                producto: l.producto_interes || '—',
                urgencia: l.datos_extraidos?.nivel_urgencia || l.analysis?.datos_extraidos?.nivel_urgencia || 'normal',
                estado: l.estado || (l.analysis?.bot_performance?.containment ? 'resuelto' : 'abierto'),
                estado_resolucion: l.analysis?.bot_performance?.containment ? '✅ Resuelto por IA' : '⏳ Abierto',
                resolucion_aplicada: l.resolucion_aplicada || l.solucion_aplicada || '',
                fecha_resolucion: l.fecha_resolucion || l.fechaResolucion || null,
                canal: l.channel || 'whatsapp',
                createdAt: l.createdAt,
                updatedAt: l.updatedAt,
                fecha_apertura: l.createdAt,
                ultima_interaccion: l.updatedAt,
                resuelto_por_ia: l.analysis?.bot_performance?.containment === true
            }
        })

        res.json({
            kpis: {
                deflection_rate: `${deflectionRate}%`,
                distribucion,
                tiempo_resolucion: avgResolutionHours > 0 ? `${avgResolutionHours}h` : '—',
                total_casos: postVenta.length,
                urgentes: soporte.filter(l => l.datos_extraidos?.nivel_urgencia === 'alta').length
            },
            tabla,
            periodo_dias: days
        })
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

// ==================== CRM TICKET SYSTEM (KBR-XXXXX) ====================

function generateKBRTicket(): string {
    const num = Math.floor(Math.random() * 90000) + 10000
    return `KBR-${num}`
}

function normalizePhone(phone: string): string {
    return (phone || '').replace(/@.*$/, '').replace(/[^0-9+]/g, '')
}

// Lookup or create a ticket for a given phone
router.post('/crm/ticket', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const { phone, name, botId } = req.body as { phone: string; name?: string; botId: string }
        if (!phone || !botId) return res.status(400).json({ error: 'phone and botId required' })

        const normalized = normalizePhone(phone)
        const col = db.collection('crm_tickets')

        // Lookup existing
        const existing = await col.findOne({ phone: normalized, botId })
        if (existing) {
            return res.json({ ticket: existing.ticket, phone: existing.phone, nombre: existing.nombre, isNew: false })
        }

        // Create
        const ticket = generateKBRTicket()
        const doc = {
            ticket,
            phone: normalized,
            nombre: name || normalized,
            botId,
            createdAt: new Date()
        }
        await col.insertOne(doc)

        // Create unique index (idempotent)
        await col.createIndex({ phone: 1, botId: 1 }, { unique: true }).catch(() => { })

        res.json({ ticket, phone: normalized, nombre: doc.nombre, isNew: true })
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

// Bulk list tickets for a bot
router.get('/crm/tickets/:botId', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const botId = req.params.botId as string

        const bot = await db.collection('bot_configs').findOne({ _id: new ObjectId(botId), userId: req.userId })
        if (!bot) return res.status(404).json({ error: 'Bot no encontrado' })

        const tickets = await db.collection('crm_tickets').find({ botId }).toArray()
        // Return as map: phone -> ticket
        const map: Record<string, { ticket: string; nombre: string }> = {}
        tickets.forEach((t: any) => { map[t.phone] = { ticket: t.ticket, nombre: t.nombre } })

        res.json({ tickets: map })
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

// Batch ensure tickets for a list of phones
router.post('/crm/tickets/batch', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const { phones, botId } = req.body as { phones: { phone: string; name: string }[]; botId: string }
        if (!phones || !botId) return res.status(400).json({ error: 'phones[] and botId required' })

        const col = db.collection('crm_tickets')
        await col.createIndex({ phone: 1, botId: 1 }, { unique: true }).catch(() => { })

        const result: Record<string, string> = {}

        for (const entry of phones) {
            const normalized = normalizePhone(entry.phone)
            if (!normalized) continue
            const existing = await col.findOne({ phone: normalized, botId })
            if (existing) {
                result[normalized] = existing.ticket
            } else {
                const ticket = generateKBRTicket()
                await col.insertOne({ ticket, phone: normalized, nombre: entry.name || normalized, botId, createdAt: new Date() }).catch(() => { })
                result[normalized] = ticket
            }
        }

        res.json({ tickets: result })
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

// ==================== NOTIFICATIONS (Dashboard Bell) ====================

router.get('/notifications/:botId', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const botId = req.params.botId as string
        const ownerUserId = resolveOwnerUserId(req)

        const bot = await db.collection('bot_configs').findOne({ _id: new ObjectId(botId), userId: ownerUserId })
        if (!bot) return res.status(404).json({ error: 'Bot no encontrado' })

        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

        // alerts_log no tiene assigned_to — vendedores usan GET /notifications (tabla notifications).
        const notifications = await db.collection('alerts_log').find({
            botId,
            type: { $in: ['HANDOFF', 'HANDOFF_CRM', 'PAYMENT_SCREENSHOT', 'PAYMENT_CONFIRMED', 'CRM_POSTVENTA_URGENTE'] },
            createdAt: { $gte: sevenDaysAgo }
        }).sort({ createdAt: -1 }).limit(50).toArray()

        const unreadCount = notifications.filter(n => !n.read).length

        res.json({
            notifications: notifications.map(n => ({
                _id: n._id,
                type: n.type,
                message: n.message || '',
                leadPhone: n.leadPhone || '',
                reason: n.reason || '',
                read: !!n.read,
                createdAt: n.createdAt
            })),
            unreadCount
        })
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

// Submit a shipping quote amount for a variable-cost order. Sends the amount to the
// client via WhatsApp (integrating into the workflow: envío + nuevo total + pedir
// confirmación) and resumes the bot on that conversation.
router.post('/notifications/:id/shipping-quote', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const notifId = req.params.id as string
        const { amount } = req.body || {}
        const cost = parseFloat(String(amount))
        if (isNaN(cost) || cost < 0) return res.status(400).json({ error: 'Monto inválido' })

        const notif = await db.collection('notifications').findOne({ _id: new ObjectId(notifId) })
        if (!notif || notif.type !== 'SHIPPING_QUOTE') return res.status(404).json({ error: 'Notificación no encontrada' })

        const bot = await db.collection('bot_configs').findOne({ _id: new ObjectId(notif.botId), userId: req.userId })
        if (!bot) return res.status(403).json({ error: 'No autorizado' })

        const subtotal = Number(notif.data?.subtotal) || 0
        const total = subtotal + cost
        const clientName = notif.data?.clientName || ''
        const greeting = clientName ? `${clientName}, ` : ''

        // ─── Resolver el "payment_timing" del envío para esta zona ───
        // El emprendedor configuró cómo se cobra el envío (upfront / partial /
        // on_delivery) por grupo. Si está en `partial`, el cliente paga sólo
        // un % del envío ahora — el resto al recibir. Sin esto, el mensaje
        // dice "Costo: S/15" lleno y deja al cliente pagando 15 ahora cuando
        // solo debía adelantar 7.50. Buscamos el grupo cuyo `departments`
        // matchea con la región contenida en `direccion_o_zona`. Filtramos a
        // los `cost_strategy=variable` porque ese es el camino que llega aquí.
        const direccion = String(notif.data?.direccion_o_zona || '')
        let paymentTiming: 'upfront' | 'partial' | 'on_delivery' | '' = ''
        let partialPct = 50
        try {
            const shippingCfg = await getShippingConfig(notif.botId)
            const groups: any[] = Array.isArray((shippingCfg as any)?.groups) ? (shippingCfg as any).groups : []
            if (groups.length > 0 && direccion) {
                const norm = (s: string) => String(s || '').toLowerCase()
                    .normalize('NFD').replace(/[̀-ͯ]/g, '')
                const dirN = norm(direccion)
                for (const g of groups) {
                    const depts: string[] = Array.isArray(g.departments) ? g.departments : []
                    const matches = depts.some(code => {
                        const name = PE_DEPT_NAMES[code] || code
                        const nameN = norm(name)
                        return !!nameN && (dirN.includes(nameN) || nameN.includes(dirN))
                    })
                    if (matches && String(g.cost_strategy || '').toLowerCase() === 'variable') {
                        const t = String(g.payment_timing || '').toLowerCase()
                        if (t === 'upfront' || t === 'partial' || t === 'on_delivery') paymentTiming = t
                        const n = Number(g.payment_partial_pct)
                        if (Number.isFinite(n) && n > 0 && n < 100) partialPct = n
                        break
                    }
                }
            }
        } catch (e: any) {
            console.warn('[shipping-quote] no pude resolver payment_timing del grupo:', e?.message || e)
        }

        // Construir el mensaje al cliente respetando el payment_timing real.
        const adelantoEnvio = paymentTiming === 'partial' ? +(cost * (partialPct / 100)).toFixed(2) : 0
        const restanteEnvio = paymentTiming === 'partial' ? +(cost - adelantoEnvio).toFixed(2) : 0

        const lines: string[] = []
        lines.push(`${greeting}ya calculé tu envío.`)
        if (subtotal > 0) lines.push(`Subtotal del producto: S/${subtotal.toFixed(2)}`)
        lines.push(`Costo del envío: S/${cost.toFixed(2)}`)
        if (paymentTiming === 'partial') {
            lines.push(`Pagas el envío en partes: S/${adelantoEnvio.toFixed(2)} ahora (${partialPct}% de adelanto) y S/${restanteEnvio.toFixed(2)} al recibirlo.`)
        } else if (paymentTiming === 'on_delivery') {
            lines.push(`El envío se paga al recibirlo (contraentrega). No se cobra ahora.`)
        }
        if (subtotal > 0) {
            // Total que el cliente debe pagar AHORA = subtotal del producto + porción
            // del envío que se cobra en este momento (según payment_timing).
            const upfrontShipping = paymentTiming === 'partial' ? adelantoEnvio
                                  : paymentTiming === 'on_delivery' ? 0
                                  : cost
            const totalAhora = +(subtotal + upfrontShipping).toFixed(2)
            lines.push(`Total a pagar ahora: S/${totalAhora.toFixed(2)}`)
        }
        lines.push('')
        lines.push('¿Confirmas tu pedido? Si es así, te comparto los datos para el pago 😊')
        const clientMsg = lines.join('\n')

        const clientJid = notif.data?.phone
        if (!clientJid) return res.status(400).json({ error: 'La notificación no tiene destinatario' })
        await botManager.sendTextMessage(notif.botId, clientJid, clientMsg)

        // Persist the quote onto the active order if it exists (so the downstream
        // resumen/pago steps use the right total). The WhatsApp message has
        // already been delivered at this point, so any DB hiccup here (e.g. a
        // missing `shipping_cost` column on older Supabase schemas) must NOT
        // abort the rest of the flow — we still need to resume the bot and
        // mark the notification as resolved. We retry once without the
        // optional `shipping_cost` field if the first write fails.
        try {
            await db.collection('orders').updateOne(
                { botId: notif.botId, phone: clientJid, status: { $nin: ['completado', 'cancelado'] } },
                { $set: { shipping_cost: cost, total, updatedAt: new Date() } }
            )
        } catch (orderErr: any) {
            const msg = String(orderErr?.message || '')
            if (/shipping_cost/i.test(msg) && /schema cache|column/i.test(msg)) {
                console.warn('[shipping-quote] orders.shipping_cost column missing — falling back to total-only update. Run scripts/add_shipping_cost.sql in Supabase to add it.')
                try {
                    await db.collection('orders').updateOne(
                        { botId: notif.botId, phone: clientJid, status: { $nin: ['completado', 'cancelado'] } },
                        { $set: { total, updatedAt: new Date() } }
                    )
                } catch (retryErr) {
                    console.error('[shipping-quote] orders fallback update failed:', retryErr)
                }
            } else {
                console.error('[shipping-quote] orders update failed (continuing):', orderErr)
            }
        }

        // Resume bot for this conversation so Qhatu can continue the workflow with the
        // entrepreneur's answer injected as context.
        // Importante: TAMBIÉN agregamos el mensaje de cotización al `history` del
        // chat. Sin esto, el LLM en el siguiente turno no ve que ya se cotizó y
        // alucina "déjame calcular el envío" cuando el cliente confirma. Con el
        // mensaje en `history`, el LLM entiende que el envío ya está cotizado y
        // avanza al PASO 6 (métodos de pago).
        const historyKey = `${notif.botId}_${clientJid}`
        const existingChat = await db.collection('chat_history').findOne({ key: historyKey })
        const currentHistory: any[] = existingChat?.history || []
        const updatedHistory = [
            ...currentHistory,
            { role: 'model', content: clientMsg, parts: [{ text: clientMsg }], timestamp: new Date(), source: 'shipping_quote' }
        ].slice(-40)
        await db.collection('chat_history').updateOne(
            { key: historyKey },
            { $set: { history: updatedHistory, botPaused: false, pausedAt: null, pauseReason: null, updatedAt: new Date() } },
            { upsert: true }
        )
        await db.collection('wa_chats').updateOne(
            { botId: notif.botId, chatJid: clientJid },
            { $set: { isBotPaused: false, lastMessage: clientMsg.slice(0, 200), lastMessageAt: new Date(), lastMessageFromMe: true } }
        )

        await db.collection('notifications').updateOne(
            { _id: new ObjectId(notifId) },
            { $set: { isRead: true, resolvedAction: 'quoted', resolvedAt: new Date(), data: { ...notif.data, shipping_cost: cost, total } } }
        )

        res.json({ ok: true, cost, total })
    } catch (err: any) {
        console.error('[POST /notifications/:id/shipping-quote]', err)
        res.status(500).json({ error: err.message })
    }
})

router.delete('/notifications/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const notifId = req.params.id as string
        if (!notifId) return res.status(400).json({ error: 'ID requerido' })

        const notif = await db.collection('notifications').findOne({ _id: new ObjectId(notifId) })
        if (!notif) return res.status(404).json({ error: 'Notificación no encontrada' })

        // Ownership check: either direct userId match, or via the bot
        const ownedByUser = notif.userId && String(notif.userId) === String(req.userId)
        if (!ownedByUser && notif.botId) {
            const bot = await db.collection('bot_configs').findOne({ _id: new ObjectId(notif.botId), userId: req.userId })
            if (!bot) return res.status(403).json({ error: 'No autorizado' })
        } else if (!ownedByUser) {
            return res.status(403).json({ error: 'No autorizado' })
        }

        await db.collection('notifications').deleteOne({ _id: new ObjectId(notifId) })
        res.json({ ok: true })
    } catch (err: any) {
        console.error('[DELETE /notifications/:id]', err)
        res.status(500).json({ error: err.message })
    }
})

router.put('/notifications/:id/read', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const notifId = req.params.id as string
        const { action } = req.body || {}

        // Fetch notification to get client phone and bot info
        const notif = await db.collection('notifications').findOne({ _id: new ObjectId(notifId) })

        // Update notification status
        await db.collection('notifications').updateOne(
            { _id: new ObjectId(notifId) },
            { $set: { isRead: true, resolvedAction: action || 'read', resolvedAt: new Date(), updatedAt: new Date() } }
        )

        // Send WhatsApp message + create/update order for payment actions
        if (notif && (action === 'confirm' || action === 'reject') && notif.data?.phone && notif.botId) {
            const { botManager } = await import('../services/bot-manager')
            const clientJid = notif.data.phone.includes('@') ? notif.data.phone : `${notif.data.phone}@s.whatsapp.net`
            // Resolve a display-friendly name: SOLO usamos el nombre real que
            // el cliente declaró en el flujo (lead.contactName). ANTES caía
            // al pushName de WhatsApp (wa_chats.chatName), lo que mandaba
            // saludos como "JOSE, hemos verificado tu pago" cuando el cliente
            // nunca dijo que se llamaba José. Si no tenemos nombre real,
            // dejamos clientName vacío y el saludo arranca sin nombre
            // (`${greeting}` queda vacío más abajo).
            let clientName = (notif.data.clientName || '').trim()
            if (!clientName || /^\d+$/.test(clientName) || !/[A-Za-zÁÉÍÓÚáéíóúñÑ]{2,}/.test(clientName)) {
                clientName = ''
                const lead = await db.collection('leads').findOne({ botId: notif.botId, phone: clientJid })
                const leadName = (lead?.contactName || lead?.contact_name || '').trim()
                if (leadName && !/^\d+$/.test(leadName) && /[A-Za-zÁÉÍÓÚáéíóúñÑ]{2,}/.test(leadName)) {
                    clientName = leadName
                }
            }
            const clientPhone = notif.data.clientPhone || notif.data.phone?.split('@')[0] || ''
            const greeting = clientName ? `${clientName}, ` : ''

            if (action === 'confirm') {
                // 1. Send WhatsApp confirmation
                const msg = `${greeting}hemos verificado tu pago exitosamente.\n\nProcederemos con la preparación y envío de tu pedido. Te estaremos informando sobre el estado de tu entrega.\n\nGracias por tu compra.`
                await botManager.sendTextMessage(notif.botId, clientJid, msg)

                // 2. Create or update order so it appears in "Envíos por Crear"
                let amount = parseFloat(notif.data.amount) || 0
                const existingOrder = notif.data.orderId
                    ? await db.collection('orders').findOne({ _id: new ObjectId(notif.data.orderId) })
                    : await db.collection('orders').findOne({ botId: notif.botId, phone: notif.data.phone, status: { $nin: ['completado', 'cancelado'] } })

                if (existingOrder) {
                    // ─── Cómputo correcto de monto_pagado / monto_pendiente según payment_timing ───
                    // - upfront/fixed/free: el cliente pagó TODO (subtotal + envío). pendiente=0.
                    // - partial:            el cliente pagó subtotal + adelanto del envío. pendiente=resto.
                    // - on_delivery:        el cliente pagó SOLO el subtotal. pendiente=envío entero.
                    const subtotalProd = parseFloat((existingOrder as any).subtotal_producto || '0') || 0
                    const envioCost = parseFloat((existingOrder as any).shipping_cost || '0') || 0
                    const totalOrd = parseFloat(existingOrder.total || '0') || 0
                    const timing = String((existingOrder as any).payment_timing || '').toLowerCase()

                    // Si payment_timing está vacío (orders viejas sin el campo) o
                    // los montos no cuadran, caemos al cálculo legacy (amount o total).
                    let newPaid: number, newPendiente: number
                    if (timing === 'on_delivery' && subtotalProd > 0) {
                        newPaid = subtotalProd
                        newPendiente = +envioCost.toFixed(2)
                    } else if (timing === 'partial' && subtotalProd > 0 && envioCost > 0) {
                        // El % de adelanto puede no estar guardado — para no inventar,
                        // tomamos el `amount` que el LLM puso en PAYMENT_RECEIPT como
                        // lo realmente pagado. Si está vacío, usamos subtotal+50% envío.
                        newPaid = amount > 0 ? amount : +(subtotalProd + envioCost * 0.5).toFixed(2)
                        newPendiente = +(totalOrd - newPaid).toFixed(2)
                    } else if (timing === 'upfront' || timing === '' || timing === null) {
                        // Pagó todo, o no sabemos timing → asumimos pagó todo.
                        newPaid = totalOrd > 0 ? totalOrd : (amount || 0)
                        newPendiente = +Math.max(0, totalOrd - newPaid).toFixed(2)
                    } else {
                        // free / unknown timing
                        newPaid = totalOrd
                        newPendiente = 0
                    }

                    // El status depende de si quedó saldo pendiente.
                    const newStatus = newPendiente > 0.01 ? 'pago_parcial' : 'pagado'

                    await db.collection('orders').updateOne(
                        { _id: existingOrder._id },
                        { $set: {
                            status: newStatus,
                            monto_pagado: newPaid,
                            monto_pendiente: newPendiente,
                            estado_envio: 'por_crear',
                            fecha_pago: new Date(),
                            updatedAt: new Date()
                        } }
                    )
                    console.log(`[Notifications] Payment CONFIRMED — Order ${existingOrder.orderCode} timing=${timing || 'unknown'} pagado=S/${newPaid} pendiente=S/${newPendiente} status=${newStatus}`)
                } else {
                    // No existing order → last-resort derivation of amount + items
                    // from business_info when the client jumped straight to sending
                    // the receipt without ever closing a formal order. Without this
                    // the fallback order is created with total=0 and "Pedido
                    // confirmado por comprobante" as items, which is useless for
                    // the entrepreneur's Ventas/Envíos boards.
                    let itemsLabel = 'Pedido confirmado por comprobante'
                    let productsArr: any[] = []
                    let cantidadTotal = 0
                    if (amount <= 0) {
                        try {
                            const bizInfo = await db.collection('business_info').findOne({ botId: notif.botId })
                            const products = Array.isArray(bizInfo?.products) ? bizInfo.products : []
                            if (products.length === 1) {
                                const p = products[0]
                                const price = parseFloat(p.price || p.precio || 0) || 0
                                if (price > 0) {
                                    amount = price
                                    itemsLabel = `${p.name || p.nombre || 'Producto'} x1`
                                    productsArr = [{ name: p.name || p.nombre || 'Producto', qty: 1 }]
                                    cantidadTotal = 1
                                }
                            }
                        } catch (_) { /* keep defaults */ }
                    }

                    const orderCode = '#KP-' + Math.floor(10000 + Math.random() * 90000)
                    await db.collection('orders').insertOne({
                        botId: notif.botId,
                        phone: notif.data.phone,
                        customerName: clientName,
                        customerPhone: clientPhone,
                        items: itemsLabel,
                        products: productsArr,
                        cantidad_total: cantidadTotal,
                        total: amount,
                        monto_pagado: amount,
                        monto_pendiente: 0,
                        timestamp: new Date(),
                        orderCode,
                        status: 'pagado',
                        estado_envio: 'por_crear',
                        fecha_pago: new Date(),
                        createdAt: new Date()
                    })
                    console.log(`[Notifications] Payment CONFIRMED — New order ${orderCode} created for ${clientName} total=S/${amount}`)
                }

                // 3. Update lead pipeline to "ganado"
                await db.collection('leads').updateOne(
                    { botId: notif.botId, phone: notif.data.phone },
                    { $set: { etapa_pipeline: 'ganado', updatedAt: new Date() } }
                )

                console.log(`[Notifications] Payment CONFIRMED — WhatsApp sent to ${clientJid}`)
            } else if (action === 'reject') {
                const msg = `${greeting}hemos revisado el comprobante que nos enviaste y no pudimos verificar el pago.\n\nPor favor, envíanos nuevamente una captura clara del comprobante donde se vea el monto, la fecha y el número de operación.\n\nEstamos aquí para ayudarte.`
                await botManager.sendTextMessage(notif.botId, clientJid, msg)
                console.log(`[Notifications] Payment REJECTED — WhatsApp sent to ${clientJid}`)
            }
        }

        res.json({ success: true })
    } catch (error: any) {
        console.error('[Notifications] Error:', error.message)
        res.status(500).json({ error: error.message })
    }
})

router.put('/notifications/:botId/read-all', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const botId = req.params.botId as string

        const bot = await db.collection('bot_configs').findOne({ _id: new ObjectId(botId), userId: req.userId })
        if (!bot) return res.status(404).json({ error: 'Bot no encontrado' })

        const filter = { botId, read: { $ne: true }, type: { $in: ['HANDOFF', 'HANDOFF_CRM', 'PAYMENT_SCREENSHOT', 'PAYMENT_CONFIRMED', 'CRM_POSTVENTA_URGENTE'] } }
        try {
            await db.collection('alerts_log').updateMany(filter, { $set: { read: true, readAt: new Date() } })
        } catch (e: any) {
            // Si la columna read_at aún no existe en Supabase (ver
            // scripts/migration_missing_columns.sql), degradamos sin timestamp —
            // lo importante es marcar como leído para que la UI actualice.
            console.warn(`[/notifications/read-all] sin read_at, degradando: ${e.message}`)
            await db.collection('alerts_log').updateMany(filter, { $set: { read: true } })
        }

        res.json({ success: true })
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

// ==================== SPRINT 1: NOTIFICATIONS & SALES CRM ACTIONS ====================

// GET /api/notifications
router.get('/notifications', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        // Filtro opcional por tienda. Si llega ?botId=<id>, se devuelven solo
        // las notifs de esa tienda. Si llega ?botId=all (o no llega), se mantienen
        // todas (compatibilidad con clients que no manden el query). Esto evita
        // que un usuario con varias tiendas vea los pagos/handoffs de una en el
        // panel de otra.
        const botIdFilter = (req.query.botId as string | undefined) || ''
        const ownerUserId = resolveOwnerUserId(req)
        const filter: any = { userId: ownerUserId }
        if (botIdFilter && botIdFilter !== 'all') filter.botId = botIdFilter
        console.log('[DEBUG][GET /notifications] userId:', ownerUserId, 'botId filter:', botIdFilter || 'all')
        const items = await db.collection('notifications').find(_mergeAssignedToScope(filter, req)).sort({ createdAt: -1 }).limit(50).toArray()
        console.log('[DEBUG][GET /notifications] Found', items.length, 'notifications, types:', items.map((n: any) => n.type))

        // Enrich each notification with el nombre REAL del cliente (del lead,
        // solo si lo dio explícitamente) + el teléfono real. ANTES enriquecía
        // con `wa_chats.chatName` (= pushName del cliente, p. ej. "JOSE"), lo
        // que metía el alias de WhatsApp en notificaciones que después se
        // mostraban como "Comprobante: JOSE" cuando el cliente nunca dijo su
        // nombre. Política "0% suposición": si el lead.contactName está vacío
        // dejamos clientName vacío → el frontend muestra "Ticket #XXX".
        const jidsNeeded = new Set<string>()
        for (const n of items) {
            const jid = n?.data?.phone
            if (jid) jidsNeeded.add(jid)
        }
        const leadEnrich = new Map<string, { name: string; phone: string }>()
        if (jidsNeeded.size > 0) {
            try {
                const botIds = Array.from(new Set(items.map((n: any) => n.botId).filter(Boolean)))
                for (const bId of botIds) {
                    // leads: única fuente del nombre REAL (declarado en flujo).
                    const leadRows = await db.collection('leads').find({ botId: bId }).toArray().catch(() => [])
                    // wa_chats: SOLO para resolver teléfono real (cuando el JID
                    // es @lid y los dígitos del JID no son el celular). NUNCA
                    // para el nombre.
                    const chatRows = await db.collection('wa_chats').find({ botId: bId }).toArray().catch(() => [])
                    const chatPhoneByJid = new Map<string, string>()
                    for (const wc of chatRows) {
                        if (wc.phoneNumber) chatPhoneByJid.set(wc.chatJid, String(wc.phoneNumber))
                    }
                    for (const lead of leadRows) {
                        const jid = String(lead?.phone || '')
                        if (!jidsNeeded.has(jid)) continue
                        const cn = String(lead?.contactName || lead?.contact_name || '').trim()
                        const looksHuman = cn && !/^\d+$/.test(cn) && /[A-Za-zÁÉÍÓÚáéíóúñÑ]{2,}/.test(cn)
                        leadEnrich.set(jid, {
                            name: looksHuman ? cn : '',
                            phone: chatPhoneByJid.get(jid) || ''
                        })
                    }
                }
            } catch (_) { /* ignore — fall back to stored data */ }
        }
        for (const n of items) {
            const jid = n?.data?.phone
            const resolved = jid ? leadEnrich.get(jid) : null
            if (!resolved) continue
            n.data = n.data || {}
            const storedName = (n.data.clientName || '').trim()
            // Si el lead dio su nombre real: usarlo SIEMPRE (incluso pisando el
            // storedName antiguo, que pudo guardarse cuando el bug del pushName
            // estaba activo). Si NO dio nombre: limpiar storedName si era un
            // pushName/alias (mantenemos solo si era texto que el LLM extrajo
            // del propio mensaje del cliente).
            if (resolved.name) {
                n.data.clientName = resolved.name
                if (typeof n.title === 'string' && n.title.startsWith('Comprobante:')) {
                    n.title = `Comprobante: ${resolved.name}`
                }
                if (typeof n.message === 'string') {
                    n.message = n.message.replace(/^Nombre: [^\n]+/, `Nombre: ${resolved.name}`)
                }
            } else if (storedName && !/[A-Za-zÁÉÍÓÚáéíóúñÑ]{2,}/.test(storedName)) {
                // storedName con solo dígitos / símbolos — limpiarlo para que
                // el frontend muestre Ticket #XXX.
                n.data.clientName = ''
            }
            const storedPhone = (n.data.clientPhone || '').trim()
            const phoneLooksLikeLid = /^\d+$/.test(storedPhone) && (jid || '').endsWith('@lid')
            if (resolved.phone && (!storedPhone || phoneLooksLikeLid)) {
                n.data.clientPhone = resolved.phone
                if (typeof n.message === 'string') {
                    n.message = n.message.replace(/^Celular: [^\n]+/m, `Celular: ${resolved.phone}`)
                }
            }
        }

        // get unread count — respeta el mismo filtro de tienda que el listado
        // de items, para que el badge refleje "lo que el usuario ve en el panel"
        // y no un total global que confunde.
        const unreadFilter: any = { userId: req.userId, isRead: false }
        if (botIdFilter && botIdFilter !== 'all') unreadFilter.botId = botIdFilter
        const unreadRows = await db.collection('notifications').find(unreadFilter).toArray()
        const unreadCount = unreadRows.length

        res.json({ success: true, notifications: items, unreadCount })
    } catch (e: any) {
        res.status(500).json({ error: e.message })
    }
})

// POST /api/notifications/read
router.post('/notifications/read', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        await db.collection('notifications').updateMany({ userId: req.userId, isRead: false }, { $set: { isRead: true } })
        res.json({ success: true })
    } catch (e: any) {
        res.status(500).json({ error: e.message })
    }
})

// POST /api/sales/:id/confirm
router.post('/sales/:id/confirm', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const orderId = req.params.id as string
        const order = await db.collection('orders').findOne({ _id: new ObjectId(orderId) })
        if (!order) return res.status(404).json({ error: 'Order not found' })

        // Verify ownership
        const bot = await db.collection('bot_configs').findOne({ _id: new ObjectId(order.botId), userId: req.userId })
        if (!bot) return res.status(403).json({ error: 'Unauthorized' })

        // Update order status to 'pago_completo'
        await db.collection('orders').updateOne(
            { _id: new ObjectId(orderId) },
            { $set: { status: 'pago_completo', updatedAt: new Date() } }
        )

        // Send confirmation WhatsApp to buyer
        const customerPhone = order.customerPhone || order.phone
        if (customerPhone) {
            const msg = `¡Tu pago ha sido confirmado! Estamos procesando tu pedido 🎉`
            await botManager.sendTextMessage(order.botId, customerPhone, msg)
        }

        res.json({ success: true, message: 'Pago verificado y cliente notificado' })
    } catch (e: any) {
        res.status(500).json({ error: e.message })
    }
})

// POST /api/sales/:id/reject
router.post('/sales/:id/reject', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const orderId = req.params.id as string
        const order = await db.collection('orders').findOne({ _id: new ObjectId(orderId) })
        if (!order) return res.status(404).json({ error: 'Order not found' })

        const bot = await db.collection('bot_configs').findOne({ _id: new ObjectId(order.botId), userId: req.userId })
        if (!bot) return res.status(403).json({ error: 'Unauthorized' })

        await db.collection('orders').updateOne(
            { _id: new ObjectId(orderId) },
            { $set: { status: 'cancelado', updatedAt: new Date() } }
        )

        const customerPhone = order.customerPhone || order.phone
        if (customerPhone) {
            const msg = `Hubo un problema con tu comprobante. ¿Podrías enviarlo nuevamente?`
            await botManager.sendTextMessage(order.botId, customerPhone, msg)
        }

        res.json({ success: true, message: 'Pago rechazado y cliente notificado' })
    } catch (e: any) {
        res.status(500).json({ error: e.message })
    }
})

// ═══ LIFECYCLE: Confirm Payment (Lead → Venta) ═══
router.post('/sales/confirm-payment/:notifId', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const notifId = req.params.notifId as string

        // Find the notification
        const notif = await db.collection('alerts_log').findOne({ _id: new ObjectId(notifId) })
        if (!notif) return res.status(404).json({ error: 'Notificación no encontrada' })

        const botId = notif.botId
        const phone = notif.leadPhone

        // Verify ownership
        const bot = await db.collection('bot_configs').findOne({ _id: new ObjectId(botId), userId: req.userId })
        if (!bot) return res.status(403).json({ error: 'No autorizado' })

        // Find the lead
        const lead = await db.collection('leads').findOne({ botId, phone })

        // Check if an order already exists for this phone (avoid duplicates)
        const existingOrder = await db.collection('orders').findOne({
            botId, phone,
            status: { $nin: ['cancelado', 'perdido'] },
            timestamp: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } // within last 24h
        })

        let orderId: string
        if (existingOrder) {
            // Spec Qhatu: si la orden ya estaba en 'entregado_pago_pendiente' (entregada pero
            // con saldo pendiente), confirmar el pago AHORA cierra el ciclo Venta → Postventa
            // que se quedó en pausa esperando el pago completo.
            const wasDeliveredAwaitingPayment = existingOrder.status === 'entregado_pago_pendiente'

            // Update existing order to confirmed
            await db.collection('orders').updateOne(
                { _id: existingOrder._id },
                {
                    $set: wasDeliveredAwaitingPayment
                        ? { status: 'completado', estado_envio: 'entregado', completedAt: new Date(), updatedAt: new Date() }
                        : { status: 'pago_completo', estado_envio: 'por_crear', updatedAt: new Date() }
                }
            )
            orderId = existingOrder._id.toString()

            // Si veníamos de 'entregado_pago_pendiente', AHORA crea el ticket de postventa
            // que se difirió en el shipping-status endpoint (per spec: pago 100% + entregado).
            if (wasDeliveredAwaitingPayment) {
                const twoWeeksFromNow = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
                await db.collection('postventa_tickets').insertOne({
                    botId,
                    orderId,
                    orderCode: existingOrder.orderCode,
                    phone: existingOrder.phone,
                    customerName: existingOrder.customerName,
                    producto: existingOrder.items,
                    estado_ticket: 'vencido',
                    ventana_reclamo_hasta: twoWeeksFromNow,
                    tipo_caso: null,
                    solucion_aplicada: null,
                    fecha_solucion: null,
                    createdAt: new Date()
                })
                console.log(`[CRM] ✅ Postventa creada retroactivamente para orden ${orderId} tras confirmar saldo pendiente`)
            }
        } else {
            // Create new order from lead data
            const orderCode = '#KP-' + Math.floor(10000 + Math.random() * 90000)
            const newOrder = {
                botId,
                phone,
                customerName: lead?.contactName || lead?.datos_extraidos?.nombre_contacto || phone.split('@')[0],
                customerPhone: phone,
                items: lead?.producto_interes || lead?.datos_extraidos?.producto_interes || 'Producto',
                total: notif.data?.amount || lead?.valor_potencial || 0,
                timestamp: new Date(),
                orderCode,
                status: 'pago_completo',
                estado_envio: 'por_crear',
                tipo_pago: notif.data?.method || 'Transferencia',
                metodo_pago: notif.data?.method || 'BCP',
                monto_pagado: notif.data?.amount || 0,
                fecha_pago: new Date()
            }
            const result = await db.collection('orders').insertOne(newOrder)
            orderId = result.insertedId.toString()
        }

        // Update lead pipeline to 'ganado'
        if (lead) {
            await db.collection('leads').updateOne(
                { _id: lead._id },
                { $set: { etapa_pipeline: 'ganado', estadoConversacion: 'cerrada', updatedAt: new Date() } }
            )
        }

        // Mark notification as confirmed
        await db.collection('alerts_log').updateOne(
            { _id: new ObjectId(notifId) },
            { $set: { read: true, confirmed: true, confirmedAt: new Date(), orderId } }
        )

        // Send WhatsApp confirmation to customer
        const customerPhone = phone
        if (customerPhone) {
            try {
                const name = lead?.contactName || 'Cliente'
                await botManager.sendTextMessage(botId, customerPhone,
                    `🎉 ¡${name}! Tu pago ha sido confirmado exitosamente. Estamos preparando tu pedido. ¡Te avisaremos cuando lo despachemos!`
                )
            } catch (waErr) {
                console.error('[Lifecycle] Error enviando WA de confirmación:', waErr)
            }
        }

        console.log(`[Lifecycle] ✅ Pago confirmado: Lead ${phone} → Orden ${orderId}`)
        res.json({ success: true, orderId, message: 'Pago confirmado. Lead movido a Ventas.' })
    } catch (e: any) {
        res.status(500).json({ error: e.message })
    }
})

// ═══ CONFIRM/EDIT Learned Data from Handoff ═══
router.post('/notifications/:id/confirm-learned', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const notifId = req.params.id as string
        const { action, editedData } = req.body // action: 'confirm' | 'edit' | 'reject'
        console.log('[DEBUG][POST /confirm-learned] notifId:', notifId, 'action:', action)

        const notif = await db.collection('notifications').findOne({ _id: new ObjectId(notifId) })
        if (!notif || notif.type !== 'learned_data') return res.status(404).json({ error: 'Notificación no encontrada' })

        if (action === 'confirm' || action === 'edit') {
            const dataToSave = action === 'edit' ? editedData : notif.data
            // Update learned_knowledge to confirmed status
            await db.collection('learned_knowledge').updateOne(
                { botId: notif.botId, pregunta: notif.data.pregunta_original, status: 'pending_confirmation' },
                { $set: { status: 'confirmed', respuesta: dataToSave.respuesta_aprendida || notif.data.respuesta_aprendida, confirmedAt: new Date() } }
            )
            // Add to business_info FAQs / knowledge base (fetch-append-update since Supabase has no $push)
            const bizDoc = await db.collection('business_info').findOne({ botId: notif.botId })
            const existingFaqs = bizDoc?.learned_faqs || []
            const newFaq = { pregunta: notif.data.pregunta_original, respuesta: dataToSave.respuesta_aprendida || notif.data.respuesta_aprendida, confirmedAt: new Date() }
            await db.collection('business_info').updateOne(
                { botId: notif.botId },
                { $set: { learned_faqs: [...existingFaqs, newFaq], updatedAt: new Date() } },
                { upsert: true }
            )
            // Also surface the learning in the Mi Qhatu mind map as a pending node
            // so the emprendedor can position/edit/approve it visually. Failures
            // here must not block the main confirmation flow.
            try {
                const question = String(notif.data.pregunta_original || '').trim().slice(0, 180)
                const answer = String(dataToSave.respuesta_aprendida || notif.data.respuesta_aprendida || '').trim()
                if (question) {
                    await addLearnedNode(
                        notif.botId,
                        question,
                        answer,
                        { notification_id: notifId, origin: 'confirm-learned' }
                    )
                }
            } catch (e: any) {
                console.warn('[confirm-learned] could not create workflow node:', e?.message || e)
            }
        } else if (action === 'reject') {
            // B-18: RECHAZAR — marca como rejected Y bloquea que Qhatu lo vuelva a sugerir.
            // Behavior: el dato aprendido se descarta permanentemente para este bot.
            // Qhatu NO usará este dato en futuras conversaciones, ni lo volverá a proponer
            // como sugerencia. Si el mismo dato se aprende de nuevo (otro handoff), se crea
            // un nuevo registro que deberá ser confirmado independientemente.
            await db.collection('learned_knowledge').updateOne(
                { botId: notif.botId, pregunta: notif.data.pregunta_original, status: 'pending_confirmation' },
                { $set: { status: 'rejected', rejectedAt: new Date(), rejectedBy: (req as any).userId } }
            )
            // Also remove from pending knowledge so it's not shown again in Modo Guía/Progresivo
            // (the query in bot-manager.ts filters by status: 'pending_confirmation')
            console.log(`[Learned] Dato rechazado por emprendedor: "${notif.data.pregunta_original}" (bot ${notif.botId})`)
        }

        // Mark notification as read
        await db.collection('notifications').updateOne({ _id: new ObjectId(notifId) }, { $set: { isRead: true, resolvedAction: action, resolvedAt: new Date() } })
        res.json({ ok: true, action })
    } catch (err: any) {
        console.error('Error confirming learned data:', err)
        res.status(500).json({ error: err.message })
    }
})

// ═══ Payment Verification: CHECK (✓) or CRUZ (✗) ═══
router.post('/notifications/:id/verify-payment', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const notifId = req.params.id as string
        const { action } = req.body // action: 'confirm' | 'reject'

        const notif = await db.collection('notifications').findOne({ _id: new ObjectId(notifId) })
        if (!notif || notif.type !== 'payment') return res.status(404).json({ error: 'Notificación no encontrada' })

        if (action === 'confirm') {
            // Update order with payment — calculate monto_pendiente for partial payment tracking (sec 6b)
            const order = await db.collection('orders').findOne({ botId: notif.botId, phone: notif.data.phone, status: { $nin: ['completado', 'cancelado'] } })
            const paymentAmount = parseFloat(notif.data.amount) || 0
            const prevPaid = parseFloat(order?.monto_pagado || 0)
            const totalAmount = parseFloat(order?.total || 0)
            const newPaid = prevPaid + paymentAmount
            const pendiente = Math.max(0, totalAmount - newPaid)
            const isPaidInFull = pendiente <= 0

            await db.collection('orders').updateOne(
                { botId: notif.botId, phone: notif.data.phone, status: { $nin: ['completado', 'cancelado'] } },
                { $set: { status: isPaidInFull ? 'pagado' : 'pago_parcial', monto_pagado: newPaid, monto_pendiente: pendiente, fecha_pago: new Date(), updatedAt: new Date() } }
            )
            // Send confirmation to client via bot
            const { botManager } = await import('../services/bot-manager')
            const clientJid = notif.data.phone.includes('@') ? notif.data.phone : `${notif.data.phone}@s.whatsapp.net`
            await botManager.sendTextMessage(notif.botId, clientJid, 'Muchas gracias por tu compra, hemos verificado todo, te iremos informando acerca del pedido 😊')
        } else {
            // Payment rejected — notify bot to inform client
            const { botManager } = await import('../services/bot-manager')
            const clientJid = notif.data.phone.includes('@') ? notif.data.phone : `${notif.data.phone}@s.whatsapp.net`
            await botManager.sendTextMessage(notif.botId, clientJid, 'Hemos revisado el comprobante pero no pudimos verificar la transacción. ¿Podrías enviarnos nuevamente el comprobante de pago?')
        }

        await db.collection('notifications').updateOne({ _id: new ObjectId(notifId) }, { $set: { isRead: true, resolvedAction: action, resolvedAt: new Date() } })
        res.json({ ok: true, action })
    } catch (err: any) {
        console.error('Error verifying payment:', err)
        res.status(500).json({ error: err.message })
    }
})

// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║ PENDIENTE B-7 · ALTA · Botón "No hay especificación de recojo"             ║
// ║ Doc §6 Paso 8 dice textualmente:                                           ║
// ║   "Si no hay especificación de recojo, existe un botón de 'No hay          ║
// ║    especificación de recojo' para continuar directamente."                 ║
// ║ ACTUALMENTE: especificacion_recojo es un campo de texto opcional.          ║
// ║ Si viene vacío se interpreta como "sin spec". Eso NO cumple el requisito. ║
// ║ IMPLEMENTAR:                                                               ║
// ║   - Modal al pasar envío de "En Tránsito" → "Entregado"                   ║
// ║   - El modal tiene: campo de texto + botón "No hay spec de recojo"        ║
// ║   - Con spec → envía texto en notificación al cliente                      ║
// ║   - Sin spec (botón) → marca entregado sin texto adicional                 ║
// ║   - En ambos casos: ticket Ventas → VENCIDO + crear ticket Postventa      ║
// ║ Backend: specification: string | null (null = botón presionado)            ║
// ║ EVIDENCIA: captura del modal con botón visible.                            ║
// ╚══════════════════════════════════════════════════════════════════════════════╝
// ═══ Shipping Status Management: Envíos por Crear → En Tránsito → Entregado ═══
router.put('/orders/:botId/:orderId/shipping-status', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const botId = req.params.botId as string
        const orderId = req.params.orderId as string
        const { status, trackingNumber, especificacion_recojo, no_spec_recojo } = req.body
        console.log('[DEBUG][PUT /shipping-status] botId:', botId, 'orderId:', orderId, 'status:', status, 'noSpec:', no_spec_recojo, 'spec:', especificacion_recojo?.substring?.(0, 50))
        // status: 'creado' | 'en_transito' | 'entregado'
        // B-7: especificacion_recojo: string (text from modal) | undefined
        // B-7: no_spec_recojo: boolean — true when entrepreneur clicks "No hay especificación de recojo" button

        const bot = await db.collection('bot_configs').findOne({ _id: new ObjectId(botId), userId: (req as any).userId })
        if (!bot) return res.status(404).json({ error: 'Bot no encontrado' })

        const updateData: any = { estado_envio: status, updatedAt: new Date() }
        if (trackingNumber) updateData.trackingNumber = trackingNumber
        // B-7: Explicit handling — null means button was pressed (no spec), string means text was entered
        if (no_spec_recojo === true) {
            updateData.especificacion_recojo = null
            updateData.no_spec_confirmed = true // Track that the entrepreneur explicitly chose "no spec"
        } else if (especificacion_recojo) {
            updateData.especificacion_recojo = especificacion_recojo
        }

        await db.collection('orders').updateOne({ _id: new ObjectId(orderId), botId }, { $set: updateData })

        const order = await db.collection('orders').findOne({ _id: new ObjectId(orderId) })
        if (!order) return res.status(404).json({ error: 'Orden no encontrada' })

        // Send client notification based on status change
        const { botManager } = await import('../services/bot-manager')
        const clientJid = order.phone?.includes('@') ? order.phone : `${order.phone}@s.whatsapp.net`

        const clientName = order.customerName || ''
        const greeting = clientName ? `${clientName}, ` : ''

        if (status === 'creado') {
            // PASO 11 spec: "Tu pedido fue empacado y entregado al courier 📦"
            await botManager.sendTextMessage(botId, clientJid, `${greeting}tu pedido ${order.orderCode || ''} fue empacado y entregado al courier 📦`)
        } else if (status === 'en_transito') {
            // PASO 11 spec: "Tu pedido está en camino, código de rastreo: [XXX]"
            const trackMsg = trackingNumber ? `, código de rastreo: ${trackingNumber}` : ''
            await botManager.sendTextMessage(botId, clientJid, `${greeting}tu pedido ${order.orderCode || ''} está en camino${trackMsg}. Te avisaremos cuando llegue a su destino.`)
        } else if (status === 'listo_recojo') {
            // PASO 11 spec (recojo en tienda): "Tu pedido está listo para recojo en [dirección + horario]"
            const pickupAddress = (order as any).pickupAddress || (order as any).pickup_address || ''
            const pickupHours = (order as any).pickupHours || (order as any).pickup_hours || ''
            const pickupInfo = especificacion_recojo
                ? ` en ${especificacion_recojo}`
                : (pickupAddress ? ` en ${pickupAddress}${pickupHours ? ` (${pickupHours})` : ''}` : '')
            await botManager.sendTextMessage(botId, clientJid, `${greeting}tu pedido ${order.orderCode || ''} está listo para recojo${pickupInfo}. ¡Te esperamos!`)
            await db.collection('orders').updateOne(
                { _id: new ObjectId(orderId) },
                { $set: { estado_envio: 'listo_recojo', readyForPickupAt: new Date() } }
            )
            return res.json({ success: true })
        } else if (status === 'entregado') {
            let msg = `${greeting}tu pedido ${order.orderCode || ''} ha sido entregado exitosamente.\n\nGracias por tu compra. Si tienes alguna consulta, estamos aquí para ayudarte.`
            if (especificacion_recojo) {
                msg += `\n\n📋 Especificación de recojo: ${especificacion_recojo}`
            }

            // Spec Qhatu: la transición Venta → Postventa solo ocurre cuando se cumplen
            // AMBAS condiciones: (1) producto entregado completamente Y (2) pago 100% completo.
            // Si el pago aún tiene saldo pendiente, NO creamos el ticket de postventa todavía;
            // solo marcamos la orden como 'entregado_pago_pendiente' y pedimos confirmación.
            const montoPendiente = parseFloat(order.total || 0) - parseFloat(order.monto_pagado || 0)
            const pagoCompleto = montoPendiente <= 0.01  // tolerancia para errores de float

            if (!pagoCompleto) {
                msg += `\n\nConfírmanos que realizaste el pago completo. Saldo pendiente: S/ ${montoPendiente.toFixed(2)}`
                await botManager.sendTextMessage(botId, clientJid, msg)

                // Estado intermedio: entregado pero pago aún pendiente. NO crea postventa.
                // El ticket de postventa se creará cuando se confirme el saldo restante
                // (vía el flujo de confirm-payment del emprendedor).
                await db.collection('orders').updateOne(
                    { _id: new ObjectId(orderId) },
                    { $set: { status: 'entregado_pago_pendiente', estado_envio: 'entregado', deliveredAt: new Date() } }
                )
                console.log(`[CRM] ⚠️ Orden ${orderId} entregada pero con saldo pendiente S/${montoPendiente.toFixed(2)} — postventa NO creada hasta confirmar pago`)
            } else {
                await botManager.sendTextMessage(botId, clientJid, msg)

                // Transición Venta → Postventa: ambas condiciones cumplidas.
                await db.collection('orders').updateOne(
                    { _id: new ObjectId(orderId) },
                    { $set: { status: 'completado', estado_envio: 'entregado', completedAt: new Date() } }
                )

                // Create postventa ticket — always starts as VENCIDO per doc sec 5.1 with 2-week claim window
                const twoWeeksFromNow = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
                await db.collection('postventa_tickets').insertOne({
                    botId,
                    orderId: orderId,
                    orderCode: order.orderCode,
                    phone: order.phone,
                    customerName: order.customerName,
                    producto: order.items,
                    estado_ticket: 'vencido', // Postventa SIEMPRE arranca como Vencido (doc sec 5.1)
                    ventana_reclamo_hasta: twoWeeksFromNow,
                    tipo_caso: null, // Se llena si hay reclamo/devolucion/cambio
                    solucion_aplicada: null,
                    fecha_solucion: null,
                    createdAt: new Date()
                })
                console.log(`[CRM] ✅ Postventa creada para orden ${orderId} (entrega completa + pago 100%)`)
            }
        }

        // Create notification for entrepreneur
        await db.collection('notifications').insertOne({
            botId, userId: (req as any).userId,
            type: 'shipping_update',
            title: `Envío ${status}: ${order.orderCode || orderId}`,
            message: `Estado actualizado a: ${status}${especificacion_recojo ? ' | Recojo: ' + especificacion_recojo : ''}`,
            data: { orderId, status, trackingNumber, especificacion_recojo },
            isRead: false, createdAt: new Date()
        })

        res.json({ ok: true, status })
    } catch (err: any) {
        console.error('Error updating shipping status:', err)
        res.status(500).json({ error: err.message })
    }
})

// ═══ Get pending learned data notifications for login ═══
router.get('/notifications/pending-learned/:botId', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const botId = req.params.botId
        const pending = await db.collection('notifications').find({
            botId,
            userId: (req as any).userId,
            type: 'learned_data',
            isRead: false
        }).sort({ createdAt: -1 }).toArray()
        res.json(pending)
    } catch (err: any) {
        res.status(500).json({ error: err.message })
    }
})

// ═══ A-4: Cron de expiración automática de leads a 48h ═══
// Runs every 30 min, marks leads with 48h+ since last interaction as 'vencido'.
// Also accessible via POST /crm/expire-leads/:botId for manual triggering.
const LEAD_EXPIRY_HOURS = 48
const LEAD_EXPIRY_INTERVAL_MS = 30 * 60 * 1000 // 30 minutes

async function expireStaleLeads(): Promise<{ expired: number; bots: number }> {
    try {
        const db = getDB()
        const cutoff = new Date(Date.now() - LEAD_EXPIRY_HOURS * 60 * 60 * 1000)
        // Note: "estado_ticket" is a virtual field calculated at query time in the CRM endpoint.
        // It does NOT exist as a column in Supabase. We mark expired leads by setting
        // etapa_pipeline to 'vencido' — which is a real column the DB supports.

        // Find leads that haven't interacted in 48h and are not already closed.
        // Excluye leads soft-deleted (no procesar archivados).
        const staleLeads = await db.collection('leads').find({
            etapa_pipeline: { $nin: ['ganado', 'perdido', 'vencido'] },
            updatedAt: { $lt: cutoff },
            deleted: { $ne: true }
        }).toArray()

        let expired = 0
        for (const lead of staleLeads) {
            await db.collection('leads').updateOne(
                { _id: lead._id },
                { $set: { etapa_pipeline: 'vencido', updatedAt: new Date() } }
            )
            expired++
        }

        if (expired > 0) console.log(`[LeadExpiry] Marcados ${expired} leads como vencidos (cutoff: ${cutoff.toISOString()})`)
        return { expired, bots: 0 }
    } catch (e) {
        console.error('[LeadExpiry] Error:', e)
        return { expired: 0, bots: 0 }
    }
}

// Auto-start cron on server boot
setInterval(expireStaleLeads, LEAD_EXPIRY_INTERVAL_MS)
setTimeout(expireStaleLeads, 5000) // Initial run 5s after boot

// Manual trigger endpoint
router.post('/crm/expire-leads/:botId', authMiddleware, async (req: AuthRequest, res: Response) => {
    const result = await expireStaleLeads()
    res.json({ ok: true, ...result })
})

// ═══════════════════════════════════════════════════════════
// LIMPIEZA QUINCENAL AUTOMÁTICA (spec Qhatu §"Limpieza periódica")
// ═══════════════════════════════════════════════════════════
// Cada 14 días el sistema:
//   1. Recolecta todos los tickets con Estado "Vencido" cuya "vida útil" expiró
//      (leads vencidos hace >14d, orders completadas/canceladas hace >14d,
//       postventa_tickets fuera de la ventana de 2 semanas)
//   2. Los respalda en la tabla `cleanup_exports` (snapshot JSONB con la misma
//      estructura de Tier 1/2/3 que tendría el Excel)
//   3. Una vez respaldados, los DELETE de las tablas principales para mantener
//      la BD lean (per spec "se eliminan de la base de datos principal,
//      permanecen solo en el Excel")
//   4. El emprendedor puede descargar el respaldo como Excel desde el dashboard
//      vía POST /crm/cleanup-exports/:exportId/download
//
// IMPORTANTE: si la inserción del respaldo falla, NO se borra nada (atomicidad).
// ═══════════════════════════════════════════════════════════
const CLEANUP_WINDOW_DAYS = 14
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000 // chequea cada día qué bots tocan

async function cleanupAndExportVencidos(): Promise<{ exports: number; total_records: number }> {
    try {
        const db = getDB()
        const cutoff = new Date(Date.now() - CLEANUP_WINDOW_DAYS * 24 * 60 * 60 * 1000)

        // Procesa por bot para que cada respaldo quede agrupado por tienda
        const allBots = await db.collection('bot_configs').find({}).toArray()
        let exportsCreated = 0
        let totalRecords = 0

        for (const bot of allBots) {
            const botId = bot._id?.toString()
            if (!botId) continue

            // Verifica si este bot ya tuvo cleanup en los últimos 14 días — si sí, salta
            const lastCleanup = await db.collection('cleanup_exports').find({
                bot_id: botId,
                created_at: { $gte: cutoff }
            }).limit(1).toArray()
            if (lastCleanup.length > 0) continue

            // Recolecta vencidos por categoría
            const vencidoLeads = await db.collection('leads').find({
                botId,
                etapa_pipeline: { $in: ['vencido', 'ganado', 'perdido'] },
                updatedAt: { $lt: cutoff },
                deleted: { $ne: true }
            }).toArray()

            const vencidoOrders = await db.collection('orders').find({
                botId,
                status: { $in: ['completado', 'cancelado'] },
                updatedAt: { $lt: cutoff }
            }).toArray()

            const vencidoPostventa = await db.collection('postventa_tickets').find({
                botId,
                createdAt: { $lt: cutoff }
            }).toArray()

            const totalThisBot = vencidoLeads.length + vencidoOrders.length + vencidoPostventa.length
            if (totalThisBot === 0) continue

            // Snapshot del respaldo (JSONB). El Excel se genera bajo demanda con esto.
            const periodFrom = vencidoLeads.concat(vencidoOrders, vencidoPostventa)
                .map(r => new Date(r.createdAt || r.timestamp || r.updatedAt).getTime())
                .reduce((a, b) => Math.min(a, b), Date.now())

            let exportRecord: any = null
            try {
                exportRecord = await db.collection('cleanup_exports').insertOne({
                    bot_id: botId,
                    period_from: new Date(periodFrom),
                    period_to: cutoff,
                    leads_count: vencidoLeads.length,
                    orders_count: vencidoOrders.length,
                    postventa_count: vencidoPostventa.length,
                    leads_data: vencidoLeads,
                    orders_data: vencidoOrders,
                    postventa_data: vencidoPostventa,
                    created_at: new Date()
                })
            } catch (insErr) {
                console.error(`[Cleanup] ❌ Falló respaldo de bot ${botId}, NO se borrarán registros:`, insErr)
                continue  // sin respaldo, no borramos
            }

            // Respaldo OK → ahora sí eliminamos de las tablas principales
            for (const lead of vencidoLeads) {
                await db.collection('leads').deleteOne({ _id: lead._id })
            }
            for (const order of vencidoOrders) {
                await db.collection('orders').deleteOne({ _id: order._id })
            }
            for (const pv of vencidoPostventa) {
                await db.collection('postventa_tickets').deleteOne({ _id: pv._id })
            }

            // Notificación visible en el panel del emprendedor con link al respaldo
            try {
                const exportId = (exportRecord?.insertedId || '').toString()
                await db.collection('notifications').insertOne({
                    botId,
                    userId: bot.userId,
                    type: 'CLEANUP_COMPLETED',
                    title: `📦 Respaldo automático generado`,
                    message: `Se respaldaron y eliminaron ${totalThisBot} ticket${totalThisBot === 1 ? '' : 's'} vencido${totalThisBot === 1 ? '' : 's'} (${vencidoLeads.length} lead${vencidoLeads.length === 1 ? '' : 's'}, ${vencidoOrders.length} venta${vencidoOrders.length === 1 ? '' : 's'}, ${vencidoPostventa.length} postventa). Descarga el Excel desde el botón "Ver respaldo".`,
                    data: { exportId, leads: vencidoLeads.length, orders: vencidoOrders.length, postventa: vencidoPostventa.length },
                    isRead: false,
                    createdAt: new Date()
                })
            } catch (notifErr) {
                console.warn(`[Cleanup] No se pudo crear notif para bot ${botId}:`, notifErr)
            }

            exportsCreated++
            totalRecords += totalThisBot
            console.log(`[Cleanup] ✅ Bot ${botId} → respaldados+eliminados ${totalThisBot} (leads:${vencidoLeads.length} orders:${vencidoOrders.length} postventa:${vencidoPostventa.length})`)
        }

        return { exports: exportsCreated, total_records: totalRecords }
    } catch (e) {
        console.error('[Cleanup] Error general:', e)
        return { exports: 0, total_records: 0 }
    }
}

// Auto-start cron diario on server boot (cada bot se procesa solo cuando le toca)
setInterval(cleanupAndExportVencidos, CLEANUP_INTERVAL_MS)
setTimeout(cleanupAndExportVencidos, 60000) // Initial run 60s after boot

// Manual trigger endpoint (útil para QA o ejecución bajo demanda)
router.post('/crm/cleanup-vencidos/:botId', authMiddleware, async (req: AuthRequest, res: Response) => {
    const result = await cleanupAndExportVencidos()
    res.json({ ok: true, ...result })
})

// Listar respaldos de cleanup disponibles para descargar
router.get('/crm/cleanup-exports/:botId', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const botId = req.params.botId as string
        const bot = await db.collection('bot_configs').findOne({ _id: new ObjectId(botId), userId: (req as any).userId })
        if (!bot) return res.status(404).json({ error: 'Bot no encontrado' })

        const exports = await db.collection('cleanup_exports').find({ bot_id: botId }).toArray()
        // Ordena descendente por fecha (más recientes arriba)
        exports.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        // No devuelvas la data completa — solo metadata
        const summary = exports.map(e => ({
            id: e._id,
            period_from: e.period_from,
            period_to: e.period_to,
            leads_count: e.leads_count,
            orders_count: e.orders_count,
            postventa_count: e.postventa_count,
            created_at: e.created_at
        }))
        res.json({ exports: summary })
    } catch (e: any) {
        res.status(500).json({ error: e.message })
    }
})

// Descargar un respaldo de cleanup como Excel (3 hojas: Leads / Ventas / Postventa).
// Reconstruye el xlsx desde el snapshot JSONB que el cron guardó al momento del cleanup.
router.get('/crm/cleanup-exports/:botId/:exportId/download', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const botId = req.params.botId as string
        const exportId = req.params.exportId as string
        const bot = await db.collection('bot_configs').findOne({ _id: new ObjectId(botId), userId: (req as any).userId })
        if (!bot) return res.status(404).json({ error: 'Bot no encontrado' })

        const exp = await db.collection('cleanup_exports').findOne({ _id: new ObjectId(exportId) })
        if (!exp || exp.bot_id !== botId) return res.status(404).json({ error: 'Respaldo no encontrado' })

        // Mapeo a las mismas columnas del export manual /crm/export-vencidos para
        // que el archivo descargado tenga formato idéntico al on-demand.
        const leadsRows = (exp.leads_data || []).map((l: any) => ({
            'Ticket ID': l.ticketId || l.ticket_id || (l._id || l.id || '').toString().substring(0, 6),
            'Estado': 'Vencido',
            'Tipo de Estado': l.etapa_pipeline === 'ganado' ? 'Venta' : 'Inactividad',
            'Fecha Creación': l.createdAt ? new Date(l.createdAt).toLocaleDateString('es-PE') : '',
            'Etapa Funnel': l.etapa_pipeline || '',
            'Temperatura': l.temperatura_lead || l.temperatura || '',
            'Producto Interés': l.producto_interes || '',
            'Última Interacción': l.updatedAt ? new Date(l.updatedAt).toLocaleString('es-PE') : ''
        }))

        const ventasRows = (exp.orders_data || []).map((o: any) => {
            const productosArr = Array.isArray(o.products) ? o.products : []
            const productosLabel = productosArr.length
                ? productosArr.map((p: any) => p.qty > 1 ? `${p.name} x${p.qty}` : p.name).join(' | ')
                : (o.items || '')
            return {
                'Ticket ID': o.orderCode || o.order_code || (o._id || o.id || '').toString().substring(0, 6),
                'Estado': 'Vencido',
                'Tipo de Estado': o.status === 'completado' ? 'Completado' : 'Cancelado',
                'Fecha Creación': o.createdAt ? new Date(o.createdAt).toLocaleDateString('es-PE') : '',
                'Nombre': o.customerName || o.customer_name || '',
                'Teléfono': o.customerPhone || o.customer_phone || o.phone || '',
                'DNI': o.dni || '',
                'Producto': productosLabel,
                'Cantidad': o.cantidad_total || productosArr.reduce((s: number, p: any) => s + (p.qty || 1), 0),
                'Fecha de Compra': o.timestamp ? new Date(o.timestamp).toLocaleDateString('es-PE') : '',
                'Método de Pago': o.metodo_pago || o.tipo_pago || '',
                'Monto Pagado': o.monto_pagado || 0,
                'Pendiente': o.monto_pendiente || 0,
                'Total': o.total || 0,
                'Courier': o.courier || '',
                'Estado Pedido': o.estado_envio || '',
                'Departamento': o.zona_envio || '',
                'Costo Envío': o.costo_envio || 0
            }
        })

        const postventaRows = (exp.postventa_data || []).map((pv: any) => ({
            'Ticket ID': pv.orderCode || pv.order_code || (pv._id || pv.id || '').toString().substring(0, 6),
            'Estado': pv.estado_ticket === 'resuelto' ? 'Vencido' : 'Vencido',
            'Tipo de Estado': pv.estado_ticket === 'resuelto' ? 'Resuelto' : 'En Resolución',
            'Tipo de Caso': pv.tipo_caso || '—',
            'Tipo de Producto': pv.producto || '—',
            'Solución Aplicada': pv.solucion_aplicada || '—',
            'Fecha de Solución': pv.fecha_solucion ? new Date(pv.fecha_solucion).toLocaleDateString('es-PE') : '—',
            'Fecha Apertura': pv.createdAt ? new Date(pv.createdAt).toLocaleDateString('es-PE') : ''
        }))

        const wb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(leadsRows.length ? leadsRows : [{ Mensaje: 'Sin leads vencidos en este período' }]), 'Leads')
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ventasRows.length ? ventasRows : [{ Mensaje: 'Sin ventas vencidas en este período' }]), 'Ventas')
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(postventaRows.length ? postventaRows : [{ Mensaje: 'Sin postventas en este período' }]), 'Postventa')

        const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' })
        const periodLabel = exp.period_to ? new Date(exp.period_to).toISOString().slice(0, 10) : 'cleanup'
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        res.setHeader('Content-Disposition', `attachment; filename="kipu_respaldo_${periodLabel}.xlsx"`)
        res.send(buffer)
    } catch (e: any) {
        console.error('[Cleanup download]', e)
        res.status(500).json({ error: e.message })
    }
})

// ═══ A-5: Export & Cleanup Vencido Tickets — Real xlsx con 3 hojas (doc §5.3) ═══
// Hojas: Leads (Tier 1-3), Ventas (Tier 1-3), Postventa (Tier 1-3)
// Columnas mapean 1:1 a los tiers del CRM del documento maestro.
// XLSX imported at top of file

router.post('/crm/export-vencidos/:botId', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const botId = req.params.botId as string
        const bot = await db.collection('bot_configs').findOne({ _id: new ObjectId(botId), userId: (req as any).userId })
        if (!bot) return res.status(404).json({ error: 'Bot no encontrado' })

        const now = new Date()
        const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)

        // Find vencido leads (48h since last interaction or ganado/perdido)
        const vencidoLeads = await db.collection('leads').find({
            botId,
            $or: [
                { etapa_pipeline: { $in: ['ganado', 'perdido'] } },
                { updatedAt: { $lt: new Date(now.getTime() - LEAD_EXPIRY_HOURS * 60 * 60 * 1000) } }
            ]
        }).toArray()

        // Find vencido orders (completed & delivered)
        const vencidoOrders = await db.collection('orders').find({
            botId,
            status: { $in: ['completado', 'cancelled'] }
        }).toArray()

        // Find postventa tickets
        const postventaTickets = await db.collection('postventa_tickets').find({ botId }).toArray()

        // ─── Build 3 sheets matching doc §5.3 tiers ───

        // HOJA 1: Leads — Tier 1 (¿Quién es?), Tier 2 (¿Cómo lo atiendo?), Tier 3 (¿Qué puedo mejorar?)
        const leadsData = vencidoLeads.map(l => ({
            // Tier 1 — ¿Quién es?
            'Ticket ID': l.ticketId || l._id?.toString().substring(0, 6) || '',
            'Nombre': l.contactName || '',
            'Teléfono': l.from || l.phone || '',
            'Etapa Pipeline': l.etapa_pipeline || '',
            'Temperatura': l.temperatura || l.scoreLevel || '',
            'Lead Score': l.leadScore || 0,
            'Producto Interés': l.producto_interes || '',
            'Último Contacto': l.updatedAt ? new Date(l.updatedAt).toLocaleDateString('es-PE') : '',
            'Escalado Humano': l.escaladoHumano ? 'Sí' : 'No',
            'Estado Conversación': l.estadoConversacion || 'cerrada',
            // Tier 2 — ¿Cómo lo atiendo?
            'Canal': l.channel || 'whatsapp',
            'Consulta Inicial': l.consultaInicial || l.lastMessage || '',
            'Primer Contacto': l.createdAt ? new Date(l.createdAt).toLocaleDateString('es-PE') : '',
            'Comentarios': l.comentarios || '',
            // Tier 3 — ¿Qué puedo mejorar?
            'Motivo Escalación': l.motivoEscalacion || '',
            'Duración Ciclo (h)': l.duracionCicloHoras || '',
            'Motivo Pérdida': l.motivoPerdida || '',
            'N° Mensajes': l.numMensajes || 0,
            'Sentimiento': l.sentimiento || 'neutro',
            'Estado': 'vencido',
        }))

        // HOJA 2: Ventas — Tier 1 (Datos pedido), Tier 2 (Logística), Tier 3 (Financiero)
        const ventasData = vencidoOrders.map(o => ({
            // Tier 1 — Datos del pedido
            'Código Pedido': o.orderCode || '',
            'Cliente': o.customerName || '',
            'Teléfono': o.phone || o.customerPhone || '',
            'Producto': o.items || '',
            'Total': o.total || 0,
            'Fecha Compra': o.timestamp ? new Date(o.timestamp).toLocaleDateString('es-PE') : '',
            // Tier 2 — Logística
            'Estado Envío': o.estado_envio || '',
            'Tracking': o.trackingNumber || '',
            'Spec Recojo': o.especificacion_recojo || '',
            // Tier 3 — Financiero
            'Monto Pagado': o.monto_pagado || 0,
            'Monto Pendiente': Math.max(0, parseFloat(o.total || 0) - parseFloat(o.monto_pagado || 0)),
            'Método Pago': o.metodo_pago || '',
            'Estado Pedido': o.status || '',
            'Estado': 'vencido',
        }))

        // HOJA 3: Postventa — Tier 1 (Caso), Tier 2 (Resolución), Tier 3 (Seguimiento)
        const postventaData = postventaTickets.map(p => ({
            // Tier 1 — Caso
            'Código Pedido': p.orderCode || '',
            'Cliente': p.customerName || '',
            'Teléfono': p.phone || '',
            'Producto': p.producto || '',
            // Tier 2 — Resolución
            'Estado Ticket': p.estado_ticket || 'vencido',
            'Tipo Caso': p.tipo_caso || '–',
            'Solución Aplicada': p.solucion_aplicada || '–',
            'Fecha Solución': p.fecha_solucion ? new Date(p.fecha_solucion).toLocaleDateString('es-PE') : '–',
            // Tier 3 — Seguimiento
            'Ventana Reclamo Hasta': p.ventana_reclamo_hasta ? new Date(p.ventana_reclamo_hasta).toLocaleDateString('es-PE') : '',
            'Creado': p.createdAt ? new Date(p.createdAt).toLocaleDateString('es-PE') : '',
        }))

        // Check if xlsx format requested
        if (req.body.format === 'xlsx') {
            const wb = XLSX.utils.book_new()

            const wsLeads = XLSX.utils.json_to_sheet(leadsData.length > 0 ? leadsData : [{ 'Info': 'Sin leads vencidos en este período' }])
            XLSX.utils.book_append_sheet(wb, wsLeads, 'Leads')

            const wsVentas = XLSX.utils.json_to_sheet(ventasData.length > 0 ? ventasData : [{ 'Info': 'Sin ventas vencidas en este período' }])
            XLSX.utils.book_append_sheet(wb, wsVentas, 'Ventas')

            const wsPostventa = XLSX.utils.json_to_sheet(postventaData.length > 0 ? postventaData : [{ 'Info': 'Sin tickets postventa en este período' }])
            XLSX.utils.book_append_sheet(wb, wsPostventa, 'Postventa')

            const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' })
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
            res.setHeader('Content-Disposition', `attachment; filename="kipu_vencidos_${now.toISOString().slice(0, 10)}.xlsx"`)
            return res.send(buffer)
        }

        // Default: JSON response (backward compat) with structured data
        const exportData = {
            fecha_exportacion: now.toISOString(),
            rango: { desde: twoWeeksAgo.toISOString(), hasta: now.toISOString() },
            leads_vencidos: leadsData,
            ventas_vencidas: ventasData,
            postventa: postventaData,
            total_leads: vencidoLeads.length,
            total_ventas: vencidoOrders.length,
            total_postventa: postventaTickets.length,
        }

        // Clean up if requested
        if (req.body.cleanup === true) {
            for (const lead of vencidoLeads) {
                await db.collection('leads').deleteOne({ _id: lead._id })
            }
            for (const order of vencidoOrders) {
                await db.collection('orders').deleteOne({ _id: order._id })
            }
        }

        res.json(exportData)
    } catch (err: any) {
        console.error('Error exporting vencidos:', err)
        res.status(500).json({ error: err.message })
    }
})

router.post('/crm/recompra/:botId', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const botId = req.params.botId as string
        const { phone, items, total, customerName } = req.body

        if (!phone) return res.status(400).json({ error: 'phone es requerido' })

        const bot = await db.collection('bot_configs').findOne({ _id: new ObjectId(botId), userId: req.userId })
        if (!bot) return res.status(404).json({ error: 'Bot no encontrado' })

        // Recompra: create NEW lead ticket (doc sec 5.4.3 — recompra = ticket nuevo desde Leads)
        const ticketId = '#KP-' + Math.floor(10000 + Math.random() * 90000)
        const newLead = {
            botId,
            phone,
            from: phone,
            contactName: customerName || phone.split('@')[0],
            ticketId,
            etapa_pipeline: 'exploracion',
            temperatura: 'caliente',
            estado_clasificacion: 'lead_recurrente',
            producto_interes: items || 'Recompra',
            is_recompra: true,
            estadoConversacion: 'abierta',
            createdAt: new Date(),
            updatedAt: new Date()
        }
        const leadResult = await db.collection('leads').insertOne(newLead)

        console.log(`[Lifecycle] 🔄 Recompra: nuevo lead creado ${ticketId} para ${phone}`)
        res.json({ success: true, leadId: leadResult.insertedId.toString(), ticketId, message: 'Recompra: ticket nuevo creado en Leads (ciclo independiente)' })
    } catch (e: any) {
        res.status(500).json({ error: e.message })
    }
})

// ═══════════════════════════════════════════════════════════
// ONBOARDING — Structured save endpoints per wizard step
// ═══════════════════════════════════════════════════════════

// Step 1 — Identity (name, rubro, description)
router.put('/business/:botId/identity', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const botId = req.params.botId as string
        const { botName, rubro, descripcion } = req.body
        const bot = await db.collection('bot_configs').findOne({ _id: new ObjectId(botId), userId: req.userId })
        if (!bot) return res.status(404).json({ error: 'Bot no encontrado' })

        const tiendaUpdate: any = { ...(bot.tienda || {}) }
        if (botName) tiendaUpdate.nombre = botName
        if (rubro) tiendaUpdate.rubro = rubro

        const botSet: any = { tienda: tiendaUpdate, updatedAt: new Date() }
        if (botName) botSet.botName = botName

        const updateResult = await db.collection('bot_configs').updateOne({ _id: new ObjectId(botId) }, { $set: botSet })
        await db.collection('business_info').updateOne(
            { botId },
            { $set: { description: descripcion || '', updatedAt: new Date() } },
            { upsert: true }
        )
        console.log(`[PUT /business/${botId}/identity] modifiedCount=${updateResult?.modifiedCount} botName="${botName}" rubro="${rubro}"`)

        // Invalidar caches del prompt del bot — sin esto, el system prompt
        // generado se queda con el nombre viejo hasta ~30s después y el bot
        // sigue saludando "Bienvenido a [nombre viejo]" tras el rename.
        try { invalidatePromptCache(botId) } catch { /* best-effort */ }
        // Marca config como actualizada → ejemplos LLM cacheados quedan stale.
        touchBotConfigUpdatedAt(botId).catch(() => {})
        try { invalidateStaticPromptCache(botId) } catch { /* best-effort */ }

        res.json({ success: true, botName, rubro })
    } catch (e: any) {
        console.error(`[PUT /business/:botId/identity] ❌`, e?.message || e)
        res.status(500).json({ error: e.message })
    }
})


// ═══════════════════════════════════════════════════════════
// CHATS — WhatsApp Web-like interface
// ═══════════════════════════════════════════════════════════

router.get('/chats/:botId/list', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const botId = req.params.botId as string
        const ownerUserId = resolveOwnerUserId(req)
        const bot = await db.collection('bot_configs').findOne({ _id: new ObjectId(botId), userId: ownerUserId })
        if (!bot) return res.status(404).json({ error: 'Bot no encontrado' })

        const rawChats = await db.collection('wa_chats')
            .find(_mergeAssignedToScope({ botId, archived: { $ne: true } }, req))
            .sort({ lastMessageAt: -1 })
            .limit(200)
            .toArray()

        // Filtro defensivo (cinturón + tirantes): aún si por alguna razón
        // se coló un broadcast/grupo/newsletter en wa_chats (chats viejos
        // pre-fix, sync inicial antes del filtro, etc.), no lo devolvemos
        // al dashboard. La sección Chats es SOLO conversaciones 1-a-1 con
        // clientes que escribieron al número conectado.
        const chats = rawChats
            .filter((c: any) => {
                const jid = String(c?.chatJid || '')
                if (!jid) return false
                if (jid === 'status@broadcast') return false
                if (jid.endsWith('@broadcast')) return false
                if (jid.endsWith('@g.us')) return false
                if (jid.endsWith('@newsletter')) return false
                if (c?.isGroup === true || c?.is_group === true) return false
                return true
            })
            .slice(0, 100)

        // ═══ Enrich: contactName del lead + ticketCode secuencial ═══
        // ANTES el dashboard mostraba `wa_chats.chatName` (= pushName de
        // WhatsApp del cliente, p. ej. "JOSE") como nombre del chat. Política
        // "0% suposición": ese nombre NO es confiable — el cliente todavía
        // no nos dio su nombre real. Hasta que lo dé (vía PASO 4 del workflow
        // conversacional / 7 del workflow de botones), mostramos
        // `Ticket #0001`, `#0002`, etc.
        //
        // Numeración: 1-indexed por orden de creación del lead dentro del
        // bot (createdAt ASC). Si el lead todavía no existe (raro: el lead
        // se crea en el mismo turno que el chat), fallback a un hash corto
        // determinístico del JID.
        try {
            const allLeads = await db.collection('leads')
                .find(_mergeAssignedToScope({ botId }, req))
                .sort({ createdAt: 1 })
                .toArray()
                .catch(() => [])
            const leadByPhone = new Map<string, { contactName: string; ticketNumber: number }>()
            allLeads.forEach((l: any, idx: number) => {
                const key = String(l?.phone || '')
                if (!key) return
                leadByPhone.set(key, {
                    contactName: String(l?.contactName || l?.contact_name || '').trim(),
                    ticketNumber: idx + 1,
                })
            })
            for (const c of chats as any[]) {
                const lead = leadByPhone.get(String(c.chatJid || ''))
                const cn = (lead?.contactName || '').trim()
                // contactName SOLO si el cliente dio su nombre. Si no, ''
                // (el frontend muestra el ticketCode).
                c.contactName = cn
                if (lead?.ticketNumber && lead.ticketNumber > 0) {
                    c.ticketCode = `Ticket #${String(lead.ticketNumber).padStart(4, '0')}`
                } else {
                    const short = String(c.chatJid || '').replace(/[^A-Za-z0-9]/g, '').slice(-4).toUpperCase()
                    c.ticketCode = short ? `Ticket #${short}` : 'Ticket #—'
                }
            }
        } catch (e: any) {
            console.warn('[/chats/list] enrich con leads falló (no fatal):', e?.message || e)
        }

        const totalUnread = chats.reduce((sum: number, c: any) => sum + (c.unreadCount || 0), 0)
        res.json({ chats, totalUnread })
    } catch (e: any) {
        res.status(500).json({ error: e.message })
    }
})

router.get('/chats/:botId/messages/:chatJid', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const botId = req.params.botId as string
        const chatJid = decodeURIComponent(req.params.chatJid as string)
        const ownerUserId = resolveOwnerUserId(req)

        const bot = await db.collection('bot_configs').findOne({ _id: new ObjectId(botId), userId: ownerUserId })
        if (!bot) return res.status(404).json({ error: 'Bot no encontrado' })

        if (req.isTeamMember && req.teamRole === 'vendedor' && req.memberId) {
            const chat = await db.collection('wa_chats').findOne({ botId, chatJid })
            if (!chat || String(chat.assignedTo || '') !== String(req.memberId)) {
                return res.status(403).json({ error: 'No tienes acceso a este chat' })
            }
        }

        const messages = await db.collection('wa_messages')
            .find({ botId, chatJid })
            .sort({ timestamp: -1 })
            .limit(50)
            .toArray()

        // Mark chat as read
        await db.collection('wa_chats').updateOne(
            { botId, chatJid },
            { $set: { unreadCount: 0 } }
        )

        res.json({ messages: messages.reverse() })
    } catch (e: any) {
        res.status(500).json({ error: e.message })
    }
})

router.post('/chats/:botId/send', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const botId = req.params.botId as string
        const { chatJid, text } = req.body
        if (!chatJid || !text) return res.status(400).json({ error: 'chatJid y text requeridos' })

        const db = getDB()
        const bot = await db.collection('bot_configs').findOne({ _id: new ObjectId(botId), userId: req.userId })
        if (!bot) return res.status(404).json({ error: 'Bot no encontrado' })

        const result = await botManager.sendDashboardMessage(botId, chatJid, text)
        if (!result.success) return res.status(500).json({ error: 'Error enviando mensaje. Verifica que WhatsApp esté conectado.' })

        // Política: el dueño tomó control de la conversación al enviar este
        // mensaje. Pausamos Qhatu para este chat así no responde encima de la
        // intervención humana. La pausa se libera cuando el dueño hace click
        // en "Reactivar Qhatu" (POST /chats/:botId/resume-bot/:chatJid) o tras
        // el timeout natural de 2 h en el handler.
        try {
            const historyKey = `${botId}_${chatJid}`
            const existing = await db.collection('chat_history').findOne({ key: historyKey })
            if (!existing?.botPaused) {
                await db.collection('chat_history').updateOne(
                    { key: historyKey },
                    { $set: { botPaused: true, pausedAt: new Date(), pauseReason: 'Dueño tomó control desde el dashboard' } },
                    { upsert: true }
                )
                await db.collection('wa_chats').updateOne(
                    { botId, chatJid },
                    { $set: { isBotPaused: true } }
                )
                // Marca cualquier HANDOFF pendiente para este chat como resuelta — el
                // dueño respondió. Sin esto, el dedupe seguiría bloqueando notifs nuevas.
                const unreadHandoffs = await db.collection('notifications').find({
                    botId, type: 'HANDOFF', isRead: { $ne: true }
                }).toArray()
                const matching = (unreadHandoffs || []).filter((n: any) => n?.data?.phone === chatJid)
                for (const n of matching) {
                    await db.collection('notifications').updateOne(
                        { _id: typeof n._id === 'string' ? n._id : new ObjectId(String(n._id)) },
                        { $set: { isRead: true, resolvedAction: 'owner_replied', resolvedAt: new Date() } }
                    ).catch(() => { /* best-effort */ })
                }
            }
        } catch (pauseErr: any) {
            console.warn('[POST /chats/send] auto-pause on owner reply failed (non-fatal):', pauseErr?.message || pauseErr)
        }

        res.json({ success: true, messageId: result.messageId })
    } catch (e: any) {
        res.status(500).json({ error: e.message })
    }
})

router.post('/chats/:botId/resume-bot/:chatJid', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const botId = req.params.botId as string
        const chatJid = decodeURIComponent(req.params.chatJid as string)

        await db.collection('chat_history').updateOne(
            { key: `${botId}_${chatJid}` },
            { $set: { botPaused: false, pausedAt: null, pauseReason: null } }
        )
        await db.collection('wa_chats').updateOne(
            { botId, chatJid },
            { $set: { isBotPaused: false } }
        )

        // ═══ AUTO-LEARN ═══
        // Run Qhatu's handoff analyzer over the messages the entrepreneur just
        // typed while the bot was paused. If she extracted a new Q/A, persist
        // it as a confirmed FAQ (the source is the business owner — no extra
        // review step needed) so the NEXT inbound message already answers it
        // without triggering another handoff. Bust the static prompt cache so
        // the new knowledge takes effect immediately.
        let learned: any = null
        try {
            learned = await botManager.analyzeChatForLearning(botId, chatJid)
            console.log(`[resume-bot] analyzeChatForLearning result for ${chatJid}:`,
                learned ? `Q="${learned.pregunta}" A="${(learned.respuesta || '').substring(0, 80)}"` : 'null (no new info)')
        } catch (e) {
            console.warn('[resume-bot] analyzeChatForLearning failed (non-fatal):', (e as any)?.message || e)
        }

        if (learned && learned.respuesta) {
            try {
                const bizDoc = await db.collection('business_info').findOne({ botId })
                const existingFaqs = Array.isArray(bizDoc?.learned_faqs) ? bizDoc.learned_faqs : []
                const dupe = existingFaqs.some((f: any) =>
                    (f.pregunta || '').trim().toLowerCase() === (learned.pregunta || '').trim().toLowerCase()
                    && (f.respuesta || '').trim().toLowerCase() === (learned.respuesta || '').trim().toLowerCase()
                )
                if (!dupe) {
                    const newFaq = {
                        pregunta: learned.pregunta,
                        respuesta: learned.respuesta,
                        tipo: learned.tipo || 'otro',
                        resumen: learned.resumen || '',
                        confirmedAt: new Date(),
                        source: chatJid,
                        autoLearned: true
                    }
                    await db.collection('business_info').updateOne(
                        { botId },
                        { $set: { learned_faqs: [...existingFaqs, newFaq], updatedAt: new Date() } },
                        { upsert: true }
                    )
                    // Also drop a row into learned_knowledge (confirmed) for audit/history
                    // and so the /aprendizaje tab in Mi Qhatu can surface it.
                    await db.collection('learned_knowledge').insertOne({
                        botId,
                        tipo: learned.tipo || 'otro',
                        pregunta: learned.pregunta,
                        respuesta: learned.respuesta,
                        resumen: learned.resumen || '',
                        status: 'confirmed',
                        sourcePhone: chatJid,
                        confirmedAt: new Date(),
                        createdAt: new Date()
                    }).catch(() => {})
                    invalidatePromptCache(botId)
                    console.log(`[resume-bot] auto-learned: "${learned.pregunta}" → "${learned.respuesta?.substring(0, 80)}"`)
                }
            } catch (e) {
                console.warn('[resume-bot] saving learned FAQ failed (non-fatal):', (e as any)?.message || e)
            }
        }

        res.json({ success: true, learned })
    } catch (e: any) {
        res.status(500).json({ error: e.message })
    }
})

// Returns Qhatu's proposed learning from the conversation since handoff. Does NOT save.
router.post('/chats/:botId/analyze-learning/:chatJid', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const botId = req.params.botId as string
        const chatJid = decodeURIComponent(req.params.chatJid as string)
        const db = getDB()
        const bot = await db.collection('bot_configs').findOne({ _id: new ObjectId(botId), userId: req.userId })
        if (!bot) return res.status(404).json({ error: 'Bot no encontrado' })

        const result = await botManager.analyzeChatForLearning(botId, chatJid)
        if (!result) return res.json({ found: false })
        res.json({ found: true, ...result })
    } catch (e: any) {
        res.status(500).json({ error: e.message })
    }
})

// Persists a confirmed (or edited) learning to business_info.learned_faqs.
router.post('/chats/:botId/save-learning/:chatJid', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const botId = req.params.botId as string
        const chatJid = decodeURIComponent(req.params.chatJid as string)
        const { pregunta, respuesta } = req.body
        if (!pregunta?.trim() || !respuesta?.trim()) {
            return res.status(400).json({ error: 'pregunta y respuesta son requeridas' })
        }
        const db = getDB()
        const bot = await db.collection('bot_configs').findOne({ _id: new ObjectId(botId), userId: req.userId })
        if (!bot) return res.status(404).json({ error: 'Bot no encontrado' })

        const bizDoc = await db.collection('business_info').findOne({ botId })
        const existingFaqs = Array.isArray(bizDoc?.learned_faqs) ? bizDoc.learned_faqs : []
        const newFaq = { pregunta: pregunta.trim(), respuesta: respuesta.trim(), confirmedAt: new Date(), source: chatJid }
        await db.collection('business_info').updateOne(
            { botId },
            { $set: { learned_faqs: [...existingFaqs, newFaq], updatedAt: new Date() } },
            { upsert: true }
        )
        res.json({ success: true })
    } catch (e: any) {
        res.status(500).json({ error: e.message })
    }
})

router.post('/chats/:botId/pause-bot/:chatJid', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const botId = req.params.botId as string
        const chatJid = decodeURIComponent(req.params.chatJid as string)

        // Preserve the original pausedAt if Qhatu already paused this chat via
        // [HANDOFF_SUGERIDO]. The auto-learn analyzer anchors its message slice
        // to that timestamp; overwriting it would erase the customer's original
        // question from the analysis window.
        const existing = await db.collection('chat_history').findOne({ key: `${botId}_${chatJid}` })
        const pauseUpdate: any = { botPaused: true }
        if (!existing?.pausedAt) {
            pauseUpdate.pausedAt = new Date()
            pauseUpdate.pauseReason = 'Pausado manualmente desde dashboard'
        }
        await db.collection('chat_history').updateOne(
            { key: `${botId}_${chatJid}` },
            { $set: pauseUpdate },
            { upsert: true }
        )
        await db.collection('wa_chats').updateOne(
            { botId, chatJid },
            { $set: { isBotPaused: true } }
        )

        res.json({ success: true })
    } catch (e: any) {
        res.status(500).json({ error: e.message })
    }
})

router.post('/chats/:botId/sync', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const botId = req.params.botId as string
        const count = await botManager.syncExistingChats(botId)
        res.json({ success: true, synced: count })
    } catch (e: any) {
        res.status(500).json({ error: e.message })
    }
})

router.get('/chats/:botId/unread-total', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const botId = req.params.botId as string
        const chats = await db.collection('wa_chats')
            .find(_mergeAssignedToScope({ botId, archived: { $ne: true } }, req))
            .toArray()
        const total = chats.reduce((sum: number, c: any) => sum + (c.unreadCount || 0), 0)
        res.json({ totalUnread: total })
    } catch (e: any) {
        res.status(500).json({ error: e.message })
    }
})

// ==================== WORKFLOW MAP (mapa mental del Qhatu) ====================

// Ownership check: the bot must belong to the authenticated user.
async function assertBotOwnership(req: AuthRequest, botId: string): Promise<boolean> {
    try {
        const db = getDB()
        const bot = await db.collection('bot_configs').findOne({ _id: new ObjectId(botId), userId: req.userId })
        return !!bot
    } catch { return false }
}

router.get('/workflow/:botId', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const botId = req.params.botId as string
        if (!(await assertBotOwnership(req, botId))) return res.status(404).json({ error: 'Bot no encontrado' })
        const map = await getWorkflowMap(botId)
        res.json(map)
    } catch (e: any) {
        res.status(500).json({ error: e.message })
    }
})

// Regenerate the workflow from current config. seedGenericWorkflow ahora hace
// el wipe internamente con mutex per-bot, así que cualquier número de llamadas
// concurrentes desde distintos save handlers se serializa y produce un solo
// workflow (sin duplicados en columnas).
router.post('/workflow/:botId/regenerate', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const botId = req.params.botId as string
        if (!(await assertBotOwnership(req, botId))) return res.status(404).json({ error: 'Bot no encontrado' })
        await seedGenericWorkflow(botId)
        const map = await getWorkflowMap(botId)
        res.json({ success: true, nodes: map.nodes.length, edges: map.edges.length })
    } catch (e: any) {
        console.error('[workflow regenerate]', e)
        res.status(500).json({ error: e.message })
    }
})

// Import workflow nodes + edges from a JSON export. Wipes existing nodes and
// inserts the imported ones with NEW IDs (the imported IDs come from another
// bot/export and would clash). Edges are remapped to the new node IDs using
// `metadata.seed_key` when available, or by index fallback.
router.post('/workflow/:botId/import', authMiddleware, async (req: AuthRequest, res: Response) => {
    const t0 = Date.now()
    try {
        const botId = req.params.botId as string
        if (!(await assertBotOwnership(req, botId))) return res.status(404).json({ error: 'Bot no encontrado' })
        const inNodes = Array.isArray(req.body?.nodes) ? req.body.nodes : []
        const inEdges = Array.isArray(req.body?.edges) ? req.body.edges : []
        if (inNodes.length === 0) return res.status(400).json({ error: 'JSON sin nodos para importar' })
        console.log(`[workflow import] botId=${botId} importing ${inNodes.length} nodes, ${inEdges.length} edges`)

        const supa = _wfSupa()

        // 1) Wipe existing nodes + edges para que no queden remanentes mezclados
        const { data: existing } = await supa.from('workflow_nodes').select('id').eq('bot_id', botId)
        const existingIds = (existing || []).map((n: any) => n.id)
        if (existingIds.length > 0) {
            await supa.from('workflow_edges').delete().eq('bot_id', botId).in('from_node_id', existingIds)
            await supa.from('workflow_edges').delete().eq('bot_id', botId).in('to_node_id', existingIds)
            await supa.from('workflow_nodes').delete().eq('bot_id', botId).in('id', existingIds)
        }

        // 2) Insertar los nodos. Mantenemos un map oldId → newId para reasignar edges.
        const idMap: Record<string, string> = {}
        const rows = inNodes.map((n: any, idx: number) => ({
            bot_id: botId,
            title: (n.title || 'Paso').toString().slice(0, 200),
            description: (n.description || '').toString(),
            node_type: n.node_type || 'step',
            source: n.source || 'imported',
            status: n.status || 'active',
            order_index: typeof n.order_index === 'number' ? n.order_index : idx,
            position_x: typeof n.position_x === 'number' ? n.position_x : 0,
            position_y: typeof n.position_y === 'number' ? n.position_y : 0,
            metadata: n.metadata || {}
        }))
        const { data: inserted, error: insErr } = await supa
            .from('workflow_nodes')
            .insert(rows)
            .select('id, metadata, order_index')
        if (insErr) throw new Error(insErr.message)

        // Mapear oldId → newId. Si no hay oldId, usar el índice (mismo orden).
        ;(inserted || []).forEach((row: any, idx: number) => {
            const original = inNodes[idx]
            if (original?.id) idMap[original.id] = row.id
        })

        // 3) Insertar edges remapeando IDs
        const edgeRows = inEdges
            .map((e: any) => {
                const from = idMap[e.from_node_id] || idMap[e.from] || idMap[e.source]
                const to = idMap[e.to_node_id] || idMap[e.to] || idMap[e.target]
                if (!from || !to) return null
                return { bot_id: botId, from_node_id: from, to_node_id: to, label: e.label || '' }
            })
            .filter(Boolean)
        if (edgeRows.length > 0) {
            const { error: eErr } = await supa.from('workflow_edges').insert(edgeRows)
            if (eErr) console.warn('[workflow import] edges save:', eErr.message)
        }

        console.log(`[workflow import] OK in ${Date.now() - t0}ms — ${rows.length} nodes, ${edgeRows.length} edges`)
        res.json({ success: true, nodes: rows.length, edges: edgeRows.length })
    } catch (e: any) {
        console.error('[workflow import] FAILED:', e?.message || e)
        res.status(500).json({ error: e.message })
    }
})

// ─── Workflow import desde PDF / Word ─────────────────────────────────────
//
// El emprendedor sube un PDF/Word describiendo cómo debe atender Maya y el
// servidor deriva nodos+edges con un LLM. Endpoint blindado contra:
//
//   1. Auth — `authMiddleware` exige JWT válido.
//   2. Multi-tenant — chequea que el bot pertenezca al usuario del token.
//   3. Tipo de archivo — `fileFilter` de multer rechaza por MIME+extensión
//      ANTES de leer el cuerpo. Evita gastar memoria con archivos no aceptados.
//   4. Tamaño — multer cortocircuita arriba de MAX_DOCUMENT_BYTES (10 MB).
//   5. Cantidad de archivos — solo 1 (multer `limits.files: 1`).
//   6. Form fields y headers — caps duros para evitar form-bombing.
//   7. Magic bytes — `validateDocumentUpload` re-lee los primeros bytes y
//      compara con la firma binaria (PDF "%PDF-", DOCX ZIP+manifest "word/").
//      Esto bloquea archivos renombrados (malware.exe → workflow.pdf).
//   8. Sanitización del nombre — el filename del cliente NUNCA llega ni a
//      disco ni a la BD; solo se loguea sanitizado para troubleshooting.
//   9. Storage en memoria — el buffer nunca se persiste en disco con un
//      nombre controlado por el cliente. Se procesa y se descarta.
//   10. Cap de texto extraído — antes de mandar al LLM se trunca a 50k chars
//       para acotar costo y latencia.
//   11. Validación estricta del JSON del LLM — schema, longitudes y caps de
//       cantidad de nodos/edges en `parseAndValidateLLMOutput`.
//   12. Reemplazo en BD usa Supabase con `bot_id` filtrado — no permite
//       cross-tenant write (RLS-friendly).
//   13. Errores genéricos en la respuesta al cliente — los detalles van a
//       logs server-side, NO al body de la respuesta (evita info leak).
router.post('/workflow/:botId/import-doc', authMiddleware, workflowDocRateLimit, (req: AuthRequest, res: Response) => {
    workflowDocUpload.single('document')(req as any, res as any, async (uploadErr: any) => {
        try {
            // multer rechazó (tipo, tamaño o cantidad)
            if (uploadErr) {
                const code = (uploadErr as any).code
                if (code === 'LIMIT_FILE_SIZE') {
                    return res.status(413).json({ error: `El archivo excede ${Math.round(MAX_DOCUMENT_BYTES / 1024 / 1024)} MB.` })
                }
                if (code === 'LIMIT_FILE_COUNT' || code === 'LIMIT_UNEXPECTED_FILE') {
                    return res.status(400).json({ error: 'Solo se permite un archivo por carga.' })
                }
                console.warn('[POST /workflow/import-doc] multer rejected:', uploadErr?.message || uploadErr)
                return res.status(400).json({ error: uploadErr?.message || 'Archivo rechazado.' })
            }

            const botId = req.params.botId as string
            const file = (req as any).file as Express.Multer.File | undefined
            if (!file || !file.buffer) {
                return res.status(400).json({ error: 'No se recibió ningún archivo.' })
            }

            // Multi-tenant — el bot DEBE pertenecer al userId del token
            const db = getDB()
            const bot = await db.collection('bot_configs').findOne({ _id: new ObjectId(botId), userId: req.userId })
            if (!bot) return res.status(404).json({ error: 'Bot no encontrado' })

            // Validación final: tamaño + extensión + MIME + magic bytes reales
            let validated
            try {
                validated = validateDocumentUpload({
                    buffer: file.buffer,
                    originalName: file.originalname,
                    mimeType: file.mimetype,
                })
            } catch (validErr: any) {
                console.warn(`[POST /workflow/${botId}/import-doc] rechazado por validación: ${validErr.message} (file="${String(file.originalname).slice(0,80)}")`)
                return res.status(400).json({ error: validErr.message })
            }

            console.log(`[POST /workflow/${botId}/import-doc] aceptado: ${validated.kind}, ${validated.sizeBytes} bytes, name="${validated.safeName}"`)

            // Procesar — extraer texto + LLM + reemplazar workflow
            try {
                const result = await importWorkflowFromDocument({
                    botId,
                    buffer: file.buffer,
                    kind: validated.kind,
                })
                // Limpieza explícita del buffer en memoria (best-effort, no
                // garantiza pero ayuda al GC)
                ;(file as any).buffer = null
                return res.json({
                    success: true,
                    nodesCreated: result.nodesCreated,
                    edgesCreated: result.edgesCreated,
                    file: { name: validated.safeName, kind: validated.kind, sizeKb: Math.round(validated.sizeBytes / 1024) }
                })
            } catch (procErr: any) {
                // Detalles van a logs server-side; al cliente solo un error genérico
                // o el mensaje de validación si es seguro mostrarlo.
                console.error(`[POST /workflow/${botId}/import-doc] procesamiento falló:`, procErr?.message || procErr)
                const safeMsg = typeof procErr?.message === 'string' && procErr.message.length < 200
                    ? procErr.message
                    : 'No se pudo procesar el archivo.'
                return res.status(422).json({ error: safeMsg })
            }
        } catch (e: any) {
            console.error('[POST /workflow/import-doc] error inesperado:', e?.message || e)
            return res.status(500).json({ error: 'Error interno procesando el archivo.' })
        }
    })
})

// Full export: bot config + business info + shipping + payments + workflow.
// El usuario puede usar este export para re-crear la tienda en otro lado vía
// el botón "Subir workflow" del registro de tiendas.
router.get('/workflow/:botId/export', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const botId = req.params.botId as string
        if (!(await assertBotOwnership(req, botId))) return res.status(404).json({ error: 'Bot no encontrado' })
        const db = getDB()
        const bot = await db.collection('bot_configs').findOne({ _id: new ObjectId(botId) })
        const biz = await db.collection('business_info').findOne({ botId })
        const map = await getWorkflowMap(botId)
        const payload = {
            version: '1.0',
            type: 'kipu_full_config',
            exported_at: new Date().toISOString(),
            bot_id: botId,
            config: {
                tienda: bot?.tienda || {},
                bot_name: bot?.botName || '',
                system_prompt: bot?.systemPrompt || '',
                greeting: bot?.greeting || '',
                operacion: bot?.operacion || {},
                shipping_config: bot?.operacion?.shippingConfig || biz?.shipping_config || null,
                products: biz?.products || [],
                payment_methods: biz?.payment_methods_structured || [],
                description: biz?.description || '',
                faqs: biz?.faqs || ''
            },
            workflow: { nodes: map.nodes, edges: map.edges }
        }
        res.json(payload)
    } catch (e: any) {
        console.error('[workflow export]', e)
        res.status(500).json({ error: e.message })
    }
})

router.post('/workflow/:botId/nodes', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const botId = req.params.botId as string
        if (!(await assertBotOwnership(req, botId))) return res.status(404).json({ error: 'Bot no encontrado' })
        const node = await wfCreateNode(botId, req.body || {})
        resumeAllBotChatsAfterConfig(botId).catch(() => {})
        res.json(node)
    } catch (e: any) {
        res.status(500).json({ error: e.message })
    }
})

router.put('/workflow/:botId/nodes/:nodeId', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const botId = req.params.botId as string
        const nodeId = req.params.nodeId as string
        if (!(await assertBotOwnership(req, botId))) return res.status(404).json({ error: 'Bot no encontrado' })
        const node = await wfUpdateNode(botId, nodeId, req.body || {})
        // Si cambiaron title o description, el ejemplo cacheado quedó stale —
        // limpiamos para forzar regeneración la próxima vez que se pida.
        const body = req.body || {}
        if (body.title !== undefined || body.description !== undefined || body.node_type !== undefined) {
            clearExampleCache(botId, nodeId).catch(e => console.warn('[clearExampleCache]', e))
        }
        resumeAllBotChatsAfterConfig(botId).catch(() => {})
        res.json(node)
    } catch (e: any) {
        res.status(500).json({ error: e.message })
    }
})

// ─── Ejemplos de mensaje del bot por nodo (LLM + cache en BD) ────────────
// GET → devuelve cacheado si está vigente; si no, regenera. Lazy-load desde
//       el editor visual al hacer click/hover en un nodo.
// POST /regenerate → fuerza regeneración aunque el cache esté vigente.
router.get('/workflow/:botId/nodes/:nodeId/example', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const botId = req.params.botId as string
        const nodeId = req.params.nodeId as string
        if (!(await assertBotOwnership(req, botId))) return res.status(404).json({ error: 'Bot no encontrado' })
        const result = await getOrGenerateExample(botId, nodeId)
        if (result.error === 'rate_limit_exceeded') return res.status(429).json(result)
        if (result.error === 'node_not_found') return res.status(404).json(result)
        res.json(result)
    } catch (e: any) {
        res.status(500).json({ error: e.message })
    }
})

router.post('/workflow/:botId/nodes/:nodeId/example/regenerate', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const botId = req.params.botId as string
        const nodeId = req.params.nodeId as string
        if (!(await assertBotOwnership(req, botId))) return res.status(404).json({ error: 'Bot no encontrado' })
        const result = await generateExampleForNode(botId, nodeId)
        if (result.error === 'rate_limit_exceeded') return res.status(429).json({ error: result.error })
        if (result.error === 'node_not_found') return res.status(404).json({ error: result.error })
        if (result.error) return res.status(500).json({ error: result.error })
        res.json({
            example: result.example,
            cached: false,
            generatedAt: result.generatedAt.toISOString()
        })
    } catch (e: any) {
        res.status(500).json({ error: e.message })
    }
})

router.delete('/workflow/:botId/nodes/:nodeId', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const botId = req.params.botId as string
        const nodeId = req.params.nodeId as string
        if (!(await assertBotOwnership(req, botId))) return res.status(404).json({ error: 'Bot no encontrado' })
        await wfDeleteNode(botId, nodeId)
        resumeAllBotChatsAfterConfig(botId).catch(() => {})
        res.json({ success: true })
    } catch (e: any) {
        res.status(500).json({ error: e.message })
    }
})

router.post('/workflow/:botId/edges', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const botId = req.params.botId as string
        const { from_node_id, to_node_id, label } = req.body || {}
        if (!from_node_id || !to_node_id) return res.status(400).json({ error: 'from_node_id y to_node_id requeridos' })
        if (!(await assertBotOwnership(req, botId))) return res.status(404).json({ error: 'Bot no encontrado' })
        const edge = await wfCreateEdge(botId, from_node_id, to_node_id, label || '')
        resumeAllBotChatsAfterConfig(botId).catch(() => {})
        res.json(edge)
    } catch (e: any) {
        res.status(500).json({ error: e.message })
    }
})

router.put('/workflow/:botId/edges/:edgeId', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const botId = req.params.botId as string
        const edgeId = req.params.edgeId as string
        const { label } = req.body || {}
        if (!(await assertBotOwnership(req, botId))) return res.status(404).json({ error: 'Bot no encontrado' })
        const edge = await wfUpdateEdge(botId, edgeId, { label })
        resumeAllBotChatsAfterConfig(botId).catch(() => {})
        res.json(edge)
    } catch (e: any) {
        res.status(500).json({ error: e.message })
    }
})

router.delete('/workflow/:botId/edges/:edgeId', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const botId = req.params.botId as string
        const edgeId = req.params.edgeId as string
        if (!(await assertBotOwnership(req, botId))) return res.status(404).json({ error: 'Bot no encontrado' })
        await wfDeleteEdge(botId, edgeId)
        resumeAllBotChatsAfterConfig(botId).catch(() => {})
        res.json({ success: true })
    } catch (e: any) {
        res.status(500).json({ error: e.message })
    }
})

// Learning hook: called when the user confirms a notification that adds new
// knowledge. Creates a pending node that the user must approve in the map UI.
router.post('/workflow/:botId/learned', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const botId = req.params.botId as string
        const { title, description, metadata } = req.body || {}
        if (!title) return res.status(400).json({ error: 'title requerido' })
        if (!(await assertBotOwnership(req, botId))) return res.status(404).json({ error: 'Bot no encontrado' })
        const node = await addLearnedNode(botId, String(title), String(description || ''), metadata || {})
        res.json(node)
    } catch (e: any) {
        res.status(500).json({ error: e.message })
    }
})

export default router

// ==================== INSTAGRAM & TIKTOK OAUTH + WEBHOOKS ====================
// These routes are added to the router above but documented separately for clarity

// --- Instagram OAuth ---
router.get('/auth/instagram', authMiddleware, async (req: AuthRequest, res: Response) => {
    // La conexión de Instagram está deshabilitada a nivel de producto
    // ("Próximamente"). La UI gatea el botón, este guard asegura que aunque
    // alguien llegue al endpoint directamente no se inicia ningún OAuth.
    return res.status(503).json({ error: 'Instagram: próximamente', comingSoon: true })
    try {
        const botId = req.query.botId as string
        if (!botId) return res.status(400).json({ error: 'botId required' })

        if (!instagramService.isConfigured()) {
            return res.status(500).json({ error: 'Instagram not configured. Set META_APP_ID, META_APP_SECRET, WEBHOOK_BASE_URL in .env' })
        }

        const url = instagramService.getOAuthURL(botId)
        res.json({ url })
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

router.get('/auth/instagram/callback', async (req: any, res: Response) => {
    try {
        const code = req.query.code as string
        const botId = req.query.state as string

        if (!code || !botId) {
            return res.send('<html><body><script>window.close()</script><h2>Error: Missing code or botId</h2></body></html>')
        }

        const result = await instagramService.handleOAuthCallback(code)

        // Save channel credentials to bot config
        const db = getDB()
        await db.collection('bot_configs').updateOne(
            { _id: new ObjectId(botId) },
            {
                $set: {
                    'channels.instagram': {
                        status: 'connected',
                        accessToken: result.accessToken,
                        igUserId: result.igUserId,
                        pageId: result.pageId,
                        pageName: result.pageName,
                        connectedAt: new Date()
                    }
                }
            }
        )

        console.log(`[Routes] Instagram connected for bot ${botId}: ${result.pageName}`)

        // Close the popup window and notify parent
        res.send(`<html><body><script>
            if (window.opener) { window.opener.postMessage({ type: 'ig-connected', botId: '${botId}' }, '*'); }
            window.close();
        </script><h2>✅ Instagram conectado exitosamente</h2><p>Puedes cerrar esta ventana.</p></body></html>`)
    } catch (error: any) {
        console.error('[Routes] Instagram OAuth error:', error)
        res.send(`<html><body><script>window.close()</script><h2>Error: ${error.message}</h2></body></html>`)
    }
})

// --- Instagram Webhook ---
router.get('/webhook/instagram', (req: any, res: Response) => {
    const mode = req.query['hub.mode']
    const token = req.query['hub.verify_token']
    const challenge = req.query['hub.challenge']

    const result = instagramService.verifyWebhook(mode, token, challenge)
    if (result) {
        res.status(200).send(result)
    } else {
        res.status(403).send('Verification failed')
    }
})

router.post('/webhook/instagram', async (req: any, res: Response) => {
    try {
        const messages = instagramService.parseWebhook(req.body)
        res.status(200).send('EVENT_RECEIVED')

        // Process messages asynchronously
        for (const msg of messages) {
            // Find which bot this IG account belongs to
            const db = getDB()
            const botConfig = await db.collection('bot_configs').findOne({
                'channels.instagram.igUserId': msg.recipientId,
                'channels.instagram.status': 'connected'
            })

            if (botConfig) {
                await botManager.handleIncomingIG(
                    botConfig._id.toString(),
                    msg.senderId,
                    msg.text
                )
            } else {
                console.warn(`[Webhook/IG] No bot found for IG user: ${msg.recipientId}`)
            }
        }
    } catch (error: any) {
        console.error('[Webhook/IG] Error:', error)
        res.status(200).send('EVENT_RECEIVED') // Always 200 for Meta
    }
})

// --- TikTok OAuth ---
router.get('/auth/tiktok', authMiddleware, async (req: AuthRequest, res: Response) => {
    // La conexión de TikTok está deshabilitada a nivel de producto
    // ("Próximamente"). Ver comentario en /auth/instagram.
    return res.status(503).json({ error: 'TikTok: próximamente', comingSoon: true })
    try {
        const botId = req.query.botId as string
        if (!botId) return res.status(400).json({ error: 'botId required' })

        if (!tiktokService.isConfigured()) {
            return res.status(500).json({ error: 'TikTok not configured. Set TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, WEBHOOK_BASE_URL in .env' })
        }

        const url = tiktokService.getOAuthURL(botId)
        res.json({ url })
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

router.get('/auth/tiktok/callback', async (req: any, res: Response) => {
    try {
        const code = req.query.code as string
        const botId = req.query.state as string

        if (!code || !botId) {
            return res.send('<html><body><script>window.close()</script><h2>Error: Missing code or botId</h2></body></html>')
        }

        const result = await tiktokService.handleOAuthCallback(code)

        // Save channel credentials to bot config
        const db = getDB()
        await db.collection('bot_configs').updateOne(
            { _id: new ObjectId(botId) },
            {
                $set: {
                    'channels.tiktok': {
                        status: 'connected',
                        accessToken: result.accessToken,
                        refreshToken: result.refreshToken,
                        openId: result.openId,
                        expiresIn: result.expiresIn,
                        connectedAt: new Date()
                    }
                }
            }
        )

        console.log(`[Routes] TikTok connected for bot ${botId}: ${result.openId}`)

        res.send(`<html><body><script>
            if (window.opener) { window.opener.postMessage({ type: 'tt-connected', botId: '${botId}' }, '*'); }
            window.close();
        </script><h2>✅ TikTok conectado exitosamente</h2><p>Puedes cerrar esta ventana.</p></body></html>`)
    } catch (error: any) {
        console.error('[Routes] TikTok OAuth error:', error)
        res.send(`<html><body><script>window.close()</script><h2>Error: ${error.message}</h2></body></html>`)
    }
})

// ═════════════════════════════════════════════════════════════════════════
// --- Meta Cloud API Webhook (WhatsApp Business Platform OFICIAL) ---
// GET: handshake con verify_token. POST: mensajes entrantes con firma HMAC.
// Reemplaza Baileys per-bot cuando bot.messagingProvider === 'meta'.
// Setup: dashboard onboarding guarda metaPhoneNumberId + metaAccessToken.
// ═════════════════════════════════════════════════════════════════════════
router.get('/webhook/meta', metaWebhookVerify)
router.post('/webhook/meta', metaWebhookHandler)

// Endpoint admin para validar credenciales Meta antes de conectar la tienda.
// Body: { phoneNumberId, accessToken }. Devuelve display_phone_number +
// verified_name si la auth es válida.
router.post('/meta/healthcheck', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const { phoneNumberId, accessToken } = req.body || {}
        if (!phoneNumberId || !accessToken) {
            return res.status(400).json({ error: 'phoneNumberId y accessToken son requeridos' })
        }
        const result = await metaCloudService.healthCheck({ phoneNumberId, accessToken })
        return res.json(result)
    } catch (e: any) {
        return res.status(500).json({ error: e?.message || 'Healthcheck failed' })
    }
})

// Guarda las credenciales Meta de un bot y lo marca como meta-conectado.
// Body: { botId, phoneNumberId, accessToken, wabaId? }
router.post('/meta/connect', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const { botId, phoneNumberId, accessToken, wabaId } = req.body || {}
        if (!botId || !phoneNumberId || !accessToken) {
            return res.status(400).json({ error: 'botId, phoneNumberId y accessToken son requeridos' })
        }
        // Verificar credenciales primero — no guardamos basura.
        const health = await metaCloudService.healthCheck({ phoneNumberId, accessToken })
        if (!health.ok) {
            return res.status(400).json({ error: `Credenciales inválidas: ${health.error}` })
        }
        const db = getDB()
        // Verificar que el bot pertenece al usuario (multi-tenant safety).
        const ownerUserId = await resolveOwnerUserId(req)
        const bot = await db.collection('bot_configs').findOne({ _id: new ObjectId(botId) })
        if (!bot) return res.status(404).json({ error: 'Bot no encontrado' })
        if (String(bot.userId) !== String(ownerUserId)) {
            return res.status(403).json({ error: 'No tienes permisos sobre este bot' })
        }
        await db.collection('bot_configs').updateOne(
            { _id: new ObjectId(botId) },
            { $set: {
                messagingProvider: 'meta',
                metaPhoneNumberId: String(phoneNumberId),
                metaAccessToken: String(accessToken),
                metaWabaId: wabaId ? String(wabaId) : undefined,
                metaConnected: true,
                metaConnectedAt: new Date(),
                connectedPhone: health.displayPhoneNumber || bot.connectedPhone,
            } }
        )
        return res.json({
            ok: true,
            displayPhoneNumber: health.displayPhoneNumber,
            verifiedName: health.verifiedName,
        })
    } catch (e: any) {
        return res.status(500).json({ error: e?.message || 'Connect failed' })
    }
})

// Desconecta Meta y vuelve al provider Baileys (rollback).
router.post('/meta/disconnect', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const { botId } = req.body || {}
        if (!botId) return res.status(400).json({ error: 'botId es requerido' })
        const db = getDB()
        const ownerUserId = await resolveOwnerUserId(req)
        const bot = await db.collection('bot_configs').findOne({ _id: new ObjectId(botId) })
        if (!bot) return res.status(404).json({ error: 'Bot no encontrado' })
        if (String(bot.userId) !== String(ownerUserId)) {
            return res.status(403).json({ error: 'No tienes permisos sobre este bot' })
        }
        await db.collection('bot_configs').updateOne(
            { _id: new ObjectId(botId) },
            { $set: {
                messagingProvider: 'baileys',
                metaConnected: false,
            } }
        )
        return res.json({ ok: true })
    } catch (e: any) {
        return res.status(500).json({ error: e?.message || 'Disconnect failed' })
    }
})

// --- TikTok Webhook ---
router.post('/webhook/tiktok', async (req: any, res: Response) => {
    try {
        // Handle verification challenge
        const challenge = tiktokService.verifyWebhook(req.body)
        if (challenge) {
            return res.status(200).json({ challenge })
        }

        const messages = tiktokService.parseWebhook(req.body)
        res.status(200).send('OK')

        for (const msg of messages) {
            // Find which bot this TikTok account belongs to
            const db = getDB()
            const botConfig = await db.collection('bot_configs').findOne({
                'channels.tiktok.status': 'connected'
            })

            if (botConfig) {
                await botManager.handleIncomingTT(
                    botConfig._id.toString(),
                    msg.senderId,
                    msg.conversationId,
                    msg.text
                )
            } else {
                console.warn(`[Webhook/TT] No bot found for TikTok message`)
            }
        }
    } catch (error: any) {
        console.error('[Webhook/TT] Error:', error)
        res.status(200).send('OK')
    }
})

// --- Disconnect Instagram/TikTok ---
router.post('/bots/:id/disconnect-ig', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const botId = req.params.id as string
        await db.collection('bot_configs').updateOne(
            { _id: new ObjectId(botId), userId: req.userId },
            { $set: { 'channels.instagram.status': 'disconnected', 'channels.instagram.accessToken': null } }
        )
        res.json({ message: 'Instagram desconectado' })
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

router.post('/bots/:id/disconnect-tt', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const botId = req.params.id as string
        await db.collection('bot_configs').updateOne(
            { _id: new ObjectId(botId), userId: req.userId },
            { $set: { 'channels.tiktok.status': 'disconnected', 'channels.tiktok.accessToken': null } }
        )
        res.json({ message: 'TikTok desconectado' })
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

// --- Channel Status ---
router.get('/bots/:id/channels', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const db = getDB()
        const bot = await db.collection('bot_configs').findOne({
            _id: new ObjectId(req.params.id as string),
            userId: req.userId
        })
        if (!bot) return res.status(404).json({ error: 'Bot not found' })

        res.json({
            whatsapp: { status: bot.status || 'disconnected', phoneNumber: bot.phoneNumber || null },
            instagram: {
                status: bot.channels?.instagram?.status || 'disconnected',
                pageName: bot.channels?.instagram?.pageName || null
            },
            tiktok: {
                status: bot.channels?.tiktok?.status || 'disconnected',
                openId: bot.channels?.tiktok?.openId || null
            }
        })
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

// ==================== MANYCHAT API — INSTAGRAM & TIKTOK DMS ====================

/**
 * ManyChat Webhook — receives incoming DMs from Instagram/TikTok
 * 
 * Configure in ManyChat Flow Builder:
 * 1. Create a flow triggered by "User Sends Message"
 * 2. Add an "External Request" (POST) action pointing to:
 *    https://YOUR_DOMAIN/api/webhook/manychat
 * 3. Send these fields in the JSON body:
 *    {
 *      "subscriber_id": {{subscriber_id}},
 *      "first_name": {{first_name}},
 *      "last_name": {{last_name}},
 *      "last_input_text": {{last_input_text}},
 *      "channel": "instagram",
 *      "bot_id": "YOUR_KIPU_BOT_ID",
 *      "ig_username": {{ig_username}},
 *      "phone": {{phone}},
 *      "email": {{email}}
 *    }
 * 4. Set channel to "tiktok" for TikTok flows
 */
router.post('/webhook/manychat', async (req: AuthRequest, res: Response) => {
    try {
        const {
            subscriber_id,
            first_name,
            last_name,
            last_input_text,
            channel,
            bot_id,
            ig_username,
            phone,
            email
        } = req.body

        // Validate required fields
        if (!subscriber_id || !last_input_text) {
            return res.status(400).json({
                status: 'error',
                message: 'subscriber_id and last_input_text are required'
            })
        }

        const subscriberName = `${first_name || ''} ${last_name || ''}`.trim() || `MC_${subscriber_id}`
        const msgChannel = (channel || 'instagram').toLowerCase() as 'instagram' | 'tiktok'

        console.log(`[ManyChat Webhook] 📩 ${msgChannel} DM from ${subscriberName} (${subscriber_id}): "${(last_input_text || '').substring(0, 80)}..."`)

        // Determine which bot to route to
        let targetBotId = bot_id

        if (!targetBotId) {
            // Fallback: find the first bot that has ManyChat configured
            const db = getDB()
            const anyBot = await db.collection('bot_configs').findOne({
                'channels.manychat.enabled': true
            })
            if (anyBot) {
                targetBotId = anyBot._id.toString()
            } else {
                // Last resort: use the first active bot
                const firstBot = await db.collection('bot_configs').findOne({ status: 'connected' })
                if (firstBot) targetBotId = firstBot._id.toString()
            }
        }

        if (!targetBotId) {
            console.error('[ManyChat Webhook] No bot_id provided and no bots found')
            return res.status(400).json({
                status: 'error',
                message: 'bot_id is required or at least one bot must be active'
            })
        }

        // Save subscriber metadata to leads collection for CRM sync
        try {
            const db = getDB()
            const fromId = `mc_${msgChannel}_${subscriber_id}`
            await db.collection('leads').updateOne(
                { botId: targetBotId, phone: fromId },
                {
                    $set: {
                        contactName: subscriberName,
                        channel: msgChannel,
                        manychatSubscriberId: subscriber_id,
                        igUsername: ig_username || null,
                        email: email || null,
                        realPhone: phone || null,
                        updatedAt: new Date()
                    },
                    $setOnInsert: {
                        botId: targetBotId,
                        phone: fromId,
                        createdAt: new Date(),
                        leadScore: 0,
                        scoreLevel: 'FRIO'
                    }
                },
                { upsert: true }
            )
        } catch (leadErr) {
            console.error('[ManyChat Webhook] Error saving lead:', leadErr)
        }

        // Route to bot-manager (async, don't block the webhook response)
        botManager.handleIncomingManyChat(
            targetBotId,
            subscriber_id,
            subscriberName,
            last_input_text,
            msgChannel
        ).catch(err => console.error('[ManyChat Webhook] handleIncomingManyChat error:', err))

        // Respond immediately to ManyChat (they expect fast responses)
        res.json({ status: 'success', message: 'Message received and being processed' })
    } catch (error: any) {
        console.error('[ManyChat Webhook] Error:', error)
        res.status(500).json({ status: 'error', message: error.message })
    }
})

/**
 * ManyChat Status — health check for the ManyChat API connection
 */
router.get('/manychat/status', async (_req: AuthRequest, res: Response) => {
    try {
        if (!manychatService.isConfigured()) {
            return res.json({
                status: 'not_configured',
                message: 'MANYCHAT_API_KEY not set in .env'
            })
        }

        const pageInfo = await manychatService.getPageInfo()
        if (pageInfo) {
            res.json({
                status: 'connected',
                page: pageInfo
            })
        } else {
            res.json({
                status: 'error',
                message: 'Could not reach ManyChat API'
            })
        }
    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message })
    }
})

/**
 * ManyChat Test — send a test message to a subscriber
 */
router.post('/manychat/test', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const { subscriber_id, message } = req.body
        if (!subscriber_id || !message) {
            return res.status(400).json({ error: 'subscriber_id and message are required' })
        }

        if (!manychatService.isConfigured()) {
            return res.status(500).json({ error: 'MANYCHAT_API_KEY not set in .env' })
        }

        const sent = await manychatService.sendTextMessage(subscriber_id, message)
        if (sent) {
            res.json({ success: true, message: 'Test message sent' })
        } else {
            res.json({ success: false, message: 'Failed to send — check console logs for details' })
        }
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

/**
 * ManyChat Subscriber Info — get details about a specific subscriber
 */
router.get('/manychat/subscriber/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const subscriberId = parseInt(req.params.id as string)
        if (isNaN(subscriberId)) {
            return res.status(400).json({ error: 'Invalid subscriber_id' })
        }

        const info = await manychatService.getSubscriberInfo(subscriberId)
        if (info) {
            res.json({ status: 'success', data: info })
        } else {
            res.status(404).json({ status: 'error', message: 'Subscriber not found' })
        }
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

// ==================== APIFY ENRICHMENT ====================

router.post('/apify/start', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const result = await startApifyActor()
        if (result) {
            startApifyPolling(30000) // Poll every 30s
            res.json({ status: 'started', ...result })
        } else {
            res.status(500).json({ error: 'Failed to start Apify actor. Check APIFY_API_TOKEN.' })
        }
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

router.post('/apify/poll', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const count = await pollApifyDataset()
        res.json({ newEntries: count })
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

router.get('/apify/status', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const stats = getApifyCacheStats()
        res.json(stats)
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

router.post('/apify/add-sender', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const { phoneOrId, senderNumber, senderName } = req.body
        if (!phoneOrId || !senderNumber) return res.status(400).json({ error: 'phoneOrId and senderNumber required' })
        addSenderInfo(phoneOrId, senderNumber, senderName || '')
        res.json({ status: 'added' })
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})


import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { getDB } from './db.service'
import { validatePasswordStrength } from '../lib/passwordValidator'

// SEGURIDAD: NUNCA caer a un default público — si la env no está cargada, el
// proceso falla al arrancar. El default anterior ('kobrai-default-secret')
// estaba en el repo: cualquiera con acceso al código podía firmar JWTs y
// suplantar usuarios. Generar con `openssl rand -hex 64` y poner en .env.
const JWT_SECRET: string = (() => {
    const s = process.env.JWT_SECRET
    if (!s || s.length < 32) {
        throw new Error(
            'FATAL: JWT_SECRET no está definido o es demasiado corto (mín 32 chars). ' +
            'Generá uno con `openssl rand -hex 64` y agregalo a tu .env antes de iniciar.'
        )
    }
    return s
})()

// Mantener la lista canónica de planes ANTES de la interfaz User para que la
// interfaz pueda referenciar el tipo derivado y no duplicar el union literal
// (que ya tuvo un drift histórico — la interfaz declaraba 'starter|pro|business'
// pero el código asignaba 'enterprise', generando un type lie silencioso).
export const VALID_PLANS = ['starter', 'pro', 'business', 'enterprise'] as const
export type Plan = typeof VALID_PLANS[number]

export interface User {
    _id?: any
    email: string
    password: string
    name: string
    businessName: string
    plan: Plan
    createdAt: Date | string
    tutorial_shown?: boolean
}

export async function registerUser(email: string, password: string, name: string, businessName: string): Promise<{ user: Omit<User, 'password'>, token: string }> {
    const db = getDB()
    const normalizedEmail = email.trim().toLowerCase()

    // Validación de contraseña en server — defensa-en-profundidad. El cliente
    // valida con zxcvbn + reglas regex, pero alguien puede hacer POST directo.
    const passwordCheck = validatePasswordStrength(password, [normalizedEmail, name, businessName])
    if (!passwordCheck.valid) {
        throw new Error(passwordCheck.message)
    }

    console.log(`[AUTH:Register] Checking: "${normalizedEmail}"`)

    const existing = await db.collection('users').findOne({ email: normalizedEmail })

    if (existing) {
        console.log(`[AUTH:Register] Conflict! Email found in DB: "${existing.email}" (ID: ${existing._id})`)
        throw new Error('Ya existe una cuenta con este correo. Inicia sesión')
    }

    const hashedPassword = await bcrypt.hash(password, 10)

    // Política temporal (mes de prueba gratis): todos los usuarios nuevos
    // arrancan en Enterprise. Se cambia cuando habilitemos la facturación
    // real. Cambio coordinado con el SQL `migration_all_users_enterprise.sql`
    // que sube a Enterprise a los usuarios pre-existentes.
    const result = await db.collection('users').insertOne({
        email: normalizedEmail,
        password: hashedPassword,
        name,
        businessName,
        plan: 'enterprise'
    })

    // Try to set tutorial_shown=false (may fail if column doesn't exist in Supabase)
    try {
        await db.collection('users').updateOne(
            { _id: result.insertedId },
            { $set: { tutorial_shown: false } }
        )
    } catch (e: any) {
        console.log(`[AUTH:Register] Note: could not set tutorial_shown: ${e.message}`)
    }

    await db.collection('bot_configs').insertOne({
        userId: result.insertedId.toString(),
        botName: businessName,
        tienda: { nombre: businessName },
        operacion: {},
        categoria_config: {},
        base_conocimiento: { fuente: 'manual', bloques: [] },
        products: [],
        metadata: {
            registro_completo: false,
            paso_actual: 1,
            fecha_registro: new Date(),
            ultima_modificacion: new Date()
        },
        systemPrompt: 'Eres un asistente de ventas amigable y profesional para PYMEs peruanas. Responde siempre en español de manera natural y concisa.',
        greeting: `Hola, bienvenido a ${businessName}, ¿cómo podemos ayudarte?`,
        status: 'disconnected',
        phoneNumber: '',
        createdAt: new Date()
    })

    const user = await db.collection('users').findOne({ _id: result.insertedId })
    if (!user) throw new Error('Error al registrar usuario')

    const token = jwt.sign({ userId: user._id.toString(), email: normalizedEmail }, JWT_SECRET, { expiresIn: '30d' })

    const { password: _, ...userWithoutPassword } = user
    return { user: userWithoutPassword, token }
}

export async function loginUser(email: string, password: string): Promise<{ user: Omit<User, 'password'>, token: string }> {
    const db = getDB()
    const normalizedEmail = email.trim().toLowerCase()
    console.log(`[AUTH:Login] Searching for: "${normalizedEmail}"`)

    const user = await db.collection('users').findOne({ email: normalizedEmail })

    if (!user) {
        const count = await db.collection('users').countDocuments({})
        console.log(`[AUTH:Login] User NOT found: "${normalizedEmail}". Total users in DB: ${count}`)
        throw new Error('No encontramos una cuenta con ese correo. Regístrate')
    }

    console.log(`[AUTH:Login] User found: ${user._id}. Validating password...`)

    const isValid = await bcrypt.compare(password, user.password)
    if (!isValid) throw new Error('Contraseña incorrecta. Inténtalo de nuevo')

    const token = jwt.sign({ userId: user._id.toString(), email: normalizedEmail }, JWT_SECRET, { expiresIn: '30d' })

    const { password: _, ...userWithoutPassword } = user
    return { user: userWithoutPassword, token }
}

// ─── Google Sign-In ─────────────────────────────────────────────────
// Login o registro automático con Google ID Token (de Google Identity Services).
// Si el email no existe → crea cuenta nueva (sin password, marca authProvider='google').
// Si existe → log in normal.
// Verificación del token vía endpoint público de Google (oauth2.googleapis.com/tokeninfo).
// Esto evita dependencia extra; en producción de alto volumen, considerar
// google-auth-library para verificación local con JWKS cacheado.
export async function loginOrRegisterWithGoogle(idToken: string): Promise<{ user: Omit<User, 'password'>, token: string, isNew: boolean }> {
    if (!idToken || typeof idToken !== 'string') {
        throw new Error('Token de Google faltante')
    }
    const expectedAudience = process.env.GOOGLE_CLIENT_ID
    if (!expectedAudience) {
        throw new Error('Google Sign-In no está configurado en el servidor (falta GOOGLE_CLIENT_ID en .env)')
    }

    // Verificación del id_token contra el endpoint público de Google
    const verifyRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`)
    if (!verifyRes.ok) {
        throw new Error('Token de Google inválido o expirado')
    }
    const payload: any = await verifyRes.json()

    // Validaciones críticas: audience match (que el token sea para NUESTRA app)
    if (payload.aud !== expectedAudience) {
        throw new Error('Token de Google no autorizado para esta app')
    }
    if (payload.exp && Number(payload.exp) * 1000 < Date.now()) {
        throw new Error('Token de Google expirado')
    }
    // El issuer debe ser Google
    if (payload.iss !== 'accounts.google.com' && payload.iss !== 'https://accounts.google.com') {
        throw new Error('Issuer del token no es Google')
    }

    const email = String(payload.email || '').trim().toLowerCase()
    const emailVerified = payload.email_verified === 'true' || payload.email_verified === true
    if (!email || !emailVerified) {
        throw new Error('No pudimos verificar tu email de Google')
    }
    const name: string = payload.name || payload.given_name || email.split('@')[0]
    const picture: string = payload.picture || ''

    const db = getDB()
    let user = await db.collection('users').findOne({ email })
    let isNew = false

    if (!user) {
        // Registro automático con default businessName — el usuario lo edita en el wizard
        isNew = true
        const businessName = name ? `Tienda de ${name.split(' ')[0]}` : 'Mi tienda'

        const result = await db.collection('users').insertOne({
            email,
            password: '',                 // no password para usuarios Google-auth
            name,
            businessName,
            plan: 'enterprise',
            authProvider: 'google',
            photoUrl: picture
        })
        try {
            await db.collection('users').updateOne(
                { _id: result.insertedId },
                { $set: { tutorial_shown: false } }
            )
        } catch (_) { /* ignore */ }

        await db.collection('bot_configs').insertOne({
            userId: result.insertedId.toString(),
            botName: businessName,
            tienda: { nombre: businessName },
            operacion: {},
            categoria_config: {},
            base_conocimiento: { fuente: 'manual', bloques: [] },
            products: [],
            metadata: {
                registro_completo: false,
                paso_actual: 1,
                fecha_registro: new Date(),
                ultima_modificacion: new Date()
            },
            systemPrompt: 'Eres un asistente de ventas amigable y profesional para PYMEs peruanas. Responde siempre en español de manera natural y concisa.',
            greeting: `Hola, bienvenido a ${businessName}, ¿cómo podemos ayudarte?`,
            status: 'disconnected',
            phoneNumber: '',
            createdAt: new Date()
        })

        user = await db.collection('users').findOne({ _id: result.insertedId })
    }

    if (!user) throw new Error('Error al crear/encontrar usuario via Google')

    const token = jwt.sign({ userId: user._id.toString(), email }, JWT_SECRET, { expiresIn: '30d' })
    const { password: _, ...userWithoutPassword } = user
    return { user: userWithoutPassword, token, isNew }
}

export function verifyToken(token: string): { userId: string, email: string } {
    try {
        return jwt.verify(token, JWT_SECRET) as { userId: string, email: string }
    } catch {
        throw new Error('Token inválido o expirado')
    }
}

// ─── G E1 — Profile / Settings ─────────────────────────────────────────
// VALID_PLANS y Plan ahora están declarados arriba (antes de la interfaz
// User) como única fuente de verdad. Cualquier call-site que hoy importe
// estos símbolos sigue resolviendo a la misma definición.

export async function changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const db = getDB()
    const { ObjectId } = await import('./db.service')
    const user = await db.collection('users').findOne({ _id: new ObjectId(userId) })
    if (!user) throw new Error('Usuario no encontrado')

    // Mismo validador estricto que el registro: 10+ chars, upper/lower/digit/
    // special, score zxcvbn ≥3. Pasamos email + name como userInputs para
    // que zxcvbn penalice si la nueva password los contiene.
    const passwordCheck = validatePasswordStrength(newPassword, [user.email || '', user.name || '', user.businessName || ''])
    if (!passwordCheck.valid) {
        throw new Error(passwordCheck.message)
    }

    const isValid = await bcrypt.compare(currentPassword, user.password)
    if (!isValid) throw new Error('La contraseña actual es incorrecta')

    const hashed = await bcrypt.hash(newPassword, 10)
    await db.collection('users').updateOne(
        { _id: new ObjectId(userId) },
        { $set: { password: hashed, updatedAt: new Date() } }
    )
}

export async function updateProfile(userId: string, updates: { name?: string, businessName?: string, photoUrl?: string }): Promise<void> {
    const db = getDB()
    const { ObjectId } = await import('./db.service')
    const safe: Record<string, any> = { updatedAt: new Date() }
    if (typeof updates.name === 'string') {
        const trimmed = updates.name.trim()
        if (trimmed.length === 0) throw new Error('El nombre no puede estar vacío')
        if (trimmed.length > 100) throw new Error('El nombre es demasiado largo')
        safe.name = trimmed
    }
    if (typeof updates.businessName === 'string') {
        const trimmed = updates.businessName.trim()
        if (trimmed.length > 100) throw new Error('El nombre del negocio es demasiado largo')
        safe.businessName = trimmed
    }
    if (typeof updates.photoUrl === 'string') {
        safe.photoUrl = updates.photoUrl.trim()
    }
    if (Object.keys(safe).length === 1) return // only updatedAt — nothing meaningful to update
    await db.collection('users').updateOne(
        { _id: new ObjectId(userId) },
        { $set: safe }
    )
}

export async function changePlan(userId: string, newPlan: string): Promise<void> {
    const normalized = String(newPlan || '').toLowerCase()
    if (!(VALID_PLANS as readonly string[]).includes(normalized)) {
        throw new Error(`Plan inválido. Opciones: ${VALID_PLANS.join(', ')}`)
    }
    const db = getDB()
    const { ObjectId } = await import('./db.service')
    await db.collection('users').updateOne(
        { _id: new ObjectId(userId) },
        { $set: { plan: normalized, planChangedAt: new Date(), updatedAt: new Date() } }
    )
}

import 'dotenv/config'
import { join } from 'path'
import express from 'express'
import cors from 'cors'
import { connectDB } from './services/db.service'
import { botManager } from './services/bot-manager'
import apiRoutes from './api/routes'

console.log('=== RecoveryAI - Plataforma SaaS ===')
console.log('SUPABASE_URL:', process.env.SUPABASE_URL ? '✅' : '❌')
console.log('SUPABASE_SERVICE_ROLE_KEY:', process.env.SUPABASE_SERVICE_ROLE_KEY ? '✅' : '❌')
console.log('GOOGLE_API_KEY:', process.env.GOOGLE_API_KEY ? '✅' : '❌')
console.log('JWT_SECRET:', process.env.JWT_SECRET ? '✅' : '❌')
console.log('====================================')

const DASHBOARD_PORT = process.env.DASHBOARD_PORT || 3009

const main = async () => {
    // Conectar a Supabase
    await connectDB()

    // Crear servidor Express
    const app = express()
    app.use(cors())
    // Captura el raw body junto al parse de JSON. El raw Buffer queda en
    // (req as any).rawBody y se usa para verificar la firma HMAC del webhook
    // de Meta (X-Hub-Signature-256). Sin esto, el JSON.stringify(req.body)
    // produciría un hash distinto al que Meta firmó (orden de claves, espacios).
    app.use(express.json({
        limit: '10mb',
        verify: (req: any, _res, buf) => { req.rawBody = buf },
    }))

    // Garantizar que req.body siempre sea un objeto — evita que los handlers
    // crasheen al hacer destructuring de `req.body` cuando el cliente no envía
    // Content-Type: application/json o manda cuerpo vacío.
    app.use((req, _res, next) => { if (req.body == null) req.body = {}; next() })

    // API routes
    app.use('/api', apiRoutes)

    const noStore = (_req: any, res: any, next: any) => {
        res.set('Cache-Control', 'no-store, must-revalidate')
        next()
    }

    // Landing page — tukipu.com/ (MUST be before static middleware)
    app.get('/', noStore, (_req, res) => {
        res.sendFile(join(process.cwd(), 'dashboard', 'landing.html'))
    })

    // Dashboard (login + app) — tukipu.com/panel
    app.get('/panel', noStore, (_req, res) => {
        res.sendFile(join(process.cwd(), 'dashboard', 'index.html'))
    })

    // Archivos estáticos (css/, js/) — sin servir index.html como default
    app.use(express.static(join(process.cwd(), 'dashboard'), { index: false, etag: false, lastModified: false, setHeaders: (res) => res.set('Cache-Control', 'no-store, must-revalidate') }))

    // SPA fallback — cualquier otra ruta sirve el dashboard
    app.use((req: any, res: any) => {
        if (!req.path.startsWith('/api')) {
            res.set('Cache-Control', 'no-store, must-revalidate')
            res.sendFile(join(process.cwd(), 'dashboard', 'index.html'))
        }
    })

    app.listen(+DASHBOARD_PORT, () => {
        console.log(`\n🚀 Dashboard: http://localhost:${DASHBOARD_PORT}`)
        console.log(`📡 API: http://localhost:${DASHBOARD_PORT}/api`)
    })

    // Reconectar bots activos
    setTimeout(() => {
        botManager.reconnectActiveBots()
    }, 3000)
}

main().catch(console.error)

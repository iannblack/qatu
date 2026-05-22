import { GoogleGenerativeAI } from '@google/generative-ai'
import { getDB, ObjectId } from './db.service'

// ═══════════════════════════════════════════════════════════
// P-00 — KIPU ANALYTICS ENGINE (System Prompt)
// ═══════════════════════════════════════════════════════════
const SYSTEM_PROMPT_P00 = `Eres KIPU, el motor de inteligencia de negocios de KobraAI.
Eres el "empleado más inteligente" del empresario: analizas sus datos en tiempo real y le dices exactamente qué está pasando, por qué y qué hacer.

== TU IDENTIDAD ==
- Nombre: Qhatu Analytics Engine
- Rol: Director de Inteligencia de Negocios interno del empresario
- Voz: Directa, clara, sin jerga financiera innecesaria. Hablas como un socio de confianza, no como un contador. Usas ejemplos con montos reales (soles).
- Nunca dices "no tengo suficientes datos" sin proponer QUÉ dato falta y cómo obtenerlo.

== ARQUITECTURA DEL SISTEMA ==
Operas sobre 2 capas de datos:

PARTE A — Datos Automáticos (siempre disponibles):
- Revenue total, pedidos, ticket promedio, tasa de conversión
- Mensajes por canal (WhatsApp, Instagram, TikTok)
- Productos más consultados, horarios pico
- ~65 métricas automáticas calculadas por KobraAI

PARTE B — Configuración Avanzada (datos ingresados por el empresario):
- product_costs: Costo unitario por producto
- fixed_expenses: Gastos fijos mensuales (alquiler, sueldos, luz, etc.)
- variable_expenses_formula: Costo variable por pedido
- product_stock: Stock actual, stock mínimo, punto de reorden
- revenue_goal: Meta de revenue mensual
- orders_goal: Meta de pedidos mensuales
- ad_spend_by_channel: Gasto en publicidad por canal
- max_daily_orders: Capacidad máxima de pedidos por día
- team_members: Equipo (nombre, rol, horas/día)
- prep_time_minutes: Tiempo de preparación por pedido
- suppliers: Proveedores (nombre, productos, lead time en días)
- discount_policies: Políticas de descuento
- payment_methods: Métodos de pago aceptados
- delivery_zones: Zonas de delivery (zona, costo, activo)
- return_policy: Política de devoluciones

== 7 DASHBOARDS Y SUS MÉTRICAS ==
D1: Rentabilidad Real (13 métricas) — Requiere: product_costs
D2: Inventario & Stock (10 métricas) — Requiere: product_stock
D3: Metas & Crecimiento (7 métricas) — Requiere: revenue_goal
D4: Marketing ROI (9 métricas) — Requiere: ad_spend_by_channel
D5: Capacidad Operativa (8 métricas) — Requiere: max_daily_orders
D6: Políticas & Logística (7 métricas) — Requiere: payment_methods + delivery_zones
D7: Flujo de Caja (6 métricas) — Requiere: fixed_expenses + product_costs + product_stock

== REGLAS DE RESPUESTA ==
1. SIEMPRE incluye el número concreto en soles (S/) cuando hablas de impacto.
2. SIEMPRE termina con 1 acción concreta que el empresario puede hacer HOY.
3. Si una métrica está bloqueada, di exactamente qué dato necesita ingresar.
4. Prioriza alertas críticas: flujo de caja negativo > quiebre de stock > margen negativo.
5. Usa emojis funcionales: 🔴 crítico, 🟡 atención, 🟢 bien, 📈 subiendo, 📉 bajando.
6. Nunca muestres fórmulas matemáticas al empresario. Solo resultados + interpretación.
7. Ajusta el lenguaje al sector del negocio (no igual para moda que para restaurante).

== FORMATO DE RESPUESTA ESTÁNDAR ==
Responde SIEMPRE en JSON válido con este formato exacto:
{
  "status": "ok|warning|critical",
  "headline": "Frase de 1 línea que resume la situación",
  "metrics": [{"name": "nombre", "value": "valor", "trend": "up|down|stable", "emoji": "emoji"}],
  "top_alert": "La alerta más importante activa",
  "action_today": "Una acción específica para hoy",
  "unlocked_count": N,
  "total_metrics": 55
}`

// ═══════════════════════════════════════════════════════════
// P-01 — KIPU ONBOARDING ASSISTANT (System Prompt)
// ═══════════════════════════════════════════════════════════
const SYSTEM_PROMPT_P01 = `Eres el asistente de configuración de Qhatu. Tu misión es ayudar al empresario a desbloquear sus 55 métricas avanzadas de negocio completando su Configuración Avanzada. Sé motivador, concreto y muestra el impacto de cada dato que pide.

== FLUJO DE ONBOARDING (orden de prioridad) ==

PASO 1 — COSTOS DE PRODUCTOS (Desbloquea Dashboard de Rentabilidad)
Pregunta: "¿Cuánto te cuesta producir o comprar cada producto que vendes?"
Ejemplo: "Si vendes una torta de S/80, ¿cuánto gastas en ingredientes + tiempo?"
Impacto al completar: "Sabrás tu margen real por cada sol que vendes."
Campo: product_costs { producto_id: costo_unitario }

PASO 2 — GASTOS FIJOS (Completa Rentabilidad + Desbloquea Flujo de Caja)
Pregunta: "¿Cuánto gastas fijo al mes sin importar cuánto vendas?"
Ejemplo: "Alquiler, sueldos, internet, luz, aplicaciones, etc."
Impacto: "Calcularemos tu punto de equilibrio exacto."
Campo: fixed_expenses (decimal, soles/mes)

PASO 3 — STOCK ACTUAL (Desbloquea Inventario)
Pregunta: "¿Cuántas unidades tienes ahora mismo de cada producto?"
Ejemplo: "10 tortas de chocolate, 5 de vainilla, etc."
Impacto: "Te avisaremos antes de quedarte sin stock."
Campo: product_stock { producto_id: { current, min, reorder_point } }

PASO 4 — META MENSUAL (Desbloquea Metas & Crecimiento)
Pregunta: "¿Cuánto quieres vender este mes en soles?"
Ejemplo: "Meta de S/8,000 en ventas."
Impacto: "Verás cada día si vas a llegar o no y cuánto necesitas vender HOY."
Campo: revenue_goal (decimal)

PASO 5 — GASTO EN PUBLICIDAD (Desbloquea Marketing ROI)
Pregunta: "¿Cuánto inviertes al mes en publicidad por canal?"
Ejemplo: "Instagram Ads: S/200, TikTok: S/150, sin publicidad: S/0"
Impacto: "Sabrás exactamente cuánto te cuesta conseguir cada cliente."
Campo: ad_spend_by_channel { whatsapp, instagram, tiktok }

PASO 6 — CAPACIDAD MÁXIMA (Desbloquea Capacidad Operativa)
Pregunta: "¿Cuántos pedidos puedes manejar como máximo en un día?"
Ejemplo: "Máximo 20 tortas al día."
Impacto: "Sabrás cuándo vas a colapsar antes de que pase."
Campo: max_daily_orders (integer)

PASO 7 — MÉTODOS DE PAGO (Desbloquea Políticas & Logística)
Pregunta: "¿Qué métodos de pago aceptas?"
Opciones: Yape, Plin, Transferencia, Tarjeta, Efectivo
Impacto: "Verás cuánto dinero pierdes por no aceptar ciertos métodos."
Campo: payment_methods (array)

PASO 8 — ZONAS DE DELIVERY (Completa Logística)
Pregunta: "¿A qué zonas haces delivery y cuánto cobras por zona?"
Ejemplo: "Miraflores: S/5, San Isidro: S/8, no delivery: S/0"
Impacto: "Verás qué zonas son más rentables y cuánto revenue pierdes por zonas no atendidas."
Campo: delivery_zones [{ zone_name, cost, active }]

== REGLAS DEL ASISTENTE ==
1. Pide UN campo a la vez. No abrumes con todos los pasos juntos.
2. Muestra siempre el beneficio CONCRETO antes de pedir el dato.
3. Si el empresario no sabe un valor, ayúdalo a estimarlo con ejemplos.
4. Celebra cada campo completado: "¡Perfecto! Acabas de desbloquear X métricas."
5. Muestra progreso: "Llevas 3/8 pasos completados. Ya tienes 18/55 métricas activas."
6. Si abandona antes de terminar, guarda lo que completó y resume qué falta.

== FORMATO DE RESPUESTA ESTÁNDAR ==
Responde SIEMPRE en JSON válido con este formato exacto:
{
  "next_field": "nombre_del_campo_a_pedir",
  "question": "Pregunta amigable para el empresario",
  "example": "Ejemplo concreto de cómo llenar el dato",
  "impact_if_completed": "Qué métricas se desbloquean",
  "progress": { "completed": N, "total": 8, "metrics_unlocked": N }
}`

// ═══════════════════════════════════════════════════════════
// P-02 — KIPU METRIC UNLOCK ENGINE (System Prompt)
// ═══════════════════════════════════════════════════════════
const SYSTEM_PROMPT_P02 = `Eres el motor de desbloqueo de métricas de Qhatu. Cuando el empresario guarda datos en Configuración Avanzada, determinas qué métricas nuevas se activan y generas el mensaje de celebración correspondiente.

== MAPA DE DESBLOQUEO ==

NIVEL 1 — Campo: product_costs
Métricas desbloqueadas (5):
- margen_bruto_por_producto (Margen bruto % por producto)
- margen_bruto_global (Margen bruto global ponderado)
- ganancia_bruta (Ganancia bruta en soles)
- producto_mas_rentable (Ranking rentabilidad vs. volumen)
- alerta_revenue_vs_ganancia (Detección de divergencia automática)
Dashboard activado: Rentabilidad Real (parcial, 5/13 métricas)

NIVEL 1+ — Campos: product_costs + fixed_expenses
Métricas desbloqueadas adicionales (8):
- punto_equilibrio (Punto de equilibrio en soles)
- pedidos_minimos (Pedidos mínimos para no perder)
- dias_cubrir_fijos (Días para cubrir gastos fijos)
- cobertura_gastos_fijos (Cobertura de gastos fijos %)
- ganancia_neta (Ganancia neta en soles)
- margen_neto (Margen neto %)
- margen_por_pedido (Ganancia bruta ÷ pedidos)
- impacto_descuento_margen (Simulador de descuentos)
Dashboard activado: Rentabilidad Real COMPLETO (13/13 métricas)

NIVEL 2A — Campo: product_stock
Métricas desbloqueadas (7):
- stock_actual_por_producto
- dias_stock_restante
- capital_inmovilizado
- productos_muertos (sin mov. >30 días)
- rotacion_inventario
- tasa_quiebre_stock
- revenue_perdido_quiebre
Dashboard activado: Inventario (parcial, 7/10 métricas)

NIVEL 2B — Campos: product_stock + suppliers
Métricas desbloqueadas adicionales (3):
- alerta_predictiva_reorden
- cantidad_optima_reorden
- calendario_reabastecimiento
Dashboard activado: Inventario COMPLETO (10/10 métricas)

NIVEL 2C — Campos: revenue_goal + orders_goal
Métricas desbloqueadas (7):
- avance_meta_revenue
- avance_meta_pedidos
- ritmo_diario_requerido
- proyeccion_cumplimiento
- dias_para_meta
- meta_sugerida_proximo_mes (requiere 3+ meses historial)
- brecha_crecimiento_mom
Dashboard activado: Metas & Crecimiento COMPLETO (7/7)

NIVEL 3A — Campo: ad_spend_by_channel
Métricas desbloqueadas (5):
- cac_global
- cpa
- cac_por_canal
- roas
- canal_mas_rentable
Dashboard activado: Marketing ROI (parcial, 5/9)

NIVEL 3B — Campos: ad_spend_by_channel + product_costs
Métricas desbloqueadas adicionales (4):
- roi_real_marketing
- ltv_estimado
- ratio_ltv_cac
- meses_recuperar_inversion
Dashboard activado: Marketing ROI COMPLETO (9/9)

NIVEL 3C — Campo: max_daily_orders
Métricas desbloqueadas (3):
- tasa_utilizacion
- dias_saturacion_mes
- proyeccion_saturacion
Dashboard activado: Capacidad (parcial, 3/8)

NIVEL 3D — Campos: max_daily_orders + team_members + prep_time_minutes
Métricas desbloqueadas adicionales (4):
- revenue_por_persona
- pedidos_por_persona
- costo_tiempo_por_pedido
- cuello_de_botella
Campo adicional: tiempo_promedio_fulfillment (requiere prep_time solo)
Dashboard activado: Capacidad COMPLETO (8/8)

NIVEL 2D — Campo: payment_methods
Métricas desbloqueadas (2):
- conversion_por_metodo_pago
- revenue_perdido_metodo_no_aceptado
Dashboard activado: Políticas (parcial, 2/7)

NIVEL 2E — Campos: delivery_zones + product_costs
Métricas desbloqueadas adicionales (3):
- costo_envio_promedio
- margen_despues_envio
- zona_mayor_conversion
- revenue_perdido_zona_no_atendida
Dashboard activado: Políticas (parcial acumulado, 6/7)

CAMPO ADICIONAL: return_policy
Métricas desbloqueadas (1):
- tasa_devolucion
Dashboard: Políticas COMPLETO (7/7)

NIVEL 3E — Campos: fixed_expenses + product_costs + product_stock
Métricas desbloqueadas (6):
- flujo_caja_mes
- proyeccion_flujo_30_dias
- alerta_flujo_negativo
- mapa_estacionalidad (requiere 3+ meses)
- forecast_revenue_proximo_mes (requiere 3+ meses)
- presupuesto_sugerido_inversion
Dashboard activado: Flujo de Caja COMPLETO (6/6)

== RESPUESTA AL DESBLOQUEAR ==
Cuando se guardan nuevos campos, genera:
{
  "newly_unlocked": ["lista de metric_keys desbloqueadas"],
  "count_new": N,
  "total_now": N,
  "celebration_message": "Mensaje motivador con impacto concreto",
  "toast_notification": "Texto corto para el toast (máx 80 chars)",
  "dashboards_newly_active": ["lista de dashboards ahora completos"],
  "next_recommended_field": "Siguiente campo a completar para mayor impacto"
}`

// ═══════════════════════════════════════════════════════════
// ANALYSIS ENGINE
// ═══════════════════════════════════════════════════════════

interface KipuAnalysisResult {
    status: string
    headline: string
    metrics: Array<{ name: string; value: string; trend: string; emoji: string }>
    top_alert: string
    action_today: string
    unlocked_count: number
    total_metrics: number
    raw?: string
}

interface KipuOnboardingResult {
    next_field: string
    question: string
    example: string
    impact_if_completed: string
    progress: { completed: number; total: number; metrics_unlocked: number }
    raw?: string
}

export interface KipuUnlockResult {
    newly_unlocked: string[]
    count_new: number
    total_now: number
    celebration_message: string
    toast_notification: string
    dashboards_newly_active: string[]
    next_recommended_field: string
    raw?: string
}

/**
 * Build context string from bot data for Gemini
 */
function buildBusinessContext(bot: any, sales: any[], advConfig: any): string {
    const now = new Date().toLocaleString('es-PE', { timeZone: 'America/Lima' })
    let ctx = `\n[FECHA/HORA: ${now}]\n`

    // Basic bot info
    ctx += `\n== NEGOCIO ==\n`
    ctx += `Nombre: ${bot.botName || bot.tienda?.nombre || 'Sin nombre'}\n`
    if (bot.tienda?.rubro) ctx += `Rubro: ${bot.tienda.rubro}\n`
    if (bot.tienda?.tipo) ctx += `Tipo: ${bot.tienda.tipo}\n`

    // Products
    const products = bot.products || []
    if (products.length > 0) {
        ctx += `\n== PRODUCTOS (${products.length}) ==\n`
        products.forEach((p: any) => {
            ctx += `- ${p.name}: S/${p.price || '?'}`
            if (p.stock !== undefined) ctx += ` | Stock: ${p.stock}`
            ctx += '\n'
        })
    }

    // Advanced config
    const l1 = advConfig?.level1 || {}
    const l2 = advConfig?.level2 || {}
    const l3 = advConfig?.level3 || {}
    const operacion = bot.operacion || {}

    // Part B data
    ctx += `\n== CONFIGURACIÓN AVANZADA ==\n`

    // product_costs
    if (l1.productCosts && Object.keys(l1.productCosts).length > 0) {
        ctx += `product_costs: ${JSON.stringify(l1.productCosts)}\n`
    } else {
        ctx += `product_costs: NO CONFIGURADO\n`
    }

    // fixed_expenses
    if (l3.gastoFijoTotal > 0) {
        ctx += `fixed_expenses: S/${l3.gastoFijoTotal}/mes`
        if (l3.alquiler) ctx += ` (alquiler: S/${l3.alquiler}`
        if (l3.servicios) ctx += `, servicios: S/${l3.servicios}`
        if (l3.sueldos) ctx += `, sueldos: S/${l3.sueldos}`
        if (l3.otrosGastos) ctx += `, otros: S/${l3.otrosGastos}`
        ctx += ')\n'
    } else {
        ctx += `fixed_expenses: NO CONFIGURADO\n`
    }

    // product_stock
    if (l2.stock && Object.keys(l2.stock).length > 0) {
        ctx += `product_stock: ${JSON.stringify(l2.stock)}\n`
        if (l2.stockMin) ctx += `stock_minimo: ${JSON.stringify(l2.stockMin)}\n`
    } else {
        ctx += `product_stock: NO CONFIGURADO\n`
    }

    // revenue_goal
    if (l2.metaMensual > 0) {
        ctx += `revenue_goal: S/${l2.metaMensual}/mes\n`
    } else {
        ctx += `revenue_goal: NO CONFIGURADO\n`
    }

    if (l2.metaPedidos > 0) {
        ctx += `orders_goal: ${l2.metaPedidos} pedidos/mes\n`
    }

    // ad_spend_by_channel
    const adsIG = l3.adsIG || 0, adsTT = l3.adsTT || 0, adsFB = l3.adsFB || 0, adsGoogle = l3.adsGoogle || 0
    const totalAds = adsIG + adsTT + adsFB + adsGoogle
    if (totalAds > 0) {
        ctx += `ad_spend_by_channel: { instagram: S/${adsIG}, tiktok: S/${adsTT}, facebook: S/${adsFB}, google: S/${adsGoogle} }\n`
    } else {
        ctx += `ad_spend_by_channel: NO CONFIGURADO\n`
    }

    // max_daily_orders
    if (l3.capPedidos > 0) {
        ctx += `max_daily_orders: ${l3.capPedidos}\n`
    } else {
        ctx += `max_daily_orders: NO CONFIGURADO\n`
    }

    // payment_methods
    if (operacion.metodos_pago?.length > 0) {
        ctx += `payment_methods: [${operacion.metodos_pago.join(', ')}]\n`
    } else if (l2.paymentMethods?.length > 0) {
        ctx += `payment_methods: [${l2.paymentMethods.join(', ')}]\n`
    } else {
        ctx += `payment_methods: NO CONFIGURADO\n`
    }

    // delivery_zones
    if (operacion.envios?.zonas?.length > 0) {
        ctx += `delivery_zones: [${operacion.envios.zonas.join(', ')}]\n`
    } else if (l2.zoneChips?.length > 0) {
        ctx += `delivery_zones: [${l2.zoneChips.join(', ')}]\n`
    } else {
        ctx += `delivery_zones: NO CONFIGURADO\n`
    }

    // return_policy
    if (l3.returnPolicy != null) {
        const policies = ['No acepta', 'Solo cambios', 'Acepta devoluciones']
        ctx += `return_policy: ${policies[l3.returnPolicy] || 'Configurado'}\n`
    }

    // Sales data summary
    ctx += `\n== DATOS DE VENTAS (Automáticos) ==\n`
    if (sales.length > 0) {
        const totalRevenue = sales.reduce((s: number, o: any) => s + (parseFloat(o.total) || 0), 0)
        const uniqueClients = new Set(sales.map((s: any) => s.clientPhone || s.from || '')).size
        const avgTicket = sales.length > 0 ? totalRevenue / sales.length : 0

        ctx += `Total pedidos: ${sales.length}\n`
        ctx += `Revenue total: S/${totalRevenue.toFixed(2)}\n`
        ctx += `Ticket promedio: S/${avgTicket.toFixed(2)}\n`
        ctx += `Clientes únicos: ${uniqueClients}\n`

        // Product breakdown
        const productCounts: Record<string, { count: number; revenue: number }> = {}
        sales.forEach((o: any) => {
            const item = o.items || o.productName || 'Otros'
            if (!productCounts[item]) productCounts[item] = { count: 0, revenue: 0 }
            productCounts[item].count++
            productCounts[item].revenue += parseFloat(o.total) || 0
        })
        const topProducts = Object.entries(productCounts)
            .sort((a, b) => b[1].count - a[1].count)
            .slice(0, 5)
        if (topProducts.length > 0) {
            ctx += `Productos más vendidos:\n`
            topProducts.forEach(([name, data]) => {
                ctx += `  - ${name}: ${data.count} pedidos, S/${data.revenue.toFixed(2)}\n`
            })
        }
    } else {
        ctx += `Sin ventas registradas aún.\n`
    }

    return ctx
}

/**
 * Calculate onboarding progress from advancedConfig
 */
function calculateOnboardingProgress(advConfig: any, operacion: any): { completed: number; total: number; metrics_unlocked: number } {
    const total = 8
    let completed = 0
    let metricsUnlocked = 0

    const l1 = advConfig?.level1 || {}
    const l2 = advConfig?.level2 || {}
    const l3 = advConfig?.level3 || {}

    if (l1.productCosts && Object.keys(l1.productCosts).length > 0) { completed++; metricsUnlocked += 13 }
    if (l3.gastoFijoTotal > 0) { completed++; metricsUnlocked += 6 }
    if (l2.stock && Object.keys(l2.stock).length > 0) { completed++; metricsUnlocked += 10 }
    if (l2.metaMensual > 0) { completed++; metricsUnlocked += 7 }
    if ((l3.adsIG || 0) + (l3.adsTT || 0) + (l3.adsFB || 0) + (l3.adsGoogle || 0) > 0) { completed++; metricsUnlocked += 9 }
    if (l3.capPedidos > 0) { completed++; metricsUnlocked += 8 }
    if (operacion?.metodos_pago?.length > 0 || l2.paymentMethods?.length > 0) { completed++; metricsUnlocked += 7 }
    if (operacion?.envios?.zonas?.length > 0 || l2.zoneChips?.length > 0) { completed++ }

    return { completed, total, metrics_unlocked: Math.min(metricsUnlocked, 55) }
}

/**
 * Parse a single combined business description into two brief parts
 */
export async function parseBusinessText(text: string): Promise<{ description: string, clients: string }> {
    const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY
    if (!apiKey) throw new Error('API_KEY not configured')

    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({
        model: 'gemini-1.5-flash',
        generationConfig: { responseMimeType: 'application/json' }
    })

    const prompt = `Analiza la siguiente descripción de un negocio y extrae dos partes resumidas (máximo 15 palabras cada una):
1. Descripción del negocio (qué hacen/venden)
2. Sus clientes (quiénes son, qué buscan)
Solo debes devolver un objeto JSON con dos llaves: "description" y "clients".
Texto: "${text}"`

    try {
        const result = await model.generateContent(prompt)
        const answer = result.response.text()
        return JSON.parse(answer)
    } catch(e) {
        return { description: text, clients: 'No especificado' }
    }
}

/**
 * Run KIPU Analysis (P-00) — Full business intelligence
 */
export async function kipuAnalyze(botId: string, userId: string, question?: string): Promise<KipuAnalysisResult> {
    const apiKey = process.env.GOOGLE_API_KEY
    if (!apiKey) throw new Error('GOOGLE_API_KEY not configured')

    const db = getDB()

    // Load bot
    const bot = await db.collection('bot_configs').findOne({
        _id: new ObjectId(botId),
        userId
    })
    if (!bot) throw new Error('Bot no encontrado')

    // Load advanced config
    const advConfig = bot.advancedConfig || { level1: null, level2: null, level3: null }

    // Load sales (last 30 days)
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    const sales = await db.collection('orders')
        .find({ botId, timestamp: { $gte: thirtyDaysAgo } })
        .sort({ timestamp: -1 })
        .toArray()

    // Build context
    const context = buildBusinessContext(bot, sales, advConfig)

    // Calculate unlocked metrics
    const progress = calculateOnboardingProgress(advConfig, bot.operacion)

    // Build user message
    let userMessage = `Analiza mi negocio con los datos que tienes. Dame tu diagnóstico general.`
    if (question) {
        userMessage = question
    }
    userMessage += `\n\n--- DATOS DEL NEGOCIO ---${context}`
    userMessage += `\n\nIMPORTANTE: Responde en JSON válido con el formato estándar. unlocked_count = ${progress.metrics_unlocked}.`

    // Call Gemini
    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({
        model: 'gemini-2.0-flash',
        systemInstruction: SYSTEM_PROMPT_P00,
    })

    const result = await model.generateContent(userMessage)
    const responseText = result.response.text()

    // Try to parse JSON from response
    try {
        const jsonMatch = responseText.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0])
            return {
                status: parsed.status || 'ok',
                headline: parsed.headline || '',
                metrics: parsed.metrics || [],
                top_alert: parsed.top_alert || '',
                action_today: parsed.action_today || '',
                unlocked_count: parsed.unlocked_count || progress.metrics_unlocked,
                total_metrics: parsed.total_metrics || 55,
            }
        }
    } catch (e) {
        console.warn('[KipuAnalytics] Could not parse JSON, returning raw response')
    }

    // Fallback: return raw text
    return {
        status: 'ok',
        headline: responseText.substring(0, 100),
        metrics: [],
        top_alert: '',
        action_today: '',
        unlocked_count: progress.metrics_unlocked,
        total_metrics: 55,
        raw: responseText,
    }
}

/**
 * Run KIPU Onboarding (P-01) — Guided configuration assistant
 */
export async function kipuOnboarding(botId: string, userId: string): Promise<KipuOnboardingResult> {
    const apiKey = process.env.GOOGLE_API_KEY
    if (!apiKey) throw new Error('GOOGLE_API_KEY not configured')

    const db = getDB()

    // Load bot
    const bot = await db.collection('bot_configs').findOne({
        _id: new ObjectId(botId),
        userId
    })
    if (!bot) throw new Error('Bot no encontrado')

    const advConfig = bot.advancedConfig || {}
    const progress = calculateOnboardingProgress(advConfig, bot.operacion)

    // Build context showing what's already done
    const context = buildBusinessContext(bot, [], advConfig)

    const userMessage = `El empresario ha completado ${progress.completed} de ${progress.total} pasos y tiene ${progress.metrics_unlocked} de 55 métricas desbloqueadas.

Datos actuales del negocio:
${context}

Dime cuál es el siguiente paso que debe completar y motívalo a hacerlo. Responde en JSON válido con el formato estándar de onboarding.`

    // Call Gemini
    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({
        model: 'gemini-2.0-flash',
        systemInstruction: SYSTEM_PROMPT_P01,
    })

    const result = await model.generateContent(userMessage)
    const responseText = result.response.text()

    // Try to parse JSON
    try {
        const jsonMatch = responseText.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0])
            return {
                next_field: parsed.next_field || '',
                question: parsed.question || '',
                example: parsed.example || '',
                impact_if_completed: parsed.impact_if_completed || '',
                progress: parsed.progress || progress,
            }
        }
    } catch (e) {
        console.warn('[KipuOnboarding] Could not parse JSON, returning raw response')
    }

    // Fallback
    return {
        next_field: 'product_costs',
        question: responseText.substring(0, 200),
        example: '',
        impact_if_completed: 'Desbloquear métricas de Rentabilidad',
        progress,
        raw: responseText,
    }
}

/**
 * Run KIPU Unlock Engine (P-02) — Evaluate newly unlocked metrics after saving
 */
export async function kipuUnlockCheck(botId: string, userId: string, savedFields: string[]): Promise<KipuUnlockResult | null> {
    const apiKey = process.env.GOOGLE_API_KEY
    if (!apiKey) throw new Error('GOOGLE_API_KEY not configured')

    const db = getDB()

    const bot = await db.collection('bot_configs').findOne({
        _id: new ObjectId(botId),
        userId
    })
    if (!bot) throw new Error('Bot no encontrado')

    const advConfig = bot.advancedConfig || {}
    const context = buildBusinessContext(bot, [], advConfig)

    const userMessage = `El empresario acaba de guardar nuevos datos en la plataforma. Los campos que guardó o actualizó son: [${savedFields.join(', ')}].

Datos actuales del negocio (recién actualizados):
${context}

Analiza qué métricas se han activado GRACIAS a estos nuevos datos guardados y genera el mensaje de celebración.
Responde estrictamente en JSON válido siguiendo el formato solicitado.`

    // Call Gemini
    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({
        model: 'gemini-2.0-flash',
        systemInstruction: SYSTEM_PROMPT_P02,
    })

    const result = await model.generateContent(userMessage)
    const responseText = result.response.text()

    try {
        const jsonMatch = responseText.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0])
            return {
                newly_unlocked: parsed.newly_unlocked || [],
                count_new: parsed.count_new || 0,
                total_now: parsed.total_now || 0,
                celebration_message: parsed.celebration_message || '¡Nuevos datos guardados con éxito!',
                toast_notification: parsed.toast_notification || 'Configuración guardada.',
                dashboards_newly_active: parsed.dashboards_newly_active || [],
                next_recommended_field: parsed.next_recommended_field || ''
            }
        }
    } catch (e) {
        console.warn('[KipuUnlockCheck] Could not parse JSON, returning null/raw text')
    }

    return null
}

// ═══════════════════════════════════════════════════════════
// P-03 — KIPU RENTABILIDAD REAL (System Prompt)
// ═══════════════════════════════════════════════════════════
const SYSTEM_PROMPT_P03 = `Eres el analista de rentabilidad de Qhatu. Tienes acceso a los datos de ventas (Parte A) y a los costos ingresados por el empresario (Configuración Avanzada).

== MÉTRICAS QUE CALCULAS (13) ==

1. MARGEN BRUTO POR PRODUCTO (%)
Fórmula: (Precio_venta - Costo_unitario) / Precio_venta × 100
Fuente: Precio de conversaciones (Parte A) + Costo de Config. Avanzada
Interpretación: <10% = alerta roja, 10-30% = amarillo, >30% = verde
Acción si bajo: "Tu producto [X] tiene margen insostenible. Sube precio un 15% o negocia el costo con tu proveedor."

2. MARGEN BRUTO GLOBAL (%)
Fórmula: Σ(Margen_i × Unidades_i) / Σ(Unidades_i)
Interpretación: Promedio real ponderado por volumen de ventas. Alerta si difiere mucho del margen por producto más vendido.

3. GANANCIA BRUTA (S/)
Fórmula: Revenue_total - Σ(Costo_i × Unidades_vendidas_i)
Muestra: Cuánto queda ANTES de gastos fijos y operativos.

4. GANANCIA NETA (S/) [requiere fixed_expenses]
Fórmula: Ganancia_bruta - Gastos_fijos - Gastos_variables_totales
Alerta crítica si es negativa.

5. MARGEN NETO (%) [requiere fixed_expenses]
Fórmula: Ganancia_neta / Revenue_total × 100
Benchmark: <5% preocupante, 5-15% aceptable, >15% saludable

6. PRODUCTO MÁS RENTABLE VS. MÁS VENDIDO
Compara: Ranking por margen % vs. ranking por volumen de ventas
Alerta si el producto más vendido NO es el más rentable.
Mensaje: "Estás dedicando el 60% de tu energía a [producto X] que solo te deja un 8% de margen. [Producto Y] te da 32% pero casi no lo ofreces."

7. MARGEN POR PEDIDO (S/)
Fórmula: Ganancia_bruta / Número_pedidos
Tendencia: Compara vs. mes anterior.

8. PUNTO DE EQUILIBRIO (S/) [requiere fixed_expenses]
Fórmula: Gastos_fijos / Margen_bruto_global_%
Visual: Aguja de velocímetro. Zona roja = aún no llegaste.

9. PEDIDOS MÍNIMOS PARA NO PERDER [requiere fixed_expenses]
Fórmula: Punto_equilibrio / Ticket_promedio

10. DÍAS PARA CUBRIR GASTOS FIJOS [requiere fixed_expenses]
Fórmula: (Gastos_fijos / Ganancia_bruta) × Días_del_mes
Mensaje si >20 días: "Aún no cubriste tus gastos fijos. Te quedan solo X días del mes."

11. COBERTURA DE GASTOS FIJOS (%) [requiere fixed_expenses]
Fórmula: Ganancia_bruta / Gastos_fijos × 100
>100% = cubiertos. <100% = aún en zona de pérdida.

12. SIMULADOR DE DESCUENTOS (interactivo)
Para descuento D%:
- Nuevo margen: ((Precio × (1-D/100)) - Costo) / (Precio × (1-D/100)) × 100
- Ventas extra necesarias para mantener ganancia: Ganancia_perdida_por_descuento / Nuevo_margen_por_unidad
Niveles: 5%, 10%, 15%, 20%
Mensaje: "Con 10% de descuento en [producto X], necesitas vender 3 unidades más para mantener la misma ganancia."

13. ALERTA REVENUE VS. GANANCIA (automática)
Detecta: Revenue sube pero ganancia baja
Causas posibles: mayor descuento, cambio en mix de productos, aumento de costos no registrado.
Mensaje: "Tus ventas subieron 20% pero tu ganancia bajó 5%. Estás vendiendo más pero ganando menos."

== FORMATO DE RESPUESTA ==
Siempre devuelve SÓLO un objeto JSON válido con la siguiente estructura (reemplaza los valores con tus cálculos reales):
{
  "dashboard": "rentabilidad_real",
  "kpi_cards": [
    { "metric": "margen_bruto_global", "value": "34.2%", "trend": "up", "delta": "+2.1pp", "status": "green" },
    { "metric": "ganancia_bruta", "value": "S/ 4,320", "trend": "up", "delta": "+S/380", "status": "green" },
    { "metric": "ganancia_neta", "value": "S/ 1,820", "trend": "down", "delta": "-S/120", "status": "yellow" },
    { "metric": "margen_neto", "value": "14.6%", "trend": "down", "delta": "-1.2pp", "status": "yellow" },
    { "metric": "margen_por_pedido", "value": "S/ 45.2", "trend": "up", "delta": "+S/5", "status": "green" },
    { "metric": "punto_equilibrio", "value": "S/ 2,400", "trend": "neutral", "delta": "0", "status": "neutral" }
  ],
  "product_table": [
    { "name": "Producto A", "margen_pct": "40%", "status": "green" },
    { "name": "Producto B", "margen_pct": "12%", "status": "red" }
  ],
  "producto_mas_rentable": "Producto A (40%)",
  "active_alerts": ["Tu producto B tiene margen insostenible. Sube precio un 15%."],
  "action_today": "Estás dedicando energía a B que deja 12%. Promociona A."
}`

export interface KipuRentabilidadResult {
    dashboard: string
    kpi_cards: Array<{ metric: string; value: string; trend: string; delta: string; status: string }>
    product_table: Array<{ name: string; margen_pct: string; status: string }>
    producto_mas_rentable: string
    active_alerts: string[]
    action_today: string
    raw?: string
}

/**
 * Run KIPU Rentabilidad Real Engine (P-03)
 */
export async function kipuRentabilidad(botId: string, userId: string): Promise<KipuRentabilidadResult> {
    const apiKey = process.env.GOOGLE_API_KEY
    if (!apiKey) throw new Error('GOOGLE_API_KEY not configured')

    const db = getDB()
    const bot = await db.collection('bot_configs').findOne({ _id: new ObjectId(botId), userId })
    if (!bot) throw new Error('Bot no encontrado')

    // Only get the last 30 days of sales to evaluate
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const orders = await db.collection('orders').find({ botId, timestamp: { $gte: thirtyDaysAgo } }).toArray()
    const advConfig = bot.advancedConfig || {}

    const context = buildBusinessContext(bot, orders, advConfig)

    const userMessage = `Analiza la rentabilidad real de los últimos 30 días basándote en los costos configurados y las ventas realizadas. Calcula las 13 métricas y devuelve el JSON requerido.

Contexto actual del negocio:
${context}
`

    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({
        model: 'gemini-2.0-flash',
        systemInstruction: SYSTEM_PROMPT_P03,
    })

    const result = await model.generateContent(userMessage)
    const responseText = result.response.text()

    try {
        const jsonMatch = responseText.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
            return {
                ...JSON.parse(jsonMatch[0]),
                raw: responseText
            }
        }
    } catch (e) {
        console.warn('[KipuRentabilidad] Could not parse JSON, returning fallback')
    }

    return {
        dashboard: "rentabilidad_real",
        kpi_cards: [],
        product_table: [],
        producto_mas_rentable: "-",
        active_alerts: ["No se pudo calcular la rentabilidad."],
        action_today: "Ingresa tus costos en Configuración Avanzada.",
        raw: responseText
    }
}

// ═══════════════════════════════════════════════════════════
// P-04 — KIPU INVENTARIO & STOCK (System Prompt)
// ═══════════════════════════════════════════════════════════
const SYSTEM_PROMPT_P04 = `Eres el analista de inventario de Qhatu. Tienes acceso al stock actual del empresario y al historial de ventas de KobraAI para proyectar agotamientos.

== MÉTRICAS QUE CALCULAS (10) ==

1. STOCK ACTUAL POR PRODUCTO
Fuente: product_stock.current (ingresado en Config. Avanzada)
Actualización: Se descuenta automáticamente con cada venta confirmada por Qhatu.
Semáforo: Verde >15 días, Amarillo 5-15 días, Rojo <5 días, Gris sin stock.

2. DÍAS DE STOCK RESTANTE
Fórmula: Stock_actual / Promedio_ventas_diarias_últimos_30d
Alerta: Notificación push si <5 días.

3. CAPITAL INMOVILIZADO (S/)
Fórmula: Σ(Stock_i × Costo_unitario_i) [requiere product_costs]
Highlight: Productos con >60 días sin movimiento.
Mensaje: "Tienes S/[X] atrapados en inventario que no rota. [Producto Y] lleva 45 días sin venderse."

4. PRODUCTOS MUERTOS (>30 días sin movimiento)
Detección: Cruza stock_actual con historial de ventas de Parte A.
Sugerencias automáticas:
- Si margen >20%: "Considera una promoción flash."
- Si margen <10%: "Evalúa liquidar con descuento agresivo."
- Si 0 ventas en 60d: "Considera descontinuar el producto."

5. ROTACIÓN DE INVENTARIO
Fórmula: Unidades_vendidas_período / Stock_promedio_período
Benchmark por categoría:
- Repostería/Alimentos: >4x/mes (rotación muy alta)
- Moda/Accesorios: 1-3x/mes
- Tecnología/Hogar: 0.5-1x/mes
Mensaje si bajo benchmark: "Tu rotación está por debajo del estándar del sector. Tienes capital atrapado."

6. TASA DE QUIEBRE DE STOCK (%)
Fuente: NLP de conversaciones de Qhatu
Detección: Clientes que preguntaron por producto agotado.
Fórmula: Consultas_sin_stock / Total_consultas_producto × 100
Alerta si >15%: estás perdiendo 1 de cada 7 ventas potenciales.

7. REVENUE PERDIDO POR QUIEBRE (S/)
Fórmula: Consultas_sin_stock × Precio_producto × Tasa_conversión_histórica
Impacto visible: "Perdiste S/[X] este mes porque se te acabó [Producto Y]."

8. ALERTA PREDICTIVA DE REORDEN [requiere suppliers]
Lógica: Si días_stock_restante ≤ lead_time_proveedor + 2 días buffer
Dispara alerta: "¡Hoy debes pedir a [Proveedor X]! Si no pides hoy, te quedarás sin [Producto Y] el [fecha]."

9. CANTIDAD ÓPTIMA DE REORDEN [requiere suppliers]
Fórmula: (Demanda_diaria_promedio × lead_time) + Stock_seguridad - Stock_actual
Stock_seguridad = Demanda_diaria × 3 días (buffer estándar)

10. CALENDARIO DE REABASTECIMIENTO [requiere suppliers]
Genera vista mensual con fechas exactas para pedir a cada proveedor.
Considera: lead times + demanda proyectada + stock actual.
Click en fecha: muestra producto, cantidad y proveedor.

== ALERTAS AUTOMÁTICAS ==
CRÍTICA: Stock de [producto] se agota en [N] días. Lead time del proveedor: [N] días. → DEBES PEDIR HOY [cantidad] unidades a [proveedor].
MEDIA: [Producto] lleva [N] días sin venderse. Considera promoción. → Revenue potencial recuperable: S/[X]
BAJA: Rotación de [producto] está [X]% por debajo del benchmark del sector.

== FORMATO DE RESPUESTA ==
Siempre devuelve SÓLO un objeto JSON válido con la siguiente estructura (inventalo/estimato si faltan historiales para predecir base a las ventas provistas):
{
  "dashboard": "inventario_stock",
  "semaforo_grid": [
    { "product": "Producto A", "stock": 45, "dias_restantes": 12, "status": "yellow" },
    { "product": "Producto B", "stock": 2, "dias_restantes": 1, "status": "red" }
  ],
  "capital_inmovilizado": {
    "total": "S/ 1,250",
    "productos_muertos": ["Producto C", "Producto D"]
  },
  "alertas_criticas": [
    "Stock de Producto B se agota en 1 día. Considera pedir 50 unidades hoy."
  ],
  "calendario_reorden": [
    "Mañana - Proveedor XYZ (Producto A)"
  ],
  "revenue_perdido_quiebre": "S/ 0",
  "action_today": "Tienes productos muertos. Considera promoción flash de Producto C."
}`

export interface KipuInventarioResult {
    dashboard: string
    semaforo_grid: Array<{ product: string; stock: number; dias_restantes: number; status: string }>
    capital_inmovilizado: {
        total: string
        productos_muertos: string[]
    }
    alertas_criticas: string[]
    calendario_reorden: string[]
    revenue_perdido_quiebre: string
    action_today: string
    raw?: string
}

/**
 * Run KIPU Inventario y Stock Engine (P-04)
 */
export async function kipuInventario(botId: string, userId: string): Promise<KipuInventarioResult> {
    const apiKey = process.env.GOOGLE_API_KEY
    if (!apiKey) throw new Error('GOOGLE_API_KEY not configured')

    const db = getDB()
    const bot = await db.collection('bot_configs').findOne({ _id: new ObjectId(botId), userId })
    if (!bot) throw new Error('Bot no encontrado')

    // Evaluate last 45 days for better movement calculation
    const fortyFiveDaysAgo = new Date();
    fortyFiveDaysAgo.setDate(fortyFiveDaysAgo.getDate() - 45);

    const orders = await db.collection('orders').find({ botId, timestamp: { $gte: fortyFiveDaysAgo } }).toArray()
    const advConfig = bot.advancedConfig || {}

    // Only supply stock logic if stock object exists
    if (!advConfig.level2 || !advConfig.level2.stock || Object.keys(advConfig.level2.stock).length === 0) {
        throw new Error('Configuración de inventario (Nivel 2) requerida')
    }

    const context = buildBusinessContext(bot, orders, advConfig)

    const userMessage = `Analiza el estado del inventario y rotación cruzando el stock actual con el ritmo de ventas de los últimos 45 días. Genera las alertas críticas de reorden basándote en la velocidad de consumo de los productos. Devuelve el JSON requerido.

Contexto actual del negocio:
${context}
`

    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({
        model: 'gemini-2.0-flash',
        systemInstruction: SYSTEM_PROMPT_P04,
    })

    const result = await model.generateContent(userMessage)
    const responseText = result.response.text()

    try {
        const jsonMatch = responseText.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
            return {
                ...JSON.parse(jsonMatch[0]),
                raw: responseText
            }
        }
    } catch (e) {
        console.warn('[KipuInventario] Could not parse JSON, returning fallback')
    }

    return {
        dashboard: "inventario_stock",
        semaforo_grid: [],
        capital_inmovilizado: { total: "S/ 0", productos_muertos: [] },
        alertas_criticas: ["AI Data Parcer Error"],
        calendario_reorden: [],
        revenue_perdido_quiebre: "S/ 0",
        action_today: "Actualiza manualmente tu stock.",
        raw: responseText
    }
}

// ═══════════════════════════════════════════════════════════
// P-05 — KIPU METAS & CRECIMIENTO (System Prompt)
// ═══════════════════════════════════════════════════════════
const SYSTEM_PROMPT_P05 = `Eres el coach de metas de Qhatu. Tu trabajo es mantener al empresario enfocado en sus objetivos y decirle exactamente qué necesita hacer hoy para llegar.

== MÉTRICAS QUE CALCULAS (7) ==

1. % AVANCE META REVENUE
Fórmula: Revenue_acumulado_mes / Meta_revenue × 100
Colores de proyección:
- Verde: Ritmo proyectado supera la meta
- Amarillo: Proyección llega ±5% de la meta
- Rojo: Proyección queda >5% por debajo de la meta
Actualización: Cada vez que KobraAI cierra una venta.

2. % AVANCE META PEDIDOS
Fórmula: Pedidos_mes / Meta_pedidos × 100
Mismo sistema de colores que revenue.

3. RITMO DIARIO REQUERIDO (S/)
Fórmula: (Meta - Revenue_acumulado) / Días_restantes_mes
Actualización: Cada día a las 00:00
Ejemplo de mensaje: "Hoy necesitas vender S/420. Llevas S/280 hoy. Te faltan S/140 para el ritmo del día."
Si ritmo requerido > 3× promedio diario: alerta roja "Meta en riesgo."

4. PROYECCIÓN DE CUMPLIMIENTO (%)
Fórmula: (Revenue_acumulado / Días_transcurridos) × Días_totales_mes / Meta × 100
Muestra línea real (azul) + línea ideal (punteada) en gráfico de tendencia.
Intervalo de confianza basado en varianza histórica.

5. DÍAS PARA ALCANZAR META
Fórmula: (Meta - Revenue_acumulado) / Promedio_diario_ventas_últimos_7d
Si resultado > días restantes del mes: alerta naranja
Mensaje: "A este ritmo llegarás a tu meta el día [fecha]. El mes termina el [fecha]. Necesitas acelerar."

6. META SUGERIDA PRÓXIMO MES [requiere 3+ meses de historial]
Cálculo: Historial + Estacionalidad + Tendencia de crecimiento
Presenta 2 opciones:
- Conservadora: Promedio_últimos_3_meses × 1.05
- Agresiva: Mejor_mes_histórico × 1.10
Contexto: "El mes pasado en [mes del año anterior] vendiste S/[X]."

7. BRECHA DE CRECIMIENTO MoM (%)
Fórmula: (Revenue_mes_actual - Revenue_mes_anterior) / Revenue_mes_anterior × 100
Flecha verde (acelerando) / amarilla (estancado <5%) / roja (cayendo)
Contexto YoY si hay historial de 12+ meses.

== LÓGICA DE ALERTAS DIARIAS ==
Inicio del día (08:00): "Buenos días. Hoy necesitas vender S/[X] para estar en ritmo. Ayer vendiste S/[Y]. El mes va [%] completado."
A las 18:00 si no alcanzó ritmo diario: "Llevas S/[X] hoy, necesitas S/[Y] más antes de cerrar el día. Considera impulsar [producto más convertible]."
Fin de mes (día 28): "Quedan 3 días. Tu meta está [%] completada. Necesitas S/[X] más. Te sugerimos: [acción específica]."

== FORMATO DE RESPUESTA ==
Siempre devuelve SÓLO un objeto JSON válido con la siguiente estructura (si faltan ventas asume los cálculos en 0 o estimaciones lógicas base a la meta provista):
{
  "dashboard": "metas_crecimiento",
  "revenue_progress": {
    "current": "S/ X",
    "goal": "S/ Y",
    "pct": 45,
    "status": "yellow"
  },
  "orders_progress": {
    "current": 12,
    "goal": 30,
    "pct": 40,
    "status": "yellow"
  },
  "ritmo_diario": {
    "needed": "S/ X",
    "achieved_today": "S/ Y",
    "gap": "S/ Z"
  },
  "projection": {
    "will_reach": false,
    "projected_final": "S/ X",
    "confidence": "medio"
  },
  "dias_para_meta": 18,
  "mom_growth": "+5.2%",
  "suggested_goal_next_month": {
    "conservative": "S/ X",
    "aggressive": "S/ Y"
  },
  "action_today": "A este ritmo llegarás a tu meta el día 5 del próximo mes. ¡Necesitas acelerar!"
}`

export interface KipuMetasResult {
    dashboard: string
    revenue_progress: { current: string; goal: string; pct: number; status: string }
    orders_progress: { current: number; goal: number; pct: number; status: string }
    ritmo_diario: { needed: string; achieved_today: string; gap: string }
    projection: { will_reach: boolean; projected_final: string; confidence: string }
    dias_para_meta: number|string
    mom_growth: string
    suggested_goal_next_month: { conservative: string; aggressive: string }
    action_today?: string
    raw?: string
}

/**
 * Run KIPU Metas y Crecimiento Engine (P-05)
 */
export async function kipuMetas(botId: string, userId: string): Promise<KipuMetasResult> {
    const apiKey = process.env.GOOGLE_API_KEY
    if (!apiKey) throw new Error('GOOGLE_API_KEY not configured')

    const db = getDB()
    const bot = await db.collection('bot_configs').findOne({ _id: new ObjectId(botId), userId })
    if (!bot) throw new Error('Bot no encontrado')

    // Context windows: This month so far vs last month (60 days max)
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

    const orders = await db.collection('orders').find({ botId, timestamp: { $gte: sixtyDaysAgo } }).toArray()
    const advConfig = bot.advancedConfig || {}

    // Only supply logic if goals exist
    if (!advConfig.level2 || (!advConfig.level2.metaMensual && !advConfig.level2.metaPedidos)) {
        throw new Error('Configuración de Metas (Nivel 2) requerida')
    }

    const context = buildBusinessContext(bot, orders, advConfig)

    const userMessage = `Eres el coach de metas de Qhatu. Analiza el ritmo diario de ventas del mes en curso contrastándolo con las metas de Ingresos y Pedidos. Proyecta si se llegará a la meta al final del mes y genera un action plan diario. Devuelve SÓLO el JSON requerido.

Contexto actual del negocio (ventas de últimos 60 días para MoM):
${context}
`

    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({
        model: 'gemini-2.0-flash',
        systemInstruction: SYSTEM_PROMPT_P05,
    })

    const result = await model.generateContent(userMessage)
    const responseText = result.response.text()

    try {
        const jsonMatch = responseText.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
            return {
                ...JSON.parse(jsonMatch[0]),
                raw: responseText
            }
        }
    } catch (e) {
        console.warn('[KipuMetas] Could not parse JSON, returning fallback')
    }

    return {
        dashboard: "metas_crecimiento",
        revenue_progress: { current: "S/ 0", goal: "S/ 0", pct: 0, status: "grey" },
        orders_progress: { current: 0, goal: 0, pct: 0, status: "grey" },
        ritmo_diario: { needed: "S/ 0", achieved_today: "S/ 0", gap: "S/ 0" },
        projection: { will_reach: false, projected_final: "S/ 0", confidence: "bajo" },
        dias_para_meta: "-",
        mom_growth: "0%",
        suggested_goal_next_month: { conservative: "S/ 0", aggressive: "S/ 0" },
        action_today: "No se pudieron calcular las metas.",
        raw: responseText
    }
}

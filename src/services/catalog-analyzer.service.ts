import OpenAI from 'openai'
import { readFileSync } from 'fs'
import * as cheerio from 'cheerio'
import type { AnyNode } from 'domhandler'

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
})

export interface CatalogProduct {
    name: string
    price: string
    description: string
    category: string
    imageUrl?: string
}

export interface CatalogAnalysis {
    // Business identity
    business_name: string
    business_summary: string
    business_category: string
    business_location: string
    target_customers: string
    bot_personality: string

    // Operations detected
    has_delivery: boolean
    payment_methods: string[]
    business_hours: string

    // Products & menu
    products: CatalogProduct[]
    restaurant_types: string[]
    detected_features: string[]
    menu_categories: string[]

    // Per-category qualifying questions Qhatu should ask after listing products
    // in a given category (e.g. Polos -> ["¿modelo en mente?", "¿uso diario o entreno?"]).
    // Keys are category names (case-insensitive match against extracted categories).
    category_followups: { [category: string]: string[] }

    // Knowledge blocks
    knowledge_blocks: { titulo: string, contenido: string }[]
}

const ANALYSIS_PROMPT = `
Eres un analista experto de negocios. Tu objetivo es analizar a fondo este catálogo, menú, documento o sitio web.
Extrae ABSOLUTAMENTE TODA la información comercial y de productos que encuentres. No asumas ni inventes, pero sé exhaustivo.

Devuelve SOLO un JSON válido con esta estructura exacta (sin markdown, sin explicación, solo el JSON puro):
{
  "business_name": "Nombre exacto del negocio si lo detectas. IMPORTANTE: Si no figura, INVENTA un nombre genérico representativo basado en el texto (Ej. 'Restaurante de Sushi', 'Tienda Ropa'). NUNCA devuelvas cadena vacía.",
  "business_summary": "Descripción completa generada por ti sobre lo que hace el negocio, qué vende, qué tipo de experiencia ofrece, su propuesta de valor y estilo (3-5 oraciones ricas en detalle)",
  "business_category": "UNA de estas opciones obligatorias: moda, belleza, reposteria, artesanias, restaurantes, tecnologia, hogar, alojamiento, nicho",
  "business_location": "Dirección física, sucursales o ciudades de cobertura detectadas, o cadena vacía",
  "target_customers": "Describe el perfil del cliente ideal basándote en los productos, precios, estilo del negocio y contenido detectado. Incluye rango de edad estimado, intereses, nivel socioeconómico y motivaciones de compra (2-3 oraciones)",
  "bot_personality": "Instrucciones precisas sobre cómo debe hablar y comportarse el asistente virtual (ej. amigable, persuasivo, formal, usa emojis, juvenil, corporativo). Infiérelo del tono comercial y rubro.",
  "has_delivery": true,
  "payment_methods": ["yape", "plin", "efectivo", "tarjeta", "transferencia"],
  "business_hours": "Horario de atención si figura explícitamente, de lo contrario cadena vacía",
  "products": [
    {
      "name": "Nombre completo del producto", 
      "price": "Precio exacto (ej. S/15.00) o 'Consultar'", 
      "description": "Descripción detallada, incluyendo variantes (colores, tallas) o ingredientes si figuran", 
      "category": "Categoría a la que pertenece dentro del catálogo"
    }
  ],
  "restaurant_types": ["usa ESTOS valores SOLAMENTE si es restaurante: polleria, chifa, cevicheria, pizzeria, hamburguesas, criolla, fast-food, sushi, parrilla, saludable, vegana, cafeteria, jugueria, postres, dark-kitchen, food-truck, brunch, bar"],
  "detected_features": ["delivery", "pickup", "combos", "promociones", "reservas", "pedidos_online", "garantia", "devoluciones", "soporte_tecnico", "envios_nacionales"],
  "menu_categories": ["usa ESTOS valores SOLAMENTE si aplica a comida: entradas, sopas, ceviches, fondos, pastas, parrilla, pizzas, hamburguesas, menu-dia, combos, ensaladas, postres, bebidas-calientes, bebidas-frias, alcohol, extras, ninos"],
  "category_followups": {
    "NombreCategoría": ["pregunta calificadora 1", "pregunta calificadora 2"]
  },
  "knowledge_blocks": [
    {
      "titulo": "Título descriptivo del bloque (ej: Política de Devoluciones, Historia de la Marca, Horarios Especiales, Garantía, FAQs, Proceso de Fabricación, Certificaciones, Promociones vigentes, Términos y Condiciones, Requisitos del servicio)",
      "contenido": "Texto completo extraído del documento sobre este tema"
    }
  ]
}

REGLAS ESTRICTAS PARA LA EXTRACCIÓN:
1. EXHAUSTIVIDAD: Extrae TODOS los productos/servicios presentes en el documento sin saltarte ninguno. Si hay 100 productos, devuelve 100.
2. PRECIOS: Si un precio no es visible, escribe "Consultar". No asumas precios gratis o nulos.
3. DESCRIPCIONES: Si el producto no tiene descripción, elabora una brevísima y profesional basada en su nombre (ej. Si dice "Camisa Oxford", pon "Camisa estilo Oxford, ideal para uso casual o formal"). Menciona colores, tallas o especificaciones técnicas si figuran en el texto u ofertas.
4. CATEGORIZACIÓN (business_category):
   - Ropa, calzado, accesorios → "moda"
   - Maquillaje, skincare, peluquería, spa → "belleza"
   - Tortas, postres, panadería → "reposteria"
   - Joyería, cerámica, manualidades → "artesanias"
   - Comida preparada, cafetería, bar → "restaurantes"
   - Celulares, laptops, gadgets → "tecnologia"
   - Muebles, decoración, línea blanca → "hogar"
   - Hoteles, Airbnb, hostales, tours → "alojamiento"
   - Servicios u otros no clasificados → "nicho"
5. MÉTODOS DE PAGO: Identifica los métodos mencionados explícitamente y mapea a: yape, plin, efectivo, tarjeta, transferencia, paypal, mercadopago.
6. CARACTERÍSTICAS (detected_features): Busca menciones a garantías, políticas de devoluciones, links de redes sociales incrustados (infiérelos del texto), y añádelos a la lista de "detected_features".
7. KNOWLEDGE BLOCKS: Extrae TODA la información que NO encaje en los campos estructurados anteriores (business_name, products, payment_methods, etc.) y agrúpala en bloques de conocimiento. Ejemplos: políticas de devolución/cambios/garantía, historia o misión de la marca, proceso de fabricación, certificaciones, FAQs, términos y condiciones, promociones vigentes, información de sucursales, horarios especiales, requisitos del servicio. Cada bloque debe tener un título claro y el contenido completo extraído. Si NO hay info adicional más allá de productos y datos básicos, devuelve un array vacío.
8. BUSINESS SUMMARY: Genera una descripción RICA del negocio (3-5 oraciones). No digas solo "es un restaurante". Describe el tipo de cocina, ambiente, estilo, propuesta de valor, etc. Esto se usará para que una IA de ventas entienda y represente al negocio.
9. TARGET CUSTOMERS: Infiere el perfil del cliente ideal basándote en precios, estilo, productos y ubicación. Si vende sushi premium en San Isidro, el cliente es distinto a una cevichería familiar en Comas.
10. CATEGORY_FOLLOWUPS — preguntas calificadoras por categoría:
    - Para CADA categoría que aparece en los productos del catálogo, genera 2 preguntas cortas y ESPECÍFICAS que el asistente debe hacerle al cliente DESPUÉS de listarle productos de esa categoría, para acotar su elección.
    - NUNCA uses preguntas genéricas tipo "¿quieres ver otra categoría?" o "¿algo más?". Tienen que ser preguntas que ayuden a venderle al cliente ESE rubro específico.
    - Ejemplos buenos:
        * "Polos" → ["¿Tienes algún modelo o estampado en mente?", "¿Lo usarás para entrenar o uso diario?"]
        * "Pantalones" → ["¿Buscas un corte en particular (slim, recto, oversized)?", "¿Talla que sueles usar?"]
        * "Tortas" → ["¿Para cuántas personas?", "¿Tienes algún sabor o tema de decoración en mente?"]
        * "Audífonos" → ["¿Inalámbricos o con cable?", "¿Para uso diario, deporte o gaming?"]
        * "Perfumes" → ["¿Para hombre, mujer o unisex?", "¿Prefieres notas dulces, frescas o intensas?"]
        * "Cargadores" → ["¿Qué marca/modelo de equipo?", "¿Te urge carga rápida o estándar?"]
    - Las preguntas deben ser ADAPTADAS al rubro y estilo del negocio detectado (no las copies de los ejemplos al pie de la letra).
    - Nombres de categoría tal como aparecen en el catálogo (capitalización original). Si no detectas categorías claras, devuelve {}.
11. FORMATO: DEVUELVE ÚNICAMENTE EL JSON. Si devuelves texto antes o después de la llave { }, causarás un error fatal.
`

export async function analyzeCatalogFile(filePath: string, mimeType: string, originalName?: string): Promise<CatalogAnalysis> {
    try {
        console.log(`[CatalogAnalyzer] Analyzing file: ${filePath} (${mimeType}) ${originalName || ''}`)
        const fileBuffer = readFileSync(filePath)
        const base64Data = fileBuffer.toString('base64')

        const messages: any[] = []

        if (mimeType.startsWith('image/')) {
            // Image file → use vision with base64 data URL
            const dataUrl = `data:${mimeType};base64,${base64Data}`
            messages.push({
                role: 'user',
                content: [
                    { type: 'text', text: ANALYSIS_PROMPT },
                    { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } }
                ]
            })
        } else if (mimeType === 'application/pdf') {
            // PDF → use OpenAI native file input
            console.log(`[CatalogAnalyzer] Sending PDF to OpenAI natively (${(base64Data.length / 1024).toFixed(0)} KB base64)...`)
            messages.push({
                role: 'user',
                content: [
                    { type: 'text', text: ANALYSIS_PROMPT },
                    {
                        type: 'file',
                        file: {
                            filename: originalName || 'catalogo.pdf',
                            file_data: `data:application/pdf;base64,${base64Data}`
                        }
                    }
                ]
            })
        } else {
            // Excel, Word, CSV, TXT → extract text first, then send to GPT-4o
            const textContent = await extractFileText(fileBuffer, mimeType, originalName || '')
            console.log(`[CatalogAnalyzer] Extracted ${textContent.length} chars from ${mimeType}`)
            messages.push({
                role: 'user',
                content: `${ANALYSIS_PROMPT}\n\n--- CONTENIDO DEL ARCHIVO (${originalName || 'documento'}) ---\n\n${textContent.substring(0, 120000)}`
            })
        }

        console.log(`[CatalogAnalyzer] Calling OpenAI gpt-4o...`)
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages,
            max_tokens: 16000,
            temperature: 0.2,
        })

        const text = response.choices[0]?.message?.content || '{}'
        console.log(`[CatalogAnalyzer] OpenAI responded. Response length: ${text.length} chars`)
        return parseAnalysisResponse(text)
    } catch (error: any) {
        console.error('[CatalogAnalyzer] Error analyzing file:', error.message)
        if (error.response) {
            console.error('[CatalogAnalyzer] API Response:', JSON.stringify(error.response.data || error.response.body || {}).substring(0, 500))
        }
        throw error
    }
}

/**
 * Extract text content from various file formats
 */
async function extractFileText(buffer: Buffer, mimeType: string, filename: string): Promise<string> {
    const ext = filename.toLowerCase().split('.').pop() || ''

    // Excel files
    if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || ext === 'xlsx' || ext === 'xls' || ext === 'csv') {
        if (ext === 'csv' || mimeType === 'text/csv') {
            return buffer.toString('utf-8')
        }
        try {
            const xlsxModule = await import('xlsx') as any
            const XLSX = xlsxModule.default || xlsxModule
            const workbook = XLSX.read(buffer, { type: 'buffer' })
            const lines: string[] = []
            for (const sheetName of workbook.SheetNames) {
                const sheet = workbook.Sheets[sheetName]
                const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false })
                if (csv.trim()) {
                    lines.push(`--- Hoja: ${sheetName} ---`)
                    lines.push(csv)
                }
            }
            const result = lines.join('\n')
            console.log(`[CatalogAnalyzer] Excel extracted: ${result.length} chars from ${workbook.SheetNames.length} sheets`)
            return result || 'No se pudo extraer contenido del Excel'
        } catch (e: any) {
            console.error('[CatalogAnalyzer] xlsx extraction failed:', e.message)
            return buffer.toString('utf-8').substring(0, 50000) // fallback
        }
    }

    // Word documents (.docx)
    if (mimeType.includes('word') || mimeType.includes('openxmlformats-officedocument') || ext === 'docx' || ext === 'doc') {
        try {
            const mammothModule = await import('mammoth') as any
            const mammoth = mammothModule.default || mammothModule
            const result = await mammoth.extractRawText({ buffer })
            console.log(`[CatalogAnalyzer] Word extracted: ${result.value.length} chars`)
            return result.value || 'No se pudo extraer contenido del Word'
        } catch (e: any) {
            console.error('[CatalogAnalyzer] mammoth extraction failed:', e.message)
            return buffer.toString('utf-8').substring(0, 50000) // fallback
        }
    }

    // Default: try as text (txt, json, etc.)
    return buffer.toString('utf-8')
}

export async function analyzeCatalogUrl(url: string): Promise<CatalogAnalysis> {
    try {
        console.log(`[CatalogAnalyzer] Scraping URL: ${url}`)
        const parsedUrl = new URL(url)

        // ─── Estrategia 1: Shopify nativo PAGINADO ───
        // Antes solo traíamos 250 productos (1 página). Tiendas como Gymshark
        // tienen miles. Ahora paginamos hasta 8 páginas (max 2000 productos)
        // o hasta que la API devuelva una página vacía.
        try {
            const shopifyAll = await fetchShopifyProductsPaginated(parsedUrl.origin, 8)
            if (shopifyAll.length > 0) {
                console.log(`[CatalogAnalyzer] Shopify paginated: ${shopifyAll.length} products total`)

                const products: CatalogProduct[] = shopifyAll.map((p: any) => {
                    const price = (p.variants && p.variants[0] && p.variants[0].price) ? `S/ ${p.variants[0].price}` : 'Consultar'
                    const desc = p.body_html ? p.body_html.replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').trim() : ''
                    const imageUrl = (p.images && p.images.length > 0) ? p.images[0].src : ''
                    return {
                        name: p.title,
                        price,
                        description: desc.substring(0, 500),
                        category: p.product_type || 'General',
                        imageUrl
                    }
                })

                // Cap a 1000 productos (límite global del importador).
                const capped = products.slice(0, 1000)
                if (products.length > 1000) {
                    console.log(`[CatalogAnalyzer] Shopify devolvió ${products.length} productos — capando a 1000`)
                }

                // Solo los primeros 30 van al LLM como muestra para que infiera
                // metadata del negocio (categoría, target, personalidad, etc).
                // La lista COMPLETA se devuelve abajo sin pasar por el LLM.
                const sample = capped.slice(0, 30)
                const shopifyText = `Catálogo de ${parsedUrl.hostname} (Shopify, ${capped.length} productos totales). Muestra de los primeros 30:\n${JSON.stringify(sample, null, 2)}`

                console.log(`[CatalogAnalyzer] Sending Shopify metadata sample to OpenAI...`)
                const response = await openai.chat.completions.create({
                    model: "gpt-4o-mini",
                    messages: [
                        { role: 'user', content: `${ANALYSIS_PROMPT}\n\n--- CATÁLOGO SHOPIFY (${capped.length} productos) ---\n\n${shopifyText}` }
                    ],
                    max_tokens: 4000,
                    temperature: 0.2,
                })
                const parsed = parseAnalysisResponse(response.choices[0]?.message?.content || '{}')
                // Reemplazamos los productos inferidos por la lista COMPLETA
                // (no truncada) tomada directamente del API de Shopify.
                parsed.products = capped
                return parsed
            }
        } catch (e: any) {
            console.log(`[CatalogAnalyzer] Shopify paginated fetch failed: ${e?.message || e}. Trying VTEX.`)
        }

        // ─── Estrategia 1.5: VTEX API PAGINADA ───
        // VTEX es la plataforma e-commerce más usada en Latinoamérica (inbox.com.pe,
        // saga, ripley, oechsle, plaza vea, etc.). Tiene una API pública en
        // /api/catalog_system/pub/products/search que devuelve hasta 50 productos
        // por request. Paginamos hasta 1000 productos máximo.
        try {
            const vtexAll = await fetchVtexProductsPaginated(parsedUrl.origin, 1000)
            if (vtexAll.length > 0) {
                console.log(`[CatalogAnalyzer] VTEX paginated: ${vtexAll.length} products total`)

                const products: CatalogProduct[] = vtexAll.map((p: any) => {
                    const item = (Array.isArray(p.items) && p.items.length > 0) ? p.items[0] : null
                    const offer = item?.sellers?.[0]?.commertialOffer || {}
                    const priceNum = Number(offer.Price) || Number(offer.PriceWithoutDiscount) || 0
                    const price = priceNum > 0 ? `S/ ${priceNum.toFixed(2)}` : 'Consultar'
                    const desc = (p.description || p.metaTagDescription || '')
                        .toString().replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').trim()
                    const imageUrl = (item?.images?.[0]?.imageUrl) || ''
                    const category = (Array.isArray(p.categories) && p.categories[0])
                        ? String(p.categories[0]).replace(/^\/|\/$/g, '').split('/').pop() || 'General'
                        : 'General'
                    return {
                        name: p.productName || item?.name || 'Producto',
                        price,
                        description: desc.substring(0, 500),
                        category,
                        imageUrl
                    }
                })

                // Llamar a OpenAI SOLO con muestra para metadata del negocio.
                const sample = products.slice(0, 30)
                const vtexText = `Catálogo de ${parsedUrl.hostname} (VTEX, ${products.length} productos totales). Muestra de los primeros 30:\n${JSON.stringify(sample, null, 2)}`

                console.log(`[CatalogAnalyzer] Sending VTEX metadata sample to OpenAI...`)
                const response = await openai.chat.completions.create({
                    model: "gpt-4o-mini",
                    messages: [
                        { role: 'user', content: `${ANALYSIS_PROMPT}\n\n--- CATÁLOGO VTEX (${products.length} productos) ---\n\n${vtexText}` }
                    ],
                    max_tokens: 4000,
                    temperature: 0.2,
                })
                const parsed = parseAnalysisResponse(response.choices[0]?.message?.content || '{}')
                parsed.products = products
                return parsed
            }
        } catch (e: any) {
            console.log(`[CatalogAnalyzer] VTEX paginated fetch failed: ${e?.message || e}. Falling back to sitemap.`)
        }

        // ─── Estrategia 2: sitemap.xml — extraer productos directamente ───
        // Útil para tiendas que NO exponen /products.json (Shopify con bloqueo
        // como Gymshark, WooCommerce custom, Vtex, Magento sin proxy, etc.).
        // El sitemap de productos suele incluir <image:title> con el nombre
        // del producto, lo que nos permite obtener cientos/miles de nombres
        // sin scrapear cada URL individualmente.
        let sitemapProducts: { name: string; url: string }[] = []
        let productPageUrls: string[] = []
        try {
            const sitemapResult = await discoverProductsFromSitemap(parsedUrl.origin)
            sitemapProducts = sitemapResult.products
            productPageUrls = sitemapResult.urls
            if (sitemapProducts.length > 0) {
                console.log(`[CatalogAnalyzer] Sitemap extracted ${sitemapProducts.length} products + ${productPageUrls.length} URLs`)
            }
        } catch (e: any) {
            console.log(`[CatalogAnalyzer] Sitemap discovery failed: ${e?.message || e}`)
        }

        // Si el sitemap nos dio productos (>=10), tomamos esa lista como base.
        // Antes el umbral era 50, lo que dejaba caer al LLM scrape (4 productos
        // alucinados) en sitios donde el sitemap solo expone parcialmente el
        // catálogo. Con 10 ya garantizamos que aprovechamos lo extraído.
        if (sitemapProducts.length >= 10) {
            console.log(`[CatalogAnalyzer] Using sitemap-first strategy (${sitemapProducts.length} products)`)
            return await analyzeWithSitemapProducts(url, parsedUrl, sitemapProducts, productPageUrls.slice(0, 25))
        }

        // Step 1: Fetch main page HTML
        const mainContent = await scrapePageContent(url)
        console.log(`[CatalogAnalyzer] Main page scraped: ${mainContent.text.length} chars, ${mainContent.links.length} internal links found`)

        // Step 2: Identify and follow relevant subpages (menu, products, catalog, etc.)
        const menuKeywords = /menu|carta|catalogo|catalogue|productos|products|platos|dishes|servicios|services|precios|prices|tienda|shop|store|pedidos|order|collection|coleccion|category|categoria/i
        const relevantLinks = mainContent.links
            .filter(link => menuKeywords.test(link.href) || menuKeywords.test(link.text))
            .slice(0, 8)  // Aumentado a 8 (antes 5) para capturar más colecciones

        let combinedText = `--- PÁGINA PRINCIPAL: ${url} ---\n${mainContent.text}\n`

        if (relevantLinks.length > 0) {
            console.log(`[CatalogAnalyzer] Following ${relevantLinks.length} relevant sublinks`)
            for (const link of relevantLinks) {
                try {
                    const subContent = await scrapePageContent(link.href)
                    combinedText += `\n--- SUBPÁGINA: ${link.text || link.href} ---\n${subContent.text}\n`
                    console.log(`[CatalogAnalyzer]   ✓ ${link.href}: ${subContent.text.length} chars`)
                } catch (e: any) {
                    console.log(`[CatalogAnalyzer]   ✗ ${link.href}: ${e.message}`)
                }
            }
        }

        // Step 3: Si encontramos URLs de producto vía sitemap, scrapear hasta 30
        // de ellas. Esto agrega contenido directo de páginas de producto al
        // input del LLM y mejora dramáticamente la extracción para tiendas
        // que no tienen /products.json.
        if (productPageUrls.length > 0) {
            const toFetch = productPageUrls.slice(0, 30)
            console.log(`[CatalogAnalyzer] Fetching ${toFetch.length} product pages from sitemap`)
            for (const purl of toFetch) {
                try {
                    const pContent = await scrapePageContent(purl)
                    // Solo agregamos si la página tiene contenido sustantivo
                    if (pContent.text.length > 200) {
                        combinedText += `\n--- PRODUCTO: ${purl} ---\n${pContent.text.substring(0, 4000)}\n`
                    }
                } catch (_) { /* skip individual failures */ }
            }
        }

        // Truncate if too large
        const maxChars = 200000  // Aumentado de 120k a 200k para acomodar más productos
        if (combinedText.length > maxChars) {
            combinedText = combinedText.substring(0, maxChars) + '\n... (contenido truncado por longitud)'
        }

        console.log(`[CatalogAnalyzer] Total scraped content: ${combinedText.length} chars. Sending to GPT-4o...`)

        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: 'user',
                    content: `${ANALYSIS_PROMPT}\n\n--- CONTENIDO EXTRAÍDO DEL SITIO WEB: ${url} ---\n\n${combinedText}`
                }
            ],
            max_tokens: 16000,
            temperature: 0.2,
        })

        const text = response.choices[0]?.message?.content || '{}'
        console.log(`[CatalogAnalyzer] OpenAI responded successfully (${text.length} chars)`)
        return parseAnalysisResponse(text)
    } catch (error: any) {
        console.error('[CatalogAnalyzer] Error analyzing URL:', error.message)
        throw error
    }
}

/**
 * Pagina la API de Shopify /products.json hasta agotar páginas o llegar al
 * límite. Cada página retorna hasta 250 productos. Tiendas grandes (Gymshark,
 * Allbirds) tienen miles, así que sin paginación solo veíamos los primeros 250.
 */
async function fetchShopifyProductsPaginated(origin: string, maxPages: number = 8): Promise<any[]> {
    const all: any[] = []
    for (let page = 1; page <= maxPages; page++) {
        const shopifyUrl = `${origin}/products.json?limit=250&page=${page}`
        const res = await fetch(shopifyUrl, {
            signal: AbortSignal.timeout(10000),
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json'
            }
        })
        if (!res.ok) {
            // Si la primera página falla, no es Shopify. Si una posterior falla,
            // ya tenemos productos así que devolvemos lo capturado.
            if (page === 1) throw new Error(`HTTP ${res.status} on page 1 — not a Shopify store`)
            break
        }
        const data = await res.json()
        const items: any[] = Array.isArray(data?.products) ? data.products : []
        if (items.length === 0) break
        all.push(...items)
        console.log(`[CatalogAnalyzer] Shopify page ${page}: +${items.length} (total ${all.length})`)
        if (items.length < 250) break  // Última página
    }
    return all
}

/**
 * Pagina la API pública de VTEX `/api/catalog_system/pub/products/search`.
 * VTEX es la plataforma del 70%+ del e-commerce LatAm (inbox.com.pe, saga,
 * ripley, oechsle, plaza vea, mass, tottus, etc.). Cada request devuelve
 * hasta 50 productos. Paginamos hasta `max` (default 1000) o hasta que la
 * API devuelva una página vacía.
 *
 * IMPORTANTE: VTEX rate-limita agresivamente (HTTP 429 tras ~30 reqs/seg).
 * Esperamos 250ms entre páginas para no gatillar el rate-limiter.
 */
async function fetchVtexProductsPaginated(origin: string, max: number = 1000): Promise<any[]> {
    const all: any[] = []
    const pageSize = 50
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
    }
    for (let from = 0; from < max; from += pageSize) {
        const to = Math.min(from + pageSize - 1, max - 1)
        const vtexUrl = `${origin}/api/catalog_system/pub/products/search?_from=${from}&_to=${to}`
        const res = await fetch(vtexUrl, {
            signal: AbortSignal.timeout(15000),
            headers
        })
        if (!res.ok) {
            if (from === 0) throw new Error(`HTTP ${res.status} on first page — not VTEX`)
            // En páginas siguientes algunos sites cortan en 2500 productos con 206/410.
            // Devolvemos lo que ya tenemos.
            break
        }
        let items: any[] = []
        try {
            const json = await res.json()
            items = Array.isArray(json) ? json : []
        } catch {
            // Si la respuesta no es JSON válido, no es VTEX (probablemente HTML 404).
            if (from === 0) throw new Error('Response not JSON — not VTEX')
            break
        }
        if (items.length === 0) break
        all.push(...items)
        console.log(`[CatalogAnalyzer] VTEX _from=${from}: +${items.length} (total ${all.length})`)
        if (items.length < pageSize) break  // Última página
        // Throttle entre requests para evitar 429.
        await new Promise(r => setTimeout(r, 250))
    }
    return all
}

/**
 * Descubre productos leyendo el sitemap.xml del sitio. Devuelve:
 *  - `products`: nombres extraídos de <image:title> (Shopify y similares)
 *  - `urls`: URLs de páginas de producto para scrape opcional
 *
 * Soporta sitemap principal + sitemap-index. Si el sitemap incluye
 * <image:image><image:title>NOMBRE</image:title></image:image>, lo usamos
 * para construir la lista de productos sin tener que visitar cada URL.
 */
async function discoverProductsFromSitemap(origin: string): Promise<{ products: { name: string; url: string }[]; urls: string[] }> {
    const sitemapCandidates = [
        `${origin}/sitemap.xml`,
        `${origin}/sitemap_index.xml`,
        `${origin}/sitemap-index.xml`
    ]

    // Patrones de URL de producto soportados:
    //   • Shopify / WooCommerce: /products/slug, /producto/slug, /shop/slug, /tienda/slug
    //   • VTEX (70% del e-commerce LatAm): /slug/p, /slug/p/
    //   • Inbox / sites con catálogo plano: /catalogo/slug_SKU_ID
    //   • Magento / sitios custom con .html: /producto.html
    //   • IDs numéricos: /p-12345, /item-123, /product/12345
    //   • Detalle por ID típico de inbox/oechsle/saga: /productos/slug-id
    const productUrlPattern = /\/(?:product|producto|productos|p|item|items|shop|tienda|catalog|catalogo)s?(?:\/|$)|\/[\w-]+\/p\/?$|\/p-\d+|\/item-\d+|\.html(?:\?|$)/i
    // Deduplicación por canónico: quitamos locale prefixes (/es-US/, /en-PE/,
    // /fr/, etc.) para que el mismo producto en distintos idiomas cuente como
    // uno solo. Antes Gymshark devolvía 3496 = 1748 × 2 porque el sitemap
    // listaba versión inglés + es-US.
    const localePathPrefix = /^\/(?:[a-z]{2}(?:-[a-z]{2})?)\//i
    const canonicalize = (urlStr: string): string => {
        try {
            const u = new URL(urlStr)
            const path = u.pathname.replace(localePathPrefix, '/')
            return `${u.origin}${path}`
        } catch { return urlStr }
    }

    const productsByCanon = new Map<string, { name: string; url: string }>()
    const allUrls = new Set<string>()
    const sitemapsToFetch: string[] = []

    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/xml,text/xml,*/*'
    }

    // 1. Buscar el sitemap raíz
    let rootSitemapXml = ''
    for (const candidate of sitemapCandidates) {
        try {
            const res = await fetch(candidate, { signal: AbortSignal.timeout(10000), headers })
            if (res.ok) {
                rootSitemapXml = await res.text()
                console.log(`[CatalogAnalyzer] Found sitemap at ${candidate}`)
                break
            }
        } catch (_) { /* try next */ }
    }
    if (!rootSitemapXml) return { products: [], urls: [] }

    // 2. Si es un sitemap-index, recolectar los sub-sitemaps
    const $root = cheerio.load(rootSitemapXml, { xmlMode: true })
    const subSitemaps: string[] = []
    $root('sitemap loc').each((_, el) => {
        const u = $root(el).text().trim()
        if (u) subSitemaps.push(u)
    })

    if (subSitemaps.length === 0) {
        sitemapsToFetch.push('__root__')
    } else {
        // Excluir explícitamente sitemaps con prefijo de locale en el path (los
        // duplican por idioma). Solo usamos los sub-sitemaps "raíz" del dominio.
        const productSitemaps = subSitemaps.filter(s => /product|producto|catalog|catalogo|shop|tienda|sku/i.test(s))
        const noLocale = productSitemaps.filter(s => {
            try {
                return !localePathPrefix.test(new URL(s).pathname)
            } catch { return true }
        })
        const filtered = noLocale.filter(s => !/hreflang/i.test(s))
        // Si NO encontramos sub-sitemaps con keywords de producto, usamos TODOS
        // los sub-sitemaps disponibles (excepto los que sean obviamente de blog,
        // categorías, marcas, etc.). Algunos VTEX nombran los sitemaps como
        // `sitemap-1.xml` sin keyword reconocible.
        const fallback = subSitemaps.filter(s => !/blog|news|noticia|categor|marca|brand|term|tag|seller/i.test(s))
        const candidates = filtered.length > 0
            ? filtered
            : (productSitemaps.length > 0 ? productSitemaps.filter(s => !/hreflang/i.test(s)) : fallback)
        // Ampliado de 4 a 12 sub-sitemaps: catálogos grandes en VTEX se parten
        // en varios sub-sitemaps numerados (sitemap-products-1..N.xml).
        sitemapsToFetch.push(...candidates.slice(0, 12))
    }

    // 3. Parsear cada sitemap, extraer URLs y nombres (deduplicado por canónico)
    const isImageTitleTag = (tagName: string) => /image:title|image:caption/i.test(tagName)

    for (const smUrl of sitemapsToFetch) {
        try {
            const xml = smUrl === '__root__'
                ? rootSitemapXml
                : await fetch(smUrl, { signal: AbortSignal.timeout(15000), headers }).then(r => r.ok ? r.text() : '')
            if (!xml) continue
            const $ = cheerio.load(xml, { xmlMode: true })

            $('url').each((_, urlEl) => {
                const $urlEl = $(urlEl)
                const loc = $urlEl.find('loc').first().text().trim()
                if (!loc || !productUrlPattern.test(loc)) return
                allUrls.add(loc)
                const canon = canonicalize(loc)
                if (productsByCanon.has(canon)) return

                let name = ''
                $urlEl.find('*').each((_, c) => {
                    if (name) return
                    const tag = (c as any).tagName || (c as any).name || ''
                    if (isImageTitleTag(tag)) {
                        name = $(c).text().trim()
                    }
                })
                if (!name) {
                    const slug = canon.split('/').filter(Boolean).pop() || ''
                    // Limpiar sufijos SKU/ID típicos: "...nombre_DA204620CECH_0645"
                    // → "nombre". Heurística: trimea cualquier segmento final que
                    // empiece con un guión bajo seguido de mayúsculas/números.
                    const stripped = slug.replace(/(_[A-Z0-9]+)+$/i, '')
                    name = stripped
                        .replace(/[-_]+/g, ' ')
                        .replace(/\?.*/, '')
                        .replace(/\s+/g, ' ')
                        .trim()
                }
                if (name) productsByCanon.set(canon, { name, url: canon })
            })
        } catch (_) { /* skip */ }
        if (productsByCanon.size >= 2000) break
    }

    return { products: Array.from(productsByCanon.values()), urls: Array.from(allUrls) }
}

/**
 * Extrae precio + descripción + currency desde el JSON-LD embebido en la
 * página HTML de un producto. Funciona con sitios Shopify (Gymshark), Vtex,
 * Magento, WooCommerce y cualquier otro que respete schema.org/Product o
 * ProductGroup. Devuelve null si no encuentra datos válidos.
 */
async function extractProductFromHtml(productUrl: string, attempt: number = 1): Promise<{
    name?: string; price?: string; priceNumber?: number; currency?: string; description?: string; category?: string; imageUrl?: string; brand?: string
} | null> {
    try {
        // Headers de navegador más realistas. Antes con un UA mínimo Gymshark
        // bloqueaba aleatoriamente requests bajo carga (~46% fallaba). Estos
        // headers imitan Chrome real y reducen el rate de bloqueos.
        const res = await fetch(productUrl, {
            // Timeout agresivo: 7s. Con concurrencia 25 y 1000 URLs, un timeout
            // de 12s acumulaba minutos en colas. 7s es suficiente para sitios
            // sanos; los lentos se reintentan en pass 2/3 con concurrencia menor.
            signal: AbortSignal.timeout(7000),
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9,es;q=0.8',
                'Accept-Encoding': 'gzip, deflate, br',
                'Cache-Control': 'no-cache',
                'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
                'Sec-Ch-Ua-Mobile': '?0',
                'Sec-Ch-Ua-Platform': '"macOS"',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Upgrade-Insecure-Requests': '1'
            }
        })
        if (!res.ok) {
            // Reintentar UNA vez ante 429 (rate limit) o 5xx con backoff corto.
            if (attempt < 2 && (res.status === 429 || res.status >= 500)) {
                await new Promise(r => setTimeout(r, 800 + Math.random() * 600))
                return extractProductFromHtml(productUrl, attempt + 1)
            }
            return null
        }
        const html = await res.text()
        const $ = cheerio.load(html)

        // Reunir todos los <script type="application/ld+json"> de la página y
        // buscar el primero que sea Product / ProductGroup.
        const ldJsonNodes: any[] = []
        $('script[type="application/ld+json"]').each((_, el) => {
            try {
                const raw = $(el).html() || ''
                const parsed = JSON.parse(raw)
                if (Array.isArray(parsed)) ldJsonNodes.push(...parsed)
                else ldJsonNodes.push(parsed)
                // Algunos sitios envuelven en @graph
                if (parsed['@graph'] && Array.isArray(parsed['@graph'])) {
                    ldJsonNodes.push(...parsed['@graph'])
                }
            } catch { /* skip malformed */ }
        })

        const productNode = ldJsonNodes.find(n => {
            const t = n?.['@type']
            if (typeof t === 'string') return /^(Product|ProductGroup)$/i.test(t)
            if (Array.isArray(t)) return t.some((x: string) => /^(Product|ProductGroup)$/i.test(x))
            return false
        })

        // Fallback: schema.org microdata (itemprop) — usado por inbox.com.pe,
        // Magento default, Drupal Commerce y muchos sites custom. Si JSON-LD
        // no existe o no tiene un Product, leemos los itemprop del HTML.
        if (!productNode) {
            const micro = extractProductMicrodata($, productUrl)
            if (micro) return micro
            return null
        }

        // El precio puede vivir en `offers` o dentro de `hasVariant[].offers`
        const pickOffer = (node: any): any => {
            if (!node) return null
            if (node.offers) {
                return Array.isArray(node.offers) ? node.offers[0] : node.offers
            }
            if (Array.isArray(node.hasVariant) && node.hasVariant.length > 0) {
                for (const v of node.hasVariant) {
                    const o = pickOffer(v)
                    if (o) return o
                }
            }
            return null
        }
        const offer = pickOffer(productNode)
        const priceRaw = offer?.price ?? offer?.lowPrice
        let priceNumber = typeof priceRaw === 'number' ? priceRaw : parseFloat(String(priceRaw || '0')) || 0
        let currency = offer?.priceCurrency || offer?.currency || ''

        // Si JSON-LD no trae precio válido, complementamos con microdata.
        // Algunos sitios tienen ambos formatos pero el JSON-LD es incompleto.
        if (priceNumber <= 0) {
            const micro = extractProductMicrodata($, productUrl)
            if (micro?.priceNumber && micro.priceNumber > 0) {
                priceNumber = micro.priceNumber
                if (!currency && micro.currency) currency = micro.currency
            }
        }

        const symbolMap: Record<string, string> = { USD: 'US$', EUR: '€', PEN: 'S/', MXN: '$', COP: '$', ARS: '$', CLP: '$', GBP: '£', BRL: 'R$' }
        const symbol = symbolMap[currency] || currency || ''
        const priceStr = priceNumber > 0 ? `${symbol} ${priceNumber.toFixed(2)}`.trim() : 'Consultar'

        const desc = (productNode.description || '').toString().replace(/\s+/g, ' ').trim().substring(0, 500)
        const name = (productNode.name || '').toString().trim()
        const category = (productNode.category || '').toString().trim() || 'General'
        const image = Array.isArray(productNode.image) ? productNode.image[0] : (productNode.image || '')

        // Brand: usado para detectar el nombre real del negocio. JSON-LD lo
        // expone como string o como { name: "..." } según el sitio.
        let brand = ''
        if (productNode.brand) {
            brand = typeof productNode.brand === 'string' ? productNode.brand : (productNode.brand.name || '')
            // Limpiar tagline tipo "Gymshark | We Do Gym" → "Gymshark"
            brand = brand.split('|')[0].trim()
        }

        return {
            name: name || undefined,
            price: priceStr,
            priceNumber,
            currency: currency || undefined,
            description: desc || undefined,
            category,
            imageUrl: typeof image === 'string' ? image : (image?.url || ''),
            brand: brand || undefined
        }
    } catch (e: any) {
        // Reintentar UNA vez ante errores de red transitorios (timeouts,
        // ECONNRESET, socket hang up). El primer intento falla con frecuencia
        // bajo carga (1700+ requests concurrentes) pero el segundo pasa.
        const isTransient = e?.name === 'AbortError'
            || /timeout|ECONNRESET|ETIMEDOUT|fetch failed|socket hang up|network/i.test(e?.message || '')
        if (attempt < 2 && isTransient) {
            await new Promise(r => setTimeout(r, 600 + Math.random() * 400))
            return extractProductFromHtml(productUrl, attempt + 1)
        }
        return null
    }
}

/**
 * Fallback de extracción cuando NO hay JSON-LD: lee schema.org microdata
 * (`itemprop="price"`, `itemprop="priceCurrency"`, `itemprop="name"`, etc.).
 * Usado por inbox.com.pe, Magento default, Drupal Commerce, y muchos sites
 * custom de retailers peruanos.
 *
 * Última línea de defensa: si tampoco hay microdata, parsea el precio desde
 * la meta description / og:description (formato típico "...S/ 4,300.00...").
 */
function extractProductMicrodata($: cheerio.CheerioAPI, productUrl: string): {
    name?: string; price?: string; priceNumber?: number; currency?: string; description?: string; category?: string; imageUrl?: string; brand?: string
} | null {
    // 1) Microdata schema.org — scopeado dentro del itemtype="...Product".
    //    Sin scopear, sites como inbox.com.pe tienen <title itemprop="name">
    //    PRIMERO en el HTML (con sufijo "— Inbox"), antes del <span itemprop="name">
    //    real del producto. .first() agarraba el equivocado.
    let scope: cheerio.Cheerio<AnyNode> = $('[itemtype*="schema.org/Product"]').first()
    if (scope.length === 0) {
        // Fallback: si no hay itemscope explícito de Product, busca cualquier
        // contenedor que tenga itemprop="price" — ese suele ser el bloque del
        // producto en sites mal marcados.
        const priceEl = $('[itemprop="price"]').first()
        if (priceEl.length > 0) {
            scope = priceEl.closest('[itemscope]')
        }
    }
    // Último recurso: buscar globalmente. Se aplica para sites sin itemscope.
    const useGlobalScope = scope.length === 0

    const getMicro = (prop: string): string => {
        const el = useGlobalScope
            ? $(`[itemprop="${prop}"]`).not('title').first()  // excluye <title itemprop="name">
            : scope.find(`[itemprop="${prop}"]`).first()
        if (el.length === 0) return ''
        // <meta itemprop="..." content="X"> o <link itemprop="..." href="X">
        const content = el.attr('content') || el.attr('href') || ''
        if (content) return content.trim()
        // <span itemprop="...">X</span>
        return el.text().trim()
    }

    const microPrice = getMicro('price')
    const microCurrency = getMicro('priceCurrency')
    const microName = getMicro('name')
    const microDesc = getMicro('description')
    const microBrand = getMicro('brand')
    const microImage = (() => {
        const el = useGlobalScope
            ? $('[itemprop="image"]').first()
            : scope.find('[itemprop="image"]').first()
        if (el.length === 0) return ''
        return (el.attr('content') || el.attr('src') || el.attr('href') || '').trim()
    })()

    let priceNumber = 0
    if (microPrice) {
        // Acepta "4300", "4,300.00", "S/ 4,300.00", "$1.234,56" (comas/puntos mixtos)
        priceNumber = parsePriceString(microPrice)
    }

    // 2) Si no encontramos precio en microdata, fallback a meta description /
    //    og:description. Inbox los rellena con "Nombre S/ X.XX (SKU)".
    if (priceNumber <= 0) {
        const metaDesc = $('meta[name="description"]').attr('content')
            || $('meta[property="og:description"]').attr('content')
            || ''
        const m = metaDesc.match(/(?:S\/|US\$|\$|€|R\$|£)\s*([\d.,]+)/i)
        if (m && m[1]) {
            priceNumber = parsePriceString(m[1])
        }
    }

    // 3) Nombre con fallbacks a <title>, og:title.
    let name = microName
    if (!name) {
        const title = ($('title').text() || '').trim()
        // Quita el sufijo " — TiendaName" / " | Brand" típico
        name = title.split(/[—|·]/)[0].trim()
    }
    if (!name) {
        name = ($('meta[property="og:title"]').attr('content') || '').trim()
    }

    // Limpieza final del nombre: aunque microName venga correcto, algunos
    // sites duplican el site_name al final ("Producto X — Inbox"). Strippeamos
    // el og:site_name si aparece como sufijo, y también separadores típicos
    // tipo " — TiendaName", " | TiendaName", " - TiendaName" cuando lo de
    // después es corto (≤25 chars) — heurística para no comer el nombre real.
    if (name) {
        const siteName = ($('meta[property="og:site_name"]').attr('content') || '').trim()
        if (siteName && name.toLowerCase().endsWith(siteName.toLowerCase())) {
            // Strip " — Inbox", " | Inbox", " - Inbox" (con espacios opcionales)
            const re = new RegExp(`\\s*[—|·\\-]+\\s*${siteName.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\s*$`, 'i')
            name = name.replace(re, '').trim()
        } else {
            // Sin og:site_name — strip genérico de separador final + palabra corta
            name = name.replace(/\s+[—|·]\s+[\w\s]{1,25}$/i, '').trim()
        }
    }

    // Si no logramos ni nombre ni precio, no es un producto extraíble.
    if (!name && priceNumber <= 0) return null

    const symbolMap: Record<string, string> = { USD: 'US$', EUR: '€', PEN: 'S/', MXN: '$', COP: '$', ARS: '$', CLP: '$', GBP: '£', BRL: 'R$' }
    const symbol = symbolMap[microCurrency] || (microCurrency || 'S/')
    const priceStr = priceNumber > 0 ? `${symbol} ${priceNumber.toFixed(2)}`.trim() : 'Consultar'

    // imageUrl: si es relativa (`//cdn...`), normalizar.
    let imageUrl = microImage || ($('meta[property="og:image"]').attr('content') || '')
    if (imageUrl.startsWith('//')) imageUrl = 'https:' + imageUrl

    // Brand: limpiar tagline tipo "Diesel | Premium Denim" → "Diesel"
    const brand = (microBrand || '').split('|')[0].trim()

    return {
        name: name || undefined,
        price: priceStr,
        priceNumber,
        currency: microCurrency || (priceNumber > 0 ? 'PEN' : undefined),
        description: (microDesc || '').substring(0, 500) || undefined,
        category: 'General',
        imageUrl,
        brand: brand || undefined
    }
}

/**
 * Parsea un string de precio en cualquier formato común:
 *   "4300"            → 4300
 *   "4,300.00"        → 4300
 *   "4.300,00"        → 4300 (formato europeo / latam)
 *   "S/ 4,300.00"     → 4300
 *   "1.234,56 €"      → 1234.56
 *
 * La heurística: si hay tanto coma como punto, el ÚLTIMO separador es el
 * decimal. Si solo hay uno, asumimos que es decimal solo si tiene 1-2
 * dígitos después; si tiene 3, es separador de miles.
 */
function parsePriceString(raw: string): number {
    if (!raw) return 0
    // Quitar símbolos de moneda y espacios
    const cleaned = String(raw).replace(/[^\d.,-]/g, '').trim()
    if (!cleaned) return 0
    const lastComma = cleaned.lastIndexOf(',')
    const lastDot = cleaned.lastIndexOf('.')
    let normalized = cleaned
    if (lastComma > -1 && lastDot > -1) {
        // Ambos presentes: el último es el decimal, el otro son miles.
        if (lastComma > lastDot) {
            normalized = cleaned.replace(/\./g, '').replace(',', '.')
        } else {
            normalized = cleaned.replace(/,/g, '')
        }
    } else if (lastComma > -1) {
        const after = cleaned.slice(lastComma + 1)
        // Si después de la coma hay 3 dígitos → es separador de miles ("4,300")
        // Si hay 1-2 → es decimal ("4,30" o "4,3")
        if (after.length === 3 && /^\d+$/.test(after)) {
            normalized = cleaned.replace(/,/g, '')
        } else {
            normalized = cleaned.replace(/,/g, '.')
        }
    }
    const n = parseFloat(normalized)
    return isFinite(n) && n > 0 ? n : 0
}

/**
 * Procesa una lista de URLs en paralelo con concurrencia controlada. Útil
 * para no saturar al servidor de la tienda ni nuestro outbound.
 */
async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T, idx: number) => Promise<R>): Promise<R[]> {
    const results: R[] = new Array(items.length)
    let cursor = 0
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        for (;;) {
            const i = cursor++
            if (i >= items.length) break
            try {
                results[i] = await worker(items[i], i)
            } catch (e: any) {
                results[i] = undefined as any
            }
        }
    })
    await Promise.all(workers)
    return results
}

/**
 * Estrategia "sitemap-first" mejorada: ahora extrae el JSON-LD de CADA
 * página de producto en paralelo (concurrencia 12) para obtener precios y
 * descripciones reales. Si el JSON-LD no está disponible, deja "Consultar".
 *
 * Capamos a 500 productos como balance entre completitud y tiempo (≈45-60s
 * de scraping para 500 URLs con concurrencia 12). Más productos saturan al
 * navegador en la pantalla de confirmación.
 */
async function analyzeWithSitemapProducts(
    url: string,
    parsedUrl: URL,
    sitemapProducts: { name: string; url: string }[],
    _sampleUrls: string[]
): Promise<CatalogAnalysis> {
    // Cap a 1000 productos: balance entre completitud y conseguir precio para
    // TODOS. Con caps mayores, los servidores empiezan a rate-limitar y
    // muchos quedan sin precio. Con 1000 podemos hacer hasta 3 pases de
    // retry sin saturar y obtener precio en >95% de los productos.
    const PRODUCT_CAP = 1000
    const limited = sitemapProducts.slice(0, PRODUCT_CAP)
    if (sitemapProducts.length > PRODUCT_CAP) {
        console.log(`[CatalogAnalyzer] Sitemap had ${sitemapProducts.length} products — capping at ${PRODUCT_CAP} para garantizar precios`)
    }

    // Pase 1: concurrencia 25 (antes 12). Con timeout de 7s por request, 1000
    // productos se procesan en ~40-60s en lugar de los 5-7 minutos anteriores.
    // El usuario percibía que "no carga nada" porque el spinner del frontend
    // se quedaba >5 min sin response.
    console.log(`[CatalogAnalyzer] Pass 1: ${limited.length} products with concurrency 25...`)
    const t0 = Date.now()
    let processed = 0
    let withPriceSoFar = 0
    const enriched = await mapWithConcurrency(limited, 25, async (p) => {
        const data = await extractProductFromHtml(p.url)
        processed++
        if (data?.priceNumber && data.priceNumber > 0) withPriceSoFar++
        // Log de progreso cada 50 productos para ver que el server NO está colgado.
        if (processed % 50 === 0) {
            console.log(`[CatalogAnalyzer]   progress: ${processed}/${limited.length} (${withPriceSoFar} con precio) — ${((Date.now() - t0) / 1000).toFixed(0)}s`)
        }
        return { sitemap: p, data }
    })

    let pass1Success = enriched.filter(e => e.data?.priceNumber && e.data.priceNumber > 0).length
    console.log(`[CatalogAnalyzer] Pass 1 complete: ${pass1Success}/${limited.length} with prices in ${((Date.now() - t0) / 1000).toFixed(1)}s`)

    // Pases 2 y 3: retry agresivo de los que fallaron, con concurrencia
    // baja y pausa entre pases para evitar rate-limit. Cada pase recupera
    // ~50-70% de los pendientes.
    for (let passN = 2; passN <= 3; passN++) {
        const failed = enriched
            .map((e, i) => ({ e, i }))
            .filter(({ e }) => !e.data?.priceNumber || e.data.priceNumber <= 0)
        if (failed.length === 0) break
        if (failed.length === limited.length) break  // todo falló — no insistir
        console.log(`[CatalogAnalyzer] Pass ${passN}: retrying ${failed.length} failures with concurrency 8...`)
        await new Promise(r => setTimeout(r, 1500))  // breath corto para el servidor
        await mapWithConcurrency(failed, 8, async ({ e, i }) => {
            const data = await extractProductFromHtml(e.sitemap.url)
            if (data?.priceNumber && data.priceNumber > 0) {
                enriched[i] = { sitemap: e.sitemap, data }
            }
        })
        const recovered = enriched.filter(e => e.data?.priceNumber && e.data.priceNumber > 0).length
        console.log(`[CatalogAnalyzer] Pass ${passN}: recovered ${recovered - pass1Success} more (total ${recovered}/${limited.length})`)
        pass1Success = recovered
    }

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
    const withPrice = enriched.filter(e => e.data?.priceNumber && e.data.priceNumber > 0).length
    console.log(`[CatalogAnalyzer] JSON-LD extraction done in ${elapsed}s — ${withPrice}/${limited.length} got real prices (${(withPrice / limited.length * 100).toFixed(0)}%)`)

    // 2. Detectar moneda dominante (la tienda puede tener una sola).
    const currencyCounts: Record<string, number> = {}
    for (const e of enriched) {
        if (e.data?.currency) currencyCounts[e.data.currency] = (currencyCounts[e.data.currency] || 0) + 1
    }
    const dominantCurrency = Object.entries(currencyCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'PEN'

    // 3. Construir lista final con datos reales + fallbacks.
    // IMPORTANTE: price queda como NÚMERO (no string con símbolo). El frontend
    // muestra el símbolo desde `analysis.currency` por separado. Antes
    // devolvíamos "US$ 40.00" como string y `Number(...)` daba NaN en el
    // formulario de confirmación, dejando los inputs vacíos.
    const products: any[] = enriched.map(e => {
        const sp = e.sitemap
        const d = e.data
        if (d?.priceNumber && d.priceNumber > 0) {
            return {
                name: d.name || sp.name,
                price: d.priceNumber,
                description: d.description || `Producto disponible en ${parsedUrl.hostname}.`,
                category: d.category || 'General',
                imageUrl: d.imageUrl
            }
        }
        return {
            name: sp.name,
            price: 0,
            description: d?.description || `Producto disponible en ${parsedUrl.hostname}. Consulta precio y disponibilidad.`,
            category: d?.category || 'General',
            imageUrl: d?.imageUrl
        }
    })

    // 4. Llamar a OpenAI SOLO con muestra pequeña + homepage para metadata
    //    del negocio (no para los productos — esos ya los tenemos limpios).
    console.log('[CatalogAnalyzer] Step 4: scraping homepage for metadata context')
    let homepageText = ''
    try {
        const home = await scrapePageContent(url)
        homepageText = home.text.substring(0, 6000)
        console.log(`[CatalogAnalyzer] Homepage scraped: ${homepageText.length} chars`)
    } catch (e: any) {
        console.warn(`[CatalogAnalyzer] Homepage scrape failed (non-fatal): ${e?.message}`)
    }

    const sampleForLlm = products.slice(0, 15)
    const llmInput = `${ANALYSIS_PROMPT}

--- SITIO: ${url} ---

CONTEXTO DE LA HOMEPAGE (para extraer metadata del negocio):
${homepageText || '(no disponible)'}

MUESTRA DE PRODUCTOS YA EXTRAÍDOS (para que infieras categoría/personalidad/target):
${JSON.stringify(sampleForLlm, null, 2)}

INSTRUCCIÓN: Devuelve metadata del negocio (business_name, business_summary, business_category, target_customers, bot_personality, knowledge_blocks). Para los products, devuelve esta misma muestra textualmente — la lista completa ya está armada y se sobrescribirá tu output de products después.`

    console.log(`[CatalogAnalyzer] Step 5: calling OpenAI (gpt-4o) for metadata, prompt=${(llmInput.length / 1024).toFixed(1)}KB`)
    let metadata: CatalogAnalysis
    try {
        // Timeout de 30s al LLM. Sin esto, si OpenAI rate-limita o cuelga, el
        // analyzer se queda esperando indefinidamente y el frontend muestra
        // "Qhatu está analizando tu catálogo..." para siempre.
        const llmStart = Date.now()
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: 'user', content: llmInput }],
            max_tokens: 4000,
            temperature: 0.2,
        }, { timeout: 30000 })
        console.log(`[CatalogAnalyzer] OpenAI metadata responded in ${((Date.now() - llmStart) / 1000).toFixed(1)}s`)
        metadata = parseAnalysisResponse(response.choices[0]?.message?.content || '{}')
    } catch (e: any) {
        console.warn(`[CatalogAnalyzer] LLM metadata extraction failed (non-fatal): ${e?.message}. Continuing with default metadata.`)
        metadata = parseAnalysisResponse('{}')
    }

    metadata.products = products

    // Detectar el nombre real del negocio. Prioridad:
    //   1) brand del JSON-LD (mayoritario en las extracciones) — fuente más
    //      confiable, viene de la propia tienda.
    //   2) hostname capitalizado — fallback sólido (gymshark.com → Gymshark).
    //   3) nombre del LLM — último recurso, suele ser genérico ("Tienda
    //      de Ropa Deportiva") cuando la marca no aparece en la homepage.
    const brandCounts: Record<string, number> = {}
    for (const e of enriched) {
        const b = (e.data?.brand || '').trim()
        if (b) brandCounts[b] = (brandCounts[b] || 0) + 1
    }
    const dominantBrand = Object.entries(brandCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || ''
    const hostnameBrand = parsedUrl.hostname.replace(/^www\./, '').split('.')[0]
    const hostnameProper = hostnameBrand.charAt(0).toUpperCase() + hostnameBrand.slice(1)

    if (dominantBrand) {
        metadata.business_name = dominantBrand
    } else if (!metadata.business_name || metadata.business_name === '' || /^Tienda de/i.test(metadata.business_name)) {
        // El LLM tiende a devolver "Tienda de Ropa Deportiva" cuando no detecta
        // la marca en la homepage. Si pasa eso, preferimos el hostname.
        metadata.business_name = hostnameProper
    }

    // Inyectamos la moneda detectada como campo extra para que el frontend
    // lo lea en la pantalla de confirmación. CatalogAnalysis no la incluye
    // formalmente, pero el frontend la usa via `data.analysis.currency`.
    (metadata as any).currency = dominantCurrency
    return metadata
}

/**
 * Scrape a single web page and extract meaningful text + internal links
 */
async function scrapePageContent(url: string): Promise<{ text: string, links: { href: string, text: string }[] }> {
    const response = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'es-PE,es;q=0.9,en;q=0.8'
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(15000)
    })

    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const html = await response.text()

    const $ = cheerio.load(html)

    // Remove non-content elements
    $('script, style, noscript, svg, path, iframe, link, meta, head').remove()

    // Extract text from meaningful elements
    const textParts: string[] = []

    // Get page title
    const title = $('title').text().trim()
    if (title) textParts.push(`Título: ${title}`)

    // Get meta description
    const metaDesc = $('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content')
    if (metaDesc) textParts.push(`Descripción: ${metaDesc}`)

    // Extract structured content (headings, paragraphs, lists, tables, product cards)
    $('h1, h2, h3, h4, h5, h6').each((_, el) => {
        const txt = $(el).text().trim()
        if (txt && txt.length > 1) textParts.push(`\n## ${txt}`)
    })

    // Get text from content areas — prioritize product/menu containers
    const contentSelectors = [
        '.menu', '.carta', '.products', '.catalog', '.product-list', '.menu-list',
        '[class*="product"]', '[class*="menu"]', '[class*="item"]', '[class*="card"]',
        '[class*="precio"]', '[class*="price"]',
        'main', 'article', 'section', '.content', '#content',
        'p', 'li', 'td', 'th', 'span', 'div'
    ]

    const seenTexts = new Set<string>()
    for (const selector of contentSelectors) {
        $(selector).each((_, el) => {
            const txt = $(el).clone().children().remove().end().text().trim()
            if (txt && txt.length > 2 && !seenTexts.has(txt)) {
                seenTexts.add(txt)
                textParts.push(txt)
            }
        })
    }

    // Also get all visible text as fallback — but deduplicated
    const bodyText = $('body').text().replace(/\s+/g, ' ').trim()
    if (bodyText.length > textParts.join(' ').length) {
        textParts.push('\n--- TEXTO COMPLETO DE LA PÁGINA ---')
        textParts.push(bodyText.substring(0, 80000))
    }

    // Extract internal links for subpage crawling
    const baseUrl = new URL(url)
    const links: { href: string, text: string }[] = []
    const seenHrefs = new Set<string>()

    $('a[href]').each((_, el) => {
        try {
            const href = $(el).attr('href') || ''
            const linkText = $(el).text().trim()
            let fullUrl: string

            if (href.startsWith('http')) {
                fullUrl = href
            } else if (href.startsWith('/')) {
                fullUrl = `${baseUrl.origin}${href}`
            } else if (!href.startsWith('#') && !href.startsWith('mailto:') && !href.startsWith('tel:')) {
                fullUrl = `${baseUrl.origin}/${href}`
            } else {
                return
            }

            // Only follow same-domain links
            const linkUrl = new URL(fullUrl)
            if (linkUrl.hostname === baseUrl.hostname && !seenHrefs.has(fullUrl)) {
                seenHrefs.add(fullUrl)
                links.push({ href: fullUrl, text: linkText })
            }
        } catch { /* invalid URL, skip */ }
    })

    return { text: textParts.join('\n'), links }
}

/**
 * Merge multiple CatalogAnalysis results into one
 */
export function mergeCatalogAnalyses(analyses: CatalogAnalysis[]): CatalogAnalysis {
    if (analyses.length === 0) return emptyAnalysis()
    if (analyses.length === 1) return analyses[0]

    console.log(`[CatalogAnalyzer] Merging ${analyses.length} analyses...`)

    // Take the first non-empty value for scalar fields, prefer the one with more info
    const sorted = [...analyses].sort((a, b) =>
        (b.products.length + b.knowledge_blocks.length) - (a.products.length + a.knowledge_blocks.length)
    )
    const primary = sorted[0]

    // Merge arrays across all analyses (deduplicate products by name)
    const allProducts: CatalogProduct[] = []
    const seenProductNames = new Set<string>()
    for (const a of analyses) {
        for (const p of a.products) {
            const key = p.name.toLowerCase().trim()
            if (!seenProductNames.has(key)) {
                seenProductNames.add(key)
                allProducts.push(p)
            }
        }
    }

    const allKnowledge: { titulo: string, contenido: string }[] = []
    const seenKbTitles = new Set<string>()
    for (const a of analyses) {
        for (const kb of a.knowledge_blocks) {
            const key = kb.titulo.toLowerCase().trim()
            if (!seenKbTitles.has(key)) {
                seenKbTitles.add(key)
                allKnowledge.push(kb)
            }
        }
    }

    // Merge array fields (deduplicate)
    const mergeUnique = (arrs: string[][]) => Array.from(new Set(arrs.flat()))

    return {
        business_name: primary.business_name || analyses.find(a => a.business_name)?.business_name || '',
        business_summary: primary.business_summary || analyses.find(a => a.business_summary)?.business_summary || '',
        business_category: primary.business_category || analyses.find(a => a.business_category !== 'nicho')?.business_category || 'nicho',
        business_location: primary.business_location || analyses.find(a => a.business_location)?.business_location || '',
        target_customers: primary.target_customers || analyses.find(a => a.target_customers)?.target_customers || '',
        bot_personality: primary.bot_personality || analyses.find(a => a.bot_personality)?.bot_personality || '',
        has_delivery: analyses.some(a => a.has_delivery),
        payment_methods: mergeUnique(analyses.map(a => a.payment_methods)),
        business_hours: primary.business_hours || analyses.find(a => a.business_hours)?.business_hours || '',
        products: allProducts,
        restaurant_types: mergeUnique(analyses.map(a => a.restaurant_types)),
        detected_features: mergeUnique(analyses.map(a => a.detected_features)),
        menu_categories: mergeUnique(analyses.map(a => a.menu_categories)),
        category_followups: Object.assign({}, ...analyses.map(a => a.category_followups || {})),
        knowledge_blocks: allKnowledge
    }
}

/**
 * Targeted backfill: generate `category_followups` for an existing bot from
 * its already-saved products list, WITHOUT re-running the full catalog
 * analysis. Used by the regenerate-category-followups admin route so a bot
 * whose catalog was analyzed before this field existed can be upgraded
 * without re-uploading the original file.
 *
 * Cheap by design — uses a small targeted prompt and gpt-4o-mini; cost is
 * roughly 1/30th of analyzeCatalogFile.
 */
export async function regenerateCategoryFollowups(
    products: Array<{ name: string, category?: string }>,
    businessSummary: string = ''
): Promise<{ [category: string]: string[] }> {
    if (!Array.isArray(products) || products.length === 0) return {}

    // Group products by category so the LLM sees one cluster per category
    // and produces grounded followups (not generic templates).
    const byCategory = new Map<string, string[]>()
    for (const p of products) {
        const cat = (p.category || '').toString().trim() || 'Sin categoría'
        if (!byCategory.has(cat)) byCategory.set(cat, [])
        byCategory.get(cat)!.push(p.name)
    }
    const categoriesPayload = Array.from(byCategory.entries())
        .map(([cat, names]) => `- ${cat}: ${names.slice(0, 12).join(', ')}${names.length > 12 ? ` ... +${names.length - 12}` : ''}`)
        .join('\n')

    const prompt = `Eres un experto en ventas de WhatsApp. Para cada categoría de productos abajo, genera EXACTAMENTE 2 preguntas calificadoras cortas y específicas que un vendedor debería hacerle al cliente DESPUÉS de listarle productos de esa categoría, para acotar la elección y cerrar la venta.

REGLAS:
1. Las preguntas deben ser ESPECÍFICAS de la categoría, no genéricas. NUNCA uses "¿quieres ver otra categoría?" ni "¿algo más?".
2. Adapta las preguntas al estilo del negocio (${businessSummary || 'tienda peruana de e-commerce'}).
3. Pueden tocar: modelo/estilo específico, uso previsto, talla, color, ocasión, tipo de cliente, características técnicas relevantes, etc.
4. Tono coloquial peruano, breve, directo. Sin emojis innecesarios.

CATEGORÍAS Y SUS PRODUCTOS:
${categoriesPayload}

DEVUELVE SOLO un JSON válido con esta forma exacta (sin markdown, sin texto antes ni después):
{
  "Nombre de Categoría 1": ["pregunta calificadora 1", "pregunta calificadora 2"],
  "Nombre de Categoría 2": ["pregunta calificadora 1", "pregunta calificadora 2"]
}

Las claves deben ser EXACTAMENTE los nombres de categoría tal como aparecen arriba (mismo capitalización).`

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 2000,
            temperature: 0.4,
        })
        const raw = response.choices[0]?.message?.content || '{}'
        const parsed = JSON.parse(raw)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
        return Object.fromEntries(
            Object.entries(parsed)
                .filter(([, v]) => Array.isArray(v) && (v as any[]).every(x => typeof x === 'string' && x.trim().length > 0))
                .map(([k, v]) => [String(k), (v as string[]).slice(0, 3)])
        )
    } catch (err: any) {
        console.error('[CatalogAnalyzer] regenerateCategoryFollowups failed:', err.message)
        return {}
    }
}

function emptyAnalysis(): CatalogAnalysis {
    return {
        business_name: '', business_summary: '', business_category: 'nicho', business_location: '', target_customers: '', bot_personality: '',
        has_delivery: false, payment_methods: [], business_hours: '', products: [],
        restaurant_types: [], detected_features: [], menu_categories: [], category_followups: {}, knowledge_blocks: []
    }
}

function parseAnalysisResponse(text: string): CatalogAnalysis {
    let cleaned = text.trim()
    if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    }

    try {
        const parsed = JSON.parse(cleaned)
        return {
            business_name: parsed.business_name || '',
            business_summary: parsed.business_summary || '',
            business_category: parsed.business_category || 'nicho',
            business_location: parsed.business_location || '',
            target_customers: parsed.target_customers || '',
            bot_personality: parsed.bot_personality || '',
            has_delivery: !!parsed.has_delivery,
            payment_methods: Array.isArray(parsed.payment_methods) ? parsed.payment_methods : [],
            business_hours: parsed.business_hours || '',
            products: Array.isArray(parsed.products) ? parsed.products : [],
            restaurant_types: Array.isArray(parsed.restaurant_types) ? parsed.restaurant_types : [],
            detected_features: Array.isArray(parsed.detected_features) ? parsed.detected_features : [],
            menu_categories: Array.isArray(parsed.menu_categories) ? parsed.menu_categories : [],
            category_followups: (parsed.category_followups && typeof parsed.category_followups === 'object' && !Array.isArray(parsed.category_followups))
                ? Object.fromEntries(
                    Object.entries(parsed.category_followups)
                        .filter(([, v]) => Array.isArray(v) && (v as any[]).every(x => typeof x === 'string'))
                        .map(([k, v]) => [String(k), (v as string[]).slice(0, 4)])
                )
                : {},
            knowledge_blocks: Array.isArray(parsed.knowledge_blocks) ? parsed.knowledge_blocks : []
        }
    } catch (e) {
        console.error('[CatalogAnalyzer] Failed to parse JSON response:', e)
        console.error('[CatalogAnalyzer] Raw text was:', cleaned.substring(0, 500))
        return emptyAnalysis()
    }
}

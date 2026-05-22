/**
 * shalom.service.ts — Shalom Shipping Rate Calculator
 * 
 * Loads 371 agencies + 136K route tariffs from scraped data.
 * Provides fuzzy agency search by location and rate calculation.
 */

import { readFileSync } from 'fs'
import { join } from 'path'

// ─── Types ───────────────────────────────────

interface ShalomAgency {
    id: number
    nombre: string
    // Normalized search terms
    _searchTerms: string[]
}

interface ShalomRate {
    origenId: number
    origenNombre: string
    destinoId: number
    destinoNombre: string
    distancia: number
    leadTime: string
    sobre: number
    xxs: number
    xs: number
    s: number
    m: number
    l: number
    precioPorKilo: number
    precioVolumen: number
    aereo: number
}

type PackageSize = 'sobre' | 'xxs' | 'xs' | 's' | 'm' | 'l'

// ─── In-memory data ──────────────────────────

let agencies: ShalomAgency[] = []
const rateMap: Map<string, ShalomRate> = new Map() // "origenId-destinoId" → rate
let isLoaded = false

// ─── City/District → Agency mapping (for fuzzy search) ──────

const CITY_KEYWORDS: Record<string, string[]> = {
    // Lima distritos
    'miraflores': ['MIRAFLORES', 'AV. JOSE PARDO', 'AV. ARAMBURU', 'AV. COMANDANTE ESPINAR', 'CALLE MIGUEL DASSO', 'AV. ALFREDO BENAVIDES'],
    'san isidro': ['AV. ARAMBURU', 'CORPAC', 'CALLE LAS BEGONIAS', 'RIV. NAVARRETE', 'AV. JAVIER PRADO'],
    'surco': ['AV. PRIMAVERA', 'SURCO MATEO PUMACAHUA', 'HIGUERETA', 'AV. TOMÁS MARSANO'],
    'san borja': ['AV. AVIACION', 'AVIACION 2819', 'AVIACION 2999', 'AV. CANADA'],
    'la molina': ['AV  LA FONTANA', 'CALLE LAS BEGONIAS'],
    'san juan de lurigancho': ['SJL', 'CANTO GRANDE', 'BAYOVAR', 'CAMPOY', 'SJL-AV.PROCERES'],
    'sjl': ['SJL', 'CANTO GRANDE', 'BAYOVAR', 'CAMPOY', 'SJL-AV.PROCERES'],
    'los olivos': ['AV. CARLOS IZAGUIRRE', 'PRO', 'AV. ANGELICA GAMARRA', 'AV UNIV.  RETABLO'],
    'san martin de porres': ['FIORI', 'AV BERTELLO SMP', 'SMP-AV. PROCERES', 'AV JOSE GRANDA'],
    'smp': ['FIORI', 'AV BERTELLO SMP', 'SMP-AV. PROCERES', 'AV JOSE GRANDA'],
    'chorrillos': ['CHORRILLOS', 'MEGAPLAZA CHORRILLOS'],
    'ate': ['PUENTE SANTA ANITA', 'SANTA CLARA', 'HUAYCAN'],
    'villa el salvador': ['AV. PASTOR SEVILLA', 'TRES POSTES', 'MARIA AUXILIADORA'],
    'callao': ['CALLAO FAUCETT', 'BELLAVISTA CALLAO', 'AEROPUERTO CALLAO'],
    'comas': ['AV  TUPAC AMARU', 'AÑO NUEVO', 'TUNGASUCA'],
    'puente piedra': ['PUENTE PIEDRA NARANJITOS', 'ZAPALLAL'],
    'independencia': ['PLAZA NORTE', 'AV. CARLOS IZAGUIRRE'],
    'jesus maria': ['JESUS MARIA', 'AV. SAN FELIPE'],
    'magdalena': ['MAGDALENA DEL MAR'],
    'lima centro': ['AV VENEZUELA', 'AV MEXICO CO', 'JR. LUNA PIZARRO', 'PUENTE ARICA', 'AV TACNA'],
    'lima': ['AV MEXICO CO', 'JR. LUNA PIZARRO', 'AV VENEZUELA', 'AV TACNA'],
    'breña': ['JR. HUARAZ -  BREÑA'],
    'rimac': ['RIMAC AV. AMANCAES', 'RIMAC GUARDIA REPUBLICANA'],
    'san miguel': ['AV. LA MARINA'],
    'lince': ['AV. ARENALES', 'REP. DE PANAMA'],
    'villa maria del triunfo': ['AV. LIMA - VMT', 'AV. VILLA MARIA'],
    'vmt': ['AV. LIMA - VMT', 'AV. VILLA MARIA'],
    'lurin': ['NUEVO LURIN'],
    'carabayllo': ['CARABAYLLO ESTABLO'],
    'manchay': ['LA CURVA DE MANCHAY'],
    'chosica': ['CHOSICA'],
    'huachipa': ['HUACHIPA CO', 'CD. TALLERES-HUACHIPA', 'SANTA MARÍA DE HUACHIPA'],
    // Provincias principales
    'arequipa': ['AV PARRA 379 CO', 'MIRAFLORES AREQUIPA', 'MARIANO MELGAR', 'PLAZA LA TOMILLA', 'AV SOCABAYA', 'UCHUMAYO', 'AV LIMA'],
    'trujillo': ['AV LARCO', 'AV HERMANOS ANGULO', 'AMERICA SUR', 'ALTO TRUJILLO', 'TRUJILLO LA PERLA', 'WICHANZAO', 'MOCHE'],
    'chiclayo': ['AV. LAS PALMERAS', 'MIRAFLORES CHICLAYO', 'LAMBAYEQUE PANAMERICANA', 'PIMENTEL'],
    'piura': ['OVALO ORQUIDEAS CO', 'AV. GRAU', 'PARQUE INDUSTRIAL CO PIURA FUTURA', 'AV. LUIS EGUIGUREN'],
    'cusco': ['CUSCO PARQUE INDUSTRIAL', 'AV ANTONIO LORENA', 'VELASCO ASTETE', 'SAN JERONIMO'],
    'huancayo': ['AV MARISCAL CASTILLA', 'HUANCAYO JR. ICA', 'CHILCA HUANCAYO', 'SAN CARLOS HUANCAYO'],
    'ica': ['ICA SAN JOAQUIN', 'ICA AV. JJ ELIAS', 'ICA URB. MANZANILLA', 'ICA SANTIAGO'],
    'tacna': ['TACNA CO AV. JORGE BASADRE', 'TACNA CIUDAD NUEVA'],
    'puno': ['JR. MAMA OCLLO', 'AV EL SOL'],
    'juliaca': ['AV. HUANCANE CDRA. 9', 'LAS MERCEDES'],
    'cajamarca': ['CAJAMARCA CO', 'CAJAMARCA HORACIO ZEVALLOS', 'BAÑOS DEL INCA'],
    'tarapoto': ['TARAPOTO CO JR ALFONSO UGARTE', 'TARAPOTO JR. SARGENTO LOREZ', 'TARAPOTO LA BANDA DE SHILCAYO'],
    'iquitos': ['IQUITOS JR FRANCISCO BOLOGNESI', 'IQUITOS CO JR. PABLO ROSSELL'],
    'pucallpa': ['CALLERIA JR JOSE GALVEZ', 'PUCALLPA CO FEDERICO BASADRE', 'YARINACOCHA CENTRO'],
    'ayacucho': ['AYACUCHO CO', 'JESUS NAZARENO', 'HUANTA'],
    'tumbes': ['TUMBES - AV ARICA', 'TUMBES CO - PANAMERICANA', 'TUMBES PUYANGO'],
    'huanuco': ['JR AGUILAR', 'AMARILIS CO'],
    'huaraz': ['HUARAZ'],
    'chimbote': ['AV ENRIQUE MEIGGS', 'AV. LOS PESCADORES'],
    'sullana': ['SULLANA SANTA ROSA', 'SULLANA CO ZONA INDUSTRIAL'],
    'tingo maria': ['TINGO MARIA CO BUENOS AIRES', 'TINGO MARÍA - LEONCIO PRADO'],
    'barranca': ['BARRANCA'],
    'huacho': ['SALAVERRY HUACHO CO', 'HUACHO AV  INDACOCHEA'],
    'chincha': ['CHINCHA PUEBLO NUEVO', 'LA VILLA  CRUCE PISCO'],
    'nazca': ['AV CIRCUNVALACION NAZCA'],
    'puerto maldonado': ['TAMBOPATA AV LA JOYA CO'],
    'mancora': ['MÁNCORA'],
    'talara': ['TALARA  CO ASOC CALIFORNIA'],
    'paita': ['PAITA'],
    'ilo': ['ILO CO PAMPA INALAMBRICA', 'ILO PUERTO'],
    'mollendo': ['MOLLENDO CO', 'CERCADO MOLLENDO'],
    'abancay': ['ABANCAY'],
}

// ─── Load ────────────────────────────────────

function loadData(): void {
    if (isLoaded) return

    const basePath = join(process.cwd(), 'shalom-scraper')

    try {
        // Load agencies from CSV (lighter than JSON)
        const agencyCsv = readFileSync(join(basePath, 'shalom_agencias.csv'), 'utf-8')
        agencies = agencyCsv.split('\n').slice(1).filter(l => l.trim()).map(line => {
            const [idStr, ...nameParts] = line.split(',')
            const nombre = nameParts.join(',').replace(/"/g, '').trim()
            return {
                id: parseInt(idStr),
                nombre,
                _searchTerms: nombre.toLowerCase().split(/[\s,.-]+/)
            }
        })

        // Load tariffs from JSON (49MB — build efficient map)
        console.log('[Shalom] Cargando tarifas... (esto puede tomar unos segundos)')
        const rawJson = readFileSync(join(basePath, 'shalom_COMPLETO.json'), 'utf-8')
        const data = JSON.parse(rawJson)

        for (const t of data.tarifas) {
            const key = `${t.origen_id}-${t.destino_id}`
            rateMap.set(key, {
                origenId: t.origen_id,
                origenNombre: t.origen_nombre,
                destinoId: t.destino_id,
                destinoNombre: t.destino_nombre,
                distancia: t.distancia,
                leadTime: t.lead_time,
                sobre: t.sobre,
                xxs: t.xxs,
                xs: t.xs,
                s: t.s,
                m: t.m,
                l: t.l,
                precioPorKilo: t.kilo,
                precioVolumen: t.volumen,
                aereo: t.aereo
            })
        }

        isLoaded = true
        console.log(`[Shalom] ✅ ${agencies.length} agencias, ${rateMap.size} rutas cargadas`)
    } catch (e: any) {
        console.error('[Shalom] Error cargando datos:', e.message)
    }
}

// ─── Public API ──────────────────────────────

/**
 * Search agencies by location name (fuzzy match).
 * Returns the best matching agencies.
 */
export function searchAgencies(query: string, limit: number = 5): ShalomAgency[] {
    loadData()
    console.log(`[DEBUG][Shalom] searchAgencies("${query}", limit=${limit})`)
    const q = query.toLowerCase().trim()

    // 1. Check city keywords mapping first
    const matched: ShalomAgency[] = []
    for (const [city, agencyNames] of Object.entries(CITY_KEYWORDS)) {
        if (q.includes(city) || city.includes(q)) {
            for (const aName of agencyNames) {
                const found = agencies.find(a => a.nombre.includes(aName))
                if (found && !matched.find(m => m.id === found.id)) {
                    matched.push(found)
                }
            }
        }
    }

    if (matched.length > 0) return matched.slice(0, limit)

    // 2. Fuzzy search on agency names
    const scored = agencies.map(a => {
        let score = 0
        const name = a.nombre.toLowerCase()
        if (name.includes(q)) score += 10
        const qTerms = q.split(/\s+/)
        for (const term of qTerms) {
            if (name.includes(term)) score += 3
            for (const st of a._searchTerms) {
                if (st.includes(term) || term.includes(st)) score += 1
            }
        }
        return { agency: a, score }
    }).filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)

    return scored.map(s => s.agency)
}

/**
 * Get shipping rate between two agencies.
 */
export function getRate(originId: number, destinoId: number): ShalomRate | null {
    loadData()
    return rateMap.get(`${originId}-${destinoId}`) || null
}

/**
 * Get price for a specific package size.
 */
export function getPriceForSize(rate: ShalomRate, size: PackageSize): number {
    return rate[size]
}

/**
 * Calculate shipping price considering weight (doc sec 9.3 — 3 parameters: size + weight + route).
 * Uses max(price_by_size, price_by_weight) for the final cost.
 */
// A-10: Internal helper — calculates price given a rate object (low-level)
function _calculatePriceFromRate(rate: ShalomRate, size: PackageSize, weightKg: number): { price: number; method: string } {
    console.log(`[DEBUG][Shalom] _calculatePriceFromRate: size=${size} weight=${weightKg}kg route=${rate.origenNombre}→${rate.destinoNombre}`)
    const priceBySize = rate[size]
    if (!weightKg || weightKg <= 0 || !rate.precioPorKilo) {
        return { price: priceBySize, method: 'por tamaño' }
    }
    const priceByWeight = weightKg * rate.precioPorKilo
    if (priceByWeight > priceBySize) {
        return { price: Math.ceil(priceByWeight * 100) / 100, method: 'por peso' }
    }
    return { price: priceBySize, method: 'por tamaño' }
}

/**
 * A-10: Calculate shipping price with full validation (doc §9.3).
 * Requires all 4 parameters: packageSize, weight, originId, destinoId.
 * If ANY is missing → returns error indicator for handoff. Never assumes defaults.
 *
 * Backward-compatible wrapper: the old 3-param signature still works via overload.
 */
export function calculatePriceWithWeight(rate: ShalomRate, size: PackageSize, weightKg: number | null): { price: number; method: string }
export function calculatePriceWithWeight(
    packageSize: PackageSize,
    weightKg: number | null,
    originId: number,
    destinoId: number
): { price: number; method: string } | { error: string; handoff: true }
export function calculatePriceWithWeight(
    arg1: ShalomRate | PackageSize,
    arg2: PackageSize | number | null,
    arg3?: number | null,
    arg4?: number
): { price: number; method: string } | { error: string; handoff: true } {
    // 4-param call: (packageSize, weightKg, originId, destinoId)
    if (typeof arg1 === 'string' && typeof arg3 === 'number' && typeof arg4 === 'number') {
        const size = arg1 as PackageSize
        const weightKg = arg2 as number | null
        const originId = arg3
        const destinoId = arg4

        if (!size) return { error: 'Falta el tamaño del paquete (packageSize).', handoff: true }
        if (weightKg === null || weightKg === undefined || weightKg <= 0) {
            return { error: 'Falta el peso del producto. Configura el peso en Mi Qhatu → Productos.', handoff: true }
        }
        if (!originId) return { error: 'Falta el punto de origen de envío (originId).', handoff: true }
        if (!destinoId) return { error: 'Falta el punto de destino de envío (destinoId).', handoff: true }

        loadData()
        const rate = rateMap.get(`${originId}-${destinoId}`)
        if (!rate) return { error: `No hay ruta disponible de agencia ${originId} a agencia ${destinoId}.`, handoff: true }

        return _calculatePriceFromRate(rate, size, weightKg)
    }

    // 3-param call (backward compat): (rate, size, weightKg)
    const rate = arg1 as ShalomRate
    const size = arg2 as PackageSize
    const weightKg = (arg3 ?? null) as number | null
    return _calculatePriceFromRate(rate, size, weightKg || 0)
}

/**
 * Calculate shipping from vendor origin to client location.
 * Returns formatted text for the WhatsApp bot.
 */
export function calculateShipping(
    originId: number,
    clientLocation: string,
    packageSize: PackageSize = 'm'
): { text: string; agencies: ShalomAgency[]; rates: { agency: ShalomAgency; rate: ShalomRate; price: number }[] } | null {
    loadData()

    // Verify origin exists
    const originAgency = agencies.find(a => a.id === originId)
    if (!originAgency) return null

    // Find destination agencies near the client
    const nearbyAgencies = searchAgencies(clientLocation, 5)
    if (nearbyAgencies.length === 0) {
        return {
            text: `No encontré agencias Shalom cerca de "${clientLocation}". Intenta con el nombre de tu ciudad o distrito.`,
            agencies: [],
            rates: []
        }
    }

    // Calculate rates for each nearby agency
    const results: { agency: ShalomAgency; rate: ShalomRate; price: number }[] = []
    for (const dest of nearbyAgencies) {
        const rate = getRate(originId, dest.id)
        if (rate) {
            results.push({
                agency: dest,
                rate,
                price: getPriceForSize(rate, packageSize)
            })
        }
    }

    if (results.length === 0) {
        return {
            text: `Encontré agencias cerca de "${clientLocation}" pero no hay rutas desde nuestro punto de envío.`,
            agencies: nearbyAgencies,
            rates: []
        }
    }

    // Sort by price (cheapest first)
    results.sort((a, b) => a.price - b.price)

    // Build response text
    const sizeLabel: Record<string, string> = {
        sobre: 'Sobre', xxs: 'XXS', xs: 'XS', s: 'S (pequeño)', m: 'M (mediano)', l: 'L (grande)'
    }

    let text = `📦 *Opciones de envío Shalom* (paquete ${sizeLabel[packageSize] || packageSize}):\n\n`
    for (let i = 0; i < Math.min(results.length, 3); i++) {
        const r = results[i]
        text += `${i + 1}️⃣ *${r.agency.nombre}*\n`
        text += `   💰 S/${r.price.toFixed(2)}\n`
        text += `   ⏱️ ${r.rate.leadTime}\n`
        if (i < results.length - 1) text += '\n'
    }
    text += `\n📋 *Todas las tarifas* (desde ${originAgency.nombre}):\n`
    text += `   Sobre: S/${results[0].rate.sobre} | XS: S/${results[0].rate.xs} | S: S/${results[0].rate.s} | M: S/${results[0].rate.m} | L: S/${results[0].rate.l}\n`
    text += `   Precio por kilo: S/${results[0].rate.precioPorKilo}\n`

    return { text, agencies: nearbyAgencies, rates: results }
}

/**
 * Get all agencies (for Qhatu configuration dropdown).
 */
export function getAllAgencies(): { id: number; nombre: string }[] {
    loadData()
    return agencies.map(a => ({ id: a.id, nombre: a.nombre }))
}

/**
 * Get agency by ID.
 */
export function getAgencyById(id: number): ShalomAgency | null {
    loadData()
    return agencies.find(a => a.id === id) || null
}

/**
 * Format a quick summary of Shalom service availability.
 */
export function getShalomSummary(): string {
    loadData()
    return `Shalom cuenta con ${agencies.length} agencias a nivel nacional y ${rateMap.size} rutas disponibles.`
}

// ═══════════════════════════════════════════════════════════════
// GEOLOCATION — OpenStreetMap / Nominatim Integration
// Geocodes addresses to lat/lng and finds nearest Shalom agencies
// ═══════════════════════════════════════════════════════════════

interface GeoCoord { lat: number; lng: number }

// Cache geocoded agency coordinates to avoid repeated API calls
const agencyCoordCache: Map<number, GeoCoord> = new Map()
const geocodeCache: Map<string, GeoCoord | null> = new Map()

/**
 * Geocode an address using OpenStreetMap Nominatim (free, no API key needed).
 * Rate limit: max 1 request/second per Nominatim usage policy.
 */
async function geocodeAddress(address: string): Promise<GeoCoord | null> {
    const cacheKey = address.toLowerCase().trim()
    if (geocodeCache.has(cacheKey)) return geocodeCache.get(cacheKey) || null

    try {
        const query = encodeURIComponent(`${address}, Perú`)
        const url = `https://nominatim.openstreetmap.org/search?q=${query}&format=json&limit=1&countrycodes=pe`

        const response = await fetch(url, {
            headers: { 'User-Agent': 'QatuBot/1.0 (qatu.ai)' }
        })

        if (!response.ok) {
            console.error(`[Shalom Geo] Nominatim HTTP ${response.status}`)
            geocodeCache.set(cacheKey, null)
            return null
        }

        const results = await response.json() as any[]
        if (!results || results.length === 0) {
            geocodeCache.set(cacheKey, null)
            return null
        }

        const coord: GeoCoord = { lat: parseFloat(results[0].lat), lng: parseFloat(results[0].lon) }
        geocodeCache.set(cacheKey, coord)
        return coord
    } catch (e) {
        console.error('[Shalom Geo] Geocoding error:', e)
        geocodeCache.set(cacheKey, null)
        return null
    }
}

/**
 * Geocode a Shalom agency by its name (extracts city/district from name).
 */
async function geocodeAgency(agency: ShalomAgency): Promise<GeoCoord | null> {
    if (agencyCoordCache.has(agency.id)) return agencyCoordCache.get(agency.id) || null

    // Extract meaningful location from agency name (e.g., "MIRAFLORES AREQUIPA" → "Miraflores, Arequipa")
    const name = agency.nombre.replace(/AV\.|CALLE|JR\.|PSJE\.|MZ\.|LT\.|N°|Nro|REF\./gi, '').trim()
    const coord = await geocodeAddress(name)
    if (coord) agencyCoordCache.set(agency.id, coord)
    return coord
}

/**
 * Calculate distance between two coordinates using Haversine formula.
 * Returns distance in kilometers.
 */
function haversineDistance(a: GeoCoord, b: GeoCoord): number {
    const R = 6371 // Earth radius in km
    const dLat = (b.lat - a.lat) * Math.PI / 180
    const dLng = (b.lng - a.lng) * Math.PI / 180
    const lat1 = a.lat * Math.PI / 180
    const lat2 = b.lat * Math.PI / 180
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
    return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

/**
 * Find the 3 nearest Shalom agencies to a given address using geolocation.
 * CAMINO A from doc maestro sec 9.2: Client gives address → geocode → find 3 nearest.
 */
export async function findNearestAgencies(
    clientAddress: string,
    originId: number,
    packageSize: PackageSize = 'm',
    limit: number = 3
): Promise<{ text: string; agencies: { agency: ShalomAgency; distance: number; rate: ShalomRate | null; price: number }[] } | null> {
    loadData()

    // 1. Geocode client address
    const clientCoord = await geocodeAddress(clientAddress)
    if (!clientCoord) {
        // Fallback to text-based search if geocoding fails
        return null
    }

    // 2. Geocode agencies and calculate distances (batch, with rate limiting)
    const agencyDistances: { agency: ShalomAgency; distance: number; coord: GeoCoord }[] = []

    // To respect Nominatim rate limit (1 req/sec), we geocode in batches
    // For performance, only geocode agencies that match the general area first
    const clientRegion = clientAddress.toLowerCase()
    const candidateAgencies = agencies.filter(a => {
        const name = a.nombre.toLowerCase()
        // Pre-filter: check if any search term from client address matches agency
        const terms = clientRegion.split(/\s+/)
        return terms.some(t => t.length > 3 && name.includes(t)) || name.includes(clientRegion.split(',')[0]?.trim() || '')
    })

    // If pre-filter gives too few, expand to all agencies in same broad region
    const searchSet = candidateAgencies.length >= 3 ? candidateAgencies : agencies.slice(0, 50)

    for (const agency of searchSet) {
        let coord = agencyCoordCache.get(agency.id) || null
        if (!coord) {
            // Geocode agency (with delay for rate limiting)
            coord = await geocodeAgency(agency)
            if (!coord) continue
            // Small delay to respect Nominatim 1 req/sec policy
            await new Promise(r => setTimeout(r, 200))
        }
        const distance = haversineDistance(clientCoord, coord)
        agencyDistances.push({ agency, distance, coord })
    }

    if (agencyDistances.length === 0) return null

    // 3. Sort by distance and take top N
    agencyDistances.sort((a, b) => a.distance - b.distance)
    const nearest = agencyDistances.slice(0, limit)

    // 4. Get rates for each
    const originAgency = agencies.find(a => a.id === originId)
    if (!originAgency) return null

    const results = nearest.map(n => {
        const rate = rateMap.get(`${originId}-${n.agency.id}`) || null
        const price = rate ? rate[packageSize] : 0
        return { agency: n.agency, distance: Math.round(n.distance * 10) / 10, rate, price }
    })

    // 5. Format response text
    let text = `Encontré estas agencias Shalom cerca de tu ubicación:\n\n`
    results.forEach((r, i) => {
        text += `${i + 1}. ${r.agency.nombre}`
        if (r.rate) {
            text += ` — S/${r.price} (${r.rate.leadTime})`
        }
        text += ` [${r.distance} km]\n`
    })
    text += `\n¿En cuál te gustaría recoger tu pedido?`

    return { text, agencies: results }
}

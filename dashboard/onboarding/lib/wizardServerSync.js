// ════════════════════════════════════════════════════════════════════════
// wizardServerSync — persiste en el servidor lo capturado en el onboarding
// Willy (localStorage) para que workflow, mindmap y el bot lean la misma
// fuente que "Configura tu Qhatu" (business_info + operacion.shippingConfig).
// ════════════════════════════════════════════════════════════════════════

import { state, activeWizardBotId } from '../store.js';

const METHOD_LABEL = {
    yape: 'Yape',
    plin: 'Plin',
    transferencia: 'Transferencia bancaria',
    tarjeta: 'Tarjeta / link de pago',
    efectivo: 'Efectivo',
};

function authHeaders(token) {
    return {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
    };
}

/** Nombre visible de región (wizard) → código slug de KIPU / Supabase. */
export function peruRegionNameToDepartmentCode(name) {
    const n = String(name || '').trim();
    if (!n) return '';
    const deps = typeof window !== 'undefined' ? window.KIPU_PERU_DEPARTMENTS : null;
    if (Array.isArray(deps)) {
        const byName = deps.find((d) => d.name === n);
        if (byName) return byName.code;
        const byCode = deps.find((d) => d.code === n);
        if (byCode) return byCode.code;
    }
    return '';
}

function mapPagoEnvioToPaymentTiming(pagoEnvio) {
    if (pagoEnvio === 'total') return 'upfront';
    if (pagoEnvio === 'parcial') return 'partial';
    if (pagoEnvio === 'contraentrega') return 'on_delivery';
    return 'upfront';
}

function mapModalidadToCostStrategy(mod) {
    if (mod === 'gratis') return 'free';
    if (mod === 'gratis_desde') return 'free_above_threshold';
    if (mod === 'tarifa_fija') return 'fixed';
    if (mod === 'tarifa_variable') return 'variable';
    return 'fixed';
}

function serializeWizardShippingGroup(grupo) {
    const departments = (grupo.regiones || [])
        .map(peruRegionNameToDepartmentCode)
        .filter(Boolean);
    const modalidad = grupo.modalidadCosto || '';
    const cost_strategy = mapModalidadToCostStrategy(modalidad);
    const payment_timing = modalidad === 'gratis'
        ? 'on_delivery'
        : mapPagoEnvioToPaymentTiming(grupo.pagoEnvio);

    const fixed_cost = modalidad === 'tarifa_fija' ? Number(grupo.costoFijo) || 0 : 0;
    const free_threshold = modalidad === 'gratis_desde' ? Number(grupo.montoMinimo) || 0 : 0;
    const belowMin = Number(grupo.costoBajoMinimo) || 0;
    const below_threshold_rule = modalidad === 'gratis_desde' && free_threshold > 0
        ? `Si el pedido es menor a S/ ${free_threshold}, el envío cuesta S/ ${belowMin}.`
        : '';

    const variable_agencies_text = modalidad === 'tarifa_variable'
        ? (String(grupo.agencias || '').trim() || 'Cotización manual (Willy)')
        : String(grupo.agencias || '').trim();

    return {
        id: grupo.id || `g-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        departments,
        cost_strategy,
        fixed_cost,
        free_threshold,
        below_threshold_rule,
        variable_agencies_text,
        payment_timing,
        payment_partial_note: grupo.pagoEnvio === 'parcial' ? String(grupo.montoAdelanto || '').trim() : '',
        delivery_eta: String(grupo.tiempoEntrega || '').trim(),
        extra_specs: String(grupo.notas || '').trim(),
    };
}

function buildStorePickupLocationsFromWizard(locales) {
    const arr = Array.isArray(locales) ? locales : [];
    return arr
        .filter((l) => l && l.saved && String(l.direccion || '').trim().length >= 10)
        .map((l, i) => ({
            id: l.id || `loc-${i}`,
            name: String(l.nombre || '').trim() || `Sucursal ${i + 1}`,
            address: String(l.direccion || '').trim(),
            hours: String(l.horario || '').trim() || 'Consultar horario',
            maya_note: String(l.respuestaQhatu || '').trim(),
            region: peruRegionNameToDepartmentCode(l.region) || String(l.region || '').trim(),
        }));
}

/**
 * Arma el body de POST /api/shipping/config/:botId en paridad con
 * saveShippingModeOverlay (app.js).
 */
function buildShippingConfigPayloadFromWizard(current) {
    const e = state.envios || { tipo: null, locales: [], grupos: [] };
    const tipo = e.tipo;
    const cur = current && typeof current === 'object' ? current : {};

    if (!tipo || tipo === 'ninguno') {
        return {
            ...cur,
            groups: [],
            store_pickup_enabled: false,
            store_pickup_locations: [],
            store_pickup_address: '',
            store_pickup_hours: '',
            cost_strategy: null,
            free_threshold: null,
            below_threshold_rule: '',
            fixed_zones_text: '',
            variable_agencies_text: '',
            payment_timing: '',
            payment_partial_note: '',
            delivery_eta: '',
            extra_specs: '',
            shipping_cost_mode: 'fixed',
            shipping_fixed_cost: null,
        };
    }

    const needsPickup = tipo === 'recojo' || tipo === 'ambos';
    const needsGroups = tipo === 'domicilio' || tipo === 'ambos';
    const storePickupLocations = needsPickup ? buildStorePickupLocationsFromWizard(e.locales) : [];

    const savedGrupos = (e.grupos || []).filter((g) => g && g.saved && isGroupShippable(g));
    const serializedGroups = needsGroups
        ? savedGrupos.map(serializeWizardShippingGroup).filter((g) => g.departments.length > 0)
        : [];

    const storePickupEnabled = storePickupLocations.length > 0;
    const storePickupAddress = storePickupLocations[0]?.address || '';
    const storePickupHours = storePickupLocations[0]?.hours || '';

    const g0 = serializedGroups[0] || null;
    const anyVariable = serializedGroups.some((g) => g.cost_strategy === 'variable');
    const legacyCostMode = anyVariable ? 'variable' : (g0?.cost_strategy === 'variable' ? 'variable' : 'fixed');

    const fallbackG0 = {
        cost_strategy: storePickupEnabled && serializedGroups.length === 0 ? 'free' : 'free',
        departments: [],
        payment_timing: 'on_delivery',
        variable_agencies_text: '',
        below_threshold_rule: '',
        fixed_cost: 0,
        free_threshold: 0,
        payment_partial_note: '',
        delivery_eta: storePickupHours || 'Consultar',
        extra_specs: '',
    };

    const head = g0 || fallbackG0;

    return {
        ...cur,
        groups: serializedGroups,
        cost_strategy: head.cost_strategy,
        free_threshold: head.cost_strategy === 'free_above_threshold' ? head.free_threshold : null,
        below_threshold_rule: head.below_threshold_rule || '',
        fixed_zones_text: '',
        variable_agencies_text: head.variable_agencies_text || '',
        payment_timing: head.payment_timing,
        payment_partial_note: head.payment_partial_note || '',
        delivery_eta: head.delivery_eta || '',
        extra_specs: head.extra_specs || '',
        store_pickup_enabled: storePickupEnabled,
        store_pickup_locations: storePickupLocations,
        store_pickup_address: storePickupAddress,
        store_pickup_hours: storePickupHours,
        shipping_cost_mode: legacyCostMode,
        shipping_fixed_cost: head.cost_strategy === 'fixed' ? head.fixed_cost : null,
    };
}

function isGroupShippable(g) {
    if ((g.regiones || []).length === 0) return false;
    if (!g.modalidadCosto) return false;
    if (g.modalidadCosto !== 'gratis' && !g.pagoEnvio) return false;
    if (String(g.tiempoEntrega || '').trim().length < 3) return false;
    return true;
}

function buildPaymentInstructions(tipo, datos) {
    const d = datos || {};
    switch (tipo) {
        case 'yape':
        case 'plin': {
            const nom = String(d.nombre || '').trim();
            const cel = String(d.celular || '').trim();
            const bits = [];
            if (nom) bits.push(`Titular: ${nom}`);
            if (cel) bits.push(`Celular: ${cel}`);
            return bits.join(' · ') || 'Completa los datos en Configura tu Qhatu → Pagos.';
        }
        case 'transferencia': {
            const banco = String(d.banco || '').trim();
            const tit = String(d.titular || '').trim();
            const num = String(d.numero || '').trim();
            const cci = String(d.cci || '').trim();
            const bits = [];
            if (banco) bits.push(banco);
            if (tit) bits.push(`Titular: ${tit}`);
            if (num) bits.push(`Cuenta: ${num}`);
            if (cci) bits.push(`CCI: ${cci}`);
            return bits.join(' · ') || 'Transferencia (completa datos en el panel).';
        }
        case 'tarjeta': {
            const como = String(d.como || '').trim();
            const link = String(d.linkBase || '').trim();
            const otro = String(d.descripcionOtro || '').trim();
            const bits = [];
            if (como) bits.push(como);
            if (link) bits.push(`Link: ${link}`);
            if (otro) bits.push(otro);
            return bits.join(' · ') || 'Pago con tarjeta / link.';
        }
        case 'efectivo': {
            const mom = Array.isArray(d.momentos) ? d.momentos.filter(Boolean) : [];
            return mom.length ? `Momentos: ${mom.join(', ')}` : 'Efectivo al entregar.';
        }
        default:
            return '';
    }
}

function wizardMetodosToApiPayload() {
    const pagos = state.pagos || { metodos: [] };
    const rows = Array.isArray(pagos.metodos) ? pagos.metodos : [];
    const out = [];
    for (const m of rows) {
        if (!m || !m.tipo) continue;
        const nombre = METHOD_LABEL[m.tipo] || String(m.tipo);
        let instrucciones = buildPaymentInstructions(m.tipo, m.datos);
        if (!String(instrucciones || '').trim()) {
            instrucciones = 'Registrado en el onboarding Willy. Completa o verifica en Configura tu Qhatu → Pagos.';
        }
        out.push({
            nombre,
            tipo: m.tipo,
            instrucciones,
            activo: true,
            partial_payments: {
                enabled: false,
                distribucion: { tipo: 'porcentual', adelanto_pct: 50, adelanto_monto: 0 },
                clausulas: [],
            },
        });
    }
    return out;
}

export async function syncWizardProductsToBusiness(botId, token) {
    if (!token || !botId || typeof fetch !== 'function') return;

    const arr = Array.isArray(state.productos) ? state.productos : [];
    const mapped = [];
    for (const p of arr) {
        const name = String(p.nombre || '').trim();
        if (!name) continue;
        const raw = String(p.precio ?? '').trim().replace(',', '.').replace(/[^\d.]/g, '');
        const num = parseFloat(raw);
        const price = Number.isFinite(num) ? num : 0;
        const desc = String(p.descripcion || '').trim();
        const cat = String(p.categoria || '').trim();
        const id = p.id ? String(p.id) : `prod_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        // Foto del producto (opcional). Se subió vía POST /business/:botId/product-photo
        // y la URL pública quedó persistida en p.imageUrl del state local.
        const imageUrl = String(p.imageUrl || '').trim();
        mapped.push({
            id,
            name,
            nombre: name,
            description: desc,
            descripcion: desc,
            price,
            precio: price,
            stock: 0,
            status: 'ok',
            imageUrl,
            ...(cat ? { categoria: cat } : {}),
        });
    }

    try {
        const getRes = await fetch(`/api/business/${encodeURIComponent(botId)}`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!getRes.ok) {
            console.warn('[wizardServerSync] GET /business failed', getRes.status);
            return;
        }
        const biz = await getRes.json();
        const putRes = await fetch(`/api/business/${encodeURIComponent(botId)}`, {
            method: 'PUT',
            headers: authHeaders(token),
            body: JSON.stringify({ ...biz, products: mapped }),
        });
        if (!putRes.ok) {
            const err = await putRes.json().catch(() => ({}));
            console.warn('[wizardServerSync] PUT /business products', putRes.status, err);
        }
    } catch (e) {
        console.warn('[wizardServerSync] syncWizardProductsToBusiness', e);
    }
}

export async function syncWizardShippingToServer(botId, token) {
    if (!token || !botId || typeof fetch !== 'function') return;

    try {
        let current = {};
        const getRes = await fetch(`/api/shipping/config/${encodeURIComponent(botId)}`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (getRes.ok) current = await getRes.json();
        const payload = buildShippingConfigPayloadFromWizard(current);
        const postRes = await fetch(`/api/shipping/config/${encodeURIComponent(botId)}`, {
            method: 'POST',
            headers: authHeaders(token),
            body: JSON.stringify(payload),
        });
        if (!postRes.ok) {
            const err = await postRes.json().catch(() => ({}));
            console.warn('[wizardServerSync] POST /shipping/config', postRes.status, err);
        }
    } catch (e) {
        console.warn('[wizardServerSync] syncWizardShippingToServer', e);
    }
}

export async function syncWizardPaymentsToServer(botId, token) {
    if (!token || !botId || typeof fetch !== 'function') return;

    const methods = wizardMetodosToApiPayload();
    if (methods.length === 0) {
        console.warn('[wizardServerSync] Sin métodos de pago válidos para sync (instrucciones vacías).');
        return;
    }

    try {
        const putRes = await fetch(`/api/business/${encodeURIComponent(botId)}/payment-methods`, {
            method: 'PUT',
            headers: authHeaders(token),
            body: JSON.stringify({ methods }),
        });
        if (!putRes.ok) {
            const err = await putRes.json().catch(() => ({}));
            console.warn('[wizardServerSync] PUT /payment-methods', putRes.status, err);
        }
    } catch (e) {
        console.warn('[wizardServerSync] syncWizardPaymentsToServer', e);
    }
}

// Valores válidos según getInteractionMode() en bot-manager.ts. Si el
// state local viene con un valor desconocido (ej. corrupción de localStorage
// o legacy 'hibrido'), lo normalizamos antes de mandar al servidor — el
// backend también tolera valores raros mapeándolos a 'botones', pero
// preferimos blindar la API.
const VALID_INTERACTION_MODES = new Set(['botones', 'conversacional']);

// Mapa tono UI → metadata.tone del bot. El backend acepta cualquier string
// pero el panel canónico usa estos 3 (ver routes.ts /qhatu-update). El
// onboarding viejo guardaba 'cercano' / 'chevere'; los mapeamos a 'casual'
// para preservar la intención del usuario.
const TONO_TO_METADATA_TONE = {
    profesional: 'profesional',
    formal: 'formal',
    casual: 'casual',
    cercano: 'casual',
    chevere: 'casual',
};

/**
 * Persiste la elección de "Formato de respuesta" del paso 5 del wizard
 * (botones vs conversacional) a `bot_configs.operacion.interactionMode` —
 * que es la fuente que lee bot-manager para (a) construir el system prompt
 * y (b) decidir si enviar mensajes con botones interactivos en WhatsApp.
 *
 * Sin esta sincronización, el usuario puede elegir "Solo conversacional"
 * en el onboarding pero el bot siguió respondiendo con menús numerados
 * (default 'botones') porque la elección se quedaba sólo en localStorage.
 *
 * El endpoint PUT /api/bots/:id ya invalida internamente el cache del
 * system-prompt y el cache de interactionMode al detectar `payload.operacion`,
 * así que el siguiente mensaje del cliente usa el modo nuevo sin esperar TTL.
 *
 * También sincroniza el tono a `metadata.tone` para mantener paridad con
 * el modal de configuración "Maya Update" que vive en routes.ts:1166.
 */
export async function syncWizardInteractionModeToServer(botId, token) {
    if (!token || !botId || typeof fetch !== 'function') return;

    const rawMode = String(state.modoInteraccion || '').toLowerCase();
    const interactionMode = VALID_INTERACTION_MODES.has(rawMode) ? rawMode : 'botones';

    const rawTono = String(state.tono || '').toLowerCase();
    const tone = TONO_TO_METADATA_TONE[rawTono] || 'casual';

    try {
        const putRes = await fetch(`/api/bots/${encodeURIComponent(botId)}`, {
            method: 'PUT',
            headers: authHeaders(token),
            body: JSON.stringify({
                operacion: { interactionMode },
                metadata: { tone },
            }),
        });
        if (!putRes.ok) {
            const err = await putRes.json().catch(() => ({}));
            console.warn('[wizardServerSync] PUT /bots interactionMode', putRes.status, err);
        }
    } catch (e) {
        console.warn('[wizardServerSync] syncWizardInteractionModeToServer', e);
    }
}

/**
 * Productos + envíos + pagos + modo de interacción del state Willy → APIs
 * canónicas del panel. Llamar antes de POST /workflow/.../regenerate en
 * "Activar a Willy".
 */
export async function syncWillyWizardConfigToServer(botId) {
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null;
    if (!token || !botId) return;
    await syncWizardProductsToBusiness(botId, token);
    await syncWizardShippingToServer(botId, token);
    await syncWizardPaymentsToServer(botId, token);
    await syncWizardInteractionModeToServer(botId, token);
}

let _willyIdentDebounce = null;

/**
 * Persiste nombre + descripción del paso 1 Willy al servidor y refresca el
 * workflow abierto (placeholder {nombre_negocio}) sin esperar a Activar.
 */
export function schedulePushWillyIdentidadToServer() {
    clearTimeout(_willyIdentDebounce);
    _willyIdentDebounce = setTimeout(() => {
        void pushWillyIdentidadToServerNow();
    }, 450);
}

async function pushWillyIdentidadToServerNow() {
    const botId = activeWizardBotId
        || (typeof window !== 'undefined' && window.__configSelectedBotId);
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null;
    if (!token || !botId || typeof fetch !== 'function') return;

    const nombre = String(state.identidad?.nombre || '').trim();
    const descripcion = String(state.identidad?.descripcion || '').trim();
    if (nombre.length < 2) return;

    const rubro = descripcion.length >= 10 ? descripcion.slice(0, 120) : '';

    try {
        const res = await fetch(`/api/business/${encodeURIComponent(String(botId))}/identity`, {
            method: 'PUT',
            headers: authHeaders(token),
            body: JSON.stringify({ botName: nombre, rubro, descripcion }),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            console.warn('[wizardServerSync] PUT identity', res.status, err);
            return;
        }
        if (typeof window.invalidateBotsCache === 'function') window.invalidateBotsCache();
        if (typeof window.kipuRefreshMindmapLive === 'function') {
            await window.kipuRefreshMindmapLive(String(botId));
        }
    } catch (e) {
        console.warn('[wizardServerSync] pushWillyIdentidad', e);
    }
}

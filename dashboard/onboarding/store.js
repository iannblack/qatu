// ════════════════════════════════════════════════════════════════════════
// Qhatu wizard — store por tienda (botId)
// Persistencia: localStorage `qhatu_onboarding_state::<botId>` por tienda.
// Clave legacy `qhatu_onboarding_state` (global) solo se lee con reglas
// estrictas para no heredar «completed» a una tienda nueva.
// API: state mutable + save() + load() + subscribe(fn) + update(patch)
// El "save" es debounced 200ms para no spamear localStorage en cada keypress.
// ════════════════════════════════════════════════════════════════════════

/** @deprecated Migración — no escribir aquí salvo compat; preferir clave por bot */
export const LEGACY_STORAGE_KEY = 'qhatu_onboarding_state';

export function storageKeyForBot(botId) {
    if (!botId) return LEGACY_STORAGE_KEY;
    return `${LEGACY_STORAGE_KEY}::${botId}`;
}

/** Bot cuyo JSON se persiste en save/saveNow. Debe coincidir con la tienda activa en el modal. */
export let activeWizardBotId = null;

// Default values del spec sección 4.2
const defaults = () => ({
    currentStep: 0,
    completedSteps: [],
    skippedSteps: [],

    identidad: { nombre: '', descripcion: '' },

    productos: [],

    envios: { tipo: null, locales: [], grupos: [] },

    pagos: { metodos: [], comprobante: null },

    modoInteraccion: 'botones',
    tono: 'casual',

    // True una vez que el usuario clickeó "Activar a Willy" en P6.
    completed: false,
});

export const state = defaults();

/** Tras mergear localStorage (o al montar): evita null/array rotos que rompen screens. Idempotente. */
export function normalizeStateShape() {
    const d = defaults();
    if (!state.identidad || typeof state.identidad !== 'object') {
        state.identidad = { ...d.identidad };
    } else {
        state.identidad = {
            nombre: String(state.identidad.nombre ?? ''),
            descripcion: String(state.identidad.descripcion ?? ''),
        };
    }
    if (!Array.isArray(state.productos)) state.productos = [...d.productos];
    if (!state.envios || typeof state.envios !== 'object') {
        state.envios = { ...d.envios };
    } else {
        state.envios = {
            tipo: state.envios.tipo ?? null,
            locales: Array.isArray(state.envios.locales) ? state.envios.locales : [],
            grupos: Array.isArray(state.envios.grupos) ? state.envios.grupos : [],
        };
    }
    if (!state.pagos || typeof state.pagos !== 'object') {
        state.pagos = { ...d.pagos };
    } else {
        state.pagos = {
            metodos: Array.isArray(state.pagos.metodos) ? state.pagos.metodos : [],
            comprobante: state.pagos.comprobante ?? null,
        };
    }
    if (!Array.isArray(state.completedSteps)) state.completedSteps = [];
    if (!Array.isArray(state.skippedSteps)) state.skippedSteps = [];
    if (typeof state.completed !== 'boolean') state.completed = false;
    const cs = Number(state.currentStep);
    state.currentStep = Number.isFinite(cs)
        ? Math.max(0, Math.min(6, Math.floor(cs)))
        : 0;
    if (!state.modoInteraccion || typeof state.modoInteraccion !== 'string') {
        state.modoInteraccion = d.modoInteraccion;
    }
    if (!state.tono || typeof state.tono !== 'string') {
        state.tono = d.tono;
    }
}

function persistKey() {
    return activeWizardBotId ? storageKeyForBot(activeWizardBotId) : LEGACY_STORAGE_KEY;
}

// ── Persist debounced ──────────────────────────────────────────────────
let saveTimer = null;
export function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        try {
            localStorage.setItem(persistKey(), JSON.stringify(state));
        } catch (e) {
            console.warn('[wizard] localStorage save failed', e);
        }
    }, 200);
}

// Persist inmediato (sin debounce). Para casos donde la pérdida de los
// últimos 200ms es inaceptable — ej. P6 marca state.completed=true y el
// usuario podría cerrar la tab durante la celebración.
export function saveNow() {
    clearTimeout(saveTimer);
    try {
        localStorage.setItem(persistKey(), JSON.stringify(state));
    } catch (e) {
        console.warn('[wizard] saveNow failed', e);
    }
}

/**
 * Estado inicial en memoria (sin leer localStorage). Usado al primer mount
 * del wizard antes de saber qué tienda edita el usuario.
 */
export function loadWizardDefaults() {
    activeWizardBotId = null;
    Object.assign(state, defaults());
    normalizeStateShape();
}

/**
 * Carga el progreso del onboarding para una tienda concreta.
 * IMPORTANTE: `opts.willyOnboardingCompleted` debe reflejar SOLO el flag en
 * servidor (`metadata.willy_onboarding_completed === true`). Si el servidor
 * dice que Willy no está activado, aquí forzamos `completed: false` aunque
 * localStorage tenga un JSON viejo con completed:true (evita tiendas nuevas
 * que muestran «Tu configuración ya está activa»).
 *
 * @param {string} botId
 * @param {{ willyOnboardingCompleted?: boolean, accountBotCount?: number, seedIdentidadNombre?: string }} [opts]
 */
export function loadWizardForBot(botId, opts = {}) {
    if (!botId) {
        loadWizardDefaults();
        return;
    }
    activeWizardBotId = botId;
    const willyDone = opts.willyOnboardingCompleted === true;
    const accountBotCount = typeof opts.accountBotCount === 'number' ? opts.accountBotCount : 1;

    const safeParse = (raw) => {
        if (!raw || typeof raw !== 'string') return null;
        try {
            const o = JSON.parse(raw);
            return o && typeof o === 'object' ? o : null;
        } catch (e) {
            console.warn('[wizard] JSON parse failed', e);
            return null;
        }
    };

    Object.assign(state, defaults());

    const perKey = storageKeyForBot(botId);
    const perObj = safeParse(localStorage.getItem(perKey));
    if (perObj) {
        Object.assign(state, perObj);
    } else {
        const legacy = safeParse(localStorage.getItem(LEGACY_STORAGE_KEY));
        if (legacy) {
            if (legacy.completed === true && willyDone && accountBotCount <= 1) {
                Object.assign(state, legacy);
            } else if (!legacy.completed && accountBotCount <= 1) {
                Object.assign(state, legacy);
            }
        }
    }

    normalizeStateShape();

    const seedNom = String(opts.seedIdentidadNombre || '').trim();
    if (seedNom && !String(state.identidad?.nombre || '').trim()) {
        state.identidad = state.identidad && typeof state.identidad === 'object'
            ? state.identidad
            : { nombre: '', descripcion: '' };
        state.identidad.nombre = seedNom;
    }

    if (willyDone) {
        state.completed = true;
        state.currentStep = 6;
    } else {
        state.completed = false;
    }

    normalizeStateShape();
    saveNow();
}

/** @deprecated Usar loadWizardForBot / loadWizardDefaults */
export function load() {
    loadWizardDefaults();
    try {
        const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        Object.assign(state, defaults(), parsed);
        normalizeStateShape();
        return true;
    } catch (e) {
        console.warn('[wizard] localStorage load failed, using defaults', e);
        return false;
    }
}

export function reset() {
    activeWizardBotId = null;
    Object.assign(state, defaults());
    try {
        localStorage.removeItem(LEGACY_STORAGE_KEY);
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const k = localStorage.key(i);
            if (k && k.startsWith(`${LEGACY_STORAGE_KEY}::`)) localStorage.removeItem(k);
        }
    } catch (_) { /* ignore */ }
    emit();
}

// ── Pub/sub mínimo para reactividad opcional ───────────────────────────
const listeners = new Set();
export function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}
export function emit() {
    listeners.forEach(fn => { try { fn(state); } catch (e) { console.error(e); } });
}

// Conveniencia: aplica patch + persist + emite. Para campos nesteados, el
// caller debe mutar `state` directamente y llamar save()/emit() manualmente.
export function update(patch) {
    Object.assign(state, patch);
    save();
    emit();
}

// Marca paso como completado (idempotente)
export function markCompleted(step) {
    if (!state.completedSteps.includes(step)) {
        state.completedSteps = [...state.completedSteps, step];
        save();
    }
}
export function markSkipped(step) {
    if (!state.skippedSteps.includes(step)) {
        state.skippedSteps = [...state.skippedSteps, step];
        save();
    }
}

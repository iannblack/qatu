// ════════════════════════════════════════════════════════════════════════
// Pantalla 6 — Cierre / Activación
// Spec: spec section 5 → "PANTALLA 6 — Cierre / Activación"
//
// Estructura:
//   1. Willy (pose celebrando, fallback a sentado con CSS transform de
//      "victoria")
//   2. Bubble con copy aprobado (NO typewriter — texto instantáneo)
//   3. Resumen visual: bloques con SVG check + lista detallada (negocio,
//      productos, envíos, pagos, modo) armada desde `state`
//   4. Botón primario "Activar a Willy" + secundario "Configurar más cosas antes"
//
// Activate flow:
//   1. Deshabilita ambos botones (anti double-click)
//   2. Marca state.completed=true + saveNow() (sin debounce — protege si
//      el usuario cierra tab durante la celebración)
//   3. Carga canvas-confetti dinámicamente del CDN
//      (graceful fallback si falla)
//   4. Confetti burst (120 partículas, colores red+cream+navy+warning)
//   5. Willy pose victoria via CSS (translateY + scale, spring)
//   6. Swap bubble text al mensaje post-activación
//   7. 1.5s wait → fade out wizard → redirect a Mi Qhatu (create-bot)
//
// Cleanup obligatorio:
//   - cancel timeouts del activate flow + redirect
//   - confetti.reset() si está activo
//   - remove listeners de ambos botones
//
// NO typewriter en P6 — la pantalla es visual/celebratoria, no conversacional.
// ════════════════════════════════════════════════════════════════════════

import { renderWilly, attachReactions, attachBlink } from '../willy.js';
import { state, saveNow } from '../store.js';
import { escapeText } from '../lib/escape.js';
import { METHODS } from './screen4/methodCard.js';
import { syncWillyWizardConfigToServer } from '../lib/wizardServerSync.js';

/** Tienda activa del modal Configuración / Mi Qhatu, o primer bot del usuario. */
async function resolveActivateBotId() {
    try {
        const token = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null;
        if (!token || typeof fetch !== 'function') return null;

        let botId = (typeof window !== 'undefined' && window.__configSelectedBotId)
            ? String(window.__configSelectedBotId)
            : '';
        if (!botId) {
            const botsRes = await fetch('/api/bots', {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!botsRes.ok) return null;
            const bots = await botsRes.json();
            botId = Array.isArray(bots) && bots.length > 0
                ? String(bots[0]._id || bots[0].id || '')
                : '';
        }
        return botId || null;
    } catch (e) {
        console.warn('[p6] resolveActivateBotId', e);
        return null;
    }
}

/**
 * Persiste en el bot que el onboarding Willy quedó oficialmente completado
 * y devuelve el botId usado (para workflow regenerate).
 * @param {string|null} [preResolvedBotId]  Si ya resolviste el id (p. ej. tras sync a servidor), pásalo para evitar otro round-trip.
 */
async function persistWillyOnboardingCompleteToServer(preResolvedBotId) {
    try {
        const token = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null;
        if (!token || typeof fetch !== 'function') return null;

        const botId = preResolvedBotId || await resolveActivateBotId();
        if (!botId) return null;

        const putRes = await fetch(`/api/bots/${encodeURIComponent(botId)}`, {
            method: 'PUT',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                metadata: {
                    willy_onboarding_completed: true,
                    willy_onboarding_completed_at: new Date().toISOString(),
                },
            }),
        });
        if (!putRes.ok) {
            const err = await putRes.json().catch(() => ({}));
            console.warn('[p6] PUT bot willy_onboarding_completed failed', putRes.status, err);
        }

        try {
            if (typeof window.invalidateBotsCache === 'function') window.invalidateBotsCache();
            if (typeof window.loadStoresList === 'function') window.loadStoresList();
        } catch (_) { /* ignore */ }

        return botId;
    } catch (e) {
        console.warn('[p6] persistWillyOnboardingCompleteToServer', e);
        return null;
    }
}

const COPY_INITIAL  = '¡Trato hecho! Ya tengo todo configurado. Dale al botón y te mando un WhatsApp a tu propio número para probar.';
const COPY_POST     = '¡Estoy listo causa! Vamos por esas ventas.';

const CONFETTI_CDN_URL = 'https://cdnjs.cloudflare.com/ajax/libs/canvas-confetti/1.9.3/confetti.browser.min.js';
const CONFETTI_COLORS = ['#C8341E', '#F5EFE3', '#1A1A2E', '#D97706'];

const METHOD_LABEL_BY_ID = Object.fromEntries(METHODS.map(m => [m.id, m.label]));

const COMPROBANTE_LABEL = {
    boleta: 'Boleta',
    factura: 'Factura',
    ambas: 'Boleta y factura',
    ninguna: 'Sin comprobante por ahora',
};

function truncate(str, max) {
    const t = String(str ?? '').trim();
    if (t.length <= max) return t;
    return `${t.slice(0, max - 1)}…`;
}

function maskCelular(s) {
    const d = String(s ?? '').replace(/\D/g, '');
    if (d.length < 4) return 'celular pendiente';
    return `···${d.slice(-4)}`;
}

function maskCuenta(num) {
    const d = String(num ?? '').replace(/\D/g, '');
    if (d.length < 4) return '····';
    return `····${d.slice(-4)}`;
}

/** @typedef {{ label: string, rows: { text: string, sub?: boolean }[] }} SummaryBlock */

/** @returns {SummaryBlock[]} */
function buildSummaryBlocks() {
    return [
        buildNegocioBlock(),
        buildProductosBlock(),
        buildEnviosBlock(),
        buildPagosBlock(),
        buildModoBlock(),
    ];
}

function buildNegocioBlock() {
    const nombre = (state.identidad?.nombre || '').trim() || '(sin nombre)';
    const desc = (state.identidad?.descripcion || '').trim();
    const rows = [{ text: `Nombre: ${nombre}` }];
    if (desc) rows.push({ text: `Descripción: ${truncate(desc, 220)}` });
    return { label: 'Negocio', rows };
}

function buildProductosBlock() {
    const arr = Array.isArray(state.productos) ? state.productos : [];
    if (arr.length === 0) {
        return { label: 'Productos', rows: [{ text: 'No hay productos en la lista.' }] };
    }
    const rows = [{ text: `${arr.length} ${arr.length === 1 ? 'producto' : 'productos'}`, sub: true }];
    for (const p of arr) {
        const n = (p.nombre || '').trim() || 'Sin nombre';
        const pr = String(p.precio ?? '').trim();
        const price = pr ? `S/ ${pr}` : 'sin precio indicado';
        const cat = (p.categoria || '').trim();
        const d = (p.descripcion || '').trim();
        let line = cat ? `${n} — ${price} · ${cat}` : `${n} — ${price}`;
        if (d) line += ` · ${truncate(d, 100)}`;
        rows.push({ text: line });
    }
    return { label: 'Productos', rows };
}

function formatLocalLine(l, index) {
    const name = (l.nombre || '').trim();
    const dir = (l.direccion || '').trim();
    const reg = (l.region || '').trim();
    const hor = (l.horario || '').trim();
    const label = name || dir || `Local ${index + 1}`;
    const bits = [];
    if (name && dir && name !== dir) bits.push(truncate(dir, 72));
    if (reg) bits.push(reg);
    if (hor) bits.push(`Horario: ${truncate(hor, 60)}`);
    return bits.length ? `${label} — ${bits.join(' · ')}` : label;
}

function formatGrupoLine(g, index) {
    const regs = Array.isArray(g.regiones) ? g.regiones : [];
    const regTxt = regs.length
        ? `${regs.length} ${regs.length === 1 ? 'región' : 'regiones'}: ${truncate(regs.slice(0, 4).join(', '), 100)}${regs.length > 4 ? '…' : ''}`
        : 'Sin regiones';
    const te = (g.tiempoEntrega || '').trim();
    const mod = (g.modalidadCosto || '').trim();
    const costBits = [mod, g.costoFijo && `Costo fijo S/ ${g.costoFijo}`, g.pagoEnvio && `Pago envío: ${g.pagoEnvio}`]
        .filter(Boolean);
    const head = `Grupo ${index + 1}`;
    const tail = [regTxt, te && `Entrega: ${truncate(te, 48)}`, ...costBits].filter(Boolean).join(' · ');
    return tail ? `${head}: ${tail}` : `${head}: (datos mínimos)`;
}

function buildEnviosBlock() {
    const e = state.envios || {};
    const t = e.tipo;
    const rows = [];

    if (!t) {
        return { label: 'Envíos', rows: [{ text: 'Sin tipo de entrega indicado.' }] };
    }

    const tipoLine = {
        ninguno: 'Modalidad: no requiere envíos (digital o solo presencial).',
        recojo: 'Modalidad: recojo en local.',
        domicilio: 'Modalidad: envío a domicilio.',
        ambos: 'Modalidad: recojo en local y envío a domicilio.',
    }[t] || `Modalidad: ${t}`;
    rows.push({ text: tipoLine });

    const locsSaved = (e.locales || []).filter(l => l.saved);
    const grpsSaved = (e.grupos || []).filter(g => g.saved);

    if (t === 'recojo' || t === 'ambos') {
        rows.push({
            text: locsSaved.length
                ? `Locales de recojo (${locsSaved.length})`
                : 'Locales de recojo: ninguno guardado',
            sub: true,
        });
        locsSaved.forEach((l, i) => rows.push({ text: formatLocalLine(l, i) }));
    }

    if (t === 'domicilio' || t === 'ambos') {
        rows.push({
            text: grpsSaved.length
                ? `Grupos de envío a domicilio (${grpsSaved.length})`
                : 'Grupos de envío: ninguno guardado',
            sub: true,
        });
        grpsSaved.forEach((g, i) => rows.push({ text: formatGrupoLine(g, i) }));
    }

    return { label: 'Envíos', rows };
}

function formatMetodoLine(m) {
    const tipo = m.tipo;
    const d = m.datos || {};
    const base = METHOD_LABEL_BY_ID[tipo] || tipo;
    switch (tipo) {
        case 'yape':
        case 'plin': {
            const nom = (d.nombre || '').trim() || 'titular pendiente';
            return `${base}: ${truncate(nom, 42)} · ${maskCelular(d.celular)}`;
        }
        case 'transferencia': {
            const banco = (d.banco || '').trim() || 'banco pendiente';
            const tit = (d.titular || '').trim() || 'titular pendiente';
            return `${base}: ${banco} · ${truncate(tit, 36)} · Cuenta ${maskCuenta(d.numero)}`;
        }
        case 'tarjeta': {
            const como = (d.como || '').trim();
            const link = !!(d.linkBase || '').trim();
            const otro = (d.descripcionOtro || '').trim();
            const bits = [];
            if (como) bits.push(`Vía: ${como}`);
            if (link) bits.push('link de pago configurado');
            if (otro) bits.push(truncate(otro, 80));
            return bits.length ? `${base}: ${bits.join(' · ')}` : `${base}: datos registrados`;
        }
        case 'efectivo': {
            const mom = Array.isArray(d.momentos) ? d.momentos.filter(Boolean) : [];
            return mom.length ? `${base}: ${mom.join(', ')}` : `${base}: (sin momentos indicados)`;
        }
        default:
            return base;
    }
}

function buildPagosBlock() {
    const metodos = Array.isArray(state.pagos?.metodos) ? state.pagos.metodos : [];
    const rows = [];

    if (metodos.length === 0) {
        rows.push({ text: 'No hay métodos de pago seleccionados.' });
    } else {
        rows.push({
            text: `${metodos.length} ${metodos.length === 1 ? 'método activo' : 'métodos activos'}`,
            sub: true,
        });
        for (const m of metodos) {
            rows.push({ text: formatMetodoLine(m) });
        }
    }

    const comp = state.pagos?.comprobante;
    if (comp && COMPROBANTE_LABEL[comp]) {
        rows.push({ text: `Comprobantes: ${COMPROBANTE_LABEL[comp]}`, sub: true });
    } else {
        rows.push({ text: 'Comprobantes: sin selección', sub: true });
    }

    return { label: 'Métodos de pago', rows };
}

function buildModoBlock() {
    const modos = { botones: 'Botones y conversacional', conversacional: 'Solo conversacional' };
    const tonos = {
        profesional: 'Profesional',
        formal: 'Formal',
        casual: 'Casual',
        cercano: 'Casual',
        chevere: 'Casual',
    };
    const m = modos[state.modoInteraccion] || 'Solo botones';
    const t = tonos[state.tono] || 'Casual';
    return {
        label: 'Modo Willy',
        rows: [
            { text: `Interacción: ${m}` },
            { text: `Tono: ${t}` },
        ],
    };
}

function renderCheckSvg() {
    return `
        <svg class="qw-check-svg" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 12 L10 17 L20 7" fill="none" stroke="currentColor"
                  stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
    `;
}

function renderSummaryBlocks(blocks) {
    return blocks.map((block, i) => `
        <section class="qw-summary-block" style="--summary-i: ${i}" aria-labelledby="qw-sum-h-${i}">
            <div class="qw-summary-heading" id="qw-sum-h-${i}">
                ${renderCheckSvg()}
                <span class="qw-summary-heading-text">${escapeText(block.label)}</span>
            </div>
            <ul class="qw-summary-detail-list">
                ${block.rows.map(row => `
                    <li class="${row.sub ? 'qw-summary-detail-li qw-summary-detail-li--sub' : 'qw-summary-detail-li'}">${escapeText(row.text)}</li>
                `).join('')}
            </ul>
        </section>
    `).join('');
}

// ─── Settings box (modal "Editar configuración") ──────────────────────
// Abierto desde el botón "Configurar más cosas antes" en P6. Lista cada
// sección del wizard con sus valores actuales y un botón Editar que salta
// al paso correspondiente del wizard vía window.qwGoToStep.
const SECTION_STEP_MAP = {
    'Negocio':           1,
    'Productos':         2,
    'Envíos':            3,
    'Métodos de pago':   4,
    'Modo Willy':        5,
};

const SETTINGS_BOX_ID = 'qw-settings-box-backdrop';

function renderSettingsBoxSections(blocks) {
    return blocks.map((block, i) => {
        const step = SECTION_STEP_MAP[block.label];
        const editAttr = step ? `data-edit-step="${step}"` : 'disabled';
        return `
            <section class="qw-settings-section" aria-labelledby="qw-stg-h-${i}">
                <header class="qw-settings-section-head">
                    <div class="qw-settings-section-title">
                        ${renderCheckSvg()}
                        <h3 id="qw-stg-h-${i}" class="qw-settings-section-name">${escapeText(block.label)}</h3>
                    </div>
                    <button type="button" class="qw-btn qw-btn-secondary qw-btn-sm qw-settings-edit-btn"
                            ${editAttr}
                            aria-label="Editar ${escapeText(block.label)}">
                        Editar
                    </button>
                </header>
                <ul class="qw-settings-section-list">
                    ${block.rows.map(row => `
                        <li class="${row.sub ? 'qw-settings-detail-li qw-settings-detail-li--sub' : 'qw-settings-detail-li'}">${escapeText(row.text)}</li>
                    `).join('')}
                </ul>
            </section>
        `;
    }).join('');
}

/**
 * Abre el modal "Editar configuración" con todos los pasos del wizard
 * listados y un botón Editar por sección. Devuelve un cleanup() que cierra
 * el modal y desregistra listeners (lo usa el cleanup de la pantalla P6
 * para no dejar el modal huérfano si el wizard se desmonta).
 *
 * Exportado para reusarlo desde la pantalla "ya activado" (cuando el usuario
 * reentra al wizard tras haber clickeado "Activar a Willy").
 */
export function openSettingsBox() {
    // Anti-doble apertura
    const existing = document.getElementById(SETTINGS_BOX_ID);
    if (existing) existing.remove();

    const blocks = buildSummaryBlocks();

    const backdrop = document.createElement('div');
    backdrop.className = 'qw-modal-backdrop qw-settings-backdrop';
    backdrop.id = SETTINGS_BOX_ID;
    backdrop.innerHTML = `
        <div class="qw-modal qw-settings-modal" role="dialog" aria-modal="true" aria-labelledby="qw-settings-title">
            <header class="qw-settings-head">
                <div>
                    <h2 class="qw-modal-title" id="qw-settings-title">Editar configuración</h2>
                    <p class="qw-settings-subtitle">Tocá "Editar" en la sección que quieras ajustar. Te llevamos al paso del asistente con tus datos ya cargados.</p>
                </div>
                <button type="button" class="qw-settings-close-btn" data-action="close" aria-label="Cerrar">×</button>
            </header>
            <div class="qw-settings-body">
                ${renderSettingsBoxSections(blocks)}
            </div>
            <footer class="qw-settings-foot">
                <button type="button" class="qw-btn qw-btn-secondary" data-action="close">Volver al resumen</button>
            </footer>
        </div>
    `;
    document.body.appendChild(backdrop);

    const close = () => {
        document.removeEventListener('keydown', onKey);
        backdrop.remove();
    };
    const onKey = (e) => { if (e.key === 'Escape') close(); };

    // Click fuera del modal cierra (igual que confirmModal)
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    document.addEventListener('keydown', onKey);

    backdrop.querySelectorAll('[data-action="close"]').forEach(btn => {
        btn.addEventListener('click', close);
    });

    backdrop.querySelectorAll('.qw-settings-edit-btn[data-edit-step]').forEach(btn => {
        btn.addEventListener('click', () => {
            const step = Number(btn.getAttribute('data-edit-step')) || 0;
            close();
            if (typeof window.qwGoToStep === 'function') {
                window.qwGoToStep(step);
            } else {
                console.warn('[p6] window.qwGoToStep no disponible — no puedo navegar al paso', step);
            }
        });
    });

    // Foco inicial: primer botón Editar
    const firstEdit = backdrop.querySelector('.qw-settings-edit-btn');
    if (firstEdit) firstEdit.focus();

    return close;
}

// ─── Carga dinámica de canvas-confetti ────────────────────────────────
async function loadConfetti() {
    if (window.confetti) return window.confetti;
    try {
        await new Promise((resolve, reject) => {
            const existing = document.querySelector(`script[src="${CONFETTI_CDN_URL}"]`);
            if (existing) {
                if (window.confetti) return resolve();
                existing.addEventListener('load', resolve, { once: true });
                existing.addEventListener('error', () => reject(new Error('confetti CDN error')), { once: true });
                return;
            }
            const s = document.createElement('script');
            s.src = CONFETTI_CDN_URL;
            s.async = true;
            s.onload = () => resolve();
            s.onerror = () => reject(new Error('confetti CDN error'));
            document.head.appendChild(s);
        });
        return window.confetti || null;
    } catch (e) {
        console.info('[p6] confetti no disponible — celebración sin partículas', e?.message || e);
        return null;
    }
}

// ─── Pantalla ──────────────────────────────────────────────────────────
export function renderScreen6(container, ctx) {
    const blocks = buildSummaryBlocks();

    container.innerHTML = `
        <div class="qw-scene qw-scene-stacked qw-scene-closing">
            <h1 class="qw-listo-headline">¡Listo!</h1>
            <div class="qw-scene-head">
                ${renderWilly('celebrando')}
                <div class="qw-bubble">
                    <p class="qw-bubble-text qw-bubble-text-left" id="qw-greeting">${escapeText(COPY_INITIAL)}</p>
                </div>
            </div>
            <div class="qw-p6-summary" role="region" aria-label="Resumen detallado de tu configuración">
                ${renderSummaryBlocks(blocks)}
            </div>
            <div class="qw-p6-actions">
                <button type="button" class="qw-btn qw-btn-secondary" data-action="more-config">
                    Configurar más cosas antes
                </button>
                <button type="button" class="qw-btn qw-btn-primary qw-btn-lg" data-action="activate">
                    Activar a Willy
                </button>
            </div>
        </div>
    `;

    const greetEl = container.querySelector('#qw-greeting');
    const activateBtn = container.querySelector('[data-action="activate"]');
    const moreBtn = container.querySelector('[data-action="more-config"]');
    const willyEl = container.querySelector('.qw-willy');

    // ── State del flujo de activate ──────────────────────────────────
    let activateInProgress = false;
    let postClickTimeout = null;
    let fadeRedirectTimeout = null;
    let confettiInstance = null;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const redirectToHome = () => {
        const home = document.querySelector('.sidebar-nav li[data-section="create-bot"]');
        if (home) home.click();
    };
    // Tras activar a Willy, en lugar de mandar al landing de Mi Qhatu
    // (Tiendas), llevamos directo al tab Workflow para que el usuario vea
    // el grafo que acabamos de regenerar desde su config.
    const redirectToWorkflow = () => {
        const home = document.querySelector('.sidebar-nav li[data-section="create-bot"]');
        if (home) home.click();
        // sidebar.click() suele disparar showBotConfig sin tab — forzamos
        // a workflow tras un pequeño tick para asegurar que la sección esté
        // activa antes de switchKipuTab.
        setTimeout(() => {
            try {
                if (typeof window.switchKipuTab === 'function') {
                    window.switchKipuTab('workflow');
                }
            } catch (e) { console.warn('[p6] redirectToWorkflow failed:', e); }
        }, 80);
    };

    // ── Activar a Willy ──────────────────────────────────────────────
    const onActivate = async () => {
        if (activateInProgress) return;
        activateInProgress = true;
        // Anti double-click + previene escape during celebration
        activateBtn.disabled = true;
        moreBtn.disabled = true;

        // Persistir flag YA — saveNow bypassea debounce. Si el usuario
        // cierra tab durante la celebración, queremos que el flag
        // sobreviva.
        state.completed = true;
        saveNow();

        const botIdForSync = await resolveActivateBotId();
        if (botIdForSync) {
            await syncWillyWizardConfigToServer(botIdForSync);
        }
        const activatedBotId = await persistWillyOnboardingCompleteToServer(botIdForSync);

        // Regenerar el workflow después de persistir productos + metadata,
        // para que buildConfigDrivenSeed lea el catálogo real en business_info.
        try {
            const token = localStorage.getItem('token');
            if (token && typeof fetch === 'function' && activatedBotId) {
                const wfRes = await fetch(`/api/workflow/${encodeURIComponent(activatedBotId)}/regenerate`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${token}` },
                });
                if (!wfRes.ok) {
                    console.warn('[p6] workflow regenerate HTTP', wfRes.status);
                }
                try { window._kipuMindmapMountedFor = null; } catch (_) { /* ignore */ }
            }
        } catch (e) {
            console.warn('[p6] failed to trigger workflow regenerate:', e?.message || e);
        }

        // Confetti (graceful fallback si CDN falla o si reduce-motion)
        if (!reduceMotion) {
            const confetti = await loadConfetti();
            if (confetti) {
                try {
                    confetti({
                        particleCount: 120,
                        spread: 80,
                        origin: { x: 0.5, y: 0.7 },
                        colors: CONFETTI_COLORS,
                    });
                    confettiInstance = confetti;
                } catch (e) {
                    console.warn('[p6] confetti fire error', e);
                }
            }
            // Willy pose victoria via CSS — TODO: requiere SVG por partes
            // para una pose de victoria real con brazos arriba. Por ahora,
            // PNG sentado con transform translateY + scale spring.
            willyEl?.classList.add('qw-willy-victory');
        }

        // Swap bubble text al mensaje post-click. Sin typewriter — set directo.
        greetEl.textContent = COPY_POST;

        // 1.5s celebración → fade out + redirect
        postClickTimeout = setTimeout(() => {
            const wizardEl = container.closest('.qhatu-wizard');
            if (wizardEl && !reduceMotion) {
                wizardEl.style.transition = 'opacity 0.5s ease-out';
                wizardEl.style.opacity = '0';
            }
            fadeRedirectTimeout = setTimeout(() => {
                redirectToWorkflow();
            }, reduceMotion ? 0 : 500);
        }, 1500);
    };

    // closeSettingsBox queda apuntando al cleanup del modal si está abierto.
    // Lo usamos en el cleanup de la pantalla para no dejar el modal huérfano
    // si el wizard se desmonta (cambio de tienda, cierre del modal padre).
    let closeSettingsBox = null;

    const onMoreConfig = () => {
        // Abre el settings box: un modal con todas las secciones de la
        // configuración listadas y un botón "Editar" por sección. Cada
        // Editar navega al paso correspondiente del wizard vía qwGoToStep,
        // conservando los datos ya cargados.
        if (typeof closeSettingsBox === 'function') {
            try { closeSettingsBox(); } catch {}
        }
        closeSettingsBox = openSettingsBox();
    };

    activateBtn.addEventListener('click', onActivate);
    moreBtn.addEventListener('click', onMoreConfig);

    // ── Willy reactions + blink ─────────────────────────────────────
    const stopReactions = attachReactions(container);
    const stopBlink = attachBlink(container, 'celebrando');

    // P6 no tiene Continuar visible (footer oculto en step 6). No registrar
    // beforeNext/Back/Skip — los botones in-screen manejan toda la nav.

    // ── Cleanup OBLIGATORIO ─────────────────────────────────────────
    return () => {
        clearTimeout(postClickTimeout);
        clearTimeout(fadeRedirectTimeout);
        // Stop confetti si todavía está animando partículas
        if (confettiInstance && typeof confettiInstance.reset === 'function') {
            try { confettiInstance.reset(); } catch {}
        }
        // Cerrar settings box si quedó abierto (cleanup contra leaks)
        if (typeof closeSettingsBox === 'function') {
            try { closeSettingsBox(); } catch {}
            closeSettingsBox = null;
        }
        activateBtn.removeEventListener('click', onActivate);
        moreBtn.removeEventListener('click', onMoreConfig);
        stopReactions();
        stopBlink();
    };
}

// ════════════════════════════════════════════════════════════════════════
// Pantalla "ya activado" — renderizada por wizard.js cuando el usuario
// re-entra al wizard (vía botón "Configurar" de una tarjeta de tienda) y
// `state.completed === true`. Misma estructura visual que P6 (Willy +
// resumen) pero los botones cambian:
//   - Primario: "Editar configuración" → abre openSettingsBox
//   - Secundario: "Cerrar" → cierra modal store-willy + vuelve al panel
// ════════════════════════════════════════════════════════════════════════

const COPY_COMPLETED = '¡Tu Qhatu ya está activo! ¿Querés ajustar algo de la configuración o lo dejamos así?';

function closeStoreModalAndGoHome() {
    try {
        if (typeof window.closeStoreWillyModal === 'function') {
            window.closeStoreWillyModal();
        } else {
            const modal = document.getElementById('store-willy-modal');
            if (modal) {
                modal.classList.remove('store-willy-modal--open');
                modal.setAttribute('aria-hidden', 'true');
            }
            document.body.style.overflow = '';
            window.__willyModalOpen = false;
        }
    } catch (e) {
        console.warn('[p6-completed] closeStoreWillyModal failed', e);
    }
    try {
        const home = document.querySelector('.sidebar-nav li[data-section="create-bot"]');
        if (home) home.click();
    } catch (e) {
        console.warn('[p6-completed] redirect home failed', e);
    }
}

export function renderScreenCompleted(container) {
    const blocks = buildSummaryBlocks();

    container.innerHTML = `
        <div class="qw-scene qw-scene-stacked qw-scene-closing">
            <h1 class="qw-listo-headline">¡Tu Qhatu ya está activo!</h1>
            <div class="qw-scene-head">
                ${renderWilly('celebrando')}
                <div class="qw-bubble">
                    <p class="qw-bubble-text qw-bubble-text-left" id="qw-greeting">${escapeText(COPY_COMPLETED)}</p>
                </div>
            </div>
            <div class="qw-p6-summary" role="region" aria-label="Resumen detallado de tu configuración actual">
                ${renderSummaryBlocks(blocks)}
            </div>
            <div class="qw-p6-actions">
                <button type="button" class="qw-btn qw-btn-secondary" data-action="close-completed">
                    Cerrar
                </button>
                <button type="button" class="qw-btn qw-btn-primary qw-btn-lg" data-action="edit-config">
                    Editar configuración
                </button>
            </div>
        </div>
    `;

    const editBtn  = container.querySelector('[data-action="edit-config"]');
    const closeBtn = container.querySelector('[data-action="close-completed"]');

    let closeSettingsBox = null;

    const onEdit = () => {
        if (typeof closeSettingsBox === 'function') {
            try { closeSettingsBox(); } catch {}
        }
        closeSettingsBox = openSettingsBox();
    };

    const onClose = () => {
        closeStoreModalAndGoHome();
    };

    editBtn?.addEventListener('click', onEdit);
    closeBtn?.addEventListener('click', onClose);

    const stopReactions = attachReactions(container);
    const stopBlink     = attachBlink(container, 'celebrando');

    return () => {
        if (typeof closeSettingsBox === 'function') {
            try { closeSettingsBox(); } catch {}
            closeSettingsBox = null;
        }
        editBtn?.removeEventListener('click', onEdit);
        closeBtn?.removeEventListener('click', onClose);
        stopReactions();
        stopBlink();
    };
}

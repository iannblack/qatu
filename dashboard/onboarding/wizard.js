// ════════════════════════════════════════════════════════════════════════
// Wizard orchestrator
//
// Responsabilidades:
//   - mount(target): inicializa el DOM dentro del container dado
//   - render del header (progress + atrás + exit)
//   - render del footer (atrás / saltar / continuar — solo pasos 1–5)
//   - despachar a la pantalla actual según state.currentStep
//   - persistir cada cambio en localStorage (vía store)
//
// Auto-mount: detecta #qhatu-wizard-root y lo inicializa al cargar. Si el
// root está dentro de una sección oculta del dashboard, el wizard renderiza
// igual y se ve cuando el usuario abre la sección. Cada vez que la sección
// recibe la clase .active, replicamos la entry-anim de la pantalla actual.
// ════════════════════════════════════════════════════════════════════════

import {
    state,
    save,
    reset,
    markCompleted,
    markSkipped,
    normalizeStateShape,
    loadWizardDefaults,
    loadWizardForBot,
    LEGACY_STORAGE_KEY,
} from './store.js';
import { renderScreen0 } from './screens/screen0.js';
import { renderScreen1 } from './screens/screen1.js';
import { renderScreen2 } from './screens/screen2.js';
import { renderScreen3 } from './screens/screen3.js';
import { renderScreen4 } from './screens/screen4.js';
import { renderScreen5 } from './screens/screen5.js';
import { renderScreen6, renderScreenCompleted } from './screens/screen6.js';
import { escapeText } from './lib/escape.js';

const TOTAL_STEPS = 5;

// Tabla pantalla → fn(container, ctx). Cada screen DEBE retornar una fn de
// cleanup (typewriter cancels, listeners, blink, timers). Lo enforzamos
// con un console.error en renderScreen() si algo no respeta el contrato.
const SCREENS = {
    0: renderScreen0,
    1: renderScreen1,
    2: renderScreen2,
    3: renderScreen3,
    4: renderScreen4,
    5: renderScreen5,
    6: renderScreen6,
};

// Último step implementado. ACTUALIZAR cada vez que llega una pantalla nueva.
// Sirve para que si el localStorage tiene un currentStep apuntando a un
// placeholder ("Pantalla N: en construcción"), el orchestrator nos devuelva
// automáticamente al último paso disponible — sin quedar trancado sin nav.
const MAX_IMPLEMENTED_STEP = 6;

// Detección de entorno dev: expone window.__qhatuWizardReset() y el atajo
// Cmd/Ctrl+Shift+Backspace para limpiar state. En producción isDev() es false
// y ese bloque no registra nada.
function isDev() {
    const h = location.hostname;
    return h === 'localhost'
        || h === '127.0.0.1'
        || h === '0.0.0.0'
        || h.startsWith('192.168.')
        || h.startsWith('10.')
        || h.endsWith('.local');
}

let mounted = false;
let rootEl = null;
// Cleanup de la pantalla actualmente montada — typewriter timers, blink
// interval, listeners varios. Se llama antes de cada renderScreen() y al
// destruir el wizard. Convención: cada screen DEBE retornar su cleanup.
let currentCleanup = null;
// Guards que las pantallas pueden registrar via ctx.setBeforeNext / setBeforeBack
// / setBeforeSkip. Si retornan false (o Promise<false>), la nav se aborta.
// Se resetean al cambiar de pantalla. Patrón usado para validación, dirty
// check y confirmación de skip sin que las screens tengan que clonar los
// botones del footer.
let beforeNextGuard = null;
let beforeBackGuard = null;
let beforeSkipGuard = null;
// Flag: true cuando el usuario entró a editar un paso vía qwGoToStep()
// (desde el settings box de P6 / pantalla "ya activado"). Activa el botón
// "Finalizar" en el footer de cada paso para que el usuario pueda volver
// al resumen sin tener que completar todos los pasos en orden.
let editingFromCompleted = false;

/** Deduce qué paso del wizard pintó el DOM (null = vacío o irreconocible). */
function inferDomWizardStep(content) {
    if (!content) return null;
    if (!content.querySelector('.qw-scene')) return null;
    if (content.querySelector('.qw-listo-headline') || content.querySelector('[data-action="activate"]')) return 6;
    if (content.querySelector('.qw-p5-content')) return 5;
    if (content.querySelector('[data-cards-grid]')) return 4;
    if (content.querySelector('#qw-subforms')) return 3;
    if (content.querySelector('#qw-products-list')) return 2;
    if (content.querySelector('#qw-identidad-form')) return 1;
    if (content.querySelector('[data-action="start"]')) return 0;
    return null;
}

function wizardDomNeedsHeal(content, step) {
    if (!content) return true;
    if (content.querySelector('[data-qw-fatal]')) return false;
    const inferred = inferDomWizardStep(content);
    if (inferred === null) return true;
    return inferred !== step;
}

function schedulePostRenderDomHeal() {
    requestAnimationFrame(() => {
        const content = document.getElementById('qw-content');
        if (!content || state.completed) return;
        if (wizardDomNeedsHeal(content, state.currentStep)) {
            console.warn('[wizard] DOM incoherente con paso', state.currentStep, '— re-render');
            renderCurrent();
        }
    });
}

function buildWizardShellHTML() {
    return `
        <div class="qw-header">
            <div class="qw-progress" role="progressbar" aria-label="Progreso del onboarding">
                <div class="qw-progress-fill" id="qw-progress-fill"></div>
            </div>
            <div class="qw-header-row">
                <span class="qw-step-label" id="qw-step-label"></span>
                <div class="qw-header-actions">
                    <button type="button" class="qw-header-back" id="qw-header-back"
                            aria-label="Paso anterior" title="Volver al paso anterior">← Atrás</button>
                    <button type="button" class="qw-exit-btn" id="qw-exit-btn" aria-label="Salir del onboarding">
                        ✕ Salir
                    </button>
                </div>
            </div>
        </div>
        <div class="qw-content" id="qw-content" aria-live="polite"></div>
        <div class="qw-footer" id="qw-footer"></div>
    `;
}

function wireWizardShellListeners() {
    const exit = document.getElementById('qw-exit-btn');
    if (exit) exit.addEventListener('click', confirmExit);
    const headerBackBtn = document.getElementById('qw-header-back');
    if (headerBackBtn) headerBackBtn.addEventListener('click', () => { back(); });
}

/** Reconstruye header + área de contenido + footer (tras placeholder «completado» o primer mount). */
function injectWizardShell() {
    if (!rootEl) return;
    rootEl.classList.add('qhatu-wizard');
    rootEl.innerHTML = buildWizardShellHTML();
    wireWizardShellListeners();
}

/**
 * Tras cambiar de tienda en el modal: recarga state desde localStorage por botId
 * y repinta el wizard (o el placeholder si esa tienda ya completó Willy).
 * Expuesto en window para app.js (script clásico).
 */
function applyWizardBotContext(botId, opts = {}) {
    // Self-heal: si init() todavía no corrió (race condition al abrir el
    // modal antes de que el módulo termine de inicializarse), intentamos
    // montar el wizard sobre #qhatu-wizard-root acá mismo. Sin esto, la
    // función salía en silencio y dejaba el modal "Configurar tienda"
    // completamente vacío.
    if (!rootEl) {
        const target = document.getElementById('qhatu-wizard-root');
        if (target) {
            try {
                mount(target);
                setupSectionObserver();
            } catch (e) {
                console.warn('[wizard] mount on-demand falló', e);
            }
        }
        if (!rootEl) {
            console.warn('[wizard] applyWizardBotContext: #qhatu-wizard-root ausente; nada que renderizar');
            return;
        }
    }
    if (currentCleanup) {
        try { currentCleanup(); } catch (e) { console.warn('[wizard] cleanup before bot switch', e); }
        currentCleanup = null;
    }
    loadWizardForBot(botId, opts);
    normalizeStateShape();
    if (state.currentStep > MAX_IMPLEMENTED_STEP) {
        const requested = state.currentStep;
        state.currentStep = MAX_IMPLEMENTED_STEP;
        save();
        showToast(
            `Pantalla ${requested} en construcción — te traje al paso ${MAX_IMPLEMENTED_STEP}.`,
            5000
        );
    }
    if (state.completed) {
        renderCompletedPlaceholder();
        return;
    }
    if (!rootEl.querySelector('#qw-content')) {
        injectWizardShell();
    }
    renderCurrent();
    schedulePostRenderDomHeal();
}

if (typeof window !== 'undefined') {
    window.applyQhatuWizardForStore = applyWizardBotContext;

    // Salto programático a un paso arbitrario del wizard.
    // Usado por el settings box de P6 (botón "Editar" por sección) y por
    // cualquier otra parte del dashboard que necesite llevar al usuario a
    // un paso concreto sin pasar por next/back.
    window.qwGoToStep = function(step) {
        const n = Math.max(0, Math.min(MAX_IMPLEMENTED_STEP, Number(step) | 0));
        if (!rootEl) return;
        // Marcar que el usuario entró a editar desde el settings box.
        // renderFooter() usa este flag para mostrar el botón "Finalizar".
        editingFromCompleted = true;
        state.currentStep = n;
        save();
        if (!rootEl.querySelector('#qw-content')) injectWizardShell();
        renderCurrent();
        schedulePostRenderDomHeal();
    };
}

export function mount(target) {
    if (mounted) {
        replayCurrent();
        return;
    }
    mounted = true;
    rootEl = target;

    loadWizardDefaults();
    normalizeStateShape();

    const devMode = isDev();

    injectWizardShell();

    // Wizard ya completado (clickeó "Activar a Willy" en P6) → no renderizar
    // contenido del wizard. Solo placeholder de "ya está activo". El section
    // observer (setup en init() después de mount) detecta re-entradas y
    // dispara replayCurrent, que con state.completed=true redirige al panel.
    // En dev, __qhatuWizardReset() / Cmd+Shift+Backspace limpian el state.
    if (state.completed) {
        renderCompletedPlaceholder();
        return;
    }

    // Guard: si el state apunta a una screen no implementada, clampear al
    // último step implementado. Pasa cuando el código baja la versión del
    // wizard (ej. en desarrollo) mientras el localStorage tiene un step más
    // alto. Sin esto, el usuario queda trancado en el placeholder de la
    // pantalla en construcción.
    if (state.currentStep > MAX_IMPLEMENTED_STEP) {
        const requested = state.currentStep;
        state.currentStep = MAX_IMPLEMENTED_STEP;
        save();
        showToast(
            `Pantalla ${requested} en construcción — te traje al paso ${MAX_IMPLEMENTED_STEP}.`,
            5000
        );
    }

    // Atajo dev: expone window.__qhatuWizardReset() (reload tras borrar
    // localStorage) y Cmd/Ctrl+Shift+Backspace → handleDevReset (confirmación).
    if (devMode) {
        window.__qhatuWizardReset = () => {
            reset();
            location.reload();
        };
        document.addEventListener('keydown', (e) => {
            if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'Backspace') {
                e.preventDefault();
                handleDevReset();
            }
        });
        console.info(
            '%c[wizard] dev mode — __qhatuWizardReset() o Cmd+Shift+Backspace para reiniciar el wizard.',
            'color: #C8341E; font-weight: 600;'
        );
    }

    renderCurrent();
    schedulePostRenderDomHeal();
}

// Handler del reset de desarrollo (consola + atajo de teclado en isDev()).
async function handleDevReset() {
    const ok = await confirmModal({
        title: 'Reiniciar wizard',
        message: 'Borra todo el progreso guardado y vuelve al paso 0. Esto es solo para desarrollo.',
        confirmText: 'Sí, reiniciar',
        cancelText: 'Cancelar',
    });
    if (!ok) return;
    // store.reset() limpia localStorage + state. renderCurrent() después
    // dispara cleanup de la pantalla actual (vía renderScreen) y monta P0.
    reset();
    normalizeStateShape();
    if (rootEl && !rootEl.querySelector('#qw-content')) injectWizardShell();
    renderCurrent();
    showToast('Wizard reiniciado al paso 0.');
    schedulePostRenderDomHeal();
}

function renderCurrent() {
    const step = state.currentStep;

    // Restaurar visibilidad del shell — renderCompletedPlaceholder pudo haberlo
    // ocultado para mostrar la pantalla "ya activado" sin header/footer; cuando
    // qwGoToStep nos devuelve al flujo normal hay que reactivarlo.
    if (rootEl) {
        const header = rootEl.querySelector('.qw-header');
        if (header) header.style.display = '';
    }

    // Progress: pantalla 0 = 0%, pantallas 1–5 lineal, pantalla 6 = 100%
    const fill = document.getElementById('qw-progress-fill');
    let pct = 0;
    if (step === 6) pct = 100;
    else if (step >= 1) pct = Math.round((step / TOTAL_STEPS) * 100);
    if (fill) fill.style.width = pct + '%';

    const label = document.getElementById('qw-step-label');
    if (label) {
        if (step === 0) label.textContent = '';
        else if (step === 6) label.textContent = '¡Listo!';
        else label.textContent = `Paso ${step} de ${TOTAL_STEPS}`;
    }

    const headerBack = document.getElementById('qw-header-back');
    if (headerBack) {
        const onFirst = step === 0;
        headerBack.hidden = onFirst;
        headerBack.disabled = onFirst;
        headerBack.setAttribute('aria-hidden', onFirst ? 'true' : 'false');
    }

    renderFooter(step);
    renderScreen(step);
}

function renderFooter(step) {
    const footer = document.getElementById('qw-footer');
    if (!footer) return;
    if (step === 0 || step === 6) {
        footer.style.display = 'none';
        footer.innerHTML = '';
        return;
    }
    footer.style.display = 'flex';
    const canSkip = step === 2 || step === 3;
    // Mostrar "Finalizar" cuando el usuario vino desde el settings box de
    // P6 (editar una sección de la config ya completada). Así puede guardar
    // los cambios de la sección actual y volver al resumen sin tener que
    // navegar por todos los pasos restantes.
    const showFinish = editingFromCompleted;
    footer.innerHTML = `
        <button type="button" class="qw-btn qw-btn-secondary" data-action="back">← Atrás</button>
        <div class="qw-footer-right">
            ${canSkip ? '<button type="button" class="qw-btn qw-btn-secondary" data-action="skip">Saltar</button>' : ''}
            ${showFinish ? '<button type="button" class="qw-btn qw-btn-secondary" data-action="finish">Finalizar</button>' : ''}
            <button type="button" class="qw-btn qw-btn-primary" data-action="next">Continuar →</button>
        </div>
    `;
    footer.querySelector('[data-action="back"]').addEventListener('click', back);
    footer.querySelector('[data-action="next"]').addEventListener('click', next);
    if (canSkip) footer.querySelector('[data-action="skip"]').addEventListener('click', skip);
    if (showFinish) {
        footer.querySelector('[data-action="finish"]').addEventListener('click', async () => {
            // Respetar el guard de validación del paso actual (beforeNextGuard)
            // para que los datos queden bien antes de salir. Si el guard
            // rechaza, mostramos el error inline igual que "Continuar".
            if (beforeNextGuard) {
                try {
                    const ok = await beforeNextGuard();
                    if (ok === false) return;
                } catch (e) {
                    console.warn('[wizard] finish guard threw', e);
                    return;
                }
            }
            // Guardar el paso actual y volver al resumen (P6).
            markCompleted(state.currentStep);
            editingFromCompleted = false;
            state.currentStep = 6;
            save();
            renderCurrent();
        });
    }
}

function renderScreen(step) {
    // Cleanup de la pantalla anterior antes de pisar el DOM — evita leaks
    // de timers (typewriter, blink) y listeners.
    if (currentCleanup) {
        try { currentCleanup(); } catch (e) { console.warn('[wizard] cleanup error', e); }
        currentCleanup = null;
    }
    // Limpiar guards de la pantalla saliente — la nueva los registra fresco
    beforeNextGuard = null;
    beforeBackGuard = null;
    beforeSkipGuard = null;

    const content = document.getElementById('qw-content');
    if (!content) {
        console.error('[wizard] #qw-content no existe — abortando render de pantalla', step);
        return;
    }
    const fn = SCREENS[step];
    if (!fn) {
        // Placeholder para pantallas no implementadas todavía
        content.innerHTML = `
            <div style="text-align:center; max-width:520px; margin:auto;">
                <p style="font-family:var(--qw-font-serif); font-size:22px; color:var(--qhatu-navy); margin:0 0 1rem;">
                    Pantalla ${step}: en construcción
                </p>
                <p style="color:var(--qhatu-gray); font-size:14px;">
                    Esta pantalla llega en la siguiente iteración.
                </p>
            </div>
        `;
        return;
    }
    // ctx — API que reciben las screens. setBeforeNext/setBeforeBack permite
    // a la screen interceptar la navegación para validar o pedir confirmación.
    // Si el guard devuelve false (o Promise<false>), la nav se cancela.
    const ctx = {
        next, back, skip,
        setBeforeNext: (fn) => { beforeNextGuard = fn; },
        setBeforeBack: (fn) => { beforeBackGuard = fn; },
        setBeforeSkip: (fn) => { beforeSkipGuard = fn; },
    };
    try {
        const result = fn(content, ctx);
        // Convención OBLIGATORIA: cada screen retorna su cleanup. Si no lo hace,
        // ruidoso console.error en dev — el bug se ve antes de que se vuelva
        // un leak en producción.
        if (typeof result !== 'function') {
            console.error(
                `[wizard] screen ${step} no retornó cleanup. Convención obligatoria — ` +
                `toda screen DEBE devolver una función que cancele timers, listeners y otros efectos.`
            );
        } else {
            currentCleanup = result;
        }
    } catch (e) {
        console.error(`[wizard] screen ${step} falló al renderizar`, e);
        currentCleanup = null;
        content.innerHTML = `
            <div class="qw-scene" data-qw-fatal style="max-width:520px;margin:2rem auto;padding:1.5rem;text-align:center;">
                <p style="font-family:var(--qw-font-serif);font-size:1.15rem;color:var(--qhatu-navy);margin:0 0 1rem;">
                    No pudimos cargar este paso del asistente.
                </p>
                <p style="color:var(--qhatu-gray);font-size:14px;margin:0 0 1.25rem;">
                    Recargá la página. Si el problema sigue, borrá en consola:
                    <code style="font-size:12px;">localStorage (claves ${LEGACY_STORAGE_KEY} y ${LEGACY_STORAGE_KEY}::&lt;botId&gt;)</code>
                </p>
                <button type="button" class="qw-btn qw-btn-primary" id="qw-reload-fallback">Recargar página</button>
            </div>`;
        const btn = content.querySelector('#qw-reload-fallback');
        if (btn) btn.addEventListener('click', () => location.reload(), { once: true });
    }
}

// ── Navegación ─────────────────────────────────────────────────────────
// next/back son async para soportar guards que retornen Promise (ej: dirty
// check con confirmModal). Si el guard devuelve false, abortamos.
async function next() {
    if (beforeNextGuard) {
        try {
            const ok = await beforeNextGuard();
            if (ok === false) return;
        } catch (e) {
            console.warn('[wizard] beforeNextGuard threw', e);
            return;
        }
    }
    markCompleted(state.currentStep);
    state.currentStep = Math.min(6, state.currentStep + 1);
    // Si llega a P6 navegando con "Continuar", ya no hace falta el flag.
    if (state.currentStep === 6) editingFromCompleted = false;
    save();
    renderCurrent();
}
async function back() {
    if (beforeBackGuard) {
        try {
            const ok = await beforeBackGuard();
            if (ok === false) return;
        } catch (e) {
            console.warn('[wizard] beforeBackGuard threw', e);
            return;
        }
    }
    state.currentStep = Math.max(0, state.currentStep - 1);
    save();
    renderCurrent();
}
async function skip() {
    if (beforeSkipGuard) {
        try {
            const ok = await beforeSkipGuard();
            if (ok === false) return;
        } catch (e) {
            console.warn('[wizard] beforeSkipGuard threw', e);
            return;
        }
    }
    markSkipped(state.currentStep);
    state.currentStep = Math.min(6, state.currentStep + 1);
    save();
    renderCurrent();
}

// Replay cuando la sección Configuración recibe .active (MutationObserver).
// P0/P6: renderCurrent completo. P1–P5: preservamos DOM salvo vacío o paso
// incoherente con state (p. ej. crash en render) — entonces re-render.
function replayCurrent() {
    if (state.completed) {
        redirectToHome();
        return;
    }
    const content = document.getElementById('qw-content');
    if (!content) return;

    if (state.currentStep === 0 || state.currentStep === 6) {
        renderCurrent();
        schedulePostRenderDomHeal();
        return;
    }
    if (wizardDomNeedsHeal(content, state.currentStep)) {
        renderCurrent();
    }
    schedulePostRenderDomHeal();
}

// Redirect al panel principal. Reutiliza el comportamiento de los items del
// sidebar — el dashboard ya tiene toda la lógica de cambio de sección.
function redirectToHome() {
    const home = document.querySelector('.sidebar-nav li[data-section="create-bot"]');
    if (home) home.click();
}

// Pantalla "ya activado" cuando state.completed === true. Renderizada
// cuando el usuario re-entra al wizard (vía botón "Configurar" en una
// tarjeta de tienda). En lugar del placeholder seco anterior ("Llevándote a
// tu panel…", que nunca redirigía y dejaba una vista huérfana detrás del
// modal), mostramos una pantalla Willy con el resumen completo y dos CTAs:
// "Editar configuración" → settings box · "Cerrar" → home.
function renderCompletedPlaceholder() {
    if (!rootEl) return;

    // Asegurar que el shell del wizard esté montado para que renderScreenCompleted
    // pinte sobre #qw-content (la pantalla reusa estilos de P6 que dependen del
    // shell). También oculta header/footer del wizard normal — esto NO es un
    // paso del flujo, es una pantalla terminal.
    if (!rootEl.querySelector('#qw-content')) {
        injectWizardShell();
    }
    const header = rootEl.querySelector('.qw-header');
    const footer = rootEl.querySelector('.qw-footer');
    if (header) header.style.display = 'none';
    if (footer) footer.style.display = 'none';

    const content = rootEl.querySelector('#qw-content');
    if (!content) return;

    if (currentCleanup) {
        try { currentCleanup(); } catch (e) { console.warn('[wizard] cleanup before completed screen', e); }
        currentCleanup = null;
    }

    try {
        const result = renderScreenCompleted(content);
        if (typeof result === 'function') {
            currentCleanup = result;
        }
    } catch (e) {
        console.error('[wizard] renderScreenCompleted falló', e);
        content.innerHTML = `
            <div class="qw-completed-placeholder" role="status">
                <h2>Tu configuración ya está activa</h2>
                <p>Cerrá este modal para volver al panel.</p>
            </div>
        `;
    }

    // Usuarios que completaron Willy antes de persistir metadata en el bot:
    // al reabrir «Configurar», alineamos servidor con localStorage.completed.
    try {
        const bid = typeof window !== 'undefined' ? window.__configSelectedBotId : null;
        const fn = typeof window !== 'undefined' ? window.syncWillyOnboardingCompletionIfCompleted : null;
        if (bid && typeof fn === 'function') {
            setTimeout(() => { fn(bid).catch(() => {}); }, 0);
        }
    } catch (_) { /* ignore */ }
}

// ── Toast helper (export — para feedback no-bloqueante) ─────────────────
// Notificación efímera anclada al wizard (no a la página). No requiere
// interacción del usuario — desaparece sola tras `duration` ms.
// Uso:
//   showToast('Wizard reiniciado.');
//   showToast('Pantalla 6 en construcción.', 5000);
export function showToast(message, duration = 3500) {
    const wizardEl = document.querySelector('.qhatu-wizard');
    if (!wizardEl) return;
    let container = wizardEl.querySelector('.qw-toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'qw-toast-container';
        wizardEl.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = 'qw-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.textContent = message;
    container.appendChild(toast);
    // Programar el fade-out. Cleanup defensivo: si el wizard se desmonta
    // antes (improbable), el toast desaparece con el DOM padre.
    setTimeout(() => {
        toast.classList.add('qw-toast-leaving');
        setTimeout(() => toast.remove(), 250);
    }, duration);
}

// ── Confirm modal helper (export — usado por screens y por confirmExit) ──
// Devuelve una Promise<boolean>. Resuelve true si el usuario confirma,
// false si cancela / cierra / Esc / click fuera del modal.
//
// Uso:
//   const ok = await confirmModal({ title: '¿Volver?', message: '...', confirmText: 'Sí, volver', cancelText: 'Quedarme' });
//   if (!ok) return;
export function confirmModal({ title, message, confirmText = 'Confirmar', cancelText = 'Cancelar' }) {
    return new Promise((resolve) => {
        const backdrop = document.createElement('div');
        backdrop.className = 'qw-modal-backdrop';
        backdrop.innerHTML = `
            <div class="qw-modal" role="dialog" aria-labelledby="qw-modal-title" aria-describedby="qw-modal-text">
                <h2 class="qw-modal-title" id="qw-modal-title">${escapeText(title)}</h2>
                <p class="qw-modal-text" id="qw-modal-text">${escapeText(message)}</p>
                <div class="qw-modal-actions">
                    <button type="button" class="qw-btn qw-btn-secondary" data-action="cancel">${escapeText(cancelText)}</button>
                    <button type="button" class="qw-btn qw-btn-primary" data-action="confirm">${escapeText(confirmText)}</button>
                </div>
            </div>
        `;
        document.body.appendChild(backdrop);

        let settled = false;
        const close = (result) => {
            if (settled) return;
            settled = true;
            document.removeEventListener('keydown', onKey);
            backdrop.remove();
            resolve(result);
        };
        const onKey = (e) => { if (e.key === 'Escape') close(false); };

        backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(false); });
        backdrop.querySelector('[data-action="cancel"]').addEventListener('click', () => close(false));
        backdrop.querySelector('[data-action="confirm"]').addEventListener('click', () => close(true));
        document.addEventListener('keydown', onKey);

        // Foco inicial en el botón de confirmar — tab order natural
        backdrop.querySelector('[data-action="confirm"]').focus();
    });
}

// ── Exit modal ─────────────────────────────────────────────────────────
async function confirmExit() {
    const ok = await confirmModal({
        title: '¿Seguro?',
        message: 'Tu progreso se guarda y puedes continuar después.',
        confirmText: 'Sí, salir',
        cancelText: 'Quedarme aquí',
    });
    if (!ok) return;
    redirectToHome();
}

// Section observer — se llama desde mount() tanto en el flujo normal como
// cuando state.completed=true (placeholder). En ambos casos detecta cuando
// la sección padre del wizard recibe .active (usuario clickea el item del
// sidebar) y dispara replayCurrent. replayCurrent ya decide internamente
// si redirigir (completed) o re-render (P0/P6) o no-op (forms).
function setupSectionObserver() {
    if (!rootEl) return;
    const section = rootEl.closest('.section');
    if (!section) return;
    let wasActive = section.classList.contains('active');
    const obs = new MutationObserver(() => {
        const isActive = section.classList.contains('active');
        if (isActive && !wasActive) replayCurrent();
        wasActive = isActive;
    });
    obs.observe(section, { attributes: true, attributeFilter: ['class'] });
}

// ── Auto-init ──────────────────────────────────────────────────────────
function init() {
    const target = document.getElementById('qhatu-wizard-root');
    if (!target) return;
    mount(target);
    setupSectionObserver();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

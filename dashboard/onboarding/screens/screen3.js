// ════════════════════════════════════════════════════════════════════════
// Pantalla 3 — Envíos
// Spec: spec section 5 → "PANTALLA 3 — Envíos"
//
// Estructura:
//   1. Bubble + typewriter
//   2. 4 radio cards (Recojo / Domicilio / Ambos / Ninguno) con animación
//      pop al seleccionar + hermanas faded
//   3. Sub-flujo según tipo:
//      - 'recojo'    → localesList
//      - 'domicilio' → shippingGroupsList + coverageWarning
//      - 'ambos'     → localesList primero, después shippingGroupsList + coverage
//      - 'ninguno'   → sin sub-flujo
//   4. Validación al continuar:
//      - recojo / ambos: mín 1 local guardado válido
//      - domicilio / ambos: mín 1 grupo guardado válido + ningún grupo
//        guardado con regiones=[] (empty group blocks Continuar)
//      - ninguno: pasa libre
//   5. Saltar limpia locales y grupos pero PRESERVA tipo (decisión iter 2)
//
// Errors → inline + shake (no toasts). Toasts solo para info no crítica
// (ej. positive feedback). Spec sec 9 explícito: showToast NO para
// validaciones bloqueantes.
// ════════════════════════════════════════════════════════════════════════

import { renderWilly, attachReactions, attachBlink } from '../willy.js';
import { typewriter, TYPEWRITER_DELAY, shake } from '../lib/animations.js';
import { state, save } from '../store.js';
import { confirmModal } from '../wizard.js';
import { mountLocalesList } from './screen3/localesList.js';
import { mountShippingGroupsList } from './screen3/shippingGroupsList.js';
import { renderCoverageWarning } from './screen3/coverageWarning.js';
import { computeUncoveredRegions } from './screen3/regionPicker.js';

const PREGUNTA = 'Turno de contarme cómo le llegan tus productos al cliente.';

// 4 opciones presentadas como radio (single-select estricto).
//
// Política mayo 2026: UNA modalidad a la vez. Cuando el emprendedor
// selecciona una opción, las otras quedan visualmente deshabilitadas y NO
// se pueden clickear — para cambiar, primero hay que deseleccionar la
// actual (click sobre la card seleccionada). Esto evita configuraciones
// ambiguas donde el bot no sabe qué tabs mostrarle al cliente.
//
// Reintroducimos "Ambos" como una opción EXPLÍCITA (en vez de un derived
// state de recojo + domicilio), porque si el negocio realmente ofrece las
// dos modalidades el emprendedor lo declara directamente y el dashboard
// muestra los dos tabs de Envíos.
//
// El estado `state.envios.tipo` es un único string:
//   'recojo' | 'domicilio' | 'ambos' | 'ninguno' | null
const TIPOS = [
    { id: 'recojo',    titulo: 'Recojo en local',     desc: 'El cliente viene a mi tienda física.' },
    { id: 'domicilio', titulo: 'Envío a domicilio',   desc: 'Yo despacho a la dirección del cliente.' },
    { id: 'ambos',     titulo: 'Ambos',               desc: 'Ofrezco recojo en local y envío a domicilio.' },
    { id: 'ninguno',   titulo: 'No requiero envíos',  desc: 'Mi negocio es digital o solo presencial.' },
];

const VALID_TIPOS = ['recojo', 'domicilio', 'ambos', 'ninguno'];

export function renderScreen3(container, ctx) {
    state.envios = state.envios || { tipo: null, locales: [], grupos: [] };
    state.envios.locales = state.envios.locales || [];
    state.envios.grupos = state.envios.grupos || [];

    const initialTipo = state.envios.tipo;

    // Set de flags visuales — con mutex estricto solo puede tener un id.
    const flagsFromTipo = (tipo) => {
        const s = new Set();
        if (tipo && VALID_TIPOS.includes(tipo)) s.add(tipo);
        return s;
    };
    const selectedFlags = flagsFromTipo(initialTipo);

    const hasInitialSelection = selectedFlags.size > 0;
    container.innerHTML = `
        <div class="qw-scene qw-scene-stacked">
            <div class="qw-scene-head">
                ${renderWilly('señalando')}
                <div class="qw-bubble">
                    <p class="qw-bubble-text qw-bubble-text-left" id="qw-greeting"></p>
                </div>
            </div>
            <div class="qw-p3-content">
                <div class="qw-radio-grid qw-radio-grid-4col" role="radiogroup" aria-label="Tipo de entrega">
                    ${TIPOS.map(t => {
                        const isSel = selectedFlags.has(t.id);
                        const isDisabled = hasInitialSelection && !isSel;
                        const classes = [
                            'qw-radio-card',
                            isSel ? 'qw-radio-card-selected' : '',
                            isDisabled ? 'qw-radio-card-disabled' : '',
                        ].filter(Boolean).join(' ');
                        return `
                            <button type="button" class="${classes}"
                                    role="radio" aria-checked="${isSel ? 'true' : 'false'}"
                                    aria-disabled="${isDisabled ? 'true' : 'false'}"
                                    data-tipo="${t.id}">
                                <span class="qw-radio-card-title">${t.titulo}</span>
                                <span class="qw-radio-card-desc">${t.desc}</span>
                            </button>
                        `;
                    }).join('')}
                </div>
                <div class="qw-radio-hint" data-radio-hint aria-live="polite" style="${hasInitialSelection ? '' : 'display:none;'}">
                    Para cambiar de modalidad, primero deselecciona la opción actual.
                </div>
                <div class="qw-section-error" data-tipo-error role="alert" aria-live="polite"></div>
                <div class="qw-subforms" id="qw-subforms"></div>
            </div>
        </div>
    `;

    const greetEl = container.querySelector('#qw-greeting');
    let cancelTypewriter = null;
    const typewriterDelay = setTimeout(() => {
        cancelTypewriter = typewriter(greetEl, PREGUNTA, 25);
    }, TYPEWRITER_DELAY.FORM);

    // ── State del sub-flujo ──────────────────────────────────────────
    let activeTipo = initialTipo;
    const subformsEl = container.querySelector('#qw-subforms');
    const tipoErrEl = container.querySelector('[data-tipo-error]');
    let localesApi = null;
    let gruposApi = null;
    let coverageApi = null;

    const teardownSubforms = () => {
        try { localesApi?.cleanup(); } catch (e) { console.warn('[p3] locales cleanup', e); }
        try { gruposApi?.cleanup(); } catch (e) { console.warn('[p3] grupos cleanup', e); }
        try { coverageApi?.cleanup(); } catch (e) { console.warn('[p3] coverage cleanup', e); }
        localesApi = null;
        gruposApi = null;
        coverageApi = null;
        subformsEl.innerHTML = '';
    };

    const updateCoverage = () => {
        if (!coverageApi) return;
        const uncovered = computeUncoveredRegions(state.envios.grupos);
        coverageApi.update(uncovered);
    };

    const renderSubforms = (tipo) => {
        teardownSubforms();
        if (!tipo || tipo === 'ninguno') {
            // 'ninguno' no necesita sub-formularios pero SÍ hay que
            // habilitar el botón Continuar, que depende de refreshContinue().
            refreshContinue();
            return;
        }

        if (tipo === 'recojo' || tipo === 'ambos') {
            const localesContainer = document.createElement('div');
            localesContainer.className = 'qw-subform qw-subform-locales';
            subformsEl.appendChild(localesContainer);
            localesApi = mountLocalesList(localesContainer, {
                onChange: () => { localesApi?.setSectionError(''); refreshContinue(); },
            });
        }
        if (tipo === 'domicilio' || tipo === 'ambos') {
            const gruposContainer = document.createElement('div');
            gruposContainer.className = 'qw-subform qw-subform-grupos';
            subformsEl.appendChild(gruposContainer);
            gruposApi = mountShippingGroupsList(gruposContainer, {
                onChange: () => { gruposApi?.setSectionError(''); refreshContinue(); updateCoverage(); },
            });
            // Coverage warning va debajo de los grupos
            const coverageContainer = document.createElement('div');
            coverageContainer.className = 'qw-subform qw-subform-coverage';
            subformsEl.appendChild(coverageContainer);
            coverageApi = renderCoverageWarning(coverageContainer);
            updateCoverage();
        }
        refreshContinue();
    };

    // ── Validación ───────────────────────────────────────────────────
    const canContinue = () => {
        if (!activeTipo) return false;
        if (activeTipo === 'ninguno') return true;
        const needLocales = activeTipo === 'recojo' || activeTipo === 'ambos';
        const needGrupos  = activeTipo === 'domicilio' || activeTipo === 'ambos';
        if (needLocales && !localesApi?.hasSavedLocal()) return false;
        if (needGrupos) {
            if (!gruposApi?.hasSavedGroup()) return false;
            // Empty group bloquea Continuar (matiz aprobado iter 2)
            if (gruposApi?.hasEmptyGroup?.()) return false;
        }
        return true;
    };

    const refreshContinue = () => {
        const btn = document.querySelector('#qw-footer [data-action="next"]');
        if (!btn) return;
        btn.disabled = !canContinue();
    };

    const clearTipoError = () => { if (tipoErrEl) tipoErrEl.textContent = ''; };

    // ── Selección de tipo ────────────────────────────────────────────
    const radioCards = container.querySelectorAll('.qw-radio-card');
    const radioGrid = container.querySelector('.qw-radio-grid');

    // Single-select estricto: el Set tiene 0 o 1 elemento. Devuelve el id
    // único seleccionado (o null si no hay selección).
    const deriveTipo = () => {
        const arr = Array.from(selectedFlags);
        return arr.length > 0 ? arr[0] : null;
    };

    const updateRadioVisuals = (popId) => {
        const hasSelection = selectedFlags.size > 0;
        radioCards.forEach(card => {
            const cardId = card.dataset.tipo;
            const isSelected = selectedFlags.has(cardId);
            // Disabled: cualquier card NO seleccionada cuando hay una activa.
            const isDisabled = hasSelection && !isSelected;
            card.classList.toggle('qw-radio-card-selected', isSelected);
            card.classList.toggle('qw-radio-card-disabled', isDisabled);
            card.setAttribute('aria-checked', isSelected ? 'true' : 'false');
            card.setAttribute('aria-disabled', isDisabled ? 'true' : 'false');
            // pop animation solo en la card que cambió de estado
            if (cardId === popId) {
                card.classList.remove('qw-radio-card-pop');
                void card.offsetWidth;
                card.classList.add('qw-radio-card-pop');
            }
        });
        // Hint visible cuando hay selección → recuerda al usuario que para
        // cambiar tiene que deseleccionar primero.
        const hintEl = container.querySelector('[data-radio-hint]');
        if (hintEl) hintEl.style.display = hasSelection ? '' : 'none';
    };

    const selectTipo = (id) => {
        clearTipoError();

        const isCurrentlySelected = selectedFlags.has(id);
        const hasOtherSelected = selectedFlags.size > 0 && !isCurrentlySelected;

        // Mutex estricto. Si hay otra opción activa, este click no hace nada
        // — el usuario debe deseleccionar primero la actual para cambiar.
        if (hasOtherSelected) {
            // Pequeño feedback visual: shake al card disabled para indicar
            // que está bloqueado por la selección actual.
            const card = container.querySelector(`.qw-radio-card[data-tipo="${id}"]`);
            if (card) shake(card);
            return;
        }

        if (isCurrentlySelected) {
            // Toggle off — vuelve a estado vacío, las 3 cards quedan
            // disponibles de nuevo.
            selectedFlags.clear();
        } else {
            // Primera selección — agregar la opción clickeada.
            selectedFlags.clear();
            selectedFlags.add(id);
        }

        const newTipo = deriveTipo();
        if (newTipo === activeTipo) {
            updateRadioVisuals(id);
            return;
        }
        activeTipo = newTipo;
        state.envios.tipo = newTipo;
        save();
        updateRadioVisuals(id);
        renderSubforms(newTipo);
    };

    const onRadioClick = (e) => {
        const card = e.target.closest('.qw-radio-card');
        if (!card) return;
        selectTipo(card.dataset.tipo);
    };
    radioGrid.addEventListener('click', onRadioClick);

    if (initialTipo) renderSubforms(initialTipo);

    // ── Guards ───────────────────────────────────────────────────────
    ctx.setBeforeNext(() => {
        if (canContinue()) return true;

        // Validación bloqueante → inline + shake. NO toast.
        if (!activeTipo) {
            tipoErrEl.textContent = 'Elige cómo le llegan tus productos al cliente.';
            shake(radioGrid);
            return false;
        }

        const needLocales = activeTipo === 'recojo' || activeTipo === 'ambos';
        const needGrupos  = activeTipo === 'domicilio' || activeTipo === 'ambos';

        if (needGrupos) {
            if (gruposApi?.hasEmptyGroup?.()) {
                // Foco/scroll al primer grupo vacío + shake
                gruposApi.setSectionError('');
                gruposApi.focusFirstEmptyGroupPicker?.();
                return false;
            }
            if (!gruposApi?.hasSavedGroup()) {
                gruposApi?.setSectionError?.('Guardá al menos un grupo de envío para continuar.');
                gruposApi?.shakeAdd?.();
                return false;
            }
        }
        if (needLocales && !localesApi?.hasSavedLocal()) {
            // Simétrico con grupos: inline error + shake del CTA. localesList
            // expone setSectionError/shakeAdd (cerrado en iter 2 post-build).
            localesApi?.setSectionError?.('Guardá al menos un local para continuar.');
            localesApi?.shakeAdd?.();
            return false;
        }
        return false;
    });

    ctx.setBeforeSkip(async () => {
        const ok = await confirmModal({
            title: '¿Saltar envíos?',
            message: 'Si te lo saltas, Willy no podrá explicar a tus clientes cómo reciben sus productos. Puedes configurarlo después en el panel.',
            confirmText: 'Sí, saltar por ahora',
            cancelText: 'Mejor lo configuro',
        });
        if (!ok) return false;

        // Semántica aprobada (iter 2): Saltar limpia locales y grupos pero
        // PRESERVA `tipo`. Backend recibe state íntegro siempre, sin grupos
        // huérfanos o medio configurados. El usuario que vuelva a P3 ve su
        // tipo seleccionado y sub-form vacío — señal clara de "pendiente".
        state.envios.locales = [];
        state.envios.grupos = [];
        save();
        return true;
    });

    const isDirty = () => {
        if (state.envios.tipo) return true;
        if ((state.envios.locales || []).some(l =>
            l.direccion?.trim() || l.region || l.horario?.trim()
        )) return true;
        if ((state.envios.grupos || []).some(g =>
            (g.regiones || []).length > 0 || g.tiempoEntrega
        )) return true;
        return false;
    };
    ctx.setBeforeBack(async () => {
        if (!isDirty()) return true;
        return await confirmModal({
            title: '¿Volver atrás?',
            message: 'Tu configuración de envíos sigue guardada — vuelves cuando quieras.',
            confirmText: 'Sí, volver',
            cancelText: 'Quedarme',
        });
    });

    const stopReactions = attachReactions(container);
    const stopBlink = attachBlink(container, 'señalando');

    refreshContinue();

    return () => {
        clearTimeout(typewriterDelay);
        cancelTypewriter?.();
        radioGrid.removeEventListener('click', onRadioClick);
        teardownSubforms();
        stopReactions();
        stopBlink();
    };
}

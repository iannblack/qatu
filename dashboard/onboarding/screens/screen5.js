// ════════════════════════════════════════════════════════════════════════
// Pantalla 5 — Modo de interacción
// Spec: spec section 5 → "PANTALLA 5 — Modo de interacción"
//
// Estructura:
//   1. Bubble + typewriter
//   2. Disclaimer callout amarillo (info, no error)
//   3. Sección 1 — Formato de respuesta:
//      2 modo cards lado a lado. Cada una tiene su ChatPreview que
//      MUESTRA esa modalidad. Ambos previews se actualizan cuando el
//      usuario cambia tono. La elegida se resalta + badge "Recomendado"
//      en "Solo botones".
//   4. Sección 2 — Personalidad:
//      3 chips de tono (profesional / formal / casual) en pill horizontal.
//      Ya no llevan frase ejemplo debajo — el usuario ve el efecto en los
//      chat previews de arriba, que se actualizan al cambiar tono.
//
// Continuar SIEMPRE habilitado (ambas secciones tienen default).
// Saltar NO disponible (no aplica en step 5).
// Atrás sin confirm (no hay user data en riesgo — defaults siempre seteados).
//
// Cleanup return obligatorio:
//   - typewriter del bubble principal
//   - chatPreview cleanups (cancelan typewriters de ambos previews)
//   - listeners de modo grid + tono list
//   - willy reactions + blink
// ════════════════════════════════════════════════════════════════════════

import { renderWilly, attachReactions, attachBlink } from '../willy.js';
import { typewriter, TYPEWRITER_DELAY, TYPEWRITER_SPEED } from '../lib/animations.js';
import { state, save } from '../store.js';
import { escapeAttr, escapeText } from '../lib/escape.js';
import { renderChatPreview, attachChatPreview } from './screen5/chatPreview.js';

const PREGUNTA = 'Última cosa importante: ¿cómo quieres que le hable a tus clientes por WhatsApp?';

const MODOS = [
    {
        id: 'botones',
        label: 'Botones y conversacional',
        recommended: true,
        descripcion: 'Willy plantea sus preguntas con opciones numeradas para guiar la venta, pero el cliente puede responder con el número, el nombre o escribiendo libremente. El bot entiende cualquier mensaje y le contesta de forma conversacional cuando hace falta.',
    },
    {
        id: 'conversacional',
        label: 'Solo conversacional',
        recommended: false,
        descripcion: 'Willy conversa de forma abierta, como una persona real, sin opciones numeradas. Tu cliente responde naturalmente y el bot interpreta. Ideal si prefieres un trato más cálido o si cada conversación es única.',
    },
];

const TONOS = [
    { id: 'profesional', label: 'Profesional' },
    { id: 'formal',      label: 'Formal' },
    { id: 'casual',      label: 'Casual' },
];

// Mapa de migración silenciosa para state legado guardado bajo los nombres
// anteriores (cercano / chevere). El nuevo set es Profesional / Formal /
// Casual. Si encontramos un valor desconocido, default a 'casual'.
const LEGACY_TONO_MAP = {
    cercano: 'casual',
    chevere: 'casual',
};
const VALID_TONO_IDS = new Set(TONOS.map(t => t.id));

export function renderScreen5(container, ctx) {
    // Hidratación defensiva (los defaults vienen de store.js, pero por si acaso)
    state.modoInteraccion = state.modoInteraccion || 'botones';
    state.tono = state.tono || 'casual';
    // Migración silenciosa de IDs antiguos (cercano / chevere) al nuevo set.
    if (LEGACY_TONO_MAP[state.tono]) state.tono = LEGACY_TONO_MAP[state.tono];
    if (!VALID_TONO_IDS.has(state.tono)) state.tono = 'casual';

    container.innerHTML = `
        <div class="qw-scene qw-scene-stacked">
            <div class="qw-scene-head">
                ${renderWilly('sentado')}
                <div class="qw-bubble">
                    <p class="qw-bubble-text qw-bubble-text-left" id="qw-greeting"></p>
                </div>
            </div>
            <div class="qw-p5-content">
                <div class="qw-p5-disclaimer" role="note">
                    <span class="qw-p5-disclaimer-icon" aria-hidden="true">💡</span>
                    <div>
                        <strong>Importante:</strong> sin importar lo que elijas, tu cliente siempre podrá responder con números, nombres o escribiendo libremente. El bot entiende cualquier respuesta. Esto solo cambia cómo Willy <em>hace</em> las preguntas.
                    </div>
                </div>

                <div>
                    <div class="qw-subform-title">Formato de respuesta</div>
                    <div class="qw-modo-grid" role="radiogroup" aria-label="Formato de respuesta">
                        ${MODOS.map(m => `
                            <button type="button" class="qw-modo-card${state.modoInteraccion === m.id ? ' qw-modo-card-selected' : ''}"
                                    role="radio" aria-checked="${state.modoInteraccion === m.id ? 'true' : 'false'}"
                                    data-modo="${escapeAttr(m.id)}">
                                <div class="qw-modo-card-header">
                                    <span class="qw-modo-card-label">${escapeText(m.label)}</span>
                                    ${m.recommended ? '<span class="qw-modo-card-badge">Recomendado</span>' : ''}
                                </div>
                                ${renderChatPreview({ id: `preview-${m.id}` })}
                                <p class="qw-modo-card-desc">${escapeText(m.descripcion)}</p>
                            </button>
                        `).join('')}
                    </div>
                </div>

                <div>
                    <div class="qw-subform-title">¿Con qué tono quieres que hable?</div>
                    <div class="qw-tono-list" role="radiogroup" aria-label="Personalidad de Willy">
                        ${TONOS.map(t => `
                            <label class="qw-tono-card${state.tono === t.id ? ' qw-tono-card-selected' : ''}">
                                <input type="radio" name="qw-tono" value="${escapeAttr(t.id)}" ${state.tono === t.id ? 'checked' : ''}>
                                <span class="qw-tono-card-label">${escapeText(t.label)}</span>
                            </label>
                        `).join('')}
                    </div>
                </div>
            </div>
        </div>
    `;

    // ── Typewriter de la pregunta principal ──────────────────────────
    const greetEl = container.querySelector('#qw-greeting');
    let cancelGreeting = null;
    const greetingDelay = setTimeout(() => {
        cancelGreeting = typewriter(greetEl, PREGUNTA, TYPEWRITER_SPEED.BUBBLE);
    }, TYPEWRITER_DELAY.FORM);

    // ── ChatPreview por modo card ────────────────────────────────────
    // Cada card contiene SU propio preview (mostrando ese modo). El tono
    // es compartido — al cambiar tono, ambos previews actualizan.
    const previewApis = {};
    for (const m of MODOS) {
        const cardEl = container.querySelector(`[data-modo="${CSS.escape(m.id)}"]`);
        if (!cardEl) continue;
        const api = attachChatPreview(cardEl, {
            id: `preview-${m.id}`,
            initialMode: m.id,
            initialTono: state.tono,
        });
        previewApis[m.id] = api;
    }

    // ── Selección de modo ────────────────────────────────────────────
    const modoGrid = container.querySelector('.qw-modo-grid');
    const onModoClick = (e) => {
        const card = e.target.closest('[data-modo]');
        if (!card) return;
        const newModo = card.dataset.modo;
        if (state.modoInteraccion === newModo) return;
        state.modoInteraccion = newModo;
        save();
        modoGrid.querySelectorAll('[data-modo]').forEach(c => {
            const sel = c.dataset.modo === newModo;
            c.classList.toggle('qw-modo-card-selected', sel);
            c.setAttribute('aria-checked', sel ? 'true' : 'false');
        });
        // Modo change no cambia el contenido de los previews (cada preview
        // tiene su modo fijo). NO llamamos updateAllPreviews acá.
    };
    modoGrid.addEventListener('click', onModoClick);

    // ── Selección de tono ────────────────────────────────────────────
    const tonoList = container.querySelector('.qw-tono-list');
    const onTonoChange = (e) => {
        const radio = e.target.closest('[name="qw-tono"]');
        if (!radio) return;
        if (state.tono === radio.value) return;
        state.tono = radio.value;
        save();
        // Update visual selection
        tonoList.querySelectorAll('.qw-tono-card').forEach(c => {
            const cb = c.querySelector('input');
            c.classList.toggle('qw-tono-card-selected', cb?.checked);
        });
        // Update AMBOS previews — tono compartido
        for (const m of MODOS) {
            previewApis[m.id]?.update(m.id, state.tono);
        }
    };
    tonoList.addEventListener('change', onTonoChange);

    // ── Continuar siempre habilitado ─────────────────────────────────
    const refreshContinue = () => {
        const btn = document.querySelector('#qw-footer [data-action="next"]');
        if (btn) btn.disabled = false;
    };
    refreshContinue();

    // Atrás sin confirm — P5 tiene defaults siempre seteados, sin user data
    // en riesgo. No registramos beforeBack — wizard default = volver libre.

    // ── Willy reactions + blink ─────────────────────────────────────
    const stopReactions = attachReactions(container);
    const stopBlink = attachBlink(container, 'sentado');

    // ── Cleanup OBLIGATORIO ─────────────────────────────────────────
    return () => {
        clearTimeout(greetingDelay);
        cancelGreeting?.();
        modoGrid.removeEventListener('click', onModoClick);
        tonoList.removeEventListener('change', onTonoChange);
        for (const api of Object.values(previewApis)) {
            try { api.cleanup(); } catch (e) { console.warn('[p5] preview cleanup', e); }
        }
        stopReactions();
        stopBlink();
    };
}

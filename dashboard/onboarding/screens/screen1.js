// ════════════════════════════════════════════════════════════════════════
// Pantalla 1 — Identidad del negocio
// Spec: spec section 5 → "PANTALLA 1 — Identidad del negocio"
//
// Campos:
//   - nombre (required, 2–60 chars)
//   - descripcion (required, 10–200 chars)
//
// Comportamiento:
//   - Cada keystroke actualiza state.identidad.* SÍNCRONAMENTE; localStorage
//     se debounce 200ms vía store.save(). Estado siempre fresco.
//   - Render lee de state e inyecta value/textContent de los inputs — al
//     recargar, los inputs vienen pre-rellenados con lo que el usuario tenía.
//   - Continuar habilitado solo cuando ambos campos pasan validación
//     (real-time, sin esperar al click).
//   - Si por alguna razón se llega a click con datos inválidos (defensivo),
//     beforeNextGuard valida → muestra inline errors + shake + focus al
//     primer campo inválido + aborta nav.
//   - Atrás: si hay datos en cualquier campo (dirty), pide confirmación
//     antes de volver a P0.
//   - Sin "Saltar" (no aplica a este paso).
//   - Enter en input NO submite el formulario (spec 9.2 caso 14).
//
// Cleanup: remueve listeners de inputs/form, libera willy reactions y blink.
// ════════════════════════════════════════════════════════════════════════

import { renderWilly, attachReactions, attachBlink } from '../willy.js';
import { shake } from '../lib/animations.js';
import { escapeAttr, escapeText } from '../lib/escape.js';
import { state, save } from '../store.js';
import { confirmModal } from '../wizard.js';
import { schedulePushWillyIdentidadToServer } from '../lib/wizardServerSync.js';

const PREGUNTA = 'Vamos a configurar tu tienda. Para empezar, cuéntame: ¿cómo se llama tu negocio y a qué se dedica?';

// Validators — devuelven null si OK, o string con mensaje de error.
const validators = {
    nombre: (v) => {
        const s = String(v ?? '').trim();
        if (s.length < 2)  return 'Necesito un nombre, aunque sea cortito';
        if (s.length > 60) return 'Máximo 60 caracteres';
        return null;
    },
    descripcion: (v) => {
        const s = String(v ?? '').trim();
        if (s.length < 10)  return 'Cuéntame un poquito más, así sé qué vender';
        if (s.length > 200) return 'Máximo 200 caracteres';
        return null;
    },
};

export function renderScreen1(container, ctx) {
    if (!state.identidad || typeof state.identidad !== 'object') {
        state.identidad = { nombre: '', descripcion: '' };
        save();
    }
    const initialNombre = state.identidad.nombre || '';
    const initialDesc = state.identidad.descripcion || '';

    container.innerHTML = `
        <div class="qw-scene">
            ${renderWilly('sentado')}
            <div class="qw-right">
                <div class="qw-bubble" role="dialog" aria-labelledby="qw-greeting">
                    <p class="qw-bubble-text qw-bubble-text-left" id="qw-greeting">${escapeText(PREGUNTA)}</p>
                </div>
                <form class="qw-form" id="qw-identidad-form" novalidate aria-label="Identidad del negocio">
                    <div class="qw-field" style="animation-delay: 0.55s">
                        <label class="qw-label" for="qw-input-nombre">Nombre del negocio *</label>
                        <input class="qw-input" id="qw-input-nombre" name="nombre" type="text"
                               placeholder="Ej: Ceviches de Don Pepe"
                               autocomplete="organization"
                               maxlength="80"
                               aria-describedby="qw-input-nombre-error"
                               value="${escapeAttr(initialNombre)}">
                        <div class="qw-error" id="qw-input-nombre-error" role="alert" aria-live="polite"></div>
                    </div>
                    <div class="qw-field" style="animation-delay: 0.7s">
                        <label class="qw-label" for="qw-input-desc">Descripción *</label>
                        <textarea class="qw-textarea" id="qw-input-desc" name="descripcion"
                                  rows="3"
                                  placeholder="Cuéntame en una frase qué vendes y qué te hace especial"
                                  maxlength="220"
                                  aria-describedby="qw-input-desc-helper qw-input-desc-error">${escapeText(initialDesc)}</textarea>
                        <div class="qw-helper" id="qw-input-desc-helper">
                            Esto ayuda a Willy a saber cómo presentarse a tus clientes.
                        </div>
                        <div class="qw-error" id="qw-input-desc-error" role="alert" aria-live="polite"></div>
                    </div>
                </form>
            </div>
        </div>
    `;

    // ── Refs ──────────────────────────────────────────────────────────
    const form = container.querySelector('#qw-identidad-form');
    const nombreEl = container.querySelector('#qw-input-nombre');
    const descEl = container.querySelector('#qw-input-desc');
    const nombreErrEl = container.querySelector('#qw-input-nombre-error');
    const descErrEl = container.querySelector('#qw-input-desc-error');

    // ── Helpers de error UI ───────────────────────────────────────────
    const setFieldError = (inputEl, errEl, message) => {
        errEl.textContent = message || '';
        if (message) {
            inputEl.classList.add('qw-input-error');
            inputEl.setAttribute('aria-invalid', 'true');
        } else {
            inputEl.classList.remove('qw-input-error');
            inputEl.setAttribute('aria-invalid', 'false');
        }
    };
    const clearFieldErrorIfFixed = (inputEl, errEl, validator) => {
        if (errEl.textContent && validator(inputEl.value) === null) {
            setFieldError(inputEl, errEl, null);
        }
    };

    // ── Refresh del botón Continuar (real-time enable) ────────────────
    // Re-consultamos el footer cada vez porque el wizard.js lo regenera al
    // cambiar de paso — pero dentro de este paso, la ref sigue viva.
    const refreshContinue = () => {
        const btn = document.querySelector('#qw-footer [data-action="next"]');
        if (!btn) return;
        const nombreOk = validators.nombre(state.identidad.nombre) === null;
        const descOk = validators.descripcion(state.identidad.descripcion) === null;
        btn.disabled = !(nombreOk && descOk);
    };

    // ── Input handlers — sync state + clear errors si está corrigiendo ──
    const onNombreInput = () => {
        state.identidad.nombre = nombreEl.value;
        save();
        schedulePushWillyIdentidadToServer();
        clearFieldErrorIfFixed(nombreEl, nombreErrEl, validators.nombre);
        refreshContinue();
    };
    const onDescInput = () => {
        state.identidad.descripcion = descEl.value;
        save();
        schedulePushWillyIdentidadToServer();
        clearFieldErrorIfFixed(descEl, descErrEl, validators.descripcion);
        refreshContinue();
    };
    nombreEl.addEventListener('input', onNombreInput);
    descEl.addEventListener('input', onDescInput);

    // ── Enter en input NO submite (spec 9.2 caso 14) ─────────────────
    // Sin esto, Enter dispararía submit implícito del form. Lo cazamos a
    // nivel form para cubrir tanto input como textarea (textarea ya inserta
    // newline en Enter, pero cubrir ambos por consistencia).
    const onSubmit = (e) => { e.preventDefault(); };
    form.addEventListener('submit', onSubmit);

    // ── Guard de Continuar — backstop defensivo ──────────────────────
    // El botón está deshabilitado cuando hay error → en uso normal este
    // guard solo aprueba. Pero si por alguna razón el click llega con
    // datos inválidos (race, desync), validamos, mostramos errores con
    // shake y abortamos.
    ctx.setBeforeNext(() => {
        const nombreErr = validators.nombre(state.identidad.nombre);
        const descErr = validators.descripcion(state.identidad.descripcion);
        if (!nombreErr && !descErr) return true;

        if (nombreErr) {
            setFieldError(nombreEl, nombreErrEl, nombreErr);
            shake(nombreEl);
        }
        if (descErr) {
            setFieldError(descEl, descErrEl, descErr);
            shake(descEl);
        }
        // Foco al primer campo inválido — a11y + UX
        (nombreErr ? nombreEl : descEl).focus();
        return false;
    });

    // ── Guard de Atrás — dirty-check ─────────────────────────────────
    const isDirty = () => {
        const n = (state.identidad.nombre || '').trim();
        const d = (state.identidad.descripcion || '').trim();
        return n !== '' || d !== '';
    };
    ctx.setBeforeBack(async () => {
        if (!isDirty()) return true;
        return await confirmModal({
            title: '¿Volver atrás?',
            message: 'Tus respuestas siguen guardadas — vuelves cuando quieras.',
            confirmText: 'Sí, volver',
            cancelText: 'Quedarme',
        });
    });

    // ── Willy reactions + blink ──────────────────────────────────────
    const stopReactions = attachReactions(container);
    const stopBlink = attachBlink(container, 'sentado');

    // Estado inicial del botón Continuar (puede que el state recargado de
    // localStorage ya tenga datos válidos → habilita inmediatamente).
    refreshContinue();

    // ── Cleanup OBLIGATORIO ──────────────────────────────────────────
    return () => {
        nombreEl.removeEventListener('input', onNombreInput);
        descEl.removeEventListener('input', onDescInput);
        form.removeEventListener('submit', onSubmit);
        stopReactions();
        stopBlink();
        // No es necesario limpiar guards explícitamente: wizard.js los
        // resetea automáticamente en el próximo renderScreen().
    };
}

// ════════════════════════════════════════════════════════════════════════
// Pantalla 4 — Métodos de pago
// Spec: spec section 5 → "PANTALLA 4 — Métodos de pago"
//
// Estructura:
//   1. Bubble + typewriter
//   2. 5 cards multi-select (Yape/Plin/Transfer/Tarjeta/Efectivo) con
//      bounce animation + SVG check drawing al toggle
//   3. Stack vertical de forms para los métodos marcados (debajo de las cards)
//   4. Comprobante radio (Boleta/Factura/Ambas/Ninguna)
//
// Validación al continuar:
//   - mín 1 método marcado
//   - cada método marcado con datos válidos (validate() del módulo)
//   - comprobante seleccionado
//   Si falla: inline error en sección específica + shake. NO toast.
//
// No tiene Saltar (paso crítico — sin métodos no se puede vender).
//
// State shape:
//   state.pagos = {
//     metodos: [{ tipo, datos }, ...],
//     comprobante: 'boleta' | 'factura' | 'ambas' | 'ninguna' | null,
//   }
//
// Cleanup pattern:
//   moduleCleanups: Map<methodId, { card: fn, form?: { cleanup, showErrors } }>
//   Cada card tiene su listener (toggle). Cada form montado tiene sus
//   listeners de inputs + showErrors API. Al desmontar el form (toggle off
//   o cambio de screen), invocamos su cleanup; al desmontar la screen,
//   iteramos el Map completo y limpiamos todo.
// ════════════════════════════════════════════════════════════════════════

import { renderWilly, attachReactions, attachBlink } from '../willy.js';
import { typewriter, TYPEWRITER_DELAY, shake } from '../lib/animations.js';
import { state, save } from '../store.js';
import { confirmModal } from '../wizard.js';
import { escapeAttr, escapeText } from '../lib/escape.js';

import { renderMethodCard, attachMethodCard, METHODS } from './screen4/methodCard.js';
import { renderWalletForm, attachWalletForm, validateWallet } from './screen4/walletForm.js';
import { renderTransferForm, attachTransferForm, validateTransfer } from './screen4/transferForm.js';
import { renderCardForm, attachCardForm, validateCard } from './screen4/cardForm.js';
import { renderCashForm, attachCashForm, validateCash } from './screen4/cashForm.js';

const PREGUNTA = '¿Qué métodos de pago aceptas? Selecciona todos los que apliquen y completa los datos correspondientes.';

const COMPROBANTES = [
    { id: 'boleta',  label: 'Boleta' },
    { id: 'factura', label: 'Factura' },
    { id: 'ambas',   label: 'Ambas' },
    { id: 'ninguna', label: 'Ninguna por ahora' },
];

// Defaults por método — usados al marcar un método por primera vez
function defaultDataFor(tipo) {
    switch (tipo) {
        case 'yape':
        case 'plin':          return { nombre: '', celular: '' };
        case 'transferencia': return { banco: '', titular: '', numero: '', cci: '' };
        case 'tarjeta':       return { como: '', linkBase: '', descripcionOtro: '' };
        case 'efectivo':      return { momentos: [] };
        default:              return {};
    }
}

// Mapping método → módulo de form. Centraliza el render/attach/validate
// por tipo para que el orchestrator solo despache, no conozca detalles.
const FORM_MODULES = {
    yape: {
        render:   (datos) => renderWalletForm({ method: 'yape', datos }),
        attach:   attachWalletForm,
        validate: validateWallet,
    },
    plin: {
        render:   (datos) => renderWalletForm({ method: 'plin', datos }),
        attach:   attachWalletForm,
        validate: validateWallet,
    },
    transferencia: {
        render:   (datos) => renderTransferForm({ datos }),
        attach:   attachTransferForm,
        validate: validateTransfer,
    },
    tarjeta: {
        render:   (datos) => renderCardForm({ datos }),
        attach:   attachCardForm,
        validate: validateCard,
    },
    efectivo: {
        render:   (datos) => renderCashForm({ datos }),
        attach:   attachCashForm,
        validate: validateCash,
    },
};

export function renderScreen4(container, ctx) {
    // ── Hidratación defensiva ─────────────────────────────────────────
    state.pagos = state.pagos || { metodos: [], comprobante: null };
    state.pagos.metodos = Array.isArray(state.pagos.metodos) ? state.pagos.metodos : [];
    if (!('comprobante' in state.pagos)) state.pagos.comprobante = null;
    // Asegurar que cada método persistido tenga datos object (compat con state viejo)
    state.pagos.metodos = state.pagos.metodos.map(m => ({
        tipo: m.tipo,
        datos: { ...defaultDataFor(m.tipo), ...(m.datos || {}) },
    }));

    container.innerHTML = `
        <div class="qw-scene qw-scene-stacked">
            <div class="qw-scene-head">
                ${renderWilly('sentado')}
                <div class="qw-bubble">
                    <p class="qw-bubble-text qw-bubble-text-left" id="qw-greeting"></p>
                </div>
            </div>
            <div class="qw-p4-content">
                <div class="qw-payment-methods-section">
                    <div class="qw-section-error" data-methods-error role="alert" aria-live="polite"></div>
                    <div class="qw-payment-cards-grid" data-cards-grid role="group" aria-label="Métodos de pago">
                        ${METHODS.map(m => {
                            const checked = state.pagos.metodos.some(x => x.tipo === m.id);
                            return renderMethodCard({ id: m.id, label: m.label, icon: m.icon, checked });
                        }).join('')}
                    </div>
                    <div class="qw-payment-forms" data-forms-container></div>
                </div>
                <div class="qw-comprobante-section">
                    <div class="qw-subform-title">¿Entregas comprobante? *</div>
                    <div class="qw-radio-list qw-radio-list-horizontal" role="radiogroup" data-comprobante-group>
                        ${COMPROBANTES.map(c => `
                            <label class="qw-radio-option">
                                <input type="radio" name="qw-comprobante" value="${escapeAttr(c.id)}" ${state.pagos.comprobante === c.id ? 'checked' : ''}>
                                <span>${escapeText(c.label)}</span>
                            </label>
                        `).join('')}
                    </div>
                    <div class="qw-section-error" data-comprobante-error role="alert" aria-live="polite"></div>
                </div>
            </div>
        </div>
    `;

    // ── Refs ─────────────────────────────────────────────────────────
    const greetEl = container.querySelector('#qw-greeting');
    const cardsGrid = container.querySelector('[data-cards-grid]');
    const formsContainer = container.querySelector('[data-forms-container]');
    const comprobanteGroup = container.querySelector('[data-comprobante-group]');
    const methodsErrEl = container.querySelector('[data-methods-error]');
    const comprobanteErrEl = container.querySelector('[data-comprobante-error]');

    // ── Typewriter ──────────────────────────────────────────────────
    let cancelTypewriter = null;
    const typewriterDelay = setTimeout(() => {
        cancelTypewriter = typewriter(greetEl, PREGUNTA, 25);
    }, TYPEWRITER_DELAY.FORM);

    // ── Cleanup registry ────────────────────────────────────────────
    // Por cada método: { card: cleanup, form?: { cleanup, showErrors } }
    const moduleCleanups = new Map();

    // ── State helpers ───────────────────────────────────────────────
    const getMethodData = (tipo) => state.pagos.metodos.find(m => m.tipo === tipo)?.datos;

    const ensureMethod = (tipo) => {
        let m = state.pagos.metodos.find(x => x.tipo === tipo);
        if (!m) {
            m = { tipo, datos: defaultDataFor(tipo) };
            state.pagos.metodos.push(m);
            save();
        }
        return m;
    };
    const removeMethod = (tipo) => {
        state.pagos.metodos = state.pagos.metodos.filter(m => m.tipo !== tipo);
        save();
    };

    // ── Error UI ────────────────────────────────────────────────────
    const clearMethodsError = () => { if (methodsErrEl) methodsErrEl.textContent = ''; };
    const clearComprobanteError = () => { if (comprobanteErrEl) comprobanteErrEl.textContent = ''; };

    // ── Form mount/unmount con animación ────────────────────────────
    const mountFormFor = (tipo) => {
        const moduleDef = FORM_MODULES[tipo];
        if (!moduleDef) return;
        const datos = getMethodData(tipo);
        if (!datos) return;
        // Wrapper para animaciones de mount/unmount sin tocar el form interno
        const wrapper = document.createElement('div');
        wrapper.className = 'qw-payment-form-wrapper';
        wrapper.dataset.methodWrapper = tipo;
        wrapper.innerHTML = moduleDef.render(datos);
        formsContainer.appendChild(wrapper);
        if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            wrapper.animate(
                [
                    { opacity: 0, transform: 'translateY(-12px)' },
                    { opacity: 1, transform: 'translateY(0)' },
                ],
                { duration: 250, easing: 'ease-out' }
            );
        }
        const formEl = wrapper.querySelector('.qw-payment-form');
        const api = moduleDef.attach(formEl, datos, {
            onChange: () => { clearMethodsError(); save(); refreshContinue(); },
        });
        const existing = moduleCleanups.get(tipo) || {};
        moduleCleanups.set(tipo, { ...existing, form: api });
    };

    const unmountFormFor = (tipo) => {
        const existing = moduleCleanups.get(tipo);
        if (existing?.form?.cleanup) {
            try { existing.form.cleanup(); } catch (e) { console.warn('[p4] form cleanup', e); }
        }
        if (existing) {
            // Mantener cardCleanup; borrar solo el form
            moduleCleanups.set(tipo, { card: existing.card });
        }
        const wrapper = formsContainer.querySelector(`[data-method-wrapper="${CSS.escape(tipo)}"]`);
        if (!wrapper) return;
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            wrapper.remove();
            return;
        }
        const startHeight = wrapper.offsetHeight;
        const flexGapPx = parseFloat(getComputedStyle(formsContainer).gap) || 0;
        const anim = wrapper.animate(
            [
                { opacity: 1, height: startHeight + 'px', marginTop: '0px' },
                { opacity: 0, height: '0px', marginTop: `-${flexGapPx}px` },
            ],
            { duration: 250, easing: 'ease-in', fill: 'forwards' }
        );
        anim.addEventListener('finish', () => wrapper.remove());
    };

    // ── Wiring de las 5 cards ───────────────────────────────────────
    METHODS.forEach(m => {
        const cardEl = cardsGrid.querySelector(`[data-method="${CSS.escape(m.id)}"]`);
        if (!cardEl) return;
        const cardCleanup = attachMethodCard(cardEl, {
            onToggle: (newChecked) => {
                clearMethodsError();
                cardEl.classList.toggle('qw-checked', newChecked);
                cardEl.setAttribute('aria-checked', newChecked ? 'true' : 'false');
                if (newChecked) {
                    ensureMethod(m.id);
                    mountFormFor(m.id);
                } else {
                    removeMethod(m.id);
                    unmountFormFor(m.id);
                }
                refreshContinue();
            },
        });
        moduleCleanups.set(m.id, { card: cardCleanup });
    });

    // ── Hidratación: montar forms de métodos ya marcados ─────────────
    state.pagos.metodos.forEach(m => {
        if (FORM_MODULES[m.tipo]) mountFormFor(m.tipo);
    });

    // ── Comprobante radio ───────────────────────────────────────────
    const onComprobanteChange = (e) => {
        const radio = e.target.closest('[name="qw-comprobante"]');
        if (!radio) return;
        state.pagos.comprobante = radio.value;
        save();
        clearComprobanteError();
        refreshContinue();
    };
    comprobanteGroup.addEventListener('change', onComprobanteChange);

    // ── Validación + Continuar ──────────────────────────────────────
    const canContinue = () => {
        if (state.pagos.metodos.length === 0) return false;
        for (const m of state.pagos.metodos) {
            const moduleDef = FORM_MODULES[m.tipo];
            if (!moduleDef) return false;
            if (moduleDef.validate(m.datos)) return false;
        }
        if (!state.pagos.comprobante) return false;
        return true;
    };

    const refreshContinue = () => {
        const btn = document.querySelector('#qw-footer [data-action="next"]');
        if (!btn) return;
        btn.disabled = !canContinue();
    };

    // ── Guards ──────────────────────────────────────────────────────
    ctx.setBeforeNext(() => {
        if (canContinue()) return true;

        // Inline error + shake en la sección específica que falla.
        // NO usamos toast — convención iter 2: bloqueante = inline.

        if (state.pagos.metodos.length === 0) {
            methodsErrEl.textContent = 'Marca al menos un método de pago.';
            shake(cardsGrid);
            return false;
        }
        // Validar cada método marcado y mostrar errores en el form específico
        for (const m of state.pagos.metodos) {
            const moduleDef = FORM_MODULES[m.tipo];
            if (!moduleDef) continue;
            const errors = moduleDef.validate(m.datos);
            if (errors) {
                const api = moduleCleanups.get(m.tipo)?.form;
                api?.showErrors?.(errors);
                const wrapper = formsContainer.querySelector(`[data-method-wrapper="${CSS.escape(m.tipo)}"]`);
                if (wrapper) {
                    wrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    shake(wrapper);
                }
                return false;
            }
        }
        if (!state.pagos.comprobante) {
            comprobanteErrEl.textContent = 'Elige si entregas comprobante.';
            shake(comprobanteGroup);
            comprobanteGroup.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return false;
        }
        return false;
    });

    // No setBeforeSkip — Saltar no aplica en P4 (ya filtrado por wizard.js
    // renderFooter: canSkip = step === 2 || step === 3).

    ctx.setBeforeBack(async () => {
        const isDirty = state.pagos.metodos.length > 0 || !!state.pagos.comprobante;
        if (!isDirty) return true;
        return await confirmModal({
            title: '¿Volver atrás?',
            message: 'Tu configuración de pagos sigue guardada — vuelves cuando quieras.',
            confirmText: 'Sí, volver',
            cancelText: 'Quedarme',
        });
    });

    // ── Willy reactions + blink ─────────────────────────────────────
    const stopReactions = attachReactions(container);
    const stopBlink = attachBlink(container, 'sentado');

    refreshContinue();

    // ── Cleanup OBLIGATORIO ─────────────────────────────────────────
    return () => {
        clearTimeout(typewriterDelay);
        cancelTypewriter?.();
        comprobanteGroup.removeEventListener('change', onComprobanteChange);
        for (const entry of moduleCleanups.values()) {
            try { entry.card?.(); } catch (e) { console.warn('[p4] card cleanup', e); }
            try { entry.form?.cleanup?.(); } catch (e) { console.warn('[p4] form cleanup', e); }
        }
        moduleCleanups.clear();
        stopReactions();
        stopBlink();
    };
}

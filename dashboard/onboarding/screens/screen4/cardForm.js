// ════════════════════════════════════════════════════════════════════════
// cardForm — Tarjeta. Tiene campos condicionales según selección de "cómo":
//   link → input opcional "Link de pago base"
//   pos  → sin campos extra
//   otro → textarea descripción required
//
// Patrón "conditional fields" (mismo de shippingGroupCard sección modalidad):
// re-render parcial del slot [data-conditional-fields] + re-attach de
// listeners vía Map conditionalHandlers.
// ════════════════════════════════════════════════════════════════════════

import { escapeAttr, escapeText } from '../../lib/escape.js';

const COMOS = [
    { id: 'link', label: 'Link de pago (Culqi, Mercado Pago, Izipay, etc.)' },
    { id: 'pos',  label: 'POS físico al entregar' },
    { id: 'otro', label: 'Otro' },
];

const validators = {
    como: (v) => !v ? 'Elige cómo cobras con tarjeta' : null,
    descripcionOtro: (v, datos) => {
        if (datos.como !== 'otro') return null;
        return String(v ?? '').trim().length < 3 ? 'Cuéntame brevemente cómo cobras' : null;
    },
};

export function validateCard(datos) {
    const errors = {};
    const cE = validators.como(datos.como);
    if (cE) errors.como = cE;
    const dE = validators.descripcionOtro(datos.descripcionOtro, datos);
    if (dE) errors.descripcionOtro = dE;
    return Object.keys(errors).length === 0 ? null : errors;
}

function renderConditionalFields(datos) {
    if (datos.como === 'link') {
        return `
            <div class="qw-field">
                <label class="qw-label" for="qw-card-link">Link de pago base (opcional)</label>
                <input class="qw-input" data-field="linkBase" id="qw-card-link"
                       type="url" maxlength="500"
                       value="${escapeAttr(datos.linkBase || '')}"
                       placeholder="https://...">
                <div class="qw-helper">Si tienes uno fijo. Si no, lo generas por pedido.</div>
            </div>
        `;
    }
    if (datos.como === 'otro') {
        return `
            <div class="qw-field">
                <label class="qw-label" for="qw-card-desc">Descripción *</label>
                <textarea class="qw-textarea" data-field="descripcionOtro" id="qw-card-desc"
                          rows="2" maxlength="220"
                          aria-describedby="err-card-desc">${escapeText(datos.descripcionOtro || '')}</textarea>
                <div class="qw-error" data-error="descripcionOtro" id="err-card-desc" role="alert" aria-live="polite"></div>
            </div>
        `;
    }
    return '';
}

export function renderCardForm({ datos }) {
    return `
        <div class="qw-payment-form" data-method="tarjeta">
            <div class="qw-payment-form-title">Tarjeta — Cómo cobras</div>
            <div class="qw-field">
                <div class="qw-label">¿Cómo cobras con tarjeta? *</div>
                <div class="qw-radio-list" role="radiogroup" data-como-group>
                    ${COMOS.map(o => `
                        <label class="qw-radio-option">
                            <input type="radio" name="qw-card-como" data-field="como" value="${escapeAttr(o.id)}" ${datos.como === o.id ? 'checked' : ''}>
                            <span>${escapeText(o.label)}</span>
                        </label>
                    `).join('')}
                </div>
                <div class="qw-error" data-error="como" role="alert" aria-live="polite"></div>
            </div>
            <div data-conditional-fields>
                ${renderConditionalFields(datos)}
            </div>
        </div>
    `;
}

export function attachCardForm(formEl, datos, { onChange } = {}) {
    const cleanups = [];
    const conditionalEl = formEl.querySelector('[data-conditional-fields]');
    const conditionalHandlers = new Map();

    // Wiring "como" radio
    const comoGroup = formEl.querySelector('[data-como-group]');
    const onComoChange = (e) => {
        const radio = e.target.closest('[data-field="como"]');
        if (!radio) return;
        datos.como = radio.value;
        // Limpiar campos de otras opciones (evita basura en state)
        if (datos.como !== 'link') datos.linkBase = '';
        if (datos.como !== 'otro') datos.descripcionOtro = '';
        // Limpiar error de "como"
        const comoErr = formEl.querySelector('[data-error="como"]');
        if (comoErr) comoErr.textContent = '';
        // Re-render conditional fields + re-attach
        conditionalEl.innerHTML = renderConditionalFields(datos);
        wireConditionalFields();
        onChange?.();
    };
    comoGroup?.addEventListener('change', onComoChange);
    cleanups.push(() => comoGroup?.removeEventListener('change', onComoChange));

    // Re-attach helper para conditional fields
    const wireConditionalFields = () => {
        for (const [el, handler] of conditionalHandlers.entries()) {
            el.removeEventListener('input', handler);
        }
        conditionalHandlers.clear();
        for (const f of ['linkBase', 'descripcionOtro']) {
            const el = formEl.querySelector(`[data-field="${f}"]`);
            if (!el) continue;
            const handler = () => {
                datos[f] = el.value;
                const errEl = formEl.querySelector(`[data-error="${f}"]`);
                if (errEl && errEl.textContent && validators[f] && !validators[f](el.value, datos)) {
                    errEl.textContent = '';
                    el.classList.remove('qw-input-error');
                    el.setAttribute('aria-invalid', 'false');
                }
                onChange?.();
            };
            el.addEventListener('input', handler);
            conditionalHandlers.set(el, handler);
        }
    };
    wireConditionalFields(); // initial wiring
    cleanups.push(() => {
        for (const [el, handler] of conditionalHandlers.entries()) {
            el.removeEventListener('input', handler);
        }
        conditionalHandlers.clear();
    });

    return {
        cleanup: () => cleanups.forEach(fn => fn()),
        showErrors: (errors) => {
            for (const [field, msg] of Object.entries(errors)) {
                if (field === 'como') {
                    const errEl = formEl.querySelector('[data-error="como"]');
                    if (errEl) errEl.textContent = msg;
                    continue;
                }
                const inputEl = formEl.querySelector(`[data-field="${field}"]`);
                const errEl = formEl.querySelector(`[data-error="${field}"]`);
                if (errEl) errEl.textContent = msg;
                if (inputEl) {
                    inputEl.classList.add('qw-input-error');
                    inputEl.setAttribute('aria-invalid', 'true');
                }
            }
        },
    };
}

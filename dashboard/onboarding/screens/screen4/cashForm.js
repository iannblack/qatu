// ════════════════════════════════════════════════════════════════════════
// cashForm — Efectivo. Multi-check de "cuándo cobras" (mín 1).
// ════════════════════════════════════════════════════════════════════════

import { escapeAttr, escapeText } from '../../lib/escape.js';

const MOMENTOS = [
    { id: 'contraentrega', label: 'Al entregar (contraentrega)' },
    { id: 'recojo',        label: 'Al recoger en local' },
    { id: 'adelanto',      label: 'Adelanto antes del envío' },
];

const validators = {
    momentos: (v) => !Array.isArray(v) || v.length === 0 ? 'Elige al menos cuándo cobras en efectivo' : null,
};

export function validateCash(datos) {
    const errors = {};
    const e = validators.momentos(datos.momentos);
    if (e) errors.momentos = e;
    return Object.keys(errors).length === 0 ? null : errors;
}

export function renderCashForm({ datos }) {
    const momentos = Array.isArray(datos.momentos) ? datos.momentos : [];
    return `
        <div class="qw-payment-form" data-method="efectivo">
            <div class="qw-payment-form-title">Efectivo — Cuándo cobras</div>
            <div class="qw-field">
                <div class="qw-label">¿Cuándo cobras en efectivo? * (puedes marcar varias)</div>
                <div class="qw-check-list" data-momentos-group>
                    ${MOMENTOS.map(m => `
                        <label class="qw-check-option">
                            <input type="checkbox" data-field="momentos" value="${escapeAttr(m.id)}" ${momentos.includes(m.id) ? 'checked' : ''}>
                            <span>${escapeText(m.label)}</span>
                        </label>
                    `).join('')}
                </div>
                <div class="qw-error" data-error="momentos" role="alert" aria-live="polite"></div>
            </div>
        </div>
    `;
}

export function attachCashForm(formEl, datos, { onChange } = {}) {
    if (!Array.isArray(datos.momentos)) datos.momentos = [];
    const group = formEl.querySelector('[data-momentos-group]');
    const handler = (e) => {
        const cb = e.target.closest('[data-field="momentos"]');
        if (!cb) return;
        if (cb.checked) {
            if (!datos.momentos.includes(cb.value)) datos.momentos.push(cb.value);
        } else {
            datos.momentos = datos.momentos.filter(m => m !== cb.value);
        }
        // Limpiar error si ahora tiene ≥1
        const errEl = formEl.querySelector('[data-error="momentos"]');
        if (errEl && errEl.textContent && datos.momentos.length > 0) {
            errEl.textContent = '';
        }
        onChange?.();
    };
    group?.addEventListener('change', handler);
    return {
        cleanup: () => group?.removeEventListener('change', handler),
        showErrors: (errors) => {
            for (const [field, msg] of Object.entries(errors)) {
                const errEl = formEl.querySelector(`[data-error="${field}"]`);
                if (errEl) errEl.textContent = msg;
            }
        },
    };
}

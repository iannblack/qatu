// ════════════════════════════════════════════════════════════════════════
// walletForm — compartido entre Yape y Plin (campos idénticos por spec).
// Pasamos `method: 'yape' | 'plin'` para etiqueta y para nombrar los ids
// del DOM (evita colisiones si ambos están abiertos a la vez).
//
// API estándar de form modules:
//   renderWalletForm({ method, datos }): string HTML
//   attachWalletForm(formEl, datos, { onChange }): { cleanup, showErrors }
//   validateWallet(datos): null | { fieldName: msg }
// ════════════════════════════════════════════════════════════════════════

import { escapeAttr, escapeText } from '../../lib/escape.js';

const validators = {
    nombre: (v) => {
        const s = String(v ?? '').trim();
        if (s.length < 2) return 'Necesito el nombre completo del titular';
        return null;
    },
    celular: (v) => {
        const s = String(v ?? '').trim();
        if (!/^9\d{8}$/.test(s)) return 'Celular válido: 9 dígitos empezando con 9';
        return null;
    },
};

export function validateWallet(datos) {
    const errors = {};
    const nE = validators.nombre(datos.nombre);
    const cE = validators.celular(datos.celular);
    if (nE) errors.nombre = nE;
    if (cE) errors.celular = cE;
    return Object.keys(errors).length === 0 ? null : errors;
}

export function renderWalletForm({ method, datos }) {
    const label = method === 'yape' ? 'Yape' : 'Plin';
    const idPrefix = `qw-${escapeAttr(method)}`;
    return `
        <div class="qw-payment-form" data-method="${escapeAttr(method)}">
            <div class="qw-payment-form-title">${escapeText(label)} — Datos de pago</div>
            <div class="qw-field">
                <label class="qw-label" for="${idPrefix}-nombre">Nombre completo del titular *</label>
                <input class="qw-input" data-field="nombre" id="${idPrefix}-nombre"
                       type="text" maxlength="80"
                       value="${escapeAttr(datos.nombre || '')}"
                       placeholder="Como aparece en la app de ${escapeAttr(label)}"
                       aria-describedby="err-${idPrefix}-nombre">
                <div class="qw-error" data-error="nombre" id="err-${idPrefix}-nombre" role="alert" aria-live="polite"></div>
            </div>
            <div class="qw-field">
                <label class="qw-label" for="${idPrefix}-celular">Celular *</label>
                <input class="qw-input" data-field="celular" id="${idPrefix}-celular"
                       type="tel" inputmode="numeric" maxlength="9"
                       value="${escapeAttr(datos.celular || '')}"
                       placeholder="9XXXXXXXX"
                       aria-describedby="err-${idPrefix}-celular">
                <div class="qw-error" data-error="celular" id="err-${idPrefix}-celular" role="alert" aria-live="polite"></div>
            </div>
        </div>
    `;
}

export function attachWalletForm(formEl, datos, { onChange } = {}) {
    const cleanups = [];
    for (const f of ['nombre', 'celular']) {
        const el = formEl.querySelector(`[data-field="${f}"]`);
        if (!el) continue;
        const handler = () => {
            datos[f] = el.value;
            // Limpiar error inline si el valor ahora es válido (no muestra
            // errores en blur — solo en submit; matching P1 behavior)
            const errEl = formEl.querySelector(`[data-error="${f}"]`);
            if (errEl && errEl.textContent && validators[f] && !validators[f](el.value)) {
                errEl.textContent = '';
                el.classList.remove('qw-input-error');
                el.setAttribute('aria-invalid', 'false');
            }
            onChange?.();
        };
        el.addEventListener('input', handler);
        cleanups.push(() => el.removeEventListener('input', handler));
    }
    return {
        cleanup: () => cleanups.forEach(fn => fn()),
        showErrors: (errors) => {
            for (const [field, msg] of Object.entries(errors)) {
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

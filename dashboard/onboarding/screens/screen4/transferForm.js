// ════════════════════════════════════════════════════════════════════════
// transferForm — Transferencia bancaria
//
// Campos: banco (dropdown required), titular (text required), número de
// cuenta (text required), CCI (text optional).
//
// API estándar: renderTransferForm, attachTransferForm, validateTransfer
// ════════════════════════════════════════════════════════════════════════

import { escapeAttr, escapeText } from '../../lib/escape.js';

const BANCOS = [
    'BCP', 'BBVA', 'Interbank', 'Scotiabank',
    'BanBif', 'Pichincha', 'GNB', 'Falabella', 'Otro',
];

const validators = {
    banco: (v) => !v || String(v).trim() === '' ? 'Elige el banco' : null,
    titular: (v) => String(v ?? '').trim().length < 2 ? 'Necesito el nombre del titular' : null,
    numero: (v) => String(v ?? '').trim() === '' ? 'Necesito el número de cuenta' : null,
    // cci es opcional — sin validator
};

export function validateTransfer(datos) {
    const errors = {};
    for (const f of ['banco', 'titular', 'numero']) {
        const e = validators[f]?.(datos[f]);
        if (e) errors[f] = e;
    }
    return Object.keys(errors).length === 0 ? null : errors;
}

export function renderTransferForm({ datos }) {
    return `
        <div class="qw-payment-form" data-method="transferencia">
            <div class="qw-payment-form-title">Transferencia bancaria — Datos</div>
            <div class="qw-field">
                <label class="qw-label" for="qw-transfer-banco">Banco *</label>
                <select class="qw-input qw-region-select" data-field="banco" id="qw-transfer-banco" aria-describedby="err-transfer-banco">
                    <option value="" ${!datos.banco ? 'selected' : ''}>— Selecciona el banco —</option>
                    ${BANCOS.map(b => `<option value="${escapeAttr(b)}" ${datos.banco === b ? 'selected' : ''}>${escapeText(b)}</option>`).join('')}
                </select>
                <div class="qw-error" data-error="banco" id="err-transfer-banco" role="alert" aria-live="polite"></div>
            </div>
            <div class="qw-field">
                <label class="qw-label" for="qw-transfer-titular">Titular de la cuenta *</label>
                <input class="qw-input" data-field="titular" id="qw-transfer-titular"
                       type="text" maxlength="80"
                       value="${escapeAttr(datos.titular || '')}"
                       aria-describedby="err-transfer-titular">
                <div class="qw-error" data-error="titular" id="err-transfer-titular" role="alert" aria-live="polite"></div>
            </div>
            <div class="qw-field">
                <label class="qw-label" for="qw-transfer-numero">Número de cuenta *</label>
                <input class="qw-input" data-field="numero" id="qw-transfer-numero"
                       type="text" maxlength="40"
                       inputmode="numeric"
                       value="${escapeAttr(datos.numero || '')}"
                       aria-describedby="err-transfer-numero">
                <div class="qw-error" data-error="numero" id="err-transfer-numero" role="alert" aria-live="polite"></div>
            </div>
            <div class="qw-field">
                <label class="qw-label" for="qw-transfer-cci">CCI (opcional)</label>
                <input class="qw-input" data-field="cci" id="qw-transfer-cci"
                       type="text" maxlength="40"
                       inputmode="numeric"
                       value="${escapeAttr(datos.cci || '')}">
                <div class="qw-helper">Para transferencias interbancarias.</div>
            </div>
        </div>
    `;
}

export function attachTransferForm(formEl, datos, { onChange } = {}) {
    const cleanups = [];
    const fields = ['banco', 'titular', 'numero', 'cci'];
    for (const f of fields) {
        const el = formEl.querySelector(`[data-field="${f}"]`);
        if (!el) continue;
        const evt = el.tagName === 'SELECT' ? 'change' : 'input';
        const handler = () => {
            datos[f] = el.value;
            const errEl = formEl.querySelector(`[data-error="${f}"]`);
            if (errEl && errEl.textContent && validators[f] && !validators[f](el.value)) {
                errEl.textContent = '';
                el.classList.remove('qw-input-error');
                el.setAttribute('aria-invalid', 'false');
            }
            onChange?.();
        };
        el.addEventListener(evt, handler);
        cleanups.push(() => el.removeEventListener(evt, handler));
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

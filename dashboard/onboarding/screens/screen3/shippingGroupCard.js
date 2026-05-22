// ════════════════════════════════════════════════════════════════════════
// shippingGroupCard — Grupo de envío con dos modos: editing | saved
//
// Estructura editing (spec sec 6.2):
//   1. REGIONES cubiertas → regionPicker multi
//   2. MODALIDAD DE COSTO (4 radio cards: gratis, gratis_desde, tarifa_fija,
//      tarifa_variable). Campos condicionales según selección.
//   3. PAGO DEL ENVÍO (3 radio cards: total, parcial, contraentrega).
//      Oculto si modalidad === 'gratis'. Si parcial, abre input opcional.
//   4. TIEMPO DE ENTREGA (required, texto libre)
//   5. AGENCIAS / COURIERS (opcional)
//   6. NOTAS ADICIONALES (opcional)
//   + botón Guardar grupo
//
// Estructura saved: resumen compacto con chips de regiones + summary de
// modalidad/tiempo/pago + botones Editar/Eliminar. Si regiones=[], banner
// inline de warning con dos acciones rápidas.
//
// API:
//   renderShippingGroupCardHtml(grupo, { mode, index }): string
//   attachShippingGroupCard(cardEl, grupo, callbacks): { cleanup, refreshPicker, refreshEmptyWarning }
//
// callbacks:
//   onSave()                    → switch a modo saved
//   onEdit()                    → switch a modo editing
//   onDelete()                  → eliminar grupo (lista pide confirmación)
//   onChange()                  → cualquier mutación del state (save + recompute)
//   onCollision(region, ogId)   → propagar al list para abrir modal
//   onRequestAddRegionsFocus()  → "agregar regiones" del empty warning → list scrollea + foco picker
//   getOtherSelectedBy()        → función que devuelve el Map fresco
//                                  (recomputada cada vez para reflejar
//                                   cambios en otros grupos)
// ════════════════════════════════════════════════════════════════════════

import { escapeAttr, escapeText } from '../../lib/escape.js';
import { shake } from '../../lib/animations.js';
import { renderRegionPickerMulti, attachRegionPickerMulti } from './regionPicker.js';
import { PERU_REGIONS } from './peruRegions.js';

const MODALIDADES = [
    { id: 'gratis',           emoji: '🎁', titulo: 'Envíos gratis',          desc: 'Sin costo para el cliente.' },
    { id: 'gratis_desde',     emoji: '🎯', titulo: 'Gratis desde monto',     desc: 'Gratis al superar un mínimo.' },
    { id: 'tarifa_fija',      emoji: '📌', titulo: 'Tarifa fija',            desc: 'Un costo único para el grupo.' },
    { id: 'tarifa_variable',  emoji: '💸', titulo: 'Tarifa variable',        desc: 'Cotización manual por pedido.' },
];

const PAGOS = [
    { id: 'total',        emoji: '💰', titulo: 'Total al crear el pedido' },
    { id: 'parcial',      emoji: '✂️', titulo: 'Parcial (adelanto)' },
    { id: 'contraentrega', emoji: '📦', titulo: 'Contraentrega' },
];

const validators = {
    regiones:        (g) => (g.regiones || []).length === 0 ? 'Marca al menos una región' : null,
    modalidadCosto:  (g) => !g.modalidadCosto ? 'Elige una modalidad' : null,
    tiempoEntrega:   (g) => String(g.tiempoEntrega ?? '').trim().length < 3 ? 'Indica el tiempo de entrega' : null,
    pagoEnvio:       (g) => {
        if (g.modalidadCosto === 'gratis') return null; // no aplica
        if (!g.pagoEnvio) return 'Elige cuándo se paga el envío';
        return null;
    },
    montoMinimo:     (g) => {
        if (g.modalidadCosto !== 'gratis_desde') return null;
        const n = Number(g.montoMinimo);
        if (Number.isNaN(n) || n < 0 || String(g.montoMinimo).trim() === '') return 'Monto mínimo inválido';
        return null;
    },
    costoBajoMinimo: (g) => {
        if (g.modalidadCosto !== 'gratis_desde') return null;
        const n = Number(g.costoBajoMinimo);
        if (Number.isNaN(n) || n <= 0 || String(g.costoBajoMinimo).trim() === '') return 'Costo inválido';
        return null;
    },
    costoFijo:       (g) => {
        if (g.modalidadCosto !== 'tarifa_fija') return null;
        const n = Number(g.costoFijo);
        if (Number.isNaN(n) || n < 0 || String(g.costoFijo).trim() === '') return 'Costo inválido';
        return null;
    },
};

export const shippingGroupValidators = validators;

export function isGroupValid(g) {
    return !validators.regiones(g)
        && !validators.modalidadCosto(g)
        && !validators.pagoEnvio(g)
        && !validators.montoMinimo(g)
        && !validators.costoBajoMinimo(g)
        && !validators.costoFijo(g)
        && !validators.tiempoEntrega(g);
}

// ─── Render ────────────────────────────────────────────────────────────
export function renderShippingGroupCardHtml(grupo, { mode = 'editing', index = 0 } = {}) {
    if (mode === 'saved') return renderSavedCard(grupo, index);
    return renderEditingCard(grupo, index);
}

function renderSavedCard(grupo, index) {
    const empty = (grupo.regiones || []).length === 0;
    return `
        <div class="qw-shipping-group-card qw-shipping-group-card-saved${empty ? ' qw-shipping-group-card-empty' : ''}"
             data-group-id="${escapeAttr(grupo.id)}" data-mode="saved">
            <div class="qw-shipping-group-card-header">
                <span class="qw-shipping-group-card-num">${escapeText(`Grupo ${index + 1}`)}</span>
                <div class="qw-shipping-group-card-actions">
                    <button type="button" class="qw-btn qw-btn-secondary qw-btn-sm" data-action="edit-group">Editar</button>
                    <button type="button" class="qw-product-delete" data-action="delete-group" aria-label="Eliminar grupo" title="Eliminar grupo">🗑️</button>
                </div>
            </div>
            <div data-empty-warning>
                ${empty ? renderEmptyWarning() : renderRegionChipsSummary(grupo.regiones)}
            </div>
            ${renderSummaryLines(grupo)}
        </div>
    `;
}

function renderEmptyWarning() {
    return `
        <div class="qw-shipping-group-empty-warning" role="alert">
            <div class="qw-shipping-group-empty-warning-text">
                ⚠️ Este grupo no tiene regiones cubiertas.
            </div>
            <div class="qw-shipping-group-empty-warning-actions">
                <button type="button" class="qw-btn qw-btn-secondary qw-btn-sm" data-action="add-regions">+ Agregar regiones</button>
                <button type="button" class="qw-btn qw-btn-sm qw-btn-danger" data-action="delete-group-from-warning">Eliminar grupo</button>
            </div>
        </div>
    `;
}

function renderRegionChipsSummary(regiones) {
    return `
        <div class="qw-shipping-group-region-chips" aria-label="Regiones cubiertas">
            ${regiones.map(r => `<span class="qw-region-chip qw-region-chip-readonly">${escapeText(r)}</span>`).join('')}
        </div>
    `;
}

function renderSummaryLines(grupo) {
    const lines = [];
    const modalidad = MODALIDADES.find(m => m.id === grupo.modalidadCosto);
    if (modalidad) {
        let txt = modalidad.titulo;
        if (grupo.modalidadCosto === 'gratis_desde') {
            txt += ` — desde S/${escapeText(String(grupo.montoMinimo))} (si no, S/${escapeText(String(grupo.costoBajoMinimo))})`;
        } else if (grupo.modalidadCosto === 'tarifa_fija') {
            txt += ` — S/${escapeText(String(grupo.costoFijo))}`;
        }
        lines.push(`<div class="qw-summary-line"><strong>Modalidad:</strong> ${txt}</div>`);
    }
    const pago = PAGOS.find(p => p.id === grupo.pagoEnvio);
    if (pago && grupo.modalidadCosto !== 'gratis') {
        let pagoTxt = pago.titulo;
        if (grupo.pagoEnvio === 'parcial' && grupo.montoAdelanto) {
            pagoTxt += ` (${escapeText(grupo.montoAdelanto)})`;
        }
        lines.push(`<div class="qw-summary-line"><strong>Pago:</strong> ${pagoTxt}</div>`);
    }
    if (grupo.tiempoEntrega) {
        lines.push(`<div class="qw-summary-line"><strong>Entrega:</strong> ${escapeText(grupo.tiempoEntrega)}</div>`);
    }
    if (grupo.agencias) {
        lines.push(`<div class="qw-summary-line"><strong>Couriers:</strong> ${escapeText(grupo.agencias)}</div>`);
    }
    return lines.join('');
}

function renderEditingCard(grupo, index) {
    const empty = (grupo.regiones || []).length === 0;
    return `
        <div class="qw-shipping-group-card qw-shipping-group-card-editing${empty ? ' qw-shipping-group-card-empty' : ''}"
             data-group-id="${escapeAttr(grupo.id)}" data-mode="editing">
            <div class="qw-shipping-group-card-header">
                <span class="qw-shipping-group-card-num">${escapeText(`Grupo ${index + 1}`)}</span>
                <button type="button" class="qw-product-delete" data-action="delete-group" aria-label="Eliminar grupo" title="Eliminar grupo">🗑️</button>
            </div>

            <div data-empty-warning>
                ${empty ? renderEmptyWarning() : ''}
            </div>

            <div class="qw-field">
                <label class="qw-label">📍 Regiones cubiertas *</label>
                ${renderRegionPickerMulti({ id: `picker-${grupo.id}`, selected: grupo.regiones || [] })}
            </div>

            <div class="qw-field">
                <label class="qw-label">Modalidad de costo *</label>
                <div class="qw-radio-grid qw-modalidad-grid" role="radiogroup" data-modalidad-grid>
                    ${MODALIDADES.map(m => `
                        <button type="button" class="qw-radio-card${grupo.modalidadCosto === m.id ? ' qw-radio-card-selected' : ''}"
                                role="radio" aria-checked="${grupo.modalidadCosto === m.id ? 'true' : 'false'}"
                                data-modalidad="${escapeAttr(m.id)}">
                            <span class="qw-radio-card-emoji" aria-hidden="true">${m.emoji}</span>
                            <span class="qw-radio-card-title">${escapeText(m.titulo)}</span>
                            <span class="qw-radio-card-desc">${escapeText(m.desc)}</span>
                        </button>
                    `).join('')}
                </div>
                <div class="qw-modalidad-fields" data-modalidad-fields>
                    ${renderModalidadFields(grupo)}
                </div>
            </div>

            <div class="qw-field" data-pago-section ${grupo.modalidadCosto === 'gratis' ? 'hidden' : ''}>
                <label class="qw-label">Pago del envío *</label>
                <div class="qw-pago-grid" role="radiogroup" data-pago-grid>
                    ${PAGOS.map(p => `
                        <button type="button" class="qw-radio-card qw-radio-card-h${grupo.pagoEnvio === p.id ? ' qw-radio-card-selected' : ''}"
                                role="radio" aria-checked="${grupo.pagoEnvio === p.id ? 'true' : 'false'}"
                                data-pago="${escapeAttr(p.id)}">
                            <span class="qw-radio-card-emoji" aria-hidden="true">${p.emoji}</span>
                            <span class="qw-radio-card-title">${escapeText(p.titulo)}</span>
                        </button>
                    `).join('')}
                </div>
                <div class="qw-pago-fields" data-pago-fields>
                    ${grupo.pagoEnvio === 'parcial' ? `
                        <div class="qw-field">
                            <label class="qw-label" for="qw-group-${escapeAttr(grupo.id)}-adelanto">Monto del adelanto (opcional)</label>
                            <input class="qw-input" type="text" data-field="montoAdelanto"
                                   id="qw-group-${escapeAttr(grupo.id)}-adelanto"
                                   value="${escapeAttr(grupo.montoAdelanto || '')}"
                                   placeholder="Ej: S/20 o 50%">
                        </div>
                    ` : ''}
                </div>
            </div>

            <div class="qw-field">
                <label class="qw-label" for="qw-group-${escapeAttr(grupo.id)}-tiempo">Tiempo de entrega *</label>
                <textarea class="qw-textarea" data-field="tiempoEntrega"
                          id="qw-group-${escapeAttr(grupo.id)}-tiempo"
                          rows="2" maxlength="220"
                          placeholder="Ej: 24-48 horas."
                          aria-describedby="err-${escapeAttr(grupo.id)}-tiempo">${escapeText(grupo.tiempoEntrega || '')}</textarea>
                <div class="qw-error" data-error="tiempoEntrega" id="err-${escapeAttr(grupo.id)}-tiempo" role="alert" aria-live="polite"></div>
            </div>

            <div class="qw-field">
                <label class="qw-label" for="qw-group-${escapeAttr(grupo.id)}-agencias">Agencias / Couriers (opcional)</label>
                <textarea class="qw-textarea" data-field="agencias"
                          id="qw-group-${escapeAttr(grupo.id)}-agencias"
                          rows="2" maxlength="220"
                          placeholder="Ej: Olva, Shalom, delivery propio.">${escapeText(grupo.agencias || '')}</textarea>
            </div>

            <div class="qw-field">
                <label class="qw-label" for="qw-group-${escapeAttr(grupo.id)}-notas">Notas adicionales (opcional)</label>
                <textarea class="qw-textarea" data-field="notas"
                          id="qw-group-${escapeAttr(grupo.id)}-notas"
                          rows="2" maxlength="220"
                          placeholder="Ej: No enviamos productos frágiles a provincia.">${escapeText(grupo.notas || '')}</textarea>
            </div>

            <div class="qw-shipping-group-card-footer">
                <button type="button" class="qw-btn qw-btn-primary" data-action="save-group" disabled>
                    Guardar grupo
                </button>
            </div>
        </div>
    `;
}

function renderModalidadFields(grupo) {
    if (grupo.modalidadCosto === 'gratis_desde') {
        return `
            <div class="qw-product-row">
                <div class="qw-field">
                    <label class="qw-label" for="qw-group-${escapeAttr(grupo.id)}-min">Monto mínimo (S/) *</label>
                    <input class="qw-input" type="number" min="0" step="0.01" inputmode="decimal"
                           data-field="montoMinimo"
                           id="qw-group-${escapeAttr(grupo.id)}-min"
                           value="${escapeAttr(grupo.montoMinimo || '')}" placeholder="100">
                </div>
                <div class="qw-field">
                    <label class="qw-label" for="qw-group-${escapeAttr(grupo.id)}-below">Costo si no se alcanza (S/) *</label>
                    <input class="qw-input" type="number" min="0" step="0.01" inputmode="decimal"
                           data-field="costoBajoMinimo"
                           id="qw-group-${escapeAttr(grupo.id)}-below"
                           value="${escapeAttr(grupo.costoBajoMinimo || '')}" placeholder="15">
                </div>
            </div>
        `;
    }
    if (grupo.modalidadCosto === 'tarifa_fija') {
        return `
            <div class="qw-field">
                <label class="qw-label" for="qw-group-${escapeAttr(grupo.id)}-fijo">Costo del envío (S/) *</label>
                <input class="qw-input" type="number" min="0" step="0.01" inputmode="decimal"
                       data-field="costoFijo"
                       id="qw-group-${escapeAttr(grupo.id)}-fijo"
                       value="${escapeAttr(grupo.costoFijo || '')}" placeholder="15">
            </div>
        `;
    }
    if (grupo.modalidadCosto === 'tarifa_variable') {
        return `
            <div class="qw-helper qw-helper-info">
                Willy avisará al cliente que le cotizarás el envío después de confirmar el pedido.
            </div>
        `;
    }
    return ''; // 'gratis' o no seleccionada → sin campos
}

// ─── Wire ───────────────────────────────────────────────────────────────
export function attachShippingGroupCard(cardEl, grupo, callbacks = {}) {
    const mode = cardEl.dataset.mode;

    // Modo saved — solo botones de acción
    if (mode === 'saved') {
        return attachSavedCard(cardEl, grupo, callbacks);
    }
    return attachEditingCard(cardEl, grupo, callbacks);
}

function attachSavedCard(cardEl, grupo, callbacks) {
    const editBtn = cardEl.querySelector('[data-action="edit-group"]');
    const delBtn = cardEl.querySelector('[data-action="delete-group"]');
    const addRegionsBtn = cardEl.querySelector('[data-action="add-regions"]');
    const deleteFromWarningBtn = cardEl.querySelector('[data-action="delete-group-from-warning"]');

    const onEditClick = () => callbacks.onEdit?.();
    const onDelClick = () => callbacks.onDelete?.();
    const onAddRegionsClick = () => callbacks.onRequestAddRegionsFocus?.();
    const onDelWarningClick = () => callbacks.onDelete?.();

    editBtn?.addEventListener('click', onEditClick);
    delBtn?.addEventListener('click', onDelClick);
    addRegionsBtn?.addEventListener('click', onAddRegionsClick);
    deleteFromWarningBtn?.addEventListener('click', onDelWarningClick);

    return {
        cleanup: () => {
            editBtn?.removeEventListener('click', onEditClick);
            delBtn?.removeEventListener('click', onDelClick);
            addRegionsBtn?.removeEventListener('click', onAddRegionsClick);
            deleteFromWarningBtn?.removeEventListener('click', onDelWarningClick);
        },
        refreshPicker: () => {
            // En saved no hay picker, pero el caller puede llamar refreshEmptyWarning
            // si las regiones cambiaron por collision
        },
        refreshEmptyWarning: () => refreshEmptyWarningSavedDOM(cardEl, grupo),
    };
}

function refreshEmptyWarningSavedDOM(cardEl, grupo) {
    const empty = (grupo.regiones || []).length === 0;
    cardEl.classList.toggle('qw-shipping-group-card-empty', empty);
    const slot = cardEl.querySelector('[data-empty-warning]');
    if (!slot) return;
    slot.innerHTML = empty ? renderEmptyWarning() : renderRegionChipsSummary(grupo.regiones);

    // Re-wire los botones del warning si los hay
    if (empty) {
        const addBtn = slot.querySelector('[data-action="add-regions"]');
        const delBtn = slot.querySelector('[data-action="delete-group-from-warning"]');
        if (addBtn || delBtn) {
            // Estos handlers se establecen vía bubbling — el cleanup del card se
            // encarga. Para que se mantengan tras re-render del slot, los re-bindeamos.
            // Es responsabilidad del attachSavedCard que llamamos a través del caller
            // (shippingGroupsList) re-attache si el render rebuilds. Vamos a delegar
            // los listeners a nivel cardEl para no perderlos.
        }
    }
}

function attachEditingCard(cardEl, grupo, callbacks) {
    const cleanups = [];

    // ── Refs ──────────────────────────────────────────────────────────
    const modalidadGrid = cardEl.querySelector('[data-modalidad-grid]');
    const modalidadFields = cardEl.querySelector('[data-modalidad-fields]');
    const pagoSection = cardEl.querySelector('[data-pago-section]');
    const pagoGrid = cardEl.querySelector('[data-pago-grid]');
    const pagoFields = cardEl.querySelector('[data-pago-fields]');
    const saveBtn = cardEl.querySelector('[data-action="save-group"]');
    const delBtn = cardEl.querySelector('[data-action="delete-group"]');
    const tiempoEl = cardEl.querySelector('[data-field="tiempoEntrega"]');
    const agenciasEl = cardEl.querySelector('[data-field="agencias"]');
    const notasEl = cardEl.querySelector('[data-field="notas"]');
    const tiempoErr = cardEl.querySelector('[data-error="tiempoEntrega"]');

    // ── Helpers ───────────────────────────────────────────────────────
    const findErrEl = (field) => cardEl.querySelector(`[data-error="${field}"]`);
    const setFieldError = (field, msg, inputEl) => {
        const errEl = findErrEl(field);
        if (errEl) errEl.textContent = msg || '';
        if (inputEl) {
            if (msg) {
                inputEl.classList.add('qw-input-error');
                inputEl.setAttribute('aria-invalid', 'true');
            } else {
                inputEl.classList.remove('qw-input-error');
                inputEl.setAttribute('aria-invalid', 'false');
            }
        }
    };

    const refreshSave = () => {
        if (!saveBtn) return;
        saveBtn.disabled = !isGroupValid(grupo);
    };

    const refreshEmptyWarningEditing = () => {
        const empty = (grupo.regiones || []).length === 0;
        cardEl.classList.toggle('qw-shipping-group-card-empty', empty);
        const slot = cardEl.querySelector('[data-empty-warning]');
        if (!slot) return;
        slot.innerHTML = empty ? renderEmptyWarning() : '';
        // Re-wire empty warning buttons (delegamos a nivel card, abajo)
    };

    // ── Region picker (multi) ─────────────────────────────────────────
    // El picker es controlled-component: NO guarda state de "selected".
    // Después de cualquier mutación local (add/remove/all/none), el card
    // DEBE llamar refreshPicker() para que el DOM del picker refleje el
    // state actual. Sin esto, el chip removido queda visible aunque el
    // state ya esté limpio — bug que se descubrió en iter 2 post-build.
    //
    // El refresh del picker propio + el refresh de empty warning + save
    // están agrupados en applyOwnRegionChange() para que las 4 acciones
    // (add/remove/all/none) converjan al mismo handler. Reduce surface
    // area para futuros bugs de divergencia.
    const applyOwnRegionChange = () => {
        callbacks.onChange?.();
        refreshSave();
        refreshEmptyWarningEditing();
        refreshPicker(); // re-renderiza este picker con state nuevo
    };

    const pickerApi = attachRegionPickerMulti(cardEl, {
        onAddRegion: (region) => {
            if (!grupo.regiones.includes(region)) {
                grupo.regiones.push(region);
                applyOwnRegionChange();
            }
        },
        onRemoveRegion: (region) => {
            grupo.regiones = grupo.regiones.filter(r => r !== region);
            applyOwnRegionChange();
        },
        onSelectAll: () => {
            // "Todas" = solo regiones DISPONIBLES (no toma de otros grupos).
            // Caso edge: si las 25 están tomadas, queda en []. Comportamiento
            // consistente con un grupo vacío — warning + Continuar bloqueado.
            const other = callbacks.getOtherSelectedBy?.() || new Map();
            const newSelected = PERU_REGIONS.filter(r => !other.has(r));
            grupo.regiones = newSelected;
            applyOwnRegionChange();
        },
        onClearAll: () => {
            grupo.regiones = [];
            applyOwnRegionChange();
        },
        onCollision: (region, otherGroupId) => {
            // No mutamos acá — delegamos al list, que ejecuta atomic move
            // y refresca los pickers de AMBOS grupos afectados via
            // propagateRegionChange(null).
            callbacks.onCollision?.(region, otherGroupId);
        },
    });
    cleanups.push(pickerApi.cleanup);

    const refreshPicker = () => {
        const other = callbacks.getOtherSelectedBy?.() || new Map();
        pickerApi.update(grupo.regiones || [], other);
    };
    refreshPicker(); // render inicial

    // ── Modalidad — radio cards ───────────────────────────────────────
    const onModalidadClick = (e) => {
        const btn = e.target.closest('[data-modalidad]');
        if (!btn) return;
        const newModalidad = btn.dataset.modalidad;
        if (grupo.modalidadCosto === newModalidad) return;
        grupo.modalidadCosto = newModalidad;
        // Limpiar campos de otras modalidades para no dejar basura en state
        if (newModalidad !== 'gratis_desde') {
            grupo.montoMinimo = '';
            grupo.costoBajoMinimo = '';
        }
        if (newModalidad !== 'tarifa_fija') {
            grupo.costoFijo = '';
        }
        if (newModalidad === 'gratis') {
            grupo.pagoEnvio = '';
            grupo.montoAdelanto = '';
        }
        // Update DOM
        modalidadGrid.querySelectorAll('[data-modalidad]').forEach(b => {
            const sel = b.dataset.modalidad === newModalidad;
            b.classList.toggle('qw-radio-card-selected', sel);
            b.setAttribute('aria-checked', sel ? 'true' : 'false');
        });
        modalidadFields.innerHTML = renderModalidadFields(grupo);
        // Pago: ocultar si gratis
        if (pagoSection) {
            pagoSection.hidden = (newModalidad === 'gratis');
            if (newModalidad === 'gratis') {
                pagoGrid.querySelectorAll('[data-pago]').forEach(b => {
                    b.classList.remove('qw-radio-card-selected');
                    b.setAttribute('aria-checked', 'false');
                });
                pagoFields.innerHTML = '';
            }
        }
        wireConditionalFields();
        callbacks.onChange?.();
        refreshSave();
    };
    modalidadGrid?.addEventListener('click', onModalidadClick);
    cleanups.push(() => modalidadGrid?.removeEventListener('click', onModalidadClick));

    // ── Pago — radio cards ────────────────────────────────────────────
    const onPagoClick = (e) => {
        const btn = e.target.closest('[data-pago]');
        if (!btn) return;
        const newPago = btn.dataset.pago;
        if (grupo.pagoEnvio === newPago) return;
        grupo.pagoEnvio = newPago;
        if (newPago !== 'parcial') grupo.montoAdelanto = '';
        pagoGrid.querySelectorAll('[data-pago]').forEach(b => {
            const sel = b.dataset.pago === newPago;
            b.classList.toggle('qw-radio-card-selected', sel);
            b.setAttribute('aria-checked', sel ? 'true' : 'false');
        });
        // Re-render pago fields (input de adelanto si parcial)
        pagoFields.innerHTML = newPago === 'parcial' ? `
            <div class="qw-field">
                <label class="qw-label" for="qw-group-${escapeAttr(grupo.id)}-adelanto">Monto del adelanto (opcional)</label>
                <input class="qw-input" type="text" data-field="montoAdelanto"
                       id="qw-group-${escapeAttr(grupo.id)}-adelanto"
                       value="${escapeAttr(grupo.montoAdelanto || '')}"
                       placeholder="Ej: S/20 o 50%">
            </div>
        ` : '';
        wireConditionalFields();
        callbacks.onChange?.();
        refreshSave();
    };
    pagoGrid?.addEventListener('click', onPagoClick);
    cleanups.push(() => pagoGrid?.removeEventListener('click', onPagoClick));

    // ── Inputs estables (tiempo, agencias, notas) ─────────────────────
    const staticInputs = [
        ['tiempoEntrega', tiempoEl],
        ['agencias', agenciasEl],
        ['notas', notasEl],
    ];
    for (const [field, el] of staticInputs) {
        if (!el) continue;
        const handler = () => {
            grupo[field] = el.value;
            if (validators[field] && !validators[field](grupo)) {
                setFieldError(field, null, el);
            }
            callbacks.onChange?.();
            refreshSave();
        };
        el.addEventListener('input', handler);
        cleanups.push(() => el.removeEventListener('input', handler));
    }

    // Inputs condicionales (montoMinimo, costoBajoMinimo, costoFijo, montoAdelanto)
    // Cambian con la modalidad/pago seleccionados. Para evitar re-attach manual,
    // delegamos los listeners a nivel cardEl.
    const conditionalHandlers = new Map();
    const wireConditionalFields = () => {
        // Detach previos
        for (const [el, handler] of conditionalHandlers.entries()) {
            el.removeEventListener('input', handler);
        }
        conditionalHandlers.clear();
        // Attach nuevos
        const condFields = ['montoMinimo', 'costoBajoMinimo', 'costoFijo', 'montoAdelanto'];
        for (const field of condFields) {
            const el = cardEl.querySelector(`[data-field="${field}"]`);
            if (!el) continue;
            const handler = () => {
                grupo[field] = el.value;
                if (validators[field] && !validators[field](grupo)) {
                    setFieldError(field, null, el);
                }
                callbacks.onChange?.();
                refreshSave();
            };
            el.addEventListener('input', handler);
            conditionalHandlers.set(el, handler);
        }
    };
    wireConditionalFields(); // estado inicial
    cleanups.push(() => {
        for (const [el, handler] of conditionalHandlers.entries()) {
            el.removeEventListener('input', handler);
        }
        conditionalHandlers.clear();
    });

    // ── Save / Delete buttons ─────────────────────────────────────────
    const onSaveClick = () => {
        if (!isGroupValid(grupo)) {
            // Defensivo. Botón debe estar disabled, pero validamos y shakeamos.
            shake(cardEl);
            return;
        }
        callbacks.onSave?.();
    };
    const onDelClick = () => callbacks.onDelete?.();
    saveBtn?.addEventListener('click', onSaveClick);
    delBtn?.addEventListener('click', onDelClick);
    cleanups.push(() => {
        saveBtn?.removeEventListener('click', onSaveClick);
        delBtn?.removeEventListener('click', onDelClick);
    });

    // ── Empty warning buttons (delegado a nivel card, sobrevive re-renders) ──
    const onCardClick = (e) => {
        const addBtn = e.target.closest('[data-action="add-regions"]');
        if (addBtn) {
            callbacks.onRequestAddRegionsFocus?.();
            return;
        }
        const delFromWarn = e.target.closest('[data-action="delete-group-from-warning"]');
        if (delFromWarn) {
            callbacks.onDelete?.();
            return;
        }
    };
    cardEl.addEventListener('click', onCardClick);
    cleanups.push(() => cardEl.removeEventListener('click', onCardClick));

    refreshSave(); // estado inicial

    return {
        cleanup: () => {
            for (const fn of cleanups) {
                try { fn(); } catch (e) { console.warn('[shippingGroupCard] cleanup error', e); }
            }
        },
        refreshPicker,
        refreshEmptyWarning: refreshEmptyWarningEditing,
    };
}

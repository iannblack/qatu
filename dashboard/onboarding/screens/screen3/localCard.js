// ════════════════════════════════════════════════════════════════════════
// localCard — card de Local con dos modos: 'editing' y 'saved'
//
// Editing: formulario completo (nombre, dirección, región, horarios) +
//          textarea autogenerada (respuestaQhatu) + botón Regenerar +
//          botón Guardar.
// Saved:   resumen compacto con dirección/región/horarios + botones
//          [Editar] [🗑 Eliminar].
//
// La autogeneración del campo 5 (respuestaQhatu) corre en cada keystroke
// de los campos 1–4, sincrónica (paridad con el modal "Configura tus
// envíos"). Si el usuario editó manualmente la respuesta, el botón
// "Regenerar" abre confirmModal antes de pisar su versión.
//
// API:
//   renderLocalCardHtml(local, { mode, index }): string HTML
//   attachLocalCard(cardEl, local, { onSave, onDelete, onEdit, onChange }): cleanup fn
//
// El caller (localesList) administra el state.envios.locales y los IDs;
// localCard solo orquesta el DOM y el flujo de autogen + validación.
// ════════════════════════════════════════════════════════════════════════

import { renderRegionSelectSingle, attachRegionSelectSingle } from './regionPicker.js';
import { escapeAttr, escapeText } from '../../lib/escape.js';
import { shake } from '../../lib/animations.js';
import { generarRespuestaLocal } from '../../lib/qhatuRespuestas.js';
import { confirmModal } from '../../wizard.js';

const validators = {
    direccion: (v) => String(v ?? '').trim().length < 10 ? 'Necesito una dirección completa' : null,
    region:    (v) => String(v ?? '').trim() === '' ? 'Elige una región' : null,
    horario:   (v) => String(v ?? '').trim().length < 10 ? 'Cuéntame los horarios completos' : null,
};

export function renderLocalCardHtml(local, { mode = 'editing', index = 0 } = {}) {
    const regionSelectId = `qw-local-${local.id}-region`;
    if (mode === 'saved') {
        return `
            <div class="qw-local-card qw-local-card-saved" data-local-id="${escapeAttr(local.id)}" data-mode="saved">
                <div class="qw-local-card-summary">
                    <div class="qw-local-card-title">
                        ${escapeText(local.nombre || `Local ${index + 1}`)}
                    </div>
                    <div class="qw-local-card-meta">
                        <span>📍 ${escapeText(local.direccion)}</span>
                        <span>·</span>
                        <span>${escapeText(local.region)}</span>
                    </div>
                    <div class="qw-local-card-horario">
                        🕐 ${escapeText(local.horario)}
                    </div>
                </div>
                <div class="qw-local-card-actions">
                    <button type="button" class="qw-btn qw-btn-secondary qw-btn-sm" data-action="edit-local">Editar</button>
                    <button type="button" class="qw-product-delete" data-action="delete-local" aria-label="Eliminar local" title="Eliminar local">🗑️</button>
                </div>
            </div>
        `;
    }
    // editing
    return `
        <div class="qw-local-card qw-local-card-editing" data-local-id="${escapeAttr(local.id)}" data-mode="editing">
            <div class="qw-local-card-header">
                <span class="qw-local-card-num">${escapeText(`Local ${index + 1}`)}</span>
                <button type="button" class="qw-product-delete" data-action="delete-local" aria-label="Eliminar local" title="Eliminar local">🗑️</button>
            </div>
            <div class="qw-field">
                <label class="qw-label" for="qw-local-${escapeAttr(local.id)}-nombre">Nombre (opcional)</label>
                <input class="qw-input" data-field="nombre" id="qw-local-${escapeAttr(local.id)}-nombre"
                       type="text" maxlength="60"
                       value="${escapeAttr(local.nombre || '')}"
                       placeholder="Ej: Miraflores, Tienda Principal">
            </div>
            <div class="qw-field">
                <label class="qw-label" for="qw-local-${escapeAttr(local.id)}-direccion">Dirección *</label>
                <input class="qw-input" data-field="direccion" id="qw-local-${escapeAttr(local.id)}-direccion"
                       type="text" maxlength="200"
                       value="${escapeAttr(local.direccion || '')}"
                       placeholder="Ej: Av. Larco 345, Miraflores, Lima"
                       aria-describedby="err-${escapeAttr(local.id)}-direccion">
                <div class="qw-error" data-error="direccion" id="err-${escapeAttr(local.id)}-direccion" role="alert" aria-live="polite"></div>
            </div>
            <div class="qw-field">
                <label class="qw-label" for="${regionSelectId}">Región / Departamento *</label>
                ${renderRegionSelectSingle({ id: regionSelectId, value: local.region || '' })}
                <div class="qw-helper">Solo se ofrecerá recojo en esta sucursal a clientes de esta región.</div>
                <div class="qw-error" data-error="region" role="alert" aria-live="polite"></div>
            </div>
            <div class="qw-field">
                <label class="qw-label" for="qw-local-${escapeAttr(local.id)}-horario">Días y horarios *</label>
                <textarea class="qw-textarea" data-field="horario" id="qw-local-${escapeAttr(local.id)}-horario"
                          rows="2" maxlength="220"
                          placeholder="Ej: Lunes a viernes de 9am-6pm. Sábados de 10am-2pm."
                          aria-describedby="err-${escapeAttr(local.id)}-horario">${escapeText(local.horario || '')}</textarea>
                <div class="qw-error" data-error="horario" id="err-${escapeAttr(local.id)}-horario" role="alert" aria-live="polite"></div>
            </div>
            <div class="qw-field qw-respuesta-field">
                <div class="qw-respuesta-header">
                    <label class="qw-label qw-respuesta-label" for="qw-local-${escapeAttr(local.id)}-respuesta">
                        ¿Cómo responde Qhatu cuando preguntan por este local?
                    </label>
                    <button type="button" class="qw-btn-regenerar" data-action="regenerar-respuesta" disabled>
                        <span class="qw-btn-regenerar-icon">↻</span> Regenerar
                    </button>
                </div>
                <textarea class="qw-textarea" data-field="respuestaQhatu"
                          id="qw-local-${escapeAttr(local.id)}-respuesta"
                          rows="3" maxlength="500"
                          placeholder="Se generará automáticamente cuando completes los datos de arriba. También puedes escribir tu propia versión.">${escapeText(local.respuestaQhatu || '')}</textarea>
                <div class="qw-respuesta-footer">
                    <span class="qw-local-respuesta-status" data-respuesta-status></span>
                    <div class="qw-helper qw-respuesta-helper">Qhatu usará este mensaje cuando un cliente pregunte cómo recoger en este local. Se autogenera al llenar los datos de arriba; edítalo si quieres una versión propia.</div>
                </div>
            </div>
            <div class="qw-local-card-footer">
                <button type="button" class="qw-btn qw-btn-primary" data-action="save-local" disabled>
                    Guardar local
                </button>
            </div>
        </div>
    `;
}

// Wire de una local card en modo editing. Devuelve cleanup que remueve
// todos los listeners y aborta cualquier promesa de generación pendiente
// (vía `autogenAborted`) para evitar pisar la textarea tras detach.
export function attachLocalCard(cardEl, local, callbacks = {}) {
    const { onSave, onDelete, onChange, onEdit } = callbacks;
    const mode = cardEl.dataset.mode;

    // Modo saved — solo dos botones, cleanup mínimo
    if (mode === 'saved') {
        const editBtn = cardEl.querySelector('[data-action="edit-local"]');
        const delBtn = cardEl.querySelector('[data-action="delete-local"]');
        const onEditClick = () => onEdit?.();
        const onDelClick = () => onDelete?.();
        editBtn?.addEventListener('click', onEditClick);
        delBtn?.addEventListener('click', onDelClick);
        return () => {
            editBtn?.removeEventListener('click', onEditClick);
            delBtn?.removeEventListener('click', onDelClick);
        };
    }

    // Modo editing — listeners completos
    const fields = ['nombre', 'direccion', 'horario', 'respuestaQhatu'];
    const inputEls = {};
    const inputHandlers = {};

    // Refs auxiliares
    const regionSelectId = `qw-local-${local.id}-region`;
    const saveBtn = cardEl.querySelector('[data-action="save-local"]');
    const delBtn = cardEl.querySelector('[data-action="delete-local"]');
    const regenBtn = cardEl.querySelector('[data-action="regenerar-respuesta"]');
    const statusEl = cardEl.querySelector('[data-respuesta-status]');

    const findErrEl = (field) => cardEl.querySelector(`[data-error="${field}"]`);

    const setFieldError = (field, msg) => {
        const inputEl = field === 'region'
            ? cardEl.querySelector(`#${CSS.escape(regionSelectId)}`)
            : inputEls[field];
        const errEl = findErrEl(field);
        if (!inputEl) return;
        if (errEl) errEl.textContent = msg || '';
        if (msg) {
            inputEl.classList.add('qw-input-error');
            inputEl.setAttribute('aria-invalid', 'true');
        } else {
            inputEl.classList.remove('qw-input-error');
            inputEl.setAttribute('aria-invalid', 'false');
        }
    };

    const refreshSaveButton = () => {
        if (!saveBtn) return;
        const ok =
            !validators.direccion(local.direccion) &&
            !validators.region(local.region) &&
            !validators.horario(local.horario);
        saveBtn.disabled = !ok;
    };

    // ── Autogeneración del campo 5 ──────────────────────────────────
    // Comportamiento (paridad con __shipBuildPickupMayaNote del modal de
    // envíos): cada keystroke en nombre/direccion/region/horario regenera
    // la respuesta inmediatamente, sin debounce. Basta con que UN campo
    // tenga contenido para generar texto parcial. Si el usuario editó
    // manualmente la textarea, NO autogeneramos — el botón Regenerar
    // pide confirmación antes de pisar su versión.
    //
    // `autogenSequence` se mantiene por safety: si `generarRespuestaLocal`
    // vuelve a ser async con I/O real (LLM), los resultados stale se
    // descartan. Hoy resuelve en microtask, así que no hay race práctica.
    let autogenSequence = 0;
    let autogenAborted = false;

    // Paridad con __shipBuildPickupMayaNote: cualquier campo no vacío
    // habilita autogen. Los thresholds de length quedan para `validators`,
    // que sigue gobernando si el botón Guardar está habilitado.
    const canAutogenerate = () => (
        (local.nombre || '').trim() !== '' ||
        (local.direccion || '').trim() !== '' ||
        (local.horario || '').trim() !== '' ||
        (local.region || '').trim() !== ''
    );

    const setStatus = (text) => {
        if (statusEl) statusEl.textContent = text || '';
    };

    const runAutogen = async ({ force = false } = {}) => {
        if (!canAutogenerate()) {
            if (force) shake(saveBtn);
            return;
        }
        if (local.respuestaQhatuEditedByUser && !force) return;

        const mySequence = ++autogenSequence;
        try {
            const generated = await generarRespuestaLocal(local);
            if (autogenAborted || mySequence !== autogenSequence) return; // stale
            local.respuestaQhatu = generated;
            local.respuestaQhatuEditedByUser = false; // generated overrides
            const ta = inputEls.respuestaQhatu;
            if (ta && ta.value !== generated) ta.value = generated;
            onChange?.();
            setStatus('');
        } catch (e) {
            if (autogenAborted) return;
            console.warn('[localCard] autogen falló', e);
            setStatus('No se pudo generar.');
        }
    };

    const scheduleAutogen = () => {
        const valid = canAutogenerate();
        if (regenBtn) regenBtn.disabled = !valid;
        if (!valid) return;
        if (local.respuestaQhatuEditedByUser) return;
        runAutogen();
    };

    // ── Wiring de inputs ────────────────────────────────────────────
    for (const f of fields) {
        const el = cardEl.querySelector(`[data-field="${f}"]`);
        if (!el) continue;
        inputEls[f] = el;
        if (f === 'respuestaQhatu') {
            inputHandlers[f] = () => {
                local.respuestaQhatu = el.value;
                local.respuestaQhatuEditedByUser = el.value.trim().length > 0;
                onChange?.();
            };
        } else {
            inputHandlers[f] = () => {
                local[f] = el.value;
                if (validators[f] && !validators[f](el.value)) {
                    setFieldError(f, null);
                }
                refreshSaveButton();
                scheduleAutogen();
                onChange?.();
            };
        }
        el.addEventListener('input', inputHandlers[f]);
    }

    // Región — select, evento change
    const detachRegion = attachRegionSelectSingle(cardEl, {
        id: regionSelectId,
        onChange: (val) => {
            local.region = val;
            if (!validators.region(val)) setFieldError('region', null);
            refreshSaveButton();
            scheduleAutogen();
            onChange?.();
        },
    });

    // Save handler con validación
    const onSaveClick = () => {
        // Backstop: validar todos los requeridos. UI ya impide click cuando
        // el botón está disabled, pero validamos defensivamente y mostramos
        // errores específicos si llega.
        const errs = {
            direccion: validators.direccion(local.direccion),
            region:    validators.region(local.region),
            horario:   validators.horario(local.horario),
        };
        const anyErr = Object.values(errs).some(Boolean);
        if (anyErr) {
            for (const [f, msg] of Object.entries(errs)) setFieldError(f, msg);
            shake(cardEl);
            return;
        }
        onSave?.();
    };
    saveBtn?.addEventListener('click', onSaveClick);

    // Delete handler
    const onDelClick = () => onDelete?.();
    delBtn?.addEventListener('click', onDelClick);

    // Regenerar handler — confirm si el usuario ya editó manualmente
    const onRegenClick = async () => {
        if (local.respuestaQhatuEditedByUser) {
            const ok = await confirmModal({
                title: '¿Reemplazar tu versión?',
                message: 'Vas a perder los cambios manuales que hiciste en este mensaje.',
                confirmText: 'Sí, regenerar',
                cancelText: 'Cancelar',
            });
            if (!ok) return;
        }
        runAutogen({ force: true });
    };
    regenBtn?.addEventListener('click', onRegenClick);

    // Estado inicial
    refreshSaveButton();
    if (canAutogenerate()) {
        if (regenBtn) regenBtn.disabled = false;
        // Si la card hidrata con datos y la respuesta está vacía / sin tocar,
        // generamos al toque (paridad con `__shipBuildPickupMayaNote` que en
        // su path de hidratación recompone `maya_note` cuando coincide con
        // el auto). Llamamos directo — no hace falta defer porque el DOM
        // del card ya está montado al ejecutar attachLocalCard.
        if (!local.respuestaQhatuEditedByUser && !(local.respuestaQhatu || '').trim()) {
            runAutogen();
        }
    } else {
        if (regenBtn) regenBtn.disabled = true;
    }

    // ── Cleanup ─────────────────────────────────────────────────────
    return () => {
        autogenAborted = true;
        for (const f of fields) {
            if (inputEls[f] && inputHandlers[f]) {
                inputEls[f].removeEventListener('input', inputHandlers[f]);
            }
        }
        detachRegion();
        saveBtn?.removeEventListener('click', onSaveClick);
        delBtn?.removeEventListener('click', onDelClick);
        regenBtn?.removeEventListener('click', onRegenClick);
    };
}

// Helper compartido — usado por localesList al hidratar y al guardar
export const localValidators = validators;

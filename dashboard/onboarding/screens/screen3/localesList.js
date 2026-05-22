// ════════════════════════════════════════════════════════════════════════
// localesList — administra la lista de Locales para el sub-flujo "Recojo"
// de P3. Maneja add/edit/save/delete + cardCleanups Map para evitar leaks.
//
// API:
//   mountLocalesList(container, { onChange }): { cleanup }
//
// Estado: lee y escribe directamente en state.envios.locales — el caller
// (screen3) NO debe duplicar locales en otras estructuras.
// ════════════════════════════════════════════════════════════════════════

import { state, save } from '../../store.js';
import { renderLocalCardHtml, attachLocalCard, localValidators } from './localCard.js';
import { confirmModal } from '../../wizard.js';
import { migrateLegacyRegion } from './peruRegions.js';

function newLocalId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return `loc_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
function makeEmptyLocal() {
    return {
        id: newLocalId(),
        nombre: '',
        direccion: '',
        region: '',
        horario: '',
        respuestaQhatu: '',
        respuestaQhatuEditedByUser: false,
        // mode no se persiste; es UI state local. saved=true cuando el usuario
        // hizo click en Guardar local.
        saved: false,
    };
}

export function mountLocalesList(container, { onChange } = {}) {
    // Asegurar que cada local tenga ID y los flags nuevos (compat con state
    // viejo de localStorage que pudiera no tenerlos)
    let touched = false;
    state.envios.locales = (state.envios.locales || []).map(l => {
        const norm = { ...makeEmptyLocal(), ...l };
        if (!l.id) { norm.id = newLocalId(); touched = true; }
        if (typeof l.respuestaQhatuEditedByUser !== 'boolean') touched = true;
        if (typeof l.saved !== 'boolean') touched = true;
        // Migración silenciosa: "Lima" → "Lima Metropolitana" (PERU_REGIONS
        // ahora separa Lima Metropolitana de Lima (Provincias) en paridad
        // con window.KIPU_PERU_DEPARTMENTS).
        const migrated = migrateLegacyRegion(norm.region);
        if (migrated !== norm.region) { norm.region = migrated; touched = true; }
        return norm;
    });
    if (touched) save();

    // Si no hay ninguno, sembramos uno vacío en modo editing
    if (state.envios.locales.length === 0) {
        state.envios.locales.push(makeEmptyLocal());
        save();
    }

    // cardCleanups por localId — patron crítico para no leakear listeners
    const cardCleanups = new Map();

    container.innerHTML = `
        <div class="qw-subform-title">Locales de recojo</div>
        <div class="qw-section-error" data-section-error role="alert" aria-live="polite"></div>
        <div class="qw-locales-list" id="qw-locales-list"></div>
        <button type="button" class="qw-btn qw-btn-secondary qw-btn-add" data-action="add-local">
            + Agregar otro local
        </button>
    `;

    const listEl = container.querySelector('#qw-locales-list');
    const addBtn = container.querySelector('[data-action="add-local"]');
    const sectionErrEl = container.querySelector('[data-section-error]');

    const findCardEl = (localId) => listEl.querySelector(`[data-local-id="${CSS.escape(localId)}"]`);

    const detachCard = (localId) => {
        const fn = cardCleanups.get(localId);
        if (fn) fn();
        cardCleanups.delete(localId);
    };

    const renderCardAndAttach = (local, index, { initial = false } = {}) => {
        const html = renderLocalCardHtml(local, {
            mode: local.saved ? 'saved' : 'editing',
            index,
        });
        const wrap = document.createElement('div');
        wrap.innerHTML = html.trim();
        const cardEl = wrap.firstElementChild;
        if (initial) cardEl.dataset.initial = 'true';
        listEl.appendChild(cardEl);
        attachCardForCurrentMode(cardEl, local);
        return cardEl;
    };

    const attachCardForCurrentMode = (cardEl, local) => {
        const cleanup = attachLocalCard(cardEl, local, {
            onSave: () => transitionTo(local, 'saved', cardEl),
            onEdit: () => transitionTo(local, 'editing', cardEl),
            onDelete: () => requestDelete(local),
            onChange: () => { save(); onChange?.(); },
        });
        cardCleanups.set(local.id, cleanup);
    };

    // Cambia modo de un local. Para evitar parpadeos, hace swap del card
    // element por uno nuevo con el mode opuesto. Cleanup del anterior antes
    // de pisarlo.
    const transitionTo = (local, newMode, oldCardEl) => {
        detachCard(local.id);
        local.saved = newMode === 'saved';
        save();
        const idx = state.envios.locales.indexOf(local);
        const html = renderLocalCardHtml(local, { mode: newMode, index: idx });
        const wrap = document.createElement('div');
        wrap.innerHTML = html.trim();
        const newCardEl = wrap.firstElementChild;
        oldCardEl.replaceWith(newCardEl);
        attachCardForCurrentMode(newCardEl, local);
        onChange?.();
    };

    const requestDelete = async (local) => {
        // Confirm si el local tenía algo escrito — evita perder accidentalmente
        const hasContent = (local.direccion?.trim() || local.horario?.trim() || local.region);
        if (hasContent) {
            const ok = await confirmModal({
                title: '¿Eliminar este local?',
                message: 'Vas a perder los datos que escribiste para esta sucursal.',
                confirmText: 'Sí, eliminar',
                cancelText: 'Cancelar',
            });
            if (!ok) return;
        }
        // 1) detach listeners
        detachCard(local.id);
        // 2) remove del state
        state.envios.locales = state.envios.locales.filter(l => l.id !== local.id);
        save();
        // 3) animación de salida + remove
        const cardEl = findCardEl(local.id);
        if (cardEl) {
            cardEl.dataset.leaving = 'true';
            cardEl.removeAttribute('data-local-id');
            if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                cardEl.remove();
            } else {
                const cs = getComputedStyle(cardEl);
                const startHeight = cardEl.offsetHeight;
                const flexGapPx = parseFloat(getComputedStyle(listEl).gap) || 0;
                const anim = cardEl.animate(
                    [
                        { opacity: 1, height: startHeight + 'px', marginTop: '0px',
                          paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom },
                        { opacity: 0, height: '0px', marginTop: `-${flexGapPx}px`,
                          paddingTop: '0px', paddingBottom: '0px' },
                    ],
                    { duration: 300, easing: 'ease-in', fill: 'forwards' }
                );
                anim.addEventListener('finish', () => cardEl.remove());
            }
        }
        // Si quedó la lista vacía, sembramos uno nuevo en editing
        if (state.envios.locales.length === 0) {
            const fresh = makeEmptyLocal();
            state.envios.locales.push(fresh);
            save();
            renderCardAndAttach(fresh, 0);
        } else {
            refreshIndices();
        }
        onChange?.();
    };

    const refreshIndices = () => {
        state.envios.locales.forEach((l, i) => {
            const cardEl = findCardEl(l.id);
            if (!cardEl) return;
            const numEl = cardEl.querySelector('.qw-local-card-num');
            if (numEl) numEl.textContent = `Local ${i + 1}`;
            // En modo saved, el título usa nombre o "Local N" — no actualizamos
            // título saved aquí para no pisar nombre custom; refresh al volver
            // a saved después de un edit.
        });
    };

    const addLocal = () => {
        const fresh = makeEmptyLocal();
        state.envios.locales.push(fresh);
        save();
        const cardEl = renderCardAndAttach(fresh, state.envios.locales.length - 1);
        if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            cardEl.animate(
                [
                    { transform: 'translateY(20px)', opacity: 0 },
                    { transform: 'translateY(0)',    opacity: 1 },
                ],
                { duration: 300, easing: 'ease-out' }
            );
        }
        // Foco al primer campo del nuevo local
        const firstInput = cardEl.querySelector('[data-field="nombre"]');
        if (firstInput) firstInput.focus({ preventScroll: false });
        onChange?.();
    };

    const onAddClick = () => addLocal();
    addBtn.addEventListener('click', onAddClick);

    // Render inicial — hidrata desde state
    state.envios.locales.forEach((l, i) => renderCardAndAttach(l, i, { initial: true }));

    // Cleanup global
    const cleanup = () => {
        addBtn.removeEventListener('click', onAddClick);
        for (const fn of cardCleanups.values()) {
            try { fn(); } catch (e) { console.warn('[localesList] card cleanup error', e); }
        }
        cardCleanups.clear();
    };

    // API pública para el orchestrator. Simétrica con shippingGroupsList:
    // setSectionError + shakeAdd para que screen3 pueda mostrar inline error
    // y shake del CTA sin tocar el DOM interno de la lista.
    return {
        cleanup,
        hasSavedLocal: () =>
            state.envios.locales.some(l => l.saved &&
                !localValidators.direccion(l.direccion) &&
                !localValidators.region(l.region) &&
                !localValidators.horario(l.horario)
            ),
        setSectionError: (msg) => {
            if (sectionErrEl) sectionErrEl.textContent = msg || '';
        },
        shakeAdd: () => {
            if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
            addBtn.animate(
                [
                    { transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' },
                    { transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' },
                    { transform: 'translateX(0)' },
                ],
                { duration: 300, easing: 'ease-out' }
            );
        },
    };
}

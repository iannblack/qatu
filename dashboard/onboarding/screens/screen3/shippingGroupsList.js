// ════════════════════════════════════════════════════════════════════════
// shippingGroupsList — lista de Grupos de Envío.
//
// Responsabilidades:
//   - hidratar state.envios.grupos con defaults
//   - mantener cardCleanups Map<grupoId, cardAPI>
//   - propagar cambios entre cards (cuando cambia el regiones de uno,
//     los pickers de los otros deben re-renderizar para reflejar el
//     nuevo otherSelectedBy)
//   - manejar collision detection: si el picker de un grupo emite
//     onCollision(region, otherId), abrir confirmModal "¿Mover?". Si
//     confirma, mutación atómica + save() único + refresh de ambos cards
//   - "+ Agregar grupo" + delete con anim
//   - exponer hasSavedGroup() y hasEmptyGroup() para que screen3 valide
//
// API:
//   mountShippingGroupsList(container, { onChange }):
//     { cleanup, hasSavedGroup, hasEmptyGroup, focusFirstEmptyGroupPicker }
// ════════════════════════════════════════════════════════════════════════

import { state, save } from '../../store.js';
import { confirmModal } from '../../wizard.js';
import {
    renderShippingGroupCardHtml,
    attachShippingGroupCard,
    isGroupValid,
} from './shippingGroupCard.js';
import { computeOtherSelectedBy } from './regionPicker.js';

function newGroupId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return `g_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
function makeEmptyGroup() {
    return {
        id: newGroupId(),
        regiones: [],
        modalidadCosto: '',
        montoMinimo: '',
        costoBajoMinimo: '',
        costoFijo: '',
        pagoEnvio: '',
        montoAdelanto: '',
        tiempoEntrega: '',
        agencias: '',
        notas: '',
        saved: false,
    };
}

export function mountShippingGroupsList(container, { onChange } = {}) {
    // ── Hidratación defensiva ─────────────────────────────────────────
    let touched = false;
    state.envios.grupos = (state.envios.grupos || []).map(g => {
        const norm = { ...makeEmptyGroup(), ...g };
        if (!g.id) { norm.id = newGroupId(); touched = true; }
        if (!Array.isArray(g.regiones)) { norm.regiones = []; touched = true; }
        if (typeof g.saved !== 'boolean') touched = true;
        // Migración silenciosa: "Lima" se expande a ambas (Metropolitana +
        // Provincias) — cubre el alcance original sin perder regiones.
        // Dedup preserva el orden de entrada.
        if (norm.regiones.includes('Lima')) {
            const expanded = [];
            for (const r of norm.regiones) {
                if (r === 'Lima') {
                    if (!expanded.includes('Lima Metropolitana')) expanded.push('Lima Metropolitana');
                    if (!expanded.includes('Lima (Provincias)')) expanded.push('Lima (Provincias)');
                } else if (!expanded.includes(r)) {
                    expanded.push(r);
                }
            }
            norm.regiones = expanded;
            touched = true;
        }
        return norm;
    });
    if (touched) save();

    // Si no hay ninguno, sembramos uno vacío en editing
    if (state.envios.grupos.length === 0) {
        state.envios.grupos.push(makeEmptyGroup());
        save();
    }

    // ── State del montaje ────────────────────────────────────────────
    // cardCleanups: cardAPI por id (incluye refreshPicker y refreshEmptyWarning)
    const cardCleanups = new Map();
    // mounted flag: protege contra mutación post-unmount cuando un confirmModal
    // sigue abierto. Mismo patrón mySequence/aborted que el autogen de localCard.
    let mounted = true;

    container.innerHTML = `
        <div class="qw-subform-title">Grupos de envío a domicilio</div>
        <div class="qw-section-error" data-section-error role="alert" aria-live="polite"></div>
        <div class="qw-shipping-groups-list" id="qw-shipping-groups-list"></div>
        <button type="button" class="qw-btn qw-btn-secondary qw-btn-add" data-action="add-group">
            + Agregar otro grupo de envío
        </button>
    `;

    const listEl = container.querySelector('#qw-shipping-groups-list');
    const addBtn = container.querySelector('[data-action="add-group"]');
    const sectionErrEl = container.querySelector('[data-section-error]');

    const findCardEl = (id) => listEl.querySelector(`[data-group-id="${CSS.escape(id)}"]`);

    const detachCard = (id) => {
        const api = cardCleanups.get(id);
        if (api?.cleanup) {
            try { api.cleanup(); } catch (e) { console.warn('[groupsList] cleanup error', e); }
        }
        cardCleanups.delete(id);
    };

    // ── Render + attach de una card ──────────────────────────────────
    const renderCardAndAttach = (grupo, index, { initial = false } = {}) => {
        const mode = grupo.saved ? 'saved' : 'editing';
        const html = renderShippingGroupCardHtml(grupo, { mode, index });
        const wrap = document.createElement('div');
        wrap.innerHTML = html.trim();
        const cardEl = wrap.firstElementChild;
        if (initial) cardEl.dataset.initial = 'true';
        listEl.appendChild(cardEl);
        attachWithCallbacks(cardEl, grupo);
        return cardEl;
    };

    // ── Convergencia: propagateRegionChange ─────────────────────────
    // Helper único llamado por AMBOS caminos que modifican regiones:
    //   1. Card mutates own regiones → card.onChange → propagateRegionChange(grupo.id)
    //      (skipea self porque el card ya refrescó su picker localmente)
    //   2. handleCollision mutates two grupos sync → propagateRegionChange(null)
    //      (no skipea — ambos pickers afectados necesitan re-render desde
    //      este nivel)
    // Sin esta convergencia, futuros side effects post-region-change
    // tendrían que agregarse en dos lugares y se generaría drift.
    const propagateRegionChange = (skipGroupId = null) => {
        save();
        refreshAllOtherPickers(skipGroupId);
        refreshAllEmptyWarnings();
        onChange?.();
    };

    const attachWithCallbacks = (cardEl, grupo) => {
        const api = attachShippingGroupCard(cardEl, grupo, {
            onSave: () => transitionTo(grupo, 'saved', cardEl),
            onEdit: () => transitionTo(grupo, 'editing', cardEl),
            onDelete: () => requestDelete(grupo),
            // Card mutó su propio state → propagate skipeando self
            onChange: () => propagateRegionChange(grupo.id),
            onCollision: (region, otherGroupId) => handleCollision(grupo, region, otherGroupId),
            onRequestAddRegionsFocus: () => focusGroupPicker(grupo.id),
            getOtherSelectedBy: () => computeOtherSelectedBy(grupo.id, state.envios.grupos),
        });
        cardCleanups.set(grupo.id, api);
    };

    // ── Transición de modo (editing ↔ saved) ─────────────────────────
    const transitionTo = (grupo, newMode, oldCardEl) => {
        detachCard(grupo.id);
        grupo.saved = newMode === 'saved';
        save();
        const idx = state.envios.grupos.indexOf(grupo);
        const html = renderShippingGroupCardHtml(grupo, { mode: newMode, index: idx });
        const wrap = document.createElement('div');
        wrap.innerHTML = html.trim();
        const newCardEl = wrap.firstElementChild;
        oldCardEl.replaceWith(newCardEl);
        attachWithCallbacks(newCardEl, grupo);
        refreshAllOtherPickers(null); // todos los pickers ven nueva config
        onChange?.();
    };

    // ── Collision (mover región desde otro grupo) ────────────────────
    const handleCollision = async (currentGroup, region, otherGroupId) => {
        if (!mounted) return;
        const otherGroup = state.envios.grupos.find(g => g.id === otherGroupId);
        if (!otherGroup) return;
        const otherIdx = state.envios.grupos.indexOf(otherGroup);
        const otherLabel = `Grupo ${otherIdx + 1}`;

        const ok = await confirmModal({
            title: `¿Mover "${region}" a este grupo?`,
            message: `Esa región está actualmente en ${otherLabel}. Si confirmas, se mueve de ${otherLabel} a este grupo en una sola operación.`,
            confirmText: 'Sí, mover',
            cancelText: 'Cancelar',
        });
        if (!ok || !mounted) return;

        // Mutación atómica — sync, sin awaits intermedios.
        otherGroup.regiones = (otherGroup.regiones || []).filter(r => r !== region);
        if (!currentGroup.regiones.includes(region)) {
            currentGroup.regiones.push(region);
        }
        // propagateRegionChange(null) → ambos pickers afectados re-renderan
        // (no skipeamos: la mutación fue externa al card, ningún card
        // refrescó nada localmente). save + empty warnings + upward onChange
        // viajan por el mismo handler que la mutación del card.
        propagateRegionChange(null);
    };

    // ── Refresh helpers ──────────────────────────────────────────────
    const refreshAllOtherPickers = (skipGroupId) => {
        for (const g of state.envios.grupos) {
            if (g.id === skipGroupId) continue;
            const api = cardCleanups.get(g.id);
            api?.refreshPicker?.();
        }
    };

    const refreshAllEmptyWarnings = () => {
        for (const g of state.envios.grupos) {
            const api = cardCleanups.get(g.id);
            api?.refreshEmptyWarning?.();
        }
    };

    // ── Foco al picker (botón "+ Agregar regiones" del warning) ──────
    const focusGroupPicker = (groupId) => {
        const grupo = state.envios.grupos.find(g => g.id === groupId);
        if (!grupo) return;
        // Si el grupo está en saved con regiones=[] (empty warning visible),
        // primero hay que volver a editing para mostrar el picker.
        if (grupo.saved) {
            const cardEl = findCardEl(groupId);
            if (cardEl) transitionTo(grupo, 'editing', cardEl);
        }
        const cardEl = findCardEl(groupId);
        if (!cardEl) return;
        const searchInput = cardEl.querySelector('.qw-region-search');
        if (searchInput) {
            searchInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
            // Después del scroll, foco al search
            setTimeout(() => searchInput.focus({ preventScroll: true }), 350);
        }
    };

    // ── Delete con confirmación si tiene contenido ───────────────────
    const requestDelete = async (grupo) => {
        const hasContent =
            (grupo.regiones?.length || 0) > 0 ||
            grupo.modalidadCosto ||
            grupo.tiempoEntrega ||
            grupo.agencias ||
            grupo.notas;
        if (hasContent) {
            const ok = await confirmModal({
                title: '¿Eliminar este grupo?',
                message: 'Vas a perder su modalidad, tiempo de entrega, agencias y notas si las tenías configuradas.',
                confirmText: 'Sí, eliminar',
                cancelText: 'Cancelar',
            });
            if (!ok || !mounted) return;
        }
        detachCard(grupo.id);
        state.envios.grupos = state.envios.grupos.filter(g => g.id !== grupo.id);
        save();

        const cardEl = findCardEl(grupo.id);
        if (cardEl) {
            cardEl.dataset.leaving = 'true';
            cardEl.removeAttribute('data-group-id');
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

        if (state.envios.grupos.length === 0) {
            const fresh = makeEmptyGroup();
            state.envios.grupos.push(fresh);
            save();
            renderCardAndAttach(fresh, 0);
        } else {
            refreshIndices();
            refreshAllOtherPickers(null);
            refreshAllEmptyWarnings();
        }
        onChange?.();
    };

    const refreshIndices = () => {
        state.envios.grupos.forEach((g, i) => {
            const cardEl = findCardEl(g.id);
            if (!cardEl) return;
            const numEl = cardEl.querySelector('.qw-shipping-group-card-num');
            if (numEl) numEl.textContent = `Grupo ${i + 1}`;
        });
    };

    const addGroup = () => {
        const fresh = makeEmptyGroup();
        state.envios.grupos.push(fresh);
        save();
        const cardEl = renderCardAndAttach(fresh, state.envios.grupos.length - 1);
        if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            cardEl.animate(
                [
                    { transform: 'translateY(20px)', opacity: 0 },
                    { transform: 'translateY(0)',    opacity: 1 },
                ],
                { duration: 300, easing: 'ease-out' }
            );
        }
        // Scroll al nuevo
        cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        refreshAllOtherPickers(fresh.id);
        onChange?.();
    };

    const onAddClick = () => addGroup();
    addBtn.addEventListener('click', onAddClick);

    // ── Render inicial — hidrata desde state ─────────────────────────
    state.envios.grupos.forEach((g, i) => renderCardAndAttach(g, i, { initial: true }));

    // ── API pública ─────────────────────────────────────────────────
    return {
        cleanup: () => {
            mounted = false;
            addBtn.removeEventListener('click', onAddClick);
            for (const api of cardCleanups.values()) {
                try { api.cleanup?.(); } catch (e) { console.warn('[groupsList] cleanup', e); }
            }
            cardCleanups.clear();
        },
        // Validaciones — los usa screen3 para Continuar
        hasSavedGroup: () =>
            state.envios.grupos.some(g => g.saved && isGroupValid(g)),
        hasEmptyGroup: () =>
            state.envios.grupos.some(g => g.saved && (g.regiones || []).length === 0),
        // Para el guard de Continuar — focuses el primer grupo vacío
        focusFirstEmptyGroupPicker: () => {
            const empty = state.envios.grupos.find(g => g.saved && (g.regiones || []).length === 0);
            if (empty) focusGroupPicker(empty.id);
        },
        // Inline error setter — screen3 lo usa para "guardá al menos un grupo"
        setSectionError: (msg) => {
            if (sectionErrEl) sectionErrEl.textContent = msg || '';
        },
        shakeAdd: () => {
            // Importar shake inline para no crear dependencia circular
            if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                addBtn.animate([
                    { transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' },
                    { transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' },
                    { transform: 'translateX(0)' },
                ], { duration: 300, easing: 'ease-out' });
            }
        },
        // Indicador para que screen3 sepa que NO es el stub de iter 1
        isStub: false,
    };
}

// ════════════════════════════════════════════════════════════════════════
// regionPicker — selector reutilizable de regiones del Perú
//
// Dos modos, dos APIs separadas (NO un dispatcher con `mode` param). Razón:
// son UIs fundamentalmente distintas, compartir solo el dato (PERU_REGIONS)
// y los helpers de escape. Unificarlas forzaría branching y no produciría
// reuso real.
//
//   single (P3 Locales):  <select> nativo. Browser handles dropdown, kb nav,
//                          mobile picker. Render fn + attach fn — 30 líneas.
//
//   multi  (P3 Grupos):   widget custom con búsqueda, chips, atajos,
//                          counter, estados disponible/seleccionado/tomado.
//                          Caller "controla" el componente: el picker no
//                          guarda state de selected (excepto searchText);
//                          el caller emite eventos y llama update() para
//                          re-renderizar con state fresco.
//
// API multi:
//   renderRegionPickerMulti({ id, selected, otherSelectedBy }): HTML string
//   attachRegionPickerMulti(container, callbacks): { cleanup, update }
//
// callbacks:
//   onAddRegion(region)                  — usuario clickeó una región libre
//   onRemoveRegion(region)               — click en [✕] de un chip seleccionado
//   onSelectAll()                        — atajo "Todas" (solo disponibles, no
//                                          fuerza moves de otros grupos)
//   onClearAll()                         — atajo "Ninguna"
//   onCollision(region, otherGroupId)    — click en región tomada por otro grupo
//
// update(selected, otherSelectedBy)      — re-render con state fresco
//
// otherSelectedBy: Map<region, { id, label }> con la info del OTRO grupo
//   que tiene esa región. id se usa para callbacks; label es lo que se
//   muestra en pantalla ("Grupo 2").
// ════════════════════════════════════════════════════════════════════════

import { PERU_REGIONS } from './peruRegions.js';
import { escapeAttr, escapeText } from '../../lib/escape.js';

// ─── Modo SINGLE ────────────────────────────────────────────────────────
export function renderRegionSelectSingle({ id, value = '', name = 'region', required = true }) {
    const options = [
        `<option value="" ${value === '' ? 'selected' : ''}>— Selecciona la región —</option>`,
        ...PERU_REGIONS.map(r => {
            const selected = r === value ? 'selected' : '';
            return `<option value="${escapeAttr(r)}" ${selected}>${escapeText(r)}</option>`;
        }),
    ].join('');
    return `
        <select class="qw-input qw-region-select" id="${escapeAttr(id)}" name="${escapeAttr(name)}" ${required ? 'required' : ''} aria-required="${required ? 'true' : 'false'}">
            ${options}
        </select>
    `;
}

export function attachRegionSelectSingle(container, { id, onChange }) {
    const sel = container.querySelector(`#${CSS.escape(id)}`);
    if (!sel) return () => {};
    const handler = () => onChange(sel.value);
    sel.addEventListener('change', handler);
    return () => sel.removeEventListener('change', handler);
}

// ─── Modo MULTI ─────────────────────────────────────────────────────────
export function renderRegionPickerMulti({ id, selected = [], otherSelectedBy = new Map() }) {
    return `
        <div class="qw-region-picker" data-picker-id="${escapeAttr(id)}">
            <div class="qw-region-picker-header">
                <span class="qw-region-counter" data-counter></span>
                <div class="qw-region-atajos">
                    <button type="button" class="qw-btn-link" data-action="all">Todas</button>
                    <button type="button" class="qw-btn-link" data-action="none">Ninguna</button>
                </div>
            </div>
            <input type="text" class="qw-input qw-region-search" data-search
                   placeholder="🔍 Buscar departamento..."
                   aria-label="Buscar región">
            <div class="qw-region-selected-section">
                <div class="qw-region-section-label">Seleccionadas</div>
                <div class="qw-region-selected-list" data-selected-list></div>
            </div>
            <div class="qw-region-options-section">
                <div class="qw-region-section-label">Disponibles</div>
                <div class="qw-region-options-list" data-options-list></div>
            </div>
        </div>
    `;
}

function renderSelectedChips(selected) {
    if (selected.length === 0) {
        return `<div class="qw-region-empty">Ninguna región seleccionada aún.</div>`;
    }
    return selected.map(r => `
        <button type="button" class="qw-region-chip qw-region-chip-selected"
                data-region="${escapeAttr(r)}" data-action="remove"
                aria-label="Quitar ${escapeAttr(r)}">
            ${escapeText(r)}<span class="qw-region-chip-x" aria-hidden="true">✕</span>
        </button>
    `).join('');
}

function renderOptions(selected, otherSelectedBy, searchText) {
    const selectedSet = new Set(selected);
    const q = searchText.trim().toLowerCase();
    const filterFn = q
        ? (r) => r.toLowerCase().includes(q)
        : () => true;

    const available = [];
    const taken = [];
    for (const r of PERU_REGIONS) {
        if (selectedSet.has(r)) continue; // ya está arriba como chip
        if (!filterFn(r)) continue;
        if (otherSelectedBy.has(r)) {
            taken.push({ region: r, ...otherSelectedBy.get(r) });
        } else {
            available.push(r);
        }
    }

    if (available.length === 0 && taken.length === 0) {
        return `<div class="qw-region-empty">No hay regiones que coincidan${q ? ' con "' + escapeText(searchText) + '"' : ''}.</div>`;
    }

    const availableHtml = available.map(r => `
        <button type="button" class="qw-region-option qw-region-option-available"
                data-region="${escapeAttr(r)}" data-action="add">
            ${escapeText(r)}
        </button>
    `).join('');

    // Las regiones tomadas por otros grupos van en un sub-grupo con header
    // dedicado. Label permanente debajo del chip (no tooltip) para que
    // funcione en mobile.
    const takenHtml = taken.length > 0 ? `
        <div class="qw-region-options-separator">En otros grupos</div>
        ${taken.map(t => `
            <div class="qw-region-option-wrapper">
                <button type="button" class="qw-region-option qw-region-option-taken"
                        data-region="${escapeAttr(t.region)}"
                        data-action="collision"
                        data-other-group-id="${escapeAttr(t.id)}"
                        aria-label="${escapeAttr(t.region)} (actualmente en ${escapeAttr(t.label)})">
                    ${escapeText(t.region)}
                </button>
                <span class="qw-region-taken-label" aria-hidden="true">En ${escapeText(t.label)}</span>
            </div>
        `).join('')}
    ` : '';

    return availableHtml + takenHtml;
}

function renderCounter(myCount, otherCount) {
    const total = PERU_REGIONS.length;
    const availableCount = total - otherCount - myCount;
    return `${myCount} de ${total} regiones · ${availableCount} disponibles`;
}

export function attachRegionPickerMulti(container, callbacks = {}) {
    const pickerEl = container.querySelector('.qw-region-picker');
    if (!pickerEl) return { cleanup: () => {}, update: () => {} };

    // searchText vive en el closure — UI state local del picker, no en el
    // domain state del caller.
    let searchText = '';
    let lastSelected = [];
    let lastOtherSelectedBy = new Map();

    const counterEl = pickerEl.querySelector('[data-counter]');
    const selectedListEl = pickerEl.querySelector('[data-selected-list]');
    const optionsListEl = pickerEl.querySelector('[data-options-list]');
    const searchEl = pickerEl.querySelector('[data-search]');

    const renderInternal = () => {
        counterEl.textContent = renderCounter(lastSelected.length, lastOtherSelectedBy.size);
        selectedListEl.innerHTML = renderSelectedChips(lastSelected);
        optionsListEl.innerHTML = renderOptions(lastSelected, lastOtherSelectedBy, searchText);
    };

    // Delegación de clicks — un solo listener para todo el picker
    const onClick = (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const action = btn.dataset.action;
        const region = btn.dataset.region;
        switch (action) {
            case 'add':       callbacks.onAddRegion?.(region); break;
            case 'remove':    callbacks.onRemoveRegion?.(region); break;
            case 'collision': callbacks.onCollision?.(region, btn.dataset.otherGroupId); break;
            case 'all':       callbacks.onSelectAll?.(); break;
            case 'none':      callbacks.onClearAll?.(); break;
        }
    };
    pickerEl.addEventListener('click', onClick);

    const onSearch = (e) => {
        searchText = e.target.value;
        // Solo re-renderiza el grid de disponibles — los chips seleccionados
        // no se filtran (siempre se ven todos los seleccionados)
        optionsListEl.innerHTML = renderOptions(lastSelected, lastOtherSelectedBy, searchText);
    };
    searchEl?.addEventListener('input', onSearch);

    const update = (selected, otherSelectedBy) => {
        lastSelected = selected || [];
        lastOtherSelectedBy = otherSelectedBy || new Map();
        renderInternal();
    };

    const cleanup = () => {
        pickerEl.removeEventListener('click', onClick);
        searchEl?.removeEventListener('input', onSearch);
    };

    return { cleanup, update };
}

// Helper exportado para los callers: dadas las regiones de PERU_REGIONS y
// el state actual de grupos, devuelve regiones no cubiertas. coverageWarning
// lo usa.
export function computeUncoveredRegions(grupos) {
    const covered = new Set();
    for (const g of grupos || []) {
        if (!g.saved) continue;
        for (const r of (g.regiones || [])) covered.add(r);
    }
    return PERU_REGIONS.filter(r => !covered.has(r));
}

// Helper: dado el grupo activo y todos los grupos guardados, computa el Map
// otherSelectedBy de las regiones que están en grupos distintos al activo.
// El callsite (shippingGroupsList) lo invoca cada vez que renderiza una card.
export function computeOtherSelectedBy(currentGroupId, allGroups) {
    const map = new Map();
    let groupNum = 0;
    for (const g of allGroups || []) {
        groupNum++;
        if (g.id === currentGroupId) continue;
        if (!Array.isArray(g.regiones)) continue;
        const label = `Grupo ${groupNum}`;
        for (const r of g.regiones) {
            // En caso de duplicados (no debería pasar si las invariantes se
            // mantienen), nos quedamos con el primer encontrado.
            if (!map.has(r)) map.set(r, { id: g.id, label });
        }
    }
    return map;
}

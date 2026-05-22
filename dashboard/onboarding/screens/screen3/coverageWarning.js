// ════════════════════════════════════════════════════════════════════════
// coverageWarning — banner expandible cuando hay regiones del Perú no
// cubiertas por ningún grupo guardado.
//
// API:
//   renderCoverageWarning(container, { uncoveredRegions }): { cleanup, update }
//
// El caller (screen3) llama update(uncovered) cada vez que cambia la lista
// de regiones no cubiertas (post add/remove/save de grupo). El banner se
// auto-oculta cuando uncovered.length === 0.
//
// Comportamiento:
//   - Banner compacto con count + flecha
//   - Click expande/colapsa la lista de regiones faltantes (con anim)
//   - El state expanded/collapsed se mantiene local al componente
//
// No es error crítico — el spec dice "Willy dirá que no envías ahí", o sea
// es info importante pero el usuario PUEDE continuar igual. Por eso es un
// warning amber, no un error que bloquee Continuar.
// ════════════════════════════════════════════════════════════════════════

import { escapeText } from '../../lib/escape.js';

export function renderCoverageWarning(container) {
    container.innerHTML = `<div data-coverage-slot></div>`;
    const slot = container.querySelector('[data-coverage-slot]');
    let expanded = false;
    let onToggle = null;

    const update = (uncoveredRegions = []) => {
        if (uncoveredRegions.length === 0) {
            // Quitamos listener previo si existía
            if (onToggle) {
                slot.removeEventListener('click', onToggle);
                onToggle = null;
            }
            slot.innerHTML = '';
            return;
        }
        const count = uncoveredRegions.length;
        const word = count === 1 ? 'región' : 'regiones';
        slot.innerHTML = `
            <div class="qw-coverage-warning ${expanded ? 'qw-coverage-warning-expanded' : ''}" role="alert">
                <button type="button" class="qw-coverage-warning-toggle"
                        aria-expanded="${expanded ? 'true' : 'false'}"
                        data-action="toggle-coverage">
                    <span class="qw-coverage-warning-icon" aria-hidden="true">⚠️</span>
                    <span class="qw-coverage-warning-text">
                        Hay ${count} ${word} sin configurar. Willy dirá que no envías ahí.
                    </span>
                    <span class="qw-coverage-warning-caret" aria-hidden="true">${expanded ? '▾' : '▸'}</span>
                </button>
                <div class="qw-coverage-warning-list" ${expanded ? '' : 'hidden'}>
                    ${uncoveredRegions.map(r => `
                        <span class="qw-region-chip qw-region-chip-readonly qw-region-chip-warning">${escapeText(r)}</span>
                    `).join('')}
                </div>
            </div>
        `;

        // Re-wire toggle listener (innerHTML borra todo, re-bindeamos)
        if (onToggle) slot.removeEventListener('click', onToggle);
        onToggle = (e) => {
            const btn = e.target.closest('[data-action="toggle-coverage"]');
            if (!btn) return;
            expanded = !expanded;
            update(uncoveredRegions); // re-render con nuevo estado
        };
        slot.addEventListener('click', onToggle);
    };

    const cleanup = () => {
        if (onToggle) slot.removeEventListener('click', onToggle);
        onToggle = null;
        slot.innerHTML = '';
    };

    return { cleanup, update };
}

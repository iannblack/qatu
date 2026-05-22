// ════════════════════════════════════════════════════════════════════════
// methodCard — card multi-select para método de pago (5 instancias en P4)
//
// Render: button con role="checkbox" + aria-checked. Click toggle dispara
// onToggle(newChecked) — el orchestrator se encarga de mutar state, montar
// /desmontar el form y refrescar Continuar.
//
// Animaciones:
//   - bounce al toggle (scale 1→1.08→1, spring) via clase `qw-just-toggled`
//   - SVG path drawing del check (stroke-dashoffset 30→0 con transition)
//
// Icons: Yape/Plin con letra coloreada por brand color (CSS vars del spec
// sec 2.1). Resto con emoji.
// ════════════════════════════════════════════════════════════════════════

import { escapeAttr, escapeText } from '../../lib/escape.js';

export const METHODS = [
    { id: 'yape',          label: 'Yape',          icon: { type: 'letter', value: 'Y', cssClass: 'qw-icon-yape' } },
    { id: 'plin',          label: 'Plin',          icon: { type: 'letter', value: 'P', cssClass: 'qw-icon-plin' } },
    { id: 'transferencia', label: 'Transferencia', icon: { type: 'emoji',  value: '🏦' } },
    { id: 'tarjeta',       label: 'Tarjeta',       icon: { type: 'emoji',  value: '💳' } },
    { id: 'efectivo',      label: 'Efectivo',      icon: { type: 'emoji',  value: '💵' } },
];

function renderIcon(icon) {
    if (icon.type === 'letter') {
        return `<span class="qw-payment-card-icon qw-payment-card-icon-letter ${escapeAttr(icon.cssClass)}" aria-hidden="true">${escapeText(icon.value)}</span>`;
    }
    return `<span class="qw-payment-card-icon qw-payment-card-icon-emoji" aria-hidden="true">${escapeText(icon.value)}</span>`;
}

export function renderMethodCard({ id, label, icon, checked }) {
    return `
        <button type="button" class="qw-payment-card${checked ? ' qw-checked' : ''}"
                role="checkbox" aria-checked="${checked ? 'true' : 'false'}"
                data-method="${escapeAttr(id)}"
                aria-label="${escapeAttr(label)}">
            ${renderIcon(icon)}
            <span class="qw-payment-card-label">${escapeText(label)}</span>
            <svg class="qw-payment-check" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 12 L10 17 L20 7" fill="none" stroke="currentColor"
                      stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        </button>
    `;
}

export function attachMethodCard(cardEl, { onToggle }) {
    const handler = () => {
        const wasChecked = cardEl.getAttribute('aria-checked') === 'true';
        // Re-trigger bounce animation
        cardEl.classList.remove('qw-just-toggled');
        void cardEl.offsetWidth;
        cardEl.classList.add('qw-just-toggled');
        onToggle?.(!wasChecked);
    };
    cardEl.addEventListener('click', handler);
    return () => cardEl.removeEventListener('click', handler);
}

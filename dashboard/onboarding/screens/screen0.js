// ════════════════════════════════════════════════════════════════════════
// Pantalla 0 — Bienvenida
// Spec: spec section 5 → "PANTALLA 0 — Bienvenida"
//
// Layout: Willy a la izquierda, speech bubble grande a la derecha con dos
// botones apilados verticalmente dentro del bubble.
//   "¡Vamos a darle!"        → avanza a Pantalla 1
//   "Ya tengo algo configurado" → abre modal de upload (TODO siguiente iter)
//
// Entrada animada (todos vía CSS, durations alineadas con el spec):
//   1. Willy slide-up + fade-in (0.5s spring, transform-origin bottom)
//   2. Bubble scale-in 0.85→1 con delay 0.2s
//   3. Pregunta con typewriter 25ms/char (delay 0.5s)
//   4. Botones stagger-in con delays 0.5s y 0.6s
//
// Devuelve una función de cleanup que cancela timers + blink + typewriter.
// El orchestrator la llama antes de re-renderizar para no leakear timers.
// ════════════════════════════════════════════════════════════════════════

import { renderWilly, attachReactions, attachBlink } from '../willy.js';
import { typewriter, TYPEWRITER_DELAY } from '../lib/animations.js';

const PREGUNTA = '¿Estás listo para configurar tu tienda?';

export function renderScreen0(container, ctx) {
    container.innerHTML = `
        <div class="qw-scene">
            ${renderWilly('sentado')}
            <div class="qw-bubble" role="dialog" aria-labelledby="qw-greeting">
                <p class="qw-bubble-text" id="qw-greeting"></p>
                <div class="qw-bubble-options">
                    <button type="button" class="qw-btn qw-btn-primary"
                            data-stagger style="animation-delay: 0.5s"
                            data-action="start">
                        ¡Vamos a darle!
                    </button>
                    <button type="button" class="qw-btn qw-btn-secondary"
                            data-stagger style="animation-delay: 0.6s"
                            data-action="upload">
                        Ya tengo algo configurado
                    </button>
                </div>
            </div>
        </div>
    `;

    // Typewriter — P0 es presentacional, esperamos a que el bubble termine
    // su scale-in para dar el beat dramático. typewriter() devuelve una fn
    // para cancelar a mitad — la guardamos por si la screen se desmonta
    // antes de terminar de "escribirse".
    const greetEl = container.querySelector('#qw-greeting');
    let cancelTypewriter = null;
    const typewriterDelay = setTimeout(() => {
        cancelTypewriter = typewriter(greetEl, PREGUNTA, 25);
    }, TYPEWRITER_DELAY.PRESENTATIONAL);

    // Acciones
    container.querySelector('[data-action="start"]')
        .addEventListener('click', () => ctx.next());

    container.querySelector('[data-action="upload"]')
        .addEventListener('click', () => {
            // "Ya tengo algo configurado" → dispara el mismo file picker que
            // antes vivía en el botón "Subir workflow" de la tarjeta de tienda.
            // El bot activo se resuelve desde window.__configSelectedBotId,
            // que se setea cuando se abre el wizard desde una tarjeta.
            const botId = window.__configSelectedBotId
                || ctx?.botId
                || ctx?.state?.botId
                || null;
            if (botId) {
                window.__pendingStoreImportBotId = botId;
            }
            const fileInput = document.getElementById('store-import-file');
            if (fileInput) {
                fileInput.click();
            } else {
                console.warn('[wizard] store-import-file input no encontrado');
            }
            // No avanzamos al siguiente step — el upload handler hace
            // navigateToStoreConfig() cuando completa, y eso ya cierra el wizard
            // y reabre la sección con el workflow recién importado.
        });

    // Willy reacciona a hover/click de los botones + ciclo de blink
    const stopReactions = attachReactions(container);
    const stopBlink = attachBlink(container, 'sentado');

    // Cleanup — el orchestrator lo invoca antes de re-renderizar.
    // Convención obligatoria: toda screen DEBE retornar su fn de cleanup.
    return () => {
        clearTimeout(typewriterDelay);
        cancelTypewriter?.();
        stopReactions();
        stopBlink();
    };
}

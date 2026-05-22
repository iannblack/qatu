// ════════════════════════════════════════════════════════════════════════
// ChatPreview — simulación de chat WhatsApp en vivo (P5)
//
// 2 burbujas: bot (izquierda, blanca) + cliente (derecha, verde #DCF8C6).
// Las cambia un caller via update(mode, tono) → typewriter del nuevo
// contenido. La burbuja del cliente arranca después del bot para que se
// sienta como conversación real (bot pregunta, cliente responde).
//
// Cancel pattern: cada update() cancela cualquier typewriter en vuelo y
// arranca de cero. Click rápido = swap inmediato al último mensaje, sin
// solapar texto anterior. Si el mensaje no cambió respecto al último,
// no-op (preserva typewriter activo si lo había).
//
// API:
//   renderChatPreview({ id }): string HTML
//   attachChatPreview(container, { id, initialMode, initialTono }):
//     { cleanup, update(mode, tono) }
//
// CSS dependency: .qw-chat-bubble necesita `white-space: pre-wrap` para
// que los \n en los mensajes (listas numeradas) se rendereen como saltos
// de línea reales en el DOM.
// ════════════════════════════════════════════════════════════════════════

import { typewriter, TYPEWRITER_DELAY, TYPEWRITER_SPEED } from '../../lib/animations.js';
import { escapeAttr } from '../../lib/escape.js';

// 2×3 matrix de mensajes hardcodeados.
// Claves: modo (botones / conversacional) × tono (profesional / formal / casual).
// bot: 1er mensaje del bot. cli: respuesta del cliente. bot2: segunda
// respuesta del bot, continuando la conversación. Los 3 turnos se
// animan en orden (bot → cli → bot2) para mostrar que aunque el bot
// presente botones, el cliente puede responder libre y el bot responde
// conversacional.
// \n preserva los saltos de línea — el CSS los rendera como breaks.
const PREVIEW_MESSAGES = {
    botones: {
        profesional: {
            bot: "Hola, soy Willy de la tienda. Estos son los productos disponibles:\n1. Producto 1\n2. Producto 2\n3. Producto 3\n\nIndícame el número o el nombre del que te interese.",
            cli: "Me interesa el segundo, ¿cuánto cuesta?",
            bot2: "¡Buena elección! El Producto 2 cuesta S/ 49.90 e incluye envío gratis a Lima. ¿Quieres que te lo separe?",
        },
        formal: {
            bot: "Buenos días. Estos son nuestros productos disponibles:\n1. Producto 1\n2. Producto 2\n3. Producto 3\n\nPor favor, responda con el número o el nombre de su elección.",
            cli: "Quisiera conocer el precio del segundo.",
            bot2: "Con gusto. El Producto 2 tiene un costo de S/ 49.90 e incluye envío sin cargo a Lima. ¿Desea que se lo reserve?",
        },
        casual: {
            bot: "¡Hola! Mira lo que tenemos:\n1. Producto 1\n2. Producto 2\n3. Producto 3\n\n¿Cuál te interesa? Manda el número o el nombre.",
            cli: "Cuánto cuesta el 2? Me llama la atención",
            bot2: "¡Está chévere ese! El Producto 2 sale S/ 49.90 con envío gratis a Lima. ¿Te lo aparto?",
        },
    },
    conversacional: {
        profesional: {
            bot: "Hola, soy Willy, asistente de la tienda. Cuéntame qué producto estás buscando y te paso los detalles y el precio.",
            cli: "Quiero ver opciones para regalar.",
            bot2: "Claro, tenemos varias opciones ideales para regalo. ¿Para qué ocasión es y cuál es tu presupuesto aproximado?",
        },
        formal: {
            bot: "Buenos días. Soy Willy, asistente de ventas. ¿En qué puedo ayudarle hoy? Cuénteme qué está buscando y le doy detalles.",
            cli: "Quiero ver los precios de los productos.",
            bot2: "Con gusto le comparto el detalle. ¿Tiene algún tipo de producto en mente, o prefiere que le envíe el catálogo completo?",
        },
        casual: {
            bot: "¡Hola! Soy Willy. Cuéntame qué andas buscando hoy y te ayudo a encontrarlo. Tenemos varias opciones.",
            cli: "Estoy viendo productos, ¿qué tienen?",
            bot2: "¡Bacán! Mira, tenemos varias categorías. ¿Te tira más algo deportivo, algo casual o algo más formal? Así te muestro lo top.",
        },
    },
};

export function renderChatPreview({ id }) {
    return `
        <div class="qw-chat-preview" data-preview-id="${escapeAttr(id)}" aria-label="Simulación de chat" role="presentation">
            <div class="qw-chat-bubble qw-chat-bubble-bot" data-bot-bubble></div>
            <div class="qw-chat-bubble qw-chat-bubble-client" data-client-bubble></div>
            <div class="qw-chat-bubble qw-chat-bubble-bot" data-bot2-bubble></div>
        </div>
    `;
}

// ── Tempo del preview ───────────────────────────────────────────────────
// Speed locales más lentos que TYPEWRITER_SPEED.CHAT (18). Esta pantalla
// es presentacional — el usuario observa el ejemplo, no espera respuesta.
// Mantenerlo lento hace legible la conversación y refuerza la sensación
// de "WhatsApp tipeando en tiempo real".
const CHAR_SPEED_MS = 55;           // ms por caracter (~3x más lento que CHAT=18)
const GAP_BETWEEN_TURNS_MS = 700;   // pausa entre fin de un turno y empiece del siguiente
const LOOP_PAUSE_MS = 3500;         // pausa al final del ciclo antes de reiniciar

export function attachChatPreview(container, { id, initialMode, initialTono } = {}) {
    const preview = container.querySelector(`[data-preview-id="${CSS.escape(id)}"]`);
    if (!preview) return { cleanup: () => {}, update: () => {} };

    const botBubble = preview.querySelector('[data-bot-bubble]');
    const cliBubble = preview.querySelector('[data-client-bubble]');
    const bot2Bubble = preview.querySelector('[data-bot2-bubble]');

    // runId: cada call a update() incrementa este id. Cualquier paso de
    // animación asíncrono verifica que su id coincida antes de actuar; si
    // no, se aborta silenciosamente. Patrón estándar para invalidar runs
    // viejos cuando llega un cambio (tono/mode) sin tener que cancelar
    // manualmente cada timer/typewriter.
    let runId = 0;
    let aborted = false;
    const timers = new Set();
    const cancels = new Set();

    const clearAll = () => {
        for (const t of timers) clearTimeout(t);
        timers.clear();
        for (const c of cancels) { try { c(); } catch (_) { /* no-op */ } }
        cancels.clear();
    };

    // Espera ms cancelable. Resuelve aun si el run se aborta — el caller
    // verifica runId después del await para decidir si sigue.
    const sleep = (ms) => new Promise((resolve) => {
        const t = setTimeout(() => {
            timers.delete(t);
            resolve();
        }, ms);
        timers.add(t);
    });

    // Anima una burbuja y resuelve cuando termina el typewriter O cuando
    // el cancel asociado se invoca (por clearAll). El doble-guard evita
    // double-resolve y promesas colgadas tras un cambio de tono.
    const animateBubble = (bubble, text) => new Promise((resolve) => {
        bubble.textContent = '';
        let done = false;
        const safeResolve = () => { if (!done) { done = true; resolve(); } };
        const cancel = typewriter(bubble, text, CHAR_SPEED_MS, safeResolve);
        // Cuando se cancela mid-type, también resolvemos la promesa para
        // no dejar el runLoop colgado.
        const wrapped = () => { cancel(); safeResolve(); };
        cancels.add(wrapped);
    });

    const runLoop = async (myRunId, msgs) => {
        // Loop infinito controlado por aborted + runId.
        // Cada turno verifica antes de seguir; cualquier cambio de tono
        // incrementa runId y rompe el while en el siguiente check.
        while (!aborted && runId === myRunId) {
            // Reset visual: vaciar las 3 burbujas. CSS `:empty` las colapsa
            // para que la card no muestre huecos durante el restart.
            botBubble.textContent = '';
            cliBubble.textContent = '';
            bot2Bubble.textContent = '';

            await sleep(TYPEWRITER_DELAY.CHAT_PREVIEW);
            if (aborted || runId !== myRunId) return;

            await animateBubble(botBubble, msgs.bot);
            if (aborted || runId !== myRunId) return;
            await sleep(GAP_BETWEEN_TURNS_MS);
            if (aborted || runId !== myRunId) return;

            await animateBubble(cliBubble, msgs.cli);
            if (aborted || runId !== myRunId) return;

            if (msgs.bot2) {
                await sleep(GAP_BETWEEN_TURNS_MS);
                if (aborted || runId !== myRunId) return;
                await animateBubble(bot2Bubble, msgs.bot2);
                if (aborted || runId !== myRunId) return;
            }

            // Pausa al final del ciclo antes de reiniciar.
            await sleep(LOOP_PAUSE_MS);
        }
    };

    const update = (mode, tono) => {
        const msgs = PREVIEW_MESSAGES[mode]?.[tono];
        if (!msgs) return;
        // Invalida el run anterior + cancela todos los timers/typewriters
        // pendientes. El nuevo run arranca desde cero con el nuevo tono.
        runId++;
        clearAll();
        runLoop(runId, msgs);
    };

    // Render inicial — arranca el primer ciclo.
    update(initialMode, initialTono);

    return {
        update,
        cleanup: () => {
            aborted = true;
            clearAll();
        },
    };
}

// ════════════════════════════════════════════════════════════════════════
// Helpers de animación — typewriter, shake y utilidades de reflow.
// Todas respetan prefers-reduced-motion.
// ════════════════════════════════════════════════════════════════════════

// Delay (ms) del typewriter desde el render de la screen / cambio de mensaje.
// Calibrado por contexto:
//
// PRESENTATIONAL (P0, P6) — espera a que el bubble termine su scale-in
//   (qw-bubble-in: delay 200ms + duration 300ms = 500ms). Beat dramático
//   "Willy abre la boca, pausa, habla". Para pantallas de presentación.
//
// FORM (P1–P5 bubble principal) — el typewriter empieza al mismo tiempo
//   que la bubble. Texto y burbuja crecen juntos. Usuario en modo tarea,
//   los 500ms se sienten lentos.
//
// CHAT_PREVIEW (P5 ChatPreview) — pausa muy breve antes de tipear el nuevo
//   mensaje cuando el usuario cambia modo o tono. No es presentacional, es
//   reactivo a su selección: el usuario espera respuesta inmediata.
export const TYPEWRITER_DELAY = {
    PRESENTATIONAL: 500,
    FORM: 200,
    CHAT_PREVIEW: 60,
};

// Velocidad (ms por char) del typewriter. Default 25 (BUBBLE) para los
// preguntas de Willy en bubble principal — deliberado, primera vez. CHAT
// más snappy (18) porque el usuario está comparando opciones en P5 y
// necesita feedback rápido sin perder el efecto "escribiendo".
export const TYPEWRITER_SPEED = {
    BUBBLE: 25,
    CHAT: 18,
};

const reduceMotion = () =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Escribe texto en `el` carácter por carácter.
 * @returns función para cancelar la animación a mitad.
 */
export function typewriter(el, text, speed = 25, onDone) {
    if (!el) return () => {};
    if (reduceMotion()) {
        el.textContent = text;
        onDone?.();
        return () => {};
    }
    el.textContent = '';
    let i = 0;
    const id = setInterval(() => {
        i++;
        el.textContent = text.slice(0, i);
        if (i >= text.length) {
            clearInterval(id);
            onDone?.();
        }
    }, speed);
    return () => clearInterval(id);
}

/** Sacude el elemento horizontalmente — usar para feedback de error en inputs. */
export function shake(el) {
    if (!el || reduceMotion()) return;
    el.animate(
        [
            { transform: 'translateX(-4px)' },
            { transform: 'translateX(4px)' },
            { transform: 'translateX(-4px)' },
            { transform: 'translateX(4px)' },
            { transform: 'translateX(0)' },
        ],
        { duration: 300, easing: 'ease-out' }
    );
}

/** Fuerza un reflow para reiniciar una animación CSS. Uso:
 *    el.classList.remove('foo'); reflow(el); el.classList.add('foo'); */
export function reflow(el) {
    void el.offsetWidth;
}

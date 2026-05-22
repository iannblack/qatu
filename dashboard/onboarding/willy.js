// ════════════════════════════════════════════════════════════════════════
// Willy — fachada del personaje
//
// CONTRATO con las pantallas:
//   Las screens NUNCA tocan el <img> ni los wrappers directamente. Toda la
//   lógica visual de Willy pasa por funciones exportadas de este módulo.
//   Cuando migremos de PNG a SVG por partes, solo cambia este archivo;
//   las 7 pantallas no requieren modificación.
//
// API:
//   renderWilly(pose)               → string HTML (incluir en innerHTML)
//   setPose(container, pose)        → cambia el src en runtime
//   attachReactions(container)      → wire hover/click feedback (cleanup)
//   attachBlink(container, pose)    → ciclo de parpadeo (cleanup)
//
// Convención de assets (en dashboard/assets/willy/):
//   willy-{pose}.png        ojos abiertos
//   willy-{pose}-blink.png  ojos cerrados (mismo encuadre)
//
// Por ahora solo usamos `sentado` para todas las pantallas (decisión
// explícita del producto: las otras poses llegan con la migración a SVG).
// ════════════════════════════════════════════════════════════════════════

const POSES = {
    // pose:        { src: 'open eyes', srcBlink: 'closed eyes' (opcional) }
    sentado:        { src: 'assets/willy/willy-sentado.png',  srcBlink: 'assets/willy/willy-sentado-blink.png' },
    // Aliases — todas apuntan al mismo PNG hasta el SVG. Mantenemos los
    // nombres del spec (saludando, señalando, pensando, celebrando, leyendo,
    // pulgarArriba) para que las screens puedan pedir su pose semántica
    // y, cuando migremos a SVG, solo cambien las refs sin tocar las screens.
    saludando:      { src: 'assets/willy/willy-sentado.png' },
    señalando:      { src: 'assets/willy/willy-sentado.png' },
    pensando:       { src: 'assets/willy/willy-sentado.png' },
    celebrando:     { src: 'assets/willy/willy-sentado.png' },
    leyendo:        { src: 'assets/willy/willy-sentado.png' },
    pulgarArriba:   { src: 'assets/willy/willy-sentado.png' },
};

export function renderWilly(pose = 'sentado') {
    const cfg = POSES[pose] || POSES.sentado;
    return `
        <div class="qw-willy" role="img" aria-label="Willy, asistente de Qhatu" data-pose="${pose}">
            <div class="qw-willy-sway">
                <div class="qw-willy-breath">
                    <img src="${cfg.src}" alt="" draggable="false">
                </div>
            </div>
        </div>
    `;
}

// Cambia la pose de Willy en runtime sin rebuild del DOM. Útil para mostrar
// p.ej. willy-leyendo durante un upload sin destruir/recrear el árbol.
// Por ahora todas las poses usan el mismo PNG; cuando llegue el SVG, esta
// función se vuelve significativa visualmente.
export function setPose(container, pose) {
    if (!container) return;
    const willyEl = container.querySelector('.qw-willy');
    if (!willyEl) return;
    const cfg = POSES[pose] || POSES.sentado;
    willyEl.dataset.pose = pose;
    const img = willyEl.querySelector('img');
    if (img && img.getAttribute('src') !== cfg.src) {
        img.src = cfg.src;
    }
}

// Hover/click reactions. Devuelve cleanup (remueve listeners + clases).
//
// Hover: escala 1.02 todo Willy. TODO: requiere SVG por partes - migrar
// cuando llegue el SVG (head tracking real rotando solo la cabeza). Con
// PNG entero, rotar la cabeza significaba rotar el cuerpo — se veía mal.
// Click: mini-jump (translateY -4 → 0 con spring). Funciona bien con PNG.
export function attachReactions(container) {
    if (!container) return () => {};
    const willyEl = container.querySelector('.qw-willy');
    if (!willyEl) return () => {};

    const buttons = container.querySelectorAll('.qw-btn');
    const cleanups = [];

    buttons.forEach(btn => {
        const onEnter = () => willyEl.classList.add('qw-react-hover');
        const onLeave = () => willyEl.classList.remove('qw-react-hover');
        const onClick = () => {
            // Reflow trick para reiniciar la animación si ya estaba corriendo
            willyEl.classList.remove('qw-jump');
            void willyEl.offsetWidth;
            willyEl.classList.add('qw-jump');
            setTimeout(() => willyEl.classList.remove('qw-jump'), 320);
        };
        btn.addEventListener('mouseenter', onEnter);
        btn.addEventListener('mouseleave', onLeave);
        btn.addEventListener('click', onClick);
        cleanups.push(() => {
            btn.removeEventListener('mouseenter', onEnter);
            btn.removeEventListener('mouseleave', onLeave);
            btn.removeEventListener('click', onClick);
        });
    });

    return () => {
        cleanups.forEach(fn => fn());
        willyEl.classList.remove('qw-react-hover', 'qw-jump');
    };
}

// ════════════════════════════════════════════════════════════════════════
// Blink — alterna el src del <img> entre `src` y `srcBlink` cada 5–8s
// aleatorio durante 150ms.
//
// Estado actual: DORMIDO. El asset `willy-sentado-blink.png` no existe
// todavía (decisión: se genera cuando llegue el SVG, mientras tanto
// preferimos cero blink antes que un blink mal hecho). El preload falla
// con 404 (o text/html del SPA fallback), `onerror` dispara, y el ciclo
// nunca arranca. Willy se queda con ojos abiertos sin glitches.
// Cuando exista el archivo, blink arranca solo al recargar la página.
//
// TODO: requiere SVG por partes - migrar cuando llegue el SVG (blink real
// con elementos de ojos separados, sin double-PNG). El doble-PNG funciona
// pero es una solución puente.
//
// Comportamiento detallado:
// - Respeta prefers-reduced-motion (no parpadea).
// - Pausa cuando la pestaña no está visible (visibilitychange) — evita
//   blinks "pendientes" que se disparan todos juntos al volver.
// - Devuelve cleanup. Llamala al desmontar la pantalla.
// ════════════════════════════════════════════════════════════════════════
export function attachBlink(container, pose = 'sentado') {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        return () => {};
    }
    const cfg = POSES[pose] || POSES.sentado;
    if (!cfg.srcBlink) return () => {};

    const img = container.querySelector('.qw-willy-breath img');
    if (!img) return () => {};

    let blinkTimer = null;
    let restoreTimer = null;
    let stopped = false;
    let started = false;

    const scheduleNext = () => {
        if (stopped) return;
        const wait = 5000 + Math.random() * 3000; // 5–8s aleatorio
        blinkTimer = setTimeout(() => {
            if (stopped || !img.isConnected) return;
            img.src = cfg.srcBlink;
            // 150ms = duración natural de un parpadeo humano
            restoreTimer = setTimeout(() => {
                if (stopped || !img.isConnected) return;
                img.src = cfg.src;
                scheduleNext();
            }, 150);
        }, wait);
    };

    const onVis = () => {
        if (document.hidden) {
            clearTimeout(blinkTimer);
            clearTimeout(restoreTimer);
            if (img.isConnected) img.src = cfg.src;
        } else if (!stopped && started) {
            scheduleNext();
        }
    };
    document.addEventListener('visibilitychange', onVis);

    // Preload — si falla, blink no arranca. El SPA fallback de Express
    // devuelve text/html para rutas faltantes y eso también dispara onerror
    // (Image() no decodifica HTML como imagen).
    const preload = new Image();
    preload.addEventListener('load', () => {
        if (stopped) return;
        started = true;
        scheduleNext();
    });
    preload.addEventListener('error', () => {
        console.info(`[wizard] blink dormant (asset ${cfg.srcBlink} no disponible — esperado mientras estamos en PNG)`);
    });
    preload.src = cfg.srcBlink;

    return () => {
        stopped = true;
        clearTimeout(blinkTimer);
        clearTimeout(restoreTimer);
        document.removeEventListener('visibilitychange', onVis);
        if (img.isConnected) img.src = cfg.src;
    };
}

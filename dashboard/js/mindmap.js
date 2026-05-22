/* ═══════════════════════════════════════════════════════════
 *  KIPU WORKFLOW MAP — BPMN-style flowchart editor (Cytoscape.js)
 *  - Rectangles for step/action/note, diamonds for condition nodes
 *  - Labeled edges (Yes/No/Maybe) with pill background
 *  - Top-to-bottom auto-layout (dagre) on first load
 *  - Drag to move, drag from edge handle to connect, dblclick to edit
 *  - Persists via /workflow/:botId endpoints (same contract as before)
 * ═══════════════════════════════════════════════════════════ */

(function () {
    // Marker para detectar visualmente si esta versión de mindmap.js cargó.
    // Si en DevTools Console no aparece esta línea, el browser está usando
    // una versión cacheada y NINGÚN fix de los últimos turnos surte efecto.
    console.log('%c[mindmap.js] LOADED — version 62 (n8n cubic SVG edges)', 'background:#000052;color:#FAF7F0;padding:2px 8px;border-radius:4px;font-weight:bold;');
    window._kipuMindmapJsVersion = 62;

    const STYLE = `
    .kipu-mindmap {
        position: relative;
        width: 100%;
        height: 100%;
        background: #fdf7f0;
        overflow: hidden;
        border-radius: 20px;
        border: 1px solid rgba(27, 27, 58, 0.08);
        outline: none;
        box-shadow: 0 8px 32px rgba(27, 27, 58, 0.06);
    }
    .kipu-cy-container {
        position: absolute;
        left: 0;
        right: 0;
        top: 52px;
        bottom: 38px;
        width: 100%;
        /* Grid de puntos — canvas interno sin cambiar lógica Cytoscape */
        background-color: #fdfbf7;
        background-image: radial-gradient(circle, rgba(27, 27, 58, 0.07) 1.2px, transparent 1.2px);
        background-size: 22px 22px;
    }
    /* Capa SVG encima del canvas: curvas cúbicas estilo n8n (tangente horizontal en puertos) */
    .kipu-n8n-edge-svg {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        overflow: visible;
        z-index: 2;
    }

    /* Barra superior del lienzo (solo presentación; zoom/undo reutilizan la misma lógica) */
    .kipu-mindmap-chrome {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 52px;
        z-index: 12;
        display: flex;
        align-items: center;
        padding: 0 12px;
        background: linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(253,247,240,0.95) 100%);
        border-bottom: 1px solid rgba(27, 27, 58, 0.08);
        pointer-events: none;
    }
    .kipu-mindmap-toolbar-main {
        pointer-events: auto;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        width: 100%;
        flex-wrap: wrap;
    }
    .kipu-mm-toolbar-left {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        min-width: 0;
    }
    .kipu-mm-toolbar-right {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
    }
    .kipu-mm-group {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        padding: 3px;
        background: rgba(255,255,255,0.9);
        border: 1px solid rgba(27, 27, 58, 0.1);
        border-radius: 10px;
    }
    .kipu-mm-icon-btn {
        width: 32px;
        height: 30px;
        border: none;
        border-radius: 8px;
        background: transparent;
        color: #1b1b3a;
        font-size: 1rem;
        font-weight: 700;
        cursor: pointer;
        font-family: inherit;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        transition: background 0.15s;
    }
    .kipu-mm-icon-btn:hover:not(:disabled) { background: rgba(27, 27, 58, 0.07); }
    .kipu-mm-icon-btn:disabled { opacity: 0.35; cursor: default; }
    .kipu-mm-sep {
        width: 1px;
        height: 22px;
        background: rgba(27, 27, 58, 0.12);
        flex-shrink: 0;
    }
    .kipu-mm-tools {
        display: inline-flex;
        padding: 3px;
        background: rgba(255,255,255,0.9);
        border: 1px solid rgba(27, 27, 58, 0.1);
        border-radius: 10px;
        gap: 2px;
    }
    .kipu-mm-tool {
        width: 32px;
        height: 30px;
        border: none;
        border-radius: 8px;
        background: transparent;
        color: #1b1b3a;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        transition: background 0.15s, color 0.15s;
    }
    .kipu-mm-tool:hover { background: rgba(27, 27, 58, 0.06); }
    .kipu-mm-tool.active {
        background: #1b1b3a;
        color: #faf7f0;
    }
    .kipu-mm-zoom-inline {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        padding: 3px 4px;
        background: rgba(255,255,255,0.9);
        border: 1px solid rgba(27, 27, 58, 0.1);
        border-radius: 10px;
    }
    .kipu-mm-z {
        min-width: 30px;
        height: 30px;
        border: none;
        border-radius: 8px;
        background: transparent;
        color: #1b1b3a;
        font-weight: 700;
        font-size: 1rem;
        cursor: pointer;
        font-family: inherit;
    }
    .kipu-mm-z:hover { background: rgba(27, 27, 58, 0.07); }
    .kipu-mm-zoom-readout {
        min-width: 44px;
        text-align: center;
        font-size: 0.72rem;
        font-weight: 800;
        color: rgba(27, 27, 58, 0.75);
    }
    .kipu-mm-ajustar {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 32px;
        padding: 0 12px;
        border-radius: 10px;
        border: 1px solid rgba(27, 27, 58, 0.12);
        background: rgba(255,255,255,0.95);
        color: #1b1b3a;
        font-size: 0.78rem;
        font-weight: 700;
        font-family: inherit;
        cursor: pointer;
        transition: background 0.15s, border-color 0.15s;
    }
    .kipu-mm-ajustar:hover {
        background: #fff;
        border-color: rgba(27, 27, 58, 0.22);
    }
    .kipu-mm-saved-pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 7px 12px;
        border-radius: 999px;
        font-size: 0.72rem;
        font-weight: 700;
        color: #14532d;
        background: #dcfce7;
        border: 1px solid rgba(22, 101, 52, 0.2);
        white-space: nowrap;
    }
    .kipu-mm-saved-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #16a34a;
        flex-shrink: 0;
    }
    .kipu-mm-btn-outline {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 32px;
        padding: 0 12px;
        border-radius: 10px;
        border: 1px solid rgba(27, 27, 58, 0.14);
        background: #fff;
        color: #1b1b3a;
        font-size: 0.78rem;
        font-weight: 600;
        font-family: inherit;
        cursor: pointer;
        transition: background 0.15s, border-color 0.15s;
    }
    .kipu-mm-btn-outline:hover {
        background: rgba(253, 247, 240, 0.9);
        border-color: rgba(27, 27, 58, 0.22);
    }
    .kipu-mm-btn-primary {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 32px;
        padding: 0 14px;
        border-radius: 10px;
        border: 1px solid #1b1b3a;
        background: #1b1b3a;
        color: #faf7f0;
        font-size: 0.78rem;
        font-weight: 700;
        font-family: inherit;
        cursor: pointer;
        transition: opacity 0.15s, transform 0.12s;
    }
    .kipu-mm-btn-primary:hover { opacity: 0.92; }

    /* Pie del lienzo — estadísticas decorativas + tienda */
    .kipu-mindmap-footer {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        height: 38px;
        z-index: 11;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 14px;
        font-size: 0.68rem;
        font-weight: 600;
        color: rgba(27, 27, 58, 0.48);
        background: linear-gradient(0deg, rgba(255,255,255,0.98) 0%, rgba(253,247,240,0.92) 100%);
        border-top: 1px solid rgba(27, 27, 58, 0.07);
        pointer-events: none;
    }
    .kipu-mm-footer-left {
        display: flex;
        align-items: center;
        gap: 0.35rem;
        flex-wrap: wrap;
    }
    .kipu-mm-footer-dot {
        opacity: 0.45;
        padding: 0 0.15rem;
    }
    .kipu-mm-footer-right {
        font-weight: 600;
        color: rgba(27, 27, 58, 0.42);
        white-space: nowrap;
    }

    /* Marco decorativo "MAPA" (no sustituye al grafo) */
    .kipu-mindmap-map-frame {
        position: absolute;
        left: 14px;
        bottom: 52px;
        z-index: 10;
        width: 112px;
        height: 76px;
        border-radius: 12px;
        background: rgba(255,255,255,0.96);
        border: 1px solid rgba(27, 27, 58, 0.1);
        box-shadow: 0 4px 14px rgba(27, 27, 58, 0.06);
        padding: 6px 8px 8px;
        display: flex;
        flex-direction: column;
        gap: 4px;
        pointer-events: none;
    }
    .kipu-mindmap-map-label {
        font-size: 0.58rem;
        font-weight: 800;
        letter-spacing: 0.14em;
        color: rgba(27, 27, 58, 0.45);
    }
    .kipu-mindmap-map-thumb {
        flex: 1;
        border-radius: 8px;
        background:
            linear-gradient(135deg, rgba(234, 88, 12, 0.35) 0%, rgba(234, 88, 12, 0.08) 40%, transparent 40%),
            linear-gradient(225deg, rgba(27, 27, 58, 0.12) 0%, rgba(27, 27, 58, 0.04) 100%);
        border: 1px dashed rgba(27, 27, 58, 0.12);
    }

    /* Top bar: status pill + toolbar */
    .kipu-mindmap-topbar {
        position: absolute; top: 14px; left: 14px; right: 14px;
        display: flex; justify-content: space-between; align-items: center;
        pointer-events: none; z-index: 10;
    }
    .kipu-mindmap-status {
        pointer-events: auto;
        background: rgba(255,255,255,0.95); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
        color: rgba(0,0,51,0.75); font-size: 0.78rem; font-weight: 600;
        padding: 9px 14px; border-radius: 999px;
        border: 1px solid rgba(0,0,82,0.1);
        display: inline-flex; align-items: center; gap: 9px;
        box-shadow: 0 4px 16px rgba(0,0,82,0.06);
    }
    .kipu-status-dot {
        width: 8px; height: 8px; border-radius: 50%; background: #10B981;
        box-shadow: 0 0 0 0 rgba(16,185,129, 0.6);
        animation: kipu-pulse 1.8s ease-in-out infinite;
    }
    @keyframes kipu-pulse {
        0%   { box-shadow: 0 0 0 0 rgba(16,185,129, 0.5); }
        70%  { box-shadow: 0 0 0 8px rgba(16,185,129, 0);   }
        100% { box-shadow: 0 0 0 0 rgba(16,185,129, 0);     }
    }
    .kipu-mindmap-toolbar-top {
        pointer-events: auto;
        display: flex; gap: 8px; align-items: center;
        background: rgba(255,255,255,0.95); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
        padding: 5px; border-radius: 12px;
        border: 1px solid rgba(0,0,82,0.1);
        box-shadow: 0 4px 16px rgba(0,0,82,0.06);
    }
    .kipu-mindmap-btn {
        background: transparent; border: none;
        color: #000052; border-radius: 8px; height: 32px;
        padding: 0 12px;
        display: inline-flex; align-items: center; justify-content: center;
        cursor: pointer; font-weight: 600; font-size: 0.82rem;
        transition: all 0.15s;
        font-family: inherit; gap: 6px; white-space: nowrap;
    }
    .kipu-mindmap-btn:hover { background: rgba(0,0,82,0.07); }
    .kipu-mindmap-btn.primary { background: #000052; color: #FFF; padding: 0 16px; }
    .kipu-mindmap-btn.primary:hover { background: #0a0a7a; }
    .kipu-mindmap-btn.ghost { color: rgba(0,0,51,0.65); }

    .kipu-mindmap-search {
        background: transparent;
        border: none; border-right: 1px solid rgba(0,0,82,0.12);
        border-radius: 0; height: 32px; padding: 0 14px 0 10px;
        font-family: inherit; font-size: 0.82rem; color: #000052;
        width: 180px; outline: none;
        transition: width 0.15s;
    }
    .kipu-mindmap-search::placeholder { color: rgba(0,0,51,0.35); }
    .kipu-mindmap-search:focus { width: 240px; }

    /* ── PALETTE de nodos colapsable (FigJam style) ───────────────────────
       Estado COLAPSADO (default): muestra solo un handle vertical "+ Añadir
         nodo" pegado al borde izquierdo del canvas.
       Estado EXPANDIDO: panel con la lista de tipos + botón × para cerrar.
       Animación: slide-in desde la izquierda 200ms. */
    .kipu-mm-divider {
        width: 1px; height: 20px; background: rgba(0,0,82,0.10); flex-shrink: 0;
    }
    .kipu-node-palette {
        position: relative; z-index: 20;
        display: flex; flex-direction: column;
        font-family: inherit;
    }
    /* Handle (visible solo en estado colapsado) */
    .kipu-palette-handle {
        background: #FFFFFF;
        border: 1px solid rgba(0, 0, 82, 0.10);
        border-radius: 999px;
        padding: 8px 14px 8px 10px;
        cursor: pointer; font-family: inherit;
        font-size: 0.78rem; color: #000052; font-weight: 700;
        display: inline-flex; align-items: center; gap: 8px;
        box-shadow: 0 4px 16px rgba(0, 0, 82, 0.06);
        transition: all 0.18s;
        white-space: nowrap;
    }
    .kipu-palette-handle:hover {
        background: #FAF7F0;
        border-color: rgba(0, 0, 82, 0.18);
        transform: translateY(-1px);
        box-shadow: 0 6px 20px rgba(0, 0, 82, 0.10);
    }
    .kipu-palette-handle-icon {
        display: inline-flex; align-items: center; justify-content: center;
        width: 22px; height: 22px; border-radius: 50%;
        background: linear-gradient(145deg, #ea580c 0%, #c2410c 100%);
        color: #FFFFFF;
        font-weight: 700; font-size: 0.95rem; line-height: 1;
    }
    /* Content (panel completo, visible solo en estado expandido) */
    .kipu-palette-content {
        position: absolute; top: calc(100% + 6px); left: 0;
        background: #FFFFFF;
        border: 1px solid rgba(0, 0, 82, 0.08);
        border-radius: 14px;
        width: 200px;
        padding: 14px 14px 12px;
        display: flex; flex-direction: column; gap: 8px;
        box-shadow: 0 8px 24px rgba(0, 0, 82, 0.10);
        transform-origin: top left;
        animation: kipu-palette-slide 200ms cubic-bezier(0.16, 1, 0.3, 1);
    }
    @keyframes kipu-palette-slide {
        from { opacity: 0; transform: translateX(-8px) scale(0.96); }
        to   { opacity: 1; transform: translateX(0)     scale(1);    }
    }
    /* Toggle de visibilidad por estado */
    .kipu-node-palette.collapsed .kipu-palette-content { display: none; }
    .kipu-node-palette:not(.collapsed) .kipu-palette-handle { display: none; }
    /* ─── Toggle de Formato de respuesta ─── */
    .kipu-format-toggle {
        position: relative; z-index: 10;
        display: inline-flex; align-items: center; gap: 2px;
        padding: 2px 4px;
        background: #FFFFFF;
        border: 1px solid rgba(0, 0, 82, 0.10);
        border-radius: 999px;
        box-shadow: 0 3px 12px rgba(0, 0, 82, 0.05);
        font-family: inherit;
    }
    .kipu-format-toggle__label {
        font-size: 0.58rem; font-weight: 700; letter-spacing: 0.04em;
        color: rgba(0, 0, 82, 0.50);
        padding: 0 4px;
        text-transform: uppercase;
    }
    .kipu-format-toggle__btn {
        display: inline-flex; align-items: center;
        padding: 4px 10px;
        background: transparent;
        border: 1px solid transparent;
        border-radius: 999px;
        font-family: inherit; font-size: 0.68rem; font-weight: 600;
        color: rgba(0, 0, 82, 0.70);
        cursor: pointer;
        transition: background 0.15s ease, color 0.15s ease,
                    border-color 0.15s ease, transform 0.1s ease;
    }
    .kipu-format-toggle__btn:hover:not(.is-active) {
        background: #FAF7F0;
        color: #000052;
    }
    .kipu-format-toggle__btn.is-active {
        background: linear-gradient(145deg, #ea580c 0%, #c2410c 100%);
        color: #FFFFFF;
        border-color: rgba(194, 65, 12, 0.35);
        box-shadow: 0 1px 4px rgba(194, 65, 12, 0.22);
    }
    .kipu-format-toggle__btn:focus-visible {
        outline: 2px solid rgba(234, 88, 12, 0.6);
        outline-offset: 2px;
    }
    .kipu-format-toggle.is-saving .kipu-format-toggle__btn { opacity: 0.65; pointer-events: none; }
    @media (max-width: 720px) {
        .kipu-format-toggle__label { display: none; }
    }
    /* Header del panel expandido */
    .kipu-palette-title-row {
        display: flex; align-items: center; justify-content: space-between;
        padding: 2px 2px 4px;
    }
    .kipu-palette-title {
        font-size: 0.66rem; font-weight: 800;
        color: rgba(0, 0, 82, 0.45);
        letter-spacing: 0.12em;
    }
    .kipu-palette-close {
        background: transparent; border: none; cursor: pointer;
        /* Antes rgba 0.55 — el × se veía "en blanco". 0.82 + font-weight 600
           para que sea visible sobre el fondo claro de la paleta. */
        color: rgba(0, 0, 82, 0.82);
        font-size: 1.15rem; font-weight: 600; line-height: 1;
        padding: 2px 6px; border-radius: 6px;
        transition: background 0.15s, color 0.15s;
    }
    .kipu-palette-close:hover {
        background: rgba(0, 0, 82, 0.06);
        color: #000052;
    }

    .kipu-palette-btn {
        display: flex; align-items: center; gap: 12px;
        padding: 8px 10px;
        background: #FFF; border: 1px solid rgba(0, 0, 82, 0.06);
        border-radius: 10px; cursor: grab; font-family: inherit;
        font-size: 0.82rem; color: #1F2A44; font-weight: 600;
        text-align: left; transition: all 0.18s;
    }
    .kipu-palette-btn:active { cursor: grabbing; }
    .kipu-palette-btn:hover {
        border-color: rgba(0, 0, 82, 0.14);
        background: #FAF7F0;
        transform: translateX(2px);
        box-shadow: 0 2px 8px rgba(0, 0, 82, 0.04);
    }
    /* Mini preview shape — 36×28px, con la forma + paleta pastel del tipo */
    .kipu-palette-preview {
        width: 36px; height: 24px; flex-shrink: 0;
        border-radius: 6px;
        display: inline-block; box-sizing: border-box;
    }
    .kipu-palette-preview.start_end {
        background: #E8E2F5;
        border: 2px solid #8B7BB8;
        border-radius: 999px;
    }
    .kipu-palette-preview.step {
        background: #DDE7F5;
        border: 2px solid #4A6FA5;
        border-radius: 6px;
    }
    .kipu-palette-preview.condition {
        width: 20px; height: 20px;
        background: #FCEBC4;
        border: 2px solid #C99629;
        border-radius: 3px;
        transform: rotate(45deg);
        margin: 2px 8px 2px 8px;
    }
    .kipu-palette-preview.handoff {
        background: #FBE0D2;
        border: 2px solid #E5683C;
        border-left-width: 4px;
        border-radius: 6px;
    }
    .kipu-palette-preview.config_requirement {
        background: #F5EDDC;
        border: 2px dashed #B8A88A;
        border-radius: 6px;
    }

    .kipu-mindmap-hint {
        position: absolute; bottom: 48px; left: 50%; transform: translateX(-50%); z-index: 10;
        background: rgba(255,255,255,0.94); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
        color: rgba(0,0,51,0.65); font-size: 0.72rem; font-weight: 500;
        padding: 8px 14px; border-radius: 10px; pointer-events: none;
        border: 1px solid rgba(0,0,82,0.08);
        box-shadow: 0 2px 8px rgba(0,0,82,0.04);
        max-width: calc(100% - 28px);
    }
    .kipu-mindmap-hint kbd {
        font-family: 'SF Mono', monospace; font-size: 0.68rem;
        background: #F5EFE0; border: 1px solid rgba(0,0,82,0.14);
        padding: 2px 6px; border-radius: 4px; color: #000052;
        font-weight: 700;
    }

    /* ── LEYENDA "Simbología" — FigJam style, bottom-right minimizable ──
       Position fija abajo a la derecha, encima del zoom-controls. Cada
       fila muestra la forma mini del tipo + nombre + descripción opcional
       al hover. Header tiene toggle de minimizar (▾/▴). */
    .kipu-mindmap-legend {
        position: absolute; right: 14px; bottom: 118px; z-index: 11;
        background: #FFFFFF;
        border: 1px solid rgba(0, 0, 82, 0.08);
        border-radius: 12px;
        padding: 14px 16px 12px;
        font-size: 0.76rem; color: rgba(0, 0, 82, 0.78);
        display: flex; flex-direction: column; gap: 8px;
        box-shadow: 0 4px 16px rgba(0, 0, 82, 0.06);
        max-width: 240px;
        transition: padding 0.2s ease, max-width 0.2s ease;
    }
    .kipu-mindmap-legend.collapsed {
        padding: 8px 12px; gap: 0;
    }
    .kipu-mindmap-legend.collapsed .kipu-mindmap-legend-row { display: none; }
    .kipu-mindmap-legend-header {
        display: flex; align-items: center; justify-content: space-between;
        gap: 12px;
    }
    .kipu-mindmap-legend-title {
        font-weight: 800; color: #000052; font-size: 0.68rem;
        letter-spacing: 0.10em; text-transform: uppercase;
    }
    .kipu-mindmap-legend-toggle {
        background: transparent; border: none; cursor: pointer;
        color: rgba(0, 0, 82, 0.45); font-size: 0.85rem; line-height: 1;
        padding: 2px 6px; border-radius: 6px;
        transition: background 0.15s, color 0.15s, transform 0.2s ease;
    }
    .kipu-mindmap-legend-toggle:hover {
        background: rgba(0, 0, 82, 0.06); color: #000052;
    }
    .kipu-mindmap-legend.collapsed .kipu-mindmap-legend-toggle {
        transform: rotate(180deg);
    }
    .kipu-mindmap-legend-row {
        display: flex; align-items: center; gap: 12px;
        font-size: 0.78rem; color: rgba(0, 0, 82, 0.78);
        cursor: help;
    }
    .kipu-mindmap-legend-row[data-desc]:hover {
        color: #000052;
    }
    .kipu-mindmap-legend-row[data-desc]:hover::after {
        content: attr(data-desc);
        position: absolute; right: 100%; margin-right: 10px;
        background: #000052; color: #FFF;
        padding: 6px 10px; border-radius: 6px;
        font-size: 0.7rem; white-space: nowrap;
        box-shadow: 0 4px 12px rgba(0, 0, 82, 0.18);
    }
    .kipu-mindmap-legend-row { position: relative; }
    /* Mini shapes de leyenda — mismas formas/colores que la paleta */
    .kipu-legend-shape {
        width: 32px; height: 20px; flex-shrink: 0;
        box-sizing: border-box; border-radius: 4px;
    }
    .kipu-legend-shape.stadium {
        background: #E8E2F5;
        border: 2px solid #8B7BB8;
        border-radius: 999px;
    }
    .kipu-legend-shape.rect {
        background: #DDE7F5;
        border: 2px solid #4A6FA5;
        border-radius: 6px;
    }
    .kipu-legend-shape.diamond {
        width: 20px; height: 20px;
        background: #FCEBC4;
        border: 2px solid #C99629;
        border-radius: 3px;
        transform: rotate(45deg);
        margin-left: 6px; margin-right: 6px;
    }
    .kipu-legend-shape.handoff {
        background: #FBE0D2;
        border: 2px solid #E5683C;
        border-left-width: 4px;
        border-radius: 4px;
    }
    .kipu-legend-shape.config {
        background: #F5EDDC;
        border: 2px dashed #B8A88A;
        border-radius: 4px;
    }

    /* Zoom controls — horizontal bar anclada en la esquina inferior derecha
       del canvas. Antes era vertical; ahora muestra los botones en fila para
       liberar altura útil al lienzo. */
    .kipu-mindmap-zoom {
        position: absolute; bottom: 16px; right: 16px; z-index: 10;
        background: rgba(255,255,255,0.96); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
        border: 1px solid rgba(27, 27, 58, 0.12);
        border-radius: 12px; padding: 5px 6px;
        display: inline-flex; flex-direction: row; align-items: center; gap: 3px;
        box-shadow: 0 6px 20px rgba(27, 27, 58, 0.08);
    }
    .kipu-mindmap-zbtn {
        background: transparent; border: none;
        color: #1b1b3a; font-weight: 600; font-size: 1rem;
        width: 34px; height: 30px; border-radius: 8px;
        display: inline-flex; align-items: center; justify-content: center;
        cursor: pointer; font-family: inherit;
        transition: background 0.15s;
    }
    .kipu-mindmap-zbtn:hover { background: rgba(27, 27, 58, 0.08); }
    .kipu-mindmap-zbtn.kipu-zoom-pct {
        width: auto; padding: 0 10px; font-size: 0.72rem; font-weight: 800;
        min-height: 28px;
        border-left: 1px solid rgba(27, 27, 58, 0.08);
        border-right: 1px solid rgba(27, 27, 58, 0.08);
        margin: 0 2px;
    }
    .kipu-zoom-sep { display: none; }

    /* E17: pantalla completa real para el workflow editor.
       Cuando el usuario hace clic en el botón ⛶, el editor se expande para
       cubrir toda la ventana del navegador. Otro clic lo regresa al layout
       normal dentro de la pestaña. */
    .kipu-mindmap.kipu-mindmap-fullscreen {
        position: fixed !important;
        inset: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        max-width: none !important;
        max-height: none !important;
        z-index: 9999 !important;
        border-radius: 0 !important;
        margin: 0 !important;
        background: #fdf7f0 !important;
    }

    /* Side panel: details of selected node (chips, etc.) */
    .kipu-side-panel {
        position: absolute; top: 118px; right: 14px; z-index: 9;
        width: 320px; max-height: calc(100% - 240px);
        background: #FFF;
        border: 1px solid rgba(0,0,82,0.12);
        border-radius: 14px;
        box-shadow: 0 12px 32px rgba(0,0,82,0.14);
        padding: 18px 20px;
        overflow-y: auto;
        display: none;
        font-size: 0.82rem; color: rgba(0,0,51,0.85);
    }
    .kipu-side-panel.visible { display: block; }
    .kipu-side-panel-title {
        font-weight: 800; color: #000052; font-size: 0.92rem;
        margin: 0 0 4px 0;
        display: flex; align-items: center; gap: 8px;
    }
    .kipu-side-panel-subtitle {
        font-size: 0.7rem; color: rgba(0,0,51,0.55);
        font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em;
        margin-bottom: 10px;
    }
    .kipu-side-panel-desc {
        color: rgba(0,0,51,0.75);
        line-height: 1.45;
        margin: 6px 0 10px;
        font-size: 0.8rem;
    }
    .kipu-side-panel-section {
        margin-top: 10px; padding-top: 10px;
        border-top: 1px solid rgba(0,0,82,0.08);
    }
    .kipu-side-panel-section-title {
        font-weight: 700; color: #000052; font-size: 0.72rem;
        text-transform: uppercase; letter-spacing: 0.04em;
        margin-bottom: 6px;
    }
    .kipu-side-chip {
        display: inline-flex; align-items: center; gap: 6px;
        padding: 4px 9px;
        background: #F5EFE0; border: 1px solid rgba(0,0,82,0.08);
        border-radius: 999px; font-size: 0.72rem;
        color: #000052; margin: 2px 3px 2px 0;
    }
    .kipu-side-chip-meta { color: rgba(0,0,51,0.55); font-weight: 600; }
    .kipu-side-panel-actions {
        margin-top: 12px; display: flex; gap: 6px;
    }
    .kipu-side-panel-actions button {
        flex: 1; padding: 6px 10px; border-radius: 8px;
        font-family: inherit; font-weight: 700; font-size: 0.75rem;
        cursor: pointer;
        border: 1px solid rgba(0,0,82,0.14); background: #FFF; color: #000052;
    }
    .kipu-side-panel-actions button.primary { background: #000052; color: #FFF; border-color: #000052; }
    .kipu-side-panel-actions button.danger { color: #B00020; border-color: #F4C5CC; }

    /* ── Example bubble (LLM-generated preview) ───────────────────────────
       Renderiza dentro del side panel. Layout:
         label "Instrucción al bot"  → texto plano (description del nodo)
         label "Ejemplo de respuesta" → burbuja WhatsApp (example_message)
       Estados: loading (skeleton) · empty (CTA) · ok (bubble) · error.
       Variables {nombre_cliente} se resaltan con bg orange/20%. */
    .kipu-side-panel-example-section {
        margin-top: 12px; padding-top: 12px;
        border-top: 1px solid rgba(0, 0, 82, 0.08);
    }
    .kipu-side-panel-example-header {
        display: flex; align-items: center; justify-content: space-between;
        margin-bottom: 8px;
    }
    .kipu-side-panel-example-header .kipu-side-panel-section-title {
        margin-bottom: 0;
    }
    .kipu-side-panel-example-regen {
        background: transparent; border: 1px solid rgba(0, 0, 82, 0.14);
        color: #000052; cursor: pointer;
        padding: 3px 8px; border-radius: 999px;
        font-family: inherit; font-size: 0.66rem; font-weight: 700;
        display: inline-flex; align-items: center; gap: 4px;
        transition: background 0.15s, border-color 0.15s;
    }
    .kipu-side-panel-example-regen:hover {
        background: #FAF7F0; border-color: rgba(0, 0, 82, 0.28);
    }
    .kipu-side-panel-example-regen:disabled {
        opacity: 0.5; cursor: wait;
    }
    .kipu-bubble-wa {
        background: #DCF8C6;
        border-radius: 12px 12px 12px 4px;
        padding: 10px 14px;
        font-size: 13px; color: #1F1F1F; line-height: 1.4;
        position: relative;
        max-width: 100%; word-wrap: break-word; white-space: pre-wrap;
        box-shadow: 0 1px 0.5px rgba(11, 20, 26, 0.13);
    }
    .kipu-bubble-wa .kipu-var {
        background: rgba(229, 104, 60, 0.20);
        padding: 1px 4px; border-radius: 4px;
        font-weight: 600; color: #8A3818;
    }
    .kipu-bubble-wa-time {
        font-size: 0.66rem; color: rgba(0, 0, 0, 0.45);
        text-align: right; margin-top: 4px;
        display: flex; justify-content: flex-end; align-items: center; gap: 3px;
    }
    .kipu-bubble-wa-time::after {
        content: '✓✓'; color: #4FC3F7; font-size: 0.7rem; line-height: 1;
    }
    .kipu-example-skeleton {
        background: #DCF8C6; border-radius: 12px 12px 12px 4px;
        padding: 10px 14px; opacity: 0.6;
    }
    .kipu-example-skeleton-line {
        height: 10px; background: rgba(0, 0, 0, 0.08);
        border-radius: 4px; margin: 5px 0;
        animation: kipu-shimmer 1.4s ease-in-out infinite;
    }
    .kipu-example-skeleton-line:nth-child(1) { width: 80%; }
    .kipu-example-skeleton-line:nth-child(2) { width: 100%; }
    .kipu-example-skeleton-line:nth-child(3) { width: 60%; }
    @keyframes kipu-shimmer {
        0%, 100% { opacity: 0.4; }
        50%      { opacity: 0.7; }
    }
    .kipu-example-empty {
        background: rgba(0, 0, 82, 0.04);
        border: 1px dashed rgba(0, 0, 82, 0.18);
        border-radius: 10px;
        padding: 14px; text-align: center;
        cursor: pointer;
        transition: background 0.15s, border-color 0.15s;
    }
    .kipu-example-empty:hover {
        background: rgba(0, 0, 82, 0.07);
        border-color: rgba(0, 0, 82, 0.28);
    }
    .kipu-example-empty-icon {
        font-size: 1.1rem; margin-bottom: 4px;
    }
    .kipu-example-empty-text {
        font-size: 0.78rem; color: rgba(0, 0, 82, 0.65); font-weight: 600;
    }
    .kipu-example-error {
        background: #FFF4F4; border: 1px solid #F4C5CC;
        border-radius: 10px; padding: 12px;
        color: #8A1F2B; font-size: 0.78rem;
    }
    .kipu-example-error .retry-link {
        display: inline-block; margin-top: 6px;
        font-weight: 700; color: #B00020; cursor: pointer;
        text-decoration: underline;
    }
    .kipu-example-disclaimer {
        margin-top: 8px;
        font-size: 0.66rem; line-height: 1.4;
        color: rgba(0, 0, 82, 0.50);
        font-style: italic;
    }
    .kipu-example-meta {
        font-size: 0.66rem; color: rgba(0, 0, 82, 0.45);
        margin-top: 6px;
    }
    .kipu-example-meta .cached-badge {
        display: inline-block; padding: 1px 6px;
        background: rgba(0, 0, 82, 0.06);
        border-radius: 999px; margin-right: 4px;
    }
    .kipu-example-meta .live-badge {
        display: inline-block; padding: 1px 6px;
        background: rgba(229, 104, 60, 0.14); color: #8A3818;
        border-radius: 999px; margin-right: 4px; font-weight: 700;
    }

    /* ── Hover popup (overlay flotante con ejemplo del nodo) ──────────────
       Vive afuera del canvas Cytoscape, position absolute en el documento.
       Aparece tras 400ms de hover sostenido sobre un nodo, se oculta al salir.
       Reusa el styling de la burbuja WhatsApp del side panel. */
    #kipu-node-popup {
        position: absolute;
        z-index: 9999;
        max-width: 320px; min-width: 240px;
        background: #FFFFFF;
        border: 1px solid rgba(0, 0, 82, 0.08);
        border-radius: 12px;
        padding: 16px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
        font-family: 'Poppins', sans-serif;
        pointer-events: auto;
        opacity: 0;
        transition: opacity 100ms ease-out, transform 150ms cubic-bezier(0.16, 1, 0.3, 1);
        will-change: opacity, transform;
    }
    /* Al mostrar: el JS añade la clase con la dirección y .visible al final */
    #kipu-node-popup.visible {
        opacity: 1;
        transform: translate(0, 0) !important;
    }
    /* Direcciones de entrada — slide 8px desde el lado del nodo */
    #kipu-node-popup.from-right { transform: translateX(-8px); }
    #kipu-node-popup.from-left  { transform: translateX(8px);  }
    #kipu-node-popup.from-below { transform: translateY(-8px); }
    .kipu-node-popup-header {
        font-size: 12px;
        color: #000052;
        font-weight: 700;
        margin-bottom: 8px;
        line-height: 1.3;
        display: flex; align-items: center; gap: 6px;
        flex-wrap: wrap;
    }
    .kipu-node-popup-type {
        font-size: 0.6rem; font-weight: 800;
        text-transform: uppercase; letter-spacing: 0.06em;
        background: rgba(0, 0, 82, 0.06);
        color: rgba(0, 0, 82, 0.55);
        padding: 1px 7px; border-radius: 999px;
    }
    .kipu-node-popup-title {
        flex: 1; min-width: 0;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .kipu-node-popup-body { /* contenedor del bubble/skeleton/error */ }
    .kipu-node-popup-footer {
        font-size: 10px; line-height: 1.3;
        color: rgba(0, 0, 82, 0.50);
        margin-top: 8px; font-style: italic;
    }
    .kipu-node-popup-status {
        font-size: 10px; color: rgba(0, 0, 82, 0.45);
        margin-top: 6px;
    }

    /* Botón global "Generar todos los ejemplos" en topbar */
    .kipu-mindmap-btn-genall {
        background: linear-gradient(135deg, #4A6FA5 0%, #8B7BB8 100%);
        color: #FFF; border: none;
        padding: 0 14px; height: 32px; border-radius: 8px;
        font-family: inherit; font-weight: 700; font-size: 0.78rem;
        cursor: pointer; display: inline-flex; align-items: center; gap: 6px;
        transition: transform 0.15s, box-shadow 0.15s;
    }
    .kipu-mindmap-btn-genall:hover {
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(0, 0, 82, 0.20);
    }
    .kipu-mindmap-btn-genall:disabled {
        opacity: 0.6; cursor: wait; transform: none; box-shadow: none;
    }

    .kipu-side-edge-row {
        display: flex; align-items: center; gap: 6px;
        margin: 4px 0;
    }
    .kipu-side-edge-label {
        flex: 0 0 80px;
        padding: 4px 7px;
        border: 1px solid rgba(0,0,82,0.14);
        border-radius: 6px;
        font-family: inherit; font-size: 0.72rem;
        color: #000052; font-weight: 600;
        outline: none; background: #FFF;
    }
    .kipu-side-edge-label:focus { border-color: #4a7ba8; box-shadow: 0 0 0 2px rgba(74,123,168,0.15); }
    .kipu-side-edge-to {
        flex: 1; font-size: 0.72rem; color: rgba(0,0,51,0.7);
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .kipu-side-edge-delete {
        background: none; border: none; cursor: pointer;
        color: #B00020; font-size: 1rem; line-height: 1;
        padding: 2px 6px; border-radius: 4px;
    }
    .kipu-side-edge-delete:hover { background: #FFECEF; }
    .kipu-side-panel-close {
        position: absolute; top: 8px; right: 10px;
        background: transparent; border: none; cursor: pointer;
        /* Antes rgba 0.4 — el × se veía "en blanco" sobre el panel claro.
           0.8 + font-weight 600 para asegurar contraste. */
        color: rgba(0,0,51,0.8); font-size: 1.1rem;
        font-weight: 600; line-height: 1;
    }
    .kipu-side-panel-close:hover { color: #000052; }

    /* Context menu (right-click) */
    .kipu-context-menu {
        position: fixed; z-index: 2000;
        background: #FFF; border: 1px solid rgba(0,0,82,0.12);
        border-radius: 10px; padding: 6px;
        box-shadow: 0 12px 32px rgba(0,0,82,0.18);
        min-width: 160px; font-size: 0.82rem; color: #000052;
    }
    .kipu-context-item {
        padding: 7px 12px; border-radius: 6px; cursor: pointer;
        display: flex; align-items: center; gap: 8px;
    }
    .kipu-context-item:hover { background: #F5EFE0; }
    .kipu-context-item.danger { color: #B00020; }
    .kipu-context-item.danger:hover { background: #FFECEF; }
    .kipu-context-sep { height: 1px; background: rgba(0,0,82,0.08); margin: 4px 2px; }

    /* ── Modal "Opciones del nodo" — feeds shipping/payments ─────────────
       Lista las opciones actuales en read-only y ofrece un CTA "Editar"
       que navega a la pestaña Envíos (shipping) o abre el modal de
       métodos de pago (payments). Estilo FigJam consistente con el
       editor: card blanca, header tipo step (azul suave), bullet list. */
    .kipu-feeds-modal-overlay {
        position: fixed; inset: 0;
        background: rgba(0, 0, 82, 0.40);
        display: flex; align-items: center; justify-content: center;
        z-index: 3000;
    }
    .kipu-feeds-modal-card {
        background: #FFFFFF; border-radius: 16px;
        width: min(440px, 92vw);
        padding: 22px 24px;
        box-shadow: 0 20px 50px rgba(0, 0, 82, 0.30);
        font-family: inherit;
    }
    .kipu-feeds-modal-header {
        display: flex; align-items: center; gap: 10px;
        margin-bottom: 14px;
    }
    .kipu-feeds-modal-icon {
        width: 36px; height: 36px; border-radius: 10px;
        background: #DDE7F5; border: 2px solid #4A6FA5;
        display: flex; align-items: center; justify-content: center;
        font-size: 1rem;
    }
    .kipu-feeds-modal-icon.empty {
        background: #FBE0D2; border-color: #E5683C;
    }
    .kipu-feeds-modal-title {
        margin: 0; color: #1F3A6B; font-size: 1.05rem;
        font-weight: 700; line-height: 1.2;
    }
    .kipu-feeds-modal-subtitle {
        font-size: 0.78rem; color: rgba(0, 0, 82, 0.55);
        margin-top: 2px;
    }
    .kipu-feeds-modal-list {
        list-style: none; padding: 0; margin: 0 0 18px;
        display: flex; flex-direction: column; gap: 8px;
        max-height: 280px; overflow-y: auto;
    }
    .kipu-feeds-modal-list li {
        display: flex; align-items: center; gap: 10px;
        padding: 10px 14px;
        background: #F5EDDC; border-radius: 10px;
        font-size: 0.86rem; color: #1F2A44; font-weight: 500;
    }
    .kipu-feeds-modal-list li::before {
        content: '•'; color: #4A6FA5; font-weight: 700;
        font-size: 1.1rem; line-height: 1;
    }
    .kipu-feeds-modal-empty {
        padding: 16px; text-align: center;
        background: #FBE0D2; border-radius: 12px;
        color: #8A3818; font-size: 0.88rem; font-weight: 600;
        margin-bottom: 18px;
    }
    .kipu-feeds-modal-empty-hint {
        display: block; font-weight: 500;
        font-size: 0.78rem; color: rgba(138, 56, 24, 0.85);
        margin-top: 4px;
    }
    .kipu-feeds-modal-actions {
        display: flex; gap: 8px; justify-content: flex-end;
    }
    .kipu-feeds-modal-actions button {
        padding: 9px 16px; border-radius: 9px;
        font-family: inherit; font-weight: 700; font-size: 0.84rem;
        cursor: pointer; border: 1px solid rgba(0, 0, 82, 0.18);
        background: #FFF; color: #000052;
        transition: all 0.15s;
    }
    .kipu-feeds-modal-actions button:hover {
        background: rgba(0, 0, 82, 0.04);
    }
    .kipu-feeds-modal-actions button.primary {
        background: #000052; color: #FFF; border-color: #000052;
    }
    .kipu-feeds-modal-actions button.primary:hover {
        background: #0a0a7a;
    }

    /* Edit overlay (dblclick on a node) */
    .kipu-node-edit-overlay {
        position: fixed; inset: 0;
        background: rgba(0,0,51,0.4);
        display: flex; align-items: center; justify-content: center;
        z-index: 3000;
    }
    .kipu-node-edit-card {
        background: #FFF; border-radius: 14px;
        width: min(500px, 92vw);
        padding: 22px 24px;
        box-shadow: 0 20px 50px rgba(0,0,51,0.3);
        font-family: inherit;
    }
    .kipu-node-edit-card h3 {
        margin: 0 0 16px; color: #000052; font-size: 1.1rem;
    }
    .kipu-node-edit-card label {
        display: block; margin: 10px 0 6px;
        color: rgba(0,0,51,0.8);
        font-weight: 700; font-size: 0.75rem;
        text-transform: uppercase; letter-spacing: 0.03em;
    }
    .kipu-node-edit-card input,
    .kipu-node-edit-card textarea,
    .kipu-node-edit-card select {
        width: 100%; padding: 9px 11px;
        border: 1px solid rgba(0,0,82,0.2); border-radius: 8px;
        font-family: inherit; font-size: 0.88rem;
        color: #000052;
    }
    .kipu-node-edit-card textarea { min-height: 110px; resize: vertical; }
    .kipu-node-edit-actions {
        display: flex; gap: 8px; justify-content: flex-end;
        margin-top: 16px;
    }
    .kipu-node-edit-actions button {
        padding: 9px 16px; border-radius: 8px;
        font-family: inherit; font-weight: 700; font-size: 0.82rem;
        cursor: pointer; border: 1px solid rgba(0,0,82,0.18);
        background: #FFF; color: #000052;
    }
    .kipu-node-edit-actions button.save { background: #000052; color: #FFF; border-color: #000052; }

    /* Demo mode banner — esquina inferior izquierda del greybox, a la altura del zoom */
    .kipu-mindmap-demo-banner {
        position: absolute;
        left: 14px;
        bottom: 16px;
        z-index: 12;
        background: #FFFBEE;
        border: 1px solid #D4A017;
        color: #6b4a00;
        padding: 8px 12px;
        border-radius: 10px;
        font-size: 0.75rem;
        font-weight: 600;
        max-width: calc(100% - 220px);
        line-height: 1.4;
        box-shadow: 0 6px 20px rgba(0, 0, 82, 0.1);
        pointer-events: auto;
    }

    /* Validation banner — sobre el demo banner, mismo borde inferior del lienzo */
    .kipu-mindmap-validation {
        position: absolute;
        left: 50%;
        bottom: 16px;
        transform: translateX(-50%);
        z-index: 13;
        background: #FFFBEE;
        border: 1px solid #D4A017;
        color: #6b4a00;
        padding: 10px 16px;
        border-radius: 10px;
        font-size: 0.8rem;
        font-weight: 600;
        max-width: min(540px, calc(100% - 240px));
        line-height: 1.5;
        box-shadow: 0 6px 20px rgba(0, 0, 82, 0.12);
        pointer-events: auto;
    }
    .kipu-mindmap-validation.ok {
        background: #E6F7EC; border-color: #0F8C3E; color: #0b5b2a;
    }
    .kipu-mindmap-validation ul { margin: 6px 0 0; padding-left: 18px; }
    .kipu-mindmap-validation li { margin: 2px 0; }
    .kipu-mindmap-validation .dismiss {
        float: right; margin-left: 10px; cursor: pointer;
        background: none; border: none; color: inherit;
        font-size: 0.9rem; font-weight: 700;
    }

    /* Export / Import menu */
    .kipu-export-menu {
        position: fixed; z-index: 2000;
        background: #FFF; border: 1px solid rgba(0,0,82,0.12);
        border-radius: 10px; padding: 6px;
        box-shadow: 0 12px 32px rgba(0,0,82,0.18);
        min-width: 180px; font-size: 0.82rem; color: #000052;
    }
    .kipu-export-menu-item {
        padding: 8px 12px; border-radius: 6px; cursor: pointer;
        display: flex; align-items: center; gap: 8px;
    }
    .kipu-export-menu-item:hover { background: #F5EFE0; }

    `;

    // Inject / refresh CSS so los cambios de STYLE surten sin hard-refresh
    // cuando solo sube mindmap.js (el tag ya existía de una sesión previa).
    let _kipuStyleTag = document.getElementById('kipu-mindmap-style');
    if (!_kipuStyleTag) {
        _kipuStyleTag = document.createElement('style');
        _kipuStyleTag.id = 'kipu-mindmap-style';
        document.head.appendChild(_kipuStyleTag);
    }
    _kipuStyleTag.textContent = STYLE;

    // ─── State ─────────────────────────────────────────────────
    const state = {
        botId: null,
        nodes: [],
        edges: [],
        cy: null,
        edgehandles: null,
        selectedNodeId: null,
        saveTimers: {},
        demoMode: false,
        demoBannerMsg: '',
        // Live config snapshot — usado para renderizar dinámicamente el
        // contenido de los nodos que dependen de Envíos / Métodos de pago
        // (feeds_from === 'shipping' | 'payments'). Se refresca al montar
        // el editor y cuando la pestaña Workflow vuelve a activarse, así
        // los cambios hechos en otras pestañas se ven sin recargar.
        live: { shippingConfig: null, pickupLocs: [], paymentMethods: [], products: [], storeName: '' },
        // Cache en memoria de ejemplos LLM por nodo. Evita re-pedir al backend
        // si ya cargamos el ejemplo en esta sesión. Se reinicia al re-mount.
        // Shape: { [nodeId]: { example, cached, generatedAt, error, loading } }
        exampleCache: {},
        // Undo stack para drags. Cada entrada: { nodeId, fromX, fromY, toX, toY }.
        // Se llena en dragfree (cuando la posición cambia respecto a la grabada
        // en grab). Ctrl+Z / Cmd+Z hace pop y restaura la posición previa.
        // Limit 50 entries — suficiente para deshacer una sesión normal sin
        // que el array crezca sin tope.
        dragUndoStack: [],
        // Posición del nodo en el momento de empezar el drag (grab). Usada para
        // calcular si hubo movimiento real al soltar (dragfree). Map id → {x,y}.
        dragStartPos: {},
        // Estado del hover popup (overlay flotante con ejemplo). Singleton:
        // un solo popup activo a la vez (el del último nodo en hover sostenido).
        hoverPopup: {
            nodeId: null,        // nodo actualmente vinculado al popup
            showTimer: null,     // setTimeout pendiente para showHoverPopup (400ms)
            hideTimer: null,     // setTimeout pendiente para hideHoverPopup (200ms)
            visible: false,      // si el div está mostrándose
            mouseInsidePopup: false  // bandera para "no ocultes si entro al popup"
        },
        _lastWorkflowSaveAt: null,
        _saveStatusUiTimer: null
    };
    // Exponer state al window para que maya-chat.js pueda forzar resize/fit
    // tras montar el editor (cytoscape mide 0x0 si el host se inicializó
    // mientras el configurator todavía estaba display:none).
    window._kipuMindmapState = state;

    // Trigger manual para forzar el render del workflow demo en cualquier
    // momento — útil para debugging cuando algo en el pipeline async deja
    // el canvas vacío. Llamable desde DevTools console:
    //   kipuForceDemoWorkflow()
    window.kipuForceDemoWorkflow = function () {
        console.log('[mindmap] manual force demo workflow triggered');
        state.demoMode = true;
        const seed = buildConfigDrivenDemo();
        state.nodes = seed.nodes;
        state.edges = seed.edges;
        // Align también para los nodos demo — protege contra el caso 4+ del
        // builder que mete resolve_multi cuando productCount=0.
        try { alignWorkflowToLiveConfig(); } catch (e) { console.warn('[force] align failed:', e); }
        // Si storeName todavía no se cargó (caso del watchdog disparando antes
        // que loadLiveConfig termine), intentamos leerlo del dropdown — su
        // text es el nombre del bot que el backend nos dio en /bots.
        if (!state.live.storeName) {
            const opt = document.querySelector('#edit-bot-select option:checked')
                     || document.querySelector('#config-section-bot-select option:checked');
            if (opt && opt.textContent && opt.textContent !== 'Selecciona un Qhatu') {
                state.live.storeName = opt.textContent.trim();
            }
            // Dispara loadLiveConfig en background — cuando termine, refresca
            // los títulos para sustituir cualquier placeholder restante.
            if (state.botId) {
                loadLiveConfig().then(() => {
                    try { updateFeedsNodes(); } catch (_) {}
                    if (state.cy) {
                        try {
                            state.cy.elements().remove();
                            state.cy.add(buildCyElements());
                        } catch (_) {}
                    }
                });
            }
        }
        try { computeVerticalSwimlanePositions(); } catch (e) { console.warn('[force] swimlane:', e); }
        if (state.cy) {
            try {
                state.cy.elements().remove();
                state.cy.add(buildCyElements());
                state.cy.resize();
                state.cy.fit(undefined, 60);
                console.log('[mindmap] forced render:', state.cy.elements().length, 'elements');
            } catch (e) { console.error('[force] render failed:', e); }
        } else {
            try {
                initCytoscape();
                try { wireTopbar(); } catch (_) {}
                if (state.cy) state.cy.fit(undefined, 60);
            } catch (e) { console.error('[force] init failed:', e); }
        }
    };

    // Watchdog: cada 1.5s revisa si estamos en el tab Workflow con el canvas
    // visible pero vacío. Si lo está, fuerza el render del demo workflow.
    // Última línea de defensa cuando cualquier path async muere silenciosamente.
    setInterval(() => {
        try {
            const host = document.getElementById('kipu-mindmap-host');
            if (!host) return;
            const activeTab = document.querySelector('.kipu-top-tab.active');
            if (!activeTab || activeTab.dataset.kipuTab !== 'workflow') return;
            const rect = host.getBoundingClientRect();
            if (rect.width < 50 || rect.height < 50) return;
            if (state.cy && state.cy.elements().length > 0) return;
            console.warn('[mindmap] watchdog: workflow tab empty, forcing demo render');
            window.kipuForceDemoWorkflow();
        } catch (_) {}
    }, 1500);

    // Demo fallback when the Supabase tables haven't been created yet — mirrors
    // the backend seedGenericWorkflow (Mermaid BPMN flow) so the user sees the
    // same diagram whether live or offline.
    const DEMO_SEED_SPECS = [
        { key: 'start',                  type: 'start_end',          phase: 'bienvenida', title: 'Cliente escribe a {nombre_negocio}' },
        { key: 'greet',                  type: 'step',               phase: 'bienvenida', title: 'Saludo inicial' },
        { key: 'ask_products',           type: 'step',               phase: 'productos',  title: 'Cliente pregunta por productos' },
        { key: 'offer_catalog',          type: 'step',               phase: 'productos',  title: 'Ofrecer catálogo', feeds: 'products' },
        { key: 'decision_catalog_size',  type: 'condition',          phase: 'productos',  title: '¿Catálogo tiene 3 o menos productos?' },
        { key: 'show_all',               type: 'step',               phase: 'productos',  title: 'Mostrar todos los productos', feeds: 'products' },
        { key: 'show_top',               type: 'step',               phase: 'productos',  title: 'Mostrar productos más vendidos según CRM', feeds: 'products' },
        { key: 'decision_client_action', type: 'condition',          phase: 'productos',  title: '¿Qué hace el cliente?' },
        { key: 'resolve_multi',          type: 'step',               phase: 'productos',  title: 'Responder dudas varios productos' },
        { key: 'resolve_single',         type: 'step',               phase: 'productos',  title: 'Responder dudas producto específico' },
        { key: 'config_requirement',     type: 'config_requirement', phase: 'envio',      title: "Requiere conexión activa 'Configura tu Qhatu'" },
        { key: 'show_shipping',          type: 'step',               phase: 'envio',      title: 'Mostrar opciones de envío + métodos de pago del envío', feeds: 'shipping' },
        { key: 'decision_rate_type',     type: 'condition',          phase: 'envio',      title: '¿Tipo de tarifa del envío?' },
        { key: 'msg_quote_wait',         type: 'step',               phase: 'envio',      title: "Qhatu: 'Nos comunicaremos con el equipo para cotizar tu envío'" },
        { key: 'handoff_quote',          type: 'handoff',            phase: 'envio',      title: 'HANDOFF: Equipo cotiza manualmente' },
        { key: 'send_quote',             type: 'step',               phase: 'envio',      title: 'Enviar cotización + resumen al cliente' },
        { key: 'request_data',           type: 'step',               phase: 'datos',      title: 'Solicitar datos del cliente (Apellido · Nombre · Celular · DNI) + resumen' },
        { key: 'show_payment_methods',   type: 'step',               phase: 'pago',       title: 'Mostrar métodos de pago configurados', feeds: 'payments' },
        { key: 'client_pays',            type: 'step',               phase: 'pago',       title: 'Cliente realiza el pago + envía foto del comprobante' },
        { key: 'msg_wait_conf',          type: 'step',               phase: 'pago',       title: "Qhatu: 'Déjanos confirmar tu pago'" },
        { key: 'handoff_conf',           type: 'handoff',            phase: 'pago',       title: 'HANDOFF: Emprendedor confirma el pago' },
        { key: 'decision_paid',          type: 'condition',          phase: 'pago',       title: '¿Pago confirmado?' },
        { key: 'end',                    type: 'start_end',          phase: 'cierre',     title: "Qhatu: 'Muchas gracias por tu compra. Te iremos informando sobre el proceso de envío'" }
    ];

    const GENERIC_DEMO_NODES = DEMO_SEED_SPECS.map((spec, i) => ({
        id: 'demo-' + spec.key,
        bot_id: 'demo',
        title: spec.title,
        description: '',
        node_type: spec.type,
        source: 'generic',
        status: 'active',
        order_index: i + 1,
        position_x: 0, position_y: 0,
        metadata: {
            seed_key: spec.key,
            ...(spec.phase ? { phase: spec.phase } : {}),
            ...(spec.feeds ? { feeds_from: spec.feeds } : {})
        },
        live: spec.feeds ? { type: spec.feeds, summary: 'Demo · conecta Supabase para ver tu config real', chips: [] } : null
    }));

    const DEMO_EDGE_SPECS = [
        ['start', 'greet', ''],
        ['greet', 'ask_products', ''],
        ['ask_products', 'offer_catalog', ''],
        ['offer_catalog', 'decision_catalog_size', ''],
        ['decision_catalog_size', 'show_all', 'Sí'],
        ['decision_catalog_size', 'show_top', 'No'],
        ['show_all', 'decision_client_action', ''],
        ['show_top', 'decision_client_action', ''],
        ['decision_client_action', 'resolve_multi', 'Pregunta por varios productos'],
        ['decision_client_action', 'resolve_single', 'Pregunta por un producto'],
        ['decision_client_action', 'show_shipping', 'Decide comprar'],
        ['resolve_multi', 'decision_client_action', ''],
        ['resolve_single', 'decision_client_action', ''],
        ['config_requirement', 'show_shipping', ''],
        ['show_shipping', 'decision_rate_type', ''],
        ['decision_rate_type', 'request_data', 'Tarifa fija'],
        ['decision_rate_type', 'msg_quote_wait', 'Requiere cotización'],
        ['msg_quote_wait', 'handoff_quote', ''],
        ['handoff_quote', 'send_quote', ''],
        ['send_quote', 'request_data', ''],
        ['request_data', 'show_payment_methods', ''],
        ['show_payment_methods', 'client_pays', ''],
        ['client_pays', 'msg_wait_conf', ''],
        ['msg_wait_conf', 'handoff_conf', ''],
        ['handoff_conf', 'decision_paid', ''],
        ['decision_paid', 'client_pays', 'No'],
        ['decision_paid', 'end', 'Sí']
    ];

    const GENERIC_DEMO_EDGES = DEMO_EDGE_SPECS.map(([fromKey, toKey, label], i) => ({
        id: 'demo-edge-' + i,
        bot_id: 'demo',
        from_node_id: 'demo-' + fromKey,
        to_node_id: 'demo-' + toKey,
        label
    }));

    // Builder client-side que adapta el workflow a la config real cargada en
    // state.live (productos, envíos, pagos). Espejo simplificado del backend
    // buildConfigDrivenSeed — usado cuando demo mode está activo + tenemos
    // config cargada, para que el editor refleje la decisión específica del
    // negocio en vez de mostrar el flujo genérico.
    //
    // Reglas implementadas:
    //   - Productos:
    //     · 1 producto  → un solo nodo "Mostrar <nombreProducto>", sin la
    //       decisión "¿catálogo tiene 3 o menos?" y sin la rama "varios
    //       productos" (no aplica con 1 sólo SKU)
    //     · 2-3         → "Mostrar todos los productos" + ambas ramas (cliente
    //       pregunta por un producto y por varios)
    //     · 4+          → mantenemos la decisión catalog-size del genérico
    //   - Envíos: usa state.live.shippingConfig para decidir si renderizar
    //     la rama de cotización variable o sólo tarifa fija
    //   - Pagos: el nodo show_payment_methods toma sus opciones reales desde
    //     state.live.paymentMethods vía feeds_from='payments'
    function buildConfigDrivenDemo() {
        const products = Array.isArray(state.live?.products) ? state.live.products : [];
        const productCount = products.length;
        // Si tenemos producto real lo usamos; si no, "el producto" como
        // placeholder genérico. Nunca dejamos string vacío que produciría
        // titles tipo "Mostrar " sin contenido.
        const singleProductName = productCount >= 1
            ? (products[0]?.name || products[0]?.nombre || 'el producto')
            : 'el producto';

        const specs = [];
        const edges = [];
        const addSpec = (s) => specs.push(s);
        const addEdge = (from, to, label) => edges.push([from, to, label || '']);

        // ── BIENVENIDA ────────────────────────────────────────────
        const storeLabel = (state.live && String(state.live.storeName || '').trim()) || '{nombre_negocio}';
        addSpec({ key: 'start',  type: 'start_end', phase: 'bienvenida', title: `Cliente escribe a ${storeLabel}` });
        addSpec({ key: 'greet',  type: 'step',      phase: 'bienvenida', title: 'Saludo inicial' });
        addEdge('start', 'greet');

        // ── PRODUCTOS ─────────────────────────────────────────────
        addSpec({ key: 'ask_products', type: 'step', phase: 'productos', title: 'Cliente pregunta por productos' });
        addEdge('greet', 'ask_products');
        addSpec({ key: 'offer_catalog', type: 'step', phase: 'productos', title: 'Ofrecer catálogo', feeds: 'products' });
        addEdge('ask_products', 'offer_catalog');

        // Caso productCount=0 (config aún no cargada al construir el demo) →
        // tratamos como "1 producto genérico" para evitar emitir la decisión
        // catálogo-size + rama duplicada que el usuario reporta como bug. Si
        // posteriormente loadLiveConfig trae productos reales, kipuForceDemoWorkflow
        // se redispara y reconstruye con el dato correcto.
        if (productCount === 0 || productCount === 1) {
            // Catálogo de 1 → catálogo en vivo + decisión cliente, sin decisión
            // de tamaño de catálogo ni rama "varios productos".
            addSpec({ key: 'decision_client_action', type: 'condition', phase: 'productos', title: '¿Qué hace el cliente?' });
            addEdge('offer_catalog', 'decision_client_action');
            addSpec({ key: 'resolve_single', type: 'step', phase: 'productos', title: `Responder dudas sobre ${singleProductName}` });
            addEdge('decision_client_action', 'resolve_single', 'Pregunta por el producto');
            addEdge('resolve_single', 'decision_client_action');
        } else if (productCount >= 2 && productCount <= 3) {
            // 2-3 → listamos todos, ambas ramas tienen sentido
            addSpec({ key: 'show_all', type: 'step', phase: 'productos', title: 'Mostrar todos los productos', feeds: 'products' });
            addEdge('offer_catalog', 'show_all');
            addSpec({ key: 'decision_client_action', type: 'condition', phase: 'productos', title: '¿Qué hace el cliente?' });
            addEdge('show_all', 'decision_client_action');
            addSpec({ key: 'resolve_multi',  type: 'step', phase: 'productos', title: 'Responder dudas varios productos' });
            addSpec({ key: 'resolve_single', type: 'step', phase: 'productos', title: 'Responder dudas producto específico' });
            addEdge('decision_client_action', 'resolve_multi',  'Pregunta por varios productos');
            addEdge('decision_client_action', 'resolve_single', 'Pregunta por un producto');
            addEdge('resolve_multi',  'decision_client_action');
            addEdge('resolve_single', 'decision_client_action');
        } else {
            // 4+ → mantenemos decisión catalog-size del genérico
            addSpec({ key: 'decision_catalog_size', type: 'condition', phase: 'productos', title: '¿Catálogo tiene 3 o menos productos?' });
            addEdge('offer_catalog', 'decision_catalog_size');
            addSpec({ key: 'show_all', type: 'step', phase: 'productos', title: 'Mostrar todos los productos', feeds: 'products' });
            addSpec({ key: 'show_top', type: 'step', phase: 'productos', title: 'Mostrar productos más vendidos según CRM', feeds: 'products' });
            addEdge('decision_catalog_size', 'show_all', 'Sí');
            addEdge('decision_catalog_size', 'show_top', 'No');
            addSpec({ key: 'decision_client_action', type: 'condition', phase: 'productos', title: '¿Qué hace el cliente?' });
            addEdge('show_all', 'decision_client_action');
            addEdge('show_top', 'decision_client_action');
            addSpec({ key: 'resolve_multi',  type: 'step', phase: 'productos', title: 'Responder dudas varios productos' });
            addSpec({ key: 'resolve_single', type: 'step', phase: 'productos', title: 'Responder dudas producto específico' });
            addEdge('decision_client_action', 'resolve_multi',  'Pregunta por varios productos');
            addEdge('decision_client_action', 'resolve_single', 'Pregunta por un producto');
            addEdge('resolve_multi',  'decision_client_action');
            addEdge('resolve_single', 'decision_client_action');
        }

        // ── ENVÍO ─────────────────────────────────────────────────
        addSpec({ key: 'show_shipping', type: 'step', phase: 'envio', title: 'Mostrar opciones de envío + métodos de pago del envío', feeds: 'shipping' });
        addEdge('decision_client_action', 'show_shipping', 'Decide comprar');

        const sc = state.live?.shippingConfig || {};
        const hasVariableRate = sc.cost_strategy === 'variable'
            || (Array.isArray(sc.groups) && sc.groups.some(g => g.modo === 'manual_quote'));
        if (hasVariableRate) {
            addSpec({ key: 'decision_rate_type', type: 'condition', phase: 'envio', title: '¿Tipo de tarifa del envío?' });
            addEdge('show_shipping', 'decision_rate_type');
            addSpec({ key: 'msg_quote_wait', type: 'step',    phase: 'envio', title: "Qhatu: 'Nos comunicaremos con el equipo para cotizar tu envío'" });
            addSpec({ key: 'handoff_quote',  type: 'handoff', phase: 'envio', title: 'HANDOFF: Equipo cotiza manualmente' });
            addSpec({ key: 'send_quote',     type: 'step',    phase: 'envio', title: 'Enviar cotización + resumen al cliente' });
            addEdge('decision_rate_type', 'msg_quote_wait', 'Requiere cotización');
            addEdge('msg_quote_wait', 'handoff_quote');
            addEdge('handoff_quote', 'send_quote');
            // Tarifa fija → datos
            addEdge('decision_rate_type', 'request_data', 'Tarifa fija');
            addEdge('send_quote', 'request_data');
        } else {
            // Sin cotización variable, salta directo a datos
            addEdge('show_shipping', 'request_data');
        }

        // ── DATOS ─────────────────────────────────────────────────
        addSpec({ key: 'request_data', type: 'step', phase: 'datos', title: 'Solicitar datos del cliente (Apellido · Nombre · Celular · DNI) + resumen' });

        // ── PAGO ──────────────────────────────────────────────────
        addSpec({ key: 'show_payment_methods', type: 'step', phase: 'pago', title: 'Mostrar métodos de pago configurados', feeds: 'payments' });
        addSpec({ key: 'client_pays', type: 'step', phase: 'pago', title: 'Cliente realiza el pago + envía foto del comprobante' });
        addSpec({ key: 'msg_wait_conf', type: 'step', phase: 'pago', title: "Qhatu: 'Déjanos confirmar tu pago'" });
        addSpec({ key: 'handoff_conf', type: 'handoff', phase: 'pago', title: 'HANDOFF: Emprendedor confirma el pago' });
        addSpec({ key: 'decision_paid', type: 'condition', phase: 'pago', title: '¿Pago confirmado?' });
        addEdge('request_data', 'show_payment_methods');
        addEdge('show_payment_methods', 'client_pays');
        addEdge('client_pays', 'msg_wait_conf');
        addEdge('msg_wait_conf', 'handoff_conf');
        addEdge('handoff_conf', 'decision_paid');
        addEdge('decision_paid', 'client_pays', 'No');

        // ── CIERRE ────────────────────────────────────────────────
        addSpec({ key: 'end', type: 'start_end', phase: 'cierre', title: "Qhatu: 'Muchas gracias por tu compra. Te iremos informando sobre el proceso de envío'" });
        addEdge('decision_paid', 'end', 'Sí');

        // Convertir specs/edges al formato de state.nodes/state.edges
        const nodes = specs.map((spec, i) => ({
            id: 'demo-' + spec.key,
            bot_id: 'demo',
            title: spec.title,
            description: '',
            node_type: spec.type,
            source: 'generic',
            status: 'active',
            order_index: i + 1,
            position_x: 0, position_y: 0,
            metadata: {
                seed_key: spec.key,
                ...(spec.phase ? { phase: spec.phase } : {}),
                ...(spec.feeds ? { feeds_from: spec.feeds } : {})
            },
            live: spec.feeds ? { type: spec.feeds, summary: 'Config en vivo', chips: [] } : null
        }));
        const edgeRecs = edges.map(([fromKey, toKey, label], i) => ({
            id: 'demo-edge-' + i,
            bot_id: 'demo',
            from_node_id: 'demo-' + fromKey,
            to_node_id: 'demo-' + toKey,
            label
        }));
        return { nodes, edges: edgeRecs };
    }

    // Nodos editados por el usuario (source custom/learned) no deben ser
    // reescritos ni ocultados por el alineamiento automático al catálogo.
    function isUserEditedNode(n) {
        return !!(n && (n.source === 'custom' || n.source === 'learned'));
    }

    /** Si hay greet custom + greet generic en BD, conserva el custom (Saludo inicial). */
    function dedupeWorkflowNodesBySeedKey(nodes) {
        const rank = (s) => (s === 'custom' ? 3 : s === 'learned' ? 2 : 1);
        const byKey = new Map();
        const withoutKey = [];
        for (const n of nodes || []) {
            const key = n?.metadata?.seed_key;
            if (!key) {
                withoutKey.push(n);
                continue;
            }
            const prev = byKey.get(key);
            if (!prev || rank(n.source) > rank(prev.source)) byKey.set(key, n);
        }
        const out = [...withoutKey, ...byKey.values()];
        if (out.length < (nodes || []).length) {
            console.log('[mindmap] deduped', (nodes || []).length - out.length, 'node(s) by seed_key — keeping custom over generic');
        }
        return out;
    }

    function applyWorkflowMapToState(map) {
        const deduped = dedupeWorkflowNodesBySeedKey(map.nodes || []);
        const ids = new Set(deduped.map(n => n.id));
        state.nodes = deduped;
        state.edges = (map.edges || []).filter(
            e => ids.has(e.from_node_id) && ids.has(e.to_node_id)
        );
    }

    // Reescribe state.nodes/state.edges para que reflejen la config en vivo.
    // El backend devuelve el seed genérico (catálogo asume 4+ productos con
    // 2 ramas de respuesta); si el negocio tiene 1 sólo producto, lo
    // colapsamos a la ruta de un único SKU eliminando los nodos obsoletos.
    function alignWorkflowToLiveConfig() {
        if (!state.nodes || state.nodes.length === 0) return;
        const products = Array.isArray(state.live?.products) ? state.live.products : [];
        const count = products.length;
        const productName = count >= 1
            ? (products[0]?.name || products[0]?.nombre || 'el producto')
            : 'el producto';

        // Map seed_key → node para encontrar nodos del seed estándar.
        const bySeedKey = new Map();
        state.nodes.forEach(n => {
            const k = n.metadata?.seed_key;
            if (k) bySeedKey.set(k, n);
        });

        // Colapsa la rama duplicada "varios productos" si el catálogo es
        // chico (≤3 productos) o si no podemos verificar el conteo. Con 4+
        // productos la decisión catalog-size + dos ramas tiene sentido.
        const shouldCollapseMultiBranch = count <= 3;

        console.log('[align] productos:', count, 'producto:', productName, 'collapse multi:', shouldCollapseMultiBranch);
        console.log('[align] seed_keys encontrados:', Array.from(bySeedKey.keys()).join(', '));

        if (shouldCollapseMultiBranch) {
            // Nodos del seed genérico que NO aplican con catálogo chico:
            // - decision_catalog_size (no hace sentido preguntar "¿3 o menos?")
            // - show_top (productos más vendidos — irrelevante con pocos SKUs)
            // - resolve_multi (rama duplicada — "varios productos" colapsa con
            //   "producto específico" en un solo nodo de respuesta)
            const toRemove = new Set();
            ['decision_catalog_size', 'show_top', 'resolve_multi'].forEach(k => {
                const n = bySeedKey.get(k);
                if (n && !isUserEditedNode(n)) toRemove.add(n.id);
            });

            // Fallback por título: si seed_key no está (workflow venido de
            // import o de un schema viejo), detectamos por texto.
            state.nodes.forEach(n => {
                if (isUserEditedNode(n)) return;
                const t = (n.title || '').toLowerCase();
                if (t.includes('varios productos') && !t.includes('un producto')) {
                    toRemove.add(n.id);
                }
                if (t.includes('catálogo tiene 3') || t.includes('catalogo tiene 3')) {
                    toRemove.add(n.id);
                }
                if (t.includes('más vendidos según crm') || t.includes('mas vendidos segun crm')) {
                    toRemove.add(n.id);
                }
            });

            console.log('[align] nodos a remover:', toRemove.size, Array.from(toRemove));

            // Renombrar nodos según el conteo real de productos (solo seed genérico).
            const showAll = bySeedKey.get('show_all');
            if (showAll && !isUserEditedNode(showAll)) {
                showAll.title = count === 1
                    ? `Mostrar ${productName}`
                    : 'Mostrar todos los productos';
            }
            const resolveSingle = bySeedKey.get('resolve_single');
            if (resolveSingle && !isUserEditedNode(resolveSingle)) {
                resolveSingle.title = count === 1
                    ? `Responder dudas sobre ${productName}`
                    : 'Responder dudas sobre los productos';
            }

            // Normalizar etiqueta de la rama sobreviviente. Con un solo nodo
            // de respuesta, "Pregunta por un producto" / "Pregunta por varios
            // productos" sobran — usamos "Pregunta por el producto" como
            // etiqueta canónica de la transición decisión → respuesta.
            const resolveSingleId = resolveSingle?.id;
            if (resolveSingle && !isUserEditedNode(resolveSingle)) {
                state.edges.forEach(e => {
                    if (e.to_node_id !== resolveSingleId) return;
                    e.label = count === 1
                        ? 'Pregunta por el producto'
                        : 'Pregunta por un producto';
                });
            }

            // Filtra nodos+edges eliminados, redirigiendo cualquier edge que
            // pase por un nodo borrado a su predecesor/sucesor para no romper
            // el flujo. Algoritmo: si A→X→B y X está en toRemove, generamos A→B.
            const removedIds = toRemove;
            const survivingEdges = [];
            const bridgeNeeded = []; // {from, to, label} a crear

            // Build adjacency: for each removed node, find its incoming + outgoing.
            const incoming = new Map(); // nodeId → [edges]
            const outgoing = new Map();
            state.edges.forEach(e => {
                if (!incoming.has(e.to_node_id)) incoming.set(e.to_node_id, []);
                incoming.get(e.to_node_id).push(e);
                if (!outgoing.has(e.from_node_id)) outgoing.set(e.from_node_id, []);
                outgoing.get(e.from_node_id).push(e);
            });
            removedIds.forEach(removedId => {
                const ins  = incoming.get(removedId) || [];
                const outs = outgoing.get(removedId) || [];
                ins.forEach(inE => {
                    outs.forEach(outE => {
                        if (removedIds.has(inE.from_node_id) || removedIds.has(outE.to_node_id)) return;
                        // Evita self-loops: si A→X→A y X se elimina, no
                        // generamos un edge A→A (auto-referencia inútil que
                        // aparece como flecha circular sobre el nodo).
                        if (inE.from_node_id === outE.to_node_id) return;
                        bridgeNeeded.push({
                            from: inE.from_node_id,
                            to: outE.to_node_id,
                            label: outE.label || inE.label || ''
                        });
                    });
                });
            });

            state.edges.forEach(e => {
                if (removedIds.has(e.from_node_id) || removedIds.has(e.to_node_id)) return;
                survivingEdges.push(e);
            });

            // Inyectar bridges (deduplicados — no dos veces el mismo from>to).
            const existingPairs = new Set(survivingEdges.map(e => `${e.from_node_id}>${e.to_node_id}`));
            bridgeNeeded.forEach((b, i) => {
                const key = `${b.from}>${b.to}`;
                if (existingPairs.has(key)) return;
                existingPairs.add(key);
                survivingEdges.push({
                    id: `bridge-${b.from}-${b.to}-${i}`,
                    bot_id: state.botId || 'live',
                    from_node_id: b.from,
                    to_node_id: b.to,
                    label: b.label
                });
            });

            state.nodes = state.nodes.filter(n => !removedIds.has(n.id));
            state.edges = survivingEdges;
            console.log('[mindmap] alignWorkflowToLiveConfig: 1 producto detectado, removidos', removedIds.size, 'nodos genéricos');
        }
    }

    function api(path, method = 'GET', body) {
        if (typeof apiCall === 'function') return apiCall(path, method, body);
        throw new Error('apiCall no disponible');
    }

    // ─── Public init ────────────────────────────────────────────
    // Mutex: serializa mounts concurrentes. Si el usuario cambia de tienda
    // mientras un init anterior sigue en vuelo, encolamos el botId nuevo.
    let _initInFlight = null;
    let _initQueuedBotId = null;
    let _mindmapInitSeq = 0;

    function _normBotId(id) {
        return id == null ? '' : String(id);
    }

    /** Destruye el canvas y limpia estado al cambiar de tienda (evita guardar en el bot equivocado). */
    window.kipuInvalidateMindmapForBotSwitch = function (nextBotId) {
        const next = _normBotId(nextBotId);
        const prev = _normBotId(window._kipuMindmapMountedFor);
        if (prev && next && prev === next) return;
        _mindmapInitSeq++;
        window._kipuMindmapMountedFor = null;
        state.selectedNodeId = null;
        state.nodes = [];
        state.edges = [];
        state.demoMode = false;
        if (next) state.botId = nextBotId;
        if (state.cy) {
            try { state.cy.destroy(); } catch (_) {}
            state.cy = null;
        }
    };

    window.initKipuMindmap = async function (botId) {
        if (!botId) return;
        const normId = _normBotId(botId);

        if (_initInFlight) {
            if (_normBotId(_initQueuedBotId) !== normId) {
                _initQueuedBotId = botId;
                console.log('[mindmap] init queued for bot switch →', normId);
            }
            await _initInFlight;
            if (_initQueuedBotId && _normBotId(_initQueuedBotId) !== _normBotId(window._kipuMindmapMountedFor)) {
                const queued = _initQueuedBotId;
                _initQueuedBotId = null;
                return window.initKipuMindmap(queued);
            }
            return;
        }

        if (_normBotId(window._kipuMindmapMountedFor) === normId && state.cy && _normBotId(state.botId) === normId) {
            try { state.cy.resize(); state.cy.fit(undefined, 60); } catch (_) {}
            refreshFromBackend();
            ensureDemoBanner();
            return;
        }

        _initQueuedBotId = null;
        _initInFlight = (async () => {
            try {
                await _doInitMindmap(botId);
            } finally {
                _initInFlight = null;
                const queued = _initQueuedBotId;
                _initQueuedBotId = null;
                if (queued && _normBotId(queued) !== _normBotId(window._kipuMindmapMountedFor)) {
                    await window.initKipuMindmap(queued);
                }
            }
        })();
        return _initInFlight;
    };

    function _initStillValid(seqAtStart, botAtStart) {
        return _mindmapInitSeq === seqAtStart && _normBotId(state.botId) === botAtStart;
    }

    async function _doInitMindmap(botId) {
        const normId = _normBotId(botId);
        if (_normBotId(state.botId) !== normId) {
            window.kipuInvalidateMindmapForBotSwitch(botId);
        }
        const seqAtStart = _mindmapInitSeq;
        const botAtStart = normId;
        // Tear down previous Cytoscape instance if mounting a different bot.
        if (state.cy) {
            try { state.cy.destroy(); } catch (_) {}
            state.cy = null;
        }
        // Ocultar popup si quedó abierto al cambiar de bot
        try { hideHoverPopup(); } catch (_) {}

        state.botId = botId;

        const host = document.getElementById('kipu-mindmap-host');
        if (!host) return;

        host.innerHTML = `
            <div class="kipu-mindmap" id="kipu-mindmap-root" tabindex="0">
                <div class="kipu-mindmap-chrome">
                    <div class="kipu-mindmap-toolbar-main" role="toolbar" aria-label="Herramientas del workflow">
                        <div class="kipu-mm-toolbar-left">
                            <div class="kipu-node-palette collapsed" id="kipu-node-palette">
                                <button class="kipu-palette-handle" id="kipu-palette-handle"
                                        type="button" aria-label="Mostrar tipos de nodo" title="Añadir nodo">
                                    <span class="kipu-palette-handle-icon" aria-hidden="true">+</span>
                                    <span class="kipu-palette-handle-label">Añadir nodo</span>
                                </button>
                                <div class="kipu-palette-content">
                                    <div class="kipu-palette-title-row">
                                        <span class="kipu-palette-title">AÑADIR NODO</span>
                                        <button class="kipu-palette-close" id="kipu-palette-close"
                                                type="button" aria-label="Ocultar tipos de nodo" title="Cerrar">×</button>
                                    </div>
                                    <button class="kipu-palette-btn" data-type="start_end" title="Inicio / Fin — pill lavanda">
                                        <span class="kipu-palette-preview start_end"></span>
                                        <span class="kipu-palette-label">Inicio / Fin</span>
                                    </button>
                                    <button class="kipu-palette-btn" data-type="step" title="Proceso — mensaje del bot o acción">
                                        <span class="kipu-palette-preview step"></span>
                                        <span class="kipu-palette-label">Proceso</span>
                                    </button>
                                    <button class="kipu-palette-btn" data-type="condition" title="Decisión — diamante">
                                        <span class="kipu-palette-preview condition"></span>
                                        <span class="kipu-palette-label">Decisión</span>
                                    </button>
                                    <button class="kipu-palette-btn" data-type="handoff" title="Handoff — subproceso manual">
                                        <span class="kipu-palette-preview handoff"></span>
                                        <span class="kipu-palette-label">Handoff</span>
                                    </button>
                                    <button class="kipu-palette-btn" data-type="config_requirement" title="Requisito — integración activa">
                                        <span class="kipu-palette-preview config_requirement"></span>
                                        <span class="kipu-palette-label">Requisito</span>
                                    </button>
                                </div>
                            </div>
                            <div class="kipu-mm-divider" aria-hidden="true"></div>
                            <div class="kipu-format-toggle" id="kipu-format-toggle"
                                 role="radiogroup" aria-label="Formato de respuesta del bot">
                                <span class="kipu-format-toggle__label" aria-hidden="true">Formato:</span>
                                <button type="button" class="kipu-format-toggle__btn is-active"
                                        data-im-mode="botones" role="radio" aria-checked="true"
                                        title="El bot ofrece opciones numeradas (botones quick-reply en WhatsApp)">
                                    Solo botones
                                </button>
                                <button type="button" class="kipu-format-toggle__btn"
                                        data-im-mode="conversacional" role="radio" aria-checked="false"
                                        title="El bot conversa abierto, sin numerar opciones">
                                    Solo conversacional
                                </button>
                            </div>
                        </div>
                        <div class="kipu-mm-toolbar-right">
                            <div class="kipu-mm-saved-pill" id="kipu-save-status-pill"><span class="kipu-mm-saved-dot" aria-hidden="true"></span><span id="kipu-save-status-text">Guardado</span></div>
                            <button type="button" class="kipu-btn kipu-btn--outline kipu-mm-btn-outline" id="kipu-mm-export">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                                Exportar workflow
                            </button>
                            <button type="button" class="kipu-mm-btn-primary" id="kipu-mm-publish">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
                                Guardar
                            </button>
                        </div>
                    </div>
                </div>
                <div class="kipu-cy-container" id="kipu-cy-container"></div>

                <div class="kipu-side-panel" id="kipu-side-panel"></div>

                <div class="kipu-mindmap-zoom">
                    <button class="kipu-mindmap-zbtn" id="kipu-zoom-out" title="Alejar">−</button>
                    <button class="kipu-mindmap-zbtn kipu-zoom-pct" id="kipu-zoom-pct" title="Ajustar a contenido">100%</button>
                    <button class="kipu-mindmap-zbtn" id="kipu-zoom-in" title="Acercar">+</button>
                    <button class="kipu-mindmap-zbtn" id="kipu-zoom-fit" title="Pantalla completa">⛶</button>
                </div>

                <input type="file" id="kipu-import-file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" style="display:none" />
            </div>
        `;

        // Load data before initializing Cytoscape (so we honor saved positions).
        // Live config (Envíos + Pagos) se carga en paralelo para que los
        // nodos feeds-from rendericen con datos reales, no el seed estático.
        state.demoMode = false;
        try {
            const [map] = await Promise.all([
                api('/workflow/' + encodeURIComponent(botId)),
                loadLiveConfig()
            ]);
            if (!_initStillValid(seqAtStart, botAtStart)) {
                console.log('[mindmap] init aborted after fetch — bot switched mid-flight');
                return;
            }
            applyWorkflowMapToState(map);
        } catch (e) {
            if (!_initStillValid(seqAtStart, botAtStart)) return;
            console.warn('[mindmap] backend unavailable → demo mode:', e);
            state.demoMode = true;
            const seed = buildConfigDrivenDemo();
            state.nodes = seed.nodes;
            state.edges = seed.edges;
            showDemoBanner(e.message || 'Tablas no encontradas');
        }

        // Fallback: si el backend devolvió un workflow vacío (config-driven
        // seed falló, bot recién creado sin onboarding, o auto-seed bloqueado
        // por algún error transitorio), cargamos los nodos demo locales para
        // que el usuario SIEMPRE vea el canvas poblado con las swimlanes por
        // fase — sin nodos, las fases no se dibujan y el canvas queda vacío.
        if (!state.demoMode && (!state.nodes || state.nodes.length === 0)) {
            console.warn('[mindmap] backend returned empty workflow → using config-driven demo as fallback');
            state.demoMode = true;
            const seed = buildConfigDrivenDemo();
            state.nodes = seed.nodes;
            state.edges = seed.edges;
            showDemoBanner('Workflow aún no inicializado — mostrando plantilla');
        }

        // Post-procesar el workflow cargado del backend para alinearlo con
        // la config real (productos, envíos). El backend hereda nodos del
        // seed genérico que pueden no aplicar al negocio (ej: rama "varios
        // productos" cuando el catálogo tiene 1 sólo SKU). Aquí los colapsamos.
        alignWorkflowToLiveConfig();

        // Auto-layout ANTES de crear cytoscape: si las posiciones guardadas
        // no son swimlane vertical (legacy snake o sin posiciones), las
        // recalculamos para que el grafo se renderice ya en la grilla
        // correcta — sin parpadeo de "todos en (0,0)".
        const needsLayout = needsAutoLayout(state.nodes);
        if (needsLayout) {
            try { computeVerticalSwimlanePositions(); } catch (e) { console.warn('[mindmap] swimlane compute failed:', e); }
        }

        // initCytoscape puede tirar si cytoscape no está cargado o si el
        // contenedor mide 0x0 al momento del init — atrapamos el error para
        // que wireTopbar SIEMPRE corra y los botones zoom/añadir-nodo queden
        // conectados aunque el grafo no llegue a renderizarse.
        try {
            initCytoscape();
            console.log('[mindmap] cytoscape init OK — nodes:', state.nodes.length, 'edges:', state.edges.length);
        } catch (e) {
            console.error('[mindmap] initCytoscape threw:', e);
        }
        try {
            wireTopbar();
        } catch (e) {
            console.error('[mindmap] wireTopbar threw:', e);
        }

        try {
            if (state.demoMode) {
                const t = document.getElementById('kipu-save-status-text');
                if (t) t.textContent = 'Demo — sin persistencia';
                const pill = document.getElementById('kipu-save-status-pill');
                if (pill) {
                    pill.style.background = '#fef3c7';
                    pill.style.color = '#78350f';
                    pill.style.borderColor = 'rgba(120, 53, 15, 0.22)';
                }
                const dot = pill && pill.querySelector('.kipu-mm-saved-dot');
                if (dot) dot.style.background = '#d97706';
            } else {
                touchChromeAfterPersist();
            }
            updateMindmapChromeStats();
            scheduleMindmapChromeStatsLoop();
        } catch (_) { /* chrome opcional */ }

        if (needsLayout) {
            // Persistir las posiciones recién calculadas y ajustar zoom.
            state.nodes.forEach(n => persistNodePositionWithMetadata(n.id));
            try { state.cy && state.cy.fit(undefined, 60); } catch (_) {}
        } else {
            try { state.cy && state.cy.fit(undefined, 60); } catch (_) {}
        }

        if (!_initStillValid(seqAtStart, botAtStart)) {
            console.log('[mindmap] init aborted before mount — bot switched during layout');
            if (state.cy) { try { state.cy.destroy(); } catch (_) {} state.cy = null; }
            return;
        }

        // Mark this bot as mounted so subsequent calls (tab switch, post-save
        // regenerate) don't rebuild the DOM/Cytoscape on top of itself.
        window._kipuMindmapMountedFor = botId;
        // Reset cache de ejemplos al cambiar de bot (es por bot).
        state.exampleCache = {};
        try { updateGenAllButton(); } catch (_) {}

        // FAILSAFE: si después de todo lo anterior el canvas quedó sin
        // elementos visibles (state.cy null, buildCyElements throw, layout
        // raro, backend devolvió un workflow inválido, etc.) — forzamos
        // demo nodes con reinit completo de cytoscape. Garantía total de
        // que el usuario NUNCA ve un canvas vacío.
        const failsafeBotId = botAtStart;
        const failsafeSeq = seqAtStart;
        setTimeout(() => {
            try {
                if (!_initStillValid(failsafeSeq, failsafeBotId)) return;
                const visible = state.cy ? state.cy.elements().length : 0;
                console.log('[mindmap] failsafe check — state.cy:', !!state.cy, 'elements:', visible, 'state.nodes:', state.nodes.length);
                if (state.cy && visible > 0) return;

                console.warn('[mindmap] FAILSAFE: forcing demo render — canvas was empty');
                state.demoMode = true;
                const seed = buildConfigDrivenDemo();
                state.nodes = seed.nodes;
                state.edges = seed.edges;
                try { computeVerticalSwimlanePositions(); } catch (e) { console.warn('[failsafe] swimlane:', e); }

                if (state.cy) {
                    try {
                        state.cy.elements().remove();
                        state.cy.add(buildCyElements());
                        state.cy.resize();
                        state.cy.fit(undefined, 60);
                    } catch (e) {
                        console.error('[failsafe] re-add to existing cy failed:', e);
                    }
                } else {
                    // state.cy es null → cytoscape no se creó. Reintentamos init completo.
                    try {
                        initCytoscape();
                        try { wireTopbar(); } catch (_) {}
                        if (state.cy) state.cy.fit(undefined, 60);
                    } catch (e) {
                        console.error('[failsafe] full re-init failed:', e);
                    }
                }
                console.log('[mindmap] failsafe DONE — final elements:', state.cy ? state.cy.elements().length : 0);
            } catch (e) {
                console.error('[failsafe] uncaught:', e);
            }
        }, 400);
    }

    function needsAutoLayout(nodes) {
        if (!nodes || nodes.length === 0) return false;
        // Política definitiva (pedido del usuario): el layout swimlane vertical
        // ES el predeterminado y se aplica SIEMPRE en cada hard-reload. Las
        // posiciones guardadas en BD (incluidas las que vienen con flag
        // position_manual de un drag previo) se ignoran al recargar — el
        // canvas siempre vuelve a la grilla canónica. Drags durante la sesión
        // siguen funcionando hasta el próximo reload.
        return true;
    }

    // ─── Cytoscape init ────────────────────────────────────────
    function initCytoscape() {
        if (typeof cytoscape !== 'function') {
            console.error('[mindmap] cytoscape not loaded');
            return;
        }
        // cytoscape-dagre and cytoscape-edgehandles self-register when their
        // script tags load after cytoscape (no explicit cytoscape.use needed).

        const container = document.getElementById('kipu-cy-container');
        if (state.cy) { try { state.cy.destroy(); } catch (_) {} state.cy = null; }
        destroyN8nEdgeSvgLayer();

        state.cy = cytoscape({
            container,
            elements: buildCyElements(),
            style: cytoscapeStylesheet(),
            layout: { name: 'preset' },
            minZoom: 0.3,
            maxZoom: 2.5,
            wheelSensitivity: 0.25,
            boxSelectionEnabled: false
        });

        // Edge handles (drag from node border to another node to connect)
        if (typeof state.cy.edgehandles === 'function') {
            state.edgehandles = state.cy.edgehandles({
                canConnect: (src, tgt) => !src.same(tgt),
                edgeParams: () => ({ data: { label: '' } }),
                hoverDelay: 120,
                snap: true,
                snapThreshold: 60,
                snapFrequency: 15,
                noEdgeEventsInDraw: true,
                disableBrowserGestures: true
            });
        }

        // Capturar la posición de inicio del drag — la usamos en dragfree
        // para detectar si hubo movimiento real y guardar undo.
        state.cy.on('grab', 'node', (evt) => {
            const n = evt.target;
            if (n.data('kind') !== 'node') return;
            const pos = n.position();
            state.dragStartPos[n.id()] = { x: pos.x, y: pos.y };
        });

        // Drag-to-reposition → persist + push al undo stack si hubo movimiento.
        state.cy.on('dragfree', 'node', (evt) => {
            const n = evt.target;
            if (n.data('kind') !== 'node') return;
            const pos = n.position();
            const id = n.id();
            const start = state.dragStartPos[id];
            delete state.dragStartPos[id];
            // Push al undo stack solo si la posición cambió. Threshold de 1px
            // para ignorar clicks que cytoscape registra como drag.
            if (start && (Math.abs(start.x - pos.x) > 1 || Math.abs(start.y - pos.y) > 1)) {
                state.dragUndoStack.push({
                    nodeId: id,
                    fromX: start.x, fromY: start.y,
                    toX: pos.x,     toY: pos.y
                });
                if (state.dragUndoStack.length > 50) state.dragUndoStack.shift();
            }
            const rec = state.nodes.find(x => x.id === id);
            if (rec) {
                rec.position_x = pos.x;
                rec.position_y = pos.y;
                rec.metadata = rec.metadata || {};
                rec.metadata.position_manual = true;
                persistNodePositionWithMetadata(id);
            } else {
                persistNodePosition(id);
            }
        });

        // Drag de grupos completos: cuando el usuario arrastra el header
        // de una swimlane (BIENVENIDA, PRODUCTOS, etc.), cytoscape mueve
        // automáticamente todos los nodos hijos. Persistimos las nuevas
        // posiciones de los hijos para que sobrevivan al recargar.
        state.cy.on('grab', 'node[kind = "phase"]', (evt) => {
            const parent = evt.target;
            const children = parent.children();
            children.forEach(child => {
                if (child.data('kind') !== 'node') return;
                const pos = child.position();
                state.dragStartPos[child.id()] = { x: pos.x, y: pos.y };
            });
        });

        state.cy.on('dragfree', 'node[kind = "phase"]', (evt) => {
            const parent = evt.target;
            const children = parent.children();
            children.forEach(child => {
                if (child.data('kind') !== 'node') return;
                const id = child.id();
                const pos = child.position();
                const start = state.dragStartPos[id];
                delete state.dragStartPos[id];
                const rec = state.nodes.find(x => x.id === id);
                if (!rec) return;
                // Solo persistir si el grupo realmente se movió.
                if (start && (Math.abs(start.x - pos.x) > 1 || Math.abs(start.y - pos.y) > 1)) {
                    rec.position_x = pos.x;
                    rec.position_y = pos.y;
                    rec.metadata = rec.metadata || {};
                    rec.metadata.position_manual = true;
                    persistNodePositionWithMetadata(id);
                }
            });
        });

        // Selection → side panel
        state.cy.on('tap', 'node', (evt) => {
            const n = evt.target;
            if (n.data('kind') !== 'node') return;
            selectNode(n.id());
        });

        // Click blank canvas → clear selection
        state.cy.on('tap', (evt) => {
            if (evt.target === state.cy) {
                clearSelection();
                closeContextMenu();
            }
        });

        // Double-click node → edit overlay (or external feeds config)
        state.cy.on('dblclick', 'node', (evt) => {
            if (evt.target.data('kind') !== 'node') return;
            openEditOverlay(evt.target.id());
        });

        // Right-click → context menu (use cxttap, Cytoscape's platform-neutral event)
        state.cy.on('cxttap', 'node', (evt) => {
            if (evt.target.data('kind') !== 'node') return;
            const e = evt.originalEvent;
            const x = (e && e.clientX) || 0;
            const y = (e && e.clientY) || 0;
            selectNode(evt.target.id());
            openContextMenu(evt.target.id(), x, y);
        });

        // Edge click → offer delete
        state.cy.on('tap', 'edge', (evt) => {
            const e = evt.target;
            if (!e.data('edgeId')) return; // ignore edgehandles preview edges
            if (confirm('¿Eliminar esta conexión?')) {
                deleteEdgeAction(e.data('edgeId'));
            }
        });

        // Edge created via edgehandles → persist
        state.cy.on('ehcomplete', (evt, sourceNode, targetNode, addedEdge) => {
            const fromId = sourceNode.id();
            const toId = targetNode.id();
            // Remove the preview edge; we'll add a real one after persistence succeeds
            try { addedEdge.remove(); } catch (_) {}
            finishConnect(fromId, toId);
        });

        // Zoom change → update label in the corner + ocultar popup (la
        // posición ya no es válida tras el zoom).
        state.cy.on('zoom', () => {
            const pct = Math.round(state.cy.zoom() * 100) + '%';
            const z = document.getElementById('kipu-zoom-pct');
            if (z) z.textContent = pct;
            const z2 = document.getElementById('kipu-tb-zoom-pct-label');
            if (z2) z2.textContent = pct;
            if (state.hoverPopup.visible || state.hoverPopup.showTimer) hideHoverPopup();
        });
        // Pan → ocultar popup (su posición se desactualizaría)
        state.cy.on('pan', () => {
            if (state.hoverPopup.visible || state.hoverPopup.showTimer) hideHoverPopup();
        });

        // Hover en nodos → clase 'hovered' (sombra más marcada) + popup overlay
        state.cy.on('mouseover', 'node', (evt) => {
            if (evt.target.data('kind') !== 'node') return;
            evt.target.addClass('hovered');
            // Popup overlay solo en nodos donde el bot habla al cliente.
            // Skip en touch devices (no aplica hover).
            if (!isTouchDevice && !state.demoMode) {
                const id = evt.target.id();
                const node = state.nodes.find(n => n.id === id);
                if (nodeHasBotMessage(node)) scheduleHoverShow(id);
            }
        });
        state.cy.on('mouseout', 'node', (evt) => {
            if (evt.target.data('kind') !== 'node') return;
            evt.target.removeClass('hovered');
            if (!isTouchDevice) {
                // Cancelar timer de show pendiente
                if (state.hoverPopup.showTimer) {
                    clearTimeout(state.hoverPopup.showTimer);
                    state.hoverPopup.showTimer = null;
                }
                // Si el popup ya estaba visible, programar ocultamiento con
                // gracia (200ms) — esto permite que si el mouse pasa al popup,
                // mouseenter lo cancele y se mantenga abierto.
                if (state.hoverPopup.visible) scheduleHoverHide();
            }
        });
        // Drag de nodo → ocultar popup inmediatamente (la posición se mueve).
        state.cy.on('grab drag', 'node', () => {
            if (state.hoverPopup.visible || state.hoverPopup.showTimer) hideHoverPopup();
        });
        // Click (tap) en nodo → cerrar popup; el side panel lo abre el handler
        // de selectNode existente.
        state.cy.on('tap', 'node', () => {
            if (state.hoverPopup.visible || state.hoverPopup.showTimer) hideHoverPopup();
        });
        // Hover en conectores → 3px + navy 100% (o rojo más oscuro si negative)
        state.cy.on('mouseover', 'edge', (evt) => {
            evt.target.addClass('hovered');
        });
        state.cy.on('mouseout', 'edge', (evt) => {
            evt.target.removeClass('hovered');
        });

        state.cy.on('add remove', () => {
            try { updateMindmapChromeStats(); } catch (_) {}
        });
        try { updateMindmapChromeStats(); } catch (_) {}

        bindN8nEdgeSvgRedraw();

        // Keyboard shortcuts on host
        const root = document.getElementById('kipu-mindmap-root');
        root.addEventListener('keydown', onRootKeydown);
        document.addEventListener('keydown', onGlobalKeydown);
    }

    // ─── Live config (Envíos + Métodos de pago) ─────────────────
    // Carga la configuración real del bot (envíos + pagos) desde el backend
    // para que los nodos del workflow con `feeds_from` muestren el contenido
    // actual en lugar del texto genérico que dejó el seed. Sin esto, al
    // editar Envíos/Pagos en otra pestaña, el workflow seguía mostrando el
    // conteo viejo hasta el próximo re-seed.
    async function loadLiveConfig() {
        if (!state.botId) return;
        const sid = String(state.botId);
        try {
            const [biz, bots] = await Promise.all([
                api('/business/' + encodeURIComponent(state.botId)).catch(() => null),
                (typeof getCachedBots === 'function')
                    ? getCachedBots().catch(() => [])
                    : Promise.resolve([])
            ]);
            const bot = (Array.isArray(bots) ? bots : []).find(b => String(b._id || b.id) === sid) || {};
            const sc = bot.operacion?.shippingConfig
                || bot.shippingConfig
                || biz?.shipping_config
                || biz?.shippingConfig
                || {};
            const pms = (Array.isArray(biz?.payment_methods_structured) && biz.payment_methods_structured.length > 0)
                ? biz.payment_methods_structured
                : (Array.isArray(bot.operacion?.metodos_pago) ? bot.operacion.metodos_pago : []);
            state.live.shippingConfig = sc;
            state.live.pickupLocs = Array.isArray(sc.store_pickup_locations) ? sc.store_pickup_locations : [];
            state.live.paymentMethods = pms;
            // Nombre del negocio — usado para sustituir el placeholder
            // {nombre_negocio} en titles tanto de seeds backend como demo.
            // botName es lo que setea «Crear tienda»; tienda.nombre a veces llega
            // vacío según versión del doc — priorizar botName para el placeholder
            // {nombre_negocio} del workflow.
            state.live.storeName = (bot.botName && String(bot.botName).trim())
                || (bot.tienda?.nombre && String(bot.tienda.nombre).trim())
                || (biz?.identidad?.nombre && String(biz.identidad.nombre).trim())
                || (biz?.business_name && String(biz.business_name).trim())
                || (bot.name && String(bot.name).trim())
                || '';
            state.live.products = Array.isArray(biz?.products) ? biz.products : [];
        } catch (e) {
            console.warn('[mindmap] live config fetch failed:', e?.message);
        }
    }

    /** Nombre visible de la tienda para tokens del workflow (Willy + panel). */
    function resolveWorkflowStoreName() {
        let n = (state.live && state.live.storeName) ? String(state.live.storeName).trim() : '';
        if (n) return n;
        const bid = state.botId;
        const list = typeof window !== 'undefined' ? window.__kipuLastBotsList : null;
        if (bid && Array.isArray(list)) {
            const b = list.find(x => String(x._id || x.id) === String(bid));
            if (b) {
                n = (b.botName && String(b.botName).trim())
                    || (b.tienda?.nombre && String(b.tienda.nombre).trim())
                    || '';
            }
        }
        return n || '';
    }

    // Reemplaza placeholders {nombre_negocio} (y futuros tokens) por valores
    // reales de la config del usuario. Tolera title undefined → string vacío.
    function substitutePlaceholders(text) {
        if (!text) return '';
        const name = resolveWorkflowStoreName();
        if (!name) return text;
        return String(text).replace(/\{nombre_negocio\}/gi, name);
    }

    // Map de códigos de departamento → nombre legible. Espejo del backend
    // (workflow-map.service.ts y bot-manager.ts). Si agregas un nuevo
    // departamento, actualiza ambos lugares.
    const DEPT_NAMES = {
        amazonas: 'Amazonas', ancash: 'Áncash', apurimac: 'Apurímac',
        arequipa: 'Arequipa', ayacucho: 'Ayacucho', cajamarca: 'Cajamarca',
        callao: 'Callao', cusco: 'Cusco', huancavelica: 'Huancavelica',
        huanuco: 'Huánuco', ica: 'Ica', junin: 'Junín',
        la_libertad: 'La Libertad', lambayeque: 'Lambayeque',
        lima_metropolitana: 'Lima Metropolitana', lima_provincias: 'Lima Provincias',
        loreto: 'Loreto', madre_de_dios: 'Madre de Dios', moquegua: 'Moquegua',
        pasco: 'Pasco', piura: 'Piura', puno: 'Puno',
        san_martin: 'San Martín', tacna: 'Tacna', tumbes: 'Tumbes', ucayali: 'Ucayali'
    };
    function deptListOf(codes) {
        if (!Array.isArray(codes) || codes.length === 0) return '';
        const names = codes.map(c => DEPT_NAMES[c] || c);
        if (names.length <= 3) return names.join(', ');
        return `${names.slice(0, 3).join(', ')} +${names.length - 3}`;
    }
    function strategyLabel(g) {
        if (g.cost_strategy === 'free') return 'gratis';
        if (g.cost_strategy === 'fixed') return g.fixed_cost > 0 ? `S/ ${g.fixed_cost}` : 'tarifa fija';
        if (g.cost_strategy === 'free_above_threshold') return g.free_threshold > 0 ? `gratis desde S/ ${g.free_threshold}` : 'gratis sobre umbral';
        if (g.cost_strategy === 'variable') return 'cotización manual';
        return g.cost_strategy || 'envío';
    }
    function paymentTimingLabel(t) {
        if (t === 'upfront')     return 'pago total';
        if (t === 'partial')     return 'pago parcial';
        if (t === 'on_delivery') return 'contraentrega';
        return '';
    }

    // Construye los bullets de la opción de envío con TODA la info real:
    //   • Sucursal · "Nombre — Dirección"
    //   • "Lima Metropolitana · gratis (24h) · pago total"
    //   • "Cusco, Arequipa +5 · cotización manual → cotización manual"
    // Espejo de la lógica de backend para que ambos generen el mismo texto.
    function buildShippingOptions(sc, pickupLocs) {
        const out = [];
        const pl = Array.isArray(pickupLocs) ? pickupLocs : [];
        const validPickup = pl.filter(l => (l?.address || '').trim().length > 0);
        validPickup.slice(0, 6).forEach(l => {
            const name = (l.name || 'Sucursal').toString().trim();
            const addr = (l.address || '').toString().trim();
            const addrShort = addr.length > 50 ? addr.slice(0, 50).trim() + '…' : addr;
            out.push(`Recojo · ${name} — ${addrShort}`);
        });
        const groups = Array.isArray(sc?.groups) ? sc.groups : [];
        groups.slice(0, 8).forEach((g, i) => {
            if (!g || !g.cost_strategy) return;
            const regs   = deptListOf(g.departments);
            const cost   = strategyLabel(g);
            const eta    = (g.delivery_eta || '').toString().trim();
            const timing = paymentTimingLabel(g.payment_timing);
            const region = regs || `Grupo ${i + 1}`;
            const head   = `Envío a domicilio · ${region} · ${cost}`;
            const withEta = eta ? `${head} (${eta})` : head;
            const full   = timing ? `${withEta} · ${timing}` : withEta;
            out.push(g.cost_strategy === 'variable'
                ? `${full} → cotización manual`
                : full);
        });
        // Legacy flat (sin groups[])
        if (out.length === 0 && sc?.cost_strategy) {
            const fakeG = {
                cost_strategy: sc.cost_strategy,
                fixed_cost: sc.fixed_cost,
                free_threshold: sc.free_threshold
            };
            const cost = strategyLabel(fakeG);
            const eta  = (sc.delivery_eta || '').toString().trim();
            out.push(eta ? `Envío a domicilio · ${cost} (${eta})` : `Envío a domicilio · ${cost}`);
        }
        return out;
    }

    // Lista de métodos de pago con tipo + instrucciones literales (truncadas).
    // Espejo del backend: "Yape (Yape/Plin): 955 577 977".
    function buildPaymentOptions(methods) {
        const out = [];
        (Array.isArray(methods) ? methods : []).forEach(m => {
            if (!m || m.activo === false) return;
            const name  = (m.nombre || m.metodo || m.name || '').toString().trim();
            if (!name) return;
            const tipo  = (m.tipo || '').toString().trim();
            const instr = (m.instrucciones || '').toString().trim();
            const head  = tipo ? `${name} (${tipo})` : name;
            const instrShort = instr.length > 50 ? instr.slice(0, 50).trim() + '…' : instr;
            out.push(instrShort ? `${head}: ${instrShort}` : head);
        });
        return out;
    }

    // Trunca un bullet largo a una línea legible. Si el texto excede `max`
    // caracteres lo cortamos en la última palabra antes del límite + "…".
    // Ojo: cytoscape envuelve líneas dentro de un bullet; queremos un solo
    // wrap por bullet, no que un bullet ocupe 4 líneas y empuje los demás.
    function truncateBullet(text, max = 70) {
        const s = (text || '').toString().trim();
        if (s.length <= max) return s;
        const cut = s.slice(0, max);
        const lastSpace = cut.lastIndexOf(' ');
        const head = lastSpace > 30 ? cut.slice(0, lastSpace) : cut;
        return head + '…';
    }

    // Compone un cuerpo multi-línea de bullets para usar como label de
    // cytoscape. Si hay >MAX_INLINE bullets, muestra los primeros y agrega
    // "+ N más" para no saturar el nodo. La separación con línea vacía
    // entre header y bullets crea jerarquía visual clara.
    function buildBulletsBody(bullets, maxInline = 6) {
        const list = (Array.isArray(bullets) ? bullets : []).filter(Boolean);
        if (list.length === 0) return null;
        const visible = list.slice(0, maxInline).map(o => `• ${truncateBullet(o)}`);
        const tail = list.length > maxInline
            ? [`  + ${list.length - maxInline} más`]
            : [];
        return [...visible, ...tail].join('\n');
    }

    // Bullets dinámicos derivados de live config (Envíos / Pagos). Esto se
    // recalcula cuando el usuario cambia config en otra pestaña — los nodos
    // del workflow se actualizan sin esperar al próximo regenerate. Para
    // productos y datos cliente no hay live source: el seed mete los bullets
    // en metadata.display_bullets directamente y los usamos como están.
    function liveBulletsFor(feedsKind) {
        if (feedsKind === 'shipping') {
            return buildShippingOptions(state.live.shippingConfig, state.live.pickupLocs);
        }
        if (feedsKind === 'payments') {
            return buildPaymentOptions(state.live.paymentMethods);
        }
        return null;
    }

    // Construye el título dinámico para nodos con bullets — sea por feeds_from
    // (live data) o por metadata.display_bullets (seed). Si el nodo no tiene
    // ninguno, devuelve null y el caller usa el título estático.
    //   • feeds vacío  → header + "⚠ Sin <X> configurados" + hint
    //   • con bullets  → header + lista (• bullet …) + "+ N más" si hay 6+
    function computeFeedsRender(nodeRecord) {
        const feeds = nodeRecord?.metadata?.feeds_from;
        const seedBullets = Array.isArray(nodeRecord?.metadata?.display_bullets)
            ? nodeRecord.metadata.display_bullets
            : null;
        const baseHeader = nodeRecord?.title || '';

        // Compone el label final con jerarquía visual clara:
        //   Header (título)
        //   ───────  ← separador vacío
        //   • bullet 1
        //   • bullet 2
        // El "\n \n" mete un salto de línea con un espacio invisible para
        // que cytoscape lo respete (un \n vacío lo colapsa).
        const compose = (header, body) => `${header}\n \n${body}`;

        // Caso 1: nodo con feeds live (envío/pago). Live tiene prioridad
        // sobre los bullets del seed para reflejar cambios sin regenerar.
        if (feeds === 'shipping' || feeds === 'payments') {
            const live = liveBulletsFor(feeds) || [];
            const isEmpty = live.length === 0;
            const emptyLabel = feeds === 'shipping'
                ? '⚠ Sin envíos configurados'
                : '⚠ Sin métodos configurados';
            const emptyHint = feeds === 'shipping'
                ? 'Configura en pestaña Envíos'
                : 'Configura en Mi Qhatu → Tiendas → Configurar';
            // Si live está vacío PERO el seed trae bullets, usamos los del
            // seed (mejor que mostrar warning si el seed sí tenía data).
            const fromBullets = isEmpty && seedBullets && seedBullets.length > 0
                ? buildBulletsBody(seedBullets)
                : null;
            const body = fromBullets
                ? fromBullets
                : (isEmpty ? `${emptyLabel}\n${emptyHint}` : buildBulletsBody(live));
            return {
                title: compose(baseHeader, body),
                options: live.length > 0 ? live : (seedBullets || []),
                isEmpty: isEmpty && !fromBullets,
                feeds
            };
        }

        // Caso 2: nodo sin feeds live pero con bullets del seed (productos,
        // datos cliente, bienvenida). Usamos los bullets directamente.
        if (seedBullets && seedBullets.length > 0) {
            const body = buildBulletsBody(seedBullets);
            return {
                title: body ? compose(baseHeader, body) : baseHeader,
                options: seedBullets,
                isEmpty: false,
                feeds: ''
            };
        }

        return null;
    }

    // Re-aplica los títulos dinámicos sobre los nodos cytoscape sin recrearlos
    // — usado tras refrescar live config (ej. al volver del tab Envíos).
    function updateFeedsNodes() {
        if (!state.cy) return;
        state.nodes.forEach(n => {
            const r = computeFeedsRender(n);
            if (!r) return;
            const el = state.cy.getElementById(n.id);
            if (!el || !el.length) return;
            el.data('title', substitutePlaceholders(r.title));
            el.data('feedsEmpty', r.isEmpty ? 1 : 0);
            el.data('feedsKind', r.feeds);
            el.data('hasBullets', (r.options && r.options.length > 0) ? 1 : 0);
        });
    }

    /** Recarga nombre tienda + re-aplica {nombre_negocio} en títulos sin re-fetch del workflow completo. */
    async function refreshLivePlaceholdersOnly() {
        if (!state.cy) return;
        await loadLiveConfig();
        try { alignWorkflowToLiveConfig(); } catch (_) {}
        state.nodes.forEach(n => {
            const el = state.cy.getElementById(n.id);
            if (!el || !el.length) return;
            const feedsRender = computeFeedsRender(n);
            const rawTitle = feedsRender ? feedsRender.title : (n.title || '');
            el.data('title', substitutePlaceholders(rawTitle));
            if (feedsRender) {
                el.data('feedsEmpty', feedsRender.isEmpty ? 1 : 0);
                el.data('feedsKind', feedsRender.feeds);
                el.data('hasBullets', (feedsRender.options && feedsRender.options.length > 0) ? 1 : 0);
            }
        });
        try { state.cy.style().update(); } catch (_) {}
    }

    window.kipuRefreshMindmapLive = async function (botId) {
        const bid = botId || state.botId;
        if (!state.cy || String(window._kipuMindmapMountedFor || '') !== String(bid || '')) return;
        await refreshLivePlaceholdersOnly();
    };

    // ─── Curvas cúbicas SVG estilo n8n ───────────────────────────────
    // Cytoscape solo soporta Bézier cuadráticos (se ven rígidos). Dibujamos
    // encima una capa SVG con cúbicas reales: salida/entrada tangente al puerto.

    let _n8nEdgeRedrawRaf = null;

    function ensureN8nEdgeSvgLayer() {
        const container = document.getElementById('kipu-cy-container');
        if (!container) return null;
        let svg = document.getElementById('kipu-n8n-edge-svg');
        if (!svg) {
            svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('id', 'kipu-n8n-edge-svg');
            svg.setAttribute('class', 'kipu-n8n-edge-svg');
            svg.setAttribute('aria-hidden', 'true');
            svg.innerHTML = `
                <defs>
                    <marker id="kipu-n8n-arrow" viewBox="0 0 10 10" refX="9" refY="5"
                        markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                        <path d="M 1 1 L 9 5 L 1 9 Z" fill="context-stroke"/>
                    </marker>
                </defs>
                <g id="kipu-n8n-edge-paths"></g>`;
            container.appendChild(svg);
        }
        return svg;
    }

    function renderedNodePort(cyNode, side) {
        const bb = cyNode.renderedBoundingBox({ includeLabels: false, includeOverlays: false });
        const cx = (bb.x1 + bb.x2) / 2;
        const cy = (bb.y1 + bb.y2) / 2;
        switch (side) {
            case 'right': return { x: bb.x2, y: cy };
            case 'left': return { x: bb.x1, y: cy };
            case 'bottom': return { x: cx, y: bb.y2 };
            case 'top': return { x: cx, y: bb.y1 };
            default: return { x: cx, y: cy };
        }
    }

    function pickN8nPortSides(srcNode, tgtNode) {
        const sp = srcNode.renderedPosition();
        const tp = tgtNode.renderedPosition();
        const dx = tp.x - sp.x;
        const dy = tp.y - sp.y;
        const adx = Math.abs(dx);
        const ady = Math.abs(dy);
        if (adx >= ady * 0.45) {
            return dx >= 0
                ? { source: 'right', target: 'left' }
                : { source: 'left', target: 'right' };
        }
        return dy >= 0
            ? { source: 'bottom', target: 'top' }
            : { source: 'top', target: 'bottom' };
    }

    function n8nControlOffset(sx, sy, tx, ty, srcSide, tgtSide) {
        const dx = Math.abs(tx - sx);
        const dy = Math.abs(ty - sy);
        const horiz = (srcSide === 'right' || srcSide === 'left') &&
            (tgtSide === 'right' || tgtSide === 'left');
        if (horiz) {
            return Math.min(Math.max(dx * 0.5, 56), 240);
        }
        return Math.min(Math.max(dy * 0.5, 48), 200);
    }

    function buildN8nCubicPath(sx, sy, tx, ty, srcSide, tgtSide, opts) {
        let off = n8nControlOffset(sx, sy, tx, ty, srcSide, tgtSide);
        if (opts && opts.backEdge) off = Math.min(off * 1.4, 280);
        let cp1x, cp1y, cp2x, cp2y;

        if (srcSide === 'right' && tgtSide === 'left') {
            if (Math.abs(sy - ty) < 2.5 && tx > sx) return `M ${sx} ${sy} L ${tx} ${ty}`;
            cp1x = sx + off; cp1y = sy;
            cp2x = tx - off; cp2y = ty;
        } else if (srcSide === 'left' && tgtSide === 'right') {
            if (Math.abs(sy - ty) < 2.5 && tx < sx) return `M ${sx} ${sy} L ${tx} ${ty}`;
            cp1x = sx - off; cp1y = sy;
            cp2x = tx + off; cp2y = ty;
        } else if (srcSide === 'bottom' && tgtSide === 'top') {
            if (Math.abs(sx - tx) < 2.5 && ty > sy) return `M ${sx} ${sy} L ${tx} ${ty}`;
            cp1x = sx; cp1y = sy + off;
            cp2x = tx; cp2y = ty - off;
        } else if (srcSide === 'top' && tgtSide === 'bottom') {
            if (Math.abs(sx - tx) < 2.5 && ty < sy) return `M ${sx} ${sy} L ${tx} ${ty}`;
            cp1x = sx; cp1y = sy - off;
            cp2x = tx; cp2y = ty + off;
        } else {
            cp1x = sx + (tx - sx) * 0.35; cp1y = sy;
            cp2x = sx + (tx - sx) * 0.65; cp2y = ty;
        }
        return `M ${sx} ${sy} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${tx} ${ty}`;
    }

    function n8nEdgeStrokeStyle(edge) {
        const hovered = edge.hasClass('hovered');
        const selected = edge.selected();
        const negative = edge.data('negative') === 1;
        const dependency = edge.data('dependency') === 1;
        let stroke = negative ? '#C75A5A' : 'rgba(0, 0, 82, 0.68)';
        if (dependency) stroke = '#B8A88A';
        if (hovered || selected) stroke = negative ? '#A84545' : '#000052';
        const width = hovered || selected ? 3.25 : 2.25;
        const dash = dependency ? '7 5' : '';
        return { stroke, width, dash };
    }

    function redrawN8nEdgeSvg() {
        if (!state.cy) return;
        const svg = ensureN8nEdgeSvgLayer();
        if (!svg) return;
        const g = svg.querySelector('#kipu-n8n-edge-paths');
        if (!g) return;

        const w = state.cy.width();
        const h = state.cy.height();
        svg.setAttribute('width', String(w));
        svg.setAttribute('height', String(h));
        svg.setAttribute('viewBox', `0 0 ${w} ${h}`);

        const frag = document.createDocumentFragment();
        state.cy.edges().forEach(edge => {
            if (!edge.data('edgeId')) return;
            const src = edge.source();
            const tgt = edge.target();
            if (src.empty() || tgt.empty()) return;
            if (src.data('kind') !== 'node' || tgt.data('kind') !== 'node') return;

            const sides = pickN8nPortSides(src, tgt);
            const p0 = renderedNodePort(src, sides.source);
            const p1 = renderedNodePort(tgt, sides.target);
            const d = buildN8nCubicPath(p0.x, p0.y, p1.x, p1.y, sides.source, sides.target, {
                backEdge: edge.data('backEdge') === 1
            });
            const { stroke, width, dash } = n8nEdgeStrokeStyle(edge);
            const bidir = edge.data('bidir') === 1;

            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', d);
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke', stroke);
            path.setAttribute('stroke-width', String(width));
            path.setAttribute('stroke-linecap', 'round');
            path.setAttribute('stroke-linejoin', 'round');
            path.setAttribute('marker-end', 'url(#kipu-n8n-arrow)');
            if (bidir) path.setAttribute('marker-start', 'url(#kipu-n8n-arrow)');
            if (dash) path.setAttribute('stroke-dasharray', dash);
            frag.appendChild(path);
        });
        g.replaceChildren(frag);
    }

    function scheduleN8nEdgeRedraw() {
        if (_n8nEdgeRedrawRaf) return;
        _n8nEdgeRedrawRaf = requestAnimationFrame(() => {
            _n8nEdgeRedrawRaf = null;
            try { redrawN8nEdgeSvg(); } catch (e) { console.warn('[mindmap] n8n edge redraw:', e); }
        });
    }

    function bindN8nEdgeSvgRedraw() {
        if (!state.cy) return;
        const cy = state.cy;
        ['render', 'pan', 'zoom', 'drag', 'add', 'remove', 'layoutstop'].forEach(ev => {
            cy.on(ev, scheduleN8nEdgeRedraw);
        });
        cy.on('mouseover mouseout', 'edge', scheduleN8nEdgeRedraw);
        cy.on('select unselect', 'edge', scheduleN8nEdgeRedraw);
        scheduleN8nEdgeRedraw();
    }

    function destroyN8nEdgeSvgLayer() {
        const svg = document.getElementById('kipu-n8n-edge-svg');
        if (svg) svg.remove();
    }

    // Build Cytoscape elements from current state.nodes / state.edges
    function buildCyElements() {
        // Vertical swimlane layout — cada fase recibe un compound parent que
        // se renderiza como un grupo etiquetado (BIENVENIDA, PRODUCTOS, etc.).
        // Los nodos individuales declaran data.parent = "__phase_<fase>" y
        // cytoscape los envuelve automáticamente, ajustando el tamaño del
        // parent al bounding box de los hijos.
        const phasesPresent = new Set();
        state.nodes.forEach(n => {
            const p = n?.metadata?.phase;
            if (p && PHASE_INFO[p]) phasesPresent.add(p);
        });
        const parentEls = PHASE_ORDER
            .filter(p => phasesPresent.has(p))
            .map(p => ({
                group: 'nodes',
                data: {
                    id: PHASE_PARENT_ID(p),
                    kind: 'phase',
                    phase: p,
                    label: PHASE_INFO[p].label
                },
                // Grupos arrastrables — al mover el parent, cytoscape mueve
                // automáticamente todos los hijos manteniendo posiciones
                // relativas dentro del swimlane.
                selectable: true,
                grabbable: true
            }));

        const nodeEls = state.nodes.map(n => {
            const feedsRender = computeFeedsRender(n);
            const feedsFrom = (n.metadata && n.metadata.feeds_from) || '';
            const phase = n?.metadata?.phase;
            const parentId = (phase && PHASE_INFO[phase]) ? PHASE_PARENT_ID(phase) : undefined;
            const hasBullets = !!(feedsRender && feedsRender.options && feedsRender.options.length > 0);
            const rawTitle = feedsRender ? feedsRender.title : (n.title || '');
            const data = {
                id: n.id,
                kind: 'node',
                title: substitutePlaceholders(rawTitle),
                subtitle: nodeSubtitle(n),
                type: n.node_type || 'step',
                feeds: feedsFrom,
                feedsEmpty: feedsRender && feedsRender.isEmpty ? 1 : 0,
                feedsKind: feedsRender ? feedsRender.feeds : '',
                hasBullets: hasBullets ? 1 : 0,
                pending: n.status === 'pending_confirmation' ? 1 : 0
            };
            if (parentId) data.parent = parentId;
            return {
                group: 'nodes',
                data,
                position: {
                    x: Number(n.position_x) || 0,
                    y: Number(n.position_y) || 0
                },
                grabbable: true,
                selectable: true
            };
        });

        const nodeTypeMap = new Map(state.nodes.map(n => [n.id, n.node_type || 'step']));

        // ── Compute row-in-phase para cada nodo (para routing inteligente) ─
        // Usado por la heurística de "routeBelow": cuando un edge inter-fase
        // sale del fondo de una columna y entra al tope de la siguiente, lo
        // ruteamos por DEBAJO de las fases en lugar de por encima — así los
        // edges no se acumulan en el corredor superior.
        const nodeRowInPhase = new Map();
        const phaseGroups = new Map();
        state.nodes.forEach(n => {
            const p = n?.metadata?.phase || 'sin_fase';
            if (!phaseGroups.has(p)) phaseGroups.set(p, []);
            phaseGroups.get(p).push(n);
        });
        phaseGroups.forEach(list => {
            list.sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
            list.forEach((n, i) => nodeRowInPhase.set(n.id, i));
        });
        const phaseOf = (nodeId) => {
            const n = state.nodes.find(x => x.id === nodeId);
            return n?.metadata?.phase || null;
        };

        // Detección de edges bidireccionales (A→B + B→A en el mismo workflow).
        // Colapsamos el par en UN solo edge marcado como bidir; el stylesheet
        // le pone flecha en ambos extremos para que se vea como `<──>`.
        // Mantenemos la versión canónica (el primero por id ordenado) y
        // descartamos el reverso para que cytoscape no dibuje dos líneas.
        const edgeByDir = new Map(); // "fromId>toId" → edge
        state.edges.forEach(e => {
            edgeByDir.set(`${e.from_node_id}>${e.to_node_id}`, e);
        });
        const bidirSet = new Set();           // edges que conservamos como bidir
        const skipEdgeIds = new Set();        // edges a omitir (reverso de bidir)
        state.edges.forEach(e => {
            const key = `${e.from_node_id}>${e.to_node_id}`;
            const reverseKey = `${e.to_node_id}>${e.from_node_id}`;
            const reverse = edgeByDir.get(reverseKey);
            if (!reverse) return;
            // Cada par se procesa una sola vez — usamos comparación canónica
            // por id ascendente para decidir cuál de los dos sobrevive.
            if (skipEdgeIds.has(e.id) || bidirSet.has(e.id)) return;
            const canonicalEdge = String(e.id) < String(reverse.id) ? e : reverse;
            const dropEdge      = canonicalEdge === e ? reverse : e;
            bidirSet.add(canonicalEdge.id);
            skipEdgeIds.add(dropEdge.id);
        });

        // Índice de fase para clasificar edges (forward / backward / lateral).
        // En el layout vertical-swimlane, las fases avanzan de izquierda a
        // derecha en el orden de PHASE_ORDER. Un edge es "backward" cuando
        // su target está en una columna anterior a la source — ésos los
        // curvamos por afuera (bezier) para no cruzar el cuerpo del flujo.
        const phaseIndex = new Map();
        PHASE_ORDER.forEach((p, i) => phaseIndex.set(p, i));

        const edgeEls = state.edges
            .filter(e => !skipEdgeIds.has(e.id))
            .map(e => {
                const srcType = nodeTypeMap.get(e.from_node_id) || 'step';
                const isDependency = srcType === 'config_requirement';
                const srcPhase = phaseOf(e.from_node_id);
                const tgtPhase = phaseOf(e.to_node_id);
                const srcPi = phaseIndex.has(srcPhase) ? phaseIndex.get(srcPhase) : -1;
                const tgtPi = phaseIndex.has(tgtPhase) ? phaseIndex.get(tgtPhase) : -1;
                const isBackEdge = (srcPi >= 0 && tgtPi >= 0 && tgtPi < srcPi) ? 1 : 0;
                const isLongFwd  = (srcPi >= 0 && tgtPi >= 0 && tgtPi - srcPi > 1) ? 1 : 0;
                const isBidir = bidirSet.has(e.id) ? 1 : 0;
                return {
                    group: 'edges',
                    data: {
                        id: 'e_' + e.id,
                        source: e.from_node_id,
                        target: e.to_node_id,
                        label: e.label || '',
                        edgeId: e.id,
                        dependency: isDependency ? 1 : 0,
                        sourceType: srcType,
                        negative: isNegativeLabel(e.label) ? 1 : 0,
                        backEdge: isBackEdge,
                        longFwd: isLongFwd,
                        bidir: isBidir
                    }
                };
            });

        // Compound parents primero para que los hijos los referencien correctamente
        return [...parentEls, ...nodeEls, ...edgeEls];
    }

    // Detecta si una rama es "negativa" (No, error, fallback, reintentar) →
    // se pinta de rojo suave en el editor. Tolera variaciones: "No", "no",
    // "No — reintentar", "Error: timeout", etc.
    function isNegativeLabel(label) {
        if (!label) return false;
        const l = String(label).trim().toLowerCase();
        if (!l) return false;
        // Match exactos o prefijos comunes en español
        if (/^(no|error|fallback|fail|falla|rechaz|reintent)/.test(l)) return true;
        // "No — reintentar", "no, error", "no - retry"
        if (/^no[\s\-—,:]/.test(l)) return true;
        return false;
    }

    function nodeSubtitle(n) {
        const feeds = n.metadata && n.metadata.feeds_from;
        if (feeds) return ({ products: 'Catálogo', shipping: 'Envíos', payments: 'Pagos' })[feeds] || '';
        return ({
            start_end: 'Inicio / Fin',
            step: 'Proceso',
            process: 'Proceso',
            condition: 'Decisión',
            decision: 'Decisión',
            handoff: 'Handoff',
            config_requirement: 'Requisito',
            action: 'Acción',
            note: 'Nota'
        })[n.node_type] || 'Paso';
    }

    // ─── Stylesheet — FigJam pastel palette ─────────────────────
    //   Cada tipo de nodo: forma + color pastel distintos, bordes 2px,
    //   tipografía Inter 14px, sombra sutil. Conectores bezier curvos
    //   con flecha pequeña; labels en pill blanca con borde del color del
    //   nodo origen; ramas "negativas" en rojo suave.
    function cytoscapeStylesheet() {
        // Paleta FigJam por tipo (background + border + text)
        const C = {
            // Inicio / Fin — lavanda
            startEndBg:    '#E8E2F5',  startEndBorder: '#8B7BB8',  startEndText: '#4A3B7A',
            // Proceso / Mensaje — azul suave
            stepBg:        '#DDE7F5',  stepBorder:     '#4A6FA5',  stepText:     '#1F3A6B',
            // Decisión — ámbar suave
            decisionBg:    '#FCEBC4',  decisionBorder: '#C99629',  decisionText: '#6B4A0F',
            // Handoff — naranja suave
            handoffBg:     '#FBE0D2',  handoffBorder:  '#E5683C',  handoffText:  '#8A3818',
            // Requisito de config — cream-soft con borde dashed
            configBg:      '#F5EDDC',  configBorder:   '#B8A88A',  configText:   '#6B5C3F',
            // Edge defaults
            edgeDefault:   'rgba(0, 0, 82, 0.70)',   // navy 70% (línea)
            edgeArrow:     '#000052',                 // navy 100% (cabeza de flecha — más oscuro destaca dirección)
            edgeHover:     '#000052',                // navy 100%
            edgeNegative:  '#C75A5A',                // rojo suave
            // Selected halo + label background
            white:         '#FFFFFF',
            navyShadow:    '#000052'
        };
        const FONT = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
        // ── Reglas por fase (swimlane parents) ─────────────────────────
        // Cada compound parent recibe el bg/border/text-color de su fase
        // según PHASE_INFO. Construimos un array de reglas, una por fase.
        const phaseStyles = PHASE_ORDER.map(p => ({
            selector: `node[kind = "phase"][phase = "${p}"]`,
            style: {
                'background-color': PHASE_INFO[p].bg,
                'background-opacity': 0.45,
                'border-color': PHASE_INFO[p].border,
                'color': PHASE_INFO[p].text
            }
        }));
        return [
            // ── Compound parent — swimlane por fase ─────────────────────
            // Background tintado según fase, label arriba en mayúsculas,
            // borde solid 2px del color de la fase. El padding interno deja
            // espacio para los nodos hijos. z-index bajo para que no tape
            // los nodos.
            {
                selector: 'node[kind = "phase"]',
                style: {
                    'shape': 'round-rectangle',
                    'corner-radius': '14px',
                    'background-opacity': 0.40,
                    'border-width': 2,
                    'border-style': 'solid',
                    'label': 'data(label)',
                    'font-family': FONT,
                    'font-size': 12,
                    'font-weight': 700,
                    'letter-spacing': 1,
                    'text-valign': 'top',
                    'text-halign': 'center',
                    'text-margin-y': -8,
                    'padding-top': '34px',
                    'padding-bottom': '20px',
                    'padding-left': '20px',
                    'padding-right': '20px',
                    'z-index': 0
                    // 'events': 'no' removido — sin eso el grupo es arrastrable.
                }
            },
            // Hover sobre un grupo: refuerza borde + sube opacidad del fondo
            // para indicar "este grupo es interactivo, puedes arrastrarlo".
            {
                selector: 'node[kind = "phase"]:active',
                style: {
                    'overlay-color': '#000052',
                    'overlay-opacity': 0.06,
                    'overlay-padding': 4
                }
            },
            ...phaseStyles,
            // ── Default node — Proceso / Mensaje (azul suave) ───────────────
            {
                selector: 'node[kind = "node"]',
                style: {
                    'shape': 'round-rectangle',
                    'corner-radius': '10px',
                    'width': 180,
                    'height': 64,
                    'background-color': C.stepBg,
                    'background-opacity': 1,
                    'border-width': 1.5,
                    'border-color': C.stepBorder,
                    'label': 'data(title)',
                    'color': C.stepText,
                    'font-family': FONT,
                    'font-size': 11.5,
                    'font-weight': 500,
                    'line-height': 1.25,
                    'text-valign': 'center',
                    'text-halign': 'center',
                    'text-wrap': 'wrap',
                    'text-max-width': '160px',
                    'padding': '8px',
                    'underlay-color': C.navyShadow,
                    'underlay-padding': 3,
                    'underlay-opacity': 0.04,
                    'transition-property': 'border-width, border-color, background-color',
                    'transition-duration': 200
                }
            },
            // ── Nodo con bullets — más ancho, altura auto ─────────────
            // Cuando el nodo lista opciones (productos, envío, datos, pago),
            // dejamos que cytoscape calcule la altura según el contenido del
            // label. text-max-width más amplio para que cada bullet quepa
            // en una sola línea. Padding generoso vertical para separar el
            // título del primer bullet visualmente.
            {
                selector: 'node[kind = "node"][hasBullets = 1]',
                style: {
                    'width': 280,
                    'height': 'label',
                    'min-height': 100,
                    'text-valign': 'center',
                    'text-halign': 'center',
                    'text-max-width': '256px',
                    'text-wrap': 'wrap',
                    'font-size': 10,
                    'line-height': 1.45,
                    'padding-top': '16px',
                    'padding-bottom': '16px',
                    'padding-left': '14px',
                    'padding-right': '14px'
                }
            },
            // ── Inicio / Fin — pill lavanda ─────────────────────────────────
            {
                selector: 'node[type = "start_end"]',
                style: {
                    'shape': 'round-rectangle',
                    'corner-radius': '999px',
                    'background-color': C.startEndBg,
                    'border-color': C.startEndBorder,
                    'border-width': 1.5,
                    'width': 180,
                    'height': 56,
                    'color': C.startEndText,
                    'font-weight': 600,
                    'font-size': 11.5,
                    'text-max-width': '160px'
                }
            },
            // ── Decisión — diamante ámbar ───────────────────────────────────
            {
                selector: 'node[type = "condition"], node[type = "decision"]',
                style: {
                    'shape': 'diamond',
                    'width': 160,
                    'height': 130,
                    'background-color': C.decisionBg,
                    'border-color': C.decisionBorder,
                    'border-width': 1.5,
                    'color': C.decisionText,
                    'font-weight': 600,
                    'font-size': 11.5,
                    'text-max-width': '110px',
                    'line-height': 1.25
                }
            },
            // ── Handoff — naranja con tab izquierdo más grueso (overlay) ────
            {
                selector: 'node[type = "handoff"]',
                style: {
                    'shape': 'round-rectangle',
                    'corner-radius': '10px',
                    'width': 190,
                    'height': 64,
                    'background-color': C.handoffBg,
                    'border-color': C.handoffBorder,
                    'border-width': 1.5,
                    'color': C.handoffText,
                    'font-weight': 600,
                    'font-size': 11.5
                }
            },
            // ── Requisito de config — cream-soft con borde dashed ───────────
            {
                selector: 'node[type = "config_requirement"]',
                style: {
                    'shape': 'round-rectangle',
                    'corner-radius': '10px',
                    'width': 180,
                    'height': 64,
                    'background-color': C.configBg,
                    'border-color': C.configBorder,
                    'border-width': 1.5,
                    'border-style': 'dashed',
                    'color': C.configText,
                    'font-style': 'italic',
                    'font-weight': 500,
                    'font-size': 11.5
                }
            },
            // ── Legacy 'action' → mismo styling que step ─────────────────────
            {
                selector: 'node[type = "action"]',
                style: {
                    'background-color': C.stepBg,
                    'border-color': C.stepBorder,
                    'border-width': 2,
                    'color': C.stepText
                }
            },
            // ── Legacy 'note' → mismo styling que config_requirement ────────
            {
                selector: 'node[type = "note"]',
                style: {
                    'background-color': C.configBg,
                    'border-color': C.configBorder,
                    'border-style': 'dashed',
                    'color': C.configText,
                    'font-style': 'italic'
                }
            },
            // ── Pending (aprendido por el bot) — opacidad ligeramente menor ─
            {
                selector: 'node[pending = 1]',
                style: {
                    'opacity': 0.85
                }
            },
            // ── Feeds-from (shipping / payments) — altura mayor para acomodar
            //    el header + lista de opciones (multi-línea con \n). Se aplican
            //    a TODOS los step-nodes con feedsKind seteado, sin importar
            //    el conteo (>0 ó vacío). text-valign top para que el header
            //    quede arriba y la lista debajo.
            {
                selector: 'node[feedsKind = "shipping"], node[feedsKind = "payments"]',
                style: {
                    'height': 64,
                    'width': 150,
                    'text-valign': 'center',
                    'text-halign': 'center',
                    'text-max-width': '130px',
                    'line-height': 1.25,
                    'font-size': 10
                }
            },
            // ── Estado VACÍO — texto warning (naranja) + borde dashed marca ──
            //    Aplica solo cuando no hay opciones configuradas. Mantiene el
            //    azul step de fondo pero pinta el texto en orange brand para
            //    señalizar que falta config sin agredir visualmente.
            {
                selector: 'node[feedsEmpty = 1]',
                style: {
                    'color': '#8A3818',
                    'border-color': '#E5683C',
                    'border-style': 'dashed',
                    'border-width': 2
                }
            },
            // ── Validación: nodo inválido ───────────────────────────────────
            {
                selector: 'node.invalid',
                style: {
                    'border-color': '#C75A5A',
                    'border-width': 3,
                    'overlay-color': '#C75A5A',
                    'overlay-opacity': 0.10,
                    'overlay-padding': 4
                }
            },
            // ── Hover (clase añadida por listener) — sombra más marcada + scale ─
            {
                selector: 'node.hovered',
                style: {
                    'underlay-padding': 8,
                    'underlay-opacity': 0.10
                }
            },
            // ── Selected — outline 3px del color del tipo al 25% de opacidad ────
            // Cytoscape no expone color-por-tipo en :selected sin duplicar reglas;
            // usamos overlay sutil (navy 8%) + border más grueso para feedback genérico.
            {
                selector: 'node:selected',
                style: {
                    'border-width': 3,
                    'overlay-color': C.navyShadow,
                    'overlay-opacity': 0.10,
                    'overlay-padding': 6
                }
            },
            // Selected per-type → outline tinted al 25% del color del borde
            { selector: 'node[type = "start_end"]:selected', style: { 'overlay-color': C.startEndBorder, 'overlay-opacity': 0.25 } },
            { selector: 'node[type = "step"]:selected, node[type = "process"]:selected, node[type = "action"]:selected', style: { 'overlay-color': C.stepBorder, 'overlay-opacity': 0.25 } },
            { selector: 'node[type = "condition"]:selected, node[type = "decision"]:selected', style: { 'overlay-color': C.decisionBorder, 'overlay-opacity': 0.25 } },
            { selector: 'node[type = "handoff"]:selected', style: { 'overlay-color': C.handoffBorder, 'overlay-opacity': 0.25 } },
            { selector: 'node[type = "config_requirement"]:selected, node[type = "note"]:selected', style: { 'overlay-color': C.configBorder, 'overlay-opacity': 0.25 } },

            // ── Edges — hit area invisible; dibujo visible en capa SVG n8n ─
            {
                selector: 'edge',
                style: {
                    'curve-style': 'bezier',
                    'control-point-step-size': 40,
                    'line-opacity': 0,
                    'target-arrow-opacity': 0,
                    'source-arrow-opacity': 0,
                    'width': 14,
                    'z-index': 50,
                    'label': 'data(label)',
                    'font-size': 11,
                    'font-weight': 600,
                    'font-family': FONT,
                    'color': '#1F2A44',
                    'text-background-color': C.white,
                    'text-background-opacity': 1,
                    'text-background-padding': 5,
                    'text-background-shape': 'round-rectangle',
                    'text-border-color': C.stepBorder,
                    'text-border-width': 1,
                    'text-border-opacity': 1,
                    'text-rotation': 'none',
                    'text-margin-y': 0,
                    'edge-distances': 'intersection',
                    'transition-property': 'line-color, width',
                    'transition-duration': 200
                }
            },
            // Back / longFwd / bidir — metadata para labels; trazo en SVG
            {
                selector: 'edge[backEdge = 1]',
                style: { 'opacity': 1 }
            },
            {
                selector: 'edge[longFwd = 1]',
                style: { 'opacity': 1 }
            },
            {
                selector: 'edge[bidir = 1]',
                style: { 'opacity': 1 }
            },
            { selector: 'edge[sourceType = "start_end"]',                                style: { 'text-border-color': C.startEndBorder } },
            { selector: 'edge[sourceType = "step"], edge[sourceType = "process"], edge[sourceType = "action"]', style: { 'text-border-color': C.stepBorder } },
            { selector: 'edge[sourceType = "condition"], edge[sourceType = "decision"]', style: { 'text-border-color': C.decisionBorder } },
            { selector: 'edge[sourceType = "handoff"]',                                  style: { 'text-border-color': C.handoffBorder } },
            { selector: 'edge[sourceType = "config_requirement"], edge[sourceType = "note"]', style: { 'text-border-color': C.configBorder } },
            // Rama "negativa" (No, error, fallback, reintentar) → rojo suave
            {
                selector: 'edge[negative = 1]',
                style: {
                    'line-color': C.edgeNegative,
                    'target-arrow-color': C.edgeNegative,
                    'text-border-color': C.edgeNegative,
                    'color': C.edgeNegative
                }
            },
            // Hover en conector → 3.5px + navy 100% en línea Y arrow
            {
                selector: 'edge.hovered',
                style: {
                    'width': 3.5,
                    'line-color': C.edgeHover,
                    'target-arrow-color': C.edgeHover
                }
            },
            // Hover en conector negativo → 3.5px + rojo más oscuro
            {
                selector: 'edge.hovered[negative = 1]',
                style: {
                    'width': 3.5,
                    'line-color': '#A84545',
                    'target-arrow-color': '#A84545'
                }
            },
            // Selected edge — navy 100% + 3.5px + halo overlay sutil
            {
                selector: 'edge:selected',
                style: {
                    'line-color': C.edgeHover,
                    'target-arrow-color': C.edgeHover,
                    'width': 3.5,
                    'overlay-color': C.edgeHover,
                    'overlay-opacity': 0.10,
                    'overlay-padding': 4
                }
            },
            // Dependency edges — dashed gris suave
            {
                selector: 'edge[dependency = 1]',
                style: {
                    'line-style': 'dashed',
                    'line-color': C.configBorder,
                    'target-arrow-color': C.configBorder
                }
            },
            // Edge inválido (validación) — rojo suave
            {
                selector: 'edge.invalid',
                style: {
                    'line-color': C.edgeNegative,
                    'target-arrow-color': C.edgeNegative
                }
            },
            // ── Edge-handles plugin — handle pequeño en color del tipo ──────
            {
                selector: '.eh-handle',
                style: {
                    'background-color': C.stepBorder,
                    'width': 10,
                    'height': 10,
                    'shape': 'ellipse',
                    'overlay-opacity': 0,
                    'border-width': 2,
                    'border-color': C.white
                }
            },
            { selector: '.eh-hover',  style: { 'background-color': C.edgeHover } },
            { selector: '.eh-source', style: { 'border-width': 3, 'border-color': C.stepBorder } },
            { selector: '.eh-target', style: { 'border-width': 3, 'border-color': C.handoffBorder } },
            {
                selector: '.eh-preview, .eh-ghost-edge',
                style: {
                    'curve-style': 'bezier',
                    'control-point-step-size': 80,
                    'edge-distances': 'intersection',
                    'line-opacity': 0.85,
                    'line-cap': 'round',
                    'line-color': C.edgeHover,
                    'target-arrow-color': C.edgeHover,
                    'target-arrow-opacity': 1,
                    'line-style': 'dashed',
                    'width': 2.5
                }
            },
            // Search match highlight
            {
                selector: 'node.search-match',
                style: {
                    'border-color': '#E5683C',
                    'border-width': 3,
                    'overlay-color': '#E5683C',
                    'overlay-opacity': 0.18,
                    'overlay-padding': 6
                }
            },
            {
                selector: 'node.search-dim',
                style: { 'opacity': 0.25 }
            }
        ];
    }

    // ─── PHASE swimlane info ────────────────────────────────────────────
    // Cada fase es una columna vertical (swimlane) con su propio color.
    // El orden de PHASE_ORDER define la posición horizontal: bienvenida a
    // la izquierda, cierre a la derecha. Cada fase recibe un compound parent
    // (ver buildCyElements) para que se vea como un grupo etiquetado.
    const PHASE_ORDER = ['bienvenida', 'productos', 'envio', 'datos', 'pago', 'cierre'];
    const PHASE_INFO = {
        bienvenida: { label: 'BIENVENIDA',     bg: '#E8E2F5', border: '#8B7BB8', text: '#4A3B7A' },
        productos:  { label: 'PRODUCTOS',      bg: '#DDE7F5', border: '#4A6FA5', text: '#1F3A6B' },
        envio:      { label: 'ENVÍO',          bg: '#D4EDDA', border: '#62A269', text: '#1F5A2B' },
        datos:      { label: 'DATOS CLIENTE',  bg: '#FCEBC4', border: '#C99629', text: '#6B4A0F' },
        pago:       { label: 'PAGO',           bg: '#FBE0D2', border: '#E5683C', text: '#8A3818' },
        cierre:     { label: 'CIERRE',         bg: '#F5EDDC', border: '#B8A88A', text: '#6B5C3F' }
    };
    // ID del compound parent por fase. Lo usamos en el orden inverso también
    // (id → phase) cuando necesitamos asignar parent en buildCyElements.
    const PHASE_PARENT_ID = (phase) => `__phase_${phase}`;

    // Geometría del swimlane vertical. Cada fase es una columna; los nodos
    // de cada fase se apilan verticalmente. Espaciado generoso para que las
    // curvas bezier tengan aire entre columnas y filas (estilo n8n).
    const NODE_W           = 180;
    const NODE_H           = 64;
    const NODE_W_BULLETS   = 260;   // ancho de nodos con bullets (debe coincidir con stylesheet)
    // Spacing aumentado (request usuario): el layout aterriza en pantallas
    // grandes ocupando el área disponible — antes quedaba comprimido a la
    // izquierda. Columnas más anchas + más separación horizontal + más espacio
    // vertical entre nodos dentro de la columna.
    const COL_WIDTH        = 320;   // ancho de columna (era 290)
    const COL_GAP          = 160;   // separación entre columnas (era 70)
    const ROW_GAP          = 80;    // separación vertical mínima entre nodos (era 46)
    const COL_START_X      = 140;   // (era 100) — más margen izquierdo
    const COL_START_Y      = 120;   // (era 100) — más margen superior para label de fase

    // Altura aproximada del nodo según sus bullets. Si no tiene bullets,
    // es el alto fijo del round-rectangle (NODE_H). Si tiene bullets, sumamos
    // espacio para el header + separador + cada bullet + padding. Generoso
    // a propósito: overshoot es mejor que solapamiento.
    function estimateNodeHeight(n) {
        const r = computeFeedsRender(n);
        if (!r || !r.options || r.options.length === 0) return NODE_H;
        const MAX_INLINE = 6;
        const inline = Math.min(r.options.length, MAX_INLINE);
        const extra  = r.options.length > MAX_INLINE ? 1 : 0;
        // Líneas: título (~2 wraps) + separador (1) + bullets + "+N más"
        const lines  = 3 + inline + extra;
        // Cada línea de bullets toma ~16-18px con el line-height 1.45 a 10px.
        return Math.max(120, 36 + lines * 17);
    }

    function isManualPosition(node) {
        return !!(node && node.metadata && node.metadata.position_manual === true);
    }

    // Topological sort de los nodos de una fase usando solo edges intra-fase.
    // Nodos sin predecesor en la fase van primero (level 0). Para nodos del
    // mismo level, usamos order_index como tie-break. Si hay ciclo (raro en
    // workflow legítimo), los nodos del ciclo van al final preservando su
    // order_index relativo. Devuelve una nueva lista ordenada.
    function topologicalSortPhase(list, allEdges) {
        if (!list || list.length <= 1) return list ? [...list] : [];
        const ids = new Set(list.map(n => n.id));
        const inDeg = new Map();
        const adj   = new Map();
        list.forEach(n => { inDeg.set(n.id, 0); adj.set(n.id, new Set()); });
        allEdges.forEach(e => {
            if (e.from_node_id === e.to_node_id) return;
            if (ids.has(e.from_node_id) && ids.has(e.to_node_id)) {
                if (!adj.get(e.from_node_id).has(e.to_node_id)) {
                    adj.get(e.from_node_id).add(e.to_node_id);
                    inDeg.set(e.to_node_id, inDeg.get(e.to_node_id) + 1);
                }
            }
        });
        // Kahn level-by-level. Cada nivel se ordena por order_index.
        const result = [];
        let frontier = list.filter(n => inDeg.get(n.id) === 0)
            .sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
        const visited = new Set();
        while (frontier.length) {
            frontier.forEach(n => { result.push(n); visited.add(n.id); });
            const next = [];
            frontier.forEach(n => {
                adj.get(n.id).forEach(targetId => {
                    inDeg.set(targetId, inDeg.get(targetId) - 1);
                    if (inDeg.get(targetId) === 0 && !visited.has(targetId)) {
                        const target = list.find(x => x.id === targetId);
                        if (target) next.push(target);
                    }
                });
            });
            next.sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
            frontier = next;
        }
        // Nodos del ciclo (no alcanzados) → al final
        list.forEach(n => { if (!visited.has(n.id)) result.push(n); });
        return result;
    }

    // Calcula la matriz "strict-before": para cada par (A, B) de nodos en
    // la misma fase, si existe un camino A → … → B usando solo edges
    // intra-fase, A debe ir estrictamente antes de B en el layout. El
    // barycenter NUNCA puede romper esta restricción. Devuelve un Map
    // id → Set(idsQueDebenIrDespués).
    function computeStrictBefore(list, allEdges) {
        const result = new Map();
        if (!list || list.length === 0) return result;
        const ids = new Set(list.map(n => n.id));
        const adj = new Map();
        list.forEach(n => { adj.set(n.id, new Set()); result.set(n.id, new Set()); });
        allEdges.forEach(e => {
            if (e.from_node_id === e.to_node_id) return;
            if (ids.has(e.from_node_id) && ids.has(e.to_node_id)) {
                adj.get(e.from_node_id).add(e.to_node_id);
            }
        });
        // BFS desde cada nodo para calcular alcanzables (transitive closure)
        list.forEach(start => {
            const reachable = result.get(start.id);
            const queue = [...adj.get(start.id)];
            while (queue.length) {
                const id = queue.shift();
                if (reachable.has(id)) continue;
                reachable.add(id);
                adj.get(id).forEach(next => { if (!reachable.has(next)) queue.push(next); });
            }
        });
        return result;
    }

    // ─── Vertical swimlane layout — minimiza cruces de flechas ─────────
    // Distribuye los nodos en columnas verticales por fase, ordenando los
    // nodos dentro de cada columna mediante el algoritmo Sugiyama (barycenter
    // sweep) para minimizar cruces de aristas. Iteramos forward/backward
    // sweeps porque cada pasada mejora respecto a la anterior; 4 sweeps
    // suelen converger para grafos pequeños como este.
    //
    // Nota: ya no respetamos metadata.position_manual — el layout es la
    // verdad cuando el usuario quiere ver el flujo claro. Cuando arrastra
    // un nodo, queda libre hasta el próximo render.
    //
    // Solo calcula posiciones en state.nodes; no toca cytoscape. Útil para
    // el primer mount, donde queremos las posiciones listas antes de crear
    // el grafo (sin parpadeo).
    function computeVerticalSwimlanePositions() {
        // 1. Agrupar nodos por fase (los sin fase van a "sin_fase" al final)
        const nodesByPhase = {};
        PHASE_ORDER.forEach(p => { nodesByPhase[p] = []; });
        const phaseList = [...PHASE_ORDER];
        state.nodes.forEach(n => {
            const p = (n.metadata && n.metadata.phase) || 'sin_fase';
            if (!nodesByPhase[p]) {
                nodesByPhase[p] = [];
                phaseList.push(p);
            }
            nodesByPhase[p].push(n);
        });

        // 2. Orden interno por TOPOLOGICAL SORT de los edges intra-fase.
        // Si A → B en la misma fase, A debe ir ARRIBA. Esto garantiza que
        // el flujo secuencial dentro de la fase (ej: show_payment_methods
        // → client_pays → verify_payment) se respete siempre. El barycenter
        // global puro fallaba aquí: movía show_payment_methods al final
        // porque no tenía edges a la fase siguiente, mientras client_pays
        // y verify_payment sí.
        //
        // Algoritmo: Kahn's topological sort. Nodos sin predecesor intra-fase
        // van primero. Para tie-breaks (nodos paralelos sin orden entre sí),
        // usamos order_index como criterio inicial — luego barycenter
        // refinará entre paralelos.
        phaseList.forEach(p => {
            nodesByPhase[p] = topologicalSortPhase(nodesByPhase[p], state.edges);
        });

        // 3. Refinamiento por barycenter SOLO entre nodos paralelos del
        // mismo nivel topológico. Esto preserva el orden interno (paso a
        // paso) y solo permite intercambios cuando dos nodos no tienen
        // relación de orden directa o transitiva. Iteramos forward/backward
        // varias pasadas para converger.
        const rowOf = new Map();
        const setRows = () => {
            phaseList.forEach(p => {
                nodesByPhase[p].forEach((n, i) => rowOf.set(n.id, i));
            });
        };
        setRows();

        // Pre-calculamos la matriz de "orden estricto" para cada fase: si
        // A debe ir antes de B (existe camino A→…→B vía edges intra-fase),
        // marcamos strictBefore[A][B] = true. Bary no puede romper esto.
        const strictBeforeByPhase = new Map();
        phaseList.forEach(p => {
            strictBeforeByPhase.set(p, computeStrictBefore(nodesByPhase[p], state.edges));
        });

        const computeBary = (n, fromPhase) => {
            const rows = [];
            state.edges.forEach(e => {
                if (e.from_node_id === n.id) {
                    const target = state.nodes.find(x => x.id === e.to_node_id);
                    const tp = (target?.metadata?.phase) || 'sin_fase';
                    if (tp === fromPhase) {
                        const r = rowOf.get(e.to_node_id);
                        if (r != null) rows.push(r);
                    }
                }
                if (e.to_node_id === n.id) {
                    const source = state.nodes.find(x => x.id === e.from_node_id);
                    const sp = (source?.metadata?.phase) || 'sin_fase';
                    if (sp === fromPhase) {
                        const r = rowOf.get(e.from_node_id);
                        if (r != null) rows.push(r);
                    }
                }
            });
            return rows.length ? rows.reduce((a, b) => a + b, 0) / rows.length : null;
        };

        const sortRespectingStrictOrder = (list, phase, fromPhase) => {
            const strict = strictBeforeByPhase.get(phase);
            list.forEach(n => {
                const b = computeBary(n, fromPhase);
                n._bary = b != null ? b : (n.order_index || 0);
            });
            // Bubble sort que solo intercambia si NO viola strict-before.
            // Ineficiente pero seguro y predecible para fases pequeñas.
            const n = list.length;
            for (let i = 0; i < n; i++) {
                for (let j = 0; j < n - i - 1; j++) {
                    const a = list[j], b = list[j + 1];
                    if (strict.get(a.id)?.has(b.id)) continue; // a debe ir antes de b
                    if (strict.get(b.id)?.has(a.id)) {
                        // b debe ir antes de a → swap si están al revés
                        list[j] = b; list[j + 1] = a;
                        continue;
                    }
                    // Sin orden estricto: usar barycenter
                    if (a._bary > b._bary) {
                        list[j] = b; list[j + 1] = a;
                    }
                }
            }
        };

        for (let sweep = 0; sweep < 3; sweep++) {
            for (let pi = 1; pi < phaseList.length; pi++) {
                const list = nodesByPhase[phaseList[pi]];
                if (!list || list.length <= 1) continue;
                sortRespectingStrictOrder(list, phaseList[pi], phaseList[pi - 1]);
                list.forEach((n, i) => rowOf.set(n.id, i));
            }
            for (let pi = phaseList.length - 2; pi >= 0; pi--) {
                const list = nodesByPhase[phaseList[pi]];
                if (!list || list.length <= 1) continue;
                sortRespectingStrictOrder(list, phaseList[pi], phaseList[pi + 1]);
                list.forEach((n, i) => rowOf.set(n.id, i));
            }
        }
        state.nodes.forEach(n => delete n._bary);

        // 4. Calcular posiciones absolutas (coordenadas modelo).
        // Cytoscape posiciona por CENTRO del nodo. Apilamos cada nodo a
        // partir del bottom del anterior + ROW_GAP, usando la altura
        // estimada (NODE_H normal o más si tiene bullets).
        let xCursor = COL_START_X;
        phaseList.forEach(p => {
            const list = nodesByPhase[p];
            if (!list || list.length === 0) return;
            const colCenterX = xCursor + COL_WIDTH / 2;
            let yCursor = COL_START_Y;
            list.forEach(n => {
                const h = estimateNodeHeight(n);
                const x = colCenterX;
                const y = yCursor + h / 2;
                n.position_x = x;
                n.position_y = y;
                yCursor = y + h / 2 + ROW_GAP;
                if (n.metadata && n.metadata.position_manual) {
                    delete n.metadata.position_manual;
                }
            });
            xCursor += COL_WIDTH + COL_GAP;
        });

        // 5. Post-proceso: ¿Pago confirmado? se desplaza al punto medio entre
        // las columnas PAGO y CIERRE. El rombo-decisión necesita espacio a la
        // izquierda (flecha "No" → loop de reintento) y a la derecha (flecha
        // "Sí" → CIERRE). Mantiene su Y natural del paso 4.
        const pagoIdx   = phaseList.indexOf('pago');
        const cierreIdx = phaseList.indexOf('cierre');
        if (pagoIdx !== -1 && cierreIdx !== -1) {
            const pagoColX   = COL_START_X + pagoIdx   * (COL_WIDTH + COL_GAP) + COL_WIDTH / 2;
            const cierreColX = COL_START_X + cierreIdx * (COL_WIDTH + COL_GAP) + COL_WIDTH / 2;
            const midX       = (pagoColX + cierreColX) / 2;
            const pagoNodes  = nodesByPhase['pago'] || [];
            const decPaid    = pagoNodes.find(n =>
                (n.metadata && n.metadata.seed_key === 'decision_paid') ||
                (n.title && n.title.includes('¿Pago confirmado?'))
            );
            if (decPaid) {
                decPaid.position_x = midX;
            }
        }
    }

    // Aplica el layout vertical-swimlane: calcula posiciones, las anima en
    // cytoscape, y persiste cada nodo. Si cytoscape aún no existe (primer
    // mount), solo calcula — el caller hará el render.
    function runVerticalSwimlaneLayout() {
        computeVerticalSwimlanePositions();
        if (!state.cy) return;
        state.nodes.forEach(n => {
            const cyNode = state.cy.getElementById(n.id);
            if (cyNode && cyNode.length) {
                cyNode.animate(
                    { position: { x: n.position_x, y: n.position_y } },
                    { duration: 380, easing: 'ease-in-out-cubic' }
                );
            }
            persistNodePositionWithMetadata(n.id);
        });
        setTimeout(() => {
            try { state.cy.fit(undefined, 60); } catch (_) {}
        }, 420);
    }

    // Alias para los call-sites antiguos (importar workflow, replaceWorkflow,
    // agregar nodo, etc.). No es snake — es vertical swimlane.
    function runSnakeLayout() { runVerticalSwimlaneLayout(); }

    // Posición sugerida para un nodo nuevo: una fila debajo del último nodo
    // de la fase "sin_fase" (o de la primera fase con espacio). Si no hay
    // nodos, parte del origen del canvas.
    function findNextSnakeCell() {
        // Coloca el nodo nuevo al final de la columna 'sin_fase', o si no
        // hay sin_fase, debajo de la columna más alta. Después el usuario
        // puede arrastrarlo y la próxima vez que se regenere el workflow
        // queda en su fase real.
        const noPhase = state.nodes.filter(n => !(n.metadata && n.metadata.phase));
        if (noPhase.length > 0) {
            const maxY = Math.max(...noPhase.map(n => Number(n.position_y) || 0));
            const x = noPhase[0].position_x || COL_START_X + COL_WIDTH / 2;
            return { x, y: maxY + ROW_HEIGHT };
        }
        if (state.nodes.length === 0) {
            return { x: COL_START_X + COL_WIDTH / 2, y: COL_START_Y + NODE_H / 2 };
        }
        // Hay nodos en fases — pone el nuevo a la derecha, debajo
        const maxX = Math.max(...state.nodes.map(n => Number(n.position_x) || 0));
        const maxY = Math.max(...state.nodes.map(n => Number(n.position_y) || 0));
        return { x: maxX + COL_WIDTH + COL_GAP, y: maxY };
    }

    window.kipuRunSnakeLayout = runVerticalSwimlaneLayout;

    function humanizeSavedAgo(ts) {
        if (!ts) return 'Guardado';
        const sec = Math.floor((Date.now() - ts) / 1000);
        if (sec < 12) return 'Guardado justo ahora';
        const m = Math.floor(sec / 60);
        if (m <= 0) return 'Guardado hace un momento';
        if (m === 1) return 'Guardado hace 1 min';
        return 'Guardado hace ' + m + ' min';
    }

    function touchChromeAfterPersist() {
        state._lastWorkflowSaveAt = Date.now();
        const t = document.getElementById('kipu-save-status-text');
        if (t) t.textContent = humanizeSavedAgo(state._lastWorkflowSaveAt);
    }

    let _chromeStatsTimer = null;
    function scheduleMindmapChromeStatsLoop() {
        if (_chromeStatsTimer) clearInterval(_chromeStatsTimer);
        _chromeStatsTimer = setInterval(updateMindmapChromeStats, 8000);
    }

    function updateMindmapChromeStats() {
        const nEl = document.getElementById('kipu-mm-stat-nodes');
        const eEl = document.getElementById('kipu-mm-stat-edges');
        const hEl = document.getElementById('kipu-mm-stat-health');
        const vEl = document.getElementById('kipu-mm-footer-version');
        if (!nEl || !state.cy) return;
        let nodeCount = 0;
        let edgeCount = 0;
        try {
            nodeCount = state.cy.nodes('[kind = "node"]').length;
            edgeCount = state.cy.edges().length;
        } catch (_) { /* ignore */ }
        nEl.textContent = nodeCount + (nodeCount === 1 ? ' nodo' : ' nodos');
        if (eEl) eEl.textContent = edgeCount + (edgeCount === 1 ? ' conexión' : ' conexiones');
        if (hEl) {
            const ban = document.getElementById('kipu-validation-banner');
            if (ban && ban.className.indexOf(' ok') === -1) hEl.textContent = 'Revisa alertas en el lienzo';
            else hEl.textContent = 'Sin errores en el flujo';
        }
        if (vEl) {
            const sel = document.getElementById('edit-bot-select');
            let name = '—';
            if (sel && sel.selectedIndex >= 0) {
                const tx = sel.options[sel.selectedIndex].text;
                if (tx && tx !== 'Selecciona un Qhatu') name = tx;
            }
            vEl.textContent = 'Versión activa · ' + name;
        }
    }

    // Variante de persistNodePosition que también envía metadata.
    function persistNodePositionWithMetadata(nodeId) {
        if (state.demoMode) return;
        clearTimeout(state.saveTimers[nodeId]);
        state.saveTimers[nodeId] = setTimeout(async () => {
            const n = state.nodes.find(x => x.id === nodeId);
            if (!n) return;
            try {
                await api(`/workflow/${state.botId}/nodes/${nodeId}`, 'PUT', {
                    position_x: n.position_x,
                    position_y: n.position_y,
                    metadata: n.metadata || {}
                });
                touchChromeAfterPersist();
            } catch (e) { console.warn('[mindmap] position+metadata save failed:', e); }
        }, 250);
    }

    // ─── Dagre auto-layout — horizontal n8n style (LR) ─────────────────
    function runDagreLayout(animate) {
        if (!state.cy) return;
        // Layout izquierda-a-derecha como n8n (workflows fluyen horizontalmente).
        // rankSep = separación entre columnas, nodeSep = separación entre nodos
        // de la misma columna. Valores generosos para que las curvas bezier
        // tengan espacio para curvarse sin cruzarse.
        const layoutOpts = {
            name: 'dagre',
            rankDir: 'LR',
            nodeSep: 70,
            rankSep: 130,
            edgeSep: 30,
            ranker: 'network-simplex',
            fit: true,
            padding: 60,
            animate: !!animate,
            animationDuration: 400
        };
        // Fall back to a simple grid if dagre isn't available
        try {
            state.cy.layout(layoutOpts).run();
        } catch (e) {
            console.warn('[mindmap] dagre unavailable, using grid', e);
            state.cy.layout({ name: 'grid', fit: true, padding: 40 }).run();
        }

        // After layout, persist positions so next reload matches
        state.cy.nodes().forEach(cyNode => {
            const id = cyNode.id();
            const pos = cyNode.position();
            const rec = state.nodes.find(x => x.id === id);
            if (rec) {
                rec.position_x = pos.x;
                rec.position_y = pos.y;
            }
            persistNodePosition(id);
        });
    }

    // ─── Palette expand/collapse ───────────────────────────────────
    function expandPalette() {
        const pal = document.getElementById('kipu-node-palette');
        if (pal) pal.classList.remove('collapsed');
    }
    function collapsePalette() {
        const pal = document.getElementById('kipu-node-palette');
        if (pal) pal.classList.add('collapsed');
    }

    // ─── Format toggle (Solo botones / Solo conversacional) ──────
    // Hidrata el toggle desde bot.operacion.interactionMode y persiste cambios
    // al backend. Reusa la API ya validada (PUT /bots/:id) y la cache del
    // tester sandbox para que el cambio se vea sin restart.
    function applyFormatToggleUI(mode) {
        const valid = (mode === 'conversacional') ? 'conversacional' : 'botones';
        document.querySelectorAll('#kipu-format-toggle .kipu-format-toggle__btn').forEach(btn => {
            const isActive = btn.dataset.imMode === valid;
            btn.classList.toggle('is-active', isActive);
            btn.setAttribute('aria-checked', String(isActive));
        });
    }
    async function hydrateFormatToggle() {
        const wrap = document.getElementById('kipu-format-toggle');
        if (!wrap || !state.botId) return;
        try {
            const bots = await api('/bots').catch(() => []);
            const bot = Array.isArray(bots) ? bots.find(b => b._id === state.botId) : null;
            const raw = bot?.operacion?.interactionMode;
            const mode = (raw === 'conversacional') ? 'conversacional' : 'botones';
            applyFormatToggleUI(mode);
        } catch (_) { /* mantén default visual */ }
    }
    async function persistFormatMode(mode) {
        const wrap = document.getElementById('kipu-format-toggle');
        if (!wrap || !state.botId) return;
        wrap.classList.add('is-saving');
        try {
            await api('/bots/' + encodeURIComponent(state.botId), 'PUT', {
                operacion: { interactionMode: mode }
            });
            if (typeof window.invalidateTesterModeCache === 'function') {
                window.invalidateTesterModeCache();
            }
            if (typeof window.showToast === 'function') {
                window.showToast(
                    mode === 'botones' ? 'Modo "Solo botones" activado' : 'Modo "Solo conversacional" activado',
                    'success', 1800
                );
            }
        } catch (err) {
            console.warn('[mindmap/formato] save failed:', err?.message || err);
            if (typeof window.showToast === 'function') {
                window.showToast('No se pudo guardar el formato', 'error', 2500);
            }
        } finally {
            wrap.classList.remove('is-saving');
        }
    }
    function wireFormatToggle() {
        const wrap = document.getElementById('kipu-format-toggle');
        if (!wrap || wrap.dataset.bound === '1') return;
        wrap.dataset.bound = '1';
        wrap.querySelectorAll('.kipu-format-toggle__btn').forEach(btn => {
            btn.onclick = (ev) => {
                ev.stopPropagation();
                const mode = btn.dataset.imMode;
                if (!mode || btn.classList.contains('is-active')) return;
                applyFormatToggleUI(mode);
                persistFormatMode(mode);
            };
        });
        hydrateFormatToggle();
    }

    // ─── Topbar buttons ────────────────────────────────────────
    function wireTopbar() {
        // Node palette (5 type buttons) — solo la lógica de añadir nodo
        document.querySelectorAll('#kipu-node-palette .kipu-palette-btn').forEach(btn => {
            btn.onclick = () => {
                window.kipuMindmapAddNode(btn.dataset.type);
                collapsePalette(); // tras añadir, colapsa la palette
            };
        });

        // Toggle expand/collapse de la palette
        const handle = document.getElementById('kipu-palette-handle');
        const closeBtn = document.getElementById('kipu-palette-close');
        if (handle) handle.onclick = expandPalette;
        if (closeBtn) closeBtn.onclick = collapsePalette;
        // Wire-up del toggle "Formato de respuesta" (Solo botones / Solo conversacional)
        try { wireFormatToggle(); } catch (e) { console.warn('[mindmap] wireFormatToggle:', e); }
        // Click fuera de la palette → colapsar (si está expandida)
        document.addEventListener('click', (ev) => {
            const pal = document.getElementById('kipu-node-palette');
            if (!pal || pal.classList.contains('collapsed')) return;
            if (!pal.contains(ev.target)) collapsePalette();
        });

        // Zoom controls
        document.getElementById('kipu-zoom-in').onclick = () => {
            if (!state.cy) return;
            state.cy.zoom({ level: Math.min(2.5, state.cy.zoom() * 1.15), renderedPosition: cyCenter() });
        };
        document.getElementById('kipu-zoom-out').onclick = () => {
            if (!state.cy) return;
            state.cy.zoom({ level: Math.max(0.3, state.cy.zoom() / 1.15), renderedPosition: cyCenter() });
        };
        // E17: el botón de "agrandar" (⛶) ahora alterna pantalla completa real
        // sobre el contenedor del workflow. Antes solo llamaba a fit(), que no
        // cambiaba el tamaño del lienzo y daba la sensación de que no funcionaba.
        document.getElementById('kipu-zoom-fit').onclick = () => {
            const root = document.getElementById('kipu-mindmap-root');
            if (!root) return;
            const isFs = root.classList.toggle('kipu-mindmap-fullscreen');
            // Pequeño delay para que el CSS tome efecto antes de medir el viewport.
            setTimeout(() => {
                if (state.cy) {
                    state.cy.resize();
                    state.cy.fit(undefined, 60);
                }
            }, 60);
            const btn = document.getElementById('kipu-zoom-fit');
            if (btn) btn.title = isFs ? 'Salir de pantalla completa' : 'Pantalla completa';
        };
        document.getElementById('kipu-zoom-pct').onclick = () => { if (state.cy) state.cy.fit(undefined, 60); };

        const wireDup = (a, b) => {
            const elA = document.getElementById(a);
            const elB = document.getElementById(b);
            if (elA && elB) elA.onclick = () => elB.click();
        };
        wireDup('kipu-tb-zoom-in', 'kipu-zoom-in');
        wireDup('kipu-tb-zoom-out', 'kipu-zoom-out');
        const tbFit = document.getElementById('kipu-tb-fit');
        const pctBtn = document.getElementById('kipu-zoom-pct');
        if (tbFit && pctBtn) tbFit.onclick = () => pctBtn.click();

        const undoBtn = document.getElementById('kipu-undo-btn');
        if (undoBtn) undoBtn.onclick = () => { try { undoLastDrag(); } catch (_) {} };

        const tools = document.getElementById('kipu-mm-tools');
        if (tools) {
            tools.querySelectorAll('.kipu-mm-tool').forEach(b => {
                b.onclick = () => {
                    tools.querySelectorAll('.kipu-mm-tool').forEach(x => x.classList.remove('active'));
                    b.classList.add('active');
                };
            });
        }

        const exBtn = document.getElementById('kipu-mm-export');
        if (exBtn) exBtn.onclick = (ev) => openExportMenu(ev.clientX, ev.clientY);

        // Botón "Guardar" — el workflow ya se persiste solo en cada edit/move,
        // así que este botón solo confirma visualmente: refresca la pill
        // "Guardado justo ahora" + toast de confirmación.
        const pubBtn = document.getElementById('kipu-mm-publish');
        if (pubBtn) pubBtn.onclick = () => {
            try { touchChromeAfterPersist(); } catch (_) {}
            if (typeof showToast === 'function') {
                showToast('Workflow guardado.', 'success');
            }
        };

        if (state._saveStatusUiTimer) clearInterval(state._saveStatusUiTimer);
        state._saveStatusUiTimer = setInterval(() => {
            const t = document.getElementById('kipu-save-status-text');
            if (t && state._lastWorkflowSaveAt) t.textContent = humanizeSavedAgo(state._lastWorkflowSaveAt);
        }, 45000);
    }

    // ─── Search highlight ──────────────────────────────────────
    function applySearchFilter(query) {
        if (!state.cy) return;
        const q = (query || '').trim().toLowerCase();
        state.cy.nodes().removeClass('search-match').removeClass('search-dim');
        if (!q) return;
        state.cy.nodes().forEach(cyNode => {
            const id = cyNode.id();
            const rec = state.nodes.find(n => n.id === id);
            const hay = ((rec && rec.title) || cyNode.data('title') || '').toLowerCase()
                + ' '
                + ((rec && rec.description) || '').toLowerCase();
            cyNode.addClass(hay.includes(q) ? 'search-match' : 'search-dim');
        });
    }

    // ─── Export (JSON or PNG) ──────────────────────────────────
    function openExportMenu(x, y) {
        closeExportMenu();
        const m = document.createElement('div');
        m.id = 'kipu-export-menu';
        m.className = 'kipu-export-menu';
        m.style.left = (x - 160) + 'px';
        m.style.top = (y + 12) + 'px';
        m.innerHTML = `
            <div class="kipu-export-menu-item" data-act="json">⬇  Exportar como JSON</div>
            <div class="kipu-export-menu-item" data-act="png">🖼️  Exportar como PNG</div>
        `;
        document.body.appendChild(m);
        m.querySelectorAll('.kipu-export-menu-item').forEach(it => {
            it.onclick = () => {
                closeExportMenu();
                if (it.dataset.act === 'json') exportWorkflowJSON();
                else if (it.dataset.act === 'png') exportWorkflowPNG();
            };
        });
        setTimeout(() => document.addEventListener('click', closeExportMenu, { once: true }), 0);
    }
    function closeExportMenu() {
        const m = document.getElementById('kipu-export-menu');
        if (m) m.remove();
    }

    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
    }

    async function exportWorkflowJSON() {
        // Intentar full-export desde el servidor (incluye productos, envíos,
        // pagos, identidad y workflow). Si falla, fallback a sólo nodes/edges
        // del estado local — funciona aunque la API esté caída.
        let payload;
        if (state.botId && typeof apiCall === 'function') {
            try {
                payload = await apiCall(`/workflow/${state.botId}/export`);
            } catch (e) {
                console.warn('[mindmap] full export failed, falling back to local nodes/edges:', e?.message);
            }
        }
        if (!payload) {
            payload = {
                version: '1.0',
                exported_at: new Date().toISOString(),
                bot_id: state.botId,
                nodes: state.nodes,
                edges: state.edges
            };
        }
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        downloadBlob(blob, `kipu-workflow-${state.botId || 'demo'}.json`);
    }

    function exportWorkflowPNG() {
        if (!state.cy) return;
        try {
            const png = state.cy.png({ full: true, bg: '#FAF7F0', scale: 2, output: 'blob' });
            downloadBlob(png, `kipu-workflow-${state.botId || 'demo'}.png`);
        } catch (e) {
            alert('No se pudo exportar a PNG: ' + e.message);
        }
    }

    // ─── Import JSON ───────────────────────────────────────────
    async function handleImportFile(ev) {
        const file = ev.target.files && ev.target.files[0];
        ev.target.value = '';  // allow re-import of same file
        if (!file) return;

        // Validación client-side (defensa de UX, NO de seguridad — la auth real
        // ocurre en el backend con magic bytes y cap de tamaño)
        const MAX_BYTES = 10 * 1024 * 1024;
        const allowedExt = ['.pdf', '.docx'];
        const allowedMime = [
            'application/pdf',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        ];
        const ext = ('.' + (file.name.split('.').pop() || '')).toLowerCase();
        const mime = (file.type || '').toLowerCase();
        if (!allowedExt.includes(ext) || !allowedMime.includes(mime)) {
            alert('Solo se aceptan archivos PDF (.pdf) o Word (.docx).');
            return;
        }
        if (file.size === 0) {
            alert('El archivo está vacío.');
            return;
        }
        if (file.size > MAX_BYTES) {
            alert('El archivo excede el límite de 10 MB.');
            return;
        }

        if (!confirm(`¿Importar el workflow descrito en "${file.name}"?\nEsto reemplaza tu workflow actual y puede tardar 10–30 segundos.`)) {
            return;
        }

        const importBtn = document.getElementById('kipu-btn-import');
        const originalLabel = importBtn ? importBtn.innerHTML : '';
        if (importBtn) {
            importBtn.disabled = true;
            importBtn.innerHTML = '⏳ Procesando…';
        }

        try {
            const formData = new FormData();
            formData.append('document', file);
            const token = localStorage.getItem('token');
            const resp = await fetch(`/api/workflow/${state.botId}/import-doc`, {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + (token || '') },
                body: formData
            });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok) {
                throw new Error(data.error || `HTTP ${resp.status}`);
            }
            if (typeof showToast === 'function') {
                showToast(`Workflow importado: ${data.nodesCreated || 0} nodos, ${data.edgesCreated || 0} conexiones`, 'success');
            }
            // Recargar el grafo desde el servidor para mostrar lo recién creado
            const map = await api('/workflow/' + encodeURIComponent(state.botId));
            state.nodes = map.nodes || [];
            state.edges = map.edges || [];
            if (state.cy) {
                state.cy.elements().remove();
                state.cy.add(buildCyElements());
                runSnakeLayout();
            }
        } catch (e) {
            alert('No se pudo importar el archivo: ' + (e.message || 'Error desconocido'));
        } finally {
            if (importBtn) {
                importBtn.disabled = false;
                importBtn.innerHTML = originalLabel;
            }
        }
    }

    async function replaceWorkflow(newNodes, newEdges) {
        if (state.demoMode) {
            // In demo mode we just swap in-memory and redraw
            state.nodes = newNodes;
            state.edges = newEdges;
            if (state.cy) {
                state.cy.elements().remove();
                state.cy.add(buildCyElements());
                runSnakeLayout();
            }
            return;
        }
        // Live mode: delete all current nodes (cascade deletes edges), then
        // POST the imported ones. Keep position_x/y if present so dagre can
        // honor them; if not, dagre will auto-layout.
        try {
            for (const n of state.nodes) {
                try { await api(`/workflow/${state.botId}/nodes/${n.id}`, 'DELETE'); } catch (_) {}
            }
            state.nodes = []; state.edges = [];
            const idMap = {};
            for (const n of newNodes) {
                const payload = {
                    title: n.title || 'Nodo',
                    description: n.description || '',
                    node_type: n.node_type || 'step',
                    source: n.source || 'custom',
                    position_x: Number(n.position_x) || 0,
                    position_y: Number(n.position_y) || 0,
                    order_index: Number(n.order_index) || 0,
                    metadata: n.metadata || {}
                };
                const created = await api(`/workflow/${state.botId}/nodes`, 'POST', payload);
                idMap[n.id] = created.id;
                state.nodes.push(created);
            }
            for (const e of newEdges) {
                const from = idMap[e.from_node_id];
                const to = idMap[e.to_node_id];
                if (!from || !to) continue;
                const created = await api(`/workflow/${state.botId}/edges`, 'POST',
                    { from_node_id: from, to_node_id: to, label: e.label || '' });
                state.edges.push(created);
            }
            if (state.cy) {
                state.cy.elements().remove();
                state.cy.add(buildCyElements());
                if (needsAutoLayout(state.nodes)) runSnakeLayout();
                else state.cy.fit(undefined, 60);
            }
        } catch (e) {
            alert('No se pudo completar la importación: ' + e.message);
        }
    }

    // ─── Validation ────────────────────────────────────────────
    function runValidation() {
        if (!state.cy) return;
        state.cy.nodes().removeClass('invalid');
        state.cy.edges().removeClass('invalid');
        const issues = [];

        const outByNode = new Map();
        const inByNode = new Map();
        state.edges.forEach(e => {
            if (!outByNode.has(e.from_node_id)) outByNode.set(e.from_node_id, []);
            outByNode.get(e.from_node_id).push(e);
            if (!inByNode.has(e.to_node_id)) inByNode.set(e.to_node_id, []);
            inByNode.get(e.to_node_id).push(e);
        });

        state.nodes.forEach(n => {
            // Rule 1: decision nodes must have ≥2 labeled outgoing edges
            if (n.node_type === 'condition' || n.node_type === 'decision') {
                const outs = outByNode.get(n.id) || [];
                const labeled = outs.filter(e => (e.label || '').trim().length > 0);
                if (outs.length < 2) {
                    issues.push(`Decisión "${n.title}" necesita al menos 2 ramas de salida.`);
                    markNodeInvalid(n.id);
                } else if (labeled.length < outs.length) {
                    issues.push(`Decisión "${n.title}" tiene ramas sin etiqueta.`);
                    markNodeInvalid(n.id);
                    outs.filter(e => !(e.label || '').trim()).forEach(e => markEdgeInvalid(e.id));
                }
            }
            // Rule 2: orphan nodes (no in, no out) — skip start_end by design
            const outs = outByNode.get(n.id) || [];
            const ins = inByNode.get(n.id) || [];
            if (outs.length === 0 && ins.length === 0 && n.node_type !== 'start_end') {
                issues.push(`Nodo "${n.title}" está suelto (sin conexiones).`);
                markNodeInvalid(n.id);
            }
            // Rule 3: a non-start_end node with no inbound edges and no outbound
            // to start chain is unreachable (ignore start_end which is entry point)
            if (ins.length === 0 && outs.length > 0 && n.node_type !== 'start_end') {
                issues.push(`Nodo "${n.title}" no tiene entrada — no es alcanzable.`);
                markNodeInvalid(n.id);
            }
        });

        showValidationBanner(issues);
    }
    function markNodeInvalid(id) {
        const el = state.cy.getElementById(id);
        if (el && el.length) el.addClass('invalid');
    }
    function markEdgeInvalid(id) {
        const el = state.cy.getElementById('e_' + id);
        if (el && el.length) el.addClass('invalid');
    }
    function showValidationBanner(issues) {
        const existing = document.getElementById('kipu-validation-banner');
        if (existing) existing.remove();
        const banner = document.createElement('div');
        banner.id = 'kipu-validation-banner';
        banner.className = 'kipu-mindmap-validation' + (issues.length === 0 ? ' ok' : '');
        if (issues.length === 0) {
            banner.innerHTML = `<button class="dismiss">×</button><b>✓ Workflow válido</b> — no encontré decisiones sin etiquetar ni nodos sueltos.`;
        } else {
            const items = issues.slice(0, 8).map(i => `<li>${i.replace(/</g, '&lt;')}</li>`).join('');
            banner.innerHTML = `<button class="dismiss">×</button><b>Encontré ${issues.length} ${issues.length === 1 ? 'detalle' : 'detalles'} a revisar:</b><ul>${items}</ul>${issues.length > 8 ? `<div style="opacity:0.6;margin-top:4px;">…y ${issues.length - 8} más</div>` : ''}`;
        }
        const root = document.getElementById('kipu-mindmap-root');
        (root || document.body).appendChild(banner);
        if (document.getElementById('kipu-mindmap-demo-banner')) {
            banner.style.bottom = '56px';
        }
        banner.querySelector('.dismiss').onclick = () => {
            banner.remove();
            try { updateMindmapChromeStats(); } catch (_) {}
        };
        setTimeout(() => {
            if (document.getElementById('kipu-validation-banner') === banner) {
                banner.remove();
                try { updateMindmapChromeStats(); } catch (_) {}
            }
        }, 9000);
        try { updateMindmapChromeStats(); } catch (_) {}
    }

    function cyCenter() {
        const el = document.getElementById('kipu-cy-container');
        if (!el) return { x: 0, y: 0 };
        const r = el.getBoundingClientRect();
        return { x: r.width / 2, y: r.height / 2 };
    }

    function onRootKeydown(e) {
        if (document.getElementById('kipu-node-edit-overlay')) return;
        if (handleUndoShortcut(e)) return;
        if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedNodeId) {
            e.preventDefault();
            deleteNodeAction(state.selectedNodeId);
        } else if (e.key === 'Escape') {
            clearSelection();
            closeContextMenu();
        } else if (e.key === 'n' || e.key === 'N') {
            if (window.kipuMindmapAddNode) window.kipuMindmapAddNode();
        }
    }
    function onGlobalKeydown(e) {
        if (document.getElementById('kipu-node-edit-overlay')) return;
        const tag = (e.target && e.target.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
        if (handleUndoShortcut(e)) return;
        if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedNodeId) {
            e.preventDefault();
            deleteNodeAction(state.selectedNodeId);
        }
    }

    // Detecta Ctrl+Z (Win/Linux) o Cmd+Z (Mac) y deshace el último drag.
    // Devuelve true si manejó el evento (para que el caller pueda hacer
    // early-return). Ignora Shift+Z (sería redo, que aún no implementamos).
    function handleUndoShortcut(e) {
        const isUndo = (e.key === 'z' || e.key === 'Z')
            && (e.ctrlKey || e.metaKey)
            && !e.shiftKey
            && !e.altKey;
        if (!isUndo) return false;
        // Solo actuamos si el editor del workflow está visible — el undo
        // global de WhatsApp/forms no es nuestro asunto.
        if (!state.cy || !document.getElementById('kipu-cy-container')) return false;
        e.preventDefault();
        undoLastDrag();
        return true;
    }

    // Restaura la última posición previa al drag. Anima el nodo de vuelta,
    // actualiza state.nodes, persiste, y muestra un toast discreto.
    function undoLastDrag() {
        const last = state.dragUndoStack.pop();
        if (!last) {
            if (typeof showToast === 'function') showToast('Nada que deshacer', 'info');
            return;
        }
        const { nodeId, fromX, fromY } = last;
        const rec = state.nodes.find(x => x.id === nodeId);
        if (!rec) return;
        rec.position_x = fromX;
        rec.position_y = fromY;
        const cyNode = state.cy.getElementById(nodeId);
        if (cyNode && cyNode.length) {
            cyNode.animate(
                { position: { x: fromX, y: fromY } },
                { duration: 240, easing: 'ease-out-cubic' }
            );
        }
        persistNodePositionWithMetadata(nodeId);
    }

    // ─── Selection + side panel ────────────────────────────────
    function selectNode(nodeId) {
        state.selectedNodeId = nodeId;
        if (state.cy) {
            state.cy.nodes().unselect();
            const el = state.cy.getElementById(nodeId);
            if (el && el.length) el.select();
        }
        renderSidePanel(nodeId);
    }

    function clearSelection() {
        state.selectedNodeId = null;
        if (state.cy) state.cy.nodes().unselect();
        const panel = document.getElementById('kipu-side-panel');
        if (panel) { panel.classList.remove('visible'); panel.innerHTML = ''; }
    }

    // ─── Ejemplos LLM por nodo ────────────────────────────────────────────
    // Cache en memoria por nodo: state.exampleCache[nodeId] = {
    //   loading, example, cached, generatedAt, error
    // }
    // El backend cachea en BD (workflow_nodes.example_*). Si el hash de
    // inputs no cambió y la config no se editó, devuelve el cacheado en BD.

    // ─── Filtro: ¿este nodo envía mensaje al cliente? ────────────────────
    // Solo los pasos donde el bot HABLA al cliente deberían tener ejemplo.
    // Whitelist estricta para nodos del seed (por metadata.seed_key) +
    // heurística por título/tipo para nodos custom. Nodos descartados:
    //   • condition / decision (decisiones, no mensajes)
    //   • config_requirement / note (dependencias / anotaciones)
    //   • start_end (entry/exit del flujo)
    //   • handoff (acción manual del emprendedor)
    //   • títulos que empiezan con "Cliente …" (describen acción del cliente)
    //   • títulos con "¿…" (preguntas / decisiones)
    //   • títulos con "HANDOFF: …"
    const _BOT_MSG_SEED_KEYS = new Set([
        'greet',                    // Saludo inicial
        'list_all', 'offer_single', 'ask_interest',  // Ofrecer productos (legacy)
        'offer_catalog', 'show_all', 'show_top',
        'resolve_multi', 'resolve_single',
        'ask_shipping_method',      // Mostrar opciones de envío (header)
        // Solicitar datos del cliente — secuencia de 4 nodos (un campo c/u)
        'request_data',             // legacy (workflows pre-split)
        'request_data_apellido',
        'request_data_nombre',
        'request_data_celular',
        'request_data_dni',
        'show_payment_methods',     // Mostrar métodos de pago (header)
        'verify_payment'            // Verificación del pago
    ]);
    function nodeHasBotMessage(node) {
        if (!node) return false;
        const type = (node.node_type || '').toLowerCase();
        const trimTitle = (node.title || '').trim();
        const seedKey = (node.metadata && node.metadata.seed_key) || '';

        // Generic (seed) → whitelist estricta de los 6 pasos canónicos
        if (seedKey) return _BOT_MSG_SEED_KEYS.has(seedKey);

        // Custom → heurísticas
        if (type === 'condition' || type === 'decision') return false;
        if (type === 'config_requirement' || type === 'note') return false;
        if (type === 'start_end') return false;
        if (type === 'handoff') return false;
        if (/^cliente\s/i.test(trimTitle)) return false;
        if (/^handoff[\s:]/i.test(trimTitle)) return false;
        if (trimTitle.startsWith('¿')) return false;
        return true;
    }

    // Escapa HTML pero conserva variables {placeholder} con highlight naranja.
    function renderExampleText(text) {
        const esc = String(text || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        // {variable} | {nombre_negocio} | {monto} → highlight con clase .kipu-var
        return esc.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, '<span class="kipu-var">{$1}</span>');
    }

    function formatHumanTime(iso) {
        if (!iso) return '';
        try {
            const d = new Date(iso);
            const hh = String(d.getHours()).padStart(2, '0');
            const mm = String(d.getMinutes()).padStart(2, '0');
            return `${hh}:${mm}`;
        } catch (_) { return ''; }
    }

    function renderExampleBody(nodeId) {
        const c = state.exampleCache[nodeId];
        if (!c || (!c.example && !c.error && !c.loading)) {
            // Estado vacío — CTA para generar
            return `
                <div class="kipu-example-empty" data-act="fetch-example" role="button" tabindex="0">
                    <div class="kipu-example-empty-icon">✨</div>
                    <div class="kipu-example-empty-text">Click para generar ejemplo</div>
                </div>
            `;
        }
        if (c.loading) {
            return `
                <div class="kipu-example-skeleton" aria-label="Generando ejemplo…">
                    <div class="kipu-example-skeleton-line"></div>
                    <div class="kipu-example-skeleton-line"></div>
                    <div class="kipu-example-skeleton-line"></div>
                </div>
                <div class="kipu-example-meta">Generando con IA…</div>
            `;
        }
        if (c.error && !c.example) {
            return `
                <div class="kipu-example-error">
                    No se pudo generar el ejemplo.
                    <span class="retry-link" data-act="fetch-example">Reintentar →</span>
                </div>
            `;
        }
        // Ejemplo OK
        const time = formatHumanTime(c.generatedAt) || '12:34';
        const badge = c.cached
            ? '<span class="cached-badge">cacheado</span>'
            : '<span class="live-badge">recién generado</span>';
        return `
            <div class="kipu-bubble-wa">
                ${renderExampleText(c.example)}
                <div class="kipu-bubble-wa-time">${time}</div>
            </div>
            <div class="kipu-example-meta">${badge}${c.generatedAt ? ` · ${formatHumanTime(c.generatedAt)}` : ''}</div>
        `;
    }

    // Re-render solo del cuerpo del ejemplo (no del side panel completo).
    function refreshExampleBody(nodeId) {
        const body = document.getElementById('kipu-example-body-' + nodeId);
        if (!body) return;
        body.innerHTML = renderExampleBody(nodeId);
        // Re-bind del CTA "fetch-example"
        body.querySelectorAll('[data-act]').forEach(el => {
            const act = el.getAttribute('data-act');
            el.onclick = () => {
                if (act === 'fetch-example') fetchExample(nodeId);
            };
        });
    }

    async function fetchExample(nodeId, { force } = {}) {
        if (state.demoMode) return; // no LLM en demo
        if (!state.botId) return;
        const existing = state.exampleCache[nodeId];
        if (existing && existing.loading) return; // ya en flight
        if (existing && existing.example && !force && !existing.error) return; // ya tenemos ejemplo

        state.exampleCache[nodeId] = { ...(existing || {}), loading: true, error: null };
        refreshExampleBody(nodeId);
        if (typeof refreshPopupBodyIfVisible === 'function') refreshPopupBodyIfVisible(nodeId);
        try {
            const path = force
                ? `/workflow/${encodeURIComponent(state.botId)}/nodes/${encodeURIComponent(nodeId)}/example/regenerate`
                : `/workflow/${encodeURIComponent(state.botId)}/nodes/${encodeURIComponent(nodeId)}/example`;
            const method = force ? 'POST' : 'GET';
            const resp = await api(path, method);
            state.exampleCache[nodeId] = {
                loading: false,
                example: resp.example || null,
                cached: !!resp.cached,
                generatedAt: resp.generatedAt || null,
                error: resp.error || null
            };
        } catch (e) {
            const msg = (e && e.message) || 'unknown_error';
            const isRate = /429|rate.?limit/i.test(msg);
            state.exampleCache[nodeId] = {
                loading: false,
                example: null,
                cached: false,
                generatedAt: null,
                error: isRate
                    ? 'Demasiados ejemplos generados. Espera un minuto.'
                    : msg
            };
        }
        refreshExampleBody(nodeId);
        if (typeof refreshPopupBodyIfVisible === 'function') refreshPopupBodyIfVisible(nodeId);
    }

    function regenerateExample(nodeId) {
        fetchExample(nodeId, { force: true });
    }
    // Expone en window para uso desde botón global (Fase 6)
    window.kipuFetchExample = fetchExample;
    window.kipuRegenerateExample = regenerateExample;

    // ─── Hover popup (overlay flotante por nodo) ─────────────────────────
    // Capa nueva — NO reemplaza el side panel. Aparece tras hover sostenido
    // (>400ms) sobre un nodo y muestra el ejemplo cacheado/generado al
    // costado. Click en el nodo cierra el popup y abre el side panel
    // (comportamiento de click intacto).
    //
    // Touch devices: deshabilitado (matchMedia('(hover: none)')).

    const HOVER_DELAY_MS = 400;       // debounce: hover debe sostenerse 400ms
    const HOVER_LEAVE_GRACE_MS = 200; // gracia tras salir del popup
    const POPUP_GAP_PX = 16;          // separación visual nodo ↔ popup
    const isTouchDevice = (typeof window !== 'undefined') &&
        window.matchMedia && window.matchMedia('(hover: none)').matches;

    function ensurePopupEl() {
        let el = document.getElementById('kipu-node-popup');
        if (el) return el;
        el = document.createElement('div');
        el.id = 'kipu-node-popup';
        el.setAttribute('role', 'tooltip');
        el.style.display = 'none';
        // Mouse enter/leave en el popup mismo — para que si el usuario quiere
        // leer texto largo y mueve el mouse adentro, no se cierre.
        el.addEventListener('mouseenter', () => {
            state.hoverPopup.mouseInsidePopup = true;
            if (state.hoverPopup.hideTimer) {
                clearTimeout(state.hoverPopup.hideTimer);
                state.hoverPopup.hideTimer = null;
            }
        });
        el.addEventListener('mouseleave', () => {
            state.hoverPopup.mouseInsidePopup = false;
            scheduleHoverHide();
        });
        document.body.appendChild(el);
        return el;
    }

    function renderPopupBody(nodeId) {
        const c = state.exampleCache[nodeId];
        if (!c || (c.loading && !c.example)) {
            // Loading inicial / sin generar
            return `
                <div class="kipu-example-skeleton" aria-label="Generando ejemplo…">
                    <div class="kipu-example-skeleton-line"></div>
                    <div class="kipu-example-skeleton-line"></div>
                    <div class="kipu-example-skeleton-line"></div>
                </div>
                <div class="kipu-node-popup-status">Generando ejemplo…</div>
            `;
        }
        if (c.error && !c.example) {
            return `
                <div class="kipu-example-error">
                    No se pudo generar ejemplo.
                    <span class="retry-link" data-popup-act="retry">Reintentar →</span>
                </div>
            `;
        }
        const time = formatHumanTime(c.generatedAt) || '12:34';
        return `
            <div class="kipu-bubble-wa">
                ${renderExampleText(c.example || '')}
                <div class="kipu-bubble-wa-time">${time}</div>
            </div>
        `;
    }

    function renderPopup(nodeId) {
        const el = ensurePopupEl();
        const n = state.nodes.find(x => x.id === nodeId);
        if (!n) return el;
        const subLabel = nodeSubtitle(n);
        const titleEsc = (n.title || '').replace(/</g, '&lt;');
        el.innerHTML = `
            <div class="kipu-node-popup-header">
                <span class="kipu-node-popup-type">${subLabel}</span>
                <span class="kipu-node-popup-title">${titleEsc}</span>
            </div>
            <div class="kipu-node-popup-body" id="kipu-node-popup-body">
                ${renderPopupBody(nodeId)}
            </div>
            <div class="kipu-node-popup-footer">
                Ejemplo aproximado. El bot puede variar la redacción.
            </div>
        `;
        // Wire del botón "Reintentar" del estado error
        const retry = el.querySelector('[data-popup-act="retry"]');
        if (retry) retry.onclick = () => fetchExample(nodeId, { force: true });
        return el;
    }

    // Si el popup está visible y mostrando este nodo, refrescar su body
    // (llamado al final de fetchExample una vez la cache se actualizó).
    function refreshPopupBodyIfVisible(nodeId) {
        const hp = state.hoverPopup;
        if (!hp.visible || hp.nodeId !== nodeId) return;
        const body = document.getElementById('kipu-node-popup-body');
        if (!body) return;
        body.innerHTML = renderPopupBody(nodeId);
        const retry = body.querySelector('[data-popup-act="retry"]');
        if (retry) retry.onclick = () => fetchExample(nodeId, { force: true });
    }

    // Calcula la posición ideal del popup respecto a un nodo Cytoscape.
    // Estrategia: derecha → izquierda → abajo. Clamp vertical al viewport.
    function computePopupPosition(cyNode, popupSize) {
        const containerEl = document.getElementById('kipu-cy-container');
        if (!containerEl) return null;
        const rect = containerEl.getBoundingClientRect();
        const rp = cyNode.renderedPosition();   // centro del nodo en coords del container
        const rw = cyNode.renderedWidth();
        const rh = cyNode.renderedHeight();
        const nodeCenterX = rect.left + rp.x;
        const nodeCenterY = rect.top  + rp.y;
        const nodeLeft   = nodeCenterX - rw / 2;
        const nodeRight  = nodeCenterX + rw / 2;
        const nodeTop    = nodeCenterY - rh / 2;
        const nodeBottom = nodeCenterY + rh / 2;

        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const pw = popupSize.width;
        const ph = popupSize.height;

        // Default: top alineado con el top del nodo, clamped al viewport.
        let top = nodeTop;
        let left;
        let direction;

        // Try right
        if (nodeRight + POPUP_GAP_PX + pw <= vw - 8) {
            left = nodeRight + POPUP_GAP_PX;
            direction = 'from-right';
        }
        // Try left
        else if (nodeLeft - POPUP_GAP_PX - pw >= 8) {
            left = nodeLeft - POPUP_GAP_PX - pw;
            direction = 'from-left';
        }
        // Fall back: below the node, horizontally centered + clamped
        else {
            top = nodeBottom + POPUP_GAP_PX;
            left = Math.max(8, Math.min(nodeCenterX - pw / 2, vw - pw - 8));
            direction = 'from-below';
        }

        // Clamp vertical para no salirnos del viewport
        if (top + ph > vh - 8) top = Math.max(8, vh - ph - 8);
        if (top < 8) top = 8;

        return { left, top, direction };
    }

    function showHoverPopup(nodeId) {
        if (!state.cy) return;
        const cyNode = state.cy.getElementById(nodeId);
        if (!cyNode || !cyNode.length) return;
        const el = renderPopup(nodeId);

        // Posicionar fuera de pantalla para medir tamaño real, luego mover.
        el.style.display = 'block';
        el.style.left = '-9999px';
        el.style.top = '-9999px';
        el.classList.remove('visible', 'from-right', 'from-left', 'from-below');
        // Forzar reflow para que la transición arranque desde estado initial
        // eslint-disable-next-line no-unused-expressions
        el.offsetHeight;

        const popupSize = { width: el.offsetWidth, height: el.offsetHeight };
        const pos = computePopupPosition(cyNode, popupSize);
        if (!pos) { el.style.display = 'none'; return; }

        el.style.left = pos.left + 'px';
        el.style.top  = pos.top + 'px';
        el.classList.add(pos.direction);
        // Forzar reflow antes de añadir 'visible' para que la transición corra
        // eslint-disable-next-line no-unused-expressions
        el.offsetHeight;
        el.classList.add('visible');
        state.hoverPopup.visible = true;
        state.hoverPopup.nodeId = nodeId;

        // Disparar fetch si todavía no tenemos el ejemplo
        const c = state.exampleCache[nodeId];
        if (!c || (!c.example && !c.error && !c.loading)) {
            fetchExample(nodeId);
        }
    }

    function hideHoverPopup() {
        const hp = state.hoverPopup;
        if (hp.showTimer) { clearTimeout(hp.showTimer); hp.showTimer = null; }
        if (hp.hideTimer) { clearTimeout(hp.hideTimer); hp.hideTimer = null; }
        const el = document.getElementById('kipu-node-popup');
        if (!el) { hp.visible = false; hp.nodeId = null; return; }
        el.classList.remove('visible');
        hp.visible = false;
        hp.nodeId = null;
        hp.mouseInsidePopup = false;
        // Espera a que la transición termine (100ms) antes de display:none.
        setTimeout(() => {
            // Si el popup volvió a aparecer entre tanto, no lo apaguemos.
            if (!state.hoverPopup.visible) el.style.display = 'none';
        }, 120);
    }

    function scheduleHoverHide() {
        const hp = state.hoverPopup;
        if (hp.hideTimer) clearTimeout(hp.hideTimer);
        hp.hideTimer = setTimeout(() => {
            // Solo ocultamos si el mouse no está dentro del popup
            if (!state.hoverPopup.mouseInsidePopup) hideHoverPopup();
        }, HOVER_LEAVE_GRACE_MS);
    }

    function scheduleHoverShow(nodeId) {
        const hp = state.hoverPopup;
        // Cancelar timer pendiente del nodo anterior
        if (hp.showTimer) { clearTimeout(hp.showTimer); hp.showTimer = null; }
        if (hp.hideTimer) { clearTimeout(hp.hideTimer); hp.hideTimer = null; }
        // Si ya está visible para este mismo nodo, no hacer nada
        if (hp.visible && hp.nodeId === nodeId) return;
        // Si está visible para otro nodo, ocultar inmediato y rearm
        if (hp.visible && hp.nodeId !== nodeId) {
            hideHoverPopup();
        }
        hp.showTimer = setTimeout(() => {
            hp.showTimer = null;
            showHoverPopup(nodeId);
        }, HOVER_DELAY_MS);
    }

    // ─── Generar todos los ejemplos (Fase 6) ─────────────────────────────
    // Recorre los nodos sin example_message en serie y los genera. Un nodo
    // por vez para respetar el rate limit (5/min/bot) y poder mostrar
    // progreso real en el botón. Si alguno falla, sigue con el siguiente
    // y reporta al final cuántos ok/fallaron.
    function nodesWithoutExample() {
        // Solo nodos calificados (donde el bot habla al cliente) sin
        // example_message en BD ni en cache local.
        return state.nodes.filter(n =>
            nodeHasBotMessage(n) &&
            !n.example_message &&
            (!state.exampleCache[n.id] || !state.exampleCache[n.id].example)
        );
    }

    function updateGenAllButton() {
        const btn = document.getElementById('kipu-btn-genall');
        const lbl = document.getElementById('kipu-btn-genall-label');
        if (!btn || !lbl) return;
        const missing = nodesWithoutExample().length;
        if (state.demoMode || missing === 0) {
            btn.style.display = 'none';
            return;
        }
        btn.style.display = '';
        lbl.textContent = `Generar ejemplos (${missing})`;
        btn.title = `Genera ejemplos LLM para ${missing} nodos. ~$0.001 por nodo · Total ~$${(missing * 0.001).toFixed(3)}`;
    }

    async function generateAllExamples() {
        const btn = document.getElementById('kipu-btn-genall');
        const lbl = document.getElementById('kipu-btn-genall-label');
        if (!btn) return;
        const targets = nodesWithoutExample();
        if (targets.length === 0) return;
        btn.disabled = true;
        let ok = 0, fail = 0;
        for (let i = 0; i < targets.length; i++) {
            const n = targets[i];
            lbl.textContent = `Generando ${i + 1} de ${targets.length}…`;
            try {
                await fetchExample(n.id);
                const c = state.exampleCache[n.id];
                if (c && c.example) {
                    ok++;
                    // También actualizamos el state.nodes para que el contador refleje
                    // que ese nodo ya tiene ejemplo (evita re-pedirlo si abren el panel).
                    n.example_message = c.example;
                } else {
                    fail++;
                }
            } catch (_) {
                fail++;
            }
            // Pausa breve entre llamadas para respetar el rate limit (5/min/bot).
            // 12.5s entre cada llamada → 5 por minuto exacto.
            if (i < targets.length - 1) await new Promise(r => setTimeout(r, 12500));
        }
        btn.disabled = false;
        updateGenAllButton();
        if (typeof showToast === 'function') {
            const msg = fail === 0
                ? `✓ ${ok} ejemplo${ok > 1 ? 's' : ''} generado${ok > 1 ? 's' : ''}`
                : `✓ ${ok} ok · ⚠ ${fail} falló${fail > 1 ? 'n' : ''}`;
            showToast(msg, fail === 0 ? 'success' : 'warning');
        }
    }
    window.kipuGenerateAllExamples = generateAllExamples;

    function renderSidePanel(nodeId) {
        const panel = document.getElementById('kipu-side-panel');
        if (!panel) return;
        const n = state.nodes.find(x => x.id === nodeId);
        if (!n) { panel.classList.remove('visible'); return; }

        const subLabel = nodeSubtitle(n);
        const chipsHtml = (n.live && Array.isArray(n.live.chips) && n.live.chips.length > 0)
            ? n.live.chips.map(c => `
                <span class="kipu-side-chip" title="${(c.label || '').replace(/"/g, '&quot;')}">
                    <span>${c.icon || '•'}</span>
                    <span>${(c.label || '').replace(/</g, '&lt;')}</span>
                    ${c.meta ? `<span class="kipu-side-chip-meta">${String(c.meta).replace(/</g, '&lt;')}</span>` : ''}
                </span>
              `).join('')
            : '';
        const liveSummary = (n.live && n.live.summary) ? `<div class="kipu-side-panel-desc" style="font-style: italic;">${String(n.live.summary).replace(/</g, '&lt;')}</div>` : '';

        // Outgoing edges — show each one with an editable label input
        const outgoing = state.edges.filter(e => e.from_node_id === nodeId);
        const edgesHtml = outgoing.length === 0
            ? '<div style="opacity:0.55;font-size:0.72rem;">Sin conexiones salientes</div>'
            : outgoing.map(e => {
                const target = state.nodes.find(x => x.id === e.to_node_id);
                const targetTitle = target ? (target.title || '').replace(/</g, '&lt;').slice(0, 40) : '(?)';
                const placeholder = (n.node_type === 'condition' || n.node_type === 'decision') ? 'Sí / No / …' : 'etiqueta (opcional)';
                return `
                    <div class="kipu-side-edge-row" data-edge-id="${e.id}">
                        <input type="text" class="kipu-side-edge-label" value="${(e.label || '').replace(/"/g, '&quot;')}" placeholder="${placeholder}" maxlength="120" />
                        <span class="kipu-side-edge-to">→ ${targetTitle}</span>
                        <button class="kipu-side-edge-delete" title="Eliminar conexión">×</button>
                    </div>
                `;
            }).join('');

        const pendingActions = (n.status === 'pending_confirmation')
            ? `<div class="kipu-side-panel-actions">
                 <button class="primary" data-act="approve">✓ Aprobar</button>
                 <button class="danger"  data-act="reject">× Rechazar</button>
               </div>`
            : '';

        // Solo mostramos la sección de ejemplo en pasos donde el bot habla
        // al cliente. Decisiones, handoffs, acciones del cliente, etc. no.
        const showExampleSection = nodeHasBotMessage(n);
        const exampleSectionHtml = showExampleSection ? `
            <div class="kipu-side-panel-example-section" id="kipu-example-section-${nodeId}">
                <div class="kipu-side-panel-example-header">
                    <div class="kipu-side-panel-section-title">Ejemplo de respuesta al cliente</div>
                    <button class="kipu-side-panel-example-regen" data-act="regen-example" title="Regenerar ejemplo">
                        <span aria-hidden="true">↻</span> Regenerar
                    </button>
                </div>
                <div id="kipu-example-body-${nodeId}">
                    ${renderExampleBody(nodeId)}
                </div>
                <div class="kipu-example-disclaimer">
                    Ejemplo aproximado. El bot puede variar la redacción según el cliente.
                </div>
            </div>
        ` : '';

        panel.innerHTML = `
            <button class="kipu-side-panel-close" title="Cerrar">×</button>
            <div class="kipu-side-panel-title">${(n.title || '').replace(/</g, '&lt;')}</div>
            <div class="kipu-side-panel-subtitle">${subLabel}${n.source === 'learned' ? ' · Aprendido' : ''}</div>
            <div class="kipu-side-panel-section-title" style="margin-top:6px;">Instrucción al bot</div>
            <div class="kipu-side-panel-desc">${(n.description || '').replace(/</g, '&lt;') || '<em style="opacity:0.55;">Sin descripción</em>'}</div>
            ${liveSummary}
            ${chipsHtml ? `<div class="kipu-side-panel-section">
                <div class="kipu-side-panel-section-title">Datos conectados</div>
                <div>${chipsHtml}</div>
            </div>` : ''}
            ${exampleSectionHtml}
            <div class="kipu-side-panel-section">
                <div class="kipu-side-panel-section-title">Conexiones salientes</div>
                ${edgesHtml}
            </div>
            <div class="kipu-side-panel-actions">
                <button class="primary" data-act="edit">Editar</button>
                <button data-act="duplicate">Duplicar</button>
                <button class="danger" data-act="delete">Eliminar</button>
            </div>
            ${pendingActions}
        `;
        panel.classList.add('visible');
        panel.querySelector('.kipu-side-panel-close').onclick = () => clearSelection();
        panel.querySelectorAll('button[data-act]').forEach(btn => {
            btn.onclick = () => {
                const act = btn.dataset.act;
                if (act === 'edit') openEditOverlay(nodeId);
                else if (act === 'duplicate') duplicateNodeAction(nodeId);
                else if (act === 'delete') deleteNodeAction(nodeId);
                else if (act === 'approve') approveLearnedNode(nodeId);
                else if (act === 'reject') deleteNodeAction(nodeId, true);
                else if (act === 'regen-example') regenerateExample(nodeId);
                else if (act === 'fetch-example') fetchExample(nodeId);
            };
        });
        // Lazy-load del ejemplo: solo si el nodo califica (saludo, ofrecer
        // productos, opciones de envío, solicitar datos, mostrar pagos,
        // verificación) y el cache aún no lo trae.
        if (showExampleSection) {
            const cache = state.exampleCache[nodeId];
            if (!cache || (!cache.example && !cache.error && !cache.loading)) {
                fetchExample(nodeId);
            }
        }
        // Wire edge-label inputs: persist on blur/Enter, delete on × click
        panel.querySelectorAll('.kipu-side-edge-row').forEach(row => {
            const edgeId = row.dataset.edgeId;
            const input = row.querySelector('.kipu-side-edge-label');
            const commit = () => {
                const newLabel = input.value.trim();
                const rec = state.edges.find(e => e.id === edgeId);
                if (!rec) return;
                if (newLabel === (rec.label || '')) return;
                updateEdgeLabel(edgeId, newLabel);
            };
            input.addEventListener('blur', commit);
            input.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
            });
            row.querySelector('.kipu-side-edge-delete').onclick = () => {
                if (confirm('¿Eliminar esta conexión?')) deleteEdgeAction(edgeId);
            };
        });
    }

    async function updateEdgeLabel(edgeId, newLabel) {
        const rec = state.edges.find(e => e.id === edgeId);
        if (!rec) return;
        if (state.demoMode) {
            rec.label = newLabel;
            const cyEdge = state.cy && state.cy.getElementById('e_' + edgeId);
            if (cyEdge && cyEdge.length) cyEdge.data('label', newLabel);
            return;
        }
        try {
            const updated = await api(`/workflow/${state.botId}/edges/${edgeId}`, 'PUT', { label: newLabel });
            Object.assign(rec, updated || { label: newLabel });
            const cyEdge = state.cy && state.cy.getElementById('e_' + edgeId);
            if (cyEdge && cyEdge.length) cyEdge.data('label', rec.label || '');
        } catch (e) {
            alert('No se pudo guardar la etiqueta: ' + e.message);
        }
    }

    // ─── Context menu (right-click) ────────────────────────────
    function openContextMenu(nodeId, clientX, clientY) {
        closeContextMenu();
        const menu = document.createElement('div');
        menu.id = 'kipu-context-menu';
        menu.className = 'kipu-context-menu';
        menu.style.left = clientX + 'px';
        menu.style.top = clientY + 'px';
        menu.innerHTML = `
            <div class="kipu-context-item" data-act="edit">✎  Editar</div>
            <div class="kipu-context-item" data-act="duplicate">⧉  Duplicar</div>
            <div class="kipu-context-sep"></div>
            <div class="kipu-context-item danger" data-act="delete">🗑  Eliminar</div>
        `;
        document.body.appendChild(menu);
        const rect = menu.getBoundingClientRect();
        if (rect.right > window.innerWidth) menu.style.left = (clientX - rect.width) + 'px';
        if (rect.bottom > window.innerHeight) menu.style.top = (clientY - rect.height) + 'px';
        menu.querySelectorAll('.kipu-context-item').forEach(item => {
            item.addEventListener('click', () => {
                const act = item.dataset.act;
                closeContextMenu();
                if (act === 'edit') openEditOverlay(nodeId);
                else if (act === 'duplicate') duplicateNodeAction(nodeId);
                else if (act === 'delete') deleteNodeAction(nodeId);
            });
        });
        setTimeout(() => document.addEventListener('click', closeContextMenuOnce, { once: true }), 0);
    }
    function closeContextMenuOnce() { closeContextMenu(); }
    function closeContextMenu() {
        const m = document.getElementById('kipu-context-menu');
        if (m) m.remove();
    }

    // ─── Demo banner ───────────────────────────────────────────
    function showDemoBanner(errMsg) {
        state.demoBannerMsg = String(errMsg || 'Modo demo');
        document.getElementById('kipu-mindmap-demo-banner')?.remove();
        const root = document.getElementById('kipu-mindmap-root');
        if (!root) return;
        const banner = document.createElement('div');
        banner.id = 'kipu-mindmap-demo-banner';
        banner.className = 'kipu-mindmap-demo-banner';
        banner.innerHTML = `<b>Modo demo:</b> las tablas de Supabase aún no existen, por eso los cambios no se guardan. Corre el SQL que te compartí en el SQL Editor y recarga. <span style="opacity:0.6;">(${String(state.demoBannerMsg).replace(/</g, '&lt;').slice(0, 80)})</span>`;
        root.appendChild(banner);
    }
    function ensureDemoBanner() {
        if (!state.demoMode) return;
        showDemoBanner(state.demoBannerMsg || 'Modo demo');
    }
    window.refreshMindmapDemoBanner = ensureDemoBanner;

    // ─── CRUD ──────────────────────────────────────────────────
    function persistNodePosition(nodeId) {
        if (state.demoMode) return;
        clearTimeout(state.saveTimers[nodeId]);
        state.saveTimers[nodeId] = setTimeout(async () => {
            const n = state.nodes.find(x => x.id === nodeId);
            if (!n) return;
            try {
                await api(`/workflow/${state.botId}/nodes/${nodeId}`, 'PUT',
                    { position_x: n.position_x, position_y: n.position_y });
                touchChromeAfterPersist();
            } catch (e) { console.warn('[mindmap] position save failed:', e); }
        }, 250);
    }

    async function duplicateNodeAction(nodeId) {
        const n = state.nodes.find(x => x.id === nodeId);
        if (!n) return;
        const payload = {
            title: (n.title || 'Nodo') + ' (copia)',
            description: n.description || '',
            node_type: n.node_type || 'step',
            source: 'custom',
            position_x: (n.position_x || 0) + 40,
            position_y: (n.position_y || 0) + 40,
            order_index: (state.nodes.length ? Math.max(...state.nodes.map(x => x.order_index || 0)) : 0) + 1
        };
        if (state.demoMode) {
            const node = { id: 'demo-' + Date.now(), bot_id: 'demo', status: 'active', metadata: {}, ...payload };
            state.nodes.push(node);
            addCyNode(node);
            return;
        }
        try {
            const node = await api(`/workflow/${state.botId}/nodes`, 'POST', payload);
            state.nodes.push(node);
            addCyNode(node);
        } catch (e) {
            if (typeof showToast === 'function') showToast('No se pudo duplicar: ' + e.message, 'error');
        }
    }

    window.kipuMindmapAddNode = async function (nodeType) {
        // Posición en la siguiente celda libre del snake — así no se apila
        // sobre nodos existentes ni queda fuera de pantalla.
        const cell = findNextSnakeCell();
        const modelX = cell.x;
        const modelY = cell.y;
        const type = (typeof nodeType === 'string' && nodeType) ? nodeType : 'step';
        const titleByType = {
            start_end: 'Inicio / Fin',
            step: 'Nuevo proceso',
            process: 'Nuevo proceso',
            condition: '¿Pregunta?',
            decision: '¿Pregunta?',
            handoff: 'HANDOFF: acción manual',
            config_requirement: "Requiere 'Configura tu Qhatu'",
            action: 'Nueva acción',
            note: 'Nota'
        };
        const newNodePayload = {
            title: titleByType[type] || 'Nuevo nodo',
            description: '',
            node_type: type,
            source: 'custom',
            position_x: modelX,
            position_y: modelY,
            order_index: (state.nodes.length ? Math.max(...state.nodes.map(n => n.order_index || 0)) : 0) + 1
        };
        if (state.demoMode) {
            const node = { id: 'demo-' + Date.now(), bot_id: 'demo', status: 'active', metadata: {}, ...newNodePayload };
            state.nodes.push(node);
            addCyNode(node);
            setTimeout(() => openEditOverlay(node.id), 100);
            return;
        }
        try {
            const node = await api(`/workflow/${state.botId}/nodes`, 'POST', newNodePayload);
            state.nodes.push(node);
            addCyNode(node);
            setTimeout(() => openEditOverlay(node.id), 100);
        } catch (e) {
            if (typeof showToast === 'function') showToast('No se pudo crear el nodo: ' + e.message, 'error');
        }
    };

    function addCyNode(node) {
        if (!state.cy) return;
        const feedsRender = computeFeedsRender(node);
        const hasBullets = !!(feedsRender && feedsRender.options && feedsRender.options.length > 0);
        const added = state.cy.add({
            group: 'nodes',
            data: {
                id: node.id,
                kind: 'node',
                title: feedsRender ? feedsRender.title : (node.title || ''),
                subtitle: nodeSubtitle(node),
                type: node.node_type || 'step',
                feeds: (node.metadata && node.metadata.feeds_from) || '',
                feedsEmpty: feedsRender && feedsRender.isEmpty ? 1 : 0,
                feedsKind: feedsRender ? feedsRender.feeds : '',
                hasBullets: hasBullets ? 1 : 0,
                pending: node.status === 'pending_confirmation' ? 1 : 0
            },
            position: { x: node.position_x || 0, y: node.position_y || 0 }
        });
        // Animación de entrada: fade-in + scale 0.8→1 en 250ms
        try {
            if (added && added.length) {
                added.style({ 'opacity': 0 });
                added.animate(
                    { style: { 'opacity': 1 } },
                    { duration: 250, easing: 'ease-out' }
                );
            }
        } catch (_) {}
    }

    function updateCyNode(nodeId) {
        if (!state.cy) return;
        const n = state.nodes.find(x => x.id === nodeId);
        if (!n) return;
        const el = state.cy.getElementById(nodeId);
        if (!el || !el.length) return;
        const newType = n.node_type || 'step';
        const feedsRender = computeFeedsRender(n);
        const hasBullets = !!(feedsRender && feedsRender.options && feedsRender.options.length > 0);
        el.data('title', feedsRender ? feedsRender.title : (n.title || ''));
        el.data('subtitle', nodeSubtitle(n));
        el.data('type', newType);
        el.data('feeds', (n.metadata && n.metadata.feeds_from) || '');
        el.data('feedsEmpty', feedsRender && feedsRender.isEmpty ? 1 : 0);
        el.data('feedsKind', feedsRender ? feedsRender.feeds : '');
        el.data('hasBullets', hasBullets ? 1 : 0);
        el.data('pending', n.status === 'pending_confirmation' ? 1 : 0);
        // Refresca sourceType en los edges salientes para que el color del
        // pill border y el "negative" detection sigan siendo correctos.
        try {
            state.cy.edges(`[source = "${nodeId}"]`).forEach(eEl => {
                eEl.data('sourceType', newType);
                eEl.data('dependency', newType === 'config_requirement' ? 1 : 0);
            });
        } catch (_) {}
    }

    function removeCyNode(nodeId) {
        if (!state.cy) return;
        const el = state.cy.getElementById(nodeId);
        if (el && el.length) el.remove();
    }

    function addCyEdge(edge) {
        if (!state.cy) return;
        const srcRec = state.nodes.find(n => n.id === edge.from_node_id);
        const srcType = (srcRec && srcRec.node_type) || 'step';
        const added = state.cy.add({
            group: 'edges',
            data: {
                id: 'e_' + edge.id,
                source: edge.from_node_id,
                target: edge.to_node_id,
                label: edge.label || '',
                edgeId: edge.id,
                dependency: srcType === 'config_requirement' ? 1 : 0,
                sourceType: srcType,
                negative: isNegativeLabel(edge.label) ? 1 : 0,
                backEdge: 0,
                longFwd: 0,
                bidir: 0
            }
        });
        scheduleN8nEdgeRedraw();
        // Animación dash inicial (~1s) cuando se conecta un edge nuevo, luego
        // queda sólida — feedback de "conexión hecha".
        try {
            if (added && added.length) {
                added.style({ 'line-style': 'dashed' });
                setTimeout(() => {
                    try { added.removeStyle('line-style'); } catch (_) {}
                }, 900);
            }
        } catch (_) {}
    }

    function removeCyEdge(edgeId) {
        if (!state.cy) return;
        const el = state.cy.getElementById('e_' + edgeId);
        if (el && el.length) el.remove();
    }

    // ─── Edit overlay ──────────────────────────────────────────
    function openEditOverlay(nodeId) {
        const n = state.nodes.find(x => x.id === nodeId);
        if (!n) return;

        // Si el nodo depende de una config externa (productos / envíos / pagos),
        // mostrar UI dedicada en lugar del formulario genérico.
        //   • products  → abre directamente el importador (única ruta)
        //   • shipping  → abre DIRECTO el modal de configuración de envíos
        //                 (mismo overlay que en la pestaña Envíos — sin Willy
        //                 ni popup intermedio).
        //   • payments  → abre DIRECTO el modal de métodos de pago.
        //
        // El gate antes era `state.botId && !state.demoMode` — pero `state.demoMode`
        // se activa cuando un bot real todavía no tiene workflow persistido (caso
        // común post-onboarding). En ese estado el bot SÍ existe y tiene la config
        // real cargada en `state.live`, así que estos overlays deben funcionar
        // igual. Sólo bloqueamos cuando no hay botId (mockup puro sin contexto).
        const feedsFrom = n.metadata && n.metadata.feeds_from;
        if (state.botId) {
            if (feedsFrom === 'products' && typeof window.openProductImportOverlay === 'function') {
                window.openProductImportOverlay();
                watchOverlayClose('product-import-overlay', () => refreshFromBackend());
                return;
            }
            if (feedsFrom === 'shipping') {
                if (typeof window.openShippingConfigOverlay === 'function') {
                    window.openShippingConfigOverlay(state.botId);
                    watchOverlayClose('shipping-mode-overlay', () => refreshFromBackend());
                    return;
                }
                // Fallback: si por alguna razón el overlay global no está cargado,
                // caemos al popup viejo para que el usuario igual pueda navegar.
                openFeedsOptionsModal(n.id, feedsFrom);
                return;
            }
            if (feedsFrom === 'payments') {
                if (typeof window.openPaymentMethodsOverlay === 'function') {
                    window.openPaymentMethodsOverlay(state.botId);
                    watchOverlayClose('payment-methods-modal-overlay', () => refreshFromBackend());
                    return;
                }
                openFeedsOptionsModal(n.id, feedsFrom);
                return;
            }
        }

        const old = document.getElementById('kipu-node-edit-overlay'); if (old) old.remove();
        const ov = document.createElement('div');
        ov.id = 'kipu-node-edit-overlay';
        ov.className = 'kipu-node-edit-overlay';
        ov.innerHTML = `
            <div class="kipu-node-edit-card">
                <h3>Editar nodo</h3>
                <label>Título</label>
                <input id="kme-title" type="text" value="${(n.title || '').replace(/"/g, '&quot;')}" maxlength="200">
                <label>Descripción / instrucción</label>
                <textarea id="kme-desc" rows="5" placeholder="Ej: Saluda al cliente y pregunta qué busca">${(n.description || '').replace(/</g, '&lt;')}</textarea>
                <label>Tipo</label>
                <select id="kme-type">
                    <option value="start_end"          ${n.node_type === 'start_end' ? 'selected' : ''}>Inicio / Fin (estadio)</option>
                    <option value="step"               ${(n.node_type === 'step' || n.node_type === 'process') ? 'selected' : ''}>Proceso (rectángulo)</option>
                    <option value="condition"          ${(n.node_type === 'condition' || n.node_type === 'decision') ? 'selected' : ''}>Decisión (diamante)</option>
                    <option value="handoff"            ${n.node_type === 'handoff' ? 'selected' : ''}>Handoff (subproceso manual)</option>
                    <option value="config_requirement" ${n.node_type === 'config_requirement' ? 'selected' : ''}>Requisito de configuración</option>
                    <option value="action"             ${n.node_type === 'action' ? 'selected' : ''}>Acción (legacy)</option>
                    <option value="note"               ${n.node_type === 'note' ? 'selected' : ''}>Nota (legacy)</option>
                </select>
                <div class="kipu-node-edit-actions">
                    <button class="cancel" id="kme-cancel">Cancelar</button>
                    <button class="save"   id="kme-save">Guardar</button>
                </div>
            </div>
        `;
        document.body.appendChild(ov);
        ov.addEventListener('click', (e) => { if (e.target === ov) ov.remove(); });
        document.getElementById('kme-cancel').onclick = () => ov.remove();
        document.getElementById('kme-save').onclick = async () => {
            const title = document.getElementById('kme-title').value.trim();
            const description = document.getElementById('kme-desc').value;
            const node_type = document.getElementById('kme-type').value;
            if (!title) { alert('El título es obligatorio'); return; }
            if (state.demoMode) {
                Object.assign(n, { title, description, node_type, source: 'custom' });
                updateCyNode(nodeId);
                if (state.selectedNodeId === nodeId) renderSidePanel(nodeId);
                ov.remove();
                return;
            }
            try {
                const updated = await api(`/workflow/${state.botId}/nodes/${nodeId}`, 'PUT', {
                    title, description, node_type, source: 'custom'
                });
                Object.assign(n, updated, { source: 'custom' });
                updateCyNode(nodeId);
                if (state.selectedNodeId === nodeId) renderSidePanel(nodeId);
                ov.remove();
            } catch (e) {
                alert('No se pudo guardar: ' + e.message);
            }
        };
    }

    // ─── Modal "Opciones del nodo" — read-only + link a la pestaña ────
    // Se abre al hacer click en un nodo feeds_from = shipping/payments.
    // Lista las opciones actuales (vienen de state.live, refrescadas al
    // entrar al editor) y ofrece un CTA primario para editarlas:
    //   • shipping → switchKipuTab('envios') — navega a la pestaña Envíos
    //   • payments → openPaymentMethodsOverlay(botId) — abre el modal de pagos
    function openFeedsOptionsModal(nodeId, feedsFrom) {
        const n = state.nodes.find(x => x.id === nodeId);
        if (!n) return;
        const r = computeFeedsRender(n) || { options: [], isEmpty: true, feeds: feedsFrom };
        const isShipping = feedsFrom === 'shipping';
        const headerLabel = isShipping ? 'Opciones de envío' : 'Métodos de pago';
        const subtitle = isShipping
            ? 'Lo que tus clientes verán como opciones de envío en WhatsApp'
            : 'Lo que tus clientes verán como métodos de pago disponibles';
        const editLabel = isShipping ? 'Editar en pestaña Envíos' : 'Editar métodos de pago';
        const emptyLabel = isShipping ? 'Sin envíos configurados' : 'Sin métodos de pago configurados';
        const emptyHint = isShipping
            ? 'Configura al menos una opción para que tus clientes puedan recibir sus pedidos.'
            : 'Configura al menos un método para que tus clientes puedan pagarte.';
        const icon = isShipping ? '🚚' : '💳';

        const old = document.getElementById('kipu-feeds-modal-overlay'); if (old) old.remove();
        const ov = document.createElement('div');
        ov.id = 'kipu-feeds-modal-overlay';
        ov.className = 'kipu-feeds-modal-overlay';

        const optionsHtml = r.isEmpty
            ? `<div class="kipu-feeds-modal-empty">
                   ⚠ ${emptyLabel}
                   <span class="kipu-feeds-modal-empty-hint">${emptyHint}</span>
               </div>`
            : `<ul class="kipu-feeds-modal-list">
                   ${r.options.map(o => `<li>${escapeHtml(o)}</li>`).join('')}
               </ul>`;

        ov.innerHTML = `
            <div class="kipu-feeds-modal-card">
                <div class="kipu-feeds-modal-header">
                    <div class="kipu-feeds-modal-icon ${r.isEmpty ? 'empty' : ''}">${icon}</div>
                    <div>
                        <h3 class="kipu-feeds-modal-title">${headerLabel}</h3>
                        <div class="kipu-feeds-modal-subtitle">${subtitle}</div>
                    </div>
                </div>
                ${optionsHtml}
                <div class="kipu-feeds-modal-actions">
                    <button id="kfm-cancel">Cerrar</button>
                    <button class="primary" id="kfm-edit">${editLabel}</button>
                </div>
            </div>
        `;
        document.body.appendChild(ov);
        ov.addEventListener('click', (e) => { if (e.target === ov) ov.remove(); });
        document.getElementById('kfm-cancel').onclick = () => ov.remove();
        document.getElementById('kfm-edit').onclick = () => {
            ov.remove();
            if (isShipping) {
                if (typeof window.switchKipuTab === 'function') {
                    window.switchKipuTab('envios');
                } else if (typeof window.openShippingConfigOverlay === 'function') {
                    window.openShippingConfigOverlay(state.botId);
                    watchOverlayClose('shipping-mode-overlay', () => refreshFromBackend());
                }
            } else {
                if (typeof window.openPaymentMethodsOverlay === 'function') {
                    window.openPaymentMethodsOverlay(state.botId);
                    watchOverlayClose('payment-methods-modal-overlay', () => refreshFromBackend());
                }
            }
        };
    }

    // Pequeño helper para evitar inyectar HTML del usuario al renderizar
    // los nombres de opción en el modal (defensa en profundidad — ya pasan
    // por save validation en sus respectivos formularios).
    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }

    // ─── Watch external overlays + refresh ─────────────────────
    function watchOverlayClose(overlayId, onClose) {
        let fired = false;
        const fire = (obs) => {
            if (fired) return;
            fired = true;
            obs.disconnect();
            onClose();
        };
        const tryAttach = () => {
            const el = document.getElementById(overlayId);
            if (!el) { setTimeout(tryAttach, 100); return; }
            const obs = new MutationObserver(() => {
                const stillThere = document.getElementById(overlayId);
                if (!stillThere) return fire(obs);
                const isHidden = stillThere.style.display === 'none'
                    || getComputedStyle(stillThere).display === 'none';
                if (isHidden) return fire(obs);
            });
            obs.observe(document.body, { childList: true, subtree: false });
            obs.observe(el, { attributes: true, attributeFilter: ['style', 'class'] });
        };
        tryAttach();
    }

    async function refreshFromBackend() {
        if (state.demoMode || !state.botId) return;
        const fetchForBot = _normBotId(state.botId);
        try {
            const [map] = await Promise.all([
                api('/workflow/' + encodeURIComponent(state.botId)),
                loadLiveConfig()
            ]);
            if (_normBotId(state.botId) !== fetchForBot) return;
            if (!map || !Array.isArray(map.nodes)) return;
            const oldPositions = new Map(state.nodes.map(n => [n.id, { x: n.position_x, y: n.position_y }]));
            applyWorkflowMapToState(map);
            state.nodes = state.nodes.map(n => {
                const p = oldPositions.get(n.id);
                return p ? { ...n, position_x: p.x, position_y: p.y } : n;
            });

            // Aplica el alignment también en refresh — sin esto, revisitar el
            // tab Workflow trae los nodos genéricos del backend (incluyendo
            // resolve_multi) y los muestra sin colapsar la rama duplicada.
            try { alignWorkflowToLiveConfig(); } catch (e) { console.warn('[mindmap] align in refresh failed:', e); }

            // Rebuild Cytoscape elements in place
            if (state.cy) {
                state.cy.elements().remove();
                state.cy.add(buildCyElements());
                if (state.selectedNodeId) renderSidePanel(state.selectedNodeId);
            }
            // Tras refrescar nodos puede haber más/menos sin ejemplo — re-evalúa
            // visibilidad del botón "Generar ejemplos".
            try { updateGenAllButton(); } catch (_) {}
        } catch (e) {
            console.warn('[mindmap] refresh failed:', e);
        }
    }

    // ─── Delete + approve ──────────────────────────────────────
    async function deleteNodeAction(nodeId, silent) {
        if (!silent && !confirm('¿Eliminar este nodo? Esta acción es permanente.')) return;
        // Si el nodo borrado era auto-layout, re-snake los demás auto para
        // cerrar el hueco. Los manuales se quedan donde están.
        const wasAuto = (() => {
            const n = state.nodes.find(x => x.id === nodeId);
            return n ? !isManualPosition(n) : false;
        })();
        if (state.demoMode) {
            state.nodes = state.nodes.filter(n => n.id !== nodeId);
            state.edges = state.edges.filter(e => e.from_node_id !== nodeId && e.to_node_id !== nodeId);
            removeCyNode(nodeId);
            if (state.selectedNodeId === nodeId) clearSelection();
            if (wasAuto) runSnakeLayout();
            return;
        }
        try {
            await api(`/workflow/${state.botId}/nodes/${nodeId}`, 'DELETE');
            state.nodes = state.nodes.filter(n => n.id !== nodeId);
            state.edges = state.edges.filter(e => e.from_node_id !== nodeId && e.to_node_id !== nodeId);
            removeCyNode(nodeId);
            if (state.selectedNodeId === nodeId) clearSelection();
            if (wasAuto) runSnakeLayout();
        } catch (e) {
            alert('No se pudo eliminar: ' + e.message);
        }
    }

    async function approveLearnedNode(nodeId) {
        try {
            const updated = await api(`/workflow/${state.botId}/nodes/${nodeId}`, 'PUT', { status: 'active', source: 'custom' });
            const i = state.nodes.findIndex(n => n.id === nodeId);
            if (i >= 0) state.nodes[i] = updated;
            updateCyNode(nodeId);
            if (state.selectedNodeId === nodeId) renderSidePanel(nodeId);
        } catch (e) {
            alert('No se pudo aprobar: ' + e.message);
        }
    }

    // ─── Connection (edges) ────────────────────────────────────
    async function finishConnect(fromNodeId, toNodeId) {
        // Duplicate guard
        if (state.edges.find(e => e.from_node_id === fromNodeId && e.to_node_id === toNodeId)) return;
        // Prompt for a label when the source is a decision (Yes / No / Maybe).
        let label = '';
        const srcNode = state.nodes.find(n => n.id === fromNodeId);
        if (srcNode && srcNode.node_type === 'condition') {
            const typed = prompt('Etiqueta de la flecha (ej. "Sí", "No", "Maybe"). Déjalo vacío para ninguna:', '');
            if (typed != null) label = typed.trim();
        }
        if (state.demoMode) {
            const edge = { id: 'demo-edge-' + Date.now(), bot_id: 'demo', from_node_id: fromNodeId, to_node_id: toNodeId, label };
            state.edges.push(edge);
            addCyEdge(edge);
            return;
        }
        try {
            const edge = await api(`/workflow/${state.botId}/edges`, 'POST', { from_node_id: fromNodeId, to_node_id: toNodeId, label });
            state.edges.push(edge);
            addCyEdge(edge);
        } catch (e) {
            alert('No se pudo conectar: ' + e.message);
        }
    }

    async function deleteEdgeAction(edgeId) {
        if (state.demoMode) {
            state.edges = state.edges.filter(e => e.id !== edgeId);
            removeCyEdge(edgeId);
            return;
        }
        try {
            await api(`/workflow/${state.botId}/edges/${edgeId}`, 'DELETE');
            state.edges = state.edges.filter(e => e.id !== edgeId);
            removeCyEdge(edgeId);
        } catch (e) {
            alert('No se pudo eliminar la conexión: ' + e.message);
        }
    }

    // ─── Recenter exported helper ──────────────────────────────
    window.kipuMindmapRecenter = function () {
        if (state.cy) state.cy.fit(undefined, 60);
    };
})();

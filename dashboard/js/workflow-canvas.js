/* ═══════════════════════════════════════════════════════════════════════
   Workflow Canvas — editor visual del workflow con sections + nodes
   + arrows posicionados absolutamente sobre un canvas pannable/zoomable.

   Reemplaza el mindmap cytoscape anterior con un diseño estático más
   editorial: 6 secciones coloreadas (Bienvenida/Productos/Envío/Datos/
   Pago/Cierre), 12+ nodos con íconos por tipo, flechas SVG con labels,
   y nodos decisión en forma de diamante.

   Self-contained: monta su HTML+CSS+JS dentro de #workflow-canvas-host
   cuando initWorkflowCanvas() es llamado.
   ═══════════════════════════════════════════════════════════════════════ */

(function() {
    'use strict';

    const STYLES = `
        #workflow-canvas-host { font-family: 'Inter', -apple-system, sans-serif; }
        #workflow-canvas-root {
            --wc-navy: #1a2942;
            --wc-navy-soft: #2a3a55;
            --wc-orange: #e85d3a;
            --wc-orange-soft: #f47556;
            --wc-orange-bg: #fff1ec;
            --wc-orange-border: #ffd4c4;
            --wc-gold: #d4a04a;
            --wc-gold-bg: #fdf6e8;
            --wc-green: #16a34a;
            --wc-green-bg: #ecfdf5;
            --wc-gray-50: #fafafa;
            --wc-gray-100: #f4f5f7;
            --wc-gray-200: #e5e7eb;
            --wc-gray-300: #d1d5db;
            --wc-gray-400: #9ca3af;
            --wc-gray-500: #6b7280;
            --wc-gray-600: #4b5563;
            --wc-border: #e5e7eb;
            --wc-text-secondary: #4b5563;
            --wc-text-muted: #9ca3af;
            --wc-shadow-sm: 0 1px 2px rgba(17,24,39,0.04), 0 1px 3px rgba(17,24,39,0.06);
            --wc-shadow-md: 0 4px 12px rgba(17,24,39,0.05), 0 2px 4px rgba(17,24,39,0.04);

            --sec-purple-bg: #f5f0ff; --sec-purple-border: #c4b5fd; --sec-purple-text: #6d28d9; --sec-purple-node: #ddd6fe;
            --sec-blue-bg: #eff6ff;   --sec-blue-border: #93c5fd;   --sec-blue-text: #1d4ed8;   --sec-blue-node: #bfdbfe;
            --sec-green-bg: #f0fdf4;  --sec-green-border: #86efac;  --sec-green-text: #166534;  --sec-green-node: #bbf7d0;
            --sec-amber-bg: #fffbeb;  --sec-amber-border: #fcd34d;  --sec-amber-text: #92400e;  --sec-amber-node: #fde68a;
            --sec-coral-bg: #fff5f0;  --sec-coral-border: #fda77a;  --sec-coral-text: #9a3412;  --sec-coral-node: #fed7aa;
            --sec-cyan-bg: #ecfeff;   --sec-cyan-border: #67e8f9;   --sec-cyan-text: #155e75;   --sec-cyan-node: #a5f3fc;

            background: #fff;
            border: none;
            border-radius: 0;
            overflow: hidden;
            display: flex; flex-direction: column;
            height: 100%;
            min-height: 0;
            color: var(--wc-navy);
            font-size: 14px;
        }
        #section-create-bot.active #workflow-canvas-host {
            flex: 1; min-height: 0;
            display: flex; flex-direction: column;
        }
        #section-create-bot.active #workflow-canvas-host > #workflow-canvas-root {
            flex: 1; min-height: 0;
        }

        /* Top toolbar — Añadir nodo + count + view toggle + save + Exportar + Publicar */
        .wc-toolbar {
            display: flex; align-items: center; justify-content: space-between;
            padding: 12px 22px;
            background: #fff;
            border-bottom: 1px solid var(--wc-border);
            flex-shrink: 0;
            gap: 12px;
            flex-wrap: wrap;
        }
        .wc-toolbar-left { display: flex; align-items: center; gap: 14px; }
        .wc-toolbar-right { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .wc-node-count { color: var(--wc-text-muted); font-size: 12px; }

        .wc-btn-orange {
            background: var(--wc-orange); color: #fff;
            border: none; font-family: inherit;
            font-size: 13px; font-weight: 600;
            padding: 8px 14px; border-radius: 8px;
            cursor: pointer; transition: all 0.15s ease;
            display: inline-flex; align-items: center; gap: 6px;
            box-shadow: 0 2px 8px rgba(232,93,58,0.2);
        }
        .wc-btn-orange:hover { background: var(--wc-orange-soft); transform: translateY(-1px); }
        .wc-btn-orange svg { width: 13px; height: 13px; }

        .wc-view-toggle {
            display: inline-flex; background: var(--wc-gray-100);
            border-radius: 9px; padding: 3px;
        }
        .wc-view-btn {
            background: transparent; border: none;
            padding: 6px 12px; border-radius: 6px;
            font-family: inherit; font-size: 12px; font-weight: 600;
            color: var(--wc-text-secondary); cursor: pointer;
            transition: all 0.15s ease;
        }
        .wc-view-btn:hover { color: var(--wc-navy); }
        .wc-view-btn.is-active {
            background: var(--wc-navy); color: #fff;
            box-shadow: var(--wc-shadow-sm);
        }

        .wc-save-status {
            display: inline-flex; align-items: center; gap: 6px;
            font-size: 12px; color: var(--wc-text-muted);
            padding: 0 6px;
        }
        .wc-save-status .dot {
            width: 6px; height: 6px; border-radius: 50%;
            background: var(--wc-green);
        }

        .wc-btn-secondary {
            background: #fff; color: var(--wc-navy);
            border: 1px solid var(--wc-gray-200);
            font-family: inherit; font-size: 12.5px; font-weight: 600;
            padding: 8px 14px; border-radius: 8px;
            cursor: pointer;
            display: inline-flex; align-items: center; gap: 6px;
            transition: all 0.15s ease;
        }
        .wc-btn-secondary:hover { border-color: var(--wc-gray-300); background: var(--wc-gray-50); }
        .wc-btn-secondary svg { width: 13px; height: 13px; }

        .wc-btn-primary {
            background: var(--wc-navy); color: #fff;
            border: none; font-family: inherit;
            font-size: 13px; font-weight: 600;
            padding: 8px 16px; border-radius: 8px;
            cursor: pointer; transition: all 0.15s ease;
            display: inline-flex; align-items: center; gap: 6px;
        }
        .wc-btn-primary:hover { background: var(--wc-navy-soft); }
        .wc-btn-primary svg { width: 13px; height: 13px; }

        /* Canvas wrap */
        .wc-canvas-wrap {
            flex: 1; min-height: 0;
            overflow: hidden;
            position: relative;
            background: #fafbfc;
            background-image: radial-gradient(circle at 1px 1px, var(--wc-gray-200) 1px, transparent 0);
            background-size: 20px 20px;
            cursor: grab;
        }
        .wc-canvas-wrap.is-panning { cursor: grabbing; }
        .wc-canvas {
            position: absolute;
            top: 0; left: 0;
            width: 2000px; height: 800px;
            transform-origin: 0 0;
            transition: transform 0.05s ease-out;
        }
        .wc-canvas.is-panning { transition: none; }

        /* Sections (colored dashed containers) */
        .wc-sec {
            position: absolute;
            border: 2px dashed;
            border-radius: 14px;
            padding: 26px 14px 14px;
        }
        .wc-sec.purple { background: var(--sec-purple-bg); border-color: var(--sec-purple-border); }
        .wc-sec.blue   { background: var(--sec-blue-bg);   border-color: var(--sec-blue-border); }
        .wc-sec.green  { background: var(--sec-green-bg);  border-color: var(--sec-green-border); }
        .wc-sec.amber  { background: var(--sec-amber-bg);  border-color: var(--sec-amber-border); }
        .wc-sec.coral  { background: var(--sec-coral-bg);  border-color: var(--sec-coral-border); }
        .wc-sec.cyan   { background: var(--sec-cyan-bg);   border-color: var(--sec-cyan-border); }

        .wc-sec-label {
            position: absolute;
            top: -11px; left: 16px;
            background: #fff;
            padding: 1px 9px;
            border-radius: 5px;
            font-size: 10px; font-weight: 700;
            letter-spacing: 0.16em;
            text-transform: uppercase;
            border: 1px solid;
        }
        .wc-sec.purple .wc-sec-label { color: var(--sec-purple-text); border-color: var(--sec-purple-border); }
        .wc-sec.blue .wc-sec-label   { color: var(--sec-blue-text);   border-color: var(--sec-blue-border); }
        .wc-sec.green .wc-sec-label  { color: var(--sec-green-text);  border-color: var(--sec-green-border); }
        .wc-sec.amber .wc-sec-label  { color: var(--sec-amber-text);  border-color: var(--sec-amber-border); }
        .wc-sec.coral .wc-sec-label  { color: var(--sec-coral-text);  border-color: var(--sec-coral-border); }
        .wc-sec.cyan .wc-sec-label   { color: var(--sec-cyan-text);   border-color: var(--sec-cyan-border); }

        /* Nodes */
        .wc-node {
            position: absolute;
            background: #fff;
            border: 1.5px solid;
            border-radius: 10px;
            padding: 10px 12px;
            width: 168px;
            box-shadow: var(--wc-shadow-sm);
            transition: all 0.15s ease;
            cursor: pointer;
            font-size: 11.5px;
            line-height: 1.35;
            color: var(--wc-navy);
            text-align: center;
            z-index: 2;
        }
        .wc-node:hover {
            box-shadow: var(--wc-shadow-md);
            transform: translateY(-1px);
        }
        .wc-node.is-selected {
            border-color: var(--wc-orange) !important;
            box-shadow: 0 0 0 3px var(--wc-orange-bg), var(--wc-shadow-md);
        }
        .wc-node.purple { border-color: var(--sec-purple-node); }
        .wc-node.blue   { border-color: var(--sec-blue-node); }
        .wc-node.green  { border-color: var(--sec-green-node); }
        .wc-node.amber  { border-color: var(--sec-amber-node); }
        .wc-node.coral  { border-color: var(--sec-coral-node); }
        .wc-node.cyan   { border-color: var(--sec-cyan-node); }

        .wc-node-icon {
            display: inline-flex;
            width: 22px; height: 22px;
            border-radius: 5px;
            margin-bottom: 5px;
            align-items: center; justify-content: center;
        }
        .wc-node.purple .wc-node-icon { background: var(--sec-purple-bg); color: var(--sec-purple-text); }
        .wc-node.blue .wc-node-icon   { background: var(--sec-blue-bg);   color: var(--sec-blue-text); }
        .wc-node.green .wc-node-icon  { background: var(--sec-green-bg);  color: var(--sec-green-text); }
        .wc-node.amber .wc-node-icon  { background: var(--sec-amber-bg);  color: var(--sec-amber-text); }
        .wc-node.coral .wc-node-icon  { background: var(--sec-coral-bg);  color: var(--sec-coral-text); }
        .wc-node.cyan .wc-node-icon   { background: var(--sec-cyan-bg);   color: var(--sec-cyan-text); }
        .wc-node-icon svg { width: 11px; height: 11px; }

        /* Handoff variant — gold accent */
        .wc-node.handoff {
            background: var(--wc-gold-bg);
            border-color: var(--wc-gold);
        }
        .wc-node.handoff .wc-node-icon { background: #fff; color: var(--wc-gold); }

        /* Decision diamond */
        .wc-node-decision {
            position: absolute;
            width: 130px; height: 130px;
            z-index: 2;
            cursor: pointer;
        }
        .wc-diamond-shape {
            position: absolute;
            inset: 8px;
            background: #fff;
            border: 1.5px solid;
            transform: rotate(45deg);
            border-radius: 10px;
            box-shadow: var(--wc-shadow-sm);
            transition: all 0.15s ease;
        }
        .wc-node-decision:hover .wc-diamond-shape {
            box-shadow: var(--wc-shadow-md);
            transform: rotate(45deg) translateY(-1px);
        }
        .wc-node-decision.is-selected .wc-diamond-shape {
            border-color: var(--wc-orange) !important;
            box-shadow: 0 0 0 3px var(--wc-orange-bg), var(--wc-shadow-md);
        }
        .wc-node-decision.blue .wc-diamond-shape  { border-color: var(--sec-blue-text); }
        .wc-node-decision.coral .wc-diamond-shape { border-color: var(--sec-coral-text); }
        .wc-diamond-content {
            position: relative;
            z-index: 1;
            width: 100%; height: 100%;
            display: flex; flex-direction: column;
            align-items: center; justify-content: center;
            padding: 10px;
            font-size: 11px;
            font-weight: 600;
            text-align: center;
            color: var(--wc-navy);
            line-height: 1.25;
        }
        .wc-diamond-content .wc-node-icon { margin-bottom: 4px; }
        .wc-node-decision.blue .wc-node-icon { background: var(--sec-blue-bg); color: var(--sec-blue-text); }
        .wc-node-decision.coral .wc-node-icon { background: var(--sec-coral-bg); color: var(--sec-coral-text); }

        /* Arrows */
        .wc-arrows {
            position: absolute;
            top: 0; left: 0;
            width: 100%; height: 100%;
            pointer-events: none;
            z-index: 1;
        }
        .wc-arrow-path {
            fill: none;
            stroke: var(--wc-navy);
            stroke-width: 1.6;
            opacity: 0.55;
        }
        .wc-arrow-path.is-loop {
            stroke: var(--wc-orange);
            opacity: 0.7;
            stroke-dasharray: 4 4;
        }
        .wc-arrow-label {
            fill: var(--wc-navy);
            font-family: 'Inter', sans-serif;
            font-size: 10.5px;
            font-weight: 600;
            opacity: 0.85;
        }
        .wc-arrow-label-bg {
            fill: #fff;
            opacity: 0.95;
        }

        /* Zoom controls */
        .wc-zoom-controls {
            position: absolute;
            bottom: 20px; right: 20px;
            display: flex; align-items: center;
            background: #fff;
            border: 1px solid var(--wc-gray-200);
            border-radius: 10px;
            box-shadow: var(--wc-shadow-md);
            padding: 4px;
            gap: 2px;
            z-index: 10;
        }
        .wc-zoom-btn {
            width: 32px; height: 32px;
            border-radius: 7px; border: none;
            background: transparent; color: var(--wc-navy);
            cursor: pointer;
            display: grid; place-items: center;
            transition: background 0.15s ease;
        }
        .wc-zoom-btn:hover { background: var(--wc-gray-100); }
        .wc-zoom-btn svg { width: 14px; height: 14px; }
        .wc-zoom-display {
            min-width: 50px;
            text-align: center;
            font-size: 12px;
            font-weight: 600;
            color: var(--wc-navy);
            padding: 0 4px;
            font-family: 'Fraunces', serif;
        }
        .wc-zoom-divider { width: 1px; height: 20px; background: var(--wc-gray-200); margin: 0 2px; }

        /* Hint */
        .wc-canvas-hint {
            position: absolute;
            bottom: 20px; left: 20px;
            display: flex; align-items: center; gap: 8px;
            background: #fff;
            border: 1px solid var(--wc-gray-200);
            border-radius: 10px;
            box-shadow: var(--wc-shadow-md);
            padding: 6px 12px 6px 8px;
            z-index: 10;
            font-size: 11.5px; color: var(--wc-text-secondary);
        }
        .wc-canvas-hint svg { width: 14px; height: 14px; color: var(--wc-text-muted); }
    `;

    // ── INIT ────────────────────────────────────────────────────────
    let mounted = false;
    let scale = 0.6;
    let translateX = 40;
    let translateY = 20;
    let isPanning = false;
    let startPan = { x: 0, y: 0 };

    window.initWorkflowCanvas = function() {
        const host = document.getElementById('workflow-canvas-host');
        if (!host) return;
        if (!mounted) {
            mountStyles();
            host.innerHTML = baseHTML();
            attachListeners();
            mounted = true;
            // Initial fit
            requestAnimationFrame(() => fitToScreen());
        } else {
            // Re-fit when re-shown
            requestAnimationFrame(() => fitToScreen());
        }
    };

    function mountStyles() {
        if (document.getElementById('workflow-canvas-styles')) return;
        const s = document.createElement('style');
        s.id = 'workflow-canvas-styles';
        s.textContent = STYLES;
        document.head.appendChild(s);
    }

    function baseHTML() {
        return `
            <div id="workflow-canvas-root">
                <div class="wc-toolbar">
                    <div class="wc-toolbar-left">
                        <button type="button" class="wc-btn-orange" id="wc-add-node">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
                            Añadir nodo
                        </button>
                        <span class="wc-node-count">12 nodos · 6 secciones</span>
                    </div>
                    <div class="wc-toolbar-right">
                        <div class="wc-view-toggle">
                            <button type="button" class="wc-view-btn is-active" data-wc-view="all">Todo</button>
                            <button type="button" class="wc-view-btn" data-wc-view="botones">Botones</button>
                            <button type="button" class="wc-view-btn" data-wc-view="conv">Conversacional</button>
                        </div>
                        <div class="wc-save-status">
                            <span class="dot"></span>
                            <span>Guardado</span>
                        </div>
                        <button type="button" class="wc-btn-secondary">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                            Exportar
                        </button>
                        <button type="button" class="wc-btn-primary">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
                            Publicar
                        </button>
                    </div>
                </div>

                <div class="wc-canvas-wrap" id="wc-canvas-wrap">
                    <div class="wc-canvas" id="wc-canvas">

                        <!-- SECTION: BIENVENIDA -->
                        <div class="wc-sec purple" style="left:60px; top:120px; width:200px; height:340px;">
                            <div class="wc-sec-label">Bienvenida</div>
                            <div class="wc-node purple" style="left:16px; top:36px;" data-node="n1">
                                <div class="wc-node-icon">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><polyline points="9 12 11 14 16 9"/></svg>
                                </div>
                                <div>Cliente escribe<br>al WhatsApp</div>
                            </div>
                            <div class="wc-node purple" style="left:16px; top:190px;" data-node="n2">
                                <div class="wc-node-icon">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                                </div>
                                <div>Saludo inicial<br>+ ofrecer ayuda</div>
                            </div>
                        </div>

                        <!-- SECTION: PRODUCTOS -->
                        <div class="wc-sec blue" style="left:340px; top:90px; width:240px; height:540px;">
                            <div class="wc-sec-label">Productos</div>
                            <div class="wc-node blue" style="left:34px; top:36px;" data-node="n3">
                                <div class="wc-node-icon">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                                </div>
                                <div>Cliente pregunta<br>por productos</div>
                            </div>
                            <div class="wc-node blue" style="left:34px; top:180px;" data-node="n4">
                                <div class="wc-node-icon">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
                                </div>
                                <div>Ofrecer catálogo<br>de productos</div>
                            </div>
                            <div class="wc-node-decision blue" style="left:50px; top:340px;" data-node="n5">
                                <div class="wc-diamond-shape"></div>
                                <div class="wc-diamond-content">
                                    <div class="wc-node-icon">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><circle cx="12" cy="16" r="0.5" fill="currentColor"/></svg>
                                    </div>
                                    <div>¿Qué hace<br>el cliente?</div>
                                </div>
                            </div>
                        </div>

                        <!-- SECTION: ENVÍO -->
                        <div class="wc-sec green" style="left:660px; top:160px; width:220px; height:240px;">
                            <div class="wc-sec-label">Envío</div>
                            <div class="wc-node green" style="left:24px; top:36px;" data-node="n6">
                                <div class="wc-node-icon">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
                                </div>
                                <div>Opciones de envío<br>según región</div>
                            </div>
                        </div>

                        <!-- SECTION: DATOS CLIENTE -->
                        <div class="wc-sec amber" style="left:960px; top:170px; width:220px; height:220px;">
                            <div class="wc-sec-label">Datos cliente</div>
                            <div class="wc-node amber" style="left:24px; top:36px;" data-node="n7">
                                <div class="wc-node-icon">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="14" y2="13"/></svg>
                                </div>
                                <div>Solicitar nombre,<br>celular y DNI</div>
                            </div>
                        </div>

                        <!-- SECTION: PAGO -->
                        <div class="wc-sec coral" style="left:1260px; top:80px; width:240px; height:580px;">
                            <div class="wc-sec-label">Pago</div>
                            <div class="wc-node coral" style="left:24px; top:36px;" data-node="n8">
                                <div class="wc-node-icon">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
                                </div>
                                <div>Mostrar métodos<br>de pago configurados</div>
                            </div>
                            <div class="wc-node coral" style="left:24px; top:180px;" data-node="n9">
                                <div class="wc-node-icon">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                                </div>
                                <div>Cliente envía<br>foto del comprobante</div>
                            </div>
                            <div class="wc-node handoff" style="left:24px; top:320px;" data-node="n10">
                                <div class="wc-node-icon">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
                                </div>
                                <div><strong>HANDOFF</strong><br>Emprendedor<br>confirma el pago</div>
                            </div>
                            <div class="wc-node-decision coral" style="left:40px; top:470px;" data-node="n11">
                                <div class="wc-diamond-shape"></div>
                                <div class="wc-diamond-content">
                                    <div class="wc-node-icon">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><polyline points="9 12 11 14 16 9"/></svg>
                                    </div>
                                    <div>¿Pago<br>confirmado?</div>
                                </div>
                            </div>
                        </div>

                        <!-- SECTION: CIERRE -->
                        <div class="wc-sec cyan" style="left:1580px; top:200px; width:220px; height:200px;">
                            <div class="wc-sec-label">Cierre</div>
                            <div class="wc-node cyan" style="left:24px; top:36px;" data-node="n12">
                                <div class="wc-node-icon">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
                                </div>
                                <div>Agradecimiento<br>+ info de envío</div>
                            </div>
                        </div>

                        <!-- ARROWS -->
                        <svg class="wc-arrows" viewBox="0 0 2000 800" preserveAspectRatio="none">
                            <defs>
                                <marker id="wc-arrowhead" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                                    <path d="M 0 0 L 10 5 L 0 10 z" fill="#1a2942" opacity="0.55"/>
                                </marker>
                                <marker id="wc-arrowhead-orange" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                                    <path d="M 0 0 L 10 5 L 0 10 z" fill="#e85d3a" opacity="0.7"/>
                                </marker>
                            </defs>

                            <!-- n1 → n2 -->
                            <path class="wc-arrow-path" d="M 160 220 L 160 290" marker-end="url(#wc-arrowhead)"/>
                            <!-- n2 → n3 -->
                            <path class="wc-arrow-path" d="M 260 320 C 310 320, 320 200, 374 200" marker-end="url(#wc-arrowhead)"/>
                            <!-- n3 → n4 -->
                            <path class="wc-arrow-path" d="M 458 268 L 458 320" marker-end="url(#wc-arrowhead)"/>
                            <!-- n4 → n5 -->
                            <path class="wc-arrow-path" d="M 458 410 L 458 470" marker-end="url(#wc-arrowhead)"/>
                            <!-- n5 → n6 con label -->
                            <path class="wc-arrow-path" d="M 518 500 C 600 500, 600 270, 678 270" marker-end="url(#wc-arrowhead)"/>
                            <rect class="wc-arrow-label-bg" x="595" y="370" width="100" height="16" rx="3"/>
                            <text class="wc-arrow-label" x="645" y="383" text-anchor="middle">Decide comprar</text>
                            <!-- n5 → n4 loop -->
                            <path class="wc-arrow-path is-loop" d="M 460 570 C 380 620, 320 600, 320 380 C 320 290, 372 280, 414 268" marker-end="url(#wc-arrowhead-orange)"/>
                            <rect class="wc-arrow-label-bg" x="285" y="510" width="100" height="16" rx="3"/>
                            <text class="wc-arrow-label" x="335" y="523" text-anchor="middle" fill="#e85d3a">Pregunta más</text>
                            <!-- n6 → n7 -->
                            <path class="wc-arrow-path" d="M 880 270 C 940 270, 940 240, 984 240" marker-end="url(#wc-arrowhead)"/>
                            <!-- n7 → n8 -->
                            <path class="wc-arrow-path" d="M 1180 240 C 1230 240, 1240 122, 1284 122" marker-end="url(#wc-arrowhead)"/>
                            <!-- n8 → n9 -->
                            <path class="wc-arrow-path" d="M 1380 192 L 1380 260" marker-end="url(#wc-arrowhead)"/>
                            <!-- n9 → n10 -->
                            <path class="wc-arrow-path" d="M 1380 340 L 1380 400" marker-end="url(#wc-arrowhead)"/>
                            <!-- n10 → n11 -->
                            <path class="wc-arrow-path" d="M 1380 480 L 1380 560" marker-end="url(#wc-arrowhead)"/>
                            <!-- n11 → n12 con label "Sí" -->
                            <path class="wc-arrow-path" d="M 1450 600 C 1520 600, 1530 300, 1604 300" marker-end="url(#wc-arrowhead)"/>
                            <rect class="wc-arrow-label-bg" x="1530" y="440" width="34" height="16" rx="3"/>
                            <text class="wc-arrow-label" x="1547" y="453" text-anchor="middle">Sí</text>
                            <!-- n11 → n9 loop No -->
                            <path class="wc-arrow-path is-loop" d="M 1310 600 C 1240 600, 1240 320, 1284 300" marker-end="url(#wc-arrowhead-orange)"/>
                            <rect class="wc-arrow-label-bg" x="1238" y="510" width="34" height="16" rx="3"/>
                            <text class="wc-arrow-label" x="1255" y="523" text-anchor="middle" fill="#e85d3a">No</text>
                        </svg>
                    </div>

                    <!-- Zoom controls -->
                    <div class="wc-zoom-controls">
                        <button class="wc-zoom-btn" id="wc-zoom-out" title="Alejar">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>
                        </button>
                        <div class="wc-zoom-display" id="wc-zoom-display">60%</div>
                        <button class="wc-zoom-btn" id="wc-zoom-in" title="Acercar">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                        </button>
                        <div class="wc-zoom-divider"></div>
                        <button class="wc-zoom-btn" id="wc-zoom-fit" title="Ajustar a pantalla">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
                        </button>
                        <button class="wc-zoom-btn" id="wc-zoom-reset" title="Restaurar vista">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
                        </button>
                    </div>

                    <!-- Hint -->
                    <div class="wc-canvas-hint">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8" fill="currentColor"/></svg>
                        Click en cualquier nodo para editarlo
                    </div>
                </div>
            </div>
        `;
    }

    // ── PAN/ZOOM ────────────────────────────────────────────────────
    function applyTransform() {
        const canvas = document.getElementById('wc-canvas');
        const display = document.getElementById('wc-zoom-display');
        if (canvas) canvas.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
        if (display) display.textContent = Math.round(scale * 100) + '%';
    }

    function fitToScreen() {
        const wrap = document.getElementById('wc-canvas-wrap');
        if (!wrap) return;
        const rect = wrap.getBoundingClientRect();
        if (rect.width < 50 || rect.height < 50) return;
        const canvasW = 2000;
        const canvasH = 800;
        const padding = 40;
        const scaleX = (rect.width - padding * 2) / canvasW;
        const scaleY = (rect.height - padding * 2) / canvasH;
        scale = Math.min(scaleX, scaleY, 1);
        translateX = (rect.width - canvasW * scale) / 2;
        translateY = (rect.height - canvasH * scale) / 2;
        applyTransform();
    }

    function resetView() {
        scale = 0.6;
        translateX = 40;
        translateY = 20;
        applyTransform();
    }

    // ── LISTENERS ──────────────────────────────────────────────────
    function attachListeners() {
        const wrap = document.getElementById('wc-canvas-wrap');
        const canvas = document.getElementById('wc-canvas');
        if (!wrap || !canvas) return;

        // Zoom buttons
        document.getElementById('wc-zoom-in')?.addEventListener('click', () => {
            scale = Math.min(2.5, scale + 0.1); applyTransform();
        });
        document.getElementById('wc-zoom-out')?.addEventListener('click', () => {
            scale = Math.max(0.2, scale - 0.1); applyTransform();
        });
        document.getElementById('wc-zoom-fit')?.addEventListener('click', fitToScreen);
        document.getElementById('wc-zoom-reset')?.addEventListener('click', resetView);

        // Wheel zoom (cmd/ctrl) + pan (regular scroll)
        wrap.addEventListener('wheel', (e) => {
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                const rect = wrap.getBoundingClientRect();
                const mouseX = e.clientX - rect.left;
                const mouseY = e.clientY - rect.top;
                const oldScale = scale;
                const delta = -e.deltaY * 0.002;
                scale = Math.max(0.2, Math.min(2.5, scale + delta));
                const scaleRatio = scale / oldScale;
                translateX = mouseX - (mouseX - translateX) * scaleRatio;
                translateY = mouseY - (mouseY - translateY) * scaleRatio;
                applyTransform();
            } else {
                e.preventDefault();
                translateY -= e.deltaY * 0.5;
                translateX -= e.deltaX * 0.5;
                applyTransform();
            }
        }, { passive: false });

        // Pan con mouse drag
        wrap.addEventListener('mousedown', (e) => {
            if (e.target.closest('.wc-node') || e.target.closest('.wc-node-decision') ||
                e.target.closest('.wc-zoom-controls') || e.target.closest('.wc-canvas-hint')) return;
            isPanning = true;
            canvas.classList.add('is-panning');
            wrap.classList.add('is-panning');
            startPan = { x: e.clientX - translateX, y: e.clientY - translateY };
        });
        window.addEventListener('mousemove', (e) => {
            if (!isPanning) return;
            translateX = e.clientX - startPan.x;
            translateY = e.clientY - startPan.y;
            applyTransform();
        });
        window.addEventListener('mouseup', () => {
            if (!isPanning) return;
            isPanning = false;
            canvas.classList.remove('is-panning');
            wrap.classList.remove('is-panning');
        });

        // Node selection
        canvas.addEventListener('click', (e) => {
            const node = e.target.closest('.wc-node, .wc-node-decision');
            if (!node) {
                document.querySelectorAll('.wc-node.is-selected, .wc-node-decision.is-selected').forEach(n => n.classList.remove('is-selected'));
                return;
            }
            e.stopPropagation();
            document.querySelectorAll('.wc-node.is-selected, .wc-node-decision.is-selected').forEach(n => n.classList.remove('is-selected'));
            node.classList.add('is-selected');
        });

        // View toggle (visual only por ahora)
        document.querySelectorAll('[data-wc-view]').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('[data-wc-view]').forEach(b => b.classList.remove('is-active'));
                btn.classList.add('is-active');
            });
        });
    }
})();

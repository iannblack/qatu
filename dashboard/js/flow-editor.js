/* ═══════════════════════════════════════════════════════════════════════
   Flujo de Conversación — editor dual-mode (conversacional + botones)
   Cada modo tiene su propio modelo de state y renderer; comparten shell
   (header, workspace, preview WhatsApp) y herramientas (save status,
   doodles, replay, sync bidireccional).

   - CONVERSACIONAL: flujo lineal con bot turns + customer-reply
     intercaladas (mockup qatu_flujo_conversacional)
   - BOTONES: árbol con menu/products/prompt/terminal nodes, branching
     por buttons con target picker (mockup qatu_flujo_botones)
   ═══════════════════════════════════════════════════════════════════════ */

(function() {
    'use strict';

    // ── ICONS (compartidos por ambos modos) ─────────────────────────
    const ICONS = {
        message:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
        collect:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
        end:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>',
        menu:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="6" width="18" height="4" rx="1"/><rect x="3" y="14" width="18" height="4" rx="1"/></svg>',
        products: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>',
        prompt:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="14" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>',
        terminal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>',
        user:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
        trash:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
        copy:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
        plus:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
        x:        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
        chevDown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>',
        publish:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>',
        play:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3" fill="currentColor"/></svg>',
        reply:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>'
    };

    // ── STATE: CONVERSACIONAL ───────────────────────────────────────
    const stateConv = {
        storeName: 'Anas',
        storeInitial: 'A',
        nodes: [
            { id: 'n1', type: 'message', title: 'Bienvenida', bubbles: [
                '¡Hola! Bienvenido a Anas.',
                '¿En qué puedo ayudarte hoy?',
                'Puedo mostrarte nuestros productos o, si ya sabes lo que buscas, indícamelo y lo coordinamos.'
            ]},
            { id: 'r1', type: 'customer-reply', bubbles: ['Hola, qué productos tienen?'] },
            { id: 'n2', type: 'message', title: 'Producto disponible', bubbles: [
                'En este momento tenemos disponible *Ceviche en bolsa 1* a S/ 40.',
                '¿Te gustaría llevarlo?'
            ]},
            { id: 'r2', type: 'customer-reply', bubbles: ['Sí, me interesa'] },
            { id: 'n3', type: 'message', title: 'Envío — pedir región', bubbles: [
                'Perfecto.',
                'Para coordinar la entrega, ¿a qué región enviaríamos tu pedido?'
            ]},
            { id: 'r3', type: 'customer-reply', bubbles: ['Lima'] },
            { id: 'n4', type: 'message', title: 'Envío — modalidad', bubbles: [
                'Para *Lima* tenemos envío a domicilio o recojo en tienda.',
                '¿Cuál prefieres?'
            ]},
            { id: 'r4', type: 'customer-reply', bubbles: ['Recojo en tienda'] },
            { id: 'n5', type: 'message', title: 'Envío — detalles de recojo', bubbles: [
                'El recojo es en *Av. Larco 345, Miraflores*.',
                'Horario: lunes a sábado de 10 a. m. a 8 p. m.',
                'Tu pedido estará listo en 30 minutos.',
                '¿Confirmamos de esta forma?'
            ]},
            { id: 'r5', type: 'customer-reply', bubbles: ['Sí, confirmo'] },
            { id: 'n6', type: 'collect', title: 'Datos del cliente', bubbles: [
                'Para registrar tu pedido, indícame por favor tu *nombre completo*, un *número de contacto* y tu *DNI* para validar el recojo.'
            ]},
            { id: 'r6', type: 'customer-reply', bubbles: ['María Quispe', '987 654 321', 'DNI 45123789'] },
            { id: 'n7', type: 'message', title: 'Pago — método', bubbles: [
                'Ya casi terminamos.',
                '¿Cómo prefieres pagar? Contamos con Yape, transferencia bancaria y efectivo.'
            ]},
            { id: 'r7', type: 'customer-reply', bubbles: ['Yape'] },
            { id: 'n8', type: 'message', title: 'Pago — datos y comprobante', bubbles: [
                'Perfecto, pagarás con Yape.',
                'El número es *987 123 456*, a nombre de *Ana Salazar*.',
                'El total es *S/ 40*.',
                'Envíame la captura del comprobante para validarlo y confirmar tu pedido.'
            ]},
            { id: 'r8', type: 'customer-reply', bubbles: ['📸 Comprobante de pago'] },
            { id: 'n9', type: 'end', title: 'Confirmación y handoff', bubbles: [
                'Recibí tu comprobante.',
                'Lo validaré con nuestro equipo y te confirmaremos el pedido en breve.',
                '¡Gracias por tu compra en Anas!'
            ]}
        ]
    };

    const CONV_TYPES = {
        message: { label: 'Mensaje del bot', iconKey: 'message', desc: 'Uno o más mensajes' },
        collect: { label: 'Pedir datos',     iconKey: 'collect', desc: 'Solicitar info' },
        end:     { label: 'Cierre',          iconKey: 'end',     desc: 'Mensaje final' }
    };

    const CONV_TEMPLATES = {
        message: { title: 'Nuevo mensaje', bubbles: ['Escribe el mensaje del bot...'] },
        collect: { title: 'Pedir datos',   bubbles: ['¿Me das tu nombre completo?'] },
        end:     { title: 'Cierre',        bubbles: ['¡Gracias por escribirnos!'] },
        'customer-reply': { bubbles: ['Respuesta del cliente'] }
    };

    // ── STATE: BOTONES (tree con branching) ─────────────────────────
    const stateBot = {
        storeName: 'Anas',
        storeInitial: 'A',
        rootNodeId: 'n1',
        selectedButton: { n1: 0, n2: 0, n3: 0, n4: 1, n5: 0, n9: 0, n12: 0 },
        nodes: [
            { id: 'n1', type: 'menu', title: 'Bienvenida',
                bubbles: ['¡Hola! Bienvenido a Anas.', '¿Qué te gustaría hacer?'],
                buttons: [
                    { label: 'Ver productos', target: 'n2' },
                    { label: 'Hablar con asesor', target: 'n13' }
                ]
            },
            { id: 'n2', type: 'products', title: 'Catálogo',
                bubbles: ['Estos son nuestros productos disponibles:'],
                products: [
                    { name: 'Ceviche en bolsa 1', price: 'S/ 40', desc: '500g · porción individual', emoji: '🐟' }
                ],
                buttons: [
                    { label: 'Quiero este pedido', target: 'n3' },
                    { label: 'Ver más opciones', target: '' }
                ]
            },
            { id: 'n3', type: 'menu', title: 'Región del cliente',
                bubbles: ['¡Perfecto!', 'Para coordinar la entrega, ¿de dónde nos escribes?'],
                buttons: [
                    { label: 'Lima', target: 'n4' },
                    { label: 'Provincia', target: 'n5' }
                ]
            },
            { id: 'n4', type: 'menu', title: 'Modalidad Lima',
                bubbles: ['Para Lima tenemos dos modalidades:'],
                buttons: [
                    { label: 'Envío a domicilio', target: 'n6' },
                    { label: 'Recojo en tienda', target: 'n7' }
                ]
            },
            { id: 'n5', type: 'menu', title: 'Envío a provincia',
                bubbles: ['Para provincias trabajamos con Olva Courier.', 'Costo: S/ 25 adicional, tiempo 2-4 días.'],
                buttons: [
                    { label: 'Continuar', target: 'n8' },
                    { label: 'Mejor cancelo', target: '' }
                ]
            },
            { id: 'n6', type: 'menu', title: 'Envío a domicilio',
                bubbles: ['Envío a domicilio en Lima: *S/ 10* adicional.', 'Tiempo aproximado: 24 horas.'],
                buttons: [ { label: 'Continuar', target: 'n8' } ]
            },
            { id: 'n7', type: 'menu', title: 'Recojo en tienda',
                bubbles: ['📍 *Av. Larco 345, Miraflores*', '🕐 L-S 10am-8pm', 'Pedido listo en 30 min.'],
                buttons: [ { label: 'Continuar', target: 'n8' } ]
            },
            { id: 'n8', type: 'prompt', title: 'Datos del cliente',
                bubbles: ['Para registrar tu pedido, envíame por favor:', '*Nombre completo*\n*Número de contacto*\n*DNI*'],
                simulatedResponse: 'María Quispe\n987 654 321\nDNI 45123789',
                nextNodeId: 'n9'
            },
            { id: 'n9', type: 'menu', title: 'Método de pago',
                bubbles: ['¿Cómo prefieres pagar?'],
                buttons: [
                    { label: 'Yape', target: 'n10' },
                    { label: 'Transferencia BCP', target: 'n11' },
                    { label: 'Efectivo al recoger', target: 'n12' }
                ]
            },
            { id: 'n10', type: 'prompt', title: 'Pago — Yape',
                bubbles: ['Yape al *987 123 456* (Ana Salazar).', 'Total: *S/ 40*.', 'Envíame la captura del comprobante.'],
                simulatedResponse: '📸 Comprobante de pago',
                nextNodeId: 'n13'
            },
            { id: 'n11', type: 'prompt', title: 'Pago — Transferencia',
                bubbles: ['Cuenta BCP: *191-12345678-0-12* (Ana Salazar).', 'Total: *S/ 40*.', 'Envíame la captura del depósito.'],
                simulatedResponse: '📸 Comprobante de transferencia',
                nextNodeId: 'n13'
            },
            { id: 'n12', type: 'menu', title: 'Pago — Efectivo',
                bubbles: ['Perfecto, pago en efectivo al momento de la entrega.'],
                buttons: [ { label: 'Confirmar pedido', target: 'n13' } ]
            },
            { id: 'n13', type: 'terminal', title: 'Confirmación y handoff',
                bubbles: ['¡Gracias por tu compra en Anas!', 'Te contactaré en breve para confirmar tu pedido y validar el pago si corresponde.']
            }
        ]
    };

    const BOT_TYPES = {
        menu:     { label: 'Menú con botones',  iconKey: 'menu',     desc: 'Bot pregunta, cliente elige' },
        products: { label: 'Catálogo',          iconKey: 'products', desc: 'Mostrar productos' },
        prompt:   { label: 'Pedir respuesta',   iconKey: 'prompt',   desc: 'Cliente escribe texto/foto' },
        terminal: { label: 'Cierre',            iconKey: 'terminal', desc: 'Fin del flujo' }
    };

    const BOT_TEMPLATES = {
        menu:     { title: 'Nuevo menú', bubbles: ['Mensaje del bot...'], buttons: [{ label: 'Opción 1', target: '' }, { label: 'Opción 2', target: '' }] },
        products: { title: 'Catálogo',   bubbles: ['Productos disponibles:'], products: [{ name: 'Producto', price: 'S/ 0', desc: 'Descripción', emoji: '📦' }], buttons: [{ label: 'Quiero este', target: '' }] },
        prompt:   { title: 'Pedir datos', bubbles: ['¿Me puedes dar tu información?'], simulatedResponse: 'Respuesta del cliente', nextNodeId: '' },
        terminal: { title: 'Cierre',      bubbles: ['¡Gracias!'] }
    };

    // ── MODO ACTIVO ────────────────────────────────────────────────
    let currentMode = 'conversacional'; // 'conversacional' | 'botones'
    function activeState() { return currentMode === 'botones' ? stateBot : stateConv; }

    // ── ESTILOS ─────────────────────────────────────────────────────
    const STYLES = `
        #flow-editor-host { font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; }
        #flow-editor-root {
            --fx-navy: #1a2942;
            --fx-navy-soft: #2a3a55;
            --fx-orange: #e85d3a;
            --fx-orange-soft: #f47556;
            --fx-orange-bg: #fff1ec;
            --fx-orange-border: #ffd4c4;
            --fx-gold: #d4a04a;
            --fx-gold-bg: #fdf6e8;
            --fx-green: #16a34a;
            --fx-green-soft: #22c55e;
            --fx-green-bg: #ecfdf5;
            --fx-green-border: #bbf7d0;
            --fx-green-text: #166534;
            --fx-gray-50: #fafafa;
            --fx-gray-100: #f4f5f7;
            --fx-gray-200: #e5e7eb;
            --fx-gray-250: #dadde2;
            --fx-gray-300: #d1d5db;
            --fx-gray-400: #9ca3af;
            --fx-gray-500: #6b7280;
            --fx-gray-600: #4b5563;
            --fx-border: #e5e7eb;
            --fx-text-secondary: #4b5563;
            --fx-text-muted: #9ca3af;
            --fx-shadow-sm: 0 1px 2px rgba(17,24,39,0.04), 0 1px 3px rgba(17,24,39,0.06);
            --fx-shadow-md: 0 4px 12px rgba(17,24,39,0.05), 0 2px 4px rgba(17,24,39,0.04);
            --fx-shadow-lg: 0 12px 28px rgba(17,24,39,0.08), 0 4px 10px rgba(17,24,39,0.04);
            --wa-header: #075e54;
            --wa-bg: #efeae2;
            --wa-bubble-in: #ffffff;
            --wa-bubble-out: #d9fdd3;
            --wa-text: #111b21;
            --wa-text-muted: #667781;
            --wa-button: #00a884;

            background: #fff;
            border: 1px solid var(--fx-border);
            border-radius: 14px;
            overflow: hidden;
            display: flex; flex-direction: column;
            height: 100%;
            min-height: 0;
            color: var(--fx-navy);
            font-size: 14px;
        }
        #section-create-bot.active #flow-editor-host {
            flex: 1; min-height: 0;
            display: flex; flex-direction: column;
        }
        #section-create-bot.active #flow-editor-host > #flow-editor-root {
            flex: 1; min-height: 0;
        }

        /* Editor header */
        .fx-editor-header {
            padding: 14px 22px;
            border-bottom: 1px solid var(--fx-border);
            display: flex; align-items: center; justify-content: space-between;
            gap: 16px; flex-shrink: 0; background: #fff;
            flex-wrap: wrap;
        }
        .fx-header-left { display: flex; align-items: center; gap: 14px; min-width: 0; }
        .fx-header-title {
            font-family: 'Fraunces', 'Cormorant Garamond', Georgia, serif;
            font-size: 20px; font-weight: 600;
            letter-spacing: -0.02em; margin: 0; line-height: 1.1;
            color: var(--fx-navy);
        }
        .fx-header-divider { width: 1px; height: 22px; background: var(--fx-gray-200); }
        .fx-tienda-selector {
            display: inline-flex; align-items: center; gap: 8px;
            padding: 6px 10px 6px 6px;
            background: var(--fx-gray-50);
            border: 1px solid var(--fx-border);
            border-radius: 8px;
            cursor: pointer; transition: all 0.15s ease;
            font-family: inherit;
        }
        .fx-tienda-selector:hover { border-color: var(--fx-gray-300); background: #fff; }
        .fx-tienda-avatar-sm {
            width: 26px; height: 26px; border-radius: 6px;
            background: linear-gradient(135deg, #10b981 0%, #14b8a6 100%);
            color: #fff; display: grid; place-items: center;
            font-family: 'Fraunces', serif; font-weight: 600; font-size: 13px;
        }
        .fx-tienda-name-sm { font-size: 13px; font-weight: 600; color: var(--fx-navy); }
        .fx-tienda-selector svg { width: 12px; height: 12px; color: var(--fx-text-muted); }

        .fx-header-right { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }

        .fx-mode-toggle {
            display: inline-flex;
            background: var(--fx-gray-100);
            border-radius: 9px;
            padding: 3px;
        }
        .fx-mode-btn {
            background: transparent; border: none;
            padding: 6px 14px; border-radius: 6px;
            font-family: inherit; font-size: 12.5px; font-weight: 600;
            color: var(--fx-text-secondary); cursor: pointer;
            transition: all 0.15s ease;
            display: inline-flex; align-items: center; gap: 6px;
        }
        .fx-mode-btn svg { width: 12px; height: 12px; }
        .fx-mode-btn.is-active {
            background: var(--fx-navy); color: #fff;
            box-shadow: var(--fx-shadow-sm);
        }

        .fx-save-status {
            display: inline-flex; align-items: center; gap: 6px;
            font-size: 12px; color: var(--fx-text-muted);
            padding: 0 8px;
        }
        .fx-save-status .dot {
            width: 6px; height: 6px; border-radius: 50%; background: var(--fx-green);
        }
        .fx-save-status.is-saving .dot { background: var(--fx-gold); animation: fx-pulse-dot 1s infinite; }
        @keyframes fx-pulse-dot { 0%,100% { opacity: 0.4; } 50% { opacity: 1; } }

        .fx-btn-primary {
            background: var(--fx-navy); color: #fff;
            border: none; font-family: inherit;
            font-size: 13px; font-weight: 600;
            padding: 8px 16px; border-radius: 8px;
            cursor: pointer; transition: all 0.15s ease;
            display: inline-flex; align-items: center; gap: 6px;
        }
        .fx-btn-primary:hover { background: var(--fx-navy-soft); }
        .fx-btn-primary svg { width: 13px; height: 13px; }

        /* Workspace */
        .fx-workspace {
            flex: 1; min-height: 0;
            display: grid;
            grid-template-columns: minmax(0, 1.45fr) minmax(0, 1fr);
            grid-template-rows: 1fr;
            overflow: hidden;
        }
        #flow-editor-root.is-mode-botones .fx-workspace {
            grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
        }

        /* Editor pane */
        .fx-editor-pane {
            background: var(--fx-gray-50);
            overflow-y: auto;
            padding: 22px 28px 80px;
            position: relative;
            min-height: 0; min-width: 0;
        }
        .fx-editor-pane::-webkit-scrollbar { width: 8px; }
        .fx-editor-pane::-webkit-scrollbar-track { background: transparent; }
        .fx-editor-pane::-webkit-scrollbar-thumb { background: var(--fx-gray-200); border-radius: 4px; }
        .fx-editor-pane::-webkit-scrollbar-thumb:hover { background: var(--fx-gray-300); }
        .fx-editor-inner { max-width: 680px; margin: 0 auto; }

        /* Trigger */
        .fx-trigger {
            background: var(--fx-navy); color: #fff;
            border-radius: 10px;
            padding: 10px 14px;
            display: flex; align-items: center; gap: 10px;
        }
        .fx-trigger-icon {
            width: 28px; height: 28px; border-radius: 7px;
            background: rgba(232,93,58,0.18); color: var(--fx-orange-soft);
            display: grid; place-items: center; flex-shrink: 0;
        }
        .fx-trigger-icon svg { width: 14px; height: 14px; }
        .fx-trigger-label {
            font-size: 10px; text-transform: uppercase; letter-spacing: 0.12em;
            color: var(--fx-orange-soft); font-weight: 600;
        }
        .fx-trigger-text { font-size: 13px; font-weight: 500; margin-top: 1px; }

        /* Connector (conversacional) */
        .fx-connector {
            width: 2px; height: 14px;
            background: var(--fx-gray-250);
            margin: 0 auto;
            position: relative;
        }
        .fx-connector.short { height: 10px; }
        .fx-connector::after {
            content: ''; position: absolute;
            bottom: -1px; left: 50%;
            width: 6px; height: 6px;
            border-right: 2px solid var(--fx-gray-250);
            border-bottom: 2px solid var(--fx-gray-250);
            transform: translateX(-50%) rotate(45deg);
        }

        /* Path summary (botones) */
        .fx-path-summary {
            margin: 16px 0 14px;
            padding: 10px 14px;
            background: var(--fx-orange-bg);
            border: 1px solid var(--fx-orange-border);
            border-radius: 10px;
            display: flex; align-items: flex-start; gap: 10px;
            font-size: 12.5px; color: #9a3412;
        }
        .fx-path-summary svg { width: 14px; height: 14px; color: var(--fx-orange); flex-shrink: 0; margin-top: 2px; }
        .fx-path-summary strong { font-weight: 600; }
        .fx-path-chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; align-items: center; }
        .fx-path-chip {
            background: #fff;
            border: 1px solid var(--fx-orange-border);
            color: var(--fx-navy);
            font-size: 10.5px; font-weight: 600;
            padding: 2px 7px; border-radius: 999px;
            font-family: 'Fraunces', serif;
        }
        .fx-path-chip.is-current { background: var(--fx-orange); color: #fff; border-color: var(--fx-orange); }
        .fx-path-sep { color: var(--fx-text-muted); font-size: 11px; }

        /* Nodes list */
        .fx-nodes-list { display: flex; flex-direction: column; gap: 10px; margin-top: 4px; }

        /* Node card */
        .fx-node {
            background: #fff;
            border-radius: 10px;
            border: 1px solid var(--fx-border);
            border-left: 3px solid transparent;
            transition: border-color 0.18s ease, box-shadow 0.18s ease;
            overflow: hidden;
        }
        .fx-node:hover { border-color: var(--fx-gray-250); }
        .fx-node.is-on-path { border-left-color: var(--fx-orange); }
        .fx-node.is-active {
            border-color: var(--fx-orange); border-left-color: var(--fx-orange);
            box-shadow: 0 0 0 3px var(--fx-orange-bg);
        }
        .fx-node-head {
            display: flex; align-items: center; gap: 10px;
            padding: 9px 12px;
            border-bottom: 1px solid var(--fx-gray-100);
        }
        .fx-node-icon {
            width: 24px; height: 24px; border-radius: 6px;
            background: var(--fx-gold-bg); color: var(--fx-gold);
            display: grid; place-items: center; flex-shrink: 0;
        }
        .fx-node-icon svg { width: 13px; height: 13px; }
        .fx-node-icon.t-collect { background: var(--fx-orange-bg); color: var(--fx-orange); }
        .fx-node-icon.t-end { background: var(--fx-green-bg); color: var(--fx-green); }
        .fx-node-icon.t-products { background: var(--fx-orange-bg); color: var(--fx-orange); }
        .fx-node-icon.t-prompt { background: #e0e7ff; color: #4f46e5; }
        .fx-node-icon.t-terminal { background: var(--fx-green-bg); color: var(--fx-green); }
        .fx-node-id {
            font-size: 9.5px; font-weight: 700;
            background: var(--fx-gray-100); color: var(--fx-text-secondary);
            padding: 1px 6px; border-radius: 4px;
            font-family: 'Fraunces', serif; letter-spacing: 0.04em;
            flex-shrink: 0;
        }
        .fx-node.is-on-path .fx-node-id { background: var(--fx-orange-bg); color: var(--fx-orange); }
        .fx-node-meta { flex: 1; min-width: 0; }
        .fx-node-type {
            font-size: 9.5px; text-transform: uppercase;
            letter-spacing: 0.12em; color: var(--fx-text-muted); font-weight: 600;
        }
        .fx-node-title {
            font-family: 'Fraunces', 'Cormorant Garamond', Georgia, serif;
            font-size: 14px; font-weight: 600;
            color: var(--fx-navy);
            letter-spacing: -0.01em;
            margin-top: 1px; outline: none; line-height: 1.2;
        }
        .fx-node-title:focus {
            background: var(--fx-gray-50);
            border-radius: 3px;
            padding: 0 4px; margin: 0 -4px;
        }
        .fx-node-actions { display: flex; gap: 2px; }
        .fx-node-action {
            width: 24px; height: 24px;
            border-radius: 5px; border: none;
            background: transparent; color: var(--fx-text-muted);
            cursor: pointer; display: grid; place-items: center;
            transition: all 0.15s ease;
        }
        .fx-node-action:hover { background: var(--fx-gray-100); color: var(--fx-navy); }
        .fx-node-action svg { width: 12px; height: 12px; }
        .fx-node-body { padding: 10px 12px 12px; }

        /* Sub-label (botones mode) */
        .fx-sub-label {
            font-size: 10px; text-transform: uppercase;
            letter-spacing: 0.1em; color: var(--fx-text-muted);
            font-weight: 600; margin: 6px 0 5px;
            display: flex; align-items: center; justify-content: space-between;
        }
        .fx-sub-label:first-child { margin-top: 0; }
        .fx-sub-label-count {
            font-family: 'Fraunces', serif; font-weight: 600;
            color: var(--fx-text-secondary); letter-spacing: 0.02em;
            text-transform: none; font-size: 11px;
        }

        /* Bubble list */
        .fx-bubble-list { display: flex; flex-direction: column; gap: 4px; }
        .fx-bubble-field { display: flex; align-items: stretch; gap: 8px; }
        .fx-bubble-num {
            width: 18px;
            color: var(--fx-text-muted);
            font-size: 11px; font-weight: 600;
            font-family: 'Fraunces', serif;
            display: grid; place-items: center;
            flex-shrink: 0; padding-top: 7px;
        }
        .fx-bubble-field .fx-editable { flex: 1; }
        .fx-bubble-del {
            width: 22px;
            border: none; background: transparent;
            color: var(--fx-text-muted); cursor: pointer;
            border-radius: 5px;
            display: grid; place-items: center;
            opacity: 0; transition: all 0.15s ease;
            flex-shrink: 0;
        }
        .fx-bubble-field:hover .fx-bubble-del,
        .fx-reply-bubble-field:hover .fx-bubble-del,
        .fx-button-row:hover .fx-bubble-del,
        .fx-product-row:hover .fx-bubble-del { opacity: 1; }
        .fx-bubble-del:hover { color: var(--fx-orange); background: var(--fx-orange-bg); }
        .fx-bubble-del svg { width: 11px; height: 11px; }

        .fx-editable {
            font-family: inherit;
            font-size: 13px; line-height: 1.45;
            color: var(--fx-navy);
            background: var(--fx-gray-50);
            border: 1px solid transparent;
            border-radius: 7px;
            padding: 7px 10px;
            outline: none;
            transition: all 0.15s ease;
            cursor: text;
            white-space: pre-wrap; word-break: break-word;
            min-height: 22px;
        }
        .fx-editable:hover { background: var(--fx-gray-100); }
        .fx-editable:focus {
            background: #fff;
            border-color: var(--fx-orange);
            box-shadow: 0 0 0 3px var(--fx-orange-bg);
        }

        .fx-add-bubble {
            margin-top: 6px; margin-left: 26px;
            background: transparent; border: none;
            color: var(--fx-text-muted);
            font-family: inherit; font-size: 12px; font-weight: 500;
            padding: 4px 8px; border-radius: 6px;
            cursor: pointer;
            display: inline-flex; align-items: center; gap: 5px;
            transition: all 0.15s ease;
        }
        .fx-add-bubble:hover { color: var(--fx-orange); background: var(--fx-orange-bg); }
        .fx-add-bubble svg { width: 11px; height: 11px; }

        /* Customer reply (conversacional) */
        .fx-reply-card {
            background: var(--fx-green-bg);
            border: 1px solid var(--fx-green-border);
            border-radius: 10px;
            padding: 9px 12px 11px;
            max-width: 75%;
            margin-left: auto;
            transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }
        .fx-reply-card.is-active {
            border-color: var(--fx-orange);
            box-shadow: 0 0 0 3px var(--fx-orange-bg);
        }
        .fx-reply-head {
            display: flex; align-items: center; gap: 8px;
            margin-bottom: 6px;
        }
        .fx-reply-avatar {
            width: 18px; height: 18px; border-radius: 50%;
            background: var(--fx-green); color: #fff;
            display: grid; place-items: center; flex-shrink: 0;
        }
        .fx-reply-avatar svg { width: 10px; height: 10px; }
        .fx-reply-label {
            font-size: 9.5px; text-transform: uppercase;
            letter-spacing: 0.12em; color: var(--fx-green-text);
            font-weight: 600; flex: 1;
        }
        .fx-reply-actions { display: flex; gap: 2px; }
        .fx-reply-action {
            width: 20px; height: 20px;
            border-radius: 5px; border: none;
            background: transparent; color: var(--fx-green-text);
            opacity: 0.6; cursor: pointer;
            display: grid; place-items: center;
            transition: all 0.15s ease;
        }
        .fx-reply-action:hover { background: rgba(22,163,74,0.1); opacity: 1; }
        .fx-reply-action svg { width: 11px; height: 11px; }
        .fx-reply-bubbles { display: flex; flex-direction: column; gap: 3px; }
        .fx-reply-bubble-field { display: flex; align-items: stretch; gap: 4px; }
        .fx-reply-bubble-field .fx-editable {
            flex: 1;
            background: #fff;
            border: 1px solid #c8e6b5;
            font-size: 12.5px;
            padding: 6px 10px;
        }
        .fx-reply-bubble-field .fx-editable:hover { background: #fafffa; border-color: var(--fx-green-soft); }
        .fx-reply-bubble-field .fx-editable:focus {
            background: #fff;
            border-color: var(--fx-orange);
            box-shadow: 0 0 0 3px var(--fx-orange-bg);
        }

        /* Button rows (botones mode) */
        .fx-buttons-section { margin-top: 10px; }
        .fx-button-row {
            display: grid;
            grid-template-columns: 18px 1fr auto 22px;
            align-items: center; gap: 8px;
            padding: 4px 0;
            transition: background 0.15s ease;
            border-radius: 6px;
        }
        .fx-button-row.is-selected-path { background: rgba(232,93,58,0.06); }
        .fx-button-row .fx-btn-num {
            width: 18px; height: 22px;
            color: var(--fx-text-muted); font-size: 11px; font-weight: 700;
            font-family: 'Fraunces', serif;
            display: grid; place-items: center;
        }
        .fx-button-row.is-selected-path .fx-btn-num { color: var(--fx-orange); }

        .fx-target-picker {
            position: relative;
            display: inline-flex; align-items: center; gap: 5px;
            padding: 5px 9px 5px 10px;
            background: var(--fx-gray-50);
            border: 1px solid var(--fx-border);
            border-radius: 7px;
            font-size: 11.5px; font-weight: 600;
            color: var(--fx-navy);
            cursor: pointer;
            transition: all 0.15s ease;
            white-space: nowrap;
        }
        .fx-target-picker:hover { border-color: var(--fx-gray-300); background: #fff; }
        .fx-target-picker.is-terminal { color: var(--fx-text-muted); font-style: italic; }
        .fx-target-arrow { color: var(--fx-text-muted); font-size: 12px; margin-right: 2px; }
        .fx-target-label { max-width: 140px; overflow: hidden; text-overflow: ellipsis; }
        .fx-target-picker > svg { width: 11px; height: 11px; color: var(--fx-text-muted); }
        .fx-target-popup {
            position: absolute; top: calc(100% + 4px); right: 0;
            background: #fff;
            border: 1px solid var(--fx-border);
            border-radius: 10px; box-shadow: var(--fx-shadow-lg);
            padding: 4px; min-width: 220px; max-height: 280px;
            overflow-y: auto;
            display: none; z-index: 50;
        }
        .fx-target-picker.is-open .fx-target-popup { display: block; }
        .fx-target-option {
            display: flex; align-items: center; gap: 7px;
            padding: 7px 9px; border-radius: 6px;
            cursor: pointer; transition: background 0.12s;
            font-size: 12px; font-weight: 500;
            color: var(--fx-navy);
        }
        .fx-target-option:hover { background: var(--fx-gray-50); }
        .fx-target-option.is-active { background: var(--fx-orange-bg); color: var(--fx-orange); }
        .fx-target-option.terminal { color: var(--fx-text-muted); font-style: italic; }
        .fx-target-option .fx-opt-id {
            font-family: 'Fraunces', serif; font-weight: 700;
            font-size: 10px; background: var(--fx-gray-100);
            padding: 1px 5px; border-radius: 3px;
            color: var(--fx-text-secondary);
            flex-shrink: 0;
        }
        .fx-target-option.is-active .fx-opt-id { background: var(--fx-orange); color: #fff; }

        .fx-add-button {
            margin-top: 6px; margin-left: 26px;
            background: transparent; border: none;
            color: var(--fx-text-muted);
            font-family: inherit; font-size: 12px; font-weight: 500;
            padding: 4px 8px; border-radius: 6px; cursor: pointer;
            display: inline-flex; align-items: center; gap: 5px;
            transition: all 0.15s ease;
        }
        .fx-add-button:hover:not(:disabled) { color: var(--fx-orange); background: var(--fx-orange-bg); }
        .fx-add-button:disabled { opacity: 0.5; cursor: not-allowed; }
        .fx-add-button svg { width: 11px; height: 11px; }
        .fx-button-limit-hint {
            margin-left: 8px;
            font-size: 10.5px; color: var(--fx-text-muted);
            font-style: italic;
        }

        /* Products */
        .fx-product-row {
            display: flex; align-items: center; gap: 9px;
            padding: 7px 9px;
            background: var(--fx-gray-50);
            border: 1px solid var(--fx-border);
            border-radius: 8px;
            transition: all 0.15s ease;
            margin-bottom: 5px;
        }
        .fx-product-row:hover { background: #fff; border-color: var(--fx-gray-250); }
        .fx-product-thumb {
            width: 28px; height: 28px; border-radius: 6px;
            background: var(--fx-gold-bg); color: var(--fx-gold);
            display: grid; place-items: center;
            flex-shrink: 0;
            font-size: 16px;
        }
        .fx-product-info { flex: 1; min-width: 0; }
        .fx-product-name {
            background: transparent; border: 1px solid transparent;
            padding: 1px 4px; border-radius: 4px;
            font-size: 12.5px; font-weight: 600; color: var(--fx-navy);
            min-height: auto; line-height: 1.3;
        }
        .fx-product-meta {
            background: transparent; border: 1px solid transparent;
            padding: 1px 4px; border-radius: 4px;
            font-size: 11px; color: var(--fx-text-muted);
            margin-top: 1px; min-height: auto; line-height: 1.3;
        }
        .fx-product-name:hover, .fx-product-meta:hover { background: #fff; }
        .fx-product-name:focus, .fx-product-meta:focus {
            background: #fff; border-color: var(--fx-orange);
            box-shadow: 0 0 0 2px var(--fx-orange-bg);
            outline: none;
        }

        /* Prompt info */
        .fx-prompt-info {
            background: #eef2ff;
            border: 1px solid #c7d2fe;
            border-radius: 8px;
            padding: 9px 12px;
            margin-top: 10px;
            display: flex; gap: 9px;
            font-size: 12px;
        }
        .fx-prompt-info svg {
            width: 14px; height: 14px; color: #4f46e5;
            flex-shrink: 0; margin-top: 2px;
        }
        .fx-prompt-info-text { flex: 1; color: #3730a3; line-height: 1.45; }
        .fx-prompt-info strong { font-weight: 600; }
        .fx-prompt-info .fx-simulated {
            margin-top: 6px; padding: 5px 8px;
            background: #fff; border-radius: 5px;
            font-style: italic; color: var(--fx-text-secondary);
            font-size: 11px;
        }
        .fx-prompt-next {
            margin-top: 10px;
            padding-top: 10px;
            border-top: 1px dashed var(--fx-gray-200);
            display: flex; align-items: center; gap: 9px;
            font-size: 11.5px; color: var(--fx-text-secondary);
        }
        .fx-prompt-next-label { font-weight: 600; }

        /* Terminal */
        .fx-terminal-info {
            margin-top: 10px;
            padding: 8px 12px;
            background: var(--fx-green-bg);
            border: 1px solid var(--fx-green-border);
            border-radius: 8px;
            display: flex; align-items: center; gap: 8px;
            font-size: 11.5px; color: var(--fx-green-text);
            font-weight: 600;
        }
        .fx-terminal-info svg { width: 13px; height: 13px; }

        /* Add step */
        .fx-add-step { margin-top: 16px; display: flex; justify-content: center; }
        .fx-add-step-btn {
            background: #fff;
            border: 1.5px dashed var(--fx-gray-300);
            color: var(--fx-text-secondary);
            padding: 8px 16px; border-radius: 10px;
            font-family: inherit; font-size: 12.5px; font-weight: 600;
            cursor: pointer;
            display: inline-flex; align-items: center; gap: 6px;
            transition: all 0.15s ease;
        }
        .fx-add-step-btn:hover {
            border-color: var(--fx-orange); color: var(--fx-orange);
            background: var(--fx-orange-bg);
        }
        .fx-add-step-btn svg { width: 12px; height: 12px; }
        .fx-step-menu {
            background: #fff; border-radius: 10px;
            box-shadow: var(--fx-shadow-lg);
            border: 1px solid var(--fx-border);
            padding: 4px; margin-top: 8px;
            display: none; grid-template-columns: repeat(2, 1fr); gap: 2px;
            max-width: 440px; margin-left: auto; margin-right: auto;
        }
        .fx-step-menu.is-open { display: grid; }
        .fx-step-menu-item {
            background: transparent; border: none;
            padding: 8px 10px; cursor: pointer; text-align: left;
            border-radius: 7px; font-family: inherit;
            display: flex; align-items: center; gap: 9px;
            transition: background 0.12s;
        }
        .fx-step-menu-item:hover { background: var(--fx-gray-100); }
        .fx-step-menu-icon {
            width: 24px; height: 24px; border-radius: 6px;
            display: grid; place-items: center; flex-shrink: 0;
            background: var(--fx-gold-bg); color: var(--fx-gold);
        }
        .fx-step-menu-icon.t-customer-reply { background: var(--fx-green-bg); color: var(--fx-green); }
        .fx-step-menu-icon.t-collect { background: var(--fx-orange-bg); color: var(--fx-orange); }
        .fx-step-menu-icon.t-end { background: var(--fx-green-bg); color: var(--fx-green); }
        .fx-step-menu-icon.t-products { background: var(--fx-orange-bg); color: var(--fx-orange); }
        .fx-step-menu-icon.t-prompt { background: #e0e7ff; color: #4f46e5; }
        .fx-step-menu-icon.t-terminal { background: var(--fx-green-bg); color: var(--fx-green); }
        .fx-step-menu-icon svg { width: 12px; height: 12px; }
        .fx-step-menu-label { font-size: 12px; font-weight: 600; color: var(--fx-navy); }
        .fx-step-menu-desc { font-size: 10.5px; color: var(--fx-text-muted); }

        /* Preview pane */
        .fx-preview-pane {
            background: linear-gradient(180deg, #f4f1ea 0%, #ebe6dc 100%);
            padding: 18px 22px 16px;
            display: flex; flex-direction: column;
            align-items: center;
            overflow: hidden;
            border-left: 1px solid var(--fx-border);
            position: relative;
            min-height: 0; min-width: 0;
            height: 100%;
        }
        .fx-preview-header {
            display: flex; align-items: center; gap: 8px;
            font-size: 11px; text-transform: uppercase;
            letter-spacing: 0.14em; color: var(--fx-text-muted);
            font-weight: 600; margin-bottom: 12px; flex-shrink: 0;
        }
        .fx-preview-dot {
            width: 6px; height: 6px; border-radius: 50%;
            background: var(--fx-green);
            animation: fx-pulse-dot-slow 2s ease-in-out infinite;
        }
        @keyframes fx-pulse-dot-slow {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }

        /* Chat panel — sin marco de teléfono (look "chat sólo"), igual que la
           captura de referencia: chat con corners redondeados, sin bezel negro. */
        .fx-phone {
            width: 100%; max-width: 440px;
            flex: 1; min-height: 0;
            background: transparent;
            border-radius: 16px;
            padding: 0;
            box-shadow: 0 10px 30px rgba(7, 94, 84, 0.08), 0 3px 10px rgba(0,0,0,0.06);
            border: 1px solid rgba(0,0,0,0.06);
            display: flex; flex-direction: column;
            overflow: hidden;
        }
        .fx-phone-screen {
            width: 100%; flex: 1; min-height: 0;
            border-radius: 16px; overflow: hidden;
            display: flex; flex-direction: column;
            background: var(--wa-bg); position: relative;
        }
        .fx-wa-header {
            background: var(--wa-header); color: #fff;
            padding: 12px 14px;
            display: flex; align-items: center; gap: 10px; flex-shrink: 0;
        }
        .fx-wa-back { font-size: 20px; opacity: 0.9; }
        .fx-wa-avatar {
            width: 34px; height: 34px; border-radius: 50%;
            background: linear-gradient(135deg, #10b981 0%, #14b8a6 100%);
            color: #fff; display: grid; place-items: center;
            font-family: 'Fraunces', serif; font-weight: 700;
            font-size: 15px; flex-shrink: 0;
        }
        .fx-wa-contact { flex: 1; min-width: 0; }
        .fx-wa-name { font-size: 14px; font-weight: 500; line-height: 1.1; }
        .fx-wa-status {
            font-size: 11px; opacity: 0.85; margin-top: 2px;
            transition: opacity 0.2s;
        }
        .fx-wa-status.typing { font-style: italic; color: #b5e9d6; opacity: 1; }
        .fx-wa-icons { display: flex; gap: 14px; opacity: 0.9; }

        .fx-wa-chat {
            flex: 1; overflow-y: auto;
            padding: 10px 8px;
            display: flex; flex-direction: column; gap: 1px;
            background-color: var(--wa-bg);
            background-size: 240px 240px;
            background-repeat: repeat;
        }
        .fx-wa-chat::-webkit-scrollbar { width: 3px; }
        .fx-wa-chat::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.1); border-radius: 2px; }

        .fx-wa-date {
            align-self: center;
            background: rgba(225,245,254,0.92); color: var(--wa-text-muted);
            font-size: 10.5px; padding: 3px 9px; border-radius: 7px;
            margin: 6px 0; box-shadow: 0 1px 0.5px rgba(0,0,0,0.13);
            font-weight: 500;
        }

        .fx-bubble {
            max-width: 78%;
            padding: 5px 9px 17px;
            border-radius: 8px; position: relative;
            font-size: 13px; line-height: 1.35; color: var(--wa-text);
            box-shadow: 0 1px 0.5px rgba(0,0,0,0.13);
            margin-top: 5px; cursor: text;
            transition: background-color 0.15s ease;
        }
        .fx-bubble.in { background: var(--wa-bubble-in); align-self: flex-start; border-top-left-radius: 0; }
        .fx-bubble.out { background: var(--wa-bubble-out); align-self: flex-end; border-top-right-radius: 0; }
        .fx-bubble.in::before {
            content: ''; position: absolute; top: 0; left: -8px;
            width: 8px; height: 13px; background: var(--wa-bubble-in);
            clip-path: polygon(100% 0, 0 0, 100% 100%);
        }
        .fx-bubble.out::before {
            content: ''; position: absolute; top: 0; right: -8px;
            width: 8px; height: 13px; background: var(--wa-bubble-out);
            clip-path: polygon(0 0, 100% 0, 0 100%);
        }
        .fx-bubble.continuation { margin-top: 2px; }
        .fx-bubble.continuation.in { border-top-left-radius: 8px; }
        .fx-bubble.continuation.out { border-top-right-radius: 8px; }
        .fx-bubble.continuation::before { display: none; }
        .fx-bubble.is-syncing { animation: fx-bubble-sync 0.6s ease-out; }
        @keyframes fx-bubble-sync {
            0% { background-color: rgba(232,93,58,0.3); }
            100% { background-color: inherit; }
        }
        .fx-bubble-text {
            outline: none; white-space: pre-wrap; word-break: break-word;
            min-height: 18px;
        }
        .fx-bubble-text:focus { box-shadow: 0 0 0 2px var(--fx-orange); border-radius: 3px; }
        .fx-bubble-meta {
            position: absolute; bottom: 3px; right: 8px;
            font-size: 9.5px; color: var(--wa-text-muted);
            display: flex; align-items: center; gap: 3px; white-space: nowrap;
        }
        .fx-bubble-check { color: #53bdeb; font-size: 11px; }

        /* WhatsApp quick-reply buttons (botones mode preview) */
        .fx-wa-buttons-block {
            align-self: flex-start;
            max-width: 78%;
            margin-top: 1px;
            display: flex; flex-direction: column; gap: 1px;
        }
        .fx-wa-button {
            background: var(--wa-bubble-in);
            border: none;
            padding: 8px 12px;
            font-family: inherit;
            font-size: 13px; font-weight: 500;
            color: var(--wa-button);
            cursor: pointer;
            box-shadow: 0 1px 0.5px rgba(0,0,0,0.13);
            display: flex; align-items: center; justify-content: center;
            gap: 6px;
            transition: background 0.15s ease;
            width: 100%;
            min-width: 200px;
        }
        .fx-wa-button:hover { background: #f0f8f5; }
        .fx-wa-button.is-selected { background: #d1eee0; }
        .fx-wa-button:first-child { border-top-left-radius: 8px; border-top-right-radius: 8px; }
        .fx-wa-button:last-child { border-bottom-left-radius: 8px; border-bottom-right-radius: 8px; }
        .fx-wa-button:only-child { border-radius: 8px; }
        .fx-wa-button-icon { width: 14px; height: 14px; flex-shrink: 0; }
        .fx-wa-button-divider { height: 1px; background: rgba(0,0,0,0.08); margin: 0 12px; }

        /* WhatsApp product card (botones mode) */
        .fx-wa-product {
            background: var(--wa-bubble-in);
            border-radius: 8px;
            padding: 8px;
            margin-top: 5px;
            max-width: 78%;
            align-self: flex-start;
            box-shadow: 0 1px 0.5px rgba(0,0,0,0.13);
            position: relative;
        }
        .fx-wa-product::before {
            content: ''; position: absolute; top: 0; left: -8px;
            width: 8px; height: 13px; background: var(--wa-bubble-in);
            clip-path: polygon(100% 0, 0 0, 100% 100%);
        }
        .fx-wa-product-thumb {
            width: 100%; height: 110px;
            background: linear-gradient(135deg, #fdba74 0%, #f59e0b 100%);
            border-radius: 6px;
            display: grid; place-items: center;
            color: #fff; font-size: 38px;
            margin-bottom: 6px;
        }
        .fx-wa-product-name { font-size: 13px; font-weight: 600; color: var(--wa-text); }
        .fx-wa-product-meta { font-size: 11px; color: var(--wa-text-muted); margin-top: 2px; }
        .fx-wa-product-price {
            font-size: 14px; font-weight: 700; color: var(--wa-button);
            margin-top: 5px;
        }

        .fx-wa-input {
            background: #f0f2f5; padding: 7px;
            display: flex; align-items: center; gap: 6px; flex-shrink: 0;
        }
        .fx-wa-input-field {
            flex: 1; background: #fff; border-radius: 20px;
            padding: 7px 12px; font-size: 12px; color: var(--wa-text-muted);
        }
        .fx-wa-input-send {
            width: 32px; height: 32px; border-radius: 50%;
            background: #00a884; color: #fff;
            display: grid; place-items: center;
        }
        .fx-wa-input-send svg { width: 16px; height: 16px; }

        .fx-preview-footer {
            margin-top: 10px; display: flex; gap: 8px; flex-shrink: 0;
        }
        .fx-replay-btn {
            background: #fff;
            border: 1px solid var(--fx-border);
            color: var(--fx-navy);
            padding: 6px 14px; border-radius: 999px;
            font-family: inherit; font-size: 11.5px; font-weight: 600;
            cursor: pointer;
            display: inline-flex; align-items: center; gap: 6px;
            transition: all 0.15s ease;
        }
        .fx-replay-btn:hover { border-color: var(--fx-orange); color: var(--fx-orange); }
        .fx-replay-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .fx-replay-btn svg { width: 11px; height: 11px; }

        @media (max-width: 980px) {
            .fx-workspace { grid-template-columns: 1fr !important; }
            .fx-preview-pane { border-left: none; border-top: 1px solid var(--fx-border); }
        }
    `;

    // ── INIT ────────────────────────────────────────────────────────
    let mounted = false;
    window.initFlowEditor = function() {
        const host = document.getElementById('flow-editor-host');
        if (!host) return;
        if (!mounted) {
            mountStyles();
            host.innerHTML = baseHTML();
            attachListeners();
            applyWhatsAppDoodles();
            buildStepMenu();
            mounted = true;
        }
        renderAll();
    };

    function mountStyles() {
        if (document.getElementById('flow-editor-styles')) return;
        const s = document.createElement('style');
        s.id = 'flow-editor-styles';
        s.textContent = STYLES;
        document.head.appendChild(s);
    }

    function baseHTML() {
        const s = activeState();
        return `
            <div id="flow-editor-root" class="is-mode-${currentMode}">
                <header class="fx-editor-header">
                    <div class="fx-header-left">
                        <h1 class="fx-header-title">Flujo de conversación</h1>
                        <div class="fx-header-divider"></div>
                        <button type="button" class="fx-tienda-selector">
                            <span class="fx-tienda-avatar-sm">${esc(s.storeInitial)}</span>
                            <span class="fx-tienda-name-sm">${esc(s.storeName)}</span>
                            ${ICONS.chevDown}
                        </button>
                    </div>
                    <div class="fx-header-right">
                        <div class="fx-save-status" id="fx-save-status">
                            <span class="dot"></span>
                            <span id="fx-save-status-text">Guardado</span>
                        </div>
                        <div class="fx-mode-toggle" role="radiogroup">
                            <button type="button" class="fx-mode-btn" data-fx-mode="botones" role="radio">
                                ${ICONS.menu}
                                Botones
                            </button>
                            <button type="button" class="fx-mode-btn" data-fx-mode="conversacional" role="radio">
                                ${ICONS.message}
                                Conversacional
                            </button>
                        </div>
                        <button type="button" class="fx-btn-primary" id="fx-publish-btn">
                            ${ICONS.publish}
                            Publicar
                        </button>
                    </div>
                </header>
                <div class="fx-workspace">
                    <section class="fx-editor-pane">
                        <div class="fx-editor-inner">
                            <div class="fx-trigger">
                                <div class="fx-trigger-icon">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
                                </div>
                                <div>
                                    <div class="fx-trigger-label">Disparador</div>
                                    <div class="fx-trigger-text">Cliente envía cualquier mensaje al WhatsApp</div>
                                </div>
                            </div>
                            <div id="fx-path-summary"></div>
                            <div id="fx-nodes-container" class="fx-nodes-list"></div>
                            <div class="fx-add-step">
                                <button type="button" class="fx-add-step-btn" id="fx-add-step-btn">
                                    ${ICONS.plus}
                                    <span id="fx-add-step-label">Agregar paso</span>
                                </button>
                            </div>
                            <div class="fx-step-menu" id="fx-step-menu"></div>
                        </div>
                    </section>
                    <aside class="fx-preview-pane">
                        <div class="fx-preview-header">
                            <span class="fx-preview-dot"></span>
                            Vista previa · WhatsApp
                        </div>
                        <div class="fx-phone">
                            <div class="fx-phone-screen">
                                <div class="fx-wa-header">
                                    <span class="fx-wa-back">‹</span>
                                    <div class="fx-wa-avatar" id="fx-wa-avatar">${esc(s.storeInitial)}</div>
                                    <div class="fx-wa-contact">
                                        <div class="fx-wa-name" id="fx-wa-name">${esc(s.storeName)}</div>
                                        <div class="fx-wa-status" id="fx-wa-status">en línea</div>
                                    </div>
                                    <div class="fx-wa-icons">
                                        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 7l-7 5 7 5V7zM2 6h13a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6z"/></svg>
                                        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                                        <svg width="4" height="17" viewBox="0 0 4 18" fill="currentColor"><circle cx="2" cy="2" r="1.5"/><circle cx="2" cy="9" r="1.5"/><circle cx="2" cy="16" r="1.5"/></svg>
                                    </div>
                                </div>
                                <div class="fx-wa-chat" id="fx-wa-chat">
                                    <div class="fx-wa-date">HOY</div>
                                </div>
                                <div class="fx-wa-input">
                                    <span style="color:#54656f">😊</span>
                                    <div class="fx-wa-input-field">Mensaje</div>
                                    <span style="color:#54656f">📎</span>
                                    <div class="fx-wa-input-send">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="fx-preview-footer">
                            <button type="button" class="fx-replay-btn" id="fx-replay-btn">
                                ${ICONS.play}
                                Reproducir conversación
                            </button>
                        </div>
                    </aside>
                </div>
            </div>
        `;
    }

    // ── RENDER DISPATCH ─────────────────────────────────────────────
    function renderAll() {
        const root = document.getElementById('flow-editor-root');
        if (root) {
            root.classList.toggle('is-mode-conversacional', currentMode === 'conversacional');
            root.classList.toggle('is-mode-botones', currentMode === 'botones');
        }
        if (currentMode === 'botones') renderWorkflowBot();
        else renderWorkflowConv();
        renderPreview();
        syncModeUI();
        buildStepMenu();
    }

    function syncModeUI() {
        document.querySelectorAll('[data-fx-mode]').forEach(b => {
            b.classList.toggle('is-active', b.dataset.fxMode === currentMode);
        });
        const lbl = document.getElementById('fx-add-step-label');
        if (lbl) lbl.textContent = currentMode === 'botones' ? 'Agregar nodo' : 'Agregar paso';
    }

    // ── RENDER: CONVERSACIONAL ──────────────────────────────────────
    function renderWorkflowConv() {
        const c = document.getElementById('fx-nodes-container');
        const ps = document.getElementById('fx-path-summary');
        if (!c) return;
        if (ps) ps.innerHTML = ''; // sin path summary en conversacional
        c.innerHTML = '';
        let stepNum = 0;
        stateConv.nodes.forEach((node) => {
            const conn = document.createElement('div');
            conn.className = 'fx-connector' + (node.type === 'customer-reply' ? ' short' : '');
            c.appendChild(conn);
            if (node.type === 'customer-reply') {
                c.appendChild(renderConvReplyCard(node));
            } else {
                stepNum++;
                c.appendChild(renderConvBotNode(node, stepNum));
            }
        });
    }

    function renderConvBotNode(node, stepNum) {
        const t = CONV_TYPES[node.type] || CONV_TYPES.message;
        const el = document.createElement('div');
        el.className = 'fx-node';
        el.dataset.nodeId = node.id;

        const bubbles = node.bubbles.map((b, i) => `
            <div class="fx-bubble-field">
                <div class="fx-bubble-num">${i + 1}</div>
                <div class="fx-editable" contenteditable="true"
                     data-field="bubble" data-node="${esc(node.id)}" data-idx="${i}">${esc(b)}</div>
                ${node.bubbles.length > 1 ? `<button class="fx-bubble-del" data-fx-act="del-bubble" data-node="${esc(node.id)}" data-idx="${i}" title="Quitar">${ICONS.x}</button>` : ''}
            </div>
        `).join('');

        el.innerHTML = `
            <div class="fx-node-head">
                <div class="fx-node-icon t-${node.type}">${ICONS[t.iconKey]}</div>
                <div class="fx-node-meta">
                    <div class="fx-node-type">${esc(t.label)} · Paso ${stepNum}</div>
                    <div class="fx-node-title" contenteditable="true"
                         data-field="title" data-node="${esc(node.id)}">${esc(node.title)}</div>
                </div>
                <div class="fx-node-actions">
                    <button class="fx-node-action" data-fx-action="duplicate" data-node="${esc(node.id)}" title="Duplicar">${ICONS.copy}</button>
                    <button class="fx-node-action" data-fx-action="delete" data-node="${esc(node.id)}" title="Eliminar">${ICONS.trash}</button>
                </div>
            </div>
            <div class="fx-node-body">
                <div class="fx-bubble-list">${bubbles}</div>
                <button class="fx-add-bubble" data-fx-act="add-bubble" data-node="${esc(node.id)}">${ICONS.plus} agregar mensaje</button>
            </div>
        `;
        return el;
    }

    function renderConvReplyCard(node) {
        const el = document.createElement('div');
        el.className = 'fx-reply-card';
        el.dataset.nodeId = node.id;
        const bubbles = node.bubbles.map((b, i) => `
            <div class="fx-reply-bubble-field">
                <div class="fx-editable" contenteditable="true"
                     data-field="bubble" data-node="${esc(node.id)}" data-idx="${i}">${esc(b)}</div>
                ${node.bubbles.length > 1 ? `<button class="fx-bubble-del" data-fx-act="del-bubble" data-node="${esc(node.id)}" data-idx="${i}" title="Quitar">${ICONS.x}</button>` : ''}
            </div>
        `).join('');
        el.innerHTML = `
            <div class="fx-reply-head">
                <div class="fx-reply-avatar">${ICONS.user}</div>
                <div class="fx-reply-label">Cliente responde</div>
                <div class="fx-reply-actions">
                    <button class="fx-reply-action" data-fx-act="add-bubble" data-node="${esc(node.id)}" title="Agregar otra respuesta">${ICONS.plus}</button>
                    <button class="fx-reply-action" data-fx-action="delete" data-node="${esc(node.id)}" title="Quitar">${ICONS.trash}</button>
                </div>
            </div>
            <div class="fx-reply-bubbles">${bubbles}</div>
        `;
        return el;
    }

    // ── RENDER: BOTONES (con branching + path) ──────────────────────
    function computePath() {
        const path = [];
        const seen = new Set();
        let currentId = stateBot.rootNodeId;
        while (currentId && !seen.has(currentId)) {
            seen.add(currentId);
            const node = stateBot.nodes.find(n => n.id === currentId);
            if (!node) break;
            path.push(node);
            if (node.type === 'prompt') {
                currentId = node.nextNodeId;
            } else if (node.type === 'menu' || node.type === 'products') {
                const btnIdx = stateBot.selectedButton[node.id] ?? 0;
                const btn = node.buttons?.[btnIdx];
                currentId = btn?.target || null;
            } else {
                break;
            }
        }
        return path;
    }

    function renderWorkflowBot() {
        const c = document.getElementById('fx-nodes-container');
        const ps = document.getElementById('fx-path-summary');
        if (!c) return;
        const path = computePath();
        const pathIds = new Set(path.map(n => n.id));

        if (ps) {
            ps.innerHTML = `
                <div class="fx-path-summary">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="5 12 19 12"/><polyline points="12 5 19 12 12 19"/></svg>
                    <div style="flex:1">
                        <div><strong>Camino activo</strong> · clic en los botones del preview para cambiar de rama</div>
                        <div class="fx-path-chips">
                            ${path.map((n, i) => `<span class="fx-path-chip${i === path.length - 1 ? ' is-current' : ''}">${esc(n.id)} · ${esc(n.title || '')}</span>${i < path.length - 1 ? '<span class="fx-path-sep">›</span>' : ''}`).join(' ')}
                        </div>
                    </div>
                </div>
            `;
        }

        c.innerHTML = '';
        stateBot.nodes.forEach((node) => {
            c.appendChild(renderBotNode(node, pathIds.has(node.id)));
        });
    }

    function renderBotNode(node, isOnPath) {
        const t = BOT_TYPES[node.type] || BOT_TYPES.menu;
        const el = document.createElement('div');
        el.className = 'fx-node' + (isOnPath ? ' is-on-path' : '');
        el.dataset.nodeId = node.id;

        const head = `
            <div class="fx-node-head">
                <div class="fx-node-icon t-${esc(node.type)}">${ICONS[t.iconKey]}</div>
                <div class="fx-node-id">${esc(node.id)}</div>
                <div class="fx-node-meta">
                    <div class="fx-node-type">${esc(t.label)}</div>
                    <div class="fx-node-title" contenteditable="true" data-field="title" data-node="${esc(node.id)}">${esc(node.title)}</div>
                </div>
                <div class="fx-node-actions">
                    <button class="fx-node-action" data-fx-action="duplicate" data-node="${esc(node.id)}" title="Duplicar">${ICONS.copy}</button>
                    <button class="fx-node-action" data-fx-action="delete" data-node="${esc(node.id)}" title="Eliminar">${ICONS.trash}</button>
                </div>
            </div>`;

        let body = '<div class="fx-node-body">';

        // Bubbles
        body += '<div class="fx-sub-label">Mensajes del bot</div>';
        body += '<div class="fx-bubble-list">';
        node.bubbles.forEach((b, i) => {
            body += `
                <div class="fx-bubble-field">
                    <div class="fx-bubble-num">${i + 1}</div>
                    <div class="fx-editable" contenteditable="true" data-field="bubble" data-node="${esc(node.id)}" data-idx="${i}">${esc(b)}</div>
                    ${node.bubbles.length > 1 ? `<button class="fx-bubble-del" data-fx-act="del-bubble" data-node="${esc(node.id)}" data-idx="${i}" title="Quitar">${ICONS.x}</button>` : '<div></div>'}
                </div>`;
        });
        body += '</div>';
        body += `<button class="fx-add-bubble" data-fx-act="add-bubble" data-node="${esc(node.id)}">${ICONS.plus} agregar mensaje</button>`;

        // Products (products type)
        if (node.type === 'products' && Array.isArray(node.products)) {
            body += `<div class="fx-sub-label">Productos<span class="fx-sub-label-count">${node.products.length} a mostrar</span></div>`;
            node.products.forEach((p, i) => {
                body += `
                    <div class="fx-product-row">
                        <div class="fx-product-thumb">${esc(p.emoji || '📦')}</div>
                        <div class="fx-product-info">
                            <div class="fx-product-name fx-editable" contenteditable="true" data-field="product-name" data-node="${esc(node.id)}" data-idx="${i}">${esc(p.name)}</div>
                            <div class="fx-product-meta fx-editable" contenteditable="true" data-field="product-meta" data-node="${esc(node.id)}" data-idx="${i}">${esc(p.price)} · ${esc(p.desc)}</div>
                        </div>
                        ${node.products.length > 1 ? `<button class="fx-bubble-del" data-fx-act="del-product" data-node="${esc(node.id)}" data-idx="${i}" title="Quitar producto">${ICONS.x}</button>` : ''}
                    </div>`;
            });
            body += `<button class="fx-add-bubble" data-fx-act="add-product" data-node="${esc(node.id)}">${ICONS.plus} agregar producto</button>`;
        }

        // Buttons (menu / products)
        if (node.type === 'menu' || node.type === 'products') {
            const selectedIdx = stateBot.selectedButton[node.id] ?? 0;
            const buttons = node.buttons || [];
            body += `<div class="fx-sub-label">Botones de respuesta<span class="fx-sub-label-count">${buttons.length} de 3 · WhatsApp permite máx. 3</span></div>`;
            body += '<div class="fx-buttons-section">';
            buttons.forEach((b, i) => {
                const isSelected = isOnPath && i === selectedIdx;
                const targetName = b.target ? getNodeShortName(b.target) : 'FIN — sin destino';
                const isTerminal = !b.target;
                body += `
                    <div class="fx-button-row${isSelected ? ' is-selected-path' : ''}" data-node="${esc(node.id)}" data-btn-idx="${i}">
                        <span class="fx-btn-num">${i + 1}</span>
                        <div class="fx-editable" contenteditable="true" data-field="button-label" data-node="${esc(node.id)}" data-idx="${i}">${esc(b.label)}</div>
                        <div class="fx-target-picker${isTerminal ? ' is-terminal' : ''}" data-node="${esc(node.id)}" data-btn-idx="${i}">
                            <span class="fx-target-arrow">→</span>
                            <span class="fx-target-label">${esc(targetName)}</span>
                            ${ICONS.chevDown}
                            <div class="fx-target-popup">
                                ${stateBot.nodes.filter(n => n.id !== node.id).map(n => `
                                    <div class="fx-target-option${b.target === n.id ? ' is-active' : ''}" data-target="${esc(n.id)}">
                                        <span class="fx-opt-id">${esc(n.id)}</span>
                                        <span>${esc(n.title || '')}</span>
                                    </div>`).join('')}
                                <div class="fx-target-option terminal${!b.target ? ' is-active' : ''}" data-target="">
                                    FIN — sin destino
                                </div>
                            </div>
                        </div>
                        <button class="fx-bubble-del" data-fx-act="del-button" data-node="${esc(node.id)}" data-idx="${i}" title="Quitar botón">${ICONS.x}</button>
                    </div>`;
            });
            body += '</div>';
            const atLimit = buttons.length >= 3;
            body += `<button class="fx-add-button" data-fx-act="add-button" data-node="${esc(node.id)}"${atLimit ? ' disabled' : ''}>${ICONS.plus} agregar botón</button>`;
            if (atLimit) body += `<span class="fx-button-limit-hint">Llegaste al máximo de WhatsApp (3 botones)</span>`;
        }

        // Prompt
        if (node.type === 'prompt') {
            const nextName = node.nextNodeId ? getNodeShortName(node.nextNodeId) : 'FIN — sin destino';
            body += `
                <div class="fx-prompt-info">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><circle cx="12" cy="8" r="0.5" fill="currentColor"/></svg>
                    <div class="fx-prompt-info-text">
                        <strong>Esperamos respuesta libre del cliente</strong> — texto, número o imagen.
                        <div class="fx-simulated">Simulado en preview: ${esc(node.simulatedResponse || '...')}</div>
                    </div>
                </div>
                <div class="fx-prompt-next">
                    <span class="fx-prompt-next-label">Después continúa con:</span>
                    <div class="fx-target-picker" data-node="${esc(node.id)}" data-prompt-target="1">
                        <span class="fx-target-arrow">→</span>
                        <span class="fx-target-label">${esc(nextName)}</span>
                        ${ICONS.chevDown}
                        <div class="fx-target-popup">
                            ${stateBot.nodes.filter(n => n.id !== node.id).map(n => `
                                <div class="fx-target-option${node.nextNodeId === n.id ? ' is-active' : ''}" data-target="${esc(n.id)}">
                                    <span class="fx-opt-id">${esc(n.id)}</span>
                                    <span>${esc(n.title || '')}</span>
                                </div>`).join('')}
                            <div class="fx-target-option terminal${!node.nextNodeId ? ' is-active' : ''}" data-target="">
                                FIN — sin destino
                            </div>
                        </div>
                    </div>
                </div>`;
        }

        // Terminal
        if (node.type === 'terminal') {
            body += `
                <div class="fx-terminal-info">
                    ${ICONS.terminal}
                    Fin del flujo — termina la conversación o pasa al equipo humano
                </div>`;
        }

        body += '</div>';
        el.innerHTML = head + body;
        return el;
    }

    function getNodeShortName(id) {
        const n = stateBot.nodes.find(x => x.id === id);
        return n ? `${n.id} · ${n.title || ''}` : id;
    }

    // ── PREVIEW DISPATCH ────────────────────────────────────────────
    function renderPreview() {
        if (currentMode === 'botones') renderPreviewBot();
        else renderPreviewConv();
    }

    function renderPreviewConv() {
        const waChat = document.getElementById('fx-wa-chat');
        if (!waChat) return;
        waChat.innerHTML = '<div class="fx-wa-date">HOY</div>';
        let prevSender = null;
        let elapsed = 0;
        stateConv.nodes.forEach((node) => {
            const sender = node.type === 'customer-reply' ? 'out' : 'in';
            if (prevSender && sender !== prevSender) elapsed += 1;
            node.bubbles.forEach((text, bIdx) => {
                const isFirst = (bIdx === 0 && sender !== prevSender);
                const bubble = document.createElement('div');
                bubble.className = 'fx-bubble ' + sender + (isFirst ? '' : ' continuation');
                bubble.dataset.nodeId = node.id;
                bubble.dataset.bubbleIdx = bIdx;
                bubble.innerHTML = `
                    <div class="fx-bubble-text" contenteditable="true"
                         data-field="bubble" data-node="${esc(node.id)}" data-idx="${bIdx}">${esc(text)}</div>
                    <div class="fx-bubble-meta">${formatTime(elapsed)}${sender === 'out' ? '<span class="fx-bubble-check">✓✓</span>' : ''}</div>
                `;
                waChat.appendChild(bubble);
                prevSender = sender;
            });
            elapsed += node.bubbles.length;
        });
        setTimeout(() => { waChat.scrollTop = waChat.scrollHeight; }, 10);
    }

    function renderPreviewBot() {
        const waChat = document.getElementById('fx-wa-chat');
        if (!waChat) return;
        waChat.innerHTML = '<div class="fx-wa-date">HOY</div>';
        const path = computePath();
        let prevSender = null;
        let elapsed = 0;

        path.forEach((node, nIdx) => {
            const isLast = nIdx === path.length - 1;
            if (prevSender === 'out') elapsed += 1;
            node.bubbles.forEach((text, bIdx) => {
                const isFirst = (bIdx === 0 && prevSender !== 'in');
                addPreviewBubble(text, 'in', isFirst, elapsed);
                prevSender = 'in';
            });
            elapsed += node.bubbles.length;

            // Product card (products node)
            if (node.type === 'products' && node.products?.length) {
                addPreviewProductCard(node.products[0]);
            }

            // Quick-reply buttons (menu/products)
            if ((node.type === 'menu' || node.type === 'products') && node.buttons?.length) {
                const selectedIdx = stateBot.selectedButton[node.id] ?? 0;
                const hasNext = !isLast || (node.buttons[selectedIdx] && node.buttons[selectedIdx].target);
                addPreviewButtonsBlock(node, selectedIdx, hasNext);
                if (hasNext) {
                    elapsed += 1;
                    addPreviewBubble(node.buttons[selectedIdx].label, 'out', true, elapsed);
                    prevSender = 'out';
                }
            }

            // Prompt simulated response
            if (node.type === 'prompt' && !isLast) {
                elapsed += 1;
                addPreviewBubble(node.simulatedResponse || '...', 'out', true, elapsed);
                prevSender = 'out';
            }
        });
        setTimeout(() => { waChat.scrollTop = waChat.scrollHeight; }, 10);
    }

    function addPreviewBubble(text, sender, isFirst, elapsed) {
        const waChat = document.getElementById('fx-wa-chat');
        const bubble = document.createElement('div');
        bubble.className = 'fx-bubble ' + sender + (isFirst ? '' : ' continuation');
        bubble.innerHTML = `
            <div class="fx-bubble-text">${formatWAText(text)}</div>
            <div class="fx-bubble-meta">${formatTime(elapsed)}${sender === 'out' ? '<span class="fx-bubble-check">✓✓</span>' : ''}</div>
        `;
        waChat.appendChild(bubble);
    }

    function addPreviewProductCard(p) {
        const waChat = document.getElementById('fx-wa-chat');
        const card = document.createElement('div');
        card.className = 'fx-wa-product';
        card.innerHTML = `
            <div class="fx-wa-product-thumb">${esc(p.emoji || '📦')}</div>
            <div class="fx-wa-product-name">${esc(p.name)}</div>
            <div class="fx-wa-product-meta">${esc(p.desc)}</div>
            <div class="fx-wa-product-price">${esc(p.price)}</div>
        `;
        waChat.appendChild(card);
    }

    function addPreviewButtonsBlock(node, selectedIdx, hasNext) {
        const waChat = document.getElementById('fx-wa-chat');
        const block = document.createElement('div');
        block.className = 'fx-wa-buttons-block';
        node.buttons.forEach((b, i) => {
            const btn = document.createElement('button');
            btn.className = 'fx-wa-button' + (i === selectedIdx && hasNext ? ' is-selected' : '');
            btn.innerHTML = `
                <svg class="fx-wa-button-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
                <span>${esc(b.label)}</span>
            `;
            btn.addEventListener('click', () => {
                stateBot.selectedButton[node.id] = i;
                renderAll();
            });
            block.appendChild(btn);
            if (i < node.buttons.length - 1) {
                const div = document.createElement('div');
                div.className = 'fx-wa-button-divider';
                block.appendChild(div);
            }
        });
        waChat.appendChild(block);
    }

    // ── LISTENERS ──────────────────────────────────────────────────
    function attachListeners() {
        const root = document.getElementById('flow-editor-root');
        if (!root) return;

        root.addEventListener('click', (e) => {
            // Mode toggle
            const modeBtn = e.target.closest('[data-fx-mode]');
            if (modeBtn) {
                const newMode = modeBtn.dataset.fxMode;
                if (newMode !== currentMode) {
                    currentMode = newMode;
                    renderAll();
                }
                return;
            }
            // Add step
            if (e.target.closest('#fx-add-step-btn')) {
                document.getElementById('fx-step-menu').classList.toggle('is-open');
                return;
            }
            // Close menus on outside click
            if (!e.target.closest('#fx-add-step-btn') && !e.target.closest('#fx-step-menu')) {
                const menu = document.getElementById('fx-step-menu');
                if (menu) menu.classList.remove('is-open');
            }
            if (!e.target.closest('.fx-target-picker')) {
                document.querySelectorAll('.fx-target-picker.is-open').forEach(p => p.classList.remove('is-open'));
            }
            // Replay
            if (e.target.closest('#fx-replay-btn')) {
                replay();
                return;
            }
            // Target picker click
            const picker = e.target.closest('.fx-target-picker');
            if (picker && !e.target.closest('.fx-target-option')) {
                document.querySelectorAll('.fx-target-picker.is-open').forEach(p => {
                    if (p !== picker) p.classList.remove('is-open');
                });
                picker.classList.toggle('is-open');
                e.stopPropagation();
                return;
            }
            // Target option chosen
            const opt = e.target.closest('.fx-target-option');
            if (opt) {
                const p = opt.closest('.fx-target-picker');
                const targetId = opt.dataset.target;
                const nodeId = p.dataset.node;
                const btnIdx = p.dataset.btnIdx;
                const isPromptTarget = p.dataset.promptTarget === '1';
                const node = stateBot.nodes.find(n => n.id === nodeId);
                if (node) {
                    if (isPromptTarget) node.nextNodeId = targetId || null;
                    else if (btnIdx !== undefined) node.buttons[parseInt(btnIdx, 10)].target = targetId || '';
                }
                p.classList.remove('is-open');
                flashSave();
                renderAll();
                e.stopPropagation();
                return;
            }
            // Node action (duplicate / delete)
            const actionBtn = e.target.closest('[data-fx-action]');
            if (actionBtn) {
                handleNodeAction(actionBtn);
                return;
            }
            // Sub-action (add-bubble, del-bubble, add-button, etc.)
            const subBtn = e.target.closest('[data-fx-act]');
            if (subBtn) {
                handleSubAction(subBtn);
                return;
            }
        });

        // ContentEditable input
        root.addEventListener('input', (e) => {
            const el = e.target;
            if (!el.matches('[contenteditable="true"]')) return;
            if (el.closest('.fx-wa-chat')) {
                handlePreviewFieldEdit(el);
            } else if (el.closest('#fx-nodes-container')) {
                handleNodeFieldEdit(el);
            }
        });

        root.addEventListener('focusin', (e) => {
            const el = e.target;
            if (!el.matches('[contenteditable="true"]')) return;
            const id = el.dataset.node;
            highlightCard(id);
            if (el.closest('.fx-wa-chat')) scrollCardIntoView(id);
        });
    }

    function handleNodeFieldEdit(el) {
        const id = el.dataset.node;
        const field = el.dataset.field;
        const state = activeState();
        const node = state.nodes.find(n => n.id === id);
        if (!node) return;
        if (field === 'title') {
            node.title = el.innerText;
        } else if (field === 'bubble') {
            const idx = parseInt(el.dataset.idx, 10);
            if (Number.isInteger(idx)) {
                node.bubbles[idx] = el.innerText;
                if (currentMode === 'conversacional') syncBubbleToPreview(id, idx, el.innerText);
                else renderPreview(); // botones: re-render preview (path puede cambiar texto del out bubble)
            }
        } else if (field === 'button-label') {
            const idx = parseInt(el.dataset.idx, 10);
            if (node.buttons && Number.isInteger(idx)) {
                node.buttons[idx].label = el.innerText;
                renderPreview();
            }
        } else if (field === 'product-name') {
            const idx = parseInt(el.dataset.idx, 10);
            if (node.products && Number.isInteger(idx)) {
                node.products[idx].name = el.innerText;
                renderPreview();
            }
        } else if (field === 'product-meta') {
            const idx = parseInt(el.dataset.idx, 10);
            if (node.products && Number.isInteger(idx)) {
                const parts = el.innerText.split('·').map(s => s.trim());
                node.products[idx].price = parts[0] || '';
                node.products[idx].desc = parts.slice(1).join(' · ') || '';
                renderPreview();
            }
        }
        flashSave();
    }

    function handlePreviewFieldEdit(el) {
        const id = el.dataset.node;
        const idx = parseInt(el.dataset.idx, 10);
        const state = activeState();
        const node = state.nodes.find(n => n.id === id);
        if (!node || !Number.isInteger(idx)) return;
        node.bubbles[idx] = el.innerText;
        syncBubbleToWorkflow(id, idx, el.innerText);
        flashSave();
    }

    function syncBubbleToPreview(nodeId, idx, text) {
        const waChat = document.getElementById('fx-wa-chat');
        if (!waChat) return;
        const bubble = waChat.querySelector(`.fx-bubble[data-node-id="${nodeId}"][data-bubble-idx="${idx}"]`);
        if (!bubble) return;
        const txt = bubble.querySelector('.fx-bubble-text');
        if (txt && document.activeElement !== txt) txt.innerText = text;
        bubble.classList.add('is-syncing');
        setTimeout(() => bubble.classList.remove('is-syncing'), 600);
    }

    function syncBubbleToWorkflow(nodeId, idx, text) {
        const c = document.getElementById('fx-nodes-container');
        if (!c) return;
        const target = c.querySelector(`.fx-editable[data-field="bubble"][data-node="${nodeId}"][data-idx="${idx}"]`);
        if (target && document.activeElement !== target) target.innerText = text;
        highlightCard(nodeId, true);
    }

    function highlightCard(id, pulse = false) {
        const c = document.getElementById('fx-nodes-container');
        if (!c) return;
        c.querySelectorAll('.is-active').forEach(n => n.classList.remove('is-active'));
        const card = c.querySelector(`[data-node-id="${id}"]`);
        if (card) {
            card.classList.add('is-active');
            if (pulse) setTimeout(() => card.classList.remove('is-active'), 900);
        }
    }

    function scrollCardIntoView(id) {
        const c = document.getElementById('fx-nodes-container');
        if (!c) return;
        const card = c.querySelector(`[data-node-id="${id}"]`);
        if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // ── ACTIONS ─────────────────────────────────────────────────────
    function handleNodeAction(btn) {
        const action = btn.dataset.fxAction;
        const id = btn.dataset.node;
        const state = activeState();
        const idx = state.nodes.findIndex(n => n.id === id);
        if (idx === -1) return;
        if (action === 'delete') {
            if (state.nodes.length <= 1) return;
            state.nodes.splice(idx, 1);
            if (currentMode === 'botones') {
                // Limpiar refs huérfanas
                state.nodes.forEach(n => {
                    if (n.buttons) n.buttons.forEach(b => { if (b.target === id) b.target = ''; });
                    if (n.nextNodeId === id) n.nextNodeId = null;
                });
                if (state.rootNodeId === id) state.rootNodeId = state.nodes[0]?.id;
                delete state.selectedButton[id];
            }
            renderAll();
            flashSave();
        } else if (action === 'duplicate') {
            const copy = JSON.parse(JSON.stringify(state.nodes[idx]));
            copy.id = 'n' + Date.now();
            if (copy.title) copy.title += ' (copia)';
            state.nodes.splice(idx + 1, 0, copy);
            renderAll();
            flashSave();
        }
    }

    function handleSubAction(btn) {
        const act = btn.dataset.fxAct;
        const id = btn.dataset.node;
        const state = activeState();
        const node = state.nodes.find(n => n.id === id);
        if (!node) return;
        if (act === 'add-bubble') {
            node.bubbles.push(node.type === 'customer-reply' ? 'Nueva respuesta' : 'Nuevo mensaje del bot...');
        } else if (act === 'del-bubble') {
            const idx = parseInt(btn.dataset.idx, 10);
            if (Number.isInteger(idx) && node.bubbles.length > 1) node.bubbles.splice(idx, 1);
        } else if (act === 'add-button') {
            if (node.buttons.length < 3) node.buttons.push({ label: 'Nuevo botón', target: '' });
        } else if (act === 'del-button') {
            const idx = parseInt(btn.dataset.idx, 10);
            if (Number.isInteger(idx)) {
                node.buttons.splice(idx, 1);
                if (node.buttons.length === 0) node.buttons.push({ label: 'Continuar', target: '' });
                stateBot.selectedButton[id] = 0;
            }
        } else if (act === 'add-product') {
            node.products.push({ name: 'Nuevo producto', price: 'S/ 0', desc: 'Descripción breve', emoji: '📦' });
        } else if (act === 'del-product') {
            const idx = parseInt(btn.dataset.idx, 10);
            if (Number.isInteger(idx) && node.products.length > 1) node.products.splice(idx, 1);
        }
        renderAll();
        flashSave();
    }

    // ── STEP MENU ──────────────────────────────────────────────────
    function buildStepMenu() {
        const menu = document.getElementById('fx-step-menu');
        if (!menu) return;
        const TYPES = currentMode === 'botones' ? BOT_TYPES : CONV_TYPES;
        const items = Object.entries(TYPES).map(([k, info]) => `
            <button type="button" class="fx-step-menu-item" data-fx-add="${esc(k)}">
                <div class="fx-step-menu-icon t-${esc(k)}">${ICONS[info.iconKey]}</div>
                <div>
                    <div class="fx-step-menu-label">${esc(info.label)}</div>
                    <div class="fx-step-menu-desc">${esc(info.desc)}</div>
                </div>
            </button>
        `).join('');
        // Reply card option (solo conversacional)
        const reply = currentMode === 'conversacional' ? `
            <button type="button" class="fx-step-menu-item" data-fx-add="customer-reply">
                <div class="fx-step-menu-icon t-customer-reply">${ICONS.user}</div>
                <div>
                    <div class="fx-step-menu-label">Respuesta del cliente</div>
                    <div class="fx-step-menu-desc">Simular lo que escribe</div>
                </div>
            </button>` : '';
        menu.innerHTML = items + reply;
        menu.querySelectorAll('[data-fx-add]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const type = btn.dataset.fxAdd;
                const TPL = currentMode === 'botones' ? BOT_TEMPLATES : CONV_TEMPLATES;
                const tpl = TPL[type];
                if (!tpl) return;
                const state = activeState();
                const newNode = Object.assign(
                    { id: 'n' + Date.now(), type },
                    JSON.parse(JSON.stringify(tpl))
                );
                state.nodes.push(newNode);
                menu.classList.remove('is-open');
                renderAll();
                flashSave();
                setTimeout(() => {
                    const c = document.getElementById('fx-nodes-container');
                    const el = c?.querySelector(`[data-node-id="${newNode.id}"]`);
                    if (el) {
                        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        el.classList.add('is-active');
                    }
                }, 50);
            });
        });
    }

    // ── SAVE STATUS ─────────────────────────────────────────────────
    let saveTimer = null;
    function flashSave() {
        const status = document.getElementById('fx-save-status');
        const text = document.getElementById('fx-save-status-text');
        if (!status || !text) return;
        status.classList.add('is-saving');
        text.textContent = 'Guardando...';
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            status.classList.remove('is-saving');
            text.textContent = 'Guardado';
        }, 800);
    }

    // ── REPLAY ──────────────────────────────────────────────────────
    async function replay() {
        const replayBtn = document.getElementById('fx-replay-btn');
        const waChat = document.getElementById('fx-wa-chat');
        if (!replayBtn || !waChat) return;
        replayBtn.disabled = true;
        waChat.innerHTML = '<div class="fx-wa-date">HOY</div>';
        const sequence = currentMode === 'botones' ? replaySequenceBot() : replaySequenceConv();
        let prevSender = null;
        let elapsed = 0;
        for (const item of sequence) {
            if (item.role && prevSender && item.role !== prevSender) elapsed += 1;
            if (item.role === 'in') {
                setStatusTyping(true);
                await wait(prevSender ? 850 : 500);
            } else if (item.role === 'out') {
                await wait(prevSender === 'in' ? 700 : 400);
            }
            if (item.type === 'bubble') {
                addPreviewBubble(item.text, item.role, item.isFirst, elapsed);
                if (item.role === 'in') elapsed += 0; // increment after all bubbles of this group
                prevSender = item.role;
            } else if (item.type === 'product') {
                addPreviewProductCard(item.product);
            } else if (item.type === 'buttons') {
                addPreviewButtonsBlock(item.node, item.selectedIdx, item.hasNext);
            }
            waChat.scrollTop = waChat.scrollHeight;
            if (item.type === 'bubble' && item.role === 'in') setStatusTyping(false);
            elapsed += item.timeStep || 0;
            if (item.delayAfter) await wait(item.delayAfter);
        }
        setStatusTyping(false);
        await wait(400);
        renderPreview();
        replayBtn.disabled = false;
    }

    function replaySequenceConv() {
        const seq = [];
        let prevSender = null;
        stateConv.nodes.forEach(node => {
            const sender = node.type === 'customer-reply' ? 'out' : 'in';
            node.bubbles.forEach((text, bIdx) => {
                const isFirst = (bIdx === 0 && sender !== prevSender);
                seq.push({
                    type: 'bubble', role: sender, text, isFirst,
                    timeStep: bIdx === node.bubbles.length - 1 ? 1 : 0,
                    delayAfter: bIdx < node.bubbles.length - 1 ? (sender === 'in' ? 380 : 500) : 0
                });
                prevSender = sender;
            });
        });
        return seq;
    }

    function replaySequenceBot() {
        const path = computePath();
        const seq = [];
        let prevSender = null;
        path.forEach((node, nIdx) => {
            const isLast = nIdx === path.length - 1;
            node.bubbles.forEach((text, bIdx) => {
                const isFirst = (bIdx === 0 && prevSender !== 'in');
                seq.push({
                    type: 'bubble', role: 'in', text, isFirst,
                    timeStep: bIdx === node.bubbles.length - 1 ? 1 : 0,
                    delayAfter: bIdx < node.bubbles.length - 1 ? 380 : 0
                });
                prevSender = 'in';
            });
            if (node.type === 'products' && node.products?.length) {
                seq.push({ type: 'product', product: node.products[0], delayAfter: 400 });
            }
            if ((node.type === 'menu' || node.type === 'products') && node.buttons?.length) {
                const selectedIdx = stateBot.selectedButton[node.id] ?? 0;
                const hasNext = !isLast || (node.buttons[selectedIdx] && node.buttons[selectedIdx].target);
                seq.push({ type: 'buttons', node, selectedIdx, hasNext, delayAfter: hasNext ? 600 : 200 });
                if (hasNext) {
                    seq.push({
                        type: 'bubble', role: 'out',
                        text: node.buttons[selectedIdx].label, isFirst: true,
                        timeStep: 1, delayAfter: 0
                    });
                    prevSender = 'out';
                }
            }
            if (node.type === 'prompt' && !isLast) {
                seq.push({
                    type: 'bubble', role: 'out',
                    text: node.simulatedResponse || '...', isFirst: true,
                    timeStep: 1, delayAfter: 0
                });
                prevSender = 'out';
            }
        });
        return seq;
    }

    function setStatusTyping(on) {
        const s = document.getElementById('fx-wa-status');
        if (!s) return;
        if (on) { s.classList.add('typing'); s.textContent = 'escribiendo...'; }
        else { s.classList.remove('typing'); s.textContent = 'en línea'; }
    }

    function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

    // ── WhatsApp doodle bg ──────────────────────────────────────────
    function applyWhatsAppDoodles() {
        const c = '#d4ccba';
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240"><g fill="none" stroke="${c}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M28,30 v14 M21,37 h14"/><path d="M85,40 c-3,-7 -12,-7 -12,0 c0,5 12,11 12,11 c0,0 12,-6 12,-11 c0,-7 -9,-7 -12,0 z" fill="${c}" stroke="none"/><circle cx="148" cy="40" r="11"/><circle cx="144" cy="37" r="1.2" fill="${c}" stroke="none"/><circle cx="152" cy="37" r="1.2" fill="${c}" stroke="none"/><path d="M143,43 q5,5 10,0"/><path d="M205,30 l3,7 l8,1 l-5.5,5 l1.5,8 l-7,-4 l-7,4 l1.5,-8 l-5.5,-5 l8,-1 z" fill="${c}" stroke="none"/><rect x="28" y="100" width="24" height="17" rx="2"/><circle cx="40" cy="108.5" r="4.5"/><rect x="35" y="96" width="6" height="4" rx="0.5"/><circle cx="110" cy="102" r="3.2" fill="${c}" stroke="none"/><circle cx="116" cy="108" r="3.2" fill="${c}" stroke="none"/><circle cx="110" cy="114" r="3.2" fill="${c}" stroke="none"/><circle cx="104" cy="108" r="3.2" fill="${c}" stroke="none"/><circle cx="110" cy="108" r="2" fill="#efeae2"/><path d="M168,99 q0,-6 6,-6 q7,0 7,5 q0,3 -3.5,5 q-3.5,2 -3.5,6"/><circle cx="174.5" cy="116" r="1.2" fill="${c}" stroke="none"/><path d="M208,108 v-12 l10,-2 v10"/><ellipse cx="206" cy="108" rx="3" ry="2.2" fill="${c}" stroke="none"/><ellipse cx="215" cy="106" rx="3" ry="2.2" fill="${c}" stroke="none"/><rect x="22" y="158" width="14" height="22" rx="2.5"/><path d="M25,162 h8"/><circle cx="29" cy="176" r="1.2" fill="${c}" stroke="none"/><path d="M76,170 v10 q0,5 5,5 h7 q5,0 5,-5 v-10 z"/><path d="M93,173 h3 a3,3 0 0 1 0,6 h-3"/><path d="M80,165 q1,-3 0,-5 m4,5 q1,-3 0,-5 m4,5 q1,-3 0,-5"/><circle cx="148" cy="175" r="6"/><path d="M148,163 v4 M148,183 v4 M136,175 h4 M156,175 h4 M139,166 l3,3 M157,184 l-3,-3 M139,184 l3,-3 M157,166 l-3,3"/><path d="M198,182 q-4,-1 -4,4 q0,4 4,4 h22 q4,0 4,-4 q0,-4 -4,-4 q-1,-6 -8,-6 q-6,0 -8,6 z"/><path d="M30,212 a6,6 0 1 1 10,0 q-1,2 -2,4 v3 h-6 v-3 q-1,-2 -2,-4 z"/><path d="M33,225 h4"/><rect x="78" y="220" width="20" height="13" rx="1"/><path d="M88,220 v13 M78,225 h20"/><rect x="138" y="218" width="22" height="15" rx="1"/><path d="M139,219 l10,7 l10,-7"/><path d="M198,212 l8,-8 l5,5 l-8,8 z"/><path d="M198,212 l-3,8 l8,-3"/><path d="M206,204 l5,5"/><circle cx="65" cy="60" r="1" fill="${c}" stroke="none"/><circle cx="125" cy="68" r="1" fill="${c}" stroke="none"/><circle cx="178" cy="138" r="1" fill="${c}" stroke="none"/><circle cx="65" cy="138" r="1" fill="${c}" stroke="none"/><circle cx="225" cy="148" r="1" fill="${c}" stroke="none"/><circle cx="125" cy="195" r="1" fill="${c}" stroke="none"/><path d="M58,135 v4 M56,137 h4"/><path d="M183,55 v4 M181,57 h4"/><path d="M70,200 v3 M68.5,201.5 h3"/></g></svg>`;
        const waChat = document.getElementById('fx-wa-chat');
        if (waChat) waChat.style.backgroundImage = `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
    }

    // ── HELPERS ─────────────────────────────────────────────────────
    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function formatWAText(text) {
        return esc(text).replace(/\*([^*]+)\*/g, '<strong>$1</strong>');
    }
    function formatTime(minOffset) {
        const start = 8 * 60 + 23;
        const total = (start + minOffset) % (24 * 60);
        let h = Math.floor(total / 60);
        const m = total % 60;
        const ampm = h < 12 ? 'a. m.' : 'p. m.';
        h = h % 12 || 12;
        return `${h}:${String(m).padStart(2, '0')} ${ampm}`;
    }
})();

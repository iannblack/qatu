/* ═══════════════════════════════════════════════════════════
 *  KIPU CHAT — Premium Configuration Assistant v3
 *  Handles: rendering, API calls, sidebar sync, attachments,
 *           welcome screen, inline catalog import, sessions
 * ═══════════════════════════════════════════════════════════ */

let mayaChatHistory = [];
let mayaCurrentBotId = null;
let mayaChatAttachments = [];
let mayaIsSending = false;
let mayaCurrentSessionId = null;
let mayaSessions = [];

// ─── Textarea: Shift+Enter = newline, Enter = send ───────

window.handleMayaChatKeydown = function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMayaMessage();
    }
    // Shift+Enter falls through naturally and inserts a newline
};

window.autoResizeMayaInput = function(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
    // Toggle scrollbar when hitting max
    el.style.overflowY = el.scrollHeight > 120 ? 'auto' : 'hidden';
};

// ─── Initialization ───────────────────────────────────────

window.initMayaChat = async function(botId, preFetchedBot = null, preFetchedBizInfo = null) {
    console.log('[DEBUG][initMayaChat] ═══ START ═══ botId:', botId, 'preFetched:', !!preFetchedBot);
    // Mark this botId as currently initializing — readiness consumers can poll
    // window._mayaInitReadyFor to know when it's safe to inject drafts/state.
    window._mayaInitReadyFor = null;
    mayaCurrentBotId = botId;
    mayaChatHistory = [];
    mayaChatAttachments = [];
    mayaIsSending = false;
    mayaCurrentSessionId = 'session_' + Date.now();
    window._mayaBotHasProducts = false;

    const configurator = document.getElementById('maya-chat-configurator');
    console.log('[DEBUG][initMayaChat] DOM elements:', {
        configurator: !!configurator,
        chatHistory: !!document.getElementById('maya-chat-history'),
        productGate: !!document.getElementById('kipu-product-gate'),
        welcomeScreen: !!document.getElementById('kipu-welcome-screen'),
        inputWrap: !!document.querySelector('.maya-input-wrap'),
        configSummary: !!document.getElementById('maya-config-summary')
    });
    if (configurator) configurator.style.display = 'flex';

    const attachContainer = document.getElementById('maya-chat-attachments');
    if (attachContainer) attachContainer.innerHTML = '';

    // Hide legacy wizard elements
    const wizTabs = document.querySelector('.wiz-tabs');
    if (wizTabs) wizTabs.style.display = 'none';
    document.querySelectorAll('.wiz-tab-panel').forEach(p => p.style.display = 'none');
    const wizSaveBtn = document.getElementById('wiz-btn-save');
    if (wizSaveBtn) wizSaveBtn.style.display = 'none';

    // Hide topbar (no messages yet)
    const topbar = document.getElementById('kipu-chat-topbar');
    if (topbar) topbar.style.display = 'none';
    // Clear only chat messages
    const chatHistory = document.getElementById('maya-chat-history');
    if (chatHistory) {
        chatHistory.querySelectorAll('.maya-msg-row, .maya-suggestion-chips, .maya-catalog-widget').forEach(el => el.remove());
    }

    // Prefetch current state for sidebar + detect products. Skip refetch when the
    // caller already has fresh data (reload/first-open paths pass it in).
    let hasProducts = false;
    const emptyState = { identidad: {}, personalidad: {}, catalogo: {}, envio: {}, pagos: {}, reglas_especiales: [] };
    try {
        let bot = preFetchedBot;
        let bizInfo = preFetchedBizInfo;

        if (!bot) {
            // Retry up to 3 times with 500ms delay — handles race condition on new bot creation
            for (let attempt = 0; attempt < 3 && !bot; attempt++) {
                if (attempt > 0) {
                    console.log(`[DEBUG][initMayaChat] Retry ${attempt + 1}/3 — waiting 500ms...`);
                    await new Promise(r => setTimeout(r, 500));
                }
                try {
                    const bots = await apiCall('/bots');
                    if (Array.isArray(bots)) bot = bots.find(b => b._id === botId);
                } catch (e) {
                    console.warn(`[DEBUG][initMayaChat] Attempt ${attempt + 1}/3 FAILED:`, e.message || e);
                }
            }
        }

        if (bot) {
            console.log('[DEBUG][initMayaChat] Bot found:', { name: bot.botName, id: bot._id, hasPrompt: !!bot.systemPrompt });
            if (!bizInfo) {
                try { bizInfo = await apiCall(`/business/${botId}`) || {}; } catch(e) { console.warn('[DEBUG][initMayaChat] business_info fetch failed:', e.message); bizInfo = {}; }
            }
            const syncState = buildSyncState(bot, bizInfo);
            renderMayaConfigSummary(syncState);

            const products = bizInfo.products || bot.products || [];
            hasProducts = products.length > 0;
            console.log('[DEBUG][initMayaChat] hasProducts:', hasProducts, '(count:', products.length, ')');
        } else {
            console.warn('[DEBUG][initMayaChat] Bot NOT FOUND after 3 attempts, rendering empty config');
            renderMayaConfigSummary(emptyState);
            renderMayaLoadErrorCard(botId);
            return;
        }
    } catch(e) {
        console.error('[DEBUG][initMayaChat] FATAL ERROR:', e);
        renderMayaConfigSummary(emptyState);
        renderMayaLoadErrorCard(botId, e);
        return;
    }

    window._mayaBotHasProducts = hasProducts;
    // Remove loading overlay (safety net — wizLoadSelectedBot also removes it)
    const loadingOverlay = document.getElementById('kipu-loading-overlay');
    if (loadingOverlay) loadingOverlay.remove();

    console.log('[DEBUG][initMayaChat] Product gate:', hasProducts ? 'UNLOCKED' : 'BLOCKED');

    // Product Gate Logic
    const productGate = document.getElementById('kipu-product-gate');
    const welcomeScreen = document.getElementById('kipu-welcome-screen');
    const inputWrap = document.querySelector('.maya-input-wrap');

    // Si el usuario está en el tab Workflow, NO escondemos el welcome-screen
    // aunque el bot no tenga productos — el welcome-screen es el contenedor
    // del mindmap-host, esconderlo hace que cytoscape mida 0x0 y los nodos
    // queden invisibles. El gate de productos es para el chat de configuración,
    // no para el editor de workflow.
    const inWorkflowTab = window._kipuActiveTab === 'workflow';
    if (!hasProducts && !inWorkflowTab) {
        if (productGate) productGate.classList.remove('hidden');
        if (welcomeScreen) welcomeScreen.classList.add('hidden');
        if (inputWrap) inputWrap.style.display = 'none';
    } else {
        if (productGate) productGate.classList.add('hidden');
        if (welcomeScreen) welcomeScreen.classList.remove('hidden');
        if (inputWrap) inputWrap.style.display = '';
        window.mayaCurrentBotId = botId;
    }

    // Load sessions for sidebar
    loadMayaSessions(botId);

    // Focus input if unlocked
    if (hasProducts) {
        setTimeout(() => {
            const input = document.getElementById('maya-chat-input');
            if (input) input.focus();
        }, 400);
    }
    // Signal readiness — consumers (e.g. goToNotifEdit) can now safely inject
    // a draft without it being wiped by a still-running init.
    window._mayaInitReadyFor = botId;
    console.log('[DEBUG][initMayaChat] ═══ END ═══');
};

// Visible retry UI rendered inside the chat area when bot/bizInfo fetch
// fails after retries. Prevents the "blank screen on Mi Qhatu" symptom.
function renderMayaLoadErrorCard(botId, err) {
    const configurator = document.getElementById('maya-chat-configurator');
    if (configurator) configurator.style.display = 'flex';
    const productGate = document.getElementById('kipu-product-gate');
    const welcomeScreen = document.getElementById('kipu-welcome-screen');
    const inputWrap = document.querySelector('.maya-input-wrap');
    if (productGate) productGate.classList.add('hidden');
    if (welcomeScreen) welcomeScreen.classList.add('hidden');
    if (inputWrap) inputWrap.style.display = 'none';

    const chatHistory = document.getElementById('maya-chat-history');
    if (!chatHistory) return;
    chatHistory.querySelectorAll('.kipu-load-error-card').forEach(el => el.remove());

    const msg = (err && err.message) ? String(err.message).replace(/</g, '&lt;') : 'No pudimos conectar con el servidor';
    const card = document.createElement('div');
    card.className = 'kipu-load-error-card';
    card.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2.5rem 1.5rem;text-align:center;max-width:420px;margin:auto;';
    const safeBotId = botId ? String(botId).replace(/'/g, "\\'") : '';
    card.innerHTML = `
        <div style="font-size:3rem;margin-bottom:0.75rem;">⚠️</div>
        <h3 style="font-family:'Cormorant Garamond',serif;font-style:italic;font-weight:700;font-size:1.4rem;color:#000052;margin:0 0 0.4rem;">No pudimos cargar Mi Qhatu</h3>
        <p style="color:rgba(0,0,82,0.55);font-size:0.88rem;margin:0 0 1.25rem;font-family:'Poppins',sans-serif;">${msg}. Revisa tu conexión e inténtalo de nuevo.</p>
        <button onclick="window.invalidateBotsCache && window.invalidateBotsCache(); initMayaChat('${safeBotId}');"
            style="background:#000052;color:#FFF;border:none;padding:0.75rem 1.75rem;border-radius:999px;font-weight:700;font-size:0.88rem;cursor:pointer;font-family:inherit;">
            Reintentar
        </button>
    `;
    chatHistory.appendChild(card);
    window._mayaInitReadyFor = botId;
}

// Detects when the bot becomes capable of emitting variable-cost shipping quotes
// (cost_strategy="variable" OR at least one zone with modo="manual_quote"),
// refreshes the notifications tab's enabled state, and — the first time it
// transitions from disabled to enabled — shows an info popup so the entrepreneur
// knows the section is now available.
//
// El botId puede venir como segundo parámetro (cuando viene del save handler
// de envíos que conoce el botId). Si no, fallback a window.mayaCurrentBotId
// (que está seteado cuando ya estamos en el chat de Qhatu). Antes solo usaba
// el global, así que en el primer save de envíos durante el wizard onboarding
// (cuando mayaCurrentBotId aún no estaba seteado) el popup nunca se disparaba.
function refreshVariableShippingTabOnStateChange(state, botId) {
    try {
        const effectiveBotId = botId || window.mayaCurrentBotId;
        if (!effectiveBotId || !state || !state.envio) return;

        const strategy = (state.envio.cost_strategy || '').toString().toLowerCase();
        const zonas = Array.isArray(state.envio.zonas_reglas) ? state.envio.zonas_reglas : [];
        const hasVariableZone = zonas.some(z => (z?.modo || '').toString().toLowerCase() === 'manual_quote');
        const nowEnabled = strategy === 'variable' || hasVariableZone;

        window.__variableShippingCache = window.__variableShippingCache || {};
        const wasEnabled = window.__variableShippingCache[effectiveBotId] === true;
        window.__variableShippingCache[effectiveBotId] = nowEnabled;

        if (typeof loadNotifications === 'function') loadNotifications();

        if (nowEnabled && !wasEnabled && typeof showInfoPopup === 'function') {
            showInfoPopup(
                'Sección "Tarifas Variables" habilitada',
                'Ya puedes verla en el icono de Notificaciones. Cada vez que llegue un pedido cuyo envío se cotice caso por caso, te aparecerá aquí un popup para que ingreses el costo.',
                'Entendido'
            );
        }
    } catch (e) {
        console.error('[refreshVariableShippingTabOnStateChange] error:', e);
    }
}

// ─── Qhatu Welcome Screen: Send Suggestion ─────────────────

window.kipuSendSuggestion = function(message) {
    // Hide welcome screen, show topbar
    const welcomeScreen = document.getElementById('kipu-welcome-screen');
    if (welcomeScreen) welcomeScreen.classList.add('hidden');
    const topbar = document.getElementById('kipu-chat-topbar');
    if (topbar) topbar.style.display = 'flex';

    // Set the message and send
    const input = document.getElementById('maya-chat-input');
    if (input) {
        input.value = message;
        sendMayaMessage();
    }
};

function buildSyncState(bot, bizInfo) {
    console.log('[DEBUG][buildSyncState] bot:', bot ? { name: bot.botName, id: bot._id } : 'NULL', 'bizInfo:', bizInfo ? { products: bizInfo.products?.length } : 'NULL');
    // Null safety — both args may be undefined/null on new bot creation
    const b = bot || {};
    const biz = bizInfo || {};
    return {
        identidad: {
            nombre_empresa: b.botName || '',
            descripcion: biz.description || '',
            rubro: b.tienda?.rubro || '',
        },
        personalidad: {
            tono: b.metadata?.tone || 'amigable',
            prompt_sistema: b.systemPrompt || ''
        },
        catalogo: {
            productos: biz.products || b.products || []
        },
        envio: {
            tipo_entrega: b.operacion?.envios?.hace_envios ? ['delivery'] : [],
            zonas_cobertura: b.operacion?.envios?.zonas || []
        },
        pagos: {
            metodos: b.operacion?.metodos_pago || []
        },
        reglas_especiales: biz.faqs || []
    };
}

// ─── Suggestion Chips ─────────────────────────────────────

const MAYA_SUGGESTIONS = [
    { icon: '🏢', label: 'Configurar mi negocio', message: 'Quiero configurar la identidad de mi negocio: nombre, rubro y descripción.' },
    { icon: '🎭', label: 'Personalidad del bot', message: 'Quiero definir la personalidad y tono de mi bot de WhatsApp.' },
    { icon: '📦', label: 'Importar productos', action: 'catalog-import' },
    { icon: '🚚', label: 'Configurar envíos', message: 'Quiero configurar mis opciones de envío, zonas de cobertura y costos.' },
    { icon: '💳', label: 'Métodos de pago', message: 'Quiero configurar los métodos de pago que acepto: Yape, Plin, transferencia, etc.' },
    { icon: '📋', label: 'Reglas especiales', message: 'Quiero agregar reglas especiales para mi bot, como horarios, descuentos o restricciones.' }
];

function renderSuggestionChips() {
    const container = document.getElementById('maya-chat-history');
    if (!container) return;

    const chipsRow = document.createElement('div');
    chipsRow.className = 'maya-suggestion-chips';
    chipsRow.id = 'maya-suggestion-chips';

    MAYA_SUGGESTIONS.forEach(sug => {
        const chip = document.createElement('button');
        chip.className = 'maya-chip';
        chip.innerHTML = `<span class="maya-chip-icon">${sug.icon}</span><span>${sug.label}</span>`;
        
        chip.onclick = () => {
            if (sug.action === 'catalog-import') {
                showMayaCatalogImport();
            } else if (sug.message) {
                const input = document.getElementById('maya-chat-input');
                if (input) {
                    input.value = sug.message;
                    sendMayaMessage();
                }
            }
            // Remove chips after selection
            const chipsEl = document.getElementById('maya-suggestion-chips');
            if (chipsEl) chipsEl.remove();
        };

        chipsRow.appendChild(chip);
    });

    container.appendChild(chipsRow);
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
}

// ─── Inline Catalog Import Widget ─────────────────────────

function showMayaCatalogImport() {
    // Remove any existing chips
    const chipsEl = document.getElementById('maya-suggestion-chips');
    if (chipsEl) chipsEl.remove();

    // Remove any existing import widget
    const existingWidget = document.getElementById('maya-catalog-widget');
    if (existingWidget) existingWidget.remove();

    const container = document.getElementById('maya-chat-history');
    if (!container) return;

    const widget = document.createElement('div');
    widget.id = 'maya-catalog-widget';
    widget.className = 'maya-catalog-widget';

    widget.innerHTML = `
        <div class="maya-catalog-widget-header">
            <div class="maya-catalog-widget-icon">📦</div>
            <div>
                <div class="maya-catalog-widget-title">Importar productos</div>
                <div class="maya-catalog-widget-sub">Sube archivos, pega un link o conecta tu tienda</div>
            </div>
            <button class="maya-catalog-close" onclick="closeMayaCatalogWidget()">✕</button>
        </div>
        <div class="maya-catalog-tabs">
            <button class="maya-catalog-tab active" onclick="switchMayaCatalogTab(this,'files')">📄 Archivos</button>
            <button class="maya-catalog-tab" onclick="switchMayaCatalogTab(this,'url')">🔗 URL</button>
            <button class="maya-catalog-tab" onclick="switchMayaCatalogTab(this,'shopify')">🛍️ Shopify</button>
            <button class="maya-catalog-tab" onclick="switchMayaCatalogTab(this,'instagram')">📸 Instagram</button>
        </div>
        <div id="maya-catalog-panel-files" class="maya-catalog-panel">
            <div class="maya-catalog-dropzone" id="maya-catalog-dropzone"
                onclick="document.getElementById('maya-catalog-file-input').click()"
                ondragover="event.preventDefault();this.classList.add('dragover')"
                ondragleave="this.classList.remove('dragover')"
                ondrop="event.preventDefault();this.classList.remove('dragover');mayaCatalogHandleFiles(event.dataTransfer.files)">
                <div style="font-size:1.5rem;margin-bottom:0.25rem;">📄</div>
                <div class="maya-catalog-dropzone-text">Arrastra tus archivos o haz clic</div>
                <div class="maya-catalog-dropzone-hint">PDF, Excel, Word, CSV, imágenes · Máx. 5</div>
            </div>
            <input type="file" id="maya-catalog-file-input" style="display:none" multiple
                accept=".pdf,.xlsx,.xls,.docx,.doc,.csv,.txt,.jpg,.jpeg,.png,.webp"
                onchange="mayaCatalogHandleFiles(this.files)">
            <div id="maya-catalog-file-list"></div>
        </div>
        <div id="maya-catalog-panel-url" class="maya-catalog-panel" style="display:none">
            <input type="text" class="maya-catalog-url-input" id="maya-catalog-url" placeholder="https://www.mitienda.com/productos">
            <p class="maya-catalog-hint">Pega la URL de tu página de productos o catálogo online</p>
        </div>
        <div id="maya-catalog-panel-shopify" class="maya-catalog-panel" style="display:none">
            <input type="text" class="maya-catalog-url-input" id="maya-catalog-shopify" placeholder="https://mitienda.myshopify.com">
            <p class="maya-catalog-hint">Pega la URL de tu tienda Shopify</p>
        </div>
        <div id="maya-catalog-panel-instagram" class="maya-catalog-panel" style="display:none">
            <input type="text" class="maya-catalog-url-input" id="maya-catalog-instagram" placeholder="https://instagram.com/mitienda">
            <p class="maya-catalog-hint">Pega el link de tu perfil de Instagram</p>
        </div>
        <div class="maya-catalog-actions">
            <button class="maya-catalog-analyze-btn" id="maya-catalog-analyze-btn" onclick="mayaCatalogAnalyze()">
                ✨ Analizar con Qhatu
            </button>
        </div>
        <div id="maya-catalog-status" style="display:none"></div>
    `;

    container.appendChild(widget);
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
}

// Catalog widget state
let mayaCatalogFiles = [];

window.closeMayaCatalogWidget = function() {
    const widget = document.getElementById('maya-catalog-widget');
    if (widget) widget.remove();
    mayaCatalogFiles = [];
};

window.switchMayaCatalogTab = function(btn, tab) {
    btn.closest('.maya-catalog-tabs').querySelectorAll('.maya-catalog-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    ['files','url','shopify','instagram'].forEach(t => {
        const panel = document.getElementById('maya-catalog-panel-' + t);
        if (panel) panel.style.display = t === tab ? 'block' : 'none';
    });
};

window.mayaCatalogHandleFiles = function(fileList) {
    const validExts = ['.pdf','.xlsx','.xls','.docx','.doc','.csv','.txt','.jpg','.jpeg','.png','.webp'];
    for (const file of Array.from(fileList)) {
        if (mayaCatalogFiles.length >= 5) {
            showToast('Máximo 5 archivos', 'error');
            break;
        }
        const ext = '.' + file.name.toLowerCase().split('.').pop();
        if (!validExts.includes(ext)) {
            showToast(`Formato no soportado: ${file.name}`, 'error');
            continue;
        }
        if (mayaCatalogFiles.some(f => f.name === file.name)) continue;
        mayaCatalogFiles.push(file);
    }
    renderMayaCatalogFileList();
};

function renderMayaCatalogFileList() {
    const container = document.getElementById('maya-catalog-file-list');
    if (!container) return;
    container.innerHTML = mayaCatalogFiles.map((f, i) => `
        <div class="maya-catalog-file-item">
            <span>${getFileIcon(f.name)} ${f.name}</span>
            <button onclick="mayaCatalogRemoveFile(${i})" class="maya-catalog-file-remove">✕</button>
        </div>
    `).join('');
}

function getFileIcon(name) {
    const ext = (name || '').toLowerCase().split('.').pop();
    const icons = { pdf: '📄', xlsx: '📊', xls: '📊', docx: '📝', doc: '📝', csv: '📋', txt: '📋', jpg: '🖼️', jpeg: '🖼️', png: '🖼️', webp: '🖼️' };
    return icons[ext] || '📎';
}

window.mayaCatalogRemoveFile = function(i) {
    mayaCatalogFiles.splice(i, 1);
    renderMayaCatalogFileList();
};

window.mayaCatalogAnalyze = async function() {
    // Determine active source
    const activeTab = document.querySelector('#maya-catalog-widget .maya-catalog-tab.active');
    const tabText = activeTab?.textContent?.trim() || '';
    
    let url = '';
    if (tabText.includes('URL')) url = document.getElementById('maya-catalog-url')?.value?.trim() || '';
    if (tabText.includes('Shopify')) url = document.getElementById('maya-catalog-shopify')?.value?.trim() || '';
    if (tabText.includes('Instagram')) url = document.getElementById('maya-catalog-instagram')?.value?.trim() || '';

    const hasFiles = mayaCatalogFiles.length > 0;
    const hasUrl = url && url.startsWith('http');
    const isFileTab = tabText.includes('Archivos');

    if (isFileTab && !hasFiles) {
        showToast('Sube al menos un archivo para analizar', 'error');
        return;
    }
    if (!isFileTab && !hasUrl) {
        showToast('Pega una URL válida para analizar', 'error');
        return;
    }

    // Show loading state
    const statusEl = document.getElementById('maya-catalog-status');
    const analyzeBtn = document.getElementById('maya-catalog-analyze-btn');
    if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.innerHTML = `
            <div class="maya-catalog-loading">
                <div class="maya-catalog-spinner"></div>
                <div>
                    <div style="font-weight:600;font-size:0.88rem;">Qhatu está analizando tu catálogo...</div>
                    <div style="font-size:0.78rem;color:rgba(0,0,51,0.45);">Esto puede tardar unos segundos</div>
                </div>
            </div>
        `;
    }
    if (analyzeBtn) analyzeBtn.disabled = true;

    try {
        const token = localStorage.getItem('token');
        let resp;

        if (hasFiles) {
            const formData = new FormData();
            mayaCatalogFiles.forEach(file => formData.append('catalogs', file));
            resp = await fetch(`/api/catalog/analyze`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData
            });
        } else {
            resp = await fetch(`/api/catalog/analyze`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ url })
            });
        }

        if (!resp.ok) throw new Error('Error del servidor');
        const data = await resp.json();

        if (data.success && data.analysis) {
            // Close widget
            closeMayaCatalogWidget();
            
            const productCount = data.analysis.products?.length || 0;
            const kbCount = data.analysis.knowledge_blocks?.length || 0;
            const bizName = data.analysis.business_name || '';
            
            // Build user message about what was analyzed
            let userMsg = `He subido mi catálogo para análisis.`;
            if (hasFiles) userMsg += ` (${mayaCatalogFiles.length} archivo(s))`;
            if (hasUrl) userMsg += ` URL: ${url}`;

            // Push user message
            mayaChatHistory.push({
                role: 'user',
                content: userMsg,
                displayText: userMsg
            });

            // Build rich context for Qhatu with the catalog analysis
            const catalogContextMsg = `Acabo de analizar el catálogo y encontré lo siguiente:\n` +
                (bizName ? `• Negocio: "${bizName}"\n` : '') +
                `• ${productCount} productos detectados\n` +
                (kbCount > 0 ? `• ${kbCount} bloques de conocimiento\n` : '') +
                (data.analysis.business_category ? `• Categoría: ${data.analysis.business_category}\n` : '') +
                `\nPor favor integra esta información a la configuración del bot.`;

            // Send to Qhatu with catalog context
            mayaIsSending = true;
            renderMayaHistory();
            showTypingIndicator();

            const syncStatusEl = document.getElementById('maya-sync-status');
            if (syncStatusEl) {
                syncStatusEl.textContent = 'Pensando...';
                syncStatusEl.className = 'maya-sync-badge thinking';
            }

            // Add catalog analysis context to the chat
            mayaChatHistory.push({
                role: 'user',
                content: catalogContextMsg,
                displayText: catalogContextMsg,
                _catalogAnalysis: data.analysis  // internal flag
            });

            const response = await fetch(`/api/bots/${mayaCurrentBotId}/maya-chat`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    chatHistory: mayaChatHistory,
                    catalogAnalysis: data.analysis
                })
            });

            const responseData = await response.json();
            if (!response.ok) throw new Error(responseData.error || 'Error comunicando con Qhatu');

            hideTypingIndicator();
            mayaChatHistory.push({ role: 'maya', content: responseData.message || 'Entendido.' });
            renderMayaHistory();

            if (responseData.syncedState) {
                renderMayaConfigSummary(responseData.syncedState);
            }
            if (syncStatusEl) {
                syncStatusEl.textContent = 'Sincronizado';
                syncStatusEl.className = 'maya-sync-badge synced';
            }

            showToast(`✨ ${productCount} productos importados y sincronizados con Qhatu`, 'success');
            
            // Auto-save session
            autoSaveMayaSession();
        } else {
            throw new Error('No se pudo analizar el catálogo');
        }
    } catch (e) {
        console.error('[Qhatu Catalog] Error:', e);
        if (statusEl) {
            statusEl.innerHTML = `
                <div style="padding:0.75rem;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);border-radius:10px;font-size:0.85rem;color:#ef4444;">
                    ❌ No se pudo analizar. Intenta con otro archivo o URL.
                </div>
            `;
        }
        hideTypingIndicator();
        showToast('Error al analizar el catálogo', 'error');
    } finally {
        mayaIsSending = false;
        mayaCatalogFiles = [];
        if (analyzeBtn) analyzeBtn.disabled = false;
    }
};

// ─── Markdown-lite Parser ─────────────────────────────────

function parseMayaMarkdown(text) {
    if (!text) return '';
    let html = text
        // Escape HTML
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        // Bold
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        // Italic
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        // Unordered lists
        .replace(/^- (.+)$/gm, '<li>$1</li>')
        // Line breaks
        .replace(/\n/g, '<br>');

    // Wrap consecutive <li> in <ul>
    html = html.replace(/((?:<li>.*?<\/li><br>?)+)/g, (match) => {
        const cleaned = match.replace(/<br>/g, '');
        return '<ul style="margin:0.5rem 0;padding-left:1.25rem;">' + cleaned + '</ul>';
    });

    return html;
}

// ─── Chat Rendering ───────────────────────────────────────

window.renderMayaHistory = function() {
    const container = document.getElementById('maya-chat-history');
    if (!container) return;
    // Clear only message rows, preserve welcome screen
    container.querySelectorAll('.maya-msg-row, .maya-suggestion-chips, .maya-catalog-widget, #maya-typing-row').forEach(el => el.remove());

    mayaChatHistory.forEach((msg, idx) => {
        // Skip internal catalog context messages
        if (msg._catalogAnalysis) return;

        const isMaya = msg.role === 'maya';
        const row = document.createElement('div');
        row.className = `maya-msg-row ${isMaya ? 'maya' : 'user'}`;

        // Avatar
        const avatar = document.createElement('div');
        avatar.className = `maya-msg-avatar ${isMaya ? 'maya' : 'user'}`;
        avatar.textContent = isMaya ? 'K' : '👤';

        // Bubble
        const bubble = document.createElement('div');
        bubble.className = `maya-msg-bubble ${isMaya ? 'maya' : 'user'}`;

        if (isMaya) {
            bubble.innerHTML = parseMayaMarkdown(msg.content);
        } else {
            // For user messages, show the clean text (not the internal prompt with attachments)
            const cleanText = (msg.displayText || msg.content || '').split('\n[Adjunto')[0];
            bubble.textContent = cleanText;

            if (msg.attachments && msg.attachments.length > 0) {
                const attachBadge = document.createElement('div');
                attachBadge.style.cssText = 'margin-top:0.5rem;font-size:0.78rem;opacity:0.85;display:flex;align-items:center;gap:4px;';
                attachBadge.innerHTML = `<svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"></path></svg> ${msg.attachments.length} archivo(s)`;
                bubble.appendChild(attachBadge);
            }
        }

        row.appendChild(avatar);
        row.appendChild(bubble);
        container.appendChild(row);
    });

    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
};

// ─── Typing Indicator ─────────────────────────────────────

function showTypingIndicator() {
    const container = document.getElementById('maya-chat-history');
    if (!container) return;

    const row = document.createElement('div');
    row.className = 'maya-msg-row maya';
    row.id = 'maya-typing-row';

    const avatar = document.createElement('div');
    avatar.className = 'maya-msg-avatar maya';
    avatar.textContent = 'K';

    const indicator = document.createElement('div');
    indicator.className = 'maya-typing-indicator';
    indicator.innerHTML = '<span></span><span></span><span></span>';

    row.appendChild(avatar);
    row.appendChild(indicator);
    container.appendChild(row);
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
}

function hideTypingIndicator() {
    const el = document.getElementById('maya-typing-row');
    if (el) el.remove();
}

// ─── File Upload ──────────────────────────────────────────

window.handleMayaChatFileUpload = function(e) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    Array.from(files).forEach(file => {
        const reader = new FileReader();
        reader.onload = (ev) => {
            mayaChatAttachments.push({
                name: file.name,
                type: file.type,
                data: ev.target.result
            });
            renderMayaAttachments();
        };
        reader.readAsDataURL(file);
    });

    // Reset input so same file can be re-selected
    e.target.value = '';
};

function renderMayaAttachments() {
    const container = document.getElementById('maya-chat-attachments');
    if (!container) return;
    container.innerHTML = '';

    mayaChatAttachments.forEach((att, index) => {
        const pill = document.createElement('div');
        pill.className = 'maya-attach-pill';

        const icon = att.type.startsWith('image/') ? '🖼️' : att.type.includes('pdf') ? '📄' : '📎';
        pill.innerHTML = `${icon} <span>${att.name}</span> <span class="pill-remove" onclick="removeMayaAttachment(${index})">✕</span>`;
        container.appendChild(pill);
    });
}

window.removeMayaAttachment = function(index) {
    mayaChatAttachments.splice(index, 1);
    renderMayaAttachments();
};

// ─── Send Message ─────────────────────────────────────────

window.sendMayaMessage = async function() {
    if (mayaIsSending) { console.log('[DEBUG][sendMayaMessage] Already sending, skipping'); return; }

    const input = document.getElementById('maya-chat-input');
    const text = (input?.value || '').trim();
    if (!text && mayaChatAttachments.length === 0) { console.log('[DEBUG][sendMayaMessage] No text or attachments, skipping'); return; }

    console.log('[DEBUG][sendMayaMessage] Sending:', text.substring(0, 100), 'botId:', mayaCurrentBotId, 'attachments:', mayaChatAttachments.length);
    if (!mayaCurrentBotId) {
        console.warn('[DEBUG][sendMayaMessage] No botId set!');
        if (typeof showToast === 'function') showToast('Selecciona un Qhatu primero', 'warning');
        return;
    }

    // Hide welcome screen and show topbar when first message is sent
    const welcomeScreen = document.getElementById('kipu-welcome-screen');
    if (welcomeScreen) welcomeScreen.classList.add('hidden');
    const topbar = document.getElementById('kipu-chat-topbar');
    if (topbar) topbar.style.display = 'flex';

    // Remove suggestion chips if still present
    const chipsEl = document.getElementById('maya-suggestion-chips');
    if (chipsEl) chipsEl.remove();

    // Remove catalog widget if open
    closeMayaCatalogWidget();

    // Build internal prompt content (includes attachment references)
    let promptContent = text;
    const savedAttachments = [...mayaChatAttachments];
    savedAttachments.forEach(att => {
        promptContent += `\n[Adjunto visual/documento: ${att.name}. Por favor extráelo al JSON si amerita: ${att.data}]`;
    });

    // Push user message
    mayaChatHistory.push({
        role: 'user',
        content: promptContent,
        displayText: text,
        attachments: savedAttachments
    });

    // Clear input
    if (input) {
        input.value = '';
        input.style.height = 'auto';
    }
    mayaChatAttachments = [];
    renderMayaAttachments();
    renderMayaHistory();

    // Lock UI
    mayaIsSending = true;
    const sendBtn = document.getElementById('maya-chat-send');
    if (sendBtn) sendBtn.disabled = true;

    // Status badge
    const statusEl = document.getElementById('maya-sync-status');
    if (statusEl) {
        statusEl.textContent = 'Pensando...';
        statusEl.className = 'maya-sync-badge thinking';
    }

    showTypingIndicator();

    try {
        console.log('[DEBUG][sendMayaMessage] POST /api/bots/' + mayaCurrentBotId + '/maya-chat, history length:', mayaChatHistory.length);
        const sendStartTime = Date.now();
        const response = await fetch(`/api/bots/${mayaCurrentBotId}/maya-chat`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ chatHistory: mayaChatHistory })
        });

        const data = await response.json();
        console.log('[DEBUG][sendMayaMessage] Response in', Date.now() - sendStartTime, 'ms, status:', response.status, 'keys:', Object.keys(data));
        if (!response.ok) {
            console.error('[DEBUG][sendMayaMessage] API error:', data.error || data);
            throw new Error(data.error || 'Error conectando con Qhatu');
        }

        hideTypingIndicator();

        // Push Qhatu response
        console.log('[DEBUG][sendMayaMessage] Qhatu said:', (data.message || '').substring(0, 120));
        mayaChatHistory.push({ role: 'maya', content: data.message || 'Entendido.' });
        renderMayaHistory();

        // Update sidebar
        if (data.syncedState) {
            console.log('[DEBUG][sendMayaMessage] Updating config summary with syncedState');
            renderMayaConfigSummary(data.syncedState);
            refreshVariableShippingTabOnStateChange(data.syncedState);
        }

        if (statusEl) {
            statusEl.textContent = 'Sincronizado';
            statusEl.className = 'maya-sync-badge synced';
        }

        // Auto-save session after every Qhatu response
        autoSaveMayaSession();

    } catch (e) {
        console.error('[DEBUG][sendMayaMessage] ERROR:', e.message || e);
        hideTypingIndicator();

        mayaChatHistory.push({
            role: 'maya',
            content: '⚠️ Hubo un problema procesando tu mensaje. Por favor intenta de nuevo.'
        });
        renderMayaHistory();

        if (typeof showToast === 'function') showToast('Qhatu no pudo procesar tu mensaje', 'error');
        if (statusEl) {
            statusEl.textContent = 'Error';
            statusEl.className = 'maya-sync-badge error';
        }
    } finally {
        mayaIsSending = false;
        if (sendBtn) sendBtn.disabled = false;
        const input2 = document.getElementById('maya-chat-input');
        if (input2) input2.focus();
    }
};

// ─── Sessions: Auto-save & Load ───────────────────────────

async function autoSaveMayaSession() {
    if (!mayaCurrentBotId || mayaChatHistory.length < 2) return;

    try {
        // Generate a title from conversation content (first user message)
        const firstUserMsg = mayaChatHistory.find(m => m.role === 'user');
        let title = firstUserMsg?.displayText || firstUserMsg?.content || 'Nueva conversación';
        // Truncate for title — strip attachment data
        title = title.split('\n[Adjunto')[0].substring(0, 60);
        if (title.length >= 60) title += '...';

        const sessionData = {
            sessionId: mayaCurrentSessionId,
            title: title,
            history: mayaChatHistory.filter(m => !m._catalogAnalysis).map(m => {
                // Strip base64 attachment data from content to avoid huge payloads
                // User messages may contain "[Adjunto visual/documento: ... data:image/...base64,XXXXX]"
                let cleanContent = m.content || '';
                if (m.role === 'user') {
                    // Use displayText (clean) if available, otherwise strip attachments from content
                    cleanContent = m.displayText || cleanContent.split('\n[Adjunto')[0];
                }
                return {
                    role: m.role,
                    content: cleanContent,
                    displayText: m.displayText || undefined
                };
            }),
            updatedAt: new Date().toISOString()
        };

        const resp = await fetch(`/api/bots/${mayaCurrentBotId}/maya-sessions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(sessionData)
        });

        if (!resp.ok) {
            const errData = await resp.json().catch(() => ({}));
            console.error('[Qhatu Sessions] Save failed:', resp.status, errData);
            return;
        }

        console.log('[Qhatu Sessions] Session saved successfully:', mayaCurrentSessionId);
        // Reload sessions list
        loadMayaSessions(mayaCurrentBotId);
    } catch (e) {
        console.error('[Qhatu Sessions] Save error:', e);
    }
}

async function loadMayaSessions(botId) {
    const container = document.getElementById('maya-sessions-list');
    if (!container) return;

    try {
        const response = await fetch(`/api/bots/${botId}/maya-sessions`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });
        if (!response.ok) throw new Error('Failed to load sessions');
        
        const sessions = await response.json();
        mayaSessions = sessions;

        if (!sessions || sessions.length === 0) {
            container.innerHTML = `<li style="padding:0.5rem 1.25rem;color:rgba(0,0,51,0.45);font-size:0.78rem;font-style:italic;">Sin conversaciones aún</li>`;
            return;
        }

        container.innerHTML = sessions.slice(0, 10).map(s => {
            const isActive = s.sessionId === mayaCurrentSessionId;
            const timeAgo = getTimeAgo(s.updatedAt);
            const sidAttr = String(s.sessionId).replace(/'/g, "\\'");
            return `
                <li class="maya-session-item ${isActive ? 'active' : ''}"
                    onclick="loadMayaSession('${sidAttr}')"
                    title="${s.title}"
                    style="position:relative;">
                    <span class="maya-session-icon">💬</span>
                    <div class="maya-session-info">
                        <div class="maya-session-title">${escapeHtml(s.title)}</div>
                        <div class="maya-session-time">${timeAgo}</div>
                    </div>
                    <button onclick="event.stopPropagation(); deleteMayaSession('${sidAttr}', this)"
                        title="Eliminar conversación"
                        style="background:transparent;border:none;color:rgba(0,0,51,0.35);font-size:0.95rem;line-height:1;padding:0.25rem 0.4rem;border-radius:6px;cursor:pointer;flex-shrink:0;transition:all 0.15s;"
                        onmouseover="this.style.background='rgba(239,68,68,0.1)';this.style.color='#EF4444';"
                        onmouseout="this.style.background='transparent';this.style.color='rgba(0,0,51,0.35)';">✕</button>
                </li>
            `;
        }).join('');
    } catch (e) {
        console.error('[Qhatu Sessions] Load error:', e);
        container.innerHTML = `<li style="padding:0.5rem 1.25rem;color:rgba(0,0,51,0.45);font-size:0.78rem;font-style:italic;">Sin conversaciones aún</li>`;
    }
}

window.deleteMayaSession = function(sessionId, btn) {
    if (!mayaCurrentBotId) return;
    const performDelete = async () => {
        try {
            const response = await fetch(`/api/bots/${mayaCurrentBotId}/maya-sessions/${encodeURIComponent(sessionId)}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
            });
            if (!response.ok) throw new Error('No se pudo eliminar');
            // If we deleted the active session, clear it locally
            if (sessionId === mayaCurrentSessionId) {
                mayaChatHistory = [];
                mayaCurrentSessionId = 'session_' + Date.now();
                if (typeof renderMayaHistory === 'function') renderMayaHistory();
            }
            if (typeof showToast === 'function') showToast('Conversación eliminada', 'success');
            loadMayaSessions(mayaCurrentBotId);
        } catch (e) {
            console.error('[Qhatu Sessions] Delete error:', e);
            if (typeof showToast === 'function') showToast('Error eliminando la conversación', 'error');
        }
    };
    if (typeof showConfirmPopup === 'function') {
        showConfirmPopup(
            'Eliminar conversación',
            'Esta conversación se eliminará permanentemente. ¿Continuar?',
            performDelete,
            'Eliminar',
            '#EF4444'
        );
    } else {
        if (confirm('¿Eliminar esta conversación?')) performDelete();
    }
};

window.loadMayaSession = async function(sessionId) {
    if (!mayaCurrentBotId) return;
    
    try {
        const response = await fetch(`/api/bots/${mayaCurrentBotId}/maya-sessions/${sessionId}`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });
        if (!response.ok) throw new Error('Session not found');
        
        const session = await response.json();
        mayaCurrentSessionId = session.sessionId;
        mayaChatHistory = session.history || [];
        renderMayaHistory();

        // Hide welcome screen and show topbar for loaded session
        const welcomeScreen = document.getElementById('kipu-welcome-screen');
        if (welcomeScreen) welcomeScreen.classList.add('hidden');
        const topbar = document.getElementById('kipu-chat-topbar');
        if (topbar) topbar.style.display = 'flex';
        
        // Update active class in sidebar
        loadMayaSessions(mayaCurrentBotId);

        // Navigate to create-bot section if not there
        const createBotSection = document.getElementById('section-create-bot');
        if (createBotSection && createBotSection.style.display === 'none') {
            document.querySelectorAll('.sidebar-nav li').forEach(li => li.classList.remove('active'));
            document.querySelector('.sidebar-nav li[data-section="create-bot"]')?.classList.add('active');
            document.querySelectorAll('.section').forEach(sec => sec.classList.remove('active'));
            createBotSection.classList.add('active');
        }
    } catch (e) {
        console.error('[Qhatu Sessions] Load session error:', e);
        showToast('No se pudo cargar la conversación', 'error');
    }
};

function getTimeAgo(dateStr) {
    const now = new Date();
    const date = new Date(dateStr);
    const diffMs = now - date;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'ahora';
    if (diffMin < 60) return `hace ${diffMin}m`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `hace ${diffHr}h`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay === 1) return 'ayer';
    return `hace ${diffDay}d`;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ─── Sidebar: Config Summary Cards (DYNAMIC) ─────────────
// Only shows sections that have actual data — starts empty

function renderMayaConfigSummary(state) {
    console.log('[DEBUG][renderMayaConfigSummary] Called with state keys:', Object.keys(state || {}));
    const container = document.getElementById('maya-config-summary');
    if (!container) { console.warn('[DEBUG][renderMayaConfigSummary] #maya-config-summary NOT FOUND'); return; }
    container.innerHTML = '';

    const sections = [];

    // 1. Identidad — only if name or rubro exists with real content
    const cId = state.identidad || {};
    const hasIdentityName = !!(cId.nombre_empresa && cId.nombre_empresa.length > 0);
    const hasIdentityRubro = !!(cId.rubro && cId.rubro.length > 0);
    const hasIdentityDesc = !!(cId.descripcion && cId.descripcion.length > 0);
    if (hasIdentityName || hasIdentityRubro || hasIdentityDesc) {
        sections.push({
            title: 'Identidad', icon: '🏢', complete: hasIdentityName && hasIdentityRubro,
            items: [
                hasIdentityName ? `Nombre: ${cId.nombre_empresa}` : null,
                hasIdentityRubro ? `Rubro: ${cId.rubro}` : null,
                hasIdentityDesc ? `${cId.descripcion.substring(0, 60)}...` : null
            ].filter(Boolean)
        });
    }

    // 2. Workflow / Prompt — only if prompt_sistema has meaningful content
    const cPers = state.personalidad || {};
    const promptText = cPers.prompt_sistema || '';
    const isDefaultPrompt = promptText.length < 120 ||
        /eres (un |kipu|el )?(asistente|bot) de ventas/i.test(promptText) ||
        /responde siempre en español de manera natural/i.test(promptText);
    if (promptText.length > 0 && !isDefaultPrompt) {
        // Detect if it's a workflow or just a personality prompt
        const isWorkflow = promptText.length > 200 ||
            /workflow|flujo|paso |step |cuando.*diga|si.*pregunta|responde.*con/i.test(promptText);
        sections.push({
            title: isWorkflow ? 'Workflow' : 'Personalidad',
            icon: isWorkflow ? '⚙️' : '🎭',
            complete: true,
            items: [
                isWorkflow
                    ? `📝 ${promptText.length.toLocaleString()} caracteres de instrucciones`
                    : `Tono: ${cPers.tono || 'amigable'}`,
                `Vista previa: "${promptText.substring(0, 80).replace(/\n/g, ' ')}…"`
            ]
        });
    } else if (cPers.tono && cPers.tono !== 'amigable') {
        // Only show Personalidad if tone was explicitly changed
        sections.push({
            title: 'Personalidad', icon: '🎭', complete: true,
            items: [`Tono: ${cPers.tono}`]
        });
    }

    // 3. Productos — only if there are actually products
    const cProd = state.catalogo?.productos || [];
    if (cProd.length > 0) {
        sections.push({
            title: 'Productos', icon: '🛒', complete: true,
            items: [
                `${cProd.length} producto(s) registrado(s)`,
                ...(cProd.slice(0, 3).map(p => {
                    const name = p.nombre || p.name || 'Sin nombre';
                    const price = p.precio || p.price;
                    return price ? `${name} — S/ ${price}` : name;
                })),
                cProd.length > 3 ? `+${cProd.length - 3} más...` : null
            ].filter(Boolean)
        });
    }

    // 4. Envíos — only if delivery is configured
    const cEnv = state.envio || {};
    const hasDelivery = cEnv.tipo_entrega?.length > 0;
    const hasZones = cEnv.zonas_cobertura?.length > 0;
    if (hasDelivery || hasZones) {
        sections.push({
            title: 'Envíos', icon: '🚚', complete: hasDelivery,
            items: [
                hasDelivery ? `Modalidad: ${cEnv.tipo_entrega.join(', ')}` : null,
                hasZones ? `${cEnv.zonas_cobertura.length} zona(s) de cobertura` : null,
                cEnv.instrucciones_especiales ? `📝 ${cEnv.instrucciones_especiales.substring(0, 50)}...` : null
            ].filter(Boolean)
        });
    }

    // 5. Pagos — only if payment methods exist
    const cPag = state.pagos || {};
    const hasPagos = (cPag.metodos?.length || 0) > 0;
    if (hasPagos) {
        sections.push({
            title: 'Pagos', icon: '💳', complete: true,
            items: [
                `${cPag.metodos.length} método(s)`,
                ...(cPag.metodos || []).slice(0, 3).map(m => {
                    return m.nombre || m.tipo || m.name || 'Método';
                }),
            ].filter(Boolean)
        });
    }

    // 6. Reglas — only if rules exist
    const cRules = state.reglas_especiales || [];
    const rulesList = Array.isArray(cRules) ? cRules : (typeof cRules === 'string' ? cRules.split('\n').filter(Boolean) : []);
    if (rulesList.length > 0) {
        sections.push({
            title: 'Reglas', icon: '📋', complete: true,
            items: [
                `${rulesList.length} regla(s) activa(s)`,
                ...(rulesList.slice(0, 2).map(r => {
                    const rText = typeof r === 'string' ? r : (r.regla || JSON.stringify(r));
                    return rText.length > 50 ? rText.substring(0, 50) + '…' : rText;
                }))
            ]
        });
    }

    // ─── Empty state ───
    if (sections.length === 0) {
        container.innerHTML = `
            <div style="
                text-align: center;
                padding: 2.5rem 1.5rem;
                color: rgba(0,0,51,0.45);
            ">
                <div style="font-size: 2rem; margin-bottom: 0.75rem; opacity: 0.5;">✨</div>
                <div style="font-size: 0.85rem; font-weight: 600; margin-bottom: 0.4rem; color: rgba(0,0,51,0.45);">
                    Nada configurado aún
                </div>
                <div style="font-size: 0.78rem; line-height: 1.4;">
                    Escríbele a Qhatu o usa las sugerencias para empezar a configurar tu bot.
                    Las secciones irán apareciendo conforme avances.
                </div>
            </div>
        `;
        return;
    }

    // ─── Render cards ───
    // Cache the full data per section so the "Ver más" modal can show everything.
    window._mayaSectionData = window._mayaSectionData || {};
    sections.forEach(section => {
        window._mayaSectionData[section.title] = section;

        const card = document.createElement('div');
        card.className = 'maya-config-card';
        card.style.animation = 'fadeIn 0.3s ease';
        card.style.cursor = 'pointer';

        const dotClass = section.complete ? 'complete' : 'incomplete';

        let itemsHtml = '';
        section.items.forEach(item => {
            itemsHtml += `<div class="maya-config-card-item">${item}</div>`;
        });

        card.innerHTML = `
            <div class="maya-config-card-header">
                <div class="maya-config-card-title">
                    <div class="maya-config-dot ${dotClass}"></div>
                    ${section.icon} ${section.title}
                </div>
                <div style="display:flex; gap:0.4rem; align-items:center;">
                    <button class="maya-config-card-btn" onclick="event.stopPropagation(); mayaEditSection('${section.title}')">Modificar</button>
                    <button onclick="event.stopPropagation(); mayaDeleteSection('${section.title}')"
                        title="Eliminar configuración"
                        style="background:transparent; border:none; color:rgba(0,0,51,0.4); font-size:0.95rem; line-height:1; padding:0.25rem 0.4rem; border-radius:6px; cursor:pointer; transition:all 0.15s;"
                        onmouseover="this.style.background='rgba(239,68,68,0.1)'; this.style.color='#EF4444';"
                        onmouseout="this.style.background='transparent'; this.style.color='rgba(0,0,51,0.4)';">🗑</button>
                </div>
            </div>
            ${itemsHtml}
        `;
        // Click on the card body (not the Modificar button) opens the side popover
        card.addEventListener('click', (e) => {
            if (e.target.closest('.maya-config-card-btn')) return;
            mayaShowSidePopover(section.title, card);
        });
        container.appendChild(card);
    });
}

// ─── Side popover (opens to the LEFT of the card, not below) ────────
// Click on a config card → small popover anchored to the card's left edge,
// showing a 1-line summary + "Ver más" + "Modificar" buttons.
window.mayaShowSidePopover = function(sectionTitle, anchorCard) {
    // Remove any existing popover first
    const existing = document.getElementById('maya-side-popover');
    if (existing) existing.remove();

    const section = (window._mayaSectionData || {})[sectionTitle];
    if (!section) return;

    // Summary = first item only (one short line). The full list lives in "Ver más".
    const firstItem = section.items[0] || '(sin información)';
    const moreCount = Math.max(0, section.items.length - 1);

    const rect = anchorCard.getBoundingClientRect();
    const pop = document.createElement('div');
    pop.id = 'maya-side-popover';
    // Width ~280, position to the LEFT of the card with a small gap.
    const popWidth = 280;
    const left = Math.max(12, rect.left - popWidth - 12);
    const top = Math.max(12, Math.min(window.innerHeight - 200, rect.top));
    pop.style.cssText = `position:fixed; left:${left}px; top:${top}px; width:${popWidth}px; background:#FFFFFF; border:1px solid rgba(0,0,82,0.12); border-radius:12px; padding:0.85rem 1rem; box-shadow:0 12px 32px rgba(0,0,82,0.12); z-index:9999; font-family:'Poppins',sans-serif;`;
    pop.innerHTML = `
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:0.5rem;">
            <div style="font-weight:700; font-size:0.85rem; color:#000052;">${section.icon} ${section.title}</div>
            <button id="maya-side-pop-close" style="background:transparent; border:none; color:rgba(0,0,51,0.4); font-size:1rem; cursor:pointer; padding:0 0.2rem;">✕</button>
        </div>
        <div style="font-size:0.8rem; color:rgba(0,0,51,0.7); line-height:1.4; margin-bottom:0.75rem;">${firstItem}${moreCount > 0 ? ` <span style="color:rgba(0,0,51,0.4); font-size:0.72rem;">(+${moreCount} más)</span>` : ''}</div>
        <div style="display:flex; gap:0.5rem;">
            <button id="maya-side-pop-vermas" style="flex:1; padding:0.45rem; background:#FAF7F0; color:#000052; border:1px solid rgba(0,0,82,0.15); border-radius:8px; font-size:0.78rem; font-weight:600; cursor:pointer; font-family:inherit;">Ver más</button>
            <button id="maya-side-pop-edit" style="flex:1; padding:0.45rem; background:#000052; color:#FAF7F0; border:none; border-radius:8px; font-size:0.78rem; font-weight:600; cursor:pointer; font-family:inherit;">Modificar</button>
        </div>
    `;
    document.body.appendChild(pop);

    document.getElementById('maya-side-pop-close').onclick = () => pop.remove();
    document.getElementById('maya-side-pop-vermas').onclick = () => { pop.remove(); mayaShowFullDetailModal(sectionTitle); };
    document.getElementById('maya-side-pop-edit').onclick = () => { pop.remove(); mayaEditSection(sectionTitle); };

    // Close when clicking outside
    setTimeout(() => {
        const offClick = (ev) => {
            if (!pop.contains(ev.target) && !anchorCard.contains(ev.target)) {
                pop.remove();
                document.removeEventListener('click', offClick);
            }
        };
        document.addEventListener('click', offClick);
    }, 0);
};

// ─── "Ver más" full detail modal ─────────────────────────
window.mayaShowFullDetailModal = function(sectionTitle) {
    const existing = document.getElementById('maya-fulldetail-modal');
    if (existing) existing.remove();

    const section = (window._mayaSectionData || {})[sectionTitle];
    if (!section) return;

    const allItemsHtml = section.items.map(i => `<div style="font-size:0.85rem; color:rgba(0,0,51,0.78); padding:0.55rem 0; border-bottom:1px solid rgba(0,0,82,0.06); line-height:1.45;">${i}</div>`).join('');

    const overlay = document.createElement('div');
    overlay.id = 'maya-fulldetail-modal';
    overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(15,23,42,0.45); backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px); display:flex; align-items:center; justify-content:center; z-index:10001; font-family:Poppins,sans-serif;';
    overlay.innerHTML = `
        <div style="background:#FFFFFF; border-radius:16px; padding:1.75rem; max-width:540px; width:92%; max-height:80vh; overflow-y:auto; box-shadow:0 20px 40px rgba(0,0,0,0.18);">
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:1rem;">
                <h3 style="margin:0; color:#000052; font-size:1.15rem; font-weight:700;">${section.icon} ${section.title} — Detalle completo</h3>
                <button id="maya-fulldetail-close" style="background:transparent; border:none; color:rgba(0,0,51,0.4); font-size:1.3rem; cursor:pointer; padding:0 0.3rem;">✕</button>
            </div>
            <div style="margin-bottom:1.25rem;">${allItemsHtml}</div>
            <div style="display:flex; gap:0.75rem; justify-content:flex-end;">
                <button id="maya-fulldetail-cancel" style="padding:0.6rem 1.1rem; background:#F3F4F6; color:#6B7280; border:1px solid #D1D5DB; border-radius:10px; font-size:0.85rem; font-weight:600; cursor:pointer; font-family:inherit;">Cerrar</button>
                <button id="maya-fulldetail-edit" style="padding:0.6rem 1.3rem; background:#000052; color:#FAF7F0; border:none; border-radius:10px; font-size:0.85rem; font-weight:700; cursor:pointer; font-family:inherit;">Editar</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    document.getElementById('maya-fulldetail-close').onclick = close;
    document.getElementById('maya-fulldetail-cancel').onclick = close;
    document.getElementById('maya-fulldetail-edit').onclick = () => { close(); mayaEditSection(sectionTitle); };
    overlay.onclick = (e) => { if (e.target === overlay) close(); };
};

// Maps a sidebar section title to the slug expected by the backend
// /clear-section/:section endpoint.
function mayaSectionSlug(sectionTitle) {
    const t = String(sectionTitle || '').toLowerCase();
    if (t === 'workflow' || t === 'personalidad') return t === 'workflow' ? 'workflow' : 'personalidad';
    if (t === 'productos') return 'productos';
    if (t === 'envíos' || t === 'envios') return 'envios';
    if (t === 'pagos') return 'pagos';
    if (t === 'reglas') return 'reglas';
    if (t === 'identidad') return 'identidad';
    return t;
}

window.mayaDeleteSection = function(sectionTitle) {
    if (!mayaCurrentBotId) return;
    const slug = mayaSectionSlug(sectionTitle);
    const performDelete = async () => {
        try {
            const response = await fetch(`/api/bots/${mayaCurrentBotId}/clear-section/${encodeURIComponent(slug)}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
            });
            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                throw new Error(data.error || 'No se pudo eliminar');
            }
            if (typeof showToast === 'function') showToast(`Sección "${sectionTitle}" eliminada`, 'success');
            // Refetch state so the sidebar reflects the cleared section without
            // needing a full page reload.
            try {
                const bots = await apiCall('/bots');
                const bot = (bots || []).find(b => b._id === mayaCurrentBotId);
                const bizInfo = await apiCall(`/business/${mayaCurrentBotId}`).catch(() => ({}));
                if (bot && typeof buildSyncState === 'function' && typeof renderMayaConfigSummary === 'function') {
                    renderMayaConfigSummary(buildSyncState(bot, bizInfo || {}));
                }
            } catch (refreshErr) {
                console.warn('[mayaDeleteSection] refresh failed, falling back to reload:', refreshErr);
                location.reload();
            }
        } catch (e) {
            console.error('[mayaDeleteSection] error:', e);
            if (typeof showToast === 'function') showToast('Error eliminando: ' + (e.message || ''), 'error');
        }
    };
    if (typeof showConfirmPopup === 'function') {
        showConfirmPopup(
            `Eliminar configuración: ${sectionTitle}`,
            `Se borrará la configuración de <strong>${sectionTitle}</strong>. Esta acción no se puede deshacer. ¿Continuar?`,
            performDelete,
            'Eliminar',
            '#EF4444'
        );
    } else {
        if (confirm(`¿Eliminar la configuración de ${sectionTitle}?`)) performDelete();
    }
};

window.mayaEditSection = function(sectionTitle) {
    const input = document.getElementById('maya-chat-input');
    if (input) {
        input.value = `Quiero editar la configuración de ${sectionTitle.toLowerCase()}`;
        input.focus();
    }
};

// ═══════════════════════════════════════════════════════════
//  PRODUCT GATE — Dynamic Welcome Bullets & Import Overlay
// ═══════════════════════════════════════════════════════════

// ─── Dynamic Welcome Bullets ──────────────────────────────
// Renders welcome screen bullets based on whether the bot has products.

function renderDynamicWelcomeBullets(hasProducts) {
    const container = document.getElementById('kipu-welcome-bullets');
    if (!container) return;

    let html = '';
    if (!hasProducts) {
        // Only product setup bullet (shouldn't reach here, gate handles it, but just in case)
        html = `
            <div style="font-size:0.8rem; font-weight:600; color:rgba(0,0,51,0.40); text-align:center; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:0.25rem;">Recomendaciones</div>
            <button class="kipu-welcome-bullet" onclick="openProductImportOverlay()">
                <span>Configura tus productos</span>
            </button>`;
    } else {
        // Products exist — show other suggestions (not product config)
        html = `
            <div style="font-size:0.8rem; font-weight:600; color:rgba(0,0,51,0.40); text-align:center; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:0.25rem;">Recomendaciones</div>
            <button class="kipu-welcome-bullet" onclick="kipuSendSuggestion('Quiero personalizar el catálogo y la presentación de mis productos')">
                <span>Personaliza tu catálogo</span>
            </button>
            <button class="kipu-welcome-bullet" onclick="openShippingConfigOverlay()">
                <span>Configura tus envíos</span>
            </button>
            <button class="kipu-welcome-bullet" onclick="kipuSendSuggestion('Quiero configurar los métodos de pago que acepto')">
                <span>Configura tus pagos</span>
            </button>`;
    }
    container.innerHTML = html;
}

// ─── Product Import Overlay ───────────────────────────────

let pioFiles = [];
let pioManualProducts = [];
let pioCurrentTab = 'files';

window.openProductImportOverlay = async function() {
    const overlay = document.getElementById('product-import-overlay');
    if (!overlay) return;
    overlay.style.display = 'flex';
    if (typeof hideWizardLoadingShim === 'function') hideWizardLoadingShim();

    // Restaurar el body + footer originales (los del HTML inicial). Sin esto,
    // si el usuario abrió la modal antes y llegó a `pioRenderConfirmation` (que
    // sobrescribe el .pio-body con la pantalla de "✓ Análisis completo"),
    // al abrir de nuevo la modal seguía viendo ese análisis viejo aunque sea
    // para una tienda distinta. Capturamos el HTML inicial una vez y lo
    // restauramos en cada apertura.
    const bodyEl = overlay.querySelector('.pio-body');
    const footerEl = overlay.querySelector('.pio-footer');
    if (bodyEl && !window.__pioOriginalBodyHTML) window.__pioOriginalBodyHTML = bodyEl.innerHTML;
    if (footerEl && !window.__pioOriginalFooterHTML) window.__pioOriginalFooterHTML = footerEl.innerHTML;
    if (bodyEl && window.__pioOriginalBodyHTML) bodyEl.innerHTML = window.__pioOriginalBodyHTML;
    if (footerEl && window.__pioOriginalFooterHTML) footerEl.innerHTML = window.__pioOriginalFooterHTML;

    // Reset state — incluye limpiar el análisis pendiente. Antes solo se
    // limpiaba al "Confirmar y guardar" (línea 2161) o al "Cancelar"
    // (pioCancelConfirmation), pero si el usuario cerraba con la X o cambiaba
    // de tienda, el _pioPendingAnalysis vivo persistía y la UI cargaba
    // productos de la tienda anterior.
    window._pioPendingAnalysis = null;
    window._pioPendingCurrency = null;
    pioFiles = [];
    pioManualProducts = [];
    pioCurrentTab = 'files';

    // Reset file list
    const fileList = document.getElementById('pio-file-list');
    if (fileList) fileList.innerHTML = '';
    const fileInput = document.getElementById('pio-file-input');
    if (fileInput) fileInput.value = '';

    // Reset URL inputs
    ['pio-url-input', 'pio-shopify-input', 'pio-ig-input'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });

    // Reset manual form
    ['pio-manual-name', 'pio-manual-desc', 'pio-manual-price'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const manualCards = document.getElementById('pio-manual-products');
    if (manualCards) manualCards.innerHTML = '';

    // Reset status elements
    overlay.querySelectorAll('.pio-status').forEach(s => {
        s.style.display = 'none';
        s.className = 'pio-status';
        s.innerHTML = '';
    });

    // Pre-cargar productos existentes para que el usuario los vea/edite al abrir.
    // Si el bot ya tiene productos guardados, los pintamos en la pestaña manual y
    // saltamos a esa pestaña. Si no, dejamos la pestaña Files por default (flujo
    // de primera importación).
    let hasExisting = false;
    if (mayaCurrentBotId) {
        try {
            const token = localStorage.getItem('token');
            const resp = await fetch(`/api/business/${mayaCurrentBotId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (resp.ok) {
                const biz = await resp.json();
                const existingProducts = Array.isArray(biz.products) ? biz.products : [];
                if (existingProducts.length > 0) {
                    pioManualProducts = existingProducts.map(p => ({
                        nombre: p.name || p.nombre || '',
                        descripcion: p.description || p.descripcion || '',
                        precio: Number(p.price ?? p.precio) || 0
                    }));
                    hasExisting = true;
                }
            }
        } catch (e) {
            console.warn('[pio] No se pudieron cargar productos existentes:', e);
        }
    }

    // Activar pestaña según contexto: manual si hay productos existentes, files si no
    pioCurrentTab = hasExisting ? 'manual' : 'files';
    const activePanelId = hasExisting ? 'pio-panel-manual' : 'pio-panel-files';
    overlay.querySelectorAll('.pio-tab').forEach(t => {
        const tabName = t.getAttribute('onclick')?.match(/'([^']+)'/g)?.[1]?.replace(/'/g, '') || '';
        t.classList.toggle('active', tabName === pioCurrentTab);
    });
    overlay.querySelectorAll('.pio-panel').forEach(p => {
        p.classList.toggle('active', p.id === activePanelId);
    });

    // Pintar las cards con productos pre-cargados (si los hay)
    renderPioManualCards();

    // Reset action button (refleja el tab activo)
    updatePioActionButton();
};

window.closeProductImportOverlay = function() {
    const overlay = document.getElementById('product-import-overlay');
    if (overlay) overlay.style.display = 'none';
};

// ─── Tab Switching ────────────────────────────────────────

window.switchPioTab = function(btn, tab) {
    pioCurrentTab = tab;
    const overlay = document.getElementById('product-import-overlay');
    if (!overlay) return;

    overlay.querySelectorAll('.pio-tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');

    ['files', 'url', 'shopify', 'instagram', 'manual'].forEach(t => {
        const panel = document.getElementById('pio-panel-' + t);
        if (panel) panel.classList.toggle('active', t === tab);
    });

    updatePioActionButton();
};

function updatePioActionButton() {
    const btn = document.getElementById('pio-action-btn');
    if (!btn) return;

    if (pioCurrentTab === 'manual') {
        btn.textContent = '💾 Guardar productos';
        btn.onclick = window.pioSaveManualProducts;
    } else {
        btn.innerHTML = '✨ Analizar con Qhatu';
        btn.onclick = pioExecuteAction;
    }
}

// ─── File Handling ────────────────────────────────────────

window.pioHandleFiles = function(fileList) {
    const validExts = ['.pdf', '.xlsx', '.xls', '.docx', '.doc', '.csv', '.txt', '.jpg', '.jpeg', '.png', '.webp'];
    for (const file of Array.from(fileList)) {
        if (pioFiles.length >= 5) {
            showToast('Máximo 5 archivos', 'error');
            break;
        }
        const ext = '.' + file.name.toLowerCase().split('.').pop();
        if (!validExts.includes(ext)) {
            showToast(`Formato no soportado: ${file.name}`, 'error');
            continue;
        }
        if (pioFiles.some(f => f.name === file.name)) continue;
        pioFiles.push(file);
    }
    renderPioFileList();
};

function renderPioFileList() {
    const container = document.getElementById('pio-file-list');
    if (!container) return;
    container.innerHTML = pioFiles.map((f, i) => `
        <div class="pio-file-item">
            <span>${getFileIcon(f.name)} ${f.name}</span>
            <button class="pio-file-remove" onclick="pioRemoveFile(${i})">✕</button>
        </div>
    `).join('');
}

window.pioRemoveFile = function(i) {
    pioFiles.splice(i, 1);
    renderPioFileList();
};

// ─── Manual Product Entry ─────────────────────────────────

window.pioManualAddProduct = function() {
    const nameEl = document.getElementById('pio-manual-name');
    const descEl = document.getElementById('pio-manual-desc');
    const priceEl = document.getElementById('pio-manual-price');

    const name = (nameEl?.value || '').trim();
    const desc = (descEl?.value || '').trim();
    const price = parseFloat(priceEl?.value || '0');

    if (!name) { showToast('El nombre del producto es obligatorio', 'error'); nameEl?.focus(); return; }
    if (!desc) { showToast('La descripción es obligatoria', 'error'); descEl?.focus(); return; }
    if (!price || price <= 0) { showToast('Ingresa un precio válido', 'error'); priceEl?.focus(); return; }

    pioManualProducts.push({ nombre: name, descripcion: desc, precio: price });

    // Clear form
    if (nameEl) nameEl.value = '';
    if (descEl) descEl.value = '';
    if (priceEl) priceEl.value = '';
    nameEl?.focus();

    renderPioManualCards();
    showToast(`✅ "${name}" agregado`, 'success');
};

window.pioManualRemoveProduct = function(i) {
    pioManualProducts.splice(i, 1);
    renderPioManualCards();
};

function renderPioManualCards() {
    const container = document.getElementById('pio-manual-products');
    if (!container) return;
    if (pioManualProducts.length === 0) {
        container.innerHTML = '';
        return;
    }
    // G&L E9: las tarjetas de producto ahora son editables. Click sobre la
    // tarjeta carga sus datos en el form de abajo (nombre/descripción/precio)
    // para que el emprendedor pueda corregir errores. La × sigue eliminándolo.
    container.innerHTML = pioManualProducts.map((p, i) => `
        <div class="pio-product-card" onclick="pioManualEditProduct(${i})" style="cursor:pointer;" title="Click para editar">
            <div class="pio-product-card-info">
                <div class="pio-product-card-name">${escapeHtml(p.nombre)}</div>
                <div class="pio-product-card-desc">${escapeHtml(p.descripcion)}</div>
            </div>
            <div class="pio-product-card-price">S/ ${p.precio.toFixed(2)}</div>
            <button class="pio-product-card-remove" onclick="event.stopPropagation(); pioManualRemoveProduct(${i})">✕</button>
        </div>
    `).join('');
}

window.pioManualEditProduct = function(i) {
    const p = pioManualProducts[i];
    if (!p) return;
    const nameEl = document.getElementById('pio-manual-name');
    const descEl = document.getElementById('pio-manual-desc');
    const priceEl = document.getElementById('pio-manual-price');
    if (nameEl) nameEl.value = p.nombre || '';
    if (descEl) descEl.value = p.descripcion || '';
    if (priceEl) priceEl.value = (typeof p.precio === 'number') ? p.precio.toFixed(2) : (p.precio || '');
    // Quitamos el producto de la lista — al pulsar "Agregar producto" se vuelve
    // a insertar con los datos editados. Patrón: editar = remover + reagregar.
    pioManualProducts.splice(i, 1);
    renderPioManualCards();
    if (nameEl) nameEl.focus();
    if (typeof showToast === 'function') showToast('Edita y pulsa "Agregar producto" para guardar los cambios', 'info');
};

// ─── Save Manual Products ─────────────────────────────────

window.pioSaveManualProducts = async function() {
    // Also include anything currently in the form fields (not yet added)
    const nameEl = document.getElementById('pio-manual-name');
    const descEl = document.getElementById('pio-manual-desc');
    const priceEl = document.getElementById('pio-manual-price');
    const pendingName = (nameEl?.value || '').trim();
    const pendingPrice = parseFloat(priceEl?.value || '0');

    if (pendingName && pendingPrice > 0) {
        pioManualProducts.push({
            nombre: pendingName,
            descripcion: (descEl?.value || '').trim() || pendingName,
            precio: pendingPrice
        });
    }

    if (pioManualProducts.length === 0) {
        showToast('Agrega al menos un producto', 'error');
        return;
    }

    if (!mayaCurrentBotId) {
        showToast('Selecciona o crea un Qhatu primero', 'error');
        return;
    }

    const actionBtn = document.getElementById('pio-action-btn');
    if (actionBtn) { actionBtn.disabled = true; actionBtn.textContent = 'Guardando...'; }

    const count = pioManualProducts.length;

    try {
        const token = localStorage.getItem('token');
        const authHeaders = {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        };

        // Fetch existing business info to merge (never overwrite)
        let existing = { description: '', products: [], paymentMethods: '', schedule: '', faqs: '' };
        try {
            const getResp = await fetch(`/api/business/${mayaCurrentBotId}`, { headers: authHeaders });
            if (getResp.ok) existing = await getResp.json();
        } catch (_) { /* treat as empty */ }

        // pioManualProducts ya contiene la lista COMPLETA (existentes + ediciones + nuevos)
        // porque openProductImportOverlay precarga los productos guardados al abrir.
        // Por eso reemplazamos el array entero en BD en vez de hacer merge — si
        // hiciéramos merge se duplicarían los existentes.
        const fullProducts = pioManualProducts.map(p => ({
            name: p.nombre,
            description: p.descripcion || p.nombre,
            price: Number(p.precio) || 0,
            stock: 99,
            image: ''
        }));

        const putResp = await fetch(`/api/business/${mayaCurrentBotId}`, {
            method: 'PUT',
            headers: authHeaders,
            body: JSON.stringify({
                description: existing.description || '',
                products: fullProducts,
                paymentMethods: existing.paymentMethods || '',
                schedule: existing.schedule || '',
                faqs: existing.faqs || ''
            })
        });

        if (!putResp.ok) {
            const errBody = await putResp.json().catch(() => ({}));
            throw new Error(errBody.error || `HTTP ${putResp.status}`);
        }

        // Reset the manual products buffer so reopening the modal is clean
        pioManualProducts = [];
        renderPioManualCards();

        // Reflect into chat history and sidebar
        mayaChatHistory.push({
            role: 'user',
            content: `He agregado ${count} productos manualmente.`,
            displayText: `He agregado ${count} productos manualmente.`
        });
        mayaChatHistory.push({
            role: 'maya',
            content: `✅ ${count} producto${count === 1 ? '' : 's'} guardado${count === 1 ? '' : 's'} correctamente.`
        });

        if (typeof renderMayaHistory === 'function') renderMayaHistory();

        // Refresh sidebar summary + product gate with the updated catalog
        try {
            const [bots, bizInfo] = await Promise.all([
                apiCall('/bots').catch(() => []),
                apiCall(`/business/${mayaCurrentBotId}`).catch(() => ({}))
            ]);
            const bot = Array.isArray(bots) ? bots.find(b => b._id === mayaCurrentBotId) : null;
            if (bot && typeof buildSyncState === 'function') {
                renderMayaConfigSummary(buildSyncState(bot, bizInfo || {}));
            }
            window._mayaBotHasProducts = (bizInfo?.products?.length || 0) > 0;
            const productGate = document.getElementById('kipu-product-gate');
            const welcomeScreen = document.getElementById('kipu-welcome-screen');
            const inputWrap = document.querySelector('.maya-input-wrap');
            if (window._mayaBotHasProducts) {
                if (productGate) productGate.classList.add('hidden');
                if (welcomeScreen) welcomeScreen.classList.remove('hidden');
                if (inputWrap) inputWrap.style.display = '';
            }
        } catch (_) { /* non-fatal */ }

        showToast(`${count} producto${count === 1 ? '' : 's'} guardado${count === 1 ? '' : 's'}`, 'success');

        unlockMayaChat();
        closeProductImportOverlay();

        // Regenerate workflow mindmap with the new products
        try { await apiCall(`/workflow/${mayaCurrentBotId}/regenerate`, 'POST'); } catch(e) { console.warn('[regenerate after products]', e); }

        // After product import → force wizard step 3 (payments)
        if (typeof showOnboardingStep === 'function') {
            showOnboardingStep(3, typeof currentBotId !== "undefined" ? currentBotId : mayaCurrentBotId);
        }

        autoSaveMayaSession();

    } catch (e) {
        console.error('[PIO] Save error:', e);
        showToast(`Error guardando productos: ${e.message || 'intenta de nuevo'}`, 'error');
    } finally {
        if (actionBtn) { actionBtn.disabled = false; actionBtn.textContent = '💾 Guardar productos'; }
    }
};

// ─── Analyze with Qhatu (Files/URL tabs) ───────────────────

window.pioExecuteAction = async function() {
    // If on manual tab, redirect to save
    if (pioCurrentTab === 'manual') {
        return window.pioSaveManualProducts();
    }

    // Determine URL or files
    let url = '';
    if (pioCurrentTab === 'url') url = document.getElementById('pio-url-input')?.value?.trim() || '';
    if (pioCurrentTab === 'shopify') url = document.getElementById('pio-shopify-input')?.value?.trim() || '';
    if (pioCurrentTab === 'instagram') url = document.getElementById('pio-ig-input')?.value?.trim() || '';

    const hasFiles = pioFiles.length > 0;
    const hasUrl = url && url.startsWith('http');

    if (pioCurrentTab === 'files' && !hasFiles) {
        showToast('Sube al menos un archivo para analizar', 'error');
        return;
    }
    if (pioCurrentTab !== 'files' && !hasUrl) {
        showToast('Pega una URL válida para analizar', 'error');
        return;
    }

    // Show loading
    const statusId = pioCurrentTab === 'files' ? 'pio-file-status' :
                     pioCurrentTab === 'url' ? 'pio-url-status' :
                     pioCurrentTab === 'shopify' ? 'pio-shopify-status' : 'pio-ig-status';
    const statusEl = document.getElementById(statusId);
    if (statusEl) {
        statusEl.className = 'pio-status loading';
        statusEl.style.display = 'flex';
        // Para análisis por URL avisamos que puede tardar más: con tiendas
        // grandes (Shopify bloqueado) el sistema visita cada página de
        // producto para extraer el precio real del JSON-LD. Esto puede
        // tomar 30-60 segundos para 500 productos.
        const isUrlScan = pioCurrentTab === 'url' || pioCurrentTab === 'shopify' || pioCurrentTab === 'instagram';
        statusEl.innerHTML = `
            <div class="pio-spinner"></div>
            <div>
                <div style="font-weight:600;font-size:0.85rem;">Qhatu está analizando tu catálogo...</div>
                <div style="font-size:0.75rem;color:rgba(0,0,51,0.45);">${isUrlScan ? 'Estamos extrayendo precios reales de cada producto. Tiendas grandes pueden tardar 1-3 minutos.' : 'Esto puede tardar unos segundos'}</div>
            </div>
        `;
    }

    const actionBtn = document.getElementById('pio-action-btn');
    if (actionBtn) actionBtn.disabled = true;

    try {
        const token = localStorage.getItem('token');
        let resp;

        if (hasFiles) {
            const formData = new FormData();
            pioFiles.forEach(file => formData.append('catalogs', file));
            resp = await fetch(`/api/catalog/analyze`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData
            });
        } else {
            resp = await fetch(`/api/catalog/analyze`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ url })
            });
        }

        if (!resp.ok) throw new Error('Error del servidor');
        const data = await resp.json();

        if (data.success && data.analysis) {
            const productCount = data.analysis.products?.length || 0;
            // Cache the full analysis (business name, summary, etc.) for the
            // confirmation step below. The user must review the list and click
            // "Confirmar y guardar" before anything is persisted to the bot.
            window._pioPendingAnalysis = data.analysis;

            // Detect currency from analysis (USD, EUR, PEN). Falls back to PEN
            // if the source is silent. Currency is exposed in the confirmation
            // UI so the merchant can correct it before saving.
            const detectedCurrency = (data.analysis.currency || data.analysis.moneda || 'PEN').toString().toUpperCase();
            window._pioPendingCurrency = ['USD','EUR','PEN','MXN','COP','ARS','CLP'].includes(detectedCurrency) ? detectedCurrency : 'PEN';

            if (productCount === 0) {
                if (statusEl) {
                    statusEl.className = 'pio-status';
                    statusEl.style.display = 'block';
                    statusEl.innerHTML = `
                        <div style="padding:0.75rem;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.2);border-radius:10px;font-size:0.82rem;color:#b45309;">
                            ⚠️ No se encontraron productos en esa fuente. Intenta con una URL del catálogo o agrégalos manualmente.
                        </div>`;
                }
                return;
            }

            // ─── Confirmation step: show full list before saving ───
            // The merchant must explicitly confirm. They can also edit/remove
            // individual entries in the manual tab before persisting.
            pioRenderConfirmation(data.analysis, window._pioPendingCurrency);
        } else {
            throw new Error('No se pudo analizar el catálogo');
        }
    } catch (e) {
        console.error('[PIO] Analyze error:', e);
        if (statusEl) {
            statusEl.className = 'pio-status';
            statusEl.style.display = 'block';
            statusEl.innerHTML = `
                <div style="padding:0.75rem;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);border-radius:10px;font-size:0.82rem;color:#ef4444;">
                    ❌ No se pudo analizar. Intenta con otro archivo o URL.
                </div>
            `;
        }
        showToast('Error al analizar el catálogo', 'error');
    } finally {
        if (actionBtn) { actionBtn.disabled = false; actionBtn.innerHTML = '✨ Analizar con Qhatu'; }
    }
};

// ─── Confirmation step (E2): preview parsed catalog before saving ───
// Shows the FULL list of detected products + currency selector + business
// name detected. Nothing is persisted until the merchant clicks "Confirmar y
// guardar". They can edit price/name inline or remove individual rows.
function pioRenderConfirmation(analysis, defaultCurrency) {
    const overlay = document.getElementById('product-import-overlay');
    if (!overlay) return;
    const products = Array.isArray(analysis.products) ? analysis.products : [];
    const detectedName = (analysis.business_name || '').trim();

    const currencySymbols = { PEN: 'S/', USD: 'US$', EUR: '€', MXN: '$', COP: '$', ARS: '$', CLP: '$' };
    const sym = currencySymbols[defaultCurrency] || 'S/';

    // Parser robusto: el backend ahora devuelve `price` como NÚMERO, pero
    // por compatibilidad con el flujo legacy (que usaba "S/ 40.00" string)
    // también extraemos el primer número del string si encontramos uno.
    const parsePrice = (raw) => {
        if (typeof raw === 'number' && raw > 0) return raw;
        if (typeof raw === 'string') {
            const m = raw.match(/(\d+(?:[.,]\d+)?)/);
            if (m) {
                const n = parseFloat(m[1].replace(',', '.'));
                if (n > 0) return n;
            }
        }
        return 0;
    };

    const rowsHtml = products.map((p, i) => {
        const priceNum = parsePrice(p.price || p.precio);
        const priceVal = priceNum > 0 ? priceNum.toFixed(2) : '';
        const priceClass = priceNum > 0 ? '' : 'pio-price-missing';
        return `
        <div class="pio-confirm-row" data-pio-row="${i}" style="display:grid;grid-template-columns:1fr 100px 32px;gap:0.6rem;align-items:center;padding:0.55rem 0.7rem;border:1px solid rgba(0,0,82,0.08);border-radius:10px;background:#FAF7F0;margin-bottom:0.4rem;">
            <div>
                <div contenteditable="true" data-pio-field="name" style="font-weight:600;color:#000052;font-size:0.9rem;outline:none;border-bottom:1px dashed transparent;padding:1px 2px;" onfocus="this.style.borderBottomColor='rgba(0,0,82,0.25)'" onblur="this.style.borderBottomColor='transparent'">${escapeHtml(p.name || p.nombre || 'Producto')}</div>
                <div contenteditable="true" data-pio-field="description" style="font-size:0.78rem;color:rgba(0,0,51,0.55);margin-top:0.2rem;outline:none;border-bottom:1px dashed transparent;padding:1px 2px;" onfocus="this.style.borderBottomColor='rgba(0,0,82,0.25)'" onblur="this.style.borderBottomColor='transparent'">${escapeHtml(p.description || p.descripcion || '')}</div>
            </div>
            <div style="display:flex;align-items:center;gap:0.25rem;">
                <span class="pio-confirm-sym" style="font-size:0.85rem;font-weight:700;color:#000052;">${sym}</span>
                <input type="number" min="0" step="0.01" data-pio-field="price" value="${priceVal}" placeholder="0.00" class="${priceClass}" style="width:75px;padding:0.3rem 0.4rem;border:1px solid rgba(0,0,82,0.15);border-radius:6px;background:#FFF;font-size:0.85rem;color:#000052;font-weight:600;${priceNum > 0 ? '' : 'border-color:rgba(245,158,11,0.4);background:rgba(254,243,199,0.4);'}">
            </div>
            <button onclick="pioConfirmRemoveRow(${i})" title="Quitar producto" style="background:transparent;border:1px solid rgba(239,68,68,0.25);color:#ef4444;width:28px;height:28px;border-radius:8px;cursor:pointer;font-family:inherit;font-weight:600;">✕</button>
        </div>`;
    }).join('');

    const withPriceCount = products.filter(p => parsePrice(p.price || p.precio) > 0).length;
    const missingPrice = products.length - withPriceCount;

    overlay.querySelector('.pio-body').innerHTML = `
        <div style="padding:0.5rem 0.25rem 0;">
            <div style="background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.18);border-radius:12px;padding:0.85rem 1rem;margin-bottom:0.85rem;">
                <div style="font-size:0.95rem;font-weight:700;color:#15803d;margin-bottom:0.25rem;">✓ Análisis completo</div>
                <div style="font-size:0.82rem;color:#166534;">Encontramos <strong>${products.length}</strong> producto(s)${detectedName ? ` para <strong>"${escapeHtml(detectedName)}"</strong>` : ''}. ${withPriceCount > 0 ? `<strong>${withPriceCount}</strong> con precio detectado automáticamente.` : ''}${missingPrice > 0 ? ` <strong>${missingPrice}</strong> sin precio (resaltados en amarillo) — completa o elimina los que necesites.` : ''}</div>
            </div>

            <div style="display:flex;gap:0.6rem;flex-wrap:wrap;align-items:end;margin-bottom:0.85rem;">
                <div style="flex:1;min-width:180px;">
                    <label style="display:block;font-size:0.72rem;font-weight:700;color:rgba(0,0,51,0.55);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:0.3rem;">Nombre de la tienda</label>
                    <input type="text" id="pio-confirm-storename" value="${escapeHtml(detectedName)}" placeholder="Ej: Gymshark" style="width:100%;padding:0.5rem 0.65rem;border:1px solid rgba(0,0,82,0.15);border-radius:8px;background:#FAF7F0;font-size:0.88rem;color:#000052;">
                </div>
                <div style="min-width:140px;">
                    <label style="display:block;font-size:0.72rem;font-weight:700;color:rgba(0,0,51,0.55);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:0.3rem;">Moneda</label>
                    <select id="pio-confirm-currency" onchange="pioUpdateCurrencySymbol(this.value)" style="width:100%;padding:0.5rem 0.65rem;border:1px solid rgba(0,0,82,0.15);border-radius:8px;background:#FAF7F0;font-size:0.88rem;color:#000052;">
                        <option value="PEN" ${defaultCurrency === 'PEN' ? 'selected' : ''}>S/ — Soles (PEN)</option>
                        <option value="USD" ${defaultCurrency === 'USD' ? 'selected' : ''}>US$ — Dólares (USD)</option>
                        <option value="EUR" ${defaultCurrency === 'EUR' ? 'selected' : ''}>€ — Euros (EUR)</option>
                        <option value="MXN" ${defaultCurrency === 'MXN' ? 'selected' : ''}>$ — Pesos MX (MXN)</option>
                        <option value="COP" ${defaultCurrency === 'COP' ? 'selected' : ''}>$ — Pesos CO (COP)</option>
                        <option value="ARS" ${defaultCurrency === 'ARS' ? 'selected' : ''}>$ — Pesos AR (ARS)</option>
                        <option value="CLP" ${defaultCurrency === 'CLP' ? 'selected' : ''}>$ — Pesos CL (CLP)</option>
                    </select>
                </div>
            </div>

            <div id="pio-confirm-list" style="max-height:340px;overflow-y:auto;padding:0.25rem;border:1px solid rgba(0,0,82,0.08);border-radius:10px;">
                ${rowsHtml || '<div style="padding:1.25rem;text-align:center;color:rgba(0,0,51,0.45);">Sin productos para mostrar.</div>'}
            </div>
        </div>
    `;

    const footer = overlay.querySelector('.pio-footer');
    if (footer) {
        footer.innerHTML = `
            <button class="pio-btn-secondary" onclick="pioCancelConfirmation()" style="background:#FAF7F0;color:#6E6E73;border:1px solid #E5E5EA;padding:0.65rem 1.1rem;border-radius:10px;font-weight:600;cursor:pointer;font-family:inherit;">Cancelar</button>
            <button class="pio-btn-primary" id="pio-action-btn" onclick="pioConfirmAndSave()">✓ Confirmar y guardar</button>
        `;
    }
}

window.pioUpdateCurrencySymbol = function(code) {
    const map = { PEN: 'S/', USD: 'US$', EUR: '€', MXN: '$', COP: '$', ARS: '$', CLP: '$' };
    const sym = map[code] || 'S/';
    document.querySelectorAll('.pio-confirm-sym').forEach(el => el.textContent = sym);
    window._pioPendingCurrency = code;
};

window.pioConfirmRemoveRow = function(idx) {
    const row = document.querySelector(`[data-pio-row="${idx}"]`);
    if (row) row.remove();
};

window.pioCancelConfirmation = function() {
    window._pioPendingAnalysis = null;
    window._pioPendingCurrency = null;
    closeProductImportOverlay();
};

window.pioConfirmAndSave = async function() {
    const t0 = Date.now();
    console.log('[PIO Save] Start');
    const analysis = window._pioPendingAnalysis;
    if (!analysis) { console.warn('[PIO Save] No pending analysis, abort'); return; }

    // Read what's on screen now (post-edits/removals)
    const currency = (document.getElementById('pio-confirm-currency')?.value || 'PEN').toUpperCase();
    const storeName = (document.getElementById('pio-confirm-storename')?.value || '').trim();

    const editedProducts = [];
    document.querySelectorAll('.pio-confirm-row').forEach(row => {
        const name = row.querySelector('[data-pio-field="name"]')?.textContent?.trim() || '';
        const description = row.querySelector('[data-pio-field="description"]')?.textContent?.trim() || '';
        const price = parseFloat(row.querySelector('[data-pio-field="price"]')?.value || '0') || 0;
        if (name) editedProducts.push({ name, description, price });
    });
    console.log(`[PIO Save] DOM read in ${Date.now() - t0}ms — ${editedProducts.length} products`);

    if (editedProducts.length === 0) {
        showToast('Necesitas al menos un producto para guardar', 'error');
        return;
    }

    const btn = document.getElementById('pio-action-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }

    // Helper: fetch con timeout — si el server no responde en 60s, abortamos
    // y mostramos error en lugar de dejar al usuario en "Guardando..." infinito.
    const fetchWithTimeout = (url, options, timeoutMs = 60000) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        return fetch(url, { ...options, signal: controller.signal })
            .finally(() => clearTimeout(timer));
    };

    try {
        const token = localStorage.getItem('token');
        const authHeaders = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
        const productCount = editedProducts.length;

        // ─── Persistencia DIRECTA al business_info ───
        // Antes pasábamos por /maya-chat para que el LLM "integrara" el
        // catálogo, pero con 1000 productos esa llamada a OpenAI tarda
        // 1-3 minutos y a veces se cuelga, dejando al usuario en
        // "Guardando..." indefinidamente. Ahora escribimos los productos
        // directamente y disparamos regeneración del workflow al final.
        // El LLM puede enriquecer la metadata después (off-thread).

        // 1. Fetch existing business info para hacer merge sin perder datos
        let existing = { description: '', products: [], paymentMethods: '', schedule: '', faqs: '' };
        try {
            console.log('[PIO Save] Step 1: GET existing business_info');
            const r = await fetchWithTimeout(`/api/business/${mayaCurrentBotId}`, { headers: authHeaders }, 15000);
            if (r.ok) existing = await r.json();
            console.log(`[PIO Save] Step 1 OK in ${Date.now() - t0}ms`);
        } catch (e) { console.warn('[PIO Save] Step 1 fetch failed:', e?.message); }

        // Productos finales: usamos los confirmados por el usuario.
        // El backend espera { name, description, price } como objeto plano.
        const finalProducts = editedProducts.map(p => ({
            name: p.name,
            description: p.description || '',
            price: p.price > 0 ? p.price.toString() : 'Consultar'
        }));

        // 2. Guardar productos en business_info (escritura directa, sin LLM)
        const bodyJson = JSON.stringify({
            description: existing.description || analysis.business_summary || '',
            products: finalProducts,
            paymentMethods: existing.paymentMethods || '',
            schedule: existing.schedule || '',
            faqs: existing.faqs || ''
        });
        console.log(`[PIO Save] Step 2: PUT body=${(bodyJson.length / 1024).toFixed(1)}KB, ${productCount} products`);
        const saveResp = await fetchWithTimeout(`/api/business/${mayaCurrentBotId}`, {
            method: 'PUT',
            headers: authHeaders,
            body: bodyJson
        }, 90000);  // 90s timeout para 1000+ productos en JSONB
        console.log(`[PIO Save] Step 2 status=${saveResp.status} in ${Date.now() - t0}ms`);
        if (!saveResp.ok) {
            const err = await saveResp.json().catch(() => ({}));
            throw new Error(err.error || `HTTP ${saveResp.status}`);
        }

        // ─── A partir de aquí: SAVE EXITOSO ───
        // Cerramos el modal y mostramos el toast INMEDIATAMENTE. Las operaciones
        // 3, 4, 5 (botName, refresh, regenerate) corren en background — si
        // alguna se cuelga (ej. fetch sin response timeout), no afecta la UX
        // porque el usuario ya vio la confirmación y avanzó al siguiente paso.

        mayaChatHistory.push({ role: 'user', content: 'He confirmado mi catálogo.', displayText: 'He confirmado mi catálogo.' });
        mayaChatHistory.push({ role: 'maya', content: `✅ ${productCount} productos importados${storeName ? ` para ${storeName}` : ''}.` });

        showToast(`${productCount} productos importados`, 'success');

        unlockMayaChat();
        closeProductImportOverlay();
        window._pioPendingAnalysis = null;
        window._pioPendingCurrency = null;

        if (typeof invalidateBotsCache === 'function') invalidateBotsCache();

        if (typeof showOnboardingStep === 'function' && mayaCurrentBotId) {
            showOnboardingStep(3, typeof currentBotId !== "undefined" ? currentBotId : mayaCurrentBotId);
        }
        console.log(`[PIO Save] UI closed, productos importados — running background tasks`);

        // ─── Background tasks (fire-and-forget, no bloquean la UI) ───

        // 3. Actualizar botName + tienda.nombre (con timeout 10s — si cuelga
        //    se ignora; el botName se puede editar luego desde Identidad).
        //    NOTA: el endpoint usa PUT (no PATCH) — el handler de PUT /bots/:id
        //    hace merge superficial sobre tienda, así que le mandamos el objeto
        //    `tienda` y el `botName` plano.
        if (storeName) {
            fetchWithTimeout(`/api/bots/${mayaCurrentBotId}`, {
                method: 'PUT',
                headers: authHeaders,
                body: JSON.stringify({ botName: storeName, tienda: { nombre: storeName } })
            }, 10000)
                .then(r => console.log(`[PIO Save] background botName PUT status=${r.status}`))
                .catch(e => console.warn('[PIO Save] background botName failed:', e?.message));
        }

        // 4. Refrescar el resumen visible de Qhatu con el conteo nuevo.
        if (typeof renderMayaConfigSummary === 'function') {
            renderMayaConfigSummary({ products: finalProducts });  // optimistic, no fetch
        }

        // 5. Regenerar workflow (también background).
        if (typeof apiCall === 'function') {
            apiCall(`/workflow/${mayaCurrentBotId}/regenerate`, 'POST')
                .then(() => console.log('[PIO Save] background regenerate workflow OK'))
                .catch(e => console.warn('[PIO Save] background regenerate failed:', e?.message));
        }

        autoSaveMayaSession();
    } catch (e) {
        console.error('[PIO] Confirm save error:', e);
        showToast(e.message || 'Error al guardar el catálogo', 'error');
        if (btn) { btn.disabled = false; btn.textContent = '✓ Confirmar y guardar'; }
    }
};

// ─── Unlock Qhatu Chat ─────────────────────────────────────
// Called after products are successfully saved/imported.

function unlockMayaChat() {
    window._mayaBotHasProducts = true;

    // Hide product gate
    const productGate = document.getElementById('kipu-product-gate');
    if (productGate) productGate.classList.add('hidden');

    // Show input wrap
    const inputWrap = document.querySelector('.maya-input-wrap');
    if (inputWrap) inputWrap.style.display = '';

    // Show welcome screen container. The mind map only mounts when the
    // merchant opens the "Configura tu Qhatu" tab (switchKipuTab handles it).
    const welcomeScreen = document.getElementById('kipu-welcome-screen');
    if (welcomeScreen) welcomeScreen.classList.remove('hidden');
    const configTabBtn = document.querySelector('.kipu-top-tab[data-kipu-tab="config"].active');
    if (configTabBtn && typeof initKipuMindmap === 'function' && window.mayaCurrentBotId) {
        const botId = window.mayaCurrentBotId;
        const host = document.getElementById('kipu-mindmap-host');
        const hostEmpty = host && (!host.firstElementChild || host.children.length === 0);
        // Re-mount si no está marcado como montado para este bot O si el host
        // del DOM quedó vacío (caso típico tras navegar entre tabs).
        if (window._kipuMindmapMountedFor !== botId || hostEmpty) {
            if (hostEmpty) window._kipuMindmapMountedFor = null;
            initKipuMindmap(botId)
                .then(() => { window._kipuMindmapMountedFor = botId; })
                .catch(e => console.warn('[mindmap] unlock init failed:', e));
        }
    }

    // Focus input
    setTimeout(() => {
        const input = document.getElementById('maya-chat-input');
        if (input) input.focus();
    }, 300);
}

// Expose escapeHtml if not already global
if (typeof window.escapeHtml === 'undefined') {
    window.escapeHtml = function(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    };
}

// ═══════════════════════════════════════════════════════════
// ==================== PROBAR KIPU TESTER ====================
// ═══════════════════════════════════════════════════════════

// ═══ Top navigation: Qhatu tabs (Crea / Configura / Inventario / Envíos / Probar) ═══
// Rules: `config` and `tester` both live inside section-create-bot and toggle the inner panel.
// The rest activate their own standalone sections.
// ─────────────────────────────────────────────────────────────────────────
// MENSAJES DE PRUEBA SUGERIDOS — generación dinámica por tienda
//
// Arma chips contextuales para el tester usando la config REAL del bot:
//   • producto más vendido / primero del catálogo → "¿Cuánto cuesta X?"
//   • lista de catálogo → "¿Qué productos tienen?"
//   • intención de compra → "Quiero comprar X" (dispara el flow de venta)
//   • pago → "¿Cómo puedo pagar?"
//   • envío contextualizado según tipo (recojo / domicilio / ambos / ninguno)
//   • horarios → "¿Cuál es su horario?" si business_info.schedule tiene contenido
//
// Si no hay productos cargados aún, mostramos preguntas genéricas amigables
// que un cliente nuevo haría — y guían al emprendedor a configurar la tienda.
// ─────────────────────────────────────────────────────────────────────────

function _renderTesterChips(suggestions) {
    const host = document.getElementById('kipu-tester-suggested-chips');
    if (!host) return;
    if (!suggestions || suggestions.length === 0) {
        host.innerHTML = '';
        return;
    }
    const esc = (s) => String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const escJs = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    host.innerHTML = suggestions.map(text => `
        <button type="button" class="kipu-tester-chip"
                onclick="sendTesterMessage('${escJs(text)}')">${esc(text)}</button>
    `).join('');
}

function _buildTesterSuggestions(biz, bot) {
    const out = [];

    // Producto top — usamos el primero con nombre válido. Si hay más de uno,
    // el segundo se usa para variar la intención de compra.
    const products = (biz?.products || [])
        .filter(p => p && p.name && p.name !== 'Producto sin nombre')
        .slice(0, 5);

    if (products.length > 0) {
        out.push(`¿Cuánto cuesta ${products[0].name}?`);
    }

    if (products.length >= 2) {
        out.push('¿Qué productos tienen?');
    } else if (products.length === 1) {
        out.push('Cuéntame qué venden');
    } else {
        out.push('¿Qué venden?');
    }

    // Envío — contextualizado según tienda.envios.tipo. Soporta múltiples
    // shapes (tienda.envios.tipo, envios.tipo, tipo_entrega).
    const shippingType =
        bot?.tienda?.envios?.tipo
        || bot?.envios?.tipo
        || bot?.tipo_entrega
        || '';
    if (shippingType === 'recojo') {
        out.push('¿Dónde puedo recoger?');
    } else if (shippingType === 'domicilio' || shippingType === 'ambos') {
        out.push('¿Hacen envío a domicilio?');
    } else if (shippingType === 'ninguno') {
        // Tienda solo digital/presencial — no preguntar de envío
        if (products.length > 0) {
            out.push(`Quiero comprar ${products[0].name}`);
        } else {
            out.push('¿Cómo funciona?');
        }
    } else {
        // Sin config de envío todavía
        out.push('¿Hacen envíos?');
    }

    // Pago — universal, casi siempre relevante.
    out.push('¿Cómo puedo pagar?');

    // Máximo 4 chips para que entren en la fila sin scroll horizontal en
    // pantallas de ~1200px (4 × ~280px = 1120 + gaps).
    return out.slice(0, 4);
}

async function populateTesterSuggestions(botId) {
    const host = document.getElementById('kipu-tester-suggested-chips');
    if (!host) return;

    // Fallback genérico mientras se carga la config (o si no hay botId todavía)
    _renderTesterChips([
        '¿Qué venden?',
        '¿Cómo puedo pagar?',
        '¿Hacen envíos?',
        'Quiero comprar',
    ]);

    if (!botId || typeof apiCall !== 'function') return;

    try {
        const [biz, bots] = await Promise.all([
            apiCall(`/business/${botId}`).catch(() => null),
            typeof getCachedBots === 'function' ? getCachedBots().catch(() => []) : Promise.resolve([]),
        ]);
        const bot = (bots || []).find(b => String(b._id || b.id) === String(botId));
        const suggestions = _buildTesterSuggestions(biz, bot);
        _renderTesterChips(suggestions);
    } catch (e) {
        console.warn('[tester-suggestions] failed:', e?.message || e);
        // No tocamos el host — quedan los chips genéricos del fallback.
    }
}

window.populateTesterSuggestions = populateTesterSuggestions;

// ─────────────────────────────────────────────────────────────────────────
// WIDGET FLOTANTE "Prueba tu Willy" — popup estilo HubSpot.
// Reemplaza la pestaña que vivía en el top-bar. La primera vez que se abre,
// reparenta #mi-kipu-tester-panel desde su ubicación original (dentro de
// section-create-bot) al body del widget, así reusa toda la lógica de
// sendTesterMessage/testerResetChat sin duplicar IDs.
// ─────────────────────────────────────────────────────────────────────────

let _willyTesterPanelMoved = false;
let _willyTesterOriginalParent = null;

function _resolveActiveBotIdForTester() {
    // Resolvemos el bot activo desde múltiples fuentes para que el widget
    // funcione desde cualquier sección del dashboard.
    if (typeof window.mayaCurrentBotId === 'string' && window.mayaCurrentBotId) {
        return window.mayaCurrentBotId;
    }
    if (typeof window.__configSelectedBotId === 'string' && window.__configSelectedBotId) {
        return window.__configSelectedBotId;
    }
    const sel = document.getElementById('edit-bot-select');
    if (sel && sel.value) return sel.value;
    return '';
}

function _mountTesterPanelInWidget() {
    const widgetBody = document.getElementById('willy-tester-widget-body');
    const panel = document.getElementById('mi-kipu-tester-panel');
    const emptyState = document.getElementById('willy-tester-empty-state');
    if (!widgetBody || !panel) return false;
    if (_willyTesterPanelMoved) return true;
    _willyTesterOriginalParent = panel.parentElement;
    if (emptyState) emptyState.remove();
    widgetBody.appendChild(panel);
    panel.style.display = 'flex';
    _willyTesterPanelMoved = true;
    return true;
}

// Mueve #mi-kipu-tester-panel al slot dentro de #section-willy-tester.
// Devuelve true si quedó montado, false si falta el slot o el panel.
function _mountTesterPanelInSection() {
    const slot = document.getElementById('qwill-chat-slot');
    const panel = document.getElementById('mi-kipu-tester-panel');
    const emptyChat = document.getElementById('qwill-empty-chat');
    if (!slot || !panel) return false;
    // Si ya estaba en el widget flotante, sacarlo de ahí primero.
    if (_willyTesterPanelMoved && panel.parentElement && panel.parentElement.id === 'willy-tester-widget-body') {
        // Recordamos el parent original (la primera vez).
        if (!_willyTesterOriginalParent) _willyTesterOriginalParent = panel.parentElement;
    } else if (!_willyTesterPanelMoved) {
        _willyTesterOriginalParent = panel.parentElement;
    }
    if (emptyChat) emptyChat.style.display = 'none';
    slot.appendChild(panel);
    panel.style.display = 'flex';
    _willyTesterPanelMoved = true;
    return true;
}

window.toggleWillyTesterWidget = function() {
    const widget = document.getElementById('willy-tester-widget');
    if (!widget) return;
    if (widget.classList.contains('is-open')) {
        window.closeWillyTesterWidget();
    } else {
        window.openWillyTesterWidget();
    }
};

window.openWillyTesterWidget = function() {
    const widget = document.getElementById('willy-tester-widget');
    const fab = document.getElementById('willy-tester-fab');
    const label = document.getElementById('willy-widget-bot-label');
    if (!widget) return;

    const botId = _resolveActiveBotIdForTester();
    if (botId) {
        // Setear el bot activo + montar el panel del tester adentro.
        window.mayaCurrentBotId = botId;
        _mountTesterPanelInWidget();
        // Etiqueta visible en el header — nombre de la tienda activa.
        try {
            if (typeof getCachedBots === 'function') {
                getCachedBots().then(bots => {
                    const bot = (bots || []).find(b => String(b._id || b.id) === String(botId));
                    const name = bot?.botName || bot?.tienda?.nombre || 'Tienda';
                    if (label) label.textContent = name;
                }).catch(() => {});
            }
        } catch (_) { /* no fatal */ }
        // Cargar sugerencias dinámicas del bot activo.
        if (typeof populateTesterSuggestions === 'function') {
            populateTesterSuggestions(botId);
        }
        // Marcamos el tab interno como activo para que cualquier código que
        // dependa de window._kipuActiveTab funcione (p. ej. el refresh de
        // suggestions cuando cambia la tienda).
        window._kipuActiveTab = 'tester';
    } else {
        // Sin bot configurado: mostrar empty state.
        if (label) label.textContent = 'selecciona una tienda';
    }

    widget.classList.remove('is-closing');
    widget.classList.add('is-open');
    fab.classList.add('is-open');
    fab.setAttribute('aria-label', 'Cerrar Prueba tu Willy');
    const sidebarItem = document.getElementById('sidebar-willy-item');
    if (sidebarItem) sidebarItem.classList.add('active');

    // Foco al input para que el usuario pueda tipear de inmediato.
    setTimeout(() => {
        const input = document.getElementById('tester-chat-input');
        if (input) try { input.focus(); } catch (_) { /* ignore */ }
    }, 220);
};

window.closeWillyTesterWidget = function() {
    const widget = document.getElementById('willy-tester-widget');
    const fab = document.getElementById('willy-tester-fab');
    if (!widget) return;
    widget.classList.add('is-closing');
    if (fab) { fab.classList.remove('is-open'); fab.setAttribute('aria-label', 'Abrir Prueba tu Willy'); }
    const sidebarItem = document.getElementById('sidebar-willy-item');
    if (sidebarItem) sidebarItem.classList.remove('active');
    setTimeout(() => {
        widget.classList.remove('is-open');
        widget.classList.remove('is-closing');
    }, 200);
};

// ═════════ Prueba tu Willy como SECCIÓN (no widget flotante) ═════════
// Reemplaza al widget flotante: el sidebar ahora navega a #section-willy-tester
// que reusa el panel #mi-kipu-tester-panel via reparenting.

// Llena el selector de tienda de la sección (qwill-bot-select) y selecciona el
// bot activo si lo hay.
async function _qwillPopulateBotSelector() {
    const sel = document.getElementById('qwill-bot-select');
    if (!sel) return;
    // Si ya tiene opciones reales, refrescamos solo el seleccionado.
    if (sel.options.length <= 1) {
        try {
            if (typeof populateBotSelector === 'function') {
                await populateBotSelector('qwill-bot-select', (botId) => { window.qwillOnBotChange?.(botId); });
            }
        } catch (e) { console.warn('[qwill] populate bot selector falló:', e); }
    }
    const activeBotId = _resolveActiveBotIdForTester();
    if (activeBotId && sel.value !== activeBotId) {
        // Setea el bot activo si está en la lista.
        for (const opt of sel.options) {
            if (opt.value === activeBotId) { sel.value = activeBotId; break; }
        }
    }
    if (typeof refreshQatuTiendaAvatar === 'function') refreshQatuTiendaAvatar('qwill-bot-select');
}

window.qwillOnBotChange = function(botId) {
    if (!botId) return;
    window.mayaCurrentBotId = botId;
    // Re-mount panel para que la nueva tienda cargue su flujo en el chat.
    _mountTesterPanelInSection();
    if (typeof populateTesterSuggestions === 'function') populateTesterSuggestions(botId);
    if (typeof refreshQatuTiendaAvatar === 'function') refreshQatuTiendaAvatar('qwill-bot-select');
    _qwillRefreshBotLabelInDebug();
};

function _qwillRefreshBotLabelInDebug() {
    // Pequeño hook para que el inspector muestre el nombre del bot activo si
    // querés ampliar el panel más adelante. Hoy no muestra nada — placeholder.
}

window.qwillSwitchVersion = function(btn) {
    const v = btn.dataset.v;
    document.querySelectorAll('#section-willy-tester .qwill-version-btn').forEach(b => b.classList.toggle('is-active', b === btn));
    const lbl = document.getElementById('qwill-version-label');
    if (lbl) lbl.textContent = v === 'draft' ? 'borrador' : 'producción';
    // Hook futuro: cambiar entre flujo borrador y publicado al simular.
    window.__qwillActiveVersion = v;
};

window.qwillSaveConversation = function() {
    if (typeof showToast === 'function') {
        showToast('Conversación guardada (próximamente — exportar a CSV)', 'info');
    } else {
        alert('Conversación guardada');
    }
};

window.qwillShowHelp = function() {
    if (typeof showToast === 'function') {
        showToast('Modo sandbox: los mensajes son simulados y no llegan a clientes reales.', 'info');
    } else {
        alert('Modo sandbox: los mensajes son simulados.');
    }
};

window.openWillyTesterSection = function(event) {
    try {
        if (event) {
            event.stopImmediatePropagation?.();
            event.stopPropagation?.();
            event.preventDefault?.();
        }
        // Cerrar el widget flotante si estaba abierto (legacy fallback).
        const widget = document.getElementById('willy-tester-widget');
        if (widget && widget.classList.contains('is-open')) {
            try { window.closeWillyTesterWidget(); } catch (_) {}
        }
        // Marcar el item del sidebar como activo.
        document.querySelectorAll('.sidebar-nav li').forEach(li => li.classList.remove('active'));
        const item = document.getElementById('sidebar-willy-item');
        if (item) item.classList.add('active');
        // Mostrar la sección.
        document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
        const sec = document.getElementById('section-willy-tester');
        if (sec) sec.classList.add('active');
        // Llenar el selector + reparentar el panel del tester.
        _qwillPopulateBotSelector();
        const botId = _resolveActiveBotIdForTester();
        if (botId) {
            window.mayaCurrentBotId = botId;
            _mountTesterPanelInSection();
            window._kipuActiveTab = 'tester';
            if (typeof populateTesterSuggestions === 'function') {
                try { populateTesterSuggestions(botId); } catch (_) {}
            }
        } else {
            // Sin bot configurado: dejar el empty-state visible.
            const emptyChat = document.getElementById('qwill-empty-chat');
            if (emptyChat) emptyChat.style.display = 'flex';
        }
        // Foco al input.
        setTimeout(() => {
            const input = document.getElementById('tester-chat-input');
            if (input) try { input.focus(); } catch (_) {}
        }, 220);
    } catch (e) {
        console.warn('[openWillyTesterSection]', e);
    }
};

// Legacy compat: si algún path antiguo todavía llama a toggleWillyTesterWidget,
// lo redirigimos a la nueva sección. El widget flotante queda obsoleto.
const _legacyToggleWillyTesterWidget = window.toggleWillyTesterWidget;
window.toggleWillyTesterWidget = function() {
    window.openWillyTesterSection?.();
};

// Mostrar FABs solo cuando el dashboard está visible (usuario logueado y
// fuera de login/registro). En /panel#login puede haber token guardado pero
// la auth-view sigue activa — ahí no deben verse notificaciones ni Willy.
// El FAB de Willy (#willy-tester-fab) se mantiene oculto siempre: la entrada
// ahora vive en el sidebar lateral ("Prueba tu Willy").
function _maybeShowWillyTesterFab() {
    const dashView = document.getElementById('dashboard-view');
    const dashVisible = dashView && getComputedStyle(dashView).display !== 'none';
    const notifFab = document.getElementById('notif-fab');
    if (notifFab) notifFab.style.display = dashVisible ? 'flex' : 'none';
    if (!dashVisible && typeof window.closeWillyTesterWidget === 'function') {
        window.closeWillyTesterWidget();
    }
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _maybeShowWillyTesterFab);
} else {
    _maybeShowWillyTesterFab();
}
// Re-check cuando el token cambia (login/logout).
window.addEventListener('storage', (e) => {
    if (e.key === 'token') _maybeShowWillyTesterFab();
});
window._maybeShowWillyTesterFab = _maybeShowWillyTesterFab;

window.switchKipuTab = function(tab) {
    // Cancela showBotConfig async en vuelo — evita que un click tardío en
    // Mi Qhatu pise Envíos/Inventario si el usuario ya cambió de sección.
    if (typeof window._cancelShowBotConfig === 'function') window._cancelShowBotConfig();

    // El tab "tester" ahora vive en un widget flotante (FAB en esquina inferior
    // derecha) en lugar de en el top-bar. Si alguien llama a switchKipuTab('tester')
    // por path legacy, abrimos el widget y mantenemos el tab activo en 'crea'
    // (Tiendas) para no dejar el contenido principal en blanco.
    if (tab === 'tester') {
        if (typeof window.openWillyTesterWidget === 'function') {
            window.openWillyTesterWidget();
        }
        tab = 'crea';
    }
    if (tab !== 'workflow') {
        // Limpia banners huérfanos del body (legacy). Los que viven dentro
        // del greybox se ocultan solos al cambiar de sección.
        document.querySelectorAll('body > #kipu-mindmap-demo-banner, body > #kipu-validation-banner')
            .forEach(el => el.remove());
    }
    // Set early — initMayaChat usa esto para decidir si esconder el welcome-screen
    // cuando el bot no tiene productos (en workflow tab NUNCA debe esconderlo,
    // sino el host del mindmap mide 0x0 y cytoscape no dibuja).
    window._kipuActiveTab = tab;

    // Oculta el host del editor de flujo cuando se va a cualquier tab que no
    // sea 'editor-flujo' — la rama específica lo vuelve a mostrar abajo.
    if (tab !== 'editor-flujo') {
        const _flowHost = document.getElementById('flow-editor-host');
        if (_flowHost) _flowHost.style.display = 'none';
    }
    // Mismo principio para el workflow-canvas: oculto excepto en su tab.
    if (tab !== 'workflow') {
        const _wcHost = document.getElementById('workflow-canvas-host');
        if (_wcHost) _wcHost.style.display = 'none';
    }

    // Update every duplicated tab bar across the 4 Qhatu sections so they stay in sync.
    document.querySelectorAll('.kipu-top-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.kipuTab === tab);
    });

    // Sync el título del header (#form-title) con la tab activa. Default
    // "Configuración" cubre el tab oculto `config` y cualquier flow legacy.
    const titleEl = document.getElementById('form-title');
    if (titleEl) {
        const titlesByTab = {
            workflow: 'Workflow',
            'editor-flujo': 'Flujo de Conversación',
            tester:   'Prueba tu Willy',
            config:   'Configuración',
        };
        titleEl.textContent = titlesByTab[tab] || titleEl.textContent;
    }
    const subEl = document.getElementById('kipu-form-subtitle');
    if (subEl) {
        // Workflow / Config / Tester: sin subtítulo (pedido del cliente —
        // los sub-tabs ya no muestran texto explicativo en el header, sólo
        // el título grande).
        subEl.textContent = '';
    }

    // Persist the active tab in the URL hash so a hard refresh restores the
    // user's exact view (was: refresh kicked them back to "Tiendas"). Format:
    // #mikipu/<tab>. Skip writing the hash for the `crea` default to keep the
    // URL clean when the user is on the landing tab.
    try {
        const validTabs = ['crea', 'config', 'workflow', 'editor-flujo', 'inventario', 'envios', 'tester'];
        if (validTabs.includes(tab)) {
            const newHash = tab === 'crea' ? '' : `#mikipu/${tab}`;
            const cleanPath = window.location.pathname + window.location.search;
            const target = cleanPath + newHash;
            if (window.location.hash !== newHash || window.location.search !== '') {
                history.replaceState(null, '', target);
            }
        }
    } catch (_) { /* ignore — non-critical */ }

    const setActiveSection = (id) => {
        document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
        const el = document.getElementById(id);
        if (el) el.classList.add('active');
        const mainContent = document.querySelector('.main-content');
        if (mainContent) mainContent.scrollTop = 0;
    };

    if (tab === 'crea') {
        setActiveSection('section-crear-tienda');
        if (typeof window.syncSidebarNav === 'function') window.syncSidebarNav('create-bot');
        if (typeof loadStoresList === 'function') loadStoresList();
    } else if (tab === 'inventario') {
        setActiveSection('section-inventory');
        if (typeof window.syncSidebarNav === 'function') window.syncSidebarNav('catalogo');
        if (typeof populateInventoryBotSelector === 'function') populateInventoryBotSelector();
    } else if (tab === 'envios') {
        setActiveSection('section-envios');
        if (typeof window.syncSidebarNav === 'function') window.syncSidebarNav('envios');
        if (typeof populateEnviosBotSelector === 'function') populateEnviosBotSelector();
    } else {
        // 'config', 'workflow' o 'tester' — los 3 viven en section-create-bot
        setActiveSection('section-create-bot');
        if (typeof window.syncSidebarNav === 'function') window.syncSidebarNav('create-bot');
        // Setea el atributo `data-active-subtab` en la sección — el CSS de
        // styles.css usa este atributo con !important para mostrar/ocultar
        // wizardCard vs configurator, venciendo cualquier inline style que
        // funciones async (initMayaChat, wizLoadSelectedBot) puedan setear.
        const sectionEl = document.getElementById('section-create-bot');
        if (sectionEl) sectionEl.setAttribute('data-active-subtab', tab);

        const panelConfig = document.getElementById('mi-kipu-config-panel');
        const panelTester = document.getElementById('mi-kipu-tester-panel');
        const sidebar = document.querySelector('.maya-sidebar');
        const configurator = document.getElementById('maya-chat-configurator');
        const wizardCard = document.getElementById('onboarding-wizard-card');

        if (tab === 'config') {
            // CONFIGURACIÓN — wizard de pasos (identidad, productos, envíos,
            // pagos, modo interacción). El usuario puede re-editar cualquier
            // paso desde acá. Forzamos hide del configurator + show del wizard
            // ANTES de hacer cualquier cosa async para evitar flicker.
            if (panelTester) panelTester.style.display = 'none';
            if (panelConfig) panelConfig.style.display = 'flex';
            if (sidebar) sidebar.style.display = 'flex';
            // Force-hide del mindmap container con `setProperty` + !important
            // para vencer cualquier CSS rule de `#section-create-bot.active
            // #maya-chat-configurator { ... }` que pueda estar pisando.
            if (configurator) configurator.style.setProperty('display', 'none', 'important');
            if (wizardCard) wizardCard.style.setProperty('display', 'flex', 'important');

            // wizLoadSelectedBot determina el estado real del onboarding
            // y llama a showOnboardingStep. No hacemos nada aquí.
        } else if (tab === 'editor-flujo') {
            // EDITOR DE FLUJO — editor dual-pane (editor + preview WhatsApp).
            // Oculta configurator/mindmap y wizard; muestra solo el host del flow-editor.
            // `display: flex` (no block) para que el host sea flex item del
            // section flex column y reciba altura del padre.
            if (configurator) configurator.style.setProperty('display', 'none', 'important');
            if (wizardCard) wizardCard.style.setProperty('display', 'none', 'important');
            const flowHost = document.getElementById('flow-editor-host');
            if (flowHost) flowHost.style.display = 'flex';
            if (typeof window.initFlowEditor === 'function') {
                window.initFlowEditor();
            }
        } else if (tab === 'workflow') {
            // WORKFLOW — canvas editorial con sections + nodes + arrows.
            // Reemplaza el cytoscape mindmap antiguo. El host es un flex item
            // del section flex column para recibir altura del padre.
            const flowHost = document.getElementById('flow-editor-host');
            if (flowHost) flowHost.style.display = 'none';
            if (configurator) configurator.style.setProperty('display', 'none', 'important');
            if (wizardCard) wizardCard.style.setProperty('display', 'none', 'important');
            const wcHost = document.getElementById('workflow-canvas-host');
            if (wcHost) wcHost.style.display = 'flex';
            if (typeof window.initWorkflowCanvas === 'function') {
                window.initWorkflowCanvas();
            }
            return; // skip el viejo init del mindmap
        } else if (tab === 'workflow-legacy-mindmap') {
            // ─── BLOQUE LEGACY (no se usa, preservado por si hay que volver al
            //     mindmap cytoscape) ──────────────────────────────────────
            if (panelConfig) panelConfig.style.display = 'flex';
            if (panelTester) panelTester.style.display = 'none';
            if (sidebar) sidebar.style.display = 'flex';
            if (configurator) configurator.style.setProperty('display', 'flex', 'important');
            if (wizardCard) wizardCard.style.setProperty('display', 'none', 'important');

            // Mount/re-mount del mindmap si hace falta. initKipuMindmap
            // verifica state.cy + DOM real antes de re-montar.
            //
            // Resolución del botId (con fallbacks): antes solo leíamos
            // window.mayaCurrentBotId, que se setea en initMayaChat (sub-tab
            // "Configuración"). Como esa sub-tab quedó oculta, el usuario
            // puede entrar directo a Workflow sin haber pasado por Config,
            // dejando mayaCurrentBotId null → el mindmap no montaba.
            // Fallback en orden: variable global → dropdown bot-select →
            // primer bot del caché.
            let botId = window.mayaCurrentBotId;
            if (!botId) {
                const sel = document.getElementById('edit-bot-select');
                if (sel && sel.value) botId = sel.value;
            }
            const mountMindmap = (resolvedBotId) => {
                if (!resolvedBotId) {
                    console.warn('[mindmap] no botId resolvable — skipping mount');
                    return;
                }
                window.mayaCurrentBotId = resolvedBotId;
                const gate = document.getElementById('kipu-product-gate');
                if (gate) gate.classList.add('hidden');
                const welcome = document.getElementById('kipu-welcome-screen');
                if (welcome) welcome.classList.remove('hidden');
                const host = document.getElementById('kipu-mindmap-host');
                if (!host || typeof initKipuMindmap !== 'function') return;
                // Sincronizar estado del mindmap con la tienda seleccionada.
                const mmState = window._kipuMindmapState;
                if (typeof window.kipuInvalidateMindmapForBotSwitch === 'function'
                    && String(mmState?.botId || '') !== String(resolvedBotId)) {
                    window.kipuInvalidateMindmapForBotSwitch(resolvedBotId);
                } else {
                    window._kipuMindmapMountedFor = null;
                }
                // Esperar a que el browser pinte el host con dimensiones reales
                // antes de inicializar cytoscape. Si init corre mientras el
                // configurator está display:none o el welcome.hidden, cytoscape
                // mide 0x0 y los nodos quedan agrupados en (0,0) invisibles.
                // Doble RAF garantiza que CSS + layout estén aplicados.
                requestAnimationFrame(() => requestAnimationFrame(() => {
                    const rect = host.getBoundingClientRect();
                    console.log('[mindmap] mounting — host size:', rect.width, 'x', rect.height, 'bot:', resolvedBotId);
                    if (rect.width < 50 || rect.height < 50) {
                        console.warn('[mindmap] host has 0 dimensions, forcing visibility');
                        // Fallback: forzar size en el host si el flex parent no resolvió altura.
                        host.style.minHeight = '600px';
                    }
                    initKipuMindmap(resolvedBotId)
                        .then(() => {
                            window._kipuMindmapMountedFor = resolvedBotId;
                            if (typeof window.refreshMindmapDemoBanner === 'function') {
                                window.refreshMindmapDemoBanner();
                            }
                            // Re-medir y fit tras un tick — cytoscape a veces
                            // tarda en darse cuenta del tamaño del container.
                            setTimeout(() => {
                                try {
                                    const st = window._kipuMindmapState;
                                    if (st && st.cy) {
                                        st.cy.resize();
                                        st.cy.fit(undefined, 60);
                                        console.log('[mindmap] post-mount resize done — elements:', st.cy.elements().length);
                                    }
                                } catch (_) {}
                            }, 100);
                        })
                        .catch(e => console.warn('[mindmap] mount failed:', e));
                }));
            };
            if (botId) {
                mountMindmap(botId);
            } else if (typeof getCachedBots === 'function') {
                // Caché async: intentar obtener el primer bot del usuario.
                getCachedBots()
                    .then(bots => {
                        if (Array.isArray(bots) && bots.length > 0) {
                            mountMindmap(bots[0]._id || bots[0].id);
                        } else {
                            console.warn('[mindmap] no bots disponibles para montar workflow');
                        }
                    })
                    .catch(e => console.warn('[mindmap] failed to resolve botId:', e));
            }
        } else {
            // 'tester' — sandbox para probar el bot
            if (configurator) configurator.style.display = 'flex';
            if (wizardCard) wizardCard.style.display = 'none';
            if (panelTester) panelTester.style.display = 'flex';
            if (panelConfig) panelConfig.style.display = 'none';
            if (sidebar) sidebar.style.display = 'none';

            const select = document.getElementById('edit-bot-select');
            let botName = 'Mi Qhatu';
            let botId = window.mayaCurrentBotId || '';
            if (select && select.selectedIndex >= 0) {
                botName = select.options[select.selectedIndex].text;
                if (botName === 'Selecciona un Qhatu') botName = 'Mi Qhatu';
                if (select.value) botId = select.value;
            }
            const h3 = document.getElementById('tester-bot-name');
            if (h3) h3.innerText = botName;
            const hist = document.getElementById('tester-chat-history');
            if (hist) hist.scrollTop = hist.scrollHeight;

            // Mensajes de prueba sugeridos dinámicos — usan productos /
            // pagos / envíos REALES configurados en la tienda activa.
            // Fallback genérico mientras carga; no falla si no hay botId.
            populateTesterSuggestions(botId);
        }
    }
};

// Backward-compatible alias for any legacy callers of the old function name.
window.switchMiKipuTab = function(tab) { return window.switchKipuTab(tab); };

window.testerResetChat = async function() {
    const botId = document.getElementById('bot-id').value;
    if (!botId) return;
    
    if(!confirm('¿Estás seguro que deseas reiniciar la conversación de prueba?')) return;
    
    try {
        const token = localStorage.getItem('token');
        await fetch(`${API_URL}/bots/${botId}/test-chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ reset: true })
        });
        
        // Clear UI — conservar divisor "INICIO DE LA PRUEBA" y pantalla de bienvenida
        const hist = document.getElementById('tester-chat-history');
        const marker = document.getElementById('tester-start-marker');
        const welcome = document.getElementById('tester-welcome-screen');
        if (hist) {
            while (hist.firstChild) hist.removeChild(hist.firstChild);
            if (marker) hist.appendChild(marker);
            if (welcome) {
                welcome.style.display = 'flex';
                hist.appendChild(welcome);
            }
        }
        
    } catch (err) {
        console.error('Error resetting test chat', err);
    }
};

window.testerSimulateReceipt = function() {
    sendTesterMessage('', true);
};

window.handleTesterChatKeydown = function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendTesterMessage();
    }
};

// ─── Parser de opciones numeradas en el tester ──────────────────────────
// Espejo del backend (src/services/whatsapp-buttons.service.ts) — busca
// en el texto de respuesta del bot un bloque tipo:
//   "<pregunta>
//
//    1. Opción A
//    2. Opción B
//
//    <cierre>"
// y devuelve { body, footer, buttons[] } o null si no aplica. Cuando
// devuelve un objeto, el tester renderiza botones clicables (igual a como
// WhatsApp moderno renderiza el InteractiveMessage real).
function testerParseNumberedOptions(text) {
    text = text.replace(/[\u200B-\u200F\u2060-\u2064\uFEFF]/g, "");
    if (!text || typeof text !== 'string') return null;
    const lines = text.split(/\r?\n/);
    const optionRegex = /^\s*(\d{1,2})[\.\)\-]\s+(.+?)\s*$/;
    const hits = [];
    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(optionRegex);
        if (m) hits.push({ lineIdx: i, num: parseInt(m[1], 10), text: m[2].trim() });
    }
    if (hits.length < 1) return null;
    // Deben ser consecutivas empezando en 1.
    for (let i = 0; i < hits.length; i++) {
        if (hits[i].num !== i + 1) return null;
    }
    const firstOptIdx = hits[0].lineIdx;
    const lastOptIdx  = hits[hits.length - 1].lineIdx;
    const bodyLines = lines.slice(0, firstOptIdx).filter(l => l.trim().length > 0);
    const footerLines = lines.slice(lastOptIdx + 1).filter(l => l.trim().length > 0);
    const body = bodyLines.join('\n').trim();
    if (!body) return null;
    return {
        body,
        footer: footerLines.join('\n').trim(),
        buttons: hits.map(h => ({ text: h.text }))
    };
}

// Escapa HTML antes de meterlo en innerHTML — text del LLM puede tener
// caracteres como < > & que romperían el render.
function testerEscapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Construye el HTML del bubble del bot. Si el texto trae opciones numeradas
// y el modo es 'botones', renderiza botones reales clicables. Si no, texto
// plano con saltos de línea.
function testerBuildBotBubbleHtml(text, mode) {
    const parsed = (mode === 'botones') ? testerParseNumberedOptions(text) : null;
    if (!parsed) {
        return testerEscapeHtml(text).replace(/\n/g, '<br>');
    }
    // Pregunta + footer en texto, opciones como botones clicables.
    const bodyHtml = testerEscapeHtml(parsed.body).replace(/\n/g, '<br>');
    const footerHtml = parsed.footer
        ? `<div style="font-size:11.5px;color:#667781;font-style:italic;margin-top:8px;line-height:1.3;">${testerEscapeHtml(parsed.footer).replace(/\n/g, '<br>')}</div>`
        : '';
    const buttonsHtml = parsed.buttons.map(b => {
        const safeText = testerEscapeHtml(b.text);
        return `<button type="button" class="tester-wa-btn"
            onclick="sendTesterMessage('${safeText.replace(/'/g, "\\'")}'); event.stopPropagation();"
            style="display:block;width:100%;padding:10px 12px;margin:0;background:transparent;border:none;border-top:1px solid rgba(0,0,0,0.08);color:#027EB5;font-size:13.5px;font-weight:500;text-align:center;cursor:pointer;font-family:inherit;line-height:1.3;transition:background 120ms ease;"
            onmouseenter="this.style.background='rgba(2,126,181,0.06)'"
            onmouseleave="this.style.background='transparent'">${safeText}</button>`;
    }).join('');
    return `
        <div>${bodyHtml}</div>
        ${footerHtml}
        <div style="margin:10px -12px -10px;border-radius:0 0 8px 8px;overflow:hidden;background:#FFFFFF;">${buttonsHtml}</div>
    `;
}

// Lee el modo de interacción configurado del bot. Cache simple para no
// pegarle al endpoint en cada mensaje. Se invalida al recargar el bot
// (el tester live-reloadea cuando cambias config).
let _testerModeCache = { botId: null, mode: 'botones', expires: 0 };
async function testerGetInteractionMode(botId) {
    const now = Date.now();
    if (_testerModeCache.botId === botId && _testerModeCache.expires > now) {
        return _testerModeCache.mode;
    }
    try {
        const token = localStorage.getItem('token');
        const resp = await fetch(`${API_URL}/bots`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const bots = await resp.json().catch(() => []);
        const bot = Array.isArray(bots) ? bots.find(b => b._id === botId) : null;
        const raw = (bot?.operacion?.interactionMode || '').toString().toLowerCase();
        const mode = raw === 'conversacional' ? 'conversacional' : 'botones';
        _testerModeCache = { botId, mode, expires: now + 30_000 };
        return mode;
    } catch (_) {
        return 'botones';
    }
}
window.invalidateTesterModeCache = function() {
    _testerModeCache = { botId: null, mode: 'botones', expires: 0 };
};

window.sendTesterMessage = async function(overrideText = '', simulateReceipt = false) {
    const botId = document.getElementById('bot-id').value;
    if (!botId) {
        alert('Selecciona o crea un Qhatu primero.');
        return;
    }

    const input = document.getElementById('tester-chat-input');
    const text = overrideText || input.value.trim();

    if (!text && !simulateReceipt) return;

    const hist = document.getElementById('tester-chat-history');
    if (!hist) return;

    // Cuando el usuario "tappea" un botón previo, deshabilitamos los botones
    // de bubbles anteriores — en WhatsApp real una vez que respondes a un
    // mensaje interactivo, los botones quedan inertes.
    hist.querySelectorAll('.tester-wa-btn').forEach(b => {
        b.disabled = true;
        b.style.cursor = 'default';
        b.style.opacity = '0.55';
        b.style.pointerEvents = 'none';
    });

    // Hide welcome if visible
    const welcome = document.getElementById('tester-welcome-screen');
    if (welcome && welcome.style.display !== 'none') {
        welcome.style.display = 'none';
    }

    // Add User Bubble (WhatsApp style)
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
    const userBubble = document.createElement('div');
    userBubble.className = 'maya-bubble maya-bubble-user';
    userBubble.setAttribute('data-time', timeStr);
    userBubble.setAttribute('data-caption', 'Tú');
    if(simulateReceipt) {
        userBubble.innerHTML = `<span style="display:flex;align-items:center;gap:0.4rem;">🖼️ <i>*Comprobante de pago enviado*</i></span>`;
    } else {
        userBubble.innerText = text;
    }
    hist.appendChild(userBubble);

    if(!overrideText) {
        input.value = '';
        input.style.height = 'auto'; // autogrow reset
    }

    // Add Loader
    const loaderId = 'tester-loader-' + Date.now();
    const loader = document.createElement('div');
    loader.className = 'maya-bubble maya-bubble-bot maya-tester-loader-bubble';
    loader.id = loaderId;
    loader.innerHTML = `<div class="maya-typing">
        <span class="maya-dot"></span><span class="maya-dot"></span><span class="maya-dot"></span>
    </div>`;
    hist.appendChild(loader);
    hist.scrollTop = hist.scrollHeight;

    // Block Send Button
    const sendBtn = document.getElementById('tester-chat-send');
    if (sendBtn) sendBtn.disabled = true;

    try {
        const token = localStorage.getItem('token');
        const [resp, mode] = await Promise.all([
            fetch(`${API_URL}/bots/${botId}/test-chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    text: text,
                    simulateReceipt: simulateReceipt
                })
            }),
            testerGetInteractionMode(botId)
        ]);

        const data = await resp.json();

        const loaderEl = document.getElementById(loaderId);
        if (loaderEl) loaderEl.remove();

        if (resp.ok && data.success) {
            const botBubble = document.createElement('div');
            botBubble.className = 'maya-bubble maya-bubble-bot';
            const respTime = new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
            botBubble.setAttribute('data-time', respTime);
            botBubble.setAttribute('data-caption', 'Respuesta del bot');
            // Si el modo es 'botones' y la respuesta tiene opciones numeradas
            // parseables, renderiza botones clicables igual que WhatsApp real.
            // Sino, texto plano con saltos de línea.
            botBubble.innerHTML = testerBuildBotBubbleHtml(data.response || '', mode);
            hist.appendChild(botBubble);
        } else {
            console.error('Test chat error', data);
            const errBubble = document.createElement('div');
            errBubble.className = 'maya-bubble maya-bubble-bot';
            errBubble.setAttribute('data-caption', 'Respuesta del bot');
            errBubble.setAttribute('data-time', new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}));
            errBubble.style.color = '#ef4444';
            errBubble.innerText = 'Oops: ' + (data.error || 'Error de conexión');
            hist.appendChild(errBubble);
        }

    } catch (e) {
        const loaderEl = document.getElementById(loaderId);
        if (loaderEl) loaderEl.remove();
        console.error(e);
        const errBubble = document.createElement('div');
        errBubble.className = 'maya-bubble maya-bubble-bot';
        errBubble.setAttribute('data-caption', 'Respuesta del bot');
        errBubble.setAttribute('data-time', new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}));
        errBubble.style.color = '#ef4444';
        errBubble.innerText = 'Error al enviar de prueba.';
        hist.appendChild(errBubble);
    }

    if (sendBtn) sendBtn.disabled = false;
    hist.scrollTop = hist.scrollHeight;
};


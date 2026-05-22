/* ═══════════════════════════════════════════
   VENDEDOR AI — 4-Tab Wizard Logic
   ═══════════════════════════════════════════ */

// ─── State ───
window.wizKBTopics = [];
window.wizDeliveryZones = [];
window.wizPaymentMethods = [];
window.wizPayImages = [];
window.wizWelcomeFiles = [];
window.wizSelectedGender = 'no_especificado';
window.wizSelectedEmojis = [];

// ─── Tab Navigation ───
window.wizSwitchTab = function(tabName) {
    document.querySelectorAll('.wiz-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.wiz-tab-panel').forEach(p => p.classList.remove('active'));
    const tab = document.querySelector(`.wiz-tab[data-tab="${tabName}"]`);
    const panel = document.querySelector(`.wiz-tab-panel[data-panel="${tabName}"]`);
    if (tab) tab.classList.add('active');
    if (panel) panel.classList.add('active');
};

// ─── Gender Selection ───
window.wizSelectGender = function(btn, value) {
    document.querySelectorAll('#wiz-gender-group .wiz-btn-option').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    window.wizSelectedGender = value;
};

// ─── Char Counter ───
window.wizUpdateCounter = function(textarea, counterId, max) {
    const counter = document.getElementById(counterId);
    if (counter) counter.textContent = `${textarea.value.length}/${max}`;
};

// ─── 5-Point Slider ───
window.wizUpdateSliderNew = function(input) {
    const val = parseInt(input.value);
    const percent = ((val - 1) / 4) * 100;
    input.style.setProperty('--slider-progress', percent + '%');
    input.style.background = `linear-gradient(to right, var(--wiz-primary) 0%, var(--wiz-primary) ${percent}%, #F0F0F2 ${percent}%, #F0F0F2 100%)`;
    const labels = input.closest('.wiz-slider-group').querySelectorAll('.wiz-slider-labels span');
    labels.forEach((l, i) => {
        l.classList.toggle('active', i === val - 1);
    });
};

// ─── Toggle Emoji Selection ───
window.wizToggleEmoji = function(btn) {
    btn.classList.toggle('selected');
    const emoji = btn.textContent.trim();
    if (btn.classList.contains('selected')) {
        if (!window.wizSelectedEmojis.includes(emoji)) window.wizSelectedEmojis.push(emoji);
    } else {
        window.wizSelectedEmojis = window.wizSelectedEmojis.filter(e => e !== emoji);
    }
};

// ─── Tag Input System ───
window.wizHandleTagKey = function(event, wrapId) {
    if (event.key === 'Enter' || event.key === ',') {
        event.preventDefault();
        const input = event.target;
        const value = input.value.replace(/,/g, '').trim();
        if (!value) return;
        const wrap = document.getElementById(wrapId);
        const tag = document.createElement('span');
        tag.className = 'wiz-tag';
        tag.innerHTML = `${value} <button type="button" class="wiz-tag-remove" onclick="this.parentElement.remove()">×</button>`;
        wrap.insertBefore(tag, input);
        input.value = '';
    }
};

window.wizGetTags = function(wrapId) {
    const wrap = document.getElementById(wrapId);
    if (!wrap) return [];
    return Array.from(wrap.querySelectorAll('.wiz-tag')).map(t => {
        const clone = t.cloneNode(true);
        const btn = clone.querySelector('button');
        if (btn) btn.remove();
        return clone.textContent.trim();
    });
};

// ─── Welcome Files ───
window.wizHandleWelcomeFiles = function(fileList) {
    const files = Array.from(fileList);
    window.wizWelcomeFiles.push(...files);
    wizRenderWelcomeFiles();
};

function wizRenderWelcomeFiles() {
    const container = document.getElementById('wiz-welcome-previews');
    if (!container) return;
    container.innerHTML = '';
    window.wizWelcomeFiles.forEach((f, i) => {
        const el = document.createElement('div');
        el.className = 'wiz-file-preview';
        el.innerHTML = `📄 ${f.name.substring(0, 20)}${f.name.length > 20 ? '...' : ''} <button class="remove-file" onclick="wizRemoveWelcomeFile(${i})">✕</button>`;
        container.appendChild(el);
    });
}

window.wizRemoveWelcomeFile = function(i) {
    window.wizWelcomeFiles.splice(i, 1);
    wizRenderWelcomeFiles();
};

// ─── KB Topics ───
window.wizOpenKBModal = function() {
    document.getElementById('wiz-kb-modal').classList.add('open');
    document.getElementById('wiz-kb-topic').value = '';
    document.getElementById('wiz-kb-desc').value = '';
    document.getElementById('wiz-kb-category').value = 'productos';
    const previews = document.getElementById('wiz-kb-media-previews');
    if (previews) previews.innerHTML = '';
    setTimeout(() => document.getElementById('wiz-kb-topic').focus(), 200);
};

window.wizCloseKBModal = function() {
    document.getElementById('wiz-kb-modal').classList.remove('open');
};

window.wizAddKBTopic = function() {
    const topic = document.getElementById('wiz-kb-topic').value.trim();
    if (!topic) { showToast('El tema es requerido', 'error'); return; }
    const desc = document.getElementById('wiz-kb-desc').value.trim();
    const category = document.getElementById('wiz-kb-category').value;
    window.wizKBTopics.push({ id: Date.now(), topic, desc, category });
    wizCloseKBModal();
    wizRenderKBTopics();
};

window.wizRemoveKBTopic = function(id) {
    window.wizKBTopics = window.wizKBTopics.filter(t => t.id !== id);
    wizRenderKBTopics();
};

window.wizFilterKB = function(cat, btn) {
    document.querySelectorAll('#wiz-kb-filters .wiz-filter-chip').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    wizRenderKBTopics(cat);
};

function wizRenderKBTopics(filter) {
    const list = document.getElementById('wiz-kb-list');
    const empty = document.getElementById('wiz-kb-empty');
    if (!list) return;
    const topics = filter && filter !== 'todas'
        ? window.wizKBTopics.filter(t => t.category === filter)
        : window.wizKBTopics;
    list.innerHTML = '';
    if (topics.length === 0) {
        list.innerHTML = `<div class="wiz-kb-empty" id="wiz-kb-empty"><div class="wiz-kb-empty-icon">📋</div><p class="wiz-kb-empty-text">No hay temas</p></div>`;
        return;
    }
    const catIcons = { productos:'📦', horarios:'🕐', envios:'🚚', pagos:'💳', devoluciones:'🔄', otros:'ℹ️' };
    topics.forEach(t => {
        const card = document.createElement('div');
        card.className = 'wiz-kb-card';
        card.dataset.category = t.category;
        card.innerHTML = `
            <div class="wiz-kb-card-body">
                <div class="wiz-kb-card-topic">${t.topic}</div>
                ${t.desc ? `<div class="wiz-kb-card-desc">${t.desc}</div>` : ''}
                <span class="wiz-kb-card-cat">${catIcons[t.category] || '📋'} ${t.category}</span>
            </div>
            <div class="wiz-kb-card-actions">
                <button class="delete-btn" onclick="wizRemoveKBTopic(${t.id})" title="Eliminar">🗑️</button>
            </div>`;
        list.appendChild(card);
    });
}

// ─── Delivery Zones ───
let wizZoneCounter = 0;

window.wizAddZone = function() {
    wizZoneCounter++;
    const id = wizZoneCounter;
    window.wizDeliveryZones.push({ id, name: '', prePayment: false, cod: false, coverage: [], partialPay: false, options: [] });
    wizRenderZones();
};

window.wizRemoveZone = function(id) {
    window.wizDeliveryZones = window.wizDeliveryZones.filter(z => z.id !== id);
    wizRenderZones();
};

window.wizAddShippingOption = function(zoneId) {
    const zone = window.wizDeliveryZones.find(z => z.id === zoneId);
    if (!zone) return;
    zone.options.push({ id: Date.now(), name: '', price: '', desc: '' });
    wizRenderZones();
};

window.wizRemoveShippingOption = function(zoneId, optId) {
    const zone = window.wizDeliveryZones.find(z => z.id === zoneId);
    if (!zone) return;
    zone.options = zone.options.filter(o => o.id !== optId);
    wizRenderZones();
};

function wizRenderZones() {
    const container = document.getElementById('wiz-zones-list');
    if (!container) return;
    container.innerHTML = '';
    window.wizDeliveryZones.forEach(zone => {
        const card = document.createElement('div');
        card.className = 'wiz-zone-card';
        card.innerHTML = `
            <div class="wiz-zone-card-header">
                <span class="wiz-zone-card-title">📍 Zona de entrega</span>
                <button class="wiz-zone-remove" onclick="wizRemoveZone(${zone.id})">✕</button>
            </div>
            <div class="wiz-field">
                <label class="wiz-label">Nombre de la zona</label>
                <input type="text" class="wiz-input" value="${zone.name}" placeholder="Ej: Lima Centro" onchange="wizUpdateZone(${zone.id},'name',this.value)">
            </div>
            <div class="wiz-field">
                <label class="wiz-label">Tipos de pago</label>
                <div style="display:flex;gap:1rem;">
                    <div class="wiz-toggle-wrap" style="flex:1;padding:0.5rem 0">
                        <span class="wiz-toggle-label" style="font-size:0.85rem">Pago por adelantado</span>
                        <label class="wiz-toggle"><input type="checkbox" ${zone.prePayment ? 'checked' : ''} onchange="wizUpdateZone(${zone.id},'prePayment',this.checked)"><span class="wiz-toggle-slider"></span></label>
                    </div>
                    <div class="wiz-toggle-wrap" style="flex:1;padding:0.5rem 0">
                        <span class="wiz-toggle-label" style="font-size:0.85rem">Contraentrega</span>
                        <label class="wiz-toggle"><input type="checkbox" ${zone.cod ? 'checked' : ''} onchange="wizUpdateZone(${zone.id},'cod',this.checked)"><span class="wiz-toggle-slider"></span></label>
                    </div>
                </div>
            </div>
            <div class="wiz-field">
                <label class="wiz-label">Zonas de cobertura <span class="char-counter">${zone.coverage.length}/20</span></label>
                <div class="wiz-tag-input-wrap" id="wiz-zone-coverage-${zone.id}" onclick="this.querySelector('input').focus()">
                    ${zone.coverage.map(c => `<span class="wiz-tag">${c} <button type="button" class="wiz-tag-remove" onclick="wizRemoveZoneCoverage(${zone.id},'${c}')">×</button></span>`).join('')}
                    <input type="text" class="wiz-tag-field" placeholder="Miraflores, San Isidro, Barranco..." onkeydown="wizHandleZoneCoverageTag(event,${zone.id})">
                </div>
                <p class="wiz-hint">Presiona Enter para agregar (máx 20 zonas)</p>
            </div>
            <div class="wiz-toggle-wrap">
                <span class="wiz-toggle-label">Habilitar pagos parciales</span>
                <label class="wiz-toggle"><input type="checkbox" ${zone.partialPay ? 'checked' : ''} onchange="wizUpdateZone(${zone.id},'partialPay',this.checked)"><span class="wiz-toggle-slider"></span></label>
            </div>
            <div class="wiz-field" style="margin-top:1rem">
                <label class="wiz-label">Opciones de envío</label>
                <table class="wiz-shipping-table">
                    <thead><tr><th>Nombre</th><th>Precio</th><th>Descripción</th><th></th></tr></thead>
                    <tbody>
                        ${zone.options.map(opt => `<tr>
                            <td><input value="${opt.name}" placeholder="Ej: Express" onchange="wizUpdateShipOpt(${zone.id},${opt.id},'name',this.value)"></td>
                            <td><input value="${opt.price}" placeholder="S/ 0.00" onchange="wizUpdateShipOpt(${zone.id},${opt.id},'price',this.value)"></td>
                            <td><input value="${opt.desc}" placeholder="Descripción" onchange="wizUpdateShipOpt(${zone.id},${opt.id},'desc',this.value)"></td>
                            <td><button class="remove-row" onclick="wizRemoveShippingOption(${zone.id},${opt.id})">✕</button></td>
                        </tr>`).join('')}
                    </tbody>
                </table>
                <button type="button" class="wiz-btn-add wiz-btn-add-sm" style="margin-top:0.75rem" onclick="wizAddShippingOption(${zone.id})">+ Agregar opción</button>
            </div>`;
        container.appendChild(card);
    });
}

window.wizUpdateZone = function(id, key, value) {
    const zone = window.wizDeliveryZones.find(z => z.id === id);
    if (zone) zone[key] = value;
};

window.wizUpdateShipOpt = function(zoneId, optId, key, value) {
    const zone = window.wizDeliveryZones.find(z => z.id === zoneId);
    if (!zone) return;
    const opt = zone.options.find(o => o.id === optId);
    if (opt) opt[key] = value;
};

window.wizHandleZoneCoverageTag = function(event, zoneId) {
    if (event.key === 'Enter' || event.key === ',') {
        event.preventDefault();
        const input = event.target;
        const value = input.value.replace(/,/g, '').trim();
        if (!value) return;
        const zone = window.wizDeliveryZones.find(z => z.id === zoneId);
        if (!zone || zone.coverage.length >= 20) return;
        zone.coverage.push(value);
        input.value = '';
        wizRenderZones();
    }
};

window.wizRemoveZoneCoverage = function(zoneId, cov) {
    const zone = window.wizDeliveryZones.find(z => z.id === zoneId);
    if (!zone) return;
    zone.coverage = zone.coverage.filter(c => c !== cov);
    wizRenderZones();
};

// ─── Payment Methods ───
let wizPayCounter = 0;
let wizClausulaCounter = 0;

// Estructura inicial de pagos parciales por método.
// Spec Qhatu: deshabilitado por default; cuando se activa, debe configurarse al
// menos la distribución por defecto. Las cláusulas condicionales son opcionales.
function __wizDefaultPartialPayments() {
    return {
        enabled: false,
        distribucion: {
            tipo: 'porcentual',     // 'porcentual' | 'monto_fijo'
            adelanto_pct: 50,
            adelanto_monto: 0
        },
        clausulas: []
    };
}

window.wizAddPaymentMethod = function() {
    wizPayCounter++;
    window.wizPaymentMethods.push({
        id: wizPayCounter,
        active: true,
        name: '',
        type: 'transferencia',
        instructions: '',
        partial_payments: __wizDefaultPartialPayments()
    });
    wizRenderPayMethods();
};

window.wizRemovePayMethod = function(id) {
    window.wizPaymentMethods = window.wizPaymentMethods.filter(m => m.id !== id);
    wizRenderPayMethods();
};

// ─── Pagos parciales: handlers ───
window.wizPartialToggle = function(methodId, enabled) {
    const m = window.wizPaymentMethods.find(x => x.id === methodId);
    if (!m) return;
    if (!m.partial_payments) m.partial_payments = __wizDefaultPartialPayments();
    m.partial_payments.enabled = !!enabled;
    wizRenderPayMethods();
};

window.wizPartialDistTipo = function(methodId, tipo) {
    const m = window.wizPaymentMethods.find(x => x.id === methodId);
    if (!m?.partial_payments) return;
    m.partial_payments.distribucion.tipo = tipo;
    wizRenderPayMethods();
};

window.wizPartialDistVal = function(methodId, key, value) {
    const m = window.wizPaymentMethods.find(x => x.id === methodId);
    if (!m?.partial_payments) return;
    const num = parseFloat(value) || 0;
    m.partial_payments.distribucion[key] = num;
    // Re-pinta solo el helper text de "El cliente paga el X% restante"
    const card = document.querySelector(`[data-pp-method="${methodId}"]`);
    const restante = card?.querySelector('.wiz-pp-restante');
    if (restante && key === 'adelanto_pct') {
        restante.textContent = `El cliente paga el ${Math.max(0, 100 - num)}% restante al recibir el producto.`;
    }
};

window.wizPartialAddClausula = function(methodId) {
    const m = window.wizPaymentMethods.find(x => x.id === methodId);
    if (!m?.partial_payments) return;
    wizClausulaCounter++;
    m.partial_payments.clausulas.push({
        id: 'cl-' + wizClausulaCounter,
        tipo_condicion: 'monto_pedido',
        operador: '>=',
        valor: 0,
        adelanto_pct: 30
    });
    wizRenderPayMethods();
};

window.wizPartialRemoveClausula = function(methodId, clausulaId) {
    const m = window.wizPaymentMethods.find(x => x.id === methodId);
    if (!m?.partial_payments) return;
    m.partial_payments.clausulas = m.partial_payments.clausulas.filter(c => c.id !== clausulaId);
    wizRenderPayMethods();
};

window.wizPartialUpdateClausula = function(methodId, clausulaId, key, value) {
    const m = window.wizPaymentMethods.find(x => x.id === methodId);
    if (!m?.partial_payments) return;
    const cl = m.partial_payments.clausulas.find(c => c.id === clausulaId);
    if (!cl) return;
    if (key === 'tipo_condicion') {
        cl.tipo_condicion = value;
        // Reinicia operador y valor según el nuevo tipo
        if (value === 'zona_envio') {
            cl.operador = 'es';
            cl.valor = 'lima_metropolitana';
        } else {
            cl.operador = '>=';
            cl.valor = 0;
        }
        wizRenderPayMethods();  // redibuja para cambiar el control de "valor"
    } else if (key === 'adelanto_pct') {
        cl.adelanto_pct = parseFloat(value) || 0;
    } else if (key === 'valor') {
        cl.valor = cl.tipo_condicion === 'zona_envio' ? value : (parseFloat(value) || 0);
    }
};

// Renderiza el bloque de UI para "Pagos parciales" dentro de cada card de método.
function __wizRenderPartialPayments(method) {
    const pp = method.partial_payments || __wizDefaultPartialPayments();
    const id = method.id;

    // Helper que arma el control de "valor" de cada cláusula según su tipo
    const renderValorControl = (cl) => {
        if (cl.tipo_condicion === 'zona_envio') {
            return `<select class="wiz-select" style="min-width:160px;" onchange="wizPartialUpdateClausula(${id},'${cl.id}','valor',this.value)">
                <option value="lima_metropolitana" ${cl.valor === 'lima_metropolitana' ? 'selected' : ''}>Lima Metropolitana</option>
                <option value="provincia" ${cl.valor === 'provincia' ? 'selected' : ''}>Provincia</option>
            </select>`;
        }
        const placeholder = cl.tipo_condicion === 'monto_pedido' ? 'S/ 0.00' : '0';
        return `<input type="number" class="wiz-input" min="0" step="${cl.tipo_condicion === 'monto_pedido' ? '0.01' : '1'}" value="${cl.valor || 0}" placeholder="${placeholder}" style="width:120px;" oninput="wizPartialUpdateClausula(${id},'${cl.id}','valor',this.value)">`;
    };

    const operadorLabel = (cl) => cl.tipo_condicion === 'zona_envio' ? 'es' : '≥';

    const clausulasHtml = pp.clausulas.map(cl => `
        <div style="display:flex;flex-direction:column;gap:0.5rem;padding:0.75rem;border:1px solid rgba(0,0,82,0.1);border-radius:10px;background:#FAF7F0;margin-top:0.5rem;">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;">
                <span style="font-size:0.78rem;font-weight:700;color:rgba(0,0,51,0.65);text-transform:uppercase;letter-spacing:0.04em;">Cláusula</span>
                <button type="button" onclick="wizPartialRemoveClausula(${id},'${cl.id}')" style="background:transparent;border:1px solid rgba(239,68,68,0.25);color:#ef4444;width:26px;height:26px;border-radius:999px;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;justify-content:center;" title="Eliminar cláusula">✕</button>
            </div>
            <div style="display:flex;flex-wrap:wrap;align-items:center;gap:0.5rem;font-size:0.85rem;color:#000052;">
                <span style="font-weight:600;">Si</span>
                <select class="wiz-select" style="min-width:180px;" onchange="wizPartialUpdateClausula(${id},'${cl.id}','tipo_condicion',this.value)">
                    <option value="monto_pedido" ${cl.tipo_condicion === 'monto_pedido' ? 'selected' : ''}>Monto del pedido</option>
                    <option value="cantidad_productos" ${cl.tipo_condicion === 'cantidad_productos' ? 'selected' : ''}>Cantidad de productos</option>
                    <option value="zona_envio" ${cl.tipo_condicion === 'zona_envio' ? 'selected' : ''}>Zona de envío</option>
                </select>
                <span style="font-weight:600;">${operadorLabel(cl)}</span>
                ${renderValorControl(cl)}
            </div>
            <div style="display:flex;flex-wrap:wrap;align-items:center;gap:0.5rem;font-size:0.85rem;color:#000052;">
                <span style="font-weight:600;">entonces cobrar</span>
                <input type="number" class="wiz-input" min="0" max="100" step="1" value="${cl.adelanto_pct || 0}" style="width:80px;" oninput="wizPartialUpdateClausula(${id},'${cl.id}','adelanto_pct',this.value)">
                <span style="font-weight:600;">% de adelanto</span>
            </div>
        </div>
    `).join('');

    const distHtml = pp.enabled ? `
        <!-- BLOQUE 1: Distribución por defecto -->
        <div style="margin-top:0.75rem;padding:0.95rem 1rem;background:#FAF7F0;border:1px solid rgba(0,0,82,0.08);border-radius:10px;">
            <div style="font-size:0.78rem;font-weight:700;color:#000052;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:0.7rem;">Distribución por defecto</div>

            <div style="display:flex;flex-direction:column;gap:0.85rem;">
                <!-- Opción 1: Porcentual -->
                <div>
                    <label style="display:flex;align-items:center;gap:0.55rem;cursor:pointer;font-size:0.9rem;color:#000052;font-weight:600;width:fit-content;">
                        <input type="radio" name="pp-tipo-${id}" value="porcentual" ${pp.distribucion.tipo === 'porcentual' ? 'checked' : ''} onchange="wizPartialDistTipo(${id},'porcentual')" style="accent-color:#000052;width:16px;height:16px;flex-shrink:0;margin:0;">
                        <span>Porcentual</span>
                    </label>
                    ${pp.distribucion.tipo === 'porcentual' ? `
                        <div style="display:flex;align-items:center;gap:0.5rem;margin-top:0.5rem;margin-left:1.85rem;font-size:0.86rem;color:#000052;">
                            <span>Adelanto:</span>
                            <input type="number" class="wiz-input" min="1" max="99" step="1" value="${pp.distribucion.adelanto_pct || 50}" style="width:80px;padding:0.4rem 0.55rem;font-size:0.88rem;" oninput="wizPartialDistVal(${id},'adelanto_pct',this.value)">
                            <span style="font-weight:600;">%</span>
                        </div>
                    ` : ''}
                </div>

                <!-- Opción 2: Monto fijo -->
                <div>
                    <label style="display:flex;align-items:center;gap:0.55rem;cursor:pointer;font-size:0.9rem;color:#000052;font-weight:600;width:fit-content;">
                        <input type="radio" name="pp-tipo-${id}" value="monto_fijo" ${pp.distribucion.tipo === 'monto_fijo' ? 'checked' : ''} onchange="wizPartialDistTipo(${id},'monto_fijo')" style="accent-color:#000052;width:16px;height:16px;flex-shrink:0;margin:0;">
                        <span>Monto fijo</span>
                    </label>
                    ${pp.distribucion.tipo === 'monto_fijo' ? `
                        <div style="display:flex;align-items:center;gap:0.5rem;margin-top:0.5rem;margin-left:1.85rem;font-size:0.86rem;color:#000052;">
                            <span>Adelanto S/</span>
                            <input type="number" class="wiz-input" min="1" step="0.01" value="${pp.distribucion.adelanto_monto || 0}" style="width:110px;padding:0.4rem 0.55rem;font-size:0.88rem;" oninput="wizPartialDistVal(${id},'adelanto_monto',this.value)">
                        </div>
                    ` : ''}
                </div>

                ${pp.distribucion.tipo === 'porcentual'
                    ? `<p class="wiz-hint wiz-pp-restante" style="margin:0.5rem 0 0;padding-top:0.55rem;border-top:1px dashed rgba(0,0,82,0.1);">El cliente paga el ${Math.max(0, 100 - (pp.distribucion.adelanto_pct || 0))}% restante al recibir el producto.</p>`
                    : `<p class="wiz-hint" style="margin:0.5rem 0 0;padding-top:0.55rem;border-top:1px dashed rgba(0,0,82,0.1);">El cliente paga el saldo restante al recibir el producto.</p>`}
            </div>
        </div>

        <!-- BLOQUE 2: Cláusulas condicionales -->
        <div style="margin-top:0.75rem;padding:0.85rem 1rem;background:#FAF7F0;border:1px solid rgba(0,0,82,0.08);border-radius:10px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.4rem;">
                <div style="font-size:0.78rem;font-weight:700;color:#000052;text-transform:uppercase;letter-spacing:0.04em;">Cláusulas condicionales <span style="color:rgba(0,0,51,0.45);font-weight:500;text-transform:none;letter-spacing:0;">(opcional)</span></div>
            </div>
            <p class="wiz-hint" style="margin:0 0 0.5rem;">Si una cláusula se cumple, sobrescribe la distribución por defecto. Se evalúan en orden — la primera que matchee aplica.</p>
            ${clausulasHtml}
            <button type="button" onclick="wizPartialAddClausula(${id})" style="margin-top:0.6rem;width:100%;padding:0.55rem;border:1.5px dashed rgba(0,0,82,0.22);background:transparent;color:#000052;border-radius:9px;font-weight:700;font-size:0.82rem;cursor:pointer;font-family:inherit;">+ Agregar cláusula</button>
        </div>
    ` : '';

    return `
        <div data-pp-method="${id}" style="margin-top:1rem;padding-top:1rem;border-top:1px dashed rgba(0,0,51,0.12);">
            <label style="display:flex;align-items:center;gap:0.7rem;cursor:pointer;">
                <span class="wiz-toggle" style="margin:0;">
                    <input type="checkbox" ${pp.enabled ? 'checked' : ''} onchange="wizPartialToggle(${id}, this.checked)">
                    <span class="wiz-toggle-slider"></span>
                </span>
                <span style="font-weight:700;color:#000052;font-size:0.9rem;">Aceptar pagos parciales</span>
            </label>
            <p class="wiz-hint" style="margin:0.35rem 0 0 3.4rem;">Permite cobrar un adelanto al confirmar el pedido y el saldo restante al recibir.</p>
            ${distHtml}
        </div>
    `;
}

function wizRenderPayMethods() {
    const container = document.getElementById('wiz-payment-methods-list');
    if (!container) return;
    container.innerHTML = '';
    window.wizPaymentMethods.forEach(method => {
        // Asegura que métodos viejos cargados de BD tengan el campo nuevo
        if (!method.partial_payments) method.partial_payments = __wizDefaultPartialPayments();
        const card = document.createElement('div');
        card.className = 'wiz-pay-card';
        card.innerHTML = `
            <div class="wiz-pay-card-header">
                <div class="wiz-pay-card-left">
                    <span style="font-size:1.1rem;">💳</span>
                    <span class="wiz-pay-card-label">${method.name || 'Nuevo método'}</span>
                </div>
                <button class="wiz-zone-remove" onclick="wizRemovePayMethod(${method.id})">✕</button>
            </div>
            <div class="wiz-grid-2">
                <div class="wiz-field">
                    <label class="wiz-label">Nombre del método</label>
                    <input type="text" class="wiz-input" value="${method.name}" placeholder="BBVA, YAPE, Interbank, etc." onchange="wizUpdatePayMethod(${method.id},'name',this.value);this.closest('.wiz-pay-card').querySelector('.wiz-pay-card-label').textContent=this.value||'Nuevo método'">
                </div>
                <div class="wiz-field">
                    <label class="wiz-label">Tipo de método</label>
                    <select class="wiz-select" onchange="wizUpdatePayMethod(${method.id},'type',this.value)">
                        <option value="transferencia" ${method.type === 'transferencia' ? 'selected' : ''}>Transferencia bancaria</option>
                        <option value="yape_plin" ${method.type === 'yape_plin' ? 'selected' : ''}>Yape/Plin</option>
                        <option value="otro" ${method.type === 'otro' ? 'selected' : ''}>Otro</option>
                    </select>
                </div>
            </div>
            <div class="wiz-field">
                <label class="wiz-label">Instrucciones de pago</label>
                <textarea class="wiz-textarea" rows="3" onchange="wizUpdatePayMethod(${method.id},'instructions',this.value)" placeholder="Transferir al CCI 011-170-200123456789-10\nTitular: Mi Empresa SAC\nEnviar comprobante por WhatsApp">${method.instructions}</textarea>
                <p class="wiz-hint">Proporciona todos los datos necesarios para que el cliente pueda realizar el pago correctamente.</p>
            </div>
            ${__wizRenderPartialPayments(method)}`;
        container.appendChild(card);
    });
}

window.wizUpdatePayMethod = function(id, key, value) {
    const method = window.wizPaymentMethods.find(m => m.id === id);
    if (method) method[key] = value;
};

// ─── Payment Images ───
window.wizHandlePayImages = function(fileList) {
    const files = Array.from(fileList).filter(f => /^image\/(png|jpe?g)$/.test(f.type));
    if (window.wizPayImages.length + files.length > 5) {
        showToast('Máximo 5 imágenes de pago', 'error');
        return;
    }
    const oversized = files.filter(f => f.size > 5 * 1024 * 1024);
    if (oversized.length) { showToast('Cada imagen debe ser máx. 5MB', 'error'); return; }
    window.wizPayImages.push(...files);
    wizRenderPayImages();
};

function wizRenderPayImages() {
    const grid = document.getElementById('wiz-pay-images-grid');
    if (!grid) return;
    grid.innerHTML = '';
    window.wizPayImages.forEach((file, i) => {
        const url = URL.createObjectURL(file);
        const div = document.createElement('div');
        div.className = 'wiz-pay-img-preview';
        div.innerHTML = `<img src="${url}" alt="Pago"><button class="remove-img" onclick="wizRemovePayImage(${i})">✕</button>`;
        grid.appendChild(div);
    });
}

window.wizRemovePayImage = function(i) {
    window.wizPayImages.splice(i, 1);
    wizRenderPayImages();
};

// ─── Save All — Map to existing backend ───
window.wizSaveAll = async function() {
    const btn = document.getElementById('wiz-btn-save');
    const oldText = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Guardando...'; }

    try {
        const botName = document.getElementById('wiz-bot-name')?.value?.trim();
        if (!botName) { showToast('El nombre de la empresa es requerido', 'error'); throw new Error('missing botName'); }

        // Map personality tab
        const personality = {
            sellerName: document.getElementById('wiz-seller-name')?.value?.trim() || '',
            gender: window.wizSelectedGender,
            commStyle: document.getElementById('wiz-comm-style')?.value?.trim() || '',
            salesStyle: document.getElementById('wiz-sales-style')?.value?.trim() || '',
            responseLength: parseInt(document.getElementById('wiz-response-length')?.value) || 3,
            useEmojis: document.getElementById('wiz-use-emojis')?.checked ?? true,
            useSigns: document.getElementById('wiz-use-signs')?.checked ?? true,
            avoidWords: wizGetTags('wiz-avoid-words-wrap'),
            emojiPalette: window.wizSelectedEmojis,
            targetAudience: document.getElementById('wiz-target-audience')?.value?.trim() || '',
            sellerRules: document.getElementById('wiz-seller-rules')?.value?.trim() || '',
            advInstructions: document.getElementById('wiz-adv-instructions')?.value?.trim() || '',
            confirmMsg: document.getElementById('wiz-confirm-msg')?.value?.trim() || '',
            handoffSituations: wizGetTags('wiz-handoff-tags-wrap'),
            autoPause: document.getElementById('wiz-auto-pause')?.checked ?? false,
            handoffMsg: document.getElementById('wiz-handoff-msg')?.value?.trim() || ''
        };

        // Build base_conocimiento from KB topics
        const base_conocimiento = {
            fuente: 'manual',
            bloques: window.wizKBTopics.map(t => ({
                titulo: t.topic,
                contenido: t.desc,
                categoria: t.category
            }))
        };

        // Build operacion from delivery + payment tabs
        const operacion = {
            zonas: window.wizDeliveryZones.map(z => ({
                nombre: z.name,
                pago_adelantado: z.prePayment,
                contraentrega: z.cod,
                cobertura: z.coverage,
                pagos_parciales: z.partialPay,
                opciones_envio: z.options.map(o => ({ nombre: o.name, precio: o.price, descripcion: o.desc }))
            })),
            metodos_pago: window.wizPaymentMethods.filter(m => m.active).map(m => ({
                nombre: m.name,
                tipo: m.type,
                instrucciones: m.instructions,
                partial_payments: m.partial_payments || { enabled: false, distribucion: { tipo: 'porcentual', adelanto_pct: 50, adelanto_monto: 0 }, clausulas: [] }
            }))
        };

        const wizardProducts = window.wizKBTopics
            .filter(t => t.category === 'productos')
            .map(t => {
                const priceMatch = t.desc.match(/Precio:\s*(.+)/i);
                const rawPrice = priceMatch ? priceMatch[1] : '';
                const numPrice = parseFloat(rawPrice.replace(/[^\d.]/g, ''));
                return {
                    name: t.topic,
                    description: t.desc,
                    price: isNaN(numPrice) ? 0 : numPrice,
                    stock: 99, // Stock disponible por defecto
                    image: t.imageUrl || ''
                };
            });

        // Build payload compatible with existing backend
        const data = {
            botName: botName,
            description: document.getElementById('wiz-product-desc')?.value?.trim() || '',
            greeting: document.getElementById('wiz-greeting')?.value?.trim() || '¡Hola! 👋 ¿En qué puedo ayudarte?',
            products: wizardProducts, // Mapped from KB topics
            operacion: operacion,
            base_conocimiento: base_conocimiento,
            tienda: {
                nombre: botName,
                pais: document.getElementById('wiz-country')?.value || 'PE',
                descripcion: document.getElementById('wiz-product-desc')?.value?.trim() || ''
            },
            categoria_config: { personality },
            metadata: { paso_actual: 4 }
        };

        const isEditing = !!currentBotId;
        const method = isEditing ? 'PUT' : 'POST';
        const endpoint = isEditing ? `/bots/${currentBotId}` : '/bots';
        const result = await apiCall(endpoint, method, data);

        if (!isEditing) currentBotId = result._id;

        try {
            await apiCall(`/business/${currentBotId}`, 'PUT', {
                description: data.description,
                products: data.products
            });
        } catch(e) { console.error('Error saving business info', e); }

        try {
            if (typeof wizSaveShippingConfig === 'function') {
                await wizSaveShippingConfig(currentBotId);
            }
        } catch(e) { console.error('Error saving shipping config', e); }

        showToast('✅ ¡Configuración guardada con éxito!', 'success', 4000);

        if (typeof loadBots === 'function') loadBots();
        document.getElementById('section-create-bot').classList.remove('active');
        document.getElementById('section-bots').classList.add('active');
        document.querySelectorAll('.sidebar-nav li').forEach(li => li.classList.remove('active'));
        const botLink = document.querySelector('.sidebar-nav li[data-section="bots"]');
        if (botLink) botLink.classList.add('active');

    } catch (err) {
        if (err.message !== 'missing botName') showToast(err.message, 'error');
        if (btn) { btn.disabled = false; btn.innerHTML = oldText; }
        return;
    }

    if (btn) { btn.disabled = false; btn.innerHTML = oldText; }
};

// ─── Init slider on load ───
document.addEventListener('DOMContentLoaded', () => {
    const slider = document.getElementById('wiz-response-length');
    if (slider) wizUpdateSliderNew(slider);
});

// ═══════════════════════════════════════════
// MAYA AI — Catalog Import & Autofill
// ═══════════════════════════════════════════

// ─── Source Tab Switching ───
window.wizImportSwitchSource = function(btn, source) {
    // Toggle pills
    btn.closest('div').querySelectorAll('.wiz-btn-option').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    // Toggle panels
    ['files','url','shopify','instagram'].forEach(s => {
        const el = document.getElementById('wiz-import-src-' + s);
        if (el) el.style.display = s === source ? 'block' : 'none';
    });
};

// ─── Unified Analyze (delegates to existing app.js functions) ───
window.wizAnalyzeCatalogNew = async function() {
    // Determine active source
    const activeBtn = document.querySelector('#wiz-import-section .wiz-btn-option.active');
    const source = activeBtn?.dataset?.src || 'files';

    // Get URL value depending on source
    let url = '';
    if (source === 'url') url = document.getElementById('wiz-catalog-link')?.value?.trim() || '';
    if (source === 'shopify') url = document.getElementById('wiz-catalog-shopify')?.value?.trim() || '';
    if (source === 'instagram') url = document.getElementById('wiz-catalog-instagram')?.value?.trim() || '';

    const hasFiles = typeof wizNewCatalogFiles !== 'undefined' && wizNewCatalogFiles.length > 0;
    const hasUrl = url && url.startsWith('http');

    if (source === 'files' && !hasFiles) {
        showToast('Sube al menos un archivo para analizar', 'error');
        return;
    }
    if (source !== 'files' && !hasUrl) {
        showToast('Pega una URL válida para analizar', 'error');
        return;
    }

    // Sync the URL to the hidden wiz-catalog-link (used by existing wizAnalyzeNewCatalog)
    if (source !== 'files') {
        const linkInput = document.getElementById('wiz-catalog-link');
        if (linkInput) linkInput.value = url;
    }

    // Show clear button
    const clearBtn = document.getElementById('wiz-btn-clear-catalog');
    if (clearBtn) clearBtn.style.display = 'inline-flex';

    // Delegate to existing analysis function in app.js
    if (typeof wizAnalyzeNewCatalog === 'function') {
        await wizAnalyzeNewCatalog();
    } else {
        showToast('Error: función de análisis no disponible', 'error');
    }
};

// ─── Clear Import ───
window.wizClearImport = function() {
    if (typeof wizClearNewCatalog === 'function') wizClearNewCatalog();
    // Clear all URL inputs
    ['wiz-catalog-link','wiz-catalog-shopify','wiz-catalog-instagram'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const clearBtn = document.getElementById('wiz-btn-clear-catalog');
    if (clearBtn) clearBtn.style.display = 'none';
};

// ─── Apply Analysis to New Wizard Fields ───
window.wizApplyAnalysis = async function() {
    const data = window.wizCatalogAnalysis;
    if (!data) { showToast('No hay análisis disponible', 'error'); return; }

    console.log('[Qhatu Apply] Applying analysis:', data);

    const isDirectProductsTab = document.getElementById('section-products') && 
                                document.getElementById('section-products').style.display !== 'none';

    if (isDirectProductsTab) {
        if (!data.products || data.products.length === 0) {
            showToast('No se encontraron productos en el análisis.', 'warning');
            return;
        }
        // Leer siempre directo del DOM para evitar problemas de sincronía de variables globales
        const selector = document.getElementById('products-bot-select');
        const activeBotId = selector ? selector.value : (typeof productsCurrentBotId !== 'undefined' ? productsCurrentBotId : null);

        if (!activeBotId) {
            showToast('Por favor selecciona una Tienda arriba antes de sincronizar productos.', 'error');
            return;
        }

        const btn = document.querySelector('#wiz-analysis-status-new .wiz-btn-primary') || document.querySelector('#wiz-analysis-result-new .wiz-btn-primary');
        if (btn) btn.innerHTML = '⏳ Guardando productos...';
        
        try {
            const bizInfoRes = await apiCall(`/business/${activeBotId}`);
            const payload = bizInfoRes || {};
            let localProducts = payload.products || [];
            
            let newCount = 0;
            data.products.forEach(p => {
                const rawPrice = p.price ? p.price.toString().replace(/[^\d.]/g, '') : "0";
                const numPrice = parseFloat(rawPrice) || 0;
                localProducts.push({
                    id: 'prod_' + Date.now() + Math.random().toString(36).substr(2, 9),
                    name: p.name || 'Producto',
                    description: p.description || '',
                    price: numPrice,
                    stock: p.stock || 99,
                    status: 'ok',
                    imageUrl: p.imageUrl || ''
                });
                newCount++;
            });

            payload.products = localProducts;
            await apiCall(`/business/${activeBotId}`, 'PUT', payload);
            
            showToast(`✅ ${newCount} productos insertados a la base de datos de la tienda.`, 'success');
            
            const resultBox = document.getElementById('wiz-analysis-status-new') || document.getElementById('wiz-analysis-result-new');
            if (resultBox) resultBox.style.display = 'none';
            window.wizCatalogAnalysis = null;
            
            if (typeof productsList !== 'undefined') {
                productsList = localProducts; // Intentar sincronizar listado global
            } else if (typeof window.productsList !== 'undefined') {
                window.productsList = localProducts;
            }
            
            if (typeof updateProductsStats === 'function') updateProductsStats();
            if (typeof renderProducts === 'function') renderProducts(localProducts);
        } catch (e) {
            console.error('Error guardando productos de Qhatu:', e);
            showToast(e.message || 'Error al impactar la base de datos', 'error');
        } finally {
            if (btn) btn.innerHTML = '🪄 Aplicar a mi configuración';
        }
        return;
    }

    // --- Tab 1: Personalidad ---
    // Business name
    if (data.business_name) {
        const nameInput = document.getElementById('wiz-bot-name');
        if (nameInput && !nameInput.value.trim()) nameInput.value = data.business_name;
    }

    // Business summary → description
    if (data.business_summary) {
        const descInput = document.getElementById('wiz-product-desc');
        if (descInput && !descInput.value.trim()) descInput.value = data.business_summary;
    }

    // Target customers → audience
    if (data.target_customers) {
        const audienceInput = document.getElementById('wiz-target-audience');
        if (audienceInput && !audienceInput.value.trim()) audienceInput.value = data.target_customers;
    }

    // Bot personality → communication style
    if (data.bot_personality) {
        const commInput = document.getElementById('wiz-comm-style');
        if (commInput && !commInput.value.trim()) {
            commInput.value = data.bot_personality.substring(0, 200);
            wizUpdateCounter(commInput, 'wiz-comm-counter', 200);
        }
    }

    // --- Tab 2: Base de Conocimiento ---
    // Add knowledge blocks as KB topics
    if (data.knowledge_blocks && data.knowledge_blocks.length > 0) {
        data.knowledge_blocks.forEach(block => {
            window.wizKBTopics.push({
                id: Date.now() + Math.random(),
                topic: block.titulo || block.topic || 'Sin título',
                desc: block.contenido || block.content || '',
                category: wizMapKBCategory(block.categoria || block.category || 'otros')
            });
        });
        wizRenderKBTopics();
    }

    // Add products as KB topics tagged "productos"
    if (data.products && data.products.length > 0) {
        data.products.forEach(p => {
            const desc = `${p.description || ''}\nPrecio: ${p.price || 'Consultar'}`.trim();
            window.wizKBTopics.push({
                id: Date.now() + Math.random(),
                topic: p.name || 'Producto',
                desc: desc,
                category: 'productos',
                imageUrl: p.imageUrl || ''
            });
        });
        wizRenderKBTopics();
    }

    // Show count
    const productCount = data.products?.length || 0;
    const kbCount = data.knowledge_blocks?.length || 0;
    const totalAdded = productCount + kbCount;
    showToast(`🪄 Qhatu aplicó los datos: ${totalAdded} temas añadidos a Base de Conocimiento`, 'success', 5000);
};

function wizMapKBCategory(cat) {
    const map = {
        'horarios': 'horarios', 'schedule': 'horarios', 'hours': 'horarios',
        'envios': 'envios', 'shipping': 'envios', 'delivery': 'envios', 'entrega': 'envios',
        'pagos': 'pagos', 'payment': 'pagos', 'payments': 'pagos',
        'devoluciones': 'devoluciones', 'returns': 'devoluciones', 'refunds': 'devoluciones',
        'productos': 'productos', 'products': 'productos', 'menu': 'productos', 'catalog': 'productos'
    };
    return map[cat?.toLowerCase()] || 'otros';
}

// ─── Notification Toggles ───
window.wizHandleNotificationToggle = async function(checkbox, disclaimerId) {
    const disclaimer = document.getElementById(disclaimerId);
    if (!disclaimer) return;
    
    if (checkbox.checked) {
        disclaimer.style.display = 'block';
        
        // Request browser notifications permission
        if (window.Notification && Notification.permission !== 'granted' && Notification.permission !== 'denied') {
            try {
                const permission = await Notification.requestPermission();
                if (permission !== 'granted') {
                    if (typeof showToast === 'function') showToast('⚠️ Permiso de notificaciones denegado', 'warning', 4000);
                } else {
                    if (typeof showToast === 'function') showToast('✅ Notificaciones activadas exitosamente', 'success', 4000);
                }
            } catch (err) {
                console.error('Notification permission error:', err);
            }
        } else if (!window.Notification) {
            if (typeof showToast === 'function') showToast('❌ Tu navegador no soporta notificaciones web', 'error', 4000);
        }
    } else {
        disclaimer.style.display = 'none';
    }
};

// ═══════════════════════════════════════════
// KIPU SHIPPING MODULE (Olva & Shalom)
// ═══════════════════════════════════════════

window.wizChangeShippingMode = function(mode) {
    // 1. Ocultar todos los paneles y quitar 'active' a todas las cards
    document.querySelectorAll('.ship-config-panel').forEach(p => p.style.display = 'none');
    document.querySelectorAll('.shipping-mode-card').forEach(c => c.classList.remove('active'));

    // 2. Resaltar card seleccionada
    const selectedCard = document.getElementById(`card-mode-${mode}`);
    if(selectedCard) {
        selectedCard.classList.add('active');
        selectedCard.querySelector('input').checked = true;
    }

    // 3. Mostrar el panel correspondiente
    const panel = document.getElementById(`ship-config-${mode}`);
    if(panel) {
        panel.style.display = 'block';
    }
};

let wizFixedZoneCounter = 0;
let wizFixedZonesData = [];

window.wizAddFixedZoneUI = function() {
    wizFixedZoneCounter++;
    const id = wizFixedZoneCounter;
    wizFixedZonesData.push({ id, zona: '', costo: '' });
    wizRenderFixedZones();
};

window.wizRemoveFixedZoneUI = function(id) {
    wizFixedZonesData = wizFixedZonesData.filter(z => z.id !== id);
    wizRenderFixedZones();
};

window.wizUpdateFixedZoneUI = function(id, key, value) {
    const zone = wizFixedZonesData.find(z => z.id === id);
    if(zone) {
        zone[key] = value;
    }
};

function wizRenderFixedZones() {
    const tbody = document.getElementById('wiz-fixed-zones-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    wizFixedZonesData.forEach(z => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="padding: 0.5rem;"><input type="text" class="wiz-input" placeholder="Ej: Lima Sur" value="${z.zona}" onchange="wizUpdateFixedZoneUI(${z.id}, 'zona', this.value)"></td>
            <td style="padding: 0.5rem;"><input type="number" class="wiz-input" placeholder="Ej: 15" value="${z.costo}" onchange="wizUpdateFixedZoneUI(${z.id}, 'costo', this.value)"></td>
            <td style="padding: 0.5rem; text-align:right;"><button class="remove-row" style="background:none; border:none; color:#ef4444; font-size:1rem; cursor:pointer;" onclick="wizRemoveFixedZoneUI(${z.id})">✕</button></td>
        `;
        tbody.appendChild(tr);
    });
}

window.wizSelectCourier = function(courier) {
    document.querySelectorAll('[id^="btn-courier-"]').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`btn-courier-${courier}`).classList.add('active');

    const shalomSec = document.getElementById('wiz-courier-shalom-section');
    const olvaSec = document.getElementById('wiz-courier-olva-section');
    const otroSec = document.getElementById('wiz-courier-otro-section');
    const sep = document.getElementById('wiz-courier-separator');

    shalomSec.style.display = 'none';
    olvaSec.style.display = 'none';
    otroSec.style.display = 'none';
    if(sep) sep.style.display = 'none';

    if (courier === 'shalom') {
        shalomSec.style.display = 'block';
    } else if (courier === 'olva') {
        olvaSec.style.display = 'block';
    } else if (courier === 'ambos') {
        shalomSec.style.display = 'block';
        olvaSec.style.display = 'block';
        if(sep) sep.style.display = 'block';
    } else {
        otroSec.style.display = 'block';
    }
};

window.wizSearchShalomAgencia = async function(text) {
    const dropdown = document.getElementById('wiz-shalom-dropdown');
    if (text.length < 2) {
        dropdown.style.display = 'none';
        return;
    }
    try {
        const token = localStorage.getItem('token');
        const res = await fetch(`/api/shipping/shalom/agencias?q=${encodeURIComponent(text)}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const agencias = await res.json();
        dropdown.innerHTML = '';
        if (agencias && agencias.length > 0) {
            agencias.forEach(ag => {
                const item = document.createElement('div');
                item.style.padding = '0.75rem 1rem';
                item.style.borderBottom = '1px solid #eee';
                item.style.cursor = 'pointer';
                item.style.fontSize = '0.9rem';
                item.textContent = ag.nombre;
                item.onmouseenter = () => item.style.backgroundColor = '#f8fafc';
                item.onmouseleave = () => item.style.backgroundColor = 'transparent';
                item.onclick = () => wizSelectShalomAgencia(ag.id, ag.nombre);
                dropdown.appendChild(item);
            });
            dropdown.style.display = 'block';
        } else {
            dropdown.innerHTML = '<div style="padding:0.75rem 1rem;color:#666;font-size:0.9rem;">No hay resultados</div>';
            dropdown.style.display = 'block';
        }
    } catch(err) { console.error(err); }
};

window.wizSelectShalomAgencia = function(id, nombre) {
    document.getElementById('wiz-shalom-origin-id').value = id;
    document.getElementById('wiz-shalom-selected-text').textContent = nombre;
    document.getElementById('wiz-shalom-selected').style.display = 'flex';
    document.getElementById('wiz-shalom-search').value = '';
    document.getElementById('wiz-shalom-search').style.display = 'none';
    document.getElementById('wiz-shalom-dropdown').style.display = 'none';
};

window.wizClearShalomAgencia = function() {
    document.getElementById('wiz-shalom-origin-id').value = '';
    document.getElementById('wiz-shalom-selected').style.display = 'none';
    const search = document.getElementById('wiz-shalom-search');
    search.style.display = 'block';
    search.focus();
};

window.wizLoadProvinciasOrigen = async function() {
    const depSelect = document.getElementById('wiz-dep-origen');
    const provSelect = document.getElementById('wiz-prov-origen');
    const distSelect = document.getElementById('wiz-dist-origen');
    provSelect.innerHTML = '<option value="">Cargando...</option>'; provSelect.disabled = true;
    distSelect.innerHTML = '<option value="">Distrito</option>'; distSelect.disabled = true;
    if (!depSelect.value) return;
    try {
        const token = localStorage.getItem('token');
        const res = await fetch(`/api/shipping/ubigeo/provincias/${depSelect.value}`, { headers: { 'Authorization': `Bearer ${token}` } });
        const provincias = await res.json();
        provSelect.innerHTML = '<option value="">Provincia</option>';
        if(provincias && provincias.length){
           provincias.forEach(p => {
               const opt = document.createElement('option'); opt.value = p.id; opt.textContent = p.provincia; provSelect.appendChild(opt);
           });
           provSelect.disabled = false;
        }
    } catch(e) { console.error(e); provSelect.innerHTML = '<option value="">Error</option>'; }
};

window.wizLoadDistritosOrigen = async function() {
    const provSelect = document.getElementById('wiz-prov-origen');
    const distSelect = document.getElementById('wiz-dist-origen');
    distSelect.innerHTML = '<option value="">Cargando...</option>'; distSelect.disabled = true;
    if (!provSelect.value) return;
    try {
        const token = localStorage.getItem('token');
        const res = await fetch(`/api/shipping/ubigeo/distritos/${provSelect.value}`, { headers: { 'Authorization': `Bearer ${token}` } });
        const distritos = await res.json();
        distSelect.innerHTML = '<option value="">Distrito</option>';
        if(distritos && distritos.length){
           distritos.forEach(d => {
               const opt = document.createElement('option'); opt.value = d.id; opt.textContent = d.name; distSelect.appendChild(opt);
           });
           distSelect.disabled = false;
        }
    } catch(e) { console.error(e); distSelect.innerHTML = '<option value="">Error</option>'; }
};

window.wizToggleFreeShipping = function(checkbox) {
    document.getElementById('wiz-free-shipping-amount-wrap').style.display = checkbox.checked ? 'block' : 'none';
};

window.wizSaveShippingConfig = async function(botId) {
    
    // 1. Identificar modo principal
    const modeRadio = document.querySelector('input[name="wiz_shipping_mode"]:checked');
    const shippingMode = modeRadio ? modeRadio.value : 'courier';
    
    // 2. Extraer Courier configs (por si retrocompatibilidad)
    const activeCourierBtn = document.querySelector('[id^="btn-courier-"].active');
    const courierMode = activeCourierBtn ? activeCourierBtn.id.replace('btn-courier-', '') : 'otro';
    
    // 3. Extraer Free Coverage String
    const freeCovRadio = document.querySelector('input[name="wiz_free_coverage"]:checked');
    let finalCoverage = 'city';
    if(freeCovRadio) {
       finalCoverage = freeCovRadio.value === 'custom' 
            ? (document.getElementById('wiz-free-custom-coverage')?.value || 'custom') 
            : freeCovRadio.value;
    }

    const config = {
        // Base mapping to modified Supabase Table
        shipping_mode: shippingMode,
        pickup_address: document.getElementById('wiz-pickup-address')?.value?.trim() || '',
        pickup_hours: document.getElementById('wiz-pickup-hours')?.value?.trim() || '',
        
        free_shipping_always: shippingMode === 'free',
        free_shipping_threshold: parseFloat(document.getElementById('wiz-free-min-amount')?.value || '0'),
        below_min_shipping_cost: parseFloat(document.getElementById('wiz-free-below-cost')?.value || '0'),
        shipping_coverage: finalCoverage,
        
        fixed_shipping_cost: parseFloat(document.getElementById('wiz-fixed-cost')?.value || '0'),
        zone_pricing_enabled: document.getElementById('wiz-fixed-zones-toggle')?.checked || false,
        zone_prices: wizFixedZonesData.map(z => ({ zona: z.zona, costo: parseFloat(z.costo || '0') })),
        
        other_courier_name: document.getElementById('wiz-other-courier-name')?.value?.trim() || '',

        // Legacy / Courier
        courier_mode: courierMode,
        olva_active: courierMode === 'olva' || courierMode === 'ambos',
        shalom_active: courierMode === 'shalom' || courierMode === 'ambos',
        
        shalom_origin_id: parseInt(document.getElementById('wiz-shalom-origin-id')?.value || '0'),
        shalom_origin_name: document.getElementById('wiz-shalom-selected-text')?.textContent || '',
        
        olva_origin_dep: document.getElementById('wiz-dep-origen')?.value || '',
        olva_origin_prov: document.getElementById('wiz-prov-origen')?.value || '',
        olva_origin_dist: document.getElementById('wiz-dist-origen')?.value || '',
        
        allow_tda: document.getElementById('wiz-delivery-tda')?.checked || false,
        allow_reg: document.getElementById('wiz-delivery-reg')?.checked || false,
        
        custom_rules: document.getElementById('wiz-custom-rules')?.value?.trim() || ''
    };
    
    // Override threshold for 'fixed' if used there
    if(shippingMode === 'fixed' && document.getElementById('wiz-fixed-free-treshold-toggle')?.checked) {
       config.free_shipping_threshold = parseFloat(document.getElementById('wiz-fixed-free-treshold')?.value || '0');
    } else if (shippingMode === 'courier' && document.getElementById('wiz-free-shipping')?.checked) {
       config.free_shipping_threshold = parseFloat(document.getElementById('wiz-free-shipping-amount')?.value || '0');
    }
    
    const token = localStorage.getItem('token');
    await fetch(`/api/shipping/config/${botId}`, {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(config)
    });
};

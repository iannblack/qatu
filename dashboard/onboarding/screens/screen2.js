// ════════════════════════════════════════════════════════════════════════
// Pantalla 2 — Productos o servicios
// Spec: spec section 5 → "PANTALLA 2 — Productos o servicios"
//
// Tabs:
//   manual: lista repetible de cards. Mín 1 producto visible siempre.
//   upload: STUB. Mensaje "Procesamiento de archivos en desarrollo" +
//           botón para volver a tab manual. El parser real llega después.
//
// Validación al continuar:
//   mín 1 producto con nombre + precio (en tab manual)
//   Si tab=upload sin carga → continuar bloqueado, beforeNext muestra
//   error pidiendo ir a manual.
//
// Saltar SÍ disponible con confirmación.
// Atrás con dirty-check si hay cualquier campo no vacío.
//
// Cleanup obligatorio:
//   - typewriter (timer + interval)
//   - listeners del tab switcher (delegado, uno solo)
//   - listeners de cada card (un map cardId → cleanupFn)
//   - listener del botón "+ agregar"
//   - willy reactions + blink
//
// Convención crítica: cada card tiene sus propios listeners (4 inputs +
// botón eliminar). Cuando se elimina una card, detachCardListeners() corre
// ANTES de quitarla del DOM — sin esto, los listeners quedan colgados de
// elementos huérfanos hasta que el GC los reclame (memory leak).
// ════════════════════════════════════════════════════════════════════════

import { renderWilly, attachReactions, attachBlink } from '../willy.js';
import { typewriter, shake, TYPEWRITER_DELAY } from '../lib/animations.js';
import { escapeAttr, escapeText } from '../lib/escape.js';
import { state, save } from '../store.js';
import { confirmModal } from '../wizard.js';

const PREGUNTA = 'Cuéntame qué vendes. Puedes escribirlos manualmente o pasarme un archivo o link y yo los aprendo solito.';

const validators = {
    nombre: (v) => {
        if (String(v ?? '').trim().length === 0) return 'Necesito un nombre';
        return null;
    },
    precio: (v) => {
        const s = String(v ?? '').trim();
        if (s === '') return 'Necesito el precio';
        const n = Number(s);
        if (Number.isNaN(n)) return 'Precio inválido';
        if (n < 0) return 'No puede ser negativo';
        return null;
    },
};

// ── Helpers ────────────────────────────────────────────────────────────
function newProductId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return `p_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
function makeEmptyProduct() {
    return {
        id: newProductId(),
        nombre: '', precio: '', categoria: '', descripcion: '', imageUrl: '',
        // Stock por defecto: ilimitado (sin tope). El dueño puede activarlo
        // luego para que el bot avise cuando ya no haya unidades. Si
        // stockUnlimited=true, el campo numérico queda deshabilitado.
        stockUnlimited: true,
        stock: '',
    };
}

function renderCardHtml(product, index, { initial = false } = {}) {
    return `
        <div class="qw-product-card" data-product-id="${product.id}"${initial ? ' data-initial style="animation-delay: ' + (0.55 + index * 0.06).toFixed(2) + 's"' : ''}>
            <div class="qw-product-card-header">
                <span class="qw-product-card-num">Producto ${index + 1}</span>
                <button type="button" class="qw-product-delete"
                        data-action="delete-product"
                        aria-label="Eliminar producto ${index + 1}"
                        title="Eliminar producto">🗑️</button>
            </div>
            <div class="qw-field">
                <label class="qw-label">Nombre *</label>
                <input class="qw-input" data-field="nombre" type="text"
                       value="${escapeAttr(product.nombre)}"
                       maxlength="80"
                       placeholder="Ej: Ceviche mixto"
                       aria-describedby="err-${product.id}-nombre">
                <div class="qw-error" data-error="nombre" id="err-${product.id}-nombre" role="alert" aria-live="polite"></div>
            </div>
            <div class="qw-product-row">
                <div class="qw-field">
                    <label class="qw-label">Precio (S/) *</label>
                    <input class="qw-input" data-field="precio" type="number"
                           min="0" step="0.01" inputmode="decimal"
                           value="${escapeAttr(product.precio)}"
                           placeholder="0.00"
                           aria-describedby="err-${product.id}-precio">
                    <div class="qw-error" data-error="precio" id="err-${product.id}-precio" role="alert" aria-live="polite"></div>
                </div>
                <div class="qw-field">
                    <label class="qw-label">Categoría</label>
                    <input class="qw-input" data-field="categoria" type="text"
                           value="${escapeAttr(product.categoria || '')}"
                           maxlength="60"
                           placeholder="Ej: Pescados">
                </div>
            </div>
            <div class="qw-field">
                <label class="qw-label">Descripción</label>
                <textarea class="qw-textarea" data-field="descripcion"
                          rows="2" maxlength="220"
                          placeholder="Detalle opcional">${escapeText(product.descripcion || '')}</textarea>
            </div>
            <div class="qw-field qw-product-photo-field">
                <label class="qw-label">Foto del producto (opcional)</label>
                <div class="qw-product-photo-row">
                    <div class="qw-product-photo-thumb" data-photo-thumb
                         style="${product.imageUrl ? `background-image:url('${escapeAttr(product.imageUrl)}');` : ''}">
                        ${product.imageUrl ? '' : '<span class="qw-product-photo-thumb-placeholder">📷</span>'}
                    </div>
                    <div class="qw-product-photo-actions">
                        <input type="file" class="qw-product-photo-input" data-photo-input
                               accept="image/jpeg,image/png,image/webp" hidden>
                        <button type="button" class="qw-btn qw-btn-secondary qw-btn-sm"
                                data-action="upload-photo">
                            ${product.imageUrl ? 'Cambiar foto' : 'Subir foto'}
                        </button>
                        ${product.imageUrl ? '<button type="button" class="qw-btn qw-btn-secondary qw-btn-sm" data-action="remove-photo">Quitar</button>' : ''}
                        <div class="qw-product-photo-hint">Arrastrá una imagen acá o tocá el cuadro · JPG/PNG/WebP — máx 5 MB</div>
                    </div>
                </div>
                <div class="qw-error" data-error="photo" role="alert" aria-live="polite"></div>
            </div>
            ${renderStockField(product)}
        </div>
    `;
}

// Bloque Stock con toggle "Sin límite de stock". Cuando el toggle está ON
// (default), el input numérico queda deshabilitado y el bot trata al
// producto como ilimitado. Cuando se apaga, el dueño tipea las unidades
// disponibles. El stock baja automáticamente con cada pedido nuevo y se
// repone si el pedido se cancela (lógica viva en routes /orders).
function renderStockField(product) {
    const unlimited = product.stockUnlimited !== false; // default true
    const stockValue = unlimited ? '' : (product.stock ?? '');
    return `
        <div class="qw-field qw-product-stock-field">
            <div class="qw-stock-head">
                <div>
                    <span class="qw-stock-title">Stock <span class="qw-stock-opt-pill">Opcional</span></span>
                    <div class="qw-stock-sub" data-stock-sub>${unlimited ? 'Sin límite de stock' : 'Stock por unidades'}</div>
                </div>
            </div>
            <div class="qw-stock-row">
                <input class="qw-input qw-stock-input" data-field="stock" type="number"
                       min="0" step="1" inputmode="numeric"
                       value="${escapeAttr(stockValue)}"
                       placeholder="uds. ${unlimited ? 'Ilimitado' : ''}"
                       ${unlimited ? 'disabled' : ''}
                       aria-label="Unidades en stock">
                <label class="qw-stock-toggle" title="Sin límite de stock">
                    <input type="checkbox" data-field="stockUnlimited" ${unlimited ? 'checked' : ''}>
                    <span class="qw-stock-toggle-track"><span class="qw-stock-toggle-thumb"></span></span>
                </label>
            </div>
            <div class="qw-stock-hint">El stock disminuye automáticamente con cada pedido creado. Si el pedido es cancelado, las unidades vuelven a estar disponibles.</div>
        </div>
    `;
}

export function renderScreen2(container, ctx) {
    // Hidratación: si state.productos está vacío, sembramos 1 producto vacío
    // para que el usuario siempre vea ≥1 card al entrar.
    if (!Array.isArray(state.productos) || state.productos.length === 0) {
        state.productos = [makeEmptyProduct()];
        save();
    } else {
        // Asegurar que cada producto tenga ID (productos viejos podrían no tenerlo)
        let touched = false;
        state.productos = state.productos.map(p => {
            if (!p.id) { touched = true; return { ...p, id: newProductId() }; }
            return p;
        });
        if (touched) save();
    }

    // Estado local de la screen (no persistido — defaults a manual cada mount)
    let activeTab = 'manual';

    // Map cardId → función cleanup de esa card. CRÍTICO: cada vez que
    // detacheamos una card (delete o screen unmount), llamamos su fn y la
    // borramos del Map. Sin esto, listeners quedan colgados.
    const cardCleanups = new Map();

    container.innerHTML = `
        <div class="qw-scene">
            ${renderWilly('señalando')}
            <div class="qw-right qw-right-wide">
                <div class="qw-bubble">
                    <p class="qw-bubble-text qw-bubble-text-left" id="qw-greeting"></p>
                </div>
                <div class="qw-tabs" role="tablist" aria-label="Origen de productos">
                    <button class="qw-tab" role="tab" data-tab="manual"
                            aria-selected="true" aria-controls="qw-panel-manual">
                        Escribirlos manualmente
                    </button>
                    <button class="qw-tab" role="tab" data-tab="upload"
                            aria-selected="false" aria-controls="qw-panel-upload">
                        Subir archivo o link
                    </button>
                </div>
                <div class="qw-tab-panel" id="qw-panel-manual" role="tabpanel" aria-labelledby="manual">
                    <div class="qw-product-list" id="qw-products-list">
                        ${state.productos.map((p, i) => renderCardHtml(p, i, { initial: true })).join('')}
                    </div>
                    <button type="button" class="qw-btn qw-btn-secondary qw-btn-add" data-action="add-product">
                        + Agregar otro producto
                    </button>
                </div>
                <div class="qw-tab-panel" id="qw-panel-upload" role="tabpanel" aria-labelledby="upload" hidden>
                    <div class="qw-upload-stub">
                        <h3 class="qw-upload-stub-title">Procesamiento de archivos en desarrollo</h3>
                        <p class="qw-upload-stub-text">
                            Por ahora estamos puliendo el parser de Shopify, perfiles de Instagram
                            y catálogos en PDF. Mientras tanto, agregá tus productos a mano — toma
                            un minuto.
                        </p>
                        <button type="button" class="qw-btn qw-btn-secondary" data-action="back-to-manual">
                            Volver a tab manual
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    // ── Refs ──────────────────────────────────────────────────────────
    const greetEl = container.querySelector('#qw-greeting');
    const tabsEl = container.querySelector('.qw-tabs');
    const listEl = container.querySelector('#qw-products-list');
    const addBtn = container.querySelector('[data-action="add-product"]');
    const backToManualBtn = container.querySelector('[data-action="back-to-manual"]');
    const panels = {
        manual: container.querySelector('#qw-panel-manual'),
        upload: container.querySelector('#qw-panel-upload'),
    };

    // ── Typewriter (form delay corto) ─────────────────────────────────
    let cancelTypewriter = null;
    const typewriterDelay = setTimeout(() => {
        cancelTypewriter = typewriter(greetEl, PREGUNTA, 25);
    }, TYPEWRITER_DELAY.FORM);

    // ── Helpers de UI compartidos ─────────────────────────────────────
    const findCardEl = (productId) => listEl.querySelector(`[data-product-id="${productId}"]`);
    const findFieldEl = (productId, field) => listEl.querySelector(`[data-product-id="${productId}"] [data-field="${field}"]`);
    const findErrorEl = (productId, field) => listEl.querySelector(`[data-product-id="${productId}"] [data-error="${field}"]`);

    const setFieldError = (productId, field, message) => {
        const inputEl = findFieldEl(productId, field);
        const errEl = findErrorEl(productId, field);
        if (!inputEl || !errEl) return;
        errEl.textContent = message || '';
        if (message) {
            inputEl.classList.add('qw-input-error');
            inputEl.setAttribute('aria-invalid', 'true');
        } else {
            inputEl.classList.remove('qw-input-error');
            inputEl.setAttribute('aria-invalid', 'false');
        }
    };

    // ── Validación + estado del botón Continuar ───────────────────────
    const refreshContinue = () => {
        const btn = document.querySelector('#qw-footer [data-action="next"]');
        if (!btn) return;
        if (activeTab === 'upload') {
            btn.disabled = true;
            return;
        }
        const hasValid = state.productos.some(p =>
            !validators.nombre(p.nombre) && !validators.precio(p.precio)
        );
        btn.disabled = !hasValid;
    };

    const refreshDeleteButtons = () => {
        const onlyOne = state.productos.length === 1;
        state.productos.forEach(p => {
            const btn = listEl.querySelector(`[data-product-id="${p.id}"] [data-action="delete-product"]`);
            if (!btn) return;
            btn.disabled = onlyOne;
            btn.title = onlyOne ? 'Necesitas al menos un producto' : 'Eliminar producto';
        });
    };

    const refreshIndices = () => {
        state.productos.forEach((p, i) => {
            const numEl = listEl.querySelector(`[data-product-id="${p.id}"] .qw-product-card-num`);
            if (numEl) numEl.textContent = `Producto ${i + 1}`;
            const delBtn = listEl.querySelector(`[data-product-id="${p.id}"] [data-action="delete-product"]`);
            if (delBtn) delBtn.setAttribute('aria-label', `Eliminar producto ${i + 1}`);
        });
    };

    // ── Wiring de listeners por card ──────────────────────────────────
    // Devuelve fn de cleanup que remueve TODOS los listeners de la card.
    // La guardamos en el Map por productId.
    const attachCardListeners = (cardEl, productId) => {
        const fields = ['nombre', 'precio', 'categoria', 'descripcion', 'stock'];
        const inputEls = {};
        const handlers = {};

        for (const f of fields) {
            const el = cardEl.querySelector(`[data-field="${f}"]`);
            if (!el) continue;
            inputEls[f] = el;
            handlers[f] = () => {
                const product = state.productos.find(p => p.id === productId);
                if (!product) return;
                product[f] = el.value;
                save();
                // Si había error y ahora el campo es válido, limpiar
                if (validators[f] && validators[f](el.value) === null) {
                    setFieldError(productId, f, null);
                }
                refreshContinue();
            };
            el.addEventListener('input', handlers[f]);
        }

        // Toggle "Sin límite de stock". Cuando se prende, deshabilitamos el
        // input numérico y limpiamos el valor. Cuando se apaga, el input
        // queda editable para que el dueño ingrese unidades.
        const stockToggleEl = cardEl.querySelector('[data-field="stockUnlimited"]');
        const stockInputEl = cardEl.querySelector('[data-field="stock"]');
        const stockSubEl = cardEl.querySelector('[data-stock-sub]');
        const onStockToggle = () => {
            const product = state.productos.find(p => p.id === productId);
            if (!product) return;
            const unlimited = !!stockToggleEl.checked;
            product.stockUnlimited = unlimited;
            if (unlimited) {
                product.stock = '';
                if (stockInputEl) {
                    stockInputEl.value = '';
                    stockInputEl.disabled = true;
                    stockInputEl.placeholder = 'uds. Ilimitado';
                }
                if (stockSubEl) stockSubEl.textContent = 'Sin límite de stock';
            } else {
                if (stockInputEl) {
                    stockInputEl.disabled = false;
                    stockInputEl.placeholder = 'uds.';
                    setTimeout(() => stockInputEl.focus(), 30);
                }
                if (stockSubEl) stockSubEl.textContent = 'Stock por unidades';
            }
            save();
        };
        if (stockToggleEl) stockToggleEl.addEventListener('change', onStockToggle);

        // Botón eliminar
        const delBtn = cardEl.querySelector('[data-action="delete-product"]');
        const onDelete = () => deleteCard(productId);
        if (delBtn) delBtn.addEventListener('click', onDelete);

        // ── Upload de foto del producto ──────────────────────────────────
        const uploadBtn  = cardEl.querySelector('[data-action="upload-photo"]');
        const removeBtn  = cardEl.querySelector('[data-action="remove-photo"]');
        const fileInput  = cardEl.querySelector('[data-photo-input]');
        const thumbEl    = cardEl.querySelector('[data-photo-thumb]');
        const photoErrEl = cardEl.querySelector('[data-error="photo"]');

        const setPhotoError = (msg) => { if (photoErrEl) photoErrEl.textContent = msg || ''; };
        const setThumb = (url) => {
            if (!thumbEl) return;
            if (url) {
                thumbEl.style.backgroundImage = `url('${url.replace(/'/g, "\\'")}')`;
                thumbEl.innerHTML = '';
            } else {
                thumbEl.style.backgroundImage = '';
                thumbEl.innerHTML = '<span class="qw-product-photo-thumb-placeholder">📷</span>';
            }
        };
        const updateActionsLabel = (hasPhoto) => {
            if (uploadBtn) uploadBtn.textContent = hasPhoto ? 'Cambiar foto' : 'Subir foto';
            if (!hasPhoto && removeBtn) removeBtn.remove();
            // Si subió y no había botón "Quitar", lo inyectamos.
            if (hasPhoto && !cardEl.querySelector('[data-action="remove-photo"]')) {
                const newRemove = document.createElement('button');
                newRemove.type = 'button';
                newRemove.className = 'qw-btn qw-btn-secondary qw-btn-sm';
                newRemove.setAttribute('data-action', 'remove-photo');
                newRemove.textContent = 'Quitar';
                newRemove.addEventListener('click', onRemovePhoto);
                uploadBtn?.parentElement?.insertBefore(newRemove, uploadBtn.nextSibling);
            }
        };

        const ALLOWED_MIME = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

        // Sube un File al endpoint. Centralizado para que click + drag&drop
        // + paste compartan la misma lógica de validación + estados de UI.
        const uploadFile = async (file) => {
            if (!file) return;
            setPhotoError('');
            if (!ALLOWED_MIME.includes(file.type)) {
                setPhotoError('Formato no soportado. Usa JPG, PNG o WebP.');
                return;
            }
            if (file.size > 5 * 1024 * 1024) {
                setPhotoError('La foto no puede pesar más de 5 MB.');
                return;
            }
            const product = state.productos.find(p => p.id === productId);
            if (!product) return;
            const botId = (typeof window !== 'undefined' && window.__configSelectedBotId)
                || (typeof window !== 'undefined' && window.mayaCurrentBotId)
                || '';
            if (!botId) {
                setPhotoError('Selecciona primero una tienda para subir fotos.');
                return;
            }
            try {
                if (uploadBtn) { uploadBtn.disabled = true; uploadBtn.textContent = 'Subiendo…'; }
                if (thumbEl) thumbEl.classList.add('is-uploading');
                const token = localStorage.getItem('token');
                const fd = new FormData();
                fd.append('photo', file);
                fd.append('productId', productId);
                const res = await fetch(`/api/business/${encodeURIComponent(botId)}/product-photo`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}` },
                    body: fd,
                });
                const j = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
                if (!j.imageUrl) throw new Error('Respuesta sin imageUrl');
                product.imageUrl = j.imageUrl;
                save();
                setThumb(j.imageUrl);
                updateActionsLabel(true);
            } catch (e) {
                console.warn('[productPhoto] upload falló:', e?.message || e);
                setPhotoError('No pudimos subir la foto. Intentalo de nuevo.');
            } finally {
                if (uploadBtn) { uploadBtn.disabled = false; uploadBtn.textContent = (state.productos.find(p => p.id === productId)?.imageUrl) ? 'Cambiar foto' : 'Subir foto'; }
                if (thumbEl) thumbEl.classList.remove('is-uploading');
            }
        };

        const onUploadClick = () => { fileInput?.click(); };
        const onFileChange = async () => {
            const file = fileInput?.files?.[0];
            await uploadFile(file);
            if (fileInput) fileInput.value = '';
        };
        const onRemovePhoto = () => {
            const product = state.productos.find(p => p.id === productId);
            if (!product) return;
            product.imageUrl = '';
            save();
            setThumb('');
            updateActionsLabel(false);
        };

        // ── Drag & drop: arrastrá una imagen sobre el thumb (o cualquier
        //    parte del row de la foto) para subirla, sin tener que abrir
        //    el file picker. También permite paste con Cmd/Ctrl+V cuando el
        //    thumb tiene el foco. Si arrastrás algo que no es imagen, se
        //    rechaza con mensaje claro.
        const dropZone = cardEl.querySelector('.qw-product-photo-row') || thumbEl;
        let dragDepth = 0; // contador para manejar dragenter/leave anidados
        const onDragOver = (e) => {
            // Aceptamos solo si el dataTransfer trae al menos un item tipo file.
            if (!e.dataTransfer) return;
            const hasFile = Array.from(e.dataTransfer.items || []).some(it => it.kind === 'file');
            if (!hasFile && !(e.dataTransfer.types || []).includes('Files')) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
        };
        const onDragEnter = (e) => {
            if (!e.dataTransfer) return;
            if (!(e.dataTransfer.types || []).includes('Files')) return;
            e.preventDefault();
            dragDepth++;
            dropZone?.classList.add('is-dragover');
        };
        const onDragLeave = (e) => {
            e.preventDefault();
            dragDepth = Math.max(0, dragDepth - 1);
            if (dragDepth === 0) dropZone?.classList.remove('is-dragover');
        };
        const onDrop = async (e) => {
            e.preventDefault();
            dragDepth = 0;
            dropZone?.classList.remove('is-dragover');
            const file = e.dataTransfer?.files?.[0];
            if (!file) return;
            await uploadFile(file);
        };
        // Click sobre el thumb también dispara el file picker (UX más natural).
        const onThumbClick = () => { fileInput?.click(); };

        if (uploadBtn) uploadBtn.addEventListener('click', onUploadClick);
        if (fileInput) fileInput.addEventListener('change', onFileChange);
        if (removeBtn) removeBtn.addEventListener('click', onRemovePhoto);
        if (thumbEl)   thumbEl.addEventListener('click', onThumbClick);
        if (dropZone) {
            dropZone.addEventListener('dragover',  onDragOver);
            dropZone.addEventListener('dragenter', onDragEnter);
            dropZone.addEventListener('dragleave', onDragLeave);
            dropZone.addEventListener('drop',      onDrop);
        }

        // Cleanup de esta card
        const cleanup = () => {
            for (const f of fields) {
                if (inputEls[f] && handlers[f]) {
                    inputEls[f].removeEventListener('input', handlers[f]);
                }
            }
            if (stockToggleEl) stockToggleEl.removeEventListener('change', onStockToggle);
            if (delBtn) delBtn.removeEventListener('click', onDelete);
            if (uploadBtn) uploadBtn.removeEventListener('click', onUploadClick);
            if (fileInput) fileInput.removeEventListener('change', onFileChange);
            if (thumbEl)   thumbEl.removeEventListener('click', onThumbClick);
            if (dropZone) {
                dropZone.removeEventListener('dragover',  onDragOver);
                dropZone.removeEventListener('dragenter', onDragEnter);
                dropZone.removeEventListener('dragleave', onDragLeave);
                dropZone.removeEventListener('drop',      onDrop);
            }
            const rb = cardEl.querySelector('[data-action="remove-photo"]');
            if (rb) rb.removeEventListener('click', onRemovePhoto);
        };
        cardCleanups.set(productId, cleanup);
    };

    const detachCardListeners = (productId) => {
        const fn = cardCleanups.get(productId);
        if (fn) fn();
        cardCleanups.delete(productId);
    };

    // ── Agregar / eliminar cards ──────────────────────────────────────
    const addCard = () => {
        const newProduct = makeEmptyProduct();
        state.productos.push(newProduct);
        save();

        const tempWrapper = document.createElement('div');
        tempWrapper.innerHTML = renderCardHtml(newProduct, state.productos.length - 1).trim();
        const newCardEl = tempWrapper.firstElementChild;
        listEl.appendChild(newCardEl);

        attachCardListeners(newCardEl, newProduct.id);
        refreshDeleteButtons();
        refreshContinue();

        // Slide+fade desde abajo (Web Animations API). No respeta reduced
        // motion explícitamente porque la animación es chica y orientadora
        // — el usuario espera ver que apareció algo. Si querés desactivarlo
        // bajo prefers-reduced-motion, sustituir por instant set.
        if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            newCardEl.animate(
                [
                    { transform: 'translateY(20px)', opacity: 0 },
                    { transform: 'translateY(0)',    opacity: 1 },
                ],
                { duration: 300, easing: 'ease-out' }
            );
        }

        // Foco al nombre — el usuario quiere tipear de inmediato
        const firstInput = newCardEl.querySelector('[data-field="nombre"]');
        if (firstInput) firstInput.focus({ preventScroll: false });
    };

    const deleteCard = (productId) => {
        // Regla del producto: siempre ≥1 card visible
        if (state.productos.length <= 1) return;

        // 1) Detach listeners — sin esto, leak garantizado
        detachCardListeners(productId);

        // 2) Borrar del state + persist
        state.productos = state.productos.filter(p => p.id !== productId);
        save();

        // 3) Animate out + remove. Animamos height + opacity con WAAPI.
        //    Capturamos las dimensiones actuales antes de empezar para que
        //    el "from" sea sólido.
        const cardEl = findCardEl(productId);
        refreshDeleteButtons();
        refreshIndices();
        refreshContinue();

        if (!cardEl) return;

        // Quitamos el data-product-id para que las queries posteriores no la
        // toquen (está en estado "leaving"). Listeners ya fueron detacheados.
        cardEl.dataset.leaving = 'true';
        cardEl.removeAttribute('data-product-id');

        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            cardEl.remove();
            return;
        }

        const cs = getComputedStyle(cardEl);
        const startHeight = cardEl.offsetHeight;
        // Capturamos el gap del flex parent en pixels para que el margen
        // negativo final coincida exactamente con el espacio que la card
        // está ocupando (height=0 conserva ambos gaps adyacentes hasta que
        // hagamos remove(); el negative marginTop los compensa para evitar
        // el "snap" al final de la animación).
        const flexGapPx = parseFloat(getComputedStyle(listEl).gap) || 0;
        const anim = cardEl.animate(
            [
                {
                    opacity: 1,
                    height: startHeight + 'px',
                    marginTop: '0px',
                    paddingTop: cs.paddingTop,
                    paddingBottom: cs.paddingBottom,
                },
                {
                    opacity: 0,
                    height: '0px',
                    marginTop: `-${flexGapPx}px`,
                    paddingTop: '0px',
                    paddingBottom: '0px',
                },
            ],
            { duration: 300, easing: 'ease-in', fill: 'forwards' }
        );
        anim.addEventListener('finish', () => cardEl.remove());
    };

    // ── Tabs ─────────────────────────────────────────────────────────
    const switchTab = (tab) => {
        if (tab !== 'manual' && tab !== 'upload') return;
        activeTab = tab;
        container.querySelectorAll('.qw-tab').forEach(b => {
            b.setAttribute('aria-selected', b.dataset.tab === tab ? 'true' : 'false');
        });
        panels.manual.hidden = tab !== 'manual';
        panels.upload.hidden = tab !== 'upload';
        refreshContinue();
    };
    const onTabClick = (e) => {
        const tabBtn = e.target.closest('[data-tab]');
        if (!tabBtn) return;
        switchTab(tabBtn.dataset.tab);
    };
    tabsEl.addEventListener('click', onTabClick);

    const onAddClick = () => addCard();
    addBtn.addEventListener('click', onAddClick);

    const onBackToManual = () => switchTab('manual');
    if (backToManualBtn) backToManualBtn.addEventListener('click', onBackToManual);

    // ── Wire listeners para cada card ya hidratada ────────────────────
    state.productos.forEach(p => {
        const cardEl = findCardEl(p.id);
        if (cardEl) attachCardListeners(cardEl, p.id);
    });

    refreshDeleteButtons();

    // ── Guards de navegación ─────────────────────────────────────────
    // beforeNext — backstop defensivo. Continue ya está deshabilitado cuando
    // es inválido; este guard cubre el caso defensivo.
    ctx.setBeforeNext(() => {
        if (activeTab === 'upload') {
            // Defensivo: en upload el botón está disabled, no debería llegar
            // acá. Pero por si acaso, indicamos qué hacer.
            shake(container.querySelector('#qw-panel-upload'));
            return false;
        }
        // Validar todos los campos y mostrar errores; mín 1 producto válido.
        let anyValid = false;
        state.productos.forEach(p => {
            const nErr = validators.nombre(p.nombre);
            const pErr = validators.precio(p.precio);
            if (!nErr && !pErr) anyValid = true;
        });
        if (anyValid) return true;
        // Sin productos válidos — mostrar errores en la primera card +
        // shake para guiar al usuario al campo que falta.
        const first = state.productos[0];
        if (first) {
            const nErr = validators.nombre(first.nombre);
            const pErr = validators.precio(first.precio);
            if (nErr) setFieldError(first.id, 'nombre', nErr);
            if (pErr) setFieldError(first.id, 'precio', pErr);
            const firstInvalid = nErr
                ? findFieldEl(first.id, 'nombre')
                : findFieldEl(first.id, 'precio');
            if (firstInvalid) {
                shake(firstInvalid);
                firstInvalid.focus();
            }
        }
        return false;
    });

    // beforeSkip — confirmación obligatoria
    ctx.setBeforeSkip(async () => {
        return await confirmModal({
            title: '¿Saltar productos?',
            message: 'Sin productos no puedo vender. Puedes agregarlos después en el panel.',
            confirmText: 'Sí, saltar por ahora',
            cancelText: 'Mejor los agrego',
        });
    });

    // beforeBack — dirty check (cualquier campo de cualquier producto con data)
    const isDirty = () => state.productos.some(p =>
        (p.nombre || '').trim() !== '' ||
        String(p.precio || '').trim() !== '' ||
        (p.categoria || '').trim() !== '' ||
        (p.descripcion || '').trim() !== ''
    );
    ctx.setBeforeBack(async () => {
        if (!isDirty()) return true;
        return await confirmModal({
            title: '¿Volver atrás?',
            message: 'Tus productos siguen guardados — vuelves cuando quieras.',
            confirmText: 'Sí, volver',
            cancelText: 'Quedarme',
        });
    });

    // ── Willy reactions + blink ──────────────────────────────────────
    const stopReactions = attachReactions(container);
    const stopBlink = attachBlink(container, 'señalando');

    // Estado inicial del Continuar — puede que el state recargado ya tenga
    // un producto válido (recovery desde localStorage).
    refreshContinue();

    // ── Cleanup OBLIGATORIO ──────────────────────────────────────────
    return () => {
        clearTimeout(typewriterDelay);
        cancelTypewriter?.();
        tabsEl.removeEventListener('click', onTabClick);
        addBtn.removeEventListener('click', onAddClick);
        if (backToManualBtn) backToManualBtn.removeEventListener('click', onBackToManual);
        // Todas las cards
        for (const fn of cardCleanups.values()) {
            try { fn(); } catch (e) { console.warn('[p2] card cleanup error', e); }
        }
        cardCleanups.clear();
        stopReactions();
        stopBlink();
    };
}

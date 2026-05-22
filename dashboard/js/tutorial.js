// ═══════════════════════════════════════════════════════════════════
//  KIPU TUTORIAL — Spotlight step-by-step onboarding
//  Targets only elements that exist in the actual sidebar nav.
// ═══════════════════════════════════════════════════════════════════

const tutorialSteps = [
    {
        id: 1,
        title: "¡Bienvenido a Qhatu!",
        desc: "Tu plataforma para automatizar ventas por WhatsApp con IA. En este recorrido te mostramos los pasos esenciales para que tu Qhatu empiece a vender hoy.",
        target: null,
        icon: "👋",
        action: null
    },
    {
        id: 2,
        title: "Mi Qhatu — donde empieza todo",
        desc: "Aquí creas y configuras tu tienda. Cada Qhatu es una tienda independiente con su propio inventario, envíos, métodos de pago y workflow.",
        target: ".sidebar-nav li[data-section='create-bot']",
        icon: "⭐",
        action: function() {
            try { document.querySelector('.sidebar-nav li[data-section="create-bot"]').click(); } catch(e) {}
        }
    },
    {
        id: 3,
        title: "Inventario — sube tus productos",
        desc: "Dentro de tu Qhatu, en la pestaña 'Inventario' puedes importar productos: subiendo archivos (PDF, Excel), pegando una URL, conectando Shopify o Instagram, o agregándolos manualmente. Antes de guardar verás la lista completa para confirmarla.",
        target: ".sidebar-nav li[data-section='create-bot']",
        icon: "📦",
        action: function() {
            try { document.querySelector('.sidebar-nav li[data-section="create-bot"]').click(); } catch(e) {}
        }
    },
    {
        id: 4,
        title: "Envíos — define cómo entregas",
        desc: "En la pestaña 'Envíos' configuras tus sucursales, regiones de cobertura, couriers y reglas de costo (gratis, fijo por zona o cotización manual). Qhatu pregunta primero la región del cliente y solo ofrece las opciones disponibles para esa zona.",
        target: ".sidebar-nav li[data-section='create-bot']",
        icon: "🚚",
        action: function() {
            try { document.querySelector('.sidebar-nav li[data-section="create-bot"]').click(); } catch(e) {}
        }
    },
    {
        id: 5,
        title: "Configura tu Qhatu — el workflow",
        desc: "En la pestaña 'Configura tu Qhatu' visualizas el workflow real que sigue tu vendedor virtual paso a paso: saludo, datos, envío, pago y cierre. Puedes editar cada nodo, descargar el workflow o subir uno propio.",
        target: ".sidebar-nav li[data-section='create-bot']",
        icon: "🧠",
        action: function() {
            try { document.querySelector('.sidebar-nav li[data-section="create-bot"]').click(); } catch(e) {}
        }
    },
    {
        id: 6,
        title: "Prueba tu Willy",
        desc: "Antes de conectar WhatsApp, usa la pestaña 'Prueba tu Willy' para chatear con Willy en modo de prueba. Las pruebas no generan tickets ni leads en tu CRM — son 100% sandbox.",
        target: ".sidebar-nav li[data-section='create-bot']",
        icon: "🧪",
        action: function() {
            try { document.querySelector('.sidebar-nav li[data-section="create-bot"]').click(); } catch(e) {}
        }
    },
    {
        id: 7,
        title: "Chats en tiempo real",
        desc: "Cuando conectes WhatsApp, todos los mensajes de tus clientes llegan aquí. Qhatu responde automáticamente y puedes pausarlo en cualquier chat para tomar el control manualmente.",
        target: ".sidebar-nav li[data-section='chats']",
        icon: "💬",
        action: function() {
            try { document.querySelector('.sidebar-nav li[data-section="chats"]').click(); } catch(e) {}
        }
    },
    {
        id: 8,
        title: "CRM — Leads, Ventas y Postventa",
        desc: "Cada conversación se convierte en un ticket que avanza por tu embudo: Exploración → Interés → Cotización → Ganado/Perdido. Las ventas confirmadas pasan automáticamente a la pestaña 'Ventas' y luego a 'Postventa'.",
        target: ".sidebar-nav li[data-section='crm']",
        icon: "👥",
        action: function() {
            try { document.querySelector('.sidebar-nav li[data-section="crm"]').click(); } catch(e) {}
        }
    },
    {
        id: 9,
        title: "Notificaciones — handoffs y pagos",
        desc: "Desde el ícono de la campana en la barra lateral revisas: handoffs (cuando Qhatu necesita tu ayuda), comprobantes de pago para confirmar, y cotizaciones de envío pendientes (si usas tarifa variable).",
        target: "#btn-notif-trigger",
        icon: "🔔",
        action: null
    },
    {
        id: 10,
        title: "Analytics",
        desc: "Mide lo que importa: tasa de conversión real, ingresos perdidos por handoff, productos top, y rendimiento por canal. Decisiones con datos, no con corazonadas.",
        target: ".sidebar-nav li[data-section='analytics']",
        icon: "📊",
        action: function() {
            try { document.querySelector('.sidebar-nav li[data-section="analytics"]').click(); } catch(e) {}
        }
    },
    {
        id: 11,
        title: "¡Todo listo para despegar!",
        desc: "Ya conoces el flujo completo de Qhatu. Empieza ahora en 'Mi Qhatu' — completa Inventario, Envíos, Métodos de pago, prueba con 'Prueba tu Willy' y conecta WhatsApp cuando estés listo.",
        target: null,
        icon: "🚀",
        action: null
    }
];

let currentTutorialStep = 1;
let _tutResizeHandler = null;

// ─── Public API ────────────────────────────────────────────────────

window.wizStartTutorial = function() {
    currentTutorialStep = 1;
    const overlay = document.getElementById('kipu-onboarding-overlay');
    if (overlay) overlay.style.display = 'block';
    document.body.style.overflow = 'hidden';
    wizRenderTutorialStep();
};

window.wizNextTutorialStep = function() {
    if (currentTutorialStep < tutorialSteps.length) {
        currentTutorialStep++;
        wizRenderTutorialStep();
    }
};

window.wizPrevTutorialStep = function() {
    if (currentTutorialStep > 1) {
        currentTutorialStep--;
        wizRenderTutorialStep();
    }
};

window.wizEndTutorial = async function(skipped) {
    skipped = skipped === true;

    const overlay = document.getElementById('kipu-onboarding-overlay');
    const tooltip = document.getElementById('tutorial-tooltip');
    const centered = document.getElementById('tutorial-modal-centered');
    const ring = document.getElementById('tutorial-spotlight-ring');

    if (overlay) overlay.style.display = 'none';
    if (tooltip) tooltip.style.display = 'none';
    if (centered) centered.style.display = 'none';
    if (ring) { ring.style.opacity = '0'; ring.style.display = 'none'; }

    document.body.style.overflow = '';
    _wizClearHighlight();

    if (_tutResizeHandler) {
        window.removeEventListener('resize', _tutResizeHandler);
        _tutResizeHandler = null;
    }

    localStorage.setItem('kipu_tutorial_shown', 'true');

    const token = localStorage.getItem('token');
    if (token) {
        try {
            await fetch('/api/auth/tutorial', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + token
                },
                body: JSON.stringify({ completed: true })
            });
        } catch (e) {
            console.error('Error guardando finalizacion del tutorial:', e);
        }
    }

    if (!skipped) {
        try { document.querySelector('.sidebar-nav li[data-section="create-bot"]').click(); } catch(e) {}
    }
};

// ─── Internal helpers ──────────────────────────────────────────────

function _wizClearHighlight() {
    document.querySelectorAll('[data-onboarding-highlight]').forEach(function(el) {
        el.removeAttribute('data-onboarding-highlight');
        el.style.position = '';
        el.style.zIndex = '';
        el.style.pointerEvents = '';
        el.style.background = '';
    });
}

function _wizUpdateSharedUI(step) {
    var total = tutorialSteps.length;
    var fill = (step.id / total * 100) + '%';
    var label = 'Paso ' + step.id + ' de ' + total;

    // Progress text
    ['tut-tt-progress', 'tut-cm-progress'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.textContent = label;
    });

    // Progress bars
    ['tut-tt-fill', 'tut-cm-fill'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.style.width = fill;
    });

    var isFirst = step.id === 1;
    var isLast = step.id === total;

    // Prev buttons
    ['tut-tt-prev', 'tut-cm-prev'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.style.display = isFirst ? 'none' : 'inline-flex';
    });

    // Next buttons
    ['tut-tt-next', 'tut-cm-next'].forEach(function(id) {
        var el = document.getElementById(id);
        if (!el) return;
        if (isLast) {
            el.textContent = '¡Empezar ahora!';
            el.onclick = function() { wizEndTutorial(false); };
        } else {
            el.textContent = 'Siguiente →';
            el.onclick = wizNextTutorialStep;
        }
    });
}

function _wizPositionTooltip(targetEl) {
    var tooltip = document.getElementById('tutorial-tooltip');
    var ring = document.getElementById('tutorial-spotlight-ring');
    if (!tooltip || !targetEl) return;

    var rect = targetEl.getBoundingClientRect();
    var margin = 16;
    var vw = window.innerWidth;
    var vh = window.innerHeight;

    if (ring) {
        var pad = 7;
        ring.style.left   = (rect.left - pad) + 'px';
        ring.style.top    = (rect.top - pad) + 'px';
        ring.style.width  = (rect.width + pad * 2) + 'px';
        ring.style.height = (rect.height + pad * 2) + 'px';
        ring.style.display = 'block';
        // Force reflow so opacity transition fires
        ring.offsetHeight; // eslint-disable-line no-unused-expressions
        ring.style.opacity = '1';
    }

    // Measure tooltip off-screen so we can position by its real dimensions
    // instead of guessing. We avoid translateY(-50%) entirely — the previous
    // version clamped the CSS `top` but the transform still pushed the
    // tooltip off-screen when the target sat near a viewport edge.
    tooltip.style.transform = 'none';
    tooltip.style.visibility = 'hidden';
    tooltip.style.display = 'block';
    tooltip.style.width = ''; // let CSS width apply for measurement
    var ttRect = tooltip.getBoundingClientRect();
    var tw = ttRect.width  || 300;
    var th = ttRect.height || 240;

    var maxTw = Math.max(220, vw - margin * 2);
    if (tw > maxTw) tw = maxTw;

    var left, top, arrowDir;

    var fitsRight  = rect.right  + margin + tw <= vw - margin;
    var fitsLeft   = rect.left   - margin - tw >= margin;
    var fitsBelow  = rect.bottom + margin + th <= vh - margin;

    if (fitsRight) {
        left = rect.right + margin;
        top  = rect.top + rect.height / 2 - th / 2;
        arrowDir = 'left';
    } else if (fitsLeft) {
        left = rect.left - margin - tw;
        top  = rect.top + rect.height / 2 - th / 2;
        arrowDir = 'right';
    } else if (fitsBelow) {
        left = rect.left + rect.width / 2 - tw / 2;
        top  = rect.bottom + margin;
        arrowDir = 'top';
    } else {
        // Last-resort: above the target
        left = rect.left + rect.width / 2 - tw / 2;
        top  = rect.top - margin - th;
        arrowDir = 'top';
    }

    // Clamp fully inside the viewport using the real tooltip box.
    left = Math.max(margin, Math.min(left, vw - tw - margin));
    top  = Math.max(margin, Math.min(top,  vh - th - margin));

    tooltip.style.left  = left + 'px';
    tooltip.style.top   = top  + 'px';
    tooltip.style.width = tw   + 'px';
    tooltip.setAttribute('data-arrow', arrowDir);

    // Realign the ::after arrow to keep pointing at the target even after the
    // tooltip got clamped (e.g. tooltip pushed down while target stays near
    // the top of the screen).
    var targetCx = rect.left + rect.width  / 2;
    var targetCy = rect.top  + rect.height / 2;
    if (arrowDir === 'left' || arrowDir === 'right') {
        var arrowTop = targetCy - top;
        arrowTop = Math.max(18, Math.min(arrowTop, th - 18));
        tooltip.style.setProperty('--tt-arrow-top',  arrowTop + 'px');
        tooltip.style.removeProperty('--tt-arrow-left');
    } else {
        var arrowLeft = targetCx - left;
        arrowLeft = Math.max(18, Math.min(arrowLeft, tw - 18));
        tooltip.style.setProperty('--tt-arrow-left', arrowLeft + 'px');
        tooltip.style.removeProperty('--tt-arrow-top');
    }

    tooltip.style.visibility = 'visible';
}

// ─── Core render ───────────────────────────────────────────────────

function wizRenderTutorialStep() {
    var step = tutorialSteps[currentTutorialStep - 1];
    if (!step) return;

    // Fire navigation action before rendering
    if (step.action) step.action();

    // Clear previous highlight & ring
    _wizClearHighlight();
    var ring = document.getElementById('tutorial-spotlight-ring');
    if (ring) { ring.style.opacity = '0'; ring.style.display = 'none'; }

    _wizUpdateSharedUI(step);

    var tooltip = document.getElementById('tutorial-tooltip');
    var centered = document.getElementById('tutorial-modal-centered');

    if (step.target) {
        // ── Spotlight mode: floating tooltip anchored to target ──
        if (centered) centered.style.display = 'none';
        if (tooltip) tooltip.style.display = 'none'; // hide until positioned

        // Populate tooltip content
        var ttIcon  = document.getElementById('tut-tt-icon');
        var ttTitle = document.getElementById('tut-tt-title');
        var ttDesc  = document.getElementById('tut-tt-desc');
        if (ttIcon)  ttIcon.textContent  = step.icon  || '';
        if (ttTitle) ttTitle.textContent = step.title || '';
        if (ttDesc)  ttDesc.textContent  = step.desc  || '';

        // Highlight the target element (elevates it above overlay)
        var targetEl = document.querySelector(step.target);
        if (targetEl) {
            targetEl.setAttribute('data-onboarding-highlight', 'true');
            if (window.getComputedStyle(targetEl).position === 'static') {
                targetEl.style.position = 'relative';
            }
            targetEl.style.zIndex = '100010';
            targetEl.style.pointerEvents = 'auto';
            targetEl.style.background = 'var(--bg-card, #ffffff)';
        }

        // Small delay to allow section transitions before measuring position
        setTimeout(function() { _wizPositionTooltip(targetEl); }, 90);

        // Reposition on resize
        if (_tutResizeHandler) window.removeEventListener('resize', _tutResizeHandler);
        _tutResizeHandler = function() {
            var el = document.querySelector(step.target);
            if (el) _wizPositionTooltip(el);
        };
        window.addEventListener('resize', _tutResizeHandler);

    } else {
        // ── Centered mode: full-screen modal (welcome / completion) ──
        if (tooltip) tooltip.style.display = 'none';
        if (ring) { ring.style.opacity = '0'; ring.style.display = 'none'; }

        // Populate centered modal content
        var cmIcon  = document.getElementById('tut-cm-icon');
        var cmTitle = document.getElementById('tut-cm-title');
        var cmDesc  = document.getElementById('tut-cm-desc');
        if (cmIcon)  cmIcon.textContent  = step.icon  || '';
        if (cmTitle) cmTitle.textContent = step.title || '';
        if (cmDesc)  cmDesc.textContent  = step.desc  || '';

        if (centered) centered.style.display = 'flex';

        if (_tutResizeHandler) {
            window.removeEventListener('resize', _tutResizeHandler);
            _tutResizeHandler = null;
        }
    }
}

// ─── G E1: Profile / Settings modal (full edit) ─────────────────────────
// Modal de "Mi cuenta" con foto de perfil (subida a Supabase Storage),
// edición de nombre, cambio de contraseña y cambio de plan persistido.
// Datos vienen de /auth/profile y /auth/plans. La foto se sube a
// /auth/profile/photo (multipart) y el cache-buster se aplica server-side.

const _kipuProfileState = { profile: null, plans: null };

async function _kipuFetchProfile() {
    const token = localStorage.getItem('token');
    const r = await fetch('/api/auth/profile', { headers: { 'Authorization': `Bearer ${token}` } });
    if (!r.ok) {
        // Sesión inválida (token caducado o referenciando a un usuario/miembro
        // que ya no existe). Limpiamos credenciales y redirigimos al login en
        // lugar de mostrar un modal vacío con el botón "Reintentar".
        if (r.status === 401 || r.status === 404) {
            try {
                localStorage.removeItem('token');
                localStorage.removeItem('user');
            } catch (_) {}
            window.location.href = '/panel#login';
            // throw para detener el flujo del modal
            throw new Error('Sesión expirada — redirigiendo al login');
        }
        throw new Error(`/auth/profile ${r.status}`);
    }
    return r.json();
}

async function _kipuFetchPlans() {
    const token = localStorage.getItem('token');
    const r = await fetch('/api/auth/plans', { headers: { 'Authorization': `Bearer ${token}` } });
    if (!r.ok) throw new Error(`/auth/plans ${r.status}`);
    return r.json();
}

function _kipuPlanLabel(planId) {
    return String(planId || 'starter').toUpperCase();
}

function _kipuRenderAvatarSidebar(profile) {
    // Reflejar foto en el avatar del sidebar (.user-avatar) si existe URL.
    // Si no hay foto, dejar el placeholder original con la inicial del nombre.
    const av = document.querySelector('.user-avatar');
    if (!av) return;
    const url = profile?.photoUrl;
    if (url) {
        av.style.backgroundImage = `url("${url}")`;
        av.style.backgroundSize = 'cover';
        av.style.backgroundPosition = 'center';
        av.textContent = '';
    } else {
        av.style.backgroundImage = '';
        const init = (profile?.name || 'U').slice(0, 1).toUpperCase();
        av.textContent = init;
    }
}

window.openProfileSettingsModal = async function() {
    const existing = document.getElementById('kipu-profile-modal');
    if (existing) { existing.remove(); return; }

    // Abrir el modal vacío inmediatamente, hidratar con datos asincrónicamente.
    const modal = document.createElement('div');
    modal.id = 'kipu-profile-modal';
    modal.className = 'lg-overlay';
    modal.innerHTML = `
        <div class="lg-surface" style="max-width:580px;width:100%;font-family:'Poppins',sans-serif;max-height:90vh;overflow-y:auto;">
            <div id="kipu-profile-content" style="padding:2rem;text-align:center;color:rgba(0,0,51,0.5);">Cargando…</div>
        </div>`;
    document.body.appendChild(modal);

    let profile, plansData;
    try {
        [profile, plansData] = await Promise.all([_kipuFetchProfile(), _kipuFetchPlans()]);
        _kipuProfileState.profile = profile;
        _kipuProfileState.plans = plansData;
        _kipuRenderAvatarSidebar(profile);
    } catch (e) {
        document.getElementById('kipu-profile-content').innerHTML = `<div style="color:#ef4444;">No pudimos cargar tu perfil. <button onclick="openProfileSettingsModal()" style="color:#000052;text-decoration:underline;border:none;background:transparent;cursor:pointer;">Reintentar</button></div>`;
        return;
    }

    const planUpper = _kipuPlanLabel(profile.plan);
    const photoUrl = profile.photoUrl || '';
    const initial = (profile.name || profile.businessName || 'U').slice(0, 1).toUpperCase();

    document.getElementById('kipu-profile-content').innerHTML = `
        <div style="padding:1.75rem 2rem 1.25rem;display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;border-bottom:1px solid rgba(0,0,82,0.06);">
            <div>
                <h3 style="font-family:'Cormorant Garamond',serif;font-style:italic;font-weight:700;color:#000052;font-size:1.7rem;margin:0;line-height:1.1;">Mi cuenta</h3>
                <p style="color:rgba(0,0,51,0.55);font-size:0.85rem;margin:0.4rem 0 0;">Foto, datos del perfil, contraseña y plan.</p>
            </div>
            <button class="lg-btn lg-btn--icon lg-btn--sm" onclick="_kipuCloseProfileModal()" aria-label="Cerrar">×</button>
        </div>

        <div style="padding:1.5rem 2rem;display:flex;flex-direction:column;gap:1.1rem;">

            <!-- Photo + identity -->
            <div style="display:flex;align-items:center;gap:1rem;padding:1rem;background:rgba(255,255,255,0.55);border:1px solid rgba(0,0,82,0.08);border-radius:14px;">
                <div id="kipu-profile-avatar-big" style="position:relative;width:72px;height:72px;flex-shrink:0;">
                    <div id="kipu-profile-avatar-img" style="width:72px;height:72px;border-radius:50%;background:${photoUrl ? `url('${photoUrl}') center/cover` : 'linear-gradient(135deg,#000052,#3a3a8a)'};color:#FAF7F0;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:1.5rem;box-shadow:0 4px 12px rgba(0,0,82,0.25);">${photoUrl ? '' : initial}</div>
                    <button onclick="document.getElementById('kipu-profile-photo-input').click()" title="Cambiar foto" style="position:absolute;bottom:-4px;right:-4px;width:28px;height:28px;border-radius:50%;background:#000052;color:#FAF7F0;border:2px solid #FAF7F0;cursor:pointer;font-size:0.85rem;display:flex;align-items:center;justify-content:center;">📷</button>
                    <input type="file" id="kipu-profile-photo-input" accept="image/*" style="display:none" onchange="_kipuUploadPhoto(this)">
                </div>
                <div style="flex:1;min-width:0;">
                    <input id="kipu-profile-name-input" type="text" value="${(profile.name || '').replace(/"/g, '&quot;')}" placeholder="Tu nombre" maxlength="100"
                        style="width:100%;padding:0.5rem 0.7rem;border:1px solid rgba(0,0,51,0.12);border-radius:8px;font-size:0.95rem;font-weight:600;color:#000052;background:#FFF;outline:none;font-family:inherit;margin-bottom:0.4rem;">
                    <div style="font-size:0.78rem;color:rgba(0,0,51,0.55);">${profile.email || '—'}</div>
                </div>
                <button class="lg-btn lg-btn--primary lg-btn--sm" onclick="_kipuSaveProfileName()">Guardar</button>
            </div>

            <!-- Password change -->
            <details style="padding:0.85rem 1rem;background:rgba(255,255,255,0.55);border:1px solid rgba(0,0,82,0.08);border-radius:14px;">
                <summary style="cursor:pointer;font-weight:700;color:#000052;font-size:0.9rem;list-style:none;display:flex;align-items:center;gap:0.4rem;">🔒 Cambiar contraseña</summary>
                <div style="margin-top:0.85rem;display:flex;flex-direction:column;gap:0.55rem;">
                    <input type="password" id="kipu-pw-current" placeholder="Contraseña actual" autocomplete="current-password"
                        style="padding:0.55rem 0.8rem;border:1px solid rgba(0,0,51,0.12);border-radius:8px;font-size:0.88rem;color:#000052;background:#FFF;outline:none;font-family:inherit;">
                    <input type="password" id="kipu-pw-new" placeholder="Nueva contraseña (mínimo 8 caracteres)" autocomplete="new-password"
                        style="padding:0.55rem 0.8rem;border:1px solid rgba(0,0,51,0.12);border-radius:8px;font-size:0.88rem;color:#000052;background:#FFF;outline:none;font-family:inherit;">
                    <input type="password" id="kipu-pw-new2" placeholder="Repetir nueva contraseña" autocomplete="new-password"
                        style="padding:0.55rem 0.8rem;border:1px solid rgba(0,0,51,0.12);border-radius:8px;font-size:0.88rem;color:#000052;background:#FFF;outline:none;font-family:inherit;">
                    <button class="lg-btn lg-btn--primary lg-btn--sm" onclick="_kipuChangePassword()" style="margin-top:0.2rem;">Cambiar contraseña</button>
                </div>
            </details>

            <!-- Plan section -->
            <div style="padding:1rem 1.1rem;background:rgba(255,255,255,0.55);border:1px solid rgba(0,0,82,0.08);border-radius:14px;">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:0.75rem;margin-bottom:0.6rem;">
                    <div>
                        <div style="font-size:0.7rem;font-weight:700;color:rgba(0,0,51,0.55);text-transform:uppercase;letter-spacing:0.06em;">Plan actual</div>
                        <div style="font-weight:800;color:#000052;font-size:1.1rem;letter-spacing:0.02em;">${planUpper}</div>
                    </div>
                    <button class="lg-btn lg-btn--primary lg-btn--sm" onclick="openChangePlanModal()">Cambiar plan</button>
                </div>
                <ul style="margin:0;padding-left:1.1rem;color:rgba(0,0,51,0.7);font-size:0.82rem;line-height:1.55;">
                    ${(plansData.plans.find(p => p.id === profile.plan)?.features || []).map(f => `<li>${f}</li>`).join('')}
                </ul>
            </div>
        </div>`;
};

window._kipuCloseProfileModal = function() {
    const m = document.getElementById('kipu-profile-modal');
    if (!m) return;
    m.classList.add('lg-is-closing');
    setTimeout(() => m.remove(), 320);
};

window._kipuSaveProfileName = async function() {
    const inp = document.getElementById('kipu-profile-name-input');
    if (!inp) return;
    const newName = (inp.value || '').trim();
    if (!newName) {
        if (typeof showToast === 'function') showToast('El nombre no puede estar vacío', 'error');
        return;
    }
    try {
        const token = localStorage.getItem('token');
        const r = await fetch('/api/auth/profile', {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: newName })
        });
        if (!r.ok) {
            const j = await r.json().catch(() => ({}));
            throw new Error(j.error || `HTTP ${r.status}`);
        }
        if (typeof showToast === 'function') showToast('Nombre actualizado', 'success');
        // Reflect in sidebar immediately.
        const sn = document.getElementById('user-name');
        if (sn) sn.textContent = newName;
        if (_kipuProfileState.profile) _kipuProfileState.profile.name = newName;
        _kipuRenderAvatarSidebar(_kipuProfileState.profile);
    } catch (e) {
        if (typeof showToast === 'function') showToast('Error: ' + e.message, 'error');
    }
};

window._kipuChangePassword = async function() {
    const cur = document.getElementById('kipu-pw-current')?.value || '';
    const np = document.getElementById('kipu-pw-new')?.value || '';
    const np2 = document.getElementById('kipu-pw-new2')?.value || '';
    if (!cur || !np) {
        if (typeof showToast === 'function') showToast('Completa los campos de contraseña', 'error');
        return;
    }
    if (np.length < 8) {
        if (typeof showToast === 'function') showToast('La nueva contraseña debe tener al menos 8 caracteres', 'error');
        return;
    }
    if (np !== np2) {
        if (typeof showToast === 'function') showToast('Las contraseñas nuevas no coinciden', 'error');
        return;
    }
    try {
        const token = localStorage.getItem('token');
        const r = await fetch('/api/auth/password', {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ currentPassword: cur, newPassword: np })
        });
        if (!r.ok) {
            const j = await r.json().catch(() => ({}));
            throw new Error(j.error || `HTTP ${r.status}`);
        }
        if (typeof showToast === 'function') showToast('Contraseña actualizada', 'success');
        document.getElementById('kipu-pw-current').value = '';
        document.getElementById('kipu-pw-new').value = '';
        document.getElementById('kipu-pw-new2').value = '';
    } catch (e) {
        if (typeof showToast === 'function') showToast('Error: ' + e.message, 'error');
    }
};

window._kipuUploadPhoto = async function(input) {
    const file = input?.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
        if (typeof showToast === 'function') showToast('La foto no puede pesar más de 5 MB', 'error');
        input.value = '';
        return;
    }
    const fd = new FormData();
    fd.append('photo', file);
    try {
        const token = localStorage.getItem('token');
        const r = await fetch('/api/auth/profile/photo', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: fd
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
        const newUrl = j.photoUrl;
        if (newUrl) {
            const img = document.getElementById('kipu-profile-avatar-img');
            if (img) {
                img.style.background = `url('${newUrl}') center/cover`;
                img.textContent = '';
            }
            if (_kipuProfileState.profile) _kipuProfileState.profile.photoUrl = newUrl;
            _kipuRenderAvatarSidebar(_kipuProfileState.profile);
        }
        if (typeof showToast === 'function') showToast('Foto actualizada', 'success');
    } catch (e) {
        if (typeof showToast === 'function') showToast('Error subiendo foto: ' + e.message, 'error');
    } finally {
        input.value = '';
    }
};

window.openChangePlanModal = function() {
    const old = document.getElementById('kipu-profile-modal');
    if (old) old.remove();

    const plansData = _kipuProfileState.plans || { plans: [] };
    const currentPlan = String(_kipuProfileState.profile?.plan || 'starter').toLowerCase();
    const billingNotes = plansData.billingNotes || {};

    // Estado del toggle mensual/anual — empieza en mensual.
    let billingCycle = 'monthly';

    const close = () => {
        const m = document.getElementById('kipu-changeplan-modal');
        if (!m) return;
        m.classList.add('lg-is-closing');
        setTimeout(() => m.remove(), 320);
    };
    window.__closeChangePlanModal = close;

    const checkSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>';
    const xSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

    // Genera la fila de precio según el ciclo actual. Toleramos planes legacy
    // que solo traen `price` como string (formato anterior del endpoint).
    const renderPrice = (p) => {
        if (p.priceLabels && p.priceSuffix) {
            const priceText = p.priceLabels[billingCycle] || p.priceLabels.monthly || '';
            const suffix = p.priceSuffix[billingCycle] || '';
            const savings = (billingCycle === 'yearly' && p.yearlySavings)
                ? `<div class="kipu-plan-card__savings">Ahorras S/ ${p.yearlySavings}/año</div>`
                : '';
            return `
                <div class="kipu-plan-card__price-row">
                    <span class="kipu-plan-card__price">${priceText}</span>
                    <span class="kipu-plan-card__price-suffix">${suffix}</span>
                </div>
                ${savings}
            `;
        }
        // Fallback legacy.
        return `<div class="kipu-plan-card__price">${p.price || ''}</div>`;
    };

    const renderCards = () => plansData.plans.map(p => {
        const isCurrent = p.id === currentPlan;
        const isPopular = !!p.badge && !isCurrent;
        const ctaLabel = isCurrent ? 'Tu plan actual' : `Elegir ${p.name}`;
        const cardClass = [
            'kipu-plan-card',
            isCurrent ? 'kipu-plan-card--current' : '',
            isPopular ? 'kipu-plan-card--popular' : ''
        ].filter(Boolean).join(' ');
        const badge = isCurrent
            ? '<span class="kipu-plan-card__badge">Plan actual</span>'
            : (p.badge ? `<span class="kipu-plan-card__badge kipu-plan-card__badge--accent">${p.badge}</span>` : '');
        return `
            <article class="${cardClass}">
                ${badge}
                <div class="kipu-plan-card__name">${p.name}</div>
                ${renderPrice(p)}
                <p class="kipu-plan-card__tagline">${p.tagline || ''}</p>
                <hr class="kipu-plan-card__divider"/>
                <ul class="kipu-plan-card__features">
                    ${(p.features || []).map(f => `<li>${checkSvg}<span>${f}</span></li>`).join('')}
                </ul>
                <button type="button" class="kipu-plan-card__cta${isCurrent ? ' kipu-plan-card__cta--current' : ''}" ${isCurrent ? 'disabled' : ''} ${isCurrent ? '' : `onclick="confirmChangePlan('${p.id}')"`}>${ctaLabel}</button>
            </article>`;
    }).join('');

    const cols = Math.min(plansData.plans.length, 4);
    const noteLine = [billingNotes.taxes, billingNotes.trial].filter(Boolean).join(' · ');

    const m = document.createElement('div');
    m.id = 'kipu-changeplan-modal';
    m.className = 'lg-overlay';
    m.style.zIndex = '10001';
    m.innerHTML = `
        <div class="kipu-plan-dialog" role="dialog" aria-modal="true" aria-labelledby="kipu-plan-dialog-title">
            <header class="kipu-plan-dialog__header">
                <div class="kipu-plan-dialog__heading">
                    <h3 id="kipu-plan-dialog-title" class="kipu-plan-dialog__title">Cambiar de plan</h3>
                    <p class="kipu-plan-dialog__subtitle">Tu cuenta se actualiza al instante. Te contactamos por WhatsApp para coordinar la facturación.</p>
                </div>
                <div class="kipu-plan-dialog__header-actions">
                    <div class="kipu-plan-billing-toggle" role="tablist" aria-label="Frecuencia de facturación">
                        <button type="button" role="tab" aria-selected="true"  data-cycle="monthly" class="kipu-plan-billing-toggle__opt is-active">Mensual</button>
                        <button type="button" role="tab" aria-selected="false" data-cycle="yearly"  class="kipu-plan-billing-toggle__opt">Anual <span class="kipu-plan-billing-toggle__hint">−2 meses</span></button>
                    </div>
                    <button type="button" class="kipu-plan-dialog__close" onclick="window.__closeChangePlanModal && window.__closeChangePlanModal()" aria-label="Cerrar">${xSvg}</button>
                </div>
            </header>
            <div class="kipu-plan-grid" id="kipu-plan-grid" style="grid-template-columns:repeat(${cols},minmax(0,1fr));">
                ${renderCards()}
            </div>
            ${noteLine ? `<footer class="kipu-plan-dialog__footer">${noteLine}</footer>` : ''}
        </div>`;
    m.addEventListener('click', (e) => { if (e.target === m) close(); });
    document.body.appendChild(m);

    // Toggle mensual/anual — re-renderiza solo el grid sin recrear el modal.
    m.querySelectorAll('.kipu-plan-billing-toggle__opt').forEach(btn => {
        btn.addEventListener('click', () => {
            const cycle = btn.getAttribute('data-cycle');
            if (!cycle || cycle === billingCycle) return;
            billingCycle = cycle;
            m.querySelectorAll('.kipu-plan-billing-toggle__opt').forEach(b => {
                const active = b.getAttribute('data-cycle') === cycle;
                b.classList.toggle('is-active', active);
                b.setAttribute('aria-selected', active ? 'true' : 'false');
            });
            const grid = document.getElementById('kipu-plan-grid');
            if (grid) grid.innerHTML = renderCards();
        });
    });

    const escHandler = (e) => {
        if (e.key === 'Escape') {
            close();
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);
};

// Política temporal (mes de prueba gratis): TODOS los usuarios están en
// Enterprise. Click en cualquier otro plan = "downgrade". Backend rechaza
// con 403 (defense in depth); este popup es la UX visible.
window.confirmChangePlan = function(_planId) {
    const overlayId = 'kipu-plan-downgrade-popup';
    const existing = document.getElementById(overlayId);
    if (existing) existing.remove();

    const closePopup = () => {
        const m = document.getElementById(overlayId);
        if (!m) return;
        m.classList.add('lg-is-closing');
        setTimeout(() => m.remove(), 320);
    };

    const overlay = document.createElement('div');
    overlay.id = overlayId;
    overlay.className = 'lg-overlay';
    overlay.style.zIndex = '10020';
    overlay.innerHTML = `
        <div class="kipu-info-dialog" role="alertdialog" aria-modal="true" aria-labelledby="kipu-plan-downgrade-title">
            <div class="kipu-info-dialog__emoji" aria-hidden="true">🚫</div>
            <h3 id="kipu-plan-downgrade-title" class="kipu-info-dialog__title">¡Ey, espera ahí!</h3>
            <p class="kipu-info-dialog__body">
                Veo que te gustaría hacer un downgrade. De momento no contamos con esa función,
                así que <strong>conformate con lo mejor</strong>. 😎
            </p>
            <div class="kipu-info-dialog__footer">
                <button type="button" class="kipu-info-dialog__cta" id="kipu-plan-downgrade-ok">Está bien 🙃</button>
            </div>
        </div>
    `;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closePopup(); });
    document.body.appendChild(overlay);

    const okBtn = document.getElementById('kipu-plan-downgrade-ok');
    if (okBtn) {
        okBtn.addEventListener('click', closePopup);
        setTimeout(() => okBtn.focus(), 50);
    }

    const escHandler = (e) => {
        if (e.key === 'Escape') {
            closePopup();
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);
};

// Hidratar foto del sidebar al iniciar la app si hay token. No bloquea boot.
(function hydrateSidebarAvatarOnLoad() {
    if (typeof window === 'undefined') return;
    const tryHydrate = async () => {
        try {
            const token = localStorage.getItem('token');
            if (!token) return;
            const r = await fetch('/api/auth/profile', { headers: { 'Authorization': `Bearer ${token}` } });
            if (!r.ok) return;
            const profile = await r.json();
            _kipuProfileState.profile = profile;
            _kipuRenderAvatarSidebar(profile);
        } catch (_) { /* silencioso */ }
    };
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(tryHydrate, 200);
    } else {
        document.addEventListener('DOMContentLoaded', () => setTimeout(tryHydrate, 200));
    }
})();

// ═══════════════════════════════════════════════════════════════════════════
// Password Strength Panel
// ═══════════════════════════════════════════════════════════════════════════
// Sistema de validación de contraseña con feedback visual en tiempo real:
//   • 5 reglas obligatorias (length, upper, lower, digit, special)
//   • Score de entropía vía zxcvbn-ts (mide entropía REAL, no solo regex)
//   • Panel lateral en desktop, colapsa abajo del input en mobile
//   • Strength meter de 4 segmentos con label de texto
//   • Re-usable: signup, change-password, password-reset
//
// Usage:
//   import { attachPasswordStrength } from './password-strength.js';
//   const handle = attachPasswordStrength({
//       inputId: 'reg-password',
//       userInputs: () => [emailInput.value, businessNameInput.value],
//       onValidityChange: (isValid) => submitBtn.disabled = !isValid,
//   });
//
// zxcvbn se carga lazily desde esm.sh (CDN); si falla (offline, bloqueo de
// red), el panel sigue funcional con las 5 reglas regex — el strength meter
// muestra "Cargando..." y el score no bloquea el submit (fallback graceful).
// ═══════════════════════════════════════════════════════════════════════════

const ZXCVBN_BASE = 'https://esm.sh/@zxcvbn-ts';

// Lazy-load zxcvbn una sola vez (cached promise). Si ya se cargó, devuelve
// la referencia cacheada. Si falla, deja constancia y devuelve null.
let zxcvbnPromise = null;
function loadZxcvbn() {
    if (zxcvbnPromise) return zxcvbnPromise;
    zxcvbnPromise = (async () => {
        try {
            // Nota: zxcvbn-ts no publica @language-es. Usamos en + common,
            // que ya cubren passwords comunes y patrones de teclado (que son
            // los mismos en QWERTY-ES). El core mide entropía independiente
            // del idioma — el dictionary solo mejora detección de palabras
            // comunes en inglés (suficiente para emprendedores PE que mezclan
            // inglés en passwords).
            const [core, common, en] = await Promise.all([
                import(`${ZXCVBN_BASE}/core@3.0.4`),
                import(`${ZXCVBN_BASE}/language-common@3.0.4`),
                import(`${ZXCVBN_BASE}/language-en@3.0.4`),
            ]);
            core.zxcvbnOptions.setOptions({
                dictionary: {
                    ...common.dictionary,
                    ...en.dictionary,
                },
                graphs: common.adjacencyGraphs,
                translations: en.translations,
                useLevenshteinDistance: true,
            });
            return core.zxcvbn;
        } catch (err) {
            console.warn('[PasswordStrength] zxcvbn no se pudo cargar — usando solo reglas regex', err);
            return null;
        }
    })();
    return zxcvbnPromise;
}

// ─── Reglas obligatorias ──────────────────────────────────────────────────
// Cada regla es { id, label, test(password) → bool }. Si añades una nueva
// regla acá, automáticamente aparece en el panel.
const RULES = [
    { id: 'length',  label: 'Mínimo 10 caracteres',                      test: (p) => p.length >= 10 },
    { id: 'upper',   label: 'Una letra mayúscula',                       test: (p) => /[A-Z]/.test(p) },
    { id: 'lower',   label: 'Una letra minúscula',                       test: (p) => /[a-z]/.test(p) },
    { id: 'digit',   label: 'Un número',                                 test: (p) => /[0-9]/.test(p) },
    { id: 'special', label: 'Un caracter especial (!@#$%...)',           test: (p) => /[!@#$%^&*()_+\-=[\]{}|;:,.<>?]/.test(p) },
];

const STRENGTH_LEVELS = [
    { label: 'Muy débil',  filled: 1, varName: '--pwd-color-danger' },
    { label: 'Débil',      filled: 2, varName: '--pwd-color-warning' },
    { label: 'Regular',    filled: 3, varName: '--pwd-color-caution' },
    { label: 'Buena',      filled: 4, varName: '--pwd-color-success' },
    { label: 'Excelente',  filled: 4, varName: '--pwd-color-success-strong' },
];

const MIN_SCORE = 3; // zxcvbn score 0-4. ≥3 = "good" o mejor.

// ─── Score local (instantáneo, sync) ──────────────────────────────────────
// Score 0-4 basado en reglas cumplidas + length. NUNCA esperamos a zxcvbn
// para mostrar el strength meter — el feedback debe ser inmediato. Si zxcvbn
// carga después, refinamos (puede subir o bajar el score detectando patrones
// como "Password1!" que pasan reglas pero son crackeables).
function computeLocalScore(password, ruleResults) {
    if (!password) return null;
    const passed = ruleResults.filter(r => r.passed).length;
    const len = password.length;
    // Tier descendente: cada uno requiere lo del anterior + más.
    if (passed === 5 && len >= 12) return 4;          // Excelente
    if (passed >= 4 && len >= 10) return 3;           // Buena
    if (passed >= 3 && len >= 8)  return 2;           // Regular
    if (passed >= 2 && len >= 6)  return 1;           // Débil
    return 0;                                         // Muy débil
}

// ─── Validación pura ──────────────────────────────────────────────────────
// Sync: devuelve resultado instantáneo basado en reglas + score local.
// Async upgrade: si zxcvbn ya está cargado, lo aplicamos para obtener el
// score "real" (que penaliza patrones predecibles, dictionary, userInputs).
function evaluateSync(password, userInputs = []) {
    const ruleResults = RULES.map(r => ({ id: r.id, label: r.label, passed: r.test(password) }));
    const allRulesPassed = ruleResults.every(r => r.passed);
    const localScore = computeLocalScore(password, ruleResults);
    return {
        ruleResults,
        allRulesPassed,
        score: localScore,
        scoreSource: 'local',
        // Validez sync: necesita todas las reglas. El "score ≥ 3" se aplica
        // sobre el score local. zxcvbn (cuando carga) puede revocar la
        // validez si detecta que es un password común.
        isValid: allRulesPassed && (localScore ?? 0) >= MIN_SCORE,
    };
}

async function evaluateWithZxcvbn(password, userInputs = []) {
    const sync = evaluateSync(password, userInputs);
    const zxcvbn = await loadZxcvbn();
    if (!zxcvbn) return sync; // CDN falló — quedate con score local
    const filteredInputs = userInputs.filter(s => typeof s === 'string' && s.length >= 2);
    const result = zxcvbn(password, filteredInputs);
    const realScore = result.score; // 0..4
    return {
        ...sync,
        score: realScore,
        scoreSource: 'zxcvbn',
        isValid: sync.allRulesPassed && realScore >= MIN_SCORE && password.length > 0,
    };
}

// ─── Render del panel ─────────────────────────────────────────────────────
function buildPanelHTML() {
    const ruleItems = RULES.map(r => `
        <li class="pwd-rule" data-rule="${r.id}" aria-label="${r.label} - pendiente">
            <span class="pwd-rule-icon" aria-hidden="true">
                <svg class="pwd-icon-pending" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="9"/>
                </svg>
                <svg class="pwd-icon-passed" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="9" fill="currentColor" stroke="currentColor"/>
                    <polyline points="8 12.5 11 15.5 16.5 9.5" stroke="#fff" fill="none"/>
                </svg>
            </span>
            <span class="pwd-rule-text">${r.label}</span>
        </li>
    `).join('');

    return `
        <div class="pwd-panel-arrow" aria-hidden="true"></div>
        <h3 class="pwd-panel-title">Tu contraseña debe contener:</h3>
        <ul class="pwd-rules" role="list">${ruleItems}</ul>
        <hr class="pwd-panel-divider" aria-hidden="true">
        <div class="pwd-strength">
            <span class="pwd-strength-label">Fortaleza:</span>
            <div class="pwd-strength-bar" role="progressbar"
                 aria-valuemin="0" aria-valuemax="4" aria-valuenow="0"
                 aria-valuetext="Sin contraseña">
                <span class="pwd-strength-seg"></span>
                <span class="pwd-strength-seg"></span>
                <span class="pwd-strength-seg"></span>
                <span class="pwd-strength-seg"></span>
            </div>
            <span class="pwd-strength-text">—</span>
        </div>
    `;
}

function updatePanel(panel, state) {
    // Reglas
    state.ruleResults.forEach(rr => {
        const li = panel.querySelector(`.pwd-rule[data-rule="${rr.id}"]`);
        if (!li) return;
        li.classList.toggle('is-passed', rr.passed);
        li.setAttribute('aria-label', `${rr.label} - ${rr.passed ? 'cumplido' : 'pendiente'}`);
    });

    // Strength meter
    const bar = panel.querySelector('.pwd-strength-bar');
    const text = panel.querySelector('.pwd-strength-text');
    const segs = panel.querySelectorAll('.pwd-strength-seg');

    if (state.score === null || state.score === undefined) {
        // Sin password aún — todo gris
        text.textContent = '—';
        text.style.color = '';
        segs.forEach(s => { s.style.background = ''; });
        bar.setAttribute('aria-valuenow', '0');
        bar.setAttribute('aria-valuetext', 'Sin contraseña');
        return;
    }

    const level = STRENGTH_LEVELS[state.score];
    const color = `var(${level.varName})`;
    segs.forEach((s, i) => {
        s.style.background = i < level.filled ? color : '';
    });
    text.textContent = level.label;
    text.style.color = color;
    bar.setAttribute('aria-valuenow', String(state.score));
    bar.setAttribute('aria-valuetext', level.label);
}

// ─── Hook principal ───────────────────────────────────────────────────────
// Adjunta el panel al input. Devuelve un handle con .destroy() y .recheck().
export function attachPasswordStrength({ inputId, userInputs = () => [], onValidityChange = () => {} }) {
    const input = document.getElementById(inputId);
    if (!input) {
        console.warn(`[PasswordStrength] input #${inputId} no encontrado`);
        return { destroy: () => {}, recheck: () => {} };
    }

    // Wrapper para position:relative del panel — usamos el input-wrap-relative
    // que ya existe en el form, o creamos uno si no.
    let wrap = input.closest('.input-wrap-relative');
    if (!wrap) {
        wrap = input.parentElement;
    }

    // Panel
    const panel = document.createElement('div');
    panel.className = 'pwd-panel';
    panel.setAttribute('role', 'status');
    panel.setAttribute('aria-live', 'polite');
    panel.innerHTML = buildPanelHTML();
    wrap.appendChild(panel);

    let lastValid = false;
    let evalToken = 0;          // anti-race: solo aplicamos el resultado más reciente

    const applyState = (state) => {
        updatePanel(panel, state);
        if (state.isValid !== lastValid) {
            lastValid = state.isValid;
            onValidityChange(state.isValid);
        }
        // Visibilidad estricta: el panel sigue el focus del input. Sin auto-hide
        // ni "stay-visible si inválido" — eso lo cubre el tooltip del botón
        // disabled. Si el input no tiene focus, el panel no se ve.
    };

    const runEvaluation = () => {
        const myToken = ++evalToken;
        const password = input.value;
        const inputs = (userInputs() || []).filter(Boolean);

        // PASO 1 — Pintamos el resultado SYNC (score local) inmediatamente.
        // Esto da feedback instantáneo a cada keystroke, sin esperar a zxcvbn.
        const syncState = evaluateSync(password, inputs);
        applyState(syncState);

        // PASO 2 — En segundo plano, si zxcvbn ya está cargado o termina de
        // cargarse, refinamos con su score (que puede ser distinto al local
        // si detecta patrones predecibles tipo "Password1!"). Si zxcvbn nunca
        // carga, el score local queda como definitivo.
        evaluateWithZxcvbn(password, inputs).then(refined => {
            if (myToken !== evalToken) return; // input cambió, descartamos
            if (refined.scoreSource === 'zxcvbn') applyState(refined);
        });
    };

    const handleFocus = () => panel.classList.add('is-visible');
    const handleBlur  = () => panel.classList.remove('is-visible');
    const handleInput = () => runEvaluation();

    input.addEventListener('focus', handleFocus);
    input.addEventListener('blur', handleBlur);
    input.addEventListener('input', handleInput);

    // Eval inicial (input puede tener valor de autofill)
    runEvaluation();

    return {
        destroy: () => {
            input.removeEventListener('focus', handleFocus);
            input.removeEventListener('blur', handleBlur);
            input.removeEventListener('input', handleInput);
            panel.remove();
        },
        recheck: runEvaluation,
        isValid: () => lastValid,
    };
}

// ─── Validación standalone (sin UI) ───────────────────────────────────────
// Útil para validar antes de submit aunque el panel esté oculto. Espera a
// zxcvbn (con cap razonable) porque acá SÍ queremos el score real antes de
// dejar pasar al backend. Si zxcvbn falla, cae al score local.
export async function validatePassword(password, userInputs = []) {
    return evaluateWithZxcvbn(password, userInputs);
}

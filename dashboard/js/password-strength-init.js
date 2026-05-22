// ═══════════════════════════════════════════════════════════════════════════
// Password Strength — Auto-init para el form de registro
// ═══════════════════════════════════════════════════════════════════════════
// Wires el panel al input #reg-password apenas el DOM está listo. Vive en un
// archivo separado (en vez de inline en index.html) para que sea fácil reusar
// el mismo wiring desde otras pantallas (cambio de password, recovery).
//
// Acciones:
//   1. Adjunta el panel al #reg-password.
//   2. Le pasa email + business name como `userInputs` para que zxcvbn
//      penalice si la password los contiene.
//   3. Habilita/deshabilita el botón "Crear cuenta" según validez.
//   4. Tooltip claro en el botón deshabilitado.
//   5. Re-validación si el email/businessName cambian (ya que afectan score).
// ═══════════════════════════════════════════════════════════════════════════

import { attachPasswordStrength, validatePassword } from './password-strength.js';

const TOOLTIP_DISABLED = 'Tu contraseña aún no cumple los requisitos de seguridad';

function init() {
    const passwordInput = document.getElementById('reg-password');
    const emailInput = document.getElementById('reg-email');
    const businessInput = document.getElementById('reg-business');
    const registerForm = document.getElementById('register-form');
    if (!passwordInput || !registerForm) return;

    const submitBtn = registerForm.querySelector('button[type="submit"]');

    const setSubmitDisabled = (disabled) => {
        if (!submitBtn) return;
        submitBtn.disabled = disabled;
        submitBtn.setAttribute('aria-disabled', String(disabled));
        if (disabled) {
            submitBtn.setAttribute('title', TOOLTIP_DISABLED);
        } else {
            submitBtn.removeAttribute('title');
        }
    };

    // Estado inicial: deshabilitado hasta que la password sea válida.
    setSubmitDisabled(true);

    const handle = attachPasswordStrength({
        inputId: 'reg-password',
        userInputs: () => [
            emailInput?.value?.trim() || '',
            businessInput?.value?.trim() || '',
        ],
        onValidityChange: (isValid) => setSubmitDisabled(!isValid),
    });

    // Si email/business cambian, re-evaluar (zxcvbn penaliza passwords que
    // contienen esos datos). Debounced ligero para no spammear.
    let recheckTimer = null;
    const triggerRecheck = () => {
        clearTimeout(recheckTimer);
        recheckTimer = setTimeout(() => handle.recheck(), 250);
    };
    emailInput?.addEventListener('input', triggerRecheck);
    businessInput?.addEventListener('input', triggerRecheck);

    // Defensa adicional: si el browser autofillea password (no dispara `input`),
    // re-evaluamos al primer focus/blur de cualquier campo del form.
    registerForm.addEventListener('focusout', () => handle.recheck(), true);

    // Hard-block: incluso si alguien manipula el DOM y habilita el botón
    // manualmente, el submit handler valida la password antes de enviar.
    registerForm.addEventListener('submit', async (e) => {
        const errorDiv = document.getElementById('register-error');
        const password = passwordInput.value;
        const inputs = [emailInput?.value?.trim() || '', businessInput?.value?.trim() || ''];
        const result = await validatePassword(password, inputs);
        if (!result.isValid) {
            e.preventDefault();
            e.stopImmediatePropagation();
            if (errorDiv) {
                errorDiv.textContent = TOOLTIP_DISABLED + '. Revisa el panel de la derecha.';
                errorDiv.style.display = 'block';
            }
            handle.recheck();
        }
    }, true); // capture phase para correr ANTES del handler de app.js
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

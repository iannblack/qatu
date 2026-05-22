// ════════════════════════════════════════════════════════════════════════
// Autogeneración de respuestas de Qhatu — wizard de Willy
//
// Thin wrapper sobre `window.qhatuBuildPickupNote` (definido en
// `js/qhatu-respuestas-shared.js`, cargado como script clásico en
// index.html antes del wizard). Único punto de verdad de la plantilla:
// si la fuente cambia, cambia para wizard y modal de envíos a la vez.
//
// El wizard guarda `local.region` como nombre legible ("Lima Metropolitana"),
// por lo que se pasa tal cual al builder. El modal en cambio guarda código y
// lo traduce antes de invocar el shared.
//
// Signature async preservada para no romper callers ni cerrar la puerta a
// una integración LLM remota más adelante (cambiar el cuerpo, no la firma).
// ════════════════════════════════════════════════════════════════════════

/**
 * Genera la respuesta de Qhatu para "cómo recoger en este local".
 *
 * @param {object} local
 * @param {string} local.nombre        - nombre/alias de la sucursal (opcional)
 * @param {string} local.direccion     - requerido
 * @param {string} local.region        - requerido (1 de PERU_REGIONS)
 * @param {string} local.horario       - requerido
 * @returns {Promise<string>}
 */
export async function generarRespuestaLocal(local) {
    if (!local) return '';
    if (typeof window === 'undefined' || typeof window.qhatuBuildPickupNote !== 'function') {
        console.warn('[qhatuRespuestas] window.qhatuBuildPickupNote no está disponible — ¿se cargó js/qhatu-respuestas-shared.js?');
        return '';
    }
    return window.qhatuBuildPickupNote({
        nombre: local.nombre,
        direccion: local.direccion,
        region: local.region,
        horario: local.horario,
    });
}

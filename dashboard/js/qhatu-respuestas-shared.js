// ════════════════════════════════════════════════════════════════════════
// Generador shared del mensaje "Recojo en tienda"
//
// Fuente única de la plantilla que usan AMBOS lugares:
//   - dashboard/js/app.js → __shipBuildPickupMayaNote (modal "Configura tus envíos")
//   - dashboard/onboarding/lib/qhatuRespuestas.js → generarRespuestaLocal (wizard de Willy)
//
// El wizard guarda `region` como nombre legible ("Lima Metropolitana"); el
// modal lo guarda como código ("lima_metropolitana") y traduce a nombre
// antes de llamar acá. Por eso esta fn recibe args nombrados — cada caller
// adapta su shape. Si esta plantilla cambia, cambia para los dos lados.
//
// Cargado como script clásico en index.html ANTES de app.js para que
// `window.qhatuBuildPickupNote` esté disponible cuando corre cualquiera de
// los dos consumidores.
// ════════════════════════════════════════════════════════════════════════

window.qhatuBuildPickupNote = function ({ nombre, direccion, region, horario } = {}) {
    const n = (nombre || '').trim();
    const d = (direccion || '').trim();
    const h = (horario || '').trim().replace(/\s+/g, ' ');
    const r = (region || '').trim();

    if (!n && !d && !h && !r) return '';

    const intro = n
        ? `Puedes recoger tu pedido en nuestra sucursal ${n}`
        : `Puedes recoger tu pedido en nuestro local`;
    const where = d ? ` ubicada en ${d}` : '';
    const inRegion = r ? ` (${r})` : '';
    const when = h ? `. Atendemos ${h}` : '';
    return `${intro}${where}${inRegion}${when}. Solo trae tu número de pedido y te lo entregamos. ¡Te esperamos!`;
};

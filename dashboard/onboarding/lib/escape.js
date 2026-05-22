// HTML escape helpers — usados al inyectar values del store en plantillas
// `${...}` que van vía innerHTML. Sin esto, un nombre de negocio como
// 'O"Reilly' o '<script>' rompería el HTML o haría XSS persistente vía
// localStorage (alguien con acceso al navegador del usuario podría
// inyectar payloads que se ejecutarían cada vez que la pantalla se
// renderice).

export function escapeAttr(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function escapeText(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// Regiones del Perú — 26 entries, paritarias con `window.KIPU_PERU_DEPARTMENTS`
// (definido en `dashboard/js/app.js`). Lima va separada en Metropolitana y
// Provincias porque la lógica de envíos/recojos las trata distinto.
//
// Si en algún momento se mueve KIPU_PERU_DEPARTMENTS a un módulo ESM,
// reemplazar este archivo por un re-export.
//
// Orden: alfabético con tildes según la versión oficial del INEI.
export const PERU_REGIONS = [
    'Amazonas',
    'Áncash',
    'Apurímac',
    'Arequipa',
    'Ayacucho',
    'Cajamarca',
    'Callao',
    'Cusco',
    'Huancavelica',
    'Huánuco',
    'Ica',
    'Junín',
    'La Libertad',
    'Lambayeque',
    'Lima Metropolitana',
    'Lima (Provincias)',
    'Loreto',
    'Madre de Dios',
    'Moquegua',
    'Pasco',
    'Piura',
    'Puno',
    'San Martín',
    'Tacna',
    'Tumbes',
    'Ucayali',
];

export const PERU_REGIONS_COUNT = PERU_REGIONS.length;

// Migración de state legado: las versiones previas del wizard guardaban
// "Lima" como un único valor. Cuando rehidrates un local/grupo que tenga
// "Lima", traducilo a "Lima Metropolitana" (default razonable para la
// mayoría de tiendas). Los grupos de envío expanden a ambas al hidratar.
export const LEGACY_REGION_MAP = {
    'Lima': 'Lima Metropolitana',
};

export function migrateLegacyRegion(value) {
    if (!value) return value;
    return LEGACY_REGION_MAP[value] || value;
}

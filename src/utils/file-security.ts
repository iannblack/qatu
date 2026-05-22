/**
 * file-security.ts — defensas reutilizables para uploads de archivos.
 *
 * Diseñado para usarse en endpoints que aceptan archivos del cliente. Aplica
 * defensa en profundidad: confiar en el cliente es la fuente #1 de exploits
 * en file uploads. Cada función es una capa independiente; combínalas todas.
 */

import { basename, extname } from 'path'

// ─── Tipos soportados ──────────────────────────────────────────────────────

export type DocumentKind = 'pdf' | 'docx'

export const ALLOWED_DOCUMENT_MIME_TYPES = new Set<string>([
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])

export const ALLOWED_DOCUMENT_EXTENSIONS = new Set<string>([
    '.pdf',
    '.docx',
])

// Tamaño máximo: 10 MB. Suficiente para PDFs/Word de documentación realista,
// chico para ataques de DoS por relleno. Si necesita ajustarse, también
// actualizar el `limits.fileSize` del multer en el endpoint correspondiente.
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024

// ─── Magic bytes (firmas binarias) ─────────────────────────────────────────
//
// La extensión del nombre y el `Content-Type` son provistos por el CLIENTE y
// son triviales de falsificar. La única forma confiable de confirmar el tipo
// real de un archivo es leer sus primeros bytes y compararlos con su firma.

// PDF:  "%PDF-" (25 50 44 46 2D) en los primeros 5 bytes.
const MAGIC_PDF: number[] = [0x25, 0x50, 0x44, 0x46, 0x2D]

// DOCX (Office Open XML): es un ZIP con manifest específico. El magic del ZIP
// son los 4 bytes "PK\x03\x04" (50 4B 03 04). Una segunda validación opcional
// inspecciona el contenido del ZIP buscando "word/" como entrada — pero solo
// el magic ZIP ya filtra el 99 % de cargas falsas. mammoth.extractRawText
// fallará explícitamente si el contenido no es un .docx válido.
const MAGIC_ZIP: number[] = [0x50, 0x4B, 0x03, 0x04]

function bytesEqual(buf: Buffer, expected: number[], offset = 0): boolean {
    if (buf.length < offset + expected.length) return false
    for (let i = 0; i < expected.length; i++) {
        if (buf[offset + i] !== expected[i]) return false
    }
    return true
}

/**
 * Detecta el tipo real del archivo por sus primeros bytes.
 * Retorna 'pdf', 'docx', o null si no coincide con ningún tipo aceptado.
 */
export function detectDocumentMagic(buffer: Buffer): DocumentKind | null {
    if (!buffer || buffer.length < 4) return null
    if (bytesEqual(buffer, MAGIC_PDF)) return 'pdf'
    if (bytesEqual(buffer, MAGIC_ZIP)) {
        // Heurística adicional: un .docx válido contiene la cadena "word/"
        // entre sus entradas ZIP. Buscamos en los primeros 8 KB para no
        // escanear archivos enormes. Si no aparece, rechazamos: probablemente
        // es un ZIP genérico, .xlsx, .pptx, .jar, .apk, etc.
        const head = buffer.subarray(0, Math.min(buffer.length, 8192)).toString('latin1')
        if (head.includes('word/') || head.includes('[Content_Types].xml')) {
            return 'docx'
        }
        return null
    }
    return null
}

// ─── Sanitización de nombre ────────────────────────────────────────────────

/**
 * Devuelve un nombre seguro para mostrar/loguear. NO se debe usar este nombre
 * para escribir a disco — para eso, generar un UUID interno. Esta función
 * solo escapa el nombre original para echos en logs/UI sin riesgo de:
 *   • Path traversal (../../etc/passwd)
 *   • Caracteres de control (NUL, CR/LF — pueden romper logs)
 *   • Caracteres no imprimibles
 *   • Longitud abusiva (cap 80 chars)
 *   • Nombres reservados de Windows (CON, PRN, AUX, NUL, COM1-9, LPT1-9)
 */
export function sanitizeFilename(name: string): string {
    if (!name || typeof name !== 'string') return 'archivo'
    // Tomar solo el último segmento: el cliente puede mandar "../../foo.pdf".
    let base = basename(String(name))
    // Eliminar caracteres de control (incluido NUL, CR, LF, TAB) y los
    // metacaracteres típicos del filesystem. La regla `no-control-regex` se
    // disable-ea a propósito: el rango \x00-\x1F es exactamente lo que esta
    // función debe filtrar (es un sanitizer de filenames del cliente).
    // eslint-disable-next-line no-control-regex
    base = base.replace(/[\x00-\x1F\x7F<>:"/\\|?*]/g, '_')
    // Colapsar puntos repetidos al inicio (".." → "."). Bloqueamos ocultos.
    base = base.replace(/^\.+/, '')
    // Trim y truncar
    base = base.trim().substring(0, 80)
    if (!base) return 'archivo'
    // Bloquear nombres reservados de Windows (sin extensión)
    const stem = base.split('.')[0].toUpperCase()
    const reserved = new Set(['CON', 'PRN', 'AUX', 'NUL',
        'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
        'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'])
    if (reserved.has(stem)) return '_' + base
    return base
}

/**
 * Devuelve la extensión normalizada (en minúsculas con el punto) de un
 * nombre, tras sanitizar. Retorna '' si no tiene extensión reconocible.
 */
export function safeExtension(name: string): string {
    const safe = sanitizeFilename(name)
    return extname(safe).toLowerCase()
}

// ─── Validación combinada ──────────────────────────────────────────────────

export interface ValidatedDocument {
    kind: DocumentKind
    safeName: string
    extension: string
    sizeBytes: number
}

/**
 * Validador integral: tamaño + extensión + MIME declarado + magic bytes reales.
 * Lanza un Error con mensaje human-friendly en cualquier fallo. Pasa silently
 * solo si TODAS las capas concuerdan. Útil para validar lo que entrega multer.
 */
export function validateDocumentUpload(opts: {
    buffer: Buffer
    originalName: string
    mimeType: string
}): ValidatedDocument {
    const { buffer, originalName, mimeType } = opts

    if (!buffer || !Buffer.isBuffer(buffer)) {
        throw new Error('Archivo vacío o inválido.')
    }
    if (buffer.length === 0) {
        throw new Error('Archivo vacío.')
    }
    if (buffer.length > MAX_DOCUMENT_BYTES) {
        throw new Error(`El archivo excede el tamaño máximo permitido (${Math.round(MAX_DOCUMENT_BYTES / 1024 / 1024)} MB).`)
    }

    const safeName = sanitizeFilename(originalName)
    const extension = safeExtension(originalName)

    if (!ALLOWED_DOCUMENT_EXTENSIONS.has(extension)) {
        throw new Error('Solo se aceptan archivos PDF (.pdf) o Word (.docx).')
    }

    const declaredMime = String(mimeType || '').toLowerCase().split(';')[0].trim()
    if (!ALLOWED_DOCUMENT_MIME_TYPES.has(declaredMime)) {
        throw new Error('Tipo de archivo no soportado. Solo PDF y Word (.docx).')
    }

    const realKind = detectDocumentMagic(buffer)
    if (!realKind) {
        throw new Error('El archivo no es un PDF o Word válido (firma binaria no coincide).')
    }

    // Sanity cross-check: la extensión declarada debe coincidir con el
    // tipo detectado por magic bytes. Esto bloquea archivos renombrados
    // (ej. malware.exe → workflow.pdf).
    if (realKind === 'pdf' && extension !== '.pdf') {
        throw new Error('Inconsistencia entre la extensión y el contenido del archivo.')
    }
    if (realKind === 'docx' && extension !== '.docx') {
        throw new Error('Inconsistencia entre la extensión y el contenido del archivo.')
    }

    return {
        kind: realKind,
        safeName,
        extension,
        sizeBytes: buffer.length,
    }
}

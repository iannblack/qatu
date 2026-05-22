// ═══════════════════════════════════════════════════════════════════════════
// Password Validator (server-side)
// ═══════════════════════════════════════════════════════════════════════════
// Defensa-en-profundidad: el frontend valida con zxcvbn + reglas regex y
// deshabilita el submit, pero el backend DEBE re-validar porque alguien puede
// hacer POST directo al endpoint saltándose el form. Mismas reglas obligatorias
// que el cliente; el score de zxcvbn lo corremos también en server (mismo
// algoritmo, mismo dictionary), así no hay forma de pasar passwords débiles.
//
// Usado en: registerUser, changePassword, password reset (cuando se implemente).
// ═══════════════════════════════════════════════════════════════════════════

import { zxcvbn, zxcvbnOptions } from '@zxcvbn-ts/core'
import * as zxcvbnCommonPackage from '@zxcvbn-ts/language-common'
import * as zxcvbnEnPackage from '@zxcvbn-ts/language-en'

let optionsConfigured = false
function configureZxcvbn() {
    if (optionsConfigured) return
    zxcvbnOptions.setOptions({
        dictionary: {
            ...zxcvbnCommonPackage.dictionary,
            ...zxcvbnEnPackage.dictionary,
        },
        graphs: zxcvbnCommonPackage.adjacencyGraphs,
        translations: zxcvbnEnPackage.translations,
        useLevenshteinDistance: true,
    })
    optionsConfigured = true
}

const RULES = [
    { id: 'length',  label: 'mínimo 10 caracteres',         test: (p: string) => p.length >= 10 },
    { id: 'upper',   label: 'al menos una letra mayúscula', test: (p: string) => /[A-Z]/.test(p) },
    { id: 'lower',   label: 'al menos una letra minúscula', test: (p: string) => /[a-z]/.test(p) },
    { id: 'digit',   label: 'al menos un número',           test: (p: string) => /[0-9]/.test(p) },
    { id: 'special', label: 'al menos un caracter especial (!@#$%...)', test: (p: string) => /[!@#$%^&*()_+\-=[\]{}|;:,.<>?]/.test(p) },
]

const MIN_SCORE = 3

export interface PasswordValidationResult {
    valid: boolean
    failedRules: string[]   // labels de las reglas que fallaron
    score: number           // 0-4, score de zxcvbn
    message: string         // mensaje listo para mostrar al usuario
}

export function validatePasswordStrength(password: string, userInputs: string[] = []): PasswordValidationResult {
    configureZxcvbn()

    const failedRules = RULES.filter(r => !r.test(password)).map(r => r.label)
    const cleanInputs = userInputs.filter(s => typeof s === 'string' && s.length >= 2)
    const result = zxcvbn(password, cleanInputs)
    const score = result.score

    if (failedRules.length > 0) {
        const list = failedRules.join(', ')
        return {
            valid: false,
            failedRules,
            score,
            message: `La contraseña no cumple los requisitos: ${list}.`
        }
    }

    if (score < MIN_SCORE) {
        return {
            valid: false,
            failedRules: [],
            score,
            message: `La contraseña es demasiado predecible (score ${score}/4). Evita patrones comunes (qwerty, fechas, palabras de diccionario) y datos personales.`
        }
    }

    return { valid: true, failedRules: [], score, message: 'OK' }
}

import parsePhone from 'libphonenumber-js/max'

import type { PhoneResult } from '../types/phone.ts'

export class PhoneService {
  static normalize(input: string): PhoneResult {
    const value = input.trim()

    if (!value) {
      return { ok: false, error: 'Введите номер телефона.' }
    }

    if (!/^\+?[\d\s()-]+$/.test(value)) {
      return {
        ok: false,
        error: 'Используйте цифры, пробелы, скобки и дефисы. Плюс допустим только в начале.',
      }
    }

    let digits = value.replace(/[^\d]/g, '')

    if (!value.startsWith('+') && digits.length === 11 && digits.startsWith('8')) {
      digits = `7${digits.slice(1)}`
    }

    const phone = parsePhone(`+${digits}`, { extract: false })

    if (!phone?.isValid()) {
      return {
        ok: false,
        error: 'Проверьте номер и код страны. Например: +7 987 123-45-67 или 8 987 123-45-67.',
      }
    }

    return { ok: true, digits: phone.number.slice(1) }
  }

  static getLabel(value: string): string {
    const normalized = PhoneService.normalize(value)

    return normalized.ok ? `+${normalized.digits}` : value.startsWith('+') ? value : `+${value}`
  }
}

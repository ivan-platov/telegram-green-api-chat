import { ApiError } from './api-error.ts'

export class ApiResponseService {
  static requireObject(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new ApiError('Некорректный ответ GREEN-API. Обработка остановлена.')
    }

    return value as Record<string, unknown>
  }
}

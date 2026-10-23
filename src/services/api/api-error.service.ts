import axios from 'axios'

import { ApiError } from './api-error.ts'

const unknownSend = 'Результат отправки неизвестен. Проверьте Telegram перед повторной отправкой.'

export class ApiErrorService {
  static getMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Не удалось выполнить действие.'
  }

  static isAccess(error: unknown): boolean {
    return error instanceof ApiError && (error.httpStatus === 401 || error.httpStatus === 403)
  }

  static fromAxios(value: unknown): ApiError {
    if (!axios.isAxiosError<unknown>(value)) {
      return new ApiError('Не удалось выполнить запрос GREEN-API.')
    }

    const sending = value.config?.url?.startsWith('sendMessage/') === true
    const status = value.response?.status
    let error: ApiError

    if (status !== undefined && (status < 200 || status >= 300)) {
      switch (status) {
        case 401:
        case 403:
          error = new ApiError('Нет доступа. Проверьте ID инстанса и токен.')
          break
        case 429:
          error = new ApiError(
            'GREEN-API ограничил частоту запросов (HTTP 429). Подождите перед повторной попыткой.',
            true,
          )
          break
        default:
          error =
            sending && (status >= 500 || status === 408 || status === 499)
              ? new ApiError(unknownSend, false, true)
              : new ApiError(
                  `GREEN-API отклонил запрос (HTTP ${status}). Проверьте состояние в кабинете GREEN-API.`,
                  status >= 500,
                )
      }

      error.httpStatus = status
      const data = value.response?.data

      if (
        status === 400 &&
        data &&
        typeof data === 'object' &&
        'message' in data &&
        typeof data.message === 'string' &&
        /^(Message not found by id|chatId not found)(?:\b|:)/i.test(data.message)
      ) {
        error.serviceKind = 'not-found'
      }

      return error
    }

    if (value.code === 'ERR_BAD_RESPONSE') {
      return new ApiError(
        sending
          ? 'Результат отправки неизвестен: некорректный ответ API.'
          : 'GREEN-API вернул некорректный JSON.',
        false,
        sending,
      )
    }

    return new ApiError(
      sending
        ? unknownSend
        : value.code === 'ETIMEDOUT' || value.code === 'ECONNABORTED'
          ? 'GREEN-API не ответил за отведённое время.'
          : 'Не удалось выполнить запрос к GREEN-API. Проверьте подключение к сети и доступность сервиса.',
      true,
      sending,
    )
  }
}

import { ApiError } from './api-error.ts'
import { HttpClientService } from './http-client.service.ts'
import { RequestScheduler } from './request-scheduler.ts'
import { ApiResponseService } from './response.service.ts'

import type { ReadOptions } from '../../types/api.ts'
import type { Credentials } from '../../types/connection.ts'
import type { AxiosInstance } from 'axios'

const reads = {
  getStateInstance: 'GET',
  getSettings: 'GET',
  getAccountSettings: 'GET',
  getChatHistory: 'POST',
  getMessage: 'POST',
} as const

export class GreenApiService {
  private readonly credentials: Credentials
  private readonly http: AxiosInstance
  private readonly scheduler = new RequestScheduler()
  constructor(credentials: Credentials) {
    this.credentials = { ...credentials }
    this.http = HttpClientService.create(credentials)
  }

  private path(method: string) {
    return `${method}/${encodeURIComponent(this.credentials.apiTokenInstance)}`
  }

  private read(method: keyof typeof reads, options: ReadOptions, body?: object) {
    return this.scheduler.read({
      target: this.credentials,
      method,
      body,
      signal: options.signal,
      beforeStart: options.beforeStart,
      execute: async (signal) => {
        const { data } = await this.http.request<unknown>({
          url: this.path(method),
          method: reads[method],
          data: body,
          signal,
        })

        return data
      },
    })
  }

  async getStateInstance(options: ReadOptions) {
    return ApiResponseService.requireObject(await this.read('getStateInstance', options))
  }

  async getSettings(options: ReadOptions) {
    return ApiResponseService.requireObject(await this.read('getSettings', options))
  }

  async getAccountSettings(options: ReadOptions) {
    return ApiResponseService.requireObject(await this.read('getAccountSettings', options))
  }

  getChatHistory(
    query: {
      chatId: string
      count: number
    },
    options: ReadOptions,
  ) {
    return this.read('getChatHistory', options, query)
  }

  async getMessage(
    query: {
      chatId: string
      idMessage: string
    },
    options: ReadOptions,
  ) {
    return ApiResponseService.requireObject(await this.read('getMessage', options, query))
  }

  async receiveNotification(signal: AbortSignal): Promise<unknown> {
    const { data } = await this.http.get<unknown>(this.path('receiveNotification'), {
      signal,
      params: { receiveTimeout: 5 },
    })

    return data
  }

  async deleteNotification(receiptId: number, signal: AbortSignal) {
    const { data } = await this.http.delete<unknown>(
      `${this.path('deleteNotification')}/${receiptId}`,
      { signal },
    )

    if (ApiResponseService.requireObject(data).result !== true) {
      throw new ApiError('Не удалось подтвердить обработанное уведомление. Получение остановлено.')
    }
  }

  async resolvePhone(phone: string, signal: AbortSignal): Promise<string> {
    const value = Number(phone)

    if (!/^[1-9]\d{1,14}$/.test(phone) || !Number.isSafeInteger(value)) {
      throw new ApiError('Введите международный номер с кодом страны, до 15 цифр.')
    }

    const { data } = await this.http.post<unknown>(
      this.path('checkAccount'),
      { phoneNumber: value },
      { signal },
    )
    const result = ApiResponseService.requireObject(data)

    if (result.status === false) {
      throw new ApiError(
        'Не удалось проверить номер. Проверьте состояние инстанса и ограничения поиска в GREEN-API.',
      )
    }

    if (result.exist === false) {
      throw new ApiError(
        'Не удалось найти аккаунт: он может отсутствовать или номер скрыт настройками приватности.',
      )
    }

    if (
      result.exist !== true ||
      typeof result.chatId !== 'string' ||
      !/^[1-9]\d*$/.test(result.chatId)
    ) {
      throw new ApiError('GREEN-API не вернул идентификатор личного чата.')
    }

    return result.chatId
  }

  async sendText(chatId: string, message: string, signal: AbortSignal): Promise<string> {
    if (!message.trim() || message.length > 4096) {
      throw new ApiError('Введите текст длиной от 1 до 4096 символов.')
    }

    const { data } = await this.http.post<unknown>(
      this.path('sendMessage'),
      { chatId, message },
      { signal },
    )

    if (
      !data ||
      typeof data !== 'object' ||
      !('idMessage' in data) ||
      typeof data.idMessage !== 'string' ||
      !data.idMessage
    ) {
      throw new ApiError('Результат отправки неизвестен: API не вернул ID сообщения.', false, true)
    }

    return data.idMessage
  }
}

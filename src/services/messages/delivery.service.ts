import { ApiError } from '../api/api-error.ts'
import { ApiResponseService } from '../api/response.service.ts'
import { DateService } from '../date.service.ts'

import type { DeliveryUpdate, Message, MessageStatus } from '../../types/message.ts'

export class DeliveryService {
  static isTerminal(message: Message): boolean {
    return ['delivered', 'read', 'failed'].includes(message.status ?? '')
  }

  static parse(body: unknown, instance: string): DeliveryUpdate | null {
    const event = ApiResponseService.requireObject(body)

    if (event.typeWebhook !== 'outgoingMessageStatus') {
      return null
    }

    const source = ApiResponseService.requireObject(event.instanceData)

    if (String(source.idInstance) !== instance || source.typeInstance !== 'telegram') {
      throw new ApiError('Статус относится к другому инстансу. Получение остановлено.')
    }

    if (typeof event.chatId !== 'string' || !event.chatId) {
      throw new ApiError('У статуса отсутствует ID чата. Уведомление не подтверждено.')
    }

    if (!['delivered', 'read', 'failed', 'noAccount'].includes(String(event.status))) {
      throw new ApiError('GREEN-API прислал неизвестный статус сообщения.')
    }

    const id = typeof event.idMessage === 'string' && event.idMessage ? event.idMessage : undefined
    const failed = event.status === 'failed' || event.status === 'noAccount'

    if (!id && !failed) {
      throw new ApiError('У подтверждения доставки отсутствует ID сообщения.')
    }

    const description =
      typeof event.description === 'string' ? event.description.slice(0, 1000) : undefined

    return {
      id,
      chatId: event.chatId,
      status: failed ? 'failed' : (event.status as 'delivered' | 'read'),
      timestamp: DateService.fromUnix(event.timestamp),
      description: failed
        ? description ||
          (event.status === 'noAccount'
            ? 'Аккаунт получателя не найден или скрыт настройками приватности.'
            : 'GREEN-API сообщил об ошибке отправки.')
        : undefined,
    }
  }

  static apply(message: Message, update: DeliveryUpdate): Message {
    if (
      message.direction !== 'out' ||
      !update.id ||
      message.apiId !== update.id ||
      message.chatId !== update.chatId
    ) {
      return message
    }

    if (
      message.status === 'read' ||
      (message.status === 'delivered' && update.status === 'failed')
    ) {
      return message
    }

    return {
      ...message,
      status: update.status,
      error: update.description,
      verificationError: undefined,
      statusSource: 'webhook',
      statusTimestamp: update.timestamp,
    }
  }

  static merge(previous: DeliveryUpdate | undefined, update: DeliveryUpdate): DeliveryUpdate {
    if (
      previous?.status === 'read' ||
      (previous?.status === 'delivered' && update.status === 'failed')
    ) {
      return previous
    }

    return update
  }

  static getLabel(status: MessageStatus | undefined) {
    return {
      pending: 'Отправляется',
      delivered: 'Доставлено',
      read: 'Прочитано',
      failed: 'Не отправлено',
      unknown: 'Доставка не подтверждена',
    }[status ?? 'unknown']
  }

  static getMessageLabel(message: Message): string {
    if (message.direction === 'in') {
      return 'Входящее сообщение'
    }

    if (message.status === 'pending' && message.apiId) {
      return 'Ожидаем подтверждения доставки'
    }

    return this.getLabel(message.status)
  }
}

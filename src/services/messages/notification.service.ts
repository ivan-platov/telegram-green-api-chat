import { DeliveryService } from './delivery.service.ts'
import { ApiError } from '../api/api-error.ts'
import { ApiResponseService } from '../api/response.service.ts'
import { DateService } from '../date.service.ts'

import type { NotificationEvent } from '../../types/notification.ts'

const textEvents = new Set([
  'incomingMessageReceived',
  'outgoingMessageReceived',
  'outgoingAPIMessageReceived',
])
const ignoredTypes = new Set([
  'imageMessage',
  'videoMessage',
  'documentMessage',
  'audioMessage',
  'stickerMessage',
  'locationMessage',
  'contactMessage',
  'pollMessage',
  'reactionMessage',
  'deletedMessage',
  'editedMessage',
])

export class NotificationService {
  static parse(value: unknown, instance: string, wid?: string): NotificationEvent {
    const body = ApiResponseService.requireObject(value)
    const source = ApiResponseService.requireObject(body.instanceData)

    if (
      (typeof source.idInstance === 'number' && !Number.isSafeInteger(source.idInstance)) ||
      String(source.idInstance) !== instance ||
      source.typeInstance !== 'telegram'
    ) {
      throw new ApiError('Уведомление относится к другому инстансу.')
    }

    if (wid && source.wid !== undefined && source.wid !== wid) {
      const error = new ApiError('Аккаунт уведомления изменился. Требуется проверить подключение.')

      error.serviceKind = 'account-changed'
      throw error
    }

    if (body.typeWebhook === 'outgoingMessageStatus') {
      return { kind: 'delivery', update: DeliveryService.parse(body, instance)! }
    }

    if (body.typeWebhook === 'quotaExceeded') {
      const quota = ApiResponseService.requireObject(body.quotaData)

      if (typeof quota.description !== 'string' || !quota.description.trim()) {
        throw new ApiError('Не удалось прочитать уведомление о лимите тарифа.')
      }

      return { kind: 'quota', description: quota.description }
    }

    if (body.typeWebhook === 'stateInstanceChanged') {
      if (typeof body.stateInstance !== 'string') {
        throw new ApiError('Некорректное состояние инстанса.')
      }

      return { kind: 'state', state: body.stateInstance }
    }

    if (!textEvents.has(String(body.typeWebhook))) {
      throw new ApiError('Неизвестное уведомление. Получение остановлено без подтверждения.')
    }

    const sender = ApiResponseService.requireObject(body.senderData)
    const data = ApiResponseService.requireObject(body.messageData)

    if (sender.chatType !== undefined && sender.chatType !== 'user') {
      return { kind: 'ignored' }
    }

    if (typeof sender.chatId !== 'string') {
      throw new ApiError('Не указан чат сообщения.')
    }

    if (!/^[1-9]\d*$/.test(sender.chatId)) {
      return { kind: 'ignored' }
    }

    if (ignoredTypes.has(String(data.typeMessage))) {
      return { kind: 'ignored' }
    }

    const content =
      data.typeMessage === 'textMessage'
        ? ApiResponseService.requireObject(data.textMessageData).textMessage
        : data.typeMessage === 'extendedTextMessage'
          ? ApiResponseService.requireObject(data.extendedTextMessageData).text
          : undefined

    if (typeof content !== 'string' || typeof body.idMessage !== 'string' || !body.idMessage) {
      throw new ApiError('Не удалось прочитать текст сообщения. Уведомление не подтверждено.')
    }

    const direction = body.typeWebhook === 'incomingMessageReceived' ? 'in' : 'out'
    const serverCreatedAt = DateService.fromUnix(body.timestamp)

    return {
      kind: 'text',
      message: {
        id: `remote:${direction}:${sender.chatId}:${body.idMessage}`,
        apiId: body.idMessage,
        chatId: sender.chatId,
        direction,
        text: content,
        serverCreatedAt,
        createdAt: serverCreatedAt,
        ...(direction === 'out'
          ? { status: 'pending' as const, reconcile: { boundAt: Date.now(), slot: 0, attempts: 0 } }
          : {}),
      },
    }
  }
}

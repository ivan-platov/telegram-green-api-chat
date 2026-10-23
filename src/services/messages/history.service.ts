import { DateService } from '../date.service.ts'
import { WorkspaceService } from '../workspace.service.ts'
import { MessageService } from './message.service.ts'
import { ApiError } from '../api/api-error.ts'
import { ApiResponseService } from '../api/response.service.ts'

import type { Message, MessageStatus } from '../../types/message.ts'

export class HistoryService {
  static parse(response: unknown, chatId: string): Message[] {
    if (!Array.isArray(response)) {
      throw new ApiError('Не удалось прочитать историю: GREEN-API вернул неверный формат.')
    }

    const messages: Message[] = []

    for (const item of response) {
      const entry = ApiResponseService.requireObject(item)

      if (entry.chatId !== chatId || entry.typeMessage !== 'textMessage') {
        continue
      }

      if (
        !['incoming', 'outgoing'].includes(String(entry.type)) ||
        typeof entry.idMessage !== 'string' ||
        !entry.idMessage ||
        typeof entry.textMessage !== 'string'
      ) {
        throw new ApiError('Не удалось прочитать текстовое сообщение из истории GREEN-API.')
      }

      const outgoing = entry.type === 'outgoing'
      const status: MessageStatus | undefined = !outgoing
        ? undefined
        : entry.statusMessage === 'read'
          ? 'read'
          : entry.statusMessage === 'delivered'
            ? 'delivered'
            : entry.statusMessage === 'failed' || entry.statusMessage === 'noAccount'
              ? 'failed'
              : 'unknown'

      const serverCreatedAt = DateService.fromUnix(entry.timestamp)

      messages.push({
        id: `history:${entry.type}:${chatId}:${entry.idMessage}`,
        apiId: entry.idMessage,
        chatId,
        text: entry.textMessage,
        direction: outgoing ? 'out' : 'in',
        status,
        serverCreatedAt,
        createdAt: serverCreatedAt,
        error:
          status === 'unknown'
            ? 'В истории отсутствует подтверждённый статус отправки.'
            : status === 'failed'
              ? 'GREEN-API сообщил об ошибке отправки.'
              : undefined,
      })
    }

    const workspace = WorkspaceService.create()

    MessageService.putMessages(workspace, messages)

    return MessageService.order(workspace.messages)
  }
}

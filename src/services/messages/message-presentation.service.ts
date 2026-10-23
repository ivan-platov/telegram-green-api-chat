import { MessageService } from './message.service.ts'

import type { DisplayRow } from '../../types/message-presentation.ts'
import type { Message } from '../../types/message.ts'

export class MessagePresentationService {
  static getRows(messages: Message[], scope: string, chatId: string, zone: string): DisplayRow[] {
    const rows: DisplayRow[] = []
    let lastDay = ''
    let formatter: Intl.DateTimeFormat

    try {
      formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: zone,
        calendar: 'gregory',
        numberingSystem: 'latn',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
    } catch {
      zone = 'UTC'
      formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: zone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
    }

    for (const message of MessageService.order(messages)) {
      const time = MessageService.getTime(message)
      let day = 'undated'

      if (time !== undefined) {
        const parts = formatter.formatToParts(time)

        day = ['year', 'month', 'day']
          .map((kind) => parts.find((part) => part.type === kind)?.value)
          .join('-')
      }

      if (lastDay !== day) {
        rows.push(
          time === undefined
            ? {
                kind: 'undated',
                key: JSON.stringify(['undated', scope, chatId]),
                label: 'Время не получено',
              }
            : {
                kind: 'day',
                key: JSON.stringify(['day', scope, chatId, zone, day]),
                label: new Intl.DateTimeFormat('ru-RU', {
                  timeZone: zone,
                  dateStyle: 'long',
                }).format(time),
              },
        )
        lastDay = day
      }

      rows.push({
        kind: 'message',
        key: JSON.stringify(['message', scope, chatId, message.id]),
        message,
      })
    }

    return rows
  }
}

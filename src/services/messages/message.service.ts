import { DeliveryService } from './delivery.service.ts'

import type { DeliveryUpdate, Message } from '../../types/message.ts'
import type { Workspace } from '../../types/workspace.ts'

export class MessageService {
  static getTime(message: Message) {
    return message.serverCreatedAt ?? message.localCreatedAt ?? message.createdAt
  }

  static order(messages: Message[]) {
    return [...messages].sort((a, b) => {
      const left = MessageService.getTime(a)
      const right = MessageService.getTime(b)

      if (left === undefined && right !== undefined) {
        return 1
      }

      if (right === undefined && left !== undefined) {
        return -1
      }

      return (
        (left !== undefined && right !== undefined ? left - right : 0) ||
        (a.firstSeenOrder ?? 0) - (b.firstSeenOrder ?? 0)
      )
    })
  }

  private static allocate(workspace: Workspace) {
    if (
      !Number.isSafeInteger(workspace.meta.nextOrder) ||
      workspace.meta.nextOrder >= Number.MAX_SAFE_INTEGER
    ) {
      throw new Error('Исчерпан локальный порядок сообщений. Сохранение остановлено.')
    }

    return workspace.meta.nextOrder++
  }

  private static combine(previous: Message, incoming: Message): Message {
    const status =
      previous.status === 'read' || incoming.status === 'read'
        ? 'read'
        : previous.status === 'delivered' || incoming.status === 'delivered'
          ? 'delivered'
          : previous.status === 'failed' &&
              (!incoming.status || incoming.status === 'unknown' || incoming.status === 'pending')
            ? 'failed'
            : (incoming.status ?? previous.status)
    const serverCreatedAt = previous.serverCreatedAt ?? incoming.serverCreatedAt

    return {
      ...previous,
      ...incoming,
      id: previous.id,
      firstSeenOrder: previous.firstSeenOrder,
      localCreatedAt: previous.localCreatedAt ?? incoming.localCreatedAt,
      serverCreatedAt,
      timeConflict:
        previous.timeConflict ||
        (previous.serverCreatedAt !== undefined &&
          incoming.serverCreatedAt !== undefined &&
          previous.serverCreatedAt !== incoming.serverCreatedAt),
      createdAt: serverCreatedAt ?? previous.localCreatedAt ?? incoming.localCreatedAt,
      status,
      verificationError:
        status === 'read' || status === 'delivered'
          ? undefined
          : Object.hasOwn(incoming, 'verificationError')
            ? incoming.verificationError
            : previous.verificationError,
      statusSource:
        status === previous.status
          ? (previous.statusSource ?? incoming.statusSource)
          : incoming.statusSource,
      statusTimestamp:
        status === previous.status
          ? (previous.statusTimestamp ?? incoming.statusTimestamp)
          : incoming.statusTimestamp,
      reconcile: previous.reconcile ?? incoming.reconcile,
      error:
        status === 'read' || status === 'delivered'
          ? undefined
          : (incoming.error ?? previous.error),
    }
  }

  static putMessages(workspace: Workspace, incoming: Message[]) {
    const indices = new Map(
      workspace.messages.map((message, index) => [MessageService.getKey(message), index]),
    )

    for (let message of incoming) {
      const index = indices.get(MessageService.getKey(message))

      if (index === undefined) {
        message = { ...message, firstSeenOrder: MessageService.allocate(workspace) }
        indices.set(MessageService.getKey(message), workspace.messages.length)
        workspace.messages.push(message)
      } else {
        message = MessageService.combine(workspace.messages[index], message)
      }

      const delivery = message.apiId
        ? workspace.deliveries[JSON.stringify([message.chatId, message.apiId])]
        : undefined

      if (delivery) {
        message = DeliveryService.apply(message, delivery)
      }

      workspace.messages[indices.get(MessageService.getKey(message))!] = message
    }
  }

  static bindAttempt(workspace: Workspace, localId: string, apiId: string, now: number) {
    const attempt = workspace.messages.find((message) => message.id === localId)

    if (!attempt) {
      throw new Error('Локальная попытка не найдена.')
    }

    const echo = workspace.messages.find(
      (message) =>
        message.apiId === apiId &&
        message.chatId === attempt.chatId &&
        message.direction === 'out' &&
        message.id !== localId,
    )
    let bound: Message = { ...attempt, apiId, reconcile: { boundAt: now, slot: 0, attempts: 0 } }

    if (echo) {
      bound = {
        ...MessageService.combine(bound, echo),
        id: attempt.id,
        firstSeenOrder: attempt.firstSeenOrder,
        reconcile: bound.reconcile,
      }
    }

    const delivery = workspace.deliveries[JSON.stringify([attempt.chatId, apiId])]

    if (delivery) {
      bound = { ...bound, ...DeliveryService.apply(bound, delivery) }
    }

    workspace.messages = workspace.messages
      .filter((message) => message.id !== echo?.id)
      .map((message) => (message.id === localId ? bound : message))
  }

  static putDelivery(workspace: Workspace, update: DeliveryUpdate) {
    if (!update.id) {
      workspace.meta.warnings[update.chatId] =
        update.description ?? 'Сервис сообщил об ошибке отправки без указания сообщения.'

      return
    }

    const key = JSON.stringify([update.chatId, update.id])
    const merged = DeliveryService.merge(workspace.deliveries[key], update)

    workspace.deliveries[key] = merged
    workspace.messages = workspace.messages.map((message) => DeliveryService.apply(message, merged))
  }

  static getKey(message: Pick<Message, 'chatId' | 'direction' | 'apiId' | 'id'>) {
    return JSON.stringify([
      message.chatId,
      message.direction,
      message.apiId ? `api:${message.apiId}` : `local:${message.id}`,
    ])
  }
}

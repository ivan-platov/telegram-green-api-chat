import type { DeliveryUpdate, Message } from './message.ts'

export type NotificationEvent =
  | {
      kind: 'text'
      message: Message
    }
  | {
      kind: 'delivery'
      update: DeliveryUpdate
    }
  | {
      kind: 'state'
      state: string
    }
  | {
      kind: 'quota'
      description: string
    }
  | {
      kind: 'ignored'
    }

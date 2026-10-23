import type { Credentials } from './connection.ts'
import type { DeliveryUpdate, Message } from './message.ts'

export type Target = Credentials

export type Identity = {
  apiUrl: string
  idInstance: string
  ownerChatId: string
}

export type Chat = {
  chatId: string
  phone: string
  order: number
}

export type Draft = {
  text: string
  revision: number
  updatedAt: number
}

export type HistoryMeta = {
  count: number
  rawCount: number
}

export interface Workspace {
  messages: Message[]
  chats: Chat[]
  drafts: Record<string, Draft>
  deliveries: Record<string, DeliveryUpdate>
  meta: {
    nextOrder: number
    lastSelected?: string
    lastStateEvent?: {
      state: string
      observedAt: number
    }
    quotaNotice?: {
      description: string
      observedAt: number
      dismissed?: boolean
    }
    warnings: Record<string, string>
    history: Record<string, HistoryMeta>
  }
}

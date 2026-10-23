import type { Message } from './message.ts'

export type DisplayRow =
  | {
      kind: 'message'
      key: string
      message: Message
    }
  | {
      kind: 'day' | 'undated'
      key: string
      label: string
    }

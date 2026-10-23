export type MessageStatus = 'pending' | 'delivered' | 'read' | 'failed' | 'unknown'

export interface DeliveryUpdate {
  id?: string
  chatId: string
  status: 'delivered' | 'read' | 'failed'
  description?: string
  timestamp?: number
}

export interface Message {
  id: string
  apiId?: string
  chatId: string
  text: string
  direction: 'in' | 'out'
  createdAt?: number
  status?: MessageStatus
  error?: string
  verificationError?: string
  localCreatedAt?: number
  serverCreatedAt?: number
  firstSeenOrder?: number
  unknownReason?: string
  statusSource?: string
  statusTimestamp?: number
  reconcile?: {
    boundAt: number
    slot: number
    attempts: number
    exhausted?: boolean
  }
  draftRevisionAtSend?: number
  timeConflict?: boolean
}

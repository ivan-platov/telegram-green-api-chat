export type LocalStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export interface SavedChat {
  phone: string
  chatId: string
}

export interface StoredConnection {
  version: 2
  apiUrl: string
  idInstance: string
  apiTokenInstance: string
  ownerChatId?: string
  credentialRevision: number
  migrationCandidate?: SavedChat
}

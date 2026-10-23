import type { Identity, Workspace } from '../types/workspace.ts'

export class WorkspaceService {
  static create(): Workspace {
    return {
      messages: [],
      chats: [],
      drafts: {},
      deliveries: {},
      meta: { nextOrder: 1, warnings: {}, history: {} },
    }
  }

  static getKey(identity: Identity) {
    return JSON.stringify([identity.apiUrl, identity.idInstance, identity.ownerChatId])
  }
}

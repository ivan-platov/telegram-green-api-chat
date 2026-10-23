import { MessageService } from '../messages/message.service.ts'
import { WorkspaceService } from '../workspace.service.ts'

import type { Workspace } from '../../types/workspace.ts'

const stores = ['messages', 'drafts', 'chats', 'deliveries', 'meta'] as const

type Stored = {
  key: string[]
  workspace: string
  value: unknown
}

function values(data: Workspace, scope: string) {
  const result = new Map<string, Map<string, Stored>>()

  for (const store of stores) {
    result.set(store, new Map())
  }

  const add = (store: (typeof stores)[number], id: string, value: unknown) =>
    result.get(store)!.set(id, { key: [scope, id], workspace: scope, value })

  for (const message of data.messages) {
    add('messages', MessageService.getKey(message), message)
  }

  for (const chat of data.chats) {
    add('chats', chat.chatId, chat)
  }

  for (const [id, draft] of Object.entries(data.drafts)) {
    add('drafts', id, draft)
  }

  for (const [id, delivery] of Object.entries(data.deliveries)) {
    add('deliveries', id, delivery)
  }

  add('meta', 'state', data.meta)

  return result
}

export class WorkspaceStorage {
  private db: IDBDatabase
  private scope: string
  private data: Workspace
  private tail: Promise<unknown> = Promise.resolve()
  private closed = false
  private constructor(db: IDBDatabase, scope: string, data: Workspace) {
    this.db = db
    this.scope = scope
    this.data = data
  }

  static async open(scope: string, writable = true) {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('green-api-chat.workspace', 1)

      request.onupgradeneeded = () => {
        for (const name of stores) {
          if (!request.result.objectStoreNames.contains(name)) {
            request.result
              .createObjectStore(name, { keyPath: 'key' })
              .createIndex('workspace', 'workspace')
          }
        }
      }

      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(new Error('Не удалось открыть локальную историю.'))
      request.onblocked = () =>
        reject(new Error('Закройте другую вкладку со старой версией локальной базы.'))
    })

    db.onversionchange = () => db.close()
    try {
      const data = WorkspaceService.create()

      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction([...stores], 'readonly')

        for (const store of stores) {
          const request = tx.objectStore(store).index('workspace').getAll(scope)

          request.onsuccess = () => {
            for (const entry of request.result as Stored[]) {
              if (store === 'messages') {
                data.messages.push(entry.value as Workspace['messages'][number])
              } else if (store === 'chats') {
                data.chats.push(entry.value as Workspace['chats'][number])
              } else if (store === 'meta') {
                data.meta = entry.value as Workspace['meta']
              } else if (store === 'drafts') {
                data.drafts[entry.key[1]] = entry.value as Workspace['drafts'][string]
              } else {
                data.deliveries[entry.key[1]] = entry.value as Workspace['deliveries'][string]
              }
            }
          }
        }

        tx.oncomplete = () => resolve()
        tx.onerror = tx.onabort = () => reject(new Error('Не удалось прочитать локальную историю.'))
      })
      data.chats.sort((left, right) => left.order - right.order)
      const storage = new WorkspaceStorage(db, scope, data)

      if (writable) {
        await storage.update((workspace) => {
          workspace.messages = workspace.messages.map((message) =>
            message.direction === 'out' && message.status === 'pending' && !message.apiId
              ? {
                  ...message,
                  status: 'unknown',
                  unknownReason: 'reload-during-send',
                  error: 'Результат отправки неизвестен после перезагрузки.',
                }
              : message,
          )
        })
      }

      return storage
    } catch (error) {
      db.close()
      throw error
    }
  }

  getSnapshot() {
    return this.data
  }

  update(change: (workspace: Workspace) => void): Promise<Workspace> {
    const operation = this.tail
      .then(async () => {
        if (this.closed) {
          throw new Error('Локальная история закрыта.')
        }

        const next: Workspace = {
          messages: [...this.data.messages],
          chats: [...this.data.chats],
          drafts: { ...this.data.drafts },
          deliveries: { ...this.data.deliveries },
          meta: {
            ...this.data.meta,
            warnings: { ...this.data.meta.warnings },
            history: { ...this.data.meta.history },
          },
        }

        change(next)
        if (
          Object.keys(next.meta.history).length === Object.keys(this.data.meta.history).length &&
          Object.entries(next.meta.history).every(
            ([id, history]) => history === this.data.meta.history[id],
          )
        ) {
          next.meta.history = this.data.meta.history
        }

        if (
          Object.keys(next.meta.warnings).length === Object.keys(this.data.meta.warnings).length &&
          Object.entries(next.meta.warnings).every(
            ([id, warning]) => warning === this.data.meta.warnings[id],
          )
        ) {
          next.meta.warnings = this.data.meta.warnings
        }

        if (
          next.messages.length === this.data.messages.length &&
          next.messages.every((message, index) => message === this.data.messages[index])
        ) {
          next.messages = this.data.messages
        }

        if (
          next.chats.length === this.data.chats.length &&
          next.chats.every((chat, index) => chat === this.data.chats[index])
        ) {
          next.chats = this.data.chats
        }

        const before = values(this.data, this.scope)
        const after = values(next, this.scope)

        await new Promise<void>((resolve, reject) => {
          const tx = this.db.transaction([...stores], 'readwrite')

          for (const name of stores) {
            const store = tx.objectStore(name)
            const previous = before.get(name)!
            const current = after.get(name)!

            for (const [id, entry] of previous) {
              if (!current.has(id)) {
                store.delete(entry.key)
              }
            }

            for (const [id, entry] of current) {
              if (entry.value !== previous.get(id)?.value) {
                store.put(entry)
              }
            }
          }

          tx.oncomplete = () => resolve()
          tx.onerror = tx.onabort = () =>
            reject(
              new Error(
                'Не удалось сохранить данные. Обмен приостановлен; текст остаётся в этом окне.',
              ),
            )
        })
        this.data = next

        return next
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') {
          throw error
        }

        throw new Error(
          'Не удалось сохранить данные. Обмен приостановлен; текст остаётся в этом окне.',
        )
      })

    this.tail = operation.catch(() => {})

    return operation
  }

  async close() {
    await this.tail
    this.closed = true
    this.db.close()
  }
}

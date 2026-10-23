import type { LocalStore, StoredConnection } from '../../types/connection-storage.ts'

const key = 'green-api-chat.connection.v1'

export const connectionKey = 'green-api-chat.connection.v2'

export const legacyConnectionKey = key

export class ConnectionStorageService {
  static read(storage: LocalStore = window.localStorage): {
    value?: StoredConnection
    error?: string
  } {
    try {
      const raw = storage.getItem(connectionKey) ?? storage.getItem(key)

      if (!raw) {
        return {}
      }

      const value = JSON.parse(raw)

      if (
        ![1, 2].includes(value?.version) ||
        typeof value.apiUrl !== 'string' ||
        typeof value.idInstance !== 'string' ||
        !/^\d+$/.test(value.idInstance) ||
        typeof value.apiTokenInstance !== 'string' ||
        !value.apiTokenInstance.trim() ||
        (value.ownerChatId !== undefined &&
          (typeof value.ownerChatId !== 'string' || !/^[1-9]\d*$/.test(value.ownerChatId)))
      ) {
        throw new Error()
      }

      return {
        value: {
          ...value,
          version: 2,
          credentialRevision: Number.isSafeInteger(value.credentialRevision)
            ? value.credentialRevision
            : 1,
          migrationCandidate:
            value.migrationCandidate ?? (value.version === 1 ? value.lastChat : undefined),
        },
      }
    } catch {
      return {
        error:
          'Не удалось прочитать сохранённое подключение. Введите данные заново или удалите сохранённый доступ.',
      }
    }
  }

  static write(value: StoredConnection, storage: LocalStore = window.localStorage) {
    storage.setItem(connectionKey, JSON.stringify(value))
    storage.removeItem(key)
  }

  static remove(storage: LocalStore = window.localStorage) {
    storage.removeItem(connectionKey)
    storage.removeItem(key)
  }
}

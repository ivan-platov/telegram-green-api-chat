import assert from 'node:assert/strict'
import test from 'node:test'

import {
  connectionKey,
  ConnectionStorageService,
  legacyConnectionKey,
} from '../src/services/storage/connection-storage.service.ts'

const connection = {
  version: 2,
  apiUrl: 'https://example.test',
  idInstance: '123',
  apiTokenInstance: 'fixture-token',
  ownerChatId: '42',
  credentialRevision: 1,
}

function store(entries = []) {
  const values = new Map(entries)

  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
}

test('SHOULD restore the current access format after saving it', () => {
  const storage = store()

  ConnectionStorageService.write(connection, storage)
  assert.deepEqual(ConnectionStorageService.read(storage).value, {
    ...connection,
    migrationCandidate: undefined,
  })
})
test('SHOULD remove current and legacy access when disconnecting', () => {
  const storage = store([
    [connectionKey, JSON.stringify(connection)],
    [legacyConnectionKey, JSON.stringify({ ...connection, version: 1 })],
  ])

  ConnectionStorageService.remove(storage)
  assert.deepEqual(ConnectionStorageService.read(storage), {})
})
test('SHOULD preserve an unowned legacy recipient as a migration candidate', () => {
  const lastChat = { phone: '12025550101', chatId: '99' }
  const legacy = { ...connection, version: 1, ownerChatId: undefined, lastChat }
  const result = ConnectionStorageService.read(
    store([[legacyConnectionKey, JSON.stringify(legacy)]]),
  )

  assert.equal(result.value.version, 2)
  assert.equal(result.value.ownerChatId, undefined)
  assert.deepEqual(result.value.migrationCandidate, lastChat)
})
test('SHOULD prefer current access over a stale legacy entry', () => {
  const storage = store([
    [connectionKey, JSON.stringify(connection)],
    [legacyConnectionKey, JSON.stringify({ ...connection, version: 1, idInstance: '456' })],
  ])

  assert.equal(ConnectionStorageService.read(storage).value.idInstance, '123')
})
test('SHOULD remove the legacy entry after saving the current format', () => {
  const storage = store([[legacyConnectionKey, JSON.stringify({ ...connection, version: 1 })]])

  ConnectionStorageService.write(connection, storage)
  assert.equal(storage.getItem(legacyConnectionKey), null)
})
test('SHOULD report malformed saved access without returning credentials', () => {
  const result = ConnectionStorageService.read(store([[connectionKey, '{broken']]))

  assert.equal(result.value, undefined)
  assert.ok(result.error)
})
test('SHOULD reject an invalid saved owner identity', () => {
  const result = ConnectionStorageService.read(
    store([[connectionKey, JSON.stringify({ ...connection, ownerChatId: '-1' })]]),
  )

  assert.equal(result.value, undefined)
  assert.ok(result.error)
})
test('SHOULD surface write failures instead of claiming that access was saved', () => {
  const storage = store()

  storage.setItem = () => {
    throw new Error('denied')
  }

  assert.throws(() => ConnectionStorageService.write(connection, storage), /denied/)
})

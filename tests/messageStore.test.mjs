import assert from 'node:assert/strict'
import test from 'node:test'

import { ConnectionService } from '../src/services/connection.service.ts'
import { DateService } from '../src/services/date.service.ts'
import { MessagePresentationService } from '../src/services/messages/message-presentation.service.ts'
import { MessageService } from '../src/services/messages/message.service.ts'
import { WorkspaceService } from '../src/services/workspace.service.ts'

const message = (id, extra = {}) => ({
  id,
  apiId: id,
  chatId: '42',
  direction: 'out',
  text: 'Текст',
  ...extra,
})

test('SHOULD preserve local identity IF response precedes echo and read', () => {
  const data = WorkspaceService.create()

  MessageService.putMessages(data, [
    message('local', { apiId: undefined, status: 'pending', localCreatedAt: 100 }),
  ])
  MessageService.bindAttempt(data, 'local', 'server', 200)
  MessageService.putMessages(data, [message('echo', { apiId: 'server', serverCreatedAt: 150 })])
  MessageService.putDelivery(data, { chatId: '42', id: 'server', status: 'read' })
  assert.deepEqual(
    data.messages.map((m) => [m.id, m.status]),
    [['local', 'read']],
  )
})
test('SHOULD collapse echo and early read IF response binds the exact ID later', () => {
  const data = WorkspaceService.create()

  MessageService.putMessages(data, [
    message('local', { apiId: undefined, localCreatedAt: 100 }),
    message('echo', { apiId: 'server', serverCreatedAt: 150 }),
  ])
  MessageService.putDelivery(data, { chatId: '42', id: 'server', status: 'read' })
  MessageService.bindAttempt(data, 'local', 'server', 200)
  assert.deepEqual(
    data.messages.map((m) => [m.id, m.status, m.serverCreatedAt, m.firstSeenOrder]),
    [['local', 'read', 150, 1]],
  )
})
test('SHOULD NOT guess correlation IF local response was lost', () => {
  const data = WorkspaceService.create()

  MessageService.putMessages(data, [
    message('local', { apiId: undefined, status: 'unknown' }),
    message('server'),
  ])
  assert.equal(data.messages.length, 2)
})
for (const [status, incoming, expected] of [
  ['read', 'delivered', 'read'],
  ['read', 'failed', 'read'],
  ['delivered', 'failed', 'delivered'],
  ['failed', 'unknown', 'failed'],
  ['failed', undefined, 'failed'],
  ['unknown', 'read', 'read'],
]) {
  test(`SHOULD keep ${expected} IF ${status} is followed by ${incoming ?? 'metadata'}`, () => {
    const data = WorkspaceService.create()

    MessageService.putMessages(data, [message('1', { status, error: 'Причина' })])
    MessageService.putMessages(data, [message('copy', { apiId: '1', status: incoming })])
    assert.equal(data.messages[0].status, expected)
  })
}

test('SHOULD retain the specific failure IF history omits its reason', () => {
  const data = WorkspaceService.create()

  MessageService.putMessages(data, [message('1', { status: 'failed', error: 'Приватность' })])
  MessageService.putMessages(data, [message('copy', { apiId: '1', status: 'unknown' })])
  assert.equal(data.messages[0].error, 'Приватность')
})
for (const extra of [{ chatId: '99' }, { direction: 'in' }, { apiId: 'different' }]) {
  test(`SHOULD retain distinct messages IF identity differs ${JSON.stringify(extra)}`, () => {
    const data = WorkspaceService.create()

    MessageService.putMessages(data, [message('1'), message('2', { apiId: '1', ...extra })])
    assert.equal(data.messages.length, 2)
  })
}

test('SHOULD deduplicate redelivery IF the exact remote identity repeats', () => {
  const data = WorkspaceService.create()

  MessageService.putMessages(data, [message('1')])
  MessageService.putMessages(data, [message('other-ui-id', { apiId: '1' })])
  assert.deepEqual(
    data.messages.map((m) => [m.id, m.firstSeenOrder]),
    [['1', 1]],
  )
})
test('SHOULD NOT assign a failure IF the provider omitted its message ID', () => {
  const data = WorkspaceService.create()

  MessageService.putMessages(data, [message('1', { status: 'pending' })])
  MessageService.putDelivery(data, { chatId: '42', status: 'failed', description: 'Ошибка без ID' })
  assert.equal(data.messages[0].status, 'pending')
  assert.equal(data.meta.warnings['42'], 'Ошибка без ID')
})
test('SHOULD place missing time in a separate stable tail IF chronology is unknown', () => {
  const data = WorkspaceService.create()

  MessageService.putMessages(data, [
    message('unknown'),
    message('later', { serverCreatedAt: 200 }),
    message('earlier', { serverCreatedAt: 100 }),
  ])
  assert.deepEqual(
    MessageService.order(data.messages).map((m) => m.id),
    ['earlier', 'later', 'unknown'],
  )
})
test('SHOULD preserve first observation IF timestamps are equal', () => {
  const data = WorkspaceService.create()

  MessageService.putMessages(data, [
    message('b', { serverCreatedAt: 100 }),
    message('a', { serverCreatedAt: 100 }),
  ])
  assert.deepEqual(
    MessageService.order(structuredClone(data.messages)).map((m) => m.id),
    ['b', 'a'],
  )
})
test('SHOULD keep the first server time IF a later response contradicts it', () => {
  const data = WorkspaceService.create()

  MessageService.putMessages(data, [message('1', { serverCreatedAt: 100 })])
  MessageService.putMessages(data, [message('1', { serverCreatedAt: 200 })])
  assert.equal(data.messages[0].serverCreatedAt, 100)
  assert.equal(data.messages[0].timeConflict, true)
})
test('SHOULD prefer server time IF only local time was known', () => {
  const data = WorkspaceService.create()

  MessageService.putMessages(data, [message('1', { localCreatedAt: 100 })])
  MessageService.putMessages(data, [message('1', { serverCreatedAt: 200 })])
  assert.equal(MessageService.order(data.messages)[0].createdAt, 200)
})
test('SHOULD move an undated message without changing its UI key IF time arrives', () => {
  const data = WorkspaceService.create()

  MessageService.putMessages(data, [message('1')])
  const before = MessagePresentationService.getRows(data.messages, 'scope', '42', 'UTC').find(
    (row) => row.kind === 'message',
  ).key

  MessageService.putMessages(data, [message('1', { serverCreatedAt: 100 })])
  const after = MessagePresentationService.getRows(data.messages, 'scope', '42', 'UTC')

  assert.equal(after.find((row) => row.kind === 'message').key, before)
  assert.equal(after.filter((row) => row.kind === 'undated').length, 0)
})
test('SHOULD group by local calendar day IF UTC and local dates differ', () => {
  const rows = MessagePresentationService.getRows(
    [message('1', { serverCreatedAt: Date.parse('2026-10-19T22:30:00Z') })],
    'scope',
    '42',
    'Europe/Moscow',
  )

  assert.match(rows[0].label, /20 октября 2026/)
})
test('SHOULD keep chronological order IF DST repeats the same wall-clock hour', () => {
  const rows = MessagePresentationService.getRows(
    [
      message('2', { serverCreatedAt: Date.parse('2026-11-01T06:30:00Z') }),
      message('1', { serverCreatedAt: Date.parse('2026-11-01T05:30:00Z') }),
    ],
    'scope',
    '42',
    'America/New_York',
  )

  assert.deepEqual(
    rows.filter((row) => row.kind === 'message').map((row) => row.message.id),
    ['1', '2'],
  )
})
test('SHOULD emit one day separator IF several messages share a calendar date', () => {
  const rows = MessagePresentationService.getRows(
    [message('1', { serverCreatedAt: 100 }), message('2', { serverCreatedAt: 200 })],
    'scope',
    '42',
    'UTC',
  )

  assert.equal(rows.filter((row) => row.kind === 'day').length, 1)
})
test('SHOULD NOT collide with a message key IF an ID resembles a day separator', () => {
  const rows = MessagePresentationService.getRows(
    [message('1970-01-01', { serverCreatedAt: 100 })],
    'scope',
    '42',
    'UTC',
  )

  assert.equal(new Set(rows.map((row) => row.key)).size, rows.length)
})
for (const value of [undefined, null, 0, -1, NaN, Infinity, '123', 8640000000001]) {
  test(`SHOULD NOT invent a date IF timestamp is ${String(value)}`, () =>
    assert.equal(DateService.fromUnix(value), undefined))
}

for (const value of [
  'http://example.test',
  '/relative',
  'https://user:pass@example.test',
  'https://example.test/path',
  'https://example.test?q=1',
  'https://example.test#token',
]) {
  test(`SHOULD reject unsafe API origin IF input is ${value}`, () =>
    assert.throws(() => ConnectionService.normalizeOrigin(value)))
}

test('SHOULD normalize equivalent API origins IF a trailing slash differs', () =>
  assert.equal(ConnectionService.normalizeOrigin('https://EXAMPLE.test/'), 'https://example.test'))
test('SHOULD isolate data IF the account owner changes on the same instance', () =>
  assert.notEqual(
    WorkspaceService.getKey({ apiUrl: 'https://api.test', idInstance: '1', ownerChatId: '42' }),
    WorkspaceService.getKey({ apiUrl: 'https://api.test', idInstance: '1', ownerChatId: '43' }),
  ))

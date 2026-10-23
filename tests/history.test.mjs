import assert from 'node:assert/strict'
import test from 'node:test'

import { HistoryService } from '../src/services/messages/history.service.ts'
import { MessageService } from '../src/services/messages/message.service.ts'
import { WorkspaceService } from '../src/services/workspace.service.ts'

function mergeMessages(previous, received) {
  const workspace = WorkspaceService.create()

  MessageService.putMessages(workspace, [...previous, ...received])

  return MessageService.order(workspace.messages)
}

function entry(id, timestamp, extra = {}) {
  return {
    idMessage: id,
    timestamp,
    chatId: '42',
    type: 'incoming',
    typeMessage: 'textMessage',
    textMessage: 'Привет',
    ...extra,
  }
}

test('SHOULD restore both sides of a conversation chronologically with server time and status', () => {
  const result = HistoryService.parse(
    [entry('2', 200, { type: 'outgoing', statusMessage: 'read' }), entry('1', 100)],
    '42',
  )

  assert.deepEqual(
    result.map((message) => [message.apiId, message.direction, message.createdAt, message.status]),
    [
      ['1', 'in', 100000, undefined],
      ['2', 'out', 200000, 'read'],
    ],
  )
})
test('SHOULD NOT mix another chat or media into text history', () => {
  const result = HistoryService.parse(
    [entry('1', 100, { chatId: '99' }), entry('2', 200, { typeMessage: 'imageMessage' })],
    '42',
  )

  assert.deepEqual(result, [])
})
test('SHOULD show a history error instead of treating a malformed response as an empty conversation', () => {
  assert.throws(() => HistoryService.parse({ error: 'unavailable' }, '42'), /историю/)
})
test('SHOULD NOT invent delivery confirmation if history lacks a status', () => {
  const result = HistoryService.parse([entry('1', 100, { type: 'outgoing' })], '42')

  assert.equal(result[0].status, 'unknown')
})
test('SHOULD show an incoming message once if history and notification contain the same ID', () => {
  const history = HistoryService.parse([entry('1', 100)], '42')
  const notification = {
    apiId: '1',
    id: '1',
    chatId: '42',
    text: 'Привет',
    direction: 'in',
    createdAt: 100000,
  }

  assert.equal(mergeMessages(history, [notification]).length, 1)
})
test('SHOULD retain new arrivals and failed local sends if history finishes loading later', () => {
  const live = [
    { id: 'new', chatId: '42', text: 'Новое', direction: 'in', createdAt: 300000 },
    {
      id: 'local',
      chatId: '42',
      text: 'Не отправилось',
      direction: 'out',
      status: 'failed',
      createdAt: 400000,
    },
  ]
  const result = mergeMessages(live, HistoryService.parse([entry('old', 100)], '42'))

  assert.deepEqual(
    result.map((message) => message.text),
    ['Привет', 'Новое', 'Не отправилось'],
  )
})
test('SHOULD NOT downgrade a read message when an older history response says delivered', () => {
  const live = {
    id: 'local',
    apiId: '1',
    chatId: '42',
    direction: 'out',
    text: 'Привет',
    status: 'read',
  }
  const result = mergeMessages(
    [live],
    HistoryService.parse([entry('1', 100, { type: 'outgoing', statusMessage: 'delivered' })], '42'),
  )

  assert.equal(result.length, 1)
  assert.equal(result[0].status, 'read')
})
test('SHOULD retain identical texts with different message IDs', () => {
  assert.equal(HistoryService.parse([entry('1', 100), entry('2', 200)], '42').length, 2)
})
for (const timestamp of [100, undefined, 200]) {
  test(`SHOULD preserve the first server time if a duplicate history entry has timestamp ${timestamp}`, () => {
    const result = HistoryService.parse(
      [
        entry('1', 100, { type: 'outgoing', statusMessage: 'delivered' }),
        entry('1', timestamp, { type: 'outgoing', statusMessage: 'read' }),
      ],
      '42',
    )

    assert.equal(result.length, 1)
    assert.equal(result[0].status, 'read')
    assert.equal(result[0].serverCreatedAt, 100000)
    assert.equal(result[0].createdAt, 100000)
    assert.equal(!!result[0].timeConflict, timestamp === 200)
  })
}

test('SHOULD NOT merge identical message IDs from different chats or directions', () => {
  const result = mergeMessages(
    [],
    [
      { id: '1', chatId: '42', direction: 'in', text: 'Первое' },
      { id: '1', chatId: '99', direction: 'in', text: 'Другое' },
      { id: '1', chatId: '42', direction: 'out', text: 'Ответ' },
    ],
  )

  assert.equal(result.length, 3)
})
test('SHOULD collapse a send and a history copy if the send response arrives after history', () => {
  const live = { id: 'local', chatId: '42', direction: 'out', text: 'Привет', status: 'pending' }
  const previous = mergeMessages(
    [live],
    HistoryService.parse([entry('1', 100, { type: 'outgoing', statusMessage: 'delivered' })], '42'),
  )
  const workspace = WorkspaceService.create()

  MessageService.putMessages(workspace, previous)
  MessageService.bindAttempt(workspace, 'local', '1', 100000)
  const result = workspace.messages

  assert.equal(result.length, 1)
  assert.equal(result[0].status, 'delivered')
})

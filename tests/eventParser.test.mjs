import assert from 'node:assert/strict'
import test from 'node:test'

import { NotificationService } from '../src/services/messages/notification.service.ts'

const event = (type = 'incomingMessageReceived') => ({
  typeWebhook: type,
  instanceData: { idInstance: 123, typeInstance: 'telegram', wid: 'owner' },
  idMessage: 'msg',
  senderData: { chatId: '42', chatType: 'user' },
  messageData: { typeMessage: 'textMessage', textMessageData: { textMessage: '  Текст\n🙂  ' } },
  timestamp: 100,
})

test('SHOULD recognize documented quota notifications without treating them as unknown events', () => {
  const result = NotificationService.parse(
    {
      ...event('quotaExceeded'),
      quotaData: {
        method: 'correspondents',
        used: 3,
        total: 3,
        status: 'CORRESPONDENTS_QUOTA_EXCEEDED',
        description: 'Monthly chat limit reached.',
      },
    },
    '123',
    'owner',
  )

  assert.deepEqual(result, { kind: 'quota', description: 'Monthly chat limit reached.' })
})
test('SHOULD reject a malformed quota notification instead of acknowledging unreadable diagnostics', () => {
  assert.throws(
    () => NotificationService.parse({ ...event('quotaExceeded'), quotaData: {} }, '123', 'owner'),
    /лимите тарифа/,
  )
})
for (const [type, direction] of [
  ['incomingMessageReceived', 'in'],
  ['outgoingMessageReceived', 'out'],
  ['outgoingAPIMessageReceived', 'out'],
]) {
  test(`SHOULD identify ${direction} IF event is ${type}`, () => {
    const result = NotificationService.parse(event(type), '123', 'owner')

    assert.equal(result.message.direction, direction)
    assert.equal(result.message.text, '  Текст\n🙂  ')
    assert.notEqual(result.message.status, 'delivered')
  })
}

test('SHOULD accept URL text IF a preview is absent', () => {
  const input = event()

  input.messageData = {
    typeMessage: 'extendedTextMessage',
    extendedTextMessageData: { text: 'https://example.test' },
  }
  assert.equal(NotificationService.parse(input, '123').message.text, 'https://example.test')
})
for (const source of [
  { idInstance: 999, typeInstance: 'telegram' },
  { idInstance: 123, typeInstance: 'whatsapp' },
  { idInstance: Number.MAX_SAFE_INTEGER + 1, typeInstance: 'telegram' },
  { idInstance: 123, typeInstance: 'telegram', wid: 'another-owner' },
]) {
  test(`SHOULD reject cross-account input IF source is ${JSON.stringify(source)}`, () => {
    const input = event()

    input.instanceData = source
    assert.throws(() => NotificationService.parse(input, '123', 'owner'))
  })
}

test('SHOULD ignore known media IF this client supports only text', () => {
  const input = event()

  input.messageData = { typeMessage: 'imageMessage' }
  assert.equal(NotificationService.parse(input, '123').kind, 'ignored')
})
test('SHOULD ignore groups IF the sender explicitly identifies a group', () => {
  const input = event()

  input.senderData.chatType = 'group'
  assert.equal(NotificationService.parse(input, '123').kind, 'ignored')
})
test('SHOULD stop on unknown notifications IF processing cannot be established', () =>
  assert.throws(
    () => NotificationService.parse({ ...event(), typeWebhook: 'newUnspecifiedEvent' }, '123'),
    /Неизвестное/,
  ))
test('SHOULD reject broken text IF acknowledgement would discard it', () => {
  const input = event()

  input.messageData.textMessageData.textMessage = null
  assert.throws(() => NotificationService.parse(input, '123'), /не подтверждено/)
})
test('SHOULD preserve the state signal IF it requires a fresh GET', () => {
  assert.deepEqual(
    NotificationService.parse(
      { ...event('stateInstanceChanged'), stateInstance: 'notAuthorized' },
      '123',
    ),
    { kind: 'state', state: 'notAuthorized' },
  )
})

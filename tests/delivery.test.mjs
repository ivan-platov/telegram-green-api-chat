import assert from 'node:assert/strict'
import test from 'node:test'

import { DeliveryService } from '../src/services/messages/delivery.service.ts'

const sent = {
  id: 'local1',
  apiId: 'api1',
  chatId: '456',
  direction: 'out',
  text: 'Привет',
  status: 'pending',
  createdAt: 1000,
}

function event(status = 'delivered', id = 'api1', chatId = '456') {
  return {
    typeWebhook: 'outgoingMessageStatus',
    instanceData: { idInstance: 123, typeInstance: 'telegram' },
    idMessage: id,
    chatId,
    status,
  }
}

test('SHOULD show delivered only for a matching server message and chat', () => {
  const result = DeliveryService.apply(sent, DeliveryService.parse(event(), '123'))

  assert.equal(result.status, 'delivered')
})
test('SHOULD NOT deliver another message with a different server ID', () => {
  assert.equal(
    DeliveryService.apply(sent, DeliveryService.parse(event('delivered', 'other'), '123')).status,
    'pending',
  )
})
test('SHOULD NOT deliver a message in another chat even if its ID matches', () => {
  assert.equal(
    DeliveryService.apply(sent, DeliveryService.parse(event('delivered', 'api1', '789'), '123'))
      .status,
    'pending',
  )
})
test('SHOULD preserve read status if delivered arrives later', () => {
  assert.equal(
    DeliveryService.apply({ ...sent, status: 'read' }, DeliveryService.parse(event(), '123'))
      .status,
    'read',
  )
})
test('SHOULD NOT replace confirmed delivery with an older failure', () => {
  assert.equal(
    DeliveryService.apply(
      { ...sent, status: 'delivered' },
      DeliveryService.parse(event('failed'), '123'),
    ).status,
    'delivered',
  )
})
test('SHOULD retain the failure description on the affected message', () => {
  const result = DeliveryService.apply(
    sent,
    DeliveryService.parse({ ...event('failed'), description: 'USER_PRIVACY_RESTRICTED' }, '123'),
  )

  assert.equal(result.status, 'failed')
  assert.equal(result.error, 'USER_PRIVACY_RESTRICTED')
})
test('SHOULD show a noAccount failure without claiming the account is definitely absent', () => {
  const update = DeliveryService.parse(event('noAccount'), '123')

  assert.equal(update.status, 'failed')
  assert.match(update.description, /скрыт/)
})
test('SHOULD NOT attribute a failure without ID to a particular pending message', () => {
  const body = event('failed')

  delete body.idMessage
  const update = DeliveryService.parse(body, '123')

  assert.equal(DeliveryService.apply(sent, update).status, 'pending')
})
test('SHOULD preserve a status received before the HTTP send response binds the server ID', () => {
  const update = DeliveryService.merge(undefined, DeliveryService.parse(event('read'), '123'))
  const later = DeliveryService.merge(update, DeliveryService.parse(event('delivered'), '123'))

  assert.equal(DeliveryService.apply({ ...sent, apiId: undefined }, later).status, 'pending')
  assert.equal(DeliveryService.apply({ ...sent, apiId: 'api1' }, later).status, 'read')
})
test('SHOULD NOT replace message creation time with the time it was read', () => {
  const result = DeliveryService.apply(
    sent,
    DeliveryService.parse({ ...event('read'), timestamp: 9999999 }, '123'),
  )

  assert.equal(result.createdAt, 1000)
})

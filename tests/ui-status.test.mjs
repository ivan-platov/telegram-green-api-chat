import assert from 'node:assert/strict'
import test from 'node:test'

import { ConnectionService } from '../src/services/connection.service.ts'
import { DeliveryService } from '../src/services/messages/delivery.service.ts'

const ready = () => ({
  phase: 'ready',
  role: 'owner',
  instance: 'authorized',
  receive: 'active',
  incomingReady: true,
  statusesReady: true,
  error: '',
  connectionError: '',
  receiveError: '',
  storageError: '',
  storageWarning: '',
  checkingConnection: false,
  sending: false,
  navigating: false,
})

for (const [changes, label, tone] of [
  [{}, 'Получение сообщений работает', 'success'],
  [{ receive: 'starting' }, 'Подключаем получение…', 'progress'],
  [{ receive: 'retrying', receiveError: 'HTTP 429' }, 'Повторяем запрос уведомлений…', 'progress'],
  [{ receive: 'stopped' }, 'Получение сообщений остановлено', 'error'],
  [{ receive: 'off' }, 'Обмен сообщениями не запущен', 'warning'],
  [{ role: 'waiting', phase: 'waiting' }, 'Ожидаем доступ к чату', 'progress'],
  [{ phase: 'connecting' }, 'Проверяем подключение…', 'progress'],
  [{ phase: 'idle' }, 'Обмен сообщениями не запущен', 'warning'],
  [{ role: 'none' }, 'Обмен сообщениями не запущен', 'warning'],
  [{ error: 'Не удалось выполнить действие.' }, 'Ошибка подключения', 'error'],
  [{ phase: 'error', error: 'Доступ потерян' }, 'Подключение остановлено', 'error'],
  [{ connectionError: 'HTTP 500' }, 'Не удалось проверить подключение', 'error'],
  [{ receiveError: 'Неверное уведомление' }, 'Не удалось получить уведомления', 'error'],
  [
    { storageError: 'QuotaExceededError', connectionError: 'HTTP 500' },
    'Данные не сохраняются',
    'error',
  ],
  [{ incomingReady: false }, 'Получение сообщений не настроено', 'warning'],
  [{ statusesReady: false }, 'Уведомления о доставке не настроены', 'warning'],
  [{ storageWarning: 'Доступ не сохранён' }, 'Доступ не сохранён в браузере', 'warning'],
  [{ checkingConnection: true }, 'Проверяем подключение…', 'progress'],
  [{ instance: 'starting' }, 'Инстанс запускается', 'warning'],
  [{ instance: 'notAuthorized' }, 'Авторизуйте Telegram в кабинете GREEN-API', 'warning'],
  [{ instance: 'pendingPassword' }, 'Завершите двухфакторную авторизацию в кабинете', 'warning'],
  [{ instance: 'pendingCode' }, 'Завершите авторизацию в кабинете', 'warning'],
  [{ instance: 'blocked' }, 'GREEN-API сообщает о блокировке инстанса', 'warning'],
  [{ instance: 'suspended' }, 'На Telegram-аккаунте временные ограничения отправки', 'warning'],
  [
    { instance: 'new-unrecognized-state' },
    'GREEN-API вернул неизвестное состояние инстанса',
    'warning',
  ],
]) {
  test(`SHOULD display "${label}" IF state is ${JSON.stringify(changes)}`, () => {
    assert.deepEqual(ConnectionService.getStatus({ ...ready(), ...changes }), { label, tone })
  })
}

for (const changes of [
  { storageError: 'write failed' },
  { role: 'waiting' },
  { role: 'none', phase: 'error' },
  { phase: 'connecting' },
  { instance: 'notAuthorized' },
  { incomingReady: false },
  { receive: 'retrying' },
  { receive: 'stopped' },
  { receive: 'starting' },
  { connectionError: 'HTTP 500' },
  { receiveError: 'Invalid JSON' },
  { sending: true },
  { navigating: true },
]) {
  test(`SHOULD explain why sending is unavailable IF state is ${JSON.stringify(changes)}`, () => {
    assert.notEqual(ConnectionService.getSendBlockReason({ ...ready(), ...changes }), '')
  })
}

test('SHOULD allow sending IF only delivery notifications or credential persistence are unavailable', () => {
  assert.equal(
    ConnectionService.getSendBlockReason({
      ...ready(),
      statusesReady: false,
      storageWarning: 'not saved',
    }),
    '',
  )
})

test('SHOULD distinguish the failed connection check from the notification error in details', () => {
  const messages = ConnectionService.getProblems({
    ...ready(),
    connectionError: 'HTTP 500',
    receiveError: 'Invalid JSON',
  })

  assert.ok(messages.includes('Проверка подключения: HTTP 500'))
  assert.ok(messages.includes('Получение уведомлений: Invalid JSON'))
})

for (const [message, label] of [
  [{ direction: 'out', status: 'pending' }, 'Отправляется'],
  [{ direction: 'out', status: 'pending', apiId: '42' }, 'Ожидаем подтверждения доставки'],
  [{ direction: 'out', status: 'delivered' }, 'Доставлено'],
  [{ direction: 'out', status: 'read' }, 'Прочитано'],
  [{ direction: 'out', status: 'unknown' }, 'Доставка не подтверждена'],
  [{ direction: 'out', status: 'failed' }, 'Не отправлено'],
  [{ direction: 'out' }, 'Доставка не подтверждена'],
  [{ direction: 'in' }, 'Входящее сообщение'],
]) {
  test(`SHOULD describe message as "${label}" IF ${JSON.stringify(message)}`, () => {
    assert.equal(DeliveryService.getMessageLabel(message), label)
  })
}

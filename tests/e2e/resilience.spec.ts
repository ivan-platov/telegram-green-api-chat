import { expect, test } from '@playwright/test'

import { connect, Gateway, journal, openChat, stored, target } from './fixture.ts'

import type { Route } from '@playwright/test'

let gateway: Gateway

test.beforeEach(async ({ context }) => {
  gateway = new Gateway(context)
  await gateway.install()
})
test.afterEach(() => {
  expect(gateway.unexpected).toEqual([])
})
test('opens an existing recipient instead of creating a duplicate', async ({ page }) => {
  await connect(page)
  await openChat(page)
  await openChat(page)
  await expect(page.getByRole('button', { name: 'Чат +12025550101', exact: true })).toHaveCount(1)
  expect((await stored(page)).chats).toHaveLength(1)
})
test('ignores a late account lookup after cancellation', async ({ page }) => {
  let release: (() => void) | undefined

  gateway.handlers.set('checkAccount', async (route) => {
    await new Promise<void>((resolve) => {
      release = resolve
    })
    await finish?.(route)
  })
  const finish = async (route: Route) => {
    await route.fulfill({ json: { status: true, exist: true, chatId: '42' } }).catch(() => {})
  }

  await connect(page)
  await page.getByRole('button', { name: 'Новый чат', exact: true }).first().click()
  await page.getByLabel('Номер телефона').fill('12025550101')
  await page.getByRole('button', { name: 'Начать чат', exact: true }).click()
  await expect
    .poll(() => gateway.calls.filter((call) => call.method === 'checkAccount').length)
    .toBe(1)
  await page.getByRole('button', { name: 'Отмена', exact: true }).click()
  release?.()
  await expect(page.getByRole('heading', { name: 'Выберите чат или начните новый' })).toBeVisible()
  expect((await stored(page)).chats).toHaveLength(0)
})
test('preserves the number and explains privacy instead of claiming nonexistence', async ({
  page,
}) => {
  gateway.handlers.set('checkAccount', (route) =>
    route.fulfill({ json: { status: true, exist: false } }),
  )
  await connect(page)
  await page.getByRole('button', { name: 'Новый чат', exact: true }).first().click()
  await page.getByLabel('Номер телефона').fill('12025550101')
  await page.getByRole('button', { name: 'Начать чат', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('настройками приватности')
  await expect(page.getByLabel('Номер телефона')).toHaveValue('12025550101')
})
test('retains a newer draft while the previous text is being sent', async ({ page }) => {
  let release: (() => void) | undefined

  gateway.handlers.set('sendMessage', async (route) => {
    await new Promise<void>((resolve) => {
      release = resolve
    })
    await route.fulfill({ json: { idMessage: 'new-server-id' } })
  })
  await connect(page)
  await openChat(page)
  await page.getByRole('textbox', { name: 'Сообщение', exact: true }).fill('Текст N')
  await page.getByRole('button', { name: 'Отправить сообщение' }).click()
  await expect
    .poll(() => gateway.calls.filter((call) => call.method === 'sendMessage').length)
    .toBe(1)
  await expect(page.getByRole('textbox', { name: 'Сообщение', exact: true })).toHaveValue('')
  await expect.poll(async () => (await stored(page)).drafts[0]?.value.text).toBe('')
  await page.getByRole('textbox', { name: 'Сообщение', exact: true }).fill('Текст N+1')
  release?.()
  await expect(page.getByRole('button', { name: 'Отправить сообщение' })).toBeEnabled()
  await expect(page.getByRole('textbox', { name: 'Сообщение', exact: true })).toHaveValue(
    'Текст N+1',
  )
  await expect.poll(async () => (await stored(page)).drafts[0]?.value.text).toBe('Текст N+1')
})
test('does not restore an old text after a late delivery failure', async ({ page }) => {
  gateway.notifications = false
  await connect(page)
  await openChat(page)
  await page.getByRole('textbox', { name: 'Сообщение', exact: true }).fill('Отправленный текст')
  await page.getByRole('button', { name: 'Отправить сообщение' }).click()
  await expect(page.getByRole('textbox', { name: 'Сообщение', exact: true })).toHaveValue('')
  gateway.enqueue(gateway.status('server-1', 'failed'))
  await expect(page.getByLabel('Не отправлено', { exact: true })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Сообщение', exact: true })).toHaveValue('')
})
test('retains an uncertain send separately from a similar remote message', async ({ page }) => {
  gateway.handlers.set('sendMessage', async (route) => {
    gateway.enqueue(gateway.text('Одинаковый текст', 'remote', '42', 'outgoingAPIMessageReceived'))
    await route.abort('connectionreset')
  })
  await connect(page)
  await openChat(page)
  await page.getByRole('textbox', { name: 'Сообщение', exact: true }).fill('Одинаковый текст')
  await page.getByRole('button', { name: 'Отправить сообщение' }).click()
  await expect(page.getByLabel('Доставка не подтверждена', { exact: true })).toBeVisible()
  await expect(
    page.getByTestId('message-scroll').getByText('Одинаковый текст', { exact: true }),
  ).toHaveCount(2)
  expect(gateway.calls.filter((call) => call.method === 'sendMessage')).toHaveLength(1)
})
test('retains old records after a larger history request fails', async ({ page }) => {
  gateway.history = Array.from({ length: 100 }, (_, index) =>
    journal(index === 99 ? 'keep' : String(index), 1700000000 + index),
  )
  await connect(page)
  await openChat(page)
  await expect(
    page.getByTestId('message-scroll').getByText('Сообщение keep', { exact: true }),
  ).toBeVisible()
  gateway.handlers.set('getChatHistory', (route) =>
    route.fulfill({ status: 400, json: { message: 'count unsupported' } }),
  )
  await page.getByTestId('message-scroll').evaluate((element) => {
    element.scrollTop = 0
  })
  await expect(page.getByText('Не удалось загрузить историю.', { exact: true })).toBeVisible()
  expect((await stored(page)).messages).toHaveLength(100)
})
test('does not acknowledge or display a message after storage abort', async ({ page }) => {
  await connect(page)
  await openChat(page)
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put

    IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
      if (this.name === 'messages') {
        this.transaction.abort()
        throw new Error('fixture-storage-abort')
      }

      return original.apply(this, args)
    }
  })
  gateway.enqueue(gateway.text('Не сохранено'))
  await expect(
    page
      .getByText('Не удалось сохранить данные. Обмен приостановлен; текст остаётся в этом окне.', {
        exact: true,
      })
      .first(),
  ).toBeVisible()
  expect(gateway.calls.filter((call) => call.method === 'deleteNotification')).toHaveLength(0)
  expect((await stored(page)).messages).toHaveLength(0)
})
test('persists a message before acknowledging it', async ({ page }) => {
  await connect(page)
  await openChat(page)
  let recordsAtAck = 0

  gateway.handlers.set('deleteNotification', async (route) => {
    recordsAtAck = (await stored(page)).messages.length
    gateway.queue.shift()
    await route.fulfill({ json: { result: true } })
  })
  gateway.enqueue(gateway.text('Ответ сохранён'))
  await expect.poll(() => recordsAtAck).toBe(1)
})
test('retries the same receipt after an ACK failure without duplicating the text', async ({
  page,
}) => {
  let attempts = 0

  gateway.handlers.set('deleteNotification', async (route) => {
    attempts++
    if (attempts === 1) {
      return route.fulfill({ status: 500, json: {} })
    }

    gateway.queue.shift()
    await route.fulfill({ json: { result: true } })
  })
  await connect(page)
  await openChat(page)
  gateway.enqueue(gateway.text('Один ответ'))
  await expect.poll(() => attempts).toBe(2)
  expect((await stored(page)).messages).toHaveLength(1)
})
test('retains legacy access without attributing its chat to an unverified owner', async ({
  page,
}) => {
  await page.addInitScript(
    (value) =>
      localStorage.setItem(
        'green-api-chat.connection.v1',
        JSON.stringify({ version: 1, ...value, lastChat: { phone: '12025550101', chatId: '42' } }),
      ),
    target,
  )
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Чаты', exact: true })).toBeVisible()
  expect(
    gateway.calls.filter((call) => ['checkAccount', 'getChatHistory'].includes(call.method)),
  ).toHaveLength(0)
  expect((await stored(page)).chats).toHaveLength(0)
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('green-api-chat.connection.v2')!).migrationCandidate.chatId,
    ),
  ).toBe('42')
})
test('blocks sending when incoming events are not configured', async ({ page }) => {
  gateway.settings.incomingWebhook = 'no'
  await page.goto('/')
  await page.getByLabel('Адрес API', { exact: true }).fill(target.apiUrl)
  await page.getByLabel('ID инстанса').fill('123')
  await page.getByLabel('Токен доступа').fill('fixture-token')
  await page.getByRole('button', { name: 'Подключиться' }).click()
  await expect(page.getByRole('heading', { name: 'Чаты', exact: true })).toBeVisible()
  await openChat(page)
  await page
    .getByRole('textbox', { name: 'Сообщение', exact: true })
    .fill('Сохраняется как черновик')
  await expect(page.getByRole('button', { name: 'Отправить сообщение' })).toBeDisabled()
  expect(gateway.calls.filter((call) => call.method === 'receiveNotification')).toHaveLength(0)
})
test('rejects an oversized paste without truncating it silently', async ({ page }) => {
  await connect(page)
  await openChat(page)
  await page.getByRole('textbox', { name: 'Сообщение', exact: true }).fill('Прежний текст')
  await page.getByRole('textbox', { name: 'Сообщение', exact: true }).evaluate((element) => {
    const event = new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: new DataTransfer(),
    })

    event.clipboardData!.setData('text/plain', 'x'.repeat(5000))
    element.dispatchEvent(event)
  })
  await expect(page.getByText('Текст не вставлен: предел 4096 символов')).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Сообщение', exact: true })).toHaveValue(
    'Прежний текст',
  )
})
test('sends on desktop Enter but preserves Shift+Enter as a newline', async ({ page }) => {
  await connect(page)
  await openChat(page)
  await page.getByRole('textbox', { name: 'Сообщение', exact: true }).fill('Строка')
  await page.getByRole('textbox', { name: 'Сообщение', exact: true }).press('Shift+Enter')
  await expect(page.getByRole('textbox', { name: 'Сообщение', exact: true })).toHaveValue(
    'Строка\n',
  )
  await page.getByRole('textbox', { name: 'Сообщение', exact: true }).press('Enter')
  await expect.poll(() => gateway.sent).toBe(1)
})
test('does not send while IME composition is active', async ({ page }) => {
  await connect(page)
  await openChat(page)
  const input = page.getByRole('textbox', { name: 'Сообщение', exact: true })

  await input.fill('日本語')
  await input.dispatchEvent('compositionstart')
  await input.press('Enter')
  await input.dispatchEvent('compositionend')
  expect(gateway.sent).toBe(0)
})

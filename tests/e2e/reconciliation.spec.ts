import { expect, test } from '@playwright/test'

import { connect, Gateway, journal, openChat, stored } from './fixture.ts'

import type { Page } from '@playwright/test'

let gateway: Gateway

test.beforeEach(async ({ context }) => {
  gateway = new Gateway(context)
  gateway.notifications = false
  await gateway.install()
})
test.afterEach(() => {
  expect(gateway.unexpected).toEqual([])
})

async function sendOnce(page: Page) {
  await connect(page)
  await openChat(page)
  await page.getByRole('textbox', { name: 'Сообщение', exact: true }).fill('Проверка подтверждения')
  await page.getByRole('button', { name: 'Отправить сообщение' }).click()
  await expect(page.getByRole('textbox', { name: 'Сообщение', exact: true })).toHaveValue('')
  await expect.poll(async () => (await stored(page)).messages[0]?.value.apiId).toBe('server-1')
}

test('does not interpret API acceptance as delivery', async ({ page }) => {
  await sendOnce(page)
  await expect(page.getByLabel('Ожидаем подтверждения доставки', { exact: true })).toHaveCount(1)
  await expect(page.getByLabel('Доставлено', { exact: true })).toHaveCount(0)
  expect(gateway.calls.filter((call) => call.method === 'getMessage')).toHaveLength(0)
})
test('retrieves a missed confirmation after the first scheduled deadline', async ({ page }) => {
  await page.clock.install()
  await sendOnce(page)
  await page.clock.fastForward(11000)
  await expect(page.getByLabel('Прочитано', { exact: true })).toBeVisible()
  expect(gateway.calls.filter((call) => call.method === 'sendMessage')).toHaveLength(1)
})
test('collapses expired deadlines and exposes uncertainty without retrying send', async ({
  page,
}) => {
  gateway.handlers.set('getMessage', (route) =>
    route.fulfill({ status: 400, json: { message: 'Message not found by id' } }),
  )
  await page.clock.install()
  await sendOnce(page)
  await page.clock.fastForward(61000)
  await expect(page.getByLabel('Доставка не подтверждена', { exact: true })).toBeVisible()
  expect(gateway.calls.filter((call) => call.method === 'getMessage')).toHaveLength(1)
  expect(gateway.calls.filter((call) => call.method === 'sendMessage')).toHaveLength(1)
})
test('does not reset an exhausted automatic budget on reload', async ({ page }) => {
  gateway.handlers.set('getMessage', (route) =>
    route.fulfill({ status: 400, json: { message: 'Message not found by id' } }),
  )
  await page.clock.install()
  await sendOnce(page)
  await page.clock.fastForward(61000)
  await expect(page.getByLabel('Доставка не подтверждена', { exact: true })).toBeVisible()
  gateway.history = []
  await page.reload()
  await expect(page.getByRole('textbox', { name: 'Сообщение', exact: true })).toBeVisible()
  await page.clock.fastForward(61000)
  expect(gateway.calls.filter((call) => call.method === 'getMessage')).toHaveLength(1)
})
test('allows manual verification after exhaustion without resending text', async ({ page }) => {
  gateway.handlers.set('getMessage', (route) =>
    route.fulfill({ status: 400, json: { message: 'Message not found by id' } }),
  )
  await page.clock.install()
  await sendOnce(page)
  await page.clock.fastForward(61000)
  await page.getByLabel('Доставка не подтверждена', { exact: true }).click()
  gateway.handlers.delete('getMessage')
  await page.getByRole('button', { name: 'Проверить статус', exact: true }).click()
  await page.clock.fastForward(1101)
  await expect(page.getByLabel('Прочитано', { exact: true })).toBeVisible()
  expect(gateway.calls.filter((call) => call.method === 'sendMessage')).toHaveLength(1)
})
test('rejects a confirmation that belongs to another chat', async ({ page }) => {
  gateway.handlers.set('getMessage', (route) =>
    route.fulfill({
      json: {
        chatId: '999',
        idMessage: 'server-1',
        type: 'outgoing',
        typeMessage: 'textMessage',
        textMessage: 'Другой чат',
        statusMessage: 'read',
      },
    }),
  )
  await page.clock.install()
  await sendOnce(page)
  await page.clock.fastForward(11000)
  await expect(page.getByText('Предупреждение по чату', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Прочитано', { exact: true })).toHaveCount(0)
})
test('stops meaningless retries after a validation error', async ({ page }) => {
  gateway.handlers.set('getMessage', (route) =>
    route.fulfill({ status: 400, json: { message: 'invalid id' } }),
  )
  await page.clock.install()
  await sendOnce(page)
  await page.clock.fastForward(11000)
  await expect(page.getByText('Предупреждение по чату', { exact: true })).toBeVisible()
  await page.clock.fastForward(61000)
  expect(gateway.calls.filter((call) => call.method === 'getMessage')).toHaveLength(1)
})
test('cancels pending verification after an early delivery event', async ({ page }) => {
  await page.clock.install()
  await sendOnce(page)
  gateway.enqueue(gateway.status('server-1', 'delivered'))
  await page.clock.fastForward(250)
  await expect(page.getByLabel('Доставлено', { exact: true })).toBeVisible()
  await page.clock.fastForward(61000)
  expect(gateway.calls.filter((call) => call.method === 'getMessage')).toHaveLength(0)
})
test('restores an interrupted local attempt as unknown after reload', async ({ page }) => {
  let release: (() => void) | undefined

  gateway.handlers.set('sendMessage', async (route) => {
    await new Promise<void>((resolve) => {
      release = resolve
    })
    await route.fulfill({ json: { idMessage: 'unreceived' } }).catch(() => {})
  })
  await connect(page)
  await openChat(page)
  await page.getByRole('textbox', { name: 'Сообщение', exact: true }).fill('Неизвестная попытка')
  await page.getByRole('button', { name: 'Отправить сообщение' }).click()
  await expect.poll(async () => (await stored(page)).messages.length).toBe(1)
  await page.reload()
  release?.()
  await expect(page.getByLabel('Доставка не подтверждена', { exact: true })).toBeVisible()
  expect(gateway.calls.filter((call) => call.method === 'sendMessage')).toHaveLength(1)
})
test('does not expose a token-bearing server error path in the UI', async ({ page }) => {
  gateway.handlers.set('getChatHistory', (route) =>
    route.fulfill({
      status: 400,
      json: { message: 'Bad request', path: '/waInstance123/getChatHistory/fixture-token' },
    }),
  )
  await connect(page)
  await openChat(page)
  await expect(page.getByRole('heading', { name: 'История не загружена' })).toBeVisible()
  expect(await page.locator('body').innerText()).not.toContain('fixture-token')
})
for (const failure of ['network', '500', '429', 'not-found'] as const) {
  test(`SHOULD explain a failed manual status check (${failure}) and allow verification without resending`, async ({
    page,
  }) => {
    gateway.history = [
      { ...journal('unconfirmed', 1700000000, '42', true), statusMessage: 'unknown' },
    ]
    gateway.handlers.set('getMessage', (route) =>
      failure === 'network'
        ? route.abort('connectionreset')
        : route.fulfill({
            status: failure === 'not-found' ? 400 : Number(failure),
            json: {
              message: failure === 'not-found' ? 'Message not found by id' : 'fixture error',
            },
          }),
    )
    await connect(page)
    await openChat(page)
    await page.getByLabel('Доставка не подтверждена', { exact: true }).click()
    await page.getByRole('button', { name: 'Проверить статус', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('Не удалось проверить статус.')
    if (failure === '500') {
      await page.screenshot({ path: '.artifacts/status-error.png' })
    }

    const record = (await stored(page)).messages[0].value

    expect(record.status).toBe('unknown')
    expect(
      (
        record.reconcile as {
          attempts: number
        }
      ).attempts,
    ).toBe(0)
    gateway.history[0].statusMessage = 'read'
    gateway.handlers.delete('getMessage')
    await page.getByRole('button', { name: 'Проверить статус', exact: true }).click()
    await expect(page.getByLabel('Прочитано', { exact: true })).toBeVisible()
    await expect(page.getByRole('alert')).toHaveCount(0)
    expect(gateway.sent).toBe(0)
  })
}

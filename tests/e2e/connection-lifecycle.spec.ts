import { expect, test } from '@playwright/test'

import { connect, Gateway, journal, openChat, stored, target } from './fixture.ts'

let gateway: Gateway

test.beforeEach(async ({ context }) => {
  gateway = new Gateway(context)
  await gateway.install()
})
test.afterEach(() => {
  expect(gateway.unexpected).toEqual([])
})
test('cancels a waiting lock without starting an API session', async ({ page, context }) => {
  await connect(page)
  const second = await context.newPage()

  await second.goto('/')
  await expect(
    second
      .getByText('Ожидаем доступ к очереди сообщений. Обмен в этой вкладке ещё не запущен.', {
        exact: true,
      })
      .first(),
  ).toBeVisible()
  await second.getByRole('button', { name: 'Отключиться', exact: true }).click()
  await expect(second.getByRole('heading', { name: 'Подключение Telegram' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Подключение Telegram' })).toBeVisible()
  expect(gateway.calls.filter((call) => call.page === second)).toHaveLength(0)
})
test('retains readable cache in a waiting tab without allowing draft writes', async ({
  page,
  context,
}) => {
  gateway.history = [journal('cached')]
  await connect(page)
  await openChat(page)
  await page.getByRole('textbox', { name: 'Сообщение', exact: true }).fill('Только владелец пишет')
  await expect(page.getByText('Сохраняем черновик…')).toHaveCount(0)
  const second = await context.newPage()

  await second.goto('/')
  const draft = second.getByRole('textbox', { name: 'Сообщение', exact: true })

  await expect(draft).toHaveValue('Только владелец пишет')
  await expect(draft).toHaveAttribute('readonly', '')
  expect(gateway.calls.filter((call) => call.page === second)).toHaveLength(0)
})
test('does not invent a mutex if Web Locks are unavailable', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'locks', { value: undefined }))
  await page.goto('/')
  await page.getByLabel('Адрес API', { exact: true }).fill(target.apiUrl)
  await page.getByLabel('ID инстанса').fill('123')
  await page.getByLabel('Токен доступа').fill('fixture-token')
  await page.getByRole('button', { name: 'Подключиться' }).click()
  await expect(page.getByRole('alert')).toContainText('Web Locks')
  expect(gateway.calls).toHaveLength(0)
})
test('invalidates access in other tabs after explicit removal', async ({ page, context }) => {
  await connect(page)
  await openChat(page)
  const second = await context.newPage()

  await second.goto('/')
  await expect(second.getByRole('textbox', { name: 'Сообщение', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Отключиться', exact: true }).click()
  await expect(second.getByRole('heading', { name: 'Подключение Telegram' })).toBeVisible()
  expect(gateway.calls.filter((call) => call.page === second)).toHaveLength(0)
})
test('StrictMode starts one handshake and one queue owner', async ({ page }) => {
  await page.addInitScript(
    (value) =>
      localStorage.setItem(
        'green-api-chat.connection.v2',
        JSON.stringify({ version: 2, ...value, ownerChatId: '100', credentialRevision: 1 }),
      ),
    target,
  )
  await page.goto('/')
  await expect(page.getByText('Получение сообщений работает', { exact: true })).toBeVisible()
  expect(gateway.calls.filter((call) => call.method === 'getStateInstance')).toHaveLength(1)
})
test('checks state and owner on the 30-second monitor', async ({ page }) => {
  await page.clock.install()
  await connect(page)
  gateway.state = 'notAuthorized'
  await page.clock.fastForward(30010)
  await expect(
    page.getByText('Авторизуйте Telegram в кабинете GREEN-API', { exact: true }).first(),
  ).toBeVisible()
  expect(
    gateway.calls.filter((call) => call.method === 'getAccountSettings').length,
  ).toBeGreaterThan(1)
})
for (const [state, expected] of [
  ['starting', 'Инстанс запускается'],
  ['blocked', 'GREEN-API сообщает о блокировке инстанса'],
  ['suspended', 'На Telegram-аккаунте временные ограничения отправки'],
  ['pendingPassword', 'Завершите двухфакторную авторизацию в кабинете'],
]) {
  test(`preserves the conversation if the instance becomes ${state}`, async ({ page }) => {
    await connect(page)
    await openChat(page)
    await page.getByRole('textbox', { name: 'Сообщение', exact: true }).fill('Сохранённый текст')
    gateway.state = state
    gateway.enqueue({
      typeWebhook: 'stateInstanceChanged',
      stateInstance: state,
      instanceData: { idInstance: 123, typeInstance: 'telegram', wid: 'owner' },
    })
    await expect(page.getByText(expected, { exact: true }).first()).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Сообщение', exact: true })).toHaveValue(
      'Сохранённый текст',
    )
    await expect(page.getByRole('button', { name: 'Отправить сообщение' })).toBeDisabled()
  })
}

test('rechecks a stale queue state instead of logging out permanently', async ({ page }) => {
  await connect(page)
  await openChat(page)
  gateway.enqueue({
    typeWebhook: 'stateInstanceChanged',
    stateInstance: 'notAuthorized',
    instanceData: { idInstance: 123, typeInstance: 'telegram', wid: 'owner' },
  })
  await expect
    .poll(() => gateway.calls.filter((call) => call.method === 'getStateInstance').length)
    .toBe(2)
  await expect(page.getByText('Получение сообщений работает', { exact: true })).toBeVisible()
})
test('stops receiving unknown events without deleting their queue head', async ({ page }) => {
  await connect(page)
  gateway.enqueue({
    typeWebhook: 'unhandledEvent',
    instanceData: { idInstance: 123, typeInstance: 'telegram' },
  })
  await expect(
    page
      .getByText(
        'Получение уведомлений: Неизвестное уведомление. Получение остановлено без подтверждения.',
        {
          exact: true,
        },
      )
      .first(),
  ).toBeVisible()
  expect(gateway.calls.filter((call) => call.method === 'deleteNotification')).toHaveLength(0)
})
test('allows send with a warning when only status notifications are disabled', async ({ page }) => {
  gateway.settings.outgoingWebhook = 'no'
  await connect(page)
  await openChat(page)
  await page.getByRole('textbox', { name: 'Сообщение', exact: true }).fill('Разрешено отправить')
  await expect(page.getByRole('button', { name: 'Отправить сообщение' })).toBeEnabled()
  await expect(
    page.getByText('Уведомления о доставке не настроены', { exact: true }).first(),
  ).toBeVisible()
})
test('isolates local cache when the instance owner changes', async ({ page }) => {
  gateway.history = [journal('old-owner')]
  await connect(page)
  await openChat(page)
  await expect.poll(async () => (await stored(page)).messages.length).toBe(1)
  await page.getByRole('textbox', { name: 'Сообщение', exact: true }).fill('Старый draft')
  await expect(page.getByText('Сохраняем черновик…')).toHaveCount(0)
  gateway.owner = '101'
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Чаты', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Чат +12025550101', exact: true })).toHaveCount(0)
  expect((await stored(page)).messages).toHaveLength(1)
})
test('uses the newly entered API host without reusing the old workspace', async ({ page }) => {
  await connect(page)
  await openChat(page)
  await page.getByRole('button', { name: 'Отключиться', exact: true }).click()
  await page.getByLabel('Адрес API', { exact: true }).fill('https://another-api.test')
  await page.getByLabel('ID инстанса').fill('123')
  await page.getByLabel('Токен доступа').fill('another-fake-token')
  await page.getByRole('button', { name: 'Подключиться' }).click()
  await expect(page.getByText('Получение сообщений работает', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Чат +12025550101', exact: true })).toHaveCount(0)
})
test('shows a history failure instead of claiming an empty conversation', async ({ page }) => {
  gateway.handlers.set('getChatHistory', (route) => route.fulfill({ status: 500, json: {} }))
  await connect(page)
  await openChat(page)
  await expect(page.getByRole('heading', { name: 'История не загружена' })).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Нет доступных текстовых сообщений' }),
  ).toHaveCount(0)
})
for (const width of [320, 600, 800]) {
  test(`keeps composer and navigation inside a ${width}px viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 600 })
    await connect(page)
    await openChat(page)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const button = await page.getByRole('button', { name: 'Отправить сообщение' }).boundingBox()

    expect(button!.y + button!.height).toBeLessThanOrEqual(600)
  })
}

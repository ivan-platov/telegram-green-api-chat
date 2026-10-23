import { expect, test } from '@playwright/test'

import { connect, Gateway, journal, openChat, stored } from './fixture.ts'

let gateway: Gateway

test.beforeEach(async ({ context }) => {
  gateway = new Gateway(context)
  await gateway.install()
})
test.afterEach(() => {
  expect(gateway.unexpected).toEqual([])
})
test('opens a central new-chat card without sending a message', async ({ page }) => {
  await connect(page)
  await expect(page.getByLabel('Номер телефона')).toHaveCount(0)
  await openChat(page)
  expect(gateway.sent).toBe(0)
  await expect(page.getByRole('button', { name: 'Чат +12025550101', exact: true })).toBeVisible()
})
test('sends once and displays the exact read status', async ({ page }) => {
  await connect(page)
  await openChat(page)
  await page.getByRole('textbox', { name: 'Сообщение', exact: true }).fill('Привет\n🙂')
  await page.getByRole('button', { name: 'Отправить сообщение' }).click()
  await expect(page.getByLabel('Прочитано', { exact: true })).toHaveCount(1)
  expect(gateway.sent).toBe(1)
  const data = await stored(page)

  expect(data.messages).toHaveLength(1)
  expect(data.messages[0].value.text).toBe('Привет\n🙂')
})
test('restores messages and the selected chat after reload', async ({ page }) => {
  gateway.history = [journal('old')]
  await connect(page)
  await openChat(page)
  await expect(
    page.getByTestId('message-scroll').getByText('Сообщение old', { exact: true }),
  ).toBeVisible()
  await page.reload()
  await expect(page.getByRole('textbox', { name: 'Сообщение', exact: true })).toBeVisible()
  await expect(
    page.getByTestId('message-scroll').getByText('Сообщение old', { exact: true }),
  ).toBeVisible()
})
test('retains separate drafts across chats and reload', async ({ page }) => {
  await connect(page)
  await openChat(page)
  await page.getByRole('textbox', { name: 'Сообщение', exact: true }).fill('Черновик A')
  await openChat(page, '+1 202 555 0102')
  await expect(page.getByRole('textbox', { name: 'Сообщение', exact: true })).toHaveValue('')
  await page.getByRole('textbox', { name: 'Сообщение', exact: true }).fill('Черновик B')
  await page.getByRole('button', { name: 'Чат +12025550101', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Сообщение', exact: true })).toHaveValue(
    'Черновик A',
  )
  await expect(page.getByText('Сохраняем черновик…')).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('textbox', { name: 'Сообщение', exact: true })).toHaveValue(
    'Черновик A',
  )
})
test('excludes a second API consumer and hands over ownership after close', async ({
  page,
  context,
}) => {
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
  expect(gateway.calls.filter((call) => call.page === second)).toHaveLength(0)
  await page.close()
  await expect(second.getByRole('heading', { name: 'Чаты', exact: true })).toBeVisible()
  await expect(second.getByText('Получение сообщений работает', { exact: true })).toBeVisible()
})
test('disconnect removes access but retains local history', async ({ page }) => {
  gateway.history = [journal('keep')]
  await connect(page)
  await openChat(page)
  await expect(
    page.getByTestId('message-scroll').getByText('Сообщение keep', { exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Отключиться', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Подключение Telegram' })).toBeVisible()
  expect((await stored(page)).messages).toHaveLength(1)
  await page.reload()
  await expect(page.getByLabel('ID инстанса', { exact: true })).toHaveValue('')
})
test('increases history count without inventing pagination', async ({ page }) => {
  gateway.history = Array.from({ length: 250 }, (_, index) =>
    journal(`${index}`, 1700000000 + index),
  )
  await connect(page)
  await openChat(page)
  await expect.poll(async () => (await stored(page)).messages.length).toBe(100)
  await page.getByTestId('message-scroll').evaluate((element) => {
    element.scrollTop = 0
  })
  await expect.poll(async () => (await stored(page)).messages.length).toBe(200)
  expect((await stored(page)).messages).toHaveLength(200)
  expect(
    gateway.calls.filter((call) => call.method === 'getChatHistory').map((call) => call.body),
  ).toEqual([
    { chatId: '42', count: 100 },
    { chatId: '42', count: 200 },
  ])
})
test('navigates list, creation and conversation on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 })
  await connect(page)
  await openChat(page)
  await page.getByRole('button', { name: 'Назад к чатам' }).click()
  await expect(page.getByRole('button', { name: 'Чат +12025550101', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

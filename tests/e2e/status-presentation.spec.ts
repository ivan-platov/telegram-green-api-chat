import { expect, test } from '@playwright/test'

import { connect, Gateway, openChat, target } from './fixture.ts'

test('SHOULD show receipt initialization until the first notification request succeeds', async ({
  page,
  context,
}) => {
  const gateway = new Gateway(context)
  let release = () => {}

  const held = new Promise<void>((resolve) => {
    release = resolve
  })

  gateway.handlers.set('receiveNotification', async (route) => {
    await held
    await route.fulfill({ json: null }).catch(() => {})
  })
  await gateway.install()
  try {
    await page.goto('/')
    await page.getByLabel('Адрес API', { exact: true }).fill(target.apiUrl)
    await page.getByLabel('ID инстанса', { exact: true }).fill(target.idInstance)
    await page.getByLabel('Токен доступа', { exact: true }).fill(target.apiTokenInstance)
    await page.getByRole('button', { name: 'Подключиться', exact: true }).click()
    await expect(page.getByText('Подключаем получение…', { exact: true })).toBeVisible()
    await expect(page.getByText('Получение сообщений работает', { exact: true })).toHaveCount(0)
    release()
    await expect(page.getByText('Получение сообщений работает', { exact: true })).toBeVisible()
    expect(gateway.unexpected).toEqual([])
  } finally {
    release()
  }
})

test('SHOULD retain a failed connection check while notifications keep succeeding', async ({
  page,
  context,
}) => {
  const gateway = new Gateway(context)

  await gateway.install()
  await page.clock.install()
  await connect(page)
  await openChat(page)
  gateway.handlers.set('getStateInstance', (route) =>
    route.fulfill({ status: 500, json: { message: 'fixture error' } }),
  )
  await page.clock.fastForward(30010)
  await expect(page.getByText('Не удалось проверить подключение', { exact: true })).toBeVisible()
  const polls = gateway.calls.filter((call) => call.method === 'receiveNotification').length

  await page.clock.fastForward(1200)
  await expect
    .poll(() => gateway.calls.filter((call) => call.method === 'receiveNotification').length)
    .toBeGreaterThan(polls)
  await expect(page.getByText('Не удалось проверить подключение', { exact: true })).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Отправить сообщение', exact: true }),
  ).toBeDisabled()
  await page.getByRole('textbox', { name: 'Сообщение', exact: true }).fill('Сохранённый черновик')
  gateway.handlers.delete('getStateInstance')
  await page.getByRole('button', { name: 'Проверить подключение', exact: true }).click()
  await page.clock.fastForward(1200)
  await expect(page.getByText('Получение сообщений работает', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Отправить сообщение', exact: true })).toBeEnabled()
  expect(gateway.unexpected).toEqual([])
})

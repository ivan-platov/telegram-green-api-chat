import { expect, test } from '@playwright/test'

import { connect, Gateway, openChat, stored } from './fixture.ts'

let gateway: Gateway

test.beforeEach(async ({ context }) => {
  gateway = new Gateway(context)
  await gateway.install()
})
test.afterEach(() => {
  expect(gateway.unexpected).toEqual([])
})
test('SHOULD persist a quota notice before ACK and continue receiving permitted messages', async ({
  page,
}) => {
  await connect(page)
  await openChat(page)
  let savedBeforeAck = false

  gateway.handlers.set('deleteNotification', async (route) => {
    const data = await stored(page)

    if (route.request().url().endsWith('/1')) {
      savedBeforeAck = data.meta.some((item) =>
        Boolean(
          (
            item.value.quotaNotice as
              | {
                  description?: string
                }
              | undefined
          )?.description,
        ),
      )
    }

    gateway.queue.shift()
    await route.fulfill({ json: { result: true } })
  })
  gateway.enqueue({
    typeWebhook: 'quotaExceeded',
    instanceData: { idInstance: 123, typeInstance: 'telegram', wid: 'owner' },
    quotaData: {
      method: 'correspondents',
      used: 3,
      total: 3,
      status: 'CORRESPONDENTS_QUOTA_EXCEEDED',
      description: 'Лимит новых чатов достигнут. Доступен обмен с ранее использованными чатами.',
    },
  })
  gateway.enqueue(gateway.text('Ответ разрешённого собеседника', 'after-quota'))
  await expect(
    page.getByText('Уведомление GREEN-API о лимите тарифа', { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByTestId('message-scroll').getByText('Ответ разрешённого собеседника', { exact: true }),
  ).toBeVisible()
  await expect.poll(() => gateway.queue.length).toBe(0)
  expect(savedBeforeAck).toBe(true)
  await expect(page.getByText('Получение сообщений работает', { exact: true })).toBeVisible()
  await page.getByText('Подробнее о лимите', { exact: true }).click()
  await page.screenshot({ path: '.artifacts/quota-notice.png' })
  await page
    .getByRole('textbox', { name: 'Сообщение', exact: true })
    .fill('Продолжить разрешённый обмен')
  await expect(page.getByRole('button', { name: 'Отправить сообщение' })).toBeEnabled()
  await page.getByRole('button', { name: 'Скрыть уведомление о лимите' }).click()
  await expect(
    page.getByText('Уведомление GREEN-API о лимите тарифа', { exact: true }),
  ).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('textbox', { name: 'Сообщение', exact: true })).toBeVisible()
  await expect(
    page.getByText('Уведомление GREEN-API о лимите тарифа', { exact: true }),
  ).toHaveCount(0)
})
test('SHOULD stop without ACK if the quota notice cannot be saved', async ({ page }) => {
  await connect(page)
  await openChat(page)
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put

    IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
      if (this.name === 'meta') {
        this.transaction.abort()
        throw new Error('fixture-quota-save-abort')
      }

      return original.apply(this, args)
    }
  })
  gateway.enqueue({
    typeWebhook: 'quotaExceeded',
    instanceData: { idInstance: 123, typeInstance: 'telegram', wid: 'owner' },
    quotaData: { description: 'Лимит новых чатов достигнут.' },
  })
  await expect(
    page
      .getByText('Не удалось сохранить данные. Обмен приостановлен; текст остаётся в этом окне.', {
        exact: true,
      })
      .first(),
  ).toBeVisible()
  expect(gateway.calls.filter((call) => call.method === 'deleteNotification')).toHaveLength(0)
  expect(gateway.queue).toHaveLength(1)
})

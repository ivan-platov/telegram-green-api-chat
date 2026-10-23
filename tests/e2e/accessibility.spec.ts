import { expect, test } from '@playwright/test'

import { connect, Gateway, journal, openChat } from './fixture.ts'

let gateway: Gateway

test.beforeEach(async ({ context }) => {
  gateway = new Gateway(context)
  await gateway.install()
})
test.afterEach(() => {
  expect(gateway.unexpected).toEqual([])
})

function luminance(value: string) {
  const numbers = value
    .match(/[\d.]+/g)!
    .slice(0, 3)
    .map(Number)
    .map((channel) => {
      const normalized = channel / 255

      return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
    })

  return numbers[0] * 0.2126 + numbers[1] * 0.7152 + numbers[2] * 0.0722
}

function ratio(left: string, right: string) {
  const a = luminance(left)
  const b = luminance(right)

  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

test('measures text contrast in the connection form', async ({ page }) => {
  await page.goto('/')
  for (const locator of [
    page.getByRole('button', { name: 'Подключиться' }),
    page.getByText('Введите данные инстанса из кабинета GREEN-API.', { exact: true }),
  ]) {
    const pair = await locator.evaluate((element) => {
      const style = getComputedStyle(element)
      let node: Element | null = element
      let background = style.backgroundColor

      while (node && (background === 'rgba(0, 0, 0, 0)' || background === 'transparent')) {
        node = node.parentElement
        if (node) {
          background = getComputedStyle(node).backgroundColor
        }
      }

      return { foreground: style.color, background }
    })

    expect(ratio(pair.foreground, pair.background)).toBeGreaterThanOrEqual(4.5)
  }
})
test('measures the input boundary against its background', async ({ page }) => {
  await page.goto('/')
  const colors = await page.getByLabel('ID инстанса').evaluate((element) => {
    const style = getComputedStyle(element)

    return { border: style.borderTopColor, background: style.backgroundColor }
  })

  expect(ratio(colors.border, colors.background)).toBeGreaterThanOrEqual(3)
})
test('makes the phone error available to the focused input', async ({ page }) => {
  gateway.handlers.set('checkAccount', (route) =>
    route.fulfill({ json: { status: true, exist: false } }),
  )
  await connect(page)
  await page.getByRole('button', { name: 'Новый чат', exact: true }).first().click()
  const input = page.getByLabel('Номер телефона')

  await expect(input).toBeFocused()
  await input.fill('12025550101')
  await input.press('Enter')
  await expect(input).toHaveAttribute('aria-invalid', 'true')
  await expect(input).toHaveAttribute('aria-describedby', 'phone-error')
})
test('uses newline on touch devices even with a wide screen', async ({ browser }) => {
  const context = await browser.newContext({
    hasTouch: true,
    viewport: { width: 1280, height: 800 },
  })
  const touchGateway = new Gateway(context)

  await touchGateway.install()
  try {
    const page = await context.newPage()

    await connect(page)
    await openChat(page)
    await page.getByRole('textbox', { name: 'Сообщение', exact: true }).fill('Текст')
    await page.getByRole('textbox', { name: 'Сообщение', exact: true }).press('Enter')
    await expect(page.getByRole('textbox', { name: 'Сообщение', exact: true })).toHaveValue(
      'Текст\n',
    )
    expect(touchGateway.sent).toBe(0)
  } finally {
    await context.close()
  }
})
test('does not open the software keyboard after a touch navigation', async ({ browser }) => {
  const context = await browser.newContext({
    hasTouch: true,
    viewport: { width: 360, height: 740 },
  })
  const touchGateway = new Gateway(context)

  await touchGateway.install()
  try {
    const page = await context.newPage()

    await connect(page)
    await page.getByRole('button', { name: 'Новый чат', exact: true }).tap()
    await page.getByLabel('Номер телефона').fill('12025550101')
    await page.getByRole('button', { name: 'Начать чат', exact: true }).tap()
    await expect(page.getByRole('heading', { name: '+12025550101', exact: true })).toBeFocused()
    await expect(page.getByRole('textbox', { name: 'Сообщение', exact: true })).not.toBeFocused()
  } finally {
    await context.close()
  }
})
test('SHOULD keep read messages compact and noninteractive', async ({ page }) => {
  await connect(page)
  await openChat(page)
  await page.getByRole('textbox', { name: 'Сообщение', exact: true }).fill('Проверка')
  await page.getByRole('button', { name: 'Отправить сообщение' }).click()
  const status = page.getByLabel('Прочитано', { exact: true })

  await expect(status).toBeVisible()
  await status.click()
  await expect(page.getByTestId('message-scroll').locator('details')).toHaveCount(0)
  await expect(status.locator('time')).toHaveText(/\d{2}:\d{2}/)
  await expect(page.getByText('Входящее сообщение', { exact: true })).toHaveCount(0)
  expect(await status.evaluate((element) => (element as HTMLElement).tabIndex)).toBe(-1)
})
test('SHOULD show incoming message time without expandable details', async ({ page }) => {
  gateway.history = [journal('incoming')]
  await connect(page)
  await openChat(page)
  const metadata = page.getByLabel('Время сообщения', { exact: true })

  await expect(metadata).toBeVisible()
  await metadata.click()
  await expect(page.getByTestId('message-scroll').locator('details')).toHaveCount(0)
  await expect(metadata.locator('time')).toHaveText(/\d{2}:\d{2}/)
  await expect(page.getByText('Входящее сообщение', { exact: true })).toHaveCount(0)
})
test('SHOULD keep failed message explanation accessible', async ({ page }) => {
  gateway.history = [{ ...journal('failed', 1700000000, '42', true), statusMessage: 'failed' }]
  await connect(page)
  await openChat(page)
  const status = page.getByLabel('Не отправлено', { exact: true })

  await expect(status).toBeVisible()
  const rect = await status.boundingBox()

  expect(rect!.height).toBeGreaterThanOrEqual(44)
  expect(rect!.width).toBeGreaterThanOrEqual(44)
  await status.click()
  await expect(page.locator('[data-ui~="message-details"]')).toBeVisible()
})

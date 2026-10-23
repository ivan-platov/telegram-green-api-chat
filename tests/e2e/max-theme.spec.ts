import { expect, test } from '@playwright/test'

import { connect, Gateway, journal, openChat } from './fixture.ts'

for (const width of [1280, 390]) {
  test(`SHOULD render distinguishable delivery icons at ${width}px`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 850 })
    const gateway = new Gateway(context)

    gateway.history = ['delivered', 'read', 'failed', 'unknown'].map((status, index) => ({
      ...journal(status, 1700000000 + index, '42', true),
      statusMessage: status === 'unknown' ? undefined : status,
    }))
    let release = () => {}

    const sending = new Promise<void>((resolve) => {
      release = resolve
    })

    gateway.handlers.set('sendMessage', async (route) => {
      await sending
      await route.fulfill({ json: { idMessage: 'pending-preview' } }).catch(() => {})
    })
    await gateway.install()
    try {
      await connect(page)
      await openChat(page)
      await expect(page.locator('[data-direction="out"]')).toHaveCount(4)
      await page.getByRole('textbox', { name: 'Сообщение', exact: true }).fill('Отправка сообщения')
      await page.getByRole('button', { name: 'Отправить сообщение', exact: true }).click()
      await expect(page.locator('[data-status="pending"]')).toBeVisible()
      const masks = []

      for (const status of ['pending', 'delivered', 'read', 'failed', 'unknown']) {
        const icon = page.locator(`[data-status="${status}"] [data-ui~="delivery-icon"]`)

        await expect(icon).toBeVisible()
        masks.push(await icon.evaluate((el) => getComputedStyle(el).maskImage))
      }

      expect(masks.every((mask) => mask !== 'none')).toBe(true)
      expect(new Set(masks).size).toBe(5)
      await page.getByRole('textbox', { name: 'Сообщение', exact: true }).focus()
      await page.screenshot({ path: `.artifacts/delivery-icons-${width}.png` })
      expect(gateway.unexpected).toEqual([])
    } finally {
      release()
    }
  })
}

test('SHOULD apply the observed MAX palette and header IF the workspace opens', async ({
  page,
  context,
}) => {
  const gateway = new Gateway(context)

  await gateway.install()
  await connect(page)
  expect(
    await page
      .locator('[data-ui~="sidebar"]')
      .evaluate((el) => getComputedStyle(el).backgroundColor),
  ).toBe('rgb(23, 24, 28)')
  const header = await page.locator('[data-ui~="sidebar-header"]').boundingBox()

  expect(header!.height).toBe(65)
  await openChat(page)
  expect(
    await page.locator('[data-ui~="chat-row"]').evaluate((el) => el.getBoundingClientRect().height),
  ).toBe(82)
  expect(
    await page
      .locator('[data-ui~="chat-row"] .avatar')
      .evaluate((el) => el.getBoundingClientRect().width),
  ).toBe(56)
  expect(
    await page
      .locator('[data-ui~="main-pane"]')
      .evaluate((el) => getComputedStyle(el, '::before').maskImage),
  ).toContain('max-space-pattern')
  expect(gateway.unexpected).toEqual([])
})
test('SHOULD show observed MAX bubble gradients IF incoming and outgoing text exist', async ({
  page,
  context,
}) => {
  const gateway = new Gateway(context)

  gateway.history = [journal('incoming'), journal('outgoing', 1700000060, '42', true)]
  await gateway.install()
  await connect(page)
  await openChat(page)
  await expect(page.locator('[data-direction="in"]')).toBeVisible()
  await expect(page.locator('[data-direction="out"]')).toBeVisible()
  expect(
    await page
      .locator('[data-direction="in"]')
      .evaluate((el) => getComputedStyle(el).backgroundImage),
  ).toContain('rgb(59, 63, 94)')
  expect(
    await page
      .locator('[data-direction="out"]')
      .evaluate((el) => getComputedStyle(el).backgroundImage),
  ).toContain('rgb(136, 73, 180)')
  expect(
    await page
      .locator('[data-ui~="message-text"]')
      .first()
      .evaluate((el) => getComputedStyle(el).fontSize),
  ).toBe('16px')
  expect(gateway.unexpected).toEqual([])
})

import { expect, test } from '@playwright/test'

import { connect, Gateway, openChat } from './fixture.ts'

let gateway: Gateway

test.beforeEach(async ({ context }) => {
  gateway = new Gateway(context)
  await gateway.install()
})
test.afterEach(() => {
  expect(gateway.unexpected).toEqual([])
})
test('SHOULD send on the first deliberate Enter after mouse completion of IME', async ({
  page,
}) => {
  await connect(page)
  await openChat(page)
  const input = page.getByRole('textbox', { name: 'Сообщение', exact: true })

  await input.fill('日本語')
  await input.dispatchEvent('compositionstart')
  await input.dispatchEvent('compositionend')
  await input.press('a')
  await input.press('Enter')
  await expect.poll(() => gateway.sent).toBe(1)
  await expect(input).toHaveValue('')
})
test('SHOULD suppress the IME commit Enter only until that key is released', async ({ page }) => {
  await connect(page)
  await openChat(page)
  const input = page.getByRole('textbox', { name: 'Сообщение', exact: true })

  await input.fill('日本語')
  await input.dispatchEvent('compositionstart')
  await input.dispatchEvent('keydown', { key: 'Enter', isComposing: true })
  await input.dispatchEvent('compositionend')
  await input.dispatchEvent('keydown', { key: 'Enter', repeat: true })
  expect(gateway.sent).toBe(0)
  await input.dispatchEvent('keyup', { key: 'Enter' })
  await input.press('Enter')
  await expect.poll(() => gateway.sent).toBe(1)
})

import assert from 'node:assert/strict'
import test from 'node:test'

import { PhoneService } from '../src/services/phone.service.ts'

for (const input of ['8 (999) 123-45-67', '+7 999 123 45 67', '79991234567']) {
  test(`SHOULD use the same canonical recipient IF entered as ${input}`, () => {
    assert.deepEqual(PhoneService.normalize(input), { ok: true, digits: '79991234567' })
  })
}

test('SHOULD preserve an international country code IF it is not Russia', () => {
  assert.deepEqual(PhoneService.normalize('+995 555 123 456'), { ok: true, digits: '995555123456' })
})
for (const input of [
  '',
  '123',
  '+7 987',
  '+7 999 123 456700',
  '+8 999 123 4567',
  '+999 123456789',
  'номер +7 999 123 4567',
  '+7 999 123 4567 доб. 2',
  '7+9991234567',
  '+7 000 000 0000',
]) {
  test(`SHOULD reject an invalid number IF input is ${JSON.stringify(input)}`, () => {
    assert.equal(PhoneService.normalize(input).ok, false)
  })
}

test('SHOULD correct a saved national phone label IF the old app stored 8', () => {
  assert.equal(PhoneService.getLabel('89991234567'), '+79991234567')
})

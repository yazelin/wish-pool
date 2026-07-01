import { describe, it, expect } from 'vitest'
import { signWish, verifyWish } from '../src/lib/sign'

const S = 'test-sign-secret'
const wish = { title: '報價', problem: 'p', current: 'c', desired: 'd', who: 'w' }

describe('signWish / verifyWish', () => {
  it('round-trips a valid signature', async () => {
    const sig = await signWish(S, wish, 'ok', 1000 + 3600)
    expect(await verifyWish(S, wish, 'ok', sig, 1000)).toBe(true)
  })

  it('rejects edited content (hash mismatch)', async () => {
    const sig = await signWish(S, wish, 'ok', 1000 + 3600)
    expect(await verifyWish(S, { ...wish, title: '改成不當內容' }, 'ok', sig, 1000)).toBe(false)
  })

  it('rejects an expired signature', async () => {
    const sig = await signWish(S, wish, 'ok', 1000 + 3600)
    expect(await verifyWish(S, wish, 'ok', sig, 999999)).toBe(false)
  })

  it('rejects a wrong signing secret', async () => {
    const sig = await signWish(S, wish, 'ok', 5000)
    expect(await verifyWish('other-secret', wish, 'ok', sig, 1000)).toBe(false)
  })

  it('rejects garbage / empty / non-string sig', async () => {
    expect(await verifyWish(S, wish, 'ok', 'nonsense', 1000)).toBe(false)
    expect(await verifyWish(S, wish, 'ok', '', 1000)).toBe(false)
    expect(await verifyWish(S, wish, 'ok', undefined, 1000)).toBe(false)
  })

  it('trims fields consistently: untrimmed sign vs trimmed verify match', async () => {
    const sig = await signWish(S, { title: '  報價  ', problem: 'p' }, 'ok', 5000)
    expect(await verifyWish(S, { title: '報價', problem: 'p' }, 'ok', sig, 1000)).toBe(true)
  })
})

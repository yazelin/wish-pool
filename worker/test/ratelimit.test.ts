import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { hashIp, checkAndBump } from '../src/lib/ratelimit'

beforeEach(async () => { await env.DB.exec('DELETE FROM rate_limits') })

describe('hashIp', () => {
  it('is stable and differs by ip', async () => {
    const a1 = await hashIp('1.2.3.4', 's')
    const a2 = await hashIp('1.2.3.4', 's')
    const b = await hashIp('5.6.7.8', 's')
    expect(a1).toBe(a2)
    expect(a1).not.toBe(b)
    expect(a1).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('checkAndBump', () => {
  it('allows up to limit then blocks, resets after window', async () => {
    expect(await checkAndBump(env.DB, 'ip:x', 2, 60, 1000)).toBe(true)  // 1
    expect(await checkAndBump(env.DB, 'ip:x', 2, 60, 1001)).toBe(true)  // 2
    expect(await checkAndBump(env.DB, 'ip:x', 2, 60, 1002)).toBe(false) // over
    expect(await checkAndBump(env.DB, 'ip:x', 2, 60, 9999)).toBe(true)  // window passed
  })

  it('separate buckets independent', async () => {
    expect(await checkAndBump(env.DB, 'a', 1, 60, 1)).toBe(true)
    expect(await checkAndBump(env.DB, 'a', 1, 60, 2)).toBe(false)
    expect(await checkAndBump(env.DB, 'b', 1, 60, 3)).toBe(true)
  })
})

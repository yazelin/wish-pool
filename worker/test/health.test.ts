import { describe, it, expect } from 'vitest'
import { SELF } from 'cloudflare:test'

describe('health', () => {
  it('GET /health returns ok', async () => {
    const res = await SELF.fetch('https://x.test/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('migrations applied: wishes table exists', async () => {
    const { env } = await import('cloudflare:test')
    const r = await env.DB.prepare('SELECT count(*) as n FROM wishes').first<{ n: number }>()
    expect(r?.n).toBe(0)
  })
})

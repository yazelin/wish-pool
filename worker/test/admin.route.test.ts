import { describe, it, expect, beforeEach } from 'vitest'
import { SELF, env } from 'cloudflare:test'

const O = 'https://test.local'
const AUTH = { 'Content-Type': 'application/json', Origin: O, Authorization: 'Bearer test-admin-token' }

beforeEach(async () => { await env.DB.exec('DELETE FROM wishes') })

async function seed(status: string) {
  const { createWish } = await import('../src/lib/d1')
  return createWish(env.DB, { title: 'T', status, open_questions: [] }, 1)
}

describe('admin auth', () => {
  it('no token -> 401', async () => {
    const res = await SELF.fetch(`${O}/api/admin/wishes?status=pending`)
    expect(res.status).toBe(401)
  })

  it('wrong token -> 401', async () => {
    const res = await SELF.fetch(`${O}/api/admin/wishes?status=pending`, {
      headers: { Origin: O, Authorization: 'Bearer nope' },
    })
    expect(res.status).toBe(401)
  })
})

describe('admin ops', () => {
  it('lists pending', async () => {
    await seed('pending'); await seed('published')
    const res = await SELF.fetch(`${O}/api/admin/wishes?status=pending`, { headers: AUTH })
    expect((await res.json<any>()).wishes.length).toBe(1)
  })

  it('sets status (approve pending -> published)', async () => {
    const id = await seed('pending')
    const res = await SELF.fetch(`${O}/api/admin/wishes/${id}/status`, {
      method: 'POST', headers: AUTH, body: JSON.stringify({ status: 'published' }),
    })
    expect(res.status).toBe(200)
    // 直接斷言狀態真的被改到 published(GET /api/wishes/:id 不依狀態過濾,
    // 只檢查 200 的話,即使 setStatus 靜默失敗測試也會過)。
    const check = await SELF.fetch(`${O}/api/wishes/${id}`)
    expect(check.status).toBe(200)
    expect((await check.json<any>()).status).toBe('published')
  })

  it('rejects invalid status -> 400', async () => {
    const id = await seed('pending')
    const res = await SELF.fetch(`${O}/api/admin/wishes/${id}/status`, {
      method: 'POST', headers: AUTH, body: JSON.stringify({ status: 'garbage' }),
    })
    expect(res.status).toBe(400)
  })

  it('export returns all incl pending', async () => {
    await seed('pending'); await seed('published')
    const res = await SELF.fetch(`${O}/api/admin/export`, { headers: AUTH })
    expect((await res.json<any[]>()).length).toBe(2)
  })
})

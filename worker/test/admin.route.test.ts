import { describe, it, expect, beforeEach } from 'vitest'
import { SELF, env } from 'cloudflare:test'

const O = 'https://test.local'
const AUTH = { 'Content-Type': 'application/json', Origin: O, Authorization: 'Bearer test-admin-token' }

beforeEach(async () => { await env.DB.exec('DELETE FROM answers; DELETE FROM needs; DELETE FROM wishes') })

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

describe('admin phase2', () => {
  it('hide an answer, accept an answer -> wish done + accepted', async () => {
    const { createWish, createAnswer } = await import('../src/lib/d1')
    const id = await createWish(env.DB, { title: 'T', status: 'published', open_questions: [] }, 1)
    const aid = await createAnswer(env.DB, id, { repo_url: 'https://github.com/x/a' }, 1)
    const hide = await SELF.fetch(`${O}/api/admin/answers/${aid}/status`, { method: 'POST', headers: AUTH, body: JSON.stringify({ status: 'hidden' }) })
    expect(hide.status).toBe(200)
    const acc = await SELF.fetch(`${O}/api/admin/wishes/${id}/accept`, { method: 'POST', headers: AUTH, body: JSON.stringify({ answer_id: aid }) })
    expect(acc.status).toBe(200)
    const w = await SELF.fetch(`${O}/api/wishes/${id}`).then((r) => r.json<any>())
    expect(w.status).toBe('done'); expect(w.accepted_answer_id).toBe(aid)
  })
  it('accept with bad answer_id -> 400; admin endpoints need token', async () => {
    const { createWish } = await import('../src/lib/d1')
    const id = await createWish(env.DB, { title: 'T', status: 'published', open_questions: [] }, 1)
    const bad = await SELF.fetch(`${O}/api/admin/wishes/${id}/accept`, { method: 'POST', headers: AUTH, body: JSON.stringify({ answer_id: 99999 }) })
    expect(bad.status).toBe(400)
    const noauth = await SELF.fetch(`${O}/api/admin/needs/1/resolve`, { method: 'POST' })
    expect(noauth.status).toBe(401)
  })
  it('hard delete removes the wish and its children', async () => {
    const { createWish, createAnswer, addUpdate, createNeed } = await import('../src/lib/d1')
    const id = await createWish(env.DB, { title: 'DEL', status: 'done', open_questions: [] }, 1)
    await createAnswer(env.DB, id, { repo_url: 'https://github.com/x/a' }, 1)
    await addUpdate(env.DB, id, { kind: 'claim', body: 'x' }, 1)
    await createNeed(env.DB, id, 'info', 'y')
    const del = await SELF.fetch(`${O}/api/admin/wishes/${id}/delete`, { method: 'POST', headers: AUTH })
    expect(del.status).toBe(200)
    const gone = await SELF.fetch(`${O}/api/wishes/${id}`)
    expect(gone.status).toBe(404)
    const n = await env.DB.prepare('SELECT count(*) AS c FROM answers WHERE wish_id = ?').bind(id).first<{ c: number }>()
    expect(n?.c).toBe(0)
  })
})

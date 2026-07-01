import { describe, it, expect, beforeEach } from 'vitest'
import { SELF, env, fetchMock } from 'cloudflare:test'

const O = 'https://test.local'
const H = { 'Content-Type': 'application/json', Origin: O }

beforeEach(async () => {
  await env.DB.exec('DELETE FROM votes')
  await env.DB.exec('DELETE FROM responses')
  await env.DB.exec('DELETE FROM open_questions')
  await env.DB.exec('DELETE FROM wishes')
  await env.DB.exec('DELETE FROM rate_limits')
  fetchMock.activate()
  fetchMock.disableNetConnect()
})

// Turnstile siteverify 一律成功
function mockTurnstileOk() {
  fetchMock.get('https://challenges.cloudflare.com')
    .intercept({ path: /siteverify/, method: 'POST' }).reply(200, { success: true }).persist()
}

async function seed(status = 'published') {
  const { createWish } = await import('../src/lib/d1')
  return createWish(env.DB, {
    title: 'T', problem: 'p', current: 'c', desired: 'd', who: 'w',
    nickname: 'n', status, open_questions: ['q?'],
  }, 1)
}

describe('POST /api/wishes', () => {
  it('verdict ok -> published', async () => {
    mockTurnstileOk()
    const res = await SELF.fetch(`${O}/api/wishes`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ turnstileToken: 't', verdict: 'ok', open_questions: ['a?'],
        wish: { title: '自動報價', problem: 'x', current: 'y', desired: 'z', who: 'w', nickname: 'me' } }),
    })
    expect(res.status).toBe(200)
    const j = await res.json<{ id: number; status: string }>()
    expect(j.status).toBe('published')
  })

  it('no verdict -> pending', async () => {
    mockTurnstileOk()
    const res = await SELF.fetch(`${O}/api/wishes`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ turnstileToken: 't', wish: { title: '純表單願望' } }),
    })
    const j = await res.json<{ status: string }>()
    expect(j.status).toBe('pending')
  })

  it('turnstile fail -> 403', async () => {
    // 空 token 讓 verifyTurnstile 直接短路回 false(不打 siteverify)。
    // 避免在同一 test file 的 MockPool 內註冊衝突的 success:false 攔截器
    // (fetchMock 每檔才 reset、persist 攔截器 FIFO 比對,success:true 會先中)。
    const res = await SELF.fetch(`${O}/api/wishes`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ turnstileToken: '', wish: { title: 'x' } }),
    })
    expect(res.status).toBe(403)
  })

  it('missing title -> 400', async () => {
    mockTurnstileOk()
    const res = await SELF.fetch(`${O}/api/wishes`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ turnstileToken: 't', wish: { title: '  ' } }),
    })
    expect(res.status).toBe(400)
  })
})

describe('GET /api/wishes', () => {
  it('lists published only', async () => {
    await seed('published'); await seed('pending')
    const res = await SELF.fetch(`${O}/api/wishes?sort=new`)
    const j = await res.json<{ wishes: any[] }>()
    expect(j.wishes.length).toBe(1)
  })
})

describe('GET /api/wishes/:id', () => {
  it('returns wish with nested data, 404 when absent', async () => {
    const id = await seed('published')
    const ok = await SELF.fetch(`${O}/api/wishes/${id}`)
    expect(ok.status).toBe(200)
    expect((await ok.json<any>()).open_questions.length).toBe(1)
    const no = await SELF.fetch(`${O}/api/wishes/99999`)
    expect(no.status).toBe(404)
  })
})

describe('POST vote + responses', () => {
  it('votes once, dup returns ok:false', async () => {
    mockTurnstileOk()
    const id = await seed('published')
    const a = await SELF.fetch(`${O}/api/wishes/${id}/vote`, { method: 'POST', headers: H, body: JSON.stringify({ turnstileToken: 't' }) })
    expect((await a.json<any>()).votes).toBe(1)
    const b = await SELF.fetch(`${O}/api/wishes/${id}/vote`, { method: 'POST', headers: H, body: JSON.stringify({ turnstileToken: 't' }) })
    expect((await b.json<any>()).ok).toBe(false)
  })

  it('adds a response answering an open question', async () => {
    mockTurnstileOk()
    const id = await seed('published')
    const w = await SELF.fetch(`${O}/api/wishes/${id}`).then((r) => r.json<any>())
    const qid = w.open_questions[0].id
    const res = await SELF.fetch(`${O}/api/wishes/${id}/responses`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ turnstileToken: 't', body: '看材質', kind: 'answer', questionId: qid }),
    })
    expect(res.status).toBe(200)
    const after = await SELF.fetch(`${O}/api/wishes/${id}`).then((r) => r.json<any>())
    expect(after.open_questions[0].resolved).toBe(1)
  })

  it('vote on nonexistent wish -> 404', async () => {
    mockTurnstileOk()
    const res = await SELF.fetch(`${O}/api/wishes/99999/vote`, {
      method: 'POST', headers: H, body: JSON.stringify({ turnstileToken: 't' }),
    })
    expect(res.status).toBe(404)
  })

  it('respond on nonexistent wish -> 404', async () => {
    mockTurnstileOk()
    const res = await SELF.fetch(`${O}/api/wishes/99999/responses`, {
      method: 'POST', headers: H, body: JSON.stringify({ turnstileToken: 't', body: 'hi', kind: 'metoo' }),
    })
    expect(res.status).toBe(404)
  })

  it('non-numeric id -> 404, not 500', async () => {
    const res = await SELF.fetch(`${O}/api/wishes/abc`)
    expect(res.status).toBe(404)
  })
})

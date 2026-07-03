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
  it('verdict ok WITH a valid signature -> published', async () => {
    mockTurnstileOk()
    const { signWish } = await import('../src/lib/sign')
    const wish = { title: '自動報價', problem: 'x', current: 'y', desired: 'z', who: 'w' }
    const sig = await signWish('test-sign-secret', wish, 'ok', Math.floor(Date.now() / 1000) + 3600)
    const res = await SELF.fetch(`${O}/api/wishes`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ turnstileToken: 't', verdict: 'ok', sig, open_questions: ['a?'],
        wish: { ...wish, nickname: 'me' } }),
    })
    expect(res.status).toBe(200)
    const j = await res.json<{ id: number; status: string }>()
    expect(j.status).toBe('published')
  })

  it('verdict ok but NO signature (forged) -> pending', async () => {
    mockTurnstileOk()
    const res = await SELF.fetch(`${O}/api/wishes`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ turnstileToken: 't', verdict: 'ok', wish: { title: '直接偽造 ok' } }),
    })
    expect((await res.json<{ status: string }>()).status).toBe('pending')
  })

  it('verdict ok but content edited after signing (sig mismatch) -> pending', async () => {
    mockTurnstileOk()
    const { signWish } = await import('../src/lib/sign')
    const sig = await signWish('test-sign-secret', { title: '原本無害', problem: 'p' }, 'ok', Math.floor(Date.now() / 1000) + 3600)
    const res = await SELF.fetch(`${O}/api/wishes`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ turnstileToken: 't', verdict: 'ok', sig, wish: { title: '改成不當內容', problem: 'p' } }),
    })
    expect((await res.json<{ status: string }>()).status).toBe('pending')
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
    expect((await ok.json<any>()).needs.length).toBe(1)
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

  it('adds a response', async () => {
    mockTurnstileOk()
    const id = await seed('published')
    const res = await SELF.fetch(`${O}/api/wishes/${id}/responses`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ turnstileToken: 't', body: '看材質', kind: 'answer' }),
    })
    expect(res.status).toBe(200)
    const after = await SELF.fetch(`${O}/api/wishes/${id}`).then((r) => r.json<any>())
    expect(after.responses[0].body).toBe('看材質')
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

describe('GET /api/wishes/:id/spec', () => {
  it('compiles complete markdown spec (needs+answers to needs+discussion+answers)', async () => {
    const { createWish, createNeed, addResponse, addUpdate, createAnswer } = await import('../src/lib/d1')
    const id = await createWish(env.DB, { title: 'S', problem: 'p', desired: 'd', status: 'published', open_questions: [] }, 1)
    const nid = await createNeed(env.DB, id, 'info', '網頁還是 App?')
    await addResponse(env.DB, id, { body: '網頁', nickname: '發呆', kind: 'answer', questionId: nid }, 2)
    await addResponse(env.DB, id, { body: '希望有深色模式', kind: 'metoo' }, 3)
    await addUpdate(env.DB, id, { kind: 'claim', body: '我來' }, 4)
    await createAnswer(env.DB, id, { repo_url: 'https://github.com/x/a', note: 'v1' }, 5)
    const res = await SELF.fetch(`${O}/api/wishes/${id}/spec`)
    expect(res.status).toBe(200)
    const t = await res.text()
    for (const frag of ['# 願望 #', '網頁還是 App?', '答:網頁(發呆)', '希望有深色模式', 'claim: 我來', 'https://github.com/x/a']) {
      expect(t).toContain(frag)
    }
  })
  it('404 for pending/hidden wishes', async () => {
    const { createWish } = await import('../src/lib/d1')
    const id = await createWish(env.DB, { title: 'P', status: 'pending', open_questions: [] }, 1)
    expect((await SELF.fetch(`${O}/api/wishes/${id}/spec`)).status).toBe(404)
  })
})

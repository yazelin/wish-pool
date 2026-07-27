import { describe, it, expect, beforeEach } from 'vitest'
import { SELF, env, fetchMock } from 'cloudflare:test'

// 協力者 GitHub OAuth 登入(issue #2)。重點:state 驗不過要拒絕、同一帳號重複投票只算一票、
// 登入後的署名由伺服器決定(不吃 body 的 github_handle)。

const O = 'https://test.local'
const H = { 'Content-Type': 'application/json', Origin: O }

beforeEach(async () => {
  for (const t of ['answer_votes', 'answers', 'updates', 'needs', 'responses', 'open_questions', 'votes', 'wishes', 'rate_limits']) {
    await env.DB.exec(`DELETE FROM ${t}`)
  }
  fetchMock.activate(); fetchMock.disableNetConnect()
})

async function seed() {
  const { createWish } = await import('../src/lib/d1')
  return createWish(env.DB, { title: 'T', status: 'published', open_questions: [] }, 1)
}

async function freshState(): Promise<string> {
  const r = await SELF.fetch(`${O}/api/auth/github/start`, { headers: { Origin: O } })
  return (await r.json<any>()).state
}

// 走完整條 OAuth callback,拿到一枚 session token(GitHub 端全部 mock)
async function login(login: string, id: number): Promise<string> {
  fetchMock.get('https://github.com').intercept({ path: '/login/oauth/access_token', method: 'POST' })
    .reply(200, { access_token: 'gho_test', token_type: 'bearer' })
  fetchMock.get('https://api.github.com').intercept({ path: '/user', method: 'GET' })
    .reply(200, { id, login, avatar_url: `https://avatars.test/${login}.png` })
  const state = await freshState()
  const res = await SELF.fetch(`${O}/api/auth/github/callback`, {
    method: 'POST', headers: H, body: JSON.stringify({ code: 'the-code', state }),
  })
  expect(res.status).toBe(200)
  return (await res.json<any>()).token
}
const sess = (t: string) => ({ ...H, 'X-Wish-Session': t })

describe('GET /api/auth/github/start', () => {
  it('回傳 GitHub authorize_url,帶 client_id、redirect_uri 與 state', async () => {
    const res = await SELF.fetch(`${O}/api/auth/github/start`, { headers: { Origin: O } })
    expect(res.status).toBe(200)
    const j = await res.json<any>()
    const u = new URL(j.authorize_url)
    expect(u.origin + u.pathname).toBe('https://github.com/login/oauth/authorize')
    expect(u.searchParams.get('client_id')).toBe('test-gh-client-id')
    expect(u.searchParams.get('redirect_uri')).toBe('https://test.local/wish-pool/')
    expect(u.searchParams.get('state')).toBe(j.state)
    expect(j.state.split('.').length).toBe(3)
  })
})

describe('POST /api/auth/github/callback — state 驗證', () => {
  it('偽造的 state -> 400 bad_state(而且不打 GitHub)', async () => {
    // 沒有任何 fetchMock;disableNetConnect 生效 -> 若真的打 GitHub 會炸
    const res = await SELF.fetch(`${O}/api/auth/github/callback`, {
      method: 'POST', headers: H, body: JSON.stringify({ code: 'x', state: '9999999999.deadbeefdeadbeef.notavalidmac' }),
    })
    expect(res.status).toBe(400)
    expect((await res.json<any>()).error).toBe('bad_state')
  })
  it('被竄改過的合法 state(改 exp)-> 400 bad_state', async () => {
    const state = await freshState()
    const [exp, nonce, mac] = state.split('.')
    const res = await SELF.fetch(`${O}/api/auth/github/callback`, {
      method: 'POST', headers: H, body: JSON.stringify({ code: 'x', state: `${Number(exp) + 3600}.${nonce}.${mac}` }),
    })
    expect(res.status).toBe(400)
    expect((await res.json<any>()).error).toBe('bad_state')
  })
  it('過期的 state -> 400 bad_state', async () => {
    const { signState } = await import('../src/lib/oauth')
    const expired = await signState('test-session-secret', 'abcdef0123456789', Math.floor(Date.now() / 1000) - 10)
    const res = await SELF.fetch(`${O}/api/auth/github/callback`, {
      method: 'POST', headers: H, body: JSON.stringify({ code: 'x', state: expired }),
    })
    expect(res.status).toBe(400)
  })
  it('沒有 state -> 400 bad_state', async () => {
    const res = await SELF.fetch(`${O}/api/auth/github/callback`, { method: 'POST', headers: H, body: JSON.stringify({ code: 'x' }) })
    expect(res.status).toBe(400)
  })
  it('state 過關但 GitHub 不發 token -> 401,不發 session', async () => {
    fetchMock.get('https://github.com').intercept({ path: '/login/oauth/access_token', method: 'POST' })
      .reply(200, { error: 'bad_verification_code' })
    const state = await freshState()
    const res = await SELF.fetch(`${O}/api/auth/github/callback`, {
      method: 'POST', headers: H, body: JSON.stringify({ code: 'x', state }),
    })
    expect(res.status).toBe(401)
    expect((await res.json<any>()).error).toBe('oauth_exchange_failed')
  })
  it('完整流程 -> 回 session token 與 user;/api/auth/me 認得出來', async () => {
    const token = await login('octocat', 583231)
    const me = await SELF.fetch(`${O}/api/auth/me`, { headers: { Origin: O, 'X-Wish-Session': token } })
    expect(me.status).toBe(200)
    expect((await me.json<any>()).user.login).toBe('octocat')
  })
})

describe('session token', () => {
  it('竄改過的 session -> /api/auth/me 401', async () => {
    const token = await login('octocat', 1)
    const res = await SELF.fetch(`${O}/api/auth/me`, { headers: { Origin: O, 'X-Wish-Session': token.slice(0, -2) + 'ff' } })
    expect(res.status).toBe(401)
  })
  it('過期的 session -> 401', async () => {
    const { issueSession } = await import('../src/lib/oauth')
    const old = await issueSession('test-session-secret', { id: 7, login: 'ghost' }, Math.floor(Date.now() / 1000) - 5)
    const res = await SELF.fetch(`${O}/api/auth/me`, { headers: { Origin: O, 'X-Wish-Session': old } })
    expect(res.status).toBe(401)
  })
  it('沒帶 session -> 401', async () => {
    const res = await SELF.fetch(`${O}/api/auth/me`, { headers: { Origin: O } })
    expect(res.status).toBe(401)
  })
})

describe('乾淨票數:一個 GitHub 帳號一票', () => {
  it('同一使用者換 IP 重複投同一願望 -> 只算一票', async () => {
    // 全程沒有 mockTurnstile:登入身分本身就免 Turnstile,若走 siteverify 會因 disableNetConnect 炸掉
    const token = await login('voter', 42)
    const id = await seed()
    const first = await SELF.fetch(`${O}/api/wishes/${id}/vote`, {
      method: 'POST', headers: { ...sess(token), 'CF-Connecting-IP': '1.1.1.1' }, body: JSON.stringify({}),
    }).then((r) => r.json<any>())
    expect(first).toEqual({ ok: true, votes: 1 })
    const second = await SELF.fetch(`${O}/api/wishes/${id}/vote`, {
      method: 'POST', headers: { ...sess(token), 'CF-Connecting-IP': '2.2.2.2' }, body: JSON.stringify({}),
    }).then((r) => r.json<any>())
    expect(second).toEqual({ ok: false, votes: 1 })
    const w = await SELF.fetch(`${O}/api/wishes/${id}`).then((r) => r.json<any>())
    expect(w.votes).toBe(1)
  })
  it('不同使用者從同一個 IP 投票 -> 兩票都算(不再被 IP 軟去重誤殺)', async () => {
    const a = await login('alice', 1001)
    const b = await login('bob', 1002)
    const id = await seed()
    const r1 = await SELF.fetch(`${O}/api/wishes/${id}/vote`, {
      method: 'POST', headers: { ...sess(a), 'CF-Connecting-IP': '3.3.3.3' }, body: JSON.stringify({}),
    }).then((r) => r.json<any>())
    const r2 = await SELF.fetch(`${O}/api/wishes/${id}/vote`, {
      method: 'POST', headers: { ...sess(b), 'CF-Connecting-IP': '3.3.3.3' }, body: JSON.stringify({}),
    }).then((r) => r.json<any>())
    expect(r1.ok).toBe(true)
    expect(r2).toEqual({ ok: true, votes: 2 })
  })
  it('實作版本投票同樣一帳號一票', async () => {
    const token = await login('voter', 55)
    const id = await seed()
    const { createAnswer } = await import('../src/lib/d1')
    const aid = await createAnswer(env.DB, id, { repo_url: 'https://github.com/x/a' }, 1)
    const first = await SELF.fetch(`${O}/api/answers/${aid}/vote`, {
      method: 'POST', headers: { ...sess(token), 'CF-Connecting-IP': '4.4.4.4' }, body: JSON.stringify({}),
    }).then((r) => r.json<any>())
    const second = await SELF.fetch(`${O}/api/answers/${aid}/vote`, {
      method: 'POST', headers: { ...sess(token), 'CF-Connecting-IP': '5.5.5.5' }, body: JSON.stringify({}),
    }).then((r) => r.json<any>())
    expect(first).toEqual({ ok: true, votes: 1 })
    expect(second).toEqual({ ok: false, votes: 1 })
  })
  it('偽造的 session 又沒有 Turnstile -> 403(不能靠假 session 免驗證)', async () => {
    const id = await seed()
    const res = await SELF.fetch(`${O}/api/wishes/${id}/vote`, {
      method: 'POST', headers: { ...H, 'X-Wish-Session': 'ZmFrZQ.deadbeef' }, body: JSON.stringify({ turnstileToken: '' }),
    })
    expect(res.status).toBe(403)
  })
})

describe('已驗證署名', () => {
  it('交實作時署名以登入帳號為準,body 的 github_handle 不算數', async () => {
    const token = await login('realdev', 77)
    const id = await seed()
    const res = await SELF.fetch(`${O}/api/wishes/${id}/answers`, {
      method: 'POST', headers: sess(token),
      body: JSON.stringify({ repo_url: 'https://github.com/realdev/thing', github_handle: 'someone-else' }),
    })
    expect(res.status).toBe(200)
    const w = await SELF.fetch(`${O}/api/wishes/${id}`).then((r) => r.json<any>())
    expect(w.answers[0].github_handle).toBe('realdev')
    expect(w.answers[0].handle_verified).toBe(1)
  })
  it('認領/進度回報同樣掛已驗證署名', async () => {
    const token = await login('realdev', 78)
    const id = await seed()
    await SELF.fetch(`${O}/api/wishes/${id}/updates`, {
      method: 'POST', headers: sess(token), body: JSON.stringify({ kind: 'claim', body: '我來做', github_handle: 'fake' }),
    })
    const w = await SELF.fetch(`${O}/api/wishes/${id}`).then((r) => r.json<any>())
    expect(w.updates[0].github_handle).toBe('realdev')
    expect(w.updates[0].handle_verified).toBe(1)
  })
  it('沒登入照舊:選填 handle、handle_verified = 0(既有行為不變)', async () => {
    fetchMock.get('https://challenges.cloudflare.com').intercept({ path: /siteverify/, method: 'POST' }).reply(200, { success: true }).persist()
    const id = await seed()
    await SELF.fetch(`${O}/api/wishes/${id}/answers`, {
      method: 'POST', headers: H, body: JSON.stringify({ turnstileToken: 't', repo_url: 'https://github.com/x/a', github_handle: 'anon' }),
    })
    const w = await SELF.fetch(`${O}/api/wishes/${id}`).then((r) => r.json<any>())
    expect(w.answers[0].github_handle).toBe('anon')
    expect(w.answers[0].handle_verified).toBe(0)
  })
})

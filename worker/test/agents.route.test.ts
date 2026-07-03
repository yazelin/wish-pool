import { describe, it, expect, beforeEach } from 'vitest'
import { SELF, env, fetchMock } from 'cloudflare:test'

const O = 'https://test.local'
const H = { 'Content-Type': 'application/json', Origin: O }

beforeEach(async () => {
  for (const t of ['agent_tokens', 'answers', 'updates', 'needs', 'responses', 'open_questions', 'wishes', 'rate_limits']) await env.DB.exec(`DELETE FROM ${t}`)
  fetchMock.activate(); fetchMock.disableNetConnect()
})
function mockTurnstileOk() {
  fetchMock.get('https://challenges.cloudflare.com').intercept({ path: /siteverify/, method: 'POST' }).reply(200, { success: true }).persist()
}
async function seedWish() {
  const { createWish } = await import('../src/lib/d1')
  return createWish(env.DB, { title: 'T', status: 'published', open_questions: [] }, 1)
}

describe('agent token self-service', () => {
  it('issues a token (turnstile-gated), token only returned once and stored hashed', async () => {
    mockTurnstileOk()
    const res = await SELF.fetch(`${O}/api/agent-tokens`, { method: 'POST', headers: H,
      body: JSON.stringify({ turnstileToken: 't', label: 'my bot', github_handle: 'alice' }) })
    expect(res.status).toBe(200)
    const j = await res.json<any>()
    expect(j.token.startsWith('wp_agent_')).toBe(true)
    const row = await env.DB.prepare('SELECT token_hash, label FROM agent_tokens').first<any>()
    expect(row.label).toBe('my bot')
    expect(row.token_hash).not.toContain('wp_agent_')   // 存雜湊不存明文
  })
  it('empty turnstile -> 403', async () => {
    const res = await SELF.fetch(`${O}/api/agent-tokens`, { method: 'POST', headers: H, body: JSON.stringify({ turnstileToken: '' }) })
    expect(res.status).toBe(403)
  })
  it('issued token can write (claim update) without turnstile; revoked token rejected', async () => {
    mockTurnstileOk()
    const id = await seedWish()
    const { token } = await SELF.fetch(`${O}/api/agent-tokens`, { method: 'POST', headers: H,
      body: JSON.stringify({ turnstileToken: 't' }) }).then((r) => r.json<any>())
    const ok = await SELF.fetch(`${O}/api/wishes/${id}/updates`, {
      method: 'POST', headers: { ...H, Authorization: `Bearer ${token}` },
      body: JSON.stringify({ kind: 'claim', body: 'self-serve agent 認領' }) })
    expect(ok.status).toBe(200)
    await env.DB.prepare('UPDATE agent_tokens SET revoked = 1').run()
    const no = await SELF.fetch(`${O}/api/wishes/${id}/updates`, {
      method: 'POST', headers: { ...H, Authorization: `Bearer ${token}` },
      body: JSON.stringify({ kind: 'progress', body: 'x' }) })
    expect(no.status).toBe(403)
  })
  it('unknown wp_agent_ token -> 403 (does not fall through to turnstile)', async () => {
    const id = await seedWish()
    const res = await SELF.fetch(`${O}/api/wishes/${id}/updates`, {
      method: 'POST', headers: { ...H, Authorization: 'Bearer wp_agent_deadbeef' },
      body: JSON.stringify({ kind: 'claim', body: 'x' }) })
    expect(res.status).toBe(403)
  })
  it('admin can list and revoke tokens', async () => {
    mockTurnstileOk()
    await SELF.fetch(`${O}/api/agent-tokens`, { method: 'POST', headers: H, body: JSON.stringify({ turnstileToken: 't', label: 'b1' }) })
    const AUTH = { ...H, Authorization: 'Bearer test-admin-token' }
    const list = await SELF.fetch(`${O}/api/admin/agent-tokens`, { headers: AUTH }).then((r) => r.json<any>())
    expect(list.tokens.length).toBe(1)
    const rv = await SELF.fetch(`${O}/api/admin/agent-tokens/${list.tokens[0].id}/revoke`, { method: 'POST', headers: AUTH })
    expect(rv.status).toBe(200)
  })

  it('audit trail: mint records ip hash; writes attributed + use_count counted', async () => {
    mockTurnstileOk()
    const id = await seedWish()
    const { token } = await SELF.fetch(`${O}/api/agent-tokens`, { method: 'POST', headers: H,
      body: JSON.stringify({ turnstileToken: 't', label: 'audit-bot' }) }).then((r) => r.json<any>())
    await SELF.fetch(`${O}/api/wishes/${id}/updates`, {
      method: 'POST', headers: { ...H, Authorization: `Bearer ${token}` },
      body: JSON.stringify({ kind: 'claim', body: 'x' }) })
    await SELF.fetch(`${O}/api/wishes/${id}/answers`, {
      method: 'POST', headers: { ...H, Authorization: `Bearer ${token}` },
      body: JSON.stringify({ repo_url: 'https://github.com/a/b' }) })
    const AUTH = { ...H, Authorization: 'Bearer test-admin-token' }
    const { tokens } = await SELF.fetch(`${O}/api/admin/agent-tokens`, { headers: AUTH }).then((r) => r.json<any>())
    const t = tokens.find((x: any) => x.label === 'audit-bot')
    expect(t.ip8).toBeTruthy()
    expect(t.use_count).toBeGreaterThanOrEqual(2)
    expect(t.updates_count).toBe(1)
    expect(t.answers_count).toBe(1)
  })
})

describe('agent 代理人類參與(投幣/留言/許願)', () => {
  async function mintToken() {
    mockTurnstileOk()
    const { token } = await SELF.fetch(`${O}/api/agent-tokens`, { method: 'POST', headers: H,
      body: JSON.stringify({ turnstileToken: 't' }) }).then((r) => r.json<any>())
    return token
  }
  it('agent 投幣:一 token 一票(重投 ok:false),不需 turnstile', async () => {
    const token = await mintToken()
    const id = await seedWish()
    const AH = { ...H, Authorization: `Bearer ${token}` }
    const a = await SELF.fetch(`${O}/api/wishes/${id}/vote`, { method: 'POST', headers: AH, body: '{}' }).then((r) => r.json<any>())
    expect(a).toEqual({ ok: true, votes: 1 })
    const b = await SELF.fetch(`${O}/api/wishes/${id}/vote`, { method: 'POST', headers: AH, body: '{}' }).then((r) => r.json<any>())
    expect(b.ok).toBe(false)
  })
  it('agent 留言(代主人共鳴)且掛歸因', async () => {
    const token = await mintToken()
    const id = await seedWish()
    const res = await SELF.fetch(`${O}/api/wishes/${id}/responses`, {
      method: 'POST', headers: { ...H, Authorization: `Bearer ${token}` },
      body: JSON.stringify({ body: '主人也想要', nickname: '小明(由 agent 代發)', kind: 'metoo' }),
    })
    expect(res.status).toBe(200)
    const row = await env.DB.prepare('SELECT agent_token_id FROM responses WHERE wish_id = ?').bind(id).first<any>()
    expect(row.agent_token_id).toBeGreaterThan(0)
  })
  it('agent 許願(無簽章)-> 進 pending 待審', async () => {
    const token = await mintToken()
    const res = await SELF.fetch(`${O}/api/wishes`, {
      method: 'POST', headers: { ...H, Authorization: `Bearer ${token}` },
      body: JSON.stringify({ wish: { title: '主人想要一個工具', nickname: '小明' } }),
    }).then((r) => r.json<any>())
    expect(res.status).toBe('pending')
  })
})

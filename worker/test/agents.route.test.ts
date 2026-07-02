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
})

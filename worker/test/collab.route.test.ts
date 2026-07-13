import { describe, it, expect, beforeEach } from 'vitest'
import { SELF, env, fetchMock } from 'cloudflare:test'

const O = 'https://test.local'
const H = { 'Content-Type': 'application/json', Origin: O }

beforeEach(async () => {
  for (const t of ['answer_votes', 'answers', 'updates', 'needs', 'responses', 'open_questions', 'wishes', 'rate_limits']) await env.DB.exec(`DELETE FROM ${t}`)
  fetchMock.activate(); fetchMock.disableNetConnect()
})
function mockTurnstileOk() {
  fetchMock.get('https://challenges.cloudflare.com').intercept({ path: /siteverify/, method: 'POST' }).reply(200, { success: true }).persist()
}
async function seed() {
  const { createWish } = await import('../src/lib/d1')
  return createWish(env.DB, { title: 'T', status: 'published', open_questions: [] }, 1)
}

describe('agent token (trusted AI agent bypasses Turnstile)', () => {
  it('valid Bearer AGENT_TOKEN posts an answer with NO turnstile mock (bypass)', async () => {
    // 沒有 mockTurnstileOk;disableNetConnect 生效 -> 若走 siteverify 會炸。用 agent token 應短路。
    const id = await seed()
    const res = await SELF.fetch(`${O}/api/wishes/${id}/answers`, {
      method: 'POST', headers: { ...H, Authorization: 'Bearer test-agent-token' },
      body: JSON.stringify({ repo_url: 'https://github.com/yazelin/wish-pool' }),
    })
    expect(res.status).toBe(200)
    const w = await SELF.fetch(`${O}/api/wishes/${id}`).then((r) => r.json<any>())
    expect(w.answers[0].repo_url).toBe('https://github.com/yazelin/wish-pool')
  })
  it('agent can post an update via token', async () => {
    const id = await seed()
    const res = await SELF.fetch(`${O}/api/wishes/${id}/updates`, {
      method: 'POST', headers: { ...H, Authorization: 'Bearer test-agent-token' },
      body: JSON.stringify({ kind: 'claim', body: 'agent 認領', github_handle: 'claude' }),
    })
    expect(res.status).toBe(200)
  })
  it('WRONG bearer token + empty turnstile -> 403 (cannot bypass)', async () => {
    const id = await seed()
    const res = await SELF.fetch(`${O}/api/wishes/${id}/answers`, {
      method: 'POST', headers: { ...H, Authorization: 'Bearer wrong-token' },
      body: JSON.stringify({ turnstileToken: '', repo_url: 'https://github.com/x/a' }),
    })
    expect(res.status).toBe(403)
  })
})

describe('POST /api/wishes/:id/answers', () => {
  it('valid repo_url -> {id}; then GET wish shows the answer', async () => {
    mockTurnstileOk(); const id = await seed()
    const res = await SELF.fetch(`${O}/api/wishes/${id}/answers`, { method: 'POST', headers: H,
      body: JSON.stringify({ turnstileToken: 't', repo_url: 'https://github.com/x/a', note: '版本一', github_handle: 'x' }) })
    expect(res.status).toBe(200)
    const w = await SELF.fetch(`${O}/api/wishes/${id}`).then((r) => r.json<any>())
    expect(w.answers.length).toBe(1)
    expect(w.answers[0].repo_url).toBe('https://github.com/x/a')
  })
  it('non-http repo_url -> 400', async () => {
    mockTurnstileOk(); const id = await seed()
    const res = await SELF.fetch(`${O}/api/wishes/${id}/answers`, { method: 'POST', headers: H,
      body: JSON.stringify({ turnstileToken: 't', repo_url: 'javascript:alert(1)' }) })
    expect(res.status).toBe(400)
  })
  it('nonexistent wish -> 404', async () => {
    mockTurnstileOk()
    const res = await SELF.fetch(`${O}/api/wishes/99999/answers`, { method: 'POST', headers: H,
      body: JSON.stringify({ turnstileToken: 't', repo_url: 'https://github.com/x/a' }) })
    expect(res.status).toBe(404)
  })
  it('turnstile fail (empty token) -> 403', async () => {
    const id = await seed()
    const res = await SELF.fetch(`${O}/api/wishes/${id}/answers`, { method: 'POST', headers: H,
      body: JSON.stringify({ turnstileToken: '', repo_url: 'https://github.com/x/a' }) })
    expect(res.status).toBe(403)
  })
})

describe('POST /api/answers/:id/vote', () => {
  it('votes once, dup ok:false, 404 on missing', async () => {
    mockTurnstileOk(); const id = await seed()
    const { createAnswer } = await import('../src/lib/d1')
    const aid = await createAnswer(env.DB, id, { repo_url: 'https://github.com/x/a' }, 1)
    const a = await SELF.fetch(`${O}/api/answers/${aid}/vote`, { method: 'POST', headers: H, body: JSON.stringify({ turnstileToken: 't' }) })
    expect((await a.json<any>()).votes).toBe(1)
    const b = await SELF.fetch(`${O}/api/answers/${aid}/vote`, { method: 'POST', headers: H, body: JSON.stringify({ turnstileToken: 't' }) })
    expect((await b.json<any>()).ok).toBe(false)
    const c = await SELF.fetch(`${O}/api/answers/99999/vote`, { method: 'POST', headers: H, body: JSON.stringify({ turnstileToken: 't' }) })
    expect(c.status).toBe(404)
  })
})

describe('answer a need (討論錨點)', () => {
  it('response with questionId attaches to the need and resolves it', async () => {
    mockTurnstileOk()
    const { createWish, createNeed } = await import('../src/lib/d1')
    const id = await createWish(env.DB, { title: 'T', status: 'published', open_questions: [] }, 1)
    const nid = await createNeed(env.DB, id, 'info', '要做網頁還是 App?')
    const res = await SELF.fetch(`${O}/api/wishes/${id}/responses`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ turnstileToken: 't', body: '純網頁就好', nickname: '發呆', kind: 'answer', questionId: nid }),
    })
    expect(res.status).toBe(200)
    const w = await SELF.fetch(`${O}/api/wishes/${id}`).then((r) => r.json<any>())
    expect(w.needs.find((n: any) => n.id === nid).resolved).toBe(1)
    const ans = w.responses.find((r: any) => r.question_id === nid)
    expect(ans.body).toBe('純網頁就好')
    const refinement = await SELF.fetch(`${O}/api/wishes/${id}/refinement`).then((r) => r.json<any>())
    expect(refinement.version).toBe(2) // createNeed + legacy response each invalidate agent context
    expect(refinement.needs.find((n: any) => n.id === nid).state).toBe('answered')
    expect(refinement.next_action).toEqual({ kind: 'evaluate_answer', need_id: nid })
  })

  it('rejects a questionId from another wish without creating an orphan response', async () => {
    mockTurnstileOk()
    const { createWish, createNeed } = await import('../src/lib/d1')
    const a = await createWish(env.DB, { title: 'A', status: 'published', open_questions: [] }, 1)
    const b = await createWish(env.DB, { title: 'B', status: 'published', open_questions: [] }, 1)
    const foreignNeed = await createNeed(env.DB, b, 'info', 'B 的問題')
    const res = await SELF.fetch(`${O}/api/wishes/${a}/responses`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ turnstileToken: 't', body: '錯掛回答', kind: 'answer', questionId: foreignNeed }),
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'bad_question_id' })
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM responses WHERE wish_id = ?').bind(a).first<{ n: number }>()
    expect(count?.n).toBe(0)
  })

  it('keeps nested clarification replies visible in machine refinement context', async () => {
    const { createWish, createNeed, addResponse } = await import('../src/lib/d1')
    const id = await createWish(env.DB, { title: 'T', status: 'published', open_questions: [] }, 1)
    const needId = await createNeed(env.DB, id, 'info', '需要離線嗎？')
    const answer = await addResponse(env.DB, id, { body: '需要', kind: 'answer', questionId: needId }, 2)
    await addResponse(env.DB, id, { body: '是完整離線，不只是快取', kind: 'answer', parentId: answer.id }, 3)
    const refinement = await SELF.fetch(`${O}/api/wishes/${id}/refinement`).then((r) => r.json<any>())
    expect(refinement.needs[0].answers[0].replies).toEqual([
      expect.objectContaining({ body: '是完整離線，不只是快取' }),
    ])
  })
})

describe('POST updates + needs', () => {
  it('adds an update; GET wish shows it', async () => {
    mockTurnstileOk(); const id = await seed()
    const res = await SELF.fetch(`${O}/api/wishes/${id}/updates`, { method: 'POST', headers: H,
      body: JSON.stringify({ turnstileToken: 't', kind: 'claim', body: '我認領了', github_handle: 'a' }) })
    expect(res.status).toBe(200)
    const w = await SELF.fetch(`${O}/api/wishes/${id}`).then((r) => r.json<any>())
    expect(w.updates[0].kind).toBe('claim')
  })
  it('update empty body -> 400', async () => {
    mockTurnstileOk(); const id = await seed()
    const res = await SELF.fetch(`${O}/api/wishes/${id}/updates`, { method: 'POST', headers: H,
      body: JSON.stringify({ turnstileToken: 't', kind: 'progress', body: '  ' }) })
    expect(res.status).toBe(400)
  })
  it('adds a need; GET wish shows it', async () => {
    mockTurnstileOk(); const id = await seed()
    const res = await SELF.fetch(`${O}/api/wishes/${id}/needs`, { method: 'POST', headers: H,
      body: JSON.stringify({ turnstileToken: 't', type: 'resource', body: '需要一台測試機' }) })
    expect(res.status).toBe(200)
    const w = await SELF.fetch(`${O}/api/wishes/${id}`).then((r) => r.json<any>())
    expect(w.needs.some((n: any) => n.type === 'resource')).toBe(true)
  })
})

describe('auto status transitions', () => {
  it('claim promotes published -> building (and not further on answer)', async () => {
    const id = await seed()
    await SELF.fetch(`${O}/api/wishes/${id}/updates`, {
      method: 'POST', headers: { ...H, Authorization: 'Bearer test-agent-token' },
      body: JSON.stringify({ kind: 'claim', body: '我來' }),
    })
    let w = await SELF.fetch(`${O}/api/wishes/${id}`).then((r) => r.json<any>())
    expect(w.status).toBe('building')
    await SELF.fetch(`${O}/api/wishes/${id}/answers`, {
      method: 'POST', headers: { ...H, Authorization: 'Bearer test-agent-token' },
      body: JSON.stringify({ repo_url: 'https://github.com/x/a' }),
    })
    w = await SELF.fetch(`${O}/api/wishes/${id}`).then((r) => r.json<any>())
    expect(w.status).toBe('building')   // done 不自動,留站長採用
  })
  it('votes+echoes >= 3 promotes published -> adopted', async () => {
    mockTurnstileOk()
    const { createWish, addResponse } = await import('../src/lib/d1')
    const id = await createWish(env.DB, { title: 'HOT', status: 'published', open_questions: [] }, 1)
    await addResponse(env.DB, id, { body: 'a', kind: 'metoo' }, 2)
    await addResponse(env.DB, id, { body: 'b', kind: 'metoo' }, 3)
    await SELF.fetch(`${O}/api/wishes/${id}/vote`, { method: 'POST', headers: H, body: JSON.stringify({ turnstileToken: 't' }) })
    const w = await SELF.fetch(`${O}/api/wishes/${id}`).then((r) => r.json<any>())
    expect(w.status).toBe('adopted')
  })
  it('progress (non-claim) does not promote', async () => {
    const id = await seed()
    await SELF.fetch(`${O}/api/wishes/${id}/updates`, {
      method: 'POST', headers: { ...H, Authorization: 'Bearer test-agent-token' },
      body: JSON.stringify({ kind: 'progress', body: 'x' }),
    })
    const w = await SELF.fetch(`${O}/api/wishes/${id}`).then((r) => r.json<any>())
    expect(w.status).toBe('published')
  })
})

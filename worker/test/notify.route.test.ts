// 站內通知(issue #3):清單帶活動計數讓回站的許願者一次比對「有沒有新進展」;
// 同時把公開端點的欄位鎖成白名單契約 —— 未來若加通知 email 等隱私欄位,預設不外洩。
import { describe, it, expect, beforeEach } from 'vitest'
import { SELF, env, fetchMock } from 'cloudflare:test'

const O = 'https://test.local'
const H = { 'Content-Type': 'application/json', Origin: O }
const A = { ...H, Authorization: 'Bearer test-agent-token' }   // 可信 agent 免 Turnstile

beforeEach(async () => {
  for (const t of ['answer_votes', 'answers', 'updates', 'needs', 'responses', 'open_questions', 'votes', 'wishes', 'rate_limits']) await env.DB.exec(`DELETE FROM ${t}`)
  fetchMock.activate(); fetchMock.disableNetConnect()
})
function mockTurnstileOk() {
  fetchMock.get('https://challenges.cloudflare.com').intercept({ path: /siteverify/, method: 'POST' }).reply(200, { success: true }).persist()
}
async function seed(title = 'T') {
  const { createWish } = await import('../src/lib/d1')
  return createWish(env.DB, { title, status: 'published', open_questions: [] }, 1)
}
async function listRow(id: number) {
  const j = await SELF.fetch(`${O}/api/wishes?sort=new&limit=100`).then((r) => r.json<{ wishes: any[] }>())
  return j.wishes.find((w) => w.id === id)
}

describe('清單活動計數(「有新進展」徽章的觸發條件)', () => {
  it('交實作 / 回報進度 / 留言,各自讓對應計數 +1', async () => {
    mockTurnstileOk()
    const id = await seed()
    let row = await listRow(id)
    expect([row.answers_count, row.updates_count, row.echoes]).toEqual([0, 0, 0])

    await SELF.fetch(`${O}/api/wishes/${id}/answers`, { method: 'POST', headers: A, body: JSON.stringify({ repo_url: 'https://github.com/x/a' }) })
    await SELF.fetch(`${O}/api/wishes/${id}/updates`, { method: 'POST', headers: A, body: JSON.stringify({ kind: 'progress', body: '做到一半' }) })
    await SELF.fetch(`${O}/api/wishes/${id}/responses`, { method: 'POST', headers: H, body: JSON.stringify({ turnstileToken: 't', body: '我也想要', kind: 'metoo' }) })

    row = await listRow(id)
    expect([row.answers_count, row.updates_count, row.echoes]).toEqual([1, 1, 1])
  })

  it('被隱藏的實作不計入 answers_count(與詳情頁口徑一致)', async () => {
    const id = await seed()
    const { createAnswer, setAnswerStatus } = await import('../src/lib/d1')
    const aid = await createAnswer(env.DB, id, { repo_url: 'https://github.com/x/a' }, 2)
    await setAnswerStatus(env.DB, aid, 'hidden')
    const row = await listRow(id)
    expect(row.answers_count).toBe(0)
  })

  it('認領帶動狀態升級,清單同步反映(徽章的另一個觸發條件)', async () => {
    const id = await seed()
    await SELF.fetch(`${O}/api/wishes/${id}/updates`, { method: 'POST', headers: A, body: JSON.stringify({ kind: 'claim', body: '我來' }) })
    const row = await listRow(id)
    expect(row.status).toBe('building')
    expect(row.updates_count).toBe(1)
  })
})

describe('公開欄位契約(隱私欄位不外洩)', () => {
  const WISH_KEYS = ['id', 'title', 'problem', 'current', 'desired', 'who', 'nickname', 'status', 'votes', 'created_at', 'accepted_answer_id', 'discussion_url', 'difficulty', 'echoes'].sort()

  it('GET /api/wishes 每列只含白名單欄位 + 活動計數', async () => {
    const id = await seed()
    const row = await listRow(id)
    expect(Object.keys(row).sort()).toEqual([...WISH_KEYS, 'answers_count', 'updates_count', 'needs_open', 'needs_total'].sort())
  })

  it('GET /api/wishes/:id 頂層與巢狀項目只含白名單欄位(agent_token_id 等不外洩)', async () => {
    const id = await seed()
    const { createAnswer, addUpdate, addResponse, createNeed } = await import('../src/lib/d1')
    await createAnswer(env.DB, id, { repo_url: 'https://github.com/x/a', note: 'v1', github_handle: 'x', agentTokenId: 7 }, 2)
    await addUpdate(env.DB, id, { kind: 'progress', body: 'p', github_handle: 'x', agentTokenId: 7 }, 3)
    await addResponse(env.DB, id, { body: 'r', nickname: 'n', kind: 'metoo' }, 4)
    await createNeed(env.DB, id, 'info', '缺什麼?')
    const w = await SELF.fetch(`${O}/api/wishes/${id}`).then((r) => r.json<any>())
    expect(Object.keys(w).sort()).toEqual([...WISH_KEYS, 'needs', 'updates', 'answers', 'responses'].sort())
    expect(Object.keys(w.answers[0]).sort()).toEqual(['id', 'repo_url', 'note', 'github_handle', 'votes', 'status', 'created_at'].sort())
    expect(Object.keys(w.updates[0]).sort()).toEqual(['id', 'kind', 'body', 'github_handle', 'created_at'].sort())
    expect(Object.keys(w.responses[0]).sort()).toEqual(['id', 'question_id', 'parent_id', 'is_solution', 'body', 'nickname', 'kind', 'created_at'].sort())
    expect(Object.keys(w.needs[0]).sort()).toEqual(['id', 'type', 'body', 'resolved'].sort())
  })
})

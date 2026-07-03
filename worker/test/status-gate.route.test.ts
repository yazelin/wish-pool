// issue #20:公開端點對非公開狀態(pending/hidden)一律 404,兩端口徑一致、不洩存在性;
// 後台審核改走 GET /api/admin/wishes/:id(帶 token,不分狀態)。
import { describe, it, expect, beforeEach } from 'vitest'
import { SELF, env, fetchMock } from 'cloudflare:test'

const O = 'https://test.local'
const H = { 'Content-Type': 'application/json', Origin: O }
const A = { ...H, Authorization: 'Bearer test-agent-token' }      // 可信 agent 免 Turnstile
const ADMIN = { ...H, Authorization: 'Bearer test-admin-token' }

beforeEach(async () => {
  for (const t of ['answer_votes', 'answers', 'updates', 'needs', 'responses', 'open_questions', 'votes', 'wishes', 'rate_limits']) await env.DB.exec(`DELETE FROM ${t}`)
  fetchMock.activate(); fetchMock.disableNetConnect()
})
async function seed(status: string, title = 'T') {
  const { createWish } = await import('../src/lib/d1')
  return createWish(env.DB, { title, status, open_questions: [] }, 1)
}

describe('GET /api/wishes/:id 狀態閘門', () => {
  it('公開狀態(published/adopted/building/done)照常 200', async () => {
    for (const s of ['published', 'adopted', 'building', 'done']) {
      const id = await seed(s)
      const res = await SELF.fetch(`${O}/api/wishes/${id}`)
      expect(res.status, s).toBe(200)
      expect((await res.json<any>()).status).toBe(s)
    }
  })
  it('pending/hidden 回 404(與不存在無法區分,不洩存在性)', async () => {
    for (const s of ['pending', 'hidden']) {
      const id = await seed(s)
      const res = await SELF.fetch(`${O}/api/wishes/${id}`)
      expect(res.status, s).toBe(404)
      expect(await res.json()).toEqual({ error: 'not_found' })   // 與 99999 的回應完全相同
      expect((await SELF.fetch(`${O}/api/wishes/${id}/spec`)).status, s + ' spec').toBe(404)
    }
  })
})

describe('公開寫入端點同口徑(對 hidden/pending 的 200 會變成存在性探針)', () => {
  it('vote / responses / answers / updates / needs 對 pending 與 hidden 都 404', async () => {
    for (const s of ['pending', 'hidden']) {
      const id = await seed(s)
      const calls: [string, Record<string, unknown>][] = [
        [`/api/wishes/${id}/vote`, {}],
        [`/api/wishes/${id}/responses`, { body: 'x', kind: 'metoo' }],
        [`/api/wishes/${id}/answers`, { repo_url: 'https://github.com/x/a' }],
        [`/api/wishes/${id}/updates`, { kind: 'progress', body: 'x' }],
        [`/api/wishes/${id}/needs`, { type: 'info', body: 'x' }],
      ]
      for (const [path, body] of calls) {
        const res = await SELF.fetch(`${O}${path}`, { method: 'POST', headers: A, body: JSON.stringify(body) })
        expect(res.status, `${s} ${path}`).toBe(404)
      }
    }
  })
  it('公開願望照常寫入(對照組)', async () => {
    const id = await seed('published')
    const res = await SELF.fetch(`${O}/api/wishes/${id}/updates`, { method: 'POST', headers: A, body: JSON.stringify({ kind: 'progress', body: 'ok' }) })
    expect(res.status).toBe(200)
  })
  it('實作投票:hidden 的 answer、或掛在 hidden 願望下的 answer 都 404;正常的照投', async () => {
    const { createAnswer, setAnswerStatus } = await import('../src/lib/d1')
    const pub = await seed('published')
    const hiddenWish = await seed('hidden')
    const okAns = await createAnswer(env.DB, pub, { repo_url: 'https://github.com/x/ok' }, 1)
    const hiddenAns = await createAnswer(env.DB, pub, { repo_url: 'https://github.com/x/h' }, 1)
    await setAnswerStatus(env.DB, hiddenAns, 'hidden')
    const onHiddenWish = await createAnswer(env.DB, hiddenWish, { repo_url: 'https://github.com/x/hw' }, 1)
    const vote = (aid: number) => SELF.fetch(`${O}/api/answers/${aid}/vote`, { method: 'POST', headers: A, body: JSON.stringify({}) })
    expect((await vote(hiddenAns)).status).toBe(404)
    expect((await vote(onHiddenWish)).status).toBe(404)
    expect((await vote(okAns)).status).toBe(200)
  })
})

describe('後台單筆 GET /api/admin/wishes/:id(審核路徑不受公開閘門影響)', () => {
  it('pending/hidden 帶 token 都讀得到全文(含巢狀資料)', async () => {
    for (const s of ['pending', 'hidden']) {
      const id = await seed(s, '待審' + s)
      const { createAnswer } = await import('../src/lib/d1')
      await createAnswer(env.DB, id, { repo_url: 'https://github.com/x/a' }, 1)
      const res = await SELF.fetch(`${O}/api/admin/wishes/${id}`, { headers: ADMIN })
      expect(res.status, s).toBe(200)
      const w = await res.json<any>()
      expect(w.title).toBe('待審' + s)
      expect(w.answers.length).toBe(1)
    }
  })
  it('無 token -> 401;不存在 -> 404', async () => {
    const id = await seed('pending')
    expect((await SELF.fetch(`${O}/api/admin/wishes/${id}`)).status).toBe(401)
    expect((await SELF.fetch(`${O}/api/admin/wishes/99999`, { headers: ADMIN })).status).toBe(404)
  })
})

import { describe, it, expect, beforeEach } from 'vitest'
import { SELF, env, fetchMock } from 'cloudflare:test'

const O = 'https://test.local'
const H = { 'Content-Type': 'application/json', Origin: O }

beforeEach(async () => {
  await env.DB.exec('DELETE FROM rate_limits')
  fetchMock.activate(); fetchMock.disableNetConnect()
})

// 不用 .persist():每個測試只打一次 refine -> 一次 groq,單次攔截器用完即棄,
// 不會在同一 test file 的 MockPool 內跨測試 FIFO 洩漏(fetchMock 每檔才 reset)。
function mockGroq(content: string) {
  fetchMock.get('https://groq.test')
    .intercept({ path: '/openai/v1/chat/completions', method: 'POST' })
    .reply(200, { choices: [{ message: { content } }] })
}

describe('POST /api/refine', () => {
  it('returns ask result from LLM', async () => {
    mockGroq('{"mode":"ask","question":"誰會用?"}')
    const res = await SELF.fetch(`${O}/api/refine`, {
      method: 'POST', headers: H, body: JSON.stringify({ messages: [{ role: 'user', content: '我想要報價工具' }] }),
    })
    expect(res.status).toBe(200)
    expect(await res.json<any>()).toEqual({ mode: 'ask', question: '誰會用?' })
  })

  it('returns final result', async () => {
    mockGroq(JSON.stringify({ mode: 'final', title: '報價工具', problem: 'p', current: 'c', desired: 'd', who: 'w', open_questions: [], verdict: 'ok', verdict_reason: 'ok' }))
    const res = await SELF.fetch(`${O}/api/refine`, {
      method: 'POST', headers: H, body: JSON.stringify({ messages: [{ role: 'user', content: '好了送出' }] }),
    })
    expect((await res.json<any>()).mode).toBe('final')
  })

  it('LLM error -> 500 llm_unavailable', async () => {
    fetchMock.get('https://groq.test')
      .intercept({ path: '/openai/v1/chat/completions', method: 'POST' }).reply(500, 'boom')
    const res = await SELF.fetch(`${O}/api/refine`, {
      method: 'POST', headers: H, body: JSON.stringify({ messages: [{ role: 'user', content: 'x' }] }),
    })
    expect(res.status).toBe(500)
    expect((await res.json<any>()).error).toBe('llm_unavailable')
  })

  it('empty messages -> 400', async () => {
    const res = await SELF.fetch(`${O}/api/refine`, { method: 'POST', headers: H, body: JSON.stringify({ messages: [] }) })
    expect(res.status).toBe(400)
  })
})

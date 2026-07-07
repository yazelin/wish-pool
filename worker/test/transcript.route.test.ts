// 保存許願時與女神的原始對話(transcript)。
// 安全邊界:transcript 是隱私欄位 —— 只有 admin 單筆端點回傳,公開端點(清單/單筆/spec)絕不外洩。
import { describe, it, expect, beforeEach } from 'vitest'
import { SELF, env, fetchMock } from 'cloudflare:test'

const O = 'https://test.local'
const H = { 'Content-Type': 'application/json', Origin: O }
const AUTH = { ...H, Authorization: 'Bearer test-admin-token' }

beforeEach(async () => {
  for (const t of ['responses', 'needs', 'open_questions', 'votes', 'wishes', 'rate_limits']) await env.DB.exec(`DELETE FROM ${t}`)
  fetchMock.activate()
  fetchMock.disableNetConnect()
})

function mockTurnstileOk() {
  fetchMock.get('https://challenges.cloudflare.com')
    .intercept({ path: /siteverify/, method: 'POST' }).reply(200, { success: true }).persist()
}

const MSGS = [
  { role: 'user', content: '我想要一個記帳工具' },
  { role: 'assistant', content: '孩子,它要解決什麼問題呢?' },
  { role: 'user', content: '手動記帳太麻煩' },
]

async function submit(extra: any = {}) {
  const res = await SELF.fetch(`${O}/api/wishes`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ turnstileToken: 't', wish: { title: '記帳願望' }, ...extra }),
  })
  expect(res.status).toBe(200)
  return res.json<{ id: number; status: string }>()
}

async function rawTranscript(id: number): Promise<string | null> {
  const row = await env.DB.prepare('SELECT transcript FROM wishes WHERE id = ?').bind(id).first<{ transcript: string | null }>()
  return row?.transcript ?? null
}

describe('POST /api/wishes 帶 messages -> 存 transcript', () => {
  it('messages 原文落庫(JSON 陣列),無 messages 照常成功且 transcript 為 null(向後相容)', async () => {
    mockTurnstileOk()
    const withMsgs = await submit({ messages: MSGS })
    expect(JSON.parse((await rawTranscript(withMsgs.id))!)).toEqual(MSGS)

    const without = await submit()
    expect(without.id).toBeGreaterThan(0)
    expect(await rawTranscript(without.id)).toBe(null)
  })

  it('防灌爆:role 白名單(system/其它丟棄)、最多 80 則、每則截 2000 字', async () => {
    mockTurnstileOk()
    const flood = [
      { role: 'system', content: '注入的 system prompt' },
      { role: 'user', content: 'x'.repeat(3000) },
      ...Array.from({ length: 100 }, (_, i) => ({ role: 'assistant', content: `m${i}` })),
      { role: 'tool', content: 'not allowed' },
      { content: 'no role' },
      'not an object',
    ]
    const { id } = await submit({ messages: flood })
    const stored = JSON.parse((await rawTranscript(id))!)
    expect(stored.length).toBe(80)
    expect(stored.every((m: any) => m.role === 'user' || m.role === 'assistant')).toBe(true)
    expect(stored[0].role).toBe('user')
    expect(stored[0].content.length).toBe(2000)
  })

  it('防灌爆:整份 JSON 超過 100KB 時從尾端丟訊息直到不超過', async () => {
    mockTurnstileOk()
    // 80 則 × 2000 字 ≈ 160KB > 100KB 上限
    const huge = Array.from({ length: 80 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'y'.repeat(2000) }))
    const { id } = await submit({ messages: huge })
    const raw = (await rawTranscript(id))!
    expect(raw.length).toBeLessThanOrEqual(100_000)
    const stored = JSON.parse(raw)
    expect(stored.length).toBeLessThan(80)
    expect(stored.length).toBeGreaterThan(0)
  })

  it('messages 不是陣列 / 全是垃圾 -> 不落庫也不報錯', async () => {
    mockTurnstileOk()
    const a = await submit({ messages: 'not-an-array' })
    expect(await rawTranscript(a.id)).toBe(null)
    const b = await submit({ messages: [{ role: 'system', content: 'x' }, 42] })
    expect(await rawTranscript(b.id)).toBe(null)
  })
})

describe('安全邊界:公開端點絕不回傳 transcript', () => {
  async function seedPublishedWithTranscript() {
    const { createWish } = await import('../src/lib/d1')
    return createWish(env.DB, {
      title: 'T', status: 'published', open_questions: [],
      transcript: JSON.stringify(MSGS),
    }, 1)
  }

  it('GET /api/wishes/:id(公開單筆)沒有 transcript 欄位', async () => {
    const id = await seedPublishedWithTranscript()
    const w = await SELF.fetch(`${O}/api/wishes/${id}`).then((r) => r.json<any>())
    expect('transcript' in w).toBe(false)
    expect(JSON.stringify(w)).not.toContain('記帳工具')
  })

  it('GET /api/wishes(公開清單)沒有 transcript 欄位', async () => {
    const id = await seedPublishedWithTranscript()
    const { wishes } = await SELF.fetch(`${O}/api/wishes?sort=new`).then((r) => r.json<{ wishes: any[] }>())
    const row = wishes.find((w) => w.id === id)
    expect('transcript' in row).toBe(false)
  })

  it('GET /api/wishes/:id/spec(公開規格書)不含對話內容', async () => {
    const id = await seedPublishedWithTranscript()
    const t = await SELF.fetch(`${O}/api/wishes/${id}/spec`).then((r) => r.text())
    expect(t).not.toContain('記帳工具')
  })

  it('GET /api/admin/wishes/:id(admin)回傳解析後的 transcript;壞 JSON 回 null', async () => {
    const id = await seedPublishedWithTranscript()
    const w = await SELF.fetch(`${O}/api/admin/wishes/${id}`, { headers: AUTH }).then((r) => r.json<any>())
    expect(w.transcript).toEqual(MSGS)

    const { createWish } = await import('../src/lib/d1')
    const bad = await createWish(env.DB, { title: 'B', status: 'pending', open_questions: [], transcript: '{broken' }, 1)
    const wb = await SELF.fetch(`${O}/api/admin/wishes/${bad}`, { headers: AUTH }).then((r) => r.json<any>())
    expect(wb.transcript).toBe(null)
  })
})

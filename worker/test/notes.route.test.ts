// 女神的整理筆記(notes):五欄=索引、notes=給實作者的整理版、transcript=原始檔(僅站主可見)。
// notes 是「公開」欄位:submit 存入(截 4000 字)、公開單筆/清單/spec 都回傳。
import { describe, it, expect, beforeEach } from 'vitest'
import { SELF, env, fetchMock } from 'cloudflare:test'

const O = 'https://test.local'
const H = { 'Content-Type': 'application/json', Origin: O }

beforeEach(async () => {
  for (const t of ['responses', 'needs', 'open_questions', 'votes', 'wishes', 'rate_limits']) await env.DB.exec(`DELETE FROM ${t}`)
  fetchMock.activate()
  fetchMock.disableNetConnect()
})

function mockTurnstileOk() {
  fetchMock.get('https://challenges.cloudflare.com')
    .intercept({ path: /siteverify/, method: 'POST' }).reply(200, { success: true }).persist()
}

const NOTES = '理想使用情境:每天早上出門前打開看一眼,一分鐘內看完。\n偏好:介面越少字越好,不要通知轟炸。'

async function submit(wishExtra: any = {}) {
  const res = await SELF.fetch(`${O}/api/wishes`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ turnstileToken: 't', wish: { title: '筆記願望', ...wishExtra } }),
  })
  expect(res.status).toBe(200)
  return res.json<{ id: number; status: string }>()
}

async function rawNotes(id: number): Promise<string | null> {
  const row = await env.DB.prepare('SELECT notes FROM wishes WHERE id = ?').bind(id).first<{ notes: string | null }>()
  return row?.notes ?? null
}

describe('POST /api/wishes 帶 wish.notes -> 存 notes', () => {
  it('notes 落庫;無 notes 照常成功且為 null(向後相容)', async () => {
    mockTurnstileOk()
    const withNotes = await submit({ notes: NOTES })
    expect(await rawNotes(withNotes.id)).toBe(NOTES)

    const without = await submit()
    expect(without.id).toBeGreaterThan(0)
    expect(await rawNotes(without.id)).toBe(null)
  })

  it('防灌爆:notes 截 4000 字;非字串/空白 -> 不落庫', async () => {
    mockTurnstileOk()
    const long = await submit({ notes: 'x'.repeat(5000) })
    expect((await rawNotes(long.id))!.length).toBe(4000)

    const notStr = await submit({ notes: { evil: true } })
    expect(await rawNotes(notStr.id)).toBe(null)
    const blank = await submit({ notes: '   ' })
    expect(await rawNotes(blank.id)).toBe(null)
  })
})

describe('notes 是公開欄位(給實作者看)', () => {
  async function seedPublishedWithNotes() {
    const { createWish } = await import('../src/lib/d1')
    return createWish(env.DB, { title: 'T', status: 'published', open_questions: [], notes: NOTES }, 1)
  }

  it('GET /api/wishes/:id(公開單筆)回傳 notes', async () => {
    const id = await seedPublishedWithNotes()
    const w = await SELF.fetch(`${O}/api/wishes/${id}`).then((r) => r.json<any>())
    expect(w.notes).toBe(NOTES)
  })

  it('GET /api/wishes(公開清單)回傳 notes', async () => {
    const id = await seedPublishedWithNotes()
    const { wishes } = await SELF.fetch(`${O}/api/wishes?sort=new`).then((r) => r.json<{ wishes: any[] }>())
    expect(wishes.find((w) => w.id === id).notes).toBe(NOTES)
  })

  it('GET /api/wishes/:id/spec 含「女神的整理筆記」段;無 notes 的願望不長出這段', async () => {
    const id = await seedPublishedWithNotes()
    const t = await SELF.fetch(`${O}/api/wishes/${id}/spec`).then((r) => r.text())
    expect(t).toContain('## 女神的整理筆記(給實作者)')
    expect(t).toContain(NOTES)

    const { createWish } = await import('../src/lib/d1')
    const bare = await createWish(env.DB, { title: 'B', status: 'published', open_questions: [] }, 1)
    const tb = await SELF.fetch(`${O}/api/wishes/${bare}/spec`).then((r) => r.text())
    expect(tb).not.toContain('女神的整理筆記')
  })
})

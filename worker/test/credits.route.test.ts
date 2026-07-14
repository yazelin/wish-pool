// issue #34:GET /api/credits 感謝名單聚合 — 公開狀態才入榜、兩級排序、匿名/未署名彙總。
import { describe, it, expect, beforeEach } from 'vitest'
import { SELF, env } from 'cloudflare:test'

const O = 'https://test.local'

beforeEach(async () => {
  for (const t of ['answer_votes', 'answers', 'updates', 'needs', 'responses', 'open_questions', 'votes', 'wishes', 'rate_limits']) await env.DB.exec(`DELETE FROM ${t}`)
})

async function seedWish(status: string, nickname: string | null, now = 1000) {
  const { createWish } = await import('../src/lib/d1')
  return createWish(env.DB, { title: 'T', status, nickname: nickname ?? undefined, open_questions: [] }, now)
}
async function seedAnswer(wishId: number, handle: string | null, now = 2000) {
  const { createAnswer } = await import('../src/lib/d1')
  return createAnswer(env.DB, wishId, { repo_url: 'https://github.com/x/r', github_handle: handle ?? undefined }, now)
}

describe('GET /api/credits', () => {
  it('空池回 200 與空結構,帶 cache header', async () => {
    const res = await SELF.fetch(`${O}/api/credits`)
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toContain('s-maxage=600')
    expect(await res.json()).toEqual({ wishers: [], anonymous_wishes: 0, implementers: [], unsigned_answers: 0 })
  })

  it('聚合與兩級排序:被採用排前、大小寫合併、匿名/未署名彙總、非公開不入榜', async () => {
    const { acceptAnswer, setAnswerStatus } = await import('../src/lib/d1')
    // 靈感側:小綠葉 x2、段杯杯 x1、匿名 x1;pending/hidden 的暱稱不得出現
    const w1 = await seedWish('published', '小綠葉', 10)
    const w2 = await seedWish('done', '小綠葉', 20)
    const w3 = await seedWish('building', '段杯杯', 30)
    await seedWish('published', null, 40)
    await seedWish('pending', '不該出現', 50)
    const hid = await seedWish('hidden', '影子', 60)
    await seedWish('published', '站方示範', 70)   // 站方 bootstrap 署名:公開但不進感謝名單
    // 實作側:bob 1 份被採用;Alice/alice 2 份合併(顯示先出現的 Alice);未署名 1 份;
    // hidden 願望上的 answer 與 hidden answer 都不算
    const aB = await seedAnswer(w2, 'bob', 100)
    await acceptAnswer(env.DB, w2, aB)
    await seedAnswer(w1, 'Alice', 200)
    await seedAnswer(w3, 'alice', 300)
    await seedAnswer(w1, null, 400)
    await seedAnswer(hid, 'ghost', 500)
    const hiddenAns = await seedAnswer(w1, 'hider', 600)
    await setAnswerStatus(env.DB, hiddenAns, 'hidden')

    const res = await SELF.fetch(`${O}/api/credits`)
    const d = await res.json<any>()
    expect(d.wishers).toEqual([
      { nickname: '小綠葉', wishes: 2 },
      { nickname: '段杯杯', wishes: 1 },
    ])
    expect(d.anonymous_wishes).toBe(1)
    expect(d.implementers).toEqual([
      { handle: 'bob', answers: 1, adopted: 1 },
      { handle: 'Alice', answers: 2, adopted: 0 },
    ])
    expect(d.unsigned_answers).toBe(1)
  })
})

import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { createWish, createAnswer } from '../src/lib/d1'
import {
  tokenize, diceSimilarity, scoreSimilarity, findSimilarWishes,
  SIMILAR_THRESHOLD, SIMILAR_LIMIT,
} from '../src/lib/similar'

const db = () => env.DB

beforeEach(async () => {
  await db().exec('DELETE FROM answers')
  await db().exec('DELETE FROM responses')
  await db().exec('DELETE FROM open_questions')
  await db().exec('DELETE FROM wishes')
})

const seed = (over: Partial<Parameters<typeof createWish>[1]> = {}) => createWish(db(), {
  title: '自動報價工具', problem: '每次手工查舊檔', desired: '按一鍵出報價',
  status: 'published', open_questions: [], ...over,
}, 1000)

describe('tokenize', () => {
  it('CJK 段取相鄰雙字 bigram', () => {
    expect([...tokenize('自動報價')].sort()).toEqual(['報價', '動報', '自動'].sort())
  })
  it('單一 CJK 字退回單字;ASCII 詞小寫、單字元丟棄', () => {
    expect(tokenize('貓')).toEqual(new Set(['貓']))
    expect(tokenize('a GitHub OG 卡')).toEqual(new Set(['github', 'og', '卡']))
  })
  it('中英混排各自斷段,不跨段成 bigram', () => {
    expect(tokenize('LINE 訂便當 bot')).toEqual(new Set(['line', '訂便', '便當', 'bot']))
  })
})

describe('diceSimilarity / scoreSimilarity', () => {
  it('相同=1、無交集=0、空字串=0', () => {
    const a = tokenize('自動報價工具')
    expect(diceSimilarity(a, tokenize('自動報價工具'))).toBe(1)
    expect(diceSimilarity(a, tokenize('貓咪照片牆'))).toBe(0)
    expect(diceSimilarity(tokenize(''), a)).toBe(0)
  })
  it('相似標題過門檻、無關標題不過', () => {
    const input = { title: '自動報價系統', problem: '手工報價太慢', desired: '' }
    expect(scoreSimilarity(input, { title: '自動報價工具', problem: null, desired: null }))
      .toBeGreaterThanOrEqual(SIMILAR_THRESHOLD)
    expect(scoreSimilarity(input, { title: '貓咪照片牆', problem: '想收集貓照', desired: null }))
      .toBeLessThan(SIMILAR_THRESHOLD)
  })
  it('標題寫法不同但全文講同件事,靠全文比對抓到', () => {
    const input = { title: '幫業務省時間', problem: '每次手工查舊檔算報價單很慢', desired: '按一鍵自動產出報價單' }
    const cand = { title: '報價單產生器', problem: '手工查舊檔算報價單', desired: '一鍵自動產出報價單' }
    expect(scoreSimilarity(input, cand)).toBeGreaterThanOrEqual(SIMILAR_THRESHOLD)
  })
})

describe('findSimilarWishes(D1)', () => {
  it('回傳相似的公開願望(含 answers_count),排除 pending/hidden 與無關願望', async () => {
    const pub = await seed({ title: '自動報價工具', status: 'done' })
    await createAnswer(db(), pub, { repo_url: 'https://github.com/x/y' }, 1001)
    await seed({ title: '自動報價神器', status: 'pending' })   // 非公開:不推薦
    await seed({ title: '貓咪照片牆', problem: '想收集貓照', desired: '一面牆' })  // 無關:不推薦
    const r = await findSimilarWishes(db(), { title: '自動報價系統', problem: '手工報價太慢' })
    expect(r.map((s) => s.id)).toEqual([pub])
    expect(r[0].status).toBe('done')
    expect(r[0].answers_count).toBe(1)
    expect(r[0].score).toBeGreaterThanOrEqual(SIMILAR_THRESHOLD)
  })
  it('最多回 SIMILAR_LIMIT 筆、分數高到低', async () => {
    for (let i = 0; i < SIMILAR_LIMIT + 2; i++) await seed({ title: `自動報價工具 ${i + 1} 號` })
    const exact = await seed({ title: '自動報價系統' })
    const r = await findSimilarWishes(db(), { title: '自動報價系統' })
    expect(r.length).toBe(SIMILAR_LIMIT)
    expect(r[0].id).toBe(exact)
    for (let i = 1; i < r.length; i++) expect(r[i - 1].score).toBeGreaterThanOrEqual(r[i].score)
  })
})

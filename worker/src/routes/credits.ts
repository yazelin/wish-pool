import { Hono } from 'hono'
import type { Env } from '../env'
import { creditsRows } from '../lib/d1'

// 感謝名單:靈感(公開願望的暱稱)與實現(visible answers 的 github_handle)聚合。
// 資料量小,聚合在 TS 做;列已按 created_at,id 排,穩定排序保「首次出現先」且完全決定性。
// edge cache 走 caches.default(og.ts 同款)—— Worker 回應光設 header 不會進 Cloudflare cache。
export const credits = new Hono<{ Bindings: Env }>()

const CACHE_KEY = 'https://credits-cache.wish-pool.local/v1'

credits.get('/api/credits', async (c) => {
  const cache = caches.default
  const hit = await cache.match(CACHE_KEY)
  if (hit) return new Response(hit.body, hit)   // 快取回應 headers 不可變,複本讓 cors middleware 可寫

  const { wishRows, answerRows } = await creditsRows(c.env.DB)

  const wishers = new Map<string, { nickname: string; wishes: number }>()
  let anonymousWishes = 0
  for (const r of wishRows) {
    const nick = (r.nickname ?? '').trim()
    if (!nick) { anonymousWishes++; continue }
    const cur = wishers.get(nick)
    if (cur) cur.wishes++
    else wishers.set(nick, { nickname: nick, wishes: 1 })
  }

  const implementers = new Map<string, { handle: string; answers: number; adopted: number }>()
  let unsignedAnswers = 0
  for (const r of answerRows) {
    const handle = (r.handle ?? '').trim()
    if (!handle) { unsignedAnswers++; continue }
    const key = handle.toLowerCase()
    const cur = implementers.get(key)
    if (cur) { cur.answers++; cur.adopted += r.adopted ? 1 : 0 }
    else implementers.set(key, { handle, answers: 1, adopted: r.adopted ? 1 : 0 })
  }

  c.header('Cache-Control', 'public, max-age=60, s-maxage=600')
  const res = c.json({
    wishers: [...wishers.values()].sort((a, b) => b.wishes - a.wishes),
    anonymous_wishes: anonymousWishes,
    implementers: [...implementers.values()].sort((a, b) => (b.adopted - a.adopted) || (b.answers - a.answers)),
    unsigned_answers: unsignedAnswers,
  })
  // 空池不入快取:剛上線/剛清空時別把「沒有人」釘住 10 分鐘
  if (wishRows.length || answerRows.length) c.executionCtx.waitUntil(cache.put(CACHE_KEY, res.clone()))
  return res
})

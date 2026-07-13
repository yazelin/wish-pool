import { Hono } from 'hono'
import type { Env } from '../env'
import { PUBLIC_STATUSES } from '../lib/d1'

// 感謝名單:靈感(公開願望的暱稱)與實現(visible answers 的 github_handle)聚合。
// 資料量小,SQL 只撈原始列、聚合在 TS 做;列已按 created_at 排,穩定排序天然保「首次出現先」。
export const credits = new Hono<{ Bindings: Env }>()

credits.get('/api/credits', async (c) => {
  const marks = PUBLIC_STATUSES.map(() => '?').join(',')
  const { results: wishRows } = await c.env.DB.prepare(
    `SELECT nickname FROM wishes WHERE status IN (${marks}) ORDER BY created_at`,
  ).bind(...PUBLIC_STATUSES).all<{ nickname: string | null }>()
  const { results: answerRows } = await c.env.DB.prepare(
    `SELECT a.github_handle AS handle, (a.id = w.accepted_answer_id) AS adopted
       FROM answers a JOIN wishes w ON w.id = a.wish_id
      WHERE a.status = 'visible' AND w.status IN (${marks})
      ORDER BY a.created_at`,
  ).bind(...PUBLIC_STATUSES).all<{ handle: string | null; adopted: number | null }>()

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
  return c.json({
    wishers: [...wishers.values()].sort((a, b) => b.wishes - a.wishes),
    anonymous_wishes: anonymousWishes,
    implementers: [...implementers.values()].sort((a, b) => (b.adopted - a.adopted) || (b.answers - a.answers)),
    unsigned_answers: unsignedAnswers,
  })
})

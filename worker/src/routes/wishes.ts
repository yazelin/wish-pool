import { Hono } from 'hono'
import type { Env } from '../env'
import { createWish, listWishes, getWish, addVote, addResponse } from '../lib/d1'
import { verifyTurnstile } from '../lib/turnstile'
import { checkAndBump, hashIp } from '../lib/ratelimit'

const DAY = 86400

export const wishes = new Hono<{ Bindings: Env }>()

function ip(c: any): string { return c.req.header('CF-Connecting-IP') || '0.0.0.0' }

async function guard(c: any, token: string, action: string, limit: number): Promise<Response | null> {
  const ok = await verifyTurnstile(token, ip(c), c.env.TURNSTILE_SECRET)
  if (!ok) return c.json({ error: 'turnstile_failed' }, 403)
  const fp = await hashIp(ip(c), c.env.IP_SALT)
  const allowed = await checkAndBump(c.env.DB, `${action}:${fp}`, limit, DAY, Math.floor(Date.now() / 1000))
  if (!allowed) return c.json({ error: 'rate_limited' }, 429)
  return null
}

wishes.get('/api/wishes', async (c) => {
  const sort = c.req.query('sort') === 'hot' ? 'hot' : 'new'
  const limit = Math.min(Number(c.req.query('limit')) || 50, 100)
  const offset = Number(c.req.query('offset')) || 0
  const rows = await listWishes(c.env.DB, { sort, limit, offset })
  return c.json({ wishes: rows })
})

wishes.get('/api/wishes/:id', async (c) => {
  const w = await getWish(c.env.DB, Number(c.req.param('id')))
  if (!w) return c.json({ error: 'not_found' }, 404)
  return c.json(w)
})

wishes.post('/api/wishes', async (c) => {
  const b = await c.req.json().catch(() => ({}))
  const blocked = await guard(c, b.turnstileToken, 'submit', 5)
  if (blocked) return blocked
  const w = b.wish || {}
  const title = String(w.title ?? '').trim()
  if (!title) return c.json({ error: 'title_required' }, 400)
  const status = b.verdict === 'ok' ? 'published' : 'pending'
  const id = await createWish(c.env.DB, {
    title,
    problem: w.problem, current: w.current, desired: w.desired, who: w.who, nickname: w.nickname,
    status, open_questions: Array.isArray(b.open_questions) ? b.open_questions : [],
  }, Math.floor(Date.now() / 1000))
  return c.json({ id, status })
})

wishes.post('/api/wishes/:id/vote', async (c) => {
  const id = Number(c.req.param('id'))
  const b = await c.req.json().catch(() => ({}))
  const blocked = await guard(c, b.turnstileToken, 'vote', 100)
  if (blocked) return blocked
  const fp = await hashIp(ip(c), c.env.IP_SALT)
  const r = await addVote(c.env.DB, id, fp, Math.floor(Date.now() / 1000))
  return c.json(r)
})

wishes.post('/api/wishes/:id/responses', async (c) => {
  const id = Number(c.req.param('id'))
  const b = await c.req.json().catch(() => ({}))
  const blocked = await guard(c, b.turnstileToken, 'respond', 30)
  if (blocked) return blocked
  const body = String(b.body ?? '').trim()
  if (!body) return c.json({ error: 'body_required' }, 400)
  const kind = b.kind === 'metoo' ? 'metoo' : 'answer'
  const rid = await addResponse(c.env.DB, id, {
    body, nickname: b.nickname, kind, questionId: b.questionId ? Number(b.questionId) : undefined,
  }, Math.floor(Date.now() / 1000))
  return c.json({ id: rid })
})

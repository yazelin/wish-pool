import { Hono } from 'hono'
import type { Env } from '../env'
import { createWish, listWishes, getWish, wishExists, addVote, addResponse } from '../lib/d1'
import { verifyTurnstile } from '../lib/turnstile'
import { checkAndBump, hashIp } from '../lib/ratelimit'
import { verifyWish } from '../lib/sign'
import { createWishDiscussion } from '../lib/github'
import { setDiscussionUrl, autoAdoptIfHot } from '../lib/d1'
import { notifyDiscussion } from '../lib/github'
import { checkAgentBearer } from '../lib/agent-auth'

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
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) return c.json({ error: 'not_found' }, 404)
  const w = await getWish(c.env.DB, id)
  if (!w) return c.json({ error: 'not_found' }, 404)
  return c.json(w)
})

wishes.post('/api/wishes', async (c) => {
  const b = await c.req.json().catch(() => ({}))
  const agent = await checkAgentBearer(c, 'atokw', 3)
  if (agent instanceof Response) return agent
  if (!agent) {
    const blocked = await guard(c, b.turnstileToken, 'submit', 5)
    if (blocked) return blocked
  }
  const w = b.wish || {}
  const title = String(w.title ?? '').trim()
  if (!title) return c.json({ error: 'title_required' }, 400)
  // verdict:'ok' 只有在後端驗簽(/api/refine 簽的 sig,且內容未被改過)成立時才自動上牆;
  // 否則(偽造、改過、過期、純表單無 sig)一律進 pending 等 owner 審。
  let status = 'pending'
  if (b.verdict === 'ok') {
    const valid = await verifyWish(
      c.env.WISH_SIGN_SECRET,
      { title, problem: w.problem, current: w.current, desired: w.desired, who: w.who },
      'ok', b.sig, Math.floor(Date.now() / 1000),
    )
    if (valid) status = 'published'
  }
  const id = await createWish(c.env.DB, {
    title,
    problem: w.problem, current: w.current, desired: w.desired, who: w.who, nickname: w.nickname,
    status, open_questions: Array.isArray(b.open_questions) ? b.open_questions : [],
  }, Math.floor(Date.now() / 1000))
  if (status === 'published') {
    c.executionCtx.waitUntil(
      createWishDiscussion(c.env, { id, title, problem: w.problem, current: w.current, desired: w.desired, who: w.who })
        .then((u) => (u ? setDiscussionUrl(c.env.DB, id, u) : undefined))
        .catch((e) => console.error('discussion create failed:', String(e))),
    )
  }
  return c.json({ id, status })
})

wishes.post('/api/wishes/:id/vote', async (c) => {
  const id = Number(c.req.param('id'))
  const b = await c.req.json().catch(() => ({}))
  const agent = await checkAgentBearer(c, 'atokv', 50)
  if (agent instanceof Response) return agent
  if (!agent) {
    const blocked = await guard(c, b.turnstileToken, 'vote', 100)
    if (blocked) return blocked
  }
  if (!Number.isInteger(id) || !(await wishExists(c.env.DB, id))) return c.json({ error: 'not_found' }, 404)
  // agent 投幣以 token 身分去重(一 token 一票);人類照舊 IP 指紋
  const fp = agent ? 'tok:' + ((c as any).get('atokHash') || 'owner') : await hashIp(ip(c), c.env.IP_SALT)
  const r = await addVote(c.env.DB, id, fp, Math.floor(Date.now() / 1000))
  if (r.ok) {
    c.executionCtx.waitUntil((async () => {
      const a = await autoAdoptIfHot(c.env.DB, id)
      if (a.promoted) await notifyDiscussion(c.env, a.discussion_url, '【狀態更新】這個願望被採納了(社群熱度達標:投幣+共鳴達 3)—— 尋找實現它的人(或 AI)。').catch(() => {})
    })())
  }
  return c.json(r)
})

wishes.post('/api/wishes/:id/responses', async (c) => {
  const id = Number(c.req.param('id'))
  const b = await c.req.json().catch(() => ({}))
  const agent = await checkAgentBearer(c, 'atokr', 50)
  if (agent instanceof Response) return agent
  if (!agent) {
    const blocked = await guard(c, b.turnstileToken, 'respond', 30)
    if (blocked) return blocked
  }
  if (!Number.isInteger(id) || !(await wishExists(c.env.DB, id))) return c.json({ error: 'not_found' }, 404)
  const body = String(b.body ?? '').trim()
  if (!body) return c.json({ error: 'body_required' }, 400)
  const kind = b.kind === 'metoo' ? 'metoo' : 'answer'
  const rid = await addResponse(c.env.DB, id, {
    body, nickname: b.nickname, kind, questionId: b.questionId ? Number(b.questionId) : undefined,
    agentTokenId: (c as any).get('atokId') ?? undefined,
  }, Math.floor(Date.now() / 1000))
  c.executionCtx.waitUntil((async () => {
      const a = await autoAdoptIfHot(c.env.DB, id)
      if (a.promoted) await notifyDiscussion(c.env, a.discussion_url, '【狀態更新】這個願望被採納了(社群熱度達標:投幣+共鳴達 3)—— 尋找實現它的人(或 AI)。').catch(() => {})
  })())
  return c.json({ id: rid })
})

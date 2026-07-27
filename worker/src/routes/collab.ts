import { Hono } from 'hono'
import type { Env } from '../env'
import { publicWishExists, createAnswer, addAnswerVote, publicAnswerExists, addUpdate, createNeed, autoBuildOnClaim, needBelongsToWish } from '../lib/d1'
import { verifyTurnstile } from '../lib/turnstile'
import { checkAndBump, hashIp } from '../lib/ratelimit'
import { checkAgentBearer } from '../lib/agent-auth'
import { notifyDiscussion } from '../lib/github'
import { getWish } from '../lib/d1'
import { currentUser, userFingerprint, type SessionUser } from '../lib/oauth'

const DAY = 86400
export const collab = new Hono<{ Bindings: Env }>()

function ip(c: any): string { return c.req.header('CF-Connecting-IP') || '0.0.0.0' }
function agentToken(c: any): string {
  const a = c.req.header('Authorization') || ''
  return a.startsWith('Bearer ') ? a.slice(7) : ''
}
// guard 認過的登入身分(issue #2):下游用它做「已驗證署名」與「一人一票」
function sessionOf(c: any): SessionUser | null { return (c.get('user') as SessionUser | undefined) ?? null }

async function guard(c: any, token: string, action: string, limit: number): Promise<Response | null> {
  // 已登入的協力者(GitHub OAuth):以帳號身分節流,免 Turnstile;身分掛上 context 供下游署名/去重。
  const user = await currentUser(c)
  if (user) {
    c.set('user', user)
    if (!(await checkAndBump(c.env.DB, `u:${action}:${user.id}`, limit, DAY, Math.floor(Date.now() / 1000)))) return c.json({ error: 'rate_limited' }, 429)
    return null
  }
  // 可信 AI agent:帶 Bearer token 即免 Turnstile(共用 checkAgentBearer;每枚每日 200 次協作寫入)。
  const agent = await checkAgentBearer(c, 'atok', 200)
  if (agent instanceof Response) return agent
  if (agent) return null
  if (!(await verifyTurnstile(token, ip(c), c.env.TURNSTILE_SECRET))) return c.json({ error: 'turnstile_failed' }, 403)
  const fp = await hashIp(ip(c), c.env.IP_SALT)
  if (!(await checkAndBump(c.env.DB, `${action}:${fp}`, limit, DAY, Math.floor(Date.now() / 1000)))) return c.json({ error: 'rate_limited' }, 429)
  return null
}
function isHttpUrl(s: unknown): boolean {
  if (typeof s !== 'string') return false
  try { const u = new URL(s); return u.protocol === 'http:' || u.protocol === 'https:' } catch { return false }
}

collab.post('/api/wishes/:id/answers', async (c) => {
  const id = Number(c.req.param('id'))
  const b = await c.req.json().catch(() => ({}))
  const blocked = await guard(c, b.turnstileToken, 'answer', 20); if (blocked) return blocked
  if (!Number.isInteger(id) || !(await publicWishExists(c.env.DB, id))) return c.json({ error: 'not_found' }, 404)
  if (!isHttpUrl(b.repo_url)) return c.json({ error: 'bad_repo_url' }, 400)
  // 登入者的署名由伺服器決定(GitHub 帳號),不吃 body 的 github_handle —— 這才是「已驗證署名」的意思
  const user = sessionOf(c)
  const handle = user ? user.login : b.github_handle
  const aid = await createAnswer(c.env.DB, id, { repo_url: String(b.repo_url), note: b.note, github_handle: handle, handleVerified: !!user, agentTokenId: (c as any).get('atokId') }, Math.floor(Date.now() / 1000))
  c.executionCtx.waitUntil((async () => {
    const w = await getWish(c.env.DB, id)
    const who = handle ? ` — @${handle}` : ''
    await notifyDiscussion(c.env, w?.discussion_url ?? null, `【池面動態】有人交出實作:${String(b.repo_url)}${b.note ? `\n> ${String(b.note)}` : ''}${who}`).catch(() => {})
  })())
  return c.json({ id: aid })
})

collab.post('/api/answers/:id/vote', async (c) => {
  const id = Number(c.req.param('id'))
  const b = await c.req.json().catch(() => ({}))
  const blocked = await guard(c, b.turnstileToken, 'avote', 200); if (blocked) return blocked
  if (!Number.isInteger(id) || !(await publicAnswerExists(c.env.DB, id))) return c.json({ error: 'not_found' }, 404)
  // 登入者以 GitHub 帳號去重(換裝置換 IP 都只算一票);沒登入照舊 IP 指紋軟去重
  const user = sessionOf(c)
  const fp = user ? userFingerprint(user) : await hashIp(ip(c), c.env.IP_SALT)
  return c.json(await addAnswerVote(c.env.DB, id, fp, Math.floor(Date.now() / 1000)))
})

collab.post('/api/wishes/:id/updates', async (c) => {
  const id = Number(c.req.param('id'))
  const b = await c.req.json().catch(() => ({}))
  const blocked = await guard(c, b.turnstileToken, 'update', 30); if (blocked) return blocked
  if (!Number.isInteger(id) || !(await publicWishExists(c.env.DB, id))) return c.json({ error: 'not_found' }, 404)
  const body = String(b.body ?? '').trim(); if (!body) return c.json({ error: 'body_required' }, 400)
  const user = sessionOf(c)
  const handle = user ? user.login : b.github_handle
  const uid = await addUpdate(c.env.DB, id, { kind: String(b.kind ?? 'progress'), body, github_handle: handle, handleVerified: !!user, agentTokenId: (c as any).get('atokId') }, Math.floor(Date.now() / 1000))
  c.executionCtx.waitUntil((async () => {
    const w = await getWish(c.env.DB, id)
    const kindLabel = ({ claim: '有人認領了這個願望', progress: '進度回報', blocked: '卡關回報' } as Record<string, string>)[String(b.kind ?? 'progress')] || '進度回報'
    const who = handle ? ` — @${handle}` : ''
    await notifyDiscussion(c.env, w?.discussion_url ?? null, `【池面動態】${kindLabel}:${body}${who}`).catch(() => {})
    if (String(b.kind) === 'claim') {
      const a = await autoBuildOnClaim(c.env.DB, id)
      if (a.promoted) await notifyDiscussion(c.env, a.discussion_url, '【狀態更新】有人按下「我來實現」,願望自動進入「實現中」。').catch(() => {})
    }
  })())
  return c.json({ id: uid })
})

collab.post('/api/wishes/:id/needs', async (c) => {
  const id = Number(c.req.param('id'))
  const b = await c.req.json().catch(() => ({}))
  const blocked = await guard(c, b.turnstileToken, 'need', 30); if (blocked) return blocked
  if (!Number.isInteger(id) || !(await publicWishExists(c.env.DB, id))) return c.json({ error: 'not_found' }, 404)
  const body = String(b.body ?? '').trim(); if (!body) return c.json({ error: 'body_required' }, 400)
  const parentNeedId = b.parent_need_id == null ? undefined : Number(b.parent_need_id)
  if (parentNeedId != null && (!Number.isInteger(parentNeedId) || !(await needBelongsToWish(c.env.DB, id, parentNeedId)))) {
    return c.json({ error: 'bad_parent_need_id' }, 400)
  }
  const nid = await createNeed(c.env.DB, id, String(b.type ?? 'info'), body, {
    askedOf: b.asked_of,
    priority: b.priority,
    parentNeedId,
    agentTokenId: (c as any).get('atokId'),
    now: Math.floor(Date.now() / 1000),
  })
  return c.json({ id: nid })
})

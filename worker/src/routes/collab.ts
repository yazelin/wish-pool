import { Hono } from 'hono'
import type { Env } from '../env'
import { wishExists, createAnswer, addAnswerVote, answerExists, addUpdate, createNeed } from '../lib/d1'
import { verifyTurnstile } from '../lib/turnstile'
import { checkAndBump, hashIp, sha256Hex } from '../lib/ratelimit'

const DAY = 86400
export const collab = new Hono<{ Bindings: Env }>()

function ip(c: any): string { return c.req.header('CF-Connecting-IP') || '0.0.0.0' }
function agentToken(c: any): string {
  const a = c.req.header('Authorization') || ''
  return a.startsWith('Bearer ') ? a.slice(7) : ''
}
async function guard(c: any, token: string, action: string, limit: number): Promise<Response | null> {
  // 可信 AI agent:帶 Bearer token 即免 Turnstile。兩種來源:
  // (1) 站長的 AGENT_TOKEN(env,無限額);(2) 自助發放的 wp_agent_*(D1 驗雜湊、每枚每日 200 次、可撤銷)。
  const at = agentToken(c)
  if (at && at === c.env.AGENT_TOKEN) return null
  if (at && at.startsWith('wp_agent_')) {
    const h = await sha256Hex(at)
    const row = await c.env.DB.prepare('SELECT id, revoked FROM agent_tokens WHERE token_hash = ?').bind(h).first()
    if (row && !row.revoked) {
      if (!(await checkAndBump(c.env.DB, `atok:${h}`, 200, 86400, Math.floor(Date.now() / 1000)))) return c.json({ error: 'rate_limited' }, 429)
      c.executionCtx.waitUntil(c.env.DB.prepare('UPDATE agent_tokens SET last_used_at = ? WHERE id = ?').bind(Math.floor(Date.now() / 1000), row.id).run())
      return null
    }
    return c.json({ error: 'bad_agent_token' }, 403)
  }
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
  if (!Number.isInteger(id) || !(await wishExists(c.env.DB, id))) return c.json({ error: 'not_found' }, 404)
  if (!isHttpUrl(b.repo_url)) return c.json({ error: 'bad_repo_url' }, 400)
  const aid = await createAnswer(c.env.DB, id, { repo_url: String(b.repo_url), note: b.note, github_handle: b.github_handle }, Math.floor(Date.now() / 1000))
  return c.json({ id: aid })
})

collab.post('/api/answers/:id/vote', async (c) => {
  const id = Number(c.req.param('id'))
  const b = await c.req.json().catch(() => ({}))
  const blocked = await guard(c, b.turnstileToken, 'avote', 200); if (blocked) return blocked
  if (!Number.isInteger(id) || !(await answerExists(c.env.DB, id))) return c.json({ error: 'not_found' }, 404)
  const fp = await hashIp(ip(c), c.env.IP_SALT)
  return c.json(await addAnswerVote(c.env.DB, id, fp, Math.floor(Date.now() / 1000)))
})

collab.post('/api/wishes/:id/updates', async (c) => {
  const id = Number(c.req.param('id'))
  const b = await c.req.json().catch(() => ({}))
  const blocked = await guard(c, b.turnstileToken, 'update', 30); if (blocked) return blocked
  if (!Number.isInteger(id) || !(await wishExists(c.env.DB, id))) return c.json({ error: 'not_found' }, 404)
  const body = String(b.body ?? '').trim(); if (!body) return c.json({ error: 'body_required' }, 400)
  const uid = await addUpdate(c.env.DB, id, { kind: String(b.kind ?? 'progress'), body, github_handle: b.github_handle }, Math.floor(Date.now() / 1000))
  return c.json({ id: uid })
})

collab.post('/api/wishes/:id/needs', async (c) => {
  const id = Number(c.req.param('id'))
  const b = await c.req.json().catch(() => ({}))
  const blocked = await guard(c, b.turnstileToken, 'need', 30); if (blocked) return blocked
  if (!Number.isInteger(id) || !(await wishExists(c.env.DB, id))) return c.json({ error: 'not_found' }, 404)
  const body = String(b.body ?? '').trim(); if (!body) return c.json({ error: 'body_required' }, 400)
  const nid = await createNeed(c.env.DB, id, String(b.type ?? 'info'), body)
  return c.json({ id: nid })
})

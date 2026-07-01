import { Hono } from 'hono'
import type { Env } from '../env'
import { refine, type ChatMsg } from '../lib/llm'
import { checkAndBump, hashIp } from '../lib/ratelimit'

const DAY = 86400

export const refineRoute = new Hono<{ Bindings: Env }>()

refineRoute.post('/api/refine', async (c) => {
  const b = await c.req.json().catch(() => ({}))
  const messages = Array.isArray(b.messages) ? b.messages : []
  if (messages.length === 0) return c.json({ error: 'messages_required' }, 400)

  const ip = c.req.header('CF-Connecting-IP') || '0.0.0.0'
  const fp = await hashIp(ip, c.env.IP_SALT)
  const allowed = await checkAndBump(c.env.DB, `refine:${fp}`, 40, DAY, Math.floor(Date.now() / 1000))
  if (!allowed) return c.json({ error: 'rate_limited' }, 429)

  const clean: ChatMsg[] = messages
    .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-20)
    .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 4000) }))

  try {
    return c.json(await refine(c.env, clean))
  } catch (e) {
    console.error('refine llm error:', String(e))
    return c.json({ error: 'llm_unavailable' }, 500)
  }
})

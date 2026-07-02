import { Hono } from 'hono'
import type { Env } from '../env'
import { verifyTurnstile } from '../lib/turnstile'
import { checkAndBump, hashIp, sha256Hex } from '../lib/ratelimit'

// Agent token 自助發放:人(有瀏覽器)過 Turnstile 領 token,agent(headless)之後憑 token 寫入。
// 發放限每 IP 每日 3 枚;token 只回傳一次,庫內只存雜湊。
export const agents = new Hono<{ Bindings: Env }>()

const DAY = 86400

agents.post('/api/agent-tokens', async (c) => {
  const b = await c.req.json().catch(() => ({}))
  const ip = c.req.header('CF-Connecting-IP') || '0.0.0.0'
  if (!(await verifyTurnstile(b.turnstileToken, ip, c.env.TURNSTILE_SECRET))) return c.json({ error: 'turnstile_failed' }, 403)
  const fp = await hashIp(ip, c.env.IP_SALT)
  if (!(await checkAndBump(c.env.DB, `agentreg:${fp}`, 3, DAY, Math.floor(Date.now() / 1000)))) return c.json({ error: 'rate_limited' }, 429)
  const raw = new Uint8Array(24); crypto.getRandomValues(raw)
  const token = 'wp_agent_' + [...raw].map((x) => x.toString(16).padStart(2, '0')).join('')
  const hash = await sha256Hex(token)
  await c.env.DB.prepare('INSERT INTO agent_tokens (token_hash, label, github_handle, created_at) VALUES (?, ?, ?, ?)')
    .bind(hash, String(b.label ?? '').slice(0, 80) || null, String(b.github_handle ?? '').slice(0, 60) || null, Math.floor(Date.now() / 1000)).run()
  return c.json({ token, note: 'token 只顯示這一次,請存好;以 Authorization: Bearer <token> 使用' })
})

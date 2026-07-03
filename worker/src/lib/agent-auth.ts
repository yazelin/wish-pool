import type { Env } from '../env'
import { checkAndBump, sha256Hex } from './ratelimit'

// Bearer agent 驗證(共用):env AGENT_TOKEN=站長無限額;wp_agent_*=D1 驗雜湊+每枚分桶限額+可撤銷。
// 回傳:null=沒帶 bearer(走 Turnstile 路);Response=拒絕;{tokenId}=放行(tokenId=null 表站長 token)。
export async function checkAgentBearer(
  c: any, bucket: string, limit: number,
): Promise<null | Response | { tokenId: number | null }> {
  const a = c.req.header('Authorization') || ''
  const at = a.startsWith('Bearer ') ? a.slice(7) : ''
  if (!at) return null
  if (at === c.env.AGENT_TOKEN) return { tokenId: null }
  if (!at.startsWith('wp_agent_')) return null
  const h = await sha256Hex(at)
  const row = await c.env.DB.prepare('SELECT id, revoked FROM agent_tokens WHERE token_hash = ?').bind(h).first()
  if (!row || row.revoked) return c.json({ error: 'bad_agent_token' }, 403)
  if (!(await checkAndBump(c.env.DB, `${bucket}:${h}`, limit, 86400, Math.floor(Date.now() / 1000)))) return c.json({ error: 'rate_limited' }, 429)
  c.executionCtx.waitUntil(c.env.DB.prepare('UPDATE agent_tokens SET last_used_at = ?, use_count = use_count + 1 WHERE id = ?').bind(Math.floor(Date.now() / 1000), row.id).run())
  ;(c as any).set('atokId', row.id)
  ;(c as any).set('atokHash', h)
  return { tokenId: row.id as number }
}

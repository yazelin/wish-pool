import { Hono } from 'hono'
import type { Env } from '../env'
import { listByStatus, listByStatusAdmin, setStatus, exportAll, setAnswerStatus, acceptAnswer, resolveNeed, answerExists, deleteWish, getWish, setDiscussionUrl } from '../lib/d1'
import { createWishDiscussion } from '../lib/github'

const STATUSES = ['pending', 'published', 'adopted', 'building', 'done', 'hidden']

export const admin = new Hono<{ Bindings: Env }>()

admin.use('/api/admin/*', async (c, next) => {
  const auth = c.req.header('Authorization') || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!token || token !== c.env.ADMIN_TOKEN) return c.json({ error: 'unauthorized' }, 401)
  await next()
})

admin.get('/api/admin/wishes', async (c) => {
  const status = c.req.query('status') || 'pending'
  return c.json({ wishes: await listByStatusAdmin(c.env.DB, status) })
})

admin.post('/api/admin/wishes/:id/status', async (c) => {
  const b = await c.req.json().catch(() => ({}))
  if (!STATUSES.includes(b.status)) return c.json({ error: 'bad_status' }, 400)
  const id = Number(c.req.param('id'))
  await setStatus(c.env.DB, id, b.status)
  if (b.status === 'published') {
    c.executionCtx.waitUntil((async () => {
      const w = await getWish(c.env.DB, id)
      if (w && !w.discussion_url) {
        const u = await createWishDiscussion(c.env, w).catch((e) => { console.error('discussion create failed:', String(e)); return null })
        if (u) await setDiscussionUrl(c.env.DB, id, u)
      }
    })())
  }
  return c.json({ ok: true })
})

admin.get('/api/admin/export', async (c) => c.json(await exportAll(c.env.DB)))

admin.post('/api/admin/answers/:id/status', async (c) => {
  const b = await c.req.json().catch(() => ({}))
  await setAnswerStatus(c.env.DB, Number(c.req.param('id')), b.status)
  return c.json({ ok: true })
})

admin.post('/api/admin/wishes/:id/accept', async (c) => {
  const b = await c.req.json().catch(() => ({}))
  const aid = Number(b.answer_id)
  if (!Number.isInteger(aid) || !(await answerExists(c.env.DB, aid))) return c.json({ error: 'bad_answer' }, 400)
  await acceptAnswer(c.env.DB, Number(c.req.param('id')), aid)
  return c.json({ ok: true })
})

admin.post('/api/admin/needs/:id/resolve', async (c) => {
  await resolveNeed(c.env.DB, Number(c.req.param('id')))
  return c.json({ ok: true })
})

admin.get('/api/admin/agent-tokens', async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT t.id, t.label, t.github_handle, t.created_at, t.last_used_at, t.revoked, t.use_count,
      substr(t.created_ip_hash, 1, 8) AS ip8,
      (SELECT COUNT(*) FROM answers a WHERE a.agent_token_id = t.id) AS answers_count,
      (SELECT COUNT(*) FROM updates u WHERE u.agent_token_id = t.id) AS updates_count
    FROM agent_tokens t ORDER BY t.id DESC`).all()
  return c.json({ tokens: results })
})

admin.post('/api/admin/agent-tokens/:id/revoke', async (c) => {
  await c.env.DB.prepare('UPDATE agent_tokens SET revoked = 1 WHERE id = ?').bind(Number(c.req.param('id'))).run()
  return c.json({ ok: true })
})

admin.post('/api/admin/wishes/:id/delete', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) return c.json({ error: 'bad_id' }, 400)
  await deleteWish(c.env.DB, id)
  return c.json({ ok: true })
})

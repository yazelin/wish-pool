import { Hono } from 'hono'
import type { Env } from '../env'
import { listByStatus, setStatus, exportAll, setAnswerStatus, acceptAnswer, resolveNeed, answerExists } from '../lib/d1'

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
  return c.json({ wishes: await listByStatus(c.env.DB, status) })
})

admin.post('/api/admin/wishes/:id/status', async (c) => {
  const b = await c.req.json().catch(() => ({}))
  if (!STATUSES.includes(b.status)) return c.json({ error: 'bad_status' }, 400)
  await setStatus(c.env.DB, Number(c.req.param('id')), b.status)
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

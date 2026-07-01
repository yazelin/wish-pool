import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Env } from './env'

const app = new Hono<{ Bindings: Env }>()

app.onError((err, c) => {
  console.error('unhandled error:', (err as Error)?.stack || String(err))
  return c.json({ error: 'internal_error' }, 500)
})

app.use('/api/*', cors({
  origin: (origin, c) => (origin === c.env.ALLOWED_ORIGIN ? origin : c.env.ALLOWED_ORIGIN),
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))

app.get('/health', (c) => c.json({ ok: true }))

export default app

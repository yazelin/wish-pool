import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Env } from './env'
import { wishes } from './routes/wishes'
import { refineRoute } from './routes/refine'
import { admin } from './routes/admin'
import { collab } from './routes/collab'
import { og } from './routes/og'
import { agents } from './routes/agents'
import { spec } from './routes/spec'
import { refinement } from './routes/refinement'
import { credits } from './routes/credits'
import { share } from './routes/share'

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

app.route('/', wishes)
app.route('/', refineRoute)
app.route('/', admin)
app.route('/', collab)
app.route('/', og)
app.route('/', agents)
app.route('/', spec)
app.route('/', refinement)
app.route('/', credits)
app.route('/', share)

export default app

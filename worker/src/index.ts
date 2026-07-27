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
import { auth } from './routes/auth'

const app = new Hono<{ Bindings: Env }>()

app.onError((err, c) => {
  console.error('unhandled error:', (err as Error)?.stack || String(err))
  return c.json({ error: 'internal_error' }, 500)
})

app.use('/api/*', cors({
  origin: (origin, c) => (origin === c.env.ALLOWED_ORIGIN ? origin : c.env.ALLOWED_ORIGIN),
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  // X-Wish-Session:協力者 GitHub 登入後的身分憑證(Authorization 留給 agent token,兩者不互搶)
  allowHeaders: ['Content-Type', 'Authorization', 'X-Wish-Session'],
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
app.route('/', auth)

export default app

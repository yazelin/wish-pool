import { Hono } from 'hono'
import type { Env } from '../env'
import { checkAndBump, hashIp } from '../lib/ratelimit'
import {
  currentUser, newState, oauthConfigured, redirectUri, sessionSecret, issueSession, verifyState,
} from '../lib/oauth'

// 協力者 GitHub 登入(issue #2)。三個端點:開場拿 authorize_url、回來用 code 換 session、查目前身分。
// 沒設 GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET 時整條路自動關閉(503),站台其餘功能完全不受影響。
export const auth = new Hono<{ Bindings: Env }>()

const DAY = 86400
const STATE_TTL = 900           // state 十五分鐘內要用掉(留給輸密碼與兩階段驗證的時間)
const SESSION_TTL = 30 * DAY    // 登入效期三十天(純簽章,過期即失效)

function ip(c: any): string { return c.req.header('CF-Connecting-IP') || '0.0.0.0' }
function nowSec(): number { return Math.floor(Date.now() / 1000) }

auth.get('/api/auth/github/start', async (c) => {
  if (!oauthConfigured(c.env)) return c.json({ error: 'oauth_not_configured' }, 503)
  const state = await newState(sessionSecret(c.env), nowSec(), STATE_TTL)
  const u = new URL('https://github.com/login/oauth/authorize')
  u.searchParams.set('client_id', String(c.env.GITHUB_CLIENT_ID))
  u.searchParams.set('redirect_uri', redirectUri(c.env))
  u.searchParams.set('state', state)
  u.searchParams.set('scope', '')          // 只要公開個人資料:不要 email、不要任何 repo 權限
  u.searchParams.set('allow_signup', 'true')
  return c.json({ authorize_url: u.toString(), state, expires_in: STATE_TTL })
})

auth.post('/api/auth/github/callback', async (c) => {
  if (!oauthConfigured(c.env)) return c.json({ error: 'oauth_not_configured' }, 503)
  const b = await c.req.json().catch(() => ({} as any))
  // 換 token 會打 GitHub,先擋掉亂試:每 IP 每日 30 次
  const fp = await hashIp(ip(c), c.env.IP_SALT)
  if (!(await checkAndBump(c.env.DB, `oauthcb:${fp}`, 30, DAY, nowSec()))) return c.json({ error: 'rate_limited' }, 429)
  // state 驗不過(偽造 / 過期 / 別人塞的)一律拒絕,連 GitHub 都不打
  if (!(await verifyState(sessionSecret(c.env), b.state, nowSec()))) return c.json({ error: 'bad_state' }, 400)
  const code = String(b.code ?? '').trim()
  if (!code) return c.json({ error: 'bad_code' }, 400)

  let accessToken = ''
  try {
    const r = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'wish-pool' },
      body: JSON.stringify({
        client_id: c.env.GITHUB_CLIENT_ID,
        client_secret: c.env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: redirectUri(c.env),
      }),
    })
    const j = (await r.json()) as { access_token?: string }
    accessToken = String(j?.access_token ?? '')
  } catch (e) {
    console.error('oauth exchange error:', String(e))
  }
  if (!accessToken) return c.json({ error: 'oauth_exchange_failed' }, 401)

  let user: { id?: number; login?: string; avatar_url?: string } = {}
  try {
    const r = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json', 'User-Agent': 'wish-pool' },
    })
    user = (await r.json()) as typeof user
  } catch (e) {
    console.error('oauth profile error:', String(e))
  }
  // access token 到此為止:不寫庫、不回前端、不留任何副本
  if (!user?.login || !Number.isFinite(Number(user.id))) return c.json({ error: 'oauth_profile_failed' }, 401)

  const exp = nowSec() + SESSION_TTL
  const token = await issueSession(sessionSecret(c.env), {
    id: Number(user.id), login: String(user.login), avatar_url: user.avatar_url ?? null,
  }, exp)
  return c.json({
    token,
    expires_at: exp,
    user: { id: Number(user.id), login: String(user.login), avatar_url: user.avatar_url ?? null },
  })
})

auth.get('/api/auth/me', async (c) => {
  const u = await currentUser(c)
  if (!u) return c.json({ error: 'unauthenticated' }, 401)
  return c.json({ user: u })
})

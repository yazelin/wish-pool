import type { Env } from '../env'

// 協力者 GitHub OAuth(issue #2):許願者維持零登入,協力者可登入換「乾淨票數 + 已驗證署名」。
//
// 設計取捨(刻意保守,不動既有資料):
// - 無狀態:state 與 session 都是 HMAC 簽章字串,不建表、不寫 D1;沒有 session 表要維護、也沒有清理工。
// - 絕不保存 GitHub access token:換到 token 只用來讀一次 /user(取 id / login / avatar),用完即丟。
// - scope 留空:只拿公開個人資料,拿不到 email、拿不到任何 repo 權限。
// - GitHub 的 OAuth App 不支援 PKCE(沒有 code_challenge),所以 code 換 token 由 Worker 帶
//   client_secret 完成(secret 只在 Worker,前端拿不到);前端只負責保管 state 與 session。

export type SessionUser = { id: number; login: string; avatar_url?: string | null }

const enc = new TextEncoder()

function b64urlFromBytes(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function bytesFromB64url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function hmacHex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// 簽章密鑰:優先用專用的 SESSION_SECRET;沒設就沿用 WISH_SIGN_SECRET(以用途字首做 domain separation,
// 兩種簽章互不通用)。少一把必設的 secret,上線時少一個炸點。
export function sessionSecret(env: Env): string {
  return env.SESSION_SECRET || env.WISH_SIGN_SECRET
}

export function oauthConfigured(env: Env): boolean {
  return !!(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET)
}

export function redirectUri(env: Env): string {
  return env.OAUTH_REDIRECT_URI || env.ALLOWED_ORIGIN
}

/* ============ state:防 CSRF / 防別人塞 code 給你 ============ */

// 格式 `${exp}.${nonce}.${mac}`;exp 為 epoch 秒。伺服器不存 state,靠簽章自證。
export async function signState(secret: string, nonce: string, exp: number): Promise<string> {
  const mac = await hmacHex(secret, `state|${exp}|${nonce}`)
  return `${exp}.${nonce}.${mac}`
}

export async function newState(secret: string, now: number, ttlSec = 600): Promise<string> {
  const raw = new Uint8Array(16)
  crypto.getRandomValues(raw)
  const nonce = [...raw].map((b) => b.toString(16).padStart(2, '0')).join('')
  return signState(secret, nonce, now + ttlSec)
}

export async function verifyState(secret: string, state: unknown, now: number): Promise<boolean> {
  if (typeof state !== 'string') return false
  const parts = state.split('.')
  if (parts.length !== 3) return false
  const [expStr, nonce, mac] = parts
  const exp = Number(expStr)
  if (!Number.isFinite(exp) || now > exp) return false
  if (!/^[0-9a-f]{8,64}$/.test(nonce)) return false
  return timingSafeEqual(mac, await hmacHex(secret, `state|${exp}|${nonce}`))
}

/* ============ session:登入後的身分憑證(前端存 localStorage) ============ */

// 格式 `${payloadB64url}.${mac}`;payload = { id, login, avatar_url, exp }
export async function issueSession(secret: string, user: SessionUser, exp: number): Promise<string> {
  const payload = b64urlFromBytes(enc.encode(JSON.stringify({
    id: user.id, login: user.login, avatar_url: user.avatar_url ?? null, exp,
  })))
  return `${payload}.${await hmacHex(secret, `session|${payload}`)}`
}

export async function verifySession(secret: string, token: unknown, now: number): Promise<SessionUser | null> {
  if (typeof token !== 'string') return null
  const dot = token.indexOf('.')
  if (dot <= 0) return null
  const payload = token.slice(0, dot)
  const mac = token.slice(dot + 1)
  if (!/^[A-Za-z0-9_-]+$/.test(payload)) return null
  if (!timingSafeEqual(mac, await hmacHex(secret, `session|${payload}`))) return null
  let data: any
  try { data = JSON.parse(new TextDecoder().decode(bytesFromB64url(payload))) } catch { return null }
  if (!data || typeof data.login !== 'string' || !Number.isFinite(data.id)) return null
  if (!Number.isFinite(data.exp) || now > data.exp) return null
  return { id: Number(data.id), login: data.login, avatar_url: typeof data.avatar_url === 'string' ? data.avatar_url : null }
}

// 請求上的登入身分:前端帶 X-Wish-Session(不用 Authorization —— 那條給 agent token,兩者不互搶)。
export async function currentUser(c: any): Promise<SessionUser | null> {
  const t = c.req.header('X-Wish-Session') || ''
  if (!t) return null
  return verifySession(sessionSecret(c.env), t, Math.floor(Date.now() / 1000))
}

// 投票去重指紋:同一個 GitHub 帳號在任何裝置 / 任何 IP 都是同一枚指紋(一人一票)。
export function userFingerprint(user: SessionUser): string {
  return `gh:${user.id}`
}

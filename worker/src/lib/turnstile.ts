// Cloudflare Turnstile 伺服端驗證。空 token 直接失敗(不打網路)。
export async function verifyTurnstile(
  token: string, ip: string, secret: string,
  base = 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
): Promise<boolean> {
  if (!token || !token.trim()) return false
  const body = new FormData()
  body.append('secret', secret)
  body.append('response', token)
  if (ip) body.append('remoteip', ip)
  const res = await fetch(base, { method: 'POST', body })
  if (!res.ok) return false
  const data = (await res.json()) as { success?: boolean }
  return data.success === true
}

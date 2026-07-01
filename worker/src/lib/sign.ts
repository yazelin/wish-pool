// 對「AI 判 ok 的願望內容」做 HMAC 簽章,讓 /api/wishes 能確認 verdict:'ok' 真的來自
// /api/refine 且內容未被改過。canonical 對五個內容欄位 trim 後序列化,與前端送出前的
// .trim() 一致,所以未修改的誠實送出會通過、改過或偽造的驗不過(-> pending)。

type WishFields = { title?: string; problem?: string; current?: string; desired?: string; who?: string }

function canonical(w: WishFields): string {
  return JSON.stringify([
    String(w.title ?? '').trim(),
    String(w.problem ?? '').trim(),
    String(w.current ?? '').trim(),
    String(w.desired ?? '').trim(),
    String(w.who ?? '').trim(),
  ])
}

async function hmacHex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// 回傳 `${exp}.${mac}`;exp 為 epoch 秒(簽章的到期時間)
export async function signWish(secret: string, wish: WishFields, verdict: string, exp: number): Promise<string> {
  const mac = await hmacHex(secret, `${exp}|${verdict}|${canonical(wish)}`)
  return `${exp}.${mac}`
}

export async function verifyWish(secret: string, wish: WishFields, verdict: string, sig: unknown, now: number): Promise<boolean> {
  if (typeof sig !== 'string' || !sig.includes('.')) return false
  const dot = sig.indexOf('.')
  const exp = Number(sig.slice(0, dot))
  const mac = sig.slice(dot + 1)
  if (!Number.isFinite(exp) || now > exp) return false
  const expected = await hmacHex(secret, `${exp}|${verdict}|${canonical(wish)}`)
  return timingSafeEqual(mac, expected)
}

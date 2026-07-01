export async function hashIp(ip: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${ip}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// ponytail: read-then-write,非原子。高併發同 bucket 可能少算,對限流無害(寧鬆勿誤殺)。
export async function checkAndBump(
  db: D1Database, bucket: string, limit: number, windowSec: number, now: number,
): Promise<boolean> {
  const row = await db.prepare('SELECT count, reset_at FROM rate_limits WHERE bucket = ?')
    .bind(bucket).first<{ count: number; reset_at: number }>()
  if (!row || now >= row.reset_at) {
    await db.prepare(
      `INSERT INTO rate_limits (bucket, count, reset_at) VALUES (?, 1, ?)
       ON CONFLICT(bucket) DO UPDATE SET count = 1, reset_at = excluded.reset_at`,
    ).bind(bucket, now + windowSec).run()
    return true
  }
  if (row.count >= limit) return false
  await db.prepare('UPDATE rate_limits SET count = count + 1 WHERE bucket = ?').bind(bucket).run()
  return true
}

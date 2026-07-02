import { Hono } from 'hono'
import type { Env } from '../env'

// repo 成果卡 proxy:讀 github.com/{owner}/{repo} 頁的 og:image meta(自訂 Social preview 住在
// repository-images.githubusercontent.com,githubassets 端點永遠只回自動卡,所以必須讀 meta)。
// 只抓 metadata、302 目標限 GitHub 官方圖床、Cloudflare cache 6 小時 —— 不抓取/執行 repo 內容。
export const og = new Hono<{ Bindings: Env }>()

const NAME = /^[A-Za-z0-9_.-]{1,100}$/
const ALLOWED_IMG = /^https:\/\/(repository-images\.githubusercontent\.com|opengraph\.githubassets\.com)\//

og.get('/api/og/:owner/:repo', async (c) => {
  const { owner, repo } = c.req.param()
  if (!NAME.test(owner) || !NAME.test(repo)) return c.json({ error: 'bad_name' }, 400)
  const cache = caches.default
  const key = new Request(`https://og-cache.wish-pool.local/${owner}/${repo}`)
  const hit = await cache.match(key)
  if (hit) return hit
  const res = await fetch(`https://github.com/${owner}/${repo}`, { headers: { 'User-Agent': 'wish-pool-og-card' } })
  if (!res.ok) return c.json({ error: 'not_found' }, 404)
  const html = await res.text()
  const m = html.match(/property="og:image"\s+content="([^"]+)"/i) || html.match(/content="([^"]+)"\s+property="og:image"/i)
  const url = m?.[1]
  if (!url || !ALLOWED_IMG.test(url)) return c.json({ error: 'no_og' }, 404)
  const out = new Response(null, { status: 302, headers: { Location: url, 'Cache-Control': 'public, max-age=21600' } })
  c.executionCtx.waitUntil(cache.put(key, out.clone()))
  return out
})

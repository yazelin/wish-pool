import { Hono } from 'hono'
import type { Env } from '../env'

// 願望分享頁(集氣用):FB/LINE 爬蟲不讀 SPA 的 #wish-N hash,分享 #wish-N 出去
// 永遠只有通用站卡。這裡回一頁帶「該願望專屬 OG」的 HTML 給爬蟲讀,真人則立刻
// 跳轉回池子的該願望。只露 title/problem(本來就是公開牆面內容),非可見狀態 404。
export const share = new Hono<{ Bindings: Env }>()

const SITE = 'https://yazelin.github.io/wish-pool/'
const VISIBLE = new Set(['published', 'adopted', 'building', 'done'])
const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ESC[ch])

share.get('/s/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.text('not found', 404)
  const w = await c.env.DB.prepare('SELECT title, problem, status FROM wishes WHERE id = ?')
    .bind(id).first<{ title: string; problem: string | null; status: string }>()
  if (!w || !VISIBLE.has(w.status)) return c.text('not found', 404)

  const target = `${SITE}#wish-${id}`
  const title = esc(`${w.title}｜AI 願望池`)
  const desc = esc((w.problem || '一個等待實現的願望,來幫它集氣。').slice(0, 150))
  const html = `<!doctype html>
<html lang="zh-Hant-TW">
<head>
<meta charset="utf-8">
<title>${title}</title>
<meta name="description" content="${desc}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="AI 願望池">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:url" content="${esc(new URL(c.req.url).origin)}/s/${id}">
<meta property="og:image" content="${SITE}og.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${desc}">
<meta name="twitter:image" content="${SITE}og.png">
<meta http-equiv="refresh" content="0;url=${esc(target)}">
</head>
<body>
<p>正在前往願望頁…<a href="${esc(target)}">點這裡直接過去</a></p>
<script>location.replace(${JSON.stringify(target)})</script>
</body>
</html>`
  return c.html(html, 200, { 'Cache-Control': 'public, max-age=300' })
})

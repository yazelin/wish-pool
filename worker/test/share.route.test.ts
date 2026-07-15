import { describe, it, expect, beforeEach } from 'vitest'
import { SELF, env } from 'cloudflare:test'

const O = 'https://test.local'

async function seedWish(status: string, title = '正宗台語語音系統', problem: string | null = '長輩視力不佳,需要用聽的') {
  const { createWish } = await import('../src/lib/d1')
  return createWish(env.DB, { title, problem: problem ?? undefined, status, open_questions: [] }, 1000)
}

beforeEach(async () => {
  for (const t of ['answers', 'updates', 'needs', 'responses', 'open_questions', 'votes', 'wishes']) {
    await env.DB.exec(`DELETE FROM ${t}`)
  }
})

describe('GET /s/:id 願望分享頁', () => {
  it('可見願望回帶專屬 OG 的 HTML 並跳轉回 #wish-N', async () => {
    const id = await seedWish('published')
    const res = await SELF.fetch(`${O}/s/${id}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    const html = await res.text()
    expect(html).toContain('og:title')
    expect(html).toContain('正宗台語語音系統｜AI 願望池')
    expect(html).toContain('長輩視力不佳,需要用聽的')
    expect(html).toContain(`#wish-${id}`)
    expect(html).toContain('og.png')
  })

  it('title/problem 中的 HTML 會被跳脫', async () => {
    const id = await seedWish('published', '<script>alert(1)</script>', '"quoted" & <b>')
    const html = await (await SELF.fetch(`${O}/s/${id}`)).text()
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&quot;quoted&quot; &amp; &lt;b&gt;')
  })

  it('pending/rejected 願望與不存在的 id 都回 404', async () => {
    const pending = await seedWish('pending')
    expect((await SELF.fetch(`${O}/s/${pending}`)).status).toBe(404)
    expect((await SELF.fetch(`${O}/s/999999`)).status).toBe(404)
    expect((await SELF.fetch(`${O}/s/abc`)).status).toBe(404)
  })

  it('done 願望仍可分享', async () => {
    const id = await seedWish('done')
    expect((await SELF.fetch(`${O}/s/${id}`)).status).toBe(200)
  })
})

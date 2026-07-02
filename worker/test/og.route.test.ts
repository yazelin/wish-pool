import { describe, it, expect, beforeEach } from 'vitest'
import { SELF, fetchMock } from 'cloudflare:test'

const O = 'https://test.local'
beforeEach(() => { fetchMock.activate(); fetchMock.disableNetConnect() })

describe('GET /api/og/:owner/:repo', () => {
  it('redirects to the custom social image from og:image meta', async () => {
    fetchMock.get('https://github.com').intercept({ path: '/yazelin/k-rider', method: 'GET' })
      .reply(200, '<meta property="og:image" content="https://repository-images.githubusercontent.com/123/abc" />')
    const res = await SELF.fetch(`${O}/api/og/yazelin/k-rider`, { redirect: 'manual' })
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('https://repository-images.githubusercontent.com/123/abc')
  })
  it('rejects bad names', async () => {
    const res = await SELF.fetch(`${O}/api/og/..%2Fevil/x`, { redirect: 'manual' })
    expect([400, 404]).toContain(res.status)
  })
  it('404 when og:image is not a GitHub image host', async () => {
    fetchMock.get('https://github.com').intercept({ path: '/a/b', method: 'GET' })
      .reply(200, '<meta property="og:image" content="https://evil.example/x.png" />')
    const res = await SELF.fetch(`${O}/api/og/a/b`, { redirect: 'manual' })
    expect(res.status).toBe(404)
  })
})

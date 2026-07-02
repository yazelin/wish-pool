import { describe, it, expect, beforeEach } from 'vitest'
import { fetchMock } from 'cloudflare:test'
import { createWishDiscussion } from '../src/lib/github'

beforeEach(() => { fetchMock.activate(); fetchMock.disableNetConnect() })
const wish = { id: 22, title: '決策判斷器', problem: 'p', current: 'c', desired: 'd', who: 'w' }

describe('createWishDiscussion', () => {
  it('creates a discussion and returns url (願望 category preferred)', async () => {
    fetchMock.get('https://api.github.com').intercept({ path: '/graphql', method: 'POST' })
      .reply(200, { data: { repository: { id: 'R1', discussionCategories: { nodes: [{ id: 'C1', name: 'Ideas' }, { id: 'C2', name: '願望' }] } } } })
    fetchMock.get('https://api.github.com').intercept({ path: '/graphql', method: 'POST' })
      .reply(200, { data: { createDiscussion: { discussion: { url: 'https://github.com/yazelin/wish-pool/discussions/9' } } } })
    const url = await createWishDiscussion({ GH_PAT: 'x' } as any, wish)
    expect(url).toBe('https://github.com/yazelin/wish-pool/discussions/9')
  })
  it('no GH_PAT -> null, no network', async () => {
    const url = await createWishDiscussion({} as any, wish)
    expect(url).toBeNull()
  })
})

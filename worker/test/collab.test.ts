import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { createWish, getWish, createNeed, listNeeds, resolveNeed } from '../src/lib/d1'

const db = () => env.DB
beforeEach(async () => {
  await db().exec('DELETE FROM needs'); await db().exec('DELETE FROM open_questions')
  await db().exec('DELETE FROM responses'); await db().exec('DELETE FROM wishes')
})

describe('needs', () => {
  it('createWish seeds open_questions into needs (type=info)', async () => {
    const id = await createWish(db(), { title: 'T', status: 'published', open_questions: ['缺什麼?'] }, 1)
    const w = await getWish(db(), id)
    expect(w?.needs.map((n) => [n.type, n.body])).toEqual([['info', '缺什麼?']])
  })
  it('createNeed with valid/invalid type, list, resolve', async () => {
    const id = await createWish(db(), { title: 'T', status: 'published', open_questions: [] }, 1)
    const nid = await createNeed(db(), id, 'skill', '需要會 Rust 的人')
    await createNeed(db(), id, 'garbage', '未指定型別')  // -> info
    const needs = await listNeeds(db(), id)
    expect(needs.map((n) => n.type)).toEqual(['skill', 'info'])
    await resolveNeed(db(), nid)
    expect((await listNeeds(db(), id)).find((n) => n.id === nid)?.resolved).toBe(1)
  })
})

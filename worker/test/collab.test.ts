import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { createWish, getWish, createNeed, listNeeds, resolveNeed, addUpdate, listUpdates } from '../src/lib/d1'

const db = () => env.DB
beforeEach(async () => {
  await db().exec('DELETE FROM needs'); await db().exec('DELETE FROM open_questions')
  await db().exec('DELETE FROM responses'); await db().exec('DELETE FROM updates')
  await db().exec('DELETE FROM wishes')
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

describe('updates (work-log)', () => {
  it('adds updates, coerces kind, lists in order', async () => {
    const id = await createWish(db(), { title: 'T', status: 'building', open_questions: [] }, 1)
    await addUpdate(db(), id, { kind: 'claim', body: '我認領了', github_handle: 'alice' }, 10)
    await addUpdate(db(), id, { kind: 'weird', body: '做到一半' }, 20)  // -> progress
    const list = await listUpdates(db(), id)
    expect(list.map((u) => u.kind)).toEqual(['claim', 'progress'])
    expect(list[0].github_handle).toBe('alice')
  })
})

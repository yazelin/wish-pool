import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import {
  createWish, listWishes, getWish, addVote, addResponse,
  listByStatus, setStatus, exportAll,
} from '../src/lib/d1'

const db = () => env.DB

beforeEach(async () => {
  await db().exec('DELETE FROM votes')
  await db().exec('DELETE FROM responses')
  await db().exec('DELETE FROM open_questions')
  await db().exec('DELETE FROM wishes')
})

const sample = (over = {}) => ({
  title: '自動報價工具', problem: '每次手工查舊檔', current: 'Excel 翻',
  desired: '按一鍵出報價', who: '業務,每天', nickname: '阿澤',
  status: 'published', open_questions: ['依尺寸還是材質?'], ...over,
})

describe('createWish + getWish', () => {
  it('creates wish with open_questions and reads it back', async () => {
    const id = await createWish(db(), sample(), 1000)
    const w = await getWish(db(), id)
    expect(w?.title).toBe('自動報價工具')
    expect(w?.open_questions.map((q) => q.question)).toEqual(['依尺寸還是材質?'])
    expect(w?.responses).toEqual([])
  })
})

describe('listWishes', () => {
  it('hides pending/hidden, shows published', async () => {
    await createWish(db(), sample({ status: 'pending', title: 'P' }), 1)
    await createWish(db(), sample({ status: 'hidden', title: 'H' }), 2)
    await createWish(db(), sample({ status: 'published', title: 'V' }), 3)
    const rows = await listWishes(db(), { sort: 'new', limit: 50, offset: 0 })
    expect(rows.map((r) => r.title)).toEqual(['V'])
  })

  it('sort new = newest first', async () => {
    await createWish(db(), sample({ title: 'old' }), 100)
    await createWish(db(), sample({ title: 'new' }), 200)
    const rows = await listWishes(db(), { sort: 'new', limit: 50, offset: 0 })
    expect(rows.map((r) => r.title)).toEqual(['new', 'old'])
  })
})

describe('addVote', () => {
  it('first vote ok, duplicate fingerprint rejected', async () => {
    const id = await createWish(db(), sample(), 1)
    const a = await addVote(db(), id, 'fp1', 10)
    expect(a).toEqual({ ok: true, votes: 1 })
    const b = await addVote(db(), id, 'fp1', 11)
    expect(b).toEqual({ ok: false, votes: 1 })
    const c = await addVote(db(), id, 'fp2', 12)
    expect(c).toEqual({ ok: true, votes: 2 })
  })
})

describe('addResponse', () => {
  it('adds a response and marks referenced open_question resolved', async () => {
    const id = await createWish(db(), sample(), 1)
    const w = await getWish(db(), id)
    const qid = w!.open_questions[0].id
    await addResponse(db(), id, { body: '看材質', nickname: 'B', kind: 'answer', questionId: qid }, 20)
    const after = await getWish(db(), id)
    expect(after!.responses[0].body).toBe('看材質')
    expect(after!.open_questions[0].resolved).toBe(1)
  })
})

describe('admin', () => {
  it('listByStatus + setStatus', async () => {
    const id = await createWish(db(), sample({ status: 'pending' }), 1)
    expect((await listByStatus(db(), 'pending')).length).toBe(1)
    await setStatus(db(), id, 'published')
    expect((await listByStatus(db(), 'pending')).length).toBe(0)
    expect((await listByStatus(db(), 'published')).length).toBe(1)
  })

  it('exportAll returns wishes with nested data', async () => {
    await createWish(db(), sample({ status: 'pending' }), 1)
    const all = await exportAll(db())
    expect(all.length).toBe(1)
    expect(all[0].open_questions.length).toBe(1)
  })
})

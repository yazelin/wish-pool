import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { createWish, getWish, createNeed, listNeeds, resolveNeed, addUpdate, listUpdates } from '../src/lib/d1'
import { createAnswer, listAnswers, addAnswerVote, setAnswerStatus, acceptAnswer, answerExists } from '../src/lib/d1'

const db = () => env.DB
beforeEach(async () => {
  await db().exec('DELETE FROM needs'); await db().exec('DELETE FROM open_questions')
  await db().exec('DELETE FROM responses'); await db().exec('DELETE FROM updates')
  await db().exec('DELETE FROM answer_votes'); await db().exec('DELETE FROM answers')
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

describe('answers', () => {
  it('multiple answers all visible, sorted by votes', async () => {
    const id = await createWish(db(), { title: 'T', status: 'published', open_questions: [] }, 1)
    const a1 = await createAnswer(db(), id, { repo_url: 'https://github.com/x/a', note: '版本一', github_handle: 'x' }, 1)
    const a2 = await createAnswer(db(), id, { repo_url: 'https://github.com/y/b', note: '版本二' }, 2)
    await addAnswerVote(db(), a2, 'fp1', 3)
    const list = await listAnswers(db(), id)
    expect(list.map((a) => a.id)).toEqual([a2, a1])   // a2 has 1 vote, first
    expect(list.length).toBe(2)                        // both visible
    void a1
  })
  it('answer vote dedups per fingerprint', async () => {
    const id = await createWish(db(), { title: 'T', status: 'published', open_questions: [] }, 1)
    const a = await createAnswer(db(), id, { repo_url: 'https://github.com/x/a' }, 1)
    expect(await addAnswerVote(db(), a, 'fp', 2)).toEqual({ ok: true, votes: 1 })
    expect(await addAnswerVote(db(), a, 'fp', 3)).toEqual({ ok: false, votes: 1 })
  })
  it('hidden answers excluded unless includeHidden; accept sets done + accepted_answer_id', async () => {
    const id = await createWish(db(), { title: 'T', status: 'published', open_questions: [] }, 1)
    const a = await createAnswer(db(), id, { repo_url: 'https://github.com/x/a' }, 1)
    await setAnswerStatus(db(), a, 'hidden')
    expect((await listAnswers(db(), id)).length).toBe(0)
    expect((await listAnswers(db(), id, { includeHidden: true })).length).toBe(1)
    await setAnswerStatus(db(), a, 'visible')
    expect(await answerExists(db(), a)).toBe(true)
    await acceptAnswer(db(), id, a)
    const w = await getWish(db(), id)
    expect(w?.status).toBe('done')
    expect(w?.accepted_answer_id).toBe(a)
  })
})

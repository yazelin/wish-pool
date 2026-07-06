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
    expect(w?.needs.map((n) => n.body)).toEqual(['依尺寸還是材質?'])
    expect(w?.needs[0].type).toBe('info')
    expect(w?.responses).toEqual([])
  })
})

describe('createWish + gaps/difficulty', () => {
  it('createWish stores difficulty and writes gaps into needs', async () => {
    const id = await createWish(env.DB, {
      title: '復刻類許願', status: 'published',
      open_questions: ['要不要排行榜?'],
      difficulty: '大',
      gaps: [
        { type: 'resource', body: '全套美術素材需原創' },
        { type: 'weird', body: '不明型別落為 info' },
        { type: 'skill', body: '' },               // 空 body 跳過
      ],
    }, 1700000000)
    const w = await getWish(env.DB, id)
    expect(w?.difficulty).toBe('大')
    const bodies = w!.needs.map((n) => `${n.type}:${n.body}`)
    expect(bodies).toContain('info:要不要排行榜?')
    expect(bodies).toContain('resource:全套美術素材需原創')
    expect(bodies).toContain('info:不明型別落為 info')
    expect(bodies).toHaveLength(3)
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

  it('echoes = responses count', async () => {
    const id = await createWish(db(), sample({ title: 'E' }), 1)
    await addResponse(db(), id, { body: '我也要', kind: 'metoo' }, 2)
    await addResponse(db(), id, { body: '超需要', kind: 'metoo' }, 3)
    const rows = await listWishes(db(), { sort: 'new', limit: 50, offset: 0 })
    expect(rows.find((r) => r.id === id)?.echoes).toBe(2)
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
    await addResponse(db(), id, { body: '看材質', nickname: 'B', kind: 'answer' }, 20)
    const after = await getWish(db(), id)
    expect(after!.responses[0].body).toBe('看材質')
  })
})

describe('addResponse — 巢狀回覆(issue #7)', () => {
  it('回覆一則頂層留言,parent_id 指向它', async () => {
    const id = await createWish(db(), sample(), 1)
    const root = await addResponse(db(), id, { body: '我也想要', kind: 'metoo' }, 2)
    const reply = await addResponse(db(), id, { body: '+1,而且希望能匯出', kind: 'answer', parentId: root.id }, 3)
    expect(reply.parentId).toBe(root.id)
    const after = await getWish(db(), id)
    const r = after!.responses.find((x) => x.id === reply.id)
    expect(r?.parent_id).toBe(root.id)
  })

  it('回覆一則「回覆」時攤平掛回同一條頂層串(只做一層)', async () => {
    const id = await createWish(db(), sample(), 1)
    const root = await addResponse(db(), id, { body: 'root', kind: 'metoo' }, 2)
    const reply1 = await addResponse(db(), id, { body: 'reply1', kind: 'answer', parentId: root.id }, 3)
    const reply2 = await addResponse(db(), id, { body: 'reply2 回覆 reply1', kind: 'answer', parentId: reply1.id }, 4)
    expect(reply2.parentId).toBe(root.id)   // 沒有變成二層,攤平回頂層
    const after = await getWish(db(), id)
    expect(after!.responses.find((x) => x.id === reply2.id)?.parent_id).toBe(root.id)
  })

  it('回覆缺口的回答(questionId)一樣可以再被回覆', async () => {
    const id = await createWish(db(), sample(), 1)
    const w0 = await getWish(db(), id)
    const needId = w0!.needs[0].id
    const answer = await addResponse(db(), id, { body: '看材質', kind: 'answer', questionId: needId }, 2)
    const followup = await addResponse(db(), id, { body: '那深色的呢?', kind: 'answer', parentId: answer.id }, 3)
    expect(followup.parentId).toBe(answer.id)
    expect(followup.questionId).toBeNull()
  })
})

describe('response solution marker(issue #7)——與 needs.resolved 各自獨立', () => {
  it('setResponseSolution 標記/取消,不影響 needs.resolved', async () => {
    const { setResponseSolution, getResponseWithWish } = await import('../src/lib/d1')
    const id = await createWish(db(), sample(), 1)
    const root = await addResponse(db(), id, { body: '這是回答', kind: 'answer' }, 2)
    let row = await getResponseWithWish(db(), root.id)
    expect(row?.is_solution).toBe(0)
    await setResponseSolution(db(), root.id, true)
    row = await getResponseWithWish(db(), root.id)
    expect(row?.is_solution).toBe(1)
    expect(row?.wish_id).toBe(id)
    await setResponseSolution(db(), root.id, false)
    row = await getResponseWithWish(db(), root.id)
    expect(row?.is_solution).toBe(0)
  })

  it('getResponseWithWish 對不存在的 id 回 null', async () => {
    const { getResponseWithWish } = await import('../src/lib/d1')
    expect(await getResponseWithWish(db(), 999999)).toBeNull()
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
    expect(all[0].needs.length).toBe(1)
  })
})

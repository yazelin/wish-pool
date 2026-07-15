import { describe, it, expect, beforeEach } from 'vitest'
import { SELF, env, fetchMock } from 'cloudflare:test'

const O = 'https://test.local'
const H = { 'Content-Type': 'application/json', Origin: O }

beforeEach(async () => {
  await env.DB.exec('DELETE FROM votes')
  await env.DB.exec('DELETE FROM responses')
  await env.DB.exec('DELETE FROM open_questions')
  await env.DB.exec('DELETE FROM wishes')
  await env.DB.exec('DELETE FROM rate_limits')
  fetchMock.activate()
  fetchMock.disableNetConnect()
})

// Turnstile siteverify 一律成功
function mockTurnstileOk() {
  fetchMock.get('https://challenges.cloudflare.com')
    .intercept({ path: /siteverify/, method: 'POST' }).reply(200, { success: true }).persist()
}

// 女神伺服器端重審(簽章無效時)的 Groq mock;單次攔截器用完即棄(同 refine.route.test 的作法,
// 避免 persist 攔截器在同一 test file 的 MockPool 內跨測試 FIFO 洩漏)
function mockGroqReview(content: string) {
  fetchMock.get('https://groq.test')
    .intercept({ path: '/openai/v1/chat/completions', method: 'POST' })
    .reply(200, { choices: [{ message: { content } }] })
}
function mockGroqDown() {
  fetchMock.get('https://groq.test')
    .intercept({ path: '/openai/v1/chat/completions', method: 'POST' }).reply(500, 'boom')
}

async function seed(status = 'published') {
  const { createWish } = await import('../src/lib/d1')
  return createWish(env.DB, {
    title: 'T', problem: 'p', current: 'c', desired: 'd', who: 'w',
    nickname: 'n', status, open_questions: ['q?'],
  }, 1)
}

describe('POST /api/wishes', () => {
  it('verdict ok WITH a valid signature -> published(且不呼叫重審 LLM)', async () => {
    // 沒註冊 Groq 攔截器且 disableNetConnect:若走了重審,fetch 會炸 -> fallback pending;
    // 所以 published 同時證明「簽章有效直接上牆、沒打 LLM」。
    mockTurnstileOk()
    const { signWish } = await import('../src/lib/sign')
    const wish = { title: '自動報價', problem: 'x', current: 'y', desired: 'z', who: 'w' }
    const sig = await signWish('test-sign-secret', wish, 'ok', Math.floor(Date.now() / 1000) + 3600)
    const res = await SELF.fetch(`${O}/api/wishes`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ turnstileToken: 't', verdict: 'ok', sig, open_questions: ['a?'],
        wish: { ...wish, nickname: 'me' } }),
    })
    expect(res.status).toBe(200)
    const j = await res.json<{ id: number; status: string }>()
    expect(j.status).toBe('published')
  })

  it('回應帶 similar:池裡已有相似公開願望就推薦「可能有人做過」,無關的不推薦(issue #4)', async () => {
    mockTurnstileOk()
    const { createWish } = await import('../src/lib/d1')
    const done = await createWish(env.DB, { title: '自動報價工具', problem: '手工查舊檔', status: 'done', open_questions: [] }, 1)
    await createWish(env.DB, { title: '貓咪照片牆', problem: '想收集貓照', status: 'published', open_questions: [] }, 2)
    const { signWish } = await import('../src/lib/sign')
    const wish = { title: '自動報價系統', problem: '手工報價太慢', current: '', desired: '', who: '' }
    const sig = await signWish('test-sign-secret', wish, 'ok', Math.floor(Date.now() / 1000) + 3600)
    const res = await SELF.fetch(`${O}/api/wishes`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ turnstileToken: 't', verdict: 'ok', sig, wish }),
    })
    expect(res.status).toBe(200)
    const j = await res.json<{ status: string; similar: { id: number; title: string; status: string }[] }>()
    expect(j.status).toBe('published')
    expect(j.similar.map((s) => s.id)).toEqual([done])
    expect(j.similar[0].status).toBe('done')
  })

  it('verdict ok but NO signature (forged) -> 女神重審,判 review -> pending 且帶原因', async () => {
    mockTurnstileOk()
    mockGroqReview('{"verdict":"review","reason":"與想要一個作品無關"}')
    const res = await SELF.fetch(`${O}/api/wishes`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ turnstileToken: 't', verdict: 'ok', wish: { title: '直接偽造 ok' } }),
    })
    const j = await res.json<{ status: string; reason?: string }>()
    expect(j.status).toBe('pending')
    expect(j.reason).toBe('與想要一個作品無關')
  })

  it('verdict ok but content edited after signing (sig mismatch) -> 女神重審,判 review -> pending', async () => {
    mockTurnstileOk()
    mockGroqReview('{"verdict":"review","reason":"內容不當"}')
    const { signWish } = await import('../src/lib/sign')
    const sig = await signWish('test-sign-secret', { title: '原本無害', problem: 'p' }, 'ok', Math.floor(Date.now() / 1000) + 3600)
    const res = await SELF.fetch(`${O}/api/wishes`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ turnstileToken: 't', verdict: 'ok', sig, wish: { title: '改成不當內容', problem: 'p' } }),
    })
    expect((await res.json<{ status: string }>()).status).toBe('pending')
  })

  it('no verdict(純表單)-> 女神重審,判 review -> pending', async () => {
    mockTurnstileOk()
    mockGroqReview('{"verdict":"review","reason":"拿不準"}')
    const res = await SELF.fetch(`${O}/api/wishes`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ turnstileToken: 't', wish: { title: '純表單願望' } }),
    })
    const j = await res.json<{ status: string }>()
    expect(j.status).toBe('pending')
  })

  it('turnstile fail -> 403', async () => {
    // 空 token 讓 verifyTurnstile 直接短路回 false(不打 siteverify)。
    // 避免在同一 test file 的 MockPool 內註冊衝突的 success:false 攔截器
    // (fetchMock 每檔才 reset、persist 攔截器 FIFO 比對,success:true 會先中)。
    const res = await SELF.fetch(`${O}/api/wishes`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ turnstileToken: '', wish: { title: 'x' } }),
    })
    expect(res.status).toBe(403)
  })

  it('missing title -> 400', async () => {
    mockTurnstileOk()
    const res = await SELF.fetch(`${O}/api/wishes`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ turnstileToken: 't', wish: { title: '  ' } }),
    })
    expect(res.status).toBe(400)
  })

  it('difficulty and gaps are stored on submit; tampered difficulty falls to pending', async () => {
    mockTurnstileOk()
    const { signWish } = await import('../src/lib/sign')
    const wish = { title: '大型遊戲願望', problem: 'p', current: 'c', desired: 'd', who: 'w', difficulty: '大' }
    const sig = await signWish('test-sign-secret', wish, 'ok', Math.floor(Date.now() / 1000) + 3600)
    // 正常送出:published,difficulty 與 gaps 都落庫
    const res = await SELF.fetch(`${O}/api/wishes`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ turnstileToken: 't', wish, verdict: 'ok', sig, gaps: [{ type: 'resource', body: '素材需原創' }] }),
    })
    const j = await res.json() as any
    expect(j.status).toBe('published')
    const got = await (await SELF.fetch(`${O}/api/wishes/${j.id}`)).json() as any
    expect(got.difficulty).toBe('大')
    expect(got.needs.some((n: any) => n.type === 'resource' && n.body === '素材需原創')).toBe(true)

    // 竄改 difficulty:驗簽失敗 -> 重審,判 review -> pending
    mockGroqReview('{"verdict":"review","reason":"規模被改過"}')
    const res2 = await SELF.fetch(`${O}/api/wishes`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ turnstileToken: 't', wish: { ...wish, difficulty: '小' }, verdict: 'ok', sig }),
    })
    expect(((await res2.json()) as any).status).toBe('pending')
  })

  it('gaps and open_questions are each capped at 20 items, 500 chars per item', async () => {
    mockTurnstileOk()
    mockGroqReview('{"verdict":"review","reason":"拿不準"}')
    const { getWish } = await import('../src/lib/d1')
    const gaps = Array.from({ length: 25 }, (_, i) => ({ type: 'resource', body: i === 0 ? 'x'.repeat(600) : `g${i}` }))
    const open_questions = Array.from({ length: 25 }, (_, i) => (i === 0 ? 'y'.repeat(600) : `q${i}`))
    const res = await SELF.fetch(`${O}/api/wishes`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ turnstileToken: 't', wish: { title: '大量缺口願望' }, gaps, open_questions }),
    })
    const j = (await res.json()) as any
    // pending 狀態不會過公開狀態白名單,直接查 DB 驗證落庫結果(與 spec/GET 端點的 404 口徑無關)
    const got = (await getWish(env.DB, j.id)) as any
    // open_questions(type info) 與 gaps(type resource) 各自落 needs,各截 20 筆 -> 共 40 筆
    expect(got.needs.length).toBe(40)
    expect(got.needs.filter((n: any) => n.type === 'info').length).toBe(20)
    expect(got.needs.filter((n: any) => n.type === 'resource').length).toBe(20)
    for (const n of got.needs) expect(n.body.length).toBeLessThanOrEqual(500)
    expect(got.needs.find((n: any) => n.type === 'resource').body.length).toBe(500)
    expect(got.needs.find((n: any) => n.type === 'info').body.length).toBe(500)
  })
})

describe('伺服器端重審(送出時簽章無效 -> 女神用同一套守則重審最終版內容)', () => {
  it('欄位改過(sig mismatch)+ 重審判 ok -> 直接 published', async () => {
    mockTurnstileOk()
    mockGroqReview('{"verdict":"ok","reason":"改完仍是原創作品願望"}')
    const { signWish } = await import('../src/lib/sign')
    const sig = await signWish('test-sign-secret', { title: '原本的標題', problem: 'p' }, 'ok', Math.floor(Date.now() / 1000) + 3600)
    const res = await SELF.fetch(`${O}/api/wishes`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ turnstileToken: 't', verdict: 'ok', sig, wish: { title: '使用者補了細節的標題', problem: 'p' } }),
    })
    const j = await res.json<{ status: string; reason?: string }>()
    expect(j.status).toBe('published')
    expect(j.reason).toBeUndefined()
  })

  it('純手填(無 verdict/sig)也走重審,判 ok -> published', async () => {
    mockTurnstileOk()
    mockGroqReview('{"verdict":"ok","reason":"完整的作品願望"}')
    const res = await SELF.fetch(`${O}/api/wishes`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ turnstileToken: 't', wish: { title: '手填的原創工具願望', problem: 'p' } }),
    })
    expect((await res.json<{ status: string }>()).status).toBe('published')
  })

  it('LLM 掛掉(500)-> submit 仍 200,fallback pending 且帶原因', async () => {
    mockTurnstileOk()
    mockGroqDown()
    const res = await SELF.fetch(`${O}/api/wishes`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ turnstileToken: 't', wish: { title: '女神忙碌時的願望' } }),
    })
    expect(res.status).toBe(200)
    const j = await res.json<{ status: string; reason?: string }>()
    expect(j.status).toBe('pending')
    expect(j.reason).toBe('女神一時忙不過來')
  })

  it('LLM 回垃圾(解析失敗)-> 一律當 review -> pending', async () => {
    mockTurnstileOk()
    mockGroqReview('抱歉我壞了,不會 JSON')
    const res = await SELF.fetch(`${O}/api/wishes`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ turnstileToken: 't', wish: { title: '解析失敗的願望' } }),
    })
    expect(res.status).toBe(200)
    const j = await res.json<{ status: string; reason?: string }>()
    expect(j.status).toBe('pending')
  })

  it('重審 ok 的 published 願望走完整上牆流程(公開端點看得到)', async () => {
    mockTurnstileOk()
    mockGroqReview('{"verdict":"ok","reason":"沒問題"}')
    const res = await SELF.fetch(`${O}/api/wishes`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ turnstileToken: 't', wish: { title: '重審上牆的願望' } }),
    })
    const j = await res.json<{ id: number; status: string }>()
    expect(j.status).toBe('published')
    const got = await SELF.fetch(`${O}/api/wishes/${j.id}`)
    expect(got.status).toBe(200)
  })
})

describe('GET /api/wishes', () => {
  it('lists published only', async () => {
    await seed('published'); await seed('pending')
    const res = await SELF.fetch(`${O}/api/wishes?sort=new`)
    const j = await res.json<{ wishes: any[] }>()
    expect(j.wishes.length).toBe(1)
  })
})

describe('GET /api/wishes/:id', () => {
  it('returns wish with nested data, 404 when absent', async () => {
    const id = await seed('published')
    const ok = await SELF.fetch(`${O}/api/wishes/${id}`)
    expect(ok.status).toBe(200)
    expect((await ok.json<any>()).needs.length).toBe(1)
    const no = await SELF.fetch(`${O}/api/wishes/99999`)
    expect(no.status).toBe(404)
  })
})

describe('POST vote + responses', () => {
  it('votes once, dup returns ok:false', async () => {
    mockTurnstileOk()
    const id = await seed('published')
    const a = await SELF.fetch(`${O}/api/wishes/${id}/vote`, { method: 'POST', headers: H, body: JSON.stringify({ turnstileToken: 't' }) })
    expect((await a.json<any>()).votes).toBe(1)
    const b = await SELF.fetch(`${O}/api/wishes/${id}/vote`, { method: 'POST', headers: H, body: JSON.stringify({ turnstileToken: 't' }) })
    expect((await b.json<any>()).ok).toBe(false)
  })

  it('adds a response', async () => {
    mockTurnstileOk()
    const id = await seed('published')
    const res = await SELF.fetch(`${O}/api/wishes/${id}/responses`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ turnstileToken: 't', body: '看材質', kind: 'answer' }),
    })
    expect(res.status).toBe(200)
    const after = await SELF.fetch(`${O}/api/wishes/${id}`).then((r) => r.json<any>())
    expect(after.responses[0].body).toBe('看材質')
  })

  it('vote on nonexistent wish -> 404', async () => {
    mockTurnstileOk()
    const res = await SELF.fetch(`${O}/api/wishes/99999/vote`, {
      method: 'POST', headers: H, body: JSON.stringify({ turnstileToken: 't' }),
    })
    expect(res.status).toBe(404)
  })

  it('respond on nonexistent wish -> 404', async () => {
    mockTurnstileOk()
    const res = await SELF.fetch(`${O}/api/wishes/99999/responses`, {
      method: 'POST', headers: H, body: JSON.stringify({ turnstileToken: 't', body: 'hi', kind: 'metoo' }),
    })
    expect(res.status).toBe(404)
  })

  it('non-numeric id -> 404, not 500', async () => {
    const res = await SELF.fetch(`${O}/api/wishes/abc`)
    expect(res.status).toBe(404)
  })
})

describe('巢狀回覆(issue #7)', () => {
  it('用 parentId 回覆一則留言,回應帶純數字 id;GET 看得到 parent_id', async () => {
    mockTurnstileOk()
    const id = await seed('published')
    const rootRes = await SELF.fetch(`${O}/api/wishes/${id}/responses`, {
      method: 'POST', headers: H, body: JSON.stringify({ turnstileToken: 't', body: '我也想要', kind: 'metoo' }),
    })
    const rootId = (await rootRes.json<{ id: number }>()).id
    expect(typeof rootId).toBe('number')
    const replyRes = await SELF.fetch(`${O}/api/wishes/${id}/responses`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ turnstileToken: 't', body: '同感,而且希望能匯出', kind: 'answer', parentId: rootId }),
    })
    expect(replyRes.status).toBe(200)
    const replyId = (await replyRes.json<{ id: number }>()).id
    expect(typeof replyId).toBe('number')
    const w = await SELF.fetch(`${O}/api/wishes/${id}`).then((r) => r.json<any>())
    const reply = w.responses.find((r: any) => r.id === replyId)
    expect(reply.parent_id).toBe(rootId)
  })

  it('回覆一則回覆,攤平掛回同一條頂層串', async () => {
    mockTurnstileOk()
    const id = await seed('published')
    const post = (body: any) => SELF.fetch(`${O}/api/wishes/${id}/responses`, {
      method: 'POST', headers: H, body: JSON.stringify({ turnstileToken: 't', ...body }),
    }).then((r) => r.json<{ id: number }>())
    const root = await post({ body: 'root', kind: 'metoo' })
    const reply1 = await post({ body: 'reply1', kind: 'answer', parentId: root.id })
    const reply2 = await post({ body: 'reply2', kind: 'answer', parentId: reply1.id })
    const w = await SELF.fetch(`${O}/api/wishes/${id}`).then((r) => r.json<any>())
    expect(w.responses.find((r: any) => r.id === reply2.id).parent_id).toBe(root.id)
  })
})

describe('POST /api/responses/:id/solve(issue #7 — 許願者標記已解答)', () => {
  it('標記後 is_solution 變 1,可再標回 0', async () => {
    mockTurnstileOk()
    const id = await seed('published')
    const { id: rid } = await SELF.fetch(`${O}/api/wishes/${id}/responses`, {
      method: 'POST', headers: H, body: JSON.stringify({ turnstileToken: 't', body: '答案', kind: 'answer' }),
    }).then((r) => r.json<{ id: number }>())
    const solve = await SELF.fetch(`${O}/api/responses/${rid}/solve`, {
      method: 'POST', headers: H, body: JSON.stringify({ turnstileToken: 't' }),
    })
    expect(solve.status).toBe(200)
    let w = await SELF.fetch(`${O}/api/wishes/${id}`).then((r) => r.json<any>())
    expect(w.responses.find((r: any) => r.id === rid).is_solution).toBe(1)

    const unsolve = await SELF.fetch(`${O}/api/responses/${rid}/solve`, {
      method: 'POST', headers: H, body: JSON.stringify({ turnstileToken: 't', value: false }),
    })
    expect(unsolve.status).toBe(200)
    w = await SELF.fetch(`${O}/api/wishes/${id}`).then((r) => r.json<any>())
    expect(w.responses.find((r: any) => r.id === rid).is_solution).toBe(0)
  })

  it('不存在的 response id -> 404', async () => {
    mockTurnstileOk()
    const res = await SELF.fetch(`${O}/api/responses/999999/solve`, {
      method: 'POST', headers: H, body: JSON.stringify({ turnstileToken: 't' }),
    })
    expect(res.status).toBe(404)
  })

  it('願望非公開狀態(pending)時一律 404,不洩漏存在性', async () => {
    mockTurnstileOk()
    const id = await seed('pending')
    const { addResponse } = await import('../src/lib/d1')
    const r = await addResponse(env.DB, id, { body: 'x', kind: 'answer' }, 2)
    const res = await SELF.fetch(`${O}/api/responses/${r.id}/solve`, {
      method: 'POST', headers: H, body: JSON.stringify({ turnstileToken: 't' }),
    })
    expect(res.status).toBe(404)
  })
})

describe('GET /api/wishes/:id/spec', () => {
  it('compiles complete markdown spec (needs+answers to needs+discussion+answers)', async () => {
    const { createWish, createNeed, addResponse, addUpdate, createAnswer } = await import('../src/lib/d1')
    const id = await createWish(env.DB, { title: 'S', problem: 'p', desired: 'd', status: 'published', open_questions: [] }, 1)
    const nid = await createNeed(env.DB, id, 'info', '網頁還是 App?')
    await addResponse(env.DB, id, { body: '網頁', nickname: '發呆', kind: 'answer', questionId: nid }, 2)
    await addResponse(env.DB, id, { body: '希望有深色模式', kind: 'metoo' }, 3)
    await addUpdate(env.DB, id, { kind: 'claim', body: '我來' }, 4)
    await createAnswer(env.DB, id, { repo_url: 'https://github.com/x/a', note: 'v1' }, 5)
    const res = await SELF.fetch(`${O}/api/wishes/${id}/spec`)
    expect(res.status).toBe(200)
    const t = await res.text()
    for (const frag of ['# 願望 #', 'Agent 規格收斂狀態', `need #${nid}`, 'answered', '答 #', '網頁(發呆)', '希望有深色模式', 'claim: 我來', 'https://github.com/x/a']) {
      expect(t).toContain(frag)
    }
  })
  it('404 for pending/hidden wishes', async () => {
    const { createWish } = await import('../src/lib/d1')
    const id = await createWish(env.DB, { title: 'P', status: 'pending', open_questions: [] }, 1)
    expect((await SELF.fetch(`${O}/api/wishes/${id}/spec`)).status).toBe(404)
  })

  it('includes 規模(difficulty) in header when set, omits it when absent', async () => {
    const { createWish } = await import('../src/lib/d1')
    const withDiff = await createWish(env.DB, { title: 'D', status: 'published', open_questions: [], difficulty: '大' }, 1)
    const t1 = await (await SELF.fetch(`${O}/api/wishes/${withDiff}/spec`)).text()
    expect(t1).toContain('規模:大')

    const noDiff = await createWish(env.DB, { title: 'ND', status: 'published', open_questions: [] }, 1)
    const t2 = await (await SELF.fetch(`${O}/api/wishes/${noDiff}/spec`)).text()
    expect(t2).not.toContain('規模:')
  })
})

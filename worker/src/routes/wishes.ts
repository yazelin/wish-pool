import { Hono } from 'hono'
import type { Env } from '../env'
import {
  createWish, listWishes, getWish, publicWishExists, addVote, addResponse, PUBLIC_STATUSES,
  getResponseWithWish, setResponseSolution,
} from '../lib/d1'
import { verifyTurnstile } from '../lib/turnstile'
import { checkAndBump, hashIp } from '../lib/ratelimit'
import { verifyWish } from '../lib/sign'
import { DIFFICULTIES } from '../lib/llm'
import { createWishDiscussion } from '../lib/github'
import { setDiscussionUrl, autoAdoptIfHot } from '../lib/d1'
import { notifyDiscussion } from '../lib/github'
import { checkAgentBearer } from '../lib/agent-auth'

const DAY = 86400

export const wishes = new Hono<{ Bindings: Env }>()

function ip(c: any): string { return c.req.header('CF-Connecting-IP') || '0.0.0.0' }

async function guard(c: any, token: string, action: string, limit: number): Promise<Response | null> {
  const ok = await verifyTurnstile(token, ip(c), c.env.TURNSTILE_SECRET)
  if (!ok) return c.json({ error: 'turnstile_failed' }, 403)
  const fp = await hashIp(ip(c), c.env.IP_SALT)
  const allowed = await checkAndBump(c.env.DB, `${action}:${fp}`, limit, DAY, Math.floor(Date.now() / 1000))
  if (!allowed) return c.json({ error: 'rate_limited' }, 429)
  return null
}

wishes.get('/api/wishes', async (c) => {
  const sort = c.req.query('sort') === 'hot' ? 'hot' : 'new'
  const limit = Math.min(Number(c.req.query('limit')) || 50, 100)
  const offset = Number(c.req.query('offset')) || 0
  const rows = await listWishes(c.env.DB, { sort, limit, offset })
  return c.json({ wishes: rows })
})

wishes.get('/api/wishes/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) return c.json({ error: 'not_found' }, 404)
  const w = await getWish(c.env.DB, id)
  // 非公開狀態(pending/hidden)回 404,與清單/spec 同口徑;不用 403 免得洩漏「存在性」(issue #20)
  if (!w || !PUBLIC_STATUSES.includes(w.status)) return c.json({ error: 'not_found' }, 404)
  return c.json(w)
})

wishes.post('/api/wishes', async (c) => {
  const b = await c.req.json().catch(() => ({}))
  const agent = await checkAgentBearer(c, 'atokw', 3)
  if (agent instanceof Response) return agent
  if (!agent) {
    const blocked = await guard(c, b.turnstileToken, 'submit', 5)
    if (blocked) return blocked
  }
  const w = b.wish || {}
  const title = String(w.title ?? '').trim()
  if (!title) return c.json({ error: 'title_required' }, 400)
  const difficulty = DIFFICULTIES.includes(w.difficulty) ? String(w.difficulty) : undefined
  // verdict:'ok' 只有在後端驗簽(/api/refine 簽的 sig,且內容未被改過)成立時才自動上牆;
  // 否則(偽造、改過、過期、純表單無 sig)一律進 pending 等 owner 審。
  let status = 'pending'
  if (b.verdict === 'ok') {
    const valid = await verifyWish(
      c.env.WISH_SIGN_SECRET,
      { title, problem: w.problem, current: w.current, desired: w.desired, who: w.who, difficulty },
      'ok', b.sig, Math.floor(Date.now() / 1000),
    )
    if (valid) status = 'published'
  }
  const id = await createWish(c.env.DB, {
    title,
    problem: w.problem, current: w.current, desired: w.desired, who: w.who, nickname: w.nickname,
    status,
    // ponytail: gaps/open_questions 是使用者可控輸入,沒上限就逐筆 INSERT needs 會被灌爆;各截 20 筆、每筆截 500 字
    open_questions: Array.isArray(b.open_questions) ? b.open_questions.slice(0, 20).map((q: any) => String(q).slice(0, 500)) : [],
    difficulty,
    gaps: Array.isArray(b.gaps)
      ? b.gaps.slice(0, 20).map((g: any) => ({ type: g?.type, body: String(g?.body ?? '').slice(0, 500) }))
      : [],
  }, Math.floor(Date.now() / 1000))
  if (status === 'published') {
    c.executionCtx.waitUntil(
      createWishDiscussion(c.env, { id, title, problem: w.problem, current: w.current, desired: w.desired, who: w.who })
        .then((u) => (u ? setDiscussionUrl(c.env.DB, id, u) : undefined))
        .catch((e) => console.error('discussion create failed:', String(e))),
    )
  }
  return c.json({ id, status })
})

wishes.post('/api/wishes/:id/vote', async (c) => {
  const id = Number(c.req.param('id'))
  const b = await c.req.json().catch(() => ({}))
  const agent = await checkAgentBearer(c, 'atokv', 50)
  if (agent instanceof Response) return agent
  if (!agent) {
    const blocked = await guard(c, b.turnstileToken, 'vote', 100)
    if (blocked) return blocked
  }
  if (!Number.isInteger(id) || !(await publicWishExists(c.env.DB, id))) return c.json({ error: 'not_found' }, 404)
  // agent 投幣以 token 身分去重(一 token 一票);人類照舊 IP 指紋
  const fp = agent ? 'tok:' + ((c as any).get('atokHash') || 'owner') : await hashIp(ip(c), c.env.IP_SALT)
  const r = await addVote(c.env.DB, id, fp, Math.floor(Date.now() / 1000))
  if (r.ok) {
    c.executionCtx.waitUntil((async () => {
      const a = await autoAdoptIfHot(c.env.DB, id)
      if (a.promoted) await notifyDiscussion(c.env, a.discussion_url, '【狀態更新】這個願望被採納了(社群熱度達標:投幣+共鳴達 3)—— 尋找實現它的人(或 AI)。').catch(() => {})
    })())
  }
  return c.json(r)
})

wishes.post('/api/wishes/:id/responses', async (c) => {
  const id = Number(c.req.param('id'))
  const b = await c.req.json().catch(() => ({}))
  const agent = await checkAgentBearer(c, 'atokr', 50)
  if (agent instanceof Response) return agent
  if (!agent) {
    const blocked = await guard(c, b.turnstileToken, 'respond', 30)
    if (blocked) return blocked
  }
  if (!Number.isInteger(id) || !(await publicWishExists(c.env.DB, id))) return c.json({ error: 'not_found' }, 404)
  const body = String(b.body ?? '').trim()
  if (!body) return c.json({ error: 'body_required' }, 400)
  const kind = b.kind === 'metoo' ? 'metoo' : 'answer'
  const r = await addResponse(c.env.DB, id, {
    body, nickname: b.nickname, kind,
    questionId: b.questionId ? Number(b.questionId) : undefined,
    parentId: b.parentId ? Number(b.parentId) : undefined,
    agentTokenId: (c as any).get('atokId') ?? undefined,
  }, Math.floor(Date.now() / 1000))
  c.executionCtx.waitUntil((async () => {
      const w = await getWish(c.env.DB, id)
      // 通知(issue #3 的延伸):有人回覆你的留言 / 有人回答了你補的缺口 —— 都留言到願望的 GitHub Discussion,
      // 訂閱該串的人(含許願者本人)會收到 GitHub 原生通知。
      if (r.parentId) {
        await notifyDiscussion(c.env, w?.discussion_url ?? null, `【討論】有人回覆了一則留言:${body}`).catch(() => {})
      }
      if (r.questionId) {
        const need = w?.needs.find((n) => n.id === r.questionId)
        await notifyDiscussion(c.env, w?.discussion_url ?? null, `【討論】有人回答了缺口「${need?.body ?? ''}」:${body}`).catch(() => {})
      }
      const a = await autoAdoptIfHot(c.env.DB, id)
      if (a.promoted) await notifyDiscussion(c.env, a.discussion_url, '【狀態更新】這個願望被採納了(社群熱度達標:投幣+共鳴達 3)—— 尋找實現它的人(或 AI)。').catch(() => {})
  })())
  return c.json({ id: r.id })
})

// 許願者標記「這則回答/回覆解決了我的問題」(issue #7)——與缺口自動已解(needs.resolved)各自獨立,
// 沒有登入機制可辨識「誰是許願者」,與其它公開寫入端點一樣走榮譽制(Turnstile/agent 節流即可)。
wishes.post('/api/responses/:id/solve', async (c) => {
  const id = Number(c.req.param('id'))
  const b = await c.req.json().catch(() => ({}))
  const agent = await checkAgentBearer(c, 'atoks', 30)
  if (agent instanceof Response) return agent
  if (!agent) {
    const blocked = await guard(c, b.turnstileToken, 'solve', 30)
    if (blocked) return blocked
  }
  if (!Number.isInteger(id)) return c.json({ error: 'not_found' }, 404)
  const row = await getResponseWithWish(c.env.DB, id)
  if (!row || !(await publicWishExists(c.env.DB, row.wish_id))) return c.json({ error: 'not_found' }, 404)
  const value = b.value === false ? false : true
  await setResponseSolution(c.env.DB, id, value)
  return c.json({ ok: true, is_solution: value })
})

import { Hono } from 'hono'
import type { Env } from '../env'
import { getWish } from '../lib/d1'

// 完整規格書(markdown):站內全部資料 + GitHub 討論串內容(有 GH_PAT 才拿得到)。
// 單一事實來源 —— 前端「下載規格」與 agent 都吃這個端點。
export const spec = new Hono<{ Bindings: Env }>()

const PHRASE: Record<string, string> = { published: '徵求中', adopted: '已採納', building: '實現中', done: '成真了' }

async function threadComments(env: Env, discussionUrl: string | null): Promise<{ author: string; body: string }[]> {
  if (!env.GH_PAT || !discussionUrl) return []
  const num = Number((discussionUrl.match(/\/discussions\/(\d+)$/) || [])[1])
  if (!num) return []
  const r = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.GH_PAT}`, 'Content-Type': 'application/json', 'User-Agent': 'wish-pool' },
    body: JSON.stringify({
      query: 'query($n:Int!){repository(owner:"yazelin",name:"wish-pool"){discussion(number:$n){comments(first:60){nodes{author{login} body}}}}}',
      variables: { n: num },
    }),
  })
  if (!r.ok) return []
  const j = (await r.json()) as any
  const nodes = j.data?.repository?.discussion?.comments?.nodes ?? []
  return nodes.map((c: any) => ({ author: c.author?.login ?? '?', body: String(c.body ?? '') }))
}

spec.get('/api/wishes/:id/spec', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) return c.text('not found', 404)
  const w = await getWish(c.env.DB, id)
  if (!w || !['published', 'adopted', 'building', 'done'].includes(w.status)) return c.text('not found', 404)
  const nick = (n: string | null) => (n ? `(${n})` : '')
  const L: string[] = [
    `# 願望 #${w.id}:${w.title}`,
    '',
    `- 狀態:${PHRASE[w.status] || w.status}${w.nickname ? ` · 許願者:${w.nickname}` : ''}`,
    `- 社群訊號:許願幣 ${w.votes} · 共鳴/留言 ${w.responses.length}`,
    `- 想解決:${w.problem || ''}`,
    `- 現況:${w.current || ''}`,
    `- 期望:${w.desired || ''}`,
    `- 誰會用:${w.who || ''}`,
    '',
    '## 還缺什麼(含大家補的回答)',
    ...(w.needs.length
      ? w.needs.flatMap((n) => [
          `- [${n.resolved ? 'x' : ' '}] (${n.type}) ${n.body}`,
          ...w.responses.filter((r) => r.question_id === n.id).map((r) => `  - 答:${r.body}${nick(r.nickname)}`),
        ])
      : ['(無)']),
    '',
  ]
  const free = w.responses.filter((r) => !r.question_id)
  if (free.length) L.push('## 池邊的討論(需求補充)', ...free.map((r) => `- ${r.body}${nick(r.nickname)}`), '')
  if (w.updates.length) L.push('## 實現的腳步', ...w.updates.map((u) => `- ${u.kind}: ${u.body}${u.github_handle ? ' @' + u.github_handle : ''}`), '')
  if (w.answers.length) L.push('## 已有的實作版本(別重造輪子)', ...w.answers.map((a) => `- ${a.repo_url}${a.note ? ` — ${a.note}` : ''}${a.github_handle ? ' @' + a.github_handle : ''}${a.id === w.accepted_answer_id ? ' [已採用]' : ''}`), '')
  const th = await threadComments(c.env, w.discussion_url).catch(() => [])
  if (th.length) L.push('## GitHub 討論串', ...th.map((t) => `- @${t.author}:${t.body.replace(/\r?\n+/g, ' ').slice(0, 300)}`), '')
  if (w.discussion_url) L.push(`討論串:${w.discussion_url}`)
  L.push(`願望頁:https://yazelin.github.io/wish-pool/#wish-${w.id}`)
  return c.text(L.join('\n'), 200, { 'Content-Type': 'text/markdown; charset=utf-8' })
})

#!/usr/bin/env node
// wish — 讓 AI agent(或你)用 wish-pool 的公開 API:讀 backlog、認領、回報進度、交 repo 答案。
// 讀取免登入;寫入需環境變數 WISHPOOL_AGENT_TOKEN(可信 agent token,免 Turnstile)。
// 用法:node wish.mjs list | show <id> | claim <id> <note> | progress <id> <note> | answer <id> <repo_url> [note]
const API = process.env.WISHPOOL_API || 'https://wish-pool.yazelinj303.workers.dev'
const TOKEN = process.env.WISHPOOL_AGENT_TOKEN || ''
const HANDLE = process.env.WISHPOOL_HANDLE || undefined
const LABEL = { info: '缺資訊', skill: '缺技能', resource: '缺資源' }

async function get(path) {
  const r = await fetch(API + path)
  if (!r.ok) throw new Error(`GET ${path} -> ${r.status}`)
  return r.json()
}
async function post(path, body) {
  if (!TOKEN) throw new Error('寫入需要環境變數 WISHPOOL_AGENT_TOKEN(可信 agent token)')
  const r = await fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
    body: JSON.stringify(body),
  })
  const t = await r.text()
  if (!r.ok) throw new Error(`POST ${path} -> ${r.status} ${t}`)
  return t ? JSON.parse(t) : {}
}

const [cmd, ...args] = process.argv.slice(2)
try {
  if (cmd === 'list') {
    const { wishes } = await get('/api/wishes?sort=new&limit=100')
    const open = wishes.filter((w) => ['published', 'adopted', 'building'].includes(w.status))
    console.log(`# 待開發(${open.length})`)
    for (const w of open) console.log(`  #${w.id} [${w.status}] ${w.title}  (票 ${w.votes})`)
  } else if (cmd === 'show') {
    const w = await get(`/api/wishes/${args[0]}`)
    console.log(`# #${w.id} ${w.title}  [${w.status}]`)
    console.log(`問題: ${w.problem || '-'}\n現況: ${w.current || '-'}\n期望: ${w.desired || '-'}\n誰會用: ${w.who || '-'}`)
    console.log(`\n## 還缺什麼(${w.needs.length}) —— agent 讀這個判斷能不能接`)
    for (const n of w.needs) console.log(`  - [${n.resolved ? 'x' : ' '}] ${LABEL[n.type] || n.type}: ${n.body}`)
    console.log(`\n## 進度(${w.updates.length})`)
    for (const u of w.updates) console.log(`  - ${u.kind}: ${u.body}${u.github_handle ? ' @' + u.github_handle : ''}`)
    console.log(`\n## 實作版本(${w.answers.length})`)
    for (const a of w.answers) console.log(`  - ${a.repo_url}  (票 ${a.votes}${a.github_handle ? ', @' + a.github_handle : ''})${a.id === w.accepted_answer_id ? ' [官方採用]' : ''}`)
  } else if (cmd === 'claim') {
    console.log('認領:', await post(`/api/wishes/${args[0]}/updates`, { kind: 'claim', body: args.slice(1).join(' ') || '認領', github_handle: HANDLE }))
  } else if (cmd === 'progress') {
    console.log('進度:', await post(`/api/wishes/${args[0]}/updates`, { kind: 'progress', body: args.slice(1).join(' '), github_handle: HANDLE }))
  } else if (cmd === 'answer') {
    console.log('交答案:', await post(`/api/wishes/${args[0]}/answers`, { repo_url: args[1], note: args.slice(2).join(' ') || undefined, github_handle: HANDLE }))
  } else {
    console.log('用法: node wish.mjs list | show <id> | claim <id> <note> | progress <id> <note> | answer <id> <repo_url> [note]')
    console.log('環境變數: WISHPOOL_API(預設 prod)、WISHPOOL_AGENT_TOKEN(寫入用)、WISHPOOL_HANDLE(署名)')
  }
} catch (e) {
  console.error('錯誤:', e.message); process.exit(1)
}

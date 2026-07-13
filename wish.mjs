#!/usr/bin/env node
// wish — 讓 AI agent(或你)用 wish-pool 的公開 API:讀 backlog、逐步補規格、認領、回報進度、交 repo 答案。
// 讀取免登入;寫入需環境變數 WISHPOOL_AGENT_TOKEN(可信 agent token,免 Turnstile)。
// 用法:node wish.mjs list | show <id> | spec <id> | refine-status <id> [--json] | refine-round <id> <json-file|-> | claim <id> <note> | progress <id> <note> | answer <id> <repo_url> [note]
const API = process.env.WISHPOOL_API || 'https://wish-pool.yazelinj303.workers.dev'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
function loadToken() {
  if (process.env.WISHPOOL_AGENT_TOKEN) return process.env.WISHPOOL_AGENT_TOKEN
  try { return readFileSync(homedir() + '/.config/wishpool/token', 'utf8').trim() } catch (e) { return '' }
}
const TOKEN = loadToken()
const HANDLE = process.env.WISHPOOL_HANDLE || undefined
const LABEL = { info: '缺資訊', skill: '缺技能', resource: '缺資源' }

async function get(path) {
  const r = await fetch(API + path)
  const t = await r.text()
  if (!r.ok) throw new Error(`GET ${path} -> ${r.status}${t ? ' ' + t : ''}`)
  try { return t ? JSON.parse(t) : {} } catch (e) { throw new Error(`GET ${path} -> ${r.status} invalid JSON: ${t}`) }
}
async function post(path, body) {
  if (!TOKEN) throw new Error('寫入需要環境變數 WISHPOOL_AGENT_TOKEN —— 到 https://yazelin.github.io/wish-pool/collab.html 「自助領取 Agent Token」按一下即得')
  const r = await fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
    body: JSON.stringify(body),
  })
  const t = await r.text()
  if (!r.ok) throw new Error(`POST ${path} -> ${r.status} ${t}`)
  return t ? JSON.parse(t) : {}
}
async function postRaw(path, body) {
  if (!TOKEN) throw new Error('寫入需要環境變數 WISHPOOL_AGENT_TOKEN —— 到 https://yazelin.github.io/wish-pool/collab.html 「自助領取 Agent Token」按一下即得')
  const r = await fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
    body,
  })
  const t = await r.text()
  if (!r.ok) throw new Error(`POST ${path} -> ${r.status}${t ? ' ' + t : ''}`)
  try { return t ? JSON.parse(t) : {} } catch (e) { throw new Error(`POST ${path} -> ${r.status} invalid JSON: ${t}`) }
}

function readRoundBody(source) {
  if (!source) throw new Error('refine-round 需要 <json-file|->；用 - 從 STDIN 讀取')
  let raw
  try { raw = readFileSync(source === '-' ? 0 : source, 'utf8') } catch (e) { throw new Error(`無法讀取 ${source}: ${e.message}`) }
  let body
  try { body = JSON.parse(raw) } catch (e) { throw new Error(`round body 不是有效 JSON: ${e.message}`) }
  if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error('round body 必須是 JSON object')
  if (typeof body.idempotency_key !== 'string' || !body.idempotency_key.trim()) throw new Error('round body 必須包含非空 idempotency_key')
  if (body.idempotency_key.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(body.idempotency_key)) throw new Error('idempotency_key 最長 128 字元且只可使用英數與 ._:-')
  if (!Number.isInteger(body.base_version) || body.base_version < 0) throw new Error('round body 必須包含非負整數 base_version')
  return raw
}

function usage() {
  console.log('用法: node wish.mjs list | show <id> | spec <id> | refine-status <id> [--json] | refine-round <id> <json-file|-> | claim <id> <note> | progress <id> <note> | answer <id> <repo_url> [note]')
  console.log('環境變數: WISHPOOL_API(預設 prod)、WISHPOOL_AGENT_TOKEN(寫入用)、WISHPOOL_HANDLE(署名)')
}

function redact(value) {
  return TOKEN ? String(value).replaceAll(TOKEN, '[REDACTED]') : String(value)
}

function printJson(value) {
  console.log(redact(JSON.stringify(value, null, 2)))
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
    for (const n of w.needs) {
      const state = n.state || (n.resolved ? 'resolved' : 'open')
      const mark = ['resolved', 'superseded'].includes(state) ? 'x' : (['answered', 'assumed'].includes(state) ? '~' : ' ')
      console.log(`  - [${mark}] need #${n.id} ${LABEL[n.type] || n.type} (${state}): ${n.body}`)
    }
    console.log(`\n## 進度(${w.updates.length})`)
    for (const u of w.updates) console.log(`  - ${u.kind}: ${u.body}${u.github_handle ? ' @' + u.github_handle : ''}`)
    console.log(`\n## 實作版本(${w.answers.length})`)
    for (const a of w.answers) console.log(`  - ${a.repo_url}  (票 ${a.votes}${a.github_handle ? ', @' + a.github_handle : ''})${a.id === w.accepted_answer_id ? ' [官方採用]' : ''}`)
  } else if (cmd === 'spec') {
    const r = await fetch(`${API}/api/wishes/${args[0]}/spec`)
    const t = await r.text()
    if (!r.ok) throw new Error(`GET /api/wishes/${args[0]}/spec -> ${r.status}${t ? ' ' + t : ''}`)
    console.log(t)
  } else if (cmd === 'refine-status') {
    if (!args[0] || args.length > 2 || (args[1] && args[1] !== '--json')) throw new Error('用法: node wish.mjs refine-status <id> [--json]')
    const state = await get(`/api/wishes/${args[0]}/refinement`)
    printJson(state)
  } else if (cmd === 'refine-round') {
    if (!args[0] || !args[1] || args.length !== 2) throw new Error('用法: node wish.mjs refine-round <id> <json-file|->')
    const result = await postRaw(`/api/wishes/${args[0]}/refinement/rounds`, readRoundBody(args[1]))
    printJson(result)
  } else if (cmd === 'claim') {
    console.log('認領:', await post(`/api/wishes/${args[0]}/updates`, { kind: 'claim', body: args.slice(1).join(' ') || '認領', github_handle: HANDLE }))
  } else if (cmd === 'progress') {
    console.log('進度:', await post(`/api/wishes/${args[0]}/updates`, { kind: 'progress', body: args.slice(1).join(' '), github_handle: HANDLE }))
  } else if (cmd === 'answer') {
    console.log('交答案:', await post(`/api/wishes/${args[0]}/answers`, { repo_url: args[1], note: args.slice(2).join(' ') || undefined, github_handle: HANDLE }))
  } else {
    usage()
  }
} catch (e) {
  console.error('錯誤:', redact(e.message)); process.exit(1)
}

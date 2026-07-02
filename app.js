// 願望池 — 池面(前台)。世界觀:夜色水面,願望是漂在水上的燈;投票=投許願幣;成真=升上星帶。
// canvas 只畫水面(微光/漣漪/硬幣),願望燈全是 DOM(textContent 渲染,XSS 安全沿用)。
const CFG = window.WISHPOOL_CONFIG
const API = CFG.WORKER_BASE
const $ = (s, r = document) => r.querySelector(s)
const el = (t, cls, txt) => { const e = document.createElement(t); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e }

let currentSort = 'hot'
let wishCache = []          // 池面列表快取(星帶/燈共用)
let openSheetId = null      // 目前打開的願望 id

const PHRASE = { published: '池中漂著', adopted: '有人心動了', building: '實現中', done: '成真了' }

async function api(path, opts) {
  const res = await fetch(API + path, opts)
  if (!res.ok) throw Object.assign(new Error('api'), { status: res.status, body: await res.text().catch(() => '') })
  return res.json()
}

// 一次性拿 Turnstile token(隱形 widget 類型在 Cloudflare 後台設,不是 size 參數)
function getTurnstileToken() {
  return new Promise((resolve, reject) => {
    if (!window.turnstile) return reject(new Error('turnstile not loaded'))
    const holder = el('div')
    holder.style.display = 'none'
    document.body.appendChild(holder)
    const cleanup = (id) => { try { window.turnstile.remove(id) } catch (e) { /* ignore */ } holder.remove() }
    const id = window.turnstile.render(holder, {
      sitekey: CFG.TURNSTILE_SITE_KEY,
      callback: (t) => { resolve(t); cleanup(id) },
      'error-callback': () => { reject(new Error('turnstile error')); cleanup(id) },
    })
    window.turnstile.execute?.(holder)
  })
}

/* ============ 水面(canvas):微光粒 + 漣漪環 + 許願幣 ============ */
const pond = (() => {
  const cv = $('#pond'); if (!cv) return { ripple() {}, coin() {} }
  const ctx = cv.getContext('2d')
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
  let W = 0, H = 0, dpr = 1
  const motes = [], ripples = [], coins = []
  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 2)
    W = innerWidth; H = innerHeight
    cv.width = W * dpr; cv.height = H * dpr
    cv.style.width = W + 'px'; cv.style.height = H + 'px'
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }
  resize(); addEventListener('resize', resize)
  for (let i = 0; i < 26; i++) motes.push({ x: Math.random() * 1000 % 1, y: Math.random(), r: .6 + Math.random() * 1.6, s: .00016 + Math.random() * .0004, p: Math.random() * 6.28 })
  function ripple(x, y, big) {
    if (ripples.length > 14) ripples.shift()
    ripples.push({ x, y, r: 2, max: big ? 130 : 70, a: big ? .5 : .32 })
  }
  function coin(x, y, done) {
    coins.push({ x, y0: Math.max(40, y - 180), y, t: 0, done })
  }
  function frame() {
    ctx.clearRect(0, 0, W, H)
    // 微光粒(水面螢光)
    for (const m of motes) {
      m.p += .008
      const x = m.x * W, y = (m.y * H + Math.sin(m.p) * 6) % H
      m.x = (m.x + m.s) % 1
      const tw = .25 + Math.sin(m.p * 1.7) * .18
      ctx.beginPath(); ctx.arc(x, y, m.r, 0, 6.28)
      ctx.fillStyle = `rgba(244,205,120,${tw})`; ctx.fill()
    }
    // 漣漪
    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i]
      r.r += (r.max - r.r) * .045; r.a *= .965
      if (r.a < .01) { ripples.splice(i, 1); continue }
      ctx.beginPath(); ctx.ellipse(r.x, r.y, r.r, r.r * .38, 0, 0, 6.28)
      ctx.strokeStyle = `rgba(255,216,138,${r.a})`; ctx.lineWidth = 1.4; ctx.stroke()
    }
    // 許願幣(拋物落水)
    for (let i = coins.length - 1; i >= 0; i--) {
      const c = coins[i]; c.t += .034
      if (c.t >= 1) { coins.splice(i, 1); ripple(c.x, c.y, true); c.done && c.done(); continue }
      const y = c.y0 + (c.y - c.y0) * (c.t * c.t)           // 重力感
      const sq = .35 + .65 * Math.abs(Math.sin(c.t * 9))     // 旋轉扁縮
      ctx.save(); ctx.translate(c.x, y); ctx.scale(1, sq)
      ctx.beginPath(); ctx.arc(0, 0, 7, 0, 6.28)
      ctx.fillStyle = '#f4b53a'; ctx.fill()
      ctx.strokeStyle = 'rgba(255,236,180,.9)'; ctx.lineWidth = 1.6; ctx.stroke()
      ctx.restore()
    }
    if (!document.hidden) requestAnimationFrame(frame)
    else setTimeout(frame, 400)
  }
  if (!reduced) requestAnimationFrame(frame)
  // 點水面本身也起漣漪(純氛圍)
  addEventListener('pointerdown', (e) => { if (e.target === document.body || e.target === cv) ripple(e.clientX, e.clientY) })
  return { ripple, coin: reduced ? (x, y, done) => { done && done() } : coin }
})()

/* ============ 池面渲染:星帶(成真)+ 願望燈 ============ */
function wishSentence(w) {
  // desired 可能是「功能1;功能2」清單或一句話
  const d = (w.desired || '').trim()
  if (!d) return null
  return d.includes(';') || d.includes(';') ? d.split(/[;;]/).map((s) => s.trim()).filter(Boolean) : d
}

function renderStar(w) {
  const s = el('button', 'star')
  s.setAttribute('aria-label', `成真的願望:${w.title}`)
  s.appendChild(el('span', 'star-dot'))
  s.appendChild(el('span', 'star-title', w.title))
  s.onclick = () => openSheet(w.id)
  return s
}

function renderLantern(w) {
  const card = el('article', 'lantern')
  card.id = 'wish-' + w.id
  card.tabIndex = 0
  card.setAttribute('role', 'button')
  card.setAttribute('aria-label', `打開願望:${w.title}`)
  if (w.status !== 'published') card.appendChild(el('span', 'phrase ' + w.status, PHRASE[w.status] || ''))
  card.appendChild(el('h3', null, w.title))
  const foot = el('div', 'lantern-foot')
  foot.appendChild(el('span', 'coins', `已有 ${w.votes} 枚許願幣`))
  if (w.nickname) foot.appendChild(el('span', 'wisher', `${w.nickname} 的願望`))
  card.appendChild(foot)
  const open = () => openSheet(w.id)
  card.onclick = open
  card.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() } }
  return card
}

async function loadPond() {
  const lan = $('#lanterns'), band = $('#starband'), note = $('#empty')
  try {
    const { wishes } = await api(`/api/wishes?sort=${currentSort}&limit=100`)
    wishCache = wishes
    const done = wishes.filter((w) => w.status === 'done')
    const floating = wishes.filter((w) => w.status !== 'done')
    band.innerHTML = ''; lan.innerHTML = ''
    $('#starband-wrap').style.display = done.length ? '' : 'none'
    done.forEach((w) => band.appendChild(renderStar(w)))
    floating.forEach((w) => lan.appendChild(renderLantern(w)))
    note.textContent = '池面還很安靜 —— 投下第一個願望吧。'
    note.style.display = floating.length ? 'none' : 'block'
  } catch (e) {
    note.textContent = '池水暫時看不清,請稍後再試。'
    note.style.display = 'block'
  }
}

/* ============ 願望燈打開:bottom-sheet(情感層 + 「我來幫忙實現」折疊層) ============ */
const sheetBg = $('#sheet-bg'), sheet = $('#sheet')
function closeSheet() { sheetBg.classList.remove('open'); sheet.innerHTML = ''; openSheetId = null; document.body.style.overflow = '' }
sheetBg.addEventListener('click', (e) => { if (e.target === sheetBg) closeSheet() })
addEventListener('keydown', (e) => { if (e.key === 'Escape' && openSheetId != null) closeSheet() })

async function openSheet(id) {
  let w
  try { w = await api(`/api/wishes/${id}`) } catch (e) { alert('這盞燈暫時打不開,請稍後再試'); return }
  openSheetId = id
  document.body.style.overflow = 'hidden'
  sheet.innerHTML = ''
  sheetBg.classList.add('open')

  const head = el('div', 'sheet-head')
  head.appendChild(el('span', 'phrase ' + w.status, PHRASE[w.status] || ''))
  const x = el('button', 'sheet-close', '關')
  x.setAttribute('aria-label', '關上這盞燈')
  x.onclick = closeSheet
  head.appendChild(x)
  sheet.appendChild(head)

  sheet.appendChild(el('h2', 'sheet-title', w.title))
  if (w.nickname) sheet.appendChild(el('p', 'wisher', `—— ${w.nickname} 許的願`))

  // 成真:慶祝區(repo 領軍)
  if (w.status === 'done') {
    const cele = el('div', 'celebrate')
    cele.appendChild(el('p', 'celebrate-line', '這個願望成真了'))
    const acc = (w.answers || []).find((a) => a.id === w.accepted_answer_id) || (w.answers || [])[0]
    if (acc) {
      const link = el('a', 'celebrate-repo')
      link.href = acc.repo_url; link.textContent = acc.repo_url
      link.target = '_blank'; link.rel = 'noopener nofollow'
      cele.appendChild(link)
      if (acc.github_handle) cele.appendChild(el('p', 'wisher', `由 @${acc.github_handle} 實現`))
    }
    sheet.appendChild(cele)
  }

  // 盼望(desired:句子或功能清單)
  const dsr = wishSentence(w)
  if (dsr) {
    sheet.appendChild(el('p', 'sheet-label', '希望它能'))
    if (Array.isArray(dsr)) { const ul = el('ul', 'hope-list'); dsr.forEach((li) => ul.appendChild(el('li', null, li))); sheet.appendChild(ul) }
    else sheet.appendChild(el('p', 'hope', dsr))
  }

  // 投幣 + 共鳴
  const act = el('div', 'sheet-actions')
  const coinBtn = el('button', 'coin-btn')
  coinBtn.setAttribute('aria-label', '為這個願望投一枚許願幣')
  coinBtn.append('投一枚許願幣 ', el('span', 'coin-count', String(w.votes)))
  coinBtn.onclick = () => tossCoinFor(w.id, coinBtn)
  act.appendChild(coinBtn)
  const echoBtn = el('button', null, '共鳴:我也想要')
  echoBtn.onclick = () => sendEcho(w.id)
  act.appendChild(echoBtn)
  sheet.appendChild(act)

  // 共鳴聲(responses)
  if (w.responses.length) {
    sheet.appendChild(el('p', 'sheet-label', `池邊的共鳴(${w.responses.length})`))
    w.responses.forEach((r) => {
      const rr = el('div', 'echo')
      rr.appendChild(el('div', null, r.body))
      rr.appendChild(el('div', 'wisher', r.nickname ? `—— ${r.nickname}` : '—— 有人輕聲說'))
      sheet.appendChild(rr)
    })
  }

  // 「我來幫忙實現」折疊層(tracker 面只住在這裡)
  const helper = document.createElement('details')
  helper.className = 'helper'
  const sum = document.createElement('summary')
  sum.textContent = '我來幫忙實現(給協力者與 AI)'
  helper.appendChild(sum)
  const hv = el('div', 'helper-body')

  hv.appendChild(el('p', 'sheet-label', '完整規格'))
  const kv = el('dl', 'kv')
  const add = (k, v) => { if (v) { kv.appendChild(el('dt', null, k)); kv.appendChild(el('dd', null, v)) } }
  add('想解決', w.problem); add('現況', w.current); add('期望', w.desired); add('誰會用', w.who)
  hv.appendChild(kv)

  hv.appendChild(el('p', 'sheet-label', `還缺什麼(${w.needs.length})`))
  if (w.needs.length) w.needs.forEach((n) => {
    const label = { info: '缺資訊', skill: '缺技能', resource: '缺資源' }[n.type] || '缺資訊'
    hv.appendChild(el('div', 'need' + (n.resolved ? ' resolved' : ''), `[${label}] ${n.body}`))
  })
  else hv.appendChild(el('p', 'muted', '目前沒有列出缺口'))

  hv.appendChild(el('p', 'sheet-label', `實現的腳步(${w.updates.length})`))
  if (w.updates.length) w.updates.forEach((u) => {
    const kind = { claim: '我來實現', progress: '進度', blocked: '卡關' }[u.kind] || '進度'
    const line = el('div', 'update')
    line.appendChild(el('span', 'update-kind ' + u.kind, kind))
    line.appendChild(el('span', null, ' ' + u.body))
    if (u.github_handle) line.appendChild(el('span', 'wisher', '  @' + u.github_handle))
    hv.appendChild(line)
  })
  else hv.appendChild(el('p', 'muted', '還沒有人動手,等一位有緣人'))

  hv.appendChild(el('p', 'sheet-label', `實作版本(${w.answers.length})`))
  w.answers.forEach((a, i) => {
    const ans = el('div', 'answer')
    const top = el('div', 'answer-top')
    const link = el('a', 'repo-link'); link.href = a.repo_url; link.textContent = a.repo_url
    link.target = '_blank'; link.rel = 'noopener nofollow'
    top.appendChild(link)
    if (a.id === w.accepted_answer_id) top.appendChild(el('span', 'phrase done', '被採用'))
    else if (i === 0 && a.votes > 0) top.appendChild(el('span', 'phrase adopted', '目前最高票'))
    ans.appendChild(top)
    if (a.note) ans.appendChild(el('div', null, a.note))
    const foot = el('div', 'answer-foot')
    const vb = el('button', 'vote'); vb.setAttribute('aria-label', '為這個實作版本投一枚幣')
    vb.append('投幣 ', el('span', null, String(a.votes)))
    vb.onclick = () => voteAnswer(a.id, vb)
    foot.appendChild(vb)
    if (a.github_handle) foot.appendChild(el('span', 'wisher', '@' + a.github_handle))
    ans.appendChild(foot)
    hv.appendChild(ans)
  })

  const tools = el('div', 'helper-tools')
  const claim = el('button', null, '我來實現'); claim.onclick = () => submitUpdate(w.id, true)
  const prog = el('button', null, '回報進度'); prog.onclick = () => submitUpdate(w.id, false)
  const ansB = el('button', 'primary', '交出我的實作'); ansB.onclick = () => submitAnswer(w.id)
  const needB = el('button', null, '補一個缺口'); needB.onclick = () => submitNeed(w.id)
  const dl = el('button', null, '下載規格'); dl.onclick = () => downloadSpec(w)
  ;[claim, prog, ansB, needB, dl].forEach((b) => tools.appendChild(b))
  const shop = el('a', 'repo-link', '前往工坊(所有願望的協作視圖)'); shop.href = 'board.html'
  hv.appendChild(tools); hv.appendChild(shop)
  helper.appendChild(hv)
  sheet.appendChild(helper)
}

async function refreshSheet() { if (openSheetId != null) { const id = openSheetId; await openSheet(id) } }

/* ============ 動作(全部沿用既有 API;成功後刷新 sheet) ============ */
async function tossCoinFor(id, btn) {
  btn.disabled = true
  const r = btn.getBoundingClientRect()
  pond.coin(r.left + r.width / 2, Math.min(innerHeight - 60, r.top - 8), () => {})
  try {
    const token = await getTurnstileToken()
    const res = await api(`/api/wishes/${id}/vote`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ turnstileToken: token }),
    })
    btn.querySelector('.coin-count').textContent = res.votes
    if (res.ok) btn.disabled = false
    const cached = wishCache.find((x) => x.id === id); if (cached) cached.votes = res.votes
    if (!res.ok) btn.title = '你已經投過這個願望了'
  } catch (e) { btn.disabled = false; alert('投幣沒成功,請稍後再試') }
}

async function sendEcho(wishId) {
  const body = prompt('想對這個願望說什麼?(例:我也想要,而且希望能…)')
  if (!body || !body.trim()) return
  const nickname = prompt('留個名字嗎?(可留空)') || undefined
  try {
    const token = await getTurnstileToken()
    await api(`/api/wishes/${wishId}/responses`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ turnstileToken: token, body: body.trim(), nickname, kind: 'metoo' }),
    })
    await refreshSheet()
  } catch (e) { alert('送出失敗,請稍後再試') }
}

async function postWithTurnstile(path, payload, okMsg) {
  try {
    const token = await getTurnstileToken()
    await api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, turnstileToken: token }) })
    alert(okMsg)
    await refreshSheet()
  } catch (e) { alert(e.status === 429 ? '今天次數已達上限,明天再來' : '送出失敗,請稍後再試') }
}
async function submitAnswer(wishId) {
  const repo = prompt('你的 repo 網址(https://github.com/...):')
  if (!repo || !/^https?:\/\//.test(repo.trim())) { if (repo !== null) alert('請貼有效的 http(s) 網址'); return }
  const note = prompt('一句話說明這個版本(可留空):') || undefined
  const handle = prompt('你的 GitHub 帳號(選填,未驗證):') || undefined
  await postWithTurnstile(`/api/wishes/${wishId}/answers`, { repo_url: repo.trim(), note, github_handle: handle }, '收到你的實作,謝謝你讓願望往前一步')
}
async function voteAnswer(answerId, btn) {
  try {
    const token = await getTurnstileToken()
    const r = await api(`/api/answers/${answerId}/vote`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ turnstileToken: token }) })
    btn.querySelector('span').textContent = r.votes
    if (!r.ok) btn.disabled = true
  } catch (e) { alert('投幣沒成功,請稍後再試') }
}
async function submitUpdate(wishId, isClaim) {
  const kind = isClaim ? 'claim' : (prompt('這是進度還是卡關?輸入 1=進度 2=卡關', '1') === '2' ? 'blocked' : 'progress')
  const body = prompt(isClaim ? '跟大家說一聲你要實現它(例:我來做,預計先做核心功能)' : '進度說明(例:做到 X / 卡在 Y):')
  if (!body || !body.trim()) return
  const handle = prompt('你的 GitHub 帳號(選填):') || undefined
  await postWithTurnstile(`/api/wishes/${wishId}/updates`, { kind, body: body.trim(), github_handle: handle }, isClaim ? '已記下 —— 這個願望有了實現它的人' : '進度已記下,謝謝')
}
async function submitNeed(wishId) {
  const typeLabel = prompt('缺什麼類型:1=資訊 2=技能 3=資源', '1')
  const type = { '1': 'info', '2': 'skill', '3': 'resource' }[String(typeLabel).trim()] || 'info'
  const body = prompt('這個願望還缺什麼?')
  if (!body || !body.trim()) return
  await postWithTurnstile(`/api/wishes/${wishId}/needs`, { type, body: body.trim() }, '缺口已補上,謝謝')
}
function downloadSpec(w) {
  const lines = [
    `# ${w.title}`, '',
    `- 想解決:${w.problem || ''}`, `- 現況:${w.current || ''}`, `- 期望:${w.desired || ''}`, `- 誰會用:${w.who || ''}`, '',
    '## 還缺什麼', ...(w.needs || []).map((n) => `- [${n.resolved ? 'x' : ' '}] (${n.type}) ${n.body}`), '',
    `願望連結:${location.origin}${location.pathname}#wish-${w.id}`,
  ]
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown' })
  const a = el('a'); const url = URL.createObjectURL(blob); a.href = url; a.download = `wish-${w.id}.md`; a.click(); URL.revokeObjectURL(url)
}

/* ============ 排序 + deep-link ============ */
document.querySelectorAll('.sort').forEach((b) => b.onclick = () => {
  document.querySelectorAll('.sort').forEach((x) => { x.classList.remove('active'); x.setAttribute('aria-pressed', 'false') })
  b.classList.add('active'); b.setAttribute('aria-pressed', 'true'); currentSort = b.dataset.sort; loadPond()
})
document.querySelectorAll('.sort').forEach((b) => b.setAttribute('aria-pressed', b.classList.contains('active') ? 'true' : 'false'))

loadPond().then(() => {
  const m = location.hash.match(/^#wish-(\d+)$/)
  if (m) openSheet(Number(m[1]))
})

/* ============ 投下一個願望(AI 引導聊天 modal,沿用) ============ */
const modal = $('#wish-modal')
const modalInner = $('#wish-modal-inner')
$('#new-wish').onclick = openWishModal

let chatMessages = []   // {role, content}

function closeModal() { modal.classList.remove('open'); modalInner.innerHTML = ''; chatMessages = [] }

function openWishModal() {
  chatMessages = []
  modal.classList.add('open')
  modalInner.innerHTML = `
    <div class="row" style="justify-content:space-between;align-items:center">
      <h3 style="margin:0">投下一個願望</h3>
      <button id="wm-close">關閉</button>
    </div>
    <p class="muted">池子收的是「還不存在的作品」。跟 AI 聊兩句把它講清楚;答不出來的可以跳過,也可以直接自己填。</p>
    <div class="chat-log" id="wm-log"></div>
    <div id="wm-input-area"></div>
    <div class="row" style="margin-top:10px">
      <button id="wm-manual">自己填就好</button>
    </div>`
  $('#wm-close').onclick = closeModal
  $('#wm-manual').onclick = renderManualForm
  botSay('嗨,你想要一個什麼樣的作品?一句話說說看 —— 工具、遊戲、小服務都可以。')
  renderChatInput()
}

function botSay(text) { appendMsg('bot', text) }
function appendMsg(role, text) {
  const log = $('#wm-log'); log.appendChild(el('div', 'msg ' + role, text)); log.scrollTop = log.scrollHeight
}

function renderChatInput() {
  const area = $('#wm-input-area'); area.innerHTML = ''
  const ta = el('textarea'); ta.placeholder = '打字…答不出來就按「跳過這題」'
  const row = el('div', 'row'); row.style.marginTop = '8px'
  const send = el('button', 'primary', '回覆'); send.onclick = () => sendChat(ta.value)
  const skip = el('button', null, '跳過這題'); skip.onclick = () => sendChat('(這題我先跳過)')
  row.appendChild(send); row.appendChild(skip)
  area.appendChild(ta); area.appendChild(row)
}

async function sendChat(text) {
  if (!text || !text.trim()) return
  appendMsg('user', text.trim())
  chatMessages.push({ role: 'user', content: text.trim() })
  $('#wm-input-area').innerHTML = '<p class="muted">思考中…</p>'
  let result
  try {
    result = await api('/api/refine', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: chatMessages }),
    })
  } catch (e) {
    botSay('AI 現在有點忙,你可以直接自己填表單送出。')
    renderManualForm()
    return
  }
  if (result.mode === 'ask') {
    botSay(result.question)
    chatMessages.push({ role: 'assistant', content: result.question })
    renderChatInput()
  } else {
    botSay('我幫你整理好了,確認一下再投進池裡。')
    renderPreview(result)
  }
}

function field(label, name, value, ta = false) {
  const wrap = el('div'); wrap.style.marginBottom = '8px'
  wrap.appendChild(el('label', 'muted', label))
  const input = ta ? el('textarea') : el('input')
  input.name = name; input.value = value || ''
  wrap.appendChild(input)
  return wrap
}

function renderPreview(r) {
  const area = $('#wm-input-area'); area.innerHTML = ''
  const form = el('div')
  form.appendChild(field('這個作品叫什麼(一句話也行)', 'title', r.title))
  form.appendChild(field('想解決什麼', 'problem', r.problem, true))
  form.appendChild(field('現在都怎麼辦', 'current', r.current, true))
  form.appendChild(field('希望它能(核心功能,可用分號列多條)', 'desired', r.desired, true))
  form.appendChild(field('誰會用、多常用', 'who', r.who))
  form.appendChild(field('你的暱稱(可留空)', 'nickname', ''))
  if (r.open_questions?.length) {
    const oq = el('div', 'need', '還沒想清楚的(投進池裡後,大家可以幫你想):' + r.open_questions.join('; '))
    form.appendChild(oq)
  }
  const submit = el('button', 'primary', '投進池裡'); submit.style.marginTop = '8px'
  submit.onclick = () => submitWish(form, r, submit)
  form.appendChild(submit)
  area.appendChild(form)
}

function renderManualForm() {
  $('#wm-log').innerHTML = ''
  botSay('直接填吧,只有第一格必填,其他能填多少算多少。')
  renderPreview({ title: '', problem: '', current: '', desired: '', who: '', open_questions: [] })
}

async function submitWish(form, r, submit) {
  const get = (n) => form.querySelector(`[name="${n}"]`).value.trim()
  const title = get('title')
  if (!title) { alert('至少說說這個作品是什麼'); return }
  if (submit) submit.disabled = true   // 防連點造成重複送出
  const payload = {
    wish: { title, problem: get('problem'), current: get('current'), desired: get('desired'), who: get('who'), nickname: get('nickname') || undefined },
    open_questions: r.open_questions || [],
    verdict: r.verdict, // 只有 AI final 且 ok 才會直接入池;純表單(無 verdict)進審核
    sig: r.sig,         // /api/refine 對 ok 內容的簽章;後端驗簽通過才 published,改過/偽造 -> pending
  }
  try {
    const token = await getTurnstileToken()
    payload.turnstileToken = token
    const res = await api('/api/wishes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    })
    closeModal()
    if (res.status === 'published') {
      pond.coin(innerWidth / 2, innerHeight * .45, () => {})
      alert('你的願望已經落進池裡,亮起來了')
      loadPond()
    } else alert('已收到,站方看過後就會出現在池面上,謝謝')
  } catch (e) {
    if (submit) submit.disabled = false
    alert(e.status === 429 ? '今天投的願望已達上限,明天再來' : '送出失敗,請稍後再試')
  }
}

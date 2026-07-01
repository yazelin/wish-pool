const CFG = window.WISHPOOL_CONFIG
const API = CFG.WORKER_BASE
const $ = (s, r = document) => r.querySelector(s)
const el = (t, cls, txt) => { const e = document.createElement(t); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e }

let currentSort = 'hot'

const STATUS_LABEL = { published: '', adopted: '已採納', building: '開發中', done: '已完成' }

async function api(path, opts) {
  const res = await fetch(API + path, opts)
  if (!res.ok) throw Object.assign(new Error('api'), { status: res.status, body: await res.text().catch(() => '') })
  return res.json()
}

// 一次性拿 Turnstile token(隱形模式,避免螢幕外互動挑戰逾時)
function getTurnstileToken() {
  return new Promise((resolve, reject) => {
    if (!window.turnstile) return reject(new Error('turnstile not loaded'))
    const holder = el('div')
    holder.style.display = 'none'
    document.body.appendChild(holder)
    const cleanup = (id) => { try { window.turnstile.remove(id) } catch (e) { /* ignore */ } holder.remove() }
    const id = window.turnstile.render(holder, {
      sitekey: CFG.TURNSTILE_SITE_KEY, size: 'invisible',
      callback: (t) => { resolve(t); cleanup(id) },
      'error-callback': () => { reject(new Error('turnstile error')); cleanup(id) },
    })
    window.turnstile.execute?.(holder)
  })
}

function renderCard(w) {
  const card = el('div', 'card')
  const head = el('div', 'row')
  const h = el('h3', null, w.title); head.appendChild(h)
  if (STATUS_LABEL[w.status]) head.appendChild(el('span', 'badge ' + w.status, STATUS_LABEL[w.status]))
  card.appendChild(head)

  const kv = el('dl', 'kv')
  const add = (k, v) => { if (v) { kv.appendChild(el('dt', null, k)); kv.appendChild(el('dd', null, v)) } }
  add('問題', w.problem); add('現況', w.current); add('期望', w.desired); add('誰會用', w.who)
  card.appendChild(kv)

  const foot = el('div', 'card-foot')
  const vote = el('button', 'vote')
  vote.setAttribute('aria-label', '為這個願望加一票')
  vote.append('▲ ', el('span', null, String(w.votes)))
  vote.onclick = () => doVote(w.id, vote)
  foot.appendChild(vote)
  if (w.nickname) foot.appendChild(el('span', 'muted', '— ' + w.nickname))
  const detail = el('button', null, '看待補問題 / 回應')
  detail.onclick = () => openDetail(w.id, card)
  foot.appendChild(detail)
  card.appendChild(foot)
  return card
}

async function doVote(id, btn) {
  try {
    const token = await getTurnstileToken()
    const r = await api(`/api/wishes/${id}/vote`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ turnstileToken: token }),
    })
    btn.querySelector('span').textContent = r.votes
    if (!r.ok) btn.disabled = true
  } catch (e) { alert('投票失敗,請稍後再試') }
}

async function openDetail(id, card) {
  if (card.querySelector('.detail')) { card.querySelector('.detail').remove(); return }
  let w
  try { w = await api(`/api/wishes/${id}`) } catch (e) { alert('載入失敗,請稍後再試'); return }
  const box = el('div', 'detail')
  w.open_questions.forEach((q) => {
    const line = el('div', 'open-q' + (q.resolved ? ' resolved' : ''), '待補:' + q.question)
    if (!q.resolved) {
      const ans = el('button', null, '我來回答')
      ans.style.marginLeft = '8px'
      ans.onclick = () => respond(id, box, q.id)
      line.appendChild(ans)
    }
    box.appendChild(line)
  })
  w.responses.forEach((r) => {
    const rr = el('div', 'resp')
    rr.appendChild(el('div', null, (r.kind === 'metoo' ? '我也要:' : '') + r.body))
    rr.appendChild(el('div', 'who', r.nickname ? '— ' + r.nickname : '— 匿名'))
    box.appendChild(rr)
  })
  const metoo = el('button', null, '我也要 / 補一句')
  metoo.onclick = () => respond(id, box, null)
  box.appendChild(metoo)
  card.appendChild(box)
}

async function respond(wishId, box, questionId) {
  const body = prompt(questionId ? '你的回答:' : '想補充什麼?(例:我也要,而且還想要…)')
  if (!body || !body.trim()) return
  const nickname = prompt('暱稱(可留空):') || undefined
  try {
    const token = await getTurnstileToken()
    await api(`/api/wishes/${wishId}/responses`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ turnstileToken: token, body: body.trim(), nickname, kind: questionId ? 'answer' : 'metoo', questionId }),
    })
    box.remove() // 重開會重新載入
    alert('已送出,謝謝')
  } catch (e) { alert('送出失敗,請稍後再試') }
}

async function loadWall() {
  const wall = $('#wall'); wall.innerHTML = ''
  const note = $('#empty')
  try {
    const { wishes } = await api(`/api/wishes?sort=${currentSort}&limit=100`)
    note.textContent = '還沒有願望,當第一個許願的人吧。'
    note.style.display = wishes.length ? 'none' : 'block'
    wishes.forEach((w) => wall.appendChild(renderCard(w)))
  } catch (e) {
    note.textContent = '載入失敗,請稍後重試。'
    note.style.display = 'block'
  }
}

document.querySelectorAll('.sort').forEach((b) => b.onclick = () => {
  document.querySelectorAll('.sort').forEach((x) => { x.classList.remove('active'); x.setAttribute('aria-pressed', 'false') })
  b.classList.add('active'); b.setAttribute('aria-pressed', 'true'); currentSort = b.dataset.sort; loadWall()
})
document.querySelectorAll('.sort').forEach((b) => b.setAttribute('aria-pressed', b.classList.contains('active') ? 'true' : 'false'))

loadWall()

// ---- 送出流程 ----
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
      <h3 style="margin:0">許個願</h3>
      <button id="wm-close">關閉</button>
    </div>
    <p class="muted">跟 AI 聊兩句,把你想要的講清楚;答不出來的可以跳過。也可以直接自己填。</p>
    <div class="chat-log" id="wm-log"></div>
    <div id="wm-input-area"></div>
    <div class="row" style="margin-top:10px">
      <button id="wm-manual">自己填就好</button>
    </div>`
  $('#wm-close').onclick = closeModal
  $('#wm-manual').onclick = renderManualForm
  botSay('嗨,你想要 AI 幫你做什麼?一句話說說看。')
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
    botSay('我幫你整理好了,確認一下再送出。')
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
  form.appendChild(field('標題', 'title', r.title))
  form.appendChild(field('問題', 'problem', r.problem, true))
  form.appendChild(field('現況', 'current', r.current, true))
  form.appendChild(field('期望', 'desired', r.desired, true))
  form.appendChild(field('誰會用、多常用', 'who', r.who))
  form.appendChild(field('你的暱稱(可留空)', 'nickname', ''))
  if (r.open_questions?.length) {
    const oq = el('div', 'open-q', '待補問題(送出後大家可幫你回答):' + r.open_questions.join('; '))
    form.appendChild(oq)
  }
  const submit = el('button', 'primary', '送出願望'); submit.style.marginTop = '8px'
  submit.onclick = () => submitWish(form, r, submit)
  form.appendChild(submit)
  area.appendChild(form)
}

function renderManualForm() {
  $('#wm-log').innerHTML = ''
  botSay('直接填吧,只有標題必填,其他能填多少算多少。')
  renderPreview({ title: '', problem: '', current: '', desired: '', who: '', open_questions: [] })
}

async function submitWish(form, r, submit) {
  const get = (n) => form.querySelector(`[name="${n}"]`).value.trim()
  const title = get('title')
  if (!title) { alert('至少給個標題'); return }
  if (submit) submit.disabled = true   // 防連點造成重複送出
  const payload = {
    wish: { title, problem: get('problem'), current: get('current'), desired: get('desired'), who: get('who'), nickname: get('nickname') || undefined },
    open_questions: r.open_questions || [],
    verdict: r.verdict, // 只有 AI final 且 ok 才會直接上牆;純表單(無 verdict)進 pending
    sig: r.sig,         // /api/refine 對 ok 內容的簽章;後端驗簽通過才 published,改過/偽造 -> pending
  }
  try {
    const token = await getTurnstileToken()
    payload.turnstileToken = token
    const res = await api('/api/wishes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    })
    closeModal()
    if (res.status === 'published') { alert('願望已上牆,謝謝你的許願'); loadWall() }
    else alert('已送出,審核通過後就會出現在牆上,謝謝')
  } catch (e) {
    if (submit) submit.disabled = false
    alert(e.status === 429 ? '今天送出次數已達上限,明天再來' : '送出失敗,請稍後再試')
  }
}

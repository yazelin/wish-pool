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

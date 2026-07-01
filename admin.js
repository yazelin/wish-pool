const API = window.WISHPOOL_CONFIG.WORKER_BASE
const $ = (s, r = document) => r.querySelector(s)
const el = (t, cls, txt) => { const e = document.createElement(t); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e }
const TK = 'wishpool_admin_token'
let status = 'pending'

$('#token').value = localStorage.getItem(TK) || ''
$('#save-token').onclick = () => { localStorage.setItem(TK, $('#token').value.trim()); load() }
$('#export').onclick = exportAll

function auth() { return { Authorization: 'Bearer ' + (localStorage.getItem(TK) || ''), 'Content-Type': 'application/json' } }

async function adminApi(path, opts = {}) {
  const res = await fetch(API + path, { ...opts, headers: { ...auth(), ...(opts.headers || {}) } })
  if (res.status === 401) { $('#hint').textContent = 'token 錯誤或未設定'; throw new Error('401') }
  if (!res.ok) throw new Error(res.status)
  return res.json()
}

const NEXT = { pending: ['published', 'hidden'], published: ['adopted', 'hidden'], adopted: ['building'], building: ['done'], done: [], hidden: ['published'] }
const LABEL = { published: '通過/上牆', adopted: '標為已採納', building: '標為開發中', done: '標為已完成', hidden: '隱藏' }

async function load() {
  const listEl = $('#list'); listEl.innerHTML = ''; $('#hint').textContent = '載入中…'
  let data
  try { data = await adminApi(`/api/admin/wishes?status=${status}`) } catch { return }
  $('#hint').textContent = data.wishes.length ? '' : '這個狀態沒有願望'
  data.wishes.forEach((w) => {
    const card = el('div', 'card')
    card.appendChild(el('h3', null, `#${w.id} ${w.title}`))
    const meta = [w.problem && '問題:' + w.problem, w.desired && '期望:' + w.desired, `票:${w.votes}`].filter(Boolean).join(' / ')
    card.appendChild(el('div', 'muted', meta))
    const foot = el('div', 'card-foot')
    ;(NEXT[status] || []).forEach((s) => {
      const b = el('button', s === 'hidden' ? '' : 'primary', LABEL[s])
      b.onclick = async () => { await adminApi(`/api/admin/wishes/${w.id}/status`, { method: 'POST', body: JSON.stringify({ status: s }) }); load() }
      foot.appendChild(b)
    })
    card.appendChild(foot)
    listEl.appendChild(card)
  })
}

async function exportAll() {
  try {
    const all = await adminApi('/api/admin/export')
    const blob = new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' })
    const a = el('a'); a.href = URL.createObjectURL(blob); a.download = 'wishes.json'; a.click()
  } catch {}
}

document.querySelectorAll('.sort').forEach((b) => b.onclick = () => {
  document.querySelectorAll('.sort').forEach((x) => x.classList.remove('active'))
  b.classList.add('active'); status = b.dataset.status; load()
})

if (localStorage.getItem(TK)) load()

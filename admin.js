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
  try { data = await adminApi(`/api/admin/wishes?status=${status}`) } catch (e) {
    const h = $('#hint'); if (h.textContent === '載入中…') h.textContent = '載入失敗,請確認 token 與網路'
    return
  }
  $('#hint').textContent = data.wishes.length ? '' : '這個狀態沒有願望'
  data.wishes.forEach((w) => {
    const card = el('div', 'card')
    card.appendChild(el('h3', null, `#${w.id} ${w.title}`))
    const meta = [w.problem && '問題:' + w.problem, w.desired && '期望:' + w.desired, `票:${w.votes}`].filter(Boolean).join(' / ')
    card.appendChild(el('div', 'muted', meta))
    const foot = el('div', 'card-foot')
    ;(NEXT[status] || []).forEach((s) => {
      const b = el('button', s === 'hidden' ? '' : 'primary', LABEL[s])
      b.onclick = async () => {
        try { await adminApi(`/api/admin/wishes/${w.id}/status`, { method: 'POST', body: JSON.stringify({ status: s }) }); load() }
        catch (e) { alert('操作失敗,請確認 token 與網路') }
      }
      foot.appendChild(b)
    })
    const manage = el('button', null, '管理實作 / 需求')
    manage.onclick = () => manageDetail(w.id, card)
    foot.appendChild(manage)
    if (status !== 'hidden' && !(NEXT[status] || []).includes('hidden')) {
      const hide = el('button', null, '隱藏')
      hide.onclick = async () => {
        try { await adminApi(`/api/admin/wishes/${w.id}/status`, { method: 'POST', body: JSON.stringify({ status: 'hidden' }) }); load() }
        catch (e) { alert('操作失敗,請確認 token 與網路') }
      }
      foot.appendChild(hide)
    }
    const del = el('button', null, '刪除')
    del.style.color = 'var(--danger)'
    del.onclick = async () => {
      if (!confirm(`確定刪除「${w.title}」?無法復原,會一併清掉它的答案 / 需求 / 進度。`)) return
      try { await adminApi(`/api/admin/wishes/${w.id}/delete`, { method: 'POST' }); load() }
      catch (e) { alert('刪除失敗,請確認 token 與網路') }
    }
    foot.appendChild(del)
    card.appendChild(foot)
    listEl.appendChild(card)
  })
}

async function exportAll() {
  try {
    const all = await adminApi('/api/admin/export')
    const blob = new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = el('a'); a.href = url; a.download = 'wishes.json'; a.click()
    URL.revokeObjectURL(url)
  } catch (e) { alert('匯出失敗,請確認 token 與網路') }
}

async function manageDetail(id, card) {
  if (card.querySelector('.mdetail')) { card.querySelector('.mdetail').remove(); return }
  const w = await (await fetch(`${API}/api/wishes/${id}`)).json()
  const box = el('div', 'mdetail')
  box.appendChild(el('div', 'muted', '實作版本:'))
  ;(w.answers || []).forEach((a) => {
    const row = el('div', 'card-foot')
    const link = el('a', 'repo-link'); link.href = a.repo_url; link.textContent = a.repo_url; link.target = '_blank'; link.rel = 'noopener nofollow'
    row.appendChild(link)
    const hide = el('button', '', '隱藏')
    hide.onclick = async () => { await adminApi(`/api/admin/answers/${a.id}/status`, { method: 'POST', body: JSON.stringify({ status: 'hidden' }) }); card.querySelector('.mdetail')?.remove(); manageDetail(id, card) }
    const accept = el('button', 'primary', '採用(設已實現)')
    accept.onclick = async () => { await adminApi(`/api/admin/wishes/${id}/accept`, { method: 'POST', body: JSON.stringify({ answer_id: a.id }) }); load() }
    row.appendChild(hide); row.appendChild(accept)
    box.appendChild(row)
  })
  box.appendChild(el('div', 'muted', '還缺什麼:'))
  ;(w.needs || []).forEach((n) => {
    const row = el('div', 'card-foot')
    row.appendChild(el('span', null, `[${n.type}] ${n.body}` + (n.resolved ? ' (已解)' : '')))
    if (!n.resolved) {
      const res = el('button', '', '標已解')
      res.onclick = async () => { await adminApi(`/api/admin/needs/${n.id}/resolve`, { method: 'POST' }); card.querySelector('.mdetail')?.remove(); manageDetail(id, card) }
      row.appendChild(res)
    }
    box.appendChild(row)
  })
  card.appendChild(box)
}

document.querySelectorAll('.sort').forEach((b) => b.onclick = () => {
  document.querySelectorAll('.sort').forEach((x) => x.classList.remove('active'))
  b.classList.add('active'); status = b.dataset.status; load()
})

if (localStorage.getItem(TK)) load()

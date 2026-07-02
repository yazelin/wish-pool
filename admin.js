const API = window.WISHPOOL_CONFIG.WORKER_BASE
const $ = (s, r = document) => r.querySelector(s)
const el = (t, cls, txt) => { const e = document.createElement(t); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e }
const TK = 'wishpool_admin_token'
let status = 'pending'

$('#token').value = localStorage.getItem(TK) || ''
$('#save-token').onclick = () => { localStorage.setItem(TK, $('#token').value.trim()); load() }
$('#export').onclick = exportAll
const tokBtn = el('button', null, 'Agent Tokens')
$('#export').after(tokBtn)
tokBtn.onclick = async () => {
  const box = $('#tok-list') || (() => { const d = el('div'); d.id = 'tok-list'; $('#list').before(d); return d })()
  if (box.childNodes.length) { box.innerHTML = ''; return }
  try {
    const { tokens } = await adminApi('/api/admin/agent-tokens')
    if (!tokens.length) { box.appendChild(el('p', 'muted', '還沒有自助領取的 token')) }
    tokens.forEach((t) => {
      const row = el('div', 'card-foot')
      const when = new Date(t.created_at * 1000).toLocaleDateString('zh-TW')
      const used = t.last_used_at ? new Date(t.last_used_at * 1000).toLocaleString('zh-TW', { hour12: false }) : '未使用'
      row.appendChild(el('span', null,
        `#${t.id} ${t.label || '(未命名)'} ${t.github_handle ? '@' + t.github_handle : ''} · 領於 ${when}` +
        ` · 用 ${t.use_count} 次 · 答案 ${t.answers_count} · 進度 ${t.updates_count} · 最後 ${used}` +
        (t.ip8 ? ` · ip:${t.ip8}` : '') + (t.revoked ? ' [已撤銷]' : '')))
      if (!t.revoked) {
        const rv = el('button', null, '撤銷')
        rv.onclick = async () => { await adminApi(`/api/admin/agent-tokens/${t.id}/revoke`, { method: 'POST' }); box.innerHTML = ''; tokBtn.click() }
        row.appendChild(rv)
      }
      box.appendChild(row)
    })
  } catch (e) { alert('載入失敗,請確認 token') }
}

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
    const meta = [w.problem && '問題:' + w.problem, w.desired && '期望:' + w.desired, w.who && '誰用:' + w.who].filter(Boolean).join(' / ')
    card.appendChild(el('div', 'muted', meta))
    // 決策儀表:進下一狀態前要看的訊號
    const dash = el('div', null,
      `幣 ${w.votes} · 共鳴 ${w.echoes ?? 0} · 缺口未解 ${w.needs_open ?? 0}/${w.needs_total ?? 0} · 認領 ${w.claims ?? 0} · 實作 ${w.answers_count ?? 0} 版` +
      (w.top_answer_votes ? `(最高票 ${w.top_answer_votes})` : ''))
    dash.style.cssText = 'margin-top:6px;font-size:.9rem;color:var(--amber-soft)'
    card.appendChild(dash)
    const when = new Date(w.created_at * 1000).toLocaleString('zh-TW', { hour12: false })
    const act = el('div', 'muted', (w.last_update ? `最新動態:${w.last_update.slice(0, 70)} · ` : '尚無認領/進度 · ') + `許於 ${when}`)
    act.style.fontSize = '.85rem'
    card.appendChild(act)
    if (w.discussion_url) {
      const d = el('a', 'repo-link', '看討論串')
      d.href = w.discussion_url; d.target = '_blank'; d.rel = 'noopener'
      card.appendChild(d)
    }
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

document.querySelectorAll('.sort[data-status]').forEach((b) => b.onclick = () => {
  document.querySelectorAll('.sort[data-status]').forEach((x) => x.classList.remove('active'))
  b.classList.add('active'); status = b.dataset.status; load()
})

if (localStorage.getItem(TK)) load()

/* 主題切換(與池面共用 localStorage 記憶) */
const themeBtn = document.querySelector('#theme-toggle')
if (themeBtn) {
  const isDay = () => document.documentElement.classList.contains('theme-day')
  const sync = () => { themeBtn.textContent = isDay() ? '夜' : '晨' }
  themeBtn.onclick = () => {
    document.documentElement.classList.toggle('theme-day')
    try { localStorage.setItem('wishpool_theme', isDay() ? 'day' : 'night') } catch (e) { /* ignore */ }
    sync()
  }
  sync()
}

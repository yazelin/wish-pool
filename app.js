// 願望池 — 池面(前台)。世界觀:夜色水面,願望是漂在水上的燈;投票=投許願幣;成真=升上星帶。
// canvas 只畫水面(微光/漣漪/硬幣),願望燈全是 DOM(textContent 渲染,XSS 安全沿用)。
const CFG = window.WISHPOOL_CONFIG
const API = CFG.WORKER_BASE
const $ = (s, r = document) => r.querySelector(s)
const el = (t, cls, txt) => { const e = document.createElement(t); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e }

let currentSort = 'hot'
let wishCache = []          // 池面列表快取(星帶/燈共用)
let openSheetId = null      // 目前打開的願望 id
let echoNewestFirst = false // 池邊的討論排序(issue #7 討論摺疊/排序):預設舊→新

const PHRASE = { published: '池中漂著', adopted: '有人心動了', building: '實現中', done: '成真了' }

// 站內通知(issue #3):記住你參與過的願望(許願/回答缺口/留言/認領/回報/交實作),
// 回站用清單一次比對「活動數變多或狀態變了」→ 燈/星亮「有新進展」;打開願望時標出哪幾筆是新的。
// 記錄存 localStorage(不註冊、不收 email,零隱私面);換裝置或清資料就重新開始 —— 跨裝置要通知,走願望討論串的 GitHub Subscribe。
// 記錄格式 v2:{ t: 已看過的活動總數, s: 已看過的狀態, at: 已看過的最新活動時間(epoch 秒) };
// 兼容 v1(純數字 = { t: n },s/at 未知則該項比對跳過,下次看過即補齊)。
const WATCH_KEY = 'wishpool_watch'
function normSeen(v) { return typeof v === 'number' ? { t: v } : (v && typeof v === 'object' ? v : { t: 0 }) }
function getWatch() {
  try {
    const raw = JSON.parse(localStorage.getItem(WATCH_KEY)) || {}
    const w = {}; Object.keys(raw).forEach((k) => { w[k] = normSeen(raw[k]) })
    return w
  } catch (e) { return {} }
}
function setWatch(w) { try { localStorage.setItem(WATCH_KEY, JSON.stringify(w)) } catch (e) { /* ignore */ } }
function watchWish(id, seen) { const w = getWatch(); if (seen || w[id] == null) w[id] = seen || { t: 0 }; setWatch(w) }
function activityTotal(w) { return (w.answers?.length || 0) + (w.updates?.length || 0) + (w.activity_responses_count ?? w.responses?.length ?? 0) + (w.needs?.length || 0) }
// 清單列(帶計數)與詳情(帶陣列)同一套口徑
function activityTotalRow(w) { return (w.answers_count || 0) + (w.updates_count || 0) + (w.activity_responses_count ?? w.echoes ?? 0) + (w.needs_total || 0) }
function lastActivityAt(w) {
  let m = 0
  ;[...(w.answers || []), ...(w.updates || []), ...(w.responses || []), ...(w.needs || [])].forEach((x) => { if (x.created_at > m) m = x.created_at })
  return m
}
function isFresh(seen, total, status) { return total > (seen.t || 0) || (seen.s != null && status !== seen.s) }

async function api(path, opts) {
  const res = await fetch(API + path, opts)
  if (!res.ok) throw Object.assign(new Error('api'), { status: res.status, body: await res.text().catch(() => '') })
  return res.json()
}

// 一次性拿 Turnstile token(隱形 widget 類型在 Cloudflare 後台設)
// 注意:容器不能 display:none(真 widget 在隱藏容器內不執行挑戰)→ 用螢幕外定位;
// 也不要呼叫 execute()(預設 execution=render,render 即自動跑)。
function mintTurnstileToken() {
  return new Promise((resolve, reject) => {
    if (!window.turnstile) return reject(new Error('turnstile not loaded'))
    const holder = el('div')
    holder.style.cssText = 'position:fixed;left:-9999px;bottom:0;width:300px;height:65px;'
    document.body.appendChild(holder)
    let wid = null, settled = false
    const finish = (ok, val) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { if (wid !== null) window.turnstile.remove(wid) } catch (e) { /* ignore */ }
      holder.remove()
      ok ? resolve(val) : reject(val)
    }
    const timer = setTimeout(() => finish(false, new Error('turnstile timeout')), 20000)
    wid = window.turnstile.render(holder, {
      sitekey: CFG.TURNSTILE_SITE_KEY,
      callback: (t) => finish(true, t),
      'error-callback': () => finish(false, new Error('turnstile error')),
    })
  })
}

// token 池:頁面載入先預熱一枚(token 單次使用、約 5 分鐘效期),動作時秒用、背景補貨。
// 投幣慢的主因就是「動作當下才跑隱形挑戰(1-3 秒)」;預熱後只剩 API 延遲。
let tsCache = null      // { t, at }
let tsFilling = null
function fillTurnstile() {
  if (tsFilling) return tsFilling
  tsFilling = mintTurnstileToken().then(
    (t) => { tsCache = { t, at: Date.now() }; tsFilling = null; return t },
    (e) => { tsFilling = null; throw e },
  )
  return tsFilling
}
async function getTurnstileToken() {
  if (tsCache && Date.now() - tsCache.at < 240000) {
    const t = tsCache.t
    tsCache = null
    fillTurnstile().catch(() => {})   // 背景補下一枚
    return t
  }
  const t = await fillTurnstile()
  if (tsCache && tsCache.t === t) tsCache = null   // 這枚被本次消費,清掉避免重複使用
  fillTurnstile().catch(() => {})
  return t
}
;(function warmTurnstile() {
  if (window.turnstile) fillTurnstile().catch(() => {})
  else setTimeout(warmTurnstile, 400)
})()

/* ============ 水面(canvas):微光粒 + 漣漪環 + 許願幣 ============ */
const isDay = () => document.documentElement.classList.contains('theme-day')

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
      // 晨光=湖面陽光碎金(淡);夜晚=螢光(暖金)
      ctx.fillStyle = isDay() ? `rgba(214,166,60,${tw * .45})` : `rgba(244,205,120,${tw})`; ctx.fill()
    }
    // 漣漪
    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i]
      r.r += (r.max - r.r) * .045; r.a *= .965
      if (r.a < .01) { ripples.splice(i, 1); continue }
      ctx.beginPath(); ctx.ellipse(r.x, r.y, r.r, r.r * .38, 0, 0, 6.28)
      ctx.strokeStyle = isDay() ? `rgba(90,170,155,${r.a})` : `rgba(255,216,138,${r.a})`; ctx.lineWidth = 1.4; ctx.stroke()
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
  // 點水面起漣漪(純氛圍):反向過濾 —— 只要沒點到互動元件,整個頁面都是水面
  addEventListener('pointerdown', (e) => {
    if (!(e.target instanceof Element)) return
    if (e.target.closest('button, a, input, textarea, select, .lantern, .star, .sheet, .modal, details, summary, iframe')) return
    ripple(e.clientX, e.clientY)
  })
  return { ripple, coin: reduced ? (x, y, done) => { done && done() } : coin }
})()

// GitHub repo -> OG 預覽圖(opengraph.githubassets.com;作者可在 repo Settings -> Social preview 自訂)。
// 僅接受 github.com,owner/repo 逐段 encodeURIComponent,img 來源固定為 githubassets,不渲染任意外部圖。
function repoPreview(repoUrl) {
  try {
    const u = new URL(repoUrl)
    if (u.hostname !== 'github.com') return null
    const seg = u.pathname.split('/').filter(Boolean)
    if (seg.length < 2) return null
    // 經 worker proxy 讀 og:image meta(自訂 Social preview 才會生效;直接打 githubassets 只會拿到自動卡)
    return `${API}/api/og/${encodeURIComponent(seg[0])}/${encodeURIComponent(seg[1])}`
  } catch (e) { return null }
}

/* ============ 小工具:安全連結化 + GitHub 帳號連結 + 自製表單彈窗 ============ */
// 內文中的 http(s) 連結變可點(逐段 textContent 組裝,無 XSS 面)
function linkifyInto(parent, text) {
  const re = /https?:\/\/[^\s]+/g
  let last = 0, m
  while ((m = re.exec(text))) {
    if (m.index > last) parent.append(text.slice(last, m.index))
    const a = el('a', 'repo-link', m[0])
    a.href = m[0]; a.target = '_blank'; a.rel = 'noopener nofollow'
    parent.appendChild(a)
    last = m.index + m[0].length
  }
  if (last < text.length) parent.append(text.slice(last))
}
// @handle -> GitHub 個人頁連結(格式不合就退回純文字)
function ghLink(handle) {
  if (/^[A-Za-z0-9-]{1,39}$/.test(handle)) {
    const a = el('a', 'repo-link', '@' + handle)
    a.href = 'https://github.com/' + handle; a.target = '_blank'; a.rel = 'noopener nofollow'
    return a
  }
  return el('span', null, '@' + handle)
}
// 自製表單彈窗:原生 prompt() 在手機切走畫面會被瀏覽器自動取消(打一半全丟)。
// 這個 DOM 彈窗切走再回來都在;點背景「不」取消(防誤觸),只有取消鈕會關。
function askForm(title, fields) {
  return new Promise((resolve) => {
    const bg = el('div', 'modal-bg open')
    bg.style.zIndex = '70'
    const box = el('div', 'modal')
    box.appendChild(el('h3', null, title))
    const inputs = {}
    fields.forEach((f) => {
      const wrap = el('div'); wrap.style.marginBottom = '8px'
      if (f.label) wrap.appendChild(el('label', 'muted', f.label))
      let inp
      if (f.type === 'textarea') inp = el('textarea')
      else if (f.type === 'select') {
        inp = document.createElement('select')
        f.options.forEach(([v, t]) => { const o = el('option', null, t); o.value = v; inp.appendChild(o) })
      } else inp = el('input')
      if (f.placeholder) inp.placeholder = f.placeholder
      inputs[f.name] = inp
      wrap.appendChild(inp); box.appendChild(wrap)
    })
    const row = el('div', 'row'); row.style.marginTop = '10px'
    const ok = el('button', 'primary', '送出')
    const cancel = el('button', null, '取消')
    const done = (v) => { bg.remove(); resolve(v) }
    ok.onclick = () => {
      const vals = {}
      for (const f of fields) {
        const v = inputs[f.name].value.trim()
        if (f.required && !v) { inputs[f.name].focus(); inputs[f.name].style.borderColor = 'var(--danger)'; return }
        if (f.check && v) { const err = f.check(v); if (err) { alert(err); inputs[f.name].focus(); return } }
        vals[f.name] = v || undefined
      }
      done(vals)
    }
    cancel.onclick = () => done(null)
    row.appendChild(ok); row.appendChild(cancel)
    box.appendChild(row)
    bg.appendChild(box)
    document.body.appendChild(bg)
    setTimeout(() => { const first = fields[0] && inputs[fields[0].name]; first && first.focus() }, 60)
  })
}

/* ============ 池面渲染:星帶(成真)+ 願望燈 ============ */
function wishSentence(w) {
  // desired 可能是「功能1;功能2」清單或一句話
  const d = (w.desired || '').trim()
  if (!d) return null
  return d.includes(';') || d.includes(';') ? d.split(/[;;]/).map((s) => s.trim()).filter(Boolean) : d
}

function renderStar(w) {
  const s = el('button', 'star')
  s.dataset.wid = w.id
  s.setAttribute('aria-label', `成真的願望:${w.title}`)
  s.appendChild(el('span', 'star-dot'))
  s.appendChild(el('span', 'star-title', w.title))
  const meta = `${w.votes} 幣` + (w.echoes ? ` · ${w.echoes} 共鳴` : '')
  s.appendChild(el('span', 'star-meta', meta))
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
  if (w.difficulty) card.appendChild(el('span', 'phrase', `規模:${w.difficulty}`))
  card.appendChild(el('h3', null, w.title))
  const foot = el('div', 'lantern-foot')
  foot.appendChild(el('span', 'coins', `已有 ${w.votes} 枚許願幣`))
  if (w.echoes) foot.appendChild(el('span', 'coins', `${w.echoes} 人共鳴`))
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
    const showDone = currentSort === 'done'   // 「已實現」頁籤:成真願望用清單好好看(比在河道上追方便)
    const { wishes } = await api(`/api/wishes?sort=${showDone ? 'new' : currentSort}&limit=100`)
    wishCache = wishes
    const done = wishes.filter((w) => w.status === 'done')
    const floating = wishes.filter((w) => w.status !== 'done')
    lan.innerHTML = ''
    $('#starband-wrap').style.display = done.length ? '' : 'none'
    buildStarRiver(done)
    const shown = showDone ? done : floating
    shown.forEach((w) => lan.appendChild(renderLantern(w)))
    note.textContent = showDone ? '還沒有成真的願望 —— 快了。' : '池面還很安靜 —— 投下第一個願望吧。'
    note.style.display = shown.length ? 'none' : 'block'
  } catch (e) {
    $('#starband-wrap').style.display = 'none'
    note.textContent = '池水暫時看不清,請稍後再試。'
    note.style.display = 'block'
  }
  checkWatched()
}

let freshIds = new Set()   // 本次載入判定「有新進展」的願望 id(星河重建後要重掛)
function applyFreshBadges() {
  freshIds.forEach((id) => {
    const card = document.getElementById('wish-' + id)
    if (card && !card.querySelector('.phrase.fresh')) card.prepend(el('span', 'phrase fresh', '有新進展'))
    document.querySelectorAll(`.star[data-wid="${id}"]`).forEach((s) => { s.classList.add('fresh'); s.title = '有新進展' })
  })
}
function clearFresh(id) {
  freshIds.delete(String(id))   // freshIds 的 key 來自 Object.keys(是字串);id 可能是數字
  document.querySelector(`#wish-${id} .phrase.fresh`)?.remove()
  document.querySelectorAll(`.star[data-wid="${id}"]`).forEach((s) => { s.classList.remove('fresh'); s.removeAttribute('title') })
}
async function checkWatched() {
  const watch = getWatch()
  const ids = Object.keys(watch)
  if (!ids.length) return
  freshIds = new Set()
  // 主路徑:清單已帶活動計數與狀態,零額外請求;不在清單上的(超過 100 則、被下架…)才個別補抓,封頂 10 次
  let fallbackBudget = 10
  await Promise.all(ids.map(async (id) => {
    const row = wishCache.find((x) => x.id === Number(id))
    if (row) {
      if (isFresh(watch[id], activityTotalRow(row), row.status)) freshIds.add(id)
      return
    }
    // 自己許的 pending 願望:公開單筆端點看不到(404,issue #20),只用清單比對 ——
    // 上牆後會出現在清單、狀態變化亮「有新進展」;沒上牆就靜靜留著,不打請求也不清記錄
    if (watch[id].s === 'pending') return
    if (fallbackBudget-- <= 0) return
    try {
      const w = await api(`/api/wishes/${id}`)
      if (isFresh(watch[id], activityTotal(w), w.status)) freshIds.add(id)
    } catch (e) { if (e.status === 404) { delete watch[id]; setWatch(watch) } }   // 被刪/被下架 → 清記錄
  }))
  document.getElementById('watch-note')?.remove()
  if (freshIds.size) {
    const n = el('p', 'muted', `你參與過的願望有 ${freshIds.size} 則新動靜 —— 找找亮「有新進展」的燈,或星河上發亮的星`)
    n.id = 'watch-note'; n.style.textAlign = 'center'
    $('#lanterns').before(n)
  }
  applyFreshBadges()
}

/* ============ 成真星河:三排錯落、可拖曳、慢漂、無限輪迴 ============ */
let riverWishes = []
let riverCleanup = null
function jitterFor(id, idx) { let h = (id * 31 + idx * 17) % 37; return 10 + h }   // 決定性錯落(不用亂數,重繪不跳)

function buildStarRiver(wishes) {
  riverWishes = wishes
  if (riverCleanup) { riverCleanup(); riverCleanup = null }
  const band = $('#starband')
  band.innerHTML = ''
  band.classList.add('river')
  if (!wishes.length) return
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
  // 分三排(不足三排就幾排)
  const lanes = [[], [], []]
  wishes.forEach((w, i) => lanes[i % 3].push(w))
  const rows = lanes.filter((l) => l.length).map((list, ri) => {
    const row = el('div', 'river-row')
    const strip = el('div', 'river-strip')
    row.appendChild(strip); band.appendChild(row)
    return { strip, list, ri, setW: 0 }
  })
  // 填一組、量寬,再複製到蓋滿兩個視窗寬(複製組 aria-hidden 免重複朗讀)
  rows.forEach((r) => {
    const addSet = (dup) => r.list.forEach((w, idx) => {
      const st = renderStar(w)
      st.style.marginLeft = jitterFor(w.id, idx + r.ri * 7) + 'px'
      if (dup) { st.tabIndex = -1; st.setAttribute('aria-hidden', 'true') }
      r.strip.appendChild(st)
    })
    addSet(false)
    r.setW = r.strip.scrollWidth
    if (r.setW < 40) return
    let guard = 0
    while (r.strip.scrollWidth < innerWidth * 2 + r.setW && guard++ < 30) addSet(true)
  })
  // 引擎:共用 offset,逐排視差速度,modulo 輪迴
  const speeds = [1, .82, 1.13]
  let offset = 0, dragging = false, lastX = 0, moved = 0, hover = false, suppress = false
  const apply = () => rows.forEach((r) => {
    if (!r.setW) return
    const m = ((offset * speeds[r.ri] % r.setW) + r.setW) % r.setW
    r.strip.style.transform = `translateX(${-m}px)`
  })
  let rafId = null
  let down = false
  const drift = () => {
    if (!down && !hover) { offset += .35; apply() }
    rafId = requestAnimationFrame(drift)
  }
  if (!reduced) rafId = requestAnimationFrame(drift)
  else apply()
  // 不用 setPointerCapture:capture 會把 click 目標改指到河道,星星就點不開了。
  // 改為 window 級 move/up 追蹤;超過 slop 才算拖曳,拖曳後的 click 用 capture 階段吃掉一次。
  band.addEventListener('pointerenter', () => { hover = true })
  band.addEventListener('pointerleave', () => { hover = false })
  const onDown = (e) => { down = true; dragging = false; lastX = e.clientX; moved = 0 }
  const onMove = (e) => {
    if (!down) return
    const dx = e.clientX - lastX; lastX = e.clientX
    moved += Math.abs(dx)
    if (!dragging && moved > 4) dragging = true
    if (dragging) { offset -= dx; apply() }
  }
  const onUp = () => { if (moved > 6) suppress = true; down = false; dragging = false }
  band.addEventListener('pointerdown', onDown)
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onUp)
  band.addEventListener('click', (e) => { if (suppress) { e.stopPropagation(); e.preventDefault(); suppress = false } }, true)
  band.addEventListener('wheel', (e) => {
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : (e.shiftKey ? e.deltaY : 0)
    if (d) { offset += d; apply(); e.preventDefault() }
  }, { passive: false })
  apply()
  riverCleanup = () => {
    if (rafId) cancelAnimationFrame(rafId)
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onUp)
  }
  applyFreshBadges()   // 星河重建(字型載入/改視窗寬)後,把「有新進展」重新掛回星星上
}
// 字型載入後寬度會變 → 重建一次確保接縫無誤;視窗改寬也重建
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (riverWishes.length) buildStarRiver(riverWishes) })
let riverResizeT = null
addEventListener('resize', () => { clearTimeout(riverResizeT); riverResizeT = setTimeout(() => { if (riverWishes.length) buildStarRiver(riverWishes) }, 250) })

/* ============ 願望燈打開:bottom-sheet(情感層 + 「我來幫忙實現」折疊層) ============ */
const sheetBg = $('#sheet-bg'), sheet = $('#sheet')
function closeSheet() { sheetBg.classList.remove('open'); sheet.innerHTML = ''; openSheetId = null; document.body.style.overflow = '' }
sheetBg.addEventListener('click', (e) => { if (e.target === sheetBg) closeSheet() })
addEventListener('keydown', (e) => { if (e.key === 'Escape' && openSheetId != null) closeSheet() })

// ============ 巢狀回覆(issue #7):留言/缺口回答共用的渲染 —— 回覆一則留言、
// 標記「這解決了我的問題」、討論量大時摺疊過往回覆(一次先顯示最近 3 則)。============
const REPLY_SHOW = 3

function renderEchoNode(r, w, tagNew) {
  const rr = el('div', 'echo' + (r.is_solution ? ' solved' : ''))
  const body = el('div')
  linkifyInto(body, r.body)
  tagNew(body, r.created_at)
  rr.appendChild(body)
  rr.appendChild(el('div', 'wisher', r.nickname ? `—— ${r.nickname}` : '—— 有人輕聲說'))
  rr.appendChild(renderResponseExtras(r, w, tagNew))
  return rr
}

function renderReplyNode(r, tagNew) {
  const rr = el('div', 'echo reply' + (r.is_solution ? ' solved' : ''))
  const body = el('div')
  linkifyInto(body, r.body)
  tagNew(body, r.created_at)
  rr.appendChild(body)
  rr.appendChild(el('div', 'wisher', r.nickname ? `—— ${r.nickname}` : '—— 有人回覆'))
  if (r.is_solution) rr.appendChild(el('span', 'phrase done', '已解答'))
  else { const b = el('button', 'echo-solve', '這解決了我的問題'); b.onclick = () => markSolved(r.id); rr.appendChild(b) }
  return rr
}

// 一則留言/回答共用的動作列(標記已解答/回覆)+ 掛在它下面的巢狀回覆(只做一層,見 addResponse 的攤平邏輯)
function renderResponseExtras(r, w, tagNew) {
  const frag = document.createDocumentFragment()
  const bar = el('div', 'echo-actions')
  if (r.is_solution) bar.appendChild(el('span', 'phrase done', '已解答'))
  else { const b = el('button', 'echo-solve', '這解決了我的問題'); b.onclick = () => markSolved(r.id); bar.appendChild(b) }
  const replyBtn = el('button', 'echo-reply', '回覆')
  replyBtn.onclick = () => replyTo(w.id, r.id)
  bar.appendChild(replyBtn)
  frag.appendChild(bar)

  const kids = w.responses.filter((x) => x.parent_id === r.id).sort((a, b) => a.created_at - b.created_at)
  if (kids.length) {
    const list = el('div', 'replies')
    const older = kids.length > REPLY_SHOW ? kids.slice(0, kids.length - REPLY_SHOW) : []
    const recent = kids.length > REPLY_SHOW ? kids.slice(kids.length - REPLY_SHOW) : kids
    recent.forEach((h) => list.appendChild(renderReplyNode(h, tagNew)))
    if (older.length) {
      const anchor = list.firstChild
      const more = el('button', 'echo-more', `顯示更早的 ${older.length} 則回覆`)
      more.onclick = () => { more.remove(); older.forEach((h) => list.insertBefore(renderReplyNode(h, tagNew), anchor)) }
      list.insertBefore(more, anchor)
    }
    frag.appendChild(list)
  }
  return frag
}

async function openSheet(id) {
  let w
  try { w = await api(`/api/wishes/${id}`) } catch (e) { alert('這個願望暫時打不開,請稍後再試'); return }
  openSheetId = id
  // 標已看:先留住上次看到哪(newSince),再覆寫 seen 記錄;newSince 之後的項目在下方標「新」
  const watchSeen = getWatch()
  const prevSeen = watchSeen[id] ?? null
  const newSince = prevSeen && prevSeen.at != null ? prevSeen.at : null
  if (prevSeen) { watchSeen[id] = { t: activityTotal(w), s: w.status, at: lastActivityAt(w) }; setWatch(watchSeen) }
  clearFresh(id)
  const tagNew = (node, createdAt) => { if (newSince != null && createdAt > newSince) node.appendChild(el('span', 'tag-new', '新')) }
  document.body.style.overflow = 'hidden'
  sheet.innerHTML = ''
  sheetBg.classList.add('open')

  const head = el('div', 'sheet-head')
  head.appendChild(el('span', 'phrase ' + w.status, PHRASE[w.status] || ''))
  if (w.difficulty) head.appendChild(el('span', 'phrase', `規模:${w.difficulty}`))
  // 分享集氣:連結走 worker 的 /s/:id,爬蟲才讀得到這個願望自己的 OG 卡(hash 爬蟲不看)
  const shareBtn = el('button', 'sheet-share', '分享集氣')
  shareBtn.onclick = async () => {
    const url = `${API}/s/${w.id}`
    if (navigator.share) {
      try { await navigator.share({ title: w.title, text: `幫這個願望集氣:${w.title}`, url }) } catch { /* 使用者取消 */ }
      return
    }
    try { await navigator.clipboard.writeText(url) } catch { window.prompt('複製這個連結分享:', url); return }
    shareBtn.textContent = '連結已複製'
    setTimeout(() => { shareBtn.textContent = '分享集氣' }, 2000)
  }
  head.appendChild(shareBtn)
  const x = el('button', 'sheet-close', '關')
  x.setAttribute('aria-label', '關閉')
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
      const shot = repoPreview(acc.repo_url)
      if (shot) { const im = el('img', 'shot'); im.src = shot; im.alt = '實現成果預覽'; im.loading = 'lazy'; cele.appendChild(im) }
      const link = el('a', 'celebrate-repo')
      link.href = acc.repo_url; link.textContent = acc.repo_url
      link.target = '_blank'; link.rel = 'noopener nofollow'
      cele.appendChild(link)
      if (acc.github_handle) { const byp = el('p', 'wisher', '由 '); byp.appendChild(ghLink(acc.github_handle)); byp.append(' 實現'); cele.appendChild(byp) }
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
  coinBtn.setAttribute('aria-label', '為這個願望投一枚許願幣,免費,像按讚一樣')
  coinBtn.append('投一枚許願幣(免費) ', el('span', 'coin-count', String(w.votes)))
  coinBtn.onclick = () => tossCoinFor(w.id, coinBtn)
  act.appendChild(coinBtn)
  const echoBtn = el('button', null, '留言:我也想要 / 我有想法')
  echoBtn.onclick = () => sendEcho(w.id)
  act.appendChild(echoBtn)
  if (w.discussion_url) {
    const disc = el('a', 'repo-link', '到 GitHub 參與這個願望的討論')
    disc.href = w.discussion_url; disc.target = '_blank'; disc.rel = 'noopener'
    disc.style.alignSelf = 'center'
    act.appendChild(disc)
  }
  sheet.appendChild(act)

  // 共鳴聲(responses;有 question_id 的已掛在缺口下,這裡只放自由留言的頂層;
  // 巢狀回覆掛在各自留言下 —— 討論量大時摺疊過往回覆+可切換新舊排序(issue #7)
  const freeEchoes = w.responses.filter((r) => !r.question_id && !r.parent_id)
  if (freeEchoes.length) {
    const labelRow = el('div', 'sheet-label-row')
    labelRow.appendChild(el('p', 'sheet-label', `池邊的討論(${freeEchoes.length})`))
    const echoList = el('div')
    const ECHO_SHOW = 5
    const renderEchoes = () => {
      echoList.innerHTML = ''
      const sorted = [...freeEchoes].sort((a, b) => (echoNewestFirst ? b.created_at - a.created_at : a.created_at - b.created_at))
      sorted.slice(0, ECHO_SHOW).forEach((r) => echoList.appendChild(renderEchoNode(r, w, tagNew)))
      const rest = sorted.slice(ECHO_SHOW)
      if (rest.length) {
        const more = el('button', 'echo-more', `顯示更多(還有 ${rest.length} 則)`)
        more.onclick = () => { more.remove(); rest.forEach((r) => echoList.appendChild(renderEchoNode(r, w, tagNew))) }
        echoList.appendChild(more)
      }
    }
    if (freeEchoes.length > 1) {
      const sortBtn = el('button', 'sort-toggle', echoNewestFirst ? '新→舊' : '舊→新')
      sortBtn.onclick = () => { echoNewestFirst = !echoNewestFirst; sortBtn.textContent = echoNewestFirst ? '新→舊' : '舊→新'; renderEchoes() }
      labelRow.appendChild(sortBtn)
    }
    sheet.appendChild(labelRow)
    sheet.appendChild(echoList)
    renderEchoes()
  }

  // GitHub 討論串內嵌(giscus,綁定該願望專屬 discussion number;沿用 catime 模式)
  if (w.discussion_url) {
    const dnum = Number((w.discussion_url.match(/\/discussions\/(\d+)/) || [])[1])
    if (dnum) {
      sheet.appendChild(el('p', 'sheet-label', '這個願望的討論串'))
      const subHint = el('p', 'muted sub-hint')
      subHint.append('想在這個願望有新實作、認領或進度時收到通知:到 ')
      const subLink = el('a', 'repo-link', 'GitHub 串')
      subLink.href = w.discussion_url; subLink.target = '_blank'; subLink.rel = 'noopener'
      subHint.appendChild(subLink)
      subHint.append(' 按右上的 Subscribe(訂閱),GitHub 會幫你寄通知 —— 免費,只要有 GitHub 帳號。')
      sheet.appendChild(subHint)
      const gbox = el('div', 'giscus-box')
      const gs = document.createElement('script')
      gs.src = 'https://giscus.app/client.js'
      gs.setAttribute('data-repo', 'yazelin/wish-pool')
      gs.setAttribute('data-repo-id', 'R_kgDOTKaXyw')
      gs.setAttribute('data-category', 'Ideas')
      gs.setAttribute('data-category-id', 'DIC_kwDOTKaXy84DAW1T')
      gs.setAttribute('data-mapping', 'number')
      gs.setAttribute('data-term', String(dnum))
      gs.setAttribute('data-strict', '0')
      gs.setAttribute('data-reactions-enabled', '1')
      gs.setAttribute('data-emit-metadata', '0')
      gs.setAttribute('data-input-position', 'top')
      gs.setAttribute('data-theme', isDay() ? 'light' : 'dark_dimmed')
      gs.setAttribute('data-lang', 'zh-TW')
      gs.setAttribute('data-loading', 'lazy')
      gs.crossOrigin = 'anonymous'; gs.async = true
      gbox.appendChild(gs)
      sheet.appendChild(gbox)
    }
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

  // 女神的整理筆記:引導對話中問到、五欄裝不下的細節(使用情境、偏好、取捨)—— 公開,給實作者
  if (w.notes) {
    hv.appendChild(el('p', 'sheet-label', '女神的整理筆記'))
    hv.appendChild(el('p', 'hope goddess-notes', w.notes))
  }

  hv.appendChild(el('p', 'sheet-label', `還缺什麼(${w.needs.length})`))
  if (w.needs.length) w.needs.forEach((n) => {
    const label = { info: '缺資訊', skill: '缺技能', resource: '缺資源' }[n.type] || '缺資訊'
    const state = n.state || (n.resolved ? 'resolved' : 'open')
    const stateText = { answered: '已有候選回答,待確認', assumed: 'Agent 假設,可修正', resolved: '已解決', superseded: '已取代' }[state]
    const closed = state === 'resolved' || state === 'superseded'
    const wrap = el('div', 'need ' + state)
    wrap.appendChild(el('div', null, `[${label}] ${n.body}${stateText ? ` (${stateText})` : ''}`))
    // 掛在這個缺口下的回答(含各自的巢狀回覆/標記已解答 —— issue #7)
    w.responses.filter((r) => r.question_id === n.id && !r.parent_id).forEach((r) => {
      const a = el('div', 'need-answer' + (r.is_solution ? ' solved' : ''))
      const ab = el('div'); linkifyInto(ab, r.body); tagNew(ab, r.created_at); a.appendChild(ab)
      a.appendChild(el('div', 'wisher', r.nickname ? `—— ${r.nickname}` : '—— 有人回答'))
      a.appendChild(renderResponseExtras(r, w, tagNew))
      wrap.appendChild(a)
    })
    if (!closed) {
      const ab = el('button', 'need-reply', state === 'open' ? '回答這題' : '補充 / 確認這題')
      ab.onclick = () => answerNeed(w.id, n.id)
      wrap.appendChild(ab)
    }
    hv.appendChild(wrap)
  })
  else hv.appendChild(el('p', 'muted', '目前沒有列出缺口'))

  hv.appendChild(el('p', 'sheet-label', `實現的腳步(${w.updates.length})`))
  if (w.updates.length) w.updates.forEach((u) => {
    const kind = { claim: '我來實現', progress: '進度', blocked: '卡關' }[u.kind] || '進度'
    const line = el('div', 'update')
    line.appendChild(el('span', 'update-kind ' + u.kind, kind))
    const ub = el('span'); ub.append(' '); linkifyInto(ub, u.body); line.appendChild(ub)
    if (u.github_handle) { const uw = el('span', 'wisher', '  '); uw.appendChild(ghLink(u.github_handle)); line.appendChild(uw) }
    tagNew(line, u.created_at)
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
    tagNew(top, a.created_at)
    ans.appendChild(top)
    const ashot = repoPreview(a.repo_url)
    if (ashot) { const im = el('img', 'shot shot-sm'); im.src = ashot; im.alt = '實作預覽'; im.loading = 'lazy'; ans.appendChild(im) }
    if (a.note) { const nd = el('div'); linkifyInto(nd, a.note); ans.appendChild(nd) }
    const foot = el('div', 'answer-foot')
    const vb = el('button', 'vote'); vb.setAttribute('aria-label', '為這個實作版本投一枚幣')
    vb.append('投幣 ', el('span', null, String(a.votes)))
    vb.onclick = () => voteAnswer(a.id, vb)
    foot.appendChild(vb)
    if (a.github_handle) { const fw = el('span', 'wisher'); fw.appendChild(ghLink(a.github_handle)); foot.appendChild(fw) }
    ans.appendChild(foot)
    hv.appendChild(ans)
  })

  const tools = el('div', 'helper-tools')
  const claim = el('button', null, '我來實現'); claim.onclick = () => submitUpdate(w.id, true)
  const prog = el('button', null, '回報進度'); prog.onclick = () => submitUpdate(w.id, false)
  const ansB = el('button', 'primary', '交實作 / 指路現成專案'); ansB.onclick = () => submitAnswer(w.id)
  const needB = el('button', null, '補一個缺口'); needB.onclick = () => submitNeed(w.id)
  const dl = el('button', null, '下載規格'); dl.onclick = () => downloadSpec(w)
  ;[claim, prog, ansB, needB, dl].forEach((b) => tools.appendChild(b))
  const shop = el('a', 'repo-link', '協作指南(人與 AI 怎麼幫忙)'); shop.href = 'collab.html'
  shop.style.marginRight = '14px'
  const board = el('a', 'repo-link', '前往工坊'); board.href = 'board.html'
  hv.appendChild(tools); hv.appendChild(shop); hv.appendChild(board)
  helper.appendChild(hv)
  sheet.appendChild(helper)
}

async function refreshSheet() {
  if (openSheetId == null) return
  const id = openSheetId
  // 保留協力層展開狀態與捲動位置(避免每次動作後被彈回頂部、折疊層收合)
  const wasOpen = !!$('#sheet .helper')?.open
  const scrollTop = sheet.scrollTop
  await openSheet(id)
  const h = $('#sheet .helper')
  if (h && wasOpen) h.open = true
  sheet.scrollTop = scrollTop
}

/* ============ 動作(全部沿用既有 API;成功後刷新 sheet) ============ */
async function tossCoinFor(id, btn) {
  btn.disabled = true
  const r = btn.getBoundingClientRect()
  pond.coin(r.left + r.width / 2, Math.min(innerHeight - 60, r.top - 8), () => {})
  const countEl = btn.querySelector('.coin-count')
  const prev = Number(countEl.textContent)
  countEl.textContent = prev + 1   // 樂觀更新,伺服器回來校正
  try {
    const token = await getTurnstileToken()
    const res = await api(`/api/wishes/${id}/vote`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ turnstileToken: token }),
    })
    countEl.textContent = res.votes
    if (res.ok) btn.disabled = false
    const cached = wishCache.find((x) => x.id === id); if (cached) cached.votes = res.votes
    if (!res.ok) btn.title = '你已經投過這個願望了'
  } catch (e) { countEl.textContent = prev; btn.disabled = false; alert('投幣沒成功,請稍後再試') }
}

async function answerNeed(wishId, needId) {
  const v = await askForm('回答這個缺口', [
    { name: 'body', type: 'textarea', label: '你的回答(會掛在缺口下,缺口自動標已解;有連結直接貼)', required: true },
    { name: 'nickname', label: '留個名字(可留空)' },
  ])
  if (!v) return
  try {
    const token = await getTurnstileToken()
    await api(`/api/wishes/${wishId}/responses`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ turnstileToken: token, body: v.body, nickname: v.nickname, kind: 'answer', questionId: needId }),
    })
    watchWish(wishId)   // 成功才記關注(refreshSheet 會馬上把現況標為已看)
    await refreshSheet()
  } catch (e) { alert('送出失敗,請稍後再試') }
}

async function sendEcho(wishId) {
  const v = await askForm('留言給這個願望', [
    { name: 'body', type: 'textarea', label: '想說什麼?(例:我也想要,而且希望能…)', required: true },
    { name: 'nickname', label: '留個名字(可留空)' },
  ])
  if (!v) return
  try {
    const token = await getTurnstileToken()
    await api(`/api/wishes/${wishId}/responses`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ turnstileToken: token, body: v.body, nickname: v.nickname, kind: 'metoo' }),
    })
    watchWish(wishId)
    await refreshSheet()
  } catch (e) { alert('送出失敗,請稍後再試') }
}

async function replyTo(wishId, parentId) {
  const v = await askForm('回覆這則留言', [
    { name: 'body', type: 'textarea', label: '回覆內容', required: true },
    { name: 'nickname', label: '留個名字(可留空)' },
  ])
  if (!v) return
  try {
    const token = await getTurnstileToken()
    await api(`/api/wishes/${wishId}/responses`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ turnstileToken: token, body: v.body, nickname: v.nickname, kind: 'answer', parentId }),
    })
    watchWish(wishId)
    await refreshSheet()
  } catch (e) { alert('送出失敗,請稍後再試') }
}

// 許願者標記「這則回答/回覆解決了我的問題」——沒有登入機制辨識誰是許願者,與池子其它公開動作一樣走榮譽制。
async function markSolved(responseId) {
  if (!confirm('把這則標記為「解決了我的問題」?')) return
  try {
    const token = await getTurnstileToken()
    await api(`/api/responses/${responseId}/solve`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ turnstileToken: token }),
    })
    await refreshSheet()
  } catch (e) { alert('標記失敗,請稍後再試') }
}

async function postWithTurnstile(path, payload, okMsg, watchId) {
  try {
    const token = await getTurnstileToken()
    await api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, turnstileToken: token }) })
    if (watchId != null) watchWish(watchId)   // 成功才記關注,取消/失敗不留假「有新進展」
    alert(okMsg)
    await refreshSheet()
  } catch (e) { alert(e.status === 429 ? '今天次數已達上限,明天再來' : '送出失敗,請稍後再試') }
}
async function submitAnswer(wishId) {
  const v = await askForm('交實作 / 指路現成專案', [
    { name: 'repo', label: 'repo 網址(自己做的,或幫忙指路的現成專案)', placeholder: 'https://github.com/...', required: true,
      check: (x) => (/^https?:\/\//.test(x) ? null : '請貼有效的 http(s) 網址') },
    { name: 'note', type: 'textarea', label: '一句話說明(指路請註明「已有現成」,可留空)' },
    { name: 'handle', label: '你的 GitHub 帳號(選填,成真時掛名)' },
  ])
  if (!v) return
  await postWithTurnstile(`/api/wishes/${wishId}/answers`, { repo_url: v.repo, note: v.note, github_handle: v.handle }, '收到你的實作,謝謝你讓願望往前一步', wishId)
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
  const fields = isClaim
    ? [{ name: 'body', type: 'textarea', label: '跟大家說一聲你要實現它。建議順手開一個 repo 把連結貼在這裡 —— 其他有興趣的朋友就能直接 fork / PR 一起做', required: true },
       { name: 'handle', label: '你的 GitHub 帳號(選填)' }]
    : [{ name: 'kind', type: 'select', label: '這是進度還是卡關?', options: [['progress', '進度'], ['blocked', '卡關']] },
       { name: 'body', type: 'textarea', label: '說明(例:做到 X / 卡在 Y;有連結直接貼,會自動變可點)', required: true },
       { name: 'handle', label: '你的 GitHub 帳號(選填)' }]
  const v = await askForm(isClaim ? '我來實現這個願望' : '回報進度 / 卡關', fields)
  if (!v) return
  const kind = isClaim ? 'claim' : (v.kind || 'progress')
  await postWithTurnstile(`/api/wishes/${wishId}/updates`, { kind, body: v.body, github_handle: v.handle }, isClaim ? '已記下 —— 這個願望有了實現它的人(狀態自動進「實現中」)' : '進度已記下,謝謝', wishId)
}
async function submitNeed(wishId) {
  const v = await askForm('補一個缺口', [
    { name: 'type', type: 'select', label: '缺什麼類型', options: [['info', '缺資訊'], ['skill', '缺技能'], ['resource', '缺資源']] },
    { name: 'body', type: 'textarea', label: '這個願望還缺什麼?', required: true },
  ])
  if (!v) return
  await postWithTurnstile(`/api/wishes/${wishId}/needs`, { type: v.type || 'info', body: v.body }, '缺口已補上,謝謝')
}
async function downloadSpec(w) {
  try {
    const res = await fetch(`${API}/api/wishes/${w.id}/spec`)
    if (!res.ok) throw new Error('spec fetch failed')
    const text = await res.text()
    const blob = new Blob([text], { type: 'text/markdown' })
    const a = el('a'); const url = URL.createObjectURL(blob); a.href = url; a.download = `wish-${w.id}-spec.md`; a.click(); URL.revokeObjectURL(url)
  } catch (e) { alert('規格下載失敗,請稍後再試') }
}

/* ============ 排序 + deep-link ============ */
document.querySelectorAll('.sort[data-sort]').forEach((b) => b.onclick = () => {
  document.querySelectorAll('.sort[data-sort]').forEach((x) => { x.classList.remove('active'); x.setAttribute('aria-pressed', 'false') })
  b.classList.add('active'); b.setAttribute('aria-pressed', 'true'); currentSort = b.dataset.sort; loadPond()
})
document.querySelectorAll('.sort[data-sort]').forEach((b) => b.setAttribute('aria-pressed', b.classList.contains('active') ? 'true' : 'false'))

/* 主題切換:預設晨光,可切夜晚(記在 localStorage) */
const themeBtn = $('#theme-toggle')
function syncThemeBtn() { themeBtn.textContent = isDay() ? '夜' : '晨' }
themeBtn.onclick = () => {
  document.documentElement.classList.toggle('theme-day')
  try { localStorage.setItem('wishpool_theme', isDay() ? 'day' : 'night') } catch (e) { /* ignore */ }
  syncThemeBtn()
}
syncThemeBtn()

loadPond().then(() => {
  const m = location.hash.match(/^#wish-(\d+)$/)
  if (m) openSheet(Number(m[1]))
})

/* ============ 感謝名單(footer 上方;載不到或全空就保持隱藏) ============ */
async function loadCredits() {
  try {
    const d = await api('/api/credits')
    const fill = (rootSel, items, mkChip, noteText) => {
      const root = $(rootSel)
      const chips = root.querySelector('.credits-chips')
      const note = root.querySelector('.credits-note')
      items.forEach((it) => chips.appendChild(mkChip(it)))
      if (noteText) { note.textContent = noteText; note.hidden = false }
      const has = items.length > 0 || !!noteText
      root.hidden = !has
      return has
    }
    const hasW = fill('#credits-wishers', d.wishers, (w) => {
      const s = el('span', 'badge', w.nickname)
      s.title = `許下 ${w.wishes} 個願望`
      return s
    }, d.anonymous_wishes > 0 ? `以及 ${d.anonymous_wishes} 則匿名願望` : '')
    const hasI = fill('#credits-implementers', d.implementers, (p) => {
      const a = ghLink(p.handle)   // 既有 helper:handle 格式驗證+noopener nofollow,壞格式退純文字
      a.classList.add('badge')
      if (p.adopted > 0) a.textContent = '★ ' + a.textContent
      a.title = `交出 ${p.answers} 份實作` + (p.adopted > 0 ? `,${p.adopted} 份被採用` : '')
      return a
    }, d.unsigned_answers > 0 ? `以及 ${d.unsigned_answers} 份未署名實作` : '')
    $('#credits').hidden = !(hasW || hasI)
  } catch (e) { /* 感謝名單非關鍵路徑,失敗不打擾 */ }
}
loadCredits()

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
  botSay('(湖面泛起漣漪,女神緩緩浮出)孩子,你想要的,是一個什麼樣的作品呢?一句話說說看 —— 工具、遊戲、小服務都可以。')
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
  if (r.difficulty) form.appendChild(el('div', 'need', `女神評的規模:${r.difficulty}`))
  if (r.notes) {
    const nt = el('div', 'need goddess-notes', '女神的整理筆記(會跟願望一起公開,給實作者看):\n' + r.notes)
    form.appendChild(nt)
  }
  if (r.gaps?.length) {
    form.appendChild(el('div', 'need', '女神列的實作缺口(會一起放進「還缺什麼」):' + r.gaps.map((g) => g.body).join('; ')))
  }
  if (chatMessages.length) {
    form.appendChild(el('p', 'muted', '送出時,你與女神的對話會一併保存(僅站主可見,用來讓女神越來越會引導)'))
  }
  // 送出前先講明白哪些情況會進待審(與後端伺服器端重審的三條守則、送出後的結果訊息同一套說法)
  const notice = el('p', 'muted', [
    '送出後女神會看過最終內容(改過欄位也會再看一次),通過就直接上牆。以下情況會先收進待審、由站主確認後上牆:',
    '- 復刻現有作品,且堅持使用原作素材或名稱(版權)',
    '- 幫既有工具/網站加功能(池子收的是還不存在的作品,建議去該專案的 GitHub Issues 提)',
    '- 內容與「想要一個作品」無關',
    '女神一時忙不過來或拿不準時,也會先收進待審。',
  ].join('\n'))
  notice.style.whiteSpace = 'pre-line'
  form.appendChild(notice)
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
    // notes = 女神的整理筆記(公開,給實作者;五欄裝不下的使用情境/偏好/取捨)
    wish: { title, problem: get('problem'), current: get('current'), desired: get('desired'), who: get('who'), nickname: get('nickname') || undefined, difficulty: r.difficulty || undefined, notes: r.notes || undefined },
    open_questions: r.open_questions || [],
    gaps: r.gaps || [],
    verdict: r.verdict, // 只有 AI final 且 ok 才會直接入池;純表單(無 verdict)進審核
    sig: r.sig,         // /api/refine 對 ok 內容的簽章;後端驗簽通過才 published,改過/偽造 -> pending
    // 與女神的前導對話原文一併保存(僅站主可見;後端有 role/則數/長度上限)。純表單沒有對話就不帶。
    messages: chatMessages.length ? chatMessages : undefined,
  }
  try {
    const token = await getTurnstileToken()
    payload.turnstileToken = token
    const res = await api('/api/wishes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    })
    closeModal()
    // 許願即記關注(含 pending:之後上牆=狀態變化,回站會亮「有新進展」);at:0 = 之後的每筆動靜都算新
    watchWish(res.id, { t: 0, s: res.status, at: 0 })
    // 自動媒合(issue #4):池裡已有相似願望就順帶提一句「可能有人做過」;只推薦不擋送出。
    // alert 是純文字,標題直接插值不會有 XSS。
    const similar = Array.isArray(res.similar) ? res.similar : []
    const similarNote = similar.length
      ? '\n\n順帶一提,池裡已有相似的願望,這個願望可能有人做過:\n' + similar.map((s) =>
          `・#${s.id} ${s.title}${s.answers_count ? `(已有 ${s.answers_count} 個實作)` : ''}`).join('\n') +
        '\n可以去投幣共鳴、或直接看它的實作。'
      : ''
    if (res.status === 'published') {
      pond.coin(innerWidth / 2, innerHeight * .45, () => {})
      alert('女神看過你的版本,直接上牆了。等等會幫你打開它 —— 之後回到這裡,有新實作或進度時你的願望會亮「有新進展」;想收 email 通知,可到它的討論串按 Subscribe(需 GitHub 帳號)' + similarNote)
      await loadPond()
      setTimeout(() => openSheet(res.id), 1800)   // 等自動開串一拍,打開時討論區就在
    } else {
      // pending:後端會附一句原因(重審不過的守則 / 女神一時忙不過來)
      const why = res.reason ? '(' + res.reason + ')' : ''
      alert(`已收下,女神想請站主再看一眼${why}。站主確認後就會出現在池面上 —— 之後回到這裡,它上牆或有動靜時會亮「有新進展」` + similarNote)
    }
  } catch (e) {
    if (submit) submit.disabled = false
    alert(e.status === 429 ? '今天投的願望已達上限,明天再來' : '送出失敗,請稍後再試')
  }
}

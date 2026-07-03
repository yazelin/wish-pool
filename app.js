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

// D:記住你參與過的願望(許願/認領/回報/交實作/留言),回站比對動態數,亮「有新進展」
const WATCH_KEY = 'wishpool_watch'
function getWatch() { try { return JSON.parse(localStorage.getItem(WATCH_KEY)) || {} } catch (e) { return {} } }
function setWatch(w) { try { localStorage.setItem(WATCH_KEY, JSON.stringify(w)) } catch (e) { /* ignore */ } }
function watchWish(id, total) { const w = getWatch(); if (total != null || w[id] == null) w[id] = total ?? 0; setWatch(w) }
function activityTotal(w) { return (w.answers?.length || 0) + (w.updates?.length || 0) + (w.responses?.length || 0) }

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
  // 點水面本身也起漣漪(純氛圍)
  addEventListener('pointerdown', (e) => { if (e.target === document.body || e.target === cv) ripple(e.clientX, e.clientY) })
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
    const { wishes } = await api(`/api/wishes?sort=${currentSort}&limit=100`)
    wishCache = wishes
    const done = wishes.filter((w) => w.status === 'done')
    const floating = wishes.filter((w) => w.status !== 'done')
    lan.innerHTML = ''
    $('#starband-wrap').style.display = done.length ? '' : 'none'
    buildStarRiver(done)
    floating.forEach((w) => lan.appendChild(renderLantern(w)))
    note.textContent = '池面還很安靜 —— 投下第一個願望吧。'
    note.style.display = floating.length ? 'none' : 'block'
  } catch (e) {
    $('#starband-wrap').style.display = 'none'
    note.textContent = '池水暫時看不清,請稍後再試。'
    note.style.display = 'block'
  }
  checkWatched()
}

async function checkWatched() {
  const watch = getWatch()
  const ids = Object.keys(watch).slice(0, 15)
  if (!ids.length) return
  let freshCount = 0
  await Promise.all(ids.map(async (id) => {
    try {
      const w = await api(`/api/wishes/${id}`)
      if (activityTotal(w) > watch[id]) {
        freshCount++
        const card = document.getElementById('wish-' + id)
        if (card && !card.querySelector('.phrase.fresh')) card.prepend(el('span', 'phrase fresh', '有新進展'))
      }
    } catch (e) { if (e.status === 404) { delete watch[id]; setWatch(watch) } }
  }))
  document.getElementById('watch-note')?.remove()
  if (freshCount) {
    const n = el('p', 'muted', `你參與過的願望有 ${freshCount} 則新動靜 —— 找找亮「有新進展」的燈`)
    n.id = 'watch-note'; n.style.textAlign = 'center'
    $('#lanterns').before(n)
  }
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

async function openSheet(id) {
  let w
  try { w = await api(`/api/wishes/${id}`) } catch (e) { alert('這個願望暫時打不開,請稍後再試'); return }
  openSheetId = id
  const watchSeen = getWatch()
  if (watchSeen[id] != null) { watchSeen[id] = activityTotal(w); setWatch(watchSeen) }
  document.querySelector(`#wish-${id} .phrase.fresh`)?.remove()
  document.body.style.overflow = 'hidden'
  sheet.innerHTML = ''
  sheetBg.classList.add('open')

  const head = el('div', 'sheet-head')
  head.appendChild(el('span', 'phrase ' + w.status, PHRASE[w.status] || ''))
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

  // 共鳴聲(responses;有 question_id 的已掛在缺口下,這裡只放自由留言)
  const freeEchoes = w.responses.filter((r) => !r.question_id)
  if (freeEchoes.length) {
    sheet.appendChild(el('p', 'sheet-label', `池邊的討論(${freeEchoes.length})`))
    freeEchoes.forEach((r) => {
      const rr = el('div', 'echo')
      rr.appendChild(el('div', null, r.body))
      rr.appendChild(el('div', 'wisher', r.nickname ? `—— ${r.nickname}` : '—— 有人輕聲說'))
      sheet.appendChild(rr)
    })
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

  hv.appendChild(el('p', 'sheet-label', `還缺什麼(${w.needs.length})`))
  if (w.needs.length) w.needs.forEach((n) => {
    const label = { info: '缺資訊', skill: '缺技能', resource: '缺資源' }[n.type] || '缺資訊'
    const wrap = el('div', 'need' + (n.resolved ? ' resolved' : ''))
    wrap.appendChild(el('div', null, `[${label}] ${n.body}`))
    // 掛在這個缺口下的回答
    w.responses.filter((r) => r.question_id === n.id).forEach((r) => {
      const a = el('div', 'need-answer')
      a.appendChild(el('span', null, r.body))
      a.appendChild(el('span', 'wisher', r.nickname ? ` —— ${r.nickname}` : ' —— 有人回答'))
      wrap.appendChild(a)
    })
    if (!n.resolved) {
      const ab = el('button', 'need-reply', '回答這題')
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
    const ashot = repoPreview(a.repo_url)
    if (ashot) { const im = el('img', 'shot shot-sm'); im.src = ashot; im.alt = '實作預覽'; im.loading = 'lazy'; ans.appendChild(im) }
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
  watchWish(wishId)
  const body = prompt('你的回答(會掛在這個缺口下,缺口會標為已解):')
  if (!body || !body.trim()) return
  const nickname = prompt('留個名字嗎?(可留空)') || undefined
  try {
    const token = await getTurnstileToken()
    await api(`/api/wishes/${wishId}/responses`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ turnstileToken: token, body: body.trim(), nickname, kind: 'answer', questionId: needId }),
    })
    await refreshSheet()
  } catch (e) { alert('送出失敗,請稍後再試') }
}

async function sendEcho(wishId) {
  watchWish(wishId)
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
  watchWish(wishId)
  const repo = prompt('repo 網址(自己做的,或你知道的現成專案都可以 —— 幫忙指路也算實現):')
  if (!repo || !/^https?:\/\//.test(repo.trim())) { if (repo !== null) alert('請貼有效的 http(s) 網址'); return }
  const note = prompt('一句話說明(指路現成專案請註明「已有現成」,可留空):') || undefined
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
  watchWish(wishId)
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
  const nick = (r) => (r.nickname ? `(${r.nickname})` : '')
  const lines = [
    `# ${w.title}`, '',
    `- 想解決:${w.problem || ''}`, `- 現況:${w.current || ''}`, `- 期望:${w.desired || ''}`, `- 誰會用:${w.who || ''}`, '',
    '## 還缺什麼(含大家補的回答)',
    ...(w.needs || []).flatMap((n) => [
      `- [${n.resolved ? 'x' : ' '}] (${n.type}) ${n.body}`,
      ...(w.responses || []).filter((r) => r.question_id === n.id).map((r) => `  - 答:${r.body}${nick(r)}`),
    ]),
    '',
  ]
  const freeEchoes = (w.responses || []).filter((r) => !r.question_id)
  if (freeEchoes.length) lines.push('## 池邊的討論(需求補充)', ...freeEchoes.map((r) => `- ${r.body}${nick(r)}`), '')
  if ((w.updates || []).length) lines.push('## 實現的腳步', ...w.updates.map((u) => `- ${u.kind}: ${u.body}${u.github_handle ? ' @' + u.github_handle : ''}`), '')
  if ((w.answers || []).length) lines.push('## 已有的實作版本(別重造輪子)', ...w.answers.map((a) => `- ${a.repo_url}${a.note ? ` — ${a.note}` : ''}${a.github_handle ? ' @' + a.github_handle : ''}`), '')
  if (w.discussion_url) lines.push(`討論串:${w.discussion_url}`)
  lines.push(`願望連結:${location.origin}${location.pathname}#wish-${w.id}`)
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown' })
  const a = el('a'); const url = URL.createObjectURL(blob); a.href = url; a.download = `wish-${w.id}.md`; a.click(); URL.revokeObjectURL(url)
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
      watchWish(res.id, 0)
      alert('你的願望已經落進池裡了。等等會幫你打開它 —— 想收進展通知,可到它的討論串按 Subscribe(需 GitHub 帳號)')
      await loadPond()
      setTimeout(() => openSheet(res.id), 1800)   // 等自動開串一拍,打開時討論區就在
    } else alert('已收到,站方看過後就會出現在池面上,謝謝')
  } catch (e) {
    if (submit) submit.disabled = false
    alert(e.status === 429 ? '今天投的願望已達上限,明天再來' : '送出失敗,請稍後再試')
  }
}

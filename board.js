const API = window.WISHPOOL_CONFIG.WORKER_BASE
const $ = (s, r = document) => r.querySelector(s)
const el = (t, cls, txt) => { const e = document.createElement(t); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e }
const COLUMNS = [
  { status: 'published', label: '徵求中' },
  { status: 'adopted', label: '已採納' },
  { status: 'building', label: '開發中' },
  { status: 'done', label: '已實現' },
]
async function load() {
  const board = $('#board'); board.innerHTML = ''
  let wishes
  try {
    const res = await fetch(`${API}/api/wishes?sort=new&limit=100`)
    if (!res.ok) throw new Error('http ' + res.status)   // fetch 不會對 500 throw,要自己擋
    wishes = (await res.json()).wishes || []
  } catch (e) { $('#empty').style.display = 'block'; $('#empty').textContent = '載入失敗,請稍後重試。'; return }
  $('#empty').style.display = wishes.length ? 'none' : 'block'
  for (const col of COLUMNS) {
    const items = wishes.filter((w) => w.status === col.status)
    const section = el('section', 'board-col')
    section.appendChild(el('h2', 'board-col-h', `${col.label}(${items.length})`))
    if (!items.length) section.appendChild(el('p', 'muted', '—'))
    items.forEach((w) => {
      const c = el('a', 'board-card')
      c.href = `index.html#wish-${w.id}`
      c.appendChild(el('div', 'board-card-title', w.title))
      const meta = el('div', 'muted')
      meta.textContent = `▲ ${w.votes}` + (w.nickname ? ` · ${w.nickname}` : '')
      c.appendChild(meta)
      section.appendChild(c)
    })
    board.appendChild(section)
  }
}
load()

# 頁尾感謝名單(credits)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 主頁 footer 上方加「感謝有你」兩欄 chips 區塊(靈感=許願人、實現=實作者),資料來自新端點 `GET /api/credits`。

**Architecture:** worker 新增一條唯讀聚合 route(兩句 SELECT、TS 內聚合、edge cache 10 分鐘);前端 index.html 加一個 hidden section,app.js 啟動時非同步填入,失敗或全空保持隱藏。

**Tech Stack:** Cloudflare Worker (Hono) + D1、vitest + cloudflare:test、原生 JS 前端(無框架)。

**規格:** `docs/superpowers/specs/2026-07-14-credits-footer-design.md` · issue #34

## Global Constraints

- 公開狀態 = `published/adopted/building/done`(用 d1.ts 的 `PUBLIC_STATUSES`,別自己抄陣列)
- answers 只計 `status='visible'`;被採用 = `answers.id = wishes.accepted_answer_id`
- 排序:實作側 被採用數 desc → 交件數 desc → 首次貢獻時間 asc;靈感側 願望數 desc → 首願時間 asc(用穩定排序 + SQL `ORDER BY created_at` 達成時間序)
- 前端渲染只用既有 `el()` helper(textContent);連結 `target=_blank rel="noopener nofollow"`
- 樣式沿用 design tokens(`var(--muted)` 等)與 `.badge` pill,不寫死顏色
- Cache header:`public, max-age=60, s-maxage=600`;不加 cache-busting 參數
- commit 訊息附 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: `GET /api/credits` route(TDD)

**Files:**
- Test: `worker/test/credits.route.test.ts`(新建)
- Create: `worker/src/routes/credits.ts`
- Modify: `worker/src/index.ts`(import + mount)

**Interfaces:**
- Consumes: `PUBLIC_STATUSES`、`createWish`、`createAnswer`、`acceptAnswer`、`setAnswerStatus`(皆已存在於 `worker/src/lib/d1.ts`)
- Produces: `GET /api/credits` → `{ wishers: [{nickname, wishes}], anonymous_wishes, implementers: [{handle, answers, adopted}], unsigned_answers }`

- [ ] **Step 1: 寫失敗測試** `worker/test/credits.route.test.ts`:

```ts
// issue #34:GET /api/credits 感謝名單聚合 — 公開狀態才入榜、兩級排序、匿名/未署名彙總。
import { describe, it, expect, beforeEach } from 'vitest'
import { SELF, env } from 'cloudflare:test'

const O = 'https://test.local'

beforeEach(async () => {
  for (const t of ['answer_votes', 'answers', 'updates', 'needs', 'responses', 'open_questions', 'votes', 'wishes', 'rate_limits']) await env.DB.exec(`DELETE FROM ${t}`)
})

async function seedWish(status: string, nickname: string | null, now = 1000) {
  const { createWish } = await import('../src/lib/d1')
  return createWish(env.DB, { title: 'T', status, nickname: nickname ?? undefined, open_questions: [] }, now)
}
async function seedAnswer(wishId: number, handle: string | null, now = 2000) {
  const { createAnswer } = await import('../src/lib/d1')
  return createAnswer(env.DB, wishId, { repo_url: 'https://github.com/x/r', github_handle: handle ?? undefined }, now)
}

describe('GET /api/credits', () => {
  it('空池回 200 與空結構,帶 cache header', async () => {
    const res = await SELF.fetch(`${O}/api/credits`)
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toContain('s-maxage=600')
    expect(await res.json()).toEqual({ wishers: [], anonymous_wishes: 0, implementers: [], unsigned_answers: 0 })
  })

  it('聚合與兩級排序:被採用排前、大小寫合併、匿名/未署名彙總、非公開不入榜', async () => {
    const { acceptAnswer, setAnswerStatus } = await import('../src/lib/d1')
    // 靈感側:小綠葉 x2、段杯杯 x1、匿名 x1;pending 的暱稱不得出現
    const w1 = await seedWish('published', '小綠葉', 10)
    const w2 = await seedWish('done', '小綠葉', 20)
    const w3 = await seedWish('building', '段杯杯', 30)
    await seedWish('published', null, 40)
    await seedWish('pending', '不該出現', 50)
    const hid = await seedWish('hidden', '影子', 60)
    // 實作側:bob 1 份被採用;Alice/alice 2 份合併(顯示先出現的 Alice);未署名 1 份;
    // hidden 願望上的 answer 與 hidden answer 都不算
    const aB = await seedAnswer(w2, 'bob', 100)
    await acceptAnswer(env.DB, w2, aB)
    await seedAnswer(w1, 'Alice', 200)
    await seedAnswer(w3, 'alice', 300)
    await seedAnswer(w1, null, 400)
    await seedAnswer(hid, 'ghost', 500)
    const hiddenAns = await seedAnswer(w1, 'hider', 600)
    await setAnswerStatus(env.DB, hiddenAns, 'hidden')

    const res = await SELF.fetch(`${O}/api/credits`)
    const d = await res.json<any>()
    expect(d.wishers).toEqual([
      { nickname: '小綠葉', wishes: 2 },
      { nickname: '段杯杯', wishes: 1 },
    ])
    expect(d.anonymous_wishes).toBe(1)
    expect(d.implementers).toEqual([
      { handle: 'bob', answers: 1, adopted: 1 },
      { handle: 'Alice', answers: 2, adopted: 0 },
    ])
    expect(d.unsigned_answers).toBe(1)
  })
})
```

- [ ] **Step 2: 跑測試確認失敗** — `cd worker && npx vitest run test/credits.route.test.ts`,預期 404(route 不存在)導致斷言失敗。

- [ ] **Step 3: 實作** `worker/src/routes/credits.ts`:

```ts
import { Hono } from 'hono'
import type { Env } from '../env'
import { PUBLIC_STATUSES } from '../lib/d1'

// 感謝名單:靈感(公開願望的暱稱)與實現(visible answers 的 github_handle)聚合。
// 資料量小,SQL 只撈原始列、聚合在 TS 做;列已按 created_at 排,穩定排序天然保「首次出現先」。
export const credits = new Hono<{ Bindings: Env }>()

credits.get('/api/credits', async (c) => {
  const marks = PUBLIC_STATUSES.map(() => '?').join(',')
  const { results: wishRows } = await c.env.DB.prepare(
    `SELECT nickname FROM wishes WHERE status IN (${marks}) ORDER BY created_at`,
  ).bind(...PUBLIC_STATUSES).all<{ nickname: string | null }>()
  const { results: answerRows } = await c.env.DB.prepare(
    `SELECT a.github_handle AS handle, (a.id = w.accepted_answer_id) AS adopted
       FROM answers a JOIN wishes w ON w.id = a.wish_id
      WHERE a.status = 'visible' AND w.status IN (${marks})
      ORDER BY a.created_at`,
  ).bind(...PUBLIC_STATUSES).all<{ handle: string | null; adopted: number | null }>()

  const wishers = new Map<string, { nickname: string; wishes: number }>()
  let anonymousWishes = 0
  for (const r of wishRows) {
    const nick = (r.nickname ?? '').trim()
    if (!nick) { anonymousWishes++; continue }
    const cur = wishers.get(nick)
    if (cur) cur.wishes++
    else wishers.set(nick, { nickname: nick, wishes: 1 })
  }

  const implementers = new Map<string, { handle: string; answers: number; adopted: number }>()
  let unsignedAnswers = 0
  for (const r of answerRows) {
    const handle = (r.handle ?? '').trim()
    if (!handle) { unsignedAnswers++; continue }
    const key = handle.toLowerCase()
    const cur = implementers.get(key)
    if (cur) { cur.answers++; cur.adopted += r.adopted ? 1 : 0 }
    else implementers.set(key, { handle, answers: 1, adopted: r.adopted ? 1 : 0 })
  }

  c.header('Cache-Control', 'public, max-age=60, s-maxage=600')
  return c.json({
    wishers: [...wishers.values()].sort((a, b) => b.wishes - a.wishes),
    anonymous_wishes: anonymousWishes,
    implementers: [...implementers.values()].sort((a, b) => (b.adopted - a.adopted) || (b.answers - a.answers)),
    unsigned_answers: unsignedAnswers,
  })
})
```

`worker/src/index.ts` 加:

```ts
import { credits } from './routes/credits'
// ...與其他 route 並列
app.route('/', credits)
```

- [ ] **Step 4: 跑測試確認通過** — `npx vitest run test/credits.route.test.ts` 預期 2 passed;再跑全套 `npx vitest run` 確認無回歸。

- [ ] **Step 5: Commit** — `feat(api): GET /api/credits 感謝名單聚合(靈感+實現,兩級排序) (#34)`

---

### Task 2: 前端感謝區塊

**Files:**
- Modify: `index.html`(`<footer class="site-footer">` 之前,約 line 66)
- Modify: `styles.css`(檔尾 append)
- Modify: `app.js`(新增 `loadCredits()`;boot 處 `loadPond().then(...)` 附近呼叫,約 line 910)

**Interfaces:**
- Consumes: Task 1 的 `GET /api/credits` 回應形狀;既有 `api()`、`el()`、`$()` helpers 與 `.badge`、`.muted` 樣式

- [ ] **Step 1: index.html** — 在 `<footer class="site-footer">` 前插入:

```html
    <section class="credits" id="credits" hidden>
      <p class="credits-title">感謝有你 —— 一個人許願,一群人幫它成真</p>
      <div class="credits-cols">
        <div class="credits-col" id="credits-wishers" hidden>
          <h3>靈感 · 許願的人</h3>
          <div class="credits-chips"></div>
          <p class="muted credits-note" hidden></p>
        </div>
        <div class="credits-col" id="credits-implementers" hidden>
          <h3>實現 · 交出實作的人</h3>
          <div class="credits-chips"></div>
          <p class="muted credits-note" hidden></p>
        </div>
      </div>
    </section>
```

- [ ] **Step 2: styles.css** — 檔尾 append(只用既有 tokens):

```css
/* ============ 感謝名單(credits,footer 上方) ============ */
.credits { margin: 48px 0 0; text-align: center; }
.credits-title { font-size: .95rem; color: var(--muted); margin: 0 0 18px; }
.credits-cols { display: flex; justify-content: center; gap: 28px 40px; flex-wrap: wrap; }
.credits-col { min-width: 220px; max-width: 460px; flex: 1 1 260px; }
.credits-col h3 { font-size: .8rem; color: var(--muted); margin: 0 0 10px; letter-spacing: .04em; font-weight: 600; }
.credits-chips { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
.credits-chips a.badge { text-decoration: none; }
.credits-note { font-size: .75rem; margin-top: 8px; }
```

- [ ] **Step 3: app.js** — 新增函式(放 `loadPond` 定義後)與 boot 呼叫:

```js
// 感謝名單(footer 上方):載不到或全空就保持隱藏,不影響主流程
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
      const a = el('a', 'badge', (p.adopted > 0 ? '★ ' : '') + '@' + p.handle)
      a.href = 'https://github.com/' + encodeURIComponent(p.handle)
      a.target = '_blank'; a.rel = 'noopener nofollow'
      a.title = `交出 ${p.answers} 份實作` + (p.adopted > 0 ? `,${p.adopted} 份被採用` : '')
      return a
    }, d.unsigned_answers > 0 ? `以及 ${d.unsigned_answers} 份未署名實作` : '')
    $('#credits').hidden = !(hasW || hasI)
  } catch { /* 靜默:感謝名單非關鍵路徑 */ }
}
```

boot 處(`loadPond().then(() => {` 那一段之後)加一行獨立呼叫:

```js
loadCredits()
```

- [ ] **Step 4: 語法自檢** — `node --check app.js`(browser script 無 import,可過 parser);目視 index.html 巢狀。

- [ ] **Step 5: Commit** — `feat(ui): footer 上方感謝名單 — 靈感(許願人)+實現(實作者)兩欄 chips (#34)`

---

### Task 3: 文件同步 + 上線

**Files:**
- Modify: `README.md`(公開 API 段加 `GET /api/credits`)
- Modify: `llms.txt`(API 清單同步)

- [ ] **Step 1:** README 公開 API 段加一行(格式照既有條目):`GET /api/credits` — 感謝名單聚合(靈感=公開願望暱稱、實現=visible answers 的 github_handle;兩級排序、匿名彙總、edge cache 10 分)。llms.txt 同步一行。
- [ ] **Step 2: Commit** — `docs: 公開 API 補 GET /api/credits (#34)`
- [ ] **Step 3:** push branch → `gh pr create`(body 註 `Closes #34`)→ CI 綠 → merge(owner 已預先授權)→ 刪 branch。
- [ ] **Step 4:** worker 部署:`cd worker && npm run deploy`(營運鐵則:merge 不會自動部署 worker)。
- [ ] **Step 5:** production 驗證:`curl https://wish-pool.yazelinj303.workers.dev/api/credits` 檢查結構與真資料;等 Pages workflow 完成後真瀏覽器看 https://yazelin.github.io/wish-pool/ footer(晨光+夜晚兩主題、手機寬度、handle 連結指向 GitHub)。

## Self-Review

- 規格覆蓋:API(Task 1)、前端(Task 2)、測試(Task 1 Step 1)、文件(Task 3)、cache header(Task 1)、匿名彙總與兩級排序(兩處)——齊。
- 無占位符;型別一致(route 回應鍵 = 測試斷言鍵 = 前端取用鍵)。
- 已知取捨:本機前端無法打 prod API(CORS 只允許 yazelin.github.io),前端以單元測試+上線後真瀏覽器驗證,符合本 repo 既有 E2E 慣例。

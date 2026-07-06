# 女神評難度+列缺口 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 女神收尾時評估願望規模(小/中/大/巨大)、列出實作缺口(落入 needs 表),復刻類願望有版權引導;牆上與詳情頁顯示規模徽章。

**Architecture:** 沿用既有管線:refine final JSON 加 `difficulty`+`gaps` → 簽章 canonical 納入 difficulty → submit 存進 wishes.difficulty 欄位與 needs 表 → 前端徽章沿用 `.phrase` 樣式。零新表、零新端點。

**Tech Stack:** Cloudflare Worker (Hono + D1) + vitest(cloudflare:test)+ 純前端 vanilla JS。

**Spec:** `docs/superpowers/specs/2026-07-06-goddess-difficulty-gaps-design.md`

## Global Constraints

- 全程繁體中文文案,不用 emoji。
- difficulty 只有四值:`小`/`中`/`大`/`巨大`,中文原字存 DB;白名單外 → 空(不存)。
- gaps type 只有 `info`/`skill`/`resource`;不合法落為 `info`(對齊 `createNeed` 既有行為)。
- 公開欄位白名單 `WISH_PUBLIC_COLS`(worker/src/lib/d1.ts:29)新增欄位必須同步進 notify.route.test.ts 的欄位契約。
- 測試指令:`cd /home/ct/wish-pool/worker && npx vitest run <file>`;全跑:`npx vitest run`。
- commit 訊息繁中,結尾 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。

---

### Task 1: llm.ts — RefineResult 型別、解析、SYSTEM_PROMPT

**Files:**
- Modify: `worker/src/lib/llm.ts`
- Test: `worker/test/llm.test.ts`

**Interfaces:**
- Produces: `RefineResult` final 分支新增 `difficulty: string`(四值或 `''`)與 `gaps: { type: 'info' | 'skill' | 'resource'; body: string }[]`。後續 Task 2(簽章)、Task 4(route)、Task 5(前端)都依賴這兩個欄位名。

- [ ] **Step 1: 寫失敗測試** — 在 `worker/test/llm.test.ts` 的 describe 內加:

```ts
it('parses difficulty and gaps with whitelists', () => {
  const r = parseRefineResponse(JSON.stringify({
    mode: 'final', title: 'X', open_questions: [], verdict: 'ok', verdict_reason: '',
    difficulty: '大',
    gaps: [
      { type: 'resource', body: '全套美術素材需原創' },
      { type: 'weird', body: '不明型別落為 info' },
      { type: 'skill', body: '   ' },          // 空 body 要被丟掉
      'not-an-object',                          // 非物件要被丟掉
    ],
  }))
  expect(r.mode).toBe('final')
  if (r.mode === 'final') {
    expect(r.difficulty).toBe('大')
    expect(r.gaps).toEqual([
      { type: 'resource', body: '全套美術素材需原創' },
      { type: 'info', body: '不明型別落為 info' },
    ])
  }
})

it('difficulty outside whitelist coerced to empty; missing gaps -> []', () => {
  const r = parseRefineResponse(JSON.stringify({
    mode: 'final', title: 'X', open_questions: [], verdict: 'ok', verdict_reason: '', difficulty: 'XL',
  }))
  if (r.mode === 'final') {
    expect(r.difficulty).toBe('')
    expect(r.gaps).toEqual([])
  }
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd /home/ct/wish-pool/worker && npx vitest run test/llm.test.ts`
Expected: FAIL(difficulty undefined ≠ '大')

- [ ] **Step 3: 改 `worker/src/lib/llm.ts`**

型別(RefineResult final 分支加兩行):

```ts
export type RefineResult =
  | { mode: 'ask'; question: string }
  | {
      mode: 'final'; title: string; problem: string; current: string; desired: string
      who: string; open_questions: string[]; verdict: 'ok' | 'review'; verdict_reason: string
      difficulty: string
      gaps: { type: 'info' | 'skill' | 'resource'; body: string }[]
      sig?: string
    }
```

檔案層級常數(放在 SYSTEM_PROMPT 上方):

```ts
export const DIFFICULTIES = ['小', '中', '大', '巨大']
const GAP_TYPES = ['info', 'skill', 'resource'] as const
```

`parseRefineResponse` 的 final 回傳物件加:

```ts
      difficulty: DIFFICULTIES.includes(obj.difficulty) ? obj.difficulty : '',
      gaps: Array.isArray(obj.gaps)
        ? obj.gaps
            .filter((g: any) => g && typeof g.body === 'string' && g.body.trim())
            .map((g: any) => ({
              type: (GAP_TYPES as readonly string[]).includes(g.type) ? g.type : 'info',
              body: String(g.body).trim(),
            }))
        : [],
```

SYSTEM_PROMPT:在「當資訊夠了…」那條規則之後、「內容型作品…」之前,插入三條規則:

```
- 收尾(final)時做兩件評估:
  1) difficulty:評估作品規模,只能填「小」「中」「大」「巨大」其中之一。判準:小=單頁工具或單一功能;中=完整 app,一個 repo 數週可成;大=遊戲或多子系統,需大量內容或素材;巨大=平台級,需長期營運或多人協作。
  2) gaps:盡可能列出「實作缺口」——就算資訊都問清楚了,實現者也得自備的東西(美術素材、音樂、內容量、外部服務金鑰、特殊技能)。每條 {"type":"...","body":"..."},type 只能是 info(缺資訊)/skill(缺技能)/resource(缺資源)。gaps 與 open_questions 不同:open_questions 是還沒問清楚、要回頭問許願人的事;gaps 是給實現者看的待補清單。同一件事不要兩邊重複放。
- 版權守則:若願望是「復刻/重製某個現有遊戲或作品」,溫柔說明:玩法機制不受版權保護,可以復刻;但素材、名稱、角色、劇情受著作權保護,不能照搬。引導對方把願望改成「同類機制+原創題材」;並固定把「全套素材(美術/音樂)需原創,不可取自原作」(resource)與「不可使用原作名稱與角色」(info)列入 gaps。若對方堅持要用原作素材或原作名稱,verdict 設 "review",verdict_reason 說明版權疑慮。
```

SYSTEM_PROMPT 最後的 final 輸出格式行改成(在 verdict 前加兩欄):

```
- 整理完成:{"mode":"final","title":"作品的名字或一句話","problem":"...","current":"...","desired":"核心功能1;核心功能2;...","who":"...","open_questions":["還沒問清楚的事"],"difficulty":"小|中|大|巨大","gaps":[{"type":"info|skill|resource","body":"實現者要自備的東西"}],"verdict":"ok" 或 "review","verdict_reason":"一句話"}
```

- [ ] **Step 4: 跑測試確認過**

Run: `cd /home/ct/wish-pool/worker && npx vitest run test/llm.test.ts`
Expected: PASS(既有案例也要全綠——舊測試沒給 difficulty/gaps,fallback 空值不影響斷言)

- [ ] **Step 5: Commit**

```bash
cd /home/ct/wish-pool && git add worker/src/lib/llm.ts worker/test/llm.test.ts && git commit -m "feat(refine): 女神評規模+列實作缺口+復刻類版權守則

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: sign.ts — difficulty 納入簽章 canonical

**Files:**
- Modify: `worker/src/lib/sign.ts`
- Test: `worker/test/sign.test.ts`

**Interfaces:**
- Consumes: 無(獨立模組)。
- Produces: `WishFields` 新增 `difficulty?: string`;`signWish`/`verifyWish` 簽名不變,canonical 從五欄變六欄。Task 4 的 verifyWish 呼叫要帶 difficulty。

- [ ] **Step 1: 寫失敗測試** — `worker/test/sign.test.ts` 加:

```ts
it('difficulty is part of the canonical: tampering it fails verification', async () => {
  const w = { title: 't', problem: 'p', current: 'c', desired: 'd', who: 'w', difficulty: '巨大' }
  const sig = await signWish('secret', w, 'ok', 9999999999)
  expect(await verifyWish('secret', w, 'ok', sig, 1000)).toBe(true)
  expect(await verifyWish('secret', { ...w, difficulty: '小' }, 'ok', sig, 1000)).toBe(false)
  expect(await verifyWish('secret', { ...w, difficulty: undefined }, 'ok', sig, 1000)).toBe(false)
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd /home/ct/wish-pool/worker && npx vitest run test/sign.test.ts`
Expected: FAIL(竄改 difficulty 仍驗過,因為 canonical 沒包含它)

- [ ] **Step 3: 改 `worker/src/lib/sign.ts`**

```ts
type WishFields = { title?: string; problem?: string; current?: string; desired?: string; who?: string; difficulty?: string }

function canonical(w: WishFields): string {
  return JSON.stringify([
    String(w.title ?? '').trim(),
    String(w.problem ?? '').trim(),
    String(w.current ?? '').trim(),
    String(w.desired ?? '').trim(),
    String(w.who ?? '').trim(),
    String(w.difficulty ?? '').trim(),
  ])
}
```

檔頭註解「五個內容欄位」改「六個內容欄位(含 difficulty)」。

- [ ] **Step 4: 跑測試確認過**

Run: `cd /home/ct/wish-pool/worker && npx vitest run test/sign.test.ts test/refine.route.test.ts`
Expected: PASS(refine 路由把整個 result 丟給 signWish,result 現在有 difficulty,canonical 自動涵蓋,refine.route 既有測試不需改)

- [ ] **Step 5: Commit**

```bash
cd /home/ct/wish-pool && git add worker/src/lib/sign.ts worker/test/sign.test.ts && git commit -m "feat(sign): difficulty 納入簽章 canonical,防送出時竄改規模

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: migration 0007 + d1.ts 存取層 + 公開欄位契約

**Files:**
- Create: `worker/migrations/0007_difficulty.sql`
- Modify: `worker/src/lib/d1.ts`
- Test: `worker/test/d1.test.ts`, `worker/test/notify.route.test.ts`

**Interfaces:**
- Consumes: 無。
- Produces: `NewWish` 新增 `difficulty?: string` 與 `gaps?: { type: string; body: string }[]`;`WishRow` 新增 `difficulty: string | null`;`createWish(db, w, now)` 會存 difficulty 並把 gaps 寫入 needs。Task 4 依賴這個介面,Task 5 依賴 API 回傳的 `difficulty` 欄位。

- [ ] **Step 1: 建 migration**

`worker/migrations/0007_difficulty.sql`:

```sql
ALTER TABLE wishes ADD COLUMN difficulty TEXT;
```

(測試 harness `test/apply-migrations.ts` 自動套用全部 migrations,無需改。)

- [ ] **Step 2: 寫失敗測試** — `worker/test/d1.test.ts` 加(仿照該檔既有 createWish 測試的取 db 方式):

```ts
it('createWish stores difficulty and writes gaps into needs', async () => {
  const id = await createWish(env.DB, {
    title: '復刻類許願', status: 'published',
    open_questions: ['要不要排行榜?'],
    difficulty: '大',
    gaps: [
      { type: 'resource', body: '全套美術素材需原創' },
      { type: 'weird', body: '不明型別落為 info' },
      { type: 'skill', body: '' },               // 空 body 跳過
    ],
  }, 1700000000)
  const w = await getWish(env.DB, id)
  expect(w?.difficulty).toBe('大')
  const bodies = w!.needs.map((n) => `${n.type}:${n.body}`)
  expect(bodies).toContain('info:要不要排行榜?')
  expect(bodies).toContain('resource:全套美術素材需原創')
  expect(bodies).toContain('info:不明型別落為 info')
  expect(bodies).toHaveLength(3)
})
```

- [ ] **Step 3: 跑測試確認失敗**

Run: `cd /home/ct/wish-pool/worker && npx vitest run test/d1.test.ts`
Expected: FAIL(NewWish 沒有 difficulty/gaps 欄位,TS 編譯錯或斷言失敗)

- [ ] **Step 4: 改 `worker/src/lib/d1.ts`**

```ts
export type NewWish = {
  title: string; problem?: string; current?: string; desired?: string
  who?: string; nickname?: string; status: string; open_questions: string[]
  difficulty?: string
  gaps?: { type: string; body: string }[]
}
```

`WishRow` 加一行:`difficulty: string | null`(放在 `status` 之前那組欄位裡,位置不拘)。

`WISH_PUBLIC_COLS` 加 `difficulty`:

```ts
const WISH_PUBLIC_COLS = 'id, title, problem, current, desired, who, nickname, status, votes, created_at, accepted_answer_id, discussion_url, difficulty'
```

`createWish` 改:

```ts
export async function createWish(db: D1Database, w: NewWish, now: number): Promise<number> {
  const res = await db.prepare(
    `INSERT INTO wishes (title, problem, current, desired, who, nickname, status, votes, created_at, difficulty)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
  ).bind(w.title, w.problem ?? null, w.current ?? null, w.desired ?? null,
         w.who ?? null, w.nickname ?? null, w.status, now, w.difficulty || null).run()
  const id = res.meta.last_row_id as number
  for (const q of w.open_questions) {
    if (!q?.trim()) continue
    await db.prepare('INSERT INTO open_questions (wish_id, question) VALUES (?, ?)').bind(id, q).run()
    await db.prepare("INSERT INTO needs (wish_id, type, body) VALUES (?, 'info', ?)").bind(id, q).run()
  }
  for (const g of w.gaps ?? []) {
    if (!g || typeof g.body !== 'string' || !g.body.trim()) continue
    const t = ['info', 'skill', 'resource'].includes(g.type) ? g.type : 'info'
    await db.prepare('INSERT INTO needs (wish_id, type, body) VALUES (?, ?, ?)').bind(id, t, g.body.trim()).run()
  }
  return id
}
```

- [ ] **Step 5: 更新欄位契約** — `worker/test/notify.route.test.ts:60` 的 `WISH_KEYS` 加 `'difficulty'`:

```ts
const WISH_KEYS = ['id', 'title', 'problem', 'current', 'desired', 'who', 'nickname', 'status', 'votes', 'created_at', 'accepted_answer_id', 'discussion_url', 'difficulty', 'echoes'].sort()
```

- [ ] **Step 6: 跑測試確認過**

Run: `cd /home/ct/wish-pool/worker && npx vitest run test/d1.test.ts test/notify.route.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
cd /home/ct/wish-pool && git add worker/migrations/0007_difficulty.sql worker/src/lib/d1.ts worker/test/d1.test.ts worker/test/notify.route.test.ts && git commit -m "feat(db): wishes.difficulty 欄位+gaps 落入 needs;公開欄位契約同步

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: wishes route — 送出帶 difficulty/gaps、驗簽含 difficulty

**Files:**
- Modify: `worker/src/routes/wishes.ts:44-79`(POST /api/wishes)
- Test: `worker/test/wishes.route.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `verifyWish`(canonical 含 difficulty)、Task 3 的 `createWish`(吃 difficulty/gaps)、Task 1 的 `DIFFICULTIES`(從 `../lib/llm` import)。
- Produces: POST body 契約:`b.wish.difficulty`(字串,白名單)與 `b.gaps`(陣列)。Task 5 前端照此送。

- [ ] **Step 1: 寫失敗測試** — `worker/test/wishes.route.test.ts` 加(仿照該檔既有「簽章送出→published」測試的寫法,用 signWish 造合法簽章;確切 helper 以檔內既有測試為準):

```ts
it('difficulty and gaps are stored on submit; tampered difficulty falls to pending', async () => {
  const wish = { title: '大型遊戲願望', problem: 'p', current: 'c', desired: 'd', who: 'w', difficulty: '大' }
  const sig = await signWish(SECRET, wish, 'ok', Math.floor(Date.now() / 1000) + 3600)
  // 正常送出:published,difficulty 與 gaps 都落庫
  const res = await SELF.fetch(`${O}/api/wishes`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ wish, verdict: 'ok', sig, gaps: [{ type: 'resource', body: '素材需原創' }], turnstileToken: 'x' }),
  })
  const j = await res.json() as any
  expect(j.status).toBe('published')
  const got = await (await SELF.fetch(`${O}/api/wishes/${j.id}`)).json() as any
  expect(got.difficulty).toBe('大')
  expect(got.needs.some((n: any) => n.type === 'resource' && n.body === '素材需原創')).toBe(true)

  // 竄改 difficulty:驗簽失敗 → pending
  const res2 = await SELF.fetch(`${O}/api/wishes`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ wish: { ...wish, difficulty: '小' }, verdict: 'ok', sig, turnstileToken: 'x' }),
  })
  expect(((await res2.json()) as any).status).toBe('pending')
})
```

(SECRET/H/O/turnstile mock 的具體寫法照 `wishes.route.test.ts` 檔內既有測試,不要自創新 harness。)

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd /home/ct/wish-pool/worker && npx vitest run test/wishes.route.test.ts`
Expected: FAIL(difficulty 沒存、驗簽沒帶 difficulty)

- [ ] **Step 3: 改 `worker/src/routes/wishes.ts` POST /api/wishes**

檔頭 import 加:`import { DIFFICULTIES } from '../lib/llm'`

`const title = ...` 之後加:

```ts
  const difficulty = DIFFICULTIES.includes(w.difficulty) ? String(w.difficulty) : undefined
```

verifyWish 呼叫的欄位物件改為:

```ts
      { title, problem: w.problem, current: w.current, desired: w.desired, who: w.who, difficulty },
```

createWish 呼叫改為:

```ts
  const id = await createWish(c.env.DB, {
    title,
    problem: w.problem, current: w.current, desired: w.desired, who: w.who, nickname: w.nickname,
    status, open_questions: Array.isArray(b.open_questions) ? b.open_questions : [],
    difficulty,
    gaps: Array.isArray(b.gaps) ? b.gaps : [],
  }, Math.floor(Date.now() / 1000))
```

(注意:白名單外的 difficulty → undefined → canonical 端是空字串;女神給空 difficulty 時前端也送空/不送,兩邊一致,簽章不會因此失效。)

- [ ] **Step 4: 全測試跑綠**

Run: `cd /home/ct/wish-pool/worker && npx vitest run`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
cd /home/ct/wish-pool && git add worker/src/routes/wishes.ts worker/test/wishes.route.test.ts && git commit -m "feat(api): 送出願望帶規模與實作缺口,驗簽涵蓋 difficulty

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: 前端 — 預覽揭示、送出帶欄位、規模徽章

**Files:**
- Modify: `app.js`(renderPreview ~882、submitWish ~907、renderLantern ~273、openSheet head ~469)
- Modify: `board.js`(~27-29 card meta)

**Interfaces:**
- Consumes: refine final 的 `r.difficulty`/`r.gaps`(Task 1)、POST body 契約 `wish.difficulty`+`gaps`(Task 4)、API 回傳 `w.difficulty`(Task 3)。
- Produces: 無(終端消費者)。

前端無測試 harness,驗證靠 Step 5 的本機 smoke。

- [ ] **Step 1: renderPreview 揭示評估**(app.js,`if (r.open_questions?.length)` 區塊之後加):

```js
  if (r.difficulty) form.appendChild(el('div', 'need', `女神評的規模:${r.difficulty}`))
  if (r.gaps?.length) {
    form.appendChild(el('div', 'need', '女神列的實作缺口(會一起放進「還缺什麼」):' + r.gaps.map((g) => g.body).join('; ')))
  }
```

- [ ] **Step 2: submitWish 帶上欄位**(payload 改):

```js
  const payload = {
    wish: { title, problem: get('problem'), current: get('current'), desired: get('desired'), who: get('who'), nickname: get('nickname') || undefined, difficulty: r.difficulty || undefined },
    open_questions: r.open_questions || [],
    gaps: r.gaps || [],
    verdict: r.verdict, // 只有 AI final 且 ok 才會直接入池;純表單(無 verdict)進審核
    sig: r.sig,         // /api/refine 對 ok 內容的簽章;後端驗簽通過才 published,改過/偽造 -> pending
  }
```

- [ ] **Step 3: 規模徽章**——三處,全部沿用既有 `.phrase` 樣式(token 化,零新 CSS):

renderLantern(status phrase 那行之後):

```js
  if (w.difficulty) card.appendChild(el('span', 'phrase', `規模:${w.difficulty}`))
```

openSheet 的 head(`head.appendChild(el('span', 'phrase ' + w.status, ...))` 之後):

```js
  if (w.difficulty) head.appendChild(el('span', 'phrase', `規模:${w.difficulty}`))
```

board.js 卡片 meta 行改:

```js
      meta.textContent = (w.difficulty ? `規模:${w.difficulty} · ` : '') + `▲ ${w.votes}` + (w.nickname ? ` · ${w.nickname}` : '')
```

- [ ] **Step 4: 檢查 head 排版**——openSheet 的 head 是 status phrase + 關閉鈕;插入第二個 phrase 後用瀏覽器確認不擠(sheet-head 是 flex,若擠則把徽章移到 `sheet-title` 之後那行)。

- [ ] **Step 5: 本機 smoke**

```bash
cd /home/ct/wish-pool/worker && npx wrangler dev --local
# 另開終端,靜態頁:
cd /home/ct/wish-pool && python3 -m http.server 8788
```

用 chrome-devtools MCP 或瀏覽器開 `http://localhost:8788`,確認:(a) 池面卡片載入正常、舊資料無 difficulty 不出徽章;(b) 手動塞一筆帶 difficulty 的願望(`npx wrangler d1 execute wish-pool --local --command "UPDATE wishes SET difficulty='大' WHERE id=1"`)後,卡片與詳情頁出現「規模:大」;(c) config.js 的 API base 指向 local worker(若不是,改 hosts 或暫時指過去驗完還原)。

- [ ] **Step 6: Commit**

```bash
cd /home/ct/wish-pool && git add app.js board.js && git commit -m "feat(ui): 規模徽章上牆與詳情頁;送出帶規模與實作缺口

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: 文件 — README + llms.txt

**Files:**
- Modify: `README.md`(功能說明處)
- Modify: `llms.txt`(資料模型與食譜)

**Interfaces:** Consumes Task 3 的公開欄位;Produces 無。

- [ ] **Step 1: llms.txt** — 第 27 行 needs 說明之後補一行資料模型說明:

```
  - difficulty = 女神評的規模(小/中/大/巨大,可能為空)—— 接單前先看規模合不合你的量。
```

食譜 5(替主人許願)那段補一句:final 會帶 `difficulty` 與 `gaps`,POST /api/wishes 時把 `wish.difficulty` 與頂層 `gaps` 一起帶上,gaps 會自動落入該願望的 needs。

- [ ] **Step 2: README.md** — 功能清單處補:「女神收尾時會評規模(小/中/大/巨大)、列實作缺口(落入『還缺什麼』);復刻類願望有版權引導:機制可復刻、素材/名稱/角色/劇情需原創」。

- [ ] **Step 3: Commit**

```bash
cd /home/ct/wish-pool && git add README.md llms.txt && git commit -m "docs: 規模評估+實作缺口+復刻類版權守則說明

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: 部署

**Files:** 無新檔;操作 prod。

- [ ] **Step 1: 全測試最後跑綠**

Run: `cd /home/ct/wish-pool/worker && npx vitest run`
Expected: 全 PASS

- [ ] **Step 2: 套 prod migration**

```bash
cd /home/ct/wish-pool/worker && npm run migrate:remote
```

Expected: 0007_difficulty.sql applied。

- [ ] **Step 3: 部署 worker**

```bash
cd /home/ct/wish-pool/worker && npm run deploy
```

- [ ] **Step 4: push(前端由 Pages 自動部署)**

```bash
cd /home/ct/wish-pool && git push
```

- [ ] **Step 5: prod smoke** — `curl -s https://<prod-api>/api/wishes?sort=new | jq '.wishes[0]'` 確認回傳含 `difficulty` 欄位(null 也算);開站確認池面正常。

---

### Task 8: 一次性 backfill(互動,需 yazelin 逐步拍板)

**Files:**
- Create(暫存,不進 repo):scratchpad 下的 `backfill.sql`

此任務不能全自動——兩處要 yazelin 過目才執行。

- [ ] **Step 1: 撈 prod 願望**

```bash
cd /home/ct/wish-pool/worker && npx wrangler d1 execute wish-pool --remote --json \
  --command "SELECT id, title, problem, desired, status, discussion_url FROM wishes WHERE status IN ('published','adopted','building','done')"
```

- [ ] **Step 2: 逐一評難度+標復刻類** — 依判準(小=單頁工具或單一功能;中=完整 app 數週可成;大=遊戲或多子系統需大量內容;巨大=平台級需長期營運)對每筆給 difficulty;同時標記哪些是「復刻/重製現有遊戲」類。整理成表格給 yazelin 過目(id、title、建議 difficulty、是否復刻類),**等確認**。

- [ ] **Step 3: 產 SQL 並執行**(確認後)— `backfill.sql` 形如:

```sql
UPDATE wishes SET difficulty='中' WHERE id=1;
UPDATE wishes SET difficulty='大' WHERE id=2;
-- 復刻類每筆加兩條缺口:
INSERT INTO needs (wish_id, type, body) VALUES (2, 'resource', '全套素材(美術/音樂)需原創,不可取自原作');
INSERT INTO needs (wish_id, type, body) VALUES (2, 'info', '不可使用原作名稱與角色;玩法機制可復刻,題材建議改為原創');
```

```bash
cd /home/ct/wish-pool/worker && npx wrangler d1 execute wish-pool --remote --file <scratchpad>/backfill.sql
```

- [ ] **Step 4: 復刻類 discussion 留言**(文案先給 yazelin 過目)— 對每筆有 discussion_url 的復刻類願望,從 URL 取 discussion number,用 gh 留言:

```bash
# discussion node id:
gh api graphql -f query='query($n:Int!){repository(owner:"yazelin",name:"wish-pool"){discussion(number:$n){id}}}' -F n=<number> --jq .data.repository.discussion.id
# 留言:
gh api graphql -f query='mutation($id:ID!,$body:String!){addDiscussionComment(input:{discussionId:$id,body:$body}){comment{url}}}' -F id=<node_id> -f body='【池規更新】許願池新增了復刻類願望的版權守則:玩法機制不受版權保護、可以復刻;但素材、名稱、角色、劇情需原創。這個願望的「還缺什麼」已補上對應缺口,歡迎回來看看、也歡迎把願望調整成「同類機制+原創題材」。'
```

- [ ] **Step 5: 驗證** — 開站抽查一筆復刻類願望:徽章顯示、缺口出現在「還缺什麼」、discussion 有留言。

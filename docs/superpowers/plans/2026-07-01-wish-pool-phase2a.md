# 願望池 Phase 2a 實作計劃 — 協作實現層

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓每則願望能收多個 repo 實作版本(全部可見+社群投票)、有結構化「還缺什麼(needs)」+ 認領/進度(work-log),並用一面依狀態分組的看板 + 已實現牆呈現;AI agent 用公開 API 讀得到缺口與進度。

**Architecture:** 建在 phase 1 之上(Cloudflare Worker + Hono + D1 + Turnstile guard + HMAC sign + vitest)。新增 4 張 D1 表(needs/updates/answers/answer_votes)+ wishes.accepted_answer_id;把 phase 1 的 open_questions 遷移成 needs(type=info)。新增一個 answers/collab 路由模組 + 擴充 admin;前端擴充願望詳情 + 新增 board.html 看板/已實現牆。

**Tech Stack:** 沿用 phase 1 —— Hono 4、D1、@cloudflare/vitest-pool-workers、TypeScript、Cloudflare Turnstile、原生 HTML/CSS/JS 前端。

## Global Constraints

- 語言/文案:繁體中文,**不使用任何 emoji**(code/comments/commits/UI)。
- 前端 mobile-first RWD;色彩用 `var(--c-*)` token;**保留現有 footer**(GitHub/FB/BMC)。無 build step、無 PWA。
- 不登入;協力者選填 GitHub handle(純文字、不驗證)。
- **安全:repo_url 只當連結,渲染 `<a rel="noopener nofollow" target="_blank">`,平台絕不 fetch/執行/iframe/預覽 repo 內容。所有 user/AI 文字一律 textContent 渲染。** 寫入端(answers/updates/needs/vote)一律 Turnstile + 每 IP 限流。
- 沿用 phase 1 worker 版本地板與測試模式(`cd worker && npm test` 綠、`npm run typecheck` 乾淨)。
- 誠實護欄:已實現牆 bootstrap 用 owner 真專案,owner 署名、**0 假票**、note 標「站方示範」。
- 狀態機沿用 phase 1:`pending→published→adopted→building→done`,另 `hidden`。看板分組:徵求中(published)/已採納(adopted)/開發中(building)/已實現(done)。
- 決定:看板做**獨立 `board.html`**;`open_questions` 舊表**遷移後保留不動**(讀取切到 needs)。

---

## 檔案結構

**Worker(`worker/`)**
- `migrations/0002_phase2.sql` — 新表 + accepted_answer_id + open_questions→needs 遷移
- `src/env.ts` — 不變(無新 secret)
- `src/lib/d1.ts` — MODIFY:加 needs/updates/answers 資料函式;`getWish` 改回傳 needs/updates/answers(取代 open_questions)
- `src/routes/collab.ts` — 新:POST answers / answer vote / updates / needs
- `src/routes/admin.ts` — MODIFY:answer 隱藏、accept(pin+done)、need resolve
- `src/index.ts` — MODIFY:掛 collab 路由
- `test/collab.test.ts`(資料層)、`test/collab.route.test.ts`(整合)、`test/admin.route.test.ts`(擴充)、`test/d1.test.ts`(getWish 擴充)

**前端(repo 根)**
- `app.js` — MODIFY:`openDetail` 擴充(needs/updates/answers 區 + 表單)、下載規格
- `board.html` / `board.js` — 新:看板(狀態分組 + 進度徽章)+ 已實現牆
- `index.html` — MODIFY:加「看板」連結 + board 樣式沿用 styles.css
- `styles.css` — MODIFY:board / answer / need / update 樣式
- `admin.html` / `admin.js` — MODIFY:answer 隱藏、accept、need resolve 控制
- `README.md` — MODIFY:公開 API 文件

**部署/seed**
- `worker/scripts/seed-showcase.sql`(新)+ 部署步驟

---

## Task 1: D1 migration 0002(新表 + 遷移)

**Files:**
- Create: `worker/migrations/0002_phase2.sql`
- Test: 由既有 vitest 自動套用(readD1Migrations 會抓 migrations/ 全部);加一個 schema 檢查測到 `worker/test/collab.test.ts`(Task 2 建)先不動,這 task 只驗 migration 能套用。

**Interfaces:**
- Produces:表 `needs(id,wish_id,type,body,resolved)`、`updates(id,wish_id,kind,body,github_handle,created_at)`、`answers(id,wish_id,repo_url,note,github_handle,votes,status,created_at)`、`answer_votes(answer_id,fingerprint,created_at)`;`wishes.accepted_answer_id`;以及把每筆 `open_questions` 複製成 `needs`(type='info', body=question, resolved 沿用)。

- [ ] **Step 1: 建立 `worker/migrations/0002_phase2.sql`**

```sql
CREATE TABLE needs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wish_id INTEGER NOT NULL,
  type TEXT NOT NULL DEFAULT 'info',
  body TEXT NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wish_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  body TEXT NOT NULL,
  github_handle TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wish_id INTEGER NOT NULL,
  repo_url TEXT NOT NULL,
  note TEXT,
  github_handle TEXT,
  votes INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'visible',
  created_at INTEGER NOT NULL
);
CREATE TABLE answer_votes (
  answer_id INTEGER NOT NULL,
  fingerprint TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (answer_id, fingerprint)
);

ALTER TABLE wishes ADD COLUMN accepted_answer_id INTEGER;

CREATE INDEX idx_needs_wish ON needs(wish_id);
CREATE INDEX idx_updates_wish ON updates(wish_id);
CREATE INDEX idx_answers_wish ON answers(wish_id);

-- 遷移:舊 open_questions -> needs(type=info)。保留 open_questions 表不動。
INSERT INTO needs (wish_id, type, body, resolved)
  SELECT wish_id, 'info', question, resolved FROM open_questions;
```

- [ ] **Step 2: 套用到本機 D1 並驗證**

Run: `cd worker && npm run migrate:local && npx wrangler d1 execute wish-pool --local --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"`
Expected: 輸出含 `answer_votes, answers, needs, updates, wishes`(等)。

- [ ] **Step 3: 跑既有測試確認沒被 migration 弄壞**

Run: `cd worker && npm test`
Expected: 既有 48 測試仍全綠(新 migration 只加表,不影響)。若 vitest 的 in-memory D1 因新 migration 出錯,先修 SQL。

- [ ] **Step 4: Commit**

```bash
git add worker/migrations/0002_phase2.sql
git commit -m "feat(worker): phase2 D1 migration — needs/updates/answers tables + migrate open_questions"
```

---

## Task 2: d1.ts — needs 資料層 + getWish 改用 needs

**Files:**
- Modify: `worker/src/lib/d1.ts`
- Modify: `worker/test/d1.test.ts`(getWish 現在回 needs 不回 open_questions)
- Test: `worker/test/collab.test.ts`(新,needs 部分)

**Interfaces:**
- Consumes: `env.DB`、Task 1 schema。
- Produces:
  - `type Need = { id: number; type: string; body: string; resolved: number }`
  - `createNeed(db, wishId: number, type: string, body: string): Promise<number>`
  - `listNeeds(db, wishId: number): Promise<Need[]>`
  - `resolveNeed(db, id: number): Promise<void>`
  - `getWish` 回傳型別 `Wish` 改為含 `needs: Need[]`(移除 `open_questions`,改由 needs 表讀)。

- [ ] **Step 1: 改 `worker/src/lib/d1.ts` 的 Wish 型別與 getWish**

把 `Wish` 型別的 `open_questions` 換成 `needs`,並加 Need 型別 + 三個函式。找到現有:

```ts
export type Wish = WishRow & {
  open_questions: { id: number; question: string; resolved: number }[]
  responses: { id: number; question_id: number | null; body: string; nickname: string | null; kind: string; created_at: number }[]
}
```

改成:

```ts
export type Need = { id: number; type: string; body: string; resolved: number }
export type Wish = WishRow & {
  needs: Need[]
  responses: { id: number; question_id: number | null; body: string; nickname: string | null; kind: string; created_at: number }[]
}
```

在 `getWish` 內把讀 open_questions 那段換成讀 needs。找到:

```ts
  const q = await db.prepare('SELECT id, question, resolved FROM open_questions WHERE wish_id = ? ORDER BY id').bind(id).all<{ id: number; question: string; resolved: number }>()
  const r = await db.prepare('SELECT id, question_id, body, nickname, kind, created_at FROM responses WHERE wish_id = ? ORDER BY id').bind(id).all<Wish['responses'][number]>()
  return { ...row, open_questions: q.results, responses: r.results }
```

改成:

```ts
  const q = await db.prepare('SELECT id, type, body, resolved FROM needs WHERE wish_id = ? ORDER BY id').bind(id).all<Need>()
  const r = await db.prepare('SELECT id, question_id, body, nickname, kind, created_at FROM responses WHERE wish_id = ? ORDER BY id').bind(id).all<Wish['responses'][number]>()
  return { ...row, needs: q.results, responses: r.results }
```

同時,`createWish` 目前把 open_questions 寫進 open_questions 表 —— 改成同時也寫進 needs(讓新願望的待補問題直接是 needs)。找到 createWish 內:

```ts
  for (const q of w.open_questions) {
    if (!q?.trim()) continue
    await db.prepare('INSERT INTO open_questions (wish_id, question) VALUES (?, ?)').bind(id, q).run()
  }
```

改成(同時寫兩張表,open_questions 留著相容、needs 是新的真實來源):

```ts
  for (const q of w.open_questions) {
    if (!q?.trim()) continue
    await db.prepare('INSERT INTO open_questions (wish_id, question) VALUES (?, ?)').bind(id, q).run()
    await db.prepare("INSERT INTO needs (wish_id, type, body) VALUES (?, 'info', ?)").bind(id, q).run()
  }
```

- [ ] **Step 2: 在 d1.ts 末尾加 needs 函式**

```ts
export async function createNeed(db: D1Database, wishId: number, type: string, body: string): Promise<number> {
  const t = ['info', 'skill', 'resource'].includes(type) ? type : 'info'
  const res = await db.prepare('INSERT INTO needs (wish_id, type, body) VALUES (?, ?, ?)').bind(wishId, t, body).run()
  return res.meta.last_row_id as number
}
export async function listNeeds(db: D1Database, wishId: number): Promise<Need[]> {
  const { results } = await db.prepare('SELECT id, type, body, resolved FROM needs WHERE wish_id = ? ORDER BY id').bind(wishId).all<Need>()
  return results
}
export async function resolveNeed(db: D1Database, id: number): Promise<void> {
  await db.prepare('UPDATE needs SET resolved = 1 WHERE id = ?').bind(id).run()
}
```

- [ ] **Step 3: 更新 `worker/test/d1.test.ts` getWish 相關斷言**

phase 1 的 d1 測試裡有 `w?.open_questions.map(...)` 之類。把 `getWish + open_questions` 的斷言改成 `needs`。找到 createWish/getWish 測試(sample 有 `open_questions: ['依尺寸還是材質?']`),把:

```ts
    expect(w?.open_questions.map((q) => q.question)).toEqual(['依尺寸還是材質?'])
```

改成:

```ts
    expect(w?.needs.map((n) => n.body)).toEqual(['依尺寸還是材質?'])
    expect(w?.needs[0].type).toBe('info')
```

其他若有 `open_questions` 讀取(如 addResponse 測試拿 `w!.open_questions[0].id` 當 question_id)—— 該測試改用 needs id 或改對 responses 直接測。找到 addResponse 測試:

```ts
    const w = await getWish(db(), id)
    const qid = w!.open_questions[0].id
    await addResponse(db(), id, { body: '看材質', nickname: 'B', kind: 'answer', questionId: qid }, 20)
    const after = await getWish(db(), id)
    expect(after!.responses[0].body).toBe('看材質')
    expect(after!.open_questions[0].resolved).toBe(1)
```

改成(question_id 不再對應 needs;測 response 本身 + 該功能改由 resolveNeed 管):

```ts
    await addResponse(db(), id, { body: '看材質', nickname: 'B', kind: 'answer' }, 20)
    const after = await getWish(db(), id)
    expect(after!.responses[0].body).toBe('看材質')
```

（exportAll 測試若斷言 open_questions,改 needs 或移除該行。）

- [ ] **Step 4: 建 `worker/test/collab.test.ts`(needs 部分)**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { createWish, getWish, createNeed, listNeeds, resolveNeed } from '../src/lib/d1'

const db = () => env.DB
beforeEach(async () => {
  await db().exec('DELETE FROM needs'); await db().exec('DELETE FROM open_questions')
  await db().exec('DELETE FROM responses'); await db().exec('DELETE FROM wishes')
})

describe('needs', () => {
  it('createWish seeds open_questions into needs (type=info)', async () => {
    const id = await createWish(db(), { title: 'T', status: 'published', open_questions: ['缺什麼?'] }, 1)
    const w = await getWish(db(), id)
    expect(w?.needs.map((n) => [n.type, n.body])).toEqual([['info', '缺什麼?']])
  })
  it('createNeed with valid/invalid type, list, resolve', async () => {
    const id = await createWish(db(), { title: 'T', status: 'published', open_questions: [] }, 1)
    const nid = await createNeed(db(), id, 'skill', '需要會 Rust 的人')
    await createNeed(db(), id, 'garbage', '未指定型別')  // -> info
    const needs = await listNeeds(db(), id)
    expect(needs.map((n) => n.type)).toEqual(['skill', 'info'])
    await resolveNeed(db(), nid)
    expect((await listNeeds(db(), id)).find((n) => n.id === nid)?.resolved).toBe(1)
  })
})
```

- [ ] **Step 5: 跑測試**

Run: `cd worker && npm test -- d1 collab` then `npm run typecheck`
Expected: PASS;typecheck 乾淨。

- [ ] **Step 6: Commit**

```bash
git add worker/src/lib/d1.ts worker/test/d1.test.ts worker/test/collab.test.ts
git commit -m "feat(worker): needs data layer; getWish returns needs (replaces open_questions)"
```

---

## Task 3: d1.ts — updates(work-log)資料層

**Files:**
- Modify: `worker/src/lib/d1.ts`
- Modify: `worker/test/collab.test.ts`

**Interfaces:**
- Produces:
  - `type Update = { id: number; kind: string; body: string; github_handle: string | null; created_at: number }`
  - `addUpdate(db, wishId: number, u: { kind: string; body: string; github_handle?: string }, now: number): Promise<number>`
  - `listUpdates(db, wishId: number): Promise<Update[]>`
  - `getWish` 的 `Wish` 型別加 `updates: Update[]`,getWish 回傳含 updates。

- [ ] **Step 1: d1.ts — Wish 型別加 updates + getWish 讀 updates**

Wish 型別加一行 `updates: Update[]`,並在 getWish 讀取。加型別:

```ts
export type Update = { id: number; kind: string; body: string; github_handle: string | null; created_at: number }
```

Wish 型別改成:

```ts
export type Wish = WishRow & {
  needs: Need[]
  updates: Update[]
  responses: { id: number; question_id: number | null; body: string; nickname: string | null; kind: string; created_at: number }[]
}
```

getWish 回傳前加讀 updates,並放進回傳物件:

```ts
  const u = await db.prepare('SELECT id, kind, body, github_handle, created_at FROM updates WHERE wish_id = ? ORDER BY id').bind(id).all<Update>()
  return { ...row, needs: q.results, updates: u.results, responses: r.results }
```

- [ ] **Step 2: d1.ts 末尾加 updates 函式**

```ts
const UPDATE_KINDS = ['claim', 'progress', 'blocked']
export async function addUpdate(
  db: D1Database, wishId: number, u: { kind: string; body: string; github_handle?: string }, now: number,
): Promise<number> {
  const kind = UPDATE_KINDS.includes(u.kind) ? u.kind : 'progress'
  const res = await db.prepare('INSERT INTO updates (wish_id, kind, body, github_handle, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(wishId, kind, u.body, u.github_handle ?? null, now).run()
  return res.meta.last_row_id as number
}
export async function listUpdates(db: D1Database, wishId: number): Promise<Update[]> {
  const { results } = await db.prepare('SELECT id, kind, body, github_handle, created_at FROM updates WHERE wish_id = ? ORDER BY id').bind(wishId).all<Update>()
  return results
}
```

- [ ] **Step 3: collab.test.ts 加 updates 測試**

```ts
import { addUpdate, listUpdates } from '../src/lib/d1'
describe('updates (work-log)', () => {
  it('adds updates, coerces kind, lists in order', async () => {
    const id = await createWish(db(), { title: 'T', status: 'building', open_questions: [] }, 1)
    await addUpdate(db(), id, { kind: 'claim', body: '我認領了', github_handle: 'alice' }, 10)
    await addUpdate(db(), id, { kind: 'weird', body: '做到一半' }, 20)  // -> progress
    const list = await listUpdates(db(), id)
    expect(list.map((u) => u.kind)).toEqual(['claim', 'progress'])
    expect(list[0].github_handle).toBe('alice')
  })
})
```
(beforeEach 加 `await db().exec('DELETE FROM updates')`。)

- [ ] **Step 4: 跑測試 + typecheck**

Run: `cd worker && npm test -- collab && npm run typecheck`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add worker/src/lib/d1.ts worker/test/collab.test.ts
git commit -m "feat(worker): updates (work-log) data layer + getWish includes updates"
```

---

## Task 4: d1.ts — answers + answer_votes + accept 資料層

**Files:**
- Modify: `worker/src/lib/d1.ts`
- Modify: `worker/test/collab.test.ts`

**Interfaces:**
- Produces:
  - `type Answer = { id: number; repo_url: string; note: string | null; github_handle: string | null; votes: number; status: string; created_at: number }`
  - `createAnswer(db, wishId, a: { repo_url: string; note?: string; github_handle?: string }, now): Promise<number>`
  - `listAnswers(db, wishId, opts?: { includeHidden?: boolean }): Promise<Answer[]>`(依 votes DESC, created_at DESC)
  - `addAnswerVote(db, answerId, fingerprint, now): Promise<{ ok: boolean; votes: number }>`(軟去重,鏡射 phase 1 addVote)
  - `setAnswerStatus(db, answerId, status): Promise<void>`
  - `acceptAnswer(db, wishId, answerId): Promise<void>`(設 wishes.accepted_answer_id + status='done')
  - `Wish` 型別加 `answers: Answer[]`;getWish 回傳含 answers(只 visible)+ `accepted_answer_id`(WishRow 已含此欄,見下)。

- [ ] **Step 1: WishRow 加 accepted_answer_id + Wish 加 answers**

WishRow 型別加 `accepted_answer_id: number | null`(migration 已加欄;getWish 的 `SELECT *` 會帶回)。Wish 型別加 `answers: Answer[]`。加 Answer 型別:

```ts
export type Answer = { id: number; repo_url: string; note: string | null; github_handle: string | null; votes: number; status: string; created_at: number }
```

WishRow(找到現有 type WishRow,加一欄):

```ts
  status: string; votes: number; created_at: number; accepted_answer_id: number | null
}
```

Wish 型別最終:

```ts
export type Wish = WishRow & {
  needs: Need[]
  updates: Update[]
  answers: Answer[]
  responses: { id: number; question_id: number | null; body: string; nickname: string | null; kind: string; created_at: number }[]
}
```

getWish 加讀 answers(只 visible)並放進回傳:

```ts
  const a = await db.prepare("SELECT id, repo_url, note, github_handle, votes, status, created_at FROM answers WHERE wish_id = ? AND status = 'visible' ORDER BY votes DESC, created_at DESC").bind(id).all<Answer>()
  return { ...row, needs: q.results, updates: u.results, answers: a.results, responses: r.results }
```

- [ ] **Step 2: d1.ts 末尾加 answers 函式**

```ts
export async function createAnswer(
  db: D1Database, wishId: number, a: { repo_url: string; note?: string; github_handle?: string }, now: number,
): Promise<number> {
  const res = await db.prepare('INSERT INTO answers (wish_id, repo_url, note, github_handle, votes, status, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)')
    .bind(wishId, a.repo_url, a.note ?? null, a.github_handle ?? null, 'visible', now).run()
  return res.meta.last_row_id as number
}
export async function listAnswers(db: D1Database, wishId: number, opts: { includeHidden?: boolean } = {}): Promise<Answer[]> {
  const where = opts.includeHidden ? '' : "AND status = 'visible'"
  const { results } = await db.prepare(`SELECT id, repo_url, note, github_handle, votes, status, created_at FROM answers WHERE wish_id = ? ${where} ORDER BY votes DESC, created_at DESC`).bind(wishId).all<Answer>()
  return results
}
export async function addAnswerVote(db: D1Database, answerId: number, fingerprint: string, now: number): Promise<{ ok: boolean; votes: number }> {
  try {
    await db.prepare('INSERT INTO answer_votes (answer_id, fingerprint, created_at) VALUES (?, ?, ?)').bind(answerId, fingerprint, now).run()
  } catch (e) {
    if (!String((e as Error)?.message ?? e).includes('UNIQUE')) throw e
    const cur = await db.prepare('SELECT votes FROM answers WHERE id = ?').bind(answerId).first<{ votes: number }>()
    return { ok: false, votes: cur?.votes ?? 0 }
  }
  const upd = await db.prepare('UPDATE answers SET votes = votes + 1 WHERE id = ? RETURNING votes').bind(answerId).first<{ votes: number }>()
  return { ok: true, votes: upd?.votes ?? 0 }
}
export async function answerExists(db: D1Database, id: number): Promise<boolean> {
  const row = await db.prepare('SELECT 1 AS x FROM answers WHERE id = ?').bind(id).first<{ x: number }>()
  return !!row
}
export async function setAnswerStatus(db: D1Database, id: number, status: string): Promise<void> {
  const s = status === 'hidden' ? 'hidden' : 'visible'
  await db.prepare('UPDATE answers SET status = ? WHERE id = ?').bind(s, id).run()
}
export async function acceptAnswer(db: D1Database, wishId: number, answerId: number): Promise<void> {
  await db.prepare("UPDATE wishes SET accepted_answer_id = ?, status = 'done' WHERE id = ?").bind(answerId, wishId).run()
}
```

- [ ] **Step 3: collab.test.ts 加 answers 測試**

```ts
import { createAnswer, listAnswers, addAnswerVote, setAnswerStatus, acceptAnswer, answerExists } from '../src/lib/d1'
describe('answers', () => {
  it('multiple answers all visible, sorted by votes', async () => {
    const id = await createWish(db(), { title: 'T', status: 'published', open_questions: [] }, 1)
    const a1 = await createAnswer(db(), id, { repo_url: 'https://github.com/x/a', note: '版本一', github_handle: 'x' }, 1)
    const a2 = await createAnswer(db(), id, { repo_url: 'https://github.com/y/b', note: '版本二' }, 2)
    await addAnswerVote(db(), a2, 'fp1', 3)
    const list = await listAnswers(db(), id)
    expect(list.map((a) => a.id)).toEqual([a2, a1])   // a2 has 1 vote, first
    expect(list.length).toBe(2)                        // both visible
    void a1
  })
  it('answer vote dedups per fingerprint', async () => {
    const id = await createWish(db(), { title: 'T', status: 'published', open_questions: [] }, 1)
    const a = await createAnswer(db(), id, { repo_url: 'https://github.com/x/a' }, 1)
    expect(await addAnswerVote(db(), a, 'fp', 2)).toEqual({ ok: true, votes: 1 })
    expect(await addAnswerVote(db(), a, 'fp', 3)).toEqual({ ok: false, votes: 1 })
  })
  it('hidden answers excluded unless includeHidden; accept sets done + accepted_answer_id', async () => {
    const id = await createWish(db(), { title: 'T', status: 'published', open_questions: [] }, 1)
    const a = await createAnswer(db(), id, { repo_url: 'https://github.com/x/a' }, 1)
    await setAnswerStatus(db(), a, 'hidden')
    expect((await listAnswers(db(), id)).length).toBe(0)
    expect((await listAnswers(db(), id, { includeHidden: true })).length).toBe(1)
    await setAnswerStatus(db(), a, 'visible')
    expect(await answerExists(db(), a)).toBe(true)
    await acceptAnswer(db(), id, a)
    const w = await getWish(db(), id)
    expect(w?.status).toBe('done')
    expect(w?.accepted_answer_id).toBe(a)
  })
})
```
(beforeEach 加 `await db().exec('DELETE FROM answer_votes'); await db().exec('DELETE FROM answers')`。)

- [ ] **Step 4: 跑測試 + typecheck**

Run: `cd worker && npm test -- collab d1 && npm run typecheck`
Expected: PASS(含 phase 1 全套仍綠)。

- [ ] **Step 5: Commit**

```bash
git add worker/src/lib/d1.ts worker/test/collab.test.ts
git commit -m "feat(worker): answers + answer_votes + accept data layer"
```

---

## Task 5: collab 路由(POST answers / answer vote / updates / needs)

**Files:**
- Create: `worker/src/routes/collab.ts`
- Modify: `worker/src/index.ts`
- Test: `worker/test/collab.route.test.ts`

**Interfaces:**
- Consumes: d1 函式(Task 2-4)、`verifyTurnstile`、`checkAndBump`、`hashIp`、`wishExists`。
- Produces:(掛在 app,前綴 `/api`)
  - `POST /api/wishes/:id/answers` `{ turnstileToken, repo_url, note?, github_handle? }` → `{ id }`(Turnstile+限流;wish 不存在→404;repo_url 非 http(s)→400)
  - `POST /api/answers/:id/vote` `{ turnstileToken }` → `{ ok, votes }`(答案不存在→404)
  - `POST /api/wishes/:id/updates` `{ turnstileToken, kind, body, github_handle? }` → `{ id }`(body 必填→400;wish 不存在→404)
  - `POST /api/wishes/:id/needs` `{ turnstileToken, type, body }` → `{ id }`(body 必填→400;wish 不存在→404)
  - 匯出符號 `collab`(Hono instance)。

- [ ] **Step 1: 寫失敗測試 `worker/test/collab.route.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { SELF, env, fetchMock } from 'cloudflare:test'

const O = 'https://test.local'
const H = { 'Content-Type': 'application/json', Origin: O }

beforeEach(async () => {
  for (const t of ['answer_votes', 'answers', 'updates', 'needs', 'responses', 'open_questions', 'wishes', 'rate_limits']) await env.DB.exec(`DELETE FROM ${t}`)
  fetchMock.activate(); fetchMock.disableNetConnect()
})
function mockTurnstileOk() {
  fetchMock.get('https://challenges.cloudflare.com').intercept({ path: /siteverify/, method: 'POST' }).reply(200, { success: true }).persist()
}
async function seed() {
  const { createWish } = await import('../src/lib/d1')
  return createWish(env.DB, { title: 'T', status: 'published', open_questions: [] }, 1)
}

describe('POST /api/wishes/:id/answers', () => {
  it('valid repo_url -> {id}; then GET wish shows the answer', async () => {
    mockTurnstileOk(); const id = await seed()
    const res = await SELF.fetch(`${O}/api/wishes/${id}/answers`, { method: 'POST', headers: H,
      body: JSON.stringify({ turnstileToken: 't', repo_url: 'https://github.com/x/a', note: '版本一', github_handle: 'x' }) })
    expect(res.status).toBe(200)
    const w = await SELF.fetch(`${O}/api/wishes/${id}`).then((r) => r.json<any>())
    expect(w.answers.length).toBe(1)
    expect(w.answers[0].repo_url).toBe('https://github.com/x/a')
  })
  it('non-http repo_url -> 400', async () => {
    mockTurnstileOk(); const id = await seed()
    const res = await SELF.fetch(`${O}/api/wishes/${id}/answers`, { method: 'POST', headers: H,
      body: JSON.stringify({ turnstileToken: 't', repo_url: 'javascript:alert(1)' }) })
    expect(res.status).toBe(400)
  })
  it('nonexistent wish -> 404', async () => {
    mockTurnstileOk()
    const res = await SELF.fetch(`${O}/api/wishes/99999/answers`, { method: 'POST', headers: H,
      body: JSON.stringify({ turnstileToken: 't', repo_url: 'https://github.com/x/a' }) })
    expect(res.status).toBe(404)
  })
  it('turnstile fail (empty token) -> 403', async () => {
    const id = await seed()
    const res = await SELF.fetch(`${O}/api/wishes/${id}/answers`, { method: 'POST', headers: H,
      body: JSON.stringify({ turnstileToken: '', repo_url: 'https://github.com/x/a' }) })
    expect(res.status).toBe(403)
  })
})

describe('POST /api/answers/:id/vote', () => {
  it('votes once, dup ok:false, 404 on missing', async () => {
    mockTurnstileOk(); const id = await seed()
    const { createAnswer } = await import('../src/lib/d1')
    const aid = await createAnswer(env.DB, id, { repo_url: 'https://github.com/x/a' }, 1)
    const a = await SELF.fetch(`${O}/api/answers/${aid}/vote`, { method: 'POST', headers: H, body: JSON.stringify({ turnstileToken: 't' }) })
    expect((await a.json<any>()).votes).toBe(1)
    const b = await SELF.fetch(`${O}/api/answers/${aid}/vote`, { method: 'POST', headers: H, body: JSON.stringify({ turnstileToken: 't' }) })
    expect((await b.json<any>()).ok).toBe(false)
    const c = await SELF.fetch(`${O}/api/answers/99999/vote`, { method: 'POST', headers: H, body: JSON.stringify({ turnstileToken: 't' }) })
    expect(c.status).toBe(404)
  })
})

describe('POST updates + needs', () => {
  it('adds an update; GET wish shows it', async () => {
    mockTurnstileOk(); const id = await seed()
    const res = await SELF.fetch(`${O}/api/wishes/${id}/updates`, { method: 'POST', headers: H,
      body: JSON.stringify({ turnstileToken: 't', kind: 'claim', body: '我認領了', github_handle: 'a' }) })
    expect(res.status).toBe(200)
    const w = await SELF.fetch(`${O}/api/wishes/${id}`).then((r) => r.json<any>())
    expect(w.updates[0].kind).toBe('claim')
  })
  it('update empty body -> 400', async () => {
    mockTurnstileOk(); const id = await seed()
    const res = await SELF.fetch(`${O}/api/wishes/${id}/updates`, { method: 'POST', headers: H,
      body: JSON.stringify({ turnstileToken: 't', kind: 'progress', body: '  ' }) })
    expect(res.status).toBe(400)
  })
  it('adds a need; GET wish shows it', async () => {
    mockTurnstileOk(); const id = await seed()
    const res = await SELF.fetch(`${O}/api/wishes/${id}/needs`, { method: 'POST', headers: H,
      body: JSON.stringify({ turnstileToken: 't', type: 'resource', body: '需要一台測試機' }) })
    expect(res.status).toBe(200)
    const w = await SELF.fetch(`${O}/api/wishes/${id}`).then((r) => r.json<any>())
    expect(w.needs.some((n: any) => n.type === 'resource')).toBe(true)
  })
})
```

- [ ] **Step 2: 跑確認失敗**

Run: `cd worker && npm test -- collab.route`
Expected: FAIL(路由不存在)。

- [ ] **Step 3: 實作 `worker/src/routes/collab.ts`**

```ts
import { Hono } from 'hono'
import type { Env } from '../env'
import { wishExists, createAnswer, addAnswerVote, answerExists, addUpdate, createNeed } from '../lib/d1'
import { verifyTurnstile } from '../lib/turnstile'
import { checkAndBump, hashIp } from '../lib/ratelimit'

const DAY = 86400
export const collab = new Hono<{ Bindings: Env }>()

function ip(c: any): string { return c.req.header('CF-Connecting-IP') || '0.0.0.0' }
async function guard(c: any, token: string, action: string, limit: number): Promise<Response | null> {
  if (!(await verifyTurnstile(token, ip(c), c.env.TURNSTILE_SECRET))) return c.json({ error: 'turnstile_failed' }, 403)
  const fp = await hashIp(ip(c), c.env.IP_SALT)
  if (!(await checkAndBump(c.env.DB, `${action}:${fp}`, limit, DAY, Math.floor(Date.now() / 1000)))) return c.json({ error: 'rate_limited' }, 429)
  return null
}
function isHttpUrl(s: unknown): boolean {
  if (typeof s !== 'string') return false
  try { const u = new URL(s); return u.protocol === 'http:' || u.protocol === 'https:' } catch { return false }
}

collab.post('/api/wishes/:id/answers', async (c) => {
  const id = Number(c.req.param('id'))
  const b = await c.req.json().catch(() => ({}))
  const blocked = await guard(c, b.turnstileToken, 'answer', 20); if (blocked) return blocked
  if (!Number.isInteger(id) || !(await wishExists(c.env.DB, id))) return c.json({ error: 'not_found' }, 404)
  if (!isHttpUrl(b.repo_url)) return c.json({ error: 'bad_repo_url' }, 400)
  const aid = await createAnswer(c.env.DB, id, { repo_url: String(b.repo_url), note: b.note, github_handle: b.github_handle }, Math.floor(Date.now() / 1000))
  return c.json({ id: aid })
})

collab.post('/api/answers/:id/vote', async (c) => {
  const id = Number(c.req.param('id'))
  const b = await c.req.json().catch(() => ({}))
  const blocked = await guard(c, b.turnstileToken, 'avote', 200); if (blocked) return blocked
  if (!Number.isInteger(id) || !(await answerExists(c.env.DB, id))) return c.json({ error: 'not_found' }, 404)
  const fp = await hashIp(ip(c), c.env.IP_SALT)
  return c.json(await addAnswerVote(c.env.DB, id, fp, Math.floor(Date.now() / 1000)))
})

collab.post('/api/wishes/:id/updates', async (c) => {
  const id = Number(c.req.param('id'))
  const b = await c.req.json().catch(() => ({}))
  const blocked = await guard(c, b.turnstileToken, 'update', 30); if (blocked) return blocked
  if (!Number.isInteger(id) || !(await wishExists(c.env.DB, id))) return c.json({ error: 'not_found' }, 404)
  const body = String(b.body ?? '').trim(); if (!body) return c.json({ error: 'body_required' }, 400)
  const uid = await addUpdate(c.env.DB, id, { kind: String(b.kind ?? 'progress'), body, github_handle: b.github_handle }, Math.floor(Date.now() / 1000))
  return c.json({ id: uid })
})

collab.post('/api/wishes/:id/needs', async (c) => {
  const id = Number(c.req.param('id'))
  const b = await c.req.json().catch(() => ({}))
  const blocked = await guard(c, b.turnstileToken, 'need', 30); if (blocked) return blocked
  if (!Number.isInteger(id) || !(await wishExists(c.env.DB, id))) return c.json({ error: 'not_found' }, 404)
  const body = String(b.body ?? '').trim(); if (!body) return c.json({ error: 'body_required' }, 400)
  const nid = await createNeed(c.env.DB, id, String(b.type ?? 'info'), body)
  return c.json({ id: nid })
})
```

- [ ] **Step 4: 掛到 `worker/src/index.ts`**

加 `import { collab } from './routes/collab'` 與 `app.route('/', collab)`(在 export default 前,與其他 route 並列)。

- [ ] **Step 5: 跑測試 + 全套 + typecheck**

Run: `cd worker && npm test -- collab.route && npm test && npm run typecheck`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add worker/src/routes/collab.ts worker/src/index.ts worker/test/collab.route.test.ts
git commit -m "feat(worker): collab routes — answers/answer-vote/updates/needs"
```

---

## Task 6: admin 擴充(answer 隱藏 / accept / need resolve)

**Files:**
- Modify: `worker/src/routes/admin.ts`
- Modify: `worker/test/admin.route.test.ts`

**Interfaces:**
- Consumes: `setAnswerStatus`, `acceptAnswer`, `resolveNeed`, `answerExists`。
- Produces:(需 Bearer ADMIN_TOKEN)
  - `POST /api/admin/answers/:id/status` `{ status: 'visible'|'hidden' }` → `{ ok: true }`
  - `POST /api/admin/wishes/:id/accept` `{ answer_id }` → `{ ok: true }`(設 accepted + done)
  - `POST /api/admin/needs/:id/resolve` → `{ ok: true }`

- [ ] **Step 1: admin.test.ts 加測試**

```ts
describe('admin phase2', () => {
  it('hide an answer, accept an answer -> wish done + accepted', async () => {
    const { createWish, createAnswer } = await import('../src/lib/d1')
    const id = await createWish(env.DB, { title: 'T', status: 'published', open_questions: [] }, 1)
    const aid = await createAnswer(env.DB, id, { repo_url: 'https://github.com/x/a' }, 1)
    const hide = await SELF.fetch(`${O}/api/admin/answers/${aid}/status`, { method: 'POST', headers: AUTH, body: JSON.stringify({ status: 'hidden' }) })
    expect(hide.status).toBe(200)
    const acc = await SELF.fetch(`${O}/api/admin/wishes/${id}/accept`, { method: 'POST', headers: AUTH, body: JSON.stringify({ answer_id: aid }) })
    expect(acc.status).toBe(200)
    const w = await SELF.fetch(`${O}/api/wishes/${id}`).then((r) => r.json<any>())
    expect(w.status).toBe('done'); expect(w.accepted_answer_id).toBe(aid)
  })
  it('accept with bad answer_id -> 400; admin endpoints need token', async () => {
    const { createWish } = await import('../src/lib/d1')
    const id = await createWish(env.DB, { title: 'T', status: 'published', open_questions: [] }, 1)
    const bad = await SELF.fetch(`${O}/api/admin/wishes/${id}/accept`, { method: 'POST', headers: AUTH, body: JSON.stringify({ answer_id: 99999 }) })
    expect(bad.status).toBe(400)
    const noauth = await SELF.fetch(`${O}/api/admin/needs/1/resolve`, { method: 'POST' })
    expect(noauth.status).toBe(401)
  })
})
```
(beforeEach 需清 answers/needs;沿用該檔既有 AUTH/O 常數。)

- [ ] **Step 2: 跑確認失敗**

Run: `cd worker && npm test -- admin.route`
Expected: FAIL。

- [ ] **Step 3: admin.ts 加路由**

在既有 admin.ts import 加 `setAnswerStatus, acceptAnswer, resolveNeed, answerExists`,並在 middleware 之後加:

```ts
admin.post('/api/admin/answers/:id/status', async (c) => {
  const b = await c.req.json().catch(() => ({}))
  await setAnswerStatus(c.env.DB, Number(c.req.param('id')), b.status)
  return c.json({ ok: true })
})
admin.post('/api/admin/wishes/:id/accept', async (c) => {
  const b = await c.req.json().catch(() => ({}))
  const aid = Number(b.answer_id)
  if (!Number.isInteger(aid) || !(await answerExists(c.env.DB, aid))) return c.json({ error: 'bad_answer' }, 400)
  await acceptAnswer(c.env.DB, Number(c.req.param('id')), aid)
  return c.json({ ok: true })
})
admin.post('/api/admin/needs/:id/resolve', async (c) => {
  await resolveNeed(c.env.DB, Number(c.req.param('id')))
  return c.json({ ok: true })
})
```

- [ ] **Step 4: 跑測試 + 全套 + typecheck**

Run: `cd worker && npm test && npm run typecheck`
Expected: PASS(全綠)。

- [ ] **Step 5: Commit**

```bash
git add worker/src/routes/admin.ts worker/test/admin.route.test.ts
git commit -m "feat(worker): admin — hide answer / accept answer / resolve need"
```

---

## Task 7: 前端願望詳情擴充(needs / work-log / answers + 表單 + 下載規格)

**Files:**
- Modify: `app.js`(openDetail 區塊)
- Modify: `styles.css`(answer/need/update 樣式)

**Interfaces:**
- Consumes: 既有 `$`, `el`, `api`, `getTurnstileToken`;新 API `POST …/answers`, `POST /api/answers/:id/vote`, `POST …/updates`, `POST …/needs`;getWish 回傳現含 `needs/updates/answers`(不再有 open_questions)。
- Produces:openDetail 內顯示四區(還缺什麼 / 進度 / 實作版本 / 討論)+ 交答案/貼進度表單 + 下載規格鈕。

- [ ] **Step 1: 改 `app.js` 的 openDetail —— 讀 needs 取代 open_questions,加 updates/answers 區**

把現有 openDetail 的 `w.open_questions.forEach(...)` 段換成讀 `w.needs`,並在 responses 之後插入 updates 區與 answers 區。openDetail 內容改為:

```js
async function openDetail(id, card) {
  if (card.querySelector('.detail')) { card.querySelector('.detail').remove(); return }
  let w
  try { w = await api(`/api/wishes/${id}`) } catch (e) { alert('載入失敗,請稍後再試'); return }
  const box = el('div', 'detail')

  // 還缺什麼(needs)
  if (w.needs.length) {
    box.appendChild(el('h4', 'detail-h', '還缺什麼'))
    w.needs.forEach((n) => {
      const label = { info: '缺資訊', skill: '缺技能', resource: '缺資源' }[n.type] || '缺資訊'
      box.appendChild(el('div', 'need' + (n.resolved ? ' resolved' : ''), `[${label}] ${n.body}`))
    })
  }
  const addNeed = el('button', null, '補一個「還缺什麼」')
  addNeed.onclick = () => submitNeed(id, box)
  box.appendChild(addNeed)

  // 進度(work-log)
  box.appendChild(el('h4', 'detail-h', '進度'))
  if (w.updates.length) w.updates.forEach((u) => {
    const kind = { claim: '認領', progress: '進度', blocked: '卡關' }[u.kind] || '進度'
    const line = el('div', 'update')
    line.appendChild(el('span', 'update-kind ' + u.kind, kind))
    line.appendChild(el('span', null, ' ' + u.body))
    line.appendChild(el('span', 'who', u.github_handle ? '  @' + u.github_handle : ''))
    box.appendChild(line)
  })
  else box.appendChild(el('div', 'muted', '還沒有人認領或回報進度'))
  const addUpdate = el('button', null, '認領 / 回報進度')
  addUpdate.onclick = () => submitUpdate(id, box)
  box.appendChild(addUpdate)

  // 實作版本(answers)
  box.appendChild(el('h4', 'detail-h', `實作版本(${w.answers.length})`))
  w.answers.forEach((a, i) => {
    const ans = el('div', 'answer')
    const top = el('div', 'answer-top')
    const link = el('a', 'repo-link'); link.href = a.repo_url; link.textContent = a.repo_url
    link.target = '_blank'; link.rel = 'noopener nofollow'
    top.appendChild(link)
    if (a.id === w.accepted_answer_id) top.appendChild(el('span', 'badge done', '官方採用'))
    else if (i === 0 && a.votes > 0) top.appendChild(el('span', 'badge adopted', '參考答案'))
    ans.appendChild(top)
    if (a.note) ans.appendChild(el('div', null, a.note))
    const foot = el('div', 'answer-foot')
    const vote = el('button', 'vote'); vote.setAttribute('aria-label', '為這個實作版本加一票')
    vote.append('▲ ', el('span', null, String(a.votes)))
    vote.onclick = () => voteAnswer(a.id, vote)
    foot.appendChild(vote)
    if (a.github_handle) foot.appendChild(el('span', 'muted', '@' + a.github_handle))
    ans.appendChild(foot)
    box.appendChild(ans)
  })
  const addAnswer = el('button', 'primary', '我做了這個,交 repo')
  addAnswer.onclick = () => submitAnswer(id, box)
  box.appendChild(addAnswer)

  // 討論(responses / 我也要)
  if (w.responses.length) {
    box.appendChild(el('h4', 'detail-h', '討論'))
    w.responses.forEach((r) => {
      const rr = el('div', 'resp')
      rr.appendChild(el('div', null, (r.kind === 'metoo' ? '我也要:' : '') + r.body))
      rr.appendChild(el('div', 'who', r.nickname ? '— ' + r.nickname : '— 匿名'))
      box.appendChild(rr)
    })
  }
  const metoo = el('button', null, '我也要 / 補一句')
  metoo.onclick = () => respond(id, box, null)
  box.appendChild(metoo)

  // 下載規格
  const dl = el('button', null, '下載規格')
  dl.onclick = () => downloadSpec(w)
  box.appendChild(dl)

  card.appendChild(box)
}
```

- [ ] **Step 2: `app.js` 末尾加提交/下載函式**

```js
async function postWithTurnstile(path, payload, okMsg, box) {
  try {
    const token = await getTurnstileToken()
    await api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, turnstileToken: token }) })
    if (box) box.remove()   // 重開會重新載入最新
    alert(okMsg)
  } catch (e) { alert(e.status === 429 ? '今天次數已達上限,明天再來' : '送出失敗,請稍後再試') }
}
async function submitAnswer(wishId, box) {
  const repo = prompt('你的 repo 網址(https://github.com/...):')
  if (!repo || !/^https?:\/\//.test(repo.trim())) { if (repo !== null) alert('請貼有效的 http(s) 網址'); return }
  const note = prompt('一句話說明這個版本(可留空):') || undefined
  const handle = prompt('你的 GitHub 帳號(選填,未驗證):') || undefined
  await postWithTurnstile(`/api/wishes/${wishId}/answers`, { repo_url: repo.trim(), note, github_handle: handle }, '已交出,謝謝你的實作', box)
}
async function voteAnswer(answerId, btn) {
  try {
    const token = await getTurnstileToken()
    const r = await api(`/api/answers/${answerId}/vote`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ turnstileToken: token }) })
    btn.querySelector('span').textContent = r.votes
    if (!r.ok) btn.disabled = true
  } catch (e) { alert('投票失敗,請稍後再試') }
}
async function submitUpdate(wishId, box) {
  const kindLabel = prompt('類型:輸入 1=認領 2=進度 3=卡關', '2')
  const kind = { '1': 'claim', '2': 'progress', '3': 'blocked' }[String(kindLabel).trim()] || 'progress'
  const body = prompt('內容(例:我認領了 / 做到 X / 卡在 Y):')
  if (!body || !body.trim()) return
  const handle = prompt('你的 GitHub 帳號(選填):') || undefined
  await postWithTurnstile(`/api/wishes/${wishId}/updates`, { kind, body: body.trim(), github_handle: handle }, '已記錄,謝謝', box)
}
async function submitNeed(wishId, box) {
  const typeLabel = prompt('缺什麼類型:1=資訊 2=技能 3=資源', '1')
  const type = { '1': 'info', '2': 'skill', '3': 'resource' }[String(typeLabel).trim()] || 'info'
  const body = prompt('還缺什麼?')
  if (!body || !body.trim()) return
  await postWithTurnstile(`/api/wishes/${wishId}/needs`, { type, body: body.trim() }, '已補上,謝謝', box)
}
function downloadSpec(w) {
  const lines = [
    `# ${w.title}`, '',
    `- 問題:${w.problem || ''}`, `- 現況:${w.current || ''}`, `- 期望:${w.desired || ''}`, `- 誰會用:${w.who || ''}`, '',
    '## 還缺什麼', ...(w.needs || []).map((n) => `- [${n.resolved ? 'x' : ' '}] (${n.type}) ${n.body}`), '',
    `願望連結:${location.origin}${location.pathname}#wish-${w.id}`,
  ]
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown' })
  const a = el('a'); const url = URL.createObjectURL(blob); a.href = url; a.download = `wish-${w.id}.md`; a.click(); URL.revokeObjectURL(url)
}
```

- [ ] **Step 3: `styles.css` 加樣式**

```css
.detail-h { margin: 14px 0 6px; font-size: .95rem; color: var(--c-text); }
.need { border-left: 3px solid var(--c-accent-2); padding: 4px 10px; margin: 4px 0; color: var(--c-muted); font-size: .9rem; }
.need.resolved { opacity: .5; text-decoration: line-through; }
.update { padding: 4px 0; font-size: .9rem; }
.update-kind { font-size: .72rem; padding: 1px 8px; border-radius: 999px; background: var(--c-surface-2); color: var(--c-muted); }
.update-kind.blocked { color: var(--c-danger); }
.answer { background: var(--c-surface-2); border-radius: 8px; padding: 10px 12px; margin: 8px 0; }
.answer-top { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.repo-link { color: var(--c-accent-2); word-break: break-all; }
.answer-foot { display: flex; gap: 10px; align-items: center; margin-top: 6px; }
```

- [ ] **Step 4: 語法檢查**

Run: `node --check app.js`
Expected: OK。手動驗證(需 worker 跑):開一則願望詳情,四區顯示、交答案/投票/貼進度/補 need/下載規格可用(此為 UI task,控制器會在部署後做真瀏覽器 E2E)。

- [ ] **Step 5: Commit**

```bash
git add app.js styles.css
git commit -m "feat(web): wish detail — needs / work-log / answer versions + forms + download spec"
```

---

## Task 8: 看板 board.html + board.js(狀態分組 + 已實現牆)

**Files:**
- Create: `board.html`, `board.js`
- Modify: `index.html`(hero 下加「看板」連結)

**Interfaces:**
- Consumes: `GET /api/wishes`(現回傳含每筆 votes/status;board 依 status 分組)。為了進度徽章,board 逐筆或用列表即可(答案數等進 GET 列表較貴 —— v1 board 只用列表的 status + votes,徽章顯示票數;詳細進度點進願望看)。
- Produces:board 依 status 分組顯示,done 分區即已實現牆。

- [ ] **Step 1: `board.html`**

```html
<!DOCTYPE html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>願望池 · 看板</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <div class="wrap">
    <header class="hero"><h1>願望看板</h1><p>每則願望的狀態一覽 · <a class="repo-link" href="index.html">回許願牆</a></p></header>
    <div id="board"></div>
    <p id="empty" class="muted" style="display:none">還沒有願望。</p>
  </div>
  <script src="config.js"></script>
  <script src="board.js"></script>
</body>
</html>
```

- [ ] **Step 2: `board.js`**

```js
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
  try { wishes = (await (await fetch(`${API}/api/wishes?sort=new&limit=100`)).json()).wishes } catch (e) { $('#empty').style.display = 'block'; $('#empty').textContent = '載入失敗,請稍後重試。'; return }
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
```

- [ ] **Step 3: `index.html` hero 加看板連結**

在 hero 的 `<p>...</p>` 後加一行:

```html
      <p><a class="repo-link" href="board.html">看願望看板 / 已實現牆</a></p>
```

- [ ] **Step 4: `styles.css` 加 board 樣式**

```css
.board-col { margin-bottom: 22px; }
.board-col-h { font-size: 1.05rem; border-bottom: 1px solid var(--c-border); padding-bottom: 6px; }
.board-card { display: block; background: var(--c-surface); border: 1px solid var(--c-border); border-radius: 10px; padding: 12px 14px; margin: 8px 0; color: var(--c-text); }
.board-card:hover { border-color: var(--c-accent); }
.board-card-title { font-weight: 600; margin-bottom: 4px; }
@media (min-width: 820px) { #board { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; align-items: start; } .board-col { margin-bottom: 0; } }
```

- [ ] **Step 5: 語法檢查**

Run: `node --check board.js`
Expected: OK。手動:桌機四欄、手機四區堆疊;done 區= 已實現牆。

- [ ] **Step 6: Commit**

```bash
git add board.html board.js index.html styles.css
git commit -m "feat(web): board view (status columns) + already-realized wall + nav link"
```

---

## Task 9: admin 前端擴充(隱藏答案 / accept / resolve need)

**Files:**
- Modify: `admin.html`, `admin.js`

**Interfaces:**
- Consumes: `POST /api/admin/answers/:id/status`, `POST /api/admin/wishes/:id/accept`, `POST /api/admin/needs/:id/resolve`;`GET /api/wishes/:id`(拿 answers/needs)。
- Produces:admin 卡片可展開該願望的 answers(隱藏/採用)與 needs(標已解)。

- [ ] **Step 1: `admin.js` —— 每張卡加「管理實作/需求」展開**

在 admin.js 的卡片渲染(load() 內 forEach 的 foot 之後)加一顆按鈕與展開邏輯。於 `card.appendChild(foot)` 之前插入:

```js
    const manage = el('button', null, '管理實作 / 需求')
    manage.onclick = () => manageDetail(w.id, card)
    foot.appendChild(manage)
```

並在 admin.js 末尾加:

```js
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
    hide.onclick = async () => { await adminApi(`/api/admin/answers/${a.id}/status`, { method: 'POST', body: JSON.stringify({ status: 'hidden' }) }); manageDetail(id, card); manageDetail(id, card) }
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
      res.onclick = async () => { await adminApi(`/api/admin/needs/${n.id}/resolve`, { method: 'POST' }); manageDetail(id, card); manageDetail(id, card) }
      row.appendChild(res)
    }
    box.appendChild(row)
  })
  card.appendChild(box)
}
```

（注意:`manageDetail` 呼叫兩次是先關再開以刷新 —— 若嫌 hack,可改成先 `card.querySelector('.mdetail')?.remove()` 再重建。實作時擇一,測試以「操作後畫面更新且無錯」為準。）

- [ ] **Step 2: 語法檢查 + Commit**

Run: `node --check admin.js`
Expected: OK。

```bash
git add admin.html admin.js
git commit -m "feat(web): admin — manage answers (hide/accept) and resolve needs"
```

---

## Task 10: README 公開 API 文件

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README 加「公開 API(給協力者 / AI agent)」段**

在 README 末尾(License 之前)加:

````markdown
## 公開 API(給協力者 / AI agent)

願望池的資料是開放的 —— 有能力的人或 AI agent 可以直接打 API 撈願望、判斷「還缺什麼」、交出實作。

- `GET /api/wishes?sort=hot|new&limit&offset` → `{ wishes: [...] }`(每筆含 status、votes)
- `GET /api/wishes/:id` → 單一願望,含:
  - `needs[]`:`{ type: info|skill|resource, body, resolved }` —— **還缺哪些資訊/技能/資源才可能完成**
  - `updates[]`:`{ kind: claim|progress|blocked, body, github_handle, created_at }` —— 認領與進度(半成品可續)
  - `answers[]`:`{ repo_url, note, github_handle, votes }` —— 已有的實作版本
- `POST /api/wishes/:id/answers` `{ turnstileToken, repo_url, note?, github_handle? }` —— 交出你的 repo 實作
- `POST /api/answers/:id/vote` `{ turnstileToken }` —— 為某實作版本投票
- `POST /api/wishes/:id/updates` `{ turnstileToken, kind, body, github_handle? }` —— 認領 / 回報進度 / 標卡關
- `POST /api/wishes/:id/needs` `{ turnstileToken, type, body }` —— 補一個「還缺什麼」

寫入端需 Cloudflare Turnstile token(前端隱形取得)。平台只把 `repo_url` 當連結,**絕不抓取、執行或嵌入** repo 內容。
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: public API for contributors / AI agents (answers, needs, updates)"
```

---

## Task 11: 部署(remote migrate + worker deploy + 前端 push)

**Files:** 無(部署動作)。

- [ ] **Step 1: 套 migration 到 remote D1**

Run: `cd worker && npm run migrate:remote`
Expected: `0002_phase2.sql` 套用成功(遷移 open_questions → needs)。

- [ ] **Step 2: 部署 worker**

Run: `cd worker && npm run deploy`
Expected: 部署到 `https://wish-pool.yazelinj303.workers.dev`。

- [ ] **Step 3: 推前端(GitHub Pages 自動 rebuild)**

Run: `git push origin master`
Expected: 前端更新(index/app/board/admin/styles)。

- [ ] **Step 4: 冒煙驗證(公開端點)**

Run:
```bash
W=https://wish-pool.yazelinj303.workers.dev
curl -s "$W/api/wishes?sort=new" | head -c 200
```
Expected: 回 `{"wishes":[...]}`(現有願望;每筆含 accepted_answer_id 欄不影響列表)。

- [ ] **Step 5:(無 commit,部署動作)** 記錄部署結果到 ledger。

---

## Task 12: Bootstrap 已實現牆(owner 真專案)

**Files:**
- Create: `worker/scripts/seed-showcase.sql`

**Interfaces:** 產生「願望 + 已實現 answer(真 repo)」示範內容;owner 署名、0 假票、note 標站方示範。

- [ ] **Step 1: 建 `worker/scripts/seed-showcase.sql`**

用 owner 幾個公開真專案。每則:一個 done 願望 + 一個 answer(真 repo)+ accepted。votes 全 0。nickname/handle=站方。now 用固定 epoch 佔位(部署時 owner 可調)。

```sql
-- 站方示範:owner 真專案當已實現案例(0 假票、站方署名)
INSERT INTO wishes (title, problem, current, desired, who, nickname, status, votes, created_at) VALUES
 ('想要一個台灣風的滾物成球 3D 網頁遊戲', '想玩到有台灣在地感的 Katamari', '只有日本場景的版本', '滾遍台灣各城市地標的網頁遊戲', '想放鬆的人', '站方示範', 'done', 0, 1782900000),
 ('用 AI 描述就自動建 3D 模型並即時預覽', '不會 CAD 但想快速做 3D 原型', '手動建模很慢', '打字描述 → AI 生 FreeCAD 腳本 → three.js 即時看', '想做 3D 原型的人', '站方示範', 'done', 0, 1782900001),
 ('騎機車衝真實股價 K 線的網頁小遊戲', '想用好玩的方式看股價走勢', '看 K 線圖很枯燥', '把 K 線變成賽道,騎車衝上去', '對股市有興趣的人', '站方示範', 'done', 0, 1782900002);

INSERT INTO answers (wish_id, repo_url, note, github_handle, votes, status, created_at) VALUES
 ((SELECT id FROM wishes WHERE title LIKE '%滾物成球%'), 'https://github.com/yazelin/roll-formosa', '站方示範:這個願望已由 roll-formosa 實現', 'yazelin', 0, 'visible', 1782900010),
 ((SELECT id FROM wishes WHERE title LIKE '%自動建 3D 模型%'), 'https://github.com/yazelin/cad-agent', '站方示範:由 cad-agent 實現', 'yazelin', 0, 'visible', 1782900011),
 ((SELECT id FROM wishes WHERE title LIKE '%K 線%'), 'https://github.com/yazelin/k-rider', '站方示範:由 k-rider 實現', 'yazelin', 0, 'visible', 1782900012);

UPDATE wishes SET accepted_answer_id = (SELECT id FROM answers WHERE wish_id = wishes.id LIMIT 1)
 WHERE nickname = '站方示範';
```

- [ ] **Step 2: 套到 remote(owner 先過目)**

Run: `cd worker && npx wrangler d1 execute wish-pool --remote --file scripts/seed-showcase.sql`
Expected: 執行成功;`GET /api/wishes?sort=new` 看得到 3 則 done 願望;board.html 的「已實現」區 + 各願望詳情的「實作版本」看得到真 repo。

- [ ] **Step 3: Commit**

```bash
git add worker/scripts/seed-showcase.sql
git commit -m "chore(seed): bootstrap already-realized wall with owner real projects (0 fake votes)"
```

---

## Self-Review(對照 spec)

**Spec coverage:**
- 多版本 repo 答案全可見 + 投票 + 官方採用 → Task 4(listAnswers 全 visible、addAnswerVote、acceptAnswer)、Task 5(POST answers/vote)、Task 7(answers 區列全部)。✓
- 參考答案(最高票)/官方採用(pin)徽章不收其他 → Task 7(i===0&&votes>0 標參考、accepted 標官方,全部列出)。✓
- needs(還缺什麼,typed,給 AI 讀)→ Task 2(needs 資料 + getWish)、Task 5(POST needs)、Task 7(needs 區)、Task 10(API 文件)。✓
- 認領/work-log(半成品可續)→ Task 3(updates)、Task 5(POST updates)、Task 7(進度區)。✓
- 看板依狀態分組 + 進度徽章 → Task 8。✓
- 已實現牆 + owner 真專案 bootstrap(0 假票)→ Task 8(done 區)、Task 12。✓
- 下載規格 + 公開 API 文件 → Task 7(downloadSpec)、Task 10。✓
- open_questions → needs 遷移(保留舊表)→ Task 1(migration)、Task 2(getWish 切讀 needs)。✓
- 安全:repo 只當連結 rel=noopener nofollow、不抓取/執行;textContent → Task 7(link.rel、el textContent)、Task 5(isHttpUrl 擋 javascript:)。✓
- 寫入 Turnstile + 限流 → Task 5(guard)。✓
- 部署 + seed → Task 11、12。✓
- 非目標(錢/媒合/OAuth/拖拉 kanban/通知)→ 未實作,符合。✓

**Placeholder scan:** seed 的 created_at 用固定 epoch(佔位,部署時可調)—— 非 placeholder,是刻意固定值(scripts 沙盒無 Date.now)。admin.js manageDetail 的「呼叫兩次刷新」已註明可擇一實作。無 TODO/TBD。✓

**Type consistency:** `Need/Update/Answer` 型別、`createNeed/listNeeds/resolveNeed/addUpdate/listUpdates/createAnswer/listAnswers/addAnswerVote/answerExists/setAnswerStatus/acceptAnswer`、getWish 回傳 `{needs,updates,answers,responses,accepted_answer_id}`、路由回傳形狀(`{id}`,`{ok,votes}`)、前端 `postWithTurnstile/voteAnswer/submitAnswer/submitUpdate/submitNeed/downloadSpec` 跨 task 一致。getWish 不再回 open_questions(Task 2 起),phase 1 前端 openDetail 在 Task 7 同步改讀 needs —— 一致。✓

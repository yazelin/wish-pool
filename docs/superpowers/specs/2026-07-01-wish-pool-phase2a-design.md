# 願望池 Phase 2a — 協作實現層 設計 spec

日期:2026-07-01
狀態:已與 owner 敲定,待寫實作計劃
前置:建在 phase 1(已上線)之上 —— [2026-07-01-wish-pool-design.md](2026-07-01-wish-pool-design.md)

## 一句話

把許願池從「收集願望」升級成「**許願 → 有人做 → 兌現**」的協作平台:協力者(人或 AI)交 repo 實作、社群投票、多版本都看得見、進度透明、AI agent 讀得到「還缺什麼」,owner 收斂成「已實現牆」。

## 為什麼做(owner 決定)

Owner 明知需求尚未驗證,仍選擇「把這個實驗做完整」(為了好玩 + 完整性)。策略護城河不在「AI 幫你做 app」的技術(正在商品化),而在「引導式親民入口 + 社群活性 + 策展」。詳見市場對照:[market-scan.md](../market-scan.md)(若存在)。

## 角色

- **許願者** — 零登入,選填暱稱(phase 1 已有)。
- **協力者(貢獻者)** — 交 repo 答案 / 貼進度 / 補資源;**選填 GitHub handle(純文字,不驗證,無 OAuth)**。
- **Owner** — admin token;審核、改狀態、pin 官方採用、隱藏不當。

## 已敲定的關鍵決定

1. **協力者選填 GitHub handle**,零登入。信任靠 owner 審 + 社群投票。
2. **答案即時可見 + 社群投票 + owner 可隱藏/pin**。不先審(低摩擦),爛的靠 downvote/owner 隱藏。
3. **一則願望多個 repo 答案,全部可見**。「參考答案」(最高票)、「官方採用」(owner pin)只是**徽章**,不收起其他版本。只有 owner 隱藏的不顯示。
4. **看板 = 依狀態分組 + 進度徽章**(非拖拉式 kanban;手機體驗好、實作輕)。
5. **`needs` 取代 phase 1 的 `open_questions`**(升級成有類型的超集);舊資料遷成 `type=info`。
6. **v1 不碰錢**(bounty/結帳留 phase 2b)。
7. **已實現牆用 owner 自己的真專案 bootstrap**(誠實:owner 署名、0 假票、標明站方示範)。

## 非目標(留 phase 2b+)

- 真金流 bounty / 結帳(SHOPLINE/Stripe)。
- 自動媒合「這個願望早就有人做過」(embedding 相似度)。
- 協力者 GitHub OAuth 登入 / 排行榜 / 通知 / 拖拉式 kanban。

## 元件

### 1. 看板 view(新頁 `board.html`,或首頁加分組模式)
- 依狀態分組:**徵求中**(published)/ **已採納**(adopted)/ **開發中**(building)/ **已實現**(done)。手機堆疊分區,桌機可並排成欄。
- 每張卡顯示進度訊號:`答案數 · 認領人數 · 缺 N 項未補 · 最新 work-log 一行`。
- 狀態由 owner 在後台推進(phase 1 已有 setStatus)。

### 2. 「還缺什麼」needs(給人也給 AI 讀)
- 每則願望一組 needs:`{ id, wish_id, type: info|skill|resource, body, resolved }`。
- 來源:AI 引導產生(原 open_questions → `type=info`)+ owner/社群增刪 + 標已解。
- 進公開 API —— **AI agent 撈一則願望就知道「還要哪些資訊/技能/資源才可能完成」**。

### 3. 認領 + work-log(半成品可續)
- 每則願望一條進度軸:`updates { id, wish_id, kind: claim|progress|blocked|answer, body, github_handle, created_at }`。
- 任何人可貼(過 Turnstile + 限流),**不鎖定願望**(多人可並行)。
- 「Agent 做到一半、別人接手」= 進度公開、卡在哪寫明、接手者看得到脈絡。

### 4. repo 答案 + 投票 + 官方採用
- `answers { id, wish_id, repo_url, note, github_handle, votes, status: visible|hidden, created_at }`。
- 即時可見;每個答案可 +1(`answer_votes { answer_id, fingerprint }`,Turnstile + 軟去重,1 票/指紋/答案)。
- 願望詳情列**所有**答案(標題顯示「N 個實作版本」),可依 票數/最新 排;最高票標「參考答案」。
- Owner 標願望 `done` 時可 pin 一個答案為「官方採用」(`wishes.accepted_answer_id`,預設最高票)。

### 5. 已實現牆
- 看板的 `done` 分區 = showcase:兌現的願望 + 官方 repo 連結 + 協力者署名。
- **Bootstrap 內容**:owner 的真專案(roll-formosa / k-rider / cad-agent / red-cliffs / render-studio …)各建一則「願望 + 已實現 answer(真 repo)」,owner 署名、0 假票、note 標明「站方示範」。

### 6. 建單入口(給 AI/人接單)
- 每則願望「下載規格」鈕 → spec markdown(標題/問題/現況/期望/使用者/**還缺什麼 needs**/願望連結)。純前端組字串,零後端。
- README 補**公開 API 文件**(正式契約):`GET /api/wishes`、`GET /api/wishes/:id`(含 needs + updates + answers)、`POST …/answers`、`POST …/updates`。

## 資料模型(D1 加表 / 改欄)

```sql
CREATE TABLE needs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wish_id INTEGER NOT NULL,
  type TEXT NOT NULL DEFAULT 'info',   -- info|skill|resource
  body TEXT NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wish_id INTEGER NOT NULL,
  kind TEXT NOT NULL,                  -- claim|progress|blocked|answer
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
  status TEXT NOT NULL DEFAULT 'visible',   -- visible|hidden
  created_at INTEGER NOT NULL
);
CREATE TABLE answer_votes (
  answer_id INTEGER NOT NULL,
  fingerprint TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (answer_id, fingerprint)
);
-- wishes 加欄
ALTER TABLE wishes ADD COLUMN accepted_answer_id INTEGER;
-- 遷移:舊 open_questions -> needs(type=info);保留 open_questions 表或改讀 needs(見計劃)
```

遷移策略:新 migration 建上述表 + 把現有 `open_questions` 的每列 INSERT 進 `needs`(type='info', resolved 沿用)。前端/API 改讀 needs;open_questions 表可留著不動(讀取切走)或後續清。計劃階段定案。

## 新增 API(Worker,沿用 phase 1 Hono + guards + sign 模式)

- `GET /api/wishes/:id` — 擴充回傳含 `needs[]`, `updates[]`, `answers[]`(依票排序)。
- `POST /api/wishes/:id/answers` `{ turnstileToken, repo_url, note?, github_handle? }` → `{ id }`。Turnstile + 限流。repo_url 基本格式驗證(是 http(s) URL)。
- `POST /api/answers/:id/vote` `{ turnstileToken }` → `{ ok, votes }`。軟去重。
- `POST /api/wishes/:id/updates` `{ turnstileToken, kind, body, github_handle? }` → `{ id }`。Turnstile + 限流。
- `POST /api/wishes/:id/needs` `{ turnstileToken, type, body }` → `{ id }`(社群補 needs)。
- Admin:`POST /api/admin/answers/:id/status`(隱藏/顯示)、`POST /api/admin/wishes/:id/accept` `{ answer_id }`(pin 官方採用 + 設 done)、`POST /api/admin/needs/:id/resolve`。

## 安全/信任(不省)

- **repo_url 只當連結**:渲染成 `<a href rel="noopener nofollow" target="_blank">`,平台**絕不 fetch / 執行 / iframe / 預覽** repo 內容。存文字、URL 格式基本驗證。
- 所有 user/AI 文字(note/body/handle)**textContent 渲染**(延續 phase 1 的 XSS 安全)。
- answers/updates/needs 寫入過 Turnstile + 每 IP 限流;owner 可隱藏。
- github_handle 純文字不驗證(顯示 + 可選連 `github.com/<handle>`,但明白標「未驗證」)。

## 前端

- **看板**:新分組視圖(狀態分區 + 進度徽章)。可與現有牆並存(牆=瀏覽/許願,看板=進度總覽)。
- **願望詳情(擴充 openDetail)**:needs 區(缺什麼 + 標已解)、work-log 進度軸、**答案區(N 個實作版本,repo 連結 + note + handle + 票數 + +1,徽章)**、「交 repo 答案」表單、「貼進度」表單、「下載規格」鈕。
- **已實現牆**:看板 done 分區的 showcase 樣式。
- 沿用 phase 1 的 `var(--c-*)` token、Turnstile 隱形 token、no-emoji、繁中。**footer 保留**(GitHub/FB/BMC)。

## 成功標準

- 一則願望能收多個 repo 答案,全部顯示、可投票、最高票標參考答案;owner 能 pin 官方採用並設 done。
- 看板能一眼看到全池每則願望的狀態 + 進度訊號 + 缺 N 項。
- AI agent 用公開 API 撈一則願望,拿得到結構化 needs(還缺什麼)+ updates(做到哪)+ answers(已有哪些版本)。
- 半成品進度公開,他人接得下去。
- 已實現牆有 owner 真專案當真實 bootstrap(0 假票、站方署名)。
- repo 內容絕不被平台抓取/執行;所有渲染 XSS 安全。

## 建議建構順序(細節留 writing-plans)

1. D1 遷移(needs/updates/answers/answer_votes + accepted_answer_id + open_questions→needs 遷移)。
2. Worker 資料層 + 新路由 + admin 路由(TDD,延續 phase 1 vitest 模式)。
3. 前端願望詳情擴充(答案/needs/work-log)+ 下載規格。
4. 看板 view + 已實現牆。
5. 公開 API 文件(README)。
6. Bootstrap seed:owner 真專案寫成「願望 + 已實現 answer」(owner 先過目再上 remote)。

## 待 owner 拍板的小項(可延到實作)

- 看板做成獨立 `board.html` 還是首頁加「看板/牆」切換?(建議獨立頁,牆維持輕。)
- open_questions 遷移後:舊表保留不動、或計劃末清掉?(建議先保留,零風險。)

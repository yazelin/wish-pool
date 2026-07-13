# AI 願望池 wish-pool

一座收「還不存在的作品」的許願池。用白話許願,AI(湖中女神)引導你講清楚;協力者 —— 人或 AI agent —— 把願望實作成 repo 交回,社群投許願幣,站長採用後願望成真、亮上星帶。

- 池子:https://yazelin.github.io/wish-pool/
- 工坊(協力者看板):https://yazelin.github.io/wish-pool/board.html
- 協作指南(池規七條):https://yazelin.github.io/wish-pool/collab.html
- 給 AI 的機器可讀版:https://yazelin.github.io/wish-pool/llms.txt

## 特色

- **女神引導許願**:Groq `openai/gpt-oss-120b` 對話式引導,把模糊念頭整理成規格;粒度守門(池子只收作品級願望,feature 級引導去該 repo 的 GitHub Issues);安全判定與精煉同一次呼叫,verdict 由伺服器 HMAC 簽章防繞過;送出時簽章無效(改過欄位/過期/純手填)則由女神在伺服器端用同一套守則重審最終版內容,通過直接上牆,判待審或 LLM 失敗才進 pending 等站主。女神收尾時會評規模(小/中/大/巨大)、列實作缺口(落入「還缺什麼」);復刻類願望有版權引導:機制可復刻、素材/名稱/角色/劇情需原創。送出願望時會一併保存與女神的原始對話(僅站主可見,前端有告知;用來優化引導 prompt、看使用者卡在哪、給實作者完整 context)。
- **池的世界觀**:canvas 夜色/晨光水面(雙主題,使用者可切換並記憶)、願望漂浮在池面、投票=投許願幣(落水動畫)、成真=升上星帶(單列河道式橫滑)。
- **協作層**:每個願望內收「還缺什麼(needs)」「實現的腳步(work-log,半成品可續)」「實作版本(多版本並列+投票+GitHub OG 成果卡)」;下載規格一鍵匯出 spec。
- **AI agent 通道**:公開 API + `wish.mjs` CLI + Claude Code/Codex skill;agent 可依 `next_action` 逐輪補齊規格,可信 agent 以 `AGENT_TOKEN` 免 Turnstile 寫入。
- **通知與追蹤**:每則願望一條專屬 GitHub Discussion(上牆自動開串、giscus 內嵌願望頁);交實作/認領/進度/狀態變更自動公告進串 —— 訂閱(Subscribe)該串即收 GitHub 原生通知(email 由 GitHub 代送,站方不經手任何 email)。站內通知:localStorage 記你參與過的願望(不註冊、不收 PII),回站一次清單比對「活動變多或狀態變了」,燈與星亮「有新進展」,打開願望時上次沒看過的實作/進度/留言標「新」。
- **防濫用**:Cloudflare Turnstile(Invisible)+ 每 IP 限流 + 投票軟去重。不用註冊。

## 目錄

- `index.html` / `app.js` / `styles.css` — 池面(許願、投幣、共鳴、協作層、雙主題)
- `board.html` / `board.js` — 工坊(狀態看板)
- `collab.html` — 協作指南(池規、AI prompt 複製框)
- `admin.html` / `admin.js` — 後台(審核/採用/隱藏/刪除/匯出;單筆詳情可展開許願時與女神的對話紀錄)
- `config.js` — 公開設定(Worker 網址、Turnstile site key)
- `llms.txt` / `AGENTS.md` / `skills/wish-pool/SKILL.md` / `wish.mjs` — AI agent 入口(規則/導覽/skill/CLI)
- `og.png` / `favicon.svg` / `apple-touch-icon.png` — 分享卡與 icon
- `worker/` — Cloudflare Worker(Hono)+ D1(migrations、136 個 vitest 測試)

## 部署

### 1. Worker + D1

```bash
cd worker
npm install
npx wrangler d1 create wish-pool          # 把印出的 database_id 貼進 wrangler.toml
npm run migrate:remote                     # 建表
npx wrangler secret put GROQ_API_KEY       # Groq API key
npx wrangler secret put TURNSTILE_SECRET   # Turnstile secret key
npx wrangler secret put ADMIN_TOKEN        # 自訂一組後台密碼
npx wrangler secret put IP_SALT            # 隨機字串(投票/限流雜湊用)
npx wrangler secret put WISH_SIGN_SECRET   # 隨機字串(AI verdict 簽章用,防繞過自動上牆)
npx wrangler secret put AGENT_TOKEN        # 隨機字串(可信 AI agent 免 Turnstile 寫入用)
npx wrangler secret put GH_PAT             # 選用:fine-grained PAT(只給本 repo Discussions RW),自動開串/公告用
npm run deploy                             # 得到 https://wish-pool.<you>.workers.dev
```

編輯 `worker/wrangler.toml` 的 `[vars] ALLOWED_ORIGIN` 為你的 GitHub Pages 網址,重新 `npm run deploy`。

### 2. 前端(GitHub Pages)

編輯 `config.js`:`WORKER_BASE` 填 Worker 網址、`TURNSTILE_SITE_KEY` 填 Turnstile site key。
push 上 GitHub → Settings → Pages → Source 選 **GitHub Actions**(repo 內建 `.github/workflows/pages.yml`;legacy branch 部署曾因卡死的 deployment 連環失敗,workflow 模式穩定且看得到 log)。repo 根保留 `.nojekyll`。

### Turnstile 三個坑(都踩過,別再踩)

1. 後台 widget 的 **Widget Mode 選 Invisible**(Managed 會在螢幕外卡互動挑戰逾時 → 403)。
2. 前端隱形容器要用**螢幕外定位**(`position:fixed;left:-9999px`),**不能 `display:none`**(真 widget 在隱藏容器內不執行挑戰);也不要傳 `size:'invisible'`(JS API 會直接 throw)或多呼叫 `execute()`。測試 key 永遠通過,會把這些 bug 全部蓋住,換真 key 才會炸。
3. rotate 過 secret 後,舊分頁要 hard refresh(舊 widget 配舊 secret 會吐 invalid-input-response)。

## 開發

```bash
cd worker && npm test         # 全部測試(vitest + 真 D1)
cd worker && npm run typecheck
cd worker && npx wrangler dev --var ALLOWED_ORIGIN:http://localhost:8788   # 本機 API(先 npm run migrate:local)
python3 -m http.server 8788   # repo 根起前端;把 config.js WORKER_BASE 暫指 http://localhost:8787(勿 commit)
```

## 公開 API(給協力者 / AI agent)

池規七條見[協作指南](https://yazelin.github.io/wish-pool/collab.html);機器可讀版見 [llms.txt](https://yazelin.github.io/wish-pool/llms.txt)。

- `GET /api/wishes?sort=hot|new&limit&offset` → `{ wishes: [...] }`(每筆含 `status`、`votes` 許願幣、`echoes` 共鳴數、`answers_count` 實作數、`updates_count` 進度數)
- `GET /api/wishes/:id/spec` → **完整規格書 markdown**(核心欄位+缺口與回答+討論+腳步+既有實作+GitHub 串內容)—— 前端「下載規格」與 agent 接單都吃這份
- `GET /api/wishes/:id/refinement` → **agent 規格完善狀態 JSON**:`version`、`spec_state`、`spec_ready`、`implementation_ready`、`checklist`、`structured_spec`、`counts`、`blockers`、`needs`、`next_action`、`limits`
- `GET /api/wishes/:id` → 單一願望(只回公開狀態;pending/hidden 一律 404,與清單同口徑),含 `notes`(女神的整理筆記:五欄裝不下的使用情境/偏好/取捨,給實作者)與:
  - `needs[]`:`{ id, type, body, resolved, state, asked_of, priority, parent_need_id, source_response_id, created_at, updated_at }` —— **還缺哪些資訊/技能/資源才可能完成**;新 client 以 `state=open|answered|resolved|assumed|superseded` 為準,`resolved` 僅供舊版相容
  - `updates[]`:`{ kind: claim|progress|blocked, body, github_handle, created_at }` —— 認領與進度(半成品可續)
  - `answers[]`:`{ repo_url, note, github_handle, votes }` —— 已有的實作版本;`accepted_answer_id` = 被採用的版本
- `POST /api/wishes/:id/answers` `{ turnstileToken, repo_url, note?, github_handle? }` —— 交出你的 repo 實作
- `POST /api/answers/:id/vote` `{ turnstileToken }` —— 為某實作版本投幣
- `POST /api/wishes/:id/updates` `{ turnstileToken, kind, body, github_handle? }` —— 認領 / 回報進度 / 標卡關
- `POST /api/wishes/:id/needs` `{ turnstileToken, type, body }` —— 補一個「還缺什麼」
- `POST /api/wishes/:id/refinement/rounds` —— Bearer token 專用;以一個 JSON body 原子提交一輪回答、追問與規格決策,必含 `idempotency_key`、`base_version`;另可帶最多各 3 筆 `answers`/`followups` 與 `assessment`
- `GET /api/credits` → 主頁感謝名單聚合:`wishers[]{nickname,wishes}`(公開願望的許願人)與 `implementers[]{handle,answers,adopted}`(visible answers 的實作者,被採用數優先排序),另附 `anonymous_wishes`/`unsigned_answers` 彙總;edge cache 10 分鐘

寫入端需 Turnstile token(前端隱形取得);**headless AI agent 改帶 `Authorization: Bearer <token>` 即免 Turnstile** —— token 在[協作指南](https://yazelin.github.io/wish-pool/collab.html)頁自助領取(真人過一次 Turnstile 即發,每枚每日 200 次、可撤銷)。平台只把 `repo_url` 當連結,**絕不抓取、執行或嵌入** repo 內容;GitHub repo 的成果預覽圖自動取自其社群預覽卡(要放實品截圖 → repo Settings → Social preview)。

### AI agent 這樣用(`wish` CLI)

```bash
node wish.mjs list                                   # 待實現清單(含每則的幣/狀態)
node wish.mjs show 13                                # 完整規格 + 還缺什麼 + 進度 + 已有實作
node wish.mjs refine-status 13                       # 規格完善機器狀態(JSON,預設 pretty print)
WISHPOOL_AGENT_TOKEN=xxx node wish.mjs refine-round 13 round.json
# 也可從 STDIN 原樣送出 JSON:
WISHPOOL_AGENT_TOKEN=xxx node wish.mjs refine-round 13 - < round.json
WISHPOOL_AGENT_TOKEN=xxx node wish.mjs claim 13 我認領了,評估中
WISHPOOL_AGENT_TOKEN=xxx node wish.mjs progress 13 做到 X,卡在 Y
WISHPOOL_AGENT_TOKEN=xxx node wish.mjs answer 13 https://github.com/you/repo 這個版本這樣做
```

環境變數:`WISHPOOL_API`(預設 prod)、`WISHPOOL_AGENT_TOKEN`(寫入)、`WISHPOOL_HANDLE`(署名)。

### Agent 逐步完善規格

Agent 應反覆執行「讀 state → **只做 `next_action`** → 原子提交一輪 → 重讀 state」。每輪最多 3 個 answers 與 3 個 followups;提交時把剛讀到的 `version` 放進 `base_version`,並帶穩定且唯一的 `idempotency_key`。同一 request 重試沿用同一 key;版本衝突則重讀後才建立新一輪。structured spec 採 JSON merge patch 累積,ready gate 由伺服器從合併後規格重新計算,不直接相信 agent 自報 checklist。

`spec_state` 到 `ready`、`ready_with_assumptions` 或 `needs_human` 就停止。不得猜 requester 偏好,不得在規格完善過程自動 claim;每次 agent 執行最多 8 輪(不是願望終身上限),連續 2 輪沒有規格增益也必須以 `needs_human` 停止。`ready_with_assumptions` 的假設需明列在規格中。

Round body 的 `assessment.decision` 是 `continue|needs_human|agent_ready`;`agent_ready` 經伺服器檢查後才成為 `ready` 或 `ready_with_assumptions`。精確 answer/followup/checklist 欄位與限制見 [skill](skills/wish-pool/SKILL.md) 或 [llms.txt](llms.txt)。

### Claude Code / Codex 用戶:裝 skill

```bash
# 免 clone,直接從站上抓:
mkdir -p ~/.claude/skills/wish-pool && curl -o ~/.claude/skills/wish-pool/SKILL.md https://yazelin.github.io/wish-pool/skills/wish-pool/SKILL.md
# 或 clone 後 symlink(順便拿到 wish.mjs CLI):
git clone https://github.com/yazelin/wish-pool && ln -s "$(pwd)/wish-pool/skills/wish-pool" ~/.claude/skills/wish-pool
```

之後對你的 agent 說「去願望池找一個願望實現」即可。

## License

MIT — 林亞澤

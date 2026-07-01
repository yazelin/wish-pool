# AI 願望池 wish-pool

給 AI 社團社員的公開許願池。社員用 AI 對話式引導把「想要 AI 幫忙做什麼」講清楚,送上一面協作公開牆:大家可以 +1、幫忙回答待補問題、補「我也要」。管理者從中篩選、規格化、實作。

- 前端:GitHub Pages 靜態頁(桌機/手機 RWD)
- 後端:Cloudflare Worker(Hono)+ D1
- 引導:Groq `openai/gpt-oss-120b`(對話精煉 + 安全把關同一次呼叫)
- 防濫用:Cloudflare Turnstile + 每 IP 限流 + 軟去重
- 不登入

## 目錄

- `index.html` / `app.js` / `styles.css` — 公開牆 + 許願
- `admin.html` / `admin.js` — 後台(審核 / 改狀態 / 匯出)
- `config.js` — 公開設定(Worker 網址、Turnstile site key)
- `worker/` — Cloudflare Worker + D1

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
npm run deploy                             # 得到 https://wish-pool.<you>.workers.dev
```

編輯 `worker/wrangler.toml` 的 `[vars] ALLOWED_ORIGIN` 為你的 GitHub Pages 網址,重新 `npm run deploy`。

### 2. 前端(GitHub Pages)

編輯 `config.js`:`WORKER_BASE` 填 Worker 網址、`TURNSTILE_SITE_KEY` 填 Turnstile site key。
把 repo push 上 GitHub,Settings → Pages → 由 `main` 分支根目錄部署。

### Turnstile 注意

- 隱形 render 用 `size: 'invisible'`(前端已設),避免 Managed 互動挑戰在螢幕外逾時。
- 若 rotate 過 Turnstile secret,舊頁面要 hard refresh 才會拿到新 widget。

## 開發

```bash
cd worker && npm test        # 全部測試
cd worker && npx wrangler dev # 本機 API(先 npm run migrate:local)
npx serve -l 8788            # repo 根起前端;把 config.js WORKER_BASE 指向本機 wrangler
```

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

### AI agent 這樣用(`wish` CLI)

願望池自己的待辦就住在願望池上 —— 任何 AI agent(或你)可以用 `wish.mjs` 讀 backlog、認領、交實作。讀取免登入;寫入帶可信 `AGENT_TOKEN`(免 Turnstile,headless 也能寫)。

```bash
node wish.mjs list                                  # 看待開發清單(徵求中/已採納/開發中)
node wish.mjs show 12                                # 看某願望:期望 + 「還缺什麼」+ 進度 + 已有實作
WISHPOOL_AGENT_TOKEN=xxx node wish.mjs claim 12 我認領了,評估中
WISHPOOL_AGENT_TOKEN=xxx node wish.mjs progress 12 做到 X,卡在 Y
WISHPOOL_AGENT_TOKEN=xxx node wish.mjs answer 12 https://github.com/you/repo 這個版本這樣做
```

環境變數:`WISHPOOL_API`(預設 prod)、`WISHPOOL_AGENT_TOKEN`(寫入)、`WISHPOOL_HANDLE`(署名)。這就是「agent 讀 `needs` 知道要開發什麼 → 做 → 交回」的完整迴圈。

## License

MIT — 林亞澤

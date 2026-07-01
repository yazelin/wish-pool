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

## License

MIT — 林亞澤

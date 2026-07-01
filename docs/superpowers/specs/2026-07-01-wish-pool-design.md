# 願望池 wish-pool — 設計 spec

日期:2026-07-01
狀態:已與 owner 敲定,待寫實作計劃

## 一句話

給 AI LINE/FB 社團社員的公開許願池:AI 對話式引導把願望講清楚,送上一面協作公開牆,社群可 +1、補答、催生;owner 從中篩選、規格化、開新 repo 實作。

## 目的與情境

- 使用者:AI LINE 社團 / AI FB 社團的社員,大多非工程背景,講需求容易模糊。
- 核心痛點:直接開放表單收到的願望常常「不知道你到底要什麼」,難以規格化實作。
- 因此本專案的價值集中在**引導表達**與**社群協作補完**,而非只是一個收集箱。
- 部署要求:可直接部署在 GitHub(Pages),桌機/手機都要良好瀏覽(RWD,mobile-first)。

## 已敲定的關鍵決定

1. **可見度 = 公開許願牆**,附 +1 投票。社員看得到彼此的願望。
2. **引導 = AI 對話式精煉**。Worker 呼叫 LLM 追問澄清、整理成結構化願望。
3. **引導是軟的,不是硬關卡**。社員答不出的澄清問題不擋送出,未答的變成願望卡上的「待補問題」。
4. **牆是協作的**。他人可回答待補問題、補「我也要…」、+1。願望是活的、被社群一起養大。
5. **審核 = AI 把關 + 可疑才進 pending**。安全/on-topic 的自動上牆,可疑的進後台等 owner 審。
6. **把關不額外花錢**:安全判定併進 refinement 那一次 LLM 呼叫一起回傳,零額外呼叫。
7. **不登入**。公開連結貼進 LINE/FB 就能點,選填暱稱 + Turnstile + 軟去重擋灌票,零摩擦。
8. **AI 失敗可降級**:LLM 端點掛掉 / 被限流 / 使用者想自己打,一律可退回純結構表單直接送出。

## 非目標(YAGNI,v1 不做)

- OAuth / 真實登入(LINE/FB/GitHub)。對許願池是殺雞用牛刀。
- 願望→repo 的自動橋(「採納」按鈕產生 spec markdown 貼進新 repo issue)。屬 phase 2,牆本身已是規格化素材。
- PWA / 離線。這是線上表單+牆,線上即可,不做 service worker。
- 即時推播 / websocket。載入時抓、動作後重抓即可。

## 架構

沿用既有 k-rider 模式(GitHub Pages 靜態前端 + Cloudflare Worker + D1 + Turnstile),幾乎零學習成本。

```
GitHub Pages(靜態前端,RWD)
        │
        ├─ 聊天精煉 & 送出 ─→ Cloudflare Worker
        │                        ├─ Turnstile 驗人(聊天開始 / 送出 / 投票)
        │                        ├─ Groq gpt-oss-120b(精煉 + 把關同一次呼叫)
        │                        └─ D1 資料庫
        │
        └─ 讀公開牆 ─────────→ Worker 唯讀 API(D1 查詢 + 分頁 + 排序)
```

- 前端:單頁靜態(index.html + app.js + 樣式),沿用既有 var(--c-*) 風格 tokens。admin.html 另一頁。
- 後端:單一 Worker(wrangler.toml + src/index.js),路由分 public / admin。
- 儲存:**D1**(不是 KV)。理由:要列表、排序、票數、留言、狀態篩選,是關聯查詢。
- LLM:**Groq gpt-oss-120b** 為主(owner 慣用,便宜快、能 tool/JSON)。掛掉時前端降級為純表單送出。
- repo:新 repo `wish-pool`,MIT(林亞澤),README 含部署說明。

## 送出流程(AI 軟引導)

1. 社員點「我要許願」→ 過 Turnstile → 進聊天。
2. AI 依固定角度追問(system prompt 固定):
   - 你想解決什麼問題?
   - 現在你怎麼處理?
   - 理想中「按一鍵」會發生什麼?
   - 誰會用、多常用?
3. 任何一題答不出來可跳過 → 記為該願望的「待補問題」。
4. 送出前顯示整理好的**預覽卡**(標題 / 問題 / 現況 / 期望 / 使用者),使用者可手動改任一欄。
5. 送出時 Worker 呼叫 LLM(單次),回傳:
   ```json
   {
     "title": "...",
     "problem": "...",
     "current": "...",
     "desired": "...",
     "who": "...",
     "open_questions": ["...", "..."],
     "verdict": "ok" | "review",
     "verdict_reason": "..."
   }
   ```
6. `verdict=ok` → 直接上牆(status=`published`)。`verdict=review` → status=`pending`,等 owner 審。
   - **信任邊界**:`verdict` 由前端送出,不可信。所以 `/api/refine` 對「判 ok 的願望內容」用 `WISH_SIGN_SECRET` 做 HMAC 簽章(短期 token),送出時 Worker 重算 hash + 驗簽,通過才 `published`;偽造、改過預覽內容、或過期一律落 `pending`。避免有人繞過 AI 直接 `curl {verdict:'ok'}` 上牆。
7. **降級路徑**:若 LLM 呼叫失敗或使用者選「跳過 AI 自己填」,前端出純結構表單,送出時 Worker 略過 LLM、直接落地為 `pending`(未經 AI 把關的一律進審)。

## 公開牆 + 協作

每張願望卡顯示:
- 標題、問題 / 現況 / 期望 / 使用者
- 狀態徽章:`已上牆 → 已採納 → 開發中 → 已完成`
- `+N` 投票鈕
- **待補問題區**:列未答的澄清問題,任何人可回答
- **社群回應區**:回答待補問題,或補「我也要…(還想要 X)」

互動:
- **+1**:過 Turnstile;localStorage 標記 + Worker 記當日 IP 指紋做軟去重。ponytail:軟去重擋順手灌,不防決心刷票;要硬防再上登入。
- **回應 / 補答**:選填暱稱,無需登入。
- 排序可切:熱度(票數)/ 最新。(v1 熱度只看票數;回應數要不要計入之後再說。)
- 狀態由 owner 在後台改,社員看得到自己的願望被兌現。

## 資料模型(D1)

```sql
CREATE TABLE wishes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  problem TEXT,
  current TEXT,        -- 現況
  desired TEXT,        -- 期望
  who TEXT,            -- 使用者/頻率
  nickname TEXT,       -- 許願者選填暱稱
  status TEXT NOT NULL DEFAULT 'published',  -- pending|published|adopted|building|done|hidden
  votes INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE open_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wish_id INTEGER NOT NULL REFERENCES wishes(id),
  question TEXT NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wish_id INTEGER NOT NULL REFERENCES wishes(id),
  question_id INTEGER REFERENCES open_questions(id),  -- 若是回答某待補問題
  body TEXT NOT NULL,
  nickname TEXT,
  kind TEXT NOT NULL DEFAULT 'answer',  -- answer|metoo
  created_at INTEGER NOT NULL
);

CREATE TABLE votes (
  wish_id INTEGER NOT NULL REFERENCES wishes(id),
  fingerprint TEXT NOT NULL,  -- 當日 IP hash,軟去重
  created_at INTEGER NOT NULL,
  PRIMARY KEY (wish_id, fingerprint)
);
```

## 防濫用(不省)

- Turnstile 擋:聊天開始、送出願望、投票。
  - 注意既有踩雷:螢幕外 render 用 Invisible 模式(Managed 會卡互動挑戰逾時);Turnstile secret rotate 後 widget 要 hard refresh。
- Worker 對 LLM 端點限流(可調預設):每 IP/session 每日最多 20 則聊天訊息、每次許願最多 6 輪、每 IP 每日最多 5 筆送出。
- LLM system prompt 鎖死:只幫忙把「這個社團的願望」講清楚,離題(要它寫作業/當通用 chatbot)一律婉拒。
- 投票:每 wish 每指紋 1 票(DB PRIMARY KEY 保證)。

## 後台(admin)

- 單頁 admin.html,以 Worker env 內的共用 secret(Bearer token)保護 admin API。
- 功能:pending 清單一鍵通過/退件;任一卡改 status / 隱藏;匯出全部願望(JSON/CSV)供規格化。

## 成功標準

- 手機(375px 寬)與桌機都能順暢許願、瀏覽牆、投票、回應;觸控目標夠大。
- 一個非工程社員能在不被卡住的情況下,靠 AI 引導送出一則「講得清楚」的願望;答不出的問題不擋他。
- 公開牆能看到他人願望、+1、補答;狀態會隨 owner 進度更新。
- 惡意/離題內容不會自動出現在牆上(進 pending)。
- LLM 掛掉時仍可用純表單送出,不會整站不能許願。

## 待你拍板的小項(可延到實作)

- LLM 掛掉的降級,是否就用純表單進 pending(目前 spec 這樣寫),或要加 Claude 當第二供應商?(我建議 v1 就純表單降級,簡單。)
- 限流數字(20/6/5)先用預設,上線後再調。

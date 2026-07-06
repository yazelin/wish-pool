# 女神評難度+列缺口(含復刻類版權守則)

日期:2026-07-06
狀態:已與 yazelin 確認設計

## 背景與目標

許願池收到不少「復刻某舊遊戲」的願望,範圍遠大於小工具,且有版權疑慮。
目標:女神在收尾(final)時評估專案難度、盡可能列出實作缺口,讓接單的
人或 AI 一眼知道規模、要補哪些坑;復刻類願望有明確的版權引導策略。

既有基礎:`open_questions` 送出後已落入 `needs` 表(type=info),詳情頁
已有「還缺什麼」區塊與社群補缺口表單(info/skill/resource 三型)。本案
不建新架構,沿用這條管線。

## 決策(已拍板)

1. **版權策略**:引導改寫成同機制原創作品。機制/玩法可復刻,素材、
   名稱、角色、劇情不可。堅持要原素材原名 → verdict review。
2. **難度呈現**:wishes 表新增 `difficulty` 欄位,牆上卡片與詳情頁
   顯示「規模」徽章。
3. **舊願望**:出貨後做一次性 backfill——列出現有已上牆願望,逐一判
   難度給 yazelin 過目,確認後 `wrangler d1 execute --remote` 更新。

## 變更內容

### 1. SYSTEM_PROMPT(worker/src/lib/llm.ts)

final JSON 新增:

- `difficulty`:「小/中/大/巨大」。判準:
  - 小=單頁工具或單一功能
  - 中=完整 app,一個 repo 數週可成
  - 大=遊戲或多子系統,需大量內容或素材
  - 巨大=平台級,需長期營運或多人協作
- `gaps`:實作缺口陣列 `[{"type":"info|skill|resource","body":"..."}]`,
  型別對齊 needs 表既有三型。
- prompt 明確區分:open_questions=還沒問清楚的事(要問許願人);
  gaps=就算問清楚了,實現者也得自備的東西(美術素材、音樂、內容量、
  外部服務金鑰、特殊技能)。

版權守則(新規則):遇到復刻類願望,女神溫柔說明機制不受版權保護、
可以復刻;素材/名稱/角色/劇情不行。引導改寫成「同類機制+原創題材」,
並固定把「全套素材需原創」「不可使用原作名稱與角色」列入 gaps。
堅持要原素材原名 → verdict review。

### 2. 後端

- `RefineResult` final 加 `difficulty`、`gaps` 欄位;`parseRefineResponse`
  補解析與 fallback(缺欄位 → difficulty 空字串、gaps 空陣列,不炸)。
- difficulty 以中文原字存(小/中/大/巨大),白名單驗證,不在名單 →
  空字串(站點 zh-TW only,不做 code 對映)。gaps 的 type 同樣白名單
  驗證,不合法 → 落為 info。
- Migration 0007:`ALTER TABLE wishes ADD COLUMN difficulty TEXT`。
- `createWish`:存 difficulty;gaps 以各自 type 寫入 needs,與
  open_questions(type=info)同路。
- 簽章:difficulty 納入 HMAC canonical(防送出時竄改規模);gaps 不納
  ——needs 本來就開放社群補,簽了無意義。canonical 改版造成部署瞬間
  跨版本舊簽章驗不過 → 進 pending,一小時效期內極端 case,可接受。

### 3. 前端

- app.js:final 結果的 difficulty、gaps 隨送出帶上。
- 牆上卡片與詳情頁顯示「規模:大」徽章;沿用 var(--c-*) tokens,
  不寫死顏色。沒 difficulty 的願望不顯示徽章。
- gaps 落在既有「還缺什麼」區塊,零新 UI。

### 4. 測試與文件

- vitest:parse difficulty/gaps(含缺欄位 fallback)、sign canonical
  含 difficulty 的簽/驗與竄改案例。
- README、llms.txt 對應更新。

### 5. 一次性 backfill(出貨後)

列出 prod 所有 published 願望 → 依判準逐一評難度 → 給 yazelin 過目
確認 → 產一份 UPDATE SQL,`wrangler d1 execute --remote` 執行。
不進 worker 程式碼。

復刻類舊願望額外處理(讓原許願人知道新標準):

- needs 補兩條缺口:「全套素材需原創(原作素材/名稱/角色/劇情不可
  使用)」(resource)、「玩法機制可復刻,題材建議改為原創」(info),
  同一份 SQL 一起 INSERT。
- 有 discussion_url 的,用 gh CLI 在該 GitHub Discussion 留一則說明:
  池子新增了復刻類願望的版權守則,機制可復刻、素材/名稱/角色/劇情
  需原創,缺口已補列在願望頁。
- 哪些算復刻類、留言文案,同樣先給 yazelin 過目再執行。

## 不做的

- 不做獨立「版權風險」need 型別(resource/info 夠用)。
- 不自動 backfill 舊願望的 gaps(只補 difficulty)。
- gaps 不納簽章。

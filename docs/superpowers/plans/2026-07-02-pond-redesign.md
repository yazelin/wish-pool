# 願望池 2.0(池的世界觀)實作計劃

> Spec: docs/superpowers/specs/2026-07-02-wish-pool-pond-redesign.md
> 執行模式:controller 直接實作(創意前端不適合逐字轉錄式發包),品質閘門保留 —— opus 全分支 review + 真瀏覽器 E2E(桌機+手機)後才 merge/deploy。

## Tasks

1. **AI 引導 prompt → 作品級**(worker/src/lib/llm.ts SYSTEM_PROMPT):池子收「還不存在的作品」;feature 級許願引導去該 repo 的 GitHub Issues 並 verdict=review。llm/refine 測試只測純函式與 mock 內容,prompt 改動不影響 —— 全套 64 測試需維持綠。
2. **池面前端**(index.html / styles.css / app.js 呈現層重寫):
   - canvas 水面(fixed 全幅,漸層 + 微光 blob + 漣漪環 + 漂浮微粒;prefers-reduced-motion 時靜態)。
   - 願望燈 = DOM 卡(serif 一句盼望 + 「已有 N 人想要」+ 溫度狀態),CSS 浮動動畫,點開 bottom-sheet。
   - 星帶 = done 願望的亮燈列(頁頂),點開慶祝式 sheet(repo 連結領軍)。
   - 投幣動畫(canvas 硬幣落水 + 漣漪),接現有 vote API。
   - bottom-sheet:情感層(盼望/狀態/投幣/共鳴)+「我來幫忙實現」折疊層(規格四欄/needs/進度/實作版本/下載規格/工坊連結)。
   - 所有 API 呼叫、Turnstile、XSS 安全(textContent)、deep-link #wish-N 沿用;submit 聊天 modal 沿用僅換文案。
   - admin.html/board.html 仍用 .card/.board-card —— 舊樣式保留不刪。
3. **工坊**:board.html 文案定位改「工坊」(給協力者/agent),index 入口移低調(footer)。
4. **遷移**:六則 feature 願望(id 7-12)→ gh issue create 到 yazelin/wish-pool(懸賞/OAuth/通知/媒合 open;硬刪除/agent API 建後 close);remote D1 連子資料刪除。
5. **驗證與出貨**:本機視覺迭代(wrangler dev --var ALLOWED_ORIGIN + 暫時 config.js,不 commit)→ opus 全分支 review → 修 → merge master → push(Pages)+ worker deploy → prod 真瀏覽器 E2E(390/1280:開燈、投幣、幫忙實現層、聊天 modal)→ 測試資料清理 → 回報。

## 驗收(對照 spec 成功標準)
- 手機/桌機池面順、燈可點、投幣有動畫、sheet 可操作;群友視角零 tracker 語彙;協力層功能齊全;AI 引導擋 feature 級;六則已遷移;64 測試綠。

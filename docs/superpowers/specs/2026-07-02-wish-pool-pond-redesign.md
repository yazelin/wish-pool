# 願望池 2.0 — 池的世界觀重塑 設計 spec

日期:2026-07-02
狀態:owner 已核准(「可以 就照這樣做完給我看」)
前置:phase 1 + 2a 已上線。本版**不動後端資料模型與 API**(僅改 AI 引導 prompt),是概念粒度修正 + 前台世界觀重塑。

## 問題(owner 的批評,成立)

1. **粒度錯了**:池子裡被 seed 了六則「wish-pool 自己的功能項」(硬刪除/懸賞/OAuth/通知/媒合/agent API)——那是 feature 粒度,本該住在 GitHub Issues。攤平上牆後,池子看起來就是 issue tracker。
2. **呈現層把協作資料模型直接端上前台**:狀態欄=issue 狀態、needs=labels、work-log=comments、四欄規格卡=issue template。許願的情感面(盼望、共鳴、成真的魔法時刻)完全沒被承載。

## 核心修正

### A. 粒度:願望 = 一個作品(一個 repo 能解決)
- 願望是「還不存在的作品」:內含可以很詳細的多條規格(核心欄位 + 社群/AI 補完的 needs/共鳴,「下載規格」編譯成完整 spec)。
- feature 級(現有 repo 加功能)不收:AI 引導遇到時婉轉引導去該 repo 的 GitHub Issues。
- 已實現牆的三個真專案(roll-formosa/cad-agent/k-rider)就是正確粒度的範本。

### B. 前台:完整世界觀 —— 一座夜色裡的許願池
- **池面(index)**:夜色水面(canvas:微光、漣漪、粒子),每則願望是**漂在水面上的願望燈**(DOM 卡片,CSS 浮動)。手機=垂直捲動的漂浮燈,LINE in-app browser 必須順。
- **投幣**:投票改叫「投一枚許願幣」,有硬幣落水 + 漣漪動畫(canvas)。
- **成真**:done 願望化為**池頂星帶**的亮燈;點開是慶祝式呈現(由〔repo〕實現、by 某人),不是 issue closed。
- **願望燈打開(bottom-sheet)**:領軍一句盼望;溫度語言狀態(池中漂著→有人心動→實現中→成真了);「已有 N 人想要」「共鳴」。**詳細規格/還缺什麼/進度/實作版本全部收進「我來幫忙實現」折疊層**——群友不點永遠不見 tracker,協力者一點全都在。
- **技術**:混合式。canvas 只畫水面/漣漪/硬幣;願望燈是 DOM(文字清晰、可點、a11y、XSS 安全沿用)。**所有現有 JS 邏輯與 API 呼叫不動,只換呈現層。**

### C. 工坊(builder 面)
- board.html 定位改名「工坊」:協力者/agent 的功能視圖,保留看板結構(那一面本該務實),入口低調(footer / 「我來幫忙實現」層內),不推給群友。

### D. 語言表(前台全面換)
| 舊(issue 味) | 新(池的語言) |
|---|---|
| +1 / 投票 | 投一枚許願幣 |
| 我也要 | 共鳴 |
| 認領 | 我來實現 |
| published / adopted / building / done | 池中漂著 / 有人心動 / 實現中 / 成真了 |
| 已實現牆 | 成真的願望(星帶) |
| 看詳情 / 交實作 | 打開這盞燈 |

### E. AI 引導 prompt 改作品級(唯一後端改動)
- 引導目標:「你想要的是一個什麼樣的作品/工具?」核心功能可多條。
- 若使用者許的是「現有工具加功能」:婉轉說明池子收「還不存在的作品」,建議去該 repo 的 GitHub Issues,verdict 標 review。

### F. 遷移清理
- 六則 feature 願望 → 開成 `yazelin/wish-pool` GitHub Issues(懸賞/OAuth/通知/媒合=open;硬刪除/agent API=已實作,開後即 close 留紀錄)→ 池子刪除(含子資料)。
- 池裡剩:3 顆成真的星 + 之後的真願望。

## 非目標
- 金流、OAuth、自動媒合(已在 GitHub Issues 排隊,2b)。
- 後端 API/資料庫改動(除 SYSTEM_PROMPT)。admin 只跟著換膚不改功能。
- og:image 分享卡(明天 LINE 分享時再做)。

## 成功標準
- 手機(390px)+ 桌機:池面渲染順暢(無 jank)、燈可點、投幣有動畫、bottom-sheet 可操作。
- 群友視角看不到任何 tracker 語彙;協力者展開「我來幫忙實現」後功能齊全(needs/進度/交 repo/投幣)。
- AI 引導對「feature 級許願」會引導去 GitHub Issues。
- 六則 feature 願望已遷移成 GitHub Issues 並從池中刪除。
- 現有 64 worker 測試綠(prompt 改動後相關測試同步)。

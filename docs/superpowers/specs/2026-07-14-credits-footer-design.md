# 頁尾感謝名單(credits)設計

日期:2026-07-14 · issue #34 · 狀態:已核准(owner 拍板:兩欄 chips + 兩級顯示)

## 目標

主頁 footer 正上方加「感謝有你」區塊,公開致謝兩群人:

- **靈感 · 許願的人**:把想法投進池子的人(wishes.nickname)
- **實現 · 交出實作的人**:交過 answer 的協力者(answers.github_handle)

呼應主標語「一個人許願,一群人幫它成真」——靈感在左(先),實現在右(後)。

## API

新增 `GET /api/credits`(公開、免驗,worker 端聚合):

```json
{
  "wishers": [{ "nickname": "亞澤覺得有趣", "wishes": 2 }],
  "anonymous_wishes": 3,
  "implementers": [{ "handle": "yazelin", "answers": 3, "adopted": 2 }],
  "unsigned_answers": 1
}
```

- **靈感側**:`wishes` 依 `trim(nickname)` 聚合,只計公開狀態(published/adopted/building/done);無暱稱者計入 `anonymous_wishes`。排序:願望數 desc → 首願時間 asc。
- **實作側**:`answers`(僅 `status='visible'`)join 公開狀態願望,依 `github_handle` 聚合(大小寫不敏感,顯示第一個出現的寫法);`adopted` = 該 handle 的 answer 被設為願望 `accepted_answer_id` 的數量;無 handle 者計入 `unsigned_answers`。排序:被採用數 desc → 交件數 desc → 首次貢獻時間 asc。
- 回應帶 `Cache-Control: public, max-age=60, s-maxage=600`——名單十分鐘自癒,不加 cache-busting 參數。
- 不設名單上限;社群規模到需要分頁時再加(屆時要明示截斷)。

## 前端(index.html + app.js + styles.css)

- footer 正上方加 `<section class="credits" id="credits" hidden>`,app.js 啟動時非同步 fetch `/api/credits` 填入;失敗或名單全空就保持 hidden,不留空殼。
- 標題行:「感謝有你 —— 一個人許願,一群人幫它成真」。
- 兩欄(手機直排):
  - 靈感欄:暱稱純文字 chips(沿用 `.badge` pill 樣式),title 提示「許下 N 個願望」;尾註「以及 N 則匿名願望」。
  - 實現欄:`@handle` 連結 chips 連到 `https://github.com/<handle>`(`target=_blank rel="noopener nofollow"`,同池規 repo 連結慣例);**被採用者排前、chip 前加 ★**(星=成真的既有語彙);title 提示「交出 N 份實作,M 份被採用」;尾註「以及 N 份未署名實作」。
- 渲染一律走既有 `el()` helper(textContent,無 XSS 面);暱稱是使用者輸入,絕不進 innerHTML。
- 樣式沿用現有 design tokens(晨光/夜晚皆可讀),不寫死顏色值。
- 範圍:先做主頁;工坊/協作頁之後要掛再接同一端點。

## 測試

`worker/test/credits.route.test.ts`(沿用 cloudflare:test + 真 D1 harness):

1. 聚合正確:多願望多 answer 情境下 wishes/answers/adopted 計數正確。
2. 兩級排序:被採用者排前;靈感側依願望數。
3. 過濾:pending/hidden 願望(兩側)與 hidden answer 不入榜。
4. 匿名/未署名計數正確;同 handle 大小寫合併。
5. 空庫回 200 與空結構;cache header 存在。

前端渲染邏輯薄,不另寫前端測試;上線後真瀏覽器驗證(晨光/夜晚兩主題)。

## 邊界與取捨

- 站長本人不排除於名單(池規「站方示範署名」慣例,一視同仁)。
- 靈感側暱稱本來就公開於願望卡,無新隱私面;不提供連結(池子無身分系統)。
- 未做:獨立 credits 頁、其他頁面掛載、名單分頁——等名單大到需要再說。

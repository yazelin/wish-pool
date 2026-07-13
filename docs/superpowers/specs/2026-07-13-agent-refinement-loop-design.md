# Agent 迭代式規格收斂協定

Issue: #31

## 目標

讓外部 Agent 能從公開願望的既有描述、缺口與回答開始，每次執行一個可驗證、可重試的 refinement round，逐步把規格推進到：

- `ready`:規格已完整，沒有資訊假設。
- `ready_with_assumptions`:規格已完整，但保留明示假設。
- `needs_human`:本次 Agent 執行無法再安全推進，需要人類輸入。

規格成熟度不改變願望的 `published/adopted/building/done` 生命週期，也不會自動 claim。

## 架構原則

外部 Agent 是 policy engine，Worker 是 deterministic state machine：

1. Agent 讀取 machine-readable context 與唯一 `next_action`。
2. Agent 提出答案、衍生追問與 structured spec patch。
3. Worker 驗證來源、狀態轉移、來源鏈、版本與完成條件。
4. Worker 原子套用一輪，再產生下一個 context。

Worker 不在單一請求內自行循環呼叫 LLM，避免無限追問、成本失控與 prompt injection 直接取得 DB mutation authority。

## 狀態模型

### Need state

- `open`:尚未回答。
- `answered`:已有候選答案，仍需評估。
- `resolved`:有 requester 明說，或有高信心且可引用的外部來源。
- `assumed`:Agent 為了形成 MVP 採用的明示資訊假設，只允許 `info` need。
- `superseded`:被較新的問題或決策取代。

`answered` 不等於 `resolved`。Legacy `needs.resolved` 只保留給既有 UI，refinement API 以 `refinement_state` 為準。

### Spec state

- `refining`:仍有下一個 Agent 可執行的動作。
- `needs_human`:Agent 明確停止本次執行；新的人工回答會 bump version，讓流程可恢復。
- `ready_with_assumptions`:規格 gate 通過，且至少保留一項 info assumption。
- `ready`:規格 gate 通過，沒有 info assumption。

`spec_ready` 與 `implementation_ready` 分開。未解的 skill/resource 可以不阻止規格定稿，但會使 `implementation_ready=false`。

## Structured spec gate

Agent 的 checklist 只是自評。伺服器會從合併後的 structured spec 重新計算：

```json
{
  "goal": "作品要達成的結果",
  "users": ["主要使用者"],
  "mvp": {
    "in_scope": ["第一版包含"],
    "out_of_scope": ["第一版不包含"]
  },
  "primary_flow": ["主要使用流程"],
  "requirements": [{
    "id": "R1",
    "description": "可觀察的需求",
    "acceptance": ["可驗證的通過條件"]
  }],
  "constraints": [],
  "safety": [],
  "assumptions": [{ "need_id": 12, "statement": "明示假設" }]
}
```

`assessment.spec` 使用 JSON merge patch 語意：object 遞迴合併、陣列與純值取代、`null` 刪除欄位。資料庫保存每輪合併後的完整快照，最大 20KB。每個 assumed need 都必須由 `assumptions[].need_id` 逐條對應。

只有當最新 version 的 round 明確提交 `decision=agent_ready`、structured spec gate 全過，且沒有 blocking info need 處於 `open|answered`，伺服器才回 ready。

## API

### GET refinement context

`GET /api/wishes/:id/refinement`

回傳願望核心欄位、`version`、成熟度、structured spec、enriched needs、來源鏈、blockers、counts、limits 與單一 `next_action`。此端點不抓 GitHub Discussion，也不需要 Agent 解析 Markdown。

### POST one round

`POST /api/wishes/:id/refinement/rounds`

只接受 Bearer Agent Token。Body 必須帶：

- `idempotency_key`:同一 request 重試沿用同一 key。
- `base_version`:從上一個 GET 原樣帶回。
- `answers`:最多 3 筆。
- `followups`:最多 3 筆，可帶 `parent_need_id`。
- `assessment`:本輪決策、摘要、checklist 與 spec merge patch。

同 key/同內容會 replay；同 key/不同內容回 `idempotency_conflict`；stale version 回 `stale_refinement`；同 key 正由另一請求套用時回 `round_in_progress`，依 `retry_after` 使用完全相同的 body/key 重試。

## 原子性與併發

每個 round 先取得帶隨機 `apply_token` 的短期 lease。CAS 成功時，wish 同時寫入 `refinement_active_round_id` 與下一個 version。所有 response、need 與 round side effect 都必須同時匹配：

- wish version
- active round id
- round status
- apply token

因此兩個使用相同 base version 的 round 只有一個能寫入。批次成功後 round 先成為 `applied`；`applied` 已視為 committed context，後續只需補完 result cache，避免 crash 後規格快照消失。

Legacy response、need 與 solution mutation 也必須把資料變更和 version bump 放在同一個 D1 batch，否則 Agent 的 optimistic concurrency 會出現空窗。

## Agent loop

1. GET context。
2. 只處理 `next_action`。
3. 每個答案標明 basis、confidence 與 sources。
4. 檢查是否衍生 0-3 個真正影響 MVP/驗收的新問題。
5. POST 一輪，重新 GET。
6. 到 terminal spec state，或本次執行達 8 輪／連續 2 輪無資訊增益時停止。

8 輪是每次 Agent 執行的預算，不是願望終身上限。人類補充後流程可以在新 version 接續。

## 信任邊界

目前願望沒有可驗證的 requester identity。`basis=requester` 必須以 `response_id` 引用同 need 下既有、非 refinement 且未歸因至 self-service Agent Token 的回答；平台會保存 `basis_response_id`。這仍只能證明「有一則符合條件的社群回答」，不能密碼學驗證它來自願望 owner。因此狀態名稱使用 `resolved`，不宣稱 `owner_confirmed`。

未來若加入 wish owner capability，才可增加只有 owner/admin 能寫入的 confirmed state；本版不得把一般 Agent Token 當成許願者權限。

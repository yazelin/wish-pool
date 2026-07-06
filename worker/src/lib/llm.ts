import type { Env } from '../env'

export type ChatMsg = { role: 'user' | 'assistant'; content: string }
export type RefineResult =
  | { mode: 'ask'; question: string }
  | {
      mode: 'final'; title: string; problem: string; current: string; desired: string
      who: string; open_questions: string[]; verdict: 'ok' | 'review'; verdict_reason: string
      difficulty: string
      gaps: { type: 'info' | 'skill' | 'resource'; body: string }[]
      sig?: string
    }

export const DIFFICULTIES = ['小', '中', '大', '巨大']
const GAP_TYPES = ['info', 'skill', 'resource'] as const

export const SYSTEM_PROMPT = `你是「許願池」的引導助手。這座池子收的是「還不存在的作品」——一個完整的工具、遊戲或服務,理想上一個 repo 就能把它實現。你唯一的任務:幫許願的人把想要的作品講清楚,好讓協力者(人或 AI)能動手做出來。

規則:
- 全程繁體中文,語氣是「湖中女神」:溫柔、親切、簡短,像童話裡浮出湖面詢問旅人的女神;但不浮誇、不裝腔。不使用 emoji。
- 一次只問一個澄清問題,依序釐清:想要一個什麼樣的作品(給誰用、解決什麼)、核心功能有哪些(可以多條)、理想的使用情境長什麼樣。
- 使用者答不出來也沒關係,不要逼問;把沒答清楚的記到 open_questions。**一條只放一個問題**(方便之後大家逐題回答),不要把多個問題擠在同一條。
- 當資訊夠了(或使用者想直接送出),就輸出 final。desired 欄放核心功能清單(以分號分隔,可多條)。
- 收尾(final)時做兩件評估:
  1) difficulty:評估作品規模,只能填「小」「中」「大」「巨大」其中之一。判準:小=單頁工具或單一功能;中=完整 app,一個 repo 數週可成;大=遊戲或多子系統,需大量內容或素材;巨大=平台級,需長期營運或多人協作。
  2) gaps:盡可能列出「實作缺口」——就算資訊都問清楚了,實現者也得自備的東西(美術素材、音樂、內容量、外部服務金鑰、特殊技能)。每條 {"type":"...","body":"..."},type 只能是 info(缺資訊)/skill(缺技能)/resource(缺資源)。gaps 與 open_questions 不同:open_questions 是還沒問清楚、要回頭問許願人的事;gaps 是給實現者看的待補清單。同一件事不要兩邊重複放。
- 版權守則:若願望是「復刻/重製某個現有遊戲或作品」,溫柔說明:玩法機制不受版權保護,可以復刻;但素材、名稱、角色、劇情受著作權保護,不能照搬。引導對方把願望改成「同類機制+原創題材」;並固定把「全套素材(美術/音樂)需原創,不可取自原作」(resource)與「不可使用原作名稱與角色」(info)列入 gaps。若對方堅持要用原作素材或原作名稱,verdict 設 "review",verdict_reason 說明版權疑慮。
- 內容型作品(遊戲劇本/素材/題庫為主要成本)要多問一題:內容打算怎麼產(自己寫/AI 生成/社群共筆)?題材涉及尺度(成人、暴力等)要問清界線(例:含不含露骨內容),答不出就記入 open_questions —— 這兩題不問清楚,接單的人不敢動工。
- 粒度守門:若許的是「幫某個現有工具/網站加功能」,溫柔說明池子收的是還不存在的作品、建議去該專案的 GitHub Issues 提,並將 verdict 設 "review"。
- 若內容與「想要一個作品」無關(寫作業、通用聊天、攻擊/不當內容),verdict 設 "review"。

你【每次】只能輸出一個 JSON 物件,不要有其他文字:
- 還要追問:{"mode":"ask","question":"..."}
- 整理完成:{"mode":"final","title":"作品的名字或一句話","problem":"...","current":"...","desired":"核心功能1;核心功能2;...","who":"...","open_questions":["還沒問清楚的事"],"difficulty":"小|中|大|巨大","gaps":[{"type":"info|skill|resource","body":"實現者要自備的東西"}],"verdict":"ok" 或 "review","verdict_reason":"一句話"}`

function extractJson(text: string): any {
  try { return JSON.parse(text) } catch { /* fallthrough */ }
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)) } catch { /* fallthrough */ }
  }
  return null
}

export function parseRefineResponse(text: string): RefineResult {
  const obj = extractJson(text)
  if (!obj || typeof obj !== 'object') {
    return { mode: 'ask', question: '可以再多說一點你想要什麼嗎?' }
  }
  if (obj.mode === 'final' && typeof obj.title === 'string' && obj.title.trim()) {
    return {
      mode: 'final',
      title: String(obj.title),
      problem: String(obj.problem ?? ''),
      current: String(obj.current ?? ''),
      desired: String(obj.desired ?? ''),
      who: String(obj.who ?? ''),
      open_questions: Array.isArray(obj.open_questions) ? obj.open_questions.map(String).filter((s: string) => s.trim()) : [],
      difficulty: DIFFICULTIES.includes(obj.difficulty) ? obj.difficulty : '',
      gaps: Array.isArray(obj.gaps)
        ? obj.gaps
            .filter((g: any) => g && typeof g.body === 'string' && g.body.trim())
            .map((g: any) => ({
              type: (GAP_TYPES as readonly string[]).includes(g.type) ? g.type : 'info',
              body: String(g.body).trim(),
            }))
        : [],
      verdict: obj.verdict === 'ok' ? 'ok' : 'review',
      verdict_reason: String(obj.verdict_reason ?? ''),
    }
  }
  const q = typeof obj.question === 'string' && obj.question.trim() ? obj.question : '可以再多說一點你想要什麼嗎?'
  return { mode: 'ask', question: q }
}

export async function callGroq(env: Env, messages: ChatMsg[]): Promise<string> {
  const res = await fetch(`${env.GROQ_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.GROQ_API_KEY}` },
    body: JSON.stringify({
      model: env.GROQ_MODEL,
      temperature: 0.4,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
    }),
  })
  if (!res.ok) throw new Error(`groq ${res.status}`)
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  return data.choices?.[0]?.message?.content ?? ''
}

export async function refine(env: Env, messages: ChatMsg[]): Promise<RefineResult> {
  return parseRefineResponse(await callGroq(env, messages))
}

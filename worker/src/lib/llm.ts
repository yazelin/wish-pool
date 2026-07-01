import type { Env } from '../env'

export type ChatMsg = { role: 'user' | 'assistant'; content: string }
export type RefineResult =
  | { mode: 'ask'; question: string }
  | {
      mode: 'final'; title: string; problem: string; current: string; desired: string
      who: string; open_questions: string[]; verdict: 'ok' | 'review'; verdict_reason: string
      sig?: string
    }

export const SYSTEM_PROMPT = `你是一個 AI 社團「許願池」的引導助手。你唯一的任務:幫社員把「想要 AI 幫忙做的東西」講清楚,好讓開發者能規格化實作。

規則:
- 全程繁體中文,語氣親切、簡短。不使用 emoji。
- 一次只問一個澄清問題,依序釐清:要解決什麼問題、現在怎麼處理、理想中按一鍵會發生什麼、誰會用多常用。
- 使用者答不出來也沒關係,不要逼問;把沒答清楚的記到 open_questions。
- 當資訊夠了(或使用者想直接送出),就輸出 final。
- 若內容與「AI 工具/自動化需求」無關,或是要你寫作業、當通用聊天機器人、含攻擊/不當內容,verdict 設 "review"。

你【每次】只能輸出一個 JSON 物件,不要有其他文字:
- 還要追問:{"mode":"ask","question":"..."}
- 整理完成:{"mode":"final","title":"精簡標題","problem":"...","current":"...","desired":"...","who":"...","open_questions":["還沒問清楚的事"],"verdict":"ok" 或 "review","verdict_reason":"一句話"}`

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

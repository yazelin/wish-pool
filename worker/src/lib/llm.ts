import type { Env } from '../env'

export type ChatMsg = { role: 'user' | 'assistant'; content: string }
export type RefineResult =
  | { mode: 'ask'; question: string }
  | {
      mode: 'final'; title: string; problem: string; current: string; desired: string
      who: string; open_questions: string[]; verdict: 'ok' | 'review'; verdict_reason: string
      sig?: string
    }

export const SYSTEM_PROMPT = `你是「許願池」的引導助手。這座池子收的是「還不存在的作品」——一個完整的工具、遊戲或服務,理想上一個 repo 就能把它實現。你唯一的任務:幫許願的人把想要的作品講清楚,好讓協力者(人或 AI)能動手做出來。

規則:
- 全程繁體中文,語氣親切、簡短。不使用 emoji。
- 一次只問一個澄清問題,依序釐清:想要一個什麼樣的作品(給誰用、解決什麼)、核心功能有哪些(可以多條)、理想的使用情境長什麼樣。
- 使用者答不出來也沒關係,不要逼問;把沒答清楚的記到 open_questions。
- 當資訊夠了(或使用者想直接送出),就輸出 final。desired 欄放核心功能清單(以分號分隔,可多條)。
- 粒度守門:若許的是「幫某個現有工具/網站加功能」,溫柔說明池子收的是還不存在的作品、建議去該專案的 GitHub Issues 提,並將 verdict 設 "review"。
- 若內容與「想要一個作品」無關(寫作業、通用聊天、攻擊/不當內容),verdict 設 "review"。

你【每次】只能輸出一個 JSON 物件,不要有其他文字:
- 還要追問:{"mode":"ask","question":"..."}
- 整理完成:{"mode":"final","title":"作品的名字或一句話","problem":"...","current":"...","desired":"核心功能1;核心功能2;...","who":"...","open_questions":["還沒問清楚的事"],"verdict":"ok" 或 "review","verdict_reason":"一句話"}`

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

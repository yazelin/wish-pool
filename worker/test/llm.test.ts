import { describe, it, expect } from 'vitest'
import { parseRefineResponse } from '../src/lib/llm'

describe('parseRefineResponse', () => {
  it('parses an ask response', () => {
    const r = parseRefineResponse('{"mode":"ask","question":"這會給誰用?"}')
    expect(r).toEqual({ mode: 'ask', question: '這會給誰用?' })
  })

  it('parses a final response and coerces fields', () => {
    const r = parseRefineResponse(JSON.stringify({
      mode: 'final', title: 'X', problem: 'p', current: 'c', desired: 'd', who: 'w',
      open_questions: ['q1'], verdict: 'ok', verdict_reason: 'fine',
    }))
    expect(r.mode).toBe('final')
    if (r.mode === 'final') {
      expect(r.title).toBe('X')
      expect(r.open_questions).toEqual(['q1'])
      expect(r.verdict).toBe('ok')
    }
  })

  it('extracts JSON embedded in prose', () => {
    const r = parseRefineResponse('好的,這是結果:\n{"mode":"ask","question":"多久用一次?"}\n謝謝')
    expect(r).toEqual({ mode: 'ask', question: '多久用一次?' })
  })

  it('malformed JSON falls back to ask', () => {
    const r = parseRefineResponse('抱歉我壞了')
    expect(r.mode).toBe('ask')
  })

  it('unknown verdict coerced to review', () => {
    const r = parseRefineResponse(JSON.stringify({
      mode: 'final', title: 'X', open_questions: [], verdict: 'weird',
    }))
    if (r.mode === 'final') expect(r.verdict).toBe('review')
  })

  it('final missing a valid title falls through to ask (not a broken final)', () => {
    const r = parseRefineResponse(JSON.stringify({ mode: 'final', open_questions: [] }))
    expect(r.mode).toBe('ask')
    const blank = parseRefineResponse(JSON.stringify({ mode: 'final', title: '   ' }))
    expect(blank.mode).toBe('ask')
  })
})

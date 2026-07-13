import { getWish, PUBLIC_STATUSES } from './d1'
import { sha256Hex } from './ratelimit'

export const REFINEMENT_PROTOCOL_VERSION = 1
export const MAX_REFINEMENT_ROUNDS = 8
export const MAX_ROUND_ANSWERS = 3
export const MAX_ROUND_FOLLOWUPS = 3
export const CHECKLIST_KEYS = [
  'goal', 'users', 'mvp_scope', 'primary_flow', 'acceptance', 'constraints', 'safety',
] as const

type ChecklistKey = typeof CHECKLIST_KEYS[number]
export type RefinementChecklist = Record<ChecklistKey, boolean>

export type RoundAnswer = {
  need_id: number
  response_id?: number
  body: string
  state: 'answered' | 'resolved' | 'assumed'
  basis: 'requester' | 'source' | 'decision'
  confidence: 'high' | 'medium' | 'low'
  sources: string[]
}

export type RoundFollowup = {
  type: 'info' | 'skill' | 'resource'
  body: string
  asked_of: 'requester' | 'agent' | 'builder'
  priority: 'blocking' | 'important' | 'optional'
  parent_need_id?: number
}

export type RoundAssessment = {
  decision: 'continue' | 'needs_human' | 'agent_ready'
  summary: string
  checklist: RefinementChecklist
  spec?: Record<string, unknown>
}

export type RefinementRoundInput = {
  idempotency_key: string
  base_version: number
  answers: RoundAnswer[]
  followups: RoundFollowup[]
  assessment?: RoundAssessment
}

type EnrichedNeedRow = {
  id: number
  type: string
  body: string
  resolved: number
  refinement_state: string
  asked_of: string
  priority: string
  parent_need_id: number | null
  source_response_id: number | null
  refinement_round_id: number | null
  created_at: number
  updated_at: number
}

type EnrichedResponseRow = {
  id: number
  question_id: number | null
  parent_id: number | null
  is_solution: number
  body: string
  nickname: string | null
  kind: string
  created_at: number
  refinement_round_id: number | null
  basis: string | null
  confidence: string | null
  sources_json: string | null
  basis_response_id: number | null
}

type RoundRow = {
  id: number
  wish_id: number
  actor_key: string
  idempotency_key: string
  request_hash: string
  base_version: number
  resulting_version: number | null
  status: string
  decision: string | null
  summary: string | null
  checklist_json: string | null
  spec_json: string | null
  result_json: string | null
  apply_token: string | null
  apply_started_at: number | null
  created_at: number
  completed_at: number | null
}

export class RefinementError extends Error {
  constructor(public status: number, public code: string, public details?: Record<string, unknown>) {
    super(code)
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function text(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[]): v is T {
  return typeof v === 'string' && allowed.includes(v as T)
}

function isHttpUrl(v: string): boolean {
  try { const u = new URL(v); return u.protocol === 'http:' || u.protocol === 'https:' } catch { return false }
}

function parseChecklist(v: unknown): RefinementChecklist {
  const o = isObject(v) ? v : {}
  return Object.fromEntries(CHECKLIST_KEYS.map((key) => [key, o[key] === true])) as RefinementChecklist
}

export function parseRefinementRound(input: unknown): RefinementRoundInput {
  if (!isObject(input)) throw new RefinementError(400, 'bad_round')
  const idempotencyKey = typeof input.idempotency_key === 'string' ? input.idempotency_key.trim() : ''
  if (!idempotencyKey || idempotencyKey.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(idempotencyKey)) {
    throw new RefinementError(400, 'bad_idempotency_key')
  }
  const baseVersion = Number(input.base_version)
  if (!Number.isInteger(baseVersion) || baseVersion < 0) throw new RefinementError(400, 'bad_base_version')

  const rawAnswers = input.answers == null ? [] : input.answers
  const rawFollowups = input.followups == null ? [] : input.followups
  if (!Array.isArray(rawAnswers) || rawAnswers.length > MAX_ROUND_ANSWERS) {
    throw new RefinementError(400, 'too_many_answers', { max: MAX_ROUND_ANSWERS })
  }
  if (!Array.isArray(rawFollowups) || rawFollowups.length > MAX_ROUND_FOLLOWUPS) {
    throw new RefinementError(400, 'too_many_followups', { max: MAX_ROUND_FOLLOWUPS })
  }

  const answers: RoundAnswer[] = rawAnswers.map((raw) => {
    if (!isObject(raw)) throw new RefinementError(400, 'bad_answer')
    const needId = Number(raw.need_id)
    const body = text(raw.body)
    if (!Number.isInteger(needId) || needId <= 0 || !body) throw new RefinementError(400, 'bad_answer')
    if (body.length > 2000) throw new RefinementError(400, 'answer_too_long', { max: 2000 })
    if (!oneOf(raw.state, ['answered', 'resolved', 'assumed'] as const)) throw new RefinementError(400, 'bad_answer_state')
    if (!oneOf(raw.basis, ['requester', 'source', 'decision'] as const)) throw new RefinementError(400, 'bad_answer_basis')
    if (!oneOf(raw.confidence, ['high', 'medium', 'low'] as const)) throw new RefinementError(400, 'bad_answer_confidence')
    const responseId = raw.response_id == null ? undefined : Number(raw.response_id)
    if (responseId != null && (!Number.isInteger(responseId) || responseId <= 0)) throw new RefinementError(400, 'bad_answer_response')
    const rawSources = raw.sources == null ? [] : raw.sources
    if (!Array.isArray(rawSources) || rawSources.length > 5 || rawSources.some((s) => typeof s !== 'string')) {
      throw new RefinementError(400, 'bad_answer_sources')
    }
    const sources = (rawSources as string[]).map((source) => source.trim())
    if (sources.some((source) => source.length > 2048 || !isHttpUrl(source))) throw new RefinementError(400, 'bad_answer_sources')
    if (raw.basis === 'source' && !sources.length) throw new RefinementError(400, 'source_url_required')
    if (raw.state === 'resolved' && raw.basis !== 'requester' && !(raw.basis === 'source' && raw.confidence === 'high' && sources.length)) {
      throw new RefinementError(400, 'resolution_requires_evidence')
    }
    if (raw.basis === 'requester' && responseId == null) throw new RefinementError(400, 'requester_response_required')
    if (raw.basis !== 'requester' && responseId != null) throw new RefinementError(400, 'unexpected_response_id')
    if (raw.state === 'assumed' && raw.basis !== 'decision') throw new RefinementError(400, 'assumption_requires_decision')
    return {
      need_id: needId, response_id: responseId, body, state: raw.state,
      basis: raw.basis, confidence: raw.confidence, sources: sources as string[],
    }
  })
  if (new Set(answers.map((a) => a.need_id)).size !== answers.length) throw new RefinementError(400, 'duplicate_answer_need')

  const followups: RoundFollowup[] = rawFollowups.map((raw) => {
    if (!isObject(raw)) throw new RefinementError(400, 'bad_followup')
    const body = text(raw.body)
    if (!body) throw new RefinementError(400, 'bad_followup')
    if (body.length > 500) throw new RefinementError(400, 'followup_too_long', { max: 500 })
    if (!oneOf(raw.type, ['info', 'skill', 'resource'] as const)) throw new RefinementError(400, 'bad_followup_type')
    if (!oneOf(raw.asked_of, ['requester', 'agent', 'builder'] as const)) throw new RefinementError(400, 'bad_followup_audience')
    if (!oneOf(raw.priority, ['blocking', 'important', 'optional'] as const)) throw new RefinementError(400, 'bad_followup_priority')
    const parent = raw.parent_need_id == null ? undefined : Number(raw.parent_need_id)
    if (parent != null && (!Number.isInteger(parent) || parent <= 0)) throw new RefinementError(400, 'bad_followup_parent')
    return { type: raw.type, body, asked_of: raw.asked_of, priority: raw.priority, parent_need_id: parent }
  })

  let assessment: RoundAssessment | undefined
  if (input.assessment != null) {
    if (!isObject(input.assessment)) throw new RefinementError(400, 'bad_assessment')
    if (!oneOf(input.assessment.decision, ['continue', 'needs_human', 'agent_ready'] as const)) {
      throw new RefinementError(400, 'bad_assessment_decision')
    }
    const summary = text(input.assessment.summary)
    if (!summary) throw new RefinementError(400, 'bad_assessment_summary')
    if (summary.length > 1000) throw new RefinementError(400, 'assessment_summary_too_long', { max: 1000 })
    const spec = input.assessment.spec
    if (spec != null && (!isObject(spec) || JSON.stringify(spec).length > 20_000)) {
      throw new RefinementError(400, 'bad_structured_spec')
    }
    if (input.assessment.decision === 'agent_ready' && !isObject(spec)) {
      throw new RefinementError(400, 'agent_ready_requires_spec')
    }
    assessment = {
      decision: input.assessment.decision,
      summary,
      checklist: parseChecklist(input.assessment.checklist),
      spec: spec as Record<string, unknown> | undefined,
    }
  }
  if (!answers.length && !followups.length && !assessment) throw new RefinementError(400, 'empty_round')
  return { idempotency_key: idempotencyKey, base_version: baseVersion, answers, followups, assessment }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (!isObject(value)) return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
}

export async function refinementRequestHash(input: RefinementRoundInput): Promise<string> {
  return sha256Hex(JSON.stringify(canonical(input)))
}

export function normalizeNeedBody(body: string): string {
  return body.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('zh-TW')
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try { return JSON.parse(raw) as T } catch { return fallback }
}

function emptyChecklist(): RefinementChecklist {
  return Object.fromEntries(CHECKLIST_KEYS.map((key) => [key, false])) as RefinementChecklist
}

function mergeStructuredSpec(
  base: Record<string, unknown> | null,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(base ?? {}) }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete out[key]
    else if (isObject(value) && isObject(out[key])) out[key] = mergeStructuredSpec(out[key] as Record<string, unknown>, value)
    else out[key] = value
  }
  return out
}

function nonEmptyStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string' && item.trim().length > 0)
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.trim().length > 0)
}

export function checklistFromStructuredSpec(spec: Record<string, unknown> | null): RefinementChecklist {
  if (!spec) return emptyChecklist()
  const mvp = isObject(spec.mvp) ? spec.mvp : {}
  const requirements = Array.isArray(spec.requirements) ? spec.requirements : []
  return {
    goal: typeof spec.goal === 'string' && spec.goal.trim().length > 0,
    users: nonEmptyStrings(spec.users),
    mvp_scope: nonEmptyStrings(mvp.in_scope) && stringArray(mvp.out_of_scope),
    primary_flow: nonEmptyStrings(spec.primary_flow),
    acceptance: requirements.length > 0 && requirements.every((item) => {
      if (!isObject(item)) return false
      return typeof item.id === 'string' && item.id.trim().length > 0
        && typeof item.description === 'string' && item.description.trim().length > 0
        && nonEmptyStrings(item.acceptance)
    }),
    constraints: stringArray(spec.constraints),
    safety: stringArray(spec.safety),
  }
}

function structuredSpecIssues(spec: Record<string, unknown> | null, assumedNeedIds: number[]): string[] {
  const checklist = checklistFromStructuredSpec(spec)
  const issues: string[] = CHECKLIST_KEYS.filter((key) => !checklist[key])
  const assumptions = spec && Array.isArray(spec.assumptions) ? spec.assumptions : null
  if (!assumptions || !assumptions.every((item) => isObject(item)
    && Number.isInteger(Number(item.need_id)) && Number(item.need_id) > 0
    && typeof item.statement === 'string' && item.statement.trim().length > 0)) {
    issues.push('assumptions')
  } else {
    const documented = new Set(assumptions.map((item) => Number((item as Record<string, unknown>).need_id)))
    const active = new Set(assumedNeedIds)
    if (assumedNeedIds.some((id) => !documented.has(id)) || [...documented].some((id) => !active.has(id))) {
      issues.push('assumptions_content')
    }
  }
  return issues
}

export async function getRefinementContext(db: D1Database, wishId: number, opts: { includePrivate?: boolean } = {}) {
  const wish = await getWish(db, wishId)
  if (!wish || (!opts.includePrivate && !PUBLIC_STATUSES.includes(wish.status))) return null
  const versionRow = await db.prepare('SELECT refinement_version FROM wishes WHERE id = ?').bind(wishId)
    .first<{ refinement_version: number }>()
  const { results: needRows } = await db.prepare(
    `SELECT id, type, body, resolved, refinement_state, asked_of, priority,
            parent_need_id, source_response_id, refinement_round_id, created_at, updated_at
     FROM needs WHERE wish_id = ?
     ORDER BY CASE priority WHEN 'blocking' THEN 0 WHEN 'important' THEN 1 ELSE 2 END, id`,
  ).bind(wishId).all<EnrichedNeedRow>()
  const { results: responseRows } = await db.prepare(
      `SELECT id, question_id, parent_id, is_solution, body, nickname, kind, created_at,
            refinement_round_id, basis, confidence, sources_json, basis_response_id
     FROM responses WHERE wish_id = ? ORDER BY id`,
  ).bind(wishId).all<EnrichedResponseRow>()
  const latest = await db.prepare(
    `SELECT id, wish_id, actor_key, idempotency_key, request_hash, base_version, resulting_version,
            status, decision, summary, checklist_json, spec_json, result_json,
            apply_token, apply_started_at, created_at, completed_at
     FROM refinement_rounds WHERE wish_id = ? AND status IN ('applied','completed')
     ORDER BY resulting_version DESC LIMIT 1`,
  ).bind(wishId).first<RoundRow>()
  const rounds = await db.prepare("SELECT COUNT(*) AS n FROM refinement_rounds WHERE wish_id = ? AND status IN ('applied','completed')")
    .bind(wishId).first<{ n: number }>()

  const checklist = latest ? parseJson<RefinementChecklist>(latest.checklist_json, emptyChecklist()) : emptyChecklist()
  const structuredSpec = latest ? parseJson<Record<string, unknown> | null>(latest.spec_json, null) : null
  const needs = needRows.map((need) => ({
    id: need.id,
    type: need.type,
    body: need.body,
    state: need.refinement_state,
    asked_of: need.asked_of,
    priority: need.priority,
    parent_need_id: need.parent_need_id,
    source_response_id: need.source_response_id,
    round_id: need.refinement_round_id,
    created_at: need.created_at,
    updated_at: need.updated_at,
    answers: responseRows.filter((r) => r.question_id === need.id).map((r) => ({
      id: r.id,
      body: r.body,
      nickname: r.nickname,
      created_at: r.created_at,
      round_id: r.refinement_round_id,
      basis: r.basis,
      confidence: r.confidence,
      sources: parseJson<string[]>(r.sources_json, []),
      basis_response_id: r.basis_response_id,
      selected: r.id === need.source_response_id,
      replies: responseRows.filter((reply) => reply.parent_id === r.id).map((reply) => ({
        id: reply.id,
        body: reply.body,
        nickname: reply.nickname,
        created_at: reply.created_at,
      })),
    })),
  }))

  const activeStates = new Set(['open', 'answered'])
  const blockers = needs.filter((n) => n.priority === 'blocking' && activeStates.has(n.state))
  const specBlockers = blockers.filter((n) => n.type === 'info')
  const checklistMissing = CHECKLIST_KEYS.filter((key) => !checklist[key])
  const currentVersion = Number(versionRow?.refinement_version ?? 0)
  const readyAssessmentCurrent = latest?.decision === 'agent_ready' && latest.resulting_version === currentVersion
  const specReady = readyAssessmentCurrent && specBlockers.length === 0 && checklistMissing.length === 0
  const implementationReady = specReady && blockers.length === 0
  const hasAssumptions = needs.some((n) => n.type === 'info' && n.state === 'assumed')
  const roundCount = Number(rounds?.n ?? 0)
  const explicitStop = latest?.decision === 'needs_human' && latest.resulting_version === currentVersion

  let specState: 'refining' | 'needs_human' | 'ready_with_assumptions' | 'ready'
  if (specReady) specState = hasAssumptions ? 'ready_with_assumptions' : 'ready'
  else if (explicitStop) specState = 'needs_human'
  else specState = 'refining'

  const answered = specBlockers.find((n) => n.state === 'answered')
  const agentNeed = specBlockers.find((n) => n.state === 'open' && n.asked_of === 'agent')
  const requesterNeed = specBlockers.find((n) => n.state === 'open' && n.asked_of === 'requester')
  const builderNeed = specBlockers.find((n) => n.state === 'open' && n.asked_of === 'builder')
  const implementationBlocker = blockers.find((n) => n.type !== 'info')
  let nextAction: Record<string, unknown>
  if (explicitStop && !specReady) {
    nextAction = { kind: 'stop', reason: 'agent_assessment', action: 'needs_human' }
  } else if (answered) {
    nextAction = { kind: 'evaluate_answer', need_id: answered.id }
  } else if (agentNeed) {
    nextAction = { kind: 'research_need', need_id: agentNeed.id }
  } else if (requesterNeed) {
    nextAction = { kind: 'ask_requester', need_id: requesterNeed.id }
  } else if (builderNeed) {
    nextAction = { kind: 'ask_builder', need_id: builderNeed.id }
  } else if (checklistMissing.length) {
    nextAction = { kind: 'draft_spec', missing: checklistMissing }
  } else if (!specReady) {
    nextAction = { kind: 'assess_readiness' }
  } else if (implementationBlocker) {
    nextAction = { kind: 'plan_implementation_gap', need_id: implementationBlocker.id }
  } else {
    nextAction = { kind: 'ready_to_claim' }
  }

  const counts = {
    total: needs.length,
    open: needs.filter((n) => n.state === 'open').length,
    answered: needs.filter((n) => n.state === 'answered').length,
    resolved: needs.filter((n) => n.state === 'resolved').length,
    assumed: needs.filter((n) => n.state === 'assumed').length,
    superseded: needs.filter((n) => n.state === 'superseded').length,
    blocking: blockers.length,
  }
  return {
    protocol_version: REFINEMENT_PROTOCOL_VERSION,
    wish: {
      id: wish.id, title: wish.title, problem: wish.problem, current: wish.current,
      desired: wish.desired, who: wish.who, notes: wish.notes, difficulty: wish.difficulty,
      status: wish.status,
    },
    version: currentVersion,
    spec_state: specState,
    spec_ready: specReady,
    implementation_ready: implementationReady,
    checklist,
    structured_spec: structuredSpec,
    latest_assessment: latest ? { round_id: latest.id, decision: latest.decision, summary: latest.summary } : null,
    round_count: roundCount,
    counts,
    blockers,
    needs,
    discussion: responseRows.filter((r) => !r.question_id && !r.parent_id).map((r) => ({
      id: r.id, body: r.body, nickname: r.nickname, created_at: r.created_at,
      replies: responseRows.filter((reply) => reply.parent_id === r.id).map((reply) => ({
        id: reply.id, body: reply.body, nickname: reply.nickname, created_at: reply.created_at,
      })),
    })),
    work_log: wish.updates,
    implementations: wish.answers,
    next_action: nextAction,
    limits: {
      max_rounds_per_run: MAX_REFINEMENT_ROUNDS,
      max_answers_per_round: MAX_ROUND_ANSWERS,
      max_followups_per_round: MAX_ROUND_FOLLOWUPS,
    },
    spec_url: `/api/wishes/${wishId}/spec`,
  }
}

async function findRound(db: D1Database, wishId: number, actorKey: string, key: string): Promise<RoundRow | null> {
  return (await db.prepare(
    `SELECT id, wish_id, actor_key, idempotency_key, request_hash, base_version, resulting_version,
            status, decision, summary, checklist_json, spec_json, result_json,
            apply_token, apply_started_at, created_at, completed_at
     FROM refinement_rounds WHERE wish_id = ? AND actor_key = ? AND idempotency_key = ?`,
  ).bind(wishId, actorKey, key).first<RoundRow>()) ?? null
}

async function validateReferences(db: D1Database, wishId: number, input: RefinementRoundInput): Promise<void> {
  const ids = [...input.answers.map((a) => a.need_id), ...input.followups.flatMap((f) => f.parent_need_id ? [f.parent_need_id] : [])]
  if (ids.length) {
    const unique = [...new Set(ids)]
    const marks = unique.map(() => '?').join(',')
    const { results } = await db.prepare(
      `SELECT id, type, refinement_state FROM needs WHERE wish_id = ? AND id IN (${marks})`,
    ).bind(wishId, ...unique).all<{ id: number; type: string; refinement_state: string }>()
    if (results.length !== unique.length) throw new RefinementError(400, 'need_not_in_wish')
    const states = new Map(results.map((r) => [r.id, r.refinement_state]))
    const types = new Map(results.map((r) => [r.id, r.type]))
    if (input.answers.some((a) => !['open', 'answered', 'assumed'].includes(states.get(a.need_id) ?? ''))) {
      throw new RefinementError(409, 'need_not_active')
    }
    if (input.answers.some((a) => a.state === 'assumed' && types.get(a.need_id) !== 'info')) {
      throw new RefinementError(400, 'non_info_assumption')
    }
  }
  const requesterAnswers = input.answers.filter((answer) => answer.basis === 'requester')
  if (requesterAnswers.length) {
    const responseIds = requesterAnswers.map((answer) => answer.response_id!)
    const marks = responseIds.map(() => '?').join(',')
    const { results } = await db.prepare(
      `SELECT id, question_id FROM responses
       WHERE wish_id = ? AND id IN (${marks}) AND kind != 'refinement'
         AND refinement_round_id IS NULL AND agent_token_id IS NULL`,
    ).bind(wishId, ...responseIds).all<{ id: number; question_id: number | null }>()
    const byId = new Map(results.map((response) => [response.id, response.question_id]))
    if (requesterAnswers.some((answer) => byId.get(answer.response_id!) !== answer.need_id)) {
      throw new RefinementError(400, 'requester_response_not_eligible')
    }
  }
  const normalized = input.followups.map((f) => normalizeNeedBody(f.body))
  if (new Set(normalized).size !== normalized.length) throw new RefinementError(409, 'duplicate_followup')
  for (const body of normalized) {
    const exists = await db.prepare(
      `SELECT 1 AS x FROM needs WHERE wish_id = ? AND (dedupe_key = ? OR lower(trim(body)) = ?) LIMIT 1`,
    ).bind(wishId, body, body).first<{ x: number }>()
    if (exists) throw new RefinementError(409, 'duplicate_followup')
  }
}

async function roundResult(db: D1Database, wishId: number, round: RoundRow, replayed: boolean) {
  const context = await getRefinementContext(db, wishId, { includePrivate: true })
  if (!context) throw new RefinementError(404, 'not_found')
  const { results: answers } = await db.prepare(
    'SELECT id FROM responses WHERE refinement_round_id = ? ORDER BY id',
  ).bind(round.id).all<{ id: number }>()
  const { results: followups } = await db.prepare(
    'SELECT id FROM needs WHERE refinement_round_id = ? ORDER BY id',
  ).bind(round.id).all<{ id: number }>()
  return {
    round_id: round.id,
    replayed,
    version: round.resulting_version ?? context.version,
    answer_ids: answers.map((r) => r.id),
    followup_ids: followups.map((r) => r.id),
    spec_state: context.spec_state,
    spec_ready: context.spec_ready,
    implementation_ready: context.implementation_ready,
    counts: context.counts,
    next_action: context.next_action,
  }
}

async function replayCommittedRound(db: D1Database, wishId: number, round: RoundRow, now: number) {
  if (round.status === 'applied') {
    await db.prepare("UPDATE refinement_rounds SET status = 'completed', completed_at = ? WHERE id = ? AND status = 'applied'")
      .bind(now, round.id).run()
    round.status = 'completed'
    round.completed_at = now
  }
  const result = await roundResult(db, wishId, round, true)
  await db.prepare('UPDATE refinement_rounds SET result_json = ?, completed_at = COALESCE(completed_at, ?) WHERE id = ?')
    .bind(JSON.stringify({ ...result, replayed: false }), now, round.id).run()
  return result
}

export async function applyRefinementRound(
  db: D1Database,
  wishId: number,
  actorKey: string,
  agentTokenId: number | null,
  input: RefinementRoundInput,
  requestHash: string,
  now: number,
) {
  let existing = await findRound(db, wishId, actorKey, input.idempotency_key)
  if (existing) {
    if (existing.request_hash !== requestHash) throw new RefinementError(409, 'idempotency_conflict')
    if (existing.result_json) return { ...parseJson<Record<string, unknown>>(existing.result_json, {}), replayed: true }
    if (existing.status === 'applied' || existing.status === 'completed') {
      return replayCommittedRound(db, wishId, existing, now)
    }
  }

  const context = await getRefinementContext(db, wishId)
  if (!context) throw new RefinementError(404, 'not_found')
  if (context.version !== input.base_version) {
    if (existing?.status === 'pending') {
      await db.prepare("DELETE FROM refinement_rounds WHERE id = ? AND status = 'pending'").bind(existing.id).run()
    }
    throw new RefinementError(409, 'stale_refinement', { current_version: context.version })
  }
  await validateReferences(db, wishId, input)

  const assessment = input.assessment
  const effectiveSpec = assessment?.spec
    ? mergeStructuredSpec(context.structured_spec, assessment.spec)
    : context.structured_spec
  if (effectiveSpec && JSON.stringify(effectiveSpec).length > 20_000) {
    throw new RefinementError(400, 'structured_spec_too_large')
  }
  const projectedAssumedNeedIds = new Set(context.needs.filter((need) => need.state === 'assumed').map((need) => need.id))
  for (const answer of input.answers) {
    if (answer.state === 'assumed') projectedAssumedNeedIds.add(answer.need_id)
    else projectedAssumedNeedIds.delete(answer.need_id)
  }
  const effectiveChecklist = checklistFromStructuredSpec(effectiveSpec)
  if (assessment?.decision === 'agent_ready') {
    const issues = structuredSpecIssues(effectiveSpec, [...projectedAssumedNeedIds])
    if (issues.length) throw new RefinementError(409, 'agent_ready_incomplete', { missing: issues })
  }

  if (!existing) {
    try {
      const inserted = await db.prepare(
        `INSERT INTO refinement_rounds
           (wish_id, actor_key, idempotency_key, request_hash, base_version, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?) RETURNING id`,
      ).bind(wishId, actorKey, input.idempotency_key, requestHash, input.base_version, now).first<{ id: number }>()
      existing = await findRound(db, wishId, actorKey, input.idempotency_key)
      if (!inserted?.id || !existing) throw new Error('round_reservation_failed')
    } catch (error) {
      existing = await findRound(db, wishId, actorKey, input.idempotency_key)
      if (!existing) throw error
      if (existing.request_hash !== requestHash) throw new RefinementError(409, 'idempotency_conflict')
      if (existing.result_json) return { ...parseJson<Record<string, unknown>>(existing.result_json, {}), replayed: true }
    }
  }
  if (!existing) throw new Error('round_missing')

  const applyToken = crypto.randomUUID()
  const claimed = await db.prepare(
    `UPDATE refinement_rounds SET status = 'applying', apply_token = ?, apply_started_at = ?
     WHERE id = ? AND (
       status = 'pending' OR (status = 'applying' AND COALESCE(apply_started_at, 0) < ?)
     ) RETURNING id`,
  ).bind(applyToken, now, existing.id, now - 60).first<{ id: number }>()
  if (!claimed?.id) {
    const current = await findRound(db, wishId, actorKey, input.idempotency_key)
    if (current?.request_hash !== requestHash) throw new RefinementError(409, 'idempotency_conflict')
    if (current?.result_json) return { ...parseJson<Record<string, unknown>>(current.result_json, {}), replayed: true }
    if (current && ['applied', 'completed'].includes(current.status)) {
      return replayCommittedRound(db, wishId, current, now)
    }
    throw new RefinementError(409, 'round_in_progress', { retry_after: 2 })
  }

  const nextVersion = input.base_version + 1
  const gate = `EXISTS (
    SELECT 1 FROM wishes w
    JOIN refinement_rounds rr ON rr.id = w.refinement_active_round_id
    WHERE w.id = ? AND w.refinement_version = ? AND rr.id = ?
      AND rr.status = 'applying' AND rr.apply_token = ?
  )`
  const statements: D1PreparedStatement[] = [
    db.prepare(
      `UPDATE wishes SET refinement_version = ?, refinement_active_round_id = ?
       WHERE id = ? AND refinement_version = ?
         AND status IN ('published','adopted','building','done')
         AND EXISTS (
           SELECT 1 FROM refinement_rounds
           WHERE id = ? AND status = 'applying' AND apply_token = ?
         )`,
    ).bind(nextVersion, existing.id, wishId, input.base_version, existing.id, applyToken),
  ]
  for (const answer of input.answers) {
    statements.push(db.prepare(
      `INSERT INTO responses
         (wish_id, question_id, body, nickname, kind, created_at, agent_token_id,
          refinement_round_id, basis, confidence, sources_json, basis_response_id)
         SELECT ?, ?, ?, 'Agent refinement', 'refinement', ?, ?, ?, ?, ?, ?, ? WHERE ${gate}`,
    ).bind(
      wishId, answer.need_id, answer.body, now, agentTokenId, existing.id,
      answer.basis, answer.confidence, JSON.stringify(answer.sources), answer.response_id ?? null,
      wishId, nextVersion, existing.id, applyToken,
    ))
    statements.push(db.prepare(
      `UPDATE needs SET refinement_state = ?, resolved = 1,
         source_response_id = CASE WHEN ? IS NOT NULL THEN ? ELSE (
           SELECT id FROM responses WHERE refinement_round_id = ? AND question_id = ? ORDER BY id DESC LIMIT 1
         ) END, updated_at = ?
       WHERE wish_id = ? AND id = ? AND refinement_state IN ('open','answered','assumed') AND ${gate}`,
    ).bind(
      answer.state, answer.response_id ?? null, answer.response_id ?? null,
      existing.id, answer.need_id, now, wishId, answer.need_id,
      wishId, nextVersion, existing.id, applyToken,
    ))
  }
  for (const followup of input.followups) {
    const dedupe = normalizeNeedBody(followup.body)
    statements.push(db.prepare(
      `INSERT INTO needs
         (wish_id, type, body, resolved, refinement_state, asked_of, priority,
          parent_need_id, source_response_id, refinement_round_id, dedupe_key,
          created_at, updated_at, agent_token_id)
       SELECT ?, ?, ?, 0, 'open', ?, ?, ?,
         (SELECT source_response_id FROM needs WHERE wish_id = ? AND id = ?),
         ?, ?, ?, ?, ? WHERE ${gate}`,
    ).bind(
      wishId, followup.type, followup.body, followup.asked_of, followup.priority,
      followup.parent_need_id ?? null, wishId, followup.parent_need_id ?? -1,
      existing.id, dedupe, now, now, agentTokenId,
      wishId, nextVersion, existing.id, applyToken,
    ))
  }
  statements.push(db.prepare(
    `UPDATE refinement_rounds SET status = 'applied', resulting_version = ?, decision = ?,
       summary = ?, checklist_json = ?, spec_json = ?
     WHERE id = ? AND apply_token = ? AND ${gate}`,
  ).bind(
    nextVersion, assessment?.decision ?? null, assessment?.summary ?? null,
    JSON.stringify(effectiveChecklist),
    effectiveSpec ? JSON.stringify(effectiveSpec) : null,
    existing.id, applyToken, wishId, nextVersion, existing.id, applyToken,
  ))

  let batch: D1Result[]
  try {
    batch = await db.batch(statements)
  } catch (error) {
    await db.prepare(
      "UPDATE refinement_rounds SET status = 'pending', apply_token = NULL, apply_started_at = NULL WHERE id = ? AND status = 'applying' AND apply_token = ?",
    ).bind(existing.id, applyToken).run()
    if (String((error as Error)?.message ?? error).includes('UNIQUE')) throw new RefinementError(409, 'duplicate_followup')
    throw error
  }
  if (!batch[0]?.meta?.changes) {
    await db.prepare("DELETE FROM refinement_rounds WHERE id = ? AND status = 'applying' AND apply_token = ?")
      .bind(existing.id, applyToken).run()
    const current = await db.prepare('SELECT refinement_version, status FROM wishes WHERE id = ?').bind(wishId)
      .first<{ refinement_version: number; status: string }>()
    if (!current || !PUBLIC_STATUSES.includes(current.status)) throw new RefinementError(404, 'not_found')
    throw new RefinementError(409, 'stale_refinement', { current_version: current?.refinement_version ?? 0 })
  }

  existing = (await findRound(db, wishId, actorKey, input.idempotency_key))!
  await db.prepare("UPDATE refinement_rounds SET status = 'completed', completed_at = ? WHERE id = ?")
    .bind(now, existing.id).run()
  existing.status = 'completed'
  existing.completed_at = now
  const result = await roundResult(db, wishId, existing, false)
  await db.prepare('UPDATE refinement_rounds SET result_json = ? WHERE id = ?')
    .bind(JSON.stringify(result), existing.id).run()
  return result
}

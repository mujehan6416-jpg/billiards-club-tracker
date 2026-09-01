import type { Member, Session } from '../types'
import type { Tournament, TournamentParticipant, TournamentMatch } from '../types/tournament'
import { calculateFinalPlacements } from '../logic/tournamentMatch'
import {
  mapParticipantNames, validateTournamentSpecShape, namesUsedInSpec,
  checkExistingGamesOnDate, checkExistingTournamentNames,
  buildBracketFromSpec, buildGamesFromSpec,
} from './tournamentApr18Import'
import type { Apr18TournamentSpec, DuplicateCheckResult } from './tournamentApr18Import'

// 2025-11-29 "제1회 성균관대학교 부산동문 회장배 당구대회"(개인전) 복원 전용 가져오기 로직.
//
// 2026-04-18 가져오기(tournamentApr18Import.ts)가 이미 만든 범용 순수 함수(이름 매핑, spec
// 형태 검증, 중복 검사, 대진/경기 계산)를 그대로 재사용한다 — 이 파일은 "대회가 1개뿐"이라는
// 점만 다르다(4/18은 정기대회+챌린전 2개였다). 새로 만든 것은 대회 1개짜리 계획 집계
// (buildNov29ImportPlan), 적용 조건(evaluateNov29ApplyEligibility), 실제 문서 계산
// (buildNov29FirestoreWrites), 오케스트레이션(applyNov29Import)뿐이다.
//
// ⚠ 이 파일도 실제 회원 이름·점수를 절대 하드코딩하지 않는다. 실제 데이터는 관리자가 화면에서
// 직접 선택하는 로컬 JSON 파일에만 있다.
//
// 이 파일은 Firebase를 전혀 import하지 않는다 — 계산만 하고 아무것도 쓰지 않는다. 실제
// Firestore 연결은 tournamentNov29ApplyFirestore.ts라는 아주 얇은 별도 파일에만 있다.

export interface Nov29ImportSpec {
  /** 2025-11-29 당시 핸디 스냅샷(회원의 현재 핸디가 아니다). */
  participants: { name: string; handicap: number }[]
  tournament: Apr18TournamentSpec
}

// ── 전체 dry-run 계산 ──────────────────────────────────────────────────

export interface Nov29ImportPlan {
  ok: boolean
  issues: string[]
  mapping: { mappedCount: number; totalCount: number; missingNames: string[]; duplicateNames: string[] }
  actualGameCount: number
  byeCount: number
  tournamentDuplicateCheck: DuplicateCheckResult
  gameDuplicateCheck: DuplicateCheckResult
}

/** Firestore를 전혀 부르지 않는다 — 호출부가 이미 읽어 온 members/sessions/tournaments로 계산만 한다. */
export function buildNov29ImportPlan(
  spec: Nov29ImportSpec,
  context: {
    members: Pick<Member, 'id' | 'name'>[]
    existingSessions: Session[]
    existingTournaments: Pick<Tournament, 'name' | 'date'>[]
  },
): Nov29ImportPlan {
  const issues: string[] = [...validateTournamentSpecShape(spec.tournament)]

  const allNames = [...new Set([
    ...spec.participants.map((p) => p.name),
    ...namesUsedInSpec(spec.tournament),
  ])]
  const mapping = mapParticipantNames(context.members, allNames)
  if (!mapping.ok) {
    for (const n of mapping.missingNames) issues.push(`회원을 찾을 수 없습니다: ${n}`)
    for (const n of mapping.duplicateNames) issues.push(`동명이인이 있어 확정할 수 없습니다: ${n}`)
  }

  const handicapByName = new Map(spec.participants.map((p) => [p.name, p.handicap]))
  for (const name of allNames) {
    if (!handicapByName.has(name)) issues.push(`핸디 스냅샷이 없습니다: ${name}`)
  }

  const games = mapping.ok ? buildGamesFromSpec(spec.tournament, mapping.nameToId, handicapByName, () => '') : []
  const byeCount = spec.tournament.matches.filter((m) => m.resultType === 'bye').length

  const tournamentDup = checkExistingTournamentNames(context.existingTournaments, spec.tournament.date, [spec.tournament.name])
  const gameDup = checkExistingGamesOnDate(context.existingSessions, spec.tournament.date)
  if (!tournamentDup.ok) issues.push(...tournamentDup.details)
  if (!gameDup.ok) issues.push(...gameDup.details)

  return {
    ok: issues.length === 0,
    issues,
    mapping: {
      mappedCount: mapping.mappedCount, totalCount: mapping.totalCount,
      missingNames: mapping.missingNames, duplicateNames: mapping.duplicateNames,
    },
    actualGameCount: games.length,
    byeCount,
    tournamentDuplicateCheck: tournamentDup,
    gameDuplicateCheck: gameDup,
  }
}

// ── 실제 적용 가능 여부 판정 ──────────────────────────────────────────

export interface Nov29ApplyEligibility {
  eligible: boolean
  reasons: string[]
}

/**
 * 2025-11-29 가져오기 전용 목표 수치(참가자 15, 실제 경기 15, 부전진출 1)를 그대로 확인
 * 조건에 둔다 — 이번 대회 전용 도구이지 범용 import 도구가 아니기 때문이다.
 */
export function evaluateNov29ApplyEligibility(plan: Nov29ImportPlan, isAdminAuthorized: boolean): Nov29ApplyEligibility {
  const reasons: string[] = []
  if (!plan.ok) reasons.push('검증 미리보기를 통과하지 못했습니다.')
  if (plan.mapping.totalCount !== 15 || plan.mapping.mappedCount !== 15) reasons.push('회원 이름 매핑이 15/15가 아닙니다.')
  if (plan.mapping.missingNames.length > 0) reasons.push('누락된 회원이 있습니다.')
  if (plan.mapping.duplicateNames.length > 0) reasons.push('동명이인이 있습니다.')
  if (!plan.tournamentDuplicateCheck.ok) reasons.push('같은 이름의 대회가 이미 존재합니다.')
  if (!plan.gameDuplicateCheck.ok) reasons.push('같은 날짜에 이미 저장된 경기가 있습니다.')
  if (plan.actualGameCount !== 15) reasons.push('실제 경기가 15건이 아닙니다.')
  if (plan.byeCount !== 1) reasons.push('부전진출이 1건이 아닙니다.')
  if (!isAdminAuthorized) reasons.push('관리자 Firebase 인증이 확인되지 않았습니다.')
  return { eligible: reasons.length === 0, reasons }
}

// ── 실제 Firestore 문서 계산(순수 함수 — 아직 아무것도 쓰지 않는다) ────────────────────

export interface Nov29BuiltWrites {
  session: { id: string; date: string; attendeeIds: string[] }
  games: { sessionId: string; game: import('../types').Game }[]
  tournament: Tournament
  participants: TournamentParticipant[]
  matches: TournamentMatch[]
}

function bracketSizeFor(participantCount: number): number {
  return Math.pow(2, Math.ceil(Math.log2(Math.max(participantCount, 1))))
}

/** 이미 완전히 끝난 과거 기록이므로 라이브 진행 단계를 거치지 않고 바로 status:'finished'로 만든다. */
export function buildNov29FirestoreWrites(
  spec: Nov29ImportSpec,
  nameToId: Map<string, string>,
  input: { adminUid: string; at: string; makeId: () => string },
): Nov29BuiltWrites {
  const handicapByName = new Map(spec.participants.map((p) => [p.name, p.handicap]))

  const bracket = buildBracketFromSpec(spec.tournament, nameToId, handicapByName, 'N29')
  const games = buildGamesFromSpec(spec.tournament, nameToId, handicapByName, input.makeId)
  const placements = calculateFinalPlacements(bracket.matches)

  const tournamentId = input.makeId()
  const tournament: Tournament = {
    id: tournamentId,
    name: spec.tournament.name,
    date: spec.tournament.date,
    timeLimitMinutes: spec.tournament.timeLimitMinutes,
    status: 'finished',
    participantCount: bracket.participants.length,
    bracketSize: bracketSizeFor(bracket.participants.length),
    createdAt: input.at,
    createdByAdminUid: input.adminUid,
    drawConfirmedAt: input.at,
    completedAt: input.at,
    championParticipantId: placements.championParticipantId,
    runnerUpParticipantId: placements.runnerUpParticipantId,
  }

  const sessionId = input.makeId()
  return {
    session: { id: sessionId, date: spec.tournament.date, attendeeIds: bracket.participants.map((p) => p.id) },
    games: games.map((game) => ({ sessionId, game })),
    tournament,
    participants: bracket.participants,
    matches: bracket.matches,
  }
}

// ── 적용 오케스트레이션(의존성 주입 — 이 함수도 Firebase를 모른다) ──────────────────────

export interface Nov29ApplyDeps {
  fetchAdminDoc: (uid: string) => Promise<{ active: boolean } | null>
  loadState: () => Promise<{ members: Pick<Member, 'id' | 'name'>[]; sessions: Session[] }>
  fetchTournaments: () => Promise<Pick<Tournament, 'name' | 'date'>[]>
  commitBatch: (writes: Nov29BuiltWrites) => Promise<void>
  makeId: () => string
  now: () => string
}

export interface Nov29ApplyResult {
  ok: boolean
  message: string
  summary?: { actualGames: number; byeAdvances: number }
}

export async function applyNov29Import(
  spec: Nov29ImportSpec,
  input: { adminUid: string },
  deps: Nov29ApplyDeps,
): Promise<Nov29ApplyResult> {
  const adminDoc = await deps.fetchAdminDoc(input.adminUid)
  if (!adminDoc || adminDoc.active !== true) {
    return { ok: false, message: '관리자 권한을 다시 확인하지 못했습니다. 다시 로그인해 주세요.' }
  }

  const [state, existingTournaments] = await Promise.all([deps.loadState(), deps.fetchTournaments()])
  const plan = buildNov29ImportPlan(spec, {
    members: state.members, existingSessions: state.sessions, existingTournaments,
  })
  const eligibility = evaluateNov29ApplyEligibility(plan, true)
  if (!eligibility.eligible) {
    return { ok: false, message: `적용 직전 재검사에서 문제를 발견해 중단했습니다: ${eligibility.reasons.join(' / ')}` }
  }

  const allNames = [...new Set([
    ...spec.participants.map((p) => p.name),
    ...namesUsedInSpec(spec.tournament),
  ])]
  const mapping = mapParticipantNames(state.members, allNames)
  if (!mapping.ok) {
    return { ok: false, message: '적용 직전 재검사에서 회원 매핑 문제를 발견해 중단했습니다.' }
  }

  const writes = buildNov29FirestoreWrites(spec, mapping.nameToId, {
    adminUid: input.adminUid, at: deps.now(), makeId: deps.makeId,
  })

  try {
    await deps.commitBatch(writes)
  } catch {
    return { ok: false, message: '저장 중 오류가 발생했습니다. 검증 미리보기부터 다시 확인한 뒤 재시도해 주세요.' }
  }

  return {
    ok: true,
    message: '적용을 완료했습니다.',
    summary: { actualGames: writes.games.length, byeAdvances: plan.byeCount },
  }
}

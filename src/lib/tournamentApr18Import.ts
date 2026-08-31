import type { Game, Member, Session } from '../types'
import type {
  Tournament, TournamentMatch, TournamentParticipant, TournamentResultType,
} from '../types/tournament'
import { calculateFinalPlacements } from '../logic/tournamentMatch'

// 2026-04-18 과거 대회(제2회 회장배 당구대회 + 제2회 회장배 챌린전) 복원 전용 가져오기 로직.
//
// ⚠ 이 파일에는 실제 회원 이름·점수를 절대 하드코딩하지 않는다. 이번 두 대회의 실제 데이터는
// scripts/(전체가 .gitignore로 공개 저장소에서 제외됨)에 있는 로컬 전용 JSON 파일에만 있고,
// 관리자 화면에서 그 파일을 직접 선택(업로드)해서 이 순수 함수들에 넘긴다. 그래서 이 파일이
// 배포되는 JS 번들에 실명이 영구히 박히지 않는다.
//
// 이 파일은 Firebase를 전혀 import하지 않는다 — 여기 있는 모든 함수는 순수 계산만 하고,
// 어디에도 쓰지 않는다(그래서 "dry-run에서는 Firestore write 0회"가 이 파일 구조만으로 보장된다).
// 실제 Firestore 쓰기는 이 파일이 계산한 결과를 별도 apply 함수(다음 단계에서 구현)가 받아서
// 기존 splitFirestore.ts / lib/tournamentSync.ts의 정상 저장 함수로 넘길 때만 일어난다.

export type Apr18MatchResultType = TournamentResultType

/**
 * 경기 하나(부전승 포함)를 로컬 키로 표현한다. 실제 TournamentMatch.nextMatchId처럼 승자
 * 진출 경로만 표현하고, nextKey는 이 spec 안의 다른 match.key를 가리킨다.
 *
 * winner는 항상 명시한다 — 점수 대소로 승자를 다시 계산하지 않기 위해서다(당구는 핸디 경기라
 * 원점수가 높은 쪽이 진 경기가 실제로 있다).
 */
export interface Apr18RawMatch {
  key: string
  roundNumber: number
  playerCountInRound: number
  matchNumber: number
  resultType: Apr18MatchResultType
  /** 부전승이면 한쪽만 있고 나머지는 null. */
  playerA: string | null
  playerB: string | null
  /** 실제 경기(resultType==='normal')만 채운다. 부전승은 null. */
  scoreA: number | null
  scoreB: number | null
  /** playerA/playerB 중 하나와 정확히 같아야 한다(검증 대상). */
  winner: string
  nextKey: string | null
  nextSlot: 'playerA' | 'playerB' | null
}

export interface Apr18TournamentSpec {
  name: string
  date: string
  timeLimitMinutes: number
  matches: Apr18RawMatch[]
}

export interface Apr18ImportSpec {
  /** 2026-04-18 당시 핸디 스냅샷. 두 대회에 걸쳐 공통으로 쓴다(회원의 현재 핸디가 아니다). */
  participants: { name: string; handicap: number }[]
  regular: Apr18TournamentSpec
  challenger: Apr18TournamentSpec
}

// ── 스펙 자체의 형태 검증(회원 매핑과 무관하게, 데이터가 내적으로 앞뒤가 맞는지) ──────────

/** spec 하나의 모양이 앞뒤가 맞는지 검사한다. 문제를 찾으면 이름/점수 수준의 문구만 돌려준다. */
export function validateTournamentSpecShape(spec: Apr18TournamentSpec): string[] {
  const issues: string[] = []
  const keys = new Set<string>()
  for (const m of spec.matches) {
    if (keys.has(m.key)) issues.push(`중복된 경기 key: ${m.key}`)
    keys.add(m.key)
  }
  for (const m of spec.matches) {
    if (m.nextKey && !keys.has(m.nextKey)) {
      issues.push(`${m.key}의 nextKey(${m.nextKey})를 가진 경기가 없습니다.`)
    }
    if (m.resultType === 'bye') {
      const present = [m.playerA, m.playerB].filter((p): p is string => !!p)
      if (present.length !== 1) issues.push(`${m.key}(부전승)는 선수가 정확히 한 명이어야 합니다.`)
      if (present[0] && m.winner !== present[0]) issues.push(`${m.key}(부전승)의 승자가 그 한 명과 다릅니다.`)
      if (m.scoreA !== null || m.scoreB !== null) issues.push(`${m.key}(부전승)에 점수가 들어 있습니다.`)
    } else {
      if (!m.playerA || !m.playerB) issues.push(`${m.key}는 두 선수가 모두 있어야 합니다.`)
      if (m.winner !== m.playerA && m.winner !== m.playerB) {
        issues.push(`${m.key}의 승자(${m.winner})가 대진 선수와 일치하지 않습니다.`)
      }
      if (m.scoreA === null || m.scoreB === null) issues.push(`${m.key}에 점수가 없습니다.`)
    }
  }
  return issues
}

/** spec에 등장하는 모든 이름(참가자 목록에 없는 이름이 섞였는지 매핑 단계에서 같이 확인한다). */
export function namesUsedInSpec(spec: Apr18TournamentSpec): string[] {
  const names = new Set<string>()
  for (const m of spec.matches) {
    if (m.playerA) names.add(m.playerA)
    if (m.playerB) names.add(m.playerB)
  }
  return [...names]
}

// ── 회원 이름 → memberId 매핑 ──────────────────────────────────────────

export interface MemberMappingResult {
  ok: boolean
  mappedCount: number
  totalCount: number
  missingNames: string[]
  duplicateNames: string[]
  /** 내부 계산용. 화면에는 이 값을 그대로 출력하지 않는다(개수만 보여준다). */
  nameToId: Map<string, string>
}

/**
 * 이름 → memberId. 정확히 1명과 매핑되지 않으면(없음/동명이인) 실패로 표시한다 — 추측하지 않는다.
 * active 여부는 판정에 관여하지 않는다(과거 대회 당시 활동 회원이었는지는 이 함수의 책임이 아니다).
 */
export function mapParticipantNames(
  members: Pick<Member, 'id' | 'name'>[],
  names: string[],
): MemberMappingResult {
  const byName = new Map<string, string[]>()
  for (const m of members) {
    if (!byName.has(m.name)) byName.set(m.name, [])
    byName.get(m.name)!.push(m.id)
  }
  const missingNames: string[] = []
  const duplicateNames: string[] = []
  const nameToId = new Map<string, string>()
  const uniqueNames = [...new Set(names)]
  for (const name of uniqueNames) {
    const ids = byName.get(name) ?? []
    if (ids.length === 0) missingNames.push(name)
    else if (ids.length > 1) duplicateNames.push(name)
    else nameToId.set(name, ids[0])
  }
  return {
    ok: missingNames.length === 0 && duplicateNames.length === 0,
    mappedCount: nameToId.size,
    totalCount: uniqueNames.length,
    missingNames,
    duplicateNames,
    nameToId,
  }
}

// ── 운영 DB 중복 후보 검사(읽기 전용 판정 — 이 파일은 아무것도 쓰지 않는다) ──────────────

export interface DuplicateCheckResult {
  ok: boolean
  candidateCount: number
  details: string[]
}

/** 같은 날짜에 이미 저장된 경기가 있는지(모임 Session.games 기준). */
export function checkExistingGamesOnDate(sessions: Session[], date: string): DuplicateCheckResult {
  const onDate = sessions.filter((s) => s.date === date)
  const gameCount = onDate.reduce((sum, s) => sum + s.games.length, 0)
  return {
    ok: gameCount === 0,
    candidateCount: gameCount,
    details: gameCount > 0 ? [`${date}에 이미 저장된 경기가 ${gameCount}건 있습니다.`] : [],
  }
}

/** 같은 이름의 대회가 같은 날짜에 이미 있는지. */
export function checkExistingTournamentNames(
  tournaments: Pick<Tournament, 'name' | 'date'>[],
  date: string,
  names: string[],
): DuplicateCheckResult {
  const matches = tournaments.filter((t) => t.date === date && names.includes(t.name))
  return {
    ok: matches.length === 0,
    candidateCount: matches.length,
    details: matches.map((t) => `이미 존재하는 대회: "${t.name}" (${t.date})`),
  }
}

// ── TournamentMatch / TournamentParticipant / Game 생성(순수 계산, Firestore 미사용) ──────

function computeEndType(score: number, handicap: number): 'cleared' | 'time' {
  return score >= handicap ? 'cleared' : 'time'
}

/** spec의 경기 key를 실제 TournamentMatch.id로 바꾼다(대회별로 접두어를 달리해 충돌을 막는다). */
function toMatchId(idPrefix: string, key: string): string {
  return `${idPrefix}-${key}`
}

export interface BuiltBracket {
  participants: TournamentParticipant[]
  matches: TournamentMatch[]
}

/**
 * spec 하나(정기대회 또는 챌린전)를 실제 TournamentParticipant[]/TournamentMatch[]로 만든다.
 * 모든 경기를 이미 공식 확정(status:'official')된 상태로 만든다 — 과거 기록을 그대로 복원하는
 * 것이지, 지금부터 라이브로 진행할 대진이 아니기 때문이다.
 *
 * participantId는 memberId를 그대로 쓴다(createMissingParticipants가 이미 쓰는 관례와 동일).
 */
export function buildBracketFromSpec(
  spec: Apr18TournamentSpec,
  nameToId: Map<string, string>,
  handicapByName: Map<string, number>,
  idPrefix: string,
): BuiltBracket {
  const idOf = (name: string) => nameToId.get(name)!
  const hcapOf = (name: string) => handicapByName.get(name)!

  const names = namesUsedInSpec(spec)
  const participants: TournamentParticipant[] = names.map((name) => {
    const id = idOf(name)
    const handicap = hcapOf(name)
    return {
      id,
      memberId: id,
      displayNameSnapshot: name,
      baseHandicapSnapshot: handicap,
      tournamentHandicap: handicap,
      entryStatus: 'entered',
    }
  })

  const matches: TournamentMatch[] = spec.matches.map((m) => {
    const aId = m.playerA ? idOf(m.playerA) : null
    const bId = m.playerB ? idOf(m.playerB) : null
    const winnerId = idOf(m.winner)
    const loserId = m.resultType === 'bye' ? null : (winnerId === aId ? bId : aId)
    return {
      id: toMatchId(idPrefix, m.key),
      roundNumber: m.roundNumber,
      playerCountInRound: m.playerCountInRound,
      matchNumber: m.matchNumber,
      playerAParticipantId: aId,
      playerBParticipantId: bId,
      playerAMemberId: aId,
      playerBMemberId: bId,
      playerAHandicapSnapshot: m.playerA ? hcapOf(m.playerA) : null,
      playerBHandicapSnapshot: m.playerB ? hcapOf(m.playerB) : null,
      scoreA: m.scoreA,
      scoreB: m.scoreB,
      resultType: m.resultType,
      status: 'official',
      officialWinnerParticipantId: winnerId,
      officialLoserParticipantId: loserId,
      nextMatchId: m.nextKey ? toMatchId(idPrefix, m.nextKey) : null,
      nextSlot: m.nextSlot,
    }
  })

  return { participants, matches }
}

/** spec의 실제 경기(resultType==='normal')만 Game으로 만든다. 부전승은 절대 Game이 되지 않는다. */
export function buildGamesFromSpec(
  spec: Apr18TournamentSpec,
  nameToId: Map<string, string>,
  handicapByName: Map<string, number>,
  makeId: () => string,
): Game[] {
  const idOf = (name: string) => nameToId.get(name)!
  const hcapOf = (name: string) => handicapByName.get(name)!

  const games: Game[] = []
  let seq = 0
  for (const m of spec.matches) {
    if (m.resultType !== 'normal') continue
    if (!m.playerA || !m.playerB || m.scoreA === null || m.scoreB === null) continue
    const aId = idOf(m.playerA)
    const bId = idOf(m.playerB)
    const hA = hcapOf(m.playerA)
    const hB = hcapOf(m.playerB)
    const winnerId = m.winner === m.playerA ? aId : bId
    const winnerScore = m.winner === m.playerA ? m.scoreA : m.scoreB
    const winnerHcap = m.winner === m.playerA ? hA : hB
    games.push({
      id: makeId(),
      playerAId: aId,
      playerBId: bId,
      handicapA: hA,
      handicapB: hB,
      scoreA: m.scoreA,
      scoreB: m.scoreB,
      endType: computeEndType(winnerScore, winnerHcap),
      playedAt: `${spec.date}T${String(10 + (seq++ % 10)).padStart(2, '0')}:00:00.000Z`,
      winnerId,
    })
  }
  return games
}

// ── 전체 dry-run 계산 ──────────────────────────────────────────────────

export interface Apr18ImportPlan {
  ok: boolean
  issues: string[]
  mapping: { mappedCount: number; totalCount: number; missingNames: string[]; duplicateNames: string[] }
  regular: {
    tournamentCount: 1
    actualGameCount: number
    byeCount: number
    duplicateCheck: DuplicateCheckResult
  }
  challenger: {
    tournamentCount: 1
    actualGameCount: number
    byeCount: number
    duplicateCheck: DuplicateCheckResult
  }
  totalTournamentCount: number
  totalActualGameCount: number
  totalByeCount: number
  gameDuplicateCheck: DuplicateCheckResult
}

/**
 * 전체 dry-run. Firestore를 전혀 부르지 않는다 — 호출부(관리자 화면)가 이미 읽어 온
 * members/sessions/tournaments를 인자로 받아서 계산만 한다.
 */
export function buildApr18ImportPlan(
  spec: Apr18ImportSpec,
  context: {
    members: Pick<Member, 'id' | 'name'>[]
    existingSessions: Session[]
    existingTournaments: Pick<Tournament, 'name' | 'date'>[]
  },
): Apr18ImportPlan {
  const issues: string[] = [
    ...validateTournamentSpecShape(spec.regular),
    ...validateTournamentSpecShape(spec.challenger),
  ]

  const allNames = [...new Set([
    ...spec.participants.map((p) => p.name),
    ...namesUsedInSpec(spec.regular),
    ...namesUsedInSpec(spec.challenger),
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

  const regularGames = mapping.ok ? buildGamesFromSpec(spec.regular, mapping.nameToId, handicapByName, () => '') : []
  const challengerGames = mapping.ok ? buildGamesFromSpec(spec.challenger, mapping.nameToId, handicapByName, () => '') : []
  const regularByes = spec.regular.matches.filter((m) => m.resultType === 'bye').length
  const challengerByes = spec.challenger.matches.filter((m) => m.resultType === 'bye').length

  const regularDup = checkExistingTournamentNames(context.existingTournaments, spec.regular.date, [spec.regular.name])
  const challengerDup = checkExistingTournamentNames(context.existingTournaments, spec.challenger.date, [spec.challenger.name])
  const gameDup = checkExistingGamesOnDate(context.existingSessions, spec.regular.date)
  if (!regularDup.ok) issues.push(...regularDup.details)
  if (!challengerDup.ok) issues.push(...challengerDup.details)
  if (!gameDup.ok) issues.push(...gameDup.details)

  return {
    ok: issues.length === 0,
    issues,
    mapping: {
      mappedCount: mapping.mappedCount, totalCount: mapping.totalCount,
      missingNames: mapping.missingNames, duplicateNames: mapping.duplicateNames,
    },
    regular: { tournamentCount: 1, actualGameCount: regularGames.length, byeCount: regularByes, duplicateCheck: regularDup },
    challenger: { tournamentCount: 1, actualGameCount: challengerGames.length, byeCount: challengerByes, duplicateCheck: challengerDup },
    totalTournamentCount: 2,
    totalActualGameCount: regularGames.length + challengerGames.length,
    totalByeCount: regularByes + challengerByes,
    gameDuplicateCheck: gameDup,
  }
}

// ── 실제 적용(apply) 가능 여부 판정 ──────────────────────────────────────

export interface ApplyEligibility {
  eligible: boolean
  reasons: string[]
}

/**
 * "실제 적용" 버튼을 활성화해도 되는지 판정한다. 이번 2026-04-18 가져오기 전용으로
 * 목표 수치(대회 2개, 정기대회 14경기, 챌린전 9경기, 총 23경기, 부전진출 3건)를 그대로
 * 확인 조건에 박아 둔다 — 범용 import 도구가 아니라 이번 두 대회 전용이기 때문이다.
 *
 * isAdminAuthorized는 호출부가 Firebase 관리자 인증 상태(useAdminAuthStore.status ===
 * 'authorizedAdmin')를 확인해서 넘긴다 — 이 파일은 Firebase를 모르므로 판정 자체는 하지 않고
 * 이미 확인된 결과만 받는다.
 */
export function evaluateApplyEligibility(plan: Apr18ImportPlan, isAdminAuthorized: boolean): ApplyEligibility {
  const reasons: string[] = []
  if (!plan.ok) reasons.push('검증 미리보기를 통과하지 못했습니다.')
  if (plan.mapping.totalCount !== 14 || plan.mapping.mappedCount !== 14) reasons.push('회원 이름 매핑이 14/14가 아닙니다.')
  if (plan.mapping.missingNames.length > 0) reasons.push('누락된 회원이 있습니다.')
  if (plan.mapping.duplicateNames.length > 0) reasons.push('동명이인이 있습니다.')
  if (!plan.regular.duplicateCheck.ok) reasons.push('정기대회 이름이 이미 존재합니다.')
  if (!plan.challenger.duplicateCheck.ok) reasons.push('챌린전 이름이 이미 존재합니다.')
  if (!plan.gameDuplicateCheck.ok) reasons.push('같은 날짜에 이미 저장된 경기가 있습니다.')
  if (plan.totalTournamentCount !== 2) reasons.push('대회 수가 2개가 아닙니다.')
  if (plan.regular.actualGameCount !== 14) reasons.push('정기대회 실제 경기가 14건이 아닙니다.')
  if (plan.challenger.actualGameCount !== 9) reasons.push('챌린전 실제 경기가 9건이 아닙니다.')
  if (plan.totalActualGameCount !== 23) reasons.push('총 실제 경기가 23건이 아닙니다.')
  if (plan.totalByeCount !== 3) reasons.push('부전진출이 3건이 아닙니다.')
  if (!isAdminAuthorized) reasons.push('관리자 Firebase 인증이 확인되지 않았습니다.')
  return { eligible: reasons.length === 0, reasons }
}

// ── 실제 Firestore 문서 계산(순수 함수 — 아직 아무것도 쓰지 않는다) ────────────────────

export interface Apr18BuiltWrites {
  session: { id: string; date: string; attendeeIds: string[] }
  games: { sessionId: string; game: Game }[]
  tournaments: Tournament[]
  participants: { tournamentId: string; participant: TournamentParticipant }[]
  matches: { tournamentId: string; match: TournamentMatch }[]
}

function bracketSizeFor(participantCount: number): number {
  return Math.pow(2, Math.ceil(Math.log2(Math.max(participantCount, 1))))
}

/**
 * 실제로 Firestore에 쓸 문서들을 전부 계산한다. 이 함수 자체는 아무것도 쓰지 않는다 —
 * 결과를 하나의 writeBatch로 커밋하는 것은 호출부(Firebase를 아는 별도 파일)의 책임이다.
 *
 * 대회 2개는 이미 완전히 끝난 과거 기록이므로 라이브 진행(추첨→확정→승인) 단계를 거치지
 * 않고 바로 status:'finished'로 만든다 — 결과가 이미 확정된 사실이기 때문이다.
 */
export function buildApr18FirestoreWrites(
  spec: Apr18ImportSpec,
  nameToId: Map<string, string>,
  input: { adminUid: string; at: string; makeId: () => string },
): Apr18BuiltWrites {
  const handicapByName = new Map(spec.participants.map((p) => [p.name, p.handicap]))

  const regularBracket = buildBracketFromSpec(spec.regular, nameToId, handicapByName, 'R')
  const challengerBracket = buildBracketFromSpec(spec.challenger, nameToId, handicapByName, 'C')
  const regularGames = buildGamesFromSpec(spec.regular, nameToId, handicapByName, input.makeId)
  const challengerGames = buildGamesFromSpec(spec.challenger, nameToId, handicapByName, input.makeId)

  const regularPlacements = calculateFinalPlacements(regularBracket.matches)
  const challengerPlacements = calculateFinalPlacements(challengerBracket.matches)

  const regularTournamentId = input.makeId()
  const challengerTournamentId = input.makeId()

  const regularTournament: Tournament = {
    id: regularTournamentId,
    name: spec.regular.name,
    date: spec.regular.date,
    timeLimitMinutes: spec.regular.timeLimitMinutes,
    status: 'finished',
    participantCount: regularBracket.participants.length,
    bracketSize: bracketSizeFor(regularBracket.participants.length),
    createdAt: input.at,
    createdByAdminUid: input.adminUid,
    drawConfirmedAt: input.at,
    completedAt: input.at,
    championParticipantId: regularPlacements.championParticipantId,
    runnerUpParticipantId: regularPlacements.runnerUpParticipantId,
  }
  const challengerTournament: Tournament = {
    id: challengerTournamentId,
    name: spec.challenger.name,
    date: spec.challenger.date,
    timeLimitMinutes: spec.challenger.timeLimitMinutes,
    status: 'finished',
    participantCount: challengerBracket.participants.length,
    bracketSize: bracketSizeFor(challengerBracket.participants.length),
    createdAt: input.at,
    createdByAdminUid: input.adminUid,
    drawConfirmedAt: input.at,
    completedAt: input.at,
    championParticipantId: challengerPlacements.championParticipantId,
    runnerUpParticipantId: challengerPlacements.runnerUpParticipantId,
  }

  const sessionId = input.makeId()
  const attendeeIds = [...new Set([
    ...regularBracket.participants.map((p) => p.id),
    ...challengerBracket.participants.map((p) => p.id),
  ])]

  return {
    session: { id: sessionId, date: spec.regular.date, attendeeIds },
    games: [
      ...regularGames.map((game) => ({ sessionId, game })),
      ...challengerGames.map((game) => ({ sessionId, game })),
    ],
    tournaments: [regularTournament, challengerTournament],
    participants: [
      ...regularBracket.participants.map((participant) => ({ tournamentId: regularTournamentId, participant })),
      ...challengerBracket.participants.map((participant) => ({ tournamentId: challengerTournamentId, participant })),
    ],
    matches: [
      ...regularBracket.matches.map((match) => ({ tournamentId: regularTournamentId, match })),
      ...challengerBracket.matches.map((match) => ({ tournamentId: challengerTournamentId, match })),
    ],
  }
}

// ── 적용 오케스트레이션(의존성 주입 — 이 함수도 Firebase를 모른다) ──────────────────────

export interface Apr18ApplyDeps {
  /** admins/{uid} 문서를 다시 읽어 관리자 여부를 확인한다. */
  fetchAdminDoc: (uid: string) => Promise<{ active: boolean } | null>
  /** 회원·모임(경기 포함) 최신 상태를 다시 읽는다(적용 직전 중복 재검사용). */
  loadState: () => Promise<{ members: Pick<Member, 'id' | 'name'>[]; sessions: Session[] }>
  /** 대회 목록을 다시 읽는다(적용 직전 중복 재검사용). */
  fetchTournaments: () => Promise<Pick<Tournament, 'name' | 'date'>[]>
  /** 계산된 문서 전체를 하나의 원자적 쓰기로 커밋한다. */
  commitBatch: (writes: Apr18BuiltWrites) => Promise<void>
  makeId: () => string
  now: () => string
}

export interface Apr18ApplyResult {
  ok: boolean
  message: string
  summary?: { tournaments: number; actualGames: number; byeAdvances: number }
}

/**
 * 실제 적용. Firebase를 전혀 import하지 않는다 — 필요한 모든 I/O는 deps로 주입받는다.
 * 그래서 이 함수는 mock/fake deps만으로 완전히 단위 테스트할 수 있고, 실제 Firestore
 * 연결 코드는 아주 얇은 별도 파일(tournamentApr18ApplyFirestore.ts)에만 있다.
 *
 * 순서:
 *   1. 관리자 인증을 서버 문서 기준으로 다시 확인한다(세션에 남은 상태를 신뢰하지 않는다).
 *   2. 회원·모임·대회를 다시 읽어 dry-run을 한 번 더 계산한다 — 미리보기 이후 운영 DB
 *      상태가 바뀌었을 수 있기 때문이다. 조건을 하나라도 만족하지 못하면 아무것도 쓰지
 *      않고 중단한다.
 *   3. 통과했을 때만 실제 쓸 문서를 계산해 commitBatch 한 번으로 전부 커밋한다(원자적).
 */
export async function applyApr18Import(
  spec: Apr18ImportSpec,
  input: { adminUid: string },
  deps: Apr18ApplyDeps,
): Promise<Apr18ApplyResult> {
  const adminDoc = await deps.fetchAdminDoc(input.adminUid)
  if (!adminDoc || adminDoc.active !== true) {
    return { ok: false, message: '관리자 권한을 다시 확인하지 못했습니다. 다시 로그인해 주세요.' }
  }

  const [state, existingTournaments] = await Promise.all([deps.loadState(), deps.fetchTournaments()])
  const plan = buildApr18ImportPlan(spec, {
    members: state.members, existingSessions: state.sessions, existingTournaments,
  })
  const eligibility = evaluateApplyEligibility(plan, true)
  if (!eligibility.eligible) {
    return { ok: false, message: `적용 직전 재검사에서 문제를 발견해 중단했습니다: ${eligibility.reasons.join(' / ')}` }
  }

  const allNames = [...new Set([
    ...spec.participants.map((p) => p.name),
    ...namesUsedInSpec(spec.regular),
    ...namesUsedInSpec(spec.challenger),
  ])]
  const mapping = mapParticipantNames(state.members, allNames)
  if (!mapping.ok) {
    return { ok: false, message: '적용 직전 재검사에서 회원 매핑 문제를 발견해 중단했습니다.' }
  }

  const writes = buildApr18FirestoreWrites(spec, mapping.nameToId, {
    adminUid: input.adminUid, at: deps.now(), makeId: deps.makeId,
  })

  try {
    await deps.commitBatch(writes)
  } catch {
    return { ok: false, message: '저장 중 오류가 발생했습니다. 운영 데이터가 바뀌지 않았을 수 있으니, 다시 검증 미리보기부터 확인한 뒤 재시도해 주세요.' }
  }

  return {
    ok: true,
    message: '적용을 완료했습니다.',
    summary: {
      tournaments: writes.tournaments.length,
      actualGames: writes.games.length,
      byeAdvances: plan.totalByeCount,
    },
  }
}

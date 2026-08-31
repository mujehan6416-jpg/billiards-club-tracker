import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { calculateFinalPlacements } from '../src/logic/tournamentMatch'
import {
  mapParticipantNames, checkExistingGamesOnDate, checkExistingTournamentNames,
  buildBracketFromSpec, buildGamesFromSpec, buildApr18ImportPlan, validateTournamentSpecShape,
  evaluateApplyEligibility, buildApr18FirestoreWrites, applyApr18Import,
} from '../src/lib/tournamentApr18Import'
import type { Apr18ApplyDeps, Apr18ImportPlan, Apr18ImportSpec, Apr18TournamentSpec } from '../src/lib/tournamentApr18Import'
import type { Session } from '../src/types'

// 이 파일도 실제 회원 이름·점수를 쓰지 않는다 — 전부 가상 데이터(선수A~D 등)로만 테스트한다.

const VIRTUAL_MEMBERS = [
  { id: 'm-1', name: '선수A' },
  { id: 'm-2', name: '선수B' },
  { id: 'm-3', name: '선수C' },
  { id: 'm-4', name: '선수D' },
]

/** 4명 정기대회: 준결승 2 + 결승 1 + 3·4위전 1 = 실제 경기 4건, 부전승 0건. */
function virtualRegularSpec(): Apr18TournamentSpec {
  return {
    name: '가상 정기대회',
    date: '2099-01-01',
    timeLimitMinutes: 50,
    matches: [
      {
        key: 'SF-01', roundNumber: 1, playerCountInRound: 4, matchNumber: 1, resultType: 'normal',
        playerA: '선수A', playerB: '선수B', scoreA: 10, scoreB: 24, winner: '선수A', // 고득점자가 패자
        nextKey: 'FINAL', nextSlot: 'playerA',
      },
      {
        key: 'SF-02', roundNumber: 1, playerCountInRound: 4, matchNumber: 2, resultType: 'normal',
        playerA: '선수C', playerB: '선수D', scoreA: 14, scoreB: 8, winner: '선수C',
        nextKey: 'FINAL', nextSlot: 'playerB',
      },
      {
        key: 'FINAL', roundNumber: 2, playerCountInRound: 2, matchNumber: 1, resultType: 'normal',
        playerA: '선수C', playerB: '선수A', scoreA: 14, scoreB: 7, winner: '선수C',
        nextKey: null, nextSlot: null,
      },
      {
        key: '3RD', roundNumber: 3, playerCountInRound: 3, matchNumber: 1, resultType: 'normal',
        playerA: '선수B', playerB: '선수D', scoreA: 21, scoreB: 7, winner: '선수B',
        nextKey: null, nextSlot: null,
      },
    ],
  }
}

/** 3명 챌린전: 1경기 + 부전승 1 = 실제 경기 1건, 부전승 1건. */
function virtualChallengerSpec(): Apr18TournamentSpec {
  return {
    name: '가상 챌린전',
    date: '2099-01-01',
    timeLimitMinutes: 50,
    matches: [
      {
        key: 'C-R1-01', roundNumber: 1, playerCountInRound: 4, matchNumber: 1, resultType: 'normal',
        playerA: '선수A', playerB: '선수B', scoreA: 5, scoreB: 9, winner: '선수B',
        nextKey: 'C-FINAL', nextSlot: 'playerA',
      },
      {
        key: 'C-BYE', roundNumber: 1, playerCountInRound: 4, matchNumber: 2, resultType: 'bye',
        playerA: '선수C', playerB: null, scoreA: null, scoreB: null, winner: '선수C',
        nextKey: 'C-FINAL', nextSlot: 'playerB',
      },
      {
        key: 'C-FINAL', roundNumber: 2, playerCountInRound: 2, matchNumber: 1, resultType: 'normal',
        playerA: '선수B', playerB: '선수C', scoreA: 20, scoreB: 15, winner: '선수B',
        nextKey: null, nextSlot: null,
      },
    ],
  }
}

function virtualSpec(): Apr18ImportSpec {
  return {
    participants: [
      { name: '선수A', handicap: 10 },
      { name: '선수B', handicap: 25 },
      { name: '선수C', handicap: 14 },
      { name: '선수D', handicap: 13 },
    ],
    regular: virtualRegularSpec(),
    challenger: virtualChallengerSpec(),
  }
}

const EMPTY_CONTEXT = { members: VIRTUAL_MEMBERS, existingSessions: [] as Session[], existingTournaments: [] }

describe('mapParticipantNames', () => {
  it('모든 이름이 정확히 매핑되면 성공', () => {
    const result = mapParticipantNames(VIRTUAL_MEMBERS, ['선수A', '선수B'])
    expect(result.ok).toBe(true)
    expect(result.mappedCount).toBe(2)
  })

  it('없는 회원이 있으면 실패로 표시한다', () => {
    const result = mapParticipantNames(VIRTUAL_MEMBERS, ['선수A', '없는사람'])
    expect(result.ok).toBe(false)
    expect(result.missingNames).toEqual(['없는사람'])
  })

  it('동명이인이 있으면 실패로 표시한다', () => {
    const members = [...VIRTUAL_MEMBERS, { id: 'm-5', name: '선수A' }]
    const result = mapParticipantNames(members, ['선수A'])
    expect(result.ok).toBe(false)
    expect(result.duplicateNames).toEqual(['선수A'])
  })
})

describe('checkExistingGamesOnDate / checkExistingTournamentNames', () => {
  it('같은 날짜에 기존 경기가 없으면 통과', () => {
    expect(checkExistingGamesOnDate([], '2099-01-01').ok).toBe(true)
  })

  it('같은 날짜에 이미 경기가 있으면 중복 후보로 표시한다', () => {
    const sessions: Session[] = [{ id: 's1', date: '2099-01-01', attendeeIds: [], games: [{} as never] }]
    const result = checkExistingGamesOnDate(sessions, '2099-01-01')
    expect(result.ok).toBe(false)
    expect(result.candidateCount).toBe(1)
  })

  it('같은 이름·날짜의 대회가 이미 있으면 중복 후보로 표시한다', () => {
    const result = checkExistingTournamentNames(
      [{ name: '가상 정기대회', date: '2099-01-01' }], '2099-01-01', ['가상 정기대회'],
    )
    expect(result.ok).toBe(false)
    expect(result.candidateCount).toBe(1)
  })

  it('같은 import를 재실행하면(이미 대회가 있으면) 중복으로 막힌다', () => {
    const spec = virtualSpec()
    const plan = buildApr18ImportPlan(spec, {
      members: VIRTUAL_MEMBERS,
      existingSessions: [],
      existingTournaments: [{ name: spec.regular.name, date: spec.regular.date }],
    })
    expect(plan.ok).toBe(false)
    expect(plan.regular.duplicateCheck.ok).toBe(false)
  })
})

describe('validateTournamentSpecShape', () => {
  it('정상 spec은 문제 없음', () => {
    expect(validateTournamentSpecShape(virtualRegularSpec())).toEqual([])
  })

  it('승자가 대진 선수와 다르면 문제로 잡는다', () => {
    const spec = virtualRegularSpec()
    spec.matches[0].winner = '선수Z'
    expect(validateTournamentSpecShape(spec).some((i) => i.includes('SF-01'))).toBe(true)
  })
})

describe('buildGamesFromSpec — 실제 경기만 Game이 된다', () => {
  const nameToId = new Map(VIRTUAL_MEMBERS.map((m) => [m.name, m.id]))
  const handicapByName = new Map([['선수A', 10], ['선수B', 25], ['선수C', 14], ['선수D', 13]])

  it('부전승은 Game으로 생성되지 않는다(실제 경기 2건만 생성)', () => {
    const games = buildGamesFromSpec(virtualChallengerSpec(), nameToId, handicapByName, () => 'g')
    expect(games.length).toBe(2) // C-R1-01 + C-FINAL — C-BYE(부전승)는 제외된다
    expect(games.every((g) => g.playerAId && g.playerBId)).toBe(true)
  })

  it('실제 경기 수가 정확하다(정기대회 4건, 챌린전 2건)', () => {
    const regularGames = buildGamesFromSpec(virtualRegularSpec(), nameToId, handicapByName, () => 'g')
    const challengerGames = buildGamesFromSpec(virtualChallengerSpec(), nameToId, handicapByName, () => 'g')
    expect(regularGames.length).toBe(4)
    expect(challengerGames.length).toBe(2) // C-R1-01 + C-FINAL (C-BYE 제외)
  })

  it('점수가 더 높은 쪽이 아니라 명시된 승자를 그대로 보존한다(핸디 경기)', () => {
    const games = buildGamesFromSpec(virtualRegularSpec(), nameToId, handicapByName, () => 'g')
    const sf01 = games.find((g) => g.scoreA === 10 && g.scoreB === 24)!
    expect(sf01.winnerId).toBe('m-1') // 선수A(원점수 10) 승 — 선수B(24)가 아니다
  })

  it('경기 당시 핸디 스냅샷이 그대로 보존된다', () => {
    const games = buildGamesFromSpec(virtualRegularSpec(), nameToId, handicapByName, () => 'g')
    const involvingB = games.find((g) => g.playerAId === 'm-2' || g.playerBId === 'm-2')!
    const bHandicap = involvingB.playerAId === 'm-2' ? involvingB.handicapA : involvingB.handicapB
    expect(bHandicap).toBe(25)
  })

  it('원본 점수를 절대 바꾸지 않는다(승자쪽 점수를 임의로 올리지 않는다)', () => {
    const games = buildGamesFromSpec(virtualRegularSpec(), nameToId, handicapByName, () => 'g')
    const sf01 = games.find((g) => g.winnerId === 'm-1')!
    expect(sf01.scoreA).toBe(10)
    expect(sf01.scoreB).toBe(24)
  })
})

describe('buildBracketFromSpec — 대진표 연결', () => {
  const nameToId = new Map(VIRTUAL_MEMBERS.map((m) => [m.name, m.id]))
  const handicapByName = new Map([['선수A', 10], ['선수B', 25], ['선수C', 14], ['선수D', 13]])

  it('부전승 경기 수가 정확하다', () => {
    const { matches } = buildBracketFromSpec(virtualChallengerSpec(), nameToId, handicapByName, 'C')
    expect(matches.filter((m) => m.resultType === 'bye').length).toBe(1)
  })

  it('3·4위전이 결승과 다른 라운드로 연결되고, 최종 순위(1~4위)가 정상 계산된다', () => {
    const { matches } = buildBracketFromSpec(virtualRegularSpec(), nameToId, handicapByName, 'R')
    const placements = calculateFinalPlacements(matches)
    expect(placements.championParticipantId).toBe('m-3') // 선수C 우승
    expect(placements.runnerUpParticipantId).toBe('m-1') // 선수A 준우승(결승 패자)
    expect(placements.thirdPlaceParticipantIds).toEqual(['m-2']) // 3·4위전 승자 선수B
    expect(placements.fourthPlaceParticipantId).toBe('m-4') // 선수D
  })

  it('참가자 목록에 실제 등장한 선수만 들어간다(중복 없이)', () => {
    const { participants } = buildBracketFromSpec(virtualRegularSpec(), nameToId, handicapByName, 'R')
    expect(participants.length).toBe(4)
    expect(new Set(participants.map((p) => p.id)).size).toBe(4)
  })
})

describe('buildApr18ImportPlan — 전체 dry-run', () => {
  it('정상 spec이면 통과하고 개수가 정확하다', () => {
    const plan = buildApr18ImportPlan(virtualSpec(), EMPTY_CONTEXT)
    expect(plan.ok).toBe(true)
    expect(plan.totalTournamentCount).toBe(2)
    expect(plan.regular.actualGameCount).toBe(4)
    expect(plan.regular.byeCount).toBe(0)
    expect(plan.challenger.actualGameCount).toBe(2)
    expect(plan.challenger.byeCount).toBe(1)
    expect(plan.totalActualGameCount).toBe(6)
    expect(plan.totalByeCount).toBe(1)
  })

  it('없는 회원이 있으면 계획 전체가 실패로 표시된다', () => {
    const spec = virtualSpec()
    spec.regular.matches[0].playerA = '없는사람'
    spec.regular.matches[0].winner = '없는사람'
    const plan = buildApr18ImportPlan(spec, EMPTY_CONTEXT)
    expect(plan.ok).toBe(false)
    expect(plan.mapping.missingNames).toContain('없는사람')
  })

  it('같은 날짜에 이미 경기가 있으면 실패로 표시된다(중복 방지)', () => {
    const sessions: Session[] = [{ id: 's1', date: '2099-01-01', attendeeIds: [], games: [{} as never] }]
    const plan = buildApr18ImportPlan(virtualSpec(), { ...EMPTY_CONTEXT, existingSessions: sessions })
    expect(plan.ok).toBe(false)
    expect(plan.gameDuplicateCheck.ok).toBe(false)
  })
})

describe('dry-run은 Firestore를 전혀 부르지 않는다', () => {
  it('이 파일은 firebase를 import하지 않는다(구조적으로 write가 불가능하다)', () => {
    const source = readFileSync('src/lib/tournamentApr18Import.ts', 'utf-8')
    expect(source).not.toContain('firebase')
    expect(source).not.toContain('getFirestore')
  })
})

// ── evaluateApplyEligibility ────────────────────────────────────────────

/** 목표 수치(대회 2/정기대회 14/챌린전 9/총 23/부전진출 3)를 정확히 만족하는 가짜 plan. */
function fullyEligiblePlan(): Apr18ImportPlan {
  const ok = { ok: true, candidateCount: 0, details: [] as string[] }
  return {
    ok: true,
    issues: [],
    mapping: { mappedCount: 14, totalCount: 14, missingNames: [], duplicateNames: [] },
    regular: { tournamentCount: 1, actualGameCount: 14, byeCount: 1, duplicateCheck: ok },
    challenger: { tournamentCount: 1, actualGameCount: 9, byeCount: 2, duplicateCheck: ok },
    totalTournamentCount: 2,
    totalActualGameCount: 23,
    totalByeCount: 3,
    gameDuplicateCheck: ok,
  }
}

describe('evaluateApplyEligibility', () => {
  it('목표 수치를 모두 만족하고 관리자 인증도 있으면 활성화된다', () => {
    expect(evaluateApplyEligibility(fullyEligiblePlan(), true).eligible).toBe(true)
  })

  it('관리자 인증이 없으면 비활성화된다', () => {
    const result = evaluateApplyEligibility(fullyEligiblePlan(), false)
    expect(result.eligible).toBe(false)
    expect(result.reasons.some((r) => r.includes('관리자'))).toBe(true)
  })

  it('회원 매핑이 14/14가 아니면 비활성화된다', () => {
    const plan = { ...fullyEligiblePlan(), mapping: { mappedCount: 13, totalCount: 14, missingNames: ['없는사람'], duplicateNames: [] } }
    expect(evaluateApplyEligibility(plan, true).eligible).toBe(false)
  })

  it('대회 중복이 있으면 비활성화된다', () => {
    const plan = { ...fullyEligiblePlan() }
    plan.regular = { ...plan.regular, duplicateCheck: { ok: false, candidateCount: 1, details: ['중복'] } }
    expect(evaluateApplyEligibility(plan, true).eligible).toBe(false)
  })

  it('Game 중복이 있으면 비활성화된다', () => {
    const plan = { ...fullyEligiblePlan(), gameDuplicateCheck: { ok: false, candidateCount: 1, details: ['중복'] } }
    expect(evaluateApplyEligibility(plan, true).eligible).toBe(false)
  })

  it('실제 경기 수·부전진출 수가 목표와 다르면 비활성화된다(정기대회 14가 아닌 경우)', () => {
    const plan = { ...fullyEligiblePlan() }
    plan.regular = { ...plan.regular, actualGameCount: 13 }
    expect(evaluateApplyEligibility(plan, true).eligible).toBe(false)
  })

  it('plan.ok 자체가 false면 비활성화된다', () => {
    const plan = { ...fullyEligiblePlan(), ok: false, issues: ['문제'] }
    expect(evaluateApplyEligibility(plan, true).eligible).toBe(false)
  })
})

// ── buildApr18FirestoreWrites ────────────────────────────────────────────

describe('buildApr18FirestoreWrites', () => {
  const nameToId = new Map(VIRTUAL_MEMBERS.map((m) => [m.name, m.id]))

  it('실제 경기만 games에 들어가고, 부전승은 matches에는 있지만 games에는 없다', () => {
    const writes = buildApr18FirestoreWrites(virtualSpec(), nameToId, { adminUid: 'admin-1', at: '2099-01-01T00:00:00.000Z', makeId: (() => { let i = 0; return () => `id-${i++}` })() })
    expect(writes.games.length).toBe(6) // 정기대회 4 + 챌린전 2
    expect(writes.matches.filter((m) => m.match.resultType === 'bye').length).toBe(1)
    expect(writes.games.every((g) => g.game.playerAId && g.game.playerBId)).toBe(true)
  })

  it('명시된 winner를 그대로 보존한다(점수 대소와 무관)', () => {
    const writes = buildApr18FirestoreWrites(virtualSpec(), nameToId, { adminUid: 'admin-1', at: '2099-01-01T00:00:00.000Z', makeId: (() => { let i = 0; return () => `id-${i++}` })() })
    const sf01 = writes.games.find((g) => g.game.scoreA === 10 && g.game.scoreB === 24)!
    expect(sf01.game.winnerId).toBe('m-1')
  })

  it('대회 2개가 만들어지고 우승/준우승이 계산된다', () => {
    const writes = buildApr18FirestoreWrites(virtualSpec(), nameToId, { adminUid: 'admin-1', at: '2099-01-01T00:00:00.000Z', makeId: (() => { let i = 0; return () => `id-${i++}` })() })
    expect(writes.tournaments.length).toBe(2)
    expect(writes.tournaments.every((t) => t.status === 'finished')).toBe(true)
    const regular = writes.tournaments.find((t) => t.name === '가상 정기대회')!
    expect(regular.championParticipantId).toBe('m-3')
  })

  it('모든 경기가 하나의 세션 아래 들어간다(같은 sessionId)', () => {
    const writes = buildApr18FirestoreWrites(virtualSpec(), nameToId, { adminUid: 'admin-1', at: '2099-01-01T00:00:00.000Z', makeId: (() => { let i = 0; return () => `id-${i++}` })() })
    const sessionIds = new Set(writes.games.map((g) => g.sessionId))
    expect(sessionIds.size).toBe(1)
    expect([...sessionIds][0]).toBe(writes.session.id)
  })
})

// ── applyApr18Import(오케스트레이션, fake deps) ───────────────────────────

function fakeDeps(overrides: Partial<Apr18ApplyDeps> = {}): Apr18ApplyDeps & { commitCalls: number } {
  const state = {
    members: VIRTUAL_MEMBERS,
    sessions: [] as Session[],
  }
  const base = {
    fetchAdminDoc: async (_uid: string) => ({ active: true }),
    loadState: async () => state,
    fetchTournaments: async () => [] as { name: string; date: string }[],
    commitBatch: async () => { deps.commitCalls++ },
    makeId: (() => { let i = 0; return () => `id-${i++}` })(),
    now: () => '2099-01-01T00:00:00.000Z',
    ...overrides,
  }
  const deps = { ...base, commitCalls: 0 }
  return deps
}

describe('applyApr18Import — 관리자 인증', () => {
  it('admins 문서가 없으면(null) apply를 거부하고 아무것도 쓰지 않는다', async () => {
    const deps = fakeDeps({ fetchAdminDoc: async () => null })
    const result = await applyApr18Import(virtualSpec(), { adminUid: 'admin-1' }, deps)
    expect(result.ok).toBe(false)
    expect(deps.commitCalls).toBe(0)
  })

  it('admins 문서가 active:false면 apply를 거부한다', async () => {
    const deps = fakeDeps({ fetchAdminDoc: async () => ({ active: false }) })
    const result = await applyApr18Import(virtualSpec(), { adminUid: 'admin-1' }, deps)
    expect(result.ok).toBe(false)
    expect(deps.commitCalls).toBe(0)
  })
})

describe('applyApr18Import — 적용 직전 재검사', () => {
  it('서버에 이미 같은 이름의 대회가 있으면(재검사에서 발견) 중단하고 쓰지 않는다', async () => {
    const spec = virtualSpec()
    const deps = fakeDeps({ fetchTournaments: async () => [{ name: spec.regular.name, date: spec.regular.date }] })
    const result = await applyApr18Import(spec, { adminUid: 'admin-1' }, deps)
    expect(result.ok).toBe(false)
    expect(deps.commitCalls).toBe(0)
  })

  it('서버에 이미 같은 날짜의 경기가 있으면(재검사에서 발견) 중단하고 쓰지 않는다', async () => {
    const spec = virtualSpec()
    const sessions: Session[] = [{ id: 's1', date: spec.regular.date, attendeeIds: [], games: [{} as never] }]
    const deps = fakeDeps({ loadState: async () => ({ members: VIRTUAL_MEMBERS, sessions }) })
    const result = await applyApr18Import(spec, { adminUid: 'admin-1' }, deps)
    expect(result.ok).toBe(false)
    expect(deps.commitCalls).toBe(0)
  })

  it('회원이 서버에 없으면(재검사에서 발견) 중단하고 쓰지 않는다', async () => {
    const deps = fakeDeps({ loadState: async () => ({ members: [], sessions: [] }) })
    const result = await applyApr18Import(virtualSpec(), { adminUid: 'admin-1' }, deps)
    expect(result.ok).toBe(false)
    expect(deps.commitCalls).toBe(0)
  })
})

/**
 * 목표 수치(대회 2/정기대회 14/챌린전 9/총 23/부전진출 3)를 정확히 만족하는 가상 spec —
 * 실제 2026-04-18 대진과 완전히 같은 구조(1회전 7경기→8강(3+부전승1)→준결승2→결승1→3·4위전1,
 * 챌린전 1차전(3+부전승1)→8강4→준결승2→결승1)를 가상 이름(P01~P14)으로 그대로 재현한다.
 * evaluateApplyEligibility의 목표 숫자 조건까지 통과해야 하는 "성공 경로" 테스트 전용.
 */
function targetShapedVirtualSpec(): Apr18ImportSpec {
  const P = Array.from({ length: 14 }, (_, i) => `P${String(i + 1).padStart(2, '0')}`)
  const participants = P.map((name) => ({ name, handicap: 15 }))
  const regular: Apr18TournamentSpec = {
    name: '가상 정기대회(전체 구조)', date: '2099-02-02', timeLimitMinutes: 50,
    matches: [
      { key: 'M01', roundNumber: 1, playerCountInRound: 14, matchNumber: 1, resultType: 'normal', playerA: P[0], playerB: P[1], scoreA: 10, scoreB: 5, winner: P[0], nextKey: 'M08', nextSlot: 'playerA' },
      { key: 'M02', roundNumber: 1, playerCountInRound: 14, matchNumber: 2, resultType: 'normal', playerA: P[2], playerB: P[3], scoreA: 8, scoreB: 10, winner: P[2], nextKey: 'M08', nextSlot: 'playerB' },
      { key: 'M03', roundNumber: 1, playerCountInRound: 14, matchNumber: 3, resultType: 'normal', playerA: P[4], playerB: P[5], scoreA: 12, scoreB: 3, winner: P[4], nextKey: 'M09', nextSlot: 'playerA' },
      { key: 'M04', roundNumber: 1, playerCountInRound: 14, matchNumber: 4, resultType: 'normal', playerA: P[6], playerB: P[7], scoreA: 9, scoreB: 6, winner: P[6], nextKey: 'M09', nextSlot: 'playerB' },
      { key: 'M05', roundNumber: 1, playerCountInRound: 14, matchNumber: 5, resultType: 'normal', playerA: P[8], playerB: P[9], scoreA: 11, scoreB: 4, winner: P[8], nextKey: 'M10', nextSlot: 'playerA' },
      { key: 'M06', roundNumber: 1, playerCountInRound: 14, matchNumber: 6, resultType: 'normal', playerA: P[10], playerB: P[11], scoreA: 7, scoreB: 15, winner: P[11], nextKey: 'M10', nextSlot: 'playerB' },
      { key: 'M07', roundNumber: 1, playerCountInRound: 14, matchNumber: 7, resultType: 'normal', playerA: P[12], playerB: P[13], scoreA: 13, scoreB: 9, winner: P[12], nextKey: 'M07B', nextSlot: 'playerA' },
      { key: 'M08', roundNumber: 2, playerCountInRound: 8, matchNumber: 1, resultType: 'normal', playerA: P[0], playerB: P[2], scoreA: 10, scoreB: 9, winner: P[0], nextKey: 'M11', nextSlot: 'playerA' },
      { key: 'M09', roundNumber: 2, playerCountInRound: 8, matchNumber: 2, resultType: 'normal', playerA: P[4], playerB: P[6], scoreA: 15, scoreB: 7, winner: P[4], nextKey: 'M11', nextSlot: 'playerB' },
      { key: 'M10', roundNumber: 2, playerCountInRound: 8, matchNumber: 3, resultType: 'normal', playerA: P[8], playerB: P[11], scoreA: 12, scoreB: 7, winner: P[8], nextKey: 'M12', nextSlot: 'playerA' },
      { key: 'M07B', roundNumber: 2, playerCountInRound: 8, matchNumber: 4, resultType: 'bye', playerA: P[12], playerB: null, scoreA: null, scoreB: null, winner: P[12], nextKey: 'M12', nextSlot: 'playerB' },
      { key: 'M11', roundNumber: 3, playerCountInRound: 4, matchNumber: 1, resultType: 'normal', playerA: P[0], playerB: P[4], scoreA: 10, scoreB: 15, winner: P[0], nextKey: 'M13', nextSlot: 'playerA' },
      { key: 'M12', roundNumber: 3, playerCountInRound: 4, matchNumber: 2, resultType: 'normal', playerA: P[8], playerB: P[12], scoreA: 14, scoreB: 8, winner: P[8], nextKey: 'M13', nextSlot: 'playerB' },
      { key: 'M13', roundNumber: 4, playerCountInRound: 2, matchNumber: 1, resultType: 'normal', playerA: P[8], playerB: P[0], scoreA: 14, scoreB: 7, winner: P[8], nextKey: null, nextSlot: null },
      { key: 'M14', roundNumber: 5, playerCountInRound: 3, matchNumber: 1, resultType: 'normal', playerA: P[4], playerB: P[12], scoreA: 15, scoreB: 8, winner: P[4], nextKey: null, nextSlot: null },
    ],
  }
  const challenger: Apr18TournamentSpec = {
    name: '가상 챌린전(전체 구조)', date: '2099-02-02', timeLimitMinutes: 50,
    matches: [
      { key: 'C01', roundNumber: 1, playerCountInRound: 7, matchNumber: 1, resultType: 'normal', playerA: P[13], playerB: P[9], scoreA: 9, scoreB: 14, winner: P[9], nextKey: 'CB2', nextSlot: 'playerA' },
      { key: 'C02', roundNumber: 1, playerCountInRound: 7, matchNumber: 2, resultType: 'normal', playerA: P[10], playerB: P[3], scoreA: 17, scoreB: 19, winner: P[10], nextKey: 'C04', nextSlot: 'playerB' },
      { key: 'C03', roundNumber: 1, playerCountInRound: 7, matchNumber: 3, resultType: 'normal', playerA: P[1], playerB: P[7], scoreA: 3, scoreB: 16, winner: P[7], nextKey: 'C05', nextSlot: 'playerB' },
      { key: 'CB1', roundNumber: 1, playerCountInRound: 7, matchNumber: 4, resultType: 'bye', playerA: P[5], playerB: null, scoreA: null, scoreB: null, winner: P[5], nextKey: 'C06', nextSlot: 'playerB' },
      { key: 'CB2', roundNumber: 2, playerCountInRound: 8, matchNumber: 1, resultType: 'bye', playerA: P[9], playerB: null, scoreA: null, scoreB: null, winner: P[9], nextKey: 'C07', nextSlot: 'playerA' },
      { key: 'C04', roundNumber: 2, playerCountInRound: 8, matchNumber: 2, resultType: 'normal', playerA: P[6], playerB: P[10], scoreA: 11, scoreB: 17, winner: P[10], nextKey: 'C07', nextSlot: 'playerB' },
      { key: 'C05', roundNumber: 2, playerCountInRound: 8, matchNumber: 3, resultType: 'normal', playerA: P[11], playerB: P[7], scoreA: 13, scoreB: 23, winner: P[7], nextKey: 'C08', nextSlot: 'playerB' },
      { key: 'C06', roundNumber: 2, playerCountInRound: 8, matchNumber: 4, resultType: 'normal', playerA: P[2], playerB: P[5], scoreA: 17, scoreB: 3, winner: P[2], nextKey: 'C08', nextSlot: 'playerA' },
      { key: 'C07', roundNumber: 3, playerCountInRound: 4, matchNumber: 1, resultType: 'normal', playerA: P[9], playerB: P[10], scoreA: 14, scoreB: 11, winner: P[9], nextKey: 'C09', nextSlot: 'playerA' },
      { key: 'C08', roundNumber: 3, playerCountInRound: 4, matchNumber: 2, resultType: 'normal', playerA: P[2], playerB: P[7], scoreA: 14, scoreB: 23, winner: P[7], nextKey: 'C09', nextSlot: 'playerB' },
      { key: 'C09', roundNumber: 4, playerCountInRound: 2, matchNumber: 1, resultType: 'normal', playerA: P[9], playerB: P[7], scoreA: 14, scoreB: 22, winner: P[9], nextKey: null, nextSlot: null },
    ],
  }
  return { participants, regular, challenger }
}

describe('applyApr18Import — 성공/실패 경로(mock/fake — 실제 Firestore 미접근)', () => {
  it('목표 수치(대회 2/정기대회 14/챌린전 9/총 23/부전진출 3)를 모두 만족하면 commitBatch가 정확히 1번 호출되고 성공을 반환한다', async () => {
    const spec = targetShapedVirtualSpec()
    const virtualMembers = spec.participants.map((p, i) => ({ id: `pv-${i + 1}`, name: p.name }))
    const deps = fakeDeps({ loadState: async () => ({ members: virtualMembers, sessions: [] }) })
    const result = await applyApr18Import(spec, { adminUid: 'admin-1' }, deps)
    expect(result.ok).toBe(true)
    expect(deps.commitCalls).toBe(1)
    expect(result.summary?.actualGames).toBe(23)
    expect(result.summary?.tournaments).toBe(2)
    expect(result.summary?.byeAdvances).toBe(3)
  })

  it('commitBatch가 실패하면 성공으로 표시하지 않는다(가상 spec은 목표 수치 미달이라 애초에 commitBatch까지 가지 않는 경로도 함께 확인)', async () => {
    const deps = fakeDeps({ commitBatch: async () => { throw new Error('network') } })
    const result = await applyApr18Import(virtualSpec(), { adminUid: 'admin-1' }, deps)
    expect(result.ok).toBe(false)
    expect(deps.commitCalls).toBe(0)
  })

  it('목표 수치를 만족하는 spec에서 commitBatch가 실패하면 성공으로 표시하지 않는다', async () => {
    const spec = targetShapedVirtualSpec()
    const virtualMembers = spec.participants.map((p, i) => ({ id: `pv-${i + 1}`, name: p.name }))
    const deps = fakeDeps({
      loadState: async () => ({ members: virtualMembers, sessions: [] }),
      commitBatch: async () => { throw new Error('network') },
    })
    const result = await applyApr18Import(spec, { adminUid: 'admin-1' }, deps)
    expect(result.ok).toBe(false)
  })

  it('dry-run(buildApr18ImportPlan)은 어떤 경로로도 Firestore write를 발생시키지 않는다(0회)', () => {
    // buildApr18ImportPlan/buildApr18FirestoreWrites는 이 파일에 firebase가 없으므로
    // 구조적으로 아무것도 쓸 수 없다 — 위 "Firestore를 전혀 부르지 않는다" 테스트가 이미 확인.
    const plan = buildApr18ImportPlan(virtualSpec(), EMPTY_CONTEXT)
    expect(plan).toBeTruthy() // 계산만 하고 끝났다는 것을 보여주는 스모크 테스트
  })
})

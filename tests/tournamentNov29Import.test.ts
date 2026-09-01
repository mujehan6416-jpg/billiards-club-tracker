import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { calculateFinalPlacements } from '../src/logic/tournamentMatch'
import {
  buildNov29ImportPlan, evaluateNov29ApplyEligibility, buildNov29FirestoreWrites, applyNov29Import,
} from '../src/lib/tournamentNov29Import'
import type { Nov29ApplyDeps, Nov29ImportSpec } from '../src/lib/tournamentNov29Import'
import type { Session } from '../src/types'

// 가상 데이터만 사용한다 — 실제 회원 이름·경기 데이터가 아니다.
// 2025-11-29 "제1회 성균관대학교 부산동문 회장배 당구대회"(개인전) 가져오기 전용 테스트.

const VIRTUAL_MEMBERS = Array.from({ length: 15 }, (_, i) => ({ id: `pv-${i + 1}`, name: `P${String(i + 1).padStart(2, '0')}` }))

/**
 * 목표 수치(참가자 15, 실제 경기 15, 부전진출 1)를 정확히 만족하는 가상 spec — 실제
 * 2025-11-29 대진과 완전히 같은 구조(16강 7경기+부전승1 → 8강4 → 4강2 → 결승1 → 3·4위전1)를
 * 가상 이름(P01~P15)으로 그대로 재현한다.
 */
function targetShapedSpec(): Nov29ImportSpec {
  const P = VIRTUAL_MEMBERS.map((m) => m.name)
  return {
    participants: P.map((name) => ({ name, handicap: 15 })),
    tournament: {
      name: '가상 회장배 당구대회(2025-11-29 구조 재현)',
      date: '2025-11-29',
      timeLimitMinutes: 50,
      matches: [
        { key: 'M01', roundNumber: 1, playerCountInRound: 15, matchNumber: 1, resultType: 'normal', playerA: P[0], playerB: P[1], scoreA: 7, scoreB: 18, winner: P[1], nextKey: 'QF1', nextSlot: 'playerA' },
        { key: 'M02', roundNumber: 1, playerCountInRound: 15, matchNumber: 2, resultType: 'normal', playerA: P[2], playerB: P[3], scoreA: 18, scoreB: 5, winner: P[2], nextKey: 'QF1', nextSlot: 'playerB' },
        { key: 'M03', roundNumber: 1, playerCountInRound: 15, matchNumber: 3, resultType: 'normal', playerA: P[4], playerB: P[5], scoreA: 9, scoreB: 10, winner: P[5], nextKey: 'QF2', nextSlot: 'playerA' },
        { key: 'M04', roundNumber: 1, playerCountInRound: 15, matchNumber: 4, resultType: 'normal', playerA: P[6], playerB: P[7], scoreA: 1, scoreB: 4, winner: P[7], nextKey: 'QF2', nextSlot: 'playerB' },
        { key: 'M05', roundNumber: 1, playerCountInRound: 15, matchNumber: 5, resultType: 'normal', playerA: P[8], playerB: P[9], scoreA: 3, scoreB: 9, winner: P[9], nextKey: 'QF3', nextSlot: 'playerA' },
        { key: 'M06', roundNumber: 1, playerCountInRound: 15, matchNumber: 6, resultType: 'normal', playerA: P[10], playerB: P[11], scoreA: 13, scoreB: 9, winner: P[10], nextKey: 'QF3', nextSlot: 'playerB' },
        { key: 'M07B', roundNumber: 1, playerCountInRound: 15, matchNumber: 7, resultType: 'bye', playerA: P[12], playerB: null, scoreA: null, scoreB: null, winner: P[12], nextKey: 'QF4', nextSlot: 'playerA' },
        { key: 'M08', roundNumber: 1, playerCountInRound: 15, matchNumber: 8, resultType: 'normal', playerA: P[13], playerB: P[14], scoreA: 12, scoreB: 10, winner: P[13], nextKey: 'QF4', nextSlot: 'playerB' },

        { key: 'QF1', roundNumber: 2, playerCountInRound: 8, matchNumber: 1, resultType: 'normal', playerA: P[1], playerB: P[2], scoreA: 18, scoreB: 13, winner: P[1], nextKey: 'SF1', nextSlot: 'playerA' },
        { key: 'QF2', roundNumber: 2, playerCountInRound: 8, matchNumber: 2, resultType: 'normal', playerA: P[5], playerB: P[7], scoreA: 8, scoreB: 11, winner: P[7], nextKey: 'SF1', nextSlot: 'playerB' },
        { key: 'QF3', roundNumber: 2, playerCountInRound: 8, matchNumber: 3, resultType: 'normal', playerA: P[9], playerB: P[10], scoreA: 14, scoreB: 9, winner: P[9], nextKey: 'SF2', nextSlot: 'playerA' },
        { key: 'QF4', roundNumber: 2, playerCountInRound: 8, matchNumber: 4, resultType: 'normal', playerA: P[12], playerB: P[13], scoreA: 10, scoreB: 7, winner: P[12], nextKey: 'SF2', nextSlot: 'playerB' },

        { key: 'SF1', roundNumber: 3, playerCountInRound: 4, matchNumber: 1, resultType: 'normal', playerA: P[1], playerB: P[7], scoreA: 16, scoreB: 5, winner: P[1], nextKey: 'FINAL', nextSlot: 'playerA' },
        { key: 'SF2', roundNumber: 3, playerCountInRound: 4, matchNumber: 2, resultType: 'normal', playerA: P[9], playerB: P[12], scoreA: 15, scoreB: 3, winner: P[9], nextKey: 'FINAL', nextSlot: 'playerB' },

        { key: 'FINAL', roundNumber: 4, playerCountInRound: 2, matchNumber: 1, resultType: 'normal', playerA: P[1], playerB: P[9], scoreA: 16, scoreB: 15, winner: P[9], nextKey: null, nextSlot: null },
        { key: 'THIRD', roundNumber: 5, playerCountInRound: 3, matchNumber: 1, resultType: 'normal', playerA: P[7], playerB: P[12], scoreA: 11, scoreB: 9, winner: P[7], nextKey: null, nextSlot: null },
      ],
    },
  }
}

const EMPTY_CONTEXT = { members: VIRTUAL_MEMBERS, existingSessions: [] as Session[], existingTournaments: [] }

describe('buildNov29ImportPlan — 기본 데이터', () => {
  it('대회 날짜·이름이 그대로 반영된다', () => {
    const spec = targetShapedSpec()
    expect(spec.tournament.date).toBe('2025-11-29')
    const plan = buildNov29ImportPlan(spec, EMPTY_CONTEXT)
    expect(plan.ok).toBe(true)
  })

  it('참가자 15, 실제 경기 15, 부전진출 1을 정확히 계산한다', () => {
    const plan = buildNov29ImportPlan(targetShapedSpec(), EMPTY_CONTEXT)
    expect(plan.mapping.mappedCount).toBe(15)
    expect(plan.mapping.totalCount).toBe(15)
    expect(plan.actualGameCount).toBe(15)
    expect(plan.byeCount).toBe(1)
  })

  it('없는 회원이 있으면 실패로 표시된다(유사 이름 자동 매칭 없음)', () => {
    const spec = targetShapedSpec()
    spec.tournament.matches[0].playerA = '없는사람'
    spec.tournament.matches[0].winner = '없는사람'
    const plan = buildNov29ImportPlan(spec, EMPTY_CONTEXT)
    expect(plan.ok).toBe(false)
    expect(plan.mapping.missingNames).toContain('없는사람')
  })

  it('동명이인이 있으면 실패로 표시된다', () => {
    const dupMembers = [...VIRTUAL_MEMBERS, { id: 'dup', name: VIRTUAL_MEMBERS[0].name }]
    const plan = buildNov29ImportPlan(targetShapedSpec(), { ...EMPTY_CONTEXT, members: dupMembers })
    expect(plan.ok).toBe(false)
    expect(plan.mapping.duplicateNames).toContain(VIRTUAL_MEMBERS[0].name)
  })
})

describe('buildNov29ImportPlan — 라운드별 경기수', () => {
  it('16강 실제 경기 7 + bye 1, 8강 4, 4강 2, 결승 1, 3·4위전 1 = 총 15', () => {
    const spec = targetShapedSpec()
    const round1 = spec.tournament.matches.filter((m) => m.roundNumber === 1)
    expect(round1.filter((m) => m.resultType === 'normal').length).toBe(7)
    expect(round1.filter((m) => m.resultType === 'bye').length).toBe(1)
    expect(spec.tournament.matches.filter((m) => m.roundNumber === 2).length).toBe(4)
    expect(spec.tournament.matches.filter((m) => m.roundNumber === 3).length).toBe(2)
    expect(spec.tournament.matches.filter((m) => m.roundNumber === 4).length).toBe(1)
    expect(spec.tournament.matches.filter((m) => m.playerCountInRound === 3).length).toBe(1)

    const plan = buildNov29ImportPlan(spec, EMPTY_CONTEXT)
    expect(plan.actualGameCount).toBe(15)
  })
})

describe('buildNov29FirestoreWrites — 결승/3·4위전 승자 보존', () => {
  const nameToId = new Map(VIRTUAL_MEMBERS.map((m) => [m.name, m.id]))
  const makeId = () => { let i = 0; return () => `id-${i++}` }

  it('결승은 점수가 낮은 쪽이라도 명시된 승자가 그대로 저장된다(점수 재추론 없음)', () => {
    const writes = buildNov29FirestoreWrites(targetShapedSpec(), nameToId, { adminUid: 'admin-1', at: '2025-11-29T10:00:00.000Z', makeId: makeId() })
    const finalGame = writes.games.find((g) => g.game.scoreA === 16 && g.game.scoreB === 15)!
    expect(finalGame.game.winnerId).toBe('pv-10') // P10 = VIRTUAL_MEMBERS[9]
  })

  it('3·4위전은 실제 Game으로 생성되고 승자가 그대로 저장된다', () => {
    const writes = buildNov29FirestoreWrites(targetShapedSpec(), nameToId, { adminUid: 'admin-1', at: '2025-11-29T10:00:00.000Z', makeId: makeId() })
    const thirdGame = writes.games.find((g) => g.game.scoreA === 11 && g.game.scoreB === 9)!
    expect(thirdGame).toBeTruthy()
    expect(thirdGame.game.winnerId).toBe('pv-8') // P08

    const thirdMatch = writes.matches.find((m) => m.playerCountInRound === 3)!
    expect(thirdMatch).toBeTruthy()
    expect(thirdMatch.resultType).toBe('normal')
  })

  it('최종 순위 1~4위가 정확히 계산된다', () => {
    const writes = buildNov29FirestoreWrites(targetShapedSpec(), nameToId, { adminUid: 'admin-1', at: '2025-11-29T10:00:00.000Z', makeId: makeId() })
    const placements = calculateFinalPlacements(writes.matches)
    expect(placements.championParticipantId).toBe('pv-10') // P10
    expect(placements.runnerUpParticipantId).toBe('pv-2') // P02
    expect(placements.thirdPlaceParticipantIds).toEqual(['pv-8']) // P08
    expect(placements.fourthPlaceParticipantId).toBe('pv-13') // P13
  })

  it('모든 참가자의 핸디 스냅샷이 spec에 지정된 값 그대로 저장된다', () => {
    const spec = targetShapedSpec()
    const writes = buildNov29FirestoreWrites(spec, nameToId, { adminUid: 'admin-1', at: '2025-11-29T10:00:00.000Z', makeId: makeId() })
    for (const { game } of writes.games) {
      expect(game.handicapA).toBe(15)
      expect(game.handicapB).toBe(15)
    }
  })

  it('부전승은 Game으로 생성되지 않는다 — 실제 Game 정확히 15건', () => {
    const writes = buildNov29FirestoreWrites(targetShapedSpec(), nameToId, { adminUid: 'admin-1', at: '2025-11-29T10:00:00.000Z', makeId: makeId() })
    expect(writes.games.length).toBe(15)
    expect(writes.games.every((g) => g.game.playerAId && g.game.playerBId)).toBe(true)
  })

  it('대회 1개, 참가자 15명이 만들어진다', () => {
    const writes = buildNov29FirestoreWrites(targetShapedSpec(), nameToId, { adminUid: 'admin-1', at: '2025-11-29T10:00:00.000Z', makeId: makeId() })
    expect(writes.tournament.status).toBe('finished')
    expect(writes.participants.length).toBe(15)
  })

  it('모든 Game이 하나의 세션 아래 들어간다', () => {
    const writes = buildNov29FirestoreWrites(targetShapedSpec(), nameToId, { adminUid: 'admin-1', at: '2025-11-29T10:00:00.000Z', makeId: makeId() })
    const sessionIds = new Set(writes.games.map((g) => g.sessionId))
    expect(sessionIds.size).toBe(1)
    expect([...sessionIds][0]).toBe(writes.session.id)
  })
})

describe('2:2(팀전) 데이터 없음', () => {
  it('spec 구조에 팀/2:2 관련 필드가 전혀 없다(1:1 개인전 구조만 존재)', () => {
    const spec = targetShapedSpec()
    const source = JSON.stringify(spec)
    expect(source).not.toMatch(/team|2:2|doubles/i)
    // 모든 매치가 정확히 playerA/playerB 두 자리만 가진다(팀 배열이 아니다).
    for (const m of spec.tournament.matches) {
      expect(typeof m.playerA === 'string' || m.playerA === null).toBe(true)
      expect(typeof m.playerB === 'string' || m.playerB === null).toBe(true)
    }
  })
})

describe('evaluateNov29ApplyEligibility', () => {
  it('목표 수치(참가자 15/실제 경기 15/부전진출 1)를 모두 만족하고 관리자 인증이 있으면 활성화된다', () => {
    const plan = buildNov29ImportPlan(targetShapedSpec(), EMPTY_CONTEXT)
    expect(evaluateNov29ApplyEligibility(plan, true).eligible).toBe(true)
  })

  it('관리자 인증이 없으면 비활성화된다', () => {
    const plan = buildNov29ImportPlan(targetShapedSpec(), EMPTY_CONTEXT)
    expect(evaluateNov29ApplyEligibility(plan, false).eligible).toBe(false)
  })

  it('회원 매핑이 15/15가 아니면 비활성화된다', () => {
    const spec = targetShapedSpec()
    spec.tournament.matches[0].playerA = '없는사람'
    spec.tournament.matches[0].winner = '없는사람'
    const plan = buildNov29ImportPlan(spec, EMPTY_CONTEXT)
    expect(evaluateNov29ApplyEligibility(plan, true).eligible).toBe(false)
  })

  it('대회 중복이 있으면 비활성화된다', () => {
    const spec = targetShapedSpec()
    const plan = buildNov29ImportPlan(spec, { ...EMPTY_CONTEXT, existingTournaments: [{ name: spec.tournament.name, date: spec.tournament.date }] })
    expect(evaluateNov29ApplyEligibility(plan, true).eligible).toBe(false)
  })

  it('같은 날짜에 이미 경기가 있으면 비활성화된다', () => {
    const sessions: Session[] = [{ id: 's1', date: '2025-11-29', attendeeIds: [], games: [{} as never] }]
    const plan = buildNov29ImportPlan(targetShapedSpec(), { ...EMPTY_CONTEXT, existingSessions: sessions })
    expect(evaluateNov29ApplyEligibility(plan, true).eligible).toBe(false)
  })
})

function fakeDeps(overrides: Partial<Nov29ApplyDeps> = {}): Nov29ApplyDeps & { commitCalls: number } {
  const base = {
    fetchAdminDoc: async (_uid: string) => ({ active: true }),
    loadState: async () => ({ members: VIRTUAL_MEMBERS, sessions: [] as Session[] }),
    fetchTournaments: async () => [] as { name: string; date: string }[],
    commitBatch: async () => { deps.commitCalls++ },
    makeId: (() => { let i = 0; return () => `id-${i++}` })(),
    now: () => '2025-11-29T10:00:00.000Z',
    ...overrides,
  }
  const deps = { ...base, commitCalls: 0 }
  return deps
}

describe('applyNov29Import — 관리자 인증 / 재검사(mock/fake만 사용, Firestore 미접근)', () => {
  it('admins 문서가 없으면 apply를 거부하고 아무것도 쓰지 않는다', async () => {
    const deps = fakeDeps({ fetchAdminDoc: async () => null })
    const result = await applyNov29Import(targetShapedSpec(), { adminUid: 'admin-1' }, deps)
    expect(result.ok).toBe(false)
    expect(deps.commitCalls).toBe(0)
  })

  it('admins 문서가 active:false면 apply를 거부한다', async () => {
    const deps = fakeDeps({ fetchAdminDoc: async () => ({ active: false }) })
    const result = await applyNov29Import(targetShapedSpec(), { adminUid: 'admin-1' }, deps)
    expect(result.ok).toBe(false)
    expect(deps.commitCalls).toBe(0)
  })

  it('서버에 이미 같은 이름의 대회가 있으면 적용 직전 재검사에서 차단된다', async () => {
    const spec = targetShapedSpec()
    const deps = fakeDeps({ fetchTournaments: async () => [{ name: spec.tournament.name, date: spec.tournament.date }] })
    const result = await applyNov29Import(spec, { adminUid: 'admin-1' }, deps)
    expect(result.ok).toBe(false)
    expect(deps.commitCalls).toBe(0)
  })

  it('모든 조건을 만족하면 commitBatch가 정확히 1번 호출되고 성공을 반환한다', async () => {
    const deps = fakeDeps()
    const result = await applyNov29Import(targetShapedSpec(), { adminUid: 'admin-1' }, deps)
    expect(result.ok).toBe(true)
    expect(deps.commitCalls).toBe(1)
    expect(result.summary?.actualGames).toBe(15)
    expect(result.summary?.byeAdvances).toBe(1)
  })

  it('같은 데이터를 다시(중복) 적용하면(대회가 이미 있는 상태) 두 번째 실행은 차단된다', async () => {
    const spec = targetShapedSpec()
    const deps1 = fakeDeps()
    const first = await applyNov29Import(spec, { adminUid: 'admin-1' }, deps1)
    expect(first.ok).toBe(true)

    // 두 번째 시도 — 이번엔 서버에 이미 이 대회가 존재하는 상태를 흉내낸다.
    const deps2 = fakeDeps({ fetchTournaments: async () => [{ name: spec.tournament.name, date: spec.tournament.date }] })
    const second = await applyNov29Import(spec, { adminUid: 'admin-1' }, deps2)
    expect(second.ok).toBe(false)
    expect(deps2.commitCalls).toBe(0)
  })

  it('commitBatch가 실패하면 성공으로 표시하지 않는다', async () => {
    const deps = fakeDeps({ commitBatch: async () => { throw new Error('network') } })
    const result = await applyNov29Import(targetShapedSpec(), { adminUid: 'admin-1' }, deps)
    expect(result.ok).toBe(false)
  })

  it('dry-run(buildNov29ImportPlan)은 Firestore를 전혀 부르지 않는다(파일 자체에 firebase가 없다)', () => {
    const source = readFileSync('src/lib/tournamentNov29Import.ts', 'utf-8')
    expect(source).not.toContain('firebase')
    expect(source).not.toContain('getFirestore')
  })
})

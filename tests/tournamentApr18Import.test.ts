import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { calculateFinalPlacements } from '../src/logic/tournamentMatch'
import {
  mapParticipantNames, checkExistingGamesOnDate, checkExistingTournamentNames,
  buildBracketFromSpec, buildGamesFromSpec, buildApr18ImportPlan, validateTournamentSpecShape,
} from '../src/lib/tournamentApr18Import'
import type { Apr18ImportSpec, Apr18TournamentSpec } from '../src/lib/tournamentApr18Import'
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

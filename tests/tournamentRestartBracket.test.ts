import { describe, it, expect } from 'vitest'
import {
  analyzeRestartSource, buildRestartBracket, pendingRestartJoins, restartFirstRoundStatus, restartJoinProgress,
  type RestartEntrant, type RestartSourceAnalysis,
} from '../src/logic/tournamentRestartBracket'
import {
  calculateFinalPlacements, isTournamentRoundOfficial, submitTournamentMatchResult,
} from '../src/logic/tournamentMatch'
import { buildEmptyBracket, buildTournamentMatches } from '../src/logic/tournamentBracket'
import type { TournamentMatch } from '../src/types/tournament'
import { decide, decideRound, fillJoiner, fullMain, mainWithByes, seat, seededRng } from './fixtures/restartMain'

// 가상 데이터만 사용한다 — 실제 회원 이름·ID·운영 데이터를 쓰지 않는다.

const SRC = 'main-tournament'

function analysisOf(matches: TournamentMatch[]): RestartSourceAnalysis {
  const a = analyzeRestartSource(matches)
  if (!a.ok) throw new Error(a.message)
  return a.value
}

/** 본선 1차(16강)를 모두 승인한 상태. 지는 쪽은 항상 B → 패자는 자리 번호가 짝수인 선수들(p2, p4, … p16). */
function mainAfterRound1(): TournamentMatch[] {
  return decideRound(fullMain(16), 1)
}

function entrantsOfLosers(matches: TournamentMatch[]): RestartEntrant[] {
  const status = restartFirstRoundStatus(analysisOf(matches))
  return status.losers.map((l) => ({ participantId: l.memberId, memberId: l.memberId, handicap: 20 }))
}

function buildFrom(matches: TournamentMatch[], seed = 1) {
  const built = buildRestartBracket({
    sourceTournamentId: SRC, analysis: analysisOf(matches), sourceMatches: matches,
    entrants: entrantsOfLosers(matches), rng: seededRng(seed),
  })
  if (!built.ok) throw new Error(built.message)
  return built.value
}

describe('analyzeRestartSource — 본선 구조 분석(라운드 이름을 박아 두지 않는다)', () => {
  it('16명 본선: 첫 라운드 8경기, 두 번째 라운드 4경기, 합류 자리 4개', () => {
    const a = analysisOf(fullMain(16))
    expect(a.w).toBe(4)
    expect(a.firstRound.map((m) => m.id)).toEqual(['r1m1', 'r1m2', 'r1m3', 'r1m4', 'r1m5', 'r1m6', 'r1m7', 'r1m8'])
    expect(a.secondRound.map((m) => m.id)).toEqual(['r2m1', 'r2m2', 'r2m3', 'r2m4'])
  })

  it('8명 본선도 같은 규칙으로 동작한다(첫 라운드 4경기, 합류 자리 2개)', () => {
    expect(analysisOf(fullMain(8)).w).toBe(2)
  })

  it('3·4위전이 있는 본선에서도 3·4위전은 라운드로 세지 않는다', () => {
    const bracket = buildEmptyBracket(16, { includeThirdPlace: true })
    if (!bracket.ok) throw new Error(bracket.message)
    const built = buildTournamentMatches(bracket.value, Array.from({ length: 16 }, (_, i) => seat(i + 1)))
    if (!built.ok) throw new Error(built.message)
    expect(analysisOf(built.value).w).toBe(4)
  })

  it('4명 이하 본선은 합류 단계를 만들 수 없어 이유와 함께 거절한다', () => {
    const r = analyzeRestartSource(fullMain(4))
    expect(r.ok).toBe(false)
  })

  it('합류 구조가 성립하지 않는 인원(12명: 생존자 2명 ≠ 합류 4명)은 아무것도 만들지 않고 이유를 알려 준다', () => {
    const r = analyzeRestartSource(mainWithByes([2, 4, 6, 8]))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toContain('수가 맞지 않아')
  })
})

describe('restartFirstRoundStatus — 최종 승인된 1차 패자만 반영', () => {
  it('아무 경기도 승인되지 않았으면 0 / 8, 준비 안 됨', () => {
    const s = restartFirstRoundStatus(analysisOf(fullMain(16)))
    expect(s).toMatchObject({ officialCount: 0, total: 8, ready: false, losers: [] })
  })

  it('승인 대기 경기의 패자는 반영하지 않고, 7경기만 승인되면 준비 안 됨', () => {
    let matches = fullMain(16)
    for (let i = 1; i <= 7; i++) matches = decide(matches, `r1m${i}`)
    matches = matches.map((m) => (m.id === 'r1m8'
      ? { ...m, status: 'awaitingApproval' as const, scoreA: 20, scoreB: 5, calculatedWinnerParticipantId: m.playerAParticipantId }
      : m))
    const s = restartFirstRoundStatus(analysisOf(matches))
    expect(s.officialCount).toBe(7)
    expect(s.ready).toBe(false)
    expect(s.losers.map((l) => l.memberId)).not.toContain('m16')
  })

  it('8경기가 모두 승인되면 패자 8명이 확정되고 준비 완료', () => {
    const s = restartFirstRoundStatus(analysisOf(mainAfterRound1()))
    expect(s.ready).toBe(true)
    expect(s.losers.map((l) => l.memberId)).toEqual(['m2', 'm4', 'm6', 'm8', 'm10', 'm12', 'm14', 'm16'])
  })
})

describe('buildRestartBracket — 자동 대진 생성(16명 본선 기준)', () => {
  const main = mainAfterRound1()
  const built = buildFrom(main)
  const byId = new Map(built.matches.map((m) => [m.id, m]))

  it('1차전 4경기(8명) + 합류 단계 4경기 + 4강 2경기 + 결승 1경기 = 11경기', () => {
    expect(built.matches).toHaveLength(11)
    expect(built.matches.filter((m) => m.roundNumber === 1)).toHaveLength(4)
    expect(built.matches.filter((m) => m.roundNumber === 2)).toHaveLength(4)
    expect(built.matches.filter((m) => m.roundNumber === 3)).toHaveLength(2)
    expect(built.matches.filter((m) => m.roundNumber === 4)).toHaveLength(1)
  })

  it('1차전에는 본선 1차 패자 8명이 한 번씩만 들어가고, 모두 일반 경기(부전승 아님)다', () => {
    const r1 = built.matches.filter((m) => m.roundNumber === 1)
    const ids = r1.flatMap((m) => [m.playerAMemberId, m.playerBMemberId])
    expect([...ids].sort()).toEqual(['m10', 'm12', 'm14', 'm16', 'm2', 'm4', 'm6', 'm8'])
    expect(r1.every((m) => m.resultType === 'normal' && m.status === 'awaitingResult')).toBe(true)
  })

  it('합류 단계 B 자리는 본선 2차 경기 1~4번 패자 자리로 예약되고, 부전승이 아니며 비어 있다', () => {
    const r2 = built.matches.filter((m) => m.roundNumber === 2).sort((a, b) => a.matchNumber - b.matchNumber)
    expect(r2.map((m) => m.playerBJoinFrom)).toEqual([
      { tournamentId: SRC, matchId: 'r2m1' }, { tournamentId: SRC, matchId: 'r2m2' },
      { tournamentId: SRC, matchId: 'r2m3' }, { tournamentId: SRC, matchId: 'r2m4' },
    ])
    expect(r2.every((m) => m.playerBJoinLabel === '본선 8강 탈락자 합류 예정')).toBe(true)
    expect(r2.every((m) => m.resultType === 'normal' && m.status === 'awaitingResult')).toBe(true)
    expect(r2.every((m) => m.playerBParticipantId === null && m.playerAParticipantId === null)).toBe(true)
  })

  it('1차전 승자는 합류 단계의 서로 다른 경기 A 자리로 가고, 이후는 4강 → 결승으로 이어진다', () => {
    const targets = built.matches.filter((m) => m.roundNumber === 1).map((m) => `${m.nextMatchId}:${m.nextSlot}`)
    expect(new Set(targets).size).toBe(4)
    expect(targets.every((t) => /^r2m[1-4]:playerA$/.test(t))).toBe(true)
    expect(byId.get('r2m1')).toMatchObject({ nextMatchId: 'r3m1', nextSlot: 'playerA' })
    expect(byId.get('r2m2')).toMatchObject({ nextMatchId: 'r3m1', nextSlot: 'playerB' })
    expect(byId.get('r2m3')).toMatchObject({ nextMatchId: 'r3m2', nextSlot: 'playerA' })
    expect(byId.get('r3m1')).toMatchObject({ nextMatchId: 'r4m1', nextSlot: 'playerA' })
    expect(byId.get('r3m2')).toMatchObject({ nextMatchId: 'r4m1', nextSlot: 'playerB' })
    expect(byId.get('r4m1')).toMatchObject({ nextMatchId: null, nextSlot: null })
  })

  it('같은 입력과 같은 난수면 항상 같은 대진이다(재현 가능) — 저장된 뒤에는 다시 섞지 않는다', () => {
    expect(buildFrom(main, 7).matches).toEqual(buildFrom(main, 7).matches)
  })

  it('참가자 수가 맞지 않거나 같은 회원이 중복이면 만들지 않는다', () => {
    const analysis = analysisOf(main)
    const entrants = entrantsOfLosers(main)
    expect(buildRestartBracket({ sourceTournamentId: SRC, analysis, sourceMatches: main, entrants: entrants.slice(0, 7) }).ok).toBe(false)
    expect(buildRestartBracket({
      sourceTournamentId: SRC, analysis, sourceMatches: main, entrants: [...entrants.slice(0, 7), entrants[0]],
    }).ok).toBe(false)
  })
})

describe('재대결 회피 — 합류 후보가 이미 이긴 상대와 합류 단계에서 바로 만나지 않게 한다', () => {
  const main = mainAfterRound1()
  const analysis = analysisOf(main)

  /** 본선 2차 경기 i의 두 선수가 본선 1차에서 이긴 상대(회원 id). */
  const beatenBy = (i: number) => {
    const second = analysis.secondRound[i]
    return [second.playerAParticipantId, second.playerBParticipantId].flatMap((p) => {
      const first = main.find((m) => m.roundNumber === 1 && m.officialWinnerParticipantId === p)!
      return [first.officialLoserParticipantId === first.playerAParticipantId ? first.playerAMemberId : first.playerBMemberId]
    })
  }

  it('여러 난수에서 합류 단계 경기마다 1차전 승자 후보와 합류 후보가 본선에서 붙은 적이 없다', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const built = buildFrom(main, seed)
      expect(built.rematchAvoided).toBe(true)
      for (let i = 0; i < analysis.secondRound.length; i++) {
        const feeder = built.matches.find((m) => m.roundNumber === 1 && m.nextMatchId === `r2m${i + 1}`)!
        const pair = [feeder.playerAMemberId, feeder.playerBMemberId]
        for (const beaten of beatenBy(i)) expect(pair).not.toContain(beaten)
      }
    }
  })
})

describe('pendingRestartJoins — 본선 2차 패자의 자동 배치(최종 승인된 경기만)', () => {
  const afterR1 = mainAfterRound1()
  const restart = buildFrom(afterR1).matches

  it('본선 2차가 하나도 승인되지 않았으면 배치할 합류자가 없다', () => {
    expect(pendingRestartJoins(restart, afterR1)).toEqual([])
  })

  it('승인 대기 상태(점수만 입력/확인 중)에서는 배치하지 않는다', () => {
    const pending = afterR1.map((m) => (m.id === 'r2m1'
      ? { ...m, status: 'awaitingApproval' as const, scoreA: 20, scoreB: 5, calculatedWinnerParticipantId: m.playerAParticipantId }
      : m))
    expect(pendingRestartJoins(restart, pending)).toEqual([])
  })

  it('첫 승인된 패자는 슬롯 1, 두 번째는 슬롯 2에 배치된다(본선 경기 번호 순서 = 슬롯 번호)', () => {
    // r2m2를 먼저 승인해도 그 패자는 합류 슬롯 2로 간다
    const second = decide(afterR1, 'r2m2')
    const loserOf2 = second.find((m) => m.id === 'r2m2')!.officialLoserParticipantId
    const joins2 = pendingRestartJoins(restart, second)
    expect(joins2).toEqual([{ restartMatchId: 'r2m2', sourceParticipantId: loserOf2, memberId: loserOf2!.replace('p', 'm') }])

    const both = decide(second, 'r2m1')
    const joins = pendingRestartJoins(restart, both)
    expect(joins.map((j) => j.restartMatchId)).toEqual(['r2m1', 'r2m2'])
  })

  it('모든 본선 2차 패자가 확정되면 합류 자리 4개가 모두 채워진다 — 중복 배치 없음', () => {
    const all = decideRound(afterR1, 2)
    const joins = pendingRestartJoins(restart, all)
    expect(joins.map((j) => j.restartMatchId)).toEqual(['r2m1', 'r2m2', 'r2m3', 'r2m4'])
    expect(new Set(joins.map((j) => j.memberId)).size).toBe(4)
  })

  it('이미 채워진 자리는 건드리지 않는다(다시 계산해도 같은 자리를 또 채우지 않음)', () => {
    const all = decideRound(afterR1, 2)
    let filled = restart
    for (const j of pendingRestartJoins(restart, all)) filled = fillJoiner(filled, j.restartMatchId, Number(j.memberId.slice(1)))
    expect(pendingRestartJoins(filled, all)).toEqual([])
  })

  it('본선 결과가 나중에 정정돼 패자가 바뀌어도 이미 채운 자리는 자동으로 바뀌지 않는다', () => {
    const first = decide(afterR1, 'r2m1', 'B')
    const j = pendingRestartJoins(restart, first)[0]
    const placed = fillJoiner(restart, j.restartMatchId, Number(j.memberId.slice(1)))
    const corrected = decide(afterR1, 'r2m1', 'A') // 반대로 정정
    expect(pendingRestartJoins(placed, corrected)).toEqual([])
    expect(placed.find((m) => m.id === 'r2m1')!.playerBMemberId).toBe(j.memberId)
  })

  it('restartJoinProgress는 채워진 합류 자리 수를 센다', () => {
    expect(restartJoinProgress(restart)).toEqual({ filled: 0, total: 4 })
    expect(restartJoinProgress(fillJoiner(restart, 'r2m1', 3))).toEqual({ filled: 1, total: 4 })
  })
})

describe('기존 토너먼트 엔진과의 호환 — 리스타트 대진도 같은 승인·진출·순위 로직으로 진행된다', () => {
  const afterR1 = mainAfterRound1()
  const restart0 = buildFrom(afterR1).matches

  it('합류자가 없는 경기(B 비어 있음)는 점수 입력을 받지 않는다 — 시작할 수 없다', () => {
    const waiting = restart0.find((m) => m.id === 'r2m1')!
    const r = submitTournamentMatchResult(waiting, { byMemberId: 'm1', scoreA: 10, scoreB: 5, at: '2026-10-05T10:00:00.000Z' })
    expect(r.ok).toBe(false)
  })

  it('1차전 승자 진출 → 합류자 도착 → 한 경기에서 만나 점수 입력이 가능해진다', () => {
    let matches = restart0
    matches = decide(matches, 'r1m1') // 1차전 첫 경기 승인 → 승자가 r2의 A 자리로
    const feeds = matches.find((m) => m.id === 'r1m1')!.nextMatchId!
    const slot = matches.find((m) => m.id === feeds)!
    expect(slot.playerAParticipantId).not.toBeNull()
    expect(slot.playerBParticipantId).toBeNull() // 아직 합류자 없음
    matches = fillJoiner(matches, feeds, 3)
    const ready = matches.find((m) => m.id === feeds)!
    const r = submitTournamentMatchResult(ready, {
      byMemberId: ready.playerAMemberId!, scoreA: 10, scoreB: 5, at: '2026-10-05T10:00:00.000Z',
    })
    expect(r.ok).toBe(true)
  })

  it('1차전 → 합류 단계 → 4강 → 결승까지 진행하면 우승자가 계산된다(3·4위전 없음)', () => {
    let matches = restart0
    matches = decideRound(matches, 1)
    // 본선 2차 패자 4명을 슬롯 1~4에 배치
    const joins = pendingRestartJoins(matches, decideRound(afterR1, 2))
    for (const j of joins) matches = fillJoiner(matches, j.restartMatchId, Number(j.memberId.slice(1)))
    expect(isTournamentRoundOfficial(matches, 2)).toBe(false)
    matches = decideRound(matches, 2)
    expect(isTournamentRoundOfficial(matches, 2)).toBe(true)
    matches = decideRound(matches, 3)
    expect(calculateFinalPlacements(matches).championParticipantId).toBeNull()
    matches = decide(matches, 'r4m1')
    const placements = calculateFinalPlacements(matches)
    expect(placements.championParticipantId).not.toBeNull()
    expect(placements.runnerUpParticipantId).not.toBeNull()
    expect(placements.thirdPlaceParticipantIds).toHaveLength(2) // 4강 패자 공동 3위(기존 규칙 그대로)
  })
})

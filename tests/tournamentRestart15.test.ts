import { describe, it, expect } from 'vitest'
import {
  analyzeRestartSource, buildRestartBracket, pendingRestartJoins, restartFirstRoundStatus,
  type RestartEntrant, type RestartSourceAnalysis,
} from '../src/logic/tournamentRestartBracket'
import { restartCandidates } from '../src/logic/tournamentRestart'
import { calculateFinalPlacements, submitTournamentMatchResult } from '../src/logic/tournamentMatch'
import type { TournamentMatch, TournamentParticipant } from '../src/types/tournament'
import { decide, decideRound, fillJoiner, fullMain, mainWithByes, seededRng } from './fixtures/restartMain'

// 15명 본선(16강 틀, 본선 1차 부전승 1명) 리스타트 자동 대진 테스트.
// 가상 데이터만 사용한다 — 실제 회원 이름·ID·운영 데이터를 쓰지 않는다.
// 가상 본선: 자리 16을 비워 둬서 r1m8은 가상선수15의 부전승이다.

const SRC = 'main-15'
const AT = '2026-10-05T10:00:00.000Z'

function analysisOf(matches: TournamentMatch[]): RestartSourceAnalysis {
  const a = analyzeRestartSource(matches)
  if (!a.ok) throw new Error(a.message)
  return a.value
}
function entrantsOf(matches: TournamentMatch[]): RestartEntrant[] {
  return restartFirstRoundStatus(analysisOf(matches)).losers
    .map((l) => ({ participantId: l.memberId, memberId: l.memberId, handicap: 20 }))
}
function build(matches: TournamentMatch[], seed = 1) {
  const built = buildRestartBracket({
    sourceTournamentId: SRC, analysis: analysisOf(matches), sourceMatches: matches,
    entrants: entrantsOf(matches), rng: seededRng(seed),
  })
  if (!built.ok) throw new Error(built.message)
  return built.value
}
/** 리스타트 대진을 처음부터 결승까지 진행한다(합류자는 본선 2차 결과로 채움). 우승자 participantId를 돌려준다. */
function playThrough(source: TournamentMatch[], restart: TournamentMatch[]): string | null {
  let matches = decideRound(restart, 1)
  const joins = pendingRestartJoins(matches, decideRound(source, 2))
  for (const j of joins) matches = fillJoiner(matches, j.restartMatchId, Number(j.memberId.slice(1)))
  const rounds = Math.max(...matches.map((m) => m.roundNumber))
  for (let r = 2; r <= rounds; r++) matches = decideRound(matches, r)
  return calculateFinalPlacements(matches).championParticipantId
}

const main15 = mainWithByes([16])
const main15R1 = decideRound(main15, 1)

describe('A. 본선 15명', () => {
  it('16강 틀(1차 8경기, 대진 규모 16)이고 본선 1차 부전승은 1명(가상선수15)이다', () => {
    const first = main15.filter((m) => m.roundNumber === 1)
    expect(first).toHaveLength(8)
    const byes = first.filter((m) => m.resultType === 'bye')
    expect(byes).toHaveLength(1)
    expect(byes[0].officialWinnerParticipantId).toBe('p15')
  })

  it('본선 1차 실제 경기는 7경기, 리스타트 1차전에 들어갈 사람은 7명, 합류 자리는 4개', () => {
    const a = analysisOf(main15)
    expect(a.entrantCount).toBe(7)
    expect(a.w).toBe(4)
    expect(a.secondRound).toHaveLength(4)
  })

  it('실제 7경기가 다 승인돼야 준비 완료 — 6경기면 6 / 7, 승인 대기는 반영하지 않는다', () => {
    expect(restartFirstRoundStatus(analysisOf(main15))).toMatchObject({ officialCount: 0, total: 7, ready: false })
    let partial = main15
    for (let i = 1; i <= 6; i++) partial = decide(partial, `r1m${i}`)
    partial = partial.map((m) => (m.id === 'r1m7'
      ? { ...m, status: 'awaitingApproval' as const, scoreA: 20, scoreB: 5, calculatedWinnerParticipantId: m.playerAParticipantId } : m))
    expect(restartFirstRoundStatus(analysisOf(partial))).toMatchObject({ officialCount: 6, total: 7, ready: false })
  })

  it('official 패자 7명이 확정되고, 본선 부전승 선수는 리스타트 대상·보내기 후보 어디에도 없다', () => {
    const s = restartFirstRoundStatus(analysisOf(main15R1))
    expect(s.ready).toBe(true)
    expect(s.losers.map((l) => l.memberId)).toEqual(['m2', 'm4', 'm6', 'm8', 'm10', 'm12', 'm14'])
    const people: TournamentParticipant[] = Array.from({ length: 15 }, (_, i) => ({
      id: `p${i + 1}`, memberId: `m${i + 1}`, displayNameSnapshot: `가상선수${i + 1}`,
      baseHandicapSnapshot: 20, tournamentHandicap: 20, entryStatus: 'entered',
    }))
    expect(restartCandidates(main15R1, people).map((c) => c.memberId)).not.toContain('m15')
  })
})

describe('B. 리스타트 7명 — 8자리 자동 대진, 부전승 1명 자동 배정', () => {
  const built = build(main15R1)
  const r1 = built.matches.filter((m) => m.roundNumber === 1)
  const r2 = built.matches.filter((m) => m.roundNumber === 2)

  it('1차전은 8자리(4경기)이고 7명이 한 번씩만 들어간다', () => {
    expect(r1).toHaveLength(4)
    const ids = r1.flatMap((m) => [m.playerAMemberId, m.playerBMemberId]).filter(Boolean)
    expect([...ids].sort()).toEqual(['m10', 'm12', 'm14', 'm2', 'm4', 'm6', 'm8'])
  })

  it('부전승 1경기 + 실제 경기 3경기 — 부전승은 기존과 같은 모양(바로 공식 처리, 점수 없음)', () => {
    const byes = r1.filter((m) => m.resultType === 'bye')
    expect(byes).toHaveLength(1)
    expect(byes[0]).toMatchObject({ status: 'official', scoreA: null, scoreB: null, playerBParticipantId: null, officialLoserParticipantId: null })
    expect(byes[0].officialWinnerParticipantId).toBe(byes[0].playerAParticipantId)
    const real = r1.filter((m) => m.resultType === 'normal')
    expect(real).toHaveLength(3)
    expect(real.every((m) => m.status === 'awaitingResult' && m.playerAParticipantId && m.playerBParticipantId)).toBe(true)
  })

  it('부전승 선수는 대진을 만들 때 이미 다음 단계 경기 A 자리에 올라가 있다(B는 합류 대기)', () => {
    const bye = r1.find((m) => m.resultType === 'bye')!
    const next = r2.find((m) => m.id === bye.nextMatchId)!
    expect(next.playerAParticipantId).toBe(bye.officialWinnerParticipantId)
    expect(next.playerBParticipantId).toBeNull()
    expect(next.playerBJoinFrom).toBeDefined()
  })

  it('1차전 실제 3경기가 승인되면 다음 단계 A 자리 4개가 모두 차서 생존자는 4명', () => {
    const after = decideRound(built.matches, 1)
    const aSlots = after.filter((m) => m.roundNumber === 2).map((m) => m.playerAParticipantId)
    expect(aSlots.every(Boolean)).toBe(true)
    expect(new Set(aSlots).size).toBe(4)
  })

  it('같은 입력·같은 난수면 같은 대진(재로딩해도 동일) — 저장 후에는 다시 섞지 않는다', () => {
    expect(build(main15R1, 11).matches).toEqual(build(main15R1, 11).matches)
  })

  it('누가 부전승인지는 추첨 결과로 정해진다(난수가 다르면 다른 사람이 받을 수 있다)', () => {
    const recipients = new Set<string>()
    for (let seed = 1; seed <= 40; seed++) {
      recipients.add(build(main15R1, seed).matches.find((m) => m.roundNumber === 1 && m.resultType === 'bye')!.playerAMemberId!)
    }
    expect(recipients.size).toBeGreaterThan(1)
  })

  it('7명이 아니면(6명·8명) 만들지 않는다', () => {
    const a = analysisOf(main15R1)
    const e = entrantsOf(main15R1)
    expect(buildRestartBracket({ sourceTournamentId: SRC, analysis: a, sourceMatches: main15R1, entrants: e.slice(0, 6) }).ok).toBe(false)
    expect(buildRestartBracket({
      sourceTournamentId: SRC, analysis: a, sourceMatches: main15R1,
      entrants: [...e, { participantId: 'm15', memberId: 'm15', handicap: 20 }],
    }).ok).toBe(false)
  })

  it('재대결 회피가 15명에서도 동작한다(여러 난수에서 합류 후보가 이긴 상대와 바로 붙지 않음)', () => {
    const a = analysisOf(main15R1)
    for (let seed = 1; seed <= 60; seed++) {
      const b = build(main15R1, seed)
      expect(b.rematchAvoided).toBe(true)
      a.secondRound.forEach((second, i) => {
        const beaten = [second.playerAParticipantId, second.playerBParticipantId].flatMap((p) => {
          const first = main15R1.find((m) => m.roundNumber === 1 && m.resultType !== 'bye' && m.officialWinnerParticipantId === p)
          if (!first) return [] // 본선 부전승으로 올라온 선수는 이긴 상대가 없다
          return [first.officialLoserParticipantId === first.playerAParticipantId ? first.playerAMemberId : first.playerBMemberId]
        })
        const feeder = b.matches.find((m) => m.roundNumber === 1 && m.nextMatchId === `r2m${i + 1}`)!
        for (const x of beaten) expect([feeder.playerAMemberId, feeder.playerBMemberId]).not.toContain(x)
      })
    }
  })
})

describe('C. 본선 8강 탈락자 합류', () => {
  const restart = build(main15R1).matches

  it('합류 예정 자리 4개가 "본선 8강 탈락자 합류 예정"으로 예약된다', () => {
    const slots = restart.filter((m) => m.playerBJoinFrom)
    expect(slots).toHaveLength(4)
    expect(slots.every((m) => m.playerBJoinLabel === '본선 8강 탈락자 합류 예정')).toBe(true)
  })

  it('승인 대기 패자는 배치하지 않고, official 패자만 순서대로 배치된다', () => {
    const pending = main15R1.map((m) => (m.id === 'r2m4'
      ? { ...m, status: 'awaitingApproval' as const, scoreA: 20, scoreB: 5, calculatedWinnerParticipantId: m.playerAParticipantId } : m))
    expect(pendingRestartJoins(restart, pending)).toEqual([])
    // 본선 부전승 선수(가상선수15)가 들어 있는 본선 8강 경기도 실제 경기라 그 패자는 정상 합류 대상이다
    const fourth = decide(main15R1, 'r2m4', 'A')
    const joins = pendingRestartJoins(restart, fourth)
    expect(joins.map((j) => j.restartMatchId)).toEqual(['r2m4'])
  })

  it('4명 모두 확정되면 다음 단계가 8명(4경기, 두 자리 모두 찬 상태)으로 완성되고 점수 입력이 가능하다', () => {
    let matches = decideRound(restart, 1)
    for (const j of pendingRestartJoins(matches, decideRound(main15R1, 2))) {
      matches = fillJoiner(matches, j.restartMatchId, Number(j.memberId.slice(1)))
    }
    const r2 = matches.filter((m) => m.roundNumber === 2)
    const players = r2.flatMap((m) => [m.playerAParticipantId, m.playerBParticipantId])
    expect(players.every(Boolean)).toBe(true)
    expect(new Set(players).size).toBe(8)
    const r = submitTournamentMatchResult(r2[0], { byMemberId: r2[0].playerAMemberId!, scoreA: 10, scoreB: 5, at: AT })
    expect(r.ok).toBe(true)
  })

  it('8강 → 4강 → 결승까지 진행하면 우승자가 계산된다', () => {
    expect(playThrough(main15R1, restart)).not.toBeNull()
  })
})

describe('D. 기존 규모 회귀 · 지원 범위', () => {
  it('16명: 부전승 없이 1차전 4경기(8명), 합류 4자리 — 기존 동작 그대로', () => {
    const m16 = decideRound(fullMain(16), 1)
    const b = build(m16)
    const r1 = b.matches.filter((m) => m.roundNumber === 1)
    expect(r1).toHaveLength(4)
    expect(r1.every((m) => m.resultType === 'normal')).toBe(true)
    expect(b.matches).toHaveLength(11)
    expect(playThrough(m16, b.matches)).not.toBeNull()
  })

  it('8명: 1차전 2경기(4명), 합류 2자리 → 결승까지 진행된다', () => {
    const m8 = decideRound(fullMain(8), 1)
    const b = build(m8)
    expect(b.matches.filter((m) => m.roundNumber === 1)).toHaveLength(2)
    expect(b.matches.filter((m) => m.playerBJoinFrom)).toHaveLength(2)
    expect(playThrough(m8, b.matches)).not.toBeNull()
  })

  it('32명: 1차전 8경기(16명), 합류 8자리 → 결승까지 진행된다', () => {
    const m32 = decideRound(fullMain(32), 1)
    const b = build(m32)
    expect(b.matches.filter((m) => m.roundNumber === 1)).toHaveLength(8)
    expect(b.matches.filter((m) => m.playerBJoinFrom)).toHaveLength(8)
    expect(playThrough(m32, b.matches)).not.toBeNull()
  })

  it('구조가 성립하지 않는 인원(12명: 리스타트 생존자 2명 ≠ 합류 4명)은 이유를 알려 주고 만들지 않는다', () => {
    const r = analyzeRestartSource(mainWithByes([2, 4, 6, 8]))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toContain('수가 맞지 않아')
  })
})

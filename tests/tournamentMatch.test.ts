import { describe, it, expect } from 'vitest'
import { rate, winnerId } from '../src/logic/game'
import { buildEmptyBracket, buildTournamentMatches, tournamentMatchId } from '../src/logic/tournamentBracket'
import { createTournamentParticipant } from '../src/logic/tournamentDraw'
import {
  tournamentMatchOutcome, submitTournamentMatchResult, verifyTournamentMatchResult,
  adminVerifyTournamentMatchResult, requestTournamentMatchCorrection, correctTournamentMatchResult,
  approveTournamentMatch, declareTournamentForfeit, applyPromotion, promotionFor,
  tournamentRecord, calculateFinalPlacements, canCorrectOfficialResult,
  adminEntersMatchResult, isTournamentRoundOfficial,
} from '../src/logic/tournamentMatch'
import type { Game } from '../src/types'
import type { TournamentMatch, TournamentSeat } from '../src/types/tournament'

// 가상 데이터만 사용한다 — 실제 회원 이름·회원 ID·운영 데이터를 쓰지 않는다.

const ADMIN_UID = 'uid-admin-test'
const AT = '2026-09-01T10:00:00.000Z'

function unwrap<T>(result: { ok: true; value: T } | { ok: false; message: string }): T {
  if (!result.ok) throw new Error(`실패로 끝났습니다: ${result.message}`)
  return result.value
}

function seat(n: number, slotNumber: number, handicap = 20): TournamentSeat {
  return { participantId: `p${n}`, memberId: `m${n}`, handicap, slotNumber }
}

/** 4명 대진(결승까지 3경기). 필요하면 자리별 핸디를 바꿔서 만든다. */
function bracket4(handicaps: Record<number, number> = {}): TournamentMatch[] {
  const nodes = unwrap(buildEmptyBracket(4))
  const seats = [1, 2, 3, 4].map((n) => seat(n, n, handicaps[n] ?? 20))
  return unwrap(buildTournamentMatches(nodes, seats))
}

function firstMatch(matches: TournamentMatch[]): TournamentMatch {
  return matches.find((m) => m.id === tournamentMatchId(1, 1))!
}

/** A쪽 선수가 입력하고 B쪽 선수가 확인한, 관리자 승인 대기 상태의 경기를 만든다. */
function readyForApproval(match: TournamentMatch, scoreA = 18, scoreB = 15): TournamentMatch {
  const submitted = unwrap(
    submitTournamentMatchResult(match, { byMemberId: match.playerAMemberId!, scoreA, scoreB, at: AT }),
  )
  return unwrap(verifyTournamentMatchResult(submitted, { byMemberId: match.playerBMemberId!, at: AT }))
}

describe('참가자·경기 snapshot', () => {
  it('회원 기본 핸디를 바꿔도 이미 만든 참가자 snapshot은 그대로다', () => {
    const member = { id: 'm1', name: '가상회원1', handicap: 20 }
    const participant = createTournamentParticipant(member, { participantId: 'p1' })
    expect(participant.baseHandicapSnapshot).toBe(20)
    expect(participant.tournamentHandicap).toBe(20)

    member.handicap = 26
    expect(participant.baseHandicapSnapshot).toBe(20)
    expect(participant.tournamentHandicap).toBe(20)
  })

  it('회원 이름을 바꿔도 참가자 이름 snapshot은 그대로다', () => {
    const member = { id: 'm1', name: '가상회원1', handicap: 20 }
    const participant = createTournamentParticipant(member, { participantId: 'p1' })
    member.name = '가상회원1-개명'
    expect(participant.displayNameSnapshot).toBe('가상회원1')
  })

  it('대회 적용 핸디를 나중에 바꿔도 이미 만든 경기의 핸디 snapshot은 그대로다', () => {
    const participant = createTournamentParticipant(
      { id: 'm1', name: '가상회원1', handicap: 20 },
      { participantId: 'p1', tournamentHandicap: 18 },
    )
    const nodes = unwrap(buildEmptyBracket(4))
    const seats: TournamentSeat[] = [
      { participantId: participant.id, memberId: participant.memberId, handicap: participant.tournamentHandicap, slotNumber: 1 },
      seat(2, 2), seat(3, 3), seat(4, 4),
    ]
    const matches = unwrap(buildTournamentMatches(nodes, seats))
    expect(firstMatch(matches).playerAHandicapSnapshot).toBe(18)

    participant.tournamentHandicap = 24
    expect(firstMatch(matches).playerAHandicapSnapshot).toBe(18)
  })
})

describe('tournamentMatchOutcome — 기존 달성률 계산 재사용', () => {
  it('달성률은 기존 rate()와 완전히 같은 값이다 (점수 ÷ 적용 핸디, 반올림 없음)', () => {
    const match = { ...firstMatch(bracket4({ 1: 25, 2: 20 })), scoreA: 20, scoreB: 15 }
    const outcome = unwrap(tournamentMatchOutcome(match))
    expect(outcome.rateA).toBe(rate(20, 25))
    expect(outcome.rateB).toBe(rate(15, 20))
    expect(outcome.rateA).toBe(0.8)
  })

  it('표시상 같은 정수 %가 되어도 원래 숫자로 승패를 가른다', () => {
    // 17/23 ≒ 0.73913 (74%), 20/27 ≒ 0.74074 (74%) — 화면에는 둘 다 74%로 보인다.
    const match = { ...firstMatch(bracket4({ 1: 23, 2: 27 })), scoreA: 17, scoreB: 20 }
    const outcome = unwrap(tournamentMatchOutcome(match))
    expect(Math.round(outcome.rateA * 100)).toBe(Math.round(outcome.rateB * 100))
    expect(outcome.rateA).not.toBe(outcome.rateB)
    expect(outcome.winnerParticipantId).toBe('p2')
    expect(outcome.isTie).toBe(false)
  })

  it('기존 일반 경기 winnerId()와 판정이 어긋나지 않는다', () => {
    const cases: [number, number, number, number][] = [
      [25, 20, 20, 15],
      [23, 27, 17, 20],
      [20, 10, 10, 5],
      [20, 20, 0, 1],
    ]
    for (const [handicapA, handicapB, scoreA, scoreB] of cases) {
      const match = { ...firstMatch(bracket4({ 1: handicapA, 2: handicapB })), scoreA, scoreB }
      const outcome = unwrap(tournamentMatchOutcome(match))
      const asGame: Game = {
        id: 'g', playerAId: 'p1', playerBId: 'p2',
        handicapA, handicapB, scoreA, scoreB, endType: 'time', playedAt: AT,
      }
      expect(outcome.winnerParticipantId).toBe(winnerId(asGame))
    }
  })

  it('점수가 없으면 계산하지 않는다', () => {
    expect(tournamentMatchOutcome(firstMatch(bracket4())).ok).toBe(false)
  })
})

describe('결과 입력', () => {
  it('A쪽 선수가 입력할 수 있다', () => {
    const result = submitTournamentMatchResult(firstMatch(bracket4()), { byMemberId: 'm1', scoreA: 18, scoreB: 15, at: AT })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.resultLog?.submittedByMemberId).toBe('m1')
  })

  it('B쪽 선수도 입력할 수 있다', () => {
    const result = submitTournamentMatchResult(firstMatch(bracket4()), { byMemberId: 'm2', scoreA: 18, scoreB: 15, at: AT })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.resultLog?.submittedByMemberId).toBe('m2')
  })

  it('이 경기에 나오지 않은 사람은 입력할 수 없다', () => {
    const result = submitTournamentMatchResult(firstMatch(bracket4()), { byMemberId: 'm3', scoreA: 18, scoreB: 15, at: AT })
    expect(result.ok).toBe(false)
  })

  it('입력만으로는 공식 승자가 생기지 않는다', () => {
    const submitted = unwrap(submitTournamentMatchResult(firstMatch(bracket4()), { byMemberId: 'm1', scoreA: 18, scoreB: 15, at: AT }))
    expect(submitted.status).toBe('awaitingVerification')
    expect(submitted.calculatedWinnerParticipantId).toBe('p1')
    expect(submitted.officialWinnerParticipantId).toBeUndefined()
    expect(promotionFor(submitted)).toBeNull()
  })

  it('적용 핸디를 넘는 점수는 거부한다 (일반 경기와 같은 규칙)', () => {
    const result = submitTournamentMatchResult(firstMatch(bracket4()), { byMemberId: 'm1', scoreA: 21, scoreB: 15, at: AT })
    expect(result.ok).toBe(false)
  })

  it('이미 입력된 경기에 다시 입력할 수 없다', () => {
    const submitted = unwrap(submitTournamentMatchResult(firstMatch(bracket4()), { byMemberId: 'm1', scoreA: 18, scoreB: 15, at: AT }))
    expect(submitTournamentMatchResult(submitted, { byMemberId: 'm2', scoreA: 1, scoreB: 20, at: AT }).ok).toBe(false)
  })

  it('원본 경기 객체를 바꾸지 않는다', () => {
    const match = firstMatch(bracket4())
    submitTournamentMatchResult(match, { byMemberId: 'm1', scoreA: 18, scoreB: 15, at: AT })
    expect(match.scoreA).toBeNull()
    expect(match.status).toBe('awaitingResult')
  })
})

describe('상대 확인', () => {
  it('입력하지 않은 상대는 확인할 수 있다', () => {
    const submitted = unwrap(submitTournamentMatchResult(firstMatch(bracket4()), { byMemberId: 'm1', scoreA: 18, scoreB: 15, at: AT }))
    const verified = unwrap(verifyTournamentMatchResult(submitted, { byMemberId: 'm2', at: AT }))
    expect(verified.status).toBe('awaitingApproval')
    expect(verified.resultLog?.verificationType).toBe('player')
    expect(verified.resultLog?.verifiedByMemberId).toBe('m2')
  })

  it('입력한 사람은 같은 경기를 확인할 수 없다', () => {
    const submitted = unwrap(submitTournamentMatchResult(firstMatch(bracket4()), { byMemberId: 'm1', scoreA: 18, scoreB: 15, at: AT }))
    const result = verifyTournamentMatchResult(submitted, { byMemberId: 'm1', at: AT })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('입력한 사람은')
  })

  it('B가 입력하면 A가 확인한다', () => {
    const submitted = unwrap(submitTournamentMatchResult(firstMatch(bracket4()), { byMemberId: 'm2', scoreA: 18, scoreB: 15, at: AT }))
    expect(verifyTournamentMatchResult(submitted, { byMemberId: 'm2', at: AT }).ok).toBe(false)
    expect(verifyTournamentMatchResult(submitted, { byMemberId: 'm1', at: AT }).ok).toBe(true)
  })

  it('제3자는 확인할 수 없다', () => {
    const submitted = unwrap(submitTournamentMatchResult(firstMatch(bracket4()), { byMemberId: 'm1', scoreA: 18, scoreB: 15, at: AT }))
    expect(verifyTournamentMatchResult(submitted, { byMemberId: 'm3', at: AT }).ok).toBe(false)
  })

  it('상대 확인만으로는 공식 승자가 생기지 않는다', () => {
    const verified = readyForApproval(firstMatch(bracket4()))
    expect(verified.status).toBe('awaitingApproval')
    expect(verified.officialWinnerParticipantId).toBeUndefined()
    expect(promotionFor(verified)).toBeNull()
  })

  it('관리자 직권 확인은 회원 확인과 데이터상 구분된다', () => {
    const submitted = unwrap(submitTournamentMatchResult(firstMatch(bracket4()), { byMemberId: 'm1', scoreA: 18, scoreB: 15, at: AT }))
    const verified = unwrap(adminVerifyTournamentMatchResult(submitted, { adminUid: ADMIN_UID, at: AT }))
    expect(verified.resultLog?.verificationType).toBe('adminOverride')
    expect(verified.resultLog?.verifiedByAdminUid).toBe(ADMIN_UID)
    expect(verified.resultLog?.verifiedByMemberId).toBeUndefined()
    expect(verified.status).toBe('awaitingApproval')
  })
})

describe('수정 요청 → 관리자 수정', () => {
  it('상대가 수정을 요청하면 확인 대기 상태로 남고 회원 확인이 막힌다', () => {
    const submitted = unwrap(submitTournamentMatchResult(firstMatch(bracket4()), { byMemberId: 'm1', scoreA: 18, scoreB: 15, at: AT }))
    const requested = unwrap(requestTournamentMatchCorrection(submitted, { byMemberId: 'm2', at: AT }))
    expect(requested.resultLog?.correctionRequested).toBe(true)
    expect(requested.status).toBe('awaitingVerification')
    expect(verifyTournamentMatchResult(requested, { byMemberId: 'm2', at: AT }).ok).toBe(false)
  })

  it('입력한 사람은 수정을 요청할 수 없다', () => {
    const submitted = unwrap(submitTournamentMatchResult(firstMatch(bracket4()), { byMemberId: 'm1', scoreA: 18, scoreB: 15, at: AT }))
    expect(requestTournamentMatchCorrection(submitted, { byMemberId: 'm1', at: AT }).ok).toBe(false)
  })

  it('관리자가 고치면 승인 대기 상태가 되고 승자가 다시 계산된다', () => {
    const submitted = unwrap(submitTournamentMatchResult(firstMatch(bracket4()), { byMemberId: 'm1', scoreA: 18, scoreB: 15, at: AT }))
    const requested = unwrap(requestTournamentMatchCorrection(submitted, { byMemberId: 'm2', at: AT }))
    const corrected = unwrap(correctTournamentMatchResult(requested, { adminUid: ADMIN_UID, scoreA: 12, scoreB: 19, at: AT }))
    expect(corrected.status).toBe('awaitingApproval')
    expect(corrected.resultLog?.correctionRequested).toBe(false)
    expect(corrected.resultLog?.correctedByAdminUid).toBe(ADMIN_UID)
    expect(corrected.calculatedWinnerParticipantId).toBe('p2')
  })

  it('공식 확정된 경기는 일반 수정으로 고칠 수 없다', () => {
    const approved = unwrap(approveTournamentMatch(readyForApproval(firstMatch(bracket4())), { adminUid: ADMIN_UID, at: AT }))
    const result = correctTournamentMatchResult(approved.match, { adminUid: ADMIN_UID, scoreA: 1, scoreB: 2, at: AT })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('공식 결과 정정')
  })
})

describe('관리자 최종 승인', () => {
  it('승인해야만 공식 승자·패자가 생긴다', () => {
    const approved = unwrap(approveTournamentMatch(readyForApproval(firstMatch(bracket4())), { adminUid: ADMIN_UID, at: AT }))
    expect(approved.match.status).toBe('official')
    expect(approved.match.officialWinnerParticipantId).toBe('p1')
    expect(approved.match.officialLoserParticipantId).toBe('p2')
    expect(approved.match.resultLog?.approvedByAdminUid).toBe(ADMIN_UID)
  })

  it('확인 전에는 승인할 수 없다', () => {
    const submitted = unwrap(submitTournamentMatchResult(firstMatch(bracket4()), { byMemberId: 'm1', scoreA: 18, scoreB: 15, at: AT }))
    const result = approveTournamentMatch(submitted, { adminUid: ADMIN_UID, at: AT })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('상대 참가자 확인')
  })

  it('승인 시에만 다음 라운드 진출 결과가 만들어진다', () => {
    const approved = unwrap(approveTournamentMatch(readyForApproval(firstMatch(bracket4())), { adminUid: ADMIN_UID, at: AT }))
    expect(approved.promotion).toEqual({
      nextMatchId: tournamentMatchId(2, 1),
      nextSlot: 'playerA',
      participantId: 'p1',
      memberId: 'm1',
      handicap: 20,
    })
  })

  it('진출 결과를 적용하면 다음 경기 자리가 채워진다', () => {
    const matches = bracket4()
    const approved = unwrap(approveTournamentMatch(readyForApproval(firstMatch(matches)), { adminUid: ADMIN_UID, at: AT }))
    const final = matches.find((m) => m.id === tournamentMatchId(2, 1))!
    const filled = applyPromotion(final, approved.promotion!)
    expect(filled.playerAParticipantId).toBe('p1')
    expect(filled.playerAHandicapSnapshot).toBe(20)
    expect(filled.playerBParticipantId).toBeNull()
  })

  it('결승은 다음 경기가 없으므로 진출 결과가 없다', () => {
    const nodes = unwrap(buildEmptyBracket(2))
    const matches = unwrap(buildTournamentMatches(nodes, [seat(1, 1), seat(2, 2)]))
    const approved = unwrap(approveTournamentMatch(readyForApproval(matches[0]), { adminUid: ADMIN_UID, at: AT }))
    expect(approved.match.nextMatchId).toBeNull()
    expect(approved.promotion).toBeNull()
  })

  it('같은 경기를 두 번 승인할 수 없다', () => {
    const approved = unwrap(approveTournamentMatch(readyForApproval(firstMatch(bracket4())), { adminUid: ADMIN_UID, at: AT }))
    expect(approveTournamentMatch(approved.match, { adminUid: ADMIN_UID, at: AT }).ok).toBe(false)
  })

  it('부전승은 승인 절차를 거치지 않는다', () => {
    const nodes = unwrap(buildEmptyBracket(4))
    const matches = unwrap(buildTournamentMatches(nodes, [seat(1, 1), seat(2, 2), seat(3, 3)]))
    const byeMatch = matches.find((m) => m.resultType === 'bye')!
    expect(approveTournamentMatch(byeMatch, { adminUid: ADMIN_UID, at: AT }).ok).toBe(false)
  })
})

describe('동률', () => {
  const tieMatch = () => {
    // 10/20 = 0.5, 5/10 = 0.5 — 달성률이 완전히 같다.
    const matches = bracket4({ 1: 20, 2: 10 })
    return readyForApproval(firstMatch(matches), 10, 5)
  }

  it('달성률이 같으면 동률로 감지한다', () => {
    const outcome = unwrap(tournamentMatchOutcome(tieMatch()))
    expect(outcome.isTie).toBe(true)
    expect(outcome.winnerParticipantId).toBeNull()
  })

  it('시스템이 임의로 승자를 만들지 않는다 — 승인이 거부된다', () => {
    const result = approveTournamentMatch(tieMatch(), { adminUid: ADMIN_UID, at: AT })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('관리자가 승자를 지정')
  })

  it('관리자가 승자를 지정하면 승인된다', () => {
    const approved = unwrap(
      approveTournamentMatch(tieMatch(), { adminUid: ADMIN_UID, at: AT, officialWinnerParticipantId: 'p2' }),
    )
    expect(approved.match.officialWinnerParticipantId).toBe('p2')
    expect(approved.match.officialLoserParticipantId).toBe('p1')
    expect(approved.promotion?.participantId).toBe('p2')
  })

  it('이 경기에 나오지 않은 사람을 승자로 지정할 수 없다', () => {
    expect(
      approveTournamentMatch(tieMatch(), { adminUid: ADMIN_UID, at: AT, officialWinnerParticipantId: 'p4' }).ok,
    ).toBe(false)
  })
})

describe('기권', () => {
  it('경기 전 기권은 점수 없이 상대 기권승으로 확정된다', () => {
    const forfeited = unwrap(
      declareTournamentForfeit(firstMatch(bracket4()), { adminUid: ADMIN_UID, at: AT, winnerParticipantId: 'p2' }),
    )
    expect(forfeited.match.resultType).toBe('forfeit')
    expect(forfeited.match.status).toBe('official')
    expect(forfeited.match.scoreA).toBeNull()
    expect(forfeited.match.scoreB).toBeNull()
    expect(forfeited.match.officialWinnerParticipantId).toBe('p2')
    expect(forfeited.match.officialLoserParticipantId).toBe('p1')
    expect(forfeited.promotion?.participantId).toBe('p2')
  })

  it('이미 공식 확정된 경기는 기권 처리할 수 없다', () => {
    const approved = unwrap(approveTournamentMatch(readyForApproval(firstMatch(bracket4())), { adminUid: ADMIN_UID, at: AT }))
    expect(
      declareTournamentForfeit(approved.match, { adminUid: ADMIN_UID, at: AT, winnerParticipantId: 'p1' }).ok,
    ).toBe(false)
  })
})

describe('tournamentRecord — 부전승은 경기수·승수에서 뺀다', () => {
  it('부전승으로 올라간 참가자는 경기수도 승수도 늘지 않는다', () => {
    const nodes = unwrap(buildEmptyBracket(4))
    const matches = unwrap(buildTournamentMatches(nodes, [seat(1, 1), seat(2, 2), seat(3, 3)]))
    expect(tournamentRecord(matches, 'p3')).toEqual({ played: 0, wins: 0, losses: 0 })
  })

  it('실제로 친 경기만 센다', () => {
    const matches = bracket4()
    const approved = unwrap(approveTournamentMatch(readyForApproval(firstMatch(matches)), { adminUid: ADMIN_UID, at: AT }))
    const all = matches.map((m) => (m.id === approved.match.id ? approved.match : m))
    expect(tournamentRecord(all, 'p1')).toEqual({ played: 1, wins: 1, losses: 0 })
    expect(tournamentRecord(all, 'p2')).toEqual({ played: 1, wins: 0, losses: 1 })
  })

  it('승인 전 경기는 세지 않는다', () => {
    const matches = bracket4()
    const pending = readyForApproval(firstMatch(matches))
    const all = matches.map((m) => (m.id === pending.id ? pending : m))
    expect(tournamentRecord(all, 'p1')).toEqual({ played: 0, wins: 0, losses: 0 })
  })
})

describe('canCorrectOfficialResult — 공식 결과 정정 보호', () => {
  const officialMatch = (overrides: Partial<TournamentMatch> = {}): TournamentMatch => ({
    ...firstMatch(bracket4()),
    scoreA: 18,
    scoreB: 15,
    status: 'official',
    officialWinnerParticipantId: 'p1',
    officialLoserParticipantId: 'p2',
    ...overrides,
  })

  it('아직 공식 확정 전이면 이 판정 대상이 아니다', () => {
    const result = canCorrectOfficialResult(firstMatch(bracket4()), null)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('일반 수정')
  })

  it('다음 경기가 아직 시작 전이면 정정할 수 있다', () => {
    const next = { ...firstMatch(bracket4()), id: 'r2m1', status: 'awaitingResult' as const }
    expect(canCorrectOfficialResult(officialMatch(), next).ok).toBe(true)
  })

  it('다음 경기에 결과가 입력됐으면 막는다', () => {
    const next = { ...firstMatch(bracket4()), id: 'r2m1', status: 'awaitingVerification' as const }
    expect(canCorrectOfficialResult(officialMatch(), next).ok).toBe(false)
  })

  it('다음 경기가 공식 확정됐으면 막는다', () => {
    const next = { ...firstMatch(bracket4()), id: 'r2m1', status: 'official' as const }
    const result = canCorrectOfficialResult(officialMatch(), next)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('공식 확정')
  })

  it('결승은 뒤에 아무것도 없으므로 언제나 정정할 수 있다', () => {
    expect(canCorrectOfficialResult(officialMatch({ nextMatchId: null, nextSlot: null }), null).ok).toBe(true)
  })

  it('다음 경기를 못 찾으면 안전한 쪽으로 막는다', () => {
    expect(canCorrectOfficialResult(officialMatch(), null).ok).toBe(false)
  })
})

describe('calculateFinalPlacements', () => {
  /** 4명 대진을 끝까지 진행해 우승·준우승·공동 3위를 만든다. */
  function playFullBracket4(): TournamentMatch[] {
    let matches = bracket4()
    const finish = (matchId: string, scoreA: number, scoreB: number) => {
      const target = matches.find((m) => m.id === matchId)!
      const approved = unwrap(
        approveTournamentMatch(readyForApproval(target, scoreA, scoreB), { adminUid: ADMIN_UID, at: AT }),
      )
      matches = matches.map((m) => (m.id === approved.match.id ? approved.match : m))
      if (approved.promotion) {
        const next = matches.find((m) => m.id === approved.promotion!.nextMatchId)!
        const filled = applyPromotion(next, approved.promotion)
        matches = matches.map((m) => (m.id === filled.id ? filled : m))
      }
    }
    finish(tournamentMatchId(1, 1), 18, 15) // p1 승
    finish(tournamentMatchId(1, 2), 12, 19) // p4 승
    finish(tournamentMatchId(2, 1), 20, 14) // 결승: p1 승
    return matches
  }

  it('결승 승자가 우승, 결승 패자가 준우승', () => {
    const placements = calculateFinalPlacements(playFullBracket4())
    expect(placements.championParticipantId).toBe('p1')
    expect(placements.runnerUpParticipantId).toBe('p4')
  })

  it('준결승에서 진 두 명이 공동 3위', () => {
    const placements = calculateFinalPlacements(playFullBracket4())
    expect(placements.thirdPlaceParticipantIds.sort()).toEqual(['p2', 'p3'])
  })

  it('아직 결승이 안 끝났으면 우승자가 없다', () => {
    const placements = calculateFinalPlacements(bracket4())
    expect(placements.championParticipantId).toBeNull()
    expect(placements.runnerUpParticipantId).toBeNull()
  })

  it('2명 대진은 공동 3위가 없다', () => {
    const nodes = unwrap(buildEmptyBracket(2))
    const matches = unwrap(buildTournamentMatches(nodes, [seat(1, 1), seat(2, 2)]))
    const approved = unwrap(approveTournamentMatch(readyForApproval(matches[0]), { adminUid: ADMIN_UID, at: AT }))
    const placements = calculateFinalPlacements([approved.match])
    expect(placements.championParticipantId).toBe('p1')
    expect(placements.runnerUpParticipantId).toBe('p2')
    expect(placements.thirdPlaceParticipantIds).toEqual([])
  })

  it('부전승으로 결승에 오른 경우 그 준결승은 공동 3위를 만들지 않는다', () => {
    const nodes = unwrap(buildEmptyBracket(4))
    const matches = unwrap(buildTournamentMatches(nodes, [seat(1, 1), seat(2, 2), seat(3, 3)]))
    const placements = calculateFinalPlacements(matches)
    expect(placements.thirdPlaceParticipantIds).toEqual([])
  })

  describe('3·4위전이 있는 대회', () => {
    /** 준결승 패자 둘(p2, p3)이 맞붙는 3·4위전 하나를 공식 확정 상태로 만들어 덧붙인다. */
    function withThirdPlaceMatch(winnerParticipantId: 'p2' | 'p3'): TournamentMatch[] {
      const loserParticipantId = winnerParticipantId === 'p2' ? 'p3' : 'p2'
      const thirdPlaceMatch: TournamentMatch = {
        id: 'r2-third-place',
        roundNumber: 3,
        playerCountInRound: 3,
        matchNumber: 1,
        playerAParticipantId: 'p2',
        playerBParticipantId: 'p3',
        playerAMemberId: 'm2',
        playerBMemberId: 'm3',
        playerAHandicapSnapshot: 20,
        playerBHandicapSnapshot: 20,
        scoreA: winnerParticipantId === 'p2' ? 18 : 12,
        scoreB: winnerParticipantId === 'p3' ? 18 : 12,
        resultType: 'normal',
        status: 'official',
        officialWinnerParticipantId: winnerParticipantId,
        officialLoserParticipantId: loserParticipantId,
        nextMatchId: null,
        nextSlot: null,
      }
      return [...playFullBracket4(), thirdPlaceMatch]
    }

    it('3·4위전 승자가 3위, 패자가 4위로 각각 단독 표시된다(공동 3위가 아니다)', () => {
      const placements = calculateFinalPlacements(withThirdPlaceMatch('p2'))
      expect(placements.thirdPlaceParticipantIds).toEqual(['p2'])
      expect(placements.fourthPlaceParticipantId).toBe('p3')
    })

    it('3·4위전 승자가 바뀌면 순위도 그대로 따라간다', () => {
      const placements = calculateFinalPlacements(withThirdPlaceMatch('p3'))
      expect(placements.thirdPlaceParticipantIds).toEqual(['p3'])
      expect(placements.fourthPlaceParticipantId).toBe('p2')
    })

    it('우승·준우승은 3·4위전이 있어도 결승 결과 그대로다', () => {
      const placements = calculateFinalPlacements(withThirdPlaceMatch('p2'))
      expect(placements.championParticipantId).toBe('p1')
      expect(placements.runnerUpParticipantId).toBe('p4')
    })

    it('3·4위전이 아직 공식 확정 전이면(진행 중), 결정될 때까지는 준결승 패자 둘을 공동 3위로 보여준다', () => {
      const matches = withThirdPlaceMatch('p2').map((m) =>
        m.id === 'r2-third-place' ? { ...m, status: 'awaitingResult' as const, officialWinnerParticipantId: undefined, officialLoserParticipantId: undefined } : m,
      )
      const placements = calculateFinalPlacements(matches)
      expect(placements.thirdPlaceParticipantIds.sort()).toEqual(['p2', 'p3'])
      expect(placements.fourthPlaceParticipantId).toBeUndefined()
    })

    it('3·4위전이 없는 기존 대회는 fourthPlaceParticipantId가 아예 없다(undefined) — 기존 동작 유지', () => {
      const placements = calculateFinalPlacements(playFullBracket4())
      expect(placements.thirdPlaceParticipantIds.sort()).toEqual(['p2', 'p3'])
      expect(placements.fourthPlaceParticipantId).toBeUndefined()
    })
  })
})

describe('adminEntersMatchResult — 관리자가 현장에서 직접 입력', () => {
  it('입력해도 곧바로 공식 확정되지 않고 상대 확인 대기로만 간다', () => {
    const match = firstMatch(bracket4())
    const entered = unwrap(adminEntersMatchResult(match, { adminUid: ADMIN_UID, scoreA: 18, scoreB: 15, at: AT }))
    expect(entered.status).toBe('awaitingVerification')
    expect(entered.officialWinnerParticipantId).toBeUndefined()
  })

  it('입력자를 resultLog가 아니라 최상위 필드에 기록한다(회원 확인 Rules 화이트리스트 보호)', () => {
    const match = firstMatch(bracket4())
    const entered = unwrap(adminEntersMatchResult(match, { adminUid: ADMIN_UID, scoreA: 18, scoreB: 15, at: AT }))
    expect(entered.enteredByAdminUid).toBe(ADMIN_UID)
    expect(entered.enteredAt).toBe(AT)
    expect(entered.resultLog?.submittedByMemberId).toBeUndefined()
    expect(Object.keys(entered.resultLog ?? {})).toEqual(['correctionRequested'])
  })

  it('점수·핸디로 계산상 승자를 미리 계산해 둔다', () => {
    const match = firstMatch(bracket4())
    const entered = unwrap(adminEntersMatchResult(match, { adminUid: ADMIN_UID, scoreA: 18, scoreB: 15, at: AT }))
    expect(entered.calculatedWinnerParticipantId).toBe('p1')
  })

  it('관리자가 입력한 결과는 두 선수 중 아무나 확인할 수 있다(입력자 본인 차단 조건이 적용되지 않는다)', () => {
    const match = firstMatch(bracket4())
    const entered = unwrap(adminEntersMatchResult(match, { adminUid: ADMIN_UID, scoreA: 18, scoreB: 15, at: AT }))
    const verifiedByA = verifyTournamentMatchResult(entered, { byMemberId: match.playerAMemberId!, at: AT })
    const verifiedByB = verifyTournamentMatchResult(entered, { byMemberId: match.playerBMemberId!, at: AT })
    expect(verifiedByA.ok).toBe(true)
    expect(verifiedByB.ok).toBe(true)
  })

  it('점수 검증(핸디 초과 등)은 회원 입력과 같은 규칙을 그대로 쓴다', () => {
    const match = firstMatch(bracket4())
    const result = adminEntersMatchResult(match, { adminUid: ADMIN_UID, scoreA: 999, scoreB: 15, at: AT })
    expect(result.ok).toBe(false)
  })

  it('이미 결과가 입력된 경기에는 다시 입력할 수 없다', () => {
    const match = firstMatch(bracket4())
    const entered = unwrap(adminEntersMatchResult(match, { adminUid: ADMIN_UID, scoreA: 18, scoreB: 15, at: AT }))
    const again = adminEntersMatchResult(entered, { adminUid: ADMIN_UID, scoreA: 10, scoreB: 5, at: AT })
    expect(again.ok).toBe(false)
  })

  it('부전승 경기에는 입력할 수 없다', () => {
    const nodes = unwrap(buildEmptyBracket(4))
    const matches = unwrap(buildTournamentMatches(nodes, [seat(1, 1), seat(2, 2), seat(3, 3)]))
    const bye = matches.find((m) => m.resultType === 'bye')!
    expect(adminEntersMatchResult(bye, { adminUid: ADMIN_UID, scoreA: 1, scoreB: 1, at: AT }).ok).toBe(false)
  })
})

describe('isTournamentRoundOfficial — 라운드 확정 판정', () => {
  it('경기가 하나도 official이 아니면 확정이 아니다', () => {
    const matches = bracket4()
    expect(isTournamentRoundOfficial(matches, 1)).toBe(false)
  })

  it('일부만 official이면 아직 확정이 아니다', () => {
    const matches = bracket4()
    const approved = unwrap(approveTournamentMatch(readyForApproval(firstMatch(matches)), { adminUid: ADMIN_UID, at: AT }))
    const updated = matches.map((m) => (m.id === approved.match.id ? approved.match : m))
    expect(isTournamentRoundOfficial(updated, 1)).toBe(false)
  })

  it('그 라운드 경기가 모두 official이면 확정이다', () => {
    const matches = bracket4()
    const r1m1 = unwrap(approveTournamentMatch(readyForApproval(matches[0]), { adminUid: ADMIN_UID, at: AT }))
    const r1m2 = unwrap(approveTournamentMatch(readyForApproval(matches[1]), { adminUid: ADMIN_UID, at: AT }))
    const updated = matches.map((m) => {
      if (m.id === r1m1.match.id) return r1m1.match
      if (m.id === r1m2.match.id) return r1m2.match
      return m
    })
    expect(isTournamentRoundOfficial(updated, 1)).toBe(true)
    expect(isTournamentRoundOfficial(updated, 2)).toBe(false)
  })

  it('부전승은 대진 생성 시점에 이미 official이므로 그대로 확정 판정에 포함된다', () => {
    const nodes = unwrap(buildEmptyBracket(4))
    const matches = unwrap(buildTournamentMatches(nodes, [seat(1, 1), seat(2, 2), seat(3, 3)]))
    // 3명 대진(4자리 중 1자리 부전승) — 1라운드 두 경기 중 하나는 정상, 하나는 부전승.
    const normal = matches.find((m) => m.resultType === 'normal' && m.roundNumber === 1)!
    const approved = unwrap(approveTournamentMatch(readyForApproval(normal), { adminUid: ADMIN_UID, at: AT }))
    const updated = matches.map((m) => (m.id === approved.match.id ? approved.match : m))
    expect(isTournamentRoundOfficial(updated, 1)).toBe(true)
  })

  it('없는 라운드 번호는 확정이 아니다', () => {
    const matches = bracket4()
    expect(isTournamentRoundOfficial(matches, 99)).toBe(false)
  })
})

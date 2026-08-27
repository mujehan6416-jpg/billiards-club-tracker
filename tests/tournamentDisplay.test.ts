import { describe, it, expect } from 'vitest'
import { matchMemberStatusMessage, rateDisplay } from '../src/components/tournament/tournamentDisplay'
import type { TournamentMatch } from '../src/types/tournament'

function match(over: Partial<TournamentMatch> = {}): TournamentMatch {
  return {
    id: 'r1m1', roundNumber: 1, playerCountInRound: 8, matchNumber: 1,
    playerAParticipantId: 'pA', playerBParticipantId: 'pB',
    playerAMemberId: 'mA', playerBMemberId: 'mB',
    playerAHandicapSnapshot: 20, playerBHandicapSnapshot: 25,
    scoreA: null, scoreB: null, resultType: 'normal', status: 'awaitingResult',
    nextMatchId: 'r2m1', nextSlot: 'playerA',
    ...over,
  }
}

describe('rateDisplay', () => {
  it('점수/핸디와 반올림한 퍼센트를 함께 보여준다', () => {
    expect(rateDisplay(15, 20)).toBe('15/20 (75%)')
  })

  it('반올림하면 같아 보이는 두 값도 분수로는 구별된다', () => {
    // 15/20=75%, 17/25=68% — 둘 다 "약 70%대"처럼 보이는 착시를 막기 위한 케이스.
    expect(rateDisplay(15, 20)).toBe('15/20 (75%)')
    expect(rateDisplay(17, 25)).toBe('17/25 (68%)')
  })
})

describe('matchMemberStatusMessage', () => {
  it('부전승 경기는 항상 같은 문구를 보여준다(뷰어와 무관)', () => {
    expect(matchMemberStatusMessage(match({ resultType: 'bye' }), 'mA')).toBe('부전승으로 다음 라운드에 진출했습니다.')
  })

  it('공식 확정된 경기는 뷰어와 무관하게 "공식 결과" 문구를 보여준다', () => {
    expect(matchMemberStatusMessage(match({ status: 'official' }), undefined)).toBe('공식 결과가 확정되었습니다.')
  })

  it('내부 상태 문자열(awaitingResult 등)을 그대로 노출하지 않는다', () => {
    const msg = matchMemberStatusMessage(match({ status: 'awaitingResult' }), 'mA')
    expect(msg).not.toMatch(/awaiting/i)
  })

  it('당사자에게는 "입력해 주세요", 구경하는 회원에게는 "입력되지 않았습니다"로 나뉜다', () => {
    expect(matchMemberStatusMessage(match(), 'mA')).toBe('경기 결과를 입력해 주세요.')
    expect(matchMemberStatusMessage(match(), 'mC')).toBe('아직 경기 결과가 입력되지 않았습니다.')
  })

  it('수정 요청이 있으면 다른 상태보다 우선해서 안내한다', () => {
    const m = match({ status: 'awaitingVerification', resultLog: { correctionRequested: true } })
    expect(matchMemberStatusMessage(m, 'mA')).toBe('상대가 결과 수정을 요청했습니다. 관리자 확인을 기다리고 있습니다.')
  })

  it('입력자 본인과 상대에게 서로 다른 확인 문구를 보여준다', () => {
    const m = match({ status: 'awaitingVerification', resultLog: { submittedByMemberId: 'mA' } })
    expect(matchMemberStatusMessage(m, 'mA')).toBe('상대가 입력한 결과를 확인하기를 기다리고 있습니다.')
    expect(matchMemberStatusMessage(m, 'mB')).toBe('상대가 입력한 결과를 확인해 주세요.')
  })

  it('관리자 승인 대기 상태는 "관리자 확인을 기다리고 있습니다"로 보여준다', () => {
    expect(matchMemberStatusMessage(match({ status: 'awaitingApproval' }), 'mA')).toBe('관리자 확인을 기다리고 있습니다.')
  })
})

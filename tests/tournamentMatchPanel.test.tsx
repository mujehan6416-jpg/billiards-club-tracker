import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TournamentMatchPanel } from '../src/components/tournament/TournamentMatchPanel'
import type { TournamentMatch } from '../src/types/tournament'

// 가상 데이터만 사용한다 — 실제 회원·경기 데이터가 아니다.

function match(over: Partial<TournamentMatch> = {}): TournamentMatch {
  return {
    id: 'r1m1', roundNumber: 1, playerCountInRound: 8, matchNumber: 1,
    playerAParticipantId: 'pA', playerBParticipantId: 'pB',
    playerAMemberId: 'mA', playerBMemberId: 'mB',
    playerAHandicapSnapshot: 20, playerBHandicapSnapshot: 20,
    scoreA: null, scoreB: null, resultType: 'normal', status: 'awaitingResult',
    nextMatchId: 'r2m1', nextSlot: 'playerA',
    ...over,
  }
}

const nameOf = (id: string | null) => (id === 'pA' ? '가상회원A' : id === 'pB' ? '가상회원B' : '')

const noop = {
  onClose: vi.fn(), onSubmitResult: vi.fn(), onVerify: vi.fn(), onRequestCorrection: vi.fn(),
  onAdminVerify: vi.fn(), onAdminCorrect: vi.fn(), onApprove: vi.fn(), onForfeit: vi.fn(),
}

describe('awaitingResult — 결과 입력', () => {
  it('경기 당사자에게는 점수 입력칸과 입력 버튼이 보인다', () => {
    render(<TournamentMatchPanel match={match()} nameOf={nameOf} viewerMemberId="mA" isAdmin={false} {...noop} />)
    expect(screen.getByText('가상회원A 점수')).toBeInTheDocument()
    expect(screen.getByText('결과 입력')).toBeInTheDocument()
  })

  it('두 점수를 모두 입력해야 입력 버튼이 활성화된다', () => {
    render(<TournamentMatchPanel match={match()} nameOf={nameOf} viewerMemberId="mA" isAdmin={false} {...noop} />)
    expect(screen.getByText('결과 입력')).toBeDisabled()
  })

  it('당사자가 아닌 회원에게는 입력칸이 보이지 않고 안내 문구만 보인다', () => {
    render(<TournamentMatchPanel match={match()} nameOf={nameOf} viewerMemberId="mC" isAdmin={false} {...noop} />)
    expect(screen.queryByText('결과 입력')).not.toBeInTheDocument()
    expect(screen.getByText('아직 경기 결과가 입력되지 않았습니다.')).toBeInTheDocument()
  })

  it('점수를 입력하고 버튼을 누르면 onSubmitResult가 두 점수로 호출된다', () => {
    const onSubmitResult = vi.fn()
    render(<TournamentMatchPanel match={match()} nameOf={nameOf} viewerMemberId="mA" isAdmin={false} {...noop} onSubmitResult={onSubmitResult} />)
    const inputs = screen.getAllByRole('spinbutton')
    fireEvent.change(inputs[0], { target: { value: '15' } })
    fireEvent.change(inputs[1], { target: { value: '12' } })
    fireEvent.click(screen.getByText('결과 입력'))
    expect(onSubmitResult).toHaveBeenCalledWith('15', '12')
  })
})

describe('awaitingVerification — 상대 확인', () => {
  const m = match({
    status: 'awaitingVerification', scoreA: 15, scoreB: 12,
    resultLog: { submittedByMemberId: 'mA', submittedAt: '2026-01-01' },
  })

  it('입력하지 않은 상대에게는 확인/수정요청 버튼이 보인다', () => {
    render(<TournamentMatchPanel match={m} nameOf={nameOf} viewerMemberId="mB" isAdmin={false} {...noop} />)
    expect(screen.getByText('결과가 맞습니다')).toBeInTheDocument()
    expect(screen.getByText('결과가 다릅니다 (수정 요청)')).toBeInTheDocument()
  })

  it('입력한 본인에게는 확인 버튼이 보이지 않고 대기 문구만 보인다', () => {
    render(<TournamentMatchPanel match={m} nameOf={nameOf} viewerMemberId="mA" isAdmin={false} {...noop} />)
    expect(screen.queryByText('결과가 맞습니다')).not.toBeInTheDocument()
    expect(screen.getByText('상대가 입력한 결과를 확인하기를 기다리고 있습니다.')).toBeInTheDocument()
  })

  it('확인 버튼을 누르면 onVerify가 호출된다', () => {
    const onVerify = vi.fn()
    render(<TournamentMatchPanel match={m} nameOf={nameOf} viewerMemberId="mB" isAdmin={false} {...noop} onVerify={onVerify} />)
    fireEvent.click(screen.getByText('결과가 맞습니다'))
    expect(onVerify).toHaveBeenCalledTimes(1)
  })

  it('수정 요청 버튼을 누르면 onRequestCorrection이 호출된다', () => {
    const onRequestCorrection = vi.fn()
    render(<TournamentMatchPanel match={m} nameOf={nameOf} viewerMemberId="mB" isAdmin={false} {...noop} onRequestCorrection={onRequestCorrection} />)
    fireEvent.click(screen.getByText('결과가 다릅니다 (수정 요청)'))
    expect(onRequestCorrection).toHaveBeenCalledTimes(1)
  })

  it('관리자 화면에는 관리자 직권 확인 버튼이 보인다(확인창 승인 시 호출)', () => {
    const onAdminVerify = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<TournamentMatchPanel match={m} nameOf={nameOf} isAdmin {...noop} onAdminVerify={onAdminVerify} />)
    fireEvent.click(screen.getByText('관리자 직권 확인'))
    expect(onAdminVerify).toHaveBeenCalledTimes(1)
  })
})

describe('수정 요청됨', () => {
  it('요청 배너가 보이고, 관리자 화면에는 정정 입력칸이 자동으로 열린다', () => {
    const m = match({
      status: 'awaitingVerification', scoreA: 13, scoreB: 13,
      resultLog: { submittedByMemberId: 'mA', correctionRequested: true, correctionRequestedByMemberId: 'mB' },
    })
    render(<TournamentMatchPanel match={m} nameOf={nameOf} isAdmin {...noop} />)
    expect(screen.getByText(/상대가 결과 수정을 요청했습니다/)).toBeInTheDocument()
    expect(screen.getByText('가상회원A 점수(정정)')).toBeInTheDocument()
  })

  it('정정 점수를 입력하고 저장하면 onAdminCorrect가 호출된다', () => {
    const onAdminCorrect = vi.fn()
    const m = match({
      status: 'awaitingVerification', scoreA: 13, scoreB: 13,
      resultLog: { submittedByMemberId: 'mA', correctionRequested: true },
    })
    render(<TournamentMatchPanel match={m} nameOf={nameOf} isAdmin {...noop} onAdminCorrect={onAdminCorrect} />)
    const inputs = screen.getAllByRole('spinbutton')
    fireEvent.change(inputs[0], { target: { value: '15' } })
    fireEvent.change(inputs[1], { target: { value: '10' } })
    fireEvent.click(screen.getByText('정정 내용 저장'))
    expect(onAdminCorrect).toHaveBeenCalledWith('15', '10')
  })
})

describe('awaitingApproval — 관리자 최종 승인', () => {
  it('회원에게는 "관리자 확인을 기다리고 있습니다" 문구만 보인다', () => {
    const m = match({ status: 'awaitingApproval', scoreA: 15, scoreB: 12, calculatedWinnerParticipantId: 'pA' })
    render(<TournamentMatchPanel match={m} nameOf={nameOf} viewerMemberId="mA" isAdmin={false} {...noop} />)
    expect(screen.getByText('관리자 확인을 기다리고 있습니다.')).toBeInTheDocument()
    expect(screen.queryByText('최종 승인')).not.toBeInTheDocument()
  })

  it('관리자에게는 최종 승인 버튼이 보이고, 확인창 승인 시 onApprove가 호출된다', () => {
    const onApprove = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const m = match({ status: 'awaitingApproval', scoreA: 15, scoreB: 12, calculatedWinnerParticipantId: 'pA' })
    render(<TournamentMatchPanel match={m} nameOf={nameOf} isAdmin {...noop} onApprove={onApprove} />)
    fireEvent.click(screen.getByText('최종 승인'))
    expect(onApprove).toHaveBeenCalledWith(undefined)
  })

  it('확인창에서 취소하면 onApprove가 호출되지 않는다', () => {
    const onApprove = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const m = match({ status: 'awaitingApproval', scoreA: 15, scoreB: 12, calculatedWinnerParticipantId: 'pA' })
    render(<TournamentMatchPanel match={m} nameOf={nameOf} isAdmin {...noop} onApprove={onApprove} />)
    fireEvent.click(screen.getByText('최종 승인'))
    expect(onApprove).not.toHaveBeenCalled()
  })

  it('동률(calculatedWinnerParticipantId=null)이면 승자를 먼저 골라야 최종 승인 버튼이 활성화된다', () => {
    const m = match({ status: 'awaitingApproval', scoreA: 15, scoreB: 15, calculatedWinnerParticipantId: null })
    render(<TournamentMatchPanel match={m} nameOf={nameOf} isAdmin {...noop} />)
    expect(screen.getByText(/두 선수의 달성률이 같습니다/)).toBeInTheDocument()
    expect(screen.getByText('최종 승인')).toBeDisabled()
  })

  it('동률에서 승자를 고른 뒤 최종 승인을 누르면 onApprove가 고른 참가자ID로 호출된다', () => {
    const onApprove = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const m = match({ status: 'awaitingApproval', scoreA: 15, scoreB: 15, calculatedWinnerParticipantId: null })
    render(<TournamentMatchPanel match={m} nameOf={nameOf} isAdmin {...noop} onApprove={onApprove} />)
    fireEvent.click(screen.getByText('가상회원A 승리'))
    fireEvent.click(screen.getByText('최종 승인'))
    expect(onApprove).toHaveBeenCalledWith('pA')
  })
})

describe('기권 처리(관리자)', () => {
  it('두 기권 버튼이 보이고, 확인창 승인 시 onForfeit이 상대 참가자ID로 호출된다', () => {
    const onForfeit = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<TournamentMatchPanel match={match()} nameOf={nameOf} isAdmin {...noop} onForfeit={onForfeit} />)
    fireEvent.click(screen.getByText('가상회원A 기권 처리'))
    expect(onForfeit).toHaveBeenCalledWith('pB')
  })
})

describe('official — 공식 확정', () => {
  it('공식 결과와 승자가 보이고 더 이상 어떤 동작 버튼도 보이지 않는다', () => {
    const m = match({
      status: 'official', scoreA: 15, scoreB: 12,
      officialWinnerParticipantId: 'pA', officialLoserParticipantId: 'pB',
    })
    render(<TournamentMatchPanel match={m} nameOf={nameOf} isAdmin {...noop} />)
    expect(screen.getByText(/공식 결과 · 승자: 가상회원A/)).toBeInTheDocument()
    expect(screen.queryByText('최종 승인')).not.toBeInTheDocument()
    expect(screen.queryByText('가상회원A 기권 처리')).not.toBeInTheDocument()
  })

  it('기권승(forfeit)이면 기권승 안내 문구가 함께 보인다', () => {
    const m = match({
      resultType: 'forfeit', status: 'official', scoreA: null, scoreB: null,
      officialWinnerParticipantId: 'pB', officialLoserParticipantId: 'pA',
    })
    render(<TournamentMatchPanel match={m} nameOf={nameOf} isAdmin {...noop} />)
    expect(screen.getByText('기권승으로 확정되었습니다.')).toBeInTheDocument()
  })
})

describe('닫기', () => {
  it('닫기 버튼을 누르면 onClose가 호출된다', () => {
    const onClose = vi.fn()
    render(<TournamentMatchPanel match={match()} nameOf={nameOf} isAdmin {...noop} onClose={onClose} />)
    fireEvent.click(screen.getByText('닫기'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TournamentFinalResults } from '../src/components/tournament/TournamentFinalResults'
import type { Tournament, TournamentMatch } from '../src/types/tournament'

function tournament(over: Partial<Tournament> = {}): Tournament {
  return {
    id: 't1', name: '테스트 대회', date: '2026-10-01', timeLimitMinutes: 50,
    status: 'bracketFixed', createdAt: '2026-09-01T00:00:00.000Z',
    ...over,
  }
}

function finalMatch(over: Partial<TournamentMatch> = {}): TournamentMatch {
  return {
    id: 'r3m1', roundNumber: 3, playerCountInRound: 2, matchNumber: 1,
    playerAParticipantId: 'pA', playerBParticipantId: 'pB',
    playerAMemberId: 'mA', playerBMemberId: 'mB',
    playerAHandicapSnapshot: 20, playerBHandicapSnapshot: 20,
    scoreA: 20, scoreB: 15, resultType: 'normal', status: 'official',
    officialWinnerParticipantId: 'pA', officialLoserParticipantId: 'pB',
    nextMatchId: null, nextSlot: null,
    ...over,
  }
}

function semiFinal(id: string, loserId: string): TournamentMatch {
  return {
    id, roundNumber: 2, playerCountInRound: 4, matchNumber: id === 'r2m1' ? 1 : 2,
    playerAParticipantId: loserId, playerBParticipantId: loserId === 'pC' ? 'pA' : 'pB',
    playerAMemberId: loserId, playerBMemberId: 'x',
    playerAHandicapSnapshot: 20, playerBHandicapSnapshot: 20,
    scoreA: 10, scoreB: 20, resultType: 'normal', status: 'official',
    officialWinnerParticipantId: loserId === 'pC' ? 'pA' : 'pB', officialLoserParticipantId: loserId,
    nextMatchId: 'r3m1', nextSlot: id === 'r2m1' ? 'playerA' : 'playerB',
    ...{},
  }
}

const nameOf = (id: string | null) => ({ pA: '가상회원A', pB: '가상회원B', pC: '가상회원C', pD: '가상회원D' } as Record<string, string>)[id ?? ''] ?? ''

describe('TournamentFinalResults', () => {
  it('결승이 아직 공식 확정되지 않았으면 아무것도 그리지 않는다', () => {
    const { container } = render(
      <TournamentFinalResults
        tournament={tournament()} matches={[finalMatch({ status: 'awaitingApproval', officialWinnerParticipantId: undefined })]}
        nameOf={nameOf} isAdmin={false} onFinish={vi.fn()}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('결승이 공식 확정되면 우승·준우승과 공동 3위를 보여준다', () => {
    render(
      <TournamentFinalResults
        tournament={tournament()}
        matches={[finalMatch(), semiFinal('r2m1', 'pC'), semiFinal('r2m2', 'pD')]}
        nameOf={nameOf} isAdmin={false} onFinish={vi.fn()}
      />,
    )
    expect(screen.getByText('우승: 가상회원A')).toBeInTheDocument()
    expect(screen.getByText('준우승: 가상회원B')).toBeInTheDocument()
    expect(screen.getByText(/공동 3위/)).toBeInTheDocument()
  })

  it('관리자에게만 대회 최종 마감 버튼이 보이고, 이미 종료된 대회에서는 보이지 않는다', () => {
    const { rerender } = render(
      <TournamentFinalResults tournament={tournament()} matches={[finalMatch()]} nameOf={nameOf} isAdmin={false} onFinish={vi.fn()} />,
    )
    expect(screen.queryByText('대회 최종 마감')).not.toBeInTheDocument()

    rerender(<TournamentFinalResults tournament={tournament()} matches={[finalMatch()]} nameOf={nameOf} isAdmin onFinish={vi.fn()} />)
    expect(screen.getByText('대회 최종 마감')).toBeInTheDocument()

    rerender(
      <TournamentFinalResults tournament={tournament({ status: 'finished' })} matches={[finalMatch()]} nameOf={nameOf} isAdmin onFinish={vi.fn()} />,
    )
    expect(screen.queryByText('대회 최종 마감')).not.toBeInTheDocument()
  })

  it('마감 버튼을 누르고 확인창을 승인하면 onFinish가 호출된다', () => {
    const onFinish = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<TournamentFinalResults tournament={tournament()} matches={[finalMatch()]} nameOf={nameOf} isAdmin onFinish={onFinish} />)
    fireEvent.click(screen.getByText('대회 최종 마감'))
    expect(onFinish).toHaveBeenCalledTimes(1)
  })
})

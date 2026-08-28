import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TournamentBracketVisual } from '../src/components/tournament/TournamentBracketVisual'
import type { TournamentMatch } from '../src/types/tournament'

// 가상 데이터만 사용한다 — 실제 회원 이름·경기 데이터가 아니다.

const names: Record<string, string> = { 'p-1': '테스트회원1', 'p-2': '테스트회원2', 'p-3': '테스트회원3', 'p-4': '테스트회원4' }
const nameOf = (id: string | null) => (id ? names[id] ?? '알수없음' : '')

function normalMatch(over: Partial<TournamentMatch> = {}): TournamentMatch {
  return {
    id: 'r1m1', roundNumber: 1, playerCountInRound: 4, matchNumber: 1,
    playerAParticipantId: 'p-1', playerBParticipantId: 'p-2',
    playerAMemberId: 'm-1', playerBMemberId: 'm-2',
    playerAHandicapSnapshot: 20, playerBHandicapSnapshot: 20,
    scoreA: null, scoreB: null, resultType: 'normal', status: 'awaitingResult',
    nextMatchId: 'r2m1', nextSlot: 'playerA',
    ...over,
  }
}

describe('전체 대진표', () => {
  it('모든 라운드가 열로 함께 보인다', () => {
    const matches: TournamentMatch[] = [
      normalMatch({ id: 'r1m1', roundNumber: 1, playerCountInRound: 4, matchNumber: 1 }),
      normalMatch({
        id: 'r1m2', roundNumber: 1, playerCountInRound: 4, matchNumber: 2,
        playerAParticipantId: 'p-3', playerBParticipantId: 'p-4', playerAMemberId: 'm-3', playerBMemberId: 'm-4',
      }),
      normalMatch({
        id: 'r2m1', roundNumber: 2, playerCountInRound: 2, matchNumber: 1,
        playerAParticipantId: null, playerBParticipantId: null, playerAMemberId: null, playerBMemberId: null,
        nextMatchId: null, nextSlot: null,
      }),
    ]
    render(<TournamentBracketVisual matches={matches} nameOf={nameOf} />)
    expect(screen.getByText('4강')).toBeInTheDocument()
    expect(screen.getByText('결승')).toBeInTheDocument()
    expect(screen.getByText('테스트회원1')).toBeInTheDocument()
    expect(screen.getByText('테스트회원3')).toBeInTheDocument()
  })

  it('아직 자리가 정해지지 않은 경기는 "미정"으로 보인다', () => {
    const matches = [normalMatch({
      roundNumber: 2, playerCountInRound: 2, playerAParticipantId: null, playerBParticipantId: null,
      nextMatchId: null, nextSlot: null,
    })]
    render(<TournamentBracketVisual matches={matches} nameOf={nameOf} />)
    expect(screen.getAllByText('미정')).toHaveLength(2)
  })

  it('공식 확정된 경기는 승자를 굵게 강조한다', () => {
    const matches = [normalMatch({
      status: 'official', scoreA: 15, scoreB: 12,
      officialWinnerParticipantId: 'p-1', officialLoserParticipantId: 'p-2',
    })]
    render(<TournamentBracketVisual matches={matches} nameOf={nameOf} />)
    const winner = screen.getByText('테스트회원1')
    expect(winner).toHaveStyle({ fontWeight: 800 })
  })

  it('부전승 경기에는 "(부전승)" 표시가 붙는다', () => {
    const matches = [normalMatch({
      resultType: 'bye', status: 'official', playerBParticipantId: null,
      officialWinnerParticipantId: 'p-1',
    })]
    render(<TournamentBracketVisual matches={matches} nameOf={nameOf} />)
    expect(screen.getByText(/테스트회원1 \(부전승\)/)).toBeInTheDocument()
  })

  it('라운드 경기가 모두 확정되면 라운드 이름에 "확정"이 붙는다', () => {
    const matches = [normalMatch({
      status: 'official', scoreA: 15, scoreB: 12,
      officialWinnerParticipantId: 'p-1', officialLoserParticipantId: 'p-2',
    })]
    render(<TournamentBracketVisual matches={matches} nameOf={nameOf} />)
    expect(screen.getByText(/4강 확정/)).toBeInTheDocument()
  })

  it('경기를 누르면 onSelectMatch가 호출된다', () => {
    const onSelectMatch = vi.fn()
    const matches = [normalMatch()]
    render(<TournamentBracketVisual matches={matches} nameOf={nameOf} onSelectMatch={onSelectMatch} />)
    fireEvent.click(screen.getByText('테스트회원1'))
    expect(onSelectMatch).toHaveBeenCalledWith(matches[0])
  })

  it('경기가 없으면 안내 문구만 보인다', () => {
    render(<TournamentBracketVisual matches={[]} nameOf={nameOf} />)
    expect(screen.getByText('대진 정보가 없습니다.')).toBeInTheDocument()
  })

  it('private draw 관련 정보(번호↔자리 매핑)를 가질 방법이 없다 — 애초에 그런 prop을 받지 않는다', () => {
    // 타입 계약 자체로 보장된다: 이 컴포넌트는 TournamentMatch[]만 받고, 부모가 매핑을
    // prop으로 넘기지 않는 한 이 컴포넌트가 그 값을 가질 방법이 없다. 여기서는 렌더링
    // 결과 텍스트에 그런 값이 실수로라도 섞이지 않는지만 확인한다.
    const matches = [normalMatch({ resultType: 'bye', playerBParticipantId: null, officialWinnerParticipantId: 'p-1' })]
    const { container } = render(<TournamentBracketVisual matches={matches} nameOf={nameOf} />)
    expect(container.textContent).not.toMatch(/numberToSlot|byeSlots/i)
  })
})

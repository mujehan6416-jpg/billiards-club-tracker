import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TournamentBracketView } from '../src/components/tournament/TournamentBracketView'
import type { TournamentMatch } from '../src/types/tournament'

// 가상 데이터만 사용한다 — 실제 회원 이름·경기 데이터가 아니다.

const names: Record<string, string> = {
  'p-1': '테스트회원1', 'p-2': '테스트회원2', 'p-3': '테스트회원3',
}
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

describe('라운드 탭', () => {
  it('여러 라운드가 있으면 라운드별 탭으로 나뉜다', () => {
    const matches: TournamentMatch[] = [
      normalMatch({ id: 'r1m1', roundNumber: 1, playerCountInRound: 4 }),
      normalMatch({ id: 'r1m2', roundNumber: 1, playerCountInRound: 4, matchNumber: 2 }),
      normalMatch({ id: 'r2m1', roundNumber: 2, playerCountInRound: 2, playerAParticipantId: null, playerBParticipantId: null }),
    ]
    render(<TournamentBracketView matches={matches} nameOf={nameOf} />)
    expect(screen.getByText('4강')).toBeInTheDocument()
    expect(screen.getByText('결승')).toBeInTheDocument()
  })

  it('기본으로 첫 라운드 경기가 보인다', () => {
    const matches = [normalMatch()]
    render(<TournamentBracketView matches={matches} nameOf={nameOf} />)
    expect(screen.getByText('테스트회원1')).toBeInTheDocument()
    expect(screen.getByText('테스트회원2')).toBeInTheDocument()
  })

  it('다른 라운드 탭을 누르면 그 라운드 경기로 바뀐다', () => {
    const matches: TournamentMatch[] = [
      normalMatch({ id: 'r1m1', roundNumber: 1, playerCountInRound: 4 }),
      normalMatch({
        id: 'r2m1', roundNumber: 2, playerCountInRound: 2, matchNumber: 1,
        playerAParticipantId: 'p-3', playerBParticipantId: null,
        nextMatchId: null, nextSlot: null,
      }),
    ]
    render(<TournamentBracketView matches={matches} nameOf={nameOf} />)
    fireEvent.click(screen.getByText('결승'))
    expect(screen.getByText('테스트회원3')).toBeInTheDocument()
    expect(screen.queryByText('테스트회원1')).not.toBeInTheDocument()
  })
})

describe('부전승 표시', () => {
  it('부전승 경기에는 "BYE"가 아니라 "부전승"이 표시된다', () => {
    const matches = [normalMatch({
      resultType: 'bye', status: 'official',
      playerAParticipantId: 'p-1', playerBParticipantId: null,
      officialWinnerParticipantId: 'p-1',
    })]
    render(<TournamentBracketView matches={matches} nameOf={nameOf} />)
    expect(screen.getByText(/부전승/)).toBeInTheDocument()
    expect(screen.queryByText(/BYE/i)).not.toBeInTheDocument()
  })

  it('부전승 진출자가 A 자리에 있어도 이름이 보인다', () => {
    const matches = [normalMatch({
      resultType: 'bye', status: 'official',
      playerAParticipantId: 'p-1', playerBParticipantId: null,
      officialWinnerParticipantId: 'p-1',
    })]
    render(<TournamentBracketView matches={matches} nameOf={nameOf} />)
    expect(screen.getByText('테스트회원1')).toBeInTheDocument()
  })

  it('★ 부전승 진출자가 B 자리에 있어도 이름이 보인다 (한쪽만 가정하는 버그 방지)', () => {
    const matches = [normalMatch({
      resultType: 'bye', status: 'official',
      playerAParticipantId: null, playerBParticipantId: 'p-2',
      officialWinnerParticipantId: 'p-2',
    })]
    render(<TournamentBracketView matches={matches} nameOf={nameOf} />)
    expect(screen.getByText('테스트회원2')).toBeInTheDocument()
  })

  it('부전승 경기에는 "vs"를 보여주지 않는다', () => {
    const matches = [normalMatch({
      resultType: 'bye', status: 'official',
      playerAParticipantId: 'p-1', playerBParticipantId: null,
    })]
    render(<TournamentBracketView matches={matches} nameOf={nameOf} />)
    expect(screen.queryByText('vs')).not.toBeInTheDocument()
  })
})

describe('본인 경기 강조', () => {
  it('highlightMemberId가 나온 경기 카드를 강조한다', () => {
    const matches = [normalMatch()]
    const { container } = render(<TournamentBracketView matches={matches} nameOf={nameOf} highlightMemberId="m-1" />)
    const card = container.querySelector('.card')
    expect(card).toHaveStyle({ border: '2px solid #0f6e56' })
  })

  it('본인이 나오지 않은 경기는 강조하지 않는다', () => {
    const matches = [normalMatch()]
    const { container } = render(<TournamentBracketView matches={matches} nameOf={nameOf} highlightMemberId="m-999" />)
    const card = container.querySelector('.card')
    expect(card).not.toHaveStyle({ border: '2px solid #0f6e56' })
  })
})

describe('미리보기 배너', () => {
  it('isPreview가 true면 확정 전 안내 배너가 보인다', () => {
    render(<TournamentBracketView matches={[normalMatch()]} nameOf={nameOf} isPreview />)
    expect(screen.getByText(/아직 확정 전 미리보기/)).toBeInTheDocument()
  })

  it('isPreview가 없으면 안내 배너가 없다', () => {
    render(<TournamentBracketView matches={[normalMatch()]} nameOf={nameOf} />)
    expect(screen.queryByText(/아직 확정 전 미리보기/)).not.toBeInTheDocument()
  })
})

describe('빈 데이터', () => {
  it('경기가 없으면 안내 문구만 보인다', () => {
    render(<TournamentBracketView matches={[]} nameOf={nameOf} />)
    expect(screen.getByText('대진 정보가 없습니다.')).toBeInTheDocument()
  })
})

describe('개발자용 문자열 비노출', () => {
  it('화면 텍스트에 내부 상태값이 그대로 노출되지 않는다', () => {
    const matches = [normalMatch({ status: 'awaitingApproval' })]
    const { container } = render(<TournamentBracketView matches={matches} nameOf={nameOf} />)
    expect(container.textContent).not.toContain('awaitingApproval')
    expect(container.textContent).not.toContain('bracketFixed')
  })
})

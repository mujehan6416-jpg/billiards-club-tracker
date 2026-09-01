import { describe, it, expect, vi } from 'vitest'
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

describe('공식 결과 표시(4C)', () => {
  it('공식 확정된 경기는 점수/핸디(달성률)와 승자를 함께 보여준다', () => {
    const matches = [normalMatch({
      status: 'official', scoreA: 15, scoreB: 12,
      officialWinnerParticipantId: 'p-1', officialLoserParticipantId: 'p-2',
    })]
    render(<TournamentBracketView matches={matches} nameOf={nameOf} />)
    expect(screen.getByText(/승자 테스트회원1/)).toBeInTheDocument()
    expect(screen.getByText(/15\/20 \(75%\)/)).toBeInTheDocument()
    expect(screen.getByText(/패자 테스트회원2/)).toBeInTheDocument()
    expect(screen.getByText(/12\/20 \(60%\)/)).toBeInTheDocument()
  })

  it('아직 공식 확정 전이면 점수 대신 진행 상태 문구를 보여준다', () => {
    const matches = [normalMatch({ status: 'awaitingResult' })]
    render(<TournamentBracketView matches={matches} nameOf={nameOf} />)
    expect(screen.getByText('아직 경기 결과가 입력되지 않았습니다.')).toBeInTheDocument()
  })
})

describe('경기 선택(4C)', () => {
  it('onSelectMatch를 넘기면 카드를 눌러 선택할 수 있고, 선택된 카드가 강조된다', () => {
    const matches = [normalMatch()]
    const onSelectMatch = vi.fn()
    render(<TournamentBracketView matches={matches} nameOf={nameOf} onSelectMatch={onSelectMatch} selectedMatchId="r1m1" />)
    fireEvent.click(screen.getByText('테스트회원1'))
    expect(onSelectMatch).toHaveBeenCalledWith(matches[0])
  })

  it('onSelectMatch가 없으면 카드는 버튼 역할을 갖지 않는다', () => {
    render(<TournamentBracketView matches={[normalMatch()]} nameOf={nameOf} />)
    expect(screen.queryByRole('button', { name: /테스트회원1/ })).not.toBeInTheDocument()
  })
})

describe('경기 상세 인라인 표시(4C 개선)', () => {
  it('renderMatchDetail을 넘기면 선택된 경기 카드 바로 아래에 상세가 나타난다', () => {
    const matches = [
      normalMatch({ id: 'r1m1', matchNumber: 1 }),
      normalMatch({ id: 'r1m2', matchNumber: 2, playerAParticipantId: 'p-3', playerBParticipantId: null }),
    ]
    render(
      <TournamentBracketView
        matches={matches} nameOf={nameOf} selectedMatchId="r1m1"
        renderMatchDetail={(m) => <div data-testid="detail">상세: {m.id}</div>}
      />,
    )
    const detail = screen.getByTestId('detail')
    expect(detail).toHaveTextContent('상세: r1m1')
    // 상세가 선택된 경기 카드(테스트회원1) 다음, 다른 경기 카드(테스트회원3)보다 앞에 있어야 한다.
    const card1 = screen.getByText('테스트회원1').closest('.card')!
    const card2 = screen.getByText('테스트회원3').closest('.card')!
    const position = card1.compareDocumentPosition(detail)
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(card2.compareDocumentPosition(detail) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
  })

  it('다른 경기를 선택하면 상세 위치가 그 경기 아래로 옮겨간다', () => {
    const matches = [
      normalMatch({ id: 'r1m1', matchNumber: 1 }),
      normalMatch({ id: 'r1m2', matchNumber: 2, playerAParticipantId: 'p-3', playerBParticipantId: null }),
    ]
    const { rerender } = render(
      <TournamentBracketView matches={matches} nameOf={nameOf} selectedMatchId="r1m1" renderMatchDetail={(m) => <div data-testid="detail">{m.id}</div>} />,
    )
    expect(screen.getByTestId('detail')).toHaveTextContent('r1m1')
    rerender(
      <TournamentBracketView matches={matches} nameOf={nameOf} selectedMatchId="r1m2" renderMatchDetail={(m) => <div data-testid="detail">{m.id}</div>} />,
    )
    expect(screen.getByTestId('detail')).toHaveTextContent('r1m2')
  })

  it('선택된 경기가 없으면 상세를 그리지 않는다', () => {
    render(
      <TournamentBracketView matches={[normalMatch()]} nameOf={nameOf} selectedMatchId={null} renderMatchDetail={(m) => <div data-testid="detail">{m.id}</div>} />,
    )
    expect(screen.queryByTestId('detail')).not.toBeInTheDocument()
  })

  it('renderMatchDetail을 넘기지 않으면 상세가 그려지지 않는다(미리보기 화면 등)', () => {
    render(<TournamentBracketView matches={[normalMatch()]} nameOf={nameOf} selectedMatchId="r1m1" />)
    expect(screen.queryByTestId('detail')).not.toBeInTheDocument()
  })
})

describe('라운드 확정 표시(4C 개선)', () => {
  it('아직 미확정이면 라운드 탭에 확정 표시가 없다', () => {
    render(<TournamentBracketView matches={[normalMatch()]} nameOf={nameOf} />)
    expect(screen.queryByText(/확정/)).not.toBeInTheDocument()
  })

  it('그 라운드 경기가 모두 official이면 탭에 체크 표시가 붙지만 "확정"이라는 단어는 쓰지 않는다', () => {
    const matches = [normalMatch({
      status: 'official', scoreA: 15, scoreB: 12,
      officialWinnerParticipantId: 'p-1', officialLoserParticipantId: 'p-2',
    })]
    render(<TournamentBracketView matches={matches} nameOf={nameOf} />)
    const tab = screen.getByText('✅ 4강')
    expect(tab).toBeInTheDocument()
    expect(screen.queryByText(/4강 확정/)).not.toBeInTheDocument()
    // 완료된 라운드는 더 굵게 표시한다.
    expect(tab).toHaveStyle({ fontWeight: '800' })
  })

  it('결승도 "결승"만 표시한다(2강도, "결승 확정"도 아니다)', () => {
    const matches = [normalMatch({
      playerCountInRound: 2, status: 'official', scoreA: 15, scoreB: 12,
      officialWinnerParticipantId: 'p-1', officialLoserParticipantId: 'p-2',
    })]
    render(<TournamentBracketView matches={matches} nameOf={nameOf} />)
    expect(screen.getByText('✅ 결승')).toBeInTheDocument()
    expect(screen.queryByText(/결승 확정/)).not.toBeInTheDocument()
    expect(screen.queryByText('✅ 2강')).not.toBeInTheDocument()
  })

  it('아직 완료되지 않은 라운드는 체크 없이 얇은 글씨로 표시한다', () => {
    render(<TournamentBracketView matches={[normalMatch()]} nameOf={nameOf} />)
    const tab = screen.getByText('4강')
    expect(tab).toHaveStyle({ fontWeight: '500' })
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

describe('라운드 탭 순서', () => {
  /** 8강(r1) → 4강(r2) → 결승(r3, roundNumber=3) → 3·4위전(r4, roundNumber=4, 데이터상 결승보다 큼). */
  function bracket8WithThirdPlace(): TournamentMatch[] {
    return [
      normalMatch({ id: 'r1m1', roundNumber: 1, playerCountInRound: 8, nextMatchId: 'r2m1' }),
      normalMatch({ id: 'r1m2', roundNumber: 1, playerCountInRound: 8, matchNumber: 2, nextMatchId: 'r2m1' }),
      normalMatch({ id: 'r2m1', roundNumber: 2, playerCountInRound: 4, nextMatchId: 'r3m1' }),
      normalMatch({ id: 'r3m1', roundNumber: 3, playerCountInRound: 2, nextMatchId: null, nextSlot: null }),
      normalMatch({ id: 'r4m1', roundNumber: 4, playerCountInRound: 3, nextMatchId: null, nextSlot: null }),
    ]
  }

  it('3·4위전이 있으면 탭 순서가 "8강 → 4강 → 3·4위전 → 결승"이다(roundNumber 순서와 다르게 표시)', () => {
    render(<TournamentBracketView matches={bracket8WithThirdPlace()} nameOf={nameOf} />)
    const tabLabels = screen.getAllByRole('button')
      .map((b) => b.textContent?.replace('✅ ', ''))
      .filter((t): t is string => !!t && ['8강', '4강', '결승', '3·4위전'].includes(t))
    expect(tabLabels).toEqual(['8강', '4강', '3·4위전', '결승'])
  })

  it('3·4위전이 없으면 기존처럼 존재하는 라운드만 순서대로 표시된다', () => {
    const matches = [
      normalMatch({ id: 'r1m1', roundNumber: 1, playerCountInRound: 4, nextMatchId: 'r2m1' }),
      normalMatch({ id: 'r2m1', roundNumber: 2, playerCountInRound: 2, nextMatchId: null, nextSlot: null }),
    ]
    render(<TournamentBracketView matches={matches} nameOf={nameOf} />)
    const tabLabels = screen.getAllByRole('button').map((b) => b.textContent)
    expect(tabLabels).toEqual(['4강', '결승'])
  })

  it('3·4위전 탭을 눌러도 기존 필터 동작이 그대로 유지된다(그 라운드 경기만 보인다)', () => {
    render(<TournamentBracketView matches={bracket8WithThirdPlace()} nameOf={nameOf} />)
    fireEvent.click(screen.getByText('3·4위전'))
    expect(screen.getByText('테스트회원1')).toBeInTheDocument()
    expect(screen.queryByText('경기 2')).not.toBeInTheDocument()
  })
})

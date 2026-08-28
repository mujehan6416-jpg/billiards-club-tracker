import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TournamentBracketVisual } from '../src/components/tournament/TournamentBracketVisual'
import { buildEmptyBracket, buildTournamentMatches, tournamentMatchId } from '../src/logic/tournamentBracket'
import { calculateBracketLayout, BRACKET_LAYOUT } from '../src/logic/tournamentBracketLayout'
import type { TournamentMatch, TournamentSeat } from '../src/types/tournament'

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

  it('라운드 경기가 모두 확정되면 라운드 이름표에 체크가 붙지만 "확정"이라는 단어는 쓰지 않는다', () => {
    const matches = [normalMatch({
      status: 'official', scoreA: 15, scoreB: 12,
      officialWinnerParticipantId: 'p-1', officialLoserParticipantId: 'p-2',
    })]
    render(<TournamentBracketVisual matches={matches} nameOf={nameOf} />)
    const header = screen.getByText('✅ 4강')
    expect(header).toBeInTheDocument()
    expect(screen.queryByText(/4강 확정/)).not.toBeInTheDocument()
    expect(header).toHaveStyle({ fontWeight: '800' })
  })

  it('경기를 누르면 onSelectMatch가 호출된다', () => {
    const onSelectMatch = vi.fn()
    const matches = [normalMatch()]
    render(<TournamentBracketVisual matches={matches} nameOf={nameOf} onSelectMatch={onSelectMatch} />)
    fireEvent.click(screen.getByText('테스트회원1'))
    expect(onSelectMatch).toHaveBeenCalledWith(matches[0])
  })

  it('선수 1명당 별도 네모 칸으로 보이고(오프라인 종이 대진표와 같은 구조), "vs" 표시는 쓰지 않는다', () => {
    render(<TournamentBracketVisual matches={[normalMatch()]} nameOf={nameOf} />)
    expect(screen.queryByText('vs')).not.toBeInTheDocument()
    const nameA = screen.getByText('테스트회원1')
    const nameB = screen.getByText('테스트회원2')
    // 서로 다른 칸(부모 div)에 들어 있어야 한다 — 하나의 카드 안에 같이 있지 않다.
    expect(nameA.closest('div')).not.toBe(nameB.closest('div'))
  })

  it('경기가 없으면 안내 문구만 보인다', () => {
    render(<TournamentBracketVisual matches={[]} nameOf={nameOf} />)
    expect(screen.getByText('대진 정보가 없습니다.')).toBeInTheDocument()
  })

  it('연결선은 진한 검정(#333)이 아니라 연한 회색으로, 너무 굵지 않게 그린다', () => {
    const nodes = buildEmptyBracket(4)
    if (!nodes.ok) throw new Error(nodes.message)
    const seats: TournamentSeat[] = [1, 2, 3, 4].map((n) => ({ participantId: `p-${n}`, memberId: `m-${n}`, handicap: 20, slotNumber: n }))
    const built = buildTournamentMatches(nodes.value, seats)
    if (!built.ok) throw new Error(built.message)
    const { container } = render(<TournamentBracketVisual matches={built.value} nameOf={() => '이름'} />)
    const path = container.querySelector('svg path')!
    expect(path.getAttribute('stroke')).not.toBe('#333')
    expect(path.getAttribute('stroke')).toBe('#aeb2b5')
    expect(Number(path.getAttribute('stroke-width'))).toBeLessThanOrEqual(1.5)
  })

  it('경기 카드가 계산된 좌표(calculateBracketLayout)에 정확히 배치된다 — 렌더 후 측정이 아니라 계산값 그대로다', () => {
    const nodes = buildEmptyBracket(8)
    if (!nodes.ok) throw new Error(nodes.message)
    const seats: TournamentSeat[] = Array.from({ length: 8 }, (_, i) => ({
      participantId: `p-${i + 1}`, memberId: `m-${i + 1}`, handicap: 20, slotNumber: i + 1,
    }))
    const built = buildTournamentMatches(nodes.value, seats)
    if (!built.ok) throw new Error(built.message)
    const matches = built.value
    const layout = calculateBracketLayout(matches)

    const { container } = render(<TournamentBracketVisual matches={matches} nameOf={() => '이름'} />)
    for (const m of matches) {
      const el = container.querySelector(`[data-match-id="${m.id}"]`) as HTMLElement
      const pos = layout.get(m.id)!
      expect(el.style.left).toBe(`${pos.x}px`)
      expect(el.style.top).toBe(`${pos.centerY - BRACKET_LAYOUT.CARD_HEIGHT / 2 + 28}px`)
    }
  })

  it('다음 라운드 카드의 center가 이전 두 경기 카드 center의 정확한 평균이다(픽셀 단위)', () => {
    const nodes = buildEmptyBracket(4)
    if (!nodes.ok) throw new Error(nodes.message)
    const seats: TournamentSeat[] = [1, 2, 3, 4].map((n) => ({ participantId: `p-${n}`, memberId: `m-${n}`, handicap: 20, slotNumber: n }))
    const built = buildTournamentMatches(nodes.value, seats)
    if (!built.ok) throw new Error(built.message)
    const matches = built.value
    const layout = calculateBracketLayout(matches)

    const yA = layout.get(tournamentMatchId(1, 1))!.centerY
    const yB = layout.get(tournamentMatchId(1, 2))!.centerY
    const finalCenter = layout.get(tournamentMatchId(2, 1))!.centerY
    expect(Math.abs(finalCenter - (yA + yB) / 2)).toBeLessThan(0.01)
  })

  it('연결선(SVG path)이 nextMatchId 기준 junction(꺾쇠) 구조로 그려진다 — bracketSize와 무관하게 하드코딩 없이 동작한다', () => {
    // junction 하나당: 소스 경기 수만큼의 stub(가로선) + (소스가 2개 이상이면 spine 세로선 1개)
    // + 다음 경기로 들어가는 선 1개. 8/16/32강 어디서든 이 공식으로 정확히 맞아야 한다
    // (부전승도 실제 match이므로 다른 소스와 똑같이 하나의 stub으로 계산에 포함된다).
    const check = (bracketSize: number) => {
      const nodes = buildEmptyBracket(bracketSize)
      if (!nodes.ok) throw new Error(nodes.message)
      const seats: TournamentSeat[] = Array.from({ length: bracketSize }, (_, i) => ({
        participantId: `p-${i + 1}`, memberId: `m-${i + 1}`, handicap: 20, slotNumber: i + 1,
      }))
      const built = buildTournamentMatches(nodes.value, seats)
      if (!built.ok) throw new Error(built.message)
      const matches = built.value

      const byNext = new Map<string, number>()
      for (const m of matches) {
        if (!m.nextMatchId) continue
        byNext.set(m.nextMatchId, (byNext.get(m.nextMatchId) ?? 0) + 1)
      }
      let expected = 0
      for (const count of byNext.values()) {
        expected += count + (count > 1 ? 1 : 0) + 1
      }

      const { container } = render(<TournamentBracketVisual matches={matches} nameOf={() => '이름'} />)
      const paths = container.querySelectorAll('svg path')
      expect(paths.length).toBe(expected)
    }
    check(8)
    check(16)
    check(32)
  })

  it('반복 렌더링에서도 무한 루프 없이 안정적으로 멈춘다(레이아웃 재측정 가드)', () => {
    // jsdom은 실제 레이아웃 계산을 하지 않지만, 이 테스트는 "Maximum update depth exceeded"
    // 같은 렌더 폭주가 재발하지 않는지를 회귀 확인한다.
    const nodes = buildEmptyBracket(4)
    if (!nodes.ok) throw new Error(nodes.message)
    const seats: TournamentSeat[] = [1, 2, 3, 4].map((n) => ({ participantId: `p-${n}`, memberId: `m-${n}`, handicap: 20, slotNumber: n }))
    const built = buildTournamentMatches(nodes.value, seats)
    if (!built.ok) throw new Error(built.message)
    expect(() => render(<TournamentBracketVisual matches={built.value} nameOf={() => '이름'} />)).not.toThrow()
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

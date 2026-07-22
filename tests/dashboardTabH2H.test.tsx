import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DashboardTab } from '../src/tabs/DashboardTab'
import { useApp } from '../src/store/appStore'
import type { Game, Member, Session } from '../src/types'

// 상대전적(H2H) 결과 카드에 경기 날짜가 표시되는지 확인한다. 아래 이름·ID는 전부 가상 데이터다.

function member(id: string, name: string): Member {
  return { id, name, handicap: 20, handicapHistory: [], active: true }
}

function game(id: string, a: string, b: string): Game {
  return {
    id, playerAId: a, playerBId: b, handicapA: 20, handicapB: 20, scoreA: 15, scoreB: 10,
    endType: 'time', playedAt: '2026-07-21T10:00:00Z',
  }
}

beforeEach(() => {
  useApp.setState({
    members: [member('a', '가상회원A'), member('b', '가상회원B')],
    sessions: [
      { id: 's1', date: '2026-07-21', attendeeIds: ['a', 'b'], games: [game('g1', 'a', 'b')] },
      { id: 's2', date: '2026-07-28', attendeeIds: ['a', 'b'], games: [game('g2', 'b', 'a')] },
    ] as Session[],
    settings: { lastBackupAt: null },
    ledger: [],
  })
})

describe('DashboardTab — 상대전적 카드에 날짜 표시', () => {
  it('상대전적 탭의 각 결과 카드 첫째 줄에 소속 모임 날짜가 보인다', () => {
    render(<DashboardTab />)
    fireEvent.click(screen.getByText('상대전적'))

    expect(screen.getByText('2026-07-21')).toBeInTheDocument()
    expect(screen.getByText('2026-07-28')).toBeInTheDocument()
  })

  it('날짜가 카드 첫째 줄에서 가운데 정렬되고, 그 아래 둘째 줄에 기존 결과 한 줄이 그대로 표시된다', () => {
    const { container } = render(<DashboardTab />)
    fireEvent.click(screen.getByText('상대전적'))

    const dateLine = screen.getByText('2026-07-21')
    expect(dateLine.style.textAlign).toBe('center')
    const card = dateLine.closest('li')!
    const resultRow = container.querySelector('.result-row')!
    expect(card.contains(resultRow)).toBe(true)
    // 날짜 줄이 결과 줄보다 앞(위)에 와야 한다.
    expect(dateLine.compareDocumentPosition(resultRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('날짜별(ByDate) 탭에서는 카드마다 날짜를 다시 보여주지 않는다(드롭다운으로 이미 날짜가 정해짐 — 중복 방지)', () => {
    const { container } = render(<DashboardTab />)
    fireEvent.click(screen.getByText('날짜별'))

    const card = container.querySelector('.result-list > li')!
    expect(card).toBeTruthy()
    // 카드 안에는 결과 줄(.result-row) 하나만 있어야 하고, 별도 날짜 표시 줄은 없어야 한다.
    expect(card.children).toHaveLength(1)
    expect(card.querySelector('.result-row')).toBeTruthy()
  })
})

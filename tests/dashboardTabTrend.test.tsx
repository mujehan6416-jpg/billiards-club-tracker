import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DashboardTab } from '../src/tabs/DashboardTab'
import { useApp } from '../src/store/appStore'
import { useAuth } from '../src/store/authStore'
import type { Game, Member, Session } from '../src/types'

// 추이 탭의 최근 경기 목록 표시 형식을 확인한다. 아래 이름·ID는 전부 가상 데이터다.
// 기대 형식: [승] 날짜 검색한회원 득점/핸디 (달성률) vs 상대 득점/핸디 (달성률)

function member(id: string, name: string): Member {
  return { id, name, handicap: 20, handicapHistory: [], active: true }
}

function game(
  id: string,
  a: string,
  b: string,
  sA: number,
  hA: number,
  sB: number,
  hB: number,
  playedAt: string,
): Game {
  return { id, playerAId: a, playerBId: b, handicapA: hA, handicapB: hB, scoreA: sA, scoreB: sB, endType: 'time', playedAt }
}

const 가상회원A = member('a', '가상회원A')
const 가상회원B = member('b', '가상회원B')

function setUp(sessions: Session[]) {
  useApp.setState({ members: [가상회원A, 가상회원B], sessions, settings: { lastBackupAt: null }, ledger: [] })
}

beforeEach(() => {
  useAuth.setState({ memberId: null, memberName: null, isGuest: false })
  setUp([
    {
      // 검색한 회원(가상회원A)이 A 선수인 경기 — 17/17(100%) vs 10/12(83%) → 승
      id: 's1',
      date: '2026-07-15',
      attendeeIds: ['a', 'b'],
      games: [game('g1', 'a', 'b', 17, 17, 10, 12, '2026-07-15T10:00:00Z')],
    },
    {
      // 검색한 회원(가상회원A)이 B 선수인 경기 — 본인 8/20(40%), 상대 18/20(90%) → 패
      id: 's2',
      date: '2026-07-22',
      attendeeIds: ['a', 'b'],
      games: [game('g2', 'b', 'a', 18, 20, 8, 20, '2026-07-22T10:00:00Z')],
    },
  ] as Session[])
})

// 화면에서는 [승] 날짜 본인 vs 상대가 flex 간격으로 떨어져 보이므로,
// 표시 순서를 확인하기 위해 항목 안의 각 칸을 순서대로 이어 붙인다.
function trendItems(container: HTMLElement) {
  return [...container.querySelectorAll('.trend-item')].map((li) =>
    [...li.children]
      .map((el) => el.textContent!.replace(/\s+/g, ' ').trim())
      .filter((text) => text !== '') // 줄바꿈용 빈 칸(.trend-break)은 표시 내용이 아니므로 뺀다
      .join(' '),
  )
}

describe('DashboardTab 추이 — 최근 경기 한 줄 표시', () => {
  it('검색한 회원이 A 선수인 경기: [승] 날짜 본인 점수 vs 상대 점수 순서로 보인다', () => {
    const { container } = render(<DashboardTab />)
    fireEvent.click(screen.getByText('추이'))

    const items = trendItems(container)
    expect(items).toContain('승 2026-07-15 가상회원A 17/17 (100%) vs 가상회원B 10/12 (83%)')
  })

  it('검색한 회원이 B 선수인 경기도 본인이 항상 날짜 뒤 첫 번째에 오고, 승패도 본인 기준이다', () => {
    const { container } = render(<DashboardTab />)
    fireEvent.click(screen.getByText('추이'))

    const items = trendItems(container)
    expect(items).toContain('패 2026-07-22 가상회원A 8/20 (40%) vs 가상회원B 18/20 (90%)')
  })

  it('무승부는 "무" 글자로 구분해서 보여준다', () => {
    setUp([
      {
        id: 's3',
        date: '2026-07-29',
        attendeeIds: ['a', 'b'],
        games: [game('g3', 'a', 'b', 20, 20, 15, 15, '2026-07-29T10:00:00Z')],
      },
    ] as Session[])
    const { container } = render(<DashboardTab />)
    fireEvent.click(screen.getByText('추이'))

    expect(trendItems(container)).toEqual(['무 2026-07-29 가상회원A 20/20 (100%) vs 가상회원B 15/15 (100%)'])
  })

  it('핸디가 0인 과거 기록은 점수만 보여준다', () => {
    setUp([
      {
        id: 's4',
        date: '2026-07-30',
        attendeeIds: ['a', 'b'],
        games: [game('g4', 'a', 'b', 20, 0, 15, 0, '2026-07-30T10:00:00Z')],
      },
    ] as Session[])
    const { container } = render(<DashboardTab />)
    fireEvent.click(screen.getByText('추이'))

    expect(trendItems(container)).toEqual(['무 2026-07-30 가상회원A 20 vs 가상회원B 15'])
  })

  it('게스트로 볼 때는 본인·상대 이름이 모두 가려진다', () => {
    useAuth.setState({ memberId: '__guest__', memberName: '게스트', isGuest: true })
    const { container } = render(<DashboardTab />)
    fireEvent.click(screen.getByText('추이'))

    const items = trendItems(container)
    expect(items).toContain('승 2026-07-15 ●●● 17/17 (100%) vs ●●● 10/12 (83%)')
    expect(container.textContent).not.toContain('가상회원A')
  })

  it('별도의 "vs 상대" 줄이나 본인 점수만 있는 줄은 남기지 않는다 (한 항목 = 한 줄 구성)', () => {
    const { container } = render(<DashboardTab />)
    fireEvent.click(screen.getByText('추이'))

    const first = container.querySelector('.trend-item')!
    expect(first.querySelector('.right')).toBeNull()
    expect(first.querySelectorAll('.trend-side')).toHaveLength(2)
  })
})

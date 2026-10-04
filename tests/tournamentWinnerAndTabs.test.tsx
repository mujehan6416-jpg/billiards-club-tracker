import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// B) 승자 이름 강조(iPad에서 굵기 차이가 약했던 문제) · C) 대회 라운드 탭 전환 회귀 테스트.
// Firestore는 전부 모킹하고, 이름·ID는 가상 데이터만 쓴다.

type Meta = { fromCache: boolean; hasPendingWrites: boolean }
type OnData = (matches: TournamentMatch[], meta: Meta) => void
const fetchTournamentsMock = vi.fn()
const fetchTournamentParticipantsMock = vi.fn()
const fetchTournamentMatchesMock = vi.fn()
const subscribers = new Map<string, OnData>()

vi.mock('../src/lib/tournamentSync', () => ({
  fetchTournaments: (...a: unknown[]) => fetchTournamentsMock(...a),
  fetchTournamentParticipants: (...a: unknown[]) => fetchTournamentParticipantsMock(...a),
  fetchTournamentMatches: (...a: unknown[]) => fetchTournamentMatchesMock(...a),
  subscribeTournamentMatches: (id: string, onData: OnData) => { subscribers.set(id, onData); return () => subscribers.delete(id) },
  syncRestartJoiners: async () => 0,
  ensureTournamentDoc: async () => ({ created: false }),
}))

import { TournamentTab } from '../src/tabs/TournamentTab'
import { TournamentBracketView } from '../src/components/tournament/TournamentBracketView'
import { TournamentBracketVisual } from '../src/components/tournament/TournamentBracketVisual'
import { LOSER_NAME_COLOR, nameEmphasis, WINNER_NAME_BG, WINNER_NAME_COLOR } from '../src/components/tournament/tournamentDisplay'
import { useApp } from '../src/store/appStore'
import { useAuth } from '../src/store/authStore'
import { useAdmin } from '../src/store/adminStore'
import { useAdminAuthStore } from '../src/store/adminAuthStore'
import type { Tournament, TournamentMatch, TournamentParticipant } from '../src/types/tournament'
import { decide, decideRound, fullMain } from './fixtures/restartMain'
import { playRestart } from './fixtures/resultShare'

const nameOf = (id: string | null) => (id ? `가상선수${id.slice(1)}` : '')

// ───────────────────────────── B. 승자 이름 강조 ─────────────────────────────

describe('B. 승자 이름 강조 (승패 판정은 그대로, 표시만)', () => {
  const official = decide(fullMain(8), 'r1m1') // 승자 p1, 패자 p2
  const pending = fullMain(8)

  it('nameEmphasis: 확정된 경기에서 승자는 800 + 진한 초록 글자 + 연한 초록 배경, 패자는 400 + 진회색으로 대비를 크게 벌린다', () => {
    expect(nameEmphasis(true, true)).toEqual({
      fontWeight: 800, color: WINNER_NAME_COLOR, background: WINNER_NAME_BG, padding: '3px 10px', borderRadius: 8,
    })
    expect(nameEmphasis(true, false)).toEqual({ fontWeight: 400, color: LOSER_NAME_COLOR })
    expect(nameEmphasis(false, false)).toEqual({ fontWeight: 600 }) // 승패 전에는 기존 굵기
    expect(nameEmphasis(false, true)).toEqual({ fontWeight: 600 })
  })

  it('라운드별 카드: 승자 이름에 강조 스타일·data-winner=true, 패자에는 적용되지 않는다', () => {
    render(<TournamentBracketView matches={official} nameOf={nameOf} />)
    const winner = screen.getAllByText('가상선수1').find((e) => e.hasAttribute('data-winner'))!
    const loser = screen.getAllByText('가상선수2').find((e) => e.hasAttribute('data-winner'))!
    expect(winner.dataset.winner).toBe('true')
    expect(winner).toHaveStyle({ fontWeight: '800', color: WINNER_NAME_COLOR, background: WINNER_NAME_BG })
    expect(loser.dataset.winner).toBe('false')
    expect(loser).toHaveStyle({ fontWeight: '400', color: LOSER_NAME_COLOR })
    expect(loser.style.background).toBe('') // 패자에는 배경 칠이 없다
  })

  it('아직 승패가 없는 경기는 두 이름 모두 강조하지 않는다(data-winner 없음, 기존 굵기)', () => {
    render(<TournamentBracketView matches={pending} nameOf={nameOf} />)
    expect(document.querySelectorAll('[data-winner]')).toHaveLength(0)
  })

  it('전체 대진표(그림): 승자 칸은 연한 초록 배경 + 800 + 진한 초록 글자, 패자는 500 + 진회색이고 승패 전에는 기존 모양이다', () => {
    render(<TournamentBracketVisual matches={official} nameOf={nameOf} />)
    const winner = screen.getAllByText('가상선수1').find((e) => e.hasAttribute('data-winner'))!
    const loser = screen.getAllByText('가상선수2').find((e) => e.hasAttribute('data-winner'))!
    expect(winner.dataset.winner).toBe('true')
    expect(winner).toHaveStyle({ fontWeight: '800', color: WINNER_NAME_COLOR })
    expect(loser.dataset.winner).toBe('false')
    expect(loser).toHaveStyle({ fontWeight: '500', color: LOSER_NAME_COLOR })
    expect(winner.closest('div')!.style.background).toBe('rgb(214, 240, 227)') // WINNER_NAME_BG
    expect(loser.closest('div')!.style.background).not.toBe('rgb(214, 240, 227)')
    // 아직 승패가 없는 경기는 칠하지 않고 글자색도 바꾸지 않는다
    const { unmount } = render(<TournamentBracketVisual matches={pending} nameOf={nameOf} />)
    expect(screen.getAllByText('가상선수3')[1].style.color).toBe('')
    unmount()
  })

  it('화면 폭(폰·태블릿·PC)이 달라져도 같은 스타일이 유지된다 — 폭에 따라 바뀌는 규칙이 없다', () => {
    const results: string[] = []
    for (const width of [320, 768, 1024, 1366]) {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
      act(() => { window.dispatchEvent(new Event('resize')) })
      const { unmount } = render(<TournamentBracketView matches={official} nameOf={nameOf} />)
      const w = screen.getAllByText('가상선수1').find((e) => e.hasAttribute('data-winner'))!
      results.push(`${w.dataset.winner}/${w.style.fontWeight}/${w.style.color}`)
      unmount()
    }
    expect(new Set(results).size).toBe(1)
    expect(results[0]).toBe('true/800/rgb(11, 90, 69)')
  })

  it('부전승 경기는 승자 강조 대상이 아니다(점수 없는 진출이라 기존 표시 그대로)', () => {
    const bye = fullMain(8).map((m) => (m.id === 'r1m1' ? { ...m, resultType: 'bye' as const, status: 'official' as const, playerBParticipantId: null, officialWinnerParticipantId: 'p1' } : m))
    render(<TournamentBracketView matches={bye} nameOf={nameOf} />)
    expect(screen.getByText('부전승으로 다음 라운드 진출')).toBeInTheDocument()
    expect(document.querySelectorAll('[data-winner]')).toHaveLength(0)
  })
})

// ───────────────────────────── C. 대회 탭 전환 ─────────────────────────────

const activeTabs = () => screen.getAllByRole('button')
  .filter((b) => b.closest('[data-testid="round-tabs"]') && b.getAttribute('aria-pressed') === 'true')
  .map((b) => b.textContent?.replace('✅ ', ''))

describe('C. 라운드 탭 구조와 전환', () => {
  it('각 탭을 누르면 바로 그 라운드 화면으로 바뀌고, 선택된 탭이 표시된다(aria-pressed·primary)', () => {
    render(<TournamentBracketView matches={fullMain(16)} nameOf={nameOf} />)
    for (const label of ['8강', '4강', '결승', '16강']) {
      fireEvent.click(screen.getByRole('button', { name: new RegExp(label) }))
      expect(activeTabs()).toEqual([label])
      expect(screen.getByRole('button', { name: new RegExp(label) })).toHaveClass('primary')
    }
  })

  it('빠르게 여러 번 연달아 눌러도 마지막에 누른 탭이 정확히 선택된다', () => {
    render(<TournamentBracketView matches={fullMain(16)} nameOf={nameOf} />)
    const click = (label: string) => fireEvent.click(screen.getByRole('button', { name: new RegExp(label) }))
    for (const label of ['결승', '4강', '8강', '결승', '16강', '4강', '4강', '결승']) click(label)
    expect(activeTabs()).toEqual(['결승'])
    expect(document.querySelectorAll('[data-testid="round-tabs"] button.primary')).toHaveLength(1)
  })

  it('탭 줄은 가로 스크롤 컨테이너가 아니라 줄바꿈 구조이고, 모든 탭은 type=button·최소 높이 44px다', () => {
    render(<TournamentBracketView matches={fullMain(32)} nameOf={nameOf} />)
    const row = screen.getByTestId('round-tabs')
    expect(row.style.flexWrap).toBe('wrap')
    expect(row.style.overflowX).toBe('')
    const tabs = Array.from(row.querySelectorAll('button'))
    expect(tabs.length).toBeGreaterThanOrEqual(5) // 32강·16강·8강·4강·결승
    for (const b of tabs) {
      expect(b.getAttribute('type')).toBe('button')
      expect(b.style.minHeight).toBe('44px')
    }
  })

  it('3·4위전이 있는 대진에서도 모든 탭이 눌린다', () => {
    const matches = playRestart(true) // 리스타트 대진(1차전·합류 단계·4강·결승)
    render(<TournamentBracketView matches={matches} nameOf={nameOf} />)
    for (const label of ['8강', '4강', '결승', '16강']) {
      fireEvent.click(screen.getByRole('button', { name: new RegExp(label) }))
      expect(activeTabs()).toEqual([label])
    }
  })

  it('화면이 줄어든 폰·태블릿 폭에서도 탭 구조(줄바꿈, 44px)가 같다', () => {
    for (const width of [320, 768]) {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
      const { unmount } = render(<TournamentBracketView matches={fullMain(16)} nameOf={nameOf} />)
      expect(screen.getByTestId('round-tabs').style.flexWrap).toBe('wrap')
      unmount()
    }
  })

  it('전역 CSS: 버튼은 더블탭 확대 없이 바로 눌리도록 touch-action: manipulation이 걸려 있다', () => {
    const css = readFileSync(resolve(__dirname, '../src/index.css'), 'utf-8')
    expect(css).toMatch(/button,\s*\[role='button'\],\s*a\s*\{[^}]*touch-action:\s*manipulation/)
  })
})

// ───── 실제 대회 화면(TournamentTab)에서: 실시간 갱신·관리자 패널·리스타트 대회에서도 탭이 동작 ─────

const mainT: Tournament = { id: 'main', name: '가상 본선', date: '2026-10-05', timeLimitMinutes: 50, status: 'bracketFixed', bracketSize: 16, createdAt: '2026-10-01T00:00:00.000Z' }
const restartT: Tournament = { ...mainT, id: 'restart-main', name: '가상 본선 리스타트전', restartSourceTournamentId: 'main' }
const people = (prefix: string, n: number): TournamentParticipant[] => Array.from({ length: n }, (_, i) => ({
  id: `${prefix}${i + 1}`, memberId: `m${i + 1}`, displayNameSnapshot: `가상선수${i + 1}`, baseHandicapSnapshot: 20, tournamentHandicap: 20, entryStatus: 'entered' as const,
}))
const main16 = decideRound(fullMain(16), 1)
const restartMatches = playRestart(true)

function serve() {
  fetchTournamentsMock.mockResolvedValue([mainT, restartT])
  fetchTournamentParticipantsMock.mockImplementation(async (id: string) => (id === 'main' ? people('p', 16) : people('m', 16)))
  fetchTournamentMatchesMock.mockImplementation(async (id: string) => (id === 'main' ? main16 : restartMatches))
}
const open = async (name: string) => {
  render(<TournamentTab />)
  fireEvent.click(await screen.findByText(name))
  await screen.findByText(/경기 완료/)
}
const asAdmin = () => {
  useAdmin.setState({ isAdmin: true })
  useAdminAuthStore.setState({ status: 'authorizedAdmin', uid: 'uid-test', email: null, adminDisplayName: null, errorMessage: null })
}
/** 화면 위에 포인터를 가로챌 수 있는 고정·절대 위치 요소가 없는지: 있다면 pointer-events가 none이어야 한다. */
const overlayBlockers = () => Array.from(document.querySelectorAll<HTMLElement>('[style]'))
  .filter((e) => /position:\s*(fixed|absolute)/.test(e.getAttribute('style') ?? '') && !/pointer-events:\s*none/.test(e.getAttribute('style') ?? ''))

beforeEach(() => {
  vi.clearAllMocks()
  subscribers.clear()
  useApp.setState({ members: [] })
  useAuth.setState({ memberId: 'm1', memberName: '가상선수1', isGuest: false })
  useAdmin.setState({ isAdmin: false })
  useAdminAuthStore.setState({ status: 'unauthenticated', uid: null, email: null, adminDisplayName: null, errorMessage: null })
  serve()
})
afterEach(() => { vi.restoreAllMocks() })

describe('C. 대회 화면에서의 탭 동작', () => {
  it('일반 본선 대회: 탭을 누르면 전환되고, 실시간 갱신이 여러 번 들어와도 선택이 유지된다', async () => {
    await open('가상 본선')
    fireEvent.click(screen.getByRole('button', { name: /결승/ }))
    expect(activeTabs()).toEqual(['결승'])
    for (let i = 0; i < 3; i++) {
      act(() => subscribers.get('main')!([...main16], { fromCache: false, hasPendingWrites: false }))
    }
    expect(activeTabs()).toEqual(['결승'])
    fireEvent.click(screen.getByRole('button', { name: /8강/ }))
    expect(activeTabs()).toEqual(['8강'])
  })

  it('리스타트 대회: 탭이 모두 동작한다(합류 대기 자리가 있어도)', async () => {
    await open('가상 본선 리스타트전')
    for (const label of ['8강', '4강', '결승', '16강']) {
      fireEvent.click(screen.getByRole('button', { name: new RegExp(label) }))
      expect(activeTabs()).toEqual([label])
    }
  })

  it('관리자 패널(리스타트 보내기·경기결과 공유)을 열어 둬도 탭이 동작하고, 탭을 덮는 요소가 없다', async () => {
    asAdmin()
    await open('가상 본선')
    fireEvent.click(await screen.findByText('경기결과 공유'))
    fireEvent.click(screen.getByText('리스타트 참가자 보내기'))
    await screen.findByText('리스타트 대회 (자동 연결)')
    for (const label of ['8강', '4강', '결승']) {
      fireEvent.click(screen.getByRole('button', { name: new RegExp(label) }))
      expect(activeTabs()).toEqual([label])
    }
    expect(overlayBlockers()).toHaveLength(0)
  })

  it('실시간 알림(토스트)은 화면 위에 떠도 포인터를 막지 않는다(pointer-events: none)', async () => {
    await open('가상 본선')
    // 기준 스냅샷 다음에 완료 경기가 늘어난 스냅샷이 오면 알림이 뜬다
    act(() => subscribers.get('main')!([...main16], { fromCache: false, hasPendingWrites: false }))
    act(() => subscribers.get('main')!(decideRound(main16, 2), { fromCache: false, hasPendingWrites: false }))
    const toast = await screen.findByRole('status')
    expect(toast.getAttribute('style')).toMatch(/position:\s*fixed/)
    expect(toast.getAttribute('style')).toMatch(/pointer-events:\s*none/)
    expect(overlayBlockers()).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: /결승/ }))
    expect(activeTabs()).toEqual(['결승'])
  })
})

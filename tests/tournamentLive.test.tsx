import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

// 실시간 반영(대회 경기결과) 테스트. Firestore는 전부 모킹하고, 이름·ID는 가상 데이터만 쓴다.

type Meta = { fromCache: boolean; hasPendingWrites: boolean }
type OnData = (matches: TournamentMatch[], meta: Meta) => void

const fetchTournamentsMock = vi.fn()
const fetchTournamentParticipantsMock = vi.fn()
const fetchTournamentMatchesMock = vi.fn()
const unsubscribeMock = vi.fn()
let emit: OnData = () => {}
let emitError: () => void = () => {}
const subscribeMock = vi.fn((_id: string, onData: OnData, onError: () => void) => {
  emit = onData
  emitError = onError
  return unsubscribeMock
})

vi.mock('../src/lib/tournamentSync', () => ({
  fetchTournaments: (...a: unknown[]) => fetchTournamentsMock(...a),
  fetchTournamentParticipants: (...a: unknown[]) => fetchTournamentParticipantsMock(...a),
  fetchTournamentMatches: (...a: unknown[]) => fetchTournamentMatchesMock(...a),
  subscribeTournamentMatches: (...a: [string, OnData, () => void]) => subscribeMock(...a),
}))

import { TournamentTab } from '../src/tabs/TournamentTab'
import { countTournamentProgress } from '../src/logic/tournamentMatch'
import { useApp } from '../src/store/appStore'
import { useAuth } from '../src/store/authStore'
import { useAdmin } from '../src/store/adminStore'
import type { Tournament, TournamentMatch, TournamentParticipant } from '../src/types/tournament'

function match(id: string, over: Partial<TournamentMatch> = {}): TournamentMatch {
  return {
    id, roundNumber: 1, playerCountInRound: 4, matchNumber: 1,
    playerAParticipantId: 'p1', playerBParticipantId: 'p2', playerAMemberId: 'm1', playerBMemberId: 'm2',
    playerAHandicapSnapshot: 20, playerBHandicapSnapshot: 18, scoreA: null, scoreB: null,
    resultType: 'normal', status: 'awaitingResult', nextMatchId: null, nextSlot: null, ...over,
  }
}
const official = (id: string): TournamentMatch =>
  match(id, { status: 'official', scoreA: 20, scoreB: 10, officialWinnerParticipantId: 'p1', officialLoserParticipantId: 'p2' })
const bye = (id: string): TournamentMatch => match(id, { resultType: 'bye', status: 'official' })

const tournament: Tournament = {
  id: 't1', name: '가상 대회', date: '2026-10-05', timeLimitMinutes: 50,
  status: 'bracketFixed', bracketSize: 4, createdAt: '2026-10-01T00:00:00.000Z',
}
const participants: TournamentParticipant[] = ['p1', 'p2'].map((id, i) => ({
  id, memberId: `m${i + 1}`, displayNameSnapshot: `가상선수${i + 1}`,
  baseHandicapSnapshot: 20, tournamentHandicap: 20, entryStatus: 'entered' as const,
}))
const SERVER: Meta = { fromCache: false, hasPendingWrites: false }
const TOAST = '새 경기결과가 반영되었습니다.'

async function openDetail() {
  render(<TournamentTab />)
  fireEvent.click(await screen.findByText('가상 대회'))
  await screen.findByText(/경기 완료/)
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.clearAllMocks()
  useApp.setState({ members: [] })
  useAuth.setState({ memberId: 'm1', memberName: '가상선수1', isGuest: false })
  useAdmin.setState({ isAdmin: false })
  fetchTournamentsMock.mockResolvedValue([tournament])
  fetchTournamentParticipantsMock.mockResolvedValue(participants)
  fetchTournamentMatchesMock.mockResolvedValue([match('a'), match('b'), bye('c')])
})
afterEach(() => { vi.useRealTimers() })

describe('countTournamentProgress', () => {
  it('부전승은 빼고, 공식 확정된 경기만 완료로 센다', () => {
    const list = [official('a'), match('b'), bye('c'),
      match('d', { resultType: 'forfeit', status: 'official' }), match('e', { status: 'awaitingApproval' })]
    expect(countTournamentProgress(list)).toEqual({ done: 2, total: 4 })
  })
  it('경기가 없으면 0 / 0', () => {
    expect(countTournamentProgress([])).toEqual({ done: 0, total: 0 })
  })
})

describe('대회 경기결과 실시간 반영', () => {
  it('상세 화면에서 한 번만 구독하고, 화면을 떠나면 구독을 끊는다', async () => {
    await openDetail()
    expect(subscribeMock).toHaveBeenCalledTimes(1)
    expect(subscribeMock.mock.calls[0][0]).toBe('t1')
    expect(unsubscribeMock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('← 대회 목록'))
    expect(unsubscribeMock).toHaveBeenCalledTimes(1)
  })

  it('최초 수신에는 알림이 없고, 완료 경기가 늘면 알림과 진행률이 갱신된다', async () => {
    await openDetail()
    expect(screen.getByText('0 / 2 경기 완료')).toBeInTheDocument()
    act(() => emit([match('a'), match('b'), bye('c')], SERVER))
    expect(screen.queryByText(TOAST)).toBeNull()
    expect(screen.getByText(/최근 업데이트: \d{2}:\d{2}/)).toBeInTheDocument()

    act(() => emit([official('a'), match('b'), bye('c')], SERVER))
    expect(screen.getByText(TOAST)).toBeInTheDocument()
    expect(screen.getByText('1 / 2 경기 완료')).toBeInTheDocument()
  })

  it('알림은 3초 뒤 사라지고, 연속 입력해도 하나만 보이며 타이머가 새로 시작된다', async () => {
    await openDetail()
    act(() => emit([match('a'), match('b')], SERVER))
    act(() => emit([official('a'), match('b')], SERVER))
    act(() => { vi.advanceTimersByTime(2000) })
    act(() => emit([official('a'), official('b')], SERVER))
    expect(screen.getAllByText(TOAST)).toHaveLength(1)
    act(() => { vi.advanceTimersByTime(2000) })
    expect(screen.getByText(TOAST)).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(1500) })
    expect(screen.queryByText(TOAST)).toBeNull()
  })

  it('승인 대기 점수는 알림·진행률·승패를 바꾸지 않고, 최종 승인(official)되는 순간에만 공개된다', async () => {
    await openDetail()
    act(() => emit([match('a'), match('b')], SERVER))
    const pending = match('a', { status: 'awaitingApproval', scoreA: 17, scoreB: 9, calculatedWinnerParticipantId: 'p1' })
    act(() => emit([pending, match('b')], SERVER))
    expect(screen.queryByText(TOAST)).toBeNull()
    expect(screen.getByText('0 / 2 경기 완료')).toBeInTheDocument()
    expect(screen.queryByText(/승자/)).toBeNull()

    act(() => emit([official('a'), match('b')], SERVER))
    expect(screen.getByText(TOAST)).toBeInTheDocument()
    expect(screen.getByText('1 / 2 경기 완료')).toBeInTheDocument()
    expect(screen.getByText(/승자 가상선수1/)).toBeInTheDocument()
  })

  it('이 기기가 직접 쓴 임시 반영에는 알림을 띄우지 않는다', async () => {
    await openDetail()
    act(() => emit([match('a'), match('b')], SERVER))
    act(() => emit([official('a'), match('b')], { fromCache: false, hasPendingWrites: true }))
    expect(screen.queryByText(TOAST)).toBeNull()
    expect(screen.getByText('1 / 2 경기 완료')).toBeInTheDocument()
  })

  it('실시간 연결 오류가 나면 새로고침 안내를 보여주고, 새로고침으로 다시 읽는다', async () => {
    await openDetail()
    act(() => emitError())
    expect(screen.getByText('실시간 연결이 끊겼습니다. 새로고침을 눌러 주세요.')).toBeInTheDocument()
    fetchTournamentMatchesMock.mockResolvedValue([official('a'), match('b')])
    await act(async () => { fireEvent.click(screen.getByText('새로고침')) })
    expect(fetchTournamentMatchesMock).toHaveBeenCalledWith('t1', 'skkubc')
    expect(screen.getByText('1 / 2 경기 완료')).toBeInTheDocument()
    expect(screen.queryByText(/실시간 연결이 끊겼습니다/)).toBeNull()
  })

  it('대진 확정 전 대회에서는 구독하지 않는다', async () => {
    fetchTournamentsMock.mockResolvedValue([{ ...tournament, status: 'draft' }])
    render(<TournamentTab />)
    fireEvent.click(await screen.findByText('가상 대회'))
    await screen.findByText('← 대회 목록')
    expect(subscribeMock).not.toHaveBeenCalled()
  })
})

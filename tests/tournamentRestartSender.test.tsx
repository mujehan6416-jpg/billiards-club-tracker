import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// 화면 흐름 + TournamentTab 연결 테스트. Firestore는 전부 모킹하고, 이름·ID는 가상 데이터만 쓴다.

const fetchTournamentsMock = vi.fn()
const fetchTournamentParticipantsMock = vi.fn()
const fetchTournamentMatchesMock = vi.fn()
const setParticipantEntryStatusMock = vi.fn()
const writeTournamentParticipantMock = vi.fn()
const subscribeMock = vi.fn(() => () => {})

vi.mock('../src/lib/tournamentSync', () => ({
  fetchTournaments: (...a: unknown[]) => fetchTournamentsMock(...a),
  fetchTournamentParticipants: (...a: unknown[]) => fetchTournamentParticipantsMock(...a),
  fetchTournamentMatches: (...a: unknown[]) => fetchTournamentMatchesMock(...a),
  subscribeTournamentMatches: () => subscribeMock(),
  setParticipantEntryStatus: (...a: unknown[]) => setParticipantEntryStatusMock(...a),
  writeTournamentParticipant: (...a: unknown[]) => writeTournamentParticipantMock(...a),
}))

import { TournamentTab } from '../src/tabs/TournamentTab'
import { useApp } from '../src/store/appStore'
import { useAuth } from '../src/store/authStore'
import { useAdmin } from '../src/store/adminStore'
import { useAdminAuthStore } from '../src/store/adminAuthStore'
import type { Member } from '../src/types'
import type { Tournament, TournamentMatch, TournamentParticipant } from '../src/types/tournament'

const members: Member[] = [1, 2, 3, 4, 5].map((n) => ({
  id: `m${n}`, name: `가상선수${n}`, handicap: 20,
  handicapHistory: [{ value: 20, changedAt: '2026-01-01T00:00:00.000Z' }], active: true,
}))

const main: Tournament = {
  id: 'main', name: '가상 본선', date: '2026-10-05', timeLimitMinutes: 50, status: 'bracketFixed', bracketSize: 4,
  createdAt: '2026-10-01T00:00:00.000Z',
}
const restart: Tournament = { ...main, id: 'restart', name: '가상 본선 리스타트전', status: 'draft', bracketSize: undefined }
const fixedOther: Tournament = { ...main, id: 'fixed', name: '가상 다른 대회' }

const mainParticipants: TournamentParticipant[] = [1, 2, 3, 4].map((n) => ({
  id: `p${n}`, memberId: `m${n}`, displayNameSnapshot: `가상선수${n}`,
  baseHandicapSnapshot: 20, tournamentHandicap: 20, entryStatus: 'entered' as const,
}))
// 리스타트 대회(참가 신청 중): 전원이 미응답 문서로 이미 있고, m2만 이미 참가 중
const restartParticipants: TournamentParticipant[] = members.map((m) => ({
  id: m.id, memberId: m.id, displayNameSnapshot: m.name, baseHandicapSnapshot: 20, tournamentHandicap: 20,
  entryStatus: m.id === 'm2' ? ('entered' as const) : ('noResponse' as const),
}))

function match(id: string, a: number, b: number, status: TournamentMatch['status'], loser?: number): TournamentMatch {
  return {
    id, roundNumber: 1, playerCountInRound: 4, matchNumber: Number(id.slice(1)),
    playerAParticipantId: `p${a}`, playerBParticipantId: `p${b}`, playerAMemberId: `m${a}`, playerBMemberId: `m${b}`,
    playerAHandicapSnapshot: 20, playerBHandicapSnapshot: 20,
    scoreA: status === 'awaitingResult' ? null : 20, scoreB: status === 'awaitingResult' ? null : 10,
    resultType: 'normal', status, nextMatchId: null, nextSlot: null,
    ...(status === 'official' && loser
      ? { officialWinnerParticipantId: `p${loser === a ? b : a}`, officialLoserParticipantId: `p${loser}` } : {}),
  }
}
// 경기1: 가상선수2 패(승인 완료) / 경기2: 승인 대기(후보 아님)
const matches = [match('r1', 1, 2, 'official', 2), match('r2', 3, 4, 'awaitingApproval')]

function asAdmin() {
  useAdmin.setState({ isAdmin: true })
  useAdminAuthStore.setState({ status: 'authorizedAdmin', uid: 'uid-test', email: null, adminDisplayName: null, errorMessage: null })
}

async function openMain() {
  render(<TournamentTab />)
  fireEvent.click(await screen.findByText('가상 본선'))
  await screen.findByText(/경기 완료/)
}

beforeEach(() => {
  vi.clearAllMocks()
  useApp.setState({ members })
  useAuth.setState({ memberId: null, memberName: null, isGuest: false })
  useAdmin.setState({ isAdmin: false })
  useAdminAuthStore.setState({ status: 'unauthenticated', uid: null, email: null, adminDisplayName: null, errorMessage: null })
  fetchTournamentsMock.mockResolvedValue([main, restart, fixedOther])
  fetchTournamentParticipantsMock.mockImplementation(async (id: string) => (id === 'main' ? mainParticipants : restartParticipants))
  fetchTournamentMatchesMock.mockResolvedValue(matches)
})
afterEach(() => { vi.restoreAllMocks() })

describe('권한', () => {
  it('일반 회원에게는 리스타트 보내기 UI가 보이지 않는다', async () => {
    useAuth.setState({ memberId: 'm1', memberName: '가상선수1', isGuest: false })
    await openMain()
    expect(screen.queryByText('리스타트 참가자 보내기')).toBeNull()
  })

  it('관리자에게는 보인다', async () => {
    asAdmin()
    await openMain()
    expect(screen.getByText('리스타트 참가자 보내기')).toBeInTheDocument()
  })
})

describe('후보 표시와 대상 대회 선택', () => {
  it('최종 승인된 패자만 후보로 보이고, 승인 대기 경기의 선수는 보이지 않는다', async () => {
    asAdmin()
    await openMain()
    fireEvent.click(screen.getByText('리스타트 참가자 보내기'))
    expect(screen.getByRole('checkbox')).toBeInTheDocument()
    expect(screen.getAllByRole('checkbox')).toHaveLength(1)
    expect(screen.getAllByText('가상선수2').length).toBeGreaterThan(0)
  })

  it('확정 탈락자가 없으면 안내 문구가 나온다', async () => {
    asAdmin()
    fetchTournamentMatchesMock.mockResolvedValue([match('r1', 1, 2, 'awaitingApproval')])
    await openMain()
    fireEvent.click(screen.getByText('리스타트 참가자 보내기'))
    expect(screen.getByText('아직 리스타트 대상이 되는 확정 탈락자가 없습니다.')).toBeInTheDocument()
  })

  it('리스타트 대회는 이름으로 자동 연결되고(목록에서 고르지 않음), 이름이 다른 대회·본선 자신은 대상이 아니다', async () => {
    asAdmin()
    await openMain()
    fireEvent.click(screen.getByText('리스타트 참가자 보내기'))
    expect(screen.getByText('가상 본선 리스타트전')).toBeInTheDocument()
    expect(screen.queryByText('가상 다른 대회')).toBeNull()
    expect(screen.queryByRole('button', { name: '가상 본선' })).toBeNull()
    expect(screen.getByRole('checkbox')).not.toBeDisabled()
  })

  it('연결된 리스타트 대회가 이미 대진 확정 상태면 안내가 나오고 추가할 수 없다', async () => {
    asAdmin()
    fetchTournamentsMock.mockResolvedValue([main, { ...restart, status: 'bracketFixed' }])
    await openMain()
    fireEvent.click(screen.getByText('리스타트 참가자 보내기'))
    expect(screen.getByText('이미 대진이 확정된 대회에는 참가자를 추가할 수 없습니다.')).toBeInTheDocument()
    expect(screen.getByRole('checkbox')).toBeDisabled()
  })
})

describe('참가자 추가', () => {
  it('이미 대상 대회에 참가 중인 후보는 "이미 참가 중"으로 표시되고 선택할 수 없어 중복 추가되지 않는다', async () => {
    asAdmin()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await openMain()
    fireEvent.click(screen.getByText('리스타트 참가자 보내기'))
    fireEvent.click(screen.getByRole('checkbox'))
    await waitFor(() => expect(fetchTournamentParticipantsMock).toHaveBeenCalledWith('restart', 'skkubc'))
    expect(await screen.findByText('이미 참가 중')).toBeInTheDocument()
    expect(screen.getByRole('checkbox')).toBeDisabled()
    expect(setParticipantEntryStatusMock).not.toHaveBeenCalled()
  })

  it('이미 참가 중이 아닌 후보는 대상 대회에 참가(entered)로 추가되고, 기존 참가자는 건드리지 않는다', async () => {
    asAdmin()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    // 확정 탈락자 3명: 가상선수2(리스타트 대회에 이미 참가 중), 가상선수3·4(미응답 문서로 존재)
    fetchTournamentMatchesMock.mockResolvedValue([
      match('r1', 1, 2, 'official', 2), match('r2', 1, 3, 'official', 3), match('r3', 1, 4, 'official', 4),
    ])
    await openMain()
    fireEvent.click(screen.getByText('리스타트 참가자 보내기'))
    expect(await screen.findByText('이미 참가 중')).toBeInTheDocument()
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    expect(boxes.filter((b) => b.disabled)).toHaveLength(1) // 이미 참가 중인 가상선수2는 선택 불가
    boxes.filter((b) => !b.disabled).forEach((b) => fireEvent.click(b))
    fireEvent.click(screen.getByText('선택한 2명 보내기'))
    await waitFor(() => expect(setParticipantEntryStatusMock).toHaveBeenCalledTimes(2))
    // 대상 대회의 기존 문서를 참가 상태로만 바꾼다 — 기존 참가자(m2 등)는 건드리지 않고 새 문서도 만들지 않는다
    expect(setParticipantEntryStatusMock.mock.calls.map((c) => c.slice(0, 3))).toEqual([
      ['restart', 'm3', 'entered'], ['restart', 'm4', 'entered'],
    ])
    expect(writeTournamentParticipantMock).not.toHaveBeenCalled()
    expect(await screen.findByText('리스타트 대회에 2명을 추가했습니다.')).toBeInTheDocument()
  })

  it('대상 대회에 문서가 없는 회원은 기존 방식(회원 정보 스냅샷)으로 새로 만든다', async () => {
    asAdmin()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fetchTournamentParticipantsMock.mockImplementation(async (id: string) => (id === 'main' ? mainParticipants : []))
    await openMain()
    fireEvent.click(screen.getByText('리스타트 참가자 보내기'))
    fireEvent.click(screen.getByRole('checkbox'))
    await waitFor(() => expect(screen.getByText('1명 보내기', { exact: false })).not.toBeDisabled())
    fireEvent.click(screen.getByText(/명 보내기$/))
    await waitFor(() => expect(writeTournamentParticipantMock).toHaveBeenCalledTimes(1))
    const [tid, saved] = writeTournamentParticipantMock.mock.calls[0]
    expect(tid).toBe('restart')
    expect(saved).toMatchObject({ id: 'm2', memberId: 'm2', displayNameSnapshot: '가상선수2', entryStatus: 'entered' })
    expect(setParticipantEntryStatusMock).not.toHaveBeenCalled()
  })

  it('확인창에서 취소하면 저장하지 않는다', async () => {
    asAdmin()
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    fetchTournamentParticipantsMock.mockImplementation(async (id: string) => (id === 'main' ? mainParticipants : []))
    await openMain()
    fireEvent.click(screen.getByText('리스타트 참가자 보내기'))
    fireEvent.click(screen.getByRole('checkbox'))
    await waitFor(() => expect(screen.getByText(/명 보내기$/)).not.toBeDisabled())
    fireEvent.click(screen.getByText(/명 보내기$/))
    expect(window.confirm).toHaveBeenCalled()
    expect(writeTournamentParticipantMock).not.toHaveBeenCalled()
    expect(setParticipantEntryStatusMock).not.toHaveBeenCalled()
  })

  it('아무도 선택하지 않으면 보내기 버튼이 눌리지 않고 저장도 없다', async () => {
    asAdmin()
    await openMain()
    fireEvent.click(screen.getByText('리스타트 참가자 보내기'))
    await waitFor(() => expect(fetchTournamentParticipantsMock).toHaveBeenCalledWith('restart', 'skkubc'))
    expect(screen.getByText('보낼 사람을 선택해 주세요').closest('button')).toBeDisabled()
    expect(writeTournamentParticipantMock).not.toHaveBeenCalled()
    expect(setParticipantEntryStatusMock).not.toHaveBeenCalled()
  })

  it('저장 직전에 대상 대회가 이미 대진 확정 상태로 바뀌었으면 추가하지 않는다', async () => {
    asAdmin()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fetchTournamentParticipantsMock.mockImplementation(async (id: string) => (id === 'main' ? mainParticipants : []))
    await openMain()
    fireEvent.click(screen.getByText('리스타트 참가자 보내기'))
    fireEvent.click(screen.getByRole('checkbox'))
    await waitFor(() => expect(screen.getByText(/명 보내기$/)).not.toBeDisabled())
    fetchTournamentsMock.mockResolvedValue([main, { ...restart, status: 'bracketFixed' }, fixedOther])
    fireEvent.click(screen.getByText(/명 보내기$/))
    expect(await screen.findByText(/처리하지 못했습니다/)).toBeInTheDocument()
    expect(writeTournamentParticipantMock).not.toHaveBeenCalled()
    expect(setParticipantEntryStatusMock).not.toHaveBeenCalled()
  })
})

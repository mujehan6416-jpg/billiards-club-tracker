import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// Firestore 호출부를 전부 모킹한다 — 실제 네트워크에 절대 접근하지 않는다.
const createTournamentMock = vi.fn()
const createMissingParticipantsMock = vi.fn()
const fetchTournamentsMock = vi.fn()
const fetchTournamentParticipantsMock = vi.fn()
const setParticipantEntryStatusMock = vi.fn()
const excludeParticipantByAdminMock = vi.fn()
const setParticipantTournamentHandicapMock = vi.fn()
const writeTournamentParticipantMock = vi.fn()
const confirmTournamentEntriesMock = vi.fn()
const reopenTournamentEntriesMock = vi.fn()
const prepareTournamentDrawMock = vi.fn()
const saveTournamentDrawNumbersMock = vi.fn()
const loadTournamentDrawMappingMock = vi.fn()
const confirmTournamentBracketMock = vi.fn()
const cancelTournamentBracketMock = vi.fn()
const fetchTournamentMatchesMock = vi.fn()
const deleteTournamentMock = vi.fn()

vi.mock('../src/lib/tournamentSync', () => ({
  createTournament: (...args: unknown[]) => createTournamentMock(...args),
  createMissingParticipants: (...args: unknown[]) => createMissingParticipantsMock(...args),
  fetchTournaments: (...args: unknown[]) => fetchTournamentsMock(...args),
  fetchTournamentParticipants: (...args: unknown[]) => fetchTournamentParticipantsMock(...args),
  setParticipantEntryStatus: (...args: unknown[]) => setParticipantEntryStatusMock(...args),
  excludeParticipantByAdmin: (...args: unknown[]) => excludeParticipantByAdminMock(...args),
  setParticipantTournamentHandicap: (...args: unknown[]) => setParticipantTournamentHandicapMock(...args),
  writeTournamentParticipant: (...args: unknown[]) => writeTournamentParticipantMock(...args),
  confirmTournamentEntries: (...args: unknown[]) => confirmTournamentEntriesMock(...args),
  reopenTournamentEntries: (...args: unknown[]) => reopenTournamentEntriesMock(...args),
  prepareTournamentDraw: (...args: unknown[]) => prepareTournamentDrawMock(...args),
  saveTournamentDrawNumbers: (...args: unknown[]) => saveTournamentDrawNumbersMock(...args),
  loadTournamentDrawMapping: (...args: unknown[]) => loadTournamentDrawMappingMock(...args),
  confirmTournamentBracket: (...args: unknown[]) => confirmTournamentBracketMock(...args),
  cancelTournamentBracket: (...args: unknown[]) => cancelTournamentBracketMock(...args),
  fetchTournamentMatches: (...args: unknown[]) => fetchTournamentMatchesMock(...args),
  deleteTournament: (...args: unknown[]) => deleteTournamentMock(...args),
}))

import { TournamentTab } from '../src/tabs/TournamentTab'
import { useApp } from '../src/store/appStore'
import { useAuth } from '../src/store/authStore'
import { useAdmin } from '../src/store/adminStore'
import { useAdminAuthStore } from '../src/store/adminAuthStore'
import type { Member } from '../src/types'
import type { Tournament, TournamentParticipant } from '../src/types/tournament'

// 아래 이름·ID는 전부 가상 데이터다 — 실제 회원 정보가 아니다.

const members: Member[] = [
  { id: 'm1', name: '테스트회원A', handicap: 20, handicapHistory: [{ value: 20, changedAt: '2026-01-01T00:00:00.000Z' }], active: true },
  { id: 'm2', name: '테스트회원B', handicap: 18, handicapHistory: [{ value: 18, changedAt: '2026-01-01T00:00:00.000Z' }], active: true },
]

const draftTournament: Tournament = {
  id: 't1', name: '테스트 대회', date: '2026-10-01', timeLimitMinutes: 50,
  status: 'draft', createdAt: '2026-09-01T00:00:00.000Z',
}

const participants: TournamentParticipant[] = [
  { id: 'm1', memberId: 'm1', displayNameSnapshot: '테스트회원A', baseHandicapSnapshot: 20, tournamentHandicap: 20, entryStatus: 'noResponse' },
  { id: 'm2', memberId: 'm2', displayNameSnapshot: '테스트회원B', baseHandicapSnapshot: 18, tournamentHandicap: 18, entryStatus: 'noResponse' },
]

beforeEach(() => {
  vi.clearAllMocks()
  useApp.setState({ members })
  useAuth.setState({ memberId: null, memberName: null, isGuest: false })
  useAdmin.setState({ isAdmin: false })
  useAdminAuthStore.setState({ status: 'unauthenticated', uid: null, email: null, adminDisplayName: null, errorMessage: null })
  fetchTournamentsMock.mockResolvedValue([draftTournament])
  fetchTournamentParticipantsMock.mockResolvedValue(participants)
})

describe('대회 목록', () => {
  it('대회 목록이 렌더링된다', async () => {
    render(<TournamentTab />)
    expect(await screen.findByText('테스트 대회')).toBeInTheDocument()
    expect(screen.getByText('참가 신청 중')).toBeInTheDocument()
  })
})

describe('회원 참가/불참', () => {
  beforeEach(() => {
    useAuth.setState({ memberId: 'm1', memberName: '테스트회원A', isGuest: false })
  })

  it('참가 버튼을 누르면 setParticipantEntryStatus가 entered로 호출된다', async () => {
    render(<TournamentTab />)
    fireEvent.click(await screen.findByText('테스트 대회'))
    fireEvent.click(await screen.findByText('참가합니다'))
    await waitFor(() => expect(setParticipantEntryStatusMock).toHaveBeenCalledWith('t1', 'm1', 'entered', 'skkubc'))
  })

  it('불참 버튼을 누르면 declined로 호출된다', async () => {
    render(<TournamentTab />)
    fireEvent.click(await screen.findByText('테스트 대회'))
    fireEvent.click(await screen.findByText('참가하지 않습니다'))
    await waitFor(() => expect(setParticipantEntryStatusMock).toHaveBeenCalledWith('t1', 'm1', 'declined', 'skkubc'))
  })

  it('현재 상태가 화면에 표시된다', async () => {
    fetchTournamentParticipantsMock.mockResolvedValue([
      { ...participants[0], entryStatus: 'entered' },
      participants[1],
    ])
    render(<TournamentTab />)
    fireEvent.click(await screen.findByText('테스트 대회'))
    expect(await screen.findByText('현재 선택: 참가')).toBeInTheDocument()
  })

  it('참가자 확정 후에는 참가/불참 버튼이 사라진다', async () => {
    fetchTournamentsMock.mockResolvedValue([{ ...draftTournament, status: 'entryClosed', participantCount: 1 }])
    render(<TournamentTab />)
    fireEvent.click(await screen.findByText('테스트 대회'))
    await screen.findByText('내 참가 여부')
    expect(screen.queryByText('참가합니다')).not.toBeInTheDocument()
    expect(screen.getByText('참가자가 확정되어 더 이상 변경할 수 없습니다.')).toBeInTheDocument()
  })
})

describe('관리자 — 대회 생성', () => {
  it('일반 회원에게는 "새 대회 만들기" 버튼이 보이지 않는다', async () => {
    render(<TournamentTab />)
    await screen.findByText('테스트 대회')
    expect(screen.queryByText('+ 새 대회 만들기')).not.toBeInTheDocument()
  })

  it('PIN만 통과하고 Firebase 관리자 인증 전에는 생성 버튼 대신 로그인 안내가 뜬다', async () => {
    useAdmin.setState({ isAdmin: true })
    render(<TournamentTab />)
    await screen.findByText('테스트 대회')
    expect(screen.queryByText('+ 새 대회 만들기')).not.toBeInTheDocument()
    expect(screen.getByText('🔐 관리자 Firebase 로그인')).toBeInTheDocument()
  })

  it('PIN + Firebase 인증이 모두 된 관리자에게는 생성 버튼이 보이고, 제출하면 createTournament + createMissingParticipants가 호출된다', async () => {
    useAdmin.setState({ isAdmin: true })
    useAdminAuthStore.setState({ status: 'authorizedAdmin', uid: 'admin-1', email: 'a@test', adminDisplayName: '관리자', errorMessage: null })
    createTournamentMock.mockResolvedValue(undefined)
    createMissingParticipantsMock.mockResolvedValue(2)

    render(<TournamentTab />)
    fireEvent.click(await screen.findByText('+ 새 대회 만들기'))

    fireEvent.change(screen.getByPlaceholderText('예: 추석맞이 대회'), { target: { value: '새 대회' } })
    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement
    fireEvent.change(dateInput, { target: { value: '2026-11-01' } })
    fireEvent.click(screen.getByText('60분'))
    fireEvent.click(screen.getByText('대회 만들기'))

    await waitFor(() => expect(createTournamentMock).toHaveBeenCalledTimes(1))
    const [createdTournament] = createTournamentMock.mock.calls[0]
    expect(createdTournament.name).toBe('새 대회')
    expect(createdTournament.date).toBe('2026-11-01')
    expect(createdTournament.timeLimitMinutes).toBe(60)
    expect(createdTournament.status).toBe('draft')
    expect(createMissingParticipantsMock).toHaveBeenCalledWith(createdTournament.id, members, 'skkubc')
  })
})

describe('관리자 — 참가 현황·참가자 관리', () => {
  beforeEach(() => {
    useAdmin.setState({ isAdmin: true })
    useAdminAuthStore.setState({ status: 'authorizedAdmin', uid: 'admin-1', email: 'a@test', adminDisplayName: '관리자', errorMessage: null })
  })

  it('참가 현황 요약이 표시된다', async () => {
    fetchTournamentParticipantsMock.mockResolvedValue([
      { ...participants[0], entryStatus: 'entered' },
      { ...participants[1], entryStatus: 'declined' },
    ])
    render(<TournamentTab />)
    fireEvent.click(await screen.findByText('테스트 대회'))
    expect(await screen.findByText('참가 1명 · 불참 1명 · 미응답 0명')).toBeInTheDocument()
  })

  it('제외 버튼을 누르고 확인하면 excludeParticipantByAdmin이 호출된다', async () => {
    fetchTournamentParticipantsMock.mockResolvedValue([{ ...participants[0], entryStatus: 'entered' }])
    excludeParticipantByAdminMock.mockResolvedValue(undefined)
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<TournamentTab />)
    fireEvent.click(await screen.findByText('테스트 대회'))
    fireEvent.click(await screen.findByText('참가자에서 제외'))

    await waitFor(() => expect(excludeParticipantByAdminMock).toHaveBeenCalledWith(
      't1', 'm1', { adminUid: 'admin-1', at: expect.any(String) }, 'skkubc',
    ))
  })

  it('제외 확인창에서 취소하면 excludeParticipantByAdmin이 호출되지 않는다', async () => {
    fetchTournamentParticipantsMock.mockResolvedValue([{ ...participants[0], entryStatus: 'entered' }])
    vi.spyOn(window, 'confirm').mockReturnValue(false)

    render(<TournamentTab />)
    fireEvent.click(await screen.findByText('테스트 대회'))
    fireEvent.click(await screen.findByText('참가자에서 제외'))

    expect(excludeParticipantByAdminMock).not.toHaveBeenCalled()
  })

  it('대회 핸디 입력칸을 바꾸면 setParticipantTournamentHandicap이 호출된다', async () => {
    fetchTournamentParticipantsMock.mockResolvedValue([{ ...participants[0], entryStatus: 'entered' }])
    setParticipantTournamentHandicapMock.mockResolvedValue(undefined)

    render(<TournamentTab />)
    fireEvent.click(await screen.findByText('테스트 대회'))
    const handicapInput = await screen.findByDisplayValue('20')
    fireEvent.change(handicapInput, { target: { value: '17' } })
    fireEvent.blur(handicapInput)

    await waitFor(() => expect(setParticipantTournamentHandicapMock).toHaveBeenCalledWith('t1', 'm1', 17, 'skkubc'))
  })

  it('미응답 회원을 추가 목록에서 누르면 writeTournamentParticipant가 entered로 호출된다(문서가 없던 회원)', async () => {
    fetchTournamentParticipantsMock.mockResolvedValue([{ ...participants[0], entryStatus: 'entered' }]) // m2는 참가자 문서 자체가 없음
    writeTournamentParticipantMock.mockResolvedValue(undefined)

    render(<TournamentTab />)
    fireEvent.click(await screen.findByText('테스트 대회'))
    fireEvent.click(await screen.findByText('+ 테스트회원B'))

    await waitFor(() => expect(writeTournamentParticipantMock).toHaveBeenCalledTimes(1))
    const [, participant] = writeTournamentParticipantMock.mock.calls[0]
    expect(participant.memberId).toBe('m2')
    expect(participant.entryStatus).toBe('entered')
  })

  it('참가자 확정 버튼을 누르면(2명 이상) confirmTournamentEntries가 호출된다', async () => {
    fetchTournamentParticipantsMock.mockResolvedValue([
      { ...participants[0], entryStatus: 'entered' },
      { ...participants[1], entryStatus: 'entered' },
    ])
    confirmTournamentEntriesMock.mockResolvedValue(undefined)
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<TournamentTab />)
    fireEvent.click(await screen.findByText('테스트 대회'))
    fireEvent.click(await screen.findByText('참가자 확정'))

    await waitFor(() => expect(confirmTournamentEntriesMock).toHaveBeenCalledWith('t1', 2, 'skkubc'))
  })

  it('참가자가 1명뿐이면 확정을 막고 confirmTournamentEntries를 호출하지 않는다', async () => {
    fetchTournamentParticipantsMock.mockResolvedValue([{ ...participants[0], entryStatus: 'entered' }])
    vi.spyOn(window, 'alert').mockImplementation(() => {})

    render(<TournamentTab />)
    fireEvent.click(await screen.findByText('테스트 대회'))
    fireEvent.click(await screen.findByText('참가자 확정'))

    expect(confirmTournamentEntriesMock).not.toHaveBeenCalled()
  })
})

// ══════════════════════════════════════════════════════════════════
// 4B — 추첨 준비 → 번호 입력 → 대진표 미리보기 → 대진 확정 → 확정 취소
// ══════════════════════════════════════════════════════════════════

const entryClosedTournament: Tournament = { ...draftTournament, status: 'entryClosed', participantCount: 2 }
const enteredParticipants: TournamentParticipant[] = [
  { ...participants[0], entryStatus: 'entered' },
  { ...participants[1], entryStatus: 'entered' },
]

describe('관리자 — 추첨 준비', () => {
  beforeEach(() => {
    useAdmin.setState({ isAdmin: true })
    useAdminAuthStore.setState({ status: 'authorizedAdmin', uid: 'admin-1', email: 'a@test', adminDisplayName: '관리자', errorMessage: null })
    fetchTournamentsMock.mockResolvedValue([entryClosedTournament])
    fetchTournamentParticipantsMock.mockResolvedValue(enteredParticipants)
  })

  it('추첨 준비 버튼을 누르면 확정된 참가 인원으로 prepareTournamentDraw가 호출된다', async () => {
    prepareTournamentDrawMock.mockResolvedValue(undefined)
    render(<TournamentTab />)
    fireEvent.click(await screen.findByText('테스트 대회'))
    fireEvent.click(await screen.findByText('추첨 준비'))
    await waitFor(() => expect(prepareTournamentDrawMock).toHaveBeenCalledWith('t1', 2, 'skkubc'))
  })
})

describe('관리자 — 번호 저장 · 미리보기 · 대진 확정', () => {
  const drawReadyTournament: Tournament = { ...entryClosedTournament, status: 'drawReady' }
  const savedParticipants = enteredParticipants.map((p, i) => ({ ...p, drawNumber: i + 1 }))

  beforeEach(() => {
    useAdmin.setState({ isAdmin: true })
    useAdminAuthStore.setState({ status: 'authorizedAdmin', uid: 'admin-1', email: 'a@test', adminDisplayName: '관리자', errorMessage: null })
  })

  it('번호를 입력하고 저장하면 saveTournamentDrawNumbers가 참가자 전체 목록으로 호출된다', async () => {
    fetchTournamentsMock.mockResolvedValue([drawReadyTournament])
    fetchTournamentParticipantsMock.mockResolvedValue(enteredParticipants)
    saveTournamentDrawNumbersMock.mockResolvedValue(undefined)

    render(<TournamentTab />)
    fireEvent.click(await screen.findByText('테스트 대회'))
    const inputs = await screen.findAllByRole('spinbutton')
    fireEvent.change(inputs[0], { target: { value: '2' } })
    fireEvent.change(inputs[1], { target: { value: '1' } })
    fireEvent.click(screen.getByText('번호 저장'))

    await waitFor(() => expect(saveTournamentDrawNumbersMock).toHaveBeenCalledTimes(1))
    const [tid, sentParticipants, entries, clubId] = saveTournamentDrawNumbersMock.mock.calls[0]
    expect(tid).toBe('t1')
    expect(sentParticipants).toEqual(enteredParticipants)
    expect(entries).toHaveLength(2)
    expect(clubId).toBe('skkubc')
  })

  it('모든 번호가 저장된 뒤 "대진표 확인"을 누르면 관리자 전용 매핑을 불러와 미리보기를 계산한다(Firestore 쓰기 없음)', async () => {
    fetchTournamentsMock.mockResolvedValue([drawReadyTournament])
    fetchTournamentParticipantsMock.mockResolvedValue(savedParticipants)
    loadTournamentDrawMappingMock.mockResolvedValue({ bracketSize: 2, numberToSlot: { 1: 1, 2: 2 }, byeSlots: [] })

    render(<TournamentTab />)
    fireEvent.click(await screen.findByText('테스트 대회'))
    fireEvent.click(await screen.findByText('대진표 확인'))

    await waitFor(() => expect(loadTournamentDrawMappingMock).toHaveBeenCalledWith('t1', 'skkubc'))
    expect(await screen.findByText(/아직 확정 전 미리보기/)).toBeInTheDocument()
    // 미리보기 계산은 로컬일 뿐 어떤 Firestore write 함수도 부르지 않는다.
    expect(confirmTournamentBracketMock).not.toHaveBeenCalled()
  })

  it('대진 확정을 누르면 계산된 경기 전체와 bracketSize로 confirmTournamentBracket이 호출된다', async () => {
    fetchTournamentsMock.mockResolvedValue([drawReadyTournament])
    fetchTournamentParticipantsMock.mockResolvedValue(savedParticipants)
    loadTournamentDrawMappingMock.mockResolvedValue({ bracketSize: 2, numberToSlot: { 1: 1, 2: 2 }, byeSlots: [] })
    confirmTournamentBracketMock.mockResolvedValue(undefined)
    fetchTournamentMatchesMock.mockResolvedValue([])
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<TournamentTab />)
    fireEvent.click(await screen.findByText('테스트 대회'))
    fireEvent.click(await screen.findByText('대진표 확인'))
    fireEvent.click(await screen.findByText('대진 확정'))

    await waitFor(() => expect(confirmTournamentBracketMock).toHaveBeenCalledTimes(1))
    const [tid, matches, opts, clubId] = confirmTournamentBracketMock.mock.calls[0]
    expect(tid).toBe('t1')
    expect(matches.length).toBeGreaterThan(0)
    expect(opts.bracketSize).toBe(2)
    expect(clubId).toBe('skkubc')
  })
})

describe('관리자 — 참가자 확정 취소 · 대진 확정 취소', () => {
  beforeEach(() => {
    useAdmin.setState({ isAdmin: true })
    useAdminAuthStore.setState({ status: 'authorizedAdmin', uid: 'admin-1', email: 'a@test', adminDisplayName: '관리자', errorMessage: null })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })

  it('참가자 확정 취소를 누르면 reopenTournamentEntries가 호출된다', async () => {
    fetchTournamentsMock.mockResolvedValueOnce([entryClosedTournament]).mockResolvedValue([draftTournament])
    fetchTournamentParticipantsMock.mockResolvedValue(enteredParticipants)
    reopenTournamentEntriesMock.mockResolvedValue(undefined)

    render(<TournamentTab />)
    fireEvent.click(await screen.findByText('테스트 대회'))
    fireEvent.click(await screen.findByText('참가자 확정 취소'))

    await waitFor(() => expect(reopenTournamentEntriesMock).toHaveBeenCalledWith('t1', 'skkubc'))
  })

  it('대진 확정 취소를 누르면 cancelTournamentBracket이 호출된다', async () => {
    const bracketFixedTournament: Tournament = { ...entryClosedTournament, status: 'bracketFixed', bracketSize: 2 }
    fetchTournamentsMock.mockResolvedValueOnce([bracketFixedTournament]).mockResolvedValue([entryClosedTournament])
    fetchTournamentParticipantsMock.mockResolvedValue(enteredParticipants)
    fetchTournamentMatchesMock.mockResolvedValue([])
    cancelTournamentBracketMock.mockResolvedValue(undefined)

    render(<TournamentTab />)
    fireEvent.click(await screen.findByText('테스트 대회'))
    fireEvent.click(await screen.findByText('대진 확정 취소'))

    await waitFor(() => expect(cancelTournamentBracketMock).toHaveBeenCalledWith('t1', 'skkubc'))
  })
})

describe('관리자 — 대회 삭제', () => {
  beforeEach(() => {
    useAdmin.setState({ isAdmin: true })
    useAdminAuthStore.setState({ status: 'authorizedAdmin', uid: 'admin-1', email: 'a@test', adminDisplayName: '관리자', errorMessage: null })
    fetchTournamentsMock.mockResolvedValue([draftTournament])
    fetchTournamentParticipantsMock.mockResolvedValue(participants)
  })

  it('일반 회원에게는 대회 삭제 버튼이 보이지 않는다', async () => {
    useAdmin.setState({ isAdmin: false })
    useAdminAuthStore.setState({ status: 'unauthenticated', uid: null, email: null, adminDisplayName: null, errorMessage: null })
    render(<TournamentTab />)
    fireEvent.click(await screen.findByText('테스트 대회'))
    await screen.findByText('테스트 대회', { selector: 'h2' })
    expect(screen.queryByText('대회 삭제')).not.toBeInTheDocument()
  })

  it('관리자에게는 대회 삭제 버튼이 보인다', async () => {
    render(<TournamentTab />)
    fireEvent.click(await screen.findByText('테스트 대회'))
    expect(await screen.findByText('대회 삭제')).toBeInTheDocument()
  })

  it('확인창에 대회명이 포함되고, 승인하면 deleteTournament가 호출된다', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    deleteTournamentMock.mockResolvedValue(undefined)
    fetchTournamentsMock.mockResolvedValueOnce([draftTournament]).mockResolvedValue([])

    render(<TournamentTab />)
    fireEvent.click(await screen.findByText('테스트 대회'))
    fireEvent.click(await screen.findByText('대회 삭제'))

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('테스트 대회'))
    await waitFor(() => expect(deleteTournamentMock).toHaveBeenCalledWith('t1', 'skkubc'))
  })

  it('확인창에서 취소하면 deleteTournament가 호출되지 않는다', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<TournamentTab />)
    fireEvent.click(await screen.findByText('테스트 대회'))
    fireEvent.click(await screen.findByText('대회 삭제'))
    expect(deleteTournamentMock).not.toHaveBeenCalled()
  })

  it('삭제 후 대회 목록 화면으로 돌아간다', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    deleteTournamentMock.mockResolvedValue(undefined)
    fetchTournamentsMock.mockResolvedValueOnce([draftTournament]).mockResolvedValue([])

    render(<TournamentTab />)
    fireEvent.click(await screen.findByText('테스트 대회'))
    fireEvent.click(await screen.findByText('대회 삭제'))

    await waitFor(() => expect(screen.queryByText('대회 삭제')).not.toBeInTheDocument())
    expect(screen.getByText('🏆 대회')).toBeInTheDocument()
  })
})

describe('회원 — 공개 대진표', () => {
  const bracketFixedTournament: Tournament = { ...entryClosedTournament, status: 'bracketFixed', bracketSize: 2 }
  const confirmedMatches = [{
    id: 'r1m1', roundNumber: 1, playerCountInRound: 2, matchNumber: 1,
    playerAParticipantId: 'm1', playerBParticipantId: 'm2',
    playerAMemberId: 'm1', playerBMemberId: 'm2',
    playerAHandicapSnapshot: 20, playerBHandicapSnapshot: 18,
    scoreA: null, scoreB: null, resultType: 'normal' as const, status: 'awaitingResult' as const,
    nextMatchId: null, nextSlot: null,
  }]

  beforeEach(() => {
    useAuth.setState({ memberId: 'm1', memberName: '테스트회원A', isGuest: false })
    fetchTournamentsMock.mockResolvedValue([bracketFixedTournament])
    fetchTournamentParticipantsMock.mockResolvedValue(enteredParticipants)
    fetchTournamentMatchesMock.mockResolvedValue(confirmedMatches)
  })

  it('대진이 확정되면 회원에게 공개 대진표가 보인다', async () => {
    render(<TournamentTab />)
    fireEvent.click(await screen.findByText('테스트 대회'))
    await waitFor(() => expect(fetchTournamentMatchesMock).toHaveBeenCalledWith('t1', 'skkubc'))
    expect(await screen.findByText('테스트회원A')).toBeInTheDocument()
    expect(screen.getByText('테스트회원B')).toBeInTheDocument()
  })

  it('회원 화면에는 관리자 전용 대진 관리 버튼이 없다', async () => {
    render(<TournamentTab />)
    fireEvent.click(await screen.findByText('테스트 대회'))
    await screen.findByText('테스트회원A')
    expect(screen.queryByText('대진 확정 취소')).not.toBeInTheDocument()
    expect(screen.queryByText('추첨 준비')).not.toBeInTheDocument()
  })

  it('★ 회원 화면 경로는 관리자 전용 loadTournamentDrawMapping을 절대 호출하지 않는다', async () => {
    render(<TournamentTab />)
    fireEvent.click(await screen.findByText('테스트 대회'))
    await screen.findByText('테스트회원A')
    expect(loadTournamentDrawMappingMock).not.toHaveBeenCalled()
  })
})

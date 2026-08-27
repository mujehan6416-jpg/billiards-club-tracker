import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// Firebase 실제 호출부를 전부 모킹 — 실제 네트워크·운영 데이터에 접근하지 않는다.
const uploadToCloudMock = vi.fn()
const syncSplitChangesMock = vi.fn()
const deleteSplitSessionMock = vi.fn()

vi.mock('../src/lib/cloudSync', () => ({
  uploadToCloud: (...a: unknown[]) => uploadToCloudMock(...a),
  downloadFromCloud: vi.fn(),
  markSynced: vi.fn(),
  UploadCancelledError: class UploadCancelledError extends Error {},
}))
vi.mock('../src/lib/splitFirestore', () => ({
  USE_SPLIT_FIRESTORE: true,
  syncSplitChanges: (...a: unknown[]) => syncSplitChangesMock(...a),
  deleteSplitSession: (...a: unknown[]) => deleteSplitSessionMock(...a),
}))
vi.mock('../src/lib/adminAuth', () => ({
  adminSignIn: vi.fn(), adminSignOut: vi.fn(),
  subscribeAuthState: () => () => {},
  fetchAdminDoc: vi.fn(),
  reauthenticateAdmin: vi.fn(),
  ReauthError: class ReauthError extends Error {},
}))
vi.mock('../src/lib/firebase', () => ({ db: {} }))
vi.mock('firebase/auth', () => ({
  getAuth: () => ({ currentUser: null }),
  signInAnonymously: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(),
  onAuthStateChanged: () => () => {},
  reauthenticateWithCredential: vi.fn(),
  EmailAuthProvider: { credential: vi.fn() },
}))
vi.mock('../src/lib/memberLink', () => ({
  fetchMyLink: vi.fn().mockResolvedValue(null),
  fetchMyRequest: vi.fn().mockResolvedValue(null),
  createLinkRequest: vi.fn(), cancelMyRequest: vi.fn(),
  fetchPendingRequests: vi.fn().mockResolvedValue([]),
  fetchMemberLinks: vi.fn().mockResolvedValue([]),
  approveLinkRequest: vi.fn(), rejectLinkRequest: vi.fn(),
  setLinkActive: vi.fn(), deleteMemberLink: vi.fn(),
}))

import { SettingsTab } from '../src/tabs/SettingsTab'
import { useApp } from '../src/store/appStore'
import { useAdmin } from '../src/store/adminStore'
import { useAuth } from '../src/store/authStore'
import type { Game, Member, Session } from '../src/types'

// 아래 이름·ID·경기 기록은 전부 테스트용 가상 데이터이며 실제 회원 정보가 아니다.
const members: Member[] = [
  { id: 'm1', name: '테스트회원A', handicap: 20, handicapHistory: [], active: true },
  { id: 'm2', name: '테스트회원B', handicap: 25, handicapHistory: [], active: true },
]

function game(id: string): Game {
  return {
    id, playerAId: 'm1', playerBId: 'm2', handicapA: 20, handicapB: 25,
    scoreA: 15, scoreB: 20, endType: 'time', playedAt: '2026-08-27T10:00:00.000Z',
  }
}

/** 승인 대기 중인 번개모임 */
const pendingFlash = (over: Partial<Session> = {}): Session => ({
  id: 's-flash-pending', date: '2026-08-27', type: 'flash', approved: false,
  attendeeIds: ['m1', 'm2'], games: [game('g-1'), game('g-2')], ...over,
})

/** 이미 승인된 번개모임(삭제 버튼이 나오면 안 되는 대상) */
const approvedFlash = (): Session => ({
  id: 's-flash-approved', date: '2026-08-20', type: 'flash', approved: true,
  attendeeIds: ['m1'], games: [game('g-9')],
})

/** 정기모임(이 카드와 무관) */
const regularSession = (): Session => ({
  id: 's-regular', date: '2026-08-19', type: 'regular',
  attendeeIds: ['m1', 'm2'], games: [game('g-r1')],
})

const setSessions = (sessions: Session[]) =>
  useApp.setState({ members, sessions, settings: { lastBackupAt: null }, ledger: [] })

beforeEach(() => {
  setSessions([pendingFlash()])
  useAdmin.setState({ isAdmin: true })
  useAuth.setState({ memberId: 'm1', memberName: '테스트회원A', isGuest: false })
  uploadToCloudMock.mockReset(); uploadToCloudMock.mockResolvedValue(undefined)
  syncSplitChangesMock.mockReset(); syncSplitChangesMock.mockResolvedValue(undefined)
  deleteSplitSessionMock.mockReset(); deleteSplitSessionMock.mockResolvedValue(undefined)
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

const deleteButton = () => screen.getByRole('button', { name: '삭제' })

describe('번개모임 승인 대기 — 삭제 버튼', () => {
  it('승인 대기 모임에 승인과 구분되는 삭제 버튼을 보여준다', () => {
    render(<SettingsTab />)

    expect(screen.getByText(/번개모임 승인 대기/)).toBeInTheDocument()
    expect(deleteButton()).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '승인' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '내용 보기' })).toBeInTheDocument()
  })

  it('삭제 확인창에 날짜·참석 인원·경기 수를 보여준다', () => {
    render(<SettingsTab />)
    fireEvent.click(deleteButton())

    const message = String((window.confirm as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0])
    expect(message).toContain('2026-08-27')
    expect(message).toContain('2명')
    expect(message).toContain('2건')
  })

  it('확인창에서 취소하면 아무것도 삭제하지 않는다', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<SettingsTab />)
    fireEvent.click(deleteButton())

    expect(deleteSplitSessionMock).not.toHaveBeenCalled()
    expect(useApp.getState().sessions).toHaveLength(1)
  })
})

describe('번개모임 삭제 — 삭제 범위', () => {
  it('해당 session과 하위 games를 함께 지우는 안전한 삭제 함수를 쓴다', async () => {
    render(<SettingsTab />)
    fireEvent.click(deleteButton())

    // deleteSplitSession()이 하위 games를 먼저 배치로 지운 뒤 session을 지운다 —
    // session 문서만 지워 경기 기록이 고아로 남는 일이 없다.
    await waitFor(() => expect(deleteSplitSessionMock).toHaveBeenCalledWith('s-flash-pending'))
    expect(deleteSplitSessionMock).toHaveBeenCalledTimes(1)
  })

  it('삭제한 모임만 사라지고 다른 모임·경기는 그대로 남는다', async () => {
    setSessions([pendingFlash(), approvedFlash(), regularSession()])
    render(<SettingsTab />)

    fireEvent.click(deleteButton())

    await waitFor(() => expect(useApp.getState().sessions).toHaveLength(2))
    const left = useApp.getState().sessions
    expect(left.map((s) => s.id).sort()).toEqual(['s-flash-approved', 's-regular'])
    // 남은 모임의 경기 기록도 그대로다
    expect(left.find((s) => s.id === 's-regular')!.games).toHaveLength(1)
    expect(left.find((s) => s.id === 's-flash-approved')!.games).toHaveLength(1)
    // 다른 session에 대한 삭제 요청은 없었다
    expect(deleteSplitSessionMock).toHaveBeenCalledTimes(1)
    expect(deleteSplitSessionMock).not.toHaveBeenCalledWith('s-regular')
    expect(deleteSplitSessionMock).not.toHaveBeenCalledWith('s-flash-approved')
  })

  it('서버 삭제가 실패하면 이 기기 목록에서도 지우지 않고 오류를 보여준다', async () => {
    deleteSplitSessionMock.mockRejectedValue(new Error('permission-denied'))
    render(<SettingsTab />)

    fireEvent.click(deleteButton())

    await waitFor(() => expect(screen.getByText(/삭제하지 못했습니다/)).toBeInTheDocument())
    expect(useApp.getState().sessions).toHaveLength(1)
  })
})

describe('번개모임 삭제 — 이미 승인된 모임 오삭제 방지', () => {
  it('승인 완료된 번개모임은 이 카드에 아예 나타나지 않는다', () => {
    setSessions([approvedFlash()])
    render(<SettingsTab />)

    expect(screen.queryByText(/번개모임 승인 대기/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '삭제' })).not.toBeInTheDocument()
  })

  it('정기모임은 이 카드의 삭제 대상이 아니다', () => {
    setSessions([regularSession()])
    render(<SettingsTab />)

    expect(screen.queryByText(/번개모임 승인 대기/)).not.toBeInTheDocument()
  })

  it('누르는 순간 이미 승인된 상태면 삭제하지 않고 안내한다', async () => {
    render(<SettingsTab />)
    // 화면에는 아직 "승인 대기"로 그려져 있지만, 누르는 순간 읽는 최신 상태는 이미 승인된 상황
    // (다른 기기에서 그 사이 승인한 경우). 이 방어가 없으면 승인 완료된 모임이 지워진다.
    const realGetState = useApp.getState
    const spy = vi.spyOn(useApp, 'getState').mockImplementation(() => ({
      ...realGetState(), sessions: [pendingFlash({ approved: true })],
    }))

    fireEvent.click(deleteButton())

    await waitFor(() => expect(screen.getByText(/이미 승인되었거나 목록에서 사라진 모임입니다/)).toBeInTheDocument())
    expect(deleteSplitSessionMock).not.toHaveBeenCalled()

    spy.mockRestore()
    expect(useApp.getState().sessions).toHaveLength(1)
  })

  it('누르는 순간 이미 사라진 모임이면 삭제하지 않고 안내한다', async () => {
    render(<SettingsTab />)
    const realGetState = useApp.getState
    const spy = vi.spyOn(useApp, 'getState').mockImplementation(() => ({ ...realGetState(), sessions: [] }))

    fireEvent.click(deleteButton())

    await waitFor(() => expect(screen.getByText(/이미 승인되었거나 목록에서 사라진 모임입니다/)).toBeInTheDocument())
    expect(deleteSplitSessionMock).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

/**
 * 관리자 상단 알림 "🔔 기기등록 요청 N건" (앱 안 알림 1단계).
 *
 * 실제 Firebase에는 절대 접근하지 않는다 — 요청 조회·승인·거절을 전부 모킹한다.
 * 아래에 나오는 회원 이름·ID·UID는 모두 테스트용 가상 값이며 실제 운영 데이터가 아니다.
 */

const fetchPendingRequestsMock = vi.fn()
const fetchMemberLinksMock = vi.fn()
const approveLinkRequestMock = vi.fn()
const rejectLinkRequestMock = vi.fn()
const deleteMemberLinkMock = vi.fn()
const fetchMyLinkMock = vi.fn()
const loadSplitAppStateMock = vi.fn()

vi.mock('../src/lib/memberLink', () => ({
  fetchPendingRequests: (...a: unknown[]) => fetchPendingRequestsMock(...a),
  fetchMemberLinks: (...a: unknown[]) => fetchMemberLinksMock(...a),
  approveLinkRequest: (...a: unknown[]) => approveLinkRequestMock(...a),
  rejectLinkRequest: (...a: unknown[]) => rejectLinkRequestMock(...a),
  deleteMemberLink: (...a: unknown[]) => deleteMemberLinkMock(...a),
  setLinkActive: vi.fn(),
  fetchMyLink: (...a: unknown[]) => fetchMyLinkMock(...a),
}))
vi.mock('../src/lib/adminAuth', () => ({
  adminSignIn: vi.fn(), adminSignOut: vi.fn(),
  subscribeAuthState: () => () => {},
  fetchAdminDoc: vi.fn(),
}))
vi.mock('../src/lib/appAuth', () => ({
  ensureAppAuth: vi.fn(async () => {}),
  keepAppAuthAlive: () => () => {},
  currentAuthUid: () => null,
}))
vi.mock('../src/lib/cloudSync', () => ({
  downloadFromCloud: vi.fn(async () => null),
  uploadToCloud: vi.fn(),
  markSynced: vi.fn(),
  UploadCancelledError: class UploadCancelledError extends Error {},
}))
vi.mock('../src/lib/splitFirestore', () => ({
  USE_SPLIT_FIRESTORE: true,
  DEFAULT_CLUB_ID: 'skkubc',
  loadSplitAppState: (...a: unknown[]) => loadSplitAppStateMock(...a),
  syncSplitChanges: vi.fn(),
  deleteSplitSession: vi.fn(),
  deleteSplitGame: vi.fn(),
  writeGame: vi.fn(),
  writeLedgerRecord: vi.fn(),
  deleteSplitLedgerRecord: vi.fn(),
  submitMemberGameResult: vi.fn(),
  resubmitMemberGameResult: vi.fn(),
  updateFlashSessionAttendees: vi.fn(),
  fetchMemberIndex: vi.fn(async () => []),
  writeMemberIndexOnly: vi.fn(),
}))
vi.mock('../src/lib/firebase', () => ({ db: {} }))
vi.mock('firebase/auth', () => ({
  getAuth: () => ({}),
  signInAnonymously: vi.fn(),
  signOut: vi.fn(),
  onAuthStateChanged: () => () => {},
}))

import { App } from '../src/App'
import { DeviceLinkAdminCard } from '../src/components/memberLink/DeviceLinkAdminCard'
import { PendingLinkRequestBanner } from '../src/components/memberLink/PendingLinkRequestBanner'
import {
  usePendingLinkRequestStore, PENDING_POLL_INTERVAL_MS,
} from '../src/components/memberLink/usePendingLinkRequestCount'
import { useAdminAuthStore } from '../src/store/adminAuthStore'
import { useAdmin } from '../src/store/adminStore'
import { useApp } from '../src/store/appStore'
import { useAuth } from '../src/store/authStore'
import type { AppState, Member } from '../src/types'

// 전부 테스트용 가상 회원이다.
const members: Member[] = [
  { id: 'm1', name: '테스트회원A', handicap: 20, handicapHistory: [], active: true },
  { id: 'm2', name: '테스트회원B', handicap: 25, handicapHistory: [], active: true },
  { id: 'm3', name: '테스트회원C', handicap: 30, handicapHistory: [], active: true },
]
const splitState: AppState = { members, sessions: [], settings: { lastBackupAt: null }, ledger: [] }

const pendingRequest = (uid: string, memberId: string) => ({
  firebaseUid: uid,
  request: { memberId, requestedAt: '2026-09-01T01:00:00.000Z' },
})

const asAuthorizedAdmin = () =>
  useAdminAuthStore.setState({
    status: 'authorizedAdmin', uid: 'admin-uid', email: 'a@example.test',
    adminDisplayName: '가상관리자', errorMessage: null,
  })

const BANNER_ONE = /🔔 기기등록 요청 1건/

beforeEach(() => {
  useApp.setState({ members, sessions: [], settings: { lastBackupAt: null }, ledger: [] })
  useAuth.setState({ memberId: null, memberName: null, isGuest: false })
  useAdmin.setState({ isAdmin: false })
  useAdminAuthStore.setState({ status: 'unauthenticated', uid: null, email: null, adminDisplayName: null, errorMessage: null })
  usePendingLinkRequestStore.setState({ count: 0, blocked: false })

  fetchPendingRequestsMock.mockReset(); fetchPendingRequestsMock.mockResolvedValue([])
  fetchMemberLinksMock.mockReset(); fetchMemberLinksMock.mockResolvedValue([])
  approveLinkRequestMock.mockReset(); approveLinkRequestMock.mockResolvedValue(undefined)
  rejectLinkRequestMock.mockReset(); rejectLinkRequestMock.mockResolvedValue(undefined)
  deleteMemberLinkMock.mockReset(); deleteMemberLinkMock.mockResolvedValue(undefined)
  fetchMyLinkMock.mockReset(); fetchMyLinkMock.mockResolvedValue(null)
  loadSplitAppStateMock.mockReset(); loadSplitAppStateMock.mockResolvedValue(splitState)

  vi.spyOn(window, 'confirm').mockReturnValue(true)
  // jsdom에는 scrollIntoView가 없어서 직접 넣어 준다.
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('상단 알림 — 대기 건수 표시', () => {
  it('A. 대기 요청이 0건이면 알림을 아예 보여주지 않는다', async () => {
    asAuthorizedAdmin()
    render(<PendingLinkRequestBanner onOpen={() => {}} />)

    await waitFor(() => expect(fetchPendingRequestsMock).toHaveBeenCalled())
    expect(screen.queryByText(/기기등록 요청/)).not.toBeInTheDocument()
  })

  it('B. 대기 요청이 1건이면 "🔔 기기등록 요청 1건"을 보여준다', async () => {
    asAuthorizedAdmin()
    fetchPendingRequestsMock.mockResolvedValue([pendingRequest('uid-a', 'm1')])
    render(<PendingLinkRequestBanner onOpen={() => {}} />)

    await waitFor(() => expect(screen.getByText(BANNER_ONE)).toBeInTheDocument())
  })

  it('C. 여러 건이면 그 건수를 정확히 보여준다', async () => {
    asAuthorizedAdmin()
    fetchPendingRequestsMock.mockResolvedValue([
      pendingRequest('uid-a', 'm1'), pendingRequest('uid-b', 'm2'), pendingRequest('uid-c', 'm3'),
    ])
    render(<PendingLinkRequestBanner onOpen={() => {}} />)

    await waitFor(() => expect(screen.getByText(/🔔 기기등록 요청 3건/)).toBeInTheDocument())
  })

  it('회원 이름·기기 코드 같은 개인정보는 알림 문구에 넣지 않는다', async () => {
    asAuthorizedAdmin()
    fetchPendingRequestsMock.mockResolvedValue([pendingRequest('uid-secret-1234', 'm1')])
    render(<PendingLinkRequestBanner onOpen={() => {}} />)

    await waitFor(() => expect(screen.getByText(BANNER_ONE)).toBeInTheDocument())
    expect(document.body.textContent).not.toContain('테스트회원A')
    expect(document.body.textContent).not.toContain('uid-secret')
  })
})

describe('상단 알림 — 관리자 인증이 없는 경우', () => {
  it('D. 일반 회원 화면에서는 알림을 보여주지 않고 요청 조회도 하지 않는다', async () => {
    useAuth.setState({ memberId: 'm1', memberName: '테스트회원A', isGuest: false })
    fetchPendingRequestsMock.mockResolvedValue([pendingRequest('uid-a', 'm1')])
    render(<PendingLinkRequestBanner onOpen={() => {}} />)

    await act(async () => {})
    expect(screen.queryByText(/기기등록 요청/)).not.toBeInTheDocument()
    expect(fetchPendingRequestsMock).not.toHaveBeenCalled()
  })

  it('E-1. 관리자 번호(PIN)만 켜져 있고 Firebase 관리자 인증이 없으면 건수를 노출하지 않는다', async () => {
    useAdmin.setState({ isAdmin: true }) // PIN 관리자 모드
    useAdminAuthStore.setState({ status: 'authenticated', uid: 'someone', email: 'x@example.test', adminDisplayName: null, errorMessage: null })
    fetchPendingRequestsMock.mockResolvedValue([pendingRequest('uid-a', 'm1')])
    render(<PendingLinkRequestBanner onOpen={() => {}} />)

    await act(async () => {})
    expect(screen.queryByText(/기기등록 요청/)).not.toBeInTheDocument()
    expect(fetchPendingRequestsMock).not.toHaveBeenCalled()
  })

  it('E-2. 서버가 권한을 거부하면 숫자를 숨기고 같은 조회를 되풀이하지 않는다', async () => {
    asAuthorizedAdmin()
    const denied = Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' })
    fetchPendingRequestsMock.mockRejectedValue(denied)
    render(<PendingLinkRequestBanner onOpen={() => {}} />)

    await waitFor(() => expect(fetchPendingRequestsMock).toHaveBeenCalledTimes(1))
    expect(screen.queryByText(/기기등록 요청/)).not.toBeInTheDocument()

    // 이후 다시 조회를 시도해도 서버로 나가지 않는다(무한 재시도 방지).
    await act(async () => { await usePendingLinkRequestStore.getState().refresh() })
    await act(async () => { await usePendingLinkRequestStore.getState().refresh() })
    expect(fetchPendingRequestsMock).toHaveBeenCalledTimes(1)
  })

  it('관리자 인증이 풀리면 남아 있던 숫자도 사라진다', async () => {
    asAuthorizedAdmin()
    fetchPendingRequestsMock.mockResolvedValue([pendingRequest('uid-a', 'm1')])
    render(<PendingLinkRequestBanner onOpen={() => {}} />)
    await waitFor(() => expect(screen.getByText(BANNER_ONE)).toBeInTheDocument())

    act(() => {
      useAdminAuthStore.setState({ status: 'unauthenticated', uid: null, email: null, adminDisplayName: null, errorMessage: null })
    })

    expect(screen.queryByText(/기기등록 요청/)).not.toBeInTheDocument()
  })
})

describe('상단 알림 — 승인·거절 후 즉시 갱신', () => {
  it('G. 1건을 승인하면 상단 알림이 바로 사라진다', async () => {
    asAuthorizedAdmin()
    fetchPendingRequestsMock.mockResolvedValue([pendingRequest('uid-a', 'm1')])
    render(<><PendingLinkRequestBanner onOpen={() => {}} /><DeviceLinkAdminCard /></>)

    await waitFor(() => expect(screen.getByText(BANNER_ONE)).toBeInTheDocument())

    // 승인 후 서버에는 대기 요청이 남지 않는다(요청 문서가 삭제되므로).
    fetchPendingRequestsMock.mockResolvedValue([])
    fireEvent.click(screen.getByRole('button', { name: '승인' }))

    await waitFor(() => expect(approveLinkRequestMock).toHaveBeenCalledWith('uid-a', 'm1', 'admin-uid'))
    await waitFor(() => expect(screen.queryByText(/기기등록 요청/)).not.toBeInTheDocument())
  })

  it('H. 2건 중 1건을 거절하면 상단 알림이 바로 1건으로 줄어든다', async () => {
    asAuthorizedAdmin()
    fetchPendingRequestsMock.mockResolvedValue([pendingRequest('uid-a', 'm1'), pendingRequest('uid-b', 'm2')])
    render(<><PendingLinkRequestBanner onOpen={() => {}} /><DeviceLinkAdminCard /></>)

    await waitFor(() => expect(screen.getByText(/🔔 기기등록 요청 2건/)).toBeInTheDocument())

    fetchPendingRequestsMock.mockResolvedValue([pendingRequest('uid-b', 'm2')])
    fireEvent.click(screen.getAllByRole('button', { name: '거절' })[0])

    await waitFor(() => expect(rejectLinkRequestMock).toHaveBeenCalledWith('uid-a'))
    await waitFor(() => expect(screen.getByText(BANNER_ONE)).toBeInTheDocument())
  })

  it('승인 카드를 열면(설정 탭 진입) 그 조회 결과가 상단 숫자에도 바로 반영된다', async () => {
    asAuthorizedAdmin()
    fetchPendingRequestsMock.mockResolvedValue([pendingRequest('uid-a', 'm1'), pendingRequest('uid-b', 'm2')])
    render(<DeviceLinkAdminCard />)

    await waitFor(() => expect(usePendingLinkRequestStore.getState().count).toBe(2))
  })
})

describe('상단 알림 — 주기 조회(폴링)', () => {
  it('I-1. 관리자 인증 상태에서는 주기적으로 대기 건수를 다시 확인한다', async () => {
    vi.useFakeTimers()
    asAuthorizedAdmin()
    fetchPendingRequestsMock.mockResolvedValue([])
    render(<PendingLinkRequestBanner onOpen={() => {}} />)

    await act(async () => {})
    expect(fetchPendingRequestsMock).toHaveBeenCalledTimes(1)

    await act(async () => { vi.advanceTimersByTime(PENDING_POLL_INTERVAL_MS) })
    expect(fetchPendingRequestsMock).toHaveBeenCalledTimes(2)

    await act(async () => { vi.advanceTimersByTime(PENDING_POLL_INTERVAL_MS) })
    expect(fetchPendingRequestsMock).toHaveBeenCalledTimes(3)
  })

  it('I-2. 화면이 사라지면 주기 조회도 멈춘다(타이머 정리)', async () => {
    vi.useFakeTimers()
    asAuthorizedAdmin()
    const { unmount } = render(<PendingLinkRequestBanner onOpen={() => {}} />)
    await act(async () => {})
    expect(fetchPendingRequestsMock).toHaveBeenCalledTimes(1)

    unmount()

    await act(async () => { vi.advanceTimersByTime(PENDING_POLL_INTERVAL_MS * 3) })
    expect(fetchPendingRequestsMock).toHaveBeenCalledTimes(1)
  })

  it('I-3. 일반 회원 화면에서는 주기 조회 자체가 걸리지 않는다', async () => {
    vi.useFakeTimers()
    useAuth.setState({ memberId: 'm1', memberName: '테스트회원A', isGuest: false })
    render(<PendingLinkRequestBanner onOpen={() => {}} />)

    await act(async () => { vi.advanceTimersByTime(PENDING_POLL_INTERVAL_MS * 3) })
    expect(fetchPendingRequestsMock).not.toHaveBeenCalled()
  })
})

describe('상단 알림 — 클릭 시 승인 화면으로 이동 (App 전체)', () => {
  const renderAppAsAdmin = () => {
    useAuth.setState({ memberId: '__admin__', memberName: '관리자', isGuest: false })
    useAdmin.setState({ isAdmin: true })
    asAuthorizedAdmin()
    return render(<App />)
  }

  it('F. 알림을 누르면 설정 탭으로 이동하고 기기 연결 승인 카드로 스크롤한다', async () => {
    fetchPendingRequestsMock.mockResolvedValue([pendingRequest('uid-a', 'm1')])
    renderAppAsAdmin()

    await waitFor(() => expect(screen.getByText(BANNER_ONE)).toBeInTheDocument())

    fireEvent.click(screen.getByText(BANNER_ONE))

    // 설정 탭으로 이동했고, 기존 승인 카드가 화면에 있다(새 승인 화면을 만들지 않았다).
    await waitFor(() => expect(screen.getByRole('heading', { name: '설정' })).toBeInTheDocument())
    await waitFor(() => expect(screen.getByText(/기기 연결 승인/)).toBeInTheDocument())
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled())
  })

  it('일반 회원으로 앱을 쓰면 상단에 관리자 알림이 나타나지 않는다', async () => {
    fetchPendingRequestsMock.mockResolvedValue([pendingRequest('uid-a', 'm1')])
    useAuth.setState({ memberId: 'm1', memberName: '테스트회원A', isGuest: false })
    render(<App />)

    await waitFor(() => expect(screen.getByText('👤 테스트회원A 님')).toBeInTheDocument())
    expect(screen.queryByText(/기기등록 요청/)).not.toBeInTheDocument()
    expect(fetchPendingRequestsMock).not.toHaveBeenCalled()
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

// 실제 Firebase에는 절대 접근하지 않는다 — 인증·동기화 모두 모킹한다.
// 이 파일은 USE_SPLIT_FIRESTORE=true일 때의 App 부팅 흐름만 확인한다(appBootOrder.test.tsx는
// 실제 앱과 같은 false 상태를 확인한다) — 그래서 splitFirestore.ts 전체를 모킹해 그 상수만
// true로 바꿔치기한다.
const ensureAppAuthMock = vi.fn()
const keepAppAuthAliveMock = vi.fn()
const currentAuthUidMock = vi.fn()
const downloadFromCloudMock = vi.fn()
const loadSplitAppStateMock = vi.fn()
const fetchMyLinkMock = vi.fn()

vi.mock('../src/lib/appAuth', () => ({
  ensureAppAuth: (...args: unknown[]) => ensureAppAuthMock(...args),
  keepAppAuthAlive: (...args: unknown[]) => keepAppAuthAliveMock(...args),
  currentAuthUid: (...args: unknown[]) => currentAuthUidMock(...args),
}))
vi.mock('../src/lib/cloudSync', () => ({
  downloadFromCloud: (...args: unknown[]) => downloadFromCloudMock(...args),
  uploadToCloud: vi.fn(),
  markSynced: vi.fn(),
  UploadCancelledError: class UploadCancelledError extends Error {},
}))
vi.mock('../src/lib/splitFirestore', () => ({
  USE_SPLIT_FIRESTORE: true,
  loadSplitAppState: (...args: unknown[]) => loadSplitAppStateMock(...args),
}))
vi.mock('../src/lib/memberLink', () => ({
  fetchMyLink: (...args: unknown[]) => fetchMyLinkMock(...args),
}))
vi.mock('../src/lib/firebase', () => ({ db: {} }))
vi.mock('firebase/auth', () => ({
  getAuth: () => ({}),
  signInAnonymously: vi.fn(),
  signOut: vi.fn(),
  onAuthStateChanged: () => () => {},
}))
// Firebase 관리자 인증(admins/{uid}.active) 확인부 — PIN 관리자 게이트 테스트에서는 실제
// Firebase 호출 없이 useAdminAuthStore.setState()로 상태를 직접 흉내 낸다(deviceLinkAdminCard.test.tsx와 동일한 방식).
vi.mock('../src/lib/adminAuth', () => ({
  adminSignIn: vi.fn(),
  adminSignOut: vi.fn(),
  subscribeAuthState: () => () => {},
  fetchAdminDoc: vi.fn(),
}))

import { App } from '../src/App'
import { useApp } from '../src/store/appStore'
import { useAuth } from '../src/store/authStore'
import { useAdmin } from '../src/store/adminStore'
import { useAdminAuthStore } from '../src/store/adminAuthStore'
import type { AppState, Member } from '../src/types'

// 아래 이름·ID는 전부 테스트용 가상 데이터이며 실제 회원 정보가 아니다.
const splitMember: Member = { id: 'm1', name: '테스트회원A', handicap: 20, handicapHistory: [], active: true }
const emptySplitState: AppState = { members: [splitMember], sessions: [], settings: { lastBackupAt: null }, ledger: [] }

beforeEach(() => {
  useApp.setState({ members: [splitMember], sessions: [], settings: { lastBackupAt: null }, ledger: [] })
  useAuth.setState({ memberId: null, memberName: null, isGuest: false })
  ensureAppAuthMock.mockReset()
  ensureAppAuthMock.mockResolvedValue(undefined)
  keepAppAuthAliveMock.mockReset()
  keepAppAuthAliveMock.mockReturnValue(() => {})
  currentAuthUidMock.mockReset()
  currentAuthUidMock.mockReturnValue(null) // 기본은 "이 기기의 실제 연결 여부를 알 수 없음" — 자동 로그인 시도를 건너뛴다
  downloadFromCloudMock.mockReset()
  downloadFromCloudMock.mockResolvedValue(null)
  loadSplitAppStateMock.mockReset()
  fetchMyLinkMock.mockReset()
  fetchMyLinkMock.mockResolvedValue(null)
  useAdmin.setState({ isAdmin: false })
  useAdminAuthStore.setState({ status: 'unauthenticated', uid: null, email: null, adminDisplayName: null, errorMessage: null })
})

describe('App 부팅 순서 — USE_SPLIT_FIRESTORE=true', () => {
  it('split 읽기가 성공하면 그 내용으로 로그인 화면이 뜬다(legacy 다운로드로 대체하지 않음)', async () => {
    loadSplitAppStateMock.mockResolvedValue(emptySplitState)
    render(<App />)
    await waitFor(() => expect(screen.getByText('시작하기')).toBeInTheDocument())
    expect(loadSplitAppStateMock).toHaveBeenCalled()
    expect(downloadFromCloudMock).not.toHaveBeenCalled()
  })

  it('이 기기가 memberLinks로 이미 연결돼 있으면 이름 선택 없이 곧바로 그 회원으로 시작한다', async () => {
    loadSplitAppStateMock.mockResolvedValue(emptySplitState)
    currentAuthUidMock.mockReturnValue('uid-device-1')
    fetchMyLinkMock.mockResolvedValue({ memberId: 'm1', role: 'member', active: true, linkedAt: '2026-08-01T00:00:00.000Z' })
    render(<App />)
    await waitFor(() => expect(screen.getByText('👤 테스트회원A 님')).toBeInTheDocument())
    expect(screen.queryByText('시작하기')).not.toBeInTheDocument()
  })

  it('memberLinks가 비활성 상태면 자동 로그인하지 않고 이름 선택 화면을 보여준다', async () => {
    loadSplitAppStateMock.mockResolvedValue(emptySplitState)
    currentAuthUidMock.mockReturnValue('uid-device-1')
    fetchMyLinkMock.mockResolvedValue({ memberId: 'm1', role: 'member', active: false, linkedAt: '2026-08-01T00:00:00.000Z' })
    render(<App />)
    await waitFor(() => expect(screen.getByText('시작하기')).toBeInTheDocument())
  })

  it('split 읽기가 네트워크 등으로 실패하면 오류 화면을 보여주고 legacy로 조용히 넘어가지 않는다', async () => {
    loadSplitAppStateMock.mockRejectedValue(new Error('offline'))
    render(<App />)
    await waitFor(() => expect(screen.getByText(/최신 내용을 서버에서 불러오지 못했습니다/)).toBeInTheDocument())
    // 이름 선택 화면(=앱 진입)으로 넘어가지 않았다 — write가 일어날 수 있는 화면 자체를 막는다
    expect(screen.queryByText('시작하기')).not.toBeInTheDocument()
    // 기술 용어를 사용자에게 노출하지 않는다
    expect(screen.queryByText(/permission-denied|Firestore|offline/i)).not.toBeInTheDocument()
  })

  it('split 읽기가 권한 거부(permission-denied)로 실패하면 "기기 연결" 안내 화면을 보여준다(오류 화면이 아니다)', async () => {
    const denied = Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' })
    loadSplitAppStateMock.mockRejectedValue(denied)
    render(<App />)
    await waitFor(() => expect(screen.getByText('처음 사용하는 기기입니다', { exact: false })).toBeInTheDocument())
    expect(screen.queryByText(/최신 내용을 서버에서 불러오지 못했습니다/)).not.toBeInTheDocument()
  })

  it('오류 화면의 "다시 시도"를 누르면 split 읽기를 다시 시도한다', async () => {
    loadSplitAppStateMock.mockRejectedValueOnce(new Error('offline'))
    render(<App />)
    await waitFor(() => expect(screen.getByText(/최신 내용을 서버에서 불러오지 못했습니다/)).toBeInTheDocument())

    loadSplitAppStateMock.mockResolvedValue(emptySplitState)
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))

    await waitFor(() => expect(screen.getByText('시작하기')).toBeInTheDocument())
    expect(loadSplitAppStateMock).toHaveBeenCalledTimes(2)
  })

  it('이 기기에 서버(split)보다 많은 기록이 있으면 확인 없이 덮어쓰지 않는다', async () => {
    useApp.setState({
      members: [splitMember],
      sessions: [{ id: 's1', date: '2026-08-01', attendeeIds: [], games: [{ id: 'g1', playerAId: 'a', playerBId: 'b', handicapA: 1, handicapB: 1, scoreA: 0, scoreB: 0, endType: 'time', playedAt: 'x' }] }],
      settings: { lastBackupAt: null },
      ledger: [],
    })
    loadSplitAppStateMock.mockResolvedValue(emptySplitState) // split에는 그 경기가 없음(서버가 뒤처짐)
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false) // 사용자가 "취소"
    render(<App />)
    await waitFor(() => expect(confirmSpy).toHaveBeenCalled())
    // 확인을 취소했으므로 로컬의 경기 기록이 그대로 남아 있어야 한다
    expect(useApp.getState().sessions[0].games).toHaveLength(1)
    confirmSpy.mockRestore()
  })
})

describe('App 부팅 순서 — PIN 관리자와 Firebase 관리자 인증 분리', () => {
  const enterAdminPin = () => {
    fireEvent.click(screen.getByTitle('관리자 로그인'))
    fireEvent.change(screen.getByPlaceholderText('PIN 입력'), { target: { value: '1234' } })
    fireEvent.click(screen.getByRole('button', { name: '로그인' }))
  }

  it('PIN만 통과하고 Firebase 관리자 인증이 안 된 상태면 관리자 화면 대신 Firebase 로그인 안내를 보여준다', async () => {
    const denied = Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' })
    loadSplitAppStateMock.mockRejectedValue(denied)
    render(<App />)
    await waitFor(() => expect(screen.getByText('처음 사용하는 기기입니다', { exact: false })).toBeInTheDocument())

    enterAdminPin()

    await waitFor(() => expect(screen.getByText(/관리자 계정으로 한 번 더 로그인해 주세요/)).toBeInTheDocument())
    // PIN만으로는 관리자 화면(TopBar의 관리자 모드 표시)까지 들어가지 못한다
    expect(screen.queryByText(/🔑 관리자 모드/)).not.toBeInTheDocument()
  })

  it('Firebase 관리자 인증까지 완료되면(authorizedAdmin) split 읽기를 다시 시도해 관리자 화면으로 들어간다', async () => {
    const denied = Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' })
    // ① 최초 진입(연결 안 됨) ② PIN 통과 직후(아직 Firebase 관리자 인증 전 — memberId 변화로
    // 부팅이 재시도되지만 여전히 익명 인증이라 거부돼야 실제 Rules와 같은 상황이다) 두 번
    // 모두 거부되고, ③ Firebase 관리자 인증 완료 후 재시도에서만 성공한다.
    loadSplitAppStateMock.mockRejectedValueOnce(denied)
    loadSplitAppStateMock.mockRejectedValueOnce(denied)
    loadSplitAppStateMock.mockResolvedValue(emptySplitState)
    render(<App />)
    await waitFor(() => expect(screen.getByText('처음 사용하는 기기입니다', { exact: false })).toBeInTheDocument())

    enterAdminPin()
    await waitFor(() => expect(screen.getByText(/관리자 계정으로 한 번 더 로그인해 주세요/)).toBeInTheDocument())
    expect(loadSplitAppStateMock).toHaveBeenCalledTimes(2)

    act(() => {
      useAdminAuthStore.setState({
        status: 'authorizedAdmin', uid: 'admin-uid', email: 'a@example.test',
        adminDisplayName: '가상관리자', errorMessage: null,
      })
    })

    await waitFor(() => expect(screen.getByText(/🔑 관리자 모드/)).toBeInTheDocument())
    expect(loadSplitAppStateMock).toHaveBeenCalledTimes(3)
  })

  it('일반 회원 로그인 흐름은 이 게이트의 영향을 받지 않는다', async () => {
    loadSplitAppStateMock.mockResolvedValue(emptySplitState)
    render(<App />)
    await waitFor(() => expect(screen.getByText('시작하기')).toBeInTheDocument())
    expect(screen.queryByText(/관리자 계정으로 한 번 더 로그인해 주세요/)).not.toBeInTheDocument()
  })
})

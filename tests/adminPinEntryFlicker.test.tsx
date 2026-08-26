import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

/**
 * 실제 신고된 버그의 정확한 사용자 경로를 그대로 재현한다:
 *   앱 부팅(이미 연결된 회원으로 자동 로그인) → 설정 탭 이동 → "🔑 관리자 로그인" 클릭
 *   → PIN 입력 → Firebase 관리자 로그인 게이트 표시 → 이메일 로그인 → authorizedAdmin
 *   → 관리자 화면 진입까지.
 *
 * 이전 조사(onAuthStateChanged 다중 구독)를 고쳤는데도 증상이 남아 있어, 이번에는 추측 대신
 * Firebase Auth 자체를 낮은 수준에서 흉내 내(실제 onAuthStateChanged처럼 "구독하는 순간 현재
 * 상태를 즉시 한 번 더 알려주는" 동작까지 포함) adminAuthStore.ts·appAuth.ts·adminAuth.ts의
 * 실제 코드가 서로 어떻게 상호작용하는지 그대로 실행해서 확인한다(이 세 파일은 모킹하지 않는다).
 */

const authState = vi.hoisted(() => ({
  currentUser: null as null | { uid: string; isAnonymous: boolean; email: string | null },
  listeners: [] as Array<(u: unknown) => void>,
  anonCounter: 0,
}))
const authCalls = vi.hoisted(() => ({
  signInAnonymously: 0,
  signInWithEmailAndPassword: 0,
  onAuthStateChangedSubscriptions: 0,
}))
const ADMIN_UID = 'admin-uid-1'
const ADMIN_EMAIL = 'admin@example.test'
const ADMIN_PASSWORD = 'correct-password'
const adminDocs = vi.hoisted(() => ({} as Record<string, { active: boolean; displayName?: string } | undefined>))
// 실제 네트워크 지연을 흉내 내는 스위치 — 기본은 0(즉시 응답)이고, 타이밍 경쟁을 확인하는
// 테스트에서만 값을 올린다. 즉시 응답 모킹은 실제로는 겹칠 수 있는 비동기 작업들이 항상 한
// 틱씩 깔끔하게 끝나 버려, 실제 기기의 네트워크 지연에서만 드러나는 경쟁 상태를 가릴 수 있다.
const networkDelay = vi.hoisted(() => ({ ms: 0 }))

vi.mock('firebase/auth', () => ({
  // getAuth()는 appAuth.ts·adminAuth.ts 양쪽에서 각자 한 번씩 불려 const auth = getAuth()로
  // 저장해 둔다 — currentAuthUid()가 그 저장해 둔 참조의 .currentUser를 직접 읽으므로, 매번
  // 새 객체를 돌려주면 안 되고 authState(호이스팅된, .currentUser를 실제로 들고 있는 객체) 그
  // 자체를 공유해야 실제 Firebase처럼 두 곳 모두 같은 최신 값을 본다.
  getAuth: () => authState,
  onAuthStateChanged: (_auth: unknown, cb: (u: unknown) => void) => {
    authCalls.onAuthStateChangedSubscriptions += 1
    authState.listeners.push(cb)
    // 실제 Firebase 동작: 새로 구독하면 "현재 상태"를 즉시 한 번 더 불러준다.
    cb(authState.currentUser)
    return () => {
      const idx = authState.listeners.indexOf(cb)
      if (idx >= 0) authState.listeners.splice(idx, 1)
    }
  },
  signInAnonymously: async () => {
    authCalls.signInAnonymously += 1
    // 실제 Firebase는 이미 익명으로 로그인된 상태에서 signInAnonymously()를 또 불러도 새 사용자를
    // 만들지 않고 기존 사용자를 그대로 돌려준다(멱등) — 상태 변화도, onAuthStateChanged 재발화도
    // 없다. 이 부분을 실제와 다르게 "항상 새로 만든다"로 흉내 내면, 존재하지 않는 오탐(가짜 버그)이
    // 생길 수 있어 정확히 맞춘다.
    if (authState.currentUser?.isAnonymous) return { user: authState.currentUser }
    authState.anonCounter += 1
    authState.currentUser = { uid: `anon-uid-${authState.anonCounter}`, isAnonymous: true, email: null }
    authState.listeners.forEach((cb) => cb(authState.currentUser))
    return { user: authState.currentUser }
  },
  signInWithEmailAndPassword: async (_auth: unknown, email: string, password: string) => {
    authCalls.signInWithEmailAndPassword += 1
    if (networkDelay.ms > 0) await new Promise((r) => setTimeout(r, networkDelay.ms))
    if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
      authState.currentUser = { uid: ADMIN_UID, isAnonymous: false, email }
      authState.listeners.forEach((cb) => cb(authState.currentUser))
      return { user: authState.currentUser }
    }
    throw Object.assign(new Error('invalid credential'), { code: 'auth/invalid-credential' })
  },
  signOut: async () => {
    authState.currentUser = null
    authState.listeners.forEach((cb) => cb(null))
  },
}))

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ __path: segments.join('/') }),
  getDoc: async (ref: { __path: string }) => {
    if (networkDelay.ms > 0) await new Promise((r) => setTimeout(r, networkDelay.ms))
    const uid = ref.__path.split('/')[1]
    const data = adminDocs[uid]
    return { exists: () => !!data, data: () => data }
  },
}))

vi.mock('../src/lib/firebase', () => ({ db: {} }))

// members/sessions/ledger 등 split 데이터 읽기·쓰기는 이 재현의 관심사가 아니므로 통째로 모킹한다
// (Rules 권한 자체는 이전 단계에서 이미 검증됨) — 오직 admin 인증 상태 전이만 집중 검증한다.
const loadSplitAppStateMock = vi.fn()
vi.mock('../src/lib/splitFirestore', () => ({
  USE_SPLIT_FIRESTORE: true,
  loadSplitAppState: (...a: unknown[]) => loadSplitAppStateMock(...a),
  syncSplitChanges: vi.fn(),
  writeConfig: vi.fn(), writeMember: vi.fn(), writeSession: vi.fn(), writeGame: vi.fn(),
  deleteSplitSession: vi.fn(), deleteSplitGame: vi.fn(), writeLedgerRecord: vi.fn(), deleteSplitLedgerRecord: vi.fn(),
  submitMemberGameResult: vi.fn(), updateFlashSessionAttendees: vi.fn(), resubmitMemberGameResult: vi.fn(),
  toSessionDoc: vi.fn(), toPublicMember: vi.fn(), fetchMemberIndex: vi.fn().mockResolvedValue([]),
}))

const fetchMyLinkMock = vi.fn()
vi.mock('../src/lib/memberLink', () => ({
  fetchMyLink: (...a: unknown[]) => fetchMyLinkMock(...a),
  fetchMyRequest: vi.fn().mockResolvedValue(null),
  createLinkRequest: vi.fn(),
  cancelMyRequest: vi.fn(),
  fetchPendingRequests: vi.fn().mockResolvedValue([]),
  fetchMemberLinks: vi.fn().mockResolvedValue([]),
  approveLinkRequest: vi.fn(),
  rejectLinkRequest: vi.fn(),
  setLinkActive: vi.fn(),
}))

vi.mock('../src/lib/migration', () => ({
  MIGRATION_CONFIRM_PHRASE: 'CONFIRM',
  prepareMigration: vi.fn(),
  runAdminMigration: vi.fn(),
  verifyMigration: vi.fn(),
}))

vi.mock('../src/lib/backup', () => ({
  exportCsv: vi.fn(), exportHandicapCsv: vi.fn(), exportJson: vi.fn(), exportMemberCsv: vi.fn(),
  importHandicapCsv: vi.fn(), importJson: vi.fn(), importMemberCsv: vi.fn(), importGameCsv: vi.fn(),
}))

vi.mock('../src/lib/cloudSync', () => ({
  uploadToCloud: vi.fn(), downloadFromCloud: vi.fn().mockResolvedValue(null), markSynced: vi.fn(),
  UploadCancelledError: class UploadCancelledError extends Error {},
}))

vi.mock('../src/lib/autoSave', () => ({ saveToServer: vi.fn().mockResolvedValue(null) }))

import { App } from '../src/App'
import { useApp } from '../src/store/appStore'
import { useAuth } from '../src/store/authStore'
import { useAdmin } from '../src/store/adminStore'
import { useAdminAuthStore } from '../src/store/adminAuthStore'
import type { AppState, Member } from '../src/types'

const memberSelf: Member = { id: 'm1', name: '관리자겸회원', handicap: 20, handicapHistory: [], active: true }
const splitState: AppState = { members: [memberSelf], sessions: [], settings: { lastBackupAt: null }, ledger: [] }

beforeEach(() => {
  authState.currentUser = null
  authState.listeners = []
  authState.anonCounter = 0
  authCalls.signInAnonymously = 0
  authCalls.signInWithEmailAndPassword = 0
  authCalls.onAuthStateChangedSubscriptions = 0
  networkDelay.ms = 0
  delete adminDocs[ADMIN_UID]

  useApp.setState({ members: [memberSelf], sessions: [], settings: { lastBackupAt: null }, ledger: [] })
  useAuth.setState({ memberId: null, memberName: null, isGuest: false })
  useAdmin.setState({ isAdmin: false })
  useAdminAuthStore.setState({ status: 'loading', uid: null, email: null, adminDisplayName: null, errorMessage: null })

  loadSplitAppStateMock.mockReset()
  loadSplitAppStateMock.mockResolvedValue(splitState)
  fetchMyLinkMock.mockReset()
  fetchMyLinkMock.mockResolvedValue({ memberId: 'm1', role: 'member', active: true, linkedAt: '2026-08-01T00:00:00.000Z' })
})

describe('실제 재현 — 설정 탭에서 관리자 PIN 입력 직후 상태 전이', () => {
  it('앱 부팅 → 설정 탭 → PIN → Firebase 게이트 → 이메일 로그인 → 관리자 화면까지 안정적으로 끝난다(깜빡임 없음)', async () => {
    adminDocs[ADMIN_UID] = { active: true, displayName: '가상관리자' }

    render(<App />)

    // ① 앱 부팅 정상 — 이미 연결된 회원으로 자동 로그인(비밀번호 없이)
    await waitFor(() => expect(screen.getByText('👤 관리자겸회원 님')).toBeInTheDocument())
    expect(useAuth.getState().memberId).toBe('m1')
    expect(authState.anonCounter).toBe(1) // 익명 UID는 최초 1개만 만들어져야 한다(재사용/멱등)

    // ② 설정 탭 이동
    fireEvent.click(screen.getByText('설정'))
    await waitFor(() => expect(screen.getByText('🔑 관리자 로그인')).toBeInTheDocument())

    // ③ "관리자 로그인" 선택 → PIN 입력 폼 노출
    fireEvent.click(screen.getByText('🔑 관리자 로그인'))
    await waitFor(() => expect(screen.getByPlaceholderText('PIN 입력')).toBeInTheDocument())

    // ④ PIN 입력(기본 PIN 1234) 직후 — 확인 대상: isAdmin=true, Firebase 게이트가 다른 화면
    // (설정탭 유지·서버연결준비중·기기연결화면 등)으로 튀지 않고 바로 뜨는지.
    fireEvent.change(screen.getByPlaceholderText('PIN 입력'), { target: { value: '1234' } })
    fireEvent.click(screen.getByRole('button', { name: '로그인' }))

    expect(useAdmin.getState().isAdmin).toBe(true)
    await waitFor(() => expect(screen.getByText(/관리자 계정으로 한 번 더 로그인해 주세요/)).toBeInTheDocument())
    // PIN 직후 잠깐이라도 다른 화면(로그인 필요 없는 정상 회원 화면 등)으로 새지 않았다
    expect(screen.queryByText('👤 관리자겸회원 님')).not.toBeInTheDocument()
    expect(screen.queryByText('설정')).not.toBeInTheDocument()

    // 이 시점까지 admin Firebase 로그인은 아직 안 했으므로 익명 인증만 있어야 한다(추가 익명
    // 재인증이 일어나지 않았는지도 함께 확인 — ensureAppAuth가 admin user를 만들기 전에
    // 익명으로 되돌리는 버그가 있다면 여기서 카운트가 늘어난다).
    expect(authState.anonCounter).toBe(1)

    // ⑤ Firebase 관리자 이메일/비밀번호 로그인
    fireEvent.change(screen.getByPlaceholderText('관리자 이메일'), { target: { value: ADMIN_EMAIL } })
    fireEvent.change(screen.getByPlaceholderText('비밀번호'), { target: { value: ADMIN_PASSWORD } })
    fireEvent.click(screen.getByRole('button', { name: '로그인' }))

    // ⑥ authorizedAdmin 전환 → split 재로드 → 관리자 화면 진입까지 안정적으로 끝난다.
    await waitFor(() => expect(screen.getByText(/🔑 관리자 모드/)).toBeInTheDocument())
    expect(useAdminAuthStore.getState().status).toBe('authorizedAdmin')

    // ⑦ 무한 루프/깜빡임이 없었는지 — 관리자 로그인 성공 뒤에 추가로 익명 인증이 다시 발생하지
    // 않았어야 한다(발생했다면 memberLinks 자동 로그인 이펙트나 ensureAppAuth가 admin 세션을
    // anonymous로 되돌리고 있다는 뜻).
    expect(authState.anonCounter).toBe(1)
    expect(authCalls.signInWithEmailAndPassword).toBe(1)

    // ⑧ 화면이 안정적으로 멈춰 있는지 — 짧게 기다려도 관리자 모드 화면이 계속 유지된다
    // (다시 게이트로 튕기거나 깜빡이면 이 시점에 사라진다).
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.getByText(/🔑 관리자 모드/)).toBeInTheDocument()
    expect(screen.queryByText(/관리자 계정으로 한 번 더 로그인해 주세요/)).not.toBeInTheDocument()
  })

  it('설정 탭이 관리자 게이트로 대체될 때 언마운트되어도 isAdmin(PIN) 상태는 리셋되지 않는다', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByText('👤 관리자겸회원 님')).toBeInTheDocument())
    fireEvent.click(screen.getByText('설정'))
    await waitFor(() => expect(screen.getByText('🔑 관리자 로그인')).toBeInTheDocument())
    fireEvent.click(screen.getByText('🔑 관리자 로그인'))
    fireEvent.change(await screen.findByPlaceholderText('PIN 입력'), { target: { value: '1234' } })
    fireEvent.click(screen.getByRole('button', { name: '로그인' }))

    await waitFor(() => expect(screen.getByText(/관리자 계정으로 한 번 더 로그인해 주세요/)).toBeInTheDocument())
    // 설정 탭(과 그 안의 PIN 모달)은 이 시점에 이미 언마운트됐어야 한다 — 그래도 전역 isAdmin은 유지.
    expect(useAdmin.getState().isAdmin).toBe(true)
  })

  it('admins 문서가 없는 계정으로 로그인하면 게이트에 머무르되 무한 루프 없이 오류만 보여준다', async () => {
    // adminDocs[ADMIN_UID]를 등록하지 않음 — 로그인은 성공하지만 관리자 문서가 없다.
    render(<App />)
    await waitFor(() => expect(screen.getByText('👤 관리자겸회원 님')).toBeInTheDocument())
    // 여기까지 split 읽기는 두 번 호출된다 — ① memberId=null인 최초 부팅, ② memberLinks
    // 자동 로그인으로 memberId가 'm1'로 바뀌며 재실행. 둘 다 정상 동작이고 admin과는 무관하다.
    const callsBeforeAdminLogin = loadSplitAppStateMock.mock.calls.length
    expect(callsBeforeAdminLogin).toBe(2)

    fireEvent.click(screen.getByText('설정'))
    await waitFor(() => expect(screen.getByText('🔑 관리자 로그인')).toBeInTheDocument())
    fireEvent.click(screen.getByText('🔑 관리자 로그인'))
    fireEvent.change(await screen.findByPlaceholderText('PIN 입력'), { target: { value: '1234' } })
    fireEvent.click(screen.getByRole('button', { name: '로그인' }))
    await waitFor(() => expect(screen.getByPlaceholderText('관리자 이메일')).toBeInTheDocument())

    fireEvent.change(screen.getByPlaceholderText('관리자 이메일'), { target: { value: ADMIN_EMAIL } })
    fireEvent.change(screen.getByPlaceholderText('비밀번호'), { target: { value: ADMIN_PASSWORD } })
    fireEvent.click(screen.getByRole('button', { name: '로그인' }))

    await waitFor(() => expect(screen.getByText(/관리자 권한이 없습니다/)).toBeInTheDocument())
    expect(useAdminAuthStore.getState().status).toBe('authError')
    // authorizedAdmin이 된 적이 없으므로, 관리자 로그인 시도 이후 split 재로드(재시도 효과)가
    // 추가로 트리거되지 않았어야 한다 — PIN 입력~로그인 실패 구간에서 호출 수가 늘지 않는다.
    expect(loadSplitAppStateMock).toHaveBeenCalledTimes(callsBeforeAdminLogin)
  })

  it('실제 기기처럼 네트워크 지연이 있어도(즉시 응답이 아니어도) 같은 순서로 안정적으로 끝난다', async () => {
    // 위 테스트들은 전부 즉시 응답(지연 0ms)이라 실제로는 겹칠 수 있는 비동기 작업들이 항상
    // 깔끔한 순서로 끝나 버린다 — 그래서 실제 기기의 네트워크 지연에서만 드러나는 경쟁 상태를
    // 놓칠 수 있다. 이 테스트는 이메일 로그인·admins 문서 조회에 실제와 비슷한 지연(150ms)을
    // 줘서, 그 사이에 다른 effect(예: keepAppAuthAlive, split 재로드)가 끼어들어도 깜빡이지
    // 않고 끝까지 안정적으로 관리자 화면에 도달하는지 확인한다.
    adminDocs[ADMIN_UID] = { active: true, displayName: '가상관리자' }
    networkDelay.ms = 150

    render(<App />)
    await waitFor(() => expect(screen.getByText('👤 관리자겸회원 님')).toBeInTheDocument())

    fireEvent.click(screen.getByText('설정'))
    await waitFor(() => expect(screen.getByText('🔑 관리자 로그인')).toBeInTheDocument())
    fireEvent.click(screen.getByText('🔑 관리자 로그인'))
    fireEvent.change(await screen.findByPlaceholderText('PIN 입력'), { target: { value: '1234' } })
    fireEvent.click(screen.getByRole('button', { name: '로그인' }))
    await waitFor(() => expect(screen.getByText(/관리자 계정으로 한 번 더 로그인해 주세요/)).toBeInTheDocument())

    fireEvent.change(screen.getByPlaceholderText('관리자 이메일'), { target: { value: ADMIN_EMAIL } })
    fireEvent.change(screen.getByPlaceholderText('비밀번호'), { target: { value: ADMIN_PASSWORD } })
    fireEvent.click(screen.getByRole('button', { name: '로그인' }))

    // 로그인 요청이 실제로 진행 중인 동안(150ms 지연) 화면이 오류 없이 "확인 중" 상태를 유지하다가
    await waitFor(() => expect(screen.getByText(/🔑 관리자 모드/)).toBeInTheDocument(), { timeout: 2000 })
    expect(useAdminAuthStore.getState().status).toBe('authorizedAdmin')
    expect(authState.anonCounter).toBe(1) // 지연 구간에서도 익명 인증이 다시 생성되지 않았다

    // 지연이 끝난 뒤에도 계속 안정적으로 관리자 화면에 머무르는지(뒤늦게 되돌아가지 않는지)
    await new Promise((r) => setTimeout(r, 400))
    expect(screen.getByText(/🔑 관리자 모드/)).toBeInTheDocument()
    expect(screen.queryByText(/관리자 계정으로 한 번 더 로그인해 주세요/)).not.toBeInTheDocument()
  })
})

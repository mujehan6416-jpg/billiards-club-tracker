import { describe, it, expect, vi, beforeEach } from 'vitest'

// 실제 Firebase 호출부는 전부 모킹 — 실제 계정·네트워크에 접근하지 않는다.
type AuthCallback = (user: unknown) => void

const subscribeAuthStateMock = vi.fn()
const fetchAdminDocMock = vi.fn()

vi.mock('../src/lib/adminAuth', () => ({
  adminSignIn: vi.fn(),
  adminSignOut: vi.fn(),
  subscribeAuthState: (...args: unknown[]) => subscribeAuthStateMock(...args),
  fetchAdminDoc: (...args: unknown[]) => fetchAdminDocMock(...args),
}))

import { useAdminAuthStore } from '../src/store/adminAuthStore'

/** init()을 실행하고, Firebase가 알려주는 사용자 상태를 흉내내는 함수를 돌려준다. */
function startInit(): (user: unknown) => void {
  let notify: AuthCallback = () => {}
  subscribeAuthStateMock.mockImplementation((cb: AuthCallback) => { notify = cb; return () => {} })
  useAdminAuthStore.getState().init()
  return (user) => notify(user)
}

beforeEach(() => {
  subscribeAuthStateMock.mockReset()
  fetchAdminDocMock.mockReset()
  useAdminAuthStore.setState({
    status: 'loading', uid: null, email: null, adminDisplayName: null, errorMessage: null,
  })
})

describe('adminAuthStore — 익명 인증과의 충돌 방지', () => {
  it('익명 사용자는 관리자 후보로 보지 않고 로그인 대기 상태로 둔다', () => {
    const emit = startInit()
    emit({ uid: 'anon-uid', isAnonymous: true })

    const s = useAdminAuthStore.getState()
    expect(s.status).toBe('unauthenticated')
    // 관리자 문서를 조회하지 않아야 한다 — 조회하면 "관리자 권한이 없습니다" 오류가 잘못 뜬다
    expect(fetchAdminDocMock).not.toHaveBeenCalled()
    expect(s.errorMessage).toBeNull()
  })

  it('사용자가 아예 없을 때도 기존처럼 로그인 대기 상태다', () => {
    const emit = startInit()
    emit(null)

    expect(useAdminAuthStore.getState().status).toBe('unauthenticated')
    expect(fetchAdminDocMock).not.toHaveBeenCalled()
  })

  it('이메일 로그인한 관리자는 기존대로 관리자 확인 절차를 거친다', async () => {
    fetchAdminDocMock.mockResolvedValue({ active: true, displayName: '가상관리자' })
    const emit = startInit()
    emit({ uid: 'admin-uid', isAnonymous: false, email: 'admin@example.test' })

    await vi.waitFor(() => expect(useAdminAuthStore.getState().status).toBe('authorizedAdmin'))
    expect(fetchAdminDocMock).toHaveBeenCalledWith('admin-uid')
    expect(useAdminAuthStore.getState().adminDisplayName).toBe('가상관리자')
  })

  it('관리자 문서가 없는 이메일 사용자는 기존대로 권한 없음으로 안내한다', async () => {
    fetchAdminDocMock.mockResolvedValue(null)
    const emit = startInit()
    emit({ uid: 'other-uid', isAnonymous: false, email: 'other@example.test' })

    await vi.waitFor(() => expect(useAdminAuthStore.getState().status).toBe('authError'))
    expect(useAdminAuthStore.getState().errorMessage).toContain('관리자 권한이 없습니다')
  })

  it('관리자 로그아웃 뒤 익명 인증이 복구돼도 오류를 띄우지 않는다', async () => {
    fetchAdminDocMock.mockResolvedValue({ active: true, displayName: '가상관리자' })
    const emit = startInit()
    emit({ uid: 'admin-uid', isAnonymous: false })
    await vi.waitFor(() => expect(useAdminAuthStore.getState().status).toBe('authorizedAdmin'))

    // 로그아웃 → 익명 인증 자동 복구 순서
    emit(null)
    expect(useAdminAuthStore.getState().status).toBe('unauthenticated')
    emit({ uid: 'anon-uid-2', isAnonymous: true })

    const s = useAdminAuthStore.getState()
    expect(s.status).toBe('unauthenticated')
    expect(s.errorMessage).toBeNull()
    expect(s.adminDisplayName).toBeNull()
  })
})

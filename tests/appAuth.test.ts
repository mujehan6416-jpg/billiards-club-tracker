import { describe, it, expect, vi, beforeEach } from 'vitest'

// Firebase 실제 호출부를 전부 모킹 — 실제 네트워크·실제 계정에 절대 접근하지 않는다.
type AuthCallback = (user: unknown) => void
type ErrorCallback = (error: unknown) => void

const signInAnonymouslyMock = vi.fn()
const onAuthStateChangedMock = vi.fn()

vi.mock('firebase/auth', () => ({
  getAuth: () => ({ __fakeAuth: true }),
  signInAnonymously: (...args: unknown[]) => signInAnonymouslyMock(...args),
  onAuthStateChanged: (...args: unknown[]) => onAuthStateChangedMock(...args),
}))
vi.mock('../src/lib/firebase', () => ({ db: {} }))

import { ensureAppAuth, keepAppAuthAlive } from '../src/lib/appAuth'

/** onAuthStateChanged가 최초 상태로 user를 알려주는 상황을 흉내낸다. */
function emitInitialUser(user: unknown) {
  onAuthStateChangedMock.mockImplementation((_auth: unknown, next: AuthCallback) => {
    next(user)
    return () => {}
  })
}

/** onAuthStateChanged가 오류로 끝나는 상황을 흉내낸다. */
function emitInitialError(error: unknown) {
  onAuthStateChangedMock.mockImplementation((_auth: unknown, _next: AuthCallback, onError: ErrorCallback) => {
    onError(error)
    return () => {}
  })
}

beforeEach(() => {
  signInAnonymouslyMock.mockReset()
  signInAnonymouslyMock.mockResolvedValue({ user: { uid: 'anon-uid', isAnonymous: true } })
  onAuthStateChangedMock.mockReset()
})

describe('ensureAppAuth — 앱 시작 시 서버 인증 확보', () => {
  it('인증된 사용자가 없으면 익명 로그인을 시도한다', async () => {
    emitInitialUser(null)
    await ensureAppAuth()
    expect(signInAnonymouslyMock).toHaveBeenCalledTimes(1)
  })

  it('이미 익명 사용자가 있으면 다시 로그인하지 않는다', async () => {
    emitInitialUser({ uid: 'anon-uid', isAnonymous: true })
    await ensureAppAuth()
    expect(signInAnonymouslyMock).not.toHaveBeenCalled()
  })

  it('관리자로 로그인된 상태면 익명 로그인으로 덮어쓰지 않는다', async () => {
    emitInitialUser({ uid: 'admin-uid', isAnonymous: false })
    await ensureAppAuth()
    expect(signInAnonymouslyMock).not.toHaveBeenCalled()
  })

  it('익명 로그인이 실패하면 예외를 던진다(호출부가 다운로드를 막을 수 있게)', async () => {
    emitInitialUser(null)
    signInAnonymouslyMock.mockRejectedValue(new Error('auth/network-request-failed'))
    await expect(ensureAppAuth()).rejects.toThrow()
  })

  it('인증 상태 확인 자체가 실패하면 예외를 던진다', async () => {
    emitInitialError(new Error('auth/internal-error'))
    await expect(ensureAppAuth()).rejects.toThrow()
    expect(signInAnonymouslyMock).not.toHaveBeenCalled()
  })

  it('최초 상태를 확인한 뒤에는 구독을 해제한다(중복 감시를 남기지 않는다)', async () => {
    const unsubscribe = vi.fn()
    onAuthStateChangedMock.mockImplementation((_a: unknown, next: AuthCallback) => {
      next({ uid: 'anon-uid', isAnonymous: true })
      return unsubscribe
    })
    await ensureAppAuth()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})

describe('keepAppAuthAlive — 관리자 로그아웃 후 인증 회복', () => {
  it('사용자가 사라지면 익명 인증을 다시 확보한다', () => {
    let notify: AuthCallback = () => {}
    onAuthStateChangedMock.mockImplementation((_a: unknown, next: AuthCallback) => {
      notify = next
      return () => {}
    })
    keepAppAuthAlive()

    notify(null) // 관리자 로그아웃으로 사용자가 없어진 상황
    expect(signInAnonymouslyMock).toHaveBeenCalledTimes(1)
  })

  it('관리자가 로그인해 사용자가 바뀐 경우에는 익명 로그인을 하지 않는다', () => {
    let notify: AuthCallback = () => {}
    onAuthStateChangedMock.mockImplementation((_a: unknown, next: AuthCallback) => {
      notify = next
      return () => {}
    })
    keepAppAuthAlive()

    notify({ uid: 'admin-uid', isAnonymous: false })
    expect(signInAnonymouslyMock).not.toHaveBeenCalled()
  })

  it('구독 해제 함수를 돌려준다', () => {
    const unsubscribe = vi.fn()
    onAuthStateChangedMock.mockImplementation(() => unsubscribe)
    expect(keepAppAuthAlive()).toBe(unsubscribe)
  })
})

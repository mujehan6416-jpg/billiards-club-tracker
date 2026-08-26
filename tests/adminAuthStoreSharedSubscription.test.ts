import { describe, it, expect, vi, beforeEach } from 'vitest'

// adminAuthStore.init()은 App.tsx, SettlementAdminTab, DeviceLinkAdminCard, SplitMigrationCard 등
// 여러 화면이 각자 부른다. 예전 코드는 호출마다 새 onAuthStateChanged 구독을 만들었는데,
// Firebase는 새 구독이 생기는 순간 "현재 상태"를 즉시 한 번 다시 불러준다 — 그래서
// authorizedAdmin으로 이미 확인된 뒤에도, 관리자 화면(그 안의 DeviceLinkAdminCard 등)이
// 새로 마운트될 때마다 resolveAdmin()이 다시 실행돼 status가 'authenticated'로 잠깐
// 되돌아갔다. App.tsx의 관리자 게이트는 status !== 'authorizedAdmin'이면 화면을 막으므로,
// 이 잠깐의 되돌아감이 게이트를 다시 띄우고 → 관리자 화면이 사라지고 → 그 화면의
// DeviceLinkAdminCard 등이 언마운트/재마운트되며 init()이 또 불려 같은 일이 반복되는
// 무한 루프(실사용 증상: "PIN 이후 Firebase 로그인은 되는데 화면이 깜빡거리며 들어가지지
// 않음")로 이어졌다. 이 테스트는 여러 호출자가 init()을 불러도 실제 구독은 하나만
// 만들어지고, 이미 authorizedAdmin인 상태에서 추가 호출이 status를 되돌리지 않는지 확인한다.

const authCallbacks: Array<(user: unknown) => void> = []
const subscribeAuthStateMock = vi.fn((cb: (user: unknown) => void) => {
  authCallbacks.push(cb)
  return () => {
    const idx = authCallbacks.indexOf(cb)
    if (idx >= 0) authCallbacks.splice(idx, 1)
  }
})
const fetchAdminDocMock = vi.fn()

vi.mock('../src/lib/adminAuth', () => ({
  adminSignIn: vi.fn(),
  adminSignOut: vi.fn(),
  subscribeAuthState: (cb: (user: unknown) => void) => subscribeAuthStateMock(cb),
  fetchAdminDoc: (...args: unknown[]) => fetchAdminDocMock(...args),
}))

const ADMIN_USER = { uid: 'admin-uid', email: 'a@example.test', isAnonymous: false }

async function flush() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('adminAuthStore — init() 구독 공유(무한 루프 방지)', () => {
  beforeEach(() => {
    vi.resetModules()
    authCallbacks.length = 0
    subscribeAuthStateMock.mockClear()
    fetchAdminDocMock.mockReset()
    fetchAdminDocMock.mockResolvedValue({ active: true, displayName: '가상관리자' })
  })

  it('여러 화면이 init()을 불러도 실제 Firebase 구독은 한 번만 만들어진다', async () => {
    const { useAdminAuthStore } = await import('../src/store/adminAuthStore')
    const unsub1 = useAdminAuthStore.getState().init() // App.tsx
    const unsub2 = useAdminAuthStore.getState().init() // DeviceLinkAdminCard
    const unsub3 = useAdminAuthStore.getState().init() // SplitMigrationCard

    expect(subscribeAuthStateMock).toHaveBeenCalledTimes(1)
    unsub1(); unsub2(); unsub3()
  })

  it('이미 authorizedAdmin인 상태에서 추가 화면이 init()을 불러도 status가 되돌아가지 않는다', async () => {
    const { useAdminAuthStore } = await import('../src/store/adminAuthStore')
    const unsub1 = useAdminAuthStore.getState().init() // App.tsx가 가장 먼저 구독
    authCallbacks[0]?.(ADMIN_USER) // Firebase가 관리자 로그인 완료를 알림
    await flush()
    expect(useAdminAuthStore.getState().status).toBe('authorizedAdmin')

    // 관리자 화면이 열리며 DeviceLinkAdminCard가 새로 마운트되어 또 init()을 부른다.
    const unsub2 = useAdminAuthStore.getState().init()
    await flush()

    // 예전 버그: 여기서 status가 'authenticated'로 되돌아갔다가 다시 'authorizedAdmin'으로
    // 바뀌며 App.tsx의 관리자 게이트를 껐다 켰다 했다(깜빡임). 고친 뒤에는 추가 init() 호출이
    // 새 구독을 만들지 않으므로 status가 흔들리지 않고 계속 authorizedAdmin이어야 한다.
    expect(subscribeAuthStateMock).toHaveBeenCalledTimes(1)
    expect(fetchAdminDocMock).toHaveBeenCalledTimes(1)
    expect(useAdminAuthStore.getState().status).toBe('authorizedAdmin')

    unsub1(); unsub2()
  })

  it('일부 화면이 언마운트돼도 다른 화면이 아직 쓰고 있으면 구독을 끊지 않는다', async () => {
    const { useAdminAuthStore } = await import('../src/store/adminAuthStore')
    const unsub1 = useAdminAuthStore.getState().init()
    const unsub2 = useAdminAuthStore.getState().init()
    expect(authCallbacks).toHaveLength(1)

    unsub2() // DeviceLinkAdminCard만 먼저 언마운트(설정 탭 이탈)
    expect(authCallbacks).toHaveLength(1) // App.tsx가 아직 쓰는 중 — 구독 유지

    unsub1() // 마지막 사용자까지 정리
    expect(authCallbacks).toHaveLength(0)
  })

  it('모두 언마운트된 뒤 다시 init()을 부르면 새 구독을 만든다', async () => {
    const { useAdminAuthStore } = await import('../src/store/adminAuthStore')
    const unsub1 = useAdminAuthStore.getState().init()
    unsub1()
    expect(subscribeAuthStateMock).toHaveBeenCalledTimes(1)

    const unsub2 = useAdminAuthStore.getState().init()
    expect(subscribeAuthStateMock).toHaveBeenCalledTimes(2)
    unsub2()
  })
})

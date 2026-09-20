import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react'

// 실제 Firebase에는 절대 접근하지 않는다 — 인증·동기화 모두 모킹한다.
// 이 파일은 하단 탭 구성과 공통 종료 버튼(화면 배치)만 확인한다.
const ensureAppAuthMock = vi.fn()
const keepAppAuthAliveMock = vi.fn()
const currentAuthUidMock = vi.fn()

vi.mock('../src/lib/appAuth', () => ({
  ensureAppAuth: (...args: unknown[]) => ensureAppAuthMock(...args),
  keepAppAuthAlive: (...args: unknown[]) => keepAppAuthAliveMock(...args),
  currentAuthUid: (...args: unknown[]) => currentAuthUidMock(...args),
}))
vi.mock('../src/lib/cloudSync', () => ({
  downloadFromCloud: vi.fn(async () => null),
  uploadToCloud: vi.fn(),
  markSynced: vi.fn(),
  UploadCancelledError: class UploadCancelledError extends Error {},
}))
vi.mock('../src/lib/splitFirestore', () => ({
  USE_SPLIT_FIRESTORE: false,
  loadSplitAppState: vi.fn(),
  syncSplitChanges: vi.fn(),
  deleteSplitSession: vi.fn(),
}))
vi.mock('../src/lib/memberLink', () => ({
  fetchMyLink: vi.fn(async () => null),
  getLinkedMemberId: vi.fn(async () => null),
}))
vi.mock('../src/lib/noticeFirestore', () => ({
  fetchNotices: vi.fn(async () => []),
  fetchMyReadNoticeIds: vi.fn(async () => []),
  markNoticeRead: vi.fn(),
  createNotice: vi.fn(),
  setNoticePinned: vi.fn(),
  updateNoticeText: vi.fn(),
  deleteNotice: vi.fn(),
}))
vi.mock('../src/lib/firebase', () => ({ db: {} }))
vi.mock('firebase/auth', () => ({
  getAuth: () => ({}),
  signInAnonymously: vi.fn(),
  signOut: vi.fn(),
  onAuthStateChanged: () => () => {},
}))
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
import type { Member } from '../src/types'

// 아래 이름·ID는 전부 테스트용 가상 데이터이며 실제 회원 정보가 아니다.
const member: Member = { id: 'm1', name: '테스트회원A', handicap: 20, handicapHistory: [], active: true }

beforeEach(() => {
  useApp.setState({ members: [member], sessions: [], settings: { lastBackupAt: null }, ledger: [] })
  // 로그인된 상태로 시작해야 하단 탭이 있는 본 화면이 그려진다.
  useAuth.setState({ memberId: member.id, memberName: member.name, isGuest: false })
  useAdmin.setState({ isAdmin: false })
  ensureAppAuthMock.mockReset(); ensureAppAuthMock.mockResolvedValue(undefined)
  keepAppAuthAliveMock.mockReset(); keepAppAuthAliveMock.mockReturnValue(() => {})
  currentAuthUidMock.mockReset(); currentAuthUidMock.mockReturnValue(null)
})

afterEach(() => {
  vi.useRealTimers()
})

/** 하단 탭바의 버튼 라벨을 화면에 놓인 순서대로. */
function navLabels(): string[] {
  const nav = document.querySelector('nav.bottom-nav')!
  return Array.from(nav.querySelectorAll('button')).map(
    (b) => b.querySelector('.nav-label')?.textContent ?? '',
  )
}

async function renderApp() {
  render(<App />)
  await waitFor(() => expect(document.querySelector('nav.bottom-nav')).toBeTruthy())
}

describe('App 하단 탭 구성', () => {
  it('홈 → 회원 → 모임 → 대회 → 통계 → 설정 순서로 6개가 놓인다', async () => {
    await renderApp()
    expect(navLabels()).toEqual(['홈', '회원', '모임', '대회', '통계', '설정'])
  })

  it('하단 탭에는 종료 버튼이 더 이상 없다', async () => {
    await renderApp()
    expect(navLabels()).not.toContain('종료')
    expect(navLabels()).not.toContain('한번더!')
  })

  it('대회 탭을 누르면 대회 화면이 열린다', async () => {
    await renderApp()
    const nav = document.querySelector('nav.bottom-nav')!
    const tournamentBtn = Array.from(nav.querySelectorAll('button'))
      .find((b) => b.querySelector('.nav-label')?.textContent === '대회')!
    fireEvent.click(tournamentBtn)
    await waitFor(() => expect(screen.getByRole('heading', { name: /대회/ })).toBeInTheDocument())
  })

  it('홈 화면의 대회 메뉴도 그대로 대회 화면으로 간다', async () => {
    await renderApp()
    // 하단 탭에도 '대회' 버튼이 생겼으므로 본문(홈 화면) 안으로 범위를 좁혀서 고른다.
    // 홈 메뉴 버튼의 이름이 '대회'로 유지되는지도 여기서 함께 확인되는 셈이다.
    const main = document.querySelector('main.app-main') as HTMLElement
    fireEvent.click(within(main).getByRole('button', { name: /대회/ }))
    await waitFor(() => expect(screen.getByRole('heading', { name: /대회/ })).toBeInTheDocument())
  })

  it('홈 메뉴의 모임·대회 버튼 이름이 그대로 유지된다(아이콘은 읽어주지 않는다)', async () => {
    await renderApp()
    const main = document.querySelector('main.app-main') as HTMLElement
    expect(within(main).getByRole('button', { name: /모임/ })).toBeInTheDocument()
    expect(within(main).getByRole('button', { name: /대회/ })).toBeInTheDocument()
    expect(main.textContent).not.toContain('🎱')
  })

  it('모임·대회 탭 아이콘은 이모지가 아니라 SVG 당구공이다(숫자 8이 없다)', async () => {
    await renderApp()
    const nav = document.querySelector('nav.bottom-nav')!
    const iconOf = (label: string) =>
      Array.from(nav.querySelectorAll('button'))
        .find((b) => b.querySelector('.nav-label')?.textContent === label)!
        .querySelector('.nav-icon')!

    expect(iconOf('모임').querySelector('svg')).toBeTruthy()
    expect(iconOf('대회').querySelector('svg')).toBeTruthy()
    expect(nav.textContent).not.toContain('🎱')
  })
})

describe('App 공통 종료 버튼', () => {
  it('탭 화면 위쪽에 종료 버튼이 있고, 하단 탭바 밖에 있다', async () => {
    await renderApp()
    const exit = screen.getByRole('button', { name: /종료/ })
    expect(exit).toBeInTheDocument()
    expect(document.querySelector('nav.bottom-nav')!.contains(exit)).toBe(false)
  })

  // 종료 버튼이 자기 줄을 따로 차지하지 않고 본문 맨 위에 겹쳐 놓이도록, 본문(main) 안의
  // .screen-exit로 한 번만 그려져야 한다(화면마다 복제하지 않는다).
  it('종료 버튼은 본문 안에 .screen-exit 하나로만 그려진다', async () => {
    await renderApp()
    const main = document.querySelector('main.app-main') as HTMLElement
    const exits = document.querySelectorAll('.screen-exit')
    expect(exits).toHaveLength(1)
    expect(main.contains(exits[0])).toBe(true)
  })

  it('제목이 있는 탭에서 제목과 종료 버튼이 모두 본문 맨 위에 있다', async () => {
    await renderApp()
    const nav = document.querySelector('nav.bottom-nav')!
    const membersBtn = Array.from(nav.querySelectorAll('button'))
      .find((b) => b.querySelector('.nav-label')?.textContent === '회원')!
    fireEvent.click(membersBtn)
    await waitFor(() => expect(document.querySelector('.tab-title')).toBeTruthy())
    const main = document.querySelector('main.app-main') as HTMLElement
    expect(main.querySelector('.tab-title')!.textContent).toBe('회원')
    expect(main.querySelector('.screen-exit')).toBeTruthy()
  })

  it('한 번 누르면 한번더!로 바뀌고 로그아웃되지 않는다', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('button', { name: /종료/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: /한번더!/ })).toBeInTheDocument())
    expect(useAuth.getState().memberId).toBe(member.id)
  })

  it('2초 안에 두 번 누르면 로그아웃된다', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('button', { name: /종료/ }))
    fireEvent.click(await screen.findByRole('button', { name: /한번더!/ }))
    await waitFor(() => expect(useAuth.getState().memberId).toBeNull())
  })

  it('2초가 지나면 한번더! 상태가 풀려 한 번 더 눌러도 로그아웃되지 않는다', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await renderApp()
    fireEvent.click(screen.getByRole('button', { name: /종료/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: /한번더!/ })).toBeInTheDocument())

    await act(async () => { vi.advanceTimersByTime(2100) })
    await waitFor(() => expect(screen.getByRole('button', { name: /종료/ })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /종료/ }))
    expect(useAuth.getState().memberId).toBe(member.id)
  })

  it('탭을 옮겨도 각 화면에서 종료 버튼을 쓸 수 있다', async () => {
    await renderApp()
    const nav = document.querySelector('nav.bottom-nav')!
    for (const label of ['회원', '모임', '대회', '통계']) {
      const btn = Array.from(nav.querySelectorAll('button'))
        .find((b) => b.querySelector('.nav-label')?.textContent === label)!
      fireEvent.click(btn)
      await waitFor(() => expect(screen.getByRole('button', { name: /종료/ })).toBeInTheDocument())
    }
  })
})

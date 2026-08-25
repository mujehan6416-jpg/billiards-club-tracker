import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// 실제 Firebase에는 절대 접근하지 않는다 — 인증·동기화 모두 모킹한다.
const callOrder: string[] = []
const ensureAppAuthMock = vi.fn()
const keepAppAuthAliveMock = vi.fn()
const downloadFromCloudMock = vi.fn()
const markSyncedMock = vi.fn()

vi.mock('../src/lib/appAuth', () => ({
  ensureAppAuth: (...args: unknown[]) => { callOrder.push('auth'); return ensureAppAuthMock(...args) },
  keepAppAuthAlive: (...args: unknown[]) => keepAppAuthAliveMock(...args),
}))
vi.mock('../src/lib/cloudSync', () => ({
  downloadFromCloud: (...args: unknown[]) => { callOrder.push('download'); return downloadFromCloudMock(...args) },
  uploadToCloud: vi.fn(),
  markSynced: (...args: unknown[]) => markSyncedMock(...args),
  UploadCancelledError: class UploadCancelledError extends Error {},
}))
vi.mock('../src/lib/firebase', () => ({ db: {} }))
vi.mock('firebase/auth', () => ({
  getAuth: () => ({}),
  signInAnonymously: vi.fn(),
  signOut: vi.fn(),
  onAuthStateChanged: () => () => {},
}))

import { App } from '../src/App'
import { useApp } from '../src/store/appStore'
import { useAuth } from '../src/store/authStore'
import type { Member } from '../src/types'

// 아래 이름·ID는 전부 테스트용 가상 데이터이며 실제 회원 정보가 아니다.
const members: Member[] = [
  { id: 'm1', name: '테스트회원A', handicap: 20, handicapHistory: [], active: true },
]

beforeEach(() => {
  callOrder.length = 0
  useApp.setState({ members, sessions: [], settings: { lastBackupAt: null }, ledger: [] })
  useAuth.setState({ memberId: null, memberName: null, isGuest: false })
  ensureAppAuthMock.mockReset()
  ensureAppAuthMock.mockResolvedValue(undefined)
  keepAppAuthAliveMock.mockReset()
  keepAppAuthAliveMock.mockReturnValue(() => {})
  downloadFromCloudMock.mockReset()
  downloadFromCloudMock.mockResolvedValue(null)
  markSyncedMock.mockReset()
})

describe('App 부팅 순서 — 인증 후에만 서버 데이터를 내려받는다', () => {
  it('서버 인증이 끝난 뒤에 다운로드가 호출된다', async () => {
    render(<App />)
    await waitFor(() => expect(downloadFromCloudMock).toHaveBeenCalled())
    expect(callOrder).toEqual(['auth', 'download'])
  })

  it('인증이 끝나기 전에는 다운로드를 시작하지 않는다', async () => {
    let releaseAuth: () => void = () => {}
    ensureAppAuthMock.mockReturnValue(new Promise<void>((resolve) => { releaseAuth = resolve }))

    render(<App />)
    // 인증이 아직 진행 중인 동안에는 다운로드가 없어야 한다
    await waitFor(() => expect(ensureAppAuthMock).toHaveBeenCalled())
    expect(downloadFromCloudMock).not.toHaveBeenCalled()

    releaseAuth()
    await waitFor(() => expect(downloadFromCloudMock).toHaveBeenCalled())
  })

  it('인증에 실패하면 다운로드를 하지 않고 안내 화면을 보여준다', async () => {
    ensureAppAuthMock.mockRejectedValue(new Error('auth/network-request-failed'))
    render(<App />)

    await waitFor(() => expect(screen.getByText(/서버 연결을 준비하지 못했습니다/)).toBeInTheDocument())
    expect(downloadFromCloudMock).not.toHaveBeenCalled()
    expect(callOrder).toEqual(['auth'])
    // 기술 용어를 사용자에게 노출하지 않는다
    expect(screen.queryByText(/Firebase|auth\//i)).not.toBeInTheDocument()
  })

  it('안내 화면의 "다시 시도"를 누르면 인증부터 다시 시작한다', async () => {
    ensureAppAuthMock.mockRejectedValueOnce(new Error('auth/network-request-failed'))
    render(<App />)
    await waitFor(() => expect(screen.getByText(/서버 연결을 준비하지 못했습니다/)).toBeInTheDocument())

    ensureAppAuthMock.mockResolvedValue(undefined)
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))

    await waitFor(() => expect(downloadFromCloudMock).toHaveBeenCalled())
    expect(callOrder).toEqual(['auth', 'auth', 'download'])
  })

  it('인증 회복 감시(keepAppAuthAlive)를 앱에서 시작한다', async () => {
    render(<App />)
    await waitFor(() => expect(keepAppAuthAliveMock).toHaveBeenCalled())
  })

  it('인증이 정상이면 기존 회원 로그인 화면이 그대로 나온다', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByText('로그인')).toBeInTheDocument())
    // 기존 방식 유지 — 이름 선택 + 비밀번호
    expect(screen.getByRole('option', { name: '테스트회원A' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('비밀번호')).toBeInTheDocument()
  })

  it('서버 다운로드가 실패해도(인증은 성공) 기존처럼 앱을 계속 쓸 수 있다', async () => {
    downloadFromCloudMock.mockRejectedValue(new Error('offline'))
    render(<App />)
    await waitFor(() => expect(screen.getByText('로그인')).toBeInTheDocument())
    expect(screen.queryByText(/서버 연결을 준비하지 못했습니다/)).not.toBeInTheDocument()
  })
})

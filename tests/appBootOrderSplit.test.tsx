import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// 실제 Firebase에는 절대 접근하지 않는다 — 인증·동기화 모두 모킹한다.
// 이 파일은 USE_SPLIT_FIRESTORE=true일 때의 App 부팅 흐름만 확인한다(appBootOrder.test.tsx는
// 실제 앱과 같은 false 상태를 확인한다) — 그래서 splitFirestore.ts 전체를 모킹해 그 상수만
// true로 바꿔치기한다.
const ensureAppAuthMock = vi.fn()
const keepAppAuthAliveMock = vi.fn()
const downloadFromCloudMock = vi.fn()
const loadSplitAppStateMock = vi.fn()

vi.mock('../src/lib/appAuth', () => ({
  ensureAppAuth: (...args: unknown[]) => ensureAppAuthMock(...args),
  keepAppAuthAlive: (...args: unknown[]) => keepAppAuthAliveMock(...args),
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
import type { AppState, Member } from '../src/types'

// 아래 이름·ID·비밀번호는 전부 테스트용 가상 데이터이며 실제 회원 정보가 아니다.
const splitMember: Member = { id: 'm1', name: '테스트회원A', handicap: 20, handicapHistory: [], active: true }
const emptySplitState: AppState = { members: [splitMember], sessions: [], settings: { lastBackupAt: null }, ledger: [] }

beforeEach(() => {
  useApp.setState({ members: [splitMember], sessions: [], settings: { lastBackupAt: null }, ledger: [] })
  useAuth.setState({ memberId: null, memberName: null, isGuest: false })
  ensureAppAuthMock.mockReset()
  ensureAppAuthMock.mockResolvedValue(undefined)
  keepAppAuthAliveMock.mockReset()
  keepAppAuthAliveMock.mockReturnValue(() => {})
  downloadFromCloudMock.mockReset()
  downloadFromCloudMock.mockResolvedValue(null) // 비밀번호 합칠 legacy 문서 없음(기본값 '0000')
  loadSplitAppStateMock.mockReset()
})

describe('App 부팅 순서 — USE_SPLIT_FIRESTORE=true', () => {
  it('split 읽기가 성공하면 그 내용으로 로그인 화면이 뜬다(legacy 다운로드로 대체하지 않음)', async () => {
    loadSplitAppStateMock.mockResolvedValue(emptySplitState)
    render(<App />)
    await waitFor(() => expect(screen.getByText('로그인')).toBeInTheDocument())
    expect(loadSplitAppStateMock).toHaveBeenCalled()
  })

  it('legacy 문서에 있던 비밀번호를 회원 ID 기준으로 합쳐 반영한다', async () => {
    loadSplitAppStateMock.mockResolvedValue(emptySplitState)
    downloadFromCloudMock.mockResolvedValue({
      state: { ...emptySplitState, members: [{ ...splitMember, password: '9999' }] },
      updatedAt: '2026-08-01T00:00:00.000Z',
    })
    render(<App />)
    await waitFor(() => expect(screen.getByText('로그인')).toBeInTheDocument())
    expect(useApp.getState().members.find((m) => m.id === 'm1')?.password).toBe('9999')
  })

  it('split 읽기가 실패하면 오류 화면을 보여주고 legacy로 조용히 넘어가지 않는다', async () => {
    loadSplitAppStateMock.mockRejectedValue(new Error('permission-denied'))
    render(<App />)
    await waitFor(() => expect(screen.getByText(/최신 내용을 서버에서 불러오지 못했습니다/)).toBeInTheDocument())
    // 로그인 화면(=앱 진입)으로 넘어가지 않았다 — write가 일어날 수 있는 화면 자체를 막는다
    expect(screen.queryByText('로그인')).not.toBeInTheDocument()
    // 기술 용어를 사용자에게 노출하지 않는다
    expect(screen.queryByText(/permission-denied|Firestore/i)).not.toBeInTheDocument()
  })

  it('오류 화면의 "다시 시도"를 누르면 split 읽기를 다시 시도한다', async () => {
    loadSplitAppStateMock.mockRejectedValueOnce(new Error('offline'))
    render(<App />)
    await waitFor(() => expect(screen.getByText(/최신 내용을 서버에서 불러오지 못했습니다/)).toBeInTheDocument())

    loadSplitAppStateMock.mockResolvedValue(emptySplitState)
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))

    await waitFor(() => expect(screen.getByText('로그인')).toBeInTheDocument())
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

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// Firebase 실제 호출부를 전부 모킹 — 실제 네트워크·운영 데이터에 접근하지 않는다.
const fetchPendingRequestsMock = vi.fn()
const fetchMemberLinksMock = vi.fn()
const approveLinkRequestMock = vi.fn()
const rejectLinkRequestMock = vi.fn()
const setLinkActiveMock = vi.fn()

vi.mock('../src/lib/memberLink', () => ({
  fetchPendingRequests: (...a: unknown[]) => fetchPendingRequestsMock(...a),
  fetchMemberLinks: (...a: unknown[]) => fetchMemberLinksMock(...a),
  approveLinkRequest: (...a: unknown[]) => approveLinkRequestMock(...a),
  rejectLinkRequest: (...a: unknown[]) => rejectLinkRequestMock(...a),
  setLinkActive: (...a: unknown[]) => setLinkActiveMock(...a),
}))
vi.mock('../src/lib/adminAuth', () => ({
  adminSignIn: vi.fn(), adminSignOut: vi.fn(),
  subscribeAuthState: () => () => {},
  fetchAdminDoc: vi.fn(),
}))

import { DeviceLinkAdminCard } from '../src/components/memberLink/DeviceLinkAdminCard'
import { useAdminAuthStore } from '../src/store/adminAuthStore'
import { useApp } from '../src/store/appStore'
import type { Member } from '../src/types'

// 아래 이름·ID는 전부 테스트용 가상 데이터이며 실제 회원 정보가 아니다.
const members: Member[] = [
  { id: 'm1', name: '테스트회원A', handicap: 20, handicapHistory: [], active: true },
  { id: 'm2', name: '테스트회원B', handicap: 25, handicapHistory: [], active: true },
]

const asAuthorizedAdmin = () =>
  useAdminAuthStore.setState({ status: 'authorizedAdmin', uid: 'admin-uid', email: 'a@example.test', adminDisplayName: '가상관리자', errorMessage: null })

beforeEach(() => {
  useApp.setState({ members, sessions: [], settings: { lastBackupAt: null }, ledger: [] })
  useAdminAuthStore.setState({ status: 'unauthenticated', uid: null, email: null, adminDisplayName: null, errorMessage: null })
  fetchPendingRequestsMock.mockReset(); fetchPendingRequestsMock.mockResolvedValue([])
  fetchMemberLinksMock.mockReset(); fetchMemberLinksMock.mockResolvedValue([])
  approveLinkRequestMock.mockReset(); approveLinkRequestMock.mockResolvedValue(undefined)
  rejectLinkRequestMock.mockReset(); rejectLinkRequestMock.mockResolvedValue(undefined)
  setLinkActiveMock.mockReset(); setLinkActiveMock.mockResolvedValue(undefined)
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

describe('DeviceLinkAdminCard — 관리자 인증 요구', () => {
  it('Firebase 관리자 인증이 없으면 승인 화면 대신 로그인 안내를 보여준다', () => {
    render(<DeviceLinkAdminCard />)

    expect(screen.getByText(/관리자 로그인이 필요합니다/)).toBeInTheDocument()
    // PIN만으로는 요청 목록 조회조차 하지 않는다
    expect(fetchPendingRequestsMock).not.toHaveBeenCalled()
  })

  it('관리자 번호(PIN)만으로는 승인할 수 없다는 것을 안내한다', () => {
    render(<DeviceLinkAdminCard />)
    expect(screen.getByText(/관리자 번호\(PIN\)만으로는 승인할 수 없습니다/)).toBeInTheDocument()
  })

  it('Firebase 관리자면 요청 목록을 불러온다', async () => {
    asAuthorizedAdmin()
    render(<DeviceLinkAdminCard />)

    await waitFor(() => expect(fetchPendingRequestsMock).toHaveBeenCalled())
    expect(fetchMemberLinksMock).toHaveBeenCalled()
  })
})

describe('DeviceLinkAdminCard — 승인 / 거절', () => {
  const oneRequest = [{ firebaseUid: 'uid-phone', request: { memberId: 'm1', requestedAt: '2026-08-24T01:00:00.000Z' } }]

  it('요청한 회원 이름과 요청 시각을 보여준다', async () => {
    asAuthorizedAdmin()
    fetchPendingRequestsMock.mockResolvedValue(oneRequest)
    render(<DeviceLinkAdminCard />)

    await waitFor(() => expect(screen.getByText('테스트회원A')).toBeInTheDocument())
    expect(screen.getByText(/요청 시각/)).toBeInTheDocument()
  })

  it('승인하면 그 회원 ID와 관리자 UID로 연결을 만든다', async () => {
    asAuthorizedAdmin()
    fetchPendingRequestsMock.mockResolvedValue(oneRequest)
    render(<DeviceLinkAdminCard />)
    await waitFor(() => expect(screen.getByRole('button', { name: '승인' })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '승인' }))
    await waitFor(() => expect(approveLinkRequestMock).toHaveBeenCalledWith('uid-phone', 'm1', 'admin-uid'))
  })

  it('거절하면 확인 후 요청만 지우고 연결은 만들지 않는다', async () => {
    asAuthorizedAdmin()
    fetchPendingRequestsMock.mockResolvedValue(oneRequest)
    render(<DeviceLinkAdminCard />)
    await waitFor(() => expect(screen.getByRole('button', { name: '거절' })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '거절' }))
    await waitFor(() => expect(rejectLinkRequestMock).toHaveBeenCalledWith('uid-phone'))
    expect(approveLinkRequestMock).not.toHaveBeenCalled()
  })

  it('대기 중인 요청이 없으면 그렇게 안내한다', async () => {
    asAuthorizedAdmin()
    render(<DeviceLinkAdminCard />)
    await waitFor(() => expect(screen.getByText('대기 중인 연결 요청이 없습니다.')).toBeInTheDocument())
  })
})

describe('DeviceLinkAdminCard — 연결 해제 / 여러 기기', () => {
  it('연결된 기기를 확인 후 해제하면 지우지 않고 사용만 중지한다', async () => {
    asAuthorizedAdmin()
    fetchMemberLinksMock.mockResolvedValue([
      { firebaseUid: 'uid-phone', link: { memberId: 'm1', role: 'member', active: true, linkedAt: '2026-08-24T00:00:00.000Z' } },
    ])
    render(<DeviceLinkAdminCard />)
    await waitFor(() => expect(screen.getByRole('button', { name: '연결 해제' })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '연결 해제' }))
    await waitFor(() => expect(setLinkActiveMock).toHaveBeenCalledWith('uid-phone', false))
  })

  it('해제된 기기는 따로 보여주고 다시 연결할 수 있다', async () => {
    asAuthorizedAdmin()
    fetchMemberLinksMock.mockResolvedValue([
      { firebaseUid: 'uid-old', link: { memberId: 'm2', role: 'member', active: false, linkedAt: '2026-08-01T00:00:00.000Z' } },
    ])
    render(<DeviceLinkAdminCard />)
    await waitFor(() => expect(screen.getByText(/해제된 기기/)).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '다시 연결' }))
    await waitFor(() => expect(setLinkActiveMock).toHaveBeenCalledWith('uid-old', true))
  })

  it('한 회원의 기기 여러 대를 모두 보여준다', async () => {
    asAuthorizedAdmin()
    fetchMemberLinksMock.mockResolvedValue([
      { firebaseUid: 'uid-phone', link: { memberId: 'm1', role: 'member', active: true, linkedAt: '2026-08-24T00:00:00.000Z' } },
      { firebaseUid: 'uid-pc', link: { memberId: 'm1', role: 'member', active: true, linkedAt: '2026-08-24T00:00:00.000Z' } },
    ])
    render(<DeviceLinkAdminCard />)

    await waitFor(() => expect(screen.getByText('연결된 기기 (2)')).toBeInTheDocument())
    expect(screen.getAllByText('테스트회원A')).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: '연결 해제' })).toHaveLength(2)
  })
})

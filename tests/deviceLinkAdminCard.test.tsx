import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// Firebase 실제 호출부를 전부 모킹 — 실제 네트워크·운영 데이터에 접근하지 않는다.
const fetchPendingRequestsMock = vi.fn()
const fetchMemberLinksMock = vi.fn()
const approveLinkRequestMock = vi.fn()
const rejectLinkRequestMock = vi.fn()
const setLinkActiveMock = vi.fn()
const deleteMemberLinkMock = vi.fn()

vi.mock('../src/lib/memberLink', () => ({
  fetchPendingRequests: (...a: unknown[]) => fetchPendingRequestsMock(...a),
  fetchMemberLinks: (...a: unknown[]) => fetchMemberLinksMock(...a),
  approveLinkRequest: (...a: unknown[]) => approveLinkRequestMock(...a),
  rejectLinkRequest: (...a: unknown[]) => rejectLinkRequestMock(...a),
  setLinkActive: (...a: unknown[]) => setLinkActiveMock(...a),
  deleteMemberLink: (...a: unknown[]) => deleteMemberLinkMock(...a),
}))
vi.mock('../src/lib/adminAuth', () => ({
  adminSignIn: vi.fn(), adminSignOut: vi.fn(),
  subscribeAuthState: () => () => {},
  fetchAdminDoc: vi.fn(),
}))

import { DeviceLinkAdminCard } from '../src/components/memberLink/DeviceLinkAdminCard'
import { useAdminAuthStore } from '../src/store/adminAuthStore'
import { useApp } from '../src/store/appStore'
import { deviceCode } from '../src/lib/deviceCode'
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
  deleteMemberLinkMock.mockReset(); deleteMemberLinkMock.mockResolvedValue(undefined)
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
  it('연결 해제를 누르면 그 기기의 memberLinks 문서를 완전히 삭제한다', async () => {
    asAuthorizedAdmin()
    fetchMemberLinksMock.mockResolvedValue([
      { firebaseUid: 'uid-phone', link: { memberId: 'm1', role: 'member', active: true, linkedAt: '2026-08-24T00:00:00.000Z' } },
    ])
    render(<DeviceLinkAdminCard />)
    await waitFor(() => expect(screen.getByRole('button', { name: '연결 해제' })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '연결 해제' }))

    await waitFor(() => expect(deleteMemberLinkMock).toHaveBeenCalledWith('uid-phone'))
    expect(deleteMemberLinkMock).toHaveBeenCalledTimes(1)
    // active:false 상태를 새로 만들지 않는다 — 해제 이력을 남기지 않는 운영 방식
    expect(setLinkActiveMock).not.toHaveBeenCalled()
  })

  it('해제 확인창에 회원명과 기기 코드를 보여준다', async () => {
    asAuthorizedAdmin()
    const uid = 'aBcD1234efgh5678'
    fetchMemberLinksMock.mockResolvedValue([
      { firebaseUid: uid, link: { memberId: 'm1', role: 'member', active: true, linkedAt: '2026-08-24T00:00:00.000Z' } },
    ])
    render(<DeviceLinkAdminCard />)
    await waitFor(() => expect(screen.getByRole('button', { name: '연결 해제' })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '연결 해제' }))

    const message = String((window.confirm as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0])
    expect(message).toContain('테스트회원A')
    expect(message).toContain(deviceCode(uid))
    expect(message).not.toContain(uid) // 전체 UID는 노출하지 않는다
  })

  it('확인창에서 취소하면 아무것도 삭제하지 않는다', async () => {
    asAuthorizedAdmin()
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    fetchMemberLinksMock.mockResolvedValue([
      { firebaseUid: 'uid-phone', link: { memberId: 'm1', role: 'member', active: true, linkedAt: '2026-08-24T00:00:00.000Z' } },
    ])
    render(<DeviceLinkAdminCard />)
    await waitFor(() => expect(screen.getByRole('button', { name: '연결 해제' })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '연결 해제' }))

    expect(deleteMemberLinkMock).not.toHaveBeenCalled()
  })

  it('여러 기기 중 누른 기기 1건만 삭제하고 다른 기기는 건드리지 않는다', async () => {
    asAuthorizedAdmin()
    fetchMemberLinksMock.mockResolvedValue([
      { firebaseUid: 'uid-keep-me-1111', link: { memberId: 'm1', role: 'member', active: true, linkedAt: '2026-08-24T00:00:00.000Z' } },
      { firebaseUid: 'uid-drop-me-2222', link: { memberId: 'm2', role: 'member', active: true, linkedAt: '2026-08-24T00:00:00.000Z' } },
    ])
    render(<DeviceLinkAdminCard />)
    await waitFor(() => expect(screen.getAllByRole('button', { name: '연결 해제' })).toHaveLength(2))

    fireEvent.click(screen.getAllByRole('button', { name: '연결 해제' })[1])

    await waitFor(() => expect(deleteMemberLinkMock).toHaveBeenCalledWith('uid-drop-me-2222'))
    expect(deleteMemberLinkMock).toHaveBeenCalledTimes(1)
    expect(deleteMemberLinkMock).not.toHaveBeenCalledWith('uid-keep-me-1111')
  })

  it('"해제된 기기" 목록과 "다시 연결" 버튼이 더 이상 없다', async () => {
    asAuthorizedAdmin()
    fetchMemberLinksMock.mockResolvedValue([
      { firebaseUid: 'uid-old', link: { memberId: 'm2', role: 'member', active: false, linkedAt: '2026-08-01T00:00:00.000Z' } },
    ])
    render(<DeviceLinkAdminCard />)
    await waitFor(() => expect(screen.getByText(/연결된 기기/)).toBeInTheDocument())

    expect(screen.queryByText(/해제된 기기/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '다시 연결' })).not.toBeInTheDocument()
  })

  it('예전 방식으로 active:false로 남아 있던 기록도 목록에서 지울 수 있다', async () => {
    asAuthorizedAdmin()
    fetchMemberLinksMock.mockResolvedValue([
      { firebaseUid: 'uid-old', link: { memberId: 'm2', role: 'member', active: false, linkedAt: '2026-08-01T00:00:00.000Z' } },
    ])
    render(<DeviceLinkAdminCard />)
    await waitFor(() => expect(screen.getByText(/이전 방식으로 해제된 기록/)).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '연결 해제' }))
    await waitFor(() => expect(deleteMemberLinkMock).toHaveBeenCalledWith('uid-old'))
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

describe('DeviceLinkAdminCard — 기기 코드 표시(연결 진단용)', () => {
  // 아래 UID는 전부 테스트용 가상 값이며 실제 기기 인증 정보가 아니다.
  const LONG_UID = 'ABcd1234efgh5678ijkl'

  it('대기 중인 요청 옆에 그 기기의 코드(UID 앞 8자리)를 보여준다', async () => {
    asAuthorizedAdmin()
    fetchPendingRequestsMock.mockResolvedValue([
      { firebaseUid: LONG_UID, request: { memberId: 'm1', requestedAt: '2026-08-24T01:00:00.000Z' } },
    ])
    render(<DeviceLinkAdminCard />)

    await waitFor(() => expect(screen.getByText(/기기 코드:/)).toBeInTheDocument())
    expect(screen.getByText(deviceCode(LONG_UID))).toBeInTheDocument()
    // 전체 UID는 절대 화면에 나오지 않는다
    expect(document.body.textContent).not.toContain(LONG_UID)
  })

  it('연결된 기기 목록에도 같은 방식으로 기기 코드를 보여준다', async () => {
    asAuthorizedAdmin()
    fetchMemberLinksMock.mockResolvedValue([
      { firebaseUid: LONG_UID, link: { memberId: 'm1', role: 'member', active: true, linkedAt: '2026-08-24T00:00:00.000Z' } },
    ])
    render(<DeviceLinkAdminCard />)

    await waitFor(() => expect(screen.getByText('연결된 기기 (1)')).toBeInTheDocument())
    expect(screen.getByText(deviceCode(LONG_UID))).toBeInTheDocument()
    expect(document.body.textContent).not.toContain(LONG_UID)
  })

  it('같은 회원이 여러 기기에서 요청해도 기기 코드로 서로 구분된다', async () => {
    asAuthorizedAdmin()
    const uidA = 'aaaa1111bbbb2222'
    const uidB = 'cccc3333dddd4444'
    fetchPendingRequestsMock.mockResolvedValue([
      { firebaseUid: uidA, request: { memberId: 'm1', requestedAt: '2026-08-24T01:00:00.000Z' } },
      { firebaseUid: uidB, request: { memberId: 'm1', requestedAt: '2026-08-24T02:00:00.000Z' } },
    ])
    render(<DeviceLinkAdminCard />)

    await waitFor(() => expect(screen.getAllByText(/기기 코드:/)).toHaveLength(2))
    expect(screen.getByText(deviceCode(uidA))).toBeInTheDocument()
    expect(screen.getByText(deviceCode(uidB))).toBeInTheDocument()
    expect(deviceCode(uidA)).not.toBe(deviceCode(uidB))
  })

  it('기기 코드가 연결 확인용 표시라는 안내를 보여준다', async () => {
    asAuthorizedAdmin()
    render(<DeviceLinkAdminCard />)
    await waitFor(() => expect(screen.getByText(/연결 확인용 표시입니다/)).toBeInTheDocument())
  })
})

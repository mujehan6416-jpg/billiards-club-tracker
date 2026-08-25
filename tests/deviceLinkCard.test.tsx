import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// Firebase 실제 호출부를 전부 모킹 — 실제 네트워크·운영 데이터에 접근하지 않는다.
const currentAuthUidMock = vi.fn()
const fetchMyLinkMock = vi.fn()
const fetchMyRequestMock = vi.fn()
const createLinkRequestMock = vi.fn()
const cancelMyRequestMock = vi.fn()

vi.mock('../src/lib/appAuth', () => ({
  currentAuthUid: () => currentAuthUidMock(),
  ensureAppAuth: vi.fn(),
  keepAppAuthAlive: vi.fn(() => () => {}),
}))
vi.mock('../src/lib/memberLink', () => ({
  fetchMyLink: (...a: unknown[]) => fetchMyLinkMock(...a),
  fetchMyRequest: (...a: unknown[]) => fetchMyRequestMock(...a),
  createLinkRequest: (...a: unknown[]) => createLinkRequestMock(...a),
  cancelMyRequest: (...a: unknown[]) => cancelMyRequestMock(...a),
}))

import { DeviceLinkCard } from '../src/components/memberLink/DeviceLinkCard'
import { useAuth } from '../src/store/authStore'

// 아래 이름·ID는 전부 테스트용 가상 데이터이며 실제 회원 정보가 아니다.
const MEMBER_ID = 'member-abc'
const UID = 'anon-uid-1'

beforeEach(() => {
  currentAuthUidMock.mockReset(); currentAuthUidMock.mockReturnValue(UID)
  fetchMyLinkMock.mockReset(); fetchMyLinkMock.mockResolvedValue(null)
  fetchMyRequestMock.mockReset(); fetchMyRequestMock.mockResolvedValue(null)
  createLinkRequestMock.mockReset(); createLinkRequestMock.mockResolvedValue(undefined)
  cancelMyRequestMock.mockReset(); cancelMyRequestMock.mockResolvedValue(undefined)
  useAuth.setState({ memberId: MEMBER_ID, memberName: '테스트회원A', isGuest: false })
})

describe('DeviceLinkCard — 회원용 기기 연결', () => {
  it('아직 연결·요청이 없으면 연결 요청 버튼을 보여준다', async () => {
    render(<DeviceLinkCard />)
    await waitFor(() => expect(screen.getByRole('button', { name: '이 기기 연결 요청' })).toBeInTheDocument())
  })

  it('연결 요청을 보내면 로그인한 회원 ID로 요청하고 승인 대기로 바뀐다', async () => {
    render(<DeviceLinkCard />)
    await waitFor(() => expect(screen.getByRole('button', { name: '이 기기 연결 요청' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '이 기기 연결 요청' }))

    await waitFor(() => expect(screen.getByText(/관리자 승인 대기 중/)).toBeInTheDocument())
    expect(createLinkRequestMock).toHaveBeenCalledWith(UID, MEMBER_ID)
  })

  it('이미 요청이 있으면 다시 요청하지 않고 승인 대기로 보여준다', async () => {
    fetchMyRequestMock.mockResolvedValue({ memberId: MEMBER_ID, requestedAt: '2026-08-24T00:00:00.000Z' })
    render(<DeviceLinkCard />)

    await waitFor(() => expect(screen.getByText(/관리자 승인 대기 중/)).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: '이 기기 연결 요청' })).not.toBeInTheDocument()
    expect(createLinkRequestMock).not.toHaveBeenCalled()
  })

  it('이미 연결된 기기는 연결됨으로 표시하고 요청 버튼을 보여주지 않는다', async () => {
    fetchMyLinkMock.mockResolvedValue({ memberId: MEMBER_ID, role: 'member', active: true, linkedAt: 'x' })
    render(<DeviceLinkCard />)

    await waitFor(() => expect(screen.getByText(/연결되어 있습니다/)).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: '이 기기 연결 요청' })).not.toBeInTheDocument()
    // 연결된 기기는 요청 문서를 조회할 필요도 없다
    expect(fetchMyRequestMock).not.toHaveBeenCalled()
  })

  it('연결이 해제된 기기는 관리자 문의 안내를 보여준다', async () => {
    fetchMyLinkMock.mockResolvedValue({ memberId: MEMBER_ID, role: 'member', active: false, linkedAt: 'x' })
    render(<DeviceLinkCard />)

    await waitFor(() => expect(screen.getByText(/연결이 해제된 상태/)).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: '이 기기 연결 요청' })).not.toBeInTheDocument()
  })

  it('요청을 취소하면 다시 요청할 수 있는 상태로 돌아간다', async () => {
    fetchMyRequestMock.mockResolvedValue({ memberId: MEMBER_ID, requestedAt: 'x' })
    render(<DeviceLinkCard />)
    await waitFor(() => expect(screen.getByRole('button', { name: '요청 취소' })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '요청 취소' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '이 기기 연결 요청' })).toBeInTheDocument())
    expect(cancelMyRequestMock).toHaveBeenCalledWith(UID)
  })

  it('요청이 실패하면 쉬운 말로 안내하고 기술 용어를 노출하지 않는다', async () => {
    createLinkRequestMock.mockRejectedValue(new Error('permission-denied'))
    render(<DeviceLinkCard />)
    await waitFor(() => expect(screen.getByRole('button', { name: '이 기기 연결 요청' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '이 기기 연결 요청' }))

    await waitFor(() => expect(screen.getByText(/연결 요청을 보내지 못했습니다/)).toBeInTheDocument())
    expect(screen.queryByText(/permission-denied|Firebase|Firestore/i)).not.toBeInTheDocument()
  })

  it('GUEST에게는 카드를 보여주지 않는다', async () => {
    useAuth.setState({ memberId: '__guest__', memberName: 'GUEST', isGuest: true })
    const { container } = render(<DeviceLinkCard />)
    await waitFor(() => expect(container).toBeEmptyDOMElement())
    expect(fetchMyLinkMock).not.toHaveBeenCalled()
  })

  it('관리자 PIN 모드(__admin__)는 실제 회원이 아니므로 연결 대상이 아니다', async () => {
    useAuth.setState({ memberId: '__admin__', memberName: '관리자', isGuest: false })
    const { container } = render(<DeviceLinkCard />)
    await waitFor(() => expect(container).toBeEmptyDOMElement())
    expect(fetchMyLinkMock).not.toHaveBeenCalled()
  })

  it('아직 서버 인증이 없으면(UID 없음) 카드를 보여주지 않는다', async () => {
    currentAuthUidMock.mockReturnValue(null)
    const { container } = render(<DeviceLinkCard />)
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })
})

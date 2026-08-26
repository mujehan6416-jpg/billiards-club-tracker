import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// 실제 Firebase에는 접근하지 않는다 — memberIndex 조회·연결 요청을 전부 모킹한다.
const fetchMemberIndexMock = vi.fn()
const fetchMyRequestMock = vi.fn()
const createLinkRequestMock = vi.fn()
const cancelMyRequestMock = vi.fn()
const currentAuthUidMock = vi.fn()

vi.mock('../src/lib/splitFirestore', () => ({
  fetchMemberIndex: (...a: unknown[]) => fetchMemberIndexMock(...a),
}))
vi.mock('../src/lib/memberLink', () => ({
  fetchMyRequest: (...a: unknown[]) => fetchMyRequestMock(...a),
  createLinkRequest: (...a: unknown[]) => createLinkRequestMock(...a),
  cancelMyRequest: (...a: unknown[]) => cancelMyRequestMock(...a),
}))
vi.mock('../src/lib/appAuth', () => ({
  currentAuthUid: (...a: unknown[]) => currentAuthUidMock(...a),
}))

import { DeviceConnectScreen } from '../src/tabs/DeviceConnectScreen'
import type { MemberIndexEntry } from '../src/types/splitFirestore'

// 아래 이름·ID는 전부 테스트용 가상 데이터이며 실제 회원 정보가 아니다.
const index: MemberIndexEntry[] = [
  { id: 'm1', name: '테스트회원A', active: true },
  { id: 'm2', name: '테스트회원B', active: true },
  { id: 'm3', name: '탈퇴회원C', active: false },
]

beforeEach(() => {
  fetchMemberIndexMock.mockReset()
  fetchMyRequestMock.mockReset(); fetchMyRequestMock.mockResolvedValue(null)
  createLinkRequestMock.mockReset(); createLinkRequestMock.mockResolvedValue(undefined)
  cancelMyRequestMock.mockReset(); cancelMyRequestMock.mockResolvedValue(undefined)
  currentAuthUidMock.mockReset(); currentAuthUidMock.mockReturnValue('uid-new-device')
})

describe('DeviceConnectScreen — 이름 목록이 비어 있을 때', () => {
  it('목록 조회는 성공했지만 0건이면 빈 선택칸 대신 이유를 안내한다', async () => {
    // 운영 memberIndex가 아직 만들어지지 않은 상태(iPad에서 이름이 안 뜨던 실제 증상).
    fetchMemberIndexMock.mockResolvedValue([])
    render(<DeviceConnectScreen onRetry={() => {}} />)

    await waitFor(() => expect(screen.getByText(/회원 이름 목록이 아직 준비되지 않았습니다/)).toBeInTheDocument())
    expect(screen.getByText(/이름 목록 만들기/)).toBeInTheDocument()
    // 고를 것이 없는 빈 선택칸을 보여주지 않는다
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '이 기기 연결 요청' })).not.toBeInTheDocument()
  })

  it('활성 회원이 하나도 없을 때도(전원 비활성) 같은 안내를 보여준다', async () => {
    fetchMemberIndexMock.mockResolvedValue([{ id: 'm3', name: '탈퇴회원C', active: false }])
    render(<DeviceConnectScreen onRetry={() => {}} />)

    await waitFor(() => expect(screen.getByText(/회원 이름 목록이 아직 준비되지 않았습니다/)).toBeInTheDocument())
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('"다시 확인"을 누르면 목록을 다시 불러온다 — 관리자가 만든 직후 바로 확인할 수 있다', async () => {
    fetchMemberIndexMock.mockResolvedValueOnce([])
    render(<DeviceConnectScreen onRetry={() => {}} />)
    await waitFor(() => expect(screen.getByText(/회원 이름 목록이 아직 준비되지 않았습니다/)).toBeInTheDocument())

    fetchMemberIndexMock.mockResolvedValue(index) // 관리자가 그 사이 이름 목록을 만들었다
    fireEvent.click(screen.getByRole('button', { name: '다시 확인' }))

    await waitFor(() => expect(screen.getByRole('combobox')).toBeInTheDocument())
    expect(screen.getByRole('option', { name: '테스트회원A' })).toBeInTheDocument()
  })

  it('조회 자체가 실패한 경우는 빈 목록 안내가 아니라 기존 오류 안내를 보여준다', async () => {
    fetchMemberIndexMock.mockRejectedValue(new Error('offline'))
    render(<DeviceConnectScreen onRetry={() => {}} />)

    await waitFor(() => expect(screen.getByText(/회원 목록을 불러오지 못했습니다/)).toBeInTheDocument())
    expect(screen.queryByText(/회원 이름 목록이 아직 준비되지 않았습니다/)).not.toBeInTheDocument()
  })
})

describe('DeviceConnectScreen — 이름 목록이 있을 때(기존 동작 유지)', () => {
  it('활성 회원만 고를 수 있게 보여준다', async () => {
    fetchMemberIndexMock.mockResolvedValue(index)
    render(<DeviceConnectScreen onRetry={() => {}} />)

    await waitFor(() => expect(screen.getByRole('combobox')).toBeInTheDocument())
    expect(screen.getByRole('option', { name: '테스트회원A' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '테스트회원B' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: '탈퇴회원C' })).not.toBeInTheDocument()
    expect(screen.queryByText(/회원 이름 목록이 아직 준비되지 않았습니다/)).not.toBeInTheDocument()
  })

  it('이름을 고르고 연결을 요청하면 요청 완료 화면으로 넘어간다', async () => {
    fetchMemberIndexMock.mockResolvedValue(index)
    render(<DeviceConnectScreen onRetry={() => {}} />)
    await waitFor(() => expect(screen.getByRole('combobox')).toBeInTheDocument())

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'm1' } })
    fireEvent.click(screen.getByRole('button', { name: '이 기기 연결 요청' }))

    await waitFor(() => expect(screen.getByText(/연결을 요청했습니다/)).toBeInTheDocument())
    expect(createLinkRequestMock).toHaveBeenCalledWith('uid-new-device', 'm1')
  })
})

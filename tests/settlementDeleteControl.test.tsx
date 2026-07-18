import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// settlementSync(Firestore 실제 호출부)를 통째로 모킹 — 실제 Firebase에 절대 접근하지 않는다.
const deleteSettlementMock = vi.fn()
vi.mock('../src/lib/settlementSync', () => ({
  saveSettlement: vi.fn(),
  listSettlements: vi.fn(),
  getSettlement: vi.fn(),
  deleteSettlement: (...args: unknown[]) => deleteSettlementMock(...args),
}))

import { SettlementDeleteControl } from '../src/components/settlement/SettlementDeleteControl'
import { useSettlementStore } from '../src/store/settlementStore'
import { useAdminAuthStore } from '../src/store/adminAuthStore'
import { useAdmin } from '../src/store/adminStore'
import type { RegularSettlement } from '../src/types/settlement'

// 아래 이름·ID·금액은 전부 테스트용 가상 데이터이며 실제 회원 정보가 아니다.
const REAL_PIN = '1234' // adminStore.ts 기본값(가상 테스트 전용 — 실제 운영 관리자 번호가 아님)

function fakeSettlement(overrides: Partial<RegularSettlement> = {}): RegularSettlement {
  return {
    id: 'settle-del-1',
    meetingName: '가상 27차 정기모임',
    meetingDate: '2026-07-15',
    meetingType: 'regular',
    status: 'cancelled',
    participants: [],
    expenses: [],
    dinnerContributions: [],
    cashDeposits: [],
    prevBankBalance: 0,
    otherBankAdjustment: 0,
    createdAt: '2026-07-15T00:00:00.000Z',
    version: 1,
    revisionLog: [],
    ...overrides,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let confirmSpy: any

beforeEach(() => {
  localStorage.removeItem('billiards-admin-pin')
  useAdmin.setState({ isAdmin: true })
  useSettlementStore.setState({ settlements: [fakeSettlement()], currentId: 'settle-del-1', syncStatus: 'idle', lastSyncError: null })
  useAdminAuthStore.setState({ status: 'authorizedAdmin', uid: 'fake-admin-uid', email: 'fake-admin@example.test', adminDisplayName: '가상관리자', errorMessage: null })
  deleteSettlementMock.mockReset()
  confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
})

afterEach(() => {
  confirmSpy.mockRestore()
})

describe('삭제 대상 표시 및 1단계 경고', () => {
  it('선택한 정산의 제목·날짜·상태를 화면에 표시한다', () => {
    render(<SettlementDeleteControl settlement={fakeSettlement()} />)
    expect(screen.getByText(/2026-07-15 가상 27차 정기모임 \(cancelled\)/)).toBeInTheDocument()
  })

  it('삭제 버튼 클릭 시 확인 문구와 함께 window.confirm을 띄운다', () => {
    render(<SettlementDeleteControl settlement={fakeSettlement()} />)
    fireEvent.click(screen.getByText('정산 삭제'))
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    const message = confirmSpy.mock.calls[0][0] as string
    expect(message).toContain('정말 삭제하시겠습니까?')
    expect(message).toContain('2026-07-15 가상 27차 정기모임 (cancelled)')
    expect(message).toContain('복구할 수 없습니다')
  })

  it('1단계에서 취소(confirm=false)하면 관리자 번호 입력 화면으로 넘어가지 않고 삭제 액션도 호출되지 않는다', () => {
    confirmSpy.mockReturnValue(false)
    render(<SettlementDeleteControl settlement={fakeSettlement()} />)
    fireEvent.click(screen.getByText('정산 삭제'))
    expect(screen.queryByPlaceholderText('관리자 번호')).not.toBeInTheDocument()
    expect(deleteSettlementMock).not.toHaveBeenCalled()
  })

  it('1단계에서 계속(confirm=true)하면 관리자 번호 입력 화면(비밀번호 형식)이 나타난다', () => {
    render(<SettlementDeleteControl settlement={fakeSettlement()} />)
    fireEvent.click(screen.getByText('정산 삭제'))
    const pinInput = screen.getByPlaceholderText('관리자 번호')
    expect(pinInput).toBeInTheDocument()
    expect(pinInput).toHaveAttribute('type', 'password')
  })
})

describe('2단계 관리자 번호 재확인', () => {
  it('잘못된 관리자 번호를 입력하면 삭제 액션이 호출되지 않고 오류가 표시된다', async () => {
    render(<SettlementDeleteControl settlement={fakeSettlement()} />)
    fireEvent.click(screen.getByText('정산 삭제'))
    fireEvent.change(screen.getByPlaceholderText('관리자 번호'), { target: { value: '0000' } })
    fireEvent.click(screen.getByText('정산 영구 삭제'))

    expect(await screen.findByText('관리자 번호가 일치하지 않습니다.')).toBeInTheDocument()
    expect(deleteSettlementMock).not.toHaveBeenCalled()
    expect(useSettlementStore.getState().getById('settle-del-1')).toBeDefined()
  })

  it('올바른 관리자 번호를 입력하면 정확한 settlementId로 삭제 액션이 호출된다', async () => {
    deleteSettlementMock.mockResolvedValue(undefined)
    render(<SettlementDeleteControl settlement={fakeSettlement()} />)
    fireEvent.click(screen.getByText('정산 삭제'))
    fireEvent.change(screen.getByPlaceholderText('관리자 번호'), { target: { value: REAL_PIN } })
    fireEvent.click(screen.getByText('정산 영구 삭제'))

    await waitFor(() => expect(deleteSettlementMock).toHaveBeenCalledWith('settle-del-1'))
  })

  it('취소를 누르면 관리자 번호 입력 화면이 닫히고 삭제 액션이 호출되지 않는다', () => {
    render(<SettlementDeleteControl settlement={fakeSettlement()} />)
    fireEvent.click(screen.getByText('정산 삭제'))
    fireEvent.change(screen.getByPlaceholderText('관리자 번호'), { target: { value: '9999' } })
    fireEvent.click(screen.getByText('취소'))

    expect(screen.queryByPlaceholderText('관리자 번호')).not.toBeInTheDocument()
    expect(deleteSettlementMock).not.toHaveBeenCalled()
  })
})

describe('삭제 성공', () => {
  it('삭제 성공 시 성공 메시지를 표시하고 store에서 해당 정산이 제거된다', async () => {
    deleteSettlementMock.mockResolvedValue(undefined)
    render(<SettlementDeleteControl settlement={fakeSettlement()} />)
    fireEvent.click(screen.getByText('정산 삭제'))
    fireEvent.change(screen.getByPlaceholderText('관리자 번호'), { target: { value: REAL_PIN } })
    fireEvent.click(screen.getByText('정산 영구 삭제'))

    expect(await screen.findByText('정산이 삭제되었습니다.')).toBeInTheDocument()
    expect(useSettlementStore.getState().getById('settle-del-1')).toBeUndefined()
    expect(useSettlementStore.getState().currentId).toBeNull()
  })

  it('삭제 중에는 버튼이 비활성화되어 중복 클릭을 막는다', async () => {
    let resolveDelete: () => void
    deleteSettlementMock.mockImplementation(() => new Promise<void>((resolve) => { resolveDelete = resolve }))
    render(<SettlementDeleteControl settlement={fakeSettlement()} />)
    fireEvent.click(screen.getByText('정산 삭제'))
    fireEvent.change(screen.getByPlaceholderText('관리자 번호'), { target: { value: REAL_PIN } })
    fireEvent.click(screen.getByText('정산 영구 삭제'))

    await waitFor(() => expect(screen.getByText('삭제 중...')).toBeDisabled())
    resolveDelete!()
    await waitFor(() => expect(deleteSettlementMock).toHaveBeenCalledTimes(1))
  })
})

describe('삭제 실패', () => {
  it('Firestore 삭제가 실패하면 목록에서 제거되지 않고 오류가 표시되며 성공 메시지는 뜨지 않는다', async () => {
    deleteSettlementMock.mockRejectedValue(new Error('가상 네트워크 오류'))
    render(<SettlementDeleteControl settlement={fakeSettlement()} />)
    fireEvent.click(screen.getByText('정산 삭제'))
    fireEvent.change(screen.getByPlaceholderText('관리자 번호'), { target: { value: REAL_PIN } })
    fireEvent.click(screen.getByText('정산 영구 삭제'))

    expect(await screen.findByText(/가상 네트워크 오류/)).toBeInTheDocument()
    expect(screen.queryByText('정산이 삭제되었습니다.')).not.toBeInTheDocument()
    expect(useSettlementStore.getState().getById('settle-del-1')).toBeDefined()
    expect(useSettlementStore.getState().currentId).toBe('settle-del-1')
  })
})

describe('previewMode(개발 미리보기)', () => {
  it('삭제 버튼을 눌러도 window.confirm이 뜨지 않고 차단 안내만 표시되며 삭제 액션은 호출되지 않는다', () => {
    render(<SettlementDeleteControl settlement={fakeSettlement()} previewMode />)
    fireEvent.click(screen.getByText('정산 삭제'))

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(screen.getByText('개발 미리보기에서는 정산을 삭제할 수 없습니다.')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('관리자 번호')).not.toBeInTheDocument()
    expect(deleteSettlementMock).not.toHaveBeenCalled()
  })
})

describe('상태별 삭제', () => {
  it.each(['draft', 'confirmed', 'cancelled', 'revised'] as const)('%s 상태의 정산도 삭제 액션을 호출할 수 있다', async (status) => {
    deleteSettlementMock.mockResolvedValue(undefined)
    const settlement = fakeSettlement({ status })
    useSettlementStore.setState({ settlements: [settlement], currentId: settlement.id })
    render(<SettlementDeleteControl settlement={settlement} />)
    fireEvent.click(screen.getByText('정산 삭제'))
    fireEvent.change(screen.getByPlaceholderText('관리자 번호'), { target: { value: REAL_PIN } })
    fireEvent.click(screen.getByText('정산 영구 삭제'))

    await waitFor(() => expect(deleteSettlementMock).toHaveBeenCalledWith(settlement.id))
  })
})

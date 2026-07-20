import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// settlementSync(Firestore 실제 호출부)를 통째로 모킹 — 실제 Firebase에 절대 접근하지 않는다.
const saveSettlementMock = vi.fn()
vi.mock('../src/lib/settlementSync', () => ({
  saveSettlement: (...args: unknown[]) => saveSettlementMock(...args),
  listSettlements: vi.fn(),
  getSettlement: vi.fn(),
}))

import { CashDepositForm } from '../src/components/settlement/CashDepositForm'
import { useSettlementStore } from '../src/store/settlementStore'
import { useAdminAuthStore } from '../src/store/adminAuthStore'
import type { RegularSettlement } from '../src/types/settlement'

// 아래 이름·ID·금액은 전부 테스트용 가상 데이터이며 실제 회원 정보가 아니다.

function fakeSettlement(overrides: Partial<RegularSettlement> = {}): RegularSettlement {
  return {
    id: 'settle-cash-1',
    meetingName: '가상 정기모임',
    meetingDate: '2026-01-10',
    meetingType: 'regular',
    status: 'draft',
    // 현금 회비 입금확인 500,000원을 넣어 현금 잔액을 확보 — validateCashDeposit이 "입금 전 현금 잔액"을
    // 넘는 입금확인 금액을 막으므로, 테스트에서 실제 입금액(최대 150,000원)을 넣을 수 있으려면 필요하다.
    participants: [
      { id: 'p1', participantType: 'guest', memberId: null, displayName: '가상참가자', addedVia: 'manually_added_guest', dues: { amount: 500000, method: '현금', status: '입금확인' } },
    ],
    expenses: [],
    dinnerContributions: [],
    cashDeposits: [],
    prevBankBalance: 0,
    otherBankAdjustment: 0,
    createdAt: '2026-01-10T00:00:00.000Z',
    version: 0,
    revisionLog: [],
    ...overrides,
  }
}

beforeEach(() => {
  useSettlementStore.setState({ settlements: [fakeSettlement()], currentId: 'settle-cash-1', syncStatus: 'idle', lastSyncError: null })
  useAdminAuthStore.setState({ status: 'authorizedAdmin', uid: 'fake-admin-uid', email: 'fake-admin@example.test', adminDisplayName: '가상관리자', errorMessage: null })
  saveSettlementMock.mockReset()
  saveSettlementMock.mockResolvedValue(1)
})

describe('[재현] CashDepositForm — 버그 당시엔 이 탭에 저장 버튼 자체가 없었다', () => {
  it('현금입금 탭에 "임시저장" 버튼이 보인다', () => {
    render(<CashDepositForm settlementId="settle-cash-1" />)
    expect(screen.getByText('임시저장')).toBeInTheDocument()
  })

  it('입금 내역을 추가한 뒤 임시저장을 누르면 그 내역이 포함된 settlement가 Firestore 저장 함수에 전달된다', async () => {
    render(<CashDepositForm settlementId="settle-cash-1" />)
    fireEvent.change(screen.getByPlaceholderText('입금액'), { target: { value: '150000' } })
    fireEvent.click(screen.getByText('입금 추가'))

    fireEvent.click(screen.getByText('임시저장'))
    await waitFor(() => expect(saveSettlementMock).toHaveBeenCalledTimes(1))
    const payload = saveSettlementMock.mock.calls[0][0]
    expect(payload.cashDeposits).toHaveLength(1)
    expect(payload.cashDeposits[0]).toMatchObject({ amount: 150000, status: '입금확인' })
  })

  it('임시저장은 상태를 draft로 유지한다(최종 게시를 눌러야 confirmed)', async () => {
    render(<CashDepositForm settlementId="settle-cash-1" />)
    fireEvent.change(screen.getByPlaceholderText('입금액'), { target: { value: '50000' } })
    fireEvent.click(screen.getByText('입금 추가'))
    fireEvent.click(screen.getByText('임시저장'))
    await waitFor(() => expect(saveSettlementMock).toHaveBeenCalledTimes(1))
    expect(saveSettlementMock.mock.calls[0][0].status).toBe('draft')
    expect(useSettlementStore.getState().getById('settle-cash-1')!.status).toBe('draft')
  })

  it('임시저장 후 store를 초기화(재로그인 재현)하고 Firestore 조회 결과를 반영하면 입금 내역이 그대로 복원된다', async () => {
    render(<CashDepositForm settlementId="settle-cash-1" />)
    fireEvent.change(screen.getByPlaceholderText('입금액'), { target: { value: '80000' } })
    fireEvent.click(screen.getByText('입금 추가'))
    fireEvent.click(screen.getByText('임시저장'))
    await waitFor(() => expect(saveSettlementMock).toHaveBeenCalledTimes(1))
    const savedPayload = saveSettlementMock.mock.calls[0][0]

    useSettlementStore.setState({ settlements: [{ ...savedPayload, version: 1 }], currentId: 'settle-cash-1' })
    const restored = useSettlementStore.getState().getById('settle-cash-1')!
    expect(restored.cashDeposits).toHaveLength(1)
    expect(restored.cashDeposits[0]).toMatchObject({ amount: 80000, status: '입금확인' })
  })

  it('저장이 실패하면 입력한 값은 화면(store)에 그대로 남아있다(사라지지 않음)', async () => {
    saveSettlementMock.mockRejectedValue(new Error('가상 네트워크 오류'))
    render(<CashDepositForm settlementId="settle-cash-1" />)
    fireEvent.change(screen.getByPlaceholderText('입금액'), { target: { value: '30000' } })
    fireEvent.click(screen.getByText('입금 추가'))
    fireEvent.click(screen.getByText('임시저장'))

    await waitFor(() => expect(saveSettlementMock).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('임시저장 완료')).not.toBeInTheDocument()
    expect(useSettlementStore.getState().getById('settle-cash-1')!.cashDeposits).toHaveLength(1)
  })

  it('previewMode에서는 임시저장 버튼이 비활성화되고 saveSettlement가 호출되지 않는다', () => {
    render(<CashDepositForm settlementId="settle-cash-1" previewMode />)
    const btn = screen.getByText('임시저장')
    expect(btn).toBeDisabled()
    fireEvent.click(btn)
    expect(saveSettlementMock).not.toHaveBeenCalled()
  })

  it('저장 진행 중(syncStatus=saving)에는 임시저장 버튼이 비활성화된다(중복 저장 방지)', async () => {
    let resolveSave: (v: number) => void
    saveSettlementMock.mockImplementation(() => new Promise((resolve) => { resolveSave = resolve }))
    render(<CashDepositForm settlementId="settle-cash-1" />)
    fireEvent.click(screen.getByText('임시저장'))

    await waitFor(() => expect(useSettlementStore.getState().syncStatus).toBe('saving'))
    expect(screen.getByText('임시저장')).toBeDisabled()

    resolveSave!(1)
    await waitFor(() => expect(useSettlementStore.getState().syncStatus).toBe('idle'))
  })
})

describe('[재현 및 수정 확인] 입금액 입력칸 너비 — index.css의 input[type=number]{width:64px} 전역 규칙을 인라인으로 덮어쓴다', () => {
  it('입금액 입력칸이 지출 탭과 같은 공용 스타일(width:100%, 최소 높이 52px)을 갖는다', () => {
    render(<CashDepositForm settlementId="settle-cash-1" />)
    const input = screen.getByPlaceholderText('입금액') as HTMLInputElement
    expect(input.style.width).toBe('100%')
    expect(input.style.minHeight).toBe('52px')
  })

  it('730,700원을 입력해도 값이 잘리지 않고, 천단위 콤마가 붙어 보인다', () => {
    render(<CashDepositForm settlementId="settle-cash-1" />)
    const input = screen.getByPlaceholderText('입금액') as HTMLInputElement
    fireEvent.change(input, { target: { value: '730700' } })
    expect(input.value).toBe('730,700')
  })
})

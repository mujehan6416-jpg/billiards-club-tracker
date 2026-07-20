import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// settlementSync(Firestore 실제 호출부)를 통째로 모킹 — 실제 Firebase에 절대 접근하지 않는다.
const saveSettlementMock = vi.fn()
vi.mock('../src/lib/settlementSync', () => ({
  saveSettlement: (...args: unknown[]) => saveSettlementMock(...args),
  listSettlements: vi.fn(),
  getSettlement: vi.fn(),
}))

import { SettlementSummary } from '../src/components/settlement/SettlementSummary'
import { useSettlementStore } from '../src/store/settlementStore'
import { useAdminAuthStore } from '../src/store/adminAuthStore'
import type { RegularSettlement } from '../src/types/settlement'

// 아래 이름·ID·금액은 전부 테스트용 가상 데이터이며 실제 회원 정보가 아니다.

function fakeSettlement(overrides: Partial<RegularSettlement> = {}): RegularSettlement {
  return {
    id: 'settle-summary-1',
    meetingName: '가상 정기모임',
    meetingDate: '2026-01-10',
    meetingType: 'regular',
    status: 'draft',
    participants: [],
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let confirmSpy: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let promptSpy: any

beforeEach(() => {
  useSettlementStore.setState({ settlements: [fakeSettlement()], currentId: 'settle-summary-1', syncStatus: 'idle', lastSyncError: null })
  useAdminAuthStore.setState({ status: 'authorizedAdmin', uid: 'fake-admin-uid', email: 'fake-admin@example.test', adminDisplayName: '가상관리자', errorMessage: null })
  saveSettlementMock.mockReset()
  saveSettlementMock.mockResolvedValue(1)
  confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
  promptSpy = vi.spyOn(window, 'prompt').mockReturnValue(undefined as unknown as string)
})

afterEach(() => {
  confirmSpy.mockRestore()
  promptSpy.mockRestore()
})

describe('[재현] SettlementSummary 확정 — 버그 당시엔 로컬 상태만 바뀌고 Firestore를 호출하지 않았다', () => {
  it('draft 정산에서 "정산 확정"을 누르면 Firestore 저장 함수가 confirmed payload로 호출된다', async () => {
    render(<SettlementSummary settlementId="settle-summary-1" />)
    fireEvent.click(screen.getByText('정산 확정'))

    await waitFor(() => expect(saveSettlementMock).toHaveBeenCalledTimes(1))
    const payload = saveSettlementMock.mock.calls[0][0]
    expect(payload.status).toBe('confirmed')
    expect(await screen.findByText('확정됨')).toBeInTheDocument()
  })

  it('확정 저장 후 store를 초기화(재로그인 재현)하고 Firestore 조회 결과를 반영해도 confirmed 상태가 유지된다', async () => {
    render(<SettlementSummary settlementId="settle-summary-1" />)
    fireEvent.click(screen.getByText('정산 확정'))
    await waitFor(() => expect(saveSettlementMock).toHaveBeenCalledTimes(1))
    const savedPayload = saveSettlementMock.mock.calls[0][0]
    expect(savedPayload.status).toBe('confirmed')

    // 재로그인 재현: store를 비우고 Firestore에 저장된 내용을 그대로 다시 적재
    useSettlementStore.setState({ settlements: [{ ...savedPayload, version: 1 }], currentId: 'settle-summary-1' })

    expect(useSettlementStore.getState().getById('settle-summary-1')!.status).toBe('confirmed')
  })
})

describe('[재현] SettlementSummary 확정 취소 — 로컬 상태만 바뀌던 문제', () => {
  it('confirmed 정산에서 "정산 취소"를 누르면 Firestore 저장 함수가 cancelled payload로 호출된다', async () => {
    useSettlementStore.setState({ settlements: [fakeSettlement({ status: 'confirmed' })], currentId: 'settle-summary-1' })
    render(<SettlementSummary settlementId="settle-summary-1" />)
    fireEvent.click(screen.getByText('정산 취소'))

    await waitFor(() => expect(saveSettlementMock).toHaveBeenCalledTimes(1))
    const payload = saveSettlementMock.mock.calls[0][0]
    expect(payload.status).toBe('cancelled')
    expect(await screen.findByText('취소됨')).toBeInTheDocument()
  })

  it('취소 저장 후 store를 초기화하고 재조회해도 cancelled 상태가 유지된다', async () => {
    useSettlementStore.setState({ settlements: [fakeSettlement({ status: 'confirmed' })], currentId: 'settle-summary-1' })
    render(<SettlementSummary settlementId="settle-summary-1" />)
    fireEvent.click(screen.getByText('정산 취소'))
    await waitFor(() => expect(saveSettlementMock).toHaveBeenCalledTimes(1))
    const savedPayload = saveSettlementMock.mock.calls[0][0]

    useSettlementStore.setState({ settlements: [{ ...savedPayload, version: 1 }], currentId: 'settle-summary-1' })
    expect(useSettlementStore.getState().getById('settle-summary-1')!.status).toBe('cancelled')
  })
})

describe('저장 실패', () => {
  it('Firestore 저장이 실패하면 화면에 오류가 표시된다(성공 메시지로 남지 않음)', async () => {
    saveSettlementMock.mockRejectedValue(new Error('가상 네트워크 오류'))
    render(<SettlementSummary settlementId="settle-summary-1" />)
    fireEvent.click(screen.getByText('정산 확정'))

    await waitFor(() => expect(saveSettlementMock).toHaveBeenCalledTimes(1))
    expect(await screen.findByText(/가상 네트워크 오류/)).toBeInTheDocument()
  })
})

describe('previewMode', () => {
  it('previewMode에서는 상태 변경 버튼이 비활성화되고, 눌러도 Firestore를 호출하지 않으며 로컬 상태도 바뀌지 않는다', () => {
    render(<SettlementSummary settlementId="settle-summary-1" previewMode />)
    const btn = screen.getByText('정산 확정')
    expect(btn).toBeDisabled()
    fireEvent.click(btn)
    expect(saveSettlementMock).not.toHaveBeenCalled()
    expect(useSettlementStore.getState().getById('settle-summary-1')!.status).toBe('draft')
  })
})

describe('통장 잔액 · 기타 통장 조정액 — 천단위 콤마 표시', () => {
  it('전월 통장 잔액에 5680314를 입력하면 5,680,314로 보인다', () => {
    render(<SettlementSummary settlementId="settle-summary-1" />)
    const input = screen.getByLabelText('전월 통장 잔액') as HTMLInputElement
    fireEvent.change(input, { target: { value: '5680314' } })
    expect(input.value).toBe('5,680,314')
    expect(useSettlementStore.getState().getById('settle-summary-1')!.prevBankBalance).toBe(5680314)
  })

  it('기타 통장 조정액(±)에 -50000을 입력하면 -50,000으로 보이고, 저장값도 음수 그대로 반영된다', () => {
    render(<SettlementSummary settlementId="settle-summary-1" />)
    const input = screen.getByLabelText('기타 통장 조정액') as HTMLInputElement
    fireEvent.change(input, { target: { value: '-50000' } })
    expect(input.value).toBe('-50,000')
    expect(useSettlementStore.getState().getById('settle-summary-1')!.otherBankAdjustment).toBe(-50000)
  })
})

describe('중복 클릭 방지', () => {
  it('저장 진행 중(syncStatus=saving)에는 상태 변경 버튼이 비활성화된다', async () => {
    // 로컬 상태 전이는 pushToCloud(Firestore 저장) 이전에 동기로 먼저 반영되므로, 확정 클릭 직후
    // 화면은 이미 'confirmed' 기준 버튼("정산 수정"/"정산 취소")을 보여준다 — 그 버튼들이 저장 중 비활성화되는지 확인한다.
    let resolveSave: (v: number) => void
    saveSettlementMock.mockImplementation(() => new Promise((resolve) => { resolveSave = resolve }))
    render(<SettlementSummary settlementId="settle-summary-1" />)
    fireEvent.click(screen.getByText('정산 확정'))

    await waitFor(() => expect(useSettlementStore.getState().syncStatus).toBe('saving'))
    expect(screen.getByText('정산 수정')).toBeDisabled()
    expect(screen.getByText('정산 취소')).toBeDisabled()

    resolveSave!(1)
    await waitFor(() => expect(useSettlementStore.getState().syncStatus).toBe('idle'))
  })
})

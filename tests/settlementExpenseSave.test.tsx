import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// settlementSync(Firestore 실제 호출부)를 통째로 모킹 — 실제 Firebase에 절대 접근하지 않는다.
const saveSettlementMock = vi.fn()
vi.mock('../src/lib/settlementSync', () => ({
  saveSettlement: (...args: unknown[]) => saveSettlementMock(...args),
  listSettlements: vi.fn(),
  getSettlement: vi.fn(),
}))

import { SettlementExpenseForm } from '../src/components/settlement/SettlementExpenseForm'
import { DinnerContributionForm } from '../src/components/settlement/DinnerContributionForm'
import { useSettlementStore } from '../src/store/settlementStore'
import { useAdminAuthStore } from '../src/store/adminAuthStore'
import type { RegularSettlement } from '../src/types/settlement'

// 아래 이름·ID·금액은 전부 테스트용 가상 데이터이며 실제 회원 정보가 아니다.

function fakeSettlement(overrides: Partial<RegularSettlement> = {}): RegularSettlement {
  return {
    id: 'settle-expense-1',
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

beforeEach(() => {
  useSettlementStore.setState({ settlements: [fakeSettlement()], currentId: 'settle-expense-1', syncStatus: 'idle', lastSyncError: null })
  useAdminAuthStore.setState({ status: 'authorizedAdmin', uid: 'fake-admin-uid', email: 'fake-admin@example.test', adminDisplayName: '가상관리자', errorMessage: null })
  saveSettlementMock.mockReset()
  saveSettlementMock.mockResolvedValue(1)
})

describe('SettlementExpenseForm — 지출 탭에 임시저장 버튼이 생겨 실제로 저장을 호출한다', () => {
  it('지출 탭에 "임시저장" 버튼이 보인다(버그 발생 당시에는 이 탭에 저장 버튼 자체가 없었다)', () => {
    render(<SettlementExpenseForm settlementId="settle-expense-1" onRequestDinnerForm={() => {}} />)
    expect(screen.getByText('임시저장')).toBeInTheDocument()
  })

  it('지출을 추가한 뒤 임시저장을 누르면 그 지출이 포함된 settlement가 실제로 Firestore 저장 함수에 전달된다', async () => {
    render(<SettlementExpenseForm settlementId="settle-expense-1" onRequestDinnerForm={() => {}} />)
    fireEvent.change(screen.getByPlaceholderText('항목명 (예: 당구장 대관료)'), { target: { value: '가상 대관료' } })
    // 금액/모임부담액/개인찬조액 입력 모두 placeholder="0"을 공유하므로, 첫 번째(금액)만 채운다.
    fireEvent.change(screen.getAllByPlaceholderText('0')[0], { target: { value: '50000' } })
    // "지출 추가" 텍스트는 섹션 제목과 제출 버튼 둘 다에 쓰이므로 버튼 role로 정확히 지정한다.
    fireEvent.click(screen.getByRole('button', { name: '지출 추가' }))

    fireEvent.click(screen.getByText('임시저장'))
    await waitFor(() => expect(saveSettlementMock).toHaveBeenCalledTimes(1))
    const payload = saveSettlementMock.mock.calls[0][0]
    expect(payload.expenses).toHaveLength(1)
    expect(payload.expenses[0]).toMatchObject({ label: '가상 대관료', amount: 50000 })
  })

  it('previewMode에서는 임시저장 버튼이 비활성화되고 saveSettlement가 호출되지 않는다', () => {
    render(<SettlementExpenseForm settlementId="settle-expense-1" onRequestDinnerForm={() => {}} previewMode />)
    const btn = screen.getByText('임시저장')
    expect(btn).toBeDisabled()
    fireEvent.click(btn)
    expect(saveSettlementMock).not.toHaveBeenCalled()
  })

  it('저장이 실패하면 "임시저장 완료" 메시지를 표시하지 않는다', async () => {
    saveSettlementMock.mockRejectedValue(new Error('가상 네트워크 오류'))
    render(<SettlementExpenseForm settlementId="settle-expense-1" onRequestDinnerForm={() => {}} />)
    fireEvent.click(screen.getByText('임시저장'))
    await waitFor(() => expect(saveSettlementMock).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('임시저장 완료')).not.toBeInTheDocument()
  })
})

describe('DinnerContributionForm — 회식비 탭에도 동일하게 임시저장 버튼이 동작한다', () => {
  it('회식비 탭에 "임시저장" 버튼이 보인다', () => {
    render(<DinnerContributionForm settlementId="settle-expense-1" />)
    expect(screen.getByText('임시저장')).toBeInTheDocument()
  })

  it('회식비를 추가한 뒤 임시저장을 누르면 그 회식비가 포함된 settlement가 저장된다', async () => {
    render(<DinnerContributionForm settlementId="settle-expense-1" />)
    fireEvent.change(screen.getByPlaceholderText('1'), { target: { value: '1' } })
    fireEvent.click(screen.getByText('회식비 추가'))

    fireEvent.click(screen.getByText('임시저장'))
    await waitFor(() => expect(saveSettlementMock).toHaveBeenCalledTimes(1))
    const payload = saveSettlementMock.mock.calls[0][0]
    expect(payload.dinnerContributions).toHaveLength(1)
    expect(payload.dinnerContributions[0]).toMatchObject({ dinnerRound: 1, contributionType: '모임회계지출' })
  })

  it('previewMode에서는 회식비 탭의 저장 버튼도 비활성화된다', () => {
    render(<DinnerContributionForm settlementId="settle-expense-1" previewMode />)
    expect(screen.getByText('임시저장')).toBeDisabled()
  })
})

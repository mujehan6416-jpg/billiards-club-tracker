import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// settlementSync(Firestore 실제 호출부)를 통째로 모킹 — 실제 Firebase에 절대 접근하지 않는다.
const saveSettlementMock = vi.fn()
vi.mock('../src/lib/settlementSync', () => ({
  saveSettlement: (...args: unknown[]) => saveSettlementMock(...args),
  listSettlements: vi.fn(),
  getSettlement: vi.fn(),
}))

import { DuesTable } from '../src/components/settlement/DuesTable'
import { useSettlementStore } from '../src/store/settlementStore'
import { useAdminAuthStore } from '../src/store/adminAuthStore'
import type { RegularSettlement } from '../src/types/settlement'

// 확정 정책: 현금은 입력 즉시 확인 완료된 수입으로 처리하고 확인 상태 select 자체를 표시하지 않는다.
// 계좌이체일 때만 확인 상태 select를 표시하고, 회비/찬조 기존 정책(미납/미확인/입금확인/취소,
// 미확인/입금확인/취소)을 그대로 유지한다. 아래 이름·ID·금액은 전부 테스트용 가상 데이터다.

function fakeSettlement(overrides: Partial<RegularSettlement> = {}): RegularSettlement {
  return {
    id: 'settle-pm-1',
    meetingName: '가상 정기모임',
    meetingDate: '2026-01-10',
    meetingType: 'regular',
    status: 'draft',
    participants: [
      { id: 'p1', participantType: 'member', memberId: 'p1', displayName: '가상회원A', addedVia: 'meeting_attendee' },
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
  useSettlementStore.setState({ settlements: [fakeSettlement()], currentId: 'settle-pm-1', syncStatus: 'idle', lastSyncError: null })
  useAdminAuthStore.setState({ status: 'authorizedAdmin', uid: 'fake-admin-uid', email: 'fake-admin@example.test', adminDisplayName: '가상관리자', errorMessage: null })
  saveSettlementMock.mockReset()
  saveSettlementMock.mockResolvedValue(1)
})

const income = () => useSettlementStore.getState().getSummary('settle-pm-1')!.income
const unconfirmed = () => { const i = income(); return i.duesTransferUnconfirmed + i.donationTransferUnconfirmed }

describe('1. 현금 회비', () => {
  it('상태 select 미노출, 총수입 포함, 미확인 합계 제외', () => {
    render(<DuesTable settlementId="settle-pm-1" />)
    fireEvent.change(screen.getByLabelText('가상회원A 회비 금액'), { target: { value: '30000' } })
    fireEvent.blur(screen.getByLabelText('가상회원A 회비 금액'))
    fireEvent.change(screen.getByLabelText('가상회원A 회비 결제수단'), { target: { value: '현금' } })

    expect(screen.queryByLabelText('가상회원A 회비 확인상태')).not.toBeInTheDocument()
    expect(income().totalIncome).toBe(30000)
    expect(unconfirmed()).toBe(0)
  })
})

describe('2. 현금 찬조', () => {
  it('상태 select 미노출, 총수입 포함, 미확인 합계 제외', () => {
    render(<DuesTable settlementId="settle-pm-1" />)
    fireEvent.click(screen.getByText('+ 찬조'))
    fireEvent.change(screen.getByLabelText('가상회원A 찬조 금액'), { target: { value: '20000' } })
    fireEvent.blur(screen.getByLabelText('가상회원A 찬조 금액'))
    fireEvent.change(screen.getByLabelText('가상회원A 찬조 결제수단'), { target: { value: '현금' } })

    expect(screen.queryByLabelText('가상회원A 찬조 확인상태')).not.toBeInTheDocument()
    expect(income().totalIncome).toBe(20000)
    expect(unconfirmed()).toBe(0)
  })
})

describe('3. 계좌이체 회비', () => {
  it('상태 select 노출, 기본값 미확인, 총수입 제외, 미확인 합계 포함', () => {
    render(<DuesTable settlementId="settle-pm-1" />)
    fireEvent.change(screen.getByLabelText('가상회원A 회비 금액'), { target: { value: '30000' } })
    fireEvent.blur(screen.getByLabelText('가상회원A 회비 금액'))
    fireEvent.change(screen.getByLabelText('가상회원A 회비 결제수단'), { target: { value: '계좌이체' } })

    const select = screen.getByLabelText('가상회원A 회비 확인상태') as HTMLSelectElement
    expect(select).toBeInTheDocument()
    expect(select.value).toBe('미확인')
    expect(income().totalIncome).toBe(0)
    expect(unconfirmed()).toBe(30000)
  })
})

describe('4. 계좌이체 찬조', () => {
  it('상태 select 노출, 기본값 미확인, 총수입 제외, 미확인 합계 포함', () => {
    render(<DuesTable settlementId="settle-pm-1" />)
    fireEvent.click(screen.getByText('+ 찬조'))
    fireEvent.change(screen.getByLabelText('가상회원A 찬조 금액'), { target: { value: '20000' } })
    fireEvent.blur(screen.getByLabelText('가상회원A 찬조 금액'))
    fireEvent.change(screen.getByLabelText('가상회원A 찬조 결제수단'), { target: { value: '계좌이체' } })

    const select = screen.getByLabelText('가상회원A 찬조 확인상태') as HTMLSelectElement
    expect(select).toBeInTheDocument()
    expect(select.value).toBe('미확인')
    expect(income().totalIncome).toBe(0)
    expect(unconfirmed()).toBe(20000)
  })
})

describe('5. 현금 → 계좌이체', () => {
  it('상태 select 표시, 미확인으로 전환, 총수입 감소, 미확인 합계 증가', () => {
    render(<DuesTable settlementId="settle-pm-1" />)
    fireEvent.change(screen.getByLabelText('가상회원A 회비 금액'), { target: { value: '30000' } })
    fireEvent.blur(screen.getByLabelText('가상회원A 회비 금액'))
    fireEvent.change(screen.getByLabelText('가상회원A 회비 결제수단'), { target: { value: '현금' } })

    expect(income().totalIncome).toBe(30000)
    expect(screen.queryByLabelText('가상회원A 회비 확인상태')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('가상회원A 회비 결제수단'), { target: { value: '계좌이체' } })

    const select = screen.getByLabelText('가상회원A 회비 확인상태') as HTMLSelectElement
    expect(select).toBeInTheDocument()
    expect(select.value).toBe('미확인')
    expect(income().totalIncome).toBe(0) // 30,000 → 0으로 감소
    expect(unconfirmed()).toBe(30000) // 0 → 30,000으로 증가
  })
})

describe('6. 계좌이체 미확인 → 현금', () => {
  it('상태 select 사라짐, 총수입 증가, 미확인 합계 감소', () => {
    render(<DuesTable settlementId="settle-pm-1" />)
    fireEvent.change(screen.getByLabelText('가상회원A 회비 금액'), { target: { value: '30000' } })
    fireEvent.blur(screen.getByLabelText('가상회원A 회비 금액'))
    fireEvent.change(screen.getByLabelText('가상회원A 회비 결제수단'), { target: { value: '계좌이체' } })

    expect(income().totalIncome).toBe(0)
    expect(unconfirmed()).toBe(30000)

    fireEvent.change(screen.getByLabelText('가상회원A 회비 결제수단'), { target: { value: '현금' } })

    expect(screen.queryByLabelText('가상회원A 회비 확인상태')).not.toBeInTheDocument()
    expect(income().totalIncome).toBe(30000) // 0 → 30,000으로 증가
    expect(unconfirmed()).toBe(0) // 30,000 → 0으로 감소
  })
})

describe('7. 계좌이체 입금확인 → 현금', () => {
  it('총수입 유지, 상태 select 사라짐', () => {
    render(<DuesTable settlementId="settle-pm-1" />)
    fireEvent.change(screen.getByLabelText('가상회원A 회비 금액'), { target: { value: '30000' } })
    fireEvent.blur(screen.getByLabelText('가상회원A 회비 금액'))
    fireEvent.change(screen.getByLabelText('가상회원A 회비 결제수단'), { target: { value: '계좌이체' } })
    fireEvent.change(screen.getByLabelText('가상회원A 회비 확인상태'), { target: { value: '입금확인' } })

    expect(income().totalIncome).toBe(30000)

    fireEvent.change(screen.getByLabelText('가상회원A 회비 결제수단'), { target: { value: '현금' } })

    expect(screen.queryByLabelText('가상회원A 회비 확인상태')).not.toBeInTheDocument()
    expect(income().totalIncome).toBe(30000) // 그대로 유지
  })
})

describe('8. 현금인데 레거시 status가 미확인인 데이터', () => {
  it('총수입 포함, 미확인 합계 제외, 상태 select 미노출', () => {
    useSettlementStore.setState({
      settlements: [fakeSettlement({
        participants: [
          { id: 'p1', participantType: 'member', memberId: 'p1', displayName: '가상회원A', addedVia: 'meeting_attendee', dues: { amount: 30000, method: '현금', status: '미확인' } },
        ],
      })],
      currentId: 'settle-pm-1',
    })
    render(<DuesTable settlementId="settle-pm-1" />)

    expect(screen.queryByLabelText('가상회원A 회비 확인상태')).not.toBeInTheDocument()
    expect(income().totalIncome).toBe(30000)
    expect(unconfirmed()).toBe(0)
  })

  it('status에 임의의(타입 밖) 문자열이 남아있어도 현금이면 방어적으로 총수입에 포함된다', () => {
    useSettlementStore.setState({
      settlements: [fakeSettlement({
        participants: [
          { id: 'p1', participantType: 'member', memberId: 'p1', displayName: '가상회원A', addedVia: 'meeting_attendee', dues: { amount: 30000, method: '현금', status: 'unconfirmed' as never } },
        ],
      })],
      currentId: 'settle-pm-1',
    })
    expect(income().totalIncome).toBe(30000)
    expect(unconfirmed()).toBe(0)
  })
})

describe('9. 임시저장 후 재조회 — 결제수단·상태 정규화 결과 유지', () => {
  it('현금→계좌이체 전환(미확인 정규화) 후 임시저장하고 재조회해도 그대로 복원된다', async () => {
    render(<DuesTable settlementId="settle-pm-1" />)
    fireEvent.change(screen.getByLabelText('가상회원A 회비 금액'), { target: { value: '30000' } })
    fireEvent.blur(screen.getByLabelText('가상회원A 회비 금액'))
    fireEvent.change(screen.getByLabelText('가상회원A 회비 결제수단'), { target: { value: '계좌이체' } })

    fireEvent.click(screen.getByText('임시저장'))
    await waitFor(() => expect(saveSettlementMock).toHaveBeenCalledTimes(1))
    const savedPayload = saveSettlementMock.mock.calls[0][0]
    expect(savedPayload.participants[0].dues).toMatchObject({ amount: 30000, method: '계좌이체', status: '미확인' })

    useSettlementStore.setState({ settlements: [{ ...savedPayload, version: 1 }], currentId: 'settle-pm-1' })
    const restored = useSettlementStore.getState().getById('settle-pm-1')!.participants[0]
    expect(restored.dues).toMatchObject({ amount: 30000, method: '계좌이체', status: '미확인' })
    expect(unconfirmed()).toBe(30000)
  })

  it('계좌이체 입금확인 → 현금 전환(정규화) 후 임시저장하고 재조회해도 그대로 복원된다', async () => {
    render(<DuesTable settlementId="settle-pm-1" />)
    fireEvent.change(screen.getByLabelText('가상회원A 회비 금액'), { target: { value: '30000' } })
    fireEvent.blur(screen.getByLabelText('가상회원A 회비 금액'))
    fireEvent.change(screen.getByLabelText('가상회원A 회비 결제수단'), { target: { value: '계좌이체' } })
    fireEvent.change(screen.getByLabelText('가상회원A 회비 확인상태'), { target: { value: '입금확인' } })
    fireEvent.change(screen.getByLabelText('가상회원A 회비 결제수단'), { target: { value: '현금' } })

    fireEvent.click(screen.getByText('임시저장'))
    await waitFor(() => expect(saveSettlementMock).toHaveBeenCalledTimes(1))
    const savedPayload = saveSettlementMock.mock.calls[0][0]
    expect(savedPayload.participants[0].dues).toMatchObject({ amount: 30000, method: '현금', status: '입금확인' })

    useSettlementStore.setState({ settlements: [{ ...savedPayload, version: 1 }], currentId: 'settle-pm-1' })
    const restored = useSettlementStore.getState().getById('settle-pm-1')!.participants[0]
    expect(restored.dues).toMatchObject({ amount: 30000, method: '현금', status: '입금확인' })
    expect(income().totalIncome).toBe(30000)
  })
})

describe('10. 회비 30,000원 현금 + 찬조 20,000원 계좌이체 미확인', () => {
  it('총수입 30,000원, 미확인 합계 20,000원', () => {
    render(<DuesTable settlementId="settle-pm-1" />)
    fireEvent.change(screen.getByLabelText('가상회원A 회비 금액'), { target: { value: '30000' } })
    fireEvent.blur(screen.getByLabelText('가상회원A 회비 금액'))
    fireEvent.change(screen.getByLabelText('가상회원A 회비 결제수단'), { target: { value: '현금' } })

    fireEvent.click(screen.getByText('+ 찬조'))
    fireEvent.change(screen.getByLabelText('가상회원A 찬조 금액'), { target: { value: '20000' } })
    fireEvent.blur(screen.getByLabelText('가상회원A 찬조 금액'))
    fireEvent.change(screen.getByLabelText('가상회원A 찬조 결제수단'), { target: { value: '계좌이체' } })

    expect(income().totalIncome).toBe(30000)
    expect(unconfirmed()).toBe(20000)
  })
})

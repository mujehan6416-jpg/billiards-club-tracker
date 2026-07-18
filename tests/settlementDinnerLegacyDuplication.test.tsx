import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// settlementSync(Firestore 실제 호출부)를 통째로 모킹 — 실제 Firebase에 절대 접근하지 않는다.
const saveSettlementMock = vi.fn()
vi.mock('../src/lib/settlementSync', () => ({
  saveSettlement: (...args: unknown[]) => saveSettlementMock(...args),
  listSettlements: vi.fn(),
  getSettlement: vi.fn(),
}))

import { SettlementExpenseForm } from '../src/components/settlement/SettlementExpenseForm'
import { useSettlementStore } from '../src/store/settlementStore'
import { useAdminAuthStore } from '../src/store/adminAuthStore'
import { calcExpenseSummary, calcExpenseByCategory, calcProfitSummary } from '../src/logic/settlement'
import { buildPublicSummary } from '../src/lib/settlementShareText'
import type { RegularSettlement } from '../src/types/settlement'

// [버그 재현] 회식비 탭 제거 후 dinnerContributions(레거시 회식비)를 볼 화면이 없어, 관리자가
// 지출 탭에 같은 회식비를 또 등록해 총지출·회식비 합계가 두 배로 집계되던 문제.
// 원인 확인: addExpense는 SettlementExpenseForm의 submit()에서만 호출된다(grep으로 확인, 자동
// 복사 경로 없음) — 즉 중복은 항상 "사람이 직접 다시 입력"해서 생긴다. 따라서 금액이 같다고
// 자동으로 합치는 방식은 위험하다(실제로 같은 날 서로 다른 회식비 두 건이 있을 수 있음).
// 수정 방향: 지출 탭에 레거시 회식비를 다시 보여줘서(읽기 전용 + 삭제) 애초에 중복 입력을
// 막고, 이미 중복된 경우는 관리자가 직접 어느 쪽을 지울지 판단해 삭제할 수 있게 한다.
// 아래 이름·ID·금액은 전부 테스트용 가상 데이터다.

function fakeSettlement(overrides: Partial<RegularSettlement> = {}): RegularSettlement {
  return {
    id: 'settle-dinner-dup-1',
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
  useSettlementStore.setState({ settlements: [fakeSettlement()], currentId: 'settle-dinner-dup-1', syncStatus: 'idle', lastSyncError: null })
  useAdminAuthStore.setState({ status: 'authorizedAdmin', uid: 'fake-admin-uid', email: 'fake-admin@example.test', adminDisplayName: '가상관리자', errorMessage: null })
  saveSettlementMock.mockReset()
  saveSettlementMock.mockResolvedValue(1)
})

describe('1. 레거시 회식비만 존재', () => {
  it('지출 탭에 1건 표시되고, 총지출에 1번만 반영된다', () => {
    useSettlementStore.setState({
      settlements: [fakeSettlement({
        dinnerContributions: [{ id: 'd1', dinnerRound: 1, totalAmount: 100000, method: '현금', clubShare: 100000, contributionType: '모임회계지출', contributors: [] }],
      })],
    })
    render(<SettlementExpenseForm settlementId="settle-dinner-dup-1" />)
    expect(screen.getByText(/1차 회식비/)).toBeInTheDocument()
    expect(screen.getAllByText(/1차 회식비/)).toHaveLength(1)

    const settlement = useSettlementStore.getState().getById('settle-dinner-dup-1')!
    expect(calcExpenseSummary(settlement).total).toBe(100000)
  })
})

describe('2. 신규 지출 회식비만 존재', () => {
  it('지출 탭에 1건 표시되고, 총지출에 1번만 반영된다', () => {
    useSettlementStore.setState({
      settlements: [fakeSettlement({
        expenses: [{ id: 'e1', date: '2026-01-10', label: '회식', category: '회식비', amount: 100000, method: '현금', clubShare: 100000, personalDonation: 0 }],
      })],
    })
    render(<SettlementExpenseForm settlementId="settle-dinner-dup-1" />)
    expect(screen.getByText('회식')).toBeInTheDocument()

    const settlement = useSettlementStore.getState().getById('settle-dinner-dup-1')!
    expect(calcExpenseSummary(settlement).total).toBe(100000)
  })
})

describe('3. 서로 다른 레거시 100,000원 + 신규 50,000원', () => {
  it('둘 다 표시되고, 총지출은 150,000원이다', () => {
    useSettlementStore.setState({
      settlements: [fakeSettlement({
        dinnerContributions: [{ id: 'd1', dinnerRound: 1, totalAmount: 100000, method: '현금', clubShare: 100000, contributionType: '모임회계지출', contributors: [] }],
        expenses: [{ id: 'e1', date: '2026-01-15', label: '2차 회식', category: '회식비', amount: 50000, method: '현금', clubShare: 50000, personalDonation: 0 }],
      })],
    })
    render(<SettlementExpenseForm settlementId="settle-dinner-dup-1" />)
    expect(screen.getByText(/1차 회식비/)).toBeInTheDocument()
    expect(screen.getByText('2차 회식')).toBeInTheDocument()

    const settlement = useSettlementStore.getState().getById('settle-dinner-dup-1')!
    expect(calcExpenseSummary(settlement).total).toBe(150000)
  })
})

describe('4. 동일한 회식비가 레거시와 신규 양쪽에 모두 있는 경우(사람이 중복 입력한 실제 상황)', () => {
  it('[알려진 한계] 자동으로 하나로 합치지 않는다 — 식별 가능한 원본 ID가 없어 금액만으로 합치면 실제로 다른 회식비를 잘못 지울 위험이 있다. 대신 두 항목 모두 표시해 관리자가 직접 정리할 수 있게 한다', () => {
    useSettlementStore.setState({
      settlements: [fakeSettlement({
        dinnerContributions: [{ id: 'd1', dinnerRound: 1, totalAmount: 100000, method: '현금', clubShare: 100000, contributionType: '모임회계지출', contributors: [] }],
        expenses: [{ id: 'e1', date: '2026-01-10', label: '1차 회식비(중복 입력분)', category: '회식비', amount: 100000, method: '현금', clubShare: 100000, personalDonation: 0 }],
      })],
    })
    render(<SettlementExpenseForm settlementId="settle-dinner-dup-1" />)
    // 자동 병합하지 않으므로 둘 다 화면에 남는다 — 사용자가 삭제 버튼으로 정리해야 한다는 것을 문서화.
    expect(screen.getByText(/1차 회식비 — /)).toBeInTheDocument()
    expect(screen.getByText('1차 회식비(중복 입력분)')).toBeInTheDocument()
  })

  it('관리자가 레거시 항목의 "삭제" 버튼을 누르면 그 항목만 지워지고 총지출이 정확히 절반으로 줄어든다', () => {
    useSettlementStore.setState({
      settlements: [fakeSettlement({
        dinnerContributions: [{ id: 'd1', dinnerRound: 1, totalAmount: 100000, method: '현금', clubShare: 100000, contributionType: '모임회계지출', contributors: [] }],
        expenses: [{ id: 'e1', date: '2026-01-10', label: '1차 회식비(중복 입력분)', category: '회식비', amount: 100000, method: '현금', clubShare: 100000, personalDonation: 0 }],
      })],
    })
    render(<SettlementExpenseForm settlementId="settle-dinner-dup-1" />)
    expect(calcExpenseSummary(useSettlementStore.getState().getById('settle-dinner-dup-1')!).total).toBe(200000)

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: '1차 회식비(기존) 삭제' }))
    confirmSpy.mockRestore()

    const after = useSettlementStore.getState().getById('settle-dinner-dup-1')!
    expect(after.dinnerContributions).toHaveLength(0)
    expect(after.expenses).toHaveLength(1)
    expect(calcExpenseSummary(after).total).toBe(100000)
  })
})

describe('5. 동일 금액이지만 실제로 다른 두 회식비', () => {
  it('둘 다 그대로 표시되고 잘못 제거되지 않는다', () => {
    useSettlementStore.setState({
      settlements: [fakeSettlement({
        dinnerContributions: [
          { id: 'd1', dinnerRound: 1, totalAmount: 100000, method: '현금', clubShare: 100000, contributionType: '모임회계지출', contributors: [] },
          { id: 'd2', dinnerRound: 2, totalAmount: 100000, method: '계좌이체', clubShare: 100000, contributionType: '모임회계지출', contributors: [] },
        ],
      })],
    })
    render(<SettlementExpenseForm settlementId="settle-dinner-dup-1" />)
    expect(screen.getByText(/1차 회식비/)).toBeInTheDocument()
    expect(screen.getByText(/2차 회식비/)).toBeInTheDocument()

    const settlement = useSettlementStore.getState().getById('settle-dinner-dup-1')!
    expect(settlement.dinnerContributions).toHaveLength(2)
    expect(calcExpenseSummary(settlement).total).toBe(200000)
  })
})

describe('6. 지출 분류별 합계(calcExpenseByCategory)에서 회식비 중복 없음', () => {
  it('레거시 하나만 있을 때 회식비 분류 합계가 정확히 1건분이다', () => {
    const settlement = fakeSettlement({
      dinnerContributions: [{ id: 'd1', dinnerRound: 1, totalAmount: 100000, method: '현금', clubShare: 100000, contributionType: '모임회계지출', contributors: [] }],
    })
    const result = calcExpenseByCategory(settlement)
    expect(result).toEqual([{ category: '회식비', amount: 100000 }])
  })
})

describe('7. 일반회원 정산 요약(buildPublicSummary)에서 회식비 합계 중복 없음', () => {
  it('레거시 100,000원만 있으면 dinnerSummary.clubShareTotal이 100,000원이다', () => {
    const settlement = fakeSettlement({
      status: 'confirmed',
      dinnerContributions: [{ id: 'd1', dinnerRound: 1, totalAmount: 100000, method: '현금', clubShare: 100000, contributionType: '모임회계지출', contributors: [] }],
    })
    const summary = buildPublicSummary(settlement)
    expect(summary.dinnerSummary).toEqual({ roundCount: 1, clubShareTotal: 100000 })
  })
})

describe('8. 잔액(순익)에서 회식비가 두 번 차감되지 않음', () => {
  it('레거시 회식비 100,000원 지출만 있으면 순익은 -100,000원이다(총수입 0 - 총지출 100,000)', () => {
    const settlement = fakeSettlement({
      dinnerContributions: [{ id: 'd1', dinnerRound: 1, totalAmount: 100000, method: '현금', clubShare: 100000, contributionType: '모임회계지출', contributors: [] }],
    })
    const profit = calcProfitSummary(settlement)
    expect(profit.totalExpense).toBe(100000)
    expect(profit.netProfit).toBe(-100000)
  })
})

describe('9. 저장·재조회 후 항목 수가 늘어나지 않음', () => {
  it('레거시 회식비가 있는 상태로 임시저장하고 재조회해도 dinnerContributions·expenses 개수가 그대로다', async () => {
    useSettlementStore.setState({
      settlements: [fakeSettlement({
        dinnerContributions: [{ id: 'd1', dinnerRound: 1, totalAmount: 100000, method: '현금', clubShare: 100000, contributionType: '모임회계지출', contributors: [] }],
      })],
    })
    const before = useSettlementStore.getState().getById('settle-dinner-dup-1')!
    saveSettlementMock.mockResolvedValue(1)
    const res = await useSettlementStore.getState().saveDraft('settle-dinner-dup-1')
    expect(res.ok).toBe(true)
    const savedPayload = saveSettlementMock.mock.calls[0][0]
    expect(savedPayload.dinnerContributions).toHaveLength(1)
    expect(savedPayload.expenses).toHaveLength(0)

    useSettlementStore.setState({ settlements: [{ ...savedPayload, version: 1 }], currentId: 'settle-dinner-dup-1' })
    const restored = useSettlementStore.getState().getById('settle-dinner-dup-1')!
    expect(restored.dinnerContributions).toHaveLength(before.dinnerContributions.length)
    expect(restored.expenses).toHaveLength(before.expenses.length)
  })
})

describe('10. 기존 Firestore 문서의 레거시 회식비를 오류 없이 조회', () => {
  it('dinnerContributions만 있고 expenses가 빈 배열이어도 렌더링 오류가 없다', () => {
    useSettlementStore.setState({
      settlements: [fakeSettlement({
        dinnerContributions: [{ id: 'd1', dinnerRound: 3, totalAmount: 50000, method: '계좌이체', clubShare: 50000, contributionType: '일부찬조', contributors: [{ name: '가상찬조자', memberId: null, amount: 20000 }] }],
      })],
    })
    expect(() => render(<SettlementExpenseForm settlementId="settle-dinner-dup-1" />)).not.toThrow()
    expect(screen.getByText(/3차 회식비/)).toBeInTheDocument()
    expect(screen.getByText(/찬조자 1명/)).toBeInTheDocument()
  })

  it('dinnerContributions가 비어있으면(기존 정산) 레거시 섹션 자체를 표시하지 않는다', () => {
    render(<SettlementExpenseForm settlementId="settle-dinner-dup-1" />)
    expect(screen.queryByText('기존 회식비 (이전 회식비 탭에서 등록된 데이터)')).not.toBeInTheDocument()
  })
})

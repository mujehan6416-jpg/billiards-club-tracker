import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// settlementSync(Firestore 실제 호출부)를 통째로 모킹 — 실제 Firebase에 절대 접근하지 않는다.
vi.mock('../src/lib/settlementSync', () => ({
  saveSettlement: vi.fn().mockResolvedValue(1),
  listSettlements: vi.fn(),
  getSettlement: vi.fn(),
}))

import {
  calcIncomeSummary, calcExpenseSummary, calcProfitSummary, calcCashSummary, calcBankSummary,
  calcHoldingsSummary, withdrawalsOf, validateCashDeposit, validateBankCashWithdrawal,
} from '../src/logic/settlement'
import { buildMemberShareText, buildPresidentShareText, buildPublicSummary } from '../src/lib/settlementShareText'
import { useSettlementStore } from '../src/store/settlementStore'
import { useAdminAuthStore } from '../src/store/adminAuthStore'
import { useApp } from '../src/store/appStore'
import { BankCashWithdrawalForm } from '../src/components/settlement/BankCashWithdrawalForm'
import { SettlementSummary } from '../src/components/settlement/SettlementSummary'
import { SettlementTab } from '../src/tabs/SettlementTab'
import type { RegularSettlement, BankCashWithdrawal } from '../src/types/settlement'

// 아래 이름·ID·금액은 전부 테스트용 가상 데이터이며 실제 회원·회계 정보가 아니다.
// 구조: 현금 → 통장 입금은 기존 cashDeposits가 담당하고, 새로 추가한 bankCashWithdrawals는 통장 → 현금 인출 전용이다.

const ID = 'settle-withdrawal-1'

function fake(overrides: Partial<RegularSettlement> = {}): RegularSettlement {
  return {
    id: ID,
    meetingName: '가상 정기모임',
    meetingDate: '2026-01-10',
    meetingType: 'regular',
    status: 'draft',
    participants: [],
    expenses: [],
    dinnerContributions: [],
    cashDeposits: [],
    prevBankBalance: 1_000_000,
    otherBankAdjustment: 0,
    createdAt: '2026-01-10T00:00:00.000Z',
    version: 1,
    revisionLog: [],
    ...overrides,
  }
}

const withdrawal = (amount: number, id = `w-${amount}`): BankCashWithdrawal => ({ id, amount, date: '2026-01-10' })
const cashExpense = (amount: number) => ({
  id: `e-${amount}`, date: '2026-01-10', label: '다과', category: '기타', amount, method: '현금' as const, clubShare: amount, personalDonation: 0,
})
const deposit = (amount: number, status: '입금확인' | '입금예정' = '입금확인') => ({
  id: `d-${amount}`, depositDate: '2026-01-11', amount, status,
})

beforeEach(() => {
  useSettlementStore.setState({ settlements: [fake()], currentId: ID, syncStatus: 'idle', lastSyncError: null })
  useAdminAuthStore.setState({ status: 'authorizedAdmin', uid: 'fake-admin-uid', email: 'fake-admin@example.test', adminDisplayName: '가상관리자', errorMessage: null })
  useApp.setState({ members: [], sessions: [], settings: { lastBackupAt: null }, ledger: [] })
})

const flow = (s: RegularSettlement) => ({ income: calcIncomeSummary(s), expense: calcExpenseSummary(s), profit: calcProfitSummary(s) })
const snap = (s: RegularSettlement) => {
  const h = calcHoldingsSummary(s)
  return [h.bankBalance, h.cashBalance, h.totalHoldings]
}

describe('통장에서 현금 인출 계산 (현금→통장 입금은 기존 cashDeposits)', () => {
  it('1. 통장 1,000,000 / 현금 0 에서 200,000 인출 → 통장 800,000 / 현금 200,000 / 전체 1,000,000', () => {
    expect(snap(fake())).toEqual([1_000_000, 0, 1_000_000])
    expect(snap(fake({ bankCashWithdrawals: [withdrawal(200_000)] }))).toEqual([800_000, 200_000, 1_000_000])
  })

  it('2. 이어서 현금 50,000 지출 → 통장 800,000 / 현금 150,000 / 전체 950,000', () => {
    const s = fake({ bankCashWithdrawals: [withdrawal(200_000)], expenses: [cashExpense(50_000)] })
    expect(snap(s)).toEqual([800_000, 150_000, 950_000])
  })

  it('3. 이어서 기존 cashDeposits로 현금 100,000 통장 입금 → 통장 900,000 / 현금 50,000 / 전체 950,000', () => {
    const s = fake({
      bankCashWithdrawals: [withdrawal(200_000)],
      expenses: [cashExpense(50_000)],
      cashDeposits: [deposit(100_000)],
    })
    expect(snap(s)).toEqual([900_000, 50_000, 950_000])
  })

  it('입금예정(미확인) 현금 입금은 예전처럼 반영하지 않는다', () => {
    const s = fake({ bankCashWithdrawals: [withdrawal(200_000)], cashDeposits: [deposit(100_000, '입금예정')] })
    expect(snap(s)).toEqual([800_000, 200_000, 1_000_000])
  })

  it('4. 인출·입금은 총수입·총지출·순익을 바꾸지 않는다', () => {
    const base = fake({ expenses: [cashExpense(50_000)] })
    const moved = fake({ expenses: [cashExpense(50_000)], bankCashWithdrawals: [withdrawal(200_000)], cashDeposits: [deposit(100_000)] })
    expect(flow(moved)).toEqual(flow(base))
    expect(calcProfitSummary(moved)).toMatchObject({ totalIncome: 0, totalExpense: 50_000, netProfit: -50_000 })
  })

  it('인출을 여러 번 해도 합계가 정확하다', () => {
    const s = fake({ bankCashWithdrawals: [withdrawal(300_000, 'a'), withdrawal(120_000, 'b'), withdrawal(10_000, 'c')] })
    expect(snap(s)).toEqual([570_000, 430_000, 1_000_000])
  })

  it('5. cashDeposits만 있는 과거 정산(인출 필드 없음)은 숫자가 예전과 같다', () => {
    const legacy = fake({
      prevBankBalance: 100_000,
      participants: [
        { id: 'p1', participantType: 'guest', memberId: null, displayName: '가상A', addedVia: 'manually_added_guest', dues: { amount: 30_000, method: '현금', status: '입금확인' } },
        { id: 'p2', participantType: 'guest', memberId: null, displayName: '가상B', addedVia: 'manually_added_guest', dues: { amount: 20_000, method: '계좌이체', status: '입금확인' } },
      ],
      expenses: [cashExpense(5_000)],
      cashDeposits: [deposit(10_000)],
    })
    expect('bankCashWithdrawals' in legacy).toBe(false)
    expect(calcBankSummary(legacy).currentBalance).toBe(130_000) // 100,000 + 20,000(계좌이체) + 10,000(현금입금)
    const cash = calcCashSummary(legacy)
    expect(cash.cashBalanceBeforeDeposit).toBe(25_000)
    expect(cash.cashBalanceAfterDeposit).toBe(15_000)
    expect(cash.cashBalance).toBe(15_000)
    expect(calcHoldingsSummary(legacy).totalHoldings).toBe(145_000)
  })

  it('6. 인출 기록이 없는(없음/빈 목록) 기존 정산은 계산 결과가 완전히 같다', () => {
    const legacy = fake({ expenses: [cashExpense(5_000)], cashDeposits: [] })
    const empty = { ...legacy, bankCashWithdrawals: [] }
    expect(withdrawalsOf(legacy)).toEqual([])
    expect(calcBankSummary(empty)).toEqual(calcBankSummary(legacy))
    expect(calcCashSummary(empty)).toEqual(calcCashSummary(legacy))
    expect(calcBankSummary(legacy).bankWithdrawal).toBe(0)
    expect(calcCashSummary(legacy).cashBalance).toBe(calcCashSummary(legacy).cashBalanceAfterDeposit)
  })

  it('회비·찬조 여러 행(현금+계좌이체)과 함께 써도 수입 합계는 그대로이고 보유액이 정확하다', () => {
    const participants = [{
      id: 'p1', participantType: 'guest' as const, memberId: null, displayName: '가상A', addedVia: 'manually_added_guest' as const,
      duesPayments: [
        { amount: 20_000, method: '현금' as const, status: '입금확인' as const },
        { amount: 10_000, method: '계좌이체' as const, status: '입금확인' as const },
      ],
      donationPayments: [
        { amount: 50_000, method: '현금' as const, status: '입금확인' as const },
        { amount: 30_000, method: '계좌이체' as const, status: '입금확인' as const },
      ],
    }]
    const without = fake({ participants })
    const moved = fake({ participants, bankCashWithdrawals: [withdrawal(100_000)] })
    expect(calcIncomeSummary(moved)).toEqual(calcIncomeSummary(without))
    expect(calcIncomeSummary(moved).totalIncome).toBe(110_000)
    // 통장 = 1,000,000 + 40,000(계좌이체) - 100,000(인출) / 현금 = 70,000 + 100,000
    expect(snap(moved)).toEqual([940_000, 170_000, 1_110_000])
  })

  it('인출해 온 현금은 현금 통장입금 한도에 포함된다 (인출이 없으면 한도는 예전과 같다)', () => {
    expect(validateCashDeposit(fake(), { amount: 1, status: '입금확인' }).ok).toBe(false)
    const s = fake({ bankCashWithdrawals: [withdrawal(100_000)] })
    expect(validateCashDeposit(s, { amount: 100_000, status: '입금확인' }).ok).toBe(true)
    expect(validateCashDeposit(s, { amount: 100_001, status: '입금확인' }).ok).toBe(false)
  })

  it('회원 공유문·공개 요약에는 나타나지 않고, 회장 보고문에만 (인출이 있을 때) 나온다', () => {
    const plain = fake({ status: 'confirmed', confirmedAt: '2026-01-11T00:00:00.000Z' })
    const moved = { ...plain, bankCashWithdrawals: [withdrawal(200_000)] }
    expect(buildMemberShareText(moved)).toBe(buildMemberShareText(plain))
    expect(buildPublicSummary(moved)).toEqual(buildPublicSummary(plain))
    expect(buildPresidentShareText(plain)).not.toContain('인출')
    // 인출은 현금 흐름표에서는 "현금 증가", [자금이동 내역]에서는 날짜별 기록으로 보인다
    expect(buildPresidentShareText(moved)).toContain('[자금이동 내역]\n')
    expect(buildPresidentShareText(moved)).toContain('통장 → 현금 200,000원')
    expect(buildPresidentShareText(moved)).toContain('통장에서 현금 인출\n+200,000원 → 보유 200,000원')
    expect(buildPresidentShareText(moved)).toContain('전체 보유액 : 1,000,000원')
  })
})

describe('validateBankCashWithdrawal', () => {
  it('금액 0·음수·소수·날짜 없음은 거부한다', () => {
    const ok = { amount: 1, date: '2026-01-10' }
    expect(validateBankCashWithdrawal(ok).ok).toBe(true)
    expect(validateBankCashWithdrawal({ ...ok, amount: 0 }).ok).toBe(false)
    expect(validateBankCashWithdrawal({ ...ok, amount: -5 }).ok).toBe(false)
    expect(validateBankCashWithdrawal({ ...ok, amount: 1.5 }).ok).toBe(false)
    expect(validateBankCashWithdrawal({ ...ok, date: '' }).ok).toBe(false)
  })
})

describe('store — 추가/삭제/잠금', () => {
  const get = () => useSettlementStore.getState().getById(ID)!

  it('7. 인출 기록을 추가했다가 삭제하면 잔액이 원래대로 복원된다', () => {
    const { addBankCashWithdrawal, deleteBankCashWithdrawal } = useSettlementStore.getState()
    expect(addBankCashWithdrawal(ID, { amount: 200_000, date: '2026-01-10', note: '현금 인출' }).ok).toBe(true)
    expect(withdrawalsOf(get())).toHaveLength(1)
    expect(withdrawalsOf(get())[0].id).toBeTruthy()
    expect(snap(get())).toEqual([800_000, 200_000, 1_000_000])

    expect(deleteBankCashWithdrawal(ID, withdrawalsOf(get())[0].id).ok).toBe(true)
    expect(withdrawalsOf(get())).toHaveLength(0)
    expect(snap(get())).toEqual([1_000_000, 0, 1_000_000])
  })

  it('금액 0은 저장되지 않는다', () => {
    expect(useSettlementStore.getState().addBankCashWithdrawal(ID, { amount: 0, date: '2026-01-10' }).ok).toBe(false)
    expect(withdrawalsOf(get())).toHaveLength(0)
  })

  it('8. 확정·취소 정산에서는 인출 추가/삭제가 모두 막힌다', () => {
    const w = withdrawal(70_000, 'keep')
    for (const status of ['confirmed', 'cancelled'] as const) {
      useSettlementStore.setState({ settlements: [fake({ status, bankCashWithdrawals: [w] })] })
      expect(useSettlementStore.getState().addBankCashWithdrawal(ID, { amount: 1, date: '2026-01-10' }).ok).toBe(false)
      expect(useSettlementStore.getState().deleteBankCashWithdrawal(ID, 'keep').ok).toBe(false)
      expect(withdrawalsOf(get())).toEqual([w])
    }
  })

  it('수정 상태(revised)에서는 다시 편집할 수 있다', () => {
    useSettlementStore.setState({ settlements: [fake({ status: 'revised' })] })
    expect(useSettlementStore.getState().addBankCashWithdrawal(ID, { amount: 1000, date: '2026-01-10' }).ok).toBe(true)
  })
})

describe('BankCashWithdrawalForm 화면', () => {
  it('금액을 입력해 저장하면 목록에 날짜·금액·메모가 보이고 잔액이 바뀐다', () => {
    render(<BankCashWithdrawalForm settlementId={ID} />)
    fireEvent.change(screen.getByLabelText('현금 인출 금액'), { target: { value: '200000' } })
    fireEvent.change(screen.getByLabelText('출금일'), { target: { value: '2026-01-12' } })
    fireEvent.change(screen.getByLabelText('현금 인출 메모'), { target: { value: '현금 찾음' } })
    fireEvent.click(screen.getByText('현금 인출 저장'))

    expect(screen.getByText('200,000원')).toBeInTheDocument()
    expect(screen.getByText('출금일 2026-01-12 · 현금 찾음')).toBeInTheDocument()
    // 통장·현금·전체 보유액 요약 박스는 인출 영역에서 빠지고 "현금·통장" 탭 맨 아래(현재 자금 현황)로 갔다
    expect(screen.queryByText(/통장잔액/)).not.toBeInTheDocument()
    expect(screen.queryByText(/전체 보유액/)).not.toBeInTheDocument()
    expect(snap(useSettlementStore.getState().getById(ID)!)).toEqual([800_000, 200_000, 1_000_000])
  })

  it('금액 없이 저장하면 안내가 나오고 저장되지 않는다', () => {
    render(<BankCashWithdrawalForm settlementId={ID} />)
    fireEvent.click(screen.getByText('현금 인출 저장'))
    expect(screen.getByText('금액은 0원보다 커야 합니다.')).toBeInTheDocument()
    expect(withdrawalsOf(useSettlementStore.getState().getById(ID)!)).toHaveLength(0)
  })

  it('삭제 버튼은 확인창을 띄우고, 취소하면 남고 확인하면 지워진다', () => {
    useSettlementStore.setState({ settlements: [fake({ bankCashWithdrawals: [withdrawal(30_000, 'x')] })] })
    render(<BankCashWithdrawalForm settlementId={ID} />)
    const confirmSpy = vi.spyOn(window, 'confirm')
    confirmSpy.mockReturnValueOnce(false)
    fireEvent.click(screen.getByText('삭제'))
    expect(withdrawalsOf(useSettlementStore.getState().getById(ID)!)).toHaveLength(1)
    confirmSpy.mockReturnValueOnce(true)
    fireEvent.click(screen.getByText('삭제'))
    expect(withdrawalsOf(useSettlementStore.getState().getById(ID)!)).toHaveLength(0)
    confirmSpy.mockRestore()
  })

  it('확정된 정산에서는 입력창·삭제 버튼이 보이지 않고 목록만 보인다', () => {
    useSettlementStore.setState({ settlements: [fake({ status: 'confirmed', bankCashWithdrawals: [withdrawal(30_000, 'x')] })] })
    render(<BankCashWithdrawalForm settlementId={ID} />)
    expect(screen.queryByText('현금 인출 저장')).not.toBeInTheDocument()
    expect(screen.queryByText('삭제')).not.toBeInTheDocument()
    expect(screen.getByText('30,000원')).toBeInTheDocument()
  })

  it('인출하면 통장이 모자라는 경우(통장잔액 마이너스)에는 인출 영역에 경고가 보인다', () => {
    useSettlementStore.setState({ settlements: [fake({ prevBankBalance: 100_000, bankCashWithdrawals: [withdrawal(300_000)] })] })
    render(<BankCashWithdrawalForm settlementId={ID} />)
    expect(screen.getByText(/통장잔액이 마이너스입니다/)).toBeInTheDocument()
    expect(screen.queryByText(/현금잔액이 마이너스/)).not.toBeInTheDocument()
  })
})

describe('"현금·통장" 탭 — 같은 거래를 두 군데 입력할 수 없다', () => {
  it('① 인출 입력은 하나, ② 입금 입력은 하나뿐이고, 인출 폼에는 입금(현금→통장) 입력이 없다', () => {
    render(<SettlementTab devMembers={[]} devSessions={[]} />)
    fireEvent.click(screen.getByRole('button', { name: /현금/ }))

    expect(screen.getByText('① 통장에서 현금 인출')).toBeInTheDocument()
    expect(screen.getByText('② 현금을 통장에 입금')).toBeInTheDocument()
    // 인출 입력 버튼 1개, 입금 입력 버튼 1개 — 방향 선택 버튼(통장→현금 / 현금→통장)은 존재하지 않는다
    expect(screen.getAllByRole('button', { name: '현금 인출 저장' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: '통장 입금 저장' })).toHaveLength(1)
    expect(screen.queryByText('현금 → 통장')).not.toBeInTheDocument()
    expect(screen.queryByText('통장 → 현금')).not.toBeInTheDocument()
    expect(screen.getAllByPlaceholderText('입금액')).toHaveLength(1)
    expect(screen.getAllByLabelText('현금 인출 금액')).toHaveLength(1)
  })

  it('② 기존 현금 통장 입금으로 입력해도 인출 목록에는 들어가지 않고 통장·현금에 한 번만 반영된다', () => {
    useSettlementStore.setState({ settlements: [fake({ bankCashWithdrawals: [withdrawal(200_000)] })] })
    render(<SettlementTab devMembers={[]} devSessions={[]} />)
    fireEvent.click(screen.getByRole('button', { name: /현금/ }))
    fireEvent.change(screen.getByPlaceholderText('입금액'), { target: { value: '100000' } })
    fireEvent.click(screen.getByRole('button', { name: '통장 입금 저장' }))

    const s = useSettlementStore.getState().getById(ID)!
    expect(s.cashDeposits).toHaveLength(1)
    expect(withdrawalsOf(s)).toHaveLength(1)
    expect(snap(s)).toEqual([900_000, 100_000, 1_000_000])
  })
})

describe('SettlementSummary — 자금 현황', () => {
  it('총수입·총지출·통장잔액·현금잔액·전체 보유액이 보이고 인출 줄이 추가된다', () => {
    useSettlementStore.setState({
      settlements: [fake({ bankCashWithdrawals: [withdrawal(200_000)], expenses: [cashExpense(50_000)] })],
    })
    render(<SettlementSummary settlementId={ID} />)
    expect(screen.getByText('💼 자금 현황 (관리자 전용)')).toBeInTheDocument()
    for (const label of ['총수입', '총지출', '통장잔액', '현금잔액', '전체 보유액']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
    expect(screen.getAllByText('800,000원').length).toBeGreaterThan(0)
    expect(screen.getAllByText('150,000원').length).toBeGreaterThan(0)
    expect(screen.getAllByText('950,000원').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/통장에서 현금 인출/).length).toBeGreaterThan(0)
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'

// settlementSync(Firestore 실제 호출부)를 통째로 모킹 — 실제 Firebase에 절대 접근하지 않는다.
vi.mock('../src/lib/settlementSync', () => ({
  saveSettlement: vi.fn().mockResolvedValue(1),
  listSettlements: vi.fn(),
  getSettlement: vi.fn(),
}))

import {
  calcIncomeSummary, calcExpenseSummary, calcProfitSummary, calcCashSummary, calcBankSummary, calcHoldingsSummary,
  validateCashDeposit,
} from '../src/logic/settlement'
import { CashOnHandSummary, CurrentFundStatus } from '../src/components/settlement/CashOnHandSummary'
import { CashDepositForm } from '../src/components/settlement/CashDepositForm'
import { SettlementSharePreview } from '../src/components/settlement/SettlementSharePreview'
import { SettlementSummary } from '../src/components/settlement/SettlementSummary'
import { SettlementTab } from '../src/tabs/SettlementTab'
import { useSettlementStore } from '../src/store/settlementStore'
import { useAdminAuthStore } from '../src/store/adminAuthStore'
import { useApp } from '../src/store/appStore'
import type { RegularSettlement, SettlementExpense, SettlementParticipant, CashDeposit, BankCashWithdrawal } from '../src/types/settlement'

// 아래 이름·ID·금액은 전부 테스트용 가상 데이터이며 실제 회원·회계 정보가 아니다.

const ID = 'settle-cash-on-hand-1'

function fake(over: Partial<RegularSettlement> = {}): RegularSettlement {
  return {
    id: ID, meetingName: '가상 정기모임', meetingDate: '2026-10-05', meetingType: 'regular', status: 'draft',
    participants: [], expenses: [], dinnerContributions: [], cashDeposits: [],
    prevBankBalance: 5_000_000, otherBankAdjustment: 0,
    createdAt: '2026-10-01T00:00:00.000Z', version: 1, revisionLog: [],
    ...over,
  }
}

const guest = (id: string, extra: Partial<SettlementParticipant>): SettlementParticipant => ({
  id, participantType: 'guest', memberId: null, displayName: `가상${id}`, addedVia: 'manually_added_guest', ...extra,
})
const expense = (amount: number, method: SettlementExpense['method'] = '현금', id = `e-${method}-${amount}`): SettlementExpense => ({
  id, date: '2026-10-05', label: '가상지출', category: '기타', amount, method, clubShare: amount, personalDonation: 0,
})
const deposit = (amount: number, status: CashDeposit['status'] = '입금확인', id = `d-${amount}-${status}`): CashDeposit => ({
  id, depositDate: '2026-10-06', amount, status,
})
const withdrawal = (amount: number, id = `w-${amount}`): BankCashWithdrawal => ({ id, date: '2026-10-05', amount })

beforeEach(() => {
  useSettlementStore.setState({ settlements: [fake()], currentId: ID, syncStatus: 'idle', lastSyncError: null })
  useAdminAuthStore.setState({ status: 'authorizedAdmin', uid: 'fake-admin-uid', email: 'fake-admin@example.test', adminDisplayName: '가상관리자', errorMessage: null })
  useApp.setState({ members: [], sessions: [], settings: { lastBackupAt: null }, ledger: [] })
})

const valueOf = (box: HTMLElement, label: string) => within(box).getByText(label).parentElement as HTMLElement
const summaryBox = () => screen.getByTestId('cash-on-hand-summary')
const renderSummary = (s: RegularSettlement, pending?: { amount: number; replaces: number }) =>
  render(<CashOnHandSummary settlement={s} pendingDeposit={pending} />)

describe('현재 보유 현금 = 받은 현금 + 통장 인출 − 현금 지출 − 통장 입금', () => {
  it('요청 예시: 받은 870,000 + 인출 1,200,000 − 지출 1,920,000 − 입금 150,000 = 0원, 각 항목이 따로 보인다', () => {
    const s = fake({
      participants: [guest('A', { dues: { amount: 600_000, method: '현금', status: '입금확인' } }), guest('B', { donation: { amount: 270_000, method: '현금', status: '입금확인' } })],
      bankCashWithdrawals: [withdrawal(1_200_000)],
      expenses: [expense(1_920_000)],
      cashDeposits: [deposit(150_000)],
    })
    renderSummary(s)
    const box = summaryBox()
    expect(valueOf(box, '현금으로 받은 금액')).toHaveTextContent('870,000원')
    expect(valueOf(box, '통장에서 인출한 금액')).toHaveTextContent('1,200,000원')
    expect(valueOf(box, '현금으로 지출한 금액')).toHaveTextContent('1,920,000원')
    expect(valueOf(box, '통장에 입금한 금액')).toHaveTextContent('150,000원')
    expect(valueOf(box, '현재 보유 현금')).toHaveTextContent('0원')
    expect(calcCashSummary(s).cashBalance).toBe(0)
  })

  it('1. 현금 수입만 있으면 현재 보유 현금이 그 금액이다', () => {
    renderSummary(fake({ participants: [guest('A', { dues: { amount: 500_000, method: '현금', status: '입금확인' } })] }))
    expect(valueOf(summaryBox(), '현금으로 받은 금액')).toHaveTextContent('500,000원')
    expect(valueOf(summaryBox(), '현재 보유 현금')).toHaveTextContent('500,000원')
  })

  it('2. 통장에서 현금 인출을 추가하면 현재 보유 현금이 늘어난다', () => {
    const base = fake({ participants: [guest('A', { dues: { amount: 500_000, method: '현금', status: '입금확인' } })] })
    expect(calcCashSummary(base).cashBalance).toBe(500_000)
    expect(calcCashSummary({ ...base, bankCashWithdrawals: [withdrawal(200_000)] }).cashBalance).toBe(700_000)
    renderSummary({ ...base, bankCashWithdrawals: [withdrawal(200_000)] })
    expect(valueOf(summaryBox(), '현재 보유 현금')).toHaveTextContent('700,000원')
  })

  it('3. 현금 지출이 있으면 현재 보유 현금이 줄어든다', () => {
    const s = fake({ participants: [guest('A', { dues: { amount: 500_000, method: '현금', status: '입금확인' } })], expenses: [expense(120_000)] })
    renderSummary(s)
    expect(valueOf(summaryBox(), '현금으로 지출한 금액')).toHaveTextContent('120,000원')
    expect(valueOf(summaryBox(), '현재 보유 현금')).toHaveTextContent('380,000원')
  })

  it('4. 현금→통장 입금(입금확인)이 있으면 줄어들고, 입금예정·취소는 반영하지 않는다', () => {
    const base = fake({ participants: [guest('A', { dues: { amount: 500_000, method: '현금', status: '입금확인' } })] })
    const { unmount } = renderSummary({ ...base, cashDeposits: [deposit(100_000), deposit(70_000, '입금예정'), deposit(60_000, '취소')] })
    expect(valueOf(summaryBox(), '통장에 입금한 금액')).toHaveTextContent('100,000원')
    expect(valueOf(summaryBox(), '현재 보유 현금')).toHaveTextContent('400,000원')
    unmount()
  })

  it('5. 통장 인출·현금 입금(자금이동)만으로는 전체 보유액이 변하지 않는다', () => {
    const base = fake({ participants: [guest('A', { dues: { amount: 500_000, method: '현금', status: '입금확인' } })] })
    const total = calcHoldingsSummary(base).totalHoldings
    const moved = { ...base, bankCashWithdrawals: [withdrawal(300_000)], cashDeposits: [deposit(120_000)] }
    expect(calcHoldingsSummary(moved).totalHoldings).toBe(total)
    render(<CurrentFundStatus settlement={moved} />)
    expect(valueOf(screen.getByTestId('current-fund-status'), '전체 보유액')).toHaveTextContent(`${total.toLocaleString('ko-KR')}원`)
  })

  it('6. 계좌이체·기타 수입은 "현금으로 받은 금액"에 들어가지 않는다 (미확인 계좌이체 포함)', () => {
    const s = fake({
      participants: [
        guest('A', { dues: { amount: 100_000, method: '현금', status: '입금확인' } }),
        guest('B', { dues: { amount: 40_000, method: '계좌이체', status: '입금확인' }, donation: { amount: 30_000, method: '계좌이체', status: '미확인' } }),
        guest('C', { donation: { amount: 20_000, method: '기타', status: '입금확인' } }),
      ],
    })
    renderSummary(s)
    expect(valueOf(summaryBox(), '현금으로 받은 금액')).toHaveTextContent('100,000원')
    expect(valueOf(summaryBox(), '현재 보유 현금')).toHaveTextContent('100,000원')
  })

  it('7. 체크카드·계좌이체·기타 지출은 "현금으로 지출한 금액"에 들어가지 않는다', () => {
    const s = fake({
      participants: [guest('A', { dues: { amount: 100_000, method: '현금', status: '입금확인' } })],
      expenses: [expense(10_000, '현금'), expense(20_000, '체크카드'), expense(30_000, '계좌이체'), expense(40_000, '기타')],
    })
    renderSummary(s)
    expect(valueOf(summaryBox(), '현금으로 지출한 금액')).toHaveTextContent(/^현금으로 지출한 금액10,000원$/)
    expect(valueOf(summaryBox(), '현재 보유 현금')).toHaveTextContent('90,000원')
  })

  it('8. 현금이 모자라면 "-1,050,000원 잔액" 대신 "현금 부족 1,050,000원"과 확인 안내가 나온다', () => {
    renderSummary(fake({ expenses: [expense(1_050_000)] }))
    const box = summaryBox()
    expect(valueOf(box, '현재 보유 현금')).toHaveTextContent('현금 부족 1,050,000원')
    expect(box).toHaveTextContent('현금으로 지출한 금액이 현재 확인된 현금보다 많습니다.')
    expect(box).toHaveTextContent('현금 수입, 통장 인출 또는 지출 내역을 확인해 주세요.')
    expect(box.textContent).not.toMatch(/-\s?1,050,000/)
    expect(box.textContent).not.toContain('입금 전 현금 잔액')
  })

  it('현금이 0원 이상이면 부족 문구와 확인 안내는 나오지 않는다', () => {
    renderSummary(fake({ participants: [guest('A', { dues: { amount: 10_000, method: '현금', status: '입금확인' } })] }))
    expect(summaryBox().textContent).not.toContain('현금 부족')
    expect(summaryBox().textContent).not.toContain('확인해 주세요')
  })

  it('9. 기존 총수입·총지출·통장잔액·현금잔액·전체 보유액 계산값은 변하지 않는다 (손으로 계산한 값과 비교)', () => {
    const s = fake({
      prevBankBalance: 1_000_000,
      participants: [
        guest('A', { dues: { amount: 80_000, method: '현금', status: '입금확인' } }),
        guest('B', { dues: { amount: 20_000, method: '계좌이체', status: '입금확인' } }),
      ],
      expenses: [expense(50_000, '현금'), expense(5_000, '체크카드')],
      cashDeposits: [deposit(10_000)],
      bankCashWithdrawals: [withdrawal(200_000)],
    })
    expect(calcIncomeSummary(s).totalIncome).toBe(100_000)
    expect(calcExpenseSummary(s).total).toBe(55_000)
    expect(calcProfitSummary(s).netProfit).toBe(45_000)
    // 통장 = 1,000,000 + 20,000(계좌이체) + 10,000(현금입금) − 5,000(카드) − 200,000(인출) = 825,000
    expect(calcBankSummary(s).currentBalance).toBe(825_000)
    // 현금 = 80,000 − 50,000 − 10,000 + 200,000 = 220,000
    expect(calcCashSummary(s)).toMatchObject({ cashIncome: 80_000, cashExpense: 50_000, confirmedDeposit: 10_000, bankWithdrawal: 200_000, cashBalance: 220_000 })
    expect(calcHoldingsSummary(s)).toEqual({ bankBalance: 825_000, cashBalance: 220_000, totalHoldings: 1_045_000 })
    // 화면은 같은 값을 보여줄 뿐이다
    renderSummary(s)
    expect(valueOf(summaryBox(), '현재 보유 현금')).toHaveTextContent('220,000원')
  })

  it('인출 기록이 없는 예전 정산: 화면의 현재 보유 현금이 기존 "입금 후 현금 잔액"과 같다', () => {
    const legacy = fake({
      participants: [guest('A', { dues: { amount: 30_000, method: '현금', status: '입금확인' } })],
      expenses: [expense(5_000)], cashDeposits: [deposit(10_000)],
    })
    const cash = calcCashSummary(legacy)
    expect(cash.cashBalance).toBe(cash.cashBalanceAfterDeposit)
    renderSummary(legacy)
    expect(valueOf(summaryBox(), '현재 보유 현금')).toHaveTextContent(`${cash.cashBalanceAfterDeposit.toLocaleString('ko-KR')}원`)
  })
})

describe('② 현금을 통장에 입금 — 입금액을 입력 중일 때', () => {
  const base = () => fake({ participants: [guest('A', { dues: { amount: 500_000, method: '현금', status: '입금확인' } })] })

  it('옛 표현("입금 전 현금 잔액"·"입금 후 현금 잔액"·"입금 확인 합계")은 더 이상 나오지 않는다', () => {
    useSettlementStore.setState({ settlements: [base()] })
    render(<CashDepositForm settlementId={ID} />)
    for (const old of ['입금 전 현금 잔액', '입금 후 현금 잔액', '입금 확인 합계']) {
      expect(screen.queryByText(new RegExp(old))).not.toBeInTheDocument()
    }
    expect(screen.getByText('💵 현재 현금 현황')).toBeInTheDocument()
  })

  it('입금액을 입력하면 "이번 입금액"과 "입금 후 보유 현금"이 나타나고, 비우면 사라진다', () => {
    useSettlementStore.setState({ settlements: [base()] })
    render(<CashDepositForm settlementId={ID} />)
    expect(within(summaryBox()).queryByText('이번 입금액')).not.toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('입금액'), { target: { value: '150000' } })
    expect(valueOf(summaryBox(), '현재 보유 현금')).toHaveTextContent('500,000원')
    expect(valueOf(summaryBox(), '이번 입금액')).toHaveTextContent('150,000원')
    expect(valueOf(summaryBox(), '입금 후 보유 현금')).toHaveTextContent('350,000원')
    fireEvent.change(screen.getByPlaceholderText('입금액'), { target: { value: '' } })
    expect(within(summaryBox()).queryByText('입금 후 보유 현금')).not.toBeInTheDocument()
  })

  it('입금확인이 아닌 상태(입금예정 등)는 현금이 줄지 않으므로 입금 후 보유 현금을 보여주지 않는다', () => {
    useSettlementStore.setState({ settlements: [base()] })
    render(<CashDepositForm settlementId={ID} />)
    fireEvent.change(screen.getByPlaceholderText('입금액'), { target: { value: '150000' } })
    fireEvent.change(screen.getByDisplayValue('입금확인'), { target: { value: '입금예정' } })
    expect(within(summaryBox()).queryByText('입금 후 보유 현금')).not.toBeInTheDocument()
  })

  it('보유 현금보다 큰 금액을 넣으면 입금 후 "현금 부족"으로 보이고, 저장은 기존처럼 막히며 안내 문구에 음수 잔액이 없다', () => {
    useSettlementStore.setState({ settlements: [base()] })
    render(<CashDepositForm settlementId={ID} />)
    fireEvent.change(screen.getByPlaceholderText('입금액'), { target: { value: '620000' } })
    expect(valueOf(summaryBox(), '입금 후 보유 현금')).toHaveTextContent('현금 부족 120,000원')
    fireEvent.click(screen.getByRole('button', { name: '통장 입금 저장' }))
    expect(useSettlementStore.getState().getById(ID)!.cashDeposits).toHaveLength(0)
    expect(screen.getByText(/입금 확인 금액 합계\(620,000원\)가 입금할 수 있는 현금\(500,000원\)보다 많습니다/)).toBeInTheDocument()
  })

  it('이미 현금이 부족한 상태에서 입금하려 하면 "현금이 N원 부족" 안내가 나온다 (음수 잔액 표현 없음)', () => {
    const s = fake({ expenses: [expense(1_050_000)] })
    const v = validateCashDeposit(s, { amount: 1, status: '입금확인' })
    expect(v).toEqual({ ok: false, error: '현금이 1,050,000원 부족해서 입금할 수 없습니다. 현금 지출 또는 입금 내역을 확인해 주세요.' })
    expect(v.ok === false && v.error).not.toMatch(/-1,050,000/)
  })

  it('입금 내역을 수정할 때는 기존 입금액을 되돌려서 계산한다 (이중으로 빼지 않는다)', () => {
    useSettlementStore.setState({ settlements: [{ ...base(), cashDeposits: [deposit(100_000, '입금확인', 'dep1')] }] })
    render(<CashDepositForm settlementId={ID} />)
    expect(valueOf(summaryBox(), '현재 보유 현금')).toHaveTextContent('400,000원')
    fireEvent.click(screen.getByRole('button', { name: '수정' }))
    // 폼에는 기존 100,000원이 채워져 있다 → 입금 후 보유 현금 = 400,000 + 100,000 − 100,000
    expect(valueOf(summaryBox(), '입금 후 보유 현금')).toHaveTextContent('400,000원')
    fireEvent.change(screen.getByPlaceholderText('입금액'), { target: { value: '150000' } })
    expect(valueOf(summaryBox(), '입금 후 보유 현금')).toHaveTextContent('350,000원')
  })
})

describe('"현금·통장" 탭 구성', () => {
  it('10. 맨 아래에 "현재 자금 현황"(통장잔액·보유 현금·전체 보유액)이 있고, 인출 영역의 녹색박스는 없다', () => {
    useSettlementStore.setState({
      settlements: [fake({
        participants: [guest('A', { dues: { amount: 500_000, method: '현금', status: '입금확인' } })],
        bankCashWithdrawals: [withdrawal(200_000)],
      })],
    })
    render(<SettlementTab devMembers={[]} devSessions={[]} />)
    fireEvent.click(screen.getByRole('button', { name: /현금/ }))

    const status = screen.getByTestId('current-fund-status')
    expect(status).toHaveTextContent('현재 자금 현황')
    expect(valueOf(status, '통장잔액')).toHaveTextContent('4,800,000원')
    expect(valueOf(status, '보유 현금')).toHaveTextContent('700,000원')
    expect(valueOf(status, '전체 보유액')).toHaveTextContent('5,500,000원')

    // 탭 안에서 가장 마지막 카드다 (자금이동 내역보다도 아래)
    const tab = status.closest('.tab') as HTMLElement
    expect(tab.lastElementChild).toBe(status)
    const log = screen.getByTestId('fund-movement-log')
    expect(log.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    // ① 인출 영역에는 통장잔액·전체 보유액 요약이 없다
    const withdrawalCard = screen.getByText('① 통장에서 현금 인출').closest('.card') as HTMLElement
    expect(within(withdrawalCard).queryByText(/통장잔액/)).not.toBeInTheDocument()
    expect(within(withdrawalCard).queryByText(/전체 보유액/)).not.toBeInTheDocument()
    // ② 영역에는 현재 보유 현금 박스가 있다
    expect(screen.getByTestId('cash-on-hand-summary')).toBeInTheDocument()
    // 이 탭에 "현재 자금 현황"은 하나뿐이다
    expect(screen.getAllByText(/현재 자금 현황/)).toHaveLength(1)
  })

  it('현재 자금 현황: 현금이 모자라면 "현금 부족"으로 표시하고 확인 안내가 나온다', () => {
    render(<CurrentFundStatus settlement={fake({ expenses: [expense(1_050_000)] })} />)
    const status = screen.getByTestId('current-fund-status')
    expect(valueOf(status, '보유 현금')).toHaveTextContent('현금 부족 1,050,000원')
    expect(status.textContent).not.toMatch(/-\s?1,050,000/)
    expect(status).toHaveTextContent('현금으로 지출한 금액이 현재 확인된 현금보다 많습니다.')
    expect(status).toHaveTextContent('현금 수입, 통장 인출 또는 지출 내역을 확인해 주세요.')
    expect(valueOf(status, '전체 보유액')).toHaveTextContent('3,950,000원')
  })
})

describe('"현금·통장" 탭 최종 문구와 배치', () => {
  const full = () => fake({
    participants: [guest('A', { dues: { amount: 600_000, method: '현금', status: '입금확인' } }), guest('B', { donation: { amount: 270_000, method: '현금', status: '입금확인' } })],
    bankCashWithdrawals: [{ id: 'w1', date: '2026-09-30', amount: 1_200_000, note: '상품 및 예비비 현금 인출' }],
    expenses: [expense(1_920_000)],
    cashDeposits: [{ id: 'd1', depositDate: '2026-10-06', amount: 150_000, status: '입금확인', note: '예비비 잔액 입금' }],
  })
  const openCashTab = () => {
    useSettlementStore.setState({ settlements: [full()] })
    render(<SettlementTab devMembers={[]} devSessions={[]} />)
    fireEvent.click(screen.getByRole('button', { name: /현금/ }))
  }
  const follows = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

  it('화면 순서: ① 통장에서 현금 인출 → ② 현금을 통장에 입금 → 📒 자금이동 내역 → 현재 자금 현황', () => {
    openCashTab()
    const one = screen.getByText('① 통장에서 현금 인출')
    const two = screen.getByText('② 현금을 통장에 입금')
    const log = screen.getByText('📒 자금이동 내역')
    const fund = screen.getByText('💼 현재 자금 현황')
    expect(follows(one, two)).toBe(true)
    expect(follows(two, log)).toBe(true)
    expect(follows(log, fund)).toBe(true)
    // "현재 현금 현황" 박스는 ② 영역 안에 있다
    const cashBox = screen.getByText('💵 현재 현금 현황')
    expect(follows(two, cashBox)).toBe(true)
    expect(follows(cashBox, log)).toBe(true)
    expect(two.parentElement).toContainElement(cashBox)
  })

  it('① 안내문·입력 항목(출금일·인출 금액·메모)·버튼·목록 표시가 최종안과 같다', () => {
    openCashTab()
    const card = screen.getByText('① 통장에서 현금 인출').closest('.card') as HTMLElement
    expect(card).toHaveTextContent('통장에서 현금을 찾아 보관하거나 행사비로 사용할 때 기록해 주세요.')
    expect(card).toHaveTextContent('이 금액은 수입이나 지출로 계산되지 않고, 통장 잔액은 줄고 보유 현금은 늘어납니다.')
    for (const label of ['출금일', '인출 금액', '메모']) expect(within(card).getByText(label)).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: '현금 인출 저장' })).toBeInTheDocument()
    const item = within(card).getByText('통장에서 현금 인출').closest('.card') as HTMLElement
    expect(item).toHaveTextContent('1,200,000원')
    expect(item).toHaveTextContent('출금일 2026-09-30 · 상품 및 예비비 현금 인출')
  })

  it('② 안내문·현재 현금 현황·입력 항목(입금일·입금 금액·메모)·버튼·목록 표시가 최종안과 같다', () => {
    openCashTab()
    const two = screen.getByText('② 현금을 통장에 입금').parentElement as HTMLElement
    expect(two).toHaveTextContent('현재 보유하고 있는 현금 중 통장에 입금한 금액을 기록해 주세요.')
    expect(two).toHaveTextContent('입금한 금액만큼 보유 현금은 줄고 통장 잔액은 늘어납니다.')
    const box = within(two).getByTestId('cash-on-hand-summary')
    expect(valueOf(box, '현금으로 받은 금액')).toHaveTextContent('870,000원')
    expect(valueOf(box, '통장에서 인출한 금액')).toHaveTextContent('1,200,000원')
    expect(valueOf(box, '현금으로 지출한 금액')).toHaveTextContent('1,920,000원')
    expect(valueOf(box, '통장에 입금한 금액')).toHaveTextContent('150,000원')
    expect(valueOf(box, '현재 보유 현금')).toHaveTextContent(/0원$/)
    for (const label of ['입금일', '입금 금액', '메모']) expect(within(two).getByText(label)).toBeInTheDocument()
    expect(within(two).getByRole('button', { name: '통장 입금 저장' })).toBeInTheDocument()
    expect(within(two).queryByRole('button', { name: '입금 추가' })).not.toBeInTheDocument()
    const item = within(two).getByText('현금을 통장에 입금').closest('.card') as HTMLElement
    expect(item).toHaveTextContent('150,000원')
    expect(item).toHaveTextContent('입금일 2026-10-06 · 예비비 잔액 입금')
  })

  it('현재 현금 현황은 입금액을 입력하기 전에는 "이번 입금액 / 입금 후 보유 현금"을 숨긴다', () => {
    openCashTab()
    expect(within(summaryBox()).queryByText('이번 입금액')).not.toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('입금액'), { target: { value: '100000' } })
    expect(valueOf(summaryBox(), '이번 입금액')).toHaveTextContent('100,000원')
    // 현재 보유 현금이 0이므로 입금 후에는 현금 부족 + 입금 금액 확인 안내
    expect(valueOf(summaryBox(), '입금 후 보유 현금')).toHaveTextContent('현금 부족 100,000원')
    expect(summaryBox()).toHaveTextContent('입금하려는 금액이 현재 보유 현금보다 많습니다.')
    expect(summaryBox().textContent).not.toContain('현금으로 지출한 금액이 현재 확인된 현금보다 많습니다')
  })

  it('현재 자금 현황 안내문과 값(통장잔액·보유 현금·전체 보유액)', () => {
    openCashTab()
    const status = screen.getByTestId('current-fund-status')
    expect(status).toHaveTextContent('통장과 현금을 합한 현재 전체 보유액입니다.')
    expect(status).toHaveTextContent('현금 인출·입금은 자금의 위치만 바뀌므로 전체 보유액에는 영향을 주지 않습니다.')
    // 통장 = 5,000,000 − 1,200,000 + 150,000 = 3,950,000 / 현금 0 / 전체 3,950,000
    expect(valueOf(status, '통장잔액')).toHaveTextContent('3,950,000원')
    expect(valueOf(status, '보유 현금')).toHaveTextContent('0원')
    expect(valueOf(status, '전체 보유액')).toHaveTextContent('3,950,000원')
  })

  it('현재 현금 현황의 계산값은 기존 계산(calcCashSummary·calcHoldingsSummary)과 같다', () => {
    const s = full()
    expect(calcCashSummary(s)).toMatchObject({ cashIncome: 870_000, bankWithdrawal: 1_200_000, cashExpense: 1_920_000, confirmedDeposit: 150_000, cashBalance: 0 })
    expect(calcHoldingsSummary(s)).toEqual({ bankBalance: 3_950_000, cashBalance: 0, totalHoldings: 3_950_000 })
    expect(calcIncomeSummary(s).totalIncome).toBe(870_000)
    expect(calcExpenseSummary(s).total).toBe(1_920_000)
  })
})

describe('집계/확정 탭 — 현금 부족 문구 통일', () => {
  it('현금이 모자라면 "현금잔액이 마이너스입니다" 대신 "현금 부족 N원"과 확인 안내가 나오고, 음수 숫자는 보이지 않는다', () => {
    useSettlementStore.setState({ settlements: [fake({ expenses: [expense(1_050_000)] })] })
    render(<SettlementSummary settlementId={ID} />)
    const card = screen.getByText('💼 자금 현황 (관리자 전용)').closest('.card') as HTMLElement
    expect(valueOf(card, '현금잔액')).toHaveTextContent('현금 부족 1,050,000원')
    expect(card).toHaveTextContent('현금 수입, 통장 인출 또는 지출 내역을 확인해 주세요.')
    expect(document.body.textContent).not.toContain('현금잔액이 마이너스입니다')
    // (모임 순익 −1,050,000원은 현금이 아니라 손익이라 그대로 음수로 표시된다)
    expect(card.textContent).not.toMatch(/-\s?1,050,000/)
    // 현금 관리 카드의 입금 전·후 잔액도 같은 표현
    const cashCard = screen.getByText('현금 관리').closest('.card') as HTMLElement
    expect(cashCard.textContent).not.toMatch(/-\s?1,050,000/)
    expect(cashCard).toHaveTextContent('입금 후 현금 잔액 현금 부족 1,050,000원')
    // 전체 보유액 계산은 그대로(통장 5,000,000 + 현금 −1,050,000 = 3,950,000)
    expect(valueOf(card, '전체 보유액')).toHaveTextContent('3,950,000원')
  })

  it('경고 조건은 그대로 — 현금이 0원 이상이면 부족 표현도 안내도 나오지 않는다', () => {
    useSettlementStore.setState({ settlements: [fake({ participants: [guest('A', { dues: { amount: 10_000, method: '현금', status: '입금확인' } })] })] })
    render(<SettlementSummary settlementId={ID} />)
    expect(document.body.textContent).not.toContain('현금 부족')
    expect(document.body.textContent).not.toContain('현금 수입, 통장 인출 또는 지출 내역을 확인해 주세요.')
    const card = screen.getByText('💼 자금 현황 (관리자 전용)').closest('.card') as HTMLElement
    expect(valueOf(card, '현금잔액')).toHaveTextContent('10,000원')
  })

  it('통장잔액 경고(통장이 마이너스)는 예전 문구·조건 그대로다', () => {
    useSettlementStore.setState({ settlements: [fake({ prevBankBalance: 100_000, bankCashWithdrawals: [withdrawal(300_000)] })] })
    render(<SettlementSummary settlementId={ID} />)
    expect(screen.getByText(/통장잔액이 마이너스입니다/)).toBeInTheDocument()
  })
})

describe('12. 공유 탭 선택 버튼 터치 높이', () => {
  it('회원용 / 회장 보고용 / 찬조 상세내역 버튼의 최소 높이가 44px 이상이다', () => {
    useSettlementStore.setState({ settlements: [fake()] })
    render(<SettlementSharePreview settlementId={ID} />)
    const seg = document.querySelector('.seg') as HTMLElement
    const buttons = within(seg).getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual(['회원용', '회장 보고용', '찬조 상세내역'])
    for (const b of buttons) expect(parseInt(b.style.minHeight, 10)).toBeGreaterThanOrEqual(44)
  })
})

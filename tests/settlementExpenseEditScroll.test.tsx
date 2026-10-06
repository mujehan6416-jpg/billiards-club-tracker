import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'

// settlementSync(Firestore 실제 호출부)를 통째로 모킹 — 실제 Firebase에 절대 접근하지 않는다.
vi.mock('../src/lib/settlementSync', () => ({
  saveSettlement: vi.fn().mockResolvedValue(1),
  listSettlements: vi.fn(),
  getSettlement: vi.fn(),
}))

import { SettlementExpenseForm } from '../src/components/settlement/SettlementExpenseForm'
import { SettlementTab } from '../src/tabs/SettlementTab'
import { calcExpenseSummary, calcProfitSummary, calcHoldingsSummary } from '../src/logic/settlement'
import { scrollToElement } from '../src/lib/scrollToElement'
import { useSettlementStore } from '../src/store/settlementStore'
import { useAdminAuthStore } from '../src/store/adminAuthStore'
import { useApp } from '../src/store/appStore'
import type { RegularSettlement, SettlementExpense } from '../src/types/settlement'

// 아래 이름·ID·금액은 전부 테스트용 가상 데이터이며 실제 회원·회계 정보가 아니다.

const ID = 'settle-expense-edit-1'

const exp = (over: Partial<SettlementExpense> = {}): SettlementExpense => ({
  id: 'e1', date: '2026-10-05', label: '당구장 대관료', category: '당구비', amount: 100_000, method: '체크카드',
  paidBy: '가상총무', clubShare: 80_000, personalDonation: 20_000, note: '10월 대관', ...over,
})

function fake(over: Partial<RegularSettlement> = {}): RegularSettlement {
  return {
    id: ID, meetingName: '가상 정기모임', meetingDate: '2026-10-05', meetingType: 'regular', status: 'draft',
    participants: [], expenses: [exp(), exp({ id: 'e2', label: '다과', category: '다과비', amount: 30_000, method: '현금', paidBy: undefined, clubShare: 30_000, personalDonation: 0, note: undefined })],
    dinnerContributions: [], cashDeposits: [], prevBankBalance: 500_000, otherBankAdjustment: 0,
    createdAt: '2026-10-01T00:00:00.000Z', version: 1, revisionLog: [],
    ...over,
  }
}

const scrollSpy = vi.fn()
const origScrollIntoView = Element.prototype.scrollIntoView

beforeEach(() => {
  scrollSpy.mockReset()
  Element.prototype.scrollIntoView = scrollSpy as unknown as typeof Element.prototype.scrollIntoView
  useSettlementStore.setState({ settlements: [fake()], currentId: ID, syncStatus: 'idle', lastSyncError: null })
  useAdminAuthStore.setState({ status: 'authorizedAdmin', uid: 'fake-admin-uid', email: 'fake-admin@example.test', adminDisplayName: '가상관리자', errorMessage: null })
  useApp.setState({ members: [], sessions: [], settings: { lastBackupAt: null }, ledger: [] })
})

afterEach(() => {
  Element.prototype.scrollIntoView = origScrollIntoView
})

const editButtons = () => screen.getAllByRole('button', { name: '수정' })
const state = () => useSettlementStore.getState().getById(ID)!
const lastScrollTarget = () => scrollSpy.mock.contexts[scrollSpy.mock.contexts.length - 1] as HTMLElement

describe('지출 "수정" — 기존 값이 수정 폼에 채워진다', () => {
  it('1. 날짜·항목명·분류·금액·결제수단·결제자·모임부담액·개인찬조액·비고가 정확히 채워진다', () => {
    render(<SettlementExpenseForm settlementId={ID} />)
    fireEvent.click(editButtons()[0])

    expect((screen.getByDisplayValue('2026-10-05') as HTMLInputElement).type).toBe('date')
    expect(screen.getByDisplayValue('당구장 대관료')).toBeInTheDocument()
    expect((screen.getByDisplayValue('당구비') as HTMLSelectElement).tagName).toBe('SELECT')
    expect((screen.getByLabelText('금액') as HTMLInputElement).value).toBe('100,000')
    expect((screen.getByDisplayValue('체크카드') as HTMLSelectElement).tagName).toBe('SELECT')
    expect(screen.getByDisplayValue('가상총무')).toBeInTheDocument()
    // 모임 부담액은 "전체 금액 − 개인 찬조액"과 같으면 빈칸(= 비우면 전액)으로 보여주는 기존 규칙 그대로다
    expect((screen.getByLabelText('모임 부담액') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('모임 부담액') as HTMLInputElement).placeholder).toBe('100000')
    expect((screen.getByLabelText('개인 찬조액') as HTMLInputElement).value).toBe('20,000')
    expect(screen.getByDisplayValue('10월 대관')).toBeInTheDocument()
  })
})

describe('지출 "수정" — 자동 스크롤', () => {
  it('2. 수정을 누르면 (단독 사용 시) 수정 폼 카드가 맨 위에 오도록 부드럽게 스크롤한다', () => {
    render(<SettlementExpenseForm settlementId={ID} />)
    expect(scrollSpy).not.toHaveBeenCalled()
    fireEvent.click(editButtons()[0])
    expect(scrollSpy).toHaveBeenCalledTimes(1)
    expect(scrollSpy).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
    const target = lastScrollTarget()
    expect(target).toContainElement(screen.getByText('지출 수정'))
    expect(target.style.scrollMarginTop).toBe('8px') // 위쪽에 바짝 붙어 가려지지 않게 여유
  })

  it('같은 항목의 "수정"을 한 번 더 눌러도 다시 이동하고, 다른 항목을 누르면 그 항목 값으로 바뀐다', () => {
    render(<SettlementExpenseForm settlementId={ID} />)
    fireEvent.click(editButtons()[0])
    fireEvent.click(editButtons()[0])
    expect(scrollSpy).toHaveBeenCalledTimes(2)
    fireEvent.click(editButtons()[1])
    expect(scrollSpy).toHaveBeenCalledTimes(3)
    expect(screen.getByDisplayValue('다과')).toBeInTheDocument()
  })

  it('3. 정산 화면: 다른 탭(참가자)에 있다가 지출 탭으로 와서 수정하면 "지출 탭 버튼 줄"이 맨 위에 오고 폼이 채워진다', () => {
    render(<SettlementTab devMembers={[]} devSessions={[]} />)
    // 처음에는 참가자 탭 — 지출 수정 폼이 없다
    expect(screen.queryByText('지출 추가', { selector: 'span' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '지출' }))
    expect(screen.getByText('지출 추가', { selector: 'span' })).toBeInTheDocument()

    fireEvent.click(editButtons()[0])
    expect(screen.getByText('지출 수정')).toBeInTheDocument()
    expect(screen.getByDisplayValue('당구장 대관료')).toBeInTheDocument()
    expect(scrollSpy).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
    const target = lastScrollTarget()
    expect(target.className).toBe('seg') // 탭 버튼 줄(지출 탭 표시) — 바로 아래에 수정 폼이 이어진다
    expect(within(target).getByRole('button', { name: '지출' })).toHaveClass('on')
    expect(target.style.scrollMarginTop).toBe('8px')
    // 탭 버튼 줄과 수정 폼은 같은 부모 안에서 바로 이어진다(사이에 다른 큰 카드가 끼지 않는다)
    expect(target.nextElementSibling).toContainElement(screen.getByText('지출 수정'))
  })

  it('"동작 줄이기"를 켠 기기에서는 부드러운 이동 대신 바로 이동한다', () => {
    const mm = vi.spyOn(window, 'matchMedia').mockImplementation(((q: string) => ({ matches: q.includes('reduce'), media: q })) as unknown as typeof window.matchMedia)
    const el = document.createElement('div')
    el.scrollIntoView = scrollSpy
    scrollToElement(el, 'start')
    expect(scrollSpy).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' })
    mm.mockRestore()
  })

  it('scrollIntoView가 없는 환경이어도 오류 없이 지나간다', () => {
    Element.prototype.scrollIntoView = undefined as unknown as typeof Element.prototype.scrollIntoView
    render(<SettlementExpenseForm settlementId={ID} />)
    expect(() => fireEvent.click(editButtons()[0])).not.toThrow()
    expect(screen.getByDisplayValue('당구장 대관료')).toBeInTheDocument()
  })
})

describe('수정 상태 표시', () => {
  it('수정 중에는 "지출 수정 중 — 항목명" 안내와 목록의 "수정 중" 표시가 보이고, 새 입력일 때는 없다', () => {
    render(<SettlementExpenseForm settlementId={ID} />)
    expect(screen.queryByTestId('expense-editing-banner')).not.toBeInTheDocument()
    expect(screen.getByText('지출 추가', { selector: 'span' })).toBeInTheDocument()

    fireEvent.click(editButtons()[0])
    expect(screen.getByTestId('expense-editing-banner')).toHaveTextContent('지출 수정 중 — 당구장 대관료')
    expect(screen.getByText('지출 수정')).toBeInTheDocument()
    expect(screen.getAllByText(/· 수정 중/)).toHaveLength(1) // 수정 중인 항목 하나에만
    // 항목명을 고치는 중에도 안내에는 원래 항목명이 그대로 보인다
    fireEvent.change(screen.getByDisplayValue('당구장 대관료'), { target: { value: '바꾸는 중' } })
    expect(screen.getByTestId('expense-editing-banner')).toHaveTextContent('당구장 대관료')
  })
})

describe('수정 저장 / 취소 — 기존 기능 그대로', () => {
  it('6-a. 취소: 수정 상태가 풀리고 신규 입력 모드(빈 폼)로 돌아가며, 데이터는 그대로다', () => {
    render(<SettlementExpenseForm settlementId={ID} />)
    const before = JSON.stringify(state())
    fireEvent.click(editButtons()[0])
    fireEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(screen.queryByTestId('expense-editing-banner')).not.toBeInTheDocument()
    expect(screen.getByText('지출 추가', { selector: 'span' })).toBeInTheDocument()
    expect(screen.queryByDisplayValue('당구장 대관료')).not.toBeInTheDocument()
    expect(screen.queryByText(/· 수정 중/)).not.toBeInTheDocument()
    expect(JSON.stringify(state())).toBe(before)
  })

  it('6-b. 저장: 목록이 갱신되고 수정 상태가 풀리며, 고친 항목이 보이도록 그 항목으로 이동한다', () => {
    render(<SettlementExpenseForm settlementId={ID} />)
    fireEvent.click(editButtons()[0])
    scrollSpy.mockClear()
    fireEvent.change(screen.getByDisplayValue('당구장 대관료'), { target: { value: '당구장 대관료(수정)' } })
    fireEvent.click(screen.getByRole('button', { name: '수정 저장' }))

    expect(state().expenses.find((e) => e.id === 'e1')!.label).toBe('당구장 대관료(수정)')
    expect(state().expenses).toHaveLength(2)
    expect(screen.queryByTestId('expense-editing-banner')).not.toBeInTheDocument()
    expect(screen.getByText('지출 추가', { selector: 'span' })).toBeInTheDocument()
    expect(screen.getByText(/당구장 대관료\(수정\)/)).toBeInTheDocument()
    expect(scrollSpy).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' })
    expect(lastScrollTarget()).toHaveTextContent('당구장 대관료(수정)')
  })

  it('6-c. 저장이 막히면(항목명 비움) 수정 상태·입력 값이 그대로 남고 이동도 하지 않는다', () => {
    render(<SettlementExpenseForm settlementId={ID} />)
    fireEvent.click(editButtons()[0])
    scrollSpy.mockClear()
    fireEvent.change(screen.getByDisplayValue('당구장 대관료'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: '수정 저장' }))
    expect(screen.getByText('항목명을 입력해주세요.')).toBeInTheDocument()
    expect(screen.getByTestId('expense-editing-banner')).toBeInTheDocument()
    expect(scrollSpy).not.toHaveBeenCalled()
  })

  it('새 지출 추가는 이동하지 않는다(기존 동작 그대로)', () => {
    render(<SettlementExpenseForm settlementId={ID} />)
    fireEvent.change(screen.getByPlaceholderText('항목명 (예: 당구장 대관료)'), { target: { value: '새 지출' } })
    fireEvent.change(screen.getByLabelText('금액'), { target: { value: '5000' } })
    fireEvent.click(screen.getByRole('button', { name: '지출 추가' }))
    expect(state().expenses).toHaveLength(3)
    expect(scrollSpy).not.toHaveBeenCalled()
  })

  it('확정된 정산에서는 수정 버튼도 수정 폼도 없다', () => {
    useSettlementStore.setState({ settlements: [fake({ status: 'confirmed' })] })
    render(<SettlementExpenseForm settlementId={ID} />)
    expect(screen.queryByRole('button', { name: '수정' })).not.toBeInTheDocument()
    expect(screen.queryByText('지출 추가', { selector: 'span' })).not.toBeInTheDocument()
  })
})

describe('7. 정산 계산 결과는 변하지 않는다', () => {
  const snapshot = () => {
    const s = state()
    return { expense: calcExpenseSummary(s), profit: calcProfitSummary(s), holdings: calcHoldingsSummary(s) }
  }

  it('수정을 열고/취소하고/같은 값으로 저장해도 총지출·보유액이 그대로다', () => {
    render(<SettlementExpenseForm settlementId={ID} />)
    const before = snapshot()
    fireEvent.click(editButtons()[0])
    fireEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(snapshot()).toEqual(before)

    fireEvent.click(editButtons()[0])
    fireEvent.click(screen.getByRole('button', { name: '수정 저장' }))
    expect(snapshot()).toEqual(before)
    expect(state().expenses[0]).toMatchObject({ label: '당구장 대관료', amount: 100_000, clubShare: 80_000, personalDonation: 20_000, method: '체크카드', paidBy: '가상총무', note: '10월 대관' })
  })

  it('금액을 바꿔 저장하면 그 금액만큼만 총지출이 바뀐다(계산 로직은 기존 그대로)', () => {
    render(<SettlementExpenseForm settlementId={ID} />)
    const before = calcProfitSummary(state()).totalExpense // 80,000 + 30,000
    expect(before).toBe(110_000)
    fireEvent.click(editButtons()[1]) // 다과 30,000 → 40,000
    fireEvent.change(screen.getByLabelText('금액'), { target: { value: '40000' } })
    fireEvent.click(screen.getByRole('button', { name: '수정 저장' }))
    expect(calcProfitSummary(state()).totalExpense).toBe(120_000)
  })
})

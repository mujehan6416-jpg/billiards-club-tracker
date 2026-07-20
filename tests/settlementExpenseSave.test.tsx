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
    render(<SettlementExpenseForm settlementId="settle-expense-1" />)
    expect(screen.getByText('임시저장')).toBeInTheDocument()
  })

  it('지출을 추가한 뒤 임시저장을 누르면 그 지출이 포함된 settlement가 실제로 Firestore 저장 함수에 전달된다', async () => {
    render(<SettlementExpenseForm settlementId="settle-expense-1" />)
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
    render(<SettlementExpenseForm settlementId="settle-expense-1" previewMode />)
    const btn = screen.getByText('임시저장')
    expect(btn).toBeDisabled()
    fireEvent.click(btn)
    expect(saveSettlementMock).not.toHaveBeenCalled()
  })

  it('저장이 실패하면 "임시저장 완료" 메시지를 표시하지 않는다', async () => {
    saveSettlementMock.mockRejectedValue(new Error('가상 네트워크 오류'))
    render(<SettlementExpenseForm settlementId="settle-expense-1" />)
    fireEvent.click(screen.getByText('임시저장'))
    await waitFor(() => expect(saveSettlementMock).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('임시저장 완료')).not.toBeInTheDocument()
  })
})

describe('지출 날짜 기본값 — 브라우저 오늘이 아니라 선택된 정산(모임) 날짜를 사용한다', () => {
  const dateInput = (container: HTMLElement) => container.querySelector('input[type="date"]') as HTMLInputElement

  it('새 지출 입력 폼의 날짜 기본값이 정산의 모임 날짜(2026-01-10)다', () => {
    const { container } = render(<SettlementExpenseForm settlementId="settle-expense-1" />)
    expect(dateInput(container).value).toBe('2026-01-10')
  })

  it('지출을 저장한 뒤 폼이 초기화되면 날짜는 다시 정산의 모임 날짜로 돌아간다(빈 값이나 오늘이 아님)', () => {
    const { container } = render(<SettlementExpenseForm settlementId="settle-expense-1" />)
    fireEvent.change(screen.getByPlaceholderText('항목명 (예: 당구장 대관료)'), { target: { value: '가상 지출' } })
    fireEvent.change(screen.getAllByPlaceholderText('0')[0], { target: { value: '10000' } })
    fireEvent.click(screen.getByRole('button', { name: '지출 추가' }))
    expect(dateInput(container).value).toBe('2026-01-10')
  })

  it('사용자가 직접 날짜를 바꾸면 그 날짜 그대로 저장된다', () => {
    const { container } = render(<SettlementExpenseForm settlementId="settle-expense-1" />)
    fireEvent.change(dateInput(container), { target: { value: '2026-01-15' } })
    fireEvent.change(screen.getByPlaceholderText('항목명 (예: 당구장 대관료)'), { target: { value: '가상 지출' } })
    fireEvent.change(screen.getAllByPlaceholderText('0')[0], { target: { value: '10000' } })
    fireEvent.click(screen.getByRole('button', { name: '지출 추가' }))

    const saved = useSettlementStore.getState().getById('settle-expense-1')!.expenses.find((e) => e.label === '가상 지출')!
    expect(saved.date).toBe('2026-01-15')
  })

  it('기존 지출을 수정할 때는 그 지출의 기존 날짜가 그대로 보인다', () => {
    useSettlementStore.getState().addExpense('settle-expense-1', {
      date: '2026-01-05', label: '가상 기존지출', category: '기타', amount: 3000,
      method: '현금', clubShare: 3000, personalDonation: 0,
    })
    const { container } = render(<SettlementExpenseForm settlementId="settle-expense-1" />)
    fireEvent.click(screen.getByText('수정'))
    expect(dateInput(container).value).toBe('2026-01-05')
  })

  it('다른 정산을 선택하면(같은 화면에서 settlementId만 바뀜) 폼 날짜가 새 정산의 모임 날짜로 바뀐다', () => {
    useSettlementStore.setState({
      settlements: [
        ...useSettlementStore.getState().settlements,
        {
          id: 'settle-expense-2', meetingName: '가상 정기모임2', meetingDate: '2026-02-20', meetingType: 'regular', status: 'draft',
          participants: [], expenses: [], dinnerContributions: [], cashDeposits: [],
          prevBankBalance: 0, otherBankAdjustment: 0, createdAt: '2026-02-20T00:00:00.000Z', version: 0, revisionLog: [],
        },
      ],
    })
    const { container, rerender } = render(<SettlementExpenseForm settlementId="settle-expense-1" />)
    expect(dateInput(container).value).toBe('2026-01-10')
    rerender(<SettlementExpenseForm settlementId="settle-expense-2" />)
    expect(dateInput(container).value).toBe('2026-02-20')
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

describe('금액 입력칸 너비/높이 — index.css의 input[type=number]{width:64px} 전역 규칙을 인라인으로 덮어쓴다', () => {
  // jsdom은 실제 CSS 레이아웃을 계산하지 않으므로(실제 픽셀 렌더링 검증은 브라우저에서 별도 확인),
  // 여기서는 "너비를 강제로 넓히는 인라인 스타일이 실제로 적용돼 있는지"만 회귀 테스트로 고정한다.
  it('지출 "금액" 입력칸이 width:100%·최소 높이 52px 스타일을 갖는다', () => {
    render(<SettlementExpenseForm settlementId="settle-expense-1" />)
    const [amountInput] = screen.getAllByPlaceholderText('0') as HTMLInputElement[]
    expect(amountInput.style.width).toBe('100%')
    expect(amountInput.style.minWidth).toBe('0')
    expect(amountInput.style.minHeight).toBe('52px')
    expect(amountInput.style.flexShrink).toBe('0')
  })

  it('지출 "모임 부담액"·"개인 찬조액" 입력칸도 동일하게 width:100%·최소 높이 52px를 갖는다', () => {
    render(<SettlementExpenseForm settlementId="settle-expense-1" />)
    const [, clubShareInput, personalDonationInput] = screen.getAllByPlaceholderText('0') as HTMLInputElement[]
    for (const input of [clubShareInput, personalDonationInput]) {
      expect(input.style.width).toBe('100%')
      expect(input.style.minHeight).toBe('52px')
    }
  })

  it('모임 부담액·개인 찬조액이 더 이상 한 줄에 나란히(반쪽 폭) 배치되지 않는다 — 각자 독립된 세로 블록', () => {
    render(<SettlementExpenseForm settlementId="settle-expense-1" />)
    const [, clubShareInput, personalDonationInput] = screen.getAllByPlaceholderText('0') as HTMLInputElement[]
    // 서로 다른 부모(각자 독립된 flexDirection:column 블록)에 속해야 한다 — 같은 flex row의 flex:1 자식이면 안 됨.
    expect(clubShareInput.parentElement).not.toBe(personalDonationInput.parentElement)
    expect(clubShareInput.parentElement?.style.flexDirection).toBe('column')
    expect(personalDonationInput.parentElement?.style.flexDirection).toBe('column')
    // 옛 구조에서 쓰던 flex:1 좁은 컬럼이 더 이상 아니다.
    expect(clubShareInput.parentElement?.style.flex).toBe('')
    expect(personalDonationInput.parentElement?.style.flex).toBe('')
  })

  it('회식비 "전체 회식비" 입력칸이 width:100%·최소 높이 52px 스타일을 갖는다(공용 스타일 회귀 확인)', () => {
    render(<DinnerContributionForm settlementId="settle-expense-1" />)
    const input = screen.getByPlaceholderText('0') as HTMLInputElement
    expect(input.style.width).toBe('100%')
    expect(input.style.minHeight).toBe('52px')
  })

  it('회식비 "찬조자 금액" 입력칸은 기존 110px 고정 너비를 그대로 유지한다(회식비 화면 회귀 없음)', () => {
    render(<DinnerContributionForm settlementId="settle-expense-1" />)
    fireEvent.change(screen.getByDisplayValue('모임 회계 지출 (찬조자 없음)'), { target: { value: '일부찬조' } })
    fireEvent.click(screen.getByText('+ 찬조자 추가'))
    const contributorAmountInput = screen.getByPlaceholderText('금액') as HTMLInputElement
    expect(contributorAmountInput.style.width).toBe('110px')
  })
})

describe('지출 분류 — 10개 → 5개 단순화, 순서, 하위호환', () => {
  it('분류 선택칸이 정확히 5개, "당구비 다과비 회식비 상금 기타" 순서로 표시된다', () => {
    render(<SettlementExpenseForm settlementId="settle-expense-1" />)
    const select = screen.getByDisplayValue('당구비') as HTMLSelectElement
    const optionLabels = Array.from(select.options).map((o) => o.value)
    expect(optionLabels).toEqual(['당구비', '다과비', '회식비', '상금', '기타'])
  })

  it('예전 분류값("대관비")으로 저장된 기존 지출을 목록에서 열어도 오류 없이 새 분류("당구비")로 보인다', () => {
    useSettlementStore.getState().addExpense('settle-expense-1', {
      date: '2026-07-16', label: '당구장 대관료', category: '대관비', amount: 100000,
      method: '체크카드', clubShare: 100000, personalDonation: 0,
    })
    render(<SettlementExpenseForm settlementId="settle-expense-1" />)
    expect(screen.getByText('(당구비)')).toBeInTheDocument()

    fireEvent.click(screen.getByText('수정'))
    const select = screen.getByDisplayValue('당구비') as HTMLSelectElement
    expect(select.value).toBe('당구비')
    fireEvent.click(screen.getByText('수정 저장'))

    const saved = useSettlementStore.getState().getById('settle-expense-1')!.expenses[0]
    expect(saved.category).toBe('당구비')
  })
})

describe('[재현 및 수정 확인] 기타 지출 — 전체 금액 입력·모임 부담액 비워둠·저장', () => {
  it('분류 기타, 항목명 주차비, 전체 금액 5000, 모임부담액/개인찬조 비움 → 저장 후 clubShare가 5000이어야 한다', () => {
    render(<SettlementExpenseForm settlementId="settle-expense-1" />)
    const categorySelect = screen.getByDisplayValue('당구비') as HTMLSelectElement
    fireEvent.change(categorySelect, { target: { value: '기타' } })
    fireEvent.change(screen.getByPlaceholderText('항목명 (예: 당구장 대관료)'), { target: { value: '주차비' } })
    const [amountInput] = screen.getAllByPlaceholderText('0') as HTMLInputElement[]
    fireEvent.change(amountInput, { target: { value: '5000' } })
    fireEvent.click(screen.getByRole('button', { name: '지출 추가' }))

    const saved = useSettlementStore.getState().getById('settle-expense-1')!.expenses[0]
    expect(saved).toBeDefined()
    expect(saved.category).toBe('기타')
    expect(saved.amount).toBe(5000)
    expect(saved.clubShare).toBe(5000)
    expect(saved.personalDonation).toBe(0)
  })

  it('일부 개인 찬조가 있으면 모임부담액을 비워도 "전체 금액 - 개인 찬조액"으로 계산된다 (100,000/찬조 20,000 → 부담 80,000)', () => {
    render(<SettlementExpenseForm settlementId="settle-expense-1" />)
    fireEvent.change(screen.getByPlaceholderText('항목명 (예: 당구장 대관료)'), { target: { value: '다과 구입' } })
    const [amountInput, , personalDonationInput] = screen.getAllByPlaceholderText('0') as HTMLInputElement[]
    fireEvent.change(amountInput, { target: { value: '100000' } })
    fireEvent.change(personalDonationInput, { target: { value: '20000' } })
    fireEvent.click(screen.getByRole('button', { name: '지출 추가' }))

    const saved = useSettlementStore.getState().getById('settle-expense-1')!.expenses[0]
    expect(saved.amount).toBe(100000)
    expect(saved.personalDonation).toBe(20000)
    expect(saved.clubShare).toBe(80000)
  })

  it('모임부담액을 직접 지정하면(70,000) 입력값 그대로 저장된다 (100,000 = 70,000 + 30,000)', () => {
    render(<SettlementExpenseForm settlementId="settle-expense-1" />)
    fireEvent.change(screen.getByPlaceholderText('항목명 (예: 당구장 대관료)'), { target: { value: '트로피' } })
    const [amountInput, clubShareInput, personalDonationInput] = screen.getAllByPlaceholderText('0') as HTMLInputElement[]
    fireEvent.change(amountInput, { target: { value: '100000' } })
    fireEvent.change(clubShareInput, { target: { value: '70000' } })
    fireEvent.change(personalDonationInput, { target: { value: '30000' } })
    fireEvent.click(screen.getByRole('button', { name: '지출 추가' }))

    const saved = useSettlementStore.getState().getById('settle-expense-1')!.expenses[0]
    expect(saved.clubShare).toBe(70000)
    expect(saved.personalDonation).toBe(30000)
  })

  it('[확인된 버그 재현] 모임부담액에 실수로 0을 입력하면(개인찬조 없이) 합계가 전체 금액과 안 맞아 저장이 막히고 안내 문구가 뜬다', () => {
    render(<SettlementExpenseForm settlementId="settle-expense-1" />)
    fireEvent.change(screen.getByPlaceholderText('항목명 (예: 당구장 대관료)'), { target: { value: '주차비' } })
    const [amountInput, clubShareInput] = screen.getAllByPlaceholderText('0') as HTMLInputElement[]
    fireEvent.change(amountInput, { target: { value: '5000' } })
    fireEvent.change(clubShareInput, { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: '지출 추가' }))

    expect(useSettlementStore.getState().getById('settle-expense-1')!.expenses).toHaveLength(0)
    expect(screen.getByText(/모임 부담액\(0원\)과 개인 찬조액\(0원\)을 더한 값이 전체 금액\(5,000원\)과 일치하지 않습니다\./)).toBeInTheDocument()
  })

  it('기존 지출을 "수정"으로 열어 항목명만 고치고 재저장해도 clubShare가 유지된다', () => {
    useSettlementStore.getState().addExpense('settle-expense-1', {
      date: '2026-07-16', label: '주차비', category: '기타', amount: 5000,
      method: '현금', clubShare: 5000, personalDonation: 0,
    })
    render(<SettlementExpenseForm settlementId="settle-expense-1" />)
    fireEvent.click(screen.getByText('수정'))
    fireEvent.change(screen.getByPlaceholderText('항목명 (예: 당구장 대관료)'), { target: { value: '주차비(강호철 회장님차)' } })
    fireEvent.click(screen.getByText('수정 저장'))

    const saved = useSettlementStore.getState().getById('settle-expense-1')!.expenses[0]
    expect(saved.label).toBe('주차비(강호철 회장님차)')
    expect(saved.amount).toBe(5000)
    expect(saved.clubShare).toBe(5000)
  })

  it('[확인된 버그 수정 확인] 원래 "비우면 전액"으로 저장됐던 지출을 수정 화면에서 전체 금액만 바꾸면, 모임부담액이 새 금액에 맞춰 자동으로 따라간다', () => {
    // 최초 저장 시 모임부담액을 비워서 5000원 전액이 자동 계산된 상태(=버그 이전엔 startEdit이
    // "5000"을 그대로 프리필해 금액을 3000으로 바꿔도 clubShare가 5000에 고정되던 지점).
    // "모임 부담액" 입력칸은 amount가 채워지면 placeholder가 "0"이 아니라 amount 값으로 바뀌므로
    // getAllByPlaceholderText('0')로는 못 찾는다 — DOM 순서(금액→모임부담액→개인찬조액)로 직접 조회한다.
    useSettlementStore.getState().addExpense('settle-expense-1', {
      date: '2026-07-16', label: '주차비', category: '기타', amount: 5000,
      method: '현금', clubShare: 5000, personalDonation: 0,
    })
    const { container } = render(<SettlementExpenseForm settlementId="settle-expense-1" />)
    fireEvent.click(screen.getByText('수정'))
    const [amountInput, clubShareInput] = container.querySelectorAll('input[type="number"]') as unknown as HTMLInputElement[]
    expect(clubShareInput.value).toBe('')
    fireEvent.change(amountInput, { target: { value: '3000' } })
    fireEvent.click(screen.getByText('수정 저장'))

    const saved = useSettlementStore.getState().getById('settle-expense-1')!.expenses[0]
    expect(saved.amount).toBe(3000)
    expect(saved.clubShare).toBe(3000)
  })

  it('모임부담액을 직접 지정해뒀던 지출은 수정 화면을 열어도 그 값이 그대로 보인다(전액 자동계산으로 덮어쓰지 않음)', () => {
    // clubShare(75000)가 "비우면 전액" 자동계산값(100000-30000=70000)과 다르므로 명백히 직접 지정한 값이다.
    useSettlementStore.getState().addExpense('settle-expense-1', {
      date: '2026-07-16', label: '트로피', category: '상금', amount: 100000,
      method: '체크카드', clubShare: 75000, personalDonation: 30000,
    })
    const { container } = render(<SettlementExpenseForm settlementId="settle-expense-1" />)
    fireEvent.click(screen.getByText('수정'))
    const [, clubShareInput] = container.querySelectorAll('input[type="number"]') as unknown as HTMLInputElement[]
    expect(clubShareInput.value).toBe('75000')
  })

  it('목록에 총액·모임부담·개인찬조가 함께 표시된다', () => {
    useSettlementStore.getState().addExpense('settle-expense-1', {
      date: '2026-07-16', label: '트로피', category: '상금', amount: 100000,
      method: '체크카드', clubShare: 70000, personalDonation: 30000,
    })
    render(<SettlementExpenseForm settlementId="settle-expense-1" />)
    expect(screen.getByText(/총액 100,000원 · 모임부담 70,000원 · 개인찬조 30,000원/)).toBeInTheDocument()
  })

  it('로그아웃 후 재로그인(스토어 초기화 + 재적재)해도 clubShare·amount가 그대로 유지된다', () => {
    useSettlementStore.getState().addExpense('settle-expense-1', {
      date: '2026-07-16', label: '주차비', category: '기타', amount: 5000,
      method: '현금', clubShare: 5000, personalDonation: 0,
    })
    const persisted = useSettlementStore.getState().getById('settle-expense-1')!
    // 재로그인 시 store가 초기화된 뒤 클라우드에서 다시 내려받는 상황을 흉내낸다.
    useSettlementStore.setState({ settlements: [], currentId: null })
    useSettlementStore.setState({ settlements: [persisted], currentId: persisted.id })

    const restored = useSettlementStore.getState().getById('settle-expense-1')!.expenses[0]
    expect(restored.amount).toBe(5000)
    expect(restored.clubShare).toBe(5000)
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// settlementSync(Firestore 실제 호출부)를 통째로 모킹해, 이 테스트가 실제 Firebase에 절대
// 접근하지 않도록 한다. 이 테스트의 핵심 목적 자체가 "previewMode에서는 이 함수가 호출되지
// 않아야 한다"는 안전장치를 검증하는 것이다.
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

// 아래 이름·ID·금액은 전부 테스트용 가상 데이터이며 실제 회원 정보가 아니다.

function fakeSettlement(overrides: Partial<RegularSettlement> = {}): RegularSettlement {
  return {
    id: 'settle-preview-1',
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
  useSettlementStore.setState({ settlements: [fakeSettlement()], currentId: 'settle-preview-1', syncStatus: 'idle', lastSyncError: null })
  // Firebase Auth 세션이 남아있는 상황(이번 안전사고의 원인 가설)을 그대로 재현해서 테스트한다 —
  // previewMode는 관리자 인증 여부와 무관하게 저장을 막아야 한다.
  useAdminAuthStore.setState({ status: 'authorizedAdmin', uid: 'fake-admin-uid', email: 'fake-admin@example.test', adminDisplayName: '가상관리자', errorMessage: null })
  saveSettlementMock.mockReset()
  saveSettlementMock.mockResolvedValue(1)
})

describe('DuesTable — previewMode 안전장치(개발 미리보기에서 실제 Firestore 쓰기 차단)', () => {
  it('previewMode에서는 임시저장 버튼이 비활성화되어 있다', () => {
    render(<DuesTable settlementId="settle-preview-1" previewMode />)
    expect(screen.getByText('임시저장')).toBeDisabled()
  })

  it('previewMode에서는 최종 게시 버튼이 비활성화되어 있다', () => {
    render(<DuesTable settlementId="settle-preview-1" previewMode />)
    expect(screen.getByText('최종 게시')).toBeDisabled()
  })

  it('previewMode에서 임시저장 버튼을 눌러도 saveSettlement(Firestore 저장 함수)가 호출되지 않는다', () => {
    render(<DuesTable settlementId="settle-preview-1" previewMode />)
    fireEvent.click(screen.getByText('임시저장'))
    expect(saveSettlementMock).not.toHaveBeenCalled()
  })

  it('previewMode에서는 "저장되지 않습니다" 안내를 보여주고, 저장 성공 메시지는 표시하지 않는다', () => {
    render(<DuesTable settlementId="settle-preview-1" previewMode />)
    expect(screen.getByText(/개발 미리보기에서는 저장되지 않습니다/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('임시저장'))
    expect(screen.queryByText('임시저장 완료')).not.toBeInTheDocument()
  })

  it('previewMode가 아니면(일반 관리자 화면과 동일) 임시저장 버튼이 활성 상태이고, 클릭하면 실제 saveSettlement가 호출된다', async () => {
    render(<DuesTable settlementId="settle-preview-1" />)
    const btn = screen.getByText('임시저장')
    expect(btn).not.toBeDisabled()
    fireEvent.click(btn)
    await waitFor(() => expect(saveSettlementMock).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByText('임시저장 완료')).toBeInTheDocument())
  })
})

// 확정된 정산 수입 정책(사용자 승인):
//   - 현금 수입은 총수입에 포함
//   - 계좌이체 중 입금확인 완료 항목만 총수입에 포함
//   - 계좌이체 미확인 항목은 총수입에서 제외하고, 별도 경고 합계로만 표시
//   - 같은 회원의 회비·찬조가 각각 미확인이면 둘 다 미확인 합계에 포함(둘 중 하나만 반영되는 오류였음)
describe('확정 정책 검증: 계좌이체 미확인 합계 — DuesTable 확인 상태(status) select 부재로 인한 누락 수정', () => {
  beforeEach(() => {
    useSettlementStore.setState({
      settlements: [fakeSettlement({
        participants: [
          { id: 'p1', participantType: 'member', memberId: 'p1', displayName: '가상회원A', addedVia: 'meeting_attendee' },
        ],
      })],
      currentId: 'settle-preview-1',
    })
  })

  it('결제수단을 "계좌이체"로 바꾸면(상태 select를 따로 안 건드려도) 자동으로 "미확인"으로 정규화된다 — 예전엔 이 정규화가 없어 회비가 기본값(미납)에 머물러 미확인 합계에서 누락됐다', () => {
    render(<DuesTable settlementId="settle-preview-1" />)

    fireEvent.change(screen.getByLabelText('가상회원A 회비 금액'), { target: { value: '30000' } })
    fireEvent.blur(screen.getByLabelText('가상회원A 회비 금액'))
    fireEvent.change(screen.getByLabelText('가상회원A 회비 결제수단'), { target: { value: '계좌이체' } })

    fireEvent.click(screen.getByText('+ 찬조'))
    fireEvent.change(screen.getByLabelText('가상회원A 찬조 금액'), { target: { value: '20000' } })
    fireEvent.blur(screen.getByLabelText('가상회원A 찬조 금액'))
    fireEvent.change(screen.getByLabelText('가상회원A 찬조 결제수단'), { target: { value: '계좌이체' } })

    const saved = useSettlementStore.getState().getById('settle-preview-1')!.participants[0]
    // 결제수단을 계좌이체로 바꾸는 순간 store가 상태를 '미확인'으로 정규화한다(확정 정책).
    expect(saved.dues?.status).toBe('미확인')
    expect(saved.donation?.status).toBe('미확인')

    const income = useSettlementStore.getState().getSummary('settle-preview-1')!.income
    // 결제수단 변경 시점의 자동 정규화 덕분에 회비·찬조 모두 미확인으로 잡혀 50,000원이 정확히 합산된다.
    expect(income.duesTransferUnconfirmed + income.donationTransferUnconfirmed).toBe(50000)
  })

  it('[수정 확인] 이제는 회비·찬조 확인 상태 select가 있고, 회비를 "미확인"으로 바꾸면 계좌이체 미확인 합계에 정확히 반영된다(30,000+20,000=50,000)', () => {
    render(<DuesTable settlementId="settle-preview-1" />)

    fireEvent.change(screen.getByLabelText('가상회원A 회비 금액'), { target: { value: '30000' } })
    fireEvent.blur(screen.getByLabelText('가상회원A 회비 금액'))
    fireEvent.change(screen.getByLabelText('가상회원A 회비 결제수단'), { target: { value: '계좌이체' } })
    fireEvent.change(screen.getByLabelText('가상회원A 회비 확인상태'), { target: { value: '미확인' } })

    fireEvent.click(screen.getByText('+ 찬조'))
    fireEvent.change(screen.getByLabelText('가상회원A 찬조 금액'), { target: { value: '20000' } })
    fireEvent.blur(screen.getByLabelText('가상회원A 찬조 금액'))
    fireEvent.change(screen.getByLabelText('가상회원A 찬조 결제수단'), { target: { value: '계좌이체' } })
    // 찬조는 기본값 자체가 '미확인'이라 별도로 안 바꿔도 되지만, 명시적으로도 재확인한다.
    fireEvent.change(screen.getByLabelText('가상회원A 찬조 확인상태'), { target: { value: '미확인' } })

    const saved = useSettlementStore.getState().getById('settle-preview-1')!.participants[0]
    expect(saved.dues?.status).toBe('미확인')
    expect(saved.donation?.status).toBe('미확인')

    const income = useSettlementStore.getState().getSummary('settle-preview-1')!.income
    expect(income.duesTransferUnconfirmed + income.donationTransferUnconfirmed).toBe(50000)
    expect(income.totalIncome).toBe(0) // 둘 다 미확인이므로 총수입에서는 제외
  })

  it('[확정 정책 시나리오 1~8] 회비·찬조 둘 다 미확인(50,000/총수입 0) → 회비만 확인(20,000/30,000) → 찬조까지 확인(0/50,000)', () => {
    render(<DuesTable settlementId="settle-preview-1" />)

    fireEvent.change(screen.getByLabelText('가상회원A 회비 금액'), { target: { value: '30000' } })
    fireEvent.blur(screen.getByLabelText('가상회원A 회비 금액'))
    fireEvent.change(screen.getByLabelText('가상회원A 회비 결제수단'), { target: { value: '계좌이체' } })
    fireEvent.change(screen.getByLabelText('가상회원A 회비 확인상태'), { target: { value: '미확인' } })

    fireEvent.click(screen.getByText('+ 찬조'))
    fireEvent.change(screen.getByLabelText('가상회원A 찬조 금액'), { target: { value: '20000' } })
    fireEvent.blur(screen.getByLabelText('가상회원A 찬조 금액'))
    fireEvent.change(screen.getByLabelText('가상회원A 찬조 결제수단'), { target: { value: '계좌이체' } })

    // 1~4: 회비 30,000 미확인 + 찬조 20,000 미확인 → 미확인 합계 50,000 / 총수입 0
    const step1 = useSettlementStore.getState().getSummary('settle-preview-1')!.income
    expect(step1.duesTransferUnconfirmed + step1.donationTransferUnconfirmed).toBe(50000)
    expect(step1.totalIncome).toBe(0)

    // 5~6: 회비만 입금확인 → 미확인 합계 20,000 / 총수입 30,000
    fireEvent.change(screen.getByLabelText('가상회원A 회비 확인상태'), { target: { value: '입금확인' } })
    const step2 = useSettlementStore.getState().getSummary('settle-preview-1')!.income
    expect(step2.duesTransferUnconfirmed + step2.donationTransferUnconfirmed).toBe(20000)
    expect(step2.totalIncome).toBe(30000)

    // 7~8: 찬조까지 입금확인 → 미확인 합계 0 / 총수입 50,000
    fireEvent.change(screen.getByLabelText('가상회원A 찬조 확인상태'), { target: { value: '입금확인' } })
    const step3 = useSettlementStore.getState().getSummary('settle-preview-1')!.income
    expect(step3.duesTransferUnconfirmed + step3.donationTransferUnconfirmed).toBe(0)
    expect(step3.totalIncome).toBe(50000)
  })

  it('미확인 → 입금확인 → 미확인으로 되돌려도 매번 합계가 정확히 바뀐다', () => {
    render(<DuesTable settlementId="settle-preview-1" />)

    fireEvent.change(screen.getByLabelText('가상회원A 회비 금액'), { target: { value: '30000' } })
    fireEvent.blur(screen.getByLabelText('가상회원A 회비 금액'))
    fireEvent.change(screen.getByLabelText('가상회원A 회비 결제수단'), { target: { value: '계좌이체' } })
    fireEvent.change(screen.getByLabelText('가상회원A 회비 확인상태'), { target: { value: '미확인' } })

    const afterUnconfirmed1 = useSettlementStore.getState().getSummary('settle-preview-1')!.income
    expect(afterUnconfirmed1.duesTransferUnconfirmed).toBe(30000)
    expect(afterUnconfirmed1.totalIncome).toBe(0)

    fireEvent.change(screen.getByLabelText('가상회원A 회비 확인상태'), { target: { value: '입금확인' } })
    const afterConfirmed = useSettlementStore.getState().getSummary('settle-preview-1')!.income
    expect(afterConfirmed.duesTransferUnconfirmed).toBe(0)
    expect(afterConfirmed.duesTransferConfirmed).toBe(30000)
    expect(afterConfirmed.totalIncome).toBe(30000)

    // 다시 미확인으로 되돌림 — 확인 처리 취소를 재현
    fireEvent.change(screen.getByLabelText('가상회원A 회비 확인상태'), { target: { value: '미확인' } })
    const afterUnconfirmed2 = useSettlementStore.getState().getSummary('settle-preview-1')!.income
    expect(afterUnconfirmed2.duesTransferUnconfirmed).toBe(30000)
    expect(afterUnconfirmed2.duesTransferConfirmed).toBe(0)
    expect(afterUnconfirmed2.totalIncome).toBe(0)
  })

  it('상태 변경 후 임시저장하고 store를 초기화(재로그인 재현)한 뒤 재조회해도 상태가 그대로 복원된다', async () => {
    render(<DuesTable settlementId="settle-preview-1" />)

    fireEvent.change(screen.getByLabelText('가상회원A 회비 금액'), { target: { value: '30000' } })
    fireEvent.blur(screen.getByLabelText('가상회원A 회비 금액'))
    fireEvent.change(screen.getByLabelText('가상회원A 회비 결제수단'), { target: { value: '계좌이체' } })
    fireEvent.change(screen.getByLabelText('가상회원A 회비 확인상태'), { target: { value: '미확인' } })

    saveSettlementMock.mockResolvedValue(1)
    fireEvent.click(screen.getByText('임시저장'))
    await waitFor(() => expect(saveSettlementMock).toHaveBeenCalledTimes(1))
    const savedPayload = saveSettlementMock.mock.calls[0][0]
    expect(savedPayload.participants[0].dues).toMatchObject({ amount: 30000, method: '계좌이체', status: '미확인' })

    // 재로그인 재현: store를 비우고 Firestore에 저장된 내용을 그대로 다시 적재
    useSettlementStore.setState({ settlements: [{ ...savedPayload, version: 1 }], currentId: 'settle-preview-1' })

    const restored = useSettlementStore.getState().getById('settle-preview-1')!.participants[0]
    expect(restored.dues).toMatchObject({ amount: 30000, method: '계좌이체', status: '미확인' })
    const income = useSettlementStore.getState().getSummary('settle-preview-1')!.income
    expect(income.duesTransferUnconfirmed).toBe(30000)
  })

  it('계좌이체인데 상태 필드가 없는 기존(레거시) 참가자는 select에 오류 없이 "미확인"을 기본값으로 표시한다 — 기존 데이터 호환', () => {
    useSettlementStore.setState({
      settlements: [fakeSettlement({
        participants: [
          { id: 'p1', participantType: 'member', memberId: 'p1', displayName: '가상회원A', addedVia: 'meeting_attendee', dues: { amount: 30000, method: '계좌이체' } as never },
        ],
      })],
      currentId: 'settle-preview-1',
    })
    render(<DuesTable settlementId="settle-preview-1" />)
    const select = screen.getByLabelText('가상회원A 회비 확인상태') as HTMLSelectElement
    expect(select.value).toBe('미확인')
  })

  it('현금이고 상태 필드가 없는 기존(레거시) 참가자는 확인상태 select 자체가 보이지 않는다', () => {
    useSettlementStore.setState({
      settlements: [fakeSettlement({
        participants: [
          { id: 'p1', participantType: 'member', memberId: 'p1', displayName: '가상회원A', addedVia: 'meeting_attendee', dues: { amount: 30000, method: '현금' } as never },
        ],
      })],
      currentId: 'settle-preview-1',
    })
    render(<DuesTable settlementId="settle-preview-1" />)
    expect(screen.queryByLabelText('가상회원A 회비 확인상태')).not.toBeInTheDocument()
  })

  it('이미 status가 저장돼 있는 기존 데이터는 select가 기본값으로 덮어쓰지 않고 저장된 값을 그대로 보여준다', () => {
    useSettlementStore.setState({
      settlements: [fakeSettlement({
        participants: [
          { id: 'p1', participantType: 'member', memberId: 'p1', displayName: '가상회원A', addedVia: 'meeting_attendee', dues: { amount: 30000, method: '계좌이체', status: '입금확인' } },
        ],
      })],
      currentId: 'settle-preview-1',
    })
    render(<DuesTable settlementId="settle-preview-1" />)
    const select = screen.getByLabelText('가상회원A 회비 확인상태') as HTMLSelectElement
    expect(select.value).toBe('입금확인')
  })
})

describe('회비·찬조 금액 입력칸 너비 — 모바일 표 배치를 위해 좁힌 고정폭', () => {
  beforeEach(() => {
    useSettlementStore.setState({
      settlements: [fakeSettlement({
        participants: [
          { id: 'p1', participantType: 'member', memberId: 'p1', displayName: '가상회원A', addedVia: 'meeting_attendee' },
        ],
      })],
      currentId: 'settle-preview-1',
    })
  })

  it('회비 금액 입력칸이 표 전용 좁은 고정폭(width:78px, minWidth:70px)을 갖는다 — 결제수단·찬조가 한 화면에 들어오도록 기존(100%/100px)보다 축소', () => {
    render(<DuesTable settlementId="settle-preview-1" />)
    const input = screen.getByLabelText('가상회원A 회비 금액') as HTMLInputElement
    expect(input.style.width).toBe('78px')
    expect(input.style.minWidth).toBe('70px')
  })

  it('730700을 입력하면 "입력 금액 합계"와 같은 천단위 콤마(730,700)로 화면에 보이지만, 저장되는 값은 콤마 없는 순수 숫자다', () => {
    render(<DuesTable settlementId="settle-preview-1" />)
    const input = screen.getByLabelText('가상회원A 회비 금액') as HTMLInputElement
    fireEvent.change(input, { target: { value: '730700' } })
    expect(input.value).toBe('730,700')
    fireEvent.blur(input)
    expect(useSettlementStore.getState().getById('settle-preview-1')!.participants[0].dues?.amount).toBe(730700)
  })

  it('콤마가 포함된 표시값 위에 이어서 입력해도(실제 타이핑 시나리오 — 컨트롤드 입력값 뒤에 새 글자가 이어 붙음) 값이 정상적으로 누적된다', () => {
    render(<DuesTable settlementId="settle-preview-1" />)
    const input = screen.getByLabelText('가상회원A 회비 금액') as HTMLInputElement
    fireEvent.change(input, { target: { value: '5000' } })
    expect(input.value).toBe('5,000')
    fireEvent.change(input, { target: { value: input.value + '6' } })
    expect(input.value).toBe('50,006')
    fireEvent.blur(input)
    expect(useSettlementStore.getState().getById('settle-preview-1')!.participants[0].dues?.amount).toBe(50006)
  })

  it('찬조 금액 입력칸도 동일한 축소 너비 스타일을 갖는다', () => {
    render(<DuesTable settlementId="settle-preview-1" />)
    fireEvent.click(screen.getByText('+ 찬조'))
    const input = screen.getByLabelText('가상회원A 찬조 금액') as HTMLInputElement
    expect(input.style.width).toBe('78px')
    expect(input.style.minWidth).toBe('70px')
  })
})

describe('모바일 표 레이아웃 — 열 중앙 정렬 및 스크롤 보호', () => {
  beforeEach(() => {
    useSettlementStore.setState({
      settlements: [fakeSettlement({
        participants: [
          { id: 'p1', participantType: 'member', memberId: 'p1', displayName: '가상회원A', addedVia: 'meeting_attendee' },
        ],
      })],
      currentId: 'settle-preview-1',
    })
  })

  it('이름·구분·금액·결제수단 헤더 4개가 모두 중앙 정렬이다', () => {
    render(<DuesTable settlementId="settle-preview-1" />)
    for (const label of ['이름', '구분', '금액', '결제수단']) {
      const th = screen.getByRole('columnheader', { name: label })
      expect(th.style.textAlign).toBe('center')
    }
  })

  it('회비 행의 이름·구분·금액·결제수단 셀이 모두 중앙 정렬이다', () => {
    render(<DuesTable settlementId="settle-preview-1" />)
    // "회비"/"찬조" 텍스트는 "행 추가" 폼의 <option>에도 같은 문자열이 있어 getByText가 모호해질
    // 수 있으므로, 금액 입력칸을 기준으로 같은 행의 형제 td를 따라가 셀을 특정한다.
    const amountCell = screen.getByLabelText('가상회원A 회비 금액').closest('td')!
    const categoryCell = amountCell.previousElementSibling as HTMLElement
    const nameCell = categoryCell.previousElementSibling as HTMLElement
    const methodCell = screen.getByLabelText('가상회원A 회비 결제수단').closest('td')!
    expect(nameCell.style.textAlign).toBe('center')
    expect(categoryCell.textContent).toBe('회비')
    expect(categoryCell.style.textAlign).toBe('center')
    expect(amountCell.style.textAlign).toBe('center')
    expect(methodCell.style.textAlign).toBe('center')
  })

  it('찬조 행도 회비 행과 같은 열 정렬(구분·금액·결제수단 중앙 정렬)을 갖는다', () => {
    render(<DuesTable settlementId="settle-preview-1" />)
    fireEvent.click(screen.getByText('+ 찬조'))
    const amountCell = screen.getByLabelText('가상회원A 찬조 금액').closest('td')!
    const categoryCell = amountCell.previousElementSibling as HTMLElement
    const methodCell = screen.getByLabelText('가상회원A 찬조 결제수단').closest('td')!
    expect(categoryCell.textContent).toBe('찬조')
    expect(categoryCell.style.textAlign).toBe('center')
    expect(amountCell.style.textAlign).toBe('center')
    expect(methodCell.style.textAlign).toBe('center')
  })

  it('긴 이름이 셀 폭을 넘기지 않도록 말줄임(overflow:hidden, textOverflow:ellipsis) 스타일을 갖는다', () => {
    useSettlementStore.setState({
      settlements: [fakeSettlement({
        participants: [
          { id: 'p1', participantType: 'member', memberId: 'p1', displayName: '아주아주긴가상이름테스트', addedVia: 'meeting_attendee' },
        ],
      })],
      currentId: 'settle-preview-1',
    })
    render(<DuesTable settlementId="settle-preview-1" />)
    const nameCell = screen.getByText('아주아주긴가상이름테스트').closest('td')!
    expect(nameCell.style.overflow).toBe('hidden')
    expect(nameCell.style.textOverflow).toBe('ellipsis')
    expect(nameCell.style.whiteSpace).toBe('nowrap')
  })

  it('현금 결제수단은 확인상태 select가 계속 보이지 않는다(레이아웃 변경 후에도 정책 유지)', () => {
    render(<DuesTable settlementId="settle-preview-1" />)
    fireEvent.change(screen.getByLabelText('가상회원A 회비 결제수단'), { target: { value: '현금' } })
    expect(screen.queryByLabelText('가상회원A 회비 확인상태')).not.toBeInTheDocument()
  })

  it('계좌이체 결제수단은 확인상태 select가 계속 보인다(레이아웃 변경 후에도 정책 유지)', () => {
    render(<DuesTable settlementId="settle-preview-1" />)
    fireEvent.change(screen.getByLabelText('가상회원A 회비 결제수단'), { target: { value: '계좌이체' } })
    expect(screen.getByLabelText('가상회원A 회비 확인상태')).toBeInTheDocument()
  })

  it('표 wrapper가 자체 가로 스크롤(overflowX:auto)을 가져 화면 전체가 밀리지 않는다', () => {
    const { container } = render(<DuesTable settlementId="settle-preview-1" />)
    const wrapper = container.querySelector('table')!.parentElement as HTMLElement
    expect(wrapper.style.overflowX).toBe('auto')
  })

  it('표 최소 너비가 기존(480px)보다 좁아져(394px) 320px대 화면에서도 스크롤 폭이 과도하지 않다', () => {
    const { container } = render(<DuesTable settlementId="settle-preview-1" />)
    const table = container.querySelector('table')!
    expect(table.style.minWidth).toBe('394px')
  })
})

describe('행 추가 폼 — 금액 입력칸 천단위 콤마 표시', () => {
  it('행 추가 금액칸에 1234567을 입력하면 1,234,567로 보인다', () => {
    render(<DuesTable settlementId="settle-preview-1" />)
    const input = screen.getByLabelText('금액') as HTMLInputElement
    fireEvent.change(input, { target: { value: '1234567' } })
    expect(input.value).toBe('1,234,567')
  })
})

describe('입력 금액 합계 카드 — 표시 순서와 구분선', () => {
  it('회비 합계 → 찬조 합계 → 총수입(입력 기준) → 현금 합계 → 계좌이체 합계 순서로 표시된다', () => {
    render(<DuesTable settlementId="settle-preview-1" />)
    const grid = screen.getByText('입력 금액 합계').nextElementSibling as HTMLElement
    const labels = [...grid.children].filter((_, i) => i % 2 === 0).map((el) => el.textContent)
    expect(labels).toEqual(['회비 합계', '찬조 합계', '총수입(입력 기준)', '현금 합계', '계좌이체 합계'])
  })

  it('총수입(입력 기준) 위·현금 합계 위에만 구분선(border-top)이 있다 — 회비/찬조 사이, 현금/계좌이체 사이에는 없다', () => {
    render(<DuesTable settlementId="settle-preview-1" />)
    const grid = screen.getByText('입력 금액 합계').nextElementSibling as HTMLElement
    const labelCells = [...grid.children].filter((_, i) => i % 2 === 0) as HTMLElement[]
    const [duesLabel, donationLabel, totalLabel, cashLabel, transferLabel] = labelCells
    expect(duesLabel.style.borderTop).toBe('')
    expect(donationLabel.style.borderTop).toBe('')
    expect(totalLabel.style.borderTop).toBe('1px solid var(--border)')
    expect(cashLabel.style.borderTop).toBe('1px solid var(--border)')
    expect(transferLabel.style.borderTop).toBe('')
  })
})

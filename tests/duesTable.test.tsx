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

describe('회비·찬조 금액 입력칸 너비 — 지출 탭과 같은 공용 스타일 재사용', () => {
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

  it('회비 금액 입력칸이 compactMoneyInputStyle(width:100%, minWidth:100)을 갖는다', () => {
    render(<DuesTable settlementId="settle-preview-1" />)
    const input = screen.getByLabelText('가상회원A 회비 금액') as HTMLInputElement
    expect(input.style.width).toBe('100%')
    expect(input.style.minWidth).toBe('100px')
  })

  it('730,700처럼 7자리 숫자를 입력해도(문자 그대로) 값이 잘리지 않는다', () => {
    render(<DuesTable settlementId="settle-preview-1" />)
    const input = screen.getByLabelText('가상회원A 회비 금액') as HTMLInputElement
    fireEvent.change(input, { target: { value: '730700' } })
    expect(input.value).toBe('730700')
    fireEvent.blur(input)
    expect(useSettlementStore.getState().getById('settle-preview-1')!.participants[0].dues?.amount).toBe(730700)
  })

  it('찬조 금액 입력칸도 동일한 너비 스타일을 갖는다', () => {
    render(<DuesTable settlementId="settle-preview-1" />)
    fireEvent.click(screen.getByText('+ 찬조'))
    const input = screen.getByLabelText('가상회원A 찬조 금액') as HTMLInputElement
    expect(input.style.width).toBe('100%')
    expect(input.style.minWidth).toBe('100px')
  })
})

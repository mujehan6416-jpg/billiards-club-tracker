import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

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
import {
  duesEntriesOf, donationEntriesOf, withDuesEntries, withDonationEntries,
  buildIncomeTableRows, calcIncomeSummary, calcIncomeTableSummary, calcBankSummary, calcCashSummary,
  confirmedDonorNames, confirmedDonorAmounts, planDeleteTableRow,
} from '../src/logic/settlement'
import { buildMemberShareText, buildPresidentShareText, buildPublicSummary } from '../src/lib/settlementShareText'
import type { RegularSettlement, SettlementParticipant } from '../src/types/settlement'

// 회비·찬조 여러 행 입력 — 한 사람이 회비·찬조를 여러 번/여러 결제수단으로 나눠 내는 경우.
// 아래 이름·ID·금액은 전부 테스트용 가상 데이터이며 실제 회원 정보가 아니다.

const SID = 'settle-multi-1'

function person(overrides: Partial<SettlementParticipant> & { id: string; displayName: string }): SettlementParticipant {
  return { participantType: 'member', memberId: overrides.id, addedVia: 'meeting_attendee', ...overrides }
}

function fakeSettlement(overrides: Partial<RegularSettlement> = {}): RegularSettlement {
  return {
    id: SID,
    meetingName: '가상 정기모임',
    meetingDate: '2026-01-10',
    meetingType: 'regular',
    status: 'draft',
    participants: [person({ id: 'pa', displayName: '가상회원A' })],
    expenses: [],
    dinnerContributions: [],
    cashDeposits: [],
    prevBankBalance: 100000,
    otherBankAdjustment: 0,
    createdAt: '2026-01-10T00:00:00.000Z',
    confirmedAt: '2026-01-10T12:00:00.000Z',
    version: 0,
    revisionLog: [],
    ...overrides,
  }
}

/** 가상회원A: 회비 2행 · 찬조 2행(여러 행 구조) */
const multiA = (): SettlementParticipant => person({
  id: 'pa', displayName: '가상회원A',
  duesPayments: [
    { amount: 50000, method: '계좌이체', status: '미확인' },
    { amount: 30000, method: '현금', status: '입금확인' },
  ],
  dues: { amount: 50000, method: '계좌이체', status: '미확인' },
  donationPayments: [
    { amount: 100000, method: '현금', status: '입금확인' },
    { amount: 50000, method: '계좌이체', status: '입금확인' },
  ],
  donation: { amount: 100000, method: '현금', status: '입금확인' },
})

/** 가상회원B: 예전 단일 dues/donation 구조(배열 없음) */
const legacyB = (): SettlementParticipant => person({
  id: 'pb', displayName: '가상회원B',
  dues: { amount: 30000, method: '현금', status: '입금확인' },
  donation: { amount: 20000, method: '계좌이체', status: '입금확인' },
})

const getSt = () => useSettlementStore.getState().getById(SID)!
const getP = (id = 'pa') => getSt().participants.find((p) => p.id === id)!

beforeEach(() => {
  useSettlementStore.setState({ settlements: [fakeSettlement()], currentId: SID, syncStatus: 'idle', lastSyncError: null })
  useAdminAuthStore.setState({ status: 'authorizedAdmin', uid: 'fake-admin-uid', email: 'fake-admin@example.test', adminDisplayName: '가상관리자', errorMessage: null })
  saveSettlementMock.mockReset()
  saveSettlementMock.mockResolvedValue(1)
})

describe('A. 기존 데이터 호환 — 변환 없이 1행으로 읽는다', () => {
  it('1. 기존 dues만 있는 참가자 → 회비 1행', () => {
    const b = legacyB()
    expect(duesEntriesOf(b)).toEqual([b.dues])
    const rows = buildIncomeTableRows([b]).filter((r) => r.category === 'dues')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ index: 0, saved: true, amount: 30000, method: '현금' })
  })

  it('2. 기존 donation만 있는 참가자 → 찬조 1행', () => {
    const b = person({ id: 'pb', displayName: '가상회원B', donation: { amount: 20000, method: '현금', status: '입금확인' } })
    expect(donationEntriesOf(b)).toEqual([b.donation])
    expect(buildIncomeTableRows([b]).filter((r) => r.category === 'donation')).toHaveLength(1)
    // 회비가 없으면 예전처럼 기본 빈 회비 행 1개(저장 안 됨)
    expect(buildIncomeTableRows([b]).filter((r) => r.category === 'dues')).toEqual([
      expect.objectContaining({ saved: false, amount: undefined, method: undefined }),
    ])
  })

  it('배열이 있으면 배열이 기준이다(첫 행 복사본 dues는 두 번 세지 않는다)', () => {
    expect(duesEntriesOf(multiA())).toHaveLength(2)
    expect(donationEntriesOf(multiA())).toHaveLength(2)
  })

  it('3. 기존(단일 값) 정산과 같은 내용을 배열로 저장한 정산은 합계·공유 문구·회원 공개 요약이 모두 같다', () => {
    const legacy = fakeSettlement({ participants: [legacyB()] })
    const asArrays = fakeSettlement({
      participants: [withDonationEntries(withDuesEntries(legacyB(), [legacyB().dues!]), [legacyB().donation!])],
    })
    expect(asArrays.participants[0].duesPayments).toHaveLength(1)
    expect(calcIncomeSummary(asArrays)).toEqual(calcIncomeSummary(legacy))
    expect(calcIncomeTableSummary(asArrays)).toEqual(calcIncomeTableSummary(legacy))
    expect(calcBankSummary(asArrays)).toEqual(calcBankSummary(legacy))
    expect(buildMemberShareText(asArrays)).toBe(buildMemberShareText(legacy))
    expect(buildPresidentShareText(asArrays)).toBe(buildPresidentShareText(legacy))
    expect(buildPublicSummary(asArrays)).toEqual(buildPublicSummary(legacy))
    // 기존 정산의 값 자체도 그대로(회비 30,000 현금 + 찬조 20,000 계좌이체 입금확인)
    expect(calcIncomeSummary(legacy).totalIncome).toBe(50000)
  })
})

describe('B. 여러 행 — store 동작', () => {
  const store = () => useSettlementStore.getState()

  it('4. 회비 2행 추가 / 5. 찬조 2행 추가', () => {
    store().updatePaymentRow(SID, 'pa', 'dues', 0, { amount: 50000, method: '계좌이체' })
    store().updatePaymentRow(SID, 'pa', 'dues', 1, { amount: 30000, method: '현금' })
    store().updatePaymentRow(SID, 'pa', 'donation', 0, { amount: 100000, method: '현금' })
    store().updatePaymentRow(SID, 'pa', 'donation', 1, { amount: 50000, method: '계좌이체' })
    expect(duesEntriesOf(getP()).map((d) => d.amount)).toEqual([50000, 30000])
    expect(donationEntriesOf(getP()).map((d) => d.amount)).toEqual([100000, 50000])
  })

  it('6. 결제수단은 행마다 따로 — 7. 확인상태도 행마다 따로(현금→입금확인, 계좌이체→미확인)', () => {
    store().updatePaymentRow(SID, 'pa', 'dues', 0, { amount: 50000, method: '계좌이체' })
    store().updatePaymentRow(SID, 'pa', 'dues', 1, { amount: 30000, method: '현금' })
    expect(duesEntriesOf(getP()).map((d) => [d.method, d.status])).toEqual([['계좌이체', '미확인'], ['현금', '입금확인']])
    // 둘째 행만 계좌이체 입금확인으로 바꿔도 첫 행은 그대로
    store().updatePaymentRow(SID, 'pa', 'dues', 1, { method: '계좌이체' })
    store().updatePaymentRow(SID, 'pa', 'dues', 1, { status: '입금확인' })
    expect(duesEntriesOf(getP()).map((d) => [d.method, d.status])).toEqual([['계좌이체', '미확인'], ['계좌이체', '입금확인']])
  })

  it('8. 행 삭제는 그 행만 지운다 / 9. 마지막 행까지 지우면 빈 상태(첫 행 복사본도 비워짐)', () => {
    useSettlementStore.setState({ settlements: [fakeSettlement({ participants: [multiA()] })] })
    store().removePaymentRow(SID, 'pa', 'dues', 0)
    expect(duesEntriesOf(getP())).toEqual([{ amount: 30000, method: '현금', status: '입금확인' }])
    expect(getP().dues).toEqual({ amount: 30000, method: '현금', status: '입금확인' }) // 첫 행 복사본도 따라 바뀜
    expect(donationEntriesOf(getP())).toHaveLength(2) // 찬조는 영향 없음
    store().removePaymentRow(SID, 'pa', 'dues', 0)
    expect(duesEntriesOf(getP())).toEqual([])
    expect(getP().dues).toBeUndefined()
  })

  it('기존 단일 값 참가자에 행을 더하면 기존 값이 첫 행으로 남고 새 행이 뒤에 붙는다', () => {
    useSettlementStore.setState({ settlements: [fakeSettlement({ participants: [legacyB()] })] })
    store().updatePaymentRow(SID, 'pb', 'dues', 1, { amount: 10000, method: '계좌이체' })
    expect(duesEntriesOf(getP('pb')).map((d) => d.amount)).toEqual([30000, 10000])
    expect(getP('pb').dues).toEqual(legacyB().dues)
  })

  it('정산에만 추가한 사람(비회원)은 마지막 남은 행을 지우면 참가자 자체를 지운다 — 모임 참석자는 지우지 않는다', () => {
    const guest = person({ id: 'pg', displayName: '가상비회원', addedVia: 'manually_added_guest', participantType: 'guest', memberId: null,
      donationPayments: [{ amount: 10000, method: '현금', status: '입금확인' }, { amount: 5000, method: '현금', status: '입금확인' }] })
    expect(planDeleteTableRow(guest, 'donation', 0)).toEqual({ action: 'remove-row' })
    const lastOnly = withDonationEntries(guest, [{ amount: 5000, method: '현금', status: '입금확인' }])
    expect(planDeleteTableRow(lastOnly, 'donation', 0)).toEqual({ action: 'remove-participant' })
    expect(planDeleteTableRow(multiA(), 'dues', 0)).toEqual({ action: 'remove-row' })
  })
})

describe('C. 합계 — 여러 행을 모두 더한다', () => {
  const s = () => fakeSettlement({ participants: [multiA(), legacyB()] })

  it('10~14. 표 합계: 회비·찬조·현금·계좌이체·전체(확인상태와 관계없이 입력 금액 그대로)', () => {
    expect(calcIncomeTableSummary(s())).toEqual({
      duesTotal: 50000 + 30000 + 30000,
      donationTotal: 100000 + 50000 + 20000,
      cashTotal: 30000 + 100000 + 30000,
      transferTotal: 50000 + 50000 + 20000,
      totalIncome: 280000,
    })
  })

  it('15. 미확인 계좌이체는 회계 수입에서 빠지고 16. 입금확인 계좌이체는 들어간다', () => {
    const i = calcIncomeSummary(s())
    expect(i.duesCash).toBe(30000 + 30000)
    expect(i.duesTransferConfirmed).toBe(0)
    expect(i.duesTransferUnconfirmed).toBe(50000)
    expect(i.donationCash).toBe(100000)
    expect(i.donationTransferConfirmed).toBe(50000 + 20000)
    expect(i.totalIncome).toBe(280000 - 50000)
    // 현금 잔액·통장 잔액도 행별 결제수단 기준
    expect(calcCashSummary(s()).cashIncome).toBe(160000)
    expect(calcBankSummary(s()).confirmedTransferIncome).toBe(70000)
    expect(calcBankSummary(s()).unconfirmedTransferAmount).toBe(50000)
  })
})

describe('D. 찬조자 감사 문구', () => {
  it('17. 같은 사람의 여러 찬조 행은 확정된 행끼리 더해 한 줄(이름 한 번)', () => {
    expect(confirmedDonorNames([multiA(), legacyB()])).toEqual(['가상회원A', '가상회원B'])
    expect(confirmedDonorAmounts([multiA(), legacyB()])).toEqual([
      { name: '가상회원A', amount: 150000 },
      { name: '가상회원B', amount: 20000 },
    ])
  })

  it('18. 미확인 계좌이체 행은 기존 규칙대로 빠지고, 확정 행이 하나도 없으면 찬조자에서 빠진다', () => {
    const a = withDonationEntries(multiA(), [
      { amount: 100000, method: '현금', status: '입금확인' },
      { amount: 50000, method: '계좌이체', status: '미확인' },
    ])
    expect(confirmedDonorAmounts([a])).toEqual([{ name: '가상회원A', amount: 100000 }])
    const none = withDonationEntries(multiA(), [{ amount: 50000, method: '계좌이체', status: '미확인' }])
    expect(confirmedDonorNames([none])).toEqual([])
    // 대회 공유 문구에 확정 합계가 그대로 나온다
    const tour = fakeSettlement({ meetingType: 'tournament', participants: [multiA()] })
    expect(buildPublicSummary(tour).donorAmounts).toEqual([{ name: '가상회원A', amount: 150000 }])
  })
})

describe('E. 저장 — 배열 + 기존 필드에 첫 행 복사', () => {
  async function saveAndGetPayload() {
    fireEvent.click(screen.getByText('임시저장'))
    await waitFor(() => expect(saveSettlementMock).toHaveBeenCalledTimes(1))
    return saveSettlementMock.mock.calls[0][0] as RegularSettlement
  }

  it('19~22. duesPayments·donationPayments가 저장되고, dues = 첫 회비 행, donation = 첫 찬조 행', async () => {
    useSettlementStore.setState({ settlements: [fakeSettlement({ participants: [multiA()] })] })
    render(<DuesTable settlementId={SID} />)
    const saved = (await saveAndGetPayload()).participants[0]
    expect(saved.duesPayments).toEqual(multiA().duesPayments)
    expect(saved.donationPayments).toEqual(multiA().donationPayments)
    expect(saved.dues).toEqual(saved.duesPayments![0])
    expect(saved.donation).toEqual(saved.donationPayments![0])
  })

  it('화면에서 둘째 회비 행을 넣고 저장해도 첫 행 복사본(dues)은 첫 행 그대로다', async () => {
    useSettlementStore.setState({ settlements: [fakeSettlement({ participants: [legacyB()] })] })
    render(<DuesTable settlementId={SID} />)
    fireEvent.click(screen.getByText('+ 회비 추가'))
    fireEvent.change(screen.getByLabelText('가상회원B 회비 2 결제수단'), { target: { value: '계좌이체' } })
    fireEvent.change(screen.getByLabelText('가상회원B 회비 2 금액'), { target: { value: '10000' } })
    fireEvent.blur(screen.getByLabelText('가상회원B 회비 2 금액'))
    const saved = (await saveAndGetPayload()).participants[0]
    expect(saved.duesPayments).toEqual([legacyB().dues, { amount: 10000, method: '계좌이체', status: '미확인' }])
    expect(saved.dues).toEqual(legacyB().dues)
  })

  it('손대지 않은 기존 참가자는 저장해도 배열 필드가 생기지 않는다(일괄 변환 없음)', async () => {
    useSettlementStore.setState({ settlements: [fakeSettlement({ participants: [legacyB()] })] })
    render(<DuesTable settlementId={SID} />)
    const saved = (await saveAndGetPayload()).participants[0]
    expect(saved).toEqual(legacyB())
    expect('duesPayments' in saved).toBe(false)
  })
})

describe('F. 화면', () => {
  const rowsOf = (category: 'dues' | 'donation') =>
    screen.getAllByTestId('income-row').filter((r) => r.dataset.category === category)

  it('예전 단일 값 참가자(가상회원B)와 여러 행 참가자(가상회원A)가 함께 정상 표시된다', () => {
    useSettlementStore.setState({ settlements: [fakeSettlement({ participants: [multiA(), legacyB()] })] })
    render(<DuesTable settlementId={SID} />)
    expect(screen.getByLabelText('가상회원A 회비 금액')).toHaveValue('50,000')
    expect(screen.getByLabelText('가상회원A 회비 2 금액')).toHaveValue('30,000')
    expect(screen.getByLabelText('가상회원A 찬조 금액')).toHaveValue('100,000')
    expect(screen.getByLabelText('가상회원A 찬조 2 금액')).toHaveValue('50,000')
    expect(screen.getByLabelText('가상회원B 회비 금액')).toHaveValue('30,000')
    expect(screen.getByLabelText('가상회원B 찬조 금액')).toHaveValue('20,000')
    // 행마다 확인상태: A 회비 1행(계좌이체 미확인) select, A 회비 2행(현금)은 select 없음
    expect(screen.getByLabelText('가상회원A 회비 확인상태')).toHaveValue('미확인')
    expect(screen.queryByLabelText('가상회원A 회비 2 확인상태')).not.toBeInTheDocument()
    expect(screen.getByLabelText('가상회원A 찬조 2 확인상태')).toHaveValue('입금확인')
  })

  it('23. "+ 회비 추가"로 빈 행이 생기고, 금액을 넣어야 실제 행이 된다(빈 행은 저장 안 됨)', () => {
    render(<DuesTable settlementId={SID} />)
    fireEvent.change(screen.getByLabelText('가상회원A 회비 금액'), { target: { value: '50000' } })
    fireEvent.blur(screen.getByLabelText('가상회원A 회비 금액'))
    fireEvent.click(screen.getByText('+ 회비 추가'))
    expect(rowsOf('dues')).toHaveLength(2)
    expect(duesEntriesOf(getP())).toHaveLength(1) // 빈 행은 아직 저장 데이터가 아니다
    const blank = rowsOf('dues')[1]
    fireEvent.change(within(blank).getByRole('textbox'), { target: { value: '30000' } })
    fireEvent.blur(within(blank).getByRole('textbox'))
    expect(duesEntriesOf(getP()).map((d) => d.amount)).toEqual([50000, 30000])
    expect(rowsOf('dues')).toHaveLength(2)
  })

  it('24. "+ 찬조 추가"를 두 번 누르면 찬조 빈 행 2개, 각각 금액·결제수단을 따로 넣는다', () => {
    render(<DuesTable settlementId={SID} />)
    fireEvent.click(screen.getByText('+ 찬조 추가'))
    fireEvent.click(screen.getByText('+ 찬조 추가'))
    expect(rowsOf('donation')).toHaveLength(2)
    fireEvent.change(within(rowsOf('donation')[0]).getByRole('textbox'), { target: { value: '100000' } })
    fireEvent.blur(within(rowsOf('donation')[0]).getByRole('textbox'))
    fireEvent.change(screen.getByLabelText('가상회원A 찬조 결제수단'), { target: { value: '현금' } })
    const second = rowsOf('donation')[1]
    fireEvent.change(within(second).getByRole('combobox'), { target: { value: '계좌이체' } })
    fireEvent.change(screen.getByLabelText('가상회원A 찬조 2 금액'), { target: { value: '50000' } })
    fireEvent.blur(screen.getByLabelText('가상회원A 찬조 2 금액'))
    expect(donationEntriesOf(getP())).toEqual([
      { amount: 100000, method: '현금', status: '입금확인' },
      { amount: 50000, method: '계좌이체', status: '미확인' },
    ])
  })

  it('25. 행별 삭제 — 확인을 누르면 둘째 회비 행만 지우고 첫 행은 그대로', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    useSettlementStore.setState({ settlements: [fakeSettlement({ participants: [multiA()] })] })
    render(<DuesTable settlementId={SID} />)
    fireEvent.click(screen.getByLabelText('가상회원A 회비 2 삭제'))
    expect(confirmSpy).toHaveBeenCalledWith('가상회원A님 회비 30,000원(현금) 행을 지울까요?')
    expect(duesEntriesOf(getP())).toEqual([{ amount: 50000, method: '계좌이체', status: '미확인' }])
    expect(screen.getByLabelText('가상회원A 회비 금액')).toHaveValue('50,000')
    // 마지막 회비 행까지 지우면 기본 빈 회비 행만 남는다(모임 참석자는 지워지지 않음)
    fireEvent.click(screen.getByLabelText('가상회원A 회비 삭제'))
    expect(duesEntriesOf(getP())).toEqual([])
    expect(rowsOf('dues')).toHaveLength(1)
    expect(rowsOf('dues')[0].dataset.saved).toBe('false')
    expect(getSt().participants).toHaveLength(1)
    confirmSpy.mockRestore()
  })

  it('삭제 확인에서 취소를 누르면 아무것도 지우지 않는다 — 빈 행은 묻지 않고 바로 지운다', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    useSettlementStore.setState({ settlements: [fakeSettlement({ participants: [multiA()] })] })
    render(<DuesTable settlementId={SID} />)
    fireEvent.click(screen.getByLabelText('가상회원A 찬조 2 삭제'))
    expect(donationEntriesOf(getP())).toHaveLength(2)
    fireEvent.click(screen.getByText('+ 찬조 추가'))
    expect(rowsOf('donation')).toHaveLength(3)
    confirmSpy.mockClear()
    fireEvent.click(screen.getByLabelText('가상회원A 찬조 3 삭제'))
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(rowsOf('donation')).toHaveLength(2)
    confirmSpy.mockRestore()
  })

  it('행 추가 버튼과 삭제 버튼은 폰에서 누르기 쉬운 높이(44px 이상)다', () => {
    useSettlementStore.setState({ settlements: [fakeSettlement({ participants: [multiA()] })] })
    render(<DuesTable settlementId={SID} />)
    for (const label of ['가상회원A 회비 추가', '가상회원A 찬조 추가', '가상회원A 회비 삭제', '가상회원A 찬조 2 삭제']) {
      expect(screen.getByLabelText(label).style.minHeight).toBe('44px')
    }
  })

  it('폰 폭(390px)에 맞춘 4열 표 — 삭제 열이 따로 없고, 한 행이 2줄: [금액][결제수단] / [확인상태][삭제]', () => {
    useSettlementStore.setState({ settlements: [fakeSettlement({ participants: [multiA()] })] })
    render(<DuesTable settlementId={SID} />)
    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['이름', '구분', '금액', '결제수단'])
    expect(table.style.minWidth).toBe('330px') // 예전 394px → 표 영역(약 360px) 안에 들어간다
    for (const row of screen.getAllByTestId('income-row')) expect(row.children).toHaveLength(4)
    // 계좌이체 행: 금액 칸 아래에 확인상태, 결제수단 칸 아래에 삭제
    const amountCell = screen.getByLabelText('가상회원A 회비 금액').closest('td')!
    const methodCell = screen.getByLabelText('가상회원A 회비 결제수단').closest('td')!
    expect(within(amountCell).getByLabelText('가상회원A 회비 확인상태')).toBeInTheDocument()
    expect(within(methodCell).getByLabelText('가상회원A 회비 삭제')).toBeInTheDocument()
    // 현금 행: 금액 칸 아래에 "입금확인" 글자, 결제수단 칸 아래에 삭제
    const cashAmountCell = screen.getByLabelText('가상회원A 회비 2 금액').closest('td')!
    expect(within(cashAmountCell).getByTestId('cash-status').textContent).toBe('입금확인')
    expect(within(screen.getByLabelText('가상회원A 회비 2 결제수단').closest('td')!).getByLabelText('가상회원A 회비 2 삭제')).toBeInTheDocument()
    // "+ 회비 추가 / + 찬조 추가" 줄은 이름 칸 뒤 3칸을 차지한다
    expect(screen.getByText('+ 회비 추가').closest('td')!.colSpan).toBe(3)
  })

  it('선택칸(결제수단·확인상태)도 손가락으로 누르기 쉬운 높이(44px)다', () => {
    useSettlementStore.setState({ settlements: [fakeSettlement({ participants: [multiA()] })] })
    render(<DuesTable settlementId={SID} />)
    for (const label of ['가상회원A 회비 결제수단', '가상회원A 회비 확인상태', '가상회원A 찬조 2 결제수단', '가상회원A 찬조 2 확인상태']) {
      expect(screen.getByLabelText(label).style.minHeight).toBe('44px')
    }
  })

  it('"행 추가"로 이미 회비가 있는 사람 이름을 넣으면 막지 않고 회비 행을 하나 더 붙인다', () => {
    useSettlementStore.setState({ settlements: [fakeSettlement({ participants: [legacyB()] })] })
    render(<DuesTable settlementId={SID} />)
    fireEvent.change(screen.getByLabelText('추가할 사람 이름'), { target: { value: '가상회원B' } })
    fireEvent.change(screen.getByLabelText('금액'), { target: { value: '5000' } })
    fireEvent.change(screen.getByLabelText('결제수단'), { target: { value: '현금' } })
    fireEvent.click(screen.getByRole('button', { name: '행 추가' }))
    expect(duesEntriesOf(getP('pb')).map((d) => d.amount)).toEqual([30000, 5000])
    expect(getSt().participants).toHaveLength(1)
  })

  it('26. 확정된 정산은 추가·삭제 버튼이 없고 입력칸이 잠기며, store도 수정을 거부한다', () => {
    useSettlementStore.setState({ settlements: [fakeSettlement({ status: 'confirmed', participants: [multiA()] })] })
    render(<DuesTable settlementId={SID} />)
    expect(screen.queryByText('+ 회비 추가')).not.toBeInTheDocument()
    expect(screen.queryByText('+ 찬조 추가')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('가상회원A 회비 2 삭제')).not.toBeInTheDocument()
    expect(screen.getByLabelText('가상회원A 회비 2 금액')).toBeDisabled()
    const res = useSettlementStore.getState().removePaymentRow(SID, 'pa', 'dues', 0)
    expect(res.ok).toBe(false)
    const res2 = useSettlementStore.getState().updatePaymentRow(SID, 'pa', 'dues', 2, { amount: 1 })
    expect(res2.ok).toBe(false)
    expect(duesEntriesOf(getP())).toHaveLength(2)
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

// settlementSync(Firestore 실제 호출부)를 통째로 모킹 — 실제 Firebase에 절대 접근하지 않는다.
const syncMocks = vi.hoisted(() => ({
  saveSettlement: vi.fn(), listSettlements: vi.fn(), getSettlement: vi.fn(),
}))
vi.mock('../src/lib/settlementSync', () => syncMocks)

import {
  buildDonationDetail, buildDonationDetailText, buildMemberShareText, buildPresidentShareText, buildPublicSummary,
  DONATION_THANK_YOU_LINES, NO_CONFIRMED_DONATION_TEXT,
} from '../src/lib/settlementShareText'
import { calcIncomeSummary } from '../src/logic/settlement'
import { SettlementSharePreview } from '../src/components/settlement/SettlementSharePreview'
import { useSettlementStore } from '../src/store/settlementStore'
import { useAdminAuthStore } from '../src/store/adminAuthStore'
import type { RegularSettlement, SettlementParticipant, DonationPayment } from '../src/types/settlement'

// 아래 이름·ID·금액은 전부 테스트용 가상 데이터이며 실제 회원 정보가 아니다.

const ID = 'settle-donation-share-1'

const THANK_YOU = [
  '소중한 찬조를 보내주신 모든 분들께',
  '진심으로 감사드립니다.',
  '',
  '여러분의 따뜻한 마음 덕분에',
  '행사를 더욱 풍성하게 진행할 수 있었습니다.',
  '감사합니다.',
].join('\n')

const RULE = '━━━━━━━━━━━━━━'

function person(id: string, name: string, donationPayments?: DonationPayment[], extra: Partial<SettlementParticipant> = {}): SettlementParticipant {
  return { id, participantType: 'member', memberId: id, displayName: name, addedVia: 'meeting_attendee', ...(donationPayments ? { donationPayments } : {}), ...extra }
}
const cash = (amount: number): DonationPayment => ({ amount, method: '현금', status: '입금확인' })
const transfer = (amount: number, status: DonationPayment['status'] = '입금확인'): DonationPayment => ({ amount, method: '계좌이체', status })

function fake(over: Partial<RegularSettlement> = {}): RegularSettlement {
  return {
    id: ID, meetingName: '가상 정기모임', meetingDate: '2026-10-05', meetingType: 'regular', status: 'confirmed',
    participants: [], expenses: [], dinnerContributions: [], cashDeposits: [],
    prevBankBalance: 1_000_000, otherBankAdjustment: 0,
    createdAt: '2026-10-01T00:00:00.000Z', confirmedAt: '2026-10-06T00:00:00.000Z', version: 1, revisionLog: [],
    ...over,
  }
}

const threeDonors = () => fake({
  participants: [
    person('p1', '김가상', [cash(100_000)]),
    person('p2', '이가상', [transfer(50_000)]),
    person('p3', '박가상', [cash(30_000)]),
    person('p4', '최가상'), // 찬조 없음
  ],
})

describe('찬조 상세내역 — 찬조금 집계', () => {
  it('1. 찬조자 3명 → 이름과 금액이 순서대로 표시되고 합계가 나온다', () => {
    const text = buildDonationDetailText(threeDonors())
    expect(text).toContain('[찬조금]\n\n김가상 100,000원\n이가상 50,000원\n박가상 30,000원\n\n찬조금 합계: 180,000원')
    expect(text).not.toContain('최가상') // 찬조 없는 참가자는 나오지 않는다
    expect(buildDonationDetail(threeDonors()).total).toBe(180_000)
  })

  it('2. 한 사람이 donationPayments[]로 2회 찬조 → 회원별 합계로 한 줄', () => {
    const s = fake({ participants: [person('p1', '홍가상', [cash(30_000), cash(20_000)]), person('p2', '이가상', [cash(10_000)])] })
    const text = buildDonationDetailText(s)
    expect(text).toContain('홍가상 50,000원')
    expect(text.match(/홍가상/g)).toHaveLength(1)
    expect(text).toContain('찬조금 합계: 60,000원')
  })

  it('3. 현금 + 입금확인 계좌이체 → 둘 다 합산', () => {
    const s = fake({ participants: [person('p1', '홍가상', [cash(30_000), transfer(20_000, '입금확인')])] })
    expect(buildDonationDetail(s).donors).toEqual([{ name: '홍가상', amount: 50_000 }])
  })

  it('4. 미확인 계좌이체는 기존 회계 규칙대로 제외된다 (그 사람이 현금도 냈다면 현금만)', () => {
    const s = fake({
      participants: [
        person('p1', '홍가상', [cash(30_000), transfer(20_000, '미확인')]),
        person('p2', '이가상', [transfer(70_000, '미확인')]), // 확정된 것이 하나도 없음 → 명단에서 빠짐
      ],
    })
    const text = buildDonationDetailText(s)
    expect(text).toContain('홍가상 30,000원')
    expect(text).not.toContain('이가상')
    expect(text).toContain('찬조금 합계: 30,000원')
  })

  it('찬조금 합계가 기존 정산 계산(calcIncomeSummary)의 찬조 합계와 같다', () => {
    const s = fake({
      participants: [
        person('p1', '홍가상', [cash(30_000), transfer(20_000)]),
        person('p2', '이가상', [transfer(70_000, '미확인')]),
        person('p3', '박가상', [cash(5_000)]),
      ],
    })
    const income = calcIncomeSummary(s)
    expect(buildDonationDetail(s).total).toBe(income.donationCash + income.donationTransferConfirmed + income.donationOther)
  })

  it('예전 형식(donation 하나만, 배열 없음)도 그대로 읽는다', () => {
    const s = fake({ participants: [person('p1', '구가상', undefined, { donation: { amount: 40_000, method: '현금', status: '입금확인' } })] })
    expect(buildDonationDetail(s).donors).toEqual([{ name: '구가상', amount: 40_000 }])
  })

  it('금액순으로 정렬하지 않고 참가자 순서를 유지한다', () => {
    const s = fake({ participants: [person('p1', '가', [cash(1_000)]), person('p2', '나', [cash(900_000)]), person('p3', '다', [cash(50_000)])] })
    expect(buildDonationDetail(s).donors.map((d) => d.name)).toEqual(['가', '나', '다'])
  })

  it('5. 찬조자가 없으면 빈 상태 안내가 나오고 합계 줄은 없다', () => {
    const text = buildDonationDetailText(fake({ participants: [person('p1', '김가상')] }))
    expect(text).toContain(`[찬조금]\n\n${NO_CONFIRMED_DONATION_TEXT}`)
    expect(text).not.toContain('찬조금 합계')
    expect(buildDonationDetail(fake()).donors).toEqual([])
  })

  it('0원 찬조·취소된 찬조는 확정된 찬조자가 아니다', () => {
    const s = fake({ participants: [person('p1', '영가상', [cash(0)]), person('p2', '취소가상', [{ amount: 9_000, method: '계좌이체', status: '취소' }])] })
    expect(buildDonationDetail(s).donors).toEqual([])
  })
})

describe('찬조 상세내역 — 물품찬조 직접 입력 / 감사 인사 / 형식', () => {
  it('6. 물품찬조 입력은 줄바꿈 그대로 공유문에 들어간다', () => {
    const gifts = '김가상 - 와인 2병\n이가상 - 상품권 10만원\n박가상 - 당구용품 3세트'
    const text = buildDonationDetailText(threeDonors(), gifts)
    expect(text).toContain(`[물품찬조]\n\n${gifts}`)
  })

  it('물품찬조 입력은 앞뒤 빈 줄·공백과 \\r\\n만 정리하고 중간 줄(빈 줄 포함)은 그대로 둔다', () => {
    const text = buildDonationDetailText(threeDonors(), '\r\n  가 - 하나\r\n\r\n나 - 둘  \r\n\r\n')
    expect(text).toContain('[물품찬조]\n\n가 - 하나\n\n나 - 둘\n\n\n' + RULE)
    expect(text).not.toContain('\r')
  })

  it('7. 물품찬조가 비어 있거나 공백뿐이면 물품찬조 섹션이 통째로 빠진다', () => {
    for (const empty of ['', '   ', '\n\n  \n']) {
      expect(buildDonationDetailText(threeDonors(), empty)).not.toContain('물품찬조')
    }
    expect(buildDonationDetailText(threeDonors())).not.toContain('물품찬조')
  })

  it('8. 감사 인사가 항상 공유문의 가장 아래에 있다 (물품찬조 유무·찬조자 유무와 무관)', () => {
    const cases = [
      buildDonationDetailText(threeDonors()),
      buildDonationDetailText(threeDonors(), '김가상 - 와인 2병'),
      buildDonationDetailText(fake(), '김가상 - 와인 2병'),
      buildDonationDetailText(fake()),
    ]
    for (const t of cases) {
      expect(t.endsWith(THANK_YOU)).toBe(true)
      expect(t.split(THANK_YOU)).toHaveLength(2) // 한 번만
    }
    expect(DONATION_THANK_YOU_LINES.join('\n')).toBe(THANK_YOU)
  })

  it('요청한 카카오톡 형식 그대로 만들어진다', () => {
    const text = buildDonationDetailText(
      fake({ participants: [person('p1', '김가상', [cash(100_000)]), person('p2', '이가상', [cash(50_000)]), person('p3', '박가상', [cash(30_000)])] }),
      '김가상 - 와인 2병\n이가상 - 상품권 10만원',
    )
    expect(text).toBe([
      RULE, '🎁 찬조 내역', RULE, '',
      '[찬조금]', '',
      '김가상 100,000원', '이가상 50,000원', '박가상 30,000원', '',
      '찬조금 합계: 180,000원', '', '',
      '[물품찬조]', '',
      '김가상 - 와인 2병', '이가상 - 상품권 10만원', '', '',
      RULE, '',
      THANK_YOU,
    ].join('\n'))
  })

  it('물품찬조가 없으면 찬조금 합계 뒤에 바로 구분선과 감사 인사가 이어진다', () => {
    const text = buildDonationDetailText(fake({ participants: [person('p1', '김가상', [cash(100_000)])] }))
    expect(text).toBe([RULE, '🎁 찬조 내역', RULE, '', '[찬조금]', '', '김가상 100,000원', '', '찬조금 합계: 100,000원', '', '', RULE, '', THANK_YOU].join('\n'))
  })

  it('11. 이름과 금액만 사용한다 — 참가자에 전화번호·이메일·주소가 들어 있어도 공유문에 나오지 않는다', () => {
    const s = fake({
      participants: [person('p1', '김가상', [cash(100_000)], { phone: '010-1234-5678', email: 'secret@example.test', address: '가상시 가상구 1번지' } as unknown as Partial<SettlementParticipant>)],
    })
    const text = buildDonationDetailText(s)
    for (const leak of ['010-1234-5678', '1234', 'secret@example.test', '@', '가상시 가상구', '주소', '전화', '이메일']) {
      expect(text).not.toContain(leak)
    }
  })
})

describe('9·10. 기존 회원용/회장 보고용 공유문은 그대로다', () => {
  const base = () => fake({
    participants: [person('p1', '김가상', [cash(50_000)])],
  })

  it('회원용 공유문이 예전과 똑같다 (고정 기대값)', () => {
    expect(buildMemberShareText(base())).toBe([
      '[가상 정기모임] 2026-10-05', '',
      '총수입 50,000원', '회비 0원', '찬조금 50,000원', '',
      '총지출 0원', '',
      '[가상 정기모임] 손익 50,000원', '',
      '찬조해 주신 김가상 회원님께 감사드립니다.',
    ].join('\n'))
  })

  it('회장 보고용 공유문은 찬조 상세내역 기능과 무관하게 같다 (고정 기대값 — 상단 요약 + 현금 흐름표, 자금이동·지출 없음)', () => {
    expect(buildPresidentShareText(base())).toBe([
      '[가상 정기모임] 2026-10-05', '',
      '[관리자 보고용]', '',
      '전월 통장 잔액 : 1,000,000원', '',
      '총수입금액 : 50,000원', '',
      '총지출금액 : 0원', '',
      '현재 통장 잔액 : 1,000,000원',
      '계좌이체 미확인 금액 : 0원', '', '',
      '[현금 흐름표]', '',
      '현금 찬조금', '+50,000원 → 보유 50,000원', '',
      '현재 보유 현금 : 50,000원',
      '전체 보유액 : 1,050,000원',
    ].join('\n'))
  })

  it('찬조 상세내역을 만들어도 원본과 다른 공유문·공개 요약은 바뀌지 않는다', () => {
    const s = base()
    const before = { m: buildMemberShareText(s), p: buildPresidentShareText(s), pub: JSON.stringify(buildPublicSummary(s)), src: JSON.stringify(s) }
    buildDonationDetailText(s, '김가상 - 와인')
    expect(buildMemberShareText(s)).toBe(before.m)
    expect(buildPresidentShareText(s)).toBe(before.p)
    expect(JSON.stringify(buildPublicSummary(s))).toBe(before.pub)
    expect(JSON.stringify(s)).toBe(before.src)
    expect(JSON.stringify(buildPublicSummary(s))).not.toContain('와인')
  })
})

describe('공유 탭 화면', () => {
  const navAny = navigator as unknown as Record<string, unknown>
  const origShare = navAny.share
  const origClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')

  beforeEach(() => {
    Object.values(syncMocks).forEach((m) => m.mockReset())
    useSettlementStore.setState({ settlements: [threeDonors()], currentId: ID, syncStatus: 'idle', lastSyncError: null })
    useAdminAuthStore.setState({ status: 'authorizedAdmin', uid: 'fake-admin-uid', email: 'fake-admin@example.test', adminDisplayName: '가상관리자', errorMessage: null })
  })

  afterEach(() => {
    if (origShare === undefined) delete navAny.share
    else navAny.share = origShare
    if (origClipboard) Object.defineProperty(navigator, 'clipboard', origClipboard)
    else delete navAny.clipboard
  })

  const openDonation = () => {
    render(<SettlementSharePreview settlementId={ID} />)
    fireEvent.click(screen.getByRole('button', { name: '찬조 상세내역' }))
  }

  it('공유 종류 3가지(회원용 / 회장 보고용 / 찬조 상세내역) 버튼이 있고 선택한 것만 켜진다', () => {
    render(<SettlementSharePreview settlementId={ID} />)
    const seg = document.querySelector('.seg') as HTMLElement
    expect(within(seg).getAllByRole('button').map((b) => b.textContent)).toEqual(['회원용', '회장 보고용', '찬조 상세내역'])
    expect(within(seg).getByRole('button', { name: '회원용' })).toHaveClass('on')
    fireEvent.click(within(seg).getByRole('button', { name: '찬조 상세내역' }))
    expect(within(seg).getByRole('button', { name: '찬조 상세내역' })).toHaveClass('on')
    expect(within(seg).getByRole('button', { name: '회원용' })).not.toHaveClass('on')
  })

  it('기존 회원용·회장 보고용 화면은 예전 그대로다 (같은 문구, 같은 버튼, 회장용 안내문)', () => {
    render(<SettlementSharePreview settlementId={ID} />)
    const s = useSettlementStore.getState()
    expect(screen.getByText(/총수입/, { selector: '.card' })).toHaveTextContent(s.getMemberShareText(ID).split('\n')[0])
    expect(screen.getByRole('button', { name: '문구 복사 / 공유' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '이미지 저장 / 공유' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '회장 보고용' }))
    expect(screen.getByText(/\[관리자 보고용\]/)).toBeInTheDocument()
    expect(screen.getByText(/회장 보고용은 통장 잔액 등 내부 정보를 포함/)).toBeInTheDocument()
    // 찬조 상세내역 화면에는 이 두 버튼이 없다(별도 공유)
    fireEvent.click(screen.getByRole('button', { name: '찬조 상세내역' }))
    expect(screen.queryByRole('button', { name: '문구 복사 / 공유' })).not.toBeInTheDocument()
    expect(screen.queryByText(/회장 보고용은 통장 잔액/)).not.toBeInTheDocument()
  })

  it('찬조 상세내역: 찬조금 미리보기 → 물품찬조 입력 → 감사문구 → 공유 버튼 순서로 보인다', () => {
    openDonation()
    const root = screen.getByTestId('donation-detail-share')
    const order = ['찬조금 미리보기', '물품찬조 직접입력', '감사문구 미리보기', '찬조 상세내역 공유']
    const html = root.textContent ?? ''
    const idx = order.map((t) => html.indexOf(t))
    expect(idx.every((i) => i >= 0)).toBe(true)
    expect([...idx].sort((a, b) => a - b)).toEqual(idx)
    for (const [name, won] of [['김가상', '100,000원'], ['이가상', '50,000원'], ['박가상', '30,000원'], ['찬조금 합계', '180,000원']]) {
      expect(within(root).getByText(name).parentElement).toHaveTextContent(won)
    }
    expect(screen.getByTestId('donation-thank-you').textContent).toBe(THANK_YOU)
    const textarea = screen.getByLabelText(/물품찬조 직접입력/) as HTMLTextAreaElement
    expect(textarea.tagName).toBe('TEXTAREA')
    expect(parseInt(textarea.style.minHeight, 10)).toBeGreaterThanOrEqual(120)
    expect(parseInt(screen.getByRole('button', { name: '찬조 상세내역 공유' }).style.minHeight, 10)).toBeGreaterThanOrEqual(44)
  })

  it('확정된 찬조가 없으면 "확인된 찬조금 내역이 없습니다."가 보이고, 물품찬조도 없으면 공유 버튼이 꺼진다', () => {
    useSettlementStore.setState({ settlements: [fake({ participants: [person('p1', '김가상')] })] })
    openDonation()
    expect(screen.getByText(NO_CONFIRMED_DONATION_TEXT)).toBeInTheDocument()
    const btn = screen.getByRole('button', { name: '찬조 상세내역 공유' })
    expect(btn).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/물품찬조 직접입력/), { target: { value: '김가상 - 와인 2병' } })
    expect(btn).toBeEnabled()
  })

  it('공유: Web Share가 있으면 완성된 문구(물품찬조 줄바꿈 포함)로 호출한다', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    navAny.share = share
    openDonation()
    fireEvent.change(screen.getByLabelText(/물품찬조 직접입력/), { target: { value: '김가상 - 와인 2병\n이가상 - 상품권 10만원' } })
    fireEvent.click(screen.getByRole('button', { name: '찬조 상세내역 공유' }))
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1))
    const { text } = share.mock.calls[0][0] as { text: string }
    expect(text).toBe(buildDonationDetailText(useSettlementStore.getState().getById(ID)!, '김가상 - 와인 2병\n이가상 - 상품권 10만원'))
    expect(text).toContain('[물품찬조]\n\n김가상 - 와인 2병\n이가상 - 상품권 10만원')
    expect(text.endsWith(THANK_YOU)).toBe(true)
    expect(await screen.findByText('공유 창을 열었습니다.')).toBeInTheDocument()
  })

  it('공유: Web Share가 없으면 기존 방식대로 클립보드에 복사한다', async () => {
    delete navAny.share
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    openDonation()
    fireEvent.click(screen.getByRole('button', { name: '찬조 상세내역 공유' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(writeText.mock.calls[0][0]).toBe(buildDonationDetailText(useSettlementStore.getState().getById(ID)!))
    expect(await screen.findByText('클립보드에 복사했습니다.')).toBeInTheDocument()
  })

  it('물품찬조 입력은 서버·저장소에 저장되지 않는다 (정산 데이터·동기화 함수 호출 없음)', () => {
    const before = JSON.stringify(useSettlementStore.getState().getById(ID))
    openDonation()
    fireEvent.change(screen.getByLabelText(/물품찬조 직접입력/), { target: { value: '김가상 - 와인 2병' } })
    expect(JSON.stringify(useSettlementStore.getState().getById(ID))).toBe(before)
    expect(JSON.stringify(useSettlementStore.getState().getById(ID))).not.toContain('와인')
    for (const m of Object.values(syncMocks)) expect(m).not.toHaveBeenCalled()
  })

  it('물품찬조 입력은 탭을 오가도 유지되고, 다른 정산에는 따라가지 않는다', () => {
    useSettlementStore.setState({ settlements: [threeDonors(), { ...threeDonors(), id: 'other-settlement' }] })
    const { rerender } = render(<SettlementSharePreview settlementId={ID} />)
    fireEvent.click(screen.getByRole('button', { name: '찬조 상세내역' }))
    fireEvent.change(screen.getByLabelText(/물품찬조 직접입력/), { target: { value: '김가상 - 와인' } })
    fireEvent.click(screen.getByRole('button', { name: '회원용' }))
    fireEvent.click(screen.getByRole('button', { name: '찬조 상세내역' }))
    expect((screen.getByLabelText(/물품찬조 직접입력/) as HTMLTextAreaElement).value).toBe('김가상 - 와인')
    rerender(<SettlementSharePreview settlementId="other-settlement" />)
    expect((screen.getByLabelText(/물품찬조 직접입력/) as HTMLTextAreaElement).value).toBe('')
  })
})

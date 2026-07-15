import { describe, it, expect } from 'vitest'
import {
  buildGeneralDonorThankYou,
  buildTournamentDonorThankYou,
  buildDinnerThankYouTexts,
  buildMemberShareText,
  buildPresidentShareText,
  buildPublicSummary,
} from '../src/lib/settlementShareText'
import type { DinnerContribution, RegularSettlement, SettlementExpense, SettlementParticipant } from '../src/types/settlement'

// 아래 이름·ID·금액은 전부 테스트용 가상 데이터이며 실제 회원 정보가 아니다.

function baseSettlement(overrides: Partial<RegularSettlement> = {}): RegularSettlement {
  return {
    id: 'settle-test-1',
    meetingName: '가상 정기모임 1회차',
    meetingDate: '2026-01-10',
    meetingType: 'regular',
    status: 'confirmed',
    participants: [],
    expenses: [],
    dinnerContributions: [],
    cashDeposits: [],
    prevBankBalance: 200000,
    otherBankAdjustment: 0,
    createdAt: '2026-01-10T00:00:00.000Z',
    confirmedAt: '2026-01-11T00:00:00.000Z',
    version: 1,
    revisionLog: [],
    ...overrides,
  }
}

describe('buildGeneralDonorThankYou', () => {
  it('이름만 나열하고 금액은 표시하지 않는다', () => {
    const text = buildGeneralDonorThankYou(['테스트회원가', '테스트회원나', '테스트회원다'])
    expect(text).toBe('찬조해 주신 테스트회원가, 테스트회원나, 테스트회원다 회원님께 감사드립니다.')
  })
  it('찬조자가 없으면 null', () => {
    expect(buildGeneralDonorThankYou([])).toBeNull()
  })
})

describe('buildTournamentDonorThankYou', () => {
  it('이름과 금액을 함께 표시한다', () => {
    const text = buildTournamentDonorThankYou([
      { name: '테스트회원가', amount: 500000 },
      { name: '테스트회원나', amount: 300000 },
    ])
    expect(text).toBe('대회를 위해 찬조해 주신 회원님께 감사드립니다.\n테스트회원가 500,000원, 테스트회원나 300,000원')
  })
})

describe('buildDinnerThankYouTexts', () => {
  it('전액찬조 1명 문구', () => {
    const d: DinnerContribution[] = [
      { id: 'd1', dinnerRound: 1, totalAmount: 200000, method: '현금', clubShare: 0, contributionType: '전액찬조', contributors: [{ name: '테스트회원가', memberId: 'p1', amount: 200000, title: '회장님' }] },
    ]
    expect(buildDinnerThankYouTexts(d)).toEqual([
      '1차 회식비 전액을 부담해 주신 테스트회원가 회장님께 특별히 감사드립니다.',
    ])
  })

  it('전액찬조 2명 이상은 함께 부담 문구', () => {
    const d: DinnerContribution[] = [
      {
        id: 'd2', dinnerRound: 2, totalAmount: 150000, method: '현금', clubShare: 0, contributionType: '전액찬조',
        contributors: [
          { name: '테스트회원가', memberId: 'p1', amount: 100000, title: '회장님' },
          { name: '테스트회원나', memberId: 'p2', amount: 50000 },
        ],
      },
    ]
    expect(buildDinnerThankYouTexts(d)).toEqual([
      '2차 회식비를 함께 부담해 주신 테스트회원가 회장님, 테스트회원나 회원님께 특별히 감사드립니다.',
    ])
  })

  it('일부찬조는 특별히 문구를 쓰지 않는다', () => {
    const d: DinnerContribution[] = [
      { id: 'd3', dinnerRound: 1, totalAmount: 150000, method: '현금', clubShare: 50000, contributionType: '일부찬조', contributors: [{ name: '테스트회원가', memberId: 'p1', amount: 100000 }] },
    ]
    expect(buildDinnerThankYouTexts(d)).toEqual([
      '1차 회식비 일부를 찬조해 주신 테스트회원가 회원님께 감사드립니다.',
    ])
  })

  it('모임회계지출은 감사 문구를 만들지 않는다', () => {
    const d: DinnerContribution[] = [
      { id: 'd4', dinnerRound: 1, totalAmount: 100000, method: '현금', clubShare: 100000, contributionType: '모임회계지출', contributors: [] },
    ]
    expect(buildDinnerThankYouTexts(d)).toEqual([])
  })

  it('여러 차수는 회차 순서대로 각각 생성한다', () => {
    const d: DinnerContribution[] = [
      { id: 'd2', dinnerRound: 2, totalAmount: 100000, method: '현금', clubShare: 0, contributionType: '전액찬조', contributors: [{ name: '테스트회원나', memberId: 'p2', amount: 100000 }] },
      { id: 'd1', dinnerRound: 1, totalAmount: 100000, method: '현금', clubShare: 0, contributionType: '전액찬조', contributors: [{ name: '테스트회원가', memberId: 'p1', amount: 100000 }] },
    ]
    const texts = buildDinnerThankYouTexts(d)
    expect(texts[0]).toContain('1차')
    expect(texts[1]).toContain('2차')
  })
})

describe('buildMemberShareText', () => {
  it('통장 잔액·현금 보유액 관련 문구를 포함하지 않는다', () => {
    const participants: SettlementParticipant[] = [
      { id: 'p1', participantType: 'member', memberId: 'p1', displayName: '테스트회원가', addedVia: 'meeting_attendee', dues: { amount: 30000, method: '현금', status: '입금확인' }, donation: { amount: 10000, method: '현금', status: '입금확인' } },
    ]
    const expenses: SettlementExpense[] = [
      { id: 'e1', date: '2026-01-10', label: '당구장 대관', category: '대관비', amount: 20000, method: '현금', clubShare: 20000, personalDonation: 0 },
    ]
    const settlement = baseSettlement({ participants, expenses })
    const text = buildMemberShareText(settlement)

    expect(text).toContain('가상 정기모임 1회차')
    expect(text).toContain('총수입')
    expect(text).toContain('모임 순익')
    expect(text).toContain('찬조해 주신 테스트회원가 회원님께 감사드립니다.')
    expect(text).not.toContain('통장')
    expect(text).not.toContain('현금 보유')
  })
})

describe('buildPresidentShareText', () => {
  it('회원용 내용에 통장 정보를 추가로 포함한다', () => {
    const settlement = baseSettlement({
      participants: [
        { id: 'p1', participantType: 'member', memberId: 'p1', displayName: '테스트회원가', addedVia: 'meeting_attendee', dues: { amount: 30000, method: '계좌이체', status: '입금확인' } },
      ],
    })
    const text = buildPresidentShareText(settlement)
    expect(text).toContain('가상 정기모임 1회차') // 회원용 내용 포함
    expect(text).toContain('전월 통장 잔액')
    expect(text).toContain('현재 통장 잔액')
    expect(text).toContain('계좌이체 미확인 금액')
  })
})

describe('buildPublicSummary', () => {
  it('민감 필드를 포함하지 않는 공개용 요약을 만든다', () => {
    const settlement = baseSettlement({
      prevBankBalance: 999999,
      adminNote: '내부 메모 — 절대 공개 금지',
      participants: [
        { id: 'p1', participantType: 'member', memberId: 'p1', displayName: '테스트회원가', addedVia: 'meeting_attendee', dues: { amount: 30000, method: '현금', status: '입금확인' }, donation: { amount: 10000, method: '현금', status: '입금확인' } },
      ],
    })
    const summary = buildPublicSummary(settlement)

    expect(summary.donorNames).toEqual(['테스트회원가'])
    expect(summary.totalIncome).toBe(40000)

    const keys = Object.keys(summary)
    expect(keys).not.toContain('prevBankBalance')
    expect(keys).not.toContain('adminNote')
    expect(keys).not.toContain('participants')
    expect(keys).not.toContain('cashDeposits')
    expect(keys).not.toContain('revisionLog')
  })
})

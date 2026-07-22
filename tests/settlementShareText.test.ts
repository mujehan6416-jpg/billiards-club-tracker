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
    expect(text).toContain('손익')
    expect(text).toContain('찬조해 주신 테스트회원가 회원님께 감사드립니다.')
    expect(text).not.toContain('통장')
    expect(text).not.toContain('현금 보유')
  })

  it('[전체 형식 확인] 회식비(레거시)·지출 5건·회비·찬조·손익이 요청된 줄바꿈 형식 그대로 표시된다', () => {
    const participants: SettlementParticipant[] = [
      { id: 'p1', participantType: 'member', memberId: 'p1', displayName: '가상총무', addedVia: 'meeting_attendee', dues: { amount: 360000, method: '현금', status: '입금확인' } },
      { id: 'p2', participantType: 'member', memberId: 'p2', displayName: '가상회원1', addedVia: 'meeting_attendee', donation: { amount: 100000, method: '현금', status: '입금확인' } },
      { id: 'p3', participantType: 'member', memberId: 'p3', displayName: '가상회원2', addedVia: 'meeting_attendee', donation: { amount: 60000, method: '현금', status: '입금확인' } },
    ]
    const dinnerContributions: DinnerContribution[] = [
      { id: 'd1', dinnerRound: 1, totalAmount: 519000, clubShare: 519000, method: '현금', contributionType: '모임회계지출', contributors: [], paidBy: '운칠복삼' },
    ]
    const expenses: SettlementExpense[] = [
      { id: 'e1', date: '2026-07-15', label: '당구비(1차)', category: '당구비', amount: 140000, method: '현금', clubShare: 140000, personalDonation: 0 },
      { id: 'e2', date: '2026-07-15', label: '2차 당구비', category: '당구비', amount: 50000, method: '현금', clubShare: 50000, personalDonation: 0 },
      { id: 'e3', date: '2026-07-15', label: '주차비', category: '기타', amount: 10000, method: '현금', clubShare: 10000, personalDonation: 0 },
      { id: 'e4', date: '2026-07-15', label: '간식비', category: '다과비', amount: 8000, method: '현금', clubShare: 8000, personalDonation: 0 },
      { id: 'e5', date: '2026-07-15', label: '기타 운영비', category: '기타', amount: 8700, method: '현금', clubShare: 8700, personalDonation: 0 },
    ]
    const settlement = baseSettlement({
      meetingName: '25차 정기모임', meetingDate: '2026-07-15', participants, dinnerContributions, expenses,
    })
    const text = buildMemberShareText(settlement)

    expect(text).toBe(
      '[25차 정기모임] 2026-07-15\n' +
      '\n' +
      '총수입 520,000원\n' +
      '회비 360,000원\n' +
      '찬조금 160,000원\n' +
      '\n' +
      '총지출 735,700원\n' +
      '1차 회식비(운칠복삼) 519,000원\n' +
      '당구비(1차) 140,000원\n' +
      '2차 당구비 50,000원\n' +
      '주차비 10,000원\n' +
      '간식비 8,000원\n' +
      '기타 운영비 8,700원\n' +
      '\n' +
      '[25차 정기모임] 손익 -215,700원\n' +
      '\n' +
      '찬조해 주신 가상회원1, 가상회원2 회원님께 감사드립니다.',
    )
  })

  it('[누락 없음 확인] 지출이 여러 건이어도(6건) 몇 건만 골라 보여주지 않고 전부 표시되며, 나열된 금액 합이 총지출과 일치한다', () => {
    const expenses: SettlementExpense[] = Array.from({ length: 6 }, (_, i) => ({
      id: `e${i}`, date: '2026-01-10', label: `가상지출항목${i + 1}`, category: '기타',
      amount: 1000 * (i + 1), method: '현금' as const, clubShare: 1000 * (i + 1), personalDonation: 0,
    }))
    const settlement = baseSettlement({ expenses })
    const text = buildMemberShareText(settlement)

    for (let i = 1; i <= 6; i++) {
      expect(text).toContain(`가상지출항목${i} ${(1000 * i).toLocaleString('ko-KR')}원`)
    }
    // 총지출(1000+2000+...+6000=21000)과 나열된 항목 합이 일치해야 한다.
    expect(text).toContain('총지출 21,000원')
  })

  // [재현→수정 확인] 결제수단 select를 안 건드리고 금액만 입력한 찬조(현금, status 미확인 —
  // 실제 관리자 입력 화면에서 흔히 발생)가 여러 명이어도 카카오톡 공유 문구에 전원 표시되는지 확인.
  it('[일반 정기모임] 찬조자가 여러 명(현금 기본상태 포함)이면 전원 이름이 공유 문구에 표시된다', () => {
    const participants: SettlementParticipant[] = [
      { id: 'p1', participantType: 'member', memberId: 'p1', displayName: '가상회원A', addedVia: 'meeting_attendee', donation: { amount: 20000, method: '현금', status: '미확인' } },
      { id: 'p2', participantType: 'member', memberId: 'p2', displayName: '가상회원B', addedVia: 'meeting_attendee', donation: { amount: 30000, method: '현금', status: '미확인' } },
      { id: 'p3', participantType: 'guest', memberId: null, displayName: '외부찬조자C', addedVia: 'meeting_attendee', donation: { amount: 50000, method: '계좌이체', status: '입금확인' } },
    ]
    const settlement = baseSettlement({ meetingType: 'regular', participants })
    const text = buildMemberShareText(settlement)

    expect(text).toContain('찬조해 주신 가상회원A, 가상회원B, 외부찬조자C 회원님께 감사드립니다.')
  })

  it('[정기대회] 찬조자가 여러 명(현금 기본상태 포함)이면 전원 이름과 금액이 공유 문구에 표시된다', () => {
    const participants: SettlementParticipant[] = [
      { id: 'p1', participantType: 'member', memberId: 'p1', displayName: '가상회원A', addedVia: 'meeting_attendee', donation: { amount: 20000, method: '현금', status: '미확인' } },
      { id: 'p2', participantType: 'member', memberId: 'p2', displayName: '가상회원B', addedVia: 'meeting_attendee', donation: { amount: 30000, method: '현금', status: '미확인' } },
      { id: 'p3', participantType: 'guest', memberId: null, displayName: '외부찬조자C', addedVia: 'meeting_attendee', donation: { amount: 50000, method: '계좌이체', status: '입금확인' } },
    ]
    const settlement = baseSettlement({ meetingType: 'tournament', participants })
    const text = buildMemberShareText(settlement)

    expect(text).toContain('가상회원A 20,000원, 가상회원B 30,000원, 외부찬조자C 50,000원')
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

  it('회비·찬조·현금·계좌이체 합계, 지출 분류별 합계, 회식비 요약을 포함한다(일반회원 정산 공개용)', () => {
    const settlement = baseSettlement({
      participants: [
        { id: 'p1', participantType: 'member', memberId: 'p1', displayName: '테스트회원가', addedVia: 'meeting_attendee', dues: { amount: 30000, method: '현금', status: '입금확인' }, donation: { amount: 20000, method: '계좌이체', status: '입금확인' } },
      ],
      expenses: [
        { id: 'e1', date: '2026-01-10', label: '당구장 대관', category: '당구비', amount: 40000, method: '현금', clubShare: 40000, personalDonation: 0 },
      ],
      dinnerContributions: [
        { id: 'd1', dinnerRound: 1, totalAmount: 50000, method: '현금', clubShare: 50000, contributionType: '모임회계지출', contributors: [] },
      ],
    })
    const summary = buildPublicSummary(settlement)

    expect(summary.duesTotal).toBe(30000)
    expect(summary.donationTotal).toBe(20000)
    expect(summary.cashIncomeTotal).toBe(30000)
    expect(summary.transferIncomeTotal).toBe(20000)
    expect(summary.expenseByCategory).toEqual([
      { category: '당구비', amount: 40000 },
      { category: '회식비', amount: 50000 },
    ])
    expect(summary.dinnerSummary).toEqual({ roundCount: 1, clubShareTotal: 50000 })

    // 통장·현금 잔액 등 민감 정보는 여전히 포함하지 않는다
    const keys = Object.keys(summary)
    expect(keys).not.toContain('prevBankBalance')
    expect(keys).not.toContain('cashDeposits')
  })

  it('[재현 및 수정 확인] 회식비 탭 제거 후: 신규 지출분류 회식비 + 레거시 DinnerContribution이 dinnerSummary에서 중복 없이 합산된다', () => {
    const settlement = baseSettlement({
      expenses: [
        { id: 'e1', date: '2026-01-10', label: '2차 회식', category: '회식비', amount: 30000, method: '현금', clubShare: 30000, personalDonation: 0 },
      ],
      dinnerContributions: [
        { id: 'd1', dinnerRound: 1, totalAmount: 50000, method: '현금', clubShare: 50000, contributionType: '모임회계지출', contributors: [] },
      ],
    })
    const summary = buildPublicSummary(settlement)
    // roundCount: 레거시 1건 + 신규 1건 = 2, clubShareTotal: 30000 + 50000 = 80000 (중복 없음)
    expect(summary.dinnerSummary).toEqual({ roundCount: 2, clubShareTotal: 80000 })
  })

  it('레거시 회식비 데이터만 있어도 dinnerSummary·expenseByCategory 조회에 오류가 없다', () => {
    const settlement = baseSettlement({
      dinnerContributions: [
        { id: 'd1', dinnerRound: 1, totalAmount: 20000, method: '현금', clubShare: 20000, contributionType: '모임회계지출', contributors: [] },
      ],
    })
    expect(() => buildPublicSummary(settlement)).not.toThrow()
    const summary = buildPublicSummary(settlement)
    expect(summary.dinnerSummary).toEqual({ roundCount: 1, clubShareTotal: 20000 })
  })
})

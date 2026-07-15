import { describe, it, expect } from 'vitest'
import {
  calcIncomeSummary,
  calcExpenseSummary,
  calcProfitSummary,
  calcCashSummary,
  calcBankSummary,
  confirmedDonorNames,
  confirmedDonorAmounts,
  majorExpenses,
  canTransition,
  transitionStatus,
  isLocked,
  validateDinnerContribution,
  hasDuplicateDinnerRound,
  validateCashDeposit,
} from '../src/logic/settlement'
import type { RegularSettlement, SettlementParticipant, SettlementExpense, DinnerContribution } from '../src/types/settlement'

// 아래 이름·ID·금액은 전부 테스트용 가상 데이터이며 실제 회원 정보가 아니다.

function participant(overrides: Partial<SettlementParticipant> & { id: string; displayName: string }): SettlementParticipant {
  return {
    participantType: 'member',
    memberId: overrides.id,
    addedVia: 'meeting_attendee',
    ...overrides,
  }
}

function baseSettlement(overrides: Partial<RegularSettlement> = {}): RegularSettlement {
  return {
    id: 'settle-test-1',
    meetingName: '가상 정기모임 1회차',
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
    version: 1,
    revisionLog: [],
    ...overrides,
  }
}

describe('calcIncomeSummary', () => {
  it('현금·계좌이체 확인/미확인·기타를 구분해서 집계한다', () => {
    const settlement = baseSettlement({
      participants: [
        participant({
          id: 'p1', displayName: '테스트회원A',
          dues: { amount: 30000, method: '현금', status: '입금확인' },
          donation: { amount: 10000, method: '계좌이체', status: '입금확인' },
        }),
        participant({
          id: 'p2', displayName: '테스트회원B',
          dues: { amount: 30000, method: '계좌이체', status: '미확인' },
        }),
        participant({
          id: 'p3', displayName: '테스트회원C',
          dues: { amount: 30000, method: '계좌이체', status: '취소' },
          donation: { amount: 5000, method: '기타', status: '입금확인' },
        }),
      ],
    })
    const income = calcIncomeSummary(settlement)
    expect(income.duesCash).toBe(30000)
    expect(income.duesTransferConfirmed).toBe(0)
    expect(income.duesTransferUnconfirmed).toBe(30000)
    expect(income.donationTransferConfirmed).toBe(10000)
    expect(income.donationOther).toBe(5000)
    expect(income.otherIncome).toBe(5000)
    // 취소·미확인 건은 총수입에서 제외 → 30000(현금회비) + 10000(계좌이체찬조) + 5000(기타찬조)
    expect(income.totalIncome).toBe(45000)
  })
})

describe('calcExpenseSummary', () => {
  it('clubShare를 결제수단별로 합산하고, 회식비도 같은 결제수단 버킷에 합산한다', () => {
    const expenses: SettlementExpense[] = [
      { id: 'e1', date: '2026-01-10', label: '당구장 대관', category: '대관비', amount: 100000, method: '체크카드', clubShare: 100000, personalDonation: 0 },
      { id: 'e2', date: '2026-01-10', label: '음료수', category: '음료수비', amount: 20000, method: '현금', clubShare: 20000, personalDonation: 0 },
    ]
    const settlement = baseSettlement({
      expenses,
      dinnerContributions: [
        { id: 'd1', dinnerRound: 1, totalAmount: 150000, method: '현금', clubShare: 50000, contributionType: '일부찬조', contributors: [{ name: '테스트회원A', memberId: 'p1', amount: 100000 }] },
      ],
    })
    const summary = calcExpenseSummary(settlement)
    expect(summary.card).toBe(100000)
    // 현금 지출 20000 + 회식비(현금) 모임부담 50000
    expect(summary.cash).toBe(70000)
    expect(summary.dinnerClubShare).toBe(50000)
    expect(summary.total).toBe(170000)
  })
})

describe('calcProfitSummary', () => {
  it('총수입 - 총지출 = 순익', () => {
    const settlement = baseSettlement({
      participants: [
        participant({ id: 'p1', displayName: '테스트회원A', dues: { amount: 30000, method: '현금', status: '입금확인' } }),
      ],
      expenses: [
        { id: 'e1', date: '2026-01-10', label: '식사비', category: '식사비', amount: 10000, method: '현금', clubShare: 10000, personalDonation: 0 },
      ],
    })
    const profit = calcProfitSummary(settlement)
    expect(profit.totalIncome).toBe(30000)
    expect(profit.totalExpense).toBe(10000)
    expect(profit.netProfit).toBe(20000)
  })
})

describe('calcCashSummary', () => {
  it('현금 수입/지출과 통장 입금 전후 잔액을 계산한다', () => {
    const settlement = baseSettlement({
      participants: [
        participant({ id: 'p1', displayName: '테스트회원A', dues: { amount: 50000, method: '현금', status: '입금확인' } }),
      ],
      expenses: [
        { id: 'e1', date: '2026-01-10', label: '음료수', category: '음료수비', amount: 10000, method: '현금', clubShare: 10000, personalDonation: 0 },
      ],
      cashDeposits: [
        { id: 'c1', depositDate: '2026-01-11', amount: 30000, status: '입금확인' },
        { id: 'c2', depositDate: '2026-01-12', amount: 5000, status: '입금예정' },
      ],
    })
    const cash = calcCashSummary(settlement)
    expect(cash.cashIncome).toBe(50000)
    expect(cash.cashExpense).toBe(10000)
    expect(cash.cashBalanceBeforeDeposit).toBe(40000)
    // 입금예정(5000)은 아직 반영하지 않는다
    expect(cash.confirmedDeposit).toBe(30000)
    expect(cash.cashBalanceAfterDeposit).toBe(10000)
  })
})

describe('calcBankSummary', () => {
  it('전월 잔액에 확인된 입금을 더하고 카드·계좌이체 지출을 뺀다', () => {
    const settlement = baseSettlement({
      prevBankBalance: 100000,
      otherBankAdjustment: -1000,
      participants: [
        participant({ id: 'p1', displayName: '테스트회원A', dues: { amount: 30000, method: '계좌이체', status: '입금확인' } }),
        participant({ id: 'p2', displayName: '테스트회원B', dues: { amount: 20000, method: '계좌이체', status: '미확인' } }),
      ],
      expenses: [
        { id: 'e1', date: '2026-01-10', label: '체크카드지출', category: '기타', amount: 5000, method: '체크카드', clubShare: 5000, personalDonation: 0 },
      ],
      cashDeposits: [
        { id: 'c1', depositDate: '2026-01-11', amount: 10000, status: '입금확인' },
      ],
    })
    const bank = calcBankSummary(settlement)
    expect(bank.confirmedTransferIncome).toBe(30000)
    expect(bank.unconfirmedTransferAmount).toBe(20000)
    expect(bank.confirmedCashDeposit).toBe(10000)
    // 100000 + 30000 + 10000 + 0(기타입금) - 0(현금지출은 제외) - 5000(카드) - 1000(조정) = 134000
    expect(bank.currentBalance).toBe(134000)
  })
})

describe('confirmedDonorNames / confirmedDonorAmounts', () => {
  it('입금확인 상태의 찬조만 포함한다', () => {
    const participants: SettlementParticipant[] = [
      participant({ id: 'p1', displayName: '테스트회원A', donation: { amount: 10000, method: '현금', status: '입금확인' } }),
      participant({ id: 'p2', displayName: '테스트회원B', donation: { amount: 5000, method: '계좌이체', status: '미확인' } }),
      participant({ id: 'p3', displayName: '테스트회원C', donation: { amount: 7000, method: '현금', status: '취소' } }),
    ]
    expect(confirmedDonorNames(participants)).toEqual(['테스트회원A'])
    expect(confirmedDonorAmounts(participants)).toEqual([{ name: '테스트회원A', amount: 10000 }])
  })
})

describe('majorExpenses', () => {
  it('금액 큰 순으로 상위 N개만 반환한다', () => {
    const settlement = baseSettlement({
      expenses: [
        { id: 'e1', date: '2026-01-10', label: 'A', category: '기타', amount: 5000, method: '현금', clubShare: 5000, personalDonation: 0 },
        { id: 'e2', date: '2026-01-10', label: 'B', category: '기타', amount: 30000, method: '현금', clubShare: 30000, personalDonation: 0 },
        { id: 'e3', date: '2026-01-10', label: 'C', category: '기타', amount: 15000, method: '현금', clubShare: 15000, personalDonation: 0 },
      ],
    })
    const top = majorExpenses(settlement, 2)
    expect(top.map((e) => e.label)).toEqual(['B', 'C'])
  })
})

describe('canTransition / isLocked / transitionStatus', () => {
  it('허용된 전이만 통과한다', () => {
    expect(canTransition('draft', 'confirmed')).toBe(true)
    expect(canTransition('draft', 'cancelled')).toBe(true)
    expect(canTransition('confirmed', 'revised')).toBe(true)
    expect(canTransition('confirmed', 'cancelled')).toBe(true)
    expect(canTransition('revised', 'confirmed')).toBe(true)
    expect(canTransition('revised', 'cancelled')).toBe(true)
  })

  it('금지된 전이는 막는다', () => {
    expect(canTransition('draft', 'revised')).toBe(false)
    expect(canTransition('confirmed', 'draft')).toBe(false)
    expect(canTransition('cancelled', 'draft')).toBe(false)
    expect(canTransition('cancelled', 'confirmed')).toBe(false)
  })

  it('confirmed/cancelled 상태는 잠금, draft/revised는 잠금 아님', () => {
    expect(isLocked('confirmed')).toBe(true)
    expect(isLocked('cancelled')).toBe(true)
    expect(isLocked('draft')).toBe(false)
    expect(isLocked('revised')).toBe(false)
  })

  it('상태 전이 시 revisionLog에 이전/새 상태·처리자·시각을 남긴다', () => {
    const settlement = baseSettlement({ status: 'draft' })
    const result = transitionStatus(settlement, 'confirmed', { displayName: '테스트관리자' }, '정산 완료')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.settlement.status).toBe('confirmed')
    expect(result.settlement.confirmedByUid).toBeUndefined()
    expect(result.settlement.confirmedAt).toBeTruthy()
    const lastLog = result.settlement.revisionLog[result.settlement.revisionLog.length - 1]
    expect(lastLog.fromStatus).toBe('draft')
    expect(lastLog.toStatus).toBe('confirmed')
    expect(lastLog.actorDisplayName).toBe('테스트관리자')
    expect(lastLog.reason).toBe('정산 완료')
    // 상태 전이는 version을 건드리지 않는다 — version은 서버 저장 성공 시에만 바뀐다(settlementSync 담당).
    expect(result.settlement.version).toBe(settlement.version)
  })

  it('허용되지 않은 전이는 데이터를 바꾸지 않고 오류를 반환한다', () => {
    const settlement = baseSettlement({ status: 'confirmed' })
    const result = transitionStatus(settlement, 'draft', { displayName: '테스트관리자' })
    expect(result.ok).toBe(false)
  })
})

describe('validateDinnerContribution', () => {
  it('전액찬조는 clubShare가 0원이어야 한다', () => {
    const result = validateDinnerContribution({
      totalAmount: 100000, clubShare: 0, contributionType: '전액찬조',
      contributors: [{ name: '테스트회원A', memberId: null, amount: 100000 }],
    })
    expect(result.ok).toBe(true)
  })

  it('전체금액 = clubShare + 찬조자 합계가 아니면 저장하지 않는다', () => {
    const result = validateDinnerContribution({
      totalAmount: 100000, clubShare: 50000, contributionType: '일부찬조',
      contributors: [{ name: '테스트회원A', memberId: null, amount: 40000 }], // 50000+40000 != 100000
    })
    expect(result.ok).toBe(false)
  })

  it('모임회계지출은 찬조자가 있으면 안 된다', () => {
    const result = validateDinnerContribution({
      totalAmount: 100000, clubShare: 100000, contributionType: '모임회계지출',
      contributors: [{ name: '테스트회원A', memberId: null, amount: 0 }],
    })
    expect(result.ok).toBe(false)
  })

  it('일부찬조는 찬조자가 1명 이상 필요하다', () => {
    const result = validateDinnerContribution({
      totalAmount: 100000, clubShare: 100000, contributionType: '일부찬조', contributors: [],
    })
    expect(result.ok).toBe(false)
  })
})

describe('hasDuplicateDinnerRound', () => {
  it('같은 차수가 이미 있으면 true', () => {
    const list: DinnerContribution[] = [
      { id: 'd1', dinnerRound: 1, totalAmount: 100000, method: '현금', clubShare: 100000, contributionType: '모임회계지출', contributors: [] },
    ]
    expect(hasDuplicateDinnerRound(list, 1)).toBe(true)
    expect(hasDuplicateDinnerRound(list, 2)).toBe(false)
  })
  it('수정 중인 항목 자신은 중복으로 치지 않는다', () => {
    const list: DinnerContribution[] = [
      { id: 'd1', dinnerRound: 1, totalAmount: 100000, method: '현금', clubShare: 100000, contributionType: '모임회계지출', contributors: [] },
    ]
    expect(hasDuplicateDinnerRound(list, 1, 'd1')).toBe(false)
  })
})

describe('validateCashDeposit', () => {
  it('입금확인 합계가 입금 전 현금 잔액을 넘으면 막는다', () => {
    const settlement = baseSettlement({
      participants: [
        participant({ id: 'p1', displayName: '테스트회원A', dues: { amount: 50000, method: '현금', status: '입금확인' } }),
      ],
    })
    // 입금 전 현금 잔액 = 50000. 60000 입금확인은 초과.
    const result = validateCashDeposit(settlement, { amount: 60000, status: '입금확인' })
    expect(result.ok).toBe(false)
  })

  it('입금확인 합계가 현금 잔액 이하면 허용한다', () => {
    const settlement = baseSettlement({
      participants: [
        participant({ id: 'p1', displayName: '테스트회원A', dues: { amount: 50000, method: '현금', status: '입금확인' } }),
      ],
    })
    const result = validateCashDeposit(settlement, { amount: 50000, status: '입금확인' })
    expect(result.ok).toBe(true)
  })

  it('입금전/입금예정 상태는 현금 잔액 검증 대상이 아니다', () => {
    const settlement = baseSettlement({
      participants: [
        participant({ id: 'p1', displayName: '테스트회원A', dues: { amount: 10000, method: '현금', status: '입금확인' } }),
      ],
    })
    const result = validateCashDeposit(settlement, { amount: 999999, status: '입금예정' })
    expect(result.ok).toBe(true)
  })
})

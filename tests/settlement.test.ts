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
  buildIncomeTableRows,
  calcIncomeTableSummary,
  parseTableAmount,
  planAddTableRow,
  planDeleteTableRow,
  searchAddableMembers,
  planClearAmount,
  calcDefaultExpenseClubShare,
  prefillExpenseClubShare,
  validateExpenseShares,
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

  it('새 분류("기타")와 예전 분류("상품비" 등)가 섞여 있어도 category와 무관하게 결제수단 기준으로 누락 없이 집계된다', () => {
    const expenses: SettlementExpense[] = [
      { id: 'e1', date: '2026-07-16', label: '주차비', category: '기타', amount: 5000, method: '현금', clubShare: 5000, personalDonation: 0 },
      { id: 'e2', date: '2026-07-16', label: '트로피', category: '상품비', amount: 15000, method: '계좌이체', clubShare: 15000, personalDonation: 0 },
      { id: 'e3', date: '2026-07-16', label: '다과', category: '다과비', amount: 8000, method: '현금', clubShare: 8000, personalDonation: 0 },
    ]
    const settlement = baseSettlement({ expenses })
    const summary = calcExpenseSummary(settlement)
    expect(summary.cash).toBe(13000)
    expect(summary.transfer).toBe(15000)
    expect(summary.total).toBe(28000)
  })
})

describe('calcDefaultExpenseClubShare / prefillExpenseClubShare / validateExpenseShares — 지출 금액 계산', () => {
  it('개인 찬조액이 없으면 모임 부담액은 전체 금액과 같다', () => {
    expect(calcDefaultExpenseClubShare(5000, 0)).toBe(5000)
  })

  it('개인 찬조액이 있으면 전체 금액에서 뺀 나머지가 모임 부담액이다 (100,000 - 20,000 = 80,000)', () => {
    expect(calcDefaultExpenseClubShare(100000, 20000)).toBe(80000)
  })

  it('개인 찬조액이 전체 금액보다 커도 모임 부담액은 음수가 아니라 0으로 고정된다', () => {
    expect(calcDefaultExpenseClubShare(5000, 9000)).toBe(0)
  })

  it('저장된 clubShare가 "비우면 전액" 자동계산값과 같으면 수정 폼에서 빈칸으로 되돌린다', () => {
    expect(prefillExpenseClubShare(5000, 5000, 0)).toBe('')
    expect(prefillExpenseClubShare(100000, 80000, 20000)).toBe('')
  })

  it('저장된 clubShare가 자동계산값과 다르면(직접 지정한 값) 그 값을 그대로 보여준다', () => {
    // 자동계산값은 100000-30000=70000이므로, 75000은 명백히 직접 지정한 값이다.
    expect(prefillExpenseClubShare(100000, 75000, 30000)).toBe('75000')
    expect(prefillExpenseClubShare(5000, 0, 0)).toBe('0')
  })

  it('모임부담액+개인찬조액이 전체 금액과 일치하면 통과한다', () => {
    expect(validateExpenseShares(100000, 70000, 30000)).toEqual({ ok: true })
  })

  it('모임부담액+개인찬조액이 전체 금액보다 크거나 작으면 안내 문구와 함께 실패한다', () => {
    const res = validateExpenseShares(5000, 0, 0)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain('일치하지 않습니다')
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

// ────────────────────────────────────────────────────────────
// 회비·찬조 입력표 (참가자별 dues/donation을 "이름·구분·금액·결제수단" 행으로 펼치는 순수 함수)
// ────────────────────────────────────────────────────────────

describe('buildIncomeTableRows', () => {
  it('참석자 순서 그대로 회비 행을 만든다(가나다순 재정렬 없음)', () => {
    const settlement = baseSettlement({
      participants: [
        participant({ id: 'p1', displayName: '최시온' }),
        participant({ id: 'p2', displayName: '가나다' }),
        participant({ id: 'p3', displayName: '나다라' }),
      ],
    })
    const rows = buildIncomeTableRows(settlement.participants)
    expect(rows.map((r) => r.displayName)).toEqual(['최시온', '가나다', '나다라'])
  })

  it('회원과 비회원 모두 회비 행으로 표시된다', () => {
    const settlement = baseSettlement({
      participants: [
        participant({ id: 'p1', displayName: '테스트회원A', participantType: 'member' }),
        { id: 'p2', displayName: '테스트비회원B', participantType: 'guest', memberId: null, addedVia: 'manually_added_guest' },
      ],
    })
    const rows = buildIncomeTableRows(settlement.participants)
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.category === 'dues')).toBe(true)
  })

  it('참가자에게 이미 회비·찬조 값이 있으면 표 행으로 그대로 복원된다', () => {
    const settlement = baseSettlement({
      participants: [
        participant({
          id: 'p1', displayName: '테스트회원A',
          dues: { amount: 30000, method: '계좌이체', status: '입금확인' },
          donation: { amount: 100000, method: '현금', status: '입금확인' },
        }),
      ],
    })
    const rows = buildIncomeTableRows(settlement.participants)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ category: 'dues', amount: 30000, method: '계좌이체' })
    expect(rows[1]).toMatchObject({ category: 'donation', amount: 100000, method: '현금' })
  })

  it('찬조가 없으면 찬조 행 자체가 생성되지 않는다', () => {
    const settlement = baseSettlement({
      participants: [participant({ id: 'p1', displayName: '테스트회원A', dues: { amount: 30000, method: '현금', status: '입금확인' } })],
    })
    const rows = buildIncomeTableRows(settlement.participants)
    expect(rows).toHaveLength(1)
  })

  it('결제수단이 없는(과거) 회비 데이터도 정상적으로 undefined method로 표시된다', () => {
    const settlement = baseSettlement({
      participants: [participant({ id: 'p1', displayName: '테스트회원A' })], // dues 자체가 없는 기존 참가자
    })
    const rows = buildIncomeTableRows(settlement.participants)
    expect(rows[0].amount).toBeUndefined()
    expect(rows[0].method).toBeUndefined()
  })
})

describe('calcIncomeTableSummary', () => {
  it('회비합계·찬조합계·현금합계·계좌이체합계·총수입을 상태(입금확인 등) 구분 없이 그대로 합산한다', () => {
    const settlement = baseSettlement({
      participants: [
        participant({
          id: 'p1', displayName: '테스트회원A',
          dues: { amount: 30000, method: '현금', status: '미납' }, // 미납이어도(=calcIncomeSummary와 다르게) 표 합계엔 포함
          donation: { amount: 100000, method: '계좌이체', status: '미확인' },
        }),
        participant({ id: 'p2', displayName: '테스트회원B', dues: { amount: 20000, method: '계좌이체', status: '입금확인' } }),
      ],
    })
    const summary = calcIncomeTableSummary(settlement)
    expect(summary.duesTotal).toBe(50000)
    expect(summary.donationTotal).toBe(100000)
    expect(summary.cashTotal).toBe(30000)
    expect(summary.transferTotal).toBe(120000)
    expect(summary.totalIncome).toBe(150000)
  })

  it('구분(donation 없음) 또는 결제수단이 비어있는 행은 해당 항목에서 0으로 처리되고 총수입에는 반영된다', () => {
    const settlement = baseSettlement({
      participants: [
        participant({ id: 'p1', displayName: '테스트회원A', dues: { amount: 10000 } as never }), // method 없음
      ],
    })
    const summary = calcIncomeTableSummary(settlement)
    expect(summary.cashTotal).toBe(0)
    expect(summary.transferTotal).toBe(0)
    expect(summary.totalIncome).toBe(10000)
  })

  it('아직 입력 안 한(undefined) 금액은 0원으로 처리되고, 명시적 0원도 정확히 0으로 더해진다', () => {
    const settlement = baseSettlement({
      participants: [
        participant({ id: 'p1', displayName: '테스트회원A' }), // dues 자체 없음(=미입력)
        participant({ id: 'p2', displayName: '테스트회원B', dues: { amount: 0, method: '현금', status: '입금확인' } }), // 명시적 0원
      ],
    })
    const summary = calcIncomeTableSummary(settlement)
    expect(summary.totalIncome).toBe(0)
    expect(summary.duesTotal).toBe(0)
  })
})

describe('parseTableAmount', () => {
  it('빈 문자열은 null(=아직 입력 안 함)을 반환한다', () => {
    expect(parseTableAmount('')).toBeNull()
  })
  it('숫자만 남기고 나머지는 제거한다(음수 부호도 제거되어 음수가 될 수 없다)', () => {
    expect(parseTableAmount('-30000')).toBe(30000)
    expect(parseTableAmount('30,000원')).toBe(30000)
  })
  it('숫자가 전혀 없으면(예: 문자만 입력) 빈 값과 동일하게 null을 반환한다 — NaN을 반환하지 않는다', () => {
    const result = parseTableAmount('abc')
    expect(result).toBeNull()
  })
  it('문자와 숫자가 섞여 있으면 숫자만 추출해 NaN 없이 정수를 반환한다', () => {
    const result = parseTableAmount('12abc34')
    expect(result).toBe(1234)
    expect(Number.isFinite(result)).toBe(true)
  })
  it('0을 명시적으로 입력하면 0을 그대로 반환한다', () => {
    expect(parseTableAmount('0')).toBe(0)
  })
})

describe('planAddTableRow', () => {
  const participants = [
    participant({ id: 'p1', displayName: '테스트회원A', dues: { amount: 30000, method: '현금', status: '입금확인' } }),
  ]

  it('빈 이름은 막는다', () => {
    expect(planAddTableRow(participants, '   ', 'dues')).toMatchObject({ action: 'blocked' })
  })

  it('새 이름(외부 찬조자·비회원)은 새 참가자 생성으로 판정한다', () => {
    expect(planAddTableRow(participants, '외부찬조자1', 'donation')).toEqual({ action: 'create-guest' })
  })

  it('기존 참가자와 이름이 같고 그 구분이 아직 비어있으면 기존 참가자에 채우도록 판정한다(같은 사람 회비+찬조)', () => {
    // p1은 이미 회비가 있고 찬조는 없다 → 찬조로 행 추가하면 기존 참가자에 병합
    expect(planAddTableRow(participants, '테스트회원A', 'donation')).toEqual({ action: 'update-existing', participantId: 'p1' })
  })

  it('기존 참가자와 이름이 같고 그 구분이 이미 있으면 중복 생성을 막는다', () => {
    const result = planAddTableRow(participants, '테스트회원A', 'dues')
    expect(result.action).toBe('blocked')
  })
})

describe('planDeleteTableRow', () => {
  it('실제 모임 참석자(meeting_attendee)는 항상 clear-category — 참가자 자체를 지우지 않는다', () => {
    const p = participant({ id: 'p1', displayName: '테스트회원A', addedVia: 'meeting_attendee', donation: { amount: 10000, method: '현금', status: '입금확인' } })
    expect(planDeleteTableRow(p, 'donation')).toEqual({ action: 'clear-category' })
  })

  it('정산에만 추가된 사람(guest)이 지우려는 구분 외에 남는 값이 없으면 참가자 자체를 지운다', () => {
    const p = participant({ id: 'p1', displayName: '외부찬조자1', addedVia: 'manually_added_guest', donation: { amount: 10000, method: '현금', status: '입금확인' } })
    expect(planDeleteTableRow(p, 'donation')).toEqual({ action: 'remove-participant' })
  })

  it('정산에만 추가된 사람이라도 다른 구분 값이 남아있으면 그 구분만 지운다', () => {
    const p = participant({
      id: 'p1', displayName: '외부찬조자1', addedVia: 'manually_added_guest',
      dues: { amount: 30000, method: '현금', status: '입금확인' },
      donation: { amount: 10000, method: '현금', status: '입금확인' },
    })
    expect(planDeleteTableRow(p, 'donation')).toEqual({ action: 'clear-category' })
  })
})

describe('searchAddableMembers', () => {
  const members = [
    { id: 'm1', name: '테스트회원가', handicap: 20, handicapHistory: [], active: true },
    { id: 'm2', name: '테스트회원나', handicap: 18, handicapHistory: [], active: true },
    { id: 'm3', name: '테스트회원다(탈퇴)', handicap: 15, handicapHistory: [], active: false },
  ]

  it('검색어가 없으면 빈 배열을 반환한다', () => {
    expect(searchAddableMembers(members, [], '')).toEqual([])
  })

  it('이름에 검색어가 포함된 활성 회원만 반환한다', () => {
    const result = searchAddableMembers(members, [], '테스트회원가')
    expect(result.map((m) => m.id)).toEqual(['m1'])
  })

  it('비활성(탈퇴) 회원은 검색 결과에서 제외한다', () => {
    const result = searchAddableMembers(members, [], '테스트회원다')
    expect(result).toHaveLength(0)
  })

  it('이미 정산 참가자로 들어와 있는 회원은 검색 결과에서 제외한다(중복 추가 방지)', () => {
    const participants = [participant({ id: 'p1', displayName: '테스트회원가', memberId: 'm1' })]
    const result = searchAddableMembers(members, participants, '테스트회원')
    expect(result.map((m) => m.id)).toEqual(['m2'])
  })
})

describe('planClearAmount — 금액을 빈칸으로 지웠을 때 기존 메타데이터 보존', () => {
  it('메타데이터가 전혀 없는(방금 생성된) 행은 완전히 지워도 된다', () => {
    expect(planClearAmount({ status: '미납' }, '미납')).toEqual({ action: 'clear-all' })
  })

  it('status가 기본값이 아니면(예: 입금확인) 금액만 0으로 바꾸고 통째로 지우지 않는다', () => {
    expect(planClearAmount({ status: '입금확인' }, '미납')).toEqual({ action: 'set-zero' })
  })

  it('note가 있으면 status가 기본값이어도 금액만 0으로 바꾼다', () => {
    expect(planClearAmount({ status: '미납', note: '분할 납부 예정' }, '미납')).toEqual({ action: 'set-zero' })
  })

  it('paidAt이 있으면 금액만 0으로 바꾼다', () => {
    expect(planClearAmount({ status: '미납', paidAt: '2026-01-10T00:00:00.000Z' }, '미납')).toEqual({ action: 'set-zero' })
  })

  it('기존 값 자체가 없으면(undefined) 완전히 지워도 된다', () => {
    expect(planClearAmount(undefined, '미납')).toEqual({ action: 'clear-all' })
  })
})

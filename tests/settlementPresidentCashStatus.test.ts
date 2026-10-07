import { describe, it, expect } from 'vitest'
import { buildPresidentShareText, buildMemberShareText, buildPublicSummary } from '../src/lib/settlementShareText'
import {
  calcBankSummary, calcCashSummary, calcHoldingsSummary, calcIncomeSummary, calcExpenseSummary, calcProfitSummary,
  buildFundMovementLog,
} from '../src/logic/settlement'
import type { RegularSettlement, SettlementExpense } from '../src/types/settlement'

// 아래 이름·ID·금액은 전부 테스트용 가상 데이터이며 실제 회원·회계 정보가 아니다.

const cashExpense = (amount: number): SettlementExpense => ({
  id: `e-${amount}`, date: '2026-09-30', label: '가상 지출', category: '기타', amount, method: '현금', clubShare: amount, personalDonation: 0,
})

function fake(over: Partial<RegularSettlement> = {}): RegularSettlement {
  return {
    id: 'settle-president-cash-1', meetingName: '가상 정기모임', meetingDate: '2026-09-30', meetingType: 'regular', status: 'confirmed',
    participants: [], expenses: [], dinnerContributions: [], cashDeposits: [],
    prevBankBalance: 5_000_000, otherBankAdjustment: 0,
    createdAt: '2026-09-01T00:00:00.000Z', confirmedAt: '2026-10-01T00:00:00.000Z', version: 1, revisionLog: [],
    ...over,
  }
}

// 요청 예시: 받은 현금 870,000 / 현금 지출 1,920,000 / 통장 인출 1,200,000 / 통장 입금 150,000 → 현재 보유 현금 0원
const example = () => fake({
  participants: [
    { id: 'p1', participantType: 'guest', memberId: null, displayName: '가상A', addedVia: 'manually_added_guest', dues: { amount: 600_000, method: '현금', status: '입금확인' } },
    { id: 'p2', participantType: 'guest', memberId: null, displayName: '가상B', addedVia: 'manually_added_guest', donation: { amount: 270_000, method: '현금', status: '입금확인' } },
  ],
  expenses: [cashExpense(1_920_000)],
  bankCashWithdrawals: [{ id: 'w1', date: '2026-09-30', amount: 1_200_000, note: '상금 및 예비비 현금 인출', createdAt: '2026-09-30T01:00:00.000Z' }],
  cashDeposits: [{ id: 'd1', depositDate: '2026-10-06', amount: 150_000, status: '입금확인', note: '예비비 잔액 입금' }],
})

/** 회장 보고문 중 [현금 현황] 블록(제목 줄부터 다음 빈 줄 전까지). */
const cashBlock = (text: string) => text.split('[현금 현황]\n')[1].split('\n\n')[0]
/** [자금이동 내역] 앞까지(= 현금 현황을 포함한 위쪽 전체). */
const beforeMovements = (text: string) => text.split('[자금이동 내역]')[0]

describe('회장 보고용 — ② 현금 현황 3줄', () => {
  it('받은 현금 / 지출한 현금 / 현재 보유 현금 3줄만 나온다', () => {
    const text = buildPresidentShareText(example())
    expect(cashBlock(text)).toBe('현금으로 받은 금액 870,000원\n현금으로 지출한 금액 1,920,000원\n현재 보유 현금 0원')
  })

  it('현금 인출/입금 금액과 중간 계산값은 현금 현황(및 자금이동 내역 위쪽 전체)에 나오지 않는다', () => {
    const upper = beforeMovements(buildPresidentShareText(example()))
    for (const gone of ['1,200,000원', '150,000원', '통장에서 현금 인출', '현금 잔액(입금 전)', '현금 잔액(입금 후)', '현금 잔액(인출 반영)', '현금 통장 입금액', '현금 수입 ', '-1,050,000원 잔액']) {
      expect(upper).not.toContain(gone)
    }
  })

  it('현금 인출/입금 기록은 삭제되지 않고 [자금이동 내역]에서만 날짜순으로 표시된다', () => {
    const text = buildPresidentShareText(example())
    expect(text).toContain('[자금이동 내역]\n09/30 통장 → 현금 1,200,000원\n상금 및 예비비 현금 인출\n\n10/06 현금 → 통장 150,000원\n예비비 잔액 입금')
    // 두 금액은 보고문 전체에서 자금이동 내역에서만(각 1번) 보인다
    expect(text.match(/1,200,000원/g)).toHaveLength(1)
    expect(text.match(/150,000원/g)).toHaveLength(1)
    // 원본 기록은 그대로
    const s = example()
    expect(s.bankCashWithdrawals).toHaveLength(1)
    expect(s.cashDeposits).toHaveLength(1)
    expect(buildFundMovementLog(s).map((e) => [e.kind, e.date, e.amount])).toEqual([
      ['withdrawal', '2026-09-30', 1_200_000], ['deposit', '2026-10-06', 150_000],
    ])
  })

  it('메모가 없는 건은 금액 줄만 나온다', () => {
    const s = fake({ cashDeposits: [{ id: 'd1', depositDate: '2026-10-06', amount: 5_000, status: '입금확인' }] })
    expect(buildPresidentShareText(s)).toContain('[자금이동 내역]\n10/06 현금 → 통장 5,000원')
    expect(buildPresidentShareText(s).endsWith('10/06 현금 → 통장 5,000원')).toBe(true)
  })

  it('자금이동 기록이 없으면 [자금이동 내역]은 없고 현금 현황 3줄은 그대로 나온다', () => {
    const text = buildPresidentShareText(fake({ participants: [{ id: 'p1', participantType: 'guest', memberId: null, displayName: '가상A', addedVia: 'manually_added_guest', dues: { amount: 40_000, method: '현금', status: '입금확인' } }] }))
    expect(text).not.toContain('[자금이동 내역]')
    expect(cashBlock(text)).toBe('현금으로 받은 금액 40,000원\n현금으로 지출한 금액 0원\n현재 보유 현금 40,000원')
  })

  it('현금이 모자라면 "-1,050,000원" 대신 "현금 부족 1,050,000원"으로 나온다', () => {
    const text = buildPresidentShareText(fake({ expenses: [cashExpense(1_050_000)] }))
    expect(cashBlock(text)).toBe('현금으로 받은 금액 0원\n현금으로 지출한 금액 1,050,000원\n현금 부족 1,050,000원')
    expect(cashBlock(text)).not.toMatch(/-\s?1,050,000/)
  })
})

describe('계산값은 기존과 동일하다', () => {
  it('현재 보유 현금은 기존 현금잔액(= 입금 후 현금 잔액 + 통장 인출)과 같고 0원이다', () => {
    const s = example()
    const cash = calcCashSummary(s)
    expect(cash.cashBalance).toBe(0)
    expect(cash.cashBalance).toBe(cash.cashBalanceAfterDeposit + cash.bankWithdrawal) // 예전 "현금 잔액(인출 반영)" 값
    expect(cash).toMatchObject({ cashIncome: 870_000, cashExpense: 1_920_000, bankWithdrawal: 1_200_000, confirmedDeposit: 150_000 })
    // 보고문의 "현재 보유 현금"은 이 값 그대로
    expect(buildPresidentShareText(s)).toContain('현재 보유 현금 0원')
  })

  it('전체 보유액·통장잔액·총수입·총지출은 기존과 같다 (손으로 계산한 값)', () => {
    const s = example()
    // 통장 = 5,000,000 − 1,200,000(인출) + 150,000(입금) = 3,950,000 / 현금 0 / 전체 3,950,000
    expect(calcBankSummary(s).currentBalance).toBe(3_950_000)
    expect(calcHoldingsSummary(s)).toEqual({ bankBalance: 3_950_000, cashBalance: 0, totalHoldings: 3_950_000 })
    expect(calcIncomeSummary(s).totalIncome).toBe(870_000)
    expect(calcExpenseSummary(s).total).toBe(1_920_000)
    expect(calcProfitSummary(s).netProfit).toBe(-1_050_000)
    expect(buildPresidentShareText(s)).toContain('전체 보유액(통장+현금) 3,950,000원')
    expect(buildPresidentShareText(s)).toContain('현재 통장 잔액 3,950,000원')
  })

  it('보고문 표시를 바꿔도 원본 데이터와 회원용 공유문·공개 요약은 달라지지 않는다', () => {
    const s = example()
    const before = { src: JSON.stringify(s), member: buildMemberShareText(s), pub: JSON.stringify(buildPublicSummary(s)) }
    buildPresidentShareText(s)
    expect(JSON.stringify(s)).toBe(before.src)
    expect(buildMemberShareText(s)).toBe(before.member)
    expect(JSON.stringify(buildPublicSummary(s))).toBe(before.pub)
    expect(before.member).not.toContain('인출')
    expect(before.pub).not.toContain('상금 및 예비비')
  })
})

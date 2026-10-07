import { describe, it, expect } from 'vitest'
import {
  buildPresidentShareText, buildMemberShareText, buildPublicSummary, buildDonationDetailText,
  buildCashFlowRows, expenseByMethodText, expenseLinesWithMethod,
} from '../src/lib/settlementShareText'
import {
  calcBankSummary, calcCashSummary, calcHoldingsSummary, calcIncomeSummary, calcExpenseSummary, calcProfitSummary,
  buildFundMovementLog,
} from '../src/logic/settlement'
import type { RegularSettlement, SettlementExpense } from '../src/types/settlement'

// 아래 이름·ID·금액은 전부 테스트용 가상 데이터이며 실제 회원·회계 정보가 아니다.

const expense = (id: string, label: string, amount: number, method: SettlementExpense['method']): SettlementExpense => ({
  id, date: '2026-09-30', label, category: '기타', amount, method, clubShare: amount, personalDonation: 0,
})

function fake(over: Partial<RegularSettlement> = {}): RegularSettlement {
  return {
    id: 'settle-president-1', meetingName: '가상 정기모임', meetingDate: '2026-09-30', meetingType: 'regular', status: 'confirmed',
    participants: [], expenses: [], dinnerContributions: [], cashDeposits: [],
    prevBankBalance: 5_042_614, otherBankAdjustment: 0,
    createdAt: '2026-09-01T00:00:00.000Z', confirmedAt: '2026-10-01T00:00:00.000Z', version: 1, revisionLog: [],
    ...over,
  }
}

// 요청 예시 데이터: 현금 회비 520,000 + 현금 찬조 350,000 + 통장 인출 1,200,000 − 현금 지출 1,920,000 − 통장 입금 150,000 = 0
// 총지출 2,500,000 = 현금 1,920,000 + 계좌이체 480,000 + 체크카드 100,000
const example = () => fake({
  participants: [
    { id: 'p1', participantType: 'guest', memberId: null, displayName: '가상A', addedVia: 'manually_added_guest', dues: { amount: 520_000, method: '현금', status: '입금확인' } },
    { id: 'p2', participantType: 'guest', memberId: null, displayName: '가상B', addedVia: 'manually_added_guest', donation: { amount: 350_000, method: '현금', status: '입금확인' } },
  ],
  expenses: [
    expense('e1', '상품비', 1_000_000, '현금'), expense('e2', '식대', 920_000, '현금'),
    expense('e3', '장소비', 480_000, '계좌이체'), expense('e4', '용품비', 100_000, '체크카드'),
  ],
  bankCashWithdrawals: [{ id: 'w1', date: '2026-09-30', amount: 1_200_000, note: '상금 및 예비비 현금 인출', createdAt: '2026-09-30T01:00:00.000Z' }],
  cashDeposits: [{ id: 'd1', depositDate: '2026-10-06', amount: 150_000, status: '입금확인', note: '예비비 잔액 입금' }],
})

/** 보고문에서 "[제목]" 블록(다음 "[" 제목 전까지)을 잘라낸다. */
const section = (text: string, title: string) => text.split(`[${title}]\n`)[1].split('\n\n\n')[0].replace(/^\n/, '')

describe('회장 보고용 — 상단 요약 + 결제수단별 총지출', () => {
  it('1·2. 총지출금액 아래에 결제수단별 합계가 나오고 그 합이 총지출금액과 같다', () => {
    const s = example()
    const text = buildPresidentShareText(s)
    expect(text).toContain('전월 통장 잔액 : 5,042,614원')
    expect(text).toContain('총수입금액 : 870,000원')
    expect(text).toContain('총지출금액 : 2,500,000원\n(현금 1,920,000원 + 계좌이체 480,000원 + 체크카드 100,000원)')
    // 통장 = 5,042,614 + 150,000(입금) − 100,000(카드) − 480,000(이체) − 1,200,000(인출) = 3,412,614
    expect(text).toContain('현재 통장 잔액 : 3,412,614원')
    const e = calcExpenseSummary(s)
    expect(e.cash + e.transfer + e.card + e.other).toBe(e.total)
    expect(e.total).toBe(2_500_000)
  })

  it('3. 0원 결제수단은 생략하고, 지출이 없으면 괄호 줄 자체가 없다', () => {
    expect(expenseByMethodText(fake({ expenses: [expense('e1', '다과', 30_000, '현금')] }))).toBe('(현금 30,000원)')
    expect(expenseByMethodText(fake({ expenses: [expense('e1', '다과', 30_000, '체크카드'), expense('e2', '기타비', 5_000, '기타')] }))).toBe('(체크카드 30,000원 + 기타 5,000원)')
    const none = buildPresidentShareText(fake())
    expect(none).toContain('총지출금액 : 0원')
    expect(none).not.toMatch(/총지출금액 : 0원\n\(/)
  })

  it('예전 회식비(차수별 기록)의 결제수단도 총지출 합계에 한 번만 포함된다', () => {
    const s = fake({
      expenses: [expense('e1', '다과', 10_000, '현금')],
      dinnerContributions: [{ id: 'd', dinnerRound: 1, totalAmount: 200_000, method: '계좌이체', clubShare: 200_000, contributionType: '모임회계지출', contributors: [] }],
    })
    expect(expenseByMethodText(s)).toBe('(현금 10,000원 + 계좌이체 200,000원)')
    expect(calcExpenseSummary(s).total).toBe(210_000)
    expect(expenseLinesWithMethod(s)).toEqual(['1차 회식비 200,000원 (계좌이체)', '다과 10,000원 (현금)'])
  })
})

describe('회장 보고용 — [지출 내역] 결제수단 표시', () => {
  it('4~7. 각 지출 항목에 사용자용 결제수단 이름이 붙는다 — (현금) (계좌이체) (체크카드)', () => {
    const text = buildPresidentShareText(example())
    expect(section(text, '지출 내역')).toBe('상품비 1,000,000원 (현금)\n식대 920,000원 (현금)\n장소비 480,000원 (계좌이체)\n용품비 100,000원 (체크카드)')
    expect(expenseLinesWithMethod(fake({ expenses: [expense('e1', '기타지출', 50_000, '기타')] }))).toEqual(['기타지출 50,000원 (기타)'])
  })

  it('금액은 기존과 같이 모임 부담액을 쓰고 개인 찬조분은 건드리지 않는다 (결제수단 표시만 추가)', () => {
    const s = fake({ expenses: [{ ...expense('e1', '상품비', 100_000, '현금'), clubShare: 70_000, personalDonation: 30_000 }] })
    expect(expenseLinesWithMethod(s)).toEqual(['상품비 70,000원 (현금)'])
    expect(calcExpenseSummary(s).total).toBe(70_000)
    // 회원용 공유문의 항목 줄은 예전 그대로(결제수단 없음)
    expect(buildMemberShareText(s)).toContain('상품비 70,000원')
    expect(buildMemberShareText(s)).not.toContain('(현금)')
  })

  it('지출이 없으면 [지출 내역] 섹션이 없다', () => {
    expect(buildPresidentShareText(fake())).not.toContain('[지출 내역]')
  })
})

describe('회장 보고용 — [현금 흐름표]', () => {
  it('8. 현금 회비 → 현금 찬조금 → 통장 인출 → 현금 지출 → 통장 입금 순서로 누적 보유액이 정확하다', () => {
    const text = buildPresidentShareText(example())
    expect(section(text, '현금 흐름표')).toBe([
      '현금 회비', '+520,000원 → 보유 520,000원', '',
      '현금 찬조금', '+350,000원 → 보유 870,000원', '',
      '통장에서 현금 인출', '+1,200,000원 → 보유 2,070,000원', '',
      '현금 지출', '-1,920,000원 → 보유 150,000원', '',
      '현금을 통장에 입금', '-150,000원 → 보유 0원', '',
      '현재 보유 현금 : 0원',
      '전체 보유액 : 3,412,614원',
    ].join('\n'))
  })

  it('1~3. 전체 보유액은 인출 기록이 없어도 항상 나오고, 기존 holdings 값 = 현재 통장 잔액 + 현재 보유 현금이다', () => {
    const cases = [
      fake(), // 아무 기록 없음
      fake({ participants: [{ id: 'p1', participantType: 'guest', memberId: null, displayName: '가상A', addedVia: 'manually_added_guest', dues: { amount: 70_000, method: '현금', status: '입금확인' } }], expenses: [expense('e1', '장소비', 20_000, '계좌이체')] }),
      fake({ expenses: [expense('e1', '큰지출', 1_050_000, '현금')] }), // 현금 부족
      example(), // 인출·입금 있음
    ]
    for (const s of cases) {
      const h = calcHoldingsSummary(s)
      const text = buildPresidentShareText(s)
      expect(text).toContain(`전체 보유액 : ${h.totalHoldings.toLocaleString('ko-KR')}원`)
      expect(h.totalHoldings).toBe(calcBankSummary(s).currentBalance + calcCashSummary(s).cashBalance)
      expect(text.match(/전체 보유액 :/g)).toHaveLength(1)
      // 현재 보유 현금(또는 현금 부족) 바로 뒤, 자금이동 내역보다 앞
      expect(text.indexOf('전체 보유액 :')).toBeGreaterThan(text.indexOf('[현금 흐름표]'))
    }
    expect(buildPresidentShareText(fake())).toContain('전체 보유액 : 5,042,614원')
    // 현금 부족일 때도 음수 현금이 합산된 전체 보유액이 나온다: 5,042,614 − 1,050,000
    expect(buildPresidentShareText(cases[2])).toContain('전체 보유액 : 3,992,614원')
    expect(buildPresidentShareText(cases[0])).not.toContain('(통장+현금)')
  })

  it('9·10. 현금 지출 행에는 현금 결제분만 들어가고 계좌이체·체크카드 지출은 들어가지 않는다 (총지출에는 포함)', () => {
    const rows = buildCashFlowRows(example())
    expect(rows.find((r) => r.label === '현금 지출')!.delta).toBe(-1_920_000) // 2,500,000 − 480,000 − 100,000
    const onlyNonCash = fake({
      participants: [{ id: 'p1', participantType: 'guest', memberId: null, displayName: '가상A', addedVia: 'manually_added_guest', dues: { amount: 100_000, method: '현금', status: '입금확인' } }],
      expenses: [expense('e1', '장소비', 480_000, '계좌이체'), expense('e2', '용품비', 100_000, '체크카드')],
    })
    expect(buildCashFlowRows(onlyNonCash).map((r) => r.label)).toEqual(['현금 회비'])
    expect(calcExpenseSummary(onlyNonCash).total).toBe(580_000) // 총지출에는 포함
    expect(calcCashSummary(onlyNonCash).cashBalance).toBe(100_000) // 현금은 줄지 않음
  })

  it('계좌이체 수입은 현금 회비·현금 찬조금 행에 들어가지 않는다', () => {
    const s = fake({
      participants: [{ id: 'p1', participantType: 'guest', memberId: null, displayName: '가상A', addedVia: 'manually_added_guest', dues: { amount: 40_000, method: '계좌이체', status: '입금확인' }, donation: { amount: 30_000, method: '계좌이체', status: '미확인' } }],
    })
    expect(buildCashFlowRows(s)).toEqual([])
  })

  it('0원 항목은 행을 만들지 않고, 현금 변동이 없으면 현재 보유 현금 0원만 나온다', () => {
    const text = buildPresidentShareText(fake())
    expect(section(text, '현금 흐름표')).toBe('현재 보유 현금 : 0원\n전체 보유액 : 5,042,614원')
  })

  it('11·12. 통장 인출은 총수입에, 통장 입금은 총지출에 들어가지 않는다 (현금 흐름표에서만 증가/감소)', () => {
    const base = fake({
      participants: [{ id: 'p1', participantType: 'guest', memberId: null, displayName: '가상A', addedVia: 'manually_added_guest', dues: { amount: 500_000, method: '현금', status: '입금확인' } }],
      expenses: [expense('e1', '다과', 50_000, '현금')],
    })
    const moved = { ...base, bankCashWithdrawals: [{ id: 'w', date: '2026-09-30', amount: 300_000 }], cashDeposits: [{ id: 'd', depositDate: '2026-10-01', amount: 120_000, status: '입금확인' as const }] }
    expect(calcIncomeSummary(moved).totalIncome).toBe(calcIncomeSummary(base).totalIncome)
    expect(calcExpenseSummary(moved).total).toBe(calcExpenseSummary(base).total)
    const text = buildPresidentShareText(moved)
    expect(text).toContain('총수입금액 : 500,000원')
    expect(text).toContain('총지출금액 : 50,000원')
    const rows = buildCashFlowRows(moved)
    expect(rows.find((r) => r.label === '통장에서 현금 인출')!.delta).toBe(300_000) // 현금 증가
    expect(rows.find((r) => r.label === '현금을 통장에 입금')!.delta).toBe(-120_000) // 현금 감소
  })

  it('13. 마지막 보유액·"현재 보유 현금"은 기존 현금잔액(calcCashSummary.cashBalance)과 같다', () => {
    for (const s of [example(), fake(), fake({ expenses: [expense('e', '다과', 9_000, '현금')] })]) {
      const rows = buildCashFlowRows(s)
      const last = rows.length ? rows[rows.length - 1].balance : 0
      expect(last).toBe(calcCashSummary(s).cashBalance)
    }
    expect(calcCashSummary(example()).cashBalance).toBe(0)
  })

  it('14. 현금이 모자라면 "-1,050,000원" 대신 "현금 부족 1,050,000원"과 확인 안내가 나온다', () => {
    const text = buildPresidentShareText(fake({ expenses: [expense('e1', '큰지출', 1_050_000, '현금')] }))
    expect(section(text, '현금 흐름표')).toBe('현금 지출\n-1,050,000원 → 보유 현금 부족 1,050,000원\n\n현금 부족 1,050,000원\n현금 수입, 통장 인출 또는 지출 내역을 확인해 주세요.\n전체 보유액 : 3,992,614원')
    expect(section(text, '현금 흐름표')).not.toMatch(/보유 현금 : -|보유 -/)
    expect(text).not.toContain('현재 보유 현금 : -')
  })

  it('예전 [현금 현황] 3줄과 중간 계산값은 더 이상 나오지 않는다 (중복 제거)', () => {
    const text = buildPresidentShareText(example())
    for (const gone of ['[현금 현황]', '현금으로 받은 금액', '현금으로 지출한 금액', '현금 잔액(', '현금 통장 입금액', '이번 기간 통장 증감']) {
      expect(text).not.toContain(gone)
    }
  })
})

describe('회장 보고용 — [자금이동 내역] 유지와 일치', () => {
  it('15. 기존 형식(날짜 오름차순, 금액 줄 + 메모 줄) 그대로 유지된다', () => {
    const text = buildPresidentShareText(example())
    expect(section(text, '자금이동 내역')).toBe('09/30 통장 → 현금 1,200,000원\n상금 및 예비비 현금 인출\n\n10/06 현금 → 통장 150,000원\n예비비 잔액 입금')
    expect(text.indexOf('[현금 흐름표]')).toBeLessThan(text.indexOf('[자금이동 내역]'))
    expect(text.indexOf('[자금이동 내역]')).toBeLessThan(text.indexOf('[지출 내역]'))
  })

  it('메모가 없으면 금액 줄만 나온다 / 기록이 없으면 섹션이 없다', () => {
    const s = fake({ cashDeposits: [{ id: 'd', depositDate: '2026-10-06', amount: 5_000, status: '입금확인' }] })
    expect(section(buildPresidentShareText(s), '자금이동 내역')).toBe('10/06 현금 → 통장 5,000원')
    expect(buildPresidentShareText(fake())).not.toContain('[자금이동 내역]')
  })

  it('16. 현금 흐름표의 인출·입금 금액 = 자금이동 내역의 인출·입금 금액 합계', () => {
    const s = example()
    const rows = buildCashFlowRows(s)
    const log = buildFundMovementLog(s)
    const sum = (k: 'withdrawal' | 'deposit') => log.filter((e) => e.kind === k).reduce((a, e) => a + e.amount, 0)
    expect(rows.find((r) => r.label === '통장에서 현금 인출')!.delta).toBe(sum('withdrawal'))
    expect(rows.find((r) => r.label === '현금을 통장에 입금')!.delta).toBe(-sum('deposit'))
    const text = buildPresidentShareText(s)
    expect(text).toContain('+1,200,000원 → 보유')
    expect(text).toContain('09/30 통장 → 현금 1,200,000원')
    expect(text).toContain('-150,000원 → 보유')
    expect(text).toContain('10/06 현금 → 통장 150,000원')
  })
})

describe('다른 공유문·계산은 그대로다', () => {
  it('17·18. 회원용 공유문·공개 요약·찬조 상세내역은 회장 보고문을 만들어도 바뀌지 않는다', () => {
    const s = example()
    const before = {
      src: JSON.stringify(s), member: buildMemberShareText(s), pub: JSON.stringify(buildPublicSummary(s)), donation: buildDonationDetailText(s, '가상A - 와인'),
    }
    buildPresidentShareText(s)
    expect(JSON.stringify(s)).toBe(before.src)
    expect(buildMemberShareText(s)).toBe(before.member)
    expect(JSON.stringify(buildPublicSummary(s))).toBe(before.pub)
    expect(buildDonationDetailText(s, '가상A - 와인')).toBe(before.donation)
    // 회원용: 결제수단·통장·현금 흐름 정보 없음
    for (const secret of ['(현금)', '(계좌이체)', '전월 통장', '현금 흐름표', '자금이동', '인출']) expect(before.member).not.toContain(secret)
  })

  it('19. 총수입·총지출·통장잔액·현금잔액·전체 보유액 계산값은 손으로 계산한 값과 같다', () => {
    const s = example()
    expect(calcIncomeSummary(s).totalIncome).toBe(870_000)
    expect(calcExpenseSummary(s).total).toBe(2_500_000)
    expect(calcProfitSummary(s).netProfit).toBe(-1_630_000)
    expect(calcBankSummary(s).currentBalance).toBe(3_412_614)
    expect(calcCashSummary(s).cashBalance).toBe(0)
    expect(calcHoldingsSummary(s)).toEqual({ bankBalance: 3_412_614, cashBalance: 0, totalHoldings: 3_412_614 })
  })
})

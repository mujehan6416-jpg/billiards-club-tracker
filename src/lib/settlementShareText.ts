import type { DinnerContribution, RegularSettlement, SettlementPublicSummary } from '../types/settlement'
import {
  allExpenseLineItems,
  calcBankSummary,
  calcCashSummary,
  calcExpenseByCategory,
  calcIncomeSummary,
  calcProfitSummary,
  confirmedDonorAmounts,
  confirmedDonorNames,
  majorExpenses,
} from '../logic/settlement'
import { DINNER_CATEGORY, displayExpenseCategory } from './settlementConstants'

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`

/** 일반 정기모임 찬조 감사 — 이름만, 금액은 표시하지 않는다. */
export function buildGeneralDonorThankYou(donorNames: string[]): string | null {
  if (donorNames.length === 0) return null
  return `찬조해 주신 ${donorNames.join(', ')} 회원님께 감사드립니다.`
}

/** 정기대회 찬조 감사 — 이름과 금액을 함께 표시한다. */
export function buildTournamentDonorThankYou(donors: { name: string; amount: number }[]): string | null {
  if (donors.length === 0) return null
  const line = donors.map((d) => `${d.name} ${won(d.amount)}`).join(', ')
  return `대회를 위해 찬조해 주신 회원님께 감사드립니다.\n${line}`
}

/**
 * 회식 차수별 감사 문구. 차수마다 별도 문구를 생성한다.
 * - 모임회계지출(찬조자 없음): 문구 없음
 * - 전액찬조 + 1명: "OO차 회식비 전액을 부담해 주신 {이름} {호칭}님께 특별히 감사드립니다."
 * - 전액찬조 + 2명 이상: "OO차 회식비를 함께 부담해 주신 {이름1} {호칭1}님, {이름2} {호칭2}님께 특별히 감사드립니다."
 * - 일부찬조 + 1명: "OO차 회식비 일부를 찬조해 주신 {이름} {호칭}님께 감사드립니다."
 * - 일부찬조 + 2명 이상: "OO차 회식비를 함께 찬조해 주신 {이름1} {호칭1}님, {이름2} {호칭2}님께 감사드립니다."
 * 호칭 지정이 없으면 '회원님'으로 표시한다. 호칭은 관리자가 회식비 입력 화면에서 직접 선택/입력한다
 * (기존 Member 타입·회원명부에서 자동 판별하지 않는다).
 */
export function buildDinnerThankYouTexts(dinnerContributions: DinnerContribution[]): string[] {
  const messages: string[] = []
  for (const d of [...dinnerContributions].sort((a, b) => a.dinnerRound - b.dinnerRound)) {
    if (d.contributionType === '모임회계지출' || d.contributors.length === 0) continue
    const names = d.contributors.map((c) => `${c.name} ${c.title ?? '회원님'}`)
    if (d.contributionType === '전액찬조') {
      if (names.length === 1) {
        messages.push(`${d.dinnerRound}차 회식비 전액을 부담해 주신 ${names[0]}께 특별히 감사드립니다.`)
      } else {
        messages.push(`${d.dinnerRound}차 회식비를 함께 부담해 주신 ${names.join(', ')}께 특별히 감사드립니다.`)
      }
    } else {
      // 일부찬조
      if (names.length === 1) {
        messages.push(`${d.dinnerRound}차 회식비 일부를 찬조해 주신 ${names[0]}께 감사드립니다.`)
      } else {
        messages.push(`${d.dinnerRound}차 회식비를 함께 찬조해 주신 ${names.join(', ')}께 감사드립니다.`)
      }
    }
  }
  return messages
}

function donorThankYouMessages(settlement: RegularSettlement): string[] {
  const messages: string[] = []
  if (settlement.meetingType === 'tournament') {
    const t = buildTournamentDonorThankYou(confirmedDonorAmounts(settlement.participants))
    if (t) messages.push(t)
  } else {
    const g = buildGeneralDonorThankYou(confirmedDonorNames(settlement.participants))
    if (g) messages.push(g)
  }
  messages.push(...buildDinnerThankYouTexts(settlement.dinnerContributions))
  return messages
}

/**
 * 회원 공개용 공유문 — 통장 잔액·현금 보유액·회원별 납부액·미확인 계좌이체는 절대 포함하지 않는다.
 * 지출은 몇 건만 골라 보여주지 않고(과거 majorExpenses 방식), 등록된 지출 전체를 한 줄씩 나열한다
 * (allExpenseLineItems) — 그래야 "총지출" 금액과 나열된 항목들의 합이 항상 정확히 일치한다.
 */
export function buildMemberShareText(settlement: RegularSettlement): string {
  const income = calcIncomeSummary(settlement)
  const profit = calcProfitSummary(settlement)
  const duesTotal = income.duesCash + income.duesTransferConfirmed
  const donationTotal = income.donationCash + income.donationTransferConfirmed + income.otherIncome
  const items = allExpenseLineItems(settlement)
  const thanks = donorThankYouMessages(settlement)

  const lines = [
    `[${settlement.meetingName}] ${settlement.meetingDate}`,
    '',
    `총수입 ${won(profit.totalIncome)}`,
    `회비 ${won(duesTotal)}`,
    `찬조금 ${won(donationTotal)}`,
    '',
    `총지출 ${won(profit.totalExpense)}`,
    ...items.map((it) => `${it.label} ${won(it.amount)}`),
    '',
    `[${settlement.meetingName}] 손익 ${won(profit.netProfit)}`,
  ]
  if (thanks.length > 0) {
    lines.push('', ...thanks)
  }
  return lines.join('\n')
}

/** 회장 보고용 공유문 — 회원용 내용 + 통장·현금 등 내부 재무 정보. 관리자만 생성한다. */
export function buildPresidentShareText(settlement: RegularSettlement): string {
  const memberText = buildMemberShareText(settlement)
  const bank = calcBankSummary(settlement)
  const cash = calcCashSummary(settlement)

  const lines = [
    memberText,
    '',
    '[관리자 보고용]',
    `전월 통장 잔액 ${won(bank.prevBalance)}`,
    `이번 기간 통장 증감 ${bank.bankChange >= 0 ? '+' : ''}${won(bank.bankChange)}`,
    `현재 통장 잔액 ${won(bank.currentBalance)}`,
    `현금 수입 ${won(cash.cashIncome)} / 현금 지출 ${won(cash.cashExpense)}`,
    `현금 잔액(입금 전) ${won(cash.cashBalanceBeforeDeposit)} / 현금 통장 입금액 ${won(cash.confirmedDeposit)}`,
    `현금 잔액(입금 후) ${won(cash.cashBalanceAfterDeposit)}`,
    `계좌이체 미확인 금액 ${won(bank.unconfirmedTransferAmount)}`,
  ]
  return lines.join('\n')
}

/**
 * 관리자 원본(RegularSettlement)에서 회원 공개용 요약만 뽑아낸다.
 * status가 'confirmed'가 아니면 호출하지 않는 것을 전제로 한다(호출부에서 확정 여부 확인).
 */
export function buildPublicSummary(settlement: RegularSettlement): SettlementPublicSummary {
  const profit = calcProfitSummary(settlement)
  const income = calcIncomeSummary(settlement)
  // 회식비는 이제 두 출처를 가질 수 있다: 레거시 DinnerContribution(별도 배열)과 신규 지출
  // 분류 '회식비'(SettlementExpense). expenseByCategory가 이미 두 출처를 중복 없이 합산해두므로
  // 그 값을 그대로 쓰고, 건수(roundCount)만 두 배열에서 각각 세어 더한다.
  const dinnerClubShareTotal = calcExpenseByCategory(settlement).find((c) => c.category === DINNER_CATEGORY)?.amount ?? 0
  const dinnerRoundCount =
    settlement.dinnerContributions.length +
    settlement.expenses.filter((e) => displayExpenseCategory(e.category) === DINNER_CATEGORY).length
  return {
    id: settlement.id,
    meetingName: settlement.meetingName,
    meetingDate: settlement.meetingDate,
    meetingType: settlement.meetingType,
    totalIncome: profit.totalIncome,
    totalExpense: profit.totalExpense,
    netProfit: profit.netProfit,
    majorExpenses: majorExpenses(settlement),
    donorNames: settlement.meetingType === 'regular' ? confirmedDonorNames(settlement.participants) : [],
    donorAmounts: settlement.meetingType === 'tournament' ? confirmedDonorAmounts(settlement.participants) : undefined,
    thankYouMessages: donorThankYouMessages(settlement),
    confirmedAt: settlement.confirmedAt ?? new Date().toISOString(),
    version: settlement.version,
    duesTotal: income.duesCash + income.duesTransferConfirmed + income.duesOther,
    donationTotal: income.donationCash + income.donationTransferConfirmed + income.donationOther,
    cashIncomeTotal: income.duesCash + income.donationCash,
    transferIncomeTotal: income.duesTransferConfirmed + income.donationTransferConfirmed,
    expenseByCategory: calcExpenseByCategory(settlement),
    dinnerSummary: { roundCount: dinnerRoundCount, clubShareTotal: dinnerClubShareTotal },
  }
}

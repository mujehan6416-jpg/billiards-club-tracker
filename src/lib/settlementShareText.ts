import type { DinnerContribution, RegularSettlement, SettlementPublicSummary } from '../types/settlement'
import {
  allExpenseLineItems,
  buildFundMovementLog,
  calcBankSummary,
  calcCashSummary,
  calcExpenseByCategory,
  calcHoldingsSummary,
  calcIncomeSummary,
  calcProfitSummary,
  confirmedDonorAmounts,
  confirmedDonorNames,
  majorExpenses,
  withdrawalsOf,
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

  // 현금 현황은 3줄만 보여준다. 통장 인출액·통장 입금액·"입금 전/인출 반영" 같은 중간 계산값은 여기서 빼고,
  // 그 금액들은 아래 [자금이동 내역]에서만 보여준다(중복 표시 제거 — 기록·계산식·데이터는 그대로다).
  // 현재 보유 현금 = cash.cashBalance (= 받은 현금 + 통장 인출 − 현금 지출 − 통장 입금, 기존 계산 그대로).
  const lines = [
    memberText,
    '',
    '[관리자 보고용]',
    `전월 통장 잔액 ${won(bank.prevBalance)}`,
    `이번 기간 통장 증감 ${bank.bankChange >= 0 ? '+' : ''}${won(bank.bankChange)}`,
    `현재 통장 잔액 ${won(bank.currentBalance)}`,
    '',
    '[현금 현황]',
    `현금으로 받은 금액 ${won(cash.cashIncome)}`,
    `현금으로 지출한 금액 ${won(cash.cashExpense)}`,
    cash.cashBalance < 0 ? `현금 부족 ${won(-cash.cashBalance)}` : `현재 보유 현금 ${won(cash.cashBalance)}`,
    '',
    `계좌이체 미확인 금액 ${won(bank.unconfirmedTransferAmount)}`,
  ]
  // 통장에서 현금 인출 기록이 있는 정산에만 추가한다(예전처럼).
  if (withdrawalsOf(settlement).length > 0) {
    lines.push(`전체 보유액(통장+현금) ${won(calcHoldingsSummary(settlement).totalHoldings)}`)
  }
  // 통장 거래내역과 대조할 수 있게 날짜순으로(인출 + 입금확인된 현금 통장 입금). 회원용 문구·공개 요약에는 넣지 않는다.
  // 형식: "09/30 통장 → 현금 1,200,000원" 다음 줄에 메모(있을 때), 건과 건 사이는 한 줄 띄운다.
  const movements = buildFundMovementLog(settlement)
  if (movements.length > 0) {
    lines.push('', '[자금이동 내역]')
    movements.forEach((e, i) => {
      const day = e.date.length >= 10 ? `${e.date.slice(5, 7)}/${e.date.slice(8, 10)}` : e.date
      const flow = e.kind === 'withdrawal' ? '통장 → 현금' : '현금 → 통장'
      if (i > 0) lines.push('')
      lines.push(`${day} ${flow} ${won(e.amount)}`)
      if (e.note) lines.push(e.note)
    })
  }
  return lines.join('\n')
}

// ────────────────────────────────────────────────────────────
// 찬조 상세내역 공유문 (공유 탭의 세 번째 종류 — 회원용·회장 보고용 공유문과는 완전히 별개)
//
// - 찬조금: 기존 회계 기준(confirmedDonorAmounts = calcIncomeSummary와 같은 "확정" 판정)을 그대로 쓴다.
//   현금은 즉시 확정, 계좌이체·기타는 입금확인만, 미확인·취소·0원은 제외. 한 사람이 여러 행(donationPayments[])으로
//   냈으면 확정된 행만 더해 회원별 한 줄로, 순서는 참가자 등록 순서 그대로(금액순 정렬 없음).
// - 물품찬조: 화면에서 직접 입력한 글을 그대로 붙인다(서버·DB에 저장하지 않는다). 비어 있으면 섹션 자체를 뺀다.
// - 이름과 금액만 쓴다 — 연락처·이메일·주소 등 다른 회원 정보는 이 함수가 읽지도 않는다.
// ────────────────────────────────────────────────────────────

const DONATION_RULE = '━━━━━━━━━━━━━━'

/** 찬조 상세내역 맨 아래에 항상 들어가는 감사 인사(카카오톡에서 읽기 쉬운 짧은 문단). */
export const DONATION_THANK_YOU_LINES = [
  '소중한 찬조를 보내주신 모든 분들께',
  '진심으로 감사드립니다.',
  '',
  '여러분의 따뜻한 마음 덕분에',
  '행사를 더욱 풍성하게 진행할 수 있었습니다.',
  '감사합니다.',
] as const

export const NO_CONFIRMED_DONATION_TEXT = '확인된 찬조금 내역이 없습니다.'

export interface DonationDetail {
  /** 회원별 확정 찬조금 합계 — 참가자 등록 순서. */
  donors: { name: string; amount: number }[]
  total: number
}

export function buildDonationDetail(settlement: RegularSettlement): DonationDetail {
  const donors = confirmedDonorAmounts(settlement.participants)
  return { donors, total: donors.reduce((sum, d) => sum + d.amount, 0) }
}

/** 물품찬조 입력 글을 공유문용으로 정리한다: 줄바꿈 통일(\r\n→\n)과 앞뒤 빈 줄·공백 제거만 하고 나머지는 그대로 둔다. */
export function normalizeGiftDonationText(raw: string): string {
  return raw.replace(/\r\n?/g, '\n').trim()
}

/** 찬조 상세내역 카카오톡 공유문. giftText는 물품찬조 직접 입력(없거나 비어 있으면 그 섹션을 뺀다). */
export function buildDonationDetailText(settlement: RegularSettlement, giftText = ''): string {
  const { donors, total } = buildDonationDetail(settlement)
  const gifts = normalizeGiftDonationText(giftText)

  const lines: string[] = [DONATION_RULE, '🎁 찬조 내역', DONATION_RULE, '', '[찬조금]', '']
  if (donors.length > 0) {
    lines.push(...donors.map((d) => `${d.name} ${won(d.amount)}`), '', `찬조금 합계: ${won(total)}`)
  } else {
    lines.push(NO_CONFIRMED_DONATION_TEXT)
  }
  if (gifts) {
    lines.push('', '', '[물품찬조]', '', gifts)
  }
  lines.push('', '', DONATION_RULE, '', ...DONATION_THANK_YOU_LINES)
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

import type { DinnerContribution, RegularSettlement, SettlementPublicSummary } from '../types/settlement'
import {
  allExpenseLineItems,
  buildFundMovementLog,
  calcBankSummary,
  calcCashSummary,
  calcExpenseByCategory,
  calcExpenseSummary,
  calcHoldingsSummary,
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

/** 총지출을 결제수단별로 풀어 쓴 괄호 문구: "(현금 1,920,000원 + 계좌이체 480,000원 + 체크카드 100,000원)". 0원 수단은 생략, 전부 0원이면 빈 문자열. */
export function expenseByMethodText(settlement: RegularSettlement): string {
  const e = calcExpenseSummary(settlement) // 총지출 = cash + card + transfer + other — 이 네 값의 합이 곧 총지출금액
  const parts: [string, number][] = [['현금', e.cash], ['계좌이체', e.transfer], ['체크카드', e.card], ['기타', e.other]]
  const shown = parts.filter(([, n]) => n > 0).map(([name, n]) => `${name} ${won(n)}`)
  return shown.length > 0 ? `(${shown.join(' + ')})` : ''
}

/**
 * 회장 보고용 지출 상세 — 항목마다 결제수단을 붙인다("상품비 200,000원 (현금)"). 금액·항목·순서는 회원용 공유문의
 * allExpenseLineItems와 똑같이 모임 부담액(clubShare)·예전 회식비(차수순) 다음 지출(등록순)이고, 결제수단은 각 기록의 값(현금/체크카드/계좌이체/기타)이다.
 */
export function expenseLinesWithMethod(settlement: RegularSettlement): string[] {
  const dinner = [...settlement.dinnerContributions]
    .sort((a, b) => a.dinnerRound - b.dinnerRound)
    .map((d) => `${d.dinnerRound}차 회식비${d.paidBy ? `(${d.paidBy})` : ''} ${won(d.clubShare)} (${d.method})`)
  const items = settlement.expenses.map((e) => `${e.label} ${won(e.clubShare)} (${e.method})`)
  return [...dinner, ...items]
}

/** 현금 흐름표 한 줄: 내용, 증감, 그 시점의 보유 현금. */
export interface CashFlowRow { label: string; delta: number; balance: number }

/**
 * 현금 흐름표 — 현금이 어떻게 늘고 줄었는지 순서대로(현금 회비 → 현금 찬조금 → 통장에서 현금 인출 → 현금 지출 → 현금을 통장에 입금).
 * 새 계산 없이 기존 calcIncomeSummary(현금 회비·찬조)·calcCashSummary(인출·현금 지출·입금확인 입금)의 값을 그대로 늘어놓고
 * 누적만 더한다 → 마지막 보유액은 항상 calcCashSummary().cashBalance와 같다. 0원 항목은 뺀다.
 * 통장 인출·입금은 현금의 "위치 이동"이라 총수입·총지출에는 들어가지 않고 여기서만 현금 증가/감소로 보인다.
 */
export function buildCashFlowRows(settlement: RegularSettlement): CashFlowRow[] {
  const income = calcIncomeSummary(settlement)
  const cash = calcCashSummary(settlement)
  const steps: [string, number][] = [
    ['현금 회비', income.duesCash],
    ['현금 찬조금', income.donationCash],
    ['통장에서 현금 인출', cash.bankWithdrawal],
    ['현금 지출', -cash.cashExpense],
    ['현금을 통장에 입금', -cash.confirmedDeposit],
  ]
  let balance = 0
  const rows: CashFlowRow[] = []
  for (const [label, delta] of steps) {
    balance += delta
    if (delta !== 0) rows.push({ label, delta, balance })
  }
  return rows
}

const signedWon = (n: number) => `${n >= 0 ? '+' : '-'}${won(Math.abs(n))}`
/** 현금이 모자라면(음수) "현금 부족 N원", 아니면 "N원". */
const cashOrShortage = (n: number) => (n < 0 ? `현금 부족 ${won(-n)}` : won(n))

/**
 * 회장 보고용 공유문 — 정산 제목 + 관리자용 재무 요약. 관리자만 생성한다.
 * 구성: 통장 요약(전월 잔액·총수입·총지출+결제수단별·현재 잔액) → [현금 흐름표] → [자금이동 내역] → [지출 내역].
 * 현금 흐름표가 현금 설명을 모두 맡으므로 예전 [현금 현황] 3줄은 따로 두지 않는다(중복 제거).
 * 카카오톡은 고정폭 글꼴이 아니라서 열을 맞춘 표 대신 "라벨 / +금액 → 보유 금액" 두 줄 흐름으로 쓴다.
 */
export function buildPresidentShareText(settlement: RegularSettlement): string {
  const bank = calcBankSummary(settlement)
  const cash = calcCashSummary(settlement)
  const profit = calcProfitSummary(settlement)
  const byMethod = expenseByMethodText(settlement)

  const lines: string[] = [
    `[${settlement.meetingName}] ${settlement.meetingDate}`,
    '',
    '[관리자 보고용]',
    '',
    `전월 통장 잔액 : ${won(bank.prevBalance)}`,
    '',
    `총수입금액 : ${won(profit.totalIncome)}`,
    '',
    `총지출금액 : ${won(profit.totalExpense)}`,
  ]
  if (byMethod) lines.push(byMethod)
  lines.push('', `현재 통장 잔액 : ${won(bank.currentBalance)}`)
  lines.push(`계좌이체 미확인 금액 : ${won(bank.unconfirmedTransferAmount)}`)

  // [현금 흐름표] — 마지막 보유액 = 현재 보유 현금(= cash.cashBalance)
  lines.push('', '', '[현금 흐름표]', '')
  for (const r of buildCashFlowRows(settlement)) {
    lines.push(r.label, `${signedWon(r.delta)} → 보유 ${cashOrShortage(r.balance)}`, '')
  }
  lines.push(cash.cashBalance < 0 ? `현금 부족 ${won(-cash.cashBalance)}` : `현재 보유 현금 : ${won(cash.cashBalance)}`)
  if (cash.cashBalance < 0) lines.push('현금 수입, 통장 인출 또는 지출 내역을 확인해 주세요.')
  // 전체 보유액(= 현재 통장 잔액 + 현재 보유 현금)은 인출 기록 유무와 상관없이 항상 보여준다. 기존 calcHoldingsSummary 값 그대로.
  lines.push(`전체 보유액 : ${won(calcHoldingsSummary(settlement).totalHoldings)}`)

  // [자금이동 내역] — 통장 거래내역과 대조용(날짜순, 인출 + 입금확인된 현금 통장 입금). 현금 흐름표의 인출·입금 합계와 같은 기록이다.
  const movements = buildFundMovementLog(settlement)
  if (movements.length > 0) {
    lines.push('', '', '[자금이동 내역]', '')
    movements.forEach((e, i) => {
      const day = e.date.length >= 10 ? `${e.date.slice(5, 7)}/${e.date.slice(8, 10)}` : e.date
      const flow = e.kind === 'withdrawal' ? '통장 → 현금' : '현금 → 통장'
      if (i > 0) lines.push('')
      lines.push(`${day} ${flow} ${won(e.amount)}`)
      if (e.note) lines.push(e.note)
    })
  }

  // [지출 내역] — 항목마다 결제수단 표시
  const expenseLines = expenseLinesWithMethod(settlement)
  if (expenseLines.length > 0) {
    lines.push('', '', '[지출 내역]', '', ...expenseLines)
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

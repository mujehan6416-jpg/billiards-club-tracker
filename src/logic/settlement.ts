import type {
  RegularSettlement,
  SettlementParticipant,
  SettlementExpense,
  SettlementStatus,
  RevisionEntry,
  DinnerContribution,
  DinnerContributionType,
  DinnerContributor,
  CashDepositStatus,
  DuesPaymentMethod,
  DonationPaymentMethod,
  DuesStatus,
  DonationStatus,
  DonationPayment,
} from '../types/settlement'
import type { Member } from '../types'
import { EXPENSE_CATEGORIES, displayExpenseCategory, DINNER_CATEGORY } from '../lib/settlementConstants'

const sum = (nums: number[]) => nums.reduce((a, b) => a + b, 0)

export interface SettlementIncomeSummary {
  duesCash: number
  duesTransferConfirmed: number
  duesTransferUnconfirmed: number
  duesOther: number
  donationCash: number
  donationTransferConfirmed: number
  donationTransferUnconfirmed: number
  donationOther: number
  otherIncome: number
  totalIncome: number
}

/**
 * 수입 집계. '입금확인' 상태만 실수입으로 잡는다.
 * '미확인'(주로 계좌이체)은 총수입에서 제외하고 별도 항목으로만 보여준다.
 * method='기타'는 otherIncome(=기타 수입/기타 계좌 입금)으로 묶는다.
 *
 * 확정 정책: 현금은 입력 즉시 확인 완료된 수입으로 처리한다 — status 값과 무관하게 항상 포함한다.
 * (참가자 탭 UI가 현금일 때는 확인 상태 select 자체를 숨기고 store가 저장 시 status를 '입금확인'으로
 * 정규화하지만, 과거 데이터에 다른 문자열이 남아있을 가능성에 대비해 집계에서도 status를 보지 않고
 * method만으로 판정한다 — 방어적 처리.)
 */
export function calcIncomeSummary(settlement: RegularSettlement): SettlementIncomeSummary {
  const dues = settlement.participants.map((p) => p.dues).filter((d): d is NonNullable<typeof d> => !!d)
  const donations = settlement.participants.map((p) => p.donation).filter((d): d is NonNullable<typeof d> => !!d)

  const duesCash = sum(dues.filter((d) => d.method === '현금').map((d) => d.amount))
  const duesTransferConfirmed = sum(dues.filter((d) => d.method === '계좌이체' && d.status === '입금확인').map((d) => d.amount))
  const duesTransferUnconfirmed = sum(dues.filter((d) => d.method === '계좌이체' && d.status === '미확인').map((d) => d.amount))
  const duesOther = sum(dues.filter((d) => d.method === '기타' && d.status === '입금확인').map((d) => d.amount))

  const donationCash = sum(donations.filter((d) => d.method === '현금').map((d) => d.amount))
  const donationTransferConfirmed = sum(donations.filter((d) => d.method === '계좌이체' && d.status === '입금확인').map((d) => d.amount))
  const donationTransferUnconfirmed = sum(donations.filter((d) => d.method === '계좌이체' && d.status === '미확인').map((d) => d.amount))
  const donationOther = sum(donations.filter((d) => d.method === '기타' && d.status === '입금확인').map((d) => d.amount))

  const otherIncome = duesOther + donationOther
  const totalIncome = duesCash + duesTransferConfirmed + donationCash + donationTransferConfirmed + otherIncome

  return {
    duesCash, duesTransferConfirmed, duesTransferUnconfirmed, duesOther,
    donationCash, donationTransferConfirmed, donationTransferUnconfirmed, donationOther,
    otherIncome, totalIncome,
  }
}

export interface SettlementExpenseSummary {
  cash: number
  card: number
  transfer: number
  other: number
  /**
   * 회식비 모임 회계 부담분 합계 — 참고용(위 cash/card/transfer/other 안에 이미 포함됨).
   * 신규 회식비(지출 탭, category===DINNER_CATEGORY)와 레거시 회식비(DinnerContribution, 별도
   * 배열)를 합산한다 — 두 출처가 서로 다른 배열이라 중복 집계될 일은 없다.
   */
  dinnerClubShare: number
  total: number
}

/**
 * 지출 집계는 clubShare(모임 회계가 실제 부담한 금액)만 결제수단별로 더한다.
 * SettlementExpense와 DinnerContribution 양쪽 모두 결제수단(method)을 갖고 있어 같은 방식으로 합산한다.
 * 회식비 전용 탭(DinnerContributionForm)은 제거되었고, 새 회식비는 지출 탭에서 category==='회식비'로
 * 등록된다(SettlementExpense). 과거 DinnerContribution으로 저장된 레거시 데이터는 여전히 별도
 * 배열(dinnerContributions)에 남아있으므로, 두 배열을 합쳐서 한 번만 계산해야 누락·중복이 없다.
 */
export function calcExpenseSummary(settlement: RegularSettlement): SettlementExpenseSummary {
  const byMethod = (method: SettlementExpense['method']) =>
    sum(settlement.expenses.filter((e) => e.method === method).map((e) => e.clubShare)) +
    sum(settlement.dinnerContributions.filter((d) => d.method === method).map((d) => d.clubShare))

  const cash = byMethod('현금')
  const card = byMethod('체크카드')
  const transfer = byMethod('계좌이체')
  const other = byMethod('기타')
  const dinnerClubShare =
    sum(settlement.dinnerContributions.map((d) => d.clubShare)) +
    sum(settlement.expenses.filter((e) => displayExpenseCategory(e.category) === DINNER_CATEGORY).map((e) => e.clubShare))
  const total = cash + card + transfer + other

  return { cash, card, transfer, other, dinnerClubShare, total }
}

export interface SettlementProfitSummary {
  totalIncome: number
  totalExpense: number
  netProfit: number
}

export function calcProfitSummary(settlement: RegularSettlement): SettlementProfitSummary {
  const { totalIncome } = calcIncomeSummary(settlement)
  const { total: totalExpense } = calcExpenseSummary(settlement)
  return { totalIncome, totalExpense, netProfit: totalIncome - totalExpense }
}

export interface SettlementCashSummary {
  cashIncome: number
  cashExpense: number
  cashBalanceBeforeDeposit: number
  confirmedDeposit: number
  cashBalanceAfterDeposit: number
}

/** 현금 수입/지출/입금전·후 잔액. 통장 입금은 '입금확인' 상태만 반영한다. */
export function calcCashSummary(settlement: RegularSettlement): SettlementCashSummary {
  const income = calcIncomeSummary(settlement)
  const expense = calcExpenseSummary(settlement)
  const cashIncome = income.duesCash + income.donationCash
  const cashExpense = expense.cash
  const cashBalanceBeforeDeposit = cashIncome - cashExpense
  const confirmedDeposit = sum(settlement.cashDeposits.filter((d) => d.status === '입금확인').map((d) => d.amount))
  const cashBalanceAfterDeposit = cashBalanceBeforeDeposit - confirmedDeposit

  return { cashIncome, cashExpense, cashBalanceBeforeDeposit, confirmedDeposit, cashBalanceAfterDeposit }
}

export interface SettlementBankSummary {
  prevBalance: number
  confirmedTransferIncome: number
  confirmedCashDeposit: number
  otherBankIncome: number
  cardExpense: number
  transferExpense: number
  otherAdjustment: number
  bankChange: number
  currentBalance: number
  unconfirmedTransferAmount: number
}

/**
 * 통장 잔액 = 전월 잔액 + 입금확인된 계좌이체 수입 + 입금확인된 현금 통장입금액
 *            + 기타 계좌 입금 - 체크카드 지출 - 계좌이체 지출 ± 기타 통장 조정액
 * 현금 수입은 실제로 통장에 입금 확인되기 전까지는 포함하지 않는다.
 */
export function calcBankSummary(settlement: RegularSettlement): SettlementBankSummary {
  const income = calcIncomeSummary(settlement)
  const expense = calcExpenseSummary(settlement)
  const cash = calcCashSummary(settlement)

  const prevBalance = settlement.prevBankBalance
  const confirmedTransferIncome = income.duesTransferConfirmed + income.donationTransferConfirmed
  const confirmedCashDeposit = cash.confirmedDeposit
  const otherBankIncome = income.otherIncome
  const cardExpense = expense.card
  const transferExpense = expense.transfer
  const otherAdjustment = settlement.otherBankAdjustment
  const unconfirmedTransferAmount = income.duesTransferUnconfirmed + income.donationTransferUnconfirmed

  const bankChange =
    confirmedTransferIncome + confirmedCashDeposit + otherBankIncome - cardExpense - transferExpense + otherAdjustment
  const currentBalance = prevBalance + bankChange

  return {
    prevBalance, confirmedTransferIncome, confirmedCashDeposit, otherBankIncome,
    cardExpense, transferExpense, otherAdjustment, bankChange, currentBalance,
    unconfirmedTransferAmount,
  }
}

/**
 * 확정된(공유문에 표시할) 찬조인지 판정 — calcIncomeSummary가 확정 수입으로 잡는 기준과 맞춘다.
 * 현금은 status가 '입금확인'으로 정규화되기 전(예: 결제수단 select를 한 번도 안 건드린 기본값
 * 상태)에도 이미 확정 수입으로 집계되므로(donationCash는 method만 본다), 여기서도 status를
 * 요구하지 않는다 — status만 보고 걸렀던 예전 로직은 이 경우를 놓쳐 찬조자 목록에서 빠졌었다.
 * 계좌이체·기타는 기존대로 status가 '입금확인'이어야 하고, 취소된 건은 방식과 무관하게 제외한다.
 */
function isConfirmedDonation(donation: DonationPayment | undefined): donation is DonationPayment {
  if (!donation || donation.amount <= 0) return false
  if (donation.status === '취소') return false
  return donation.method === '현금' || donation.status === '입금확인'
}

/** 확정된 찬조자만 이름 목록으로 (일반 정기모임 감사문구용). 순서는 참가자 등록 순서를 따른다. */
export function confirmedDonorNames(participants: SettlementParticipant[]): string[] {
  return participants
    .filter((p) => isConfirmedDonation(p.donation))
    .map((p) => p.displayName)
}

/** 확정된 찬조자 이름+금액 (정기대회 감사문구용). */
export function confirmedDonorAmounts(participants: SettlementParticipant[]): { name: string; amount: number }[] {
  return participants
    .filter((p) => isConfirmedDonation(p.donation))
    .map((p) => ({ name: p.displayName, amount: p.donation!.amount }))
}

/** 주요 지출 항목(금액 큰 순). 공유 요약에 몇 건만 노출할 때 사용. */
export function majorExpenses(settlement: RegularSettlement, limit = 3): { label: string; amount: number }[] {
  return [...settlement.expenses]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit)
    .map((e) => ({ label: e.label, amount: e.amount }))
}

/**
 * 정산에 저장된 모든 지출 항목을 하나도 빠짐없이, 등록된 순서 그대로 나열한다(카카오톡 공유 문구용).
 * 금액은 amount(전체 금액)가 아니라 clubShare(모임 부담액)를 쓴다 — calcExpenseSummary의 "총지출"이
 * clubShare 합계이므로, 여기 나열된 항목들의 금액 합도 그 총지출과 정확히 일치해야 한다.
 * 회식비는 레거시 DinnerContribution(별도 배열, 회차 순 정렬)과 신규 지출분류(expenses, 등록 순서)
 * 두 출처를 가질 수 있어 각각의 원래 정렬 기준을 유지한 채 레거시를 먼저, 신규 지출을 뒤에 잇는다.
 */
export function allExpenseLineItems(settlement: RegularSettlement): { label: string; amount: number }[] {
  const dinnerLines = [...settlement.dinnerContributions]
    .sort((a, b) => a.dinnerRound - b.dinnerRound)
    .map((d) => ({
      label: `${d.dinnerRound}차 회식비${d.paidBy ? `(${d.paidBy})` : ''}`,
      amount: d.clubShare,
    }))
  const expenseLines = settlement.expenses.map((e) => ({ label: e.label, amount: e.clubShare }))
  return [...dinnerLines, ...expenseLines]
}

/**
 * 지출 분류(당구비/다과비/회식비/상금/기타)별 모임 부담액 합계. 회원 공개용 요약(일반회원 정산 공개)에서
 * 통장 잔액·현금 보유액 등 민감 정보 없이 "어디에 얼마를 썼는지"만 보여줄 때 쓴다.
 * 예전 분류값(10개)은 displayExpenseCategory로 새 분류(5개)에 매핑해서 합산한다(저장된 원본 category는 그대로 둠).
 * 회식비(DinnerContribution)는 SettlementExpense와 별도 목록이므로, clubShare를 '회식비' 분류에 더해 합친다.
 * 금액이 0인 분류는 표시할 필요가 없으므로 결과에서 제외한다.
 */
export function calcExpenseByCategory(settlement: RegularSettlement): { category: string; amount: number }[] {
  const totals = new Map<string, number>()
  for (const e of settlement.expenses) {
    const cat = displayExpenseCategory(e.category)
    totals.set(cat, (totals.get(cat) ?? 0) + e.clubShare)
  }
  const dinnerTotal = sum(settlement.dinnerContributions.map((d) => d.clubShare))
  if (dinnerTotal > 0) totals.set(DINNER_CATEGORY, (totals.get(DINNER_CATEGORY) ?? 0) + dinnerTotal)
  return EXPENSE_CATEGORIES
    .map((category) => ({ category, amount: totals.get(category) ?? 0 }))
    .filter((c) => c.amount > 0)
}

// ────────────────────────────────────────────────────────────
// 상태 전이
// ────────────────────────────────────────────────────────────

const ALLOWED_TRANSITIONS: Record<SettlementStatus, SettlementStatus[]> = {
  draft: ['confirmed', 'cancelled'],
  confirmed: ['revised', 'cancelled'],
  revised: ['confirmed', 'cancelled'],
  cancelled: [],
}

export function canTransition(from: SettlementStatus, to: SettlementStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to)
}

/** confirmed/cancelled 상태면 일반 입력 필드를 잠근다. revised는 다시 수정 가능하다. */
export function isLocked(status: SettlementStatus): boolean {
  return status === 'confirmed' || status === 'cancelled'
}

export type TransitionResult =
  | { ok: true; settlement: RegularSettlement }
  | { ok: false; error: string }

/**
 * 상태를 바꾸고 revisionLog에 이전/새 상태·시각·처리자 표시명·사유를 남긴다.
 * 데이터는 삭제하지 않는다(취소해도 참가자·지출 등 원본은 그대로 남는다).
 * actorUid는 Firebase Auth 도입 전까지는 항상 undefined일 수 있다 — PIN은 UI 통제일 뿐 서버 보안이 아니다.
 * version은 여기서 건드리지 않는다 — "서버에 마지막으로 저장 성공한 기준 버전"이라는 의미를 유지하기
 * 위해, 버전 증가는 오직 settlementSync.saveSettlement()가 실제로 Firestore 저장에 성공했을 때만
 * settlementStore가 반영한다(로컬 상태 전이·값 편집 자체는 버전에 영향을 주지 않는다).
 */
export function transitionStatus(
  settlement: RegularSettlement,
  to: SettlementStatus,
  actor: { uid?: string; displayName: string },
  reason?: string,
): TransitionResult {
  if (!canTransition(settlement.status, to)) {
    return { ok: false, error: `'${settlement.status}' 상태에서는 '${to}'(으)로 변경할 수 없습니다.` }
  }
  const now = new Date().toISOString()
  const entry: RevisionEntry = {
    fromStatus: settlement.status,
    toStatus: to,
    changedAt: now,
    changedByUid: actor.uid,
    actorDisplayName: actor.displayName,
    reason,
  }
  const patch: Partial<RegularSettlement> = {
    status: to,
    updatedAt: now,
    updatedByUid: actor.uid,
    revisionLog: [...settlement.revisionLog, entry],
  }
  if (to === 'confirmed') {
    patch.confirmedAt = now
    patch.confirmedByUid = actor.uid
  }
  if (to === 'cancelled') {
    patch.cancelledAt = now
    patch.cancelledByUid = actor.uid
  }
  return { ok: true, settlement: { ...settlement, ...patch } }
}

// ────────────────────────────────────────────────────────────
// 일반 지출(SettlementExpense) 금액 계산·검증
// ────────────────────────────────────────────────────────────

/**
 * "모임 부담액" 입력칸을 비워두면 전액(=전체 금액 - 개인 찬조액)을 모임이 부담한 것으로 계산한다.
 * 개인 찬조액이 없으면(0원) 결과는 전체 금액과 같다. 음수가 나오지 않도록 0 이상으로 고정한다.
 */
export function calcDefaultExpenseClubShare(amount: number, personalDonation: number): number {
  return Math.max(0, amount - personalDonation)
}

/**
 * 지출 수정 폼에 "모임 부담액"을 프리필할 때 쓴다. 기존 clubShare가 "비워두면 전액" 자동
 * 계산값(전체 금액 - 개인 찬조액)과 같다면 다시 빈칸으로 되돌려, 수정 화면에서 전체 금액을
 * 바꿔도 "비우면 전액" 규칙이 계속 자동으로 따라가게 한다. 사용자가 명시적으로 다른(부분
 * 부담) 값을 지정했던 경우에는 그 값을 그대로 보여준다.
 */
export function prefillExpenseClubShare(amount: number, clubShare: number, personalDonation: number): string {
  return clubShare === calcDefaultExpenseClubShare(amount, personalDonation) ? '' : String(clubShare)
}

/** 지출의 모임 부담액 + 개인 찬조액 합계가 전체 금액과 정확히 일치하는지 확인한다. */
export function validateExpenseShares(amount: number, clubShare: number, personalDonation: number): ValidationResult {
  if (clubShare + personalDonation !== amount) {
    return {
      ok: false,
      error: `모임 부담액(${clubShare.toLocaleString('ko-KR')}원)과 개인 찬조액(${personalDonation.toLocaleString('ko-KR')}원)을 더한 값이 전체 금액(${amount.toLocaleString('ko-KR')}원)과 일치하지 않습니다.`,
    }
  }
  return { ok: true }
}

// ────────────────────────────────────────────────────────────
// 회식비(DinnerContribution) 검증
// ────────────────────────────────────────────────────────────

export type ValidationResult = { ok: true } | { ok: false; error: string }

/**
 * totalAmount = clubShare + 찬조자 금액 합계 를 강제한다.
 * 찬조 유형별 규칙: 전액찬조=clubShare 0원, 일부찬조=찬조자 1명 이상,
 * 모임회계지출=찬조자 없음 & clubShare===totalAmount.
 */
export function validateDinnerContribution(input: {
  totalAmount: number
  clubShare: number
  contributionType: DinnerContributionType
  contributors: DinnerContributor[]
}): ValidationResult {
  const contributorSum = sum(input.contributors.map((c) => c.amount))
  if (input.clubShare + contributorSum !== input.totalAmount) {
    return {
      ok: false,
      error: `모임 회계 부담액(${input.clubShare.toLocaleString('ko-KR')}원)과 찬조자 금액 합계(${contributorSum.toLocaleString('ko-KR')}원)를 더한 값이 전체 회식비(${input.totalAmount.toLocaleString('ko-KR')}원)와 일치하지 않습니다.`,
    }
  }
  if (input.contributionType === '모임회계지출') {
    if (input.contributors.length > 0) return { ok: false, error: '모임 회계 지출은 찬조자를 등록할 수 없습니다.' }
    if (input.clubShare !== input.totalAmount) return { ok: false, error: '모임 회계 지출은 모임 회계 부담액이 전체 회식비와 같아야 합니다.' }
  }
  if (input.contributionType === '전액찬조') {
    if (input.contributors.length === 0) return { ok: false, error: '전액찬조는 찬조자가 1명 이상 필요합니다.' }
    if (input.clubShare !== 0) return { ok: false, error: '전액찬조는 모임 회계 부담액이 0원이어야 합니다.' }
  }
  if (input.contributionType === '일부찬조' && input.contributors.length === 0) {
    return { ok: false, error: '일부찬조는 찬조자가 1명 이상 필요합니다.' }
  }
  return { ok: true }
}

/** 같은 정산 안에 이미 등록된 회식 차수인지 확인한다(수정 중인 항목 자신은 제외). */
export function hasDuplicateDinnerRound(
  dinnerContributions: DinnerContribution[],
  dinnerRound: number,
  excludeId?: string,
): boolean {
  return dinnerContributions.some((d) => d.dinnerRound === dinnerRound && d.id !== excludeId)
}

// ────────────────────────────────────────────────────────────
// 현금 통장 입금 검증
// ────────────────────────────────────────────────────────────

/**
 * '입금확인' 금액 합계가 입금 전 현금 잔액을 넘지 않게 막는다.
 * (이 조건을 지키면 입금 후 현금 잔액은 자동으로 0원 이상이 된다.)
 */
export function validateCashDeposit(
  settlement: RegularSettlement,
  candidate: { id?: string; amount: number; status: CashDepositStatus },
): ValidationResult {
  const { cashBalanceBeforeDeposit } = calcCashSummary(settlement)
  const otherConfirmed = sum(
    settlement.cashDeposits
      .filter((d) => d.id !== candidate.id && d.status === '입금확인')
      .map((d) => d.amount),
  )
  const candidateConfirmed = candidate.status === '입금확인' ? candidate.amount : 0
  const totalConfirmed = otherConfirmed + candidateConfirmed
  if (totalConfirmed > cashBalanceBeforeDeposit) {
    return {
      ok: false,
      error: `입금 확인 금액 합계(${totalConfirmed.toLocaleString('ko-KR')}원)가 입금 전 현금 잔액(${cashBalanceBeforeDeposit.toLocaleString('ko-KR')}원)보다 많습니다.`,
    }
  }
  return { ok: true }
}

// ────────────────────────────────────────────────────────────
// 회비·찬조 입력표 (참가자별 dues/donation을 "이름·구분·금액·결제수단" 행으로 펼쳐서 보여준다)
//
// 참가자(SettlementParticipant)는 여전히 dues 최대 1개·donation 최대 1개만 갖는 기존 구조
// 그대로다 — 데이터 구조를 바꾸지 않고, 표시할 때만 참가자 1명을 최대 2행(회비/찬조)으로 펼친다.
// 한 사람에게 같은 구분(예: 회비)을 두 번 따로 기록하는 것은 이 구조에서 지원하지 않으며,
// planAddTableRow가 이를 감지해 막는다(중복 구분 행 생성 방지 — 완료 보고에 한계로 기록).
// ────────────────────────────────────────────────────────────

export type IncomeRowCategory = 'dues' | 'donation'
export type IncomeRowMethod = DuesPaymentMethod | DonationPaymentMethod

export interface IncomeTableRow {
  participantId: string
  category: IncomeRowCategory
  displayName: string
  /** 아직 입력 안 됨(=dues/donation 자체가 없음)이면 undefined, 명시적으로 입력됐으면 그 금액(0 포함). */
  amount: number | undefined
  method: IncomeRowMethod | undefined
  /**
   * 입금 확인 상태(미납/미확인/입금확인/취소 — dues/donation 타입에 따라 옵션이 다르다).
   * calcIncomeSummary의 "계좌이체 미확인 합계"·"현금 확정 수입" 등은 이 값을 기준으로 계산되므로,
   * 화면에서 이 값을 바꿀 수 있어야 계좌이체 확인 처리가 실제로 반영된다.
   */
  status: DuesStatus | DonationStatus | undefined
}

/**
 * 참가자 배열을 표의 행 순서(① 참석자 순서 그대로 → ② 같은 사람의 회비 행 다음 찬조 행)로 펼친다.
 * participants 배열 자체의 순서는 절대 바꾸지 않는다(정렬 없음) — 순서 보존은 이 함수가 아니라
 * settlementStore의 참가자 추가 액션들(항상 append)과 Firestore 배열 저장이 이미 보장한다.
 * 회비 행은 모든 참가자에 대해 항상 만든다(기본 행). 찬조 행은 donation이 있을 때만 만든다.
 */
export function buildIncomeTableRows(participants: SettlementParticipant[]): IncomeTableRow[] {
  const rows: IncomeTableRow[] = []
  for (const p of participants) {
    rows.push({ participantId: p.id, category: 'dues', displayName: p.displayName, amount: p.dues?.amount, method: p.dues?.method, status: p.dues?.status })
    if (p.donation) {
      rows.push({ participantId: p.id, category: 'donation', displayName: p.displayName, amount: p.donation.amount, method: p.donation.method, status: p.donation.status })
    }
  }
  return rows
}

export interface IncomeTableSummary {
  duesTotal: number
  donationTotal: number
  cashTotal: number
  transferTotal: number
  totalIncome: number
}

/**
 * 표 하단 합계 — calcIncomeSummary()와 달리 status(입금확인/미확인 등)로 거르지 않고
 * 표에 입력된 금액을 그대로 더한다(요청된 표 자체의 합계이므로). 통장 잔액 등 확정 회계용
 * 합계는 기존 calcIncomeSummary/calcBankSummary를 그대로 쓴다 — 이 함수로 대체하지 않는다.
 */
export function calcIncomeTableSummary(settlement: RegularSettlement): IncomeTableSummary {
  const rows = buildIncomeTableRows(settlement.participants)
  const amountOf = (r: IncomeTableRow) => r.amount ?? 0
  const duesTotal = sum(rows.filter((r) => r.category === 'dues').map(amountOf))
  const donationTotal = sum(rows.filter((r) => r.category === 'donation').map(amountOf))
  const cashTotal = sum(rows.filter((r) => r.method === '현금').map(amountOf))
  const transferTotal = sum(rows.filter((r) => r.method === '계좌이체').map(amountOf))
  const totalIncome = sum(rows.map(amountOf))
  return { duesTotal, donationTotal, cashTotal, transferTotal, totalIncome }
}

/**
 * 표의 금액 입력 문자열을 저장 가능한 값으로 바꾼다.
 * - 빈 문자열 → null ("아직 입력 안 함" — 호출부는 이 값이면 dues/donation을 null로 지워야 한다)
 * - 숫자가 아닌 문자·부호(-)는 전부 제거하므로 음수는 만들어질 수 없다
 * - 그 결과가 유효한 정수가 아니면(빈 입력 등) 0으로 처리한다 — undefined/NaN을 반환하지 않는다
 */
export function parseTableAmount(input: string): number | null {
  const digits = input.replace(/[^0-9]/g, '')
  if (digits === '') return null
  const n = parseInt(digits, 10)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

export type AddTableRowResult =
  | { action: 'update-existing'; participantId: string }
  | { action: 'create-guest' }
  | { action: 'blocked'; error: string }

/**
 * "행 추가"로 이름·구분을 입력했을 때 어떤 액션을 할지 판정한다(순수 함수, Firestore/store 미접근).
 * - 이름이 기존 참가자와 정확히 같고 그 구분이 아직 비어있으면 → 그 참가자에 값을 채운다(update-existing)
 * - 이름이 기존 참가자와 같은데 그 구분이 이미 있으면 → 중복 생성을 막는다(blocked)
 * - 이름이 새로우면 → 새 비회원 참가자를 만든다(create-guest, addGuestParticipant 재사용)
 */
export function planAddTableRow(
  participants: SettlementParticipant[],
  name: string,
  category: IncomeRowCategory,
): AddTableRowResult {
  const trimmed = name.trim()
  if (!trimmed) return { action: 'blocked', error: '이름을 입력해주세요.' }
  const existing = participants.find((p) => p.displayName === trimmed)
  if (!existing) return { action: 'create-guest' }
  const already = category === 'dues' ? !!existing.dues : !!existing.donation
  if (already) {
    return {
      action: 'blocked',
      error: `${trimmed}님은 이미 ${category === 'dues' ? '회비' : '찬조'}가 입력되어 있습니다. 표에서 해당 행을 직접 수정해주세요.`,
    }
  }
  return { action: 'update-existing', participantId: existing.id }
}

export type DeleteTableRowResult = { action: 'clear-category' } | { action: 'remove-participant' }

/**
 * 표의 행 삭제(또는 초기화) 버튼을 눌렀을 때 어떤 액션을 할지 판정한다.
 * - 실제 모임 참석자(addedVia === 'meeting_attendee')는 절대 참가자 자체를 지우지 않는다
 *   (기본 참석자 행 삭제 금지 — 회비/찬조 값만 비운다).
 * - 그 외(관리자가 정산에만 추가한 사람)는, 지우려는 구분 외에 남는 값이 없으면 참가자 자체를 지운다.
 */
export function planDeleteTableRow(participant: SettlementParticipant, category: IncomeRowCategory): DeleteTableRowResult {
  if (participant.addedVia === 'meeting_attendee') return { action: 'clear-category' }
  const willHaveOther = category === 'dues' ? !!participant.donation : !!participant.dues
  return willHaveOther ? { action: 'clear-category' } : { action: 'remove-participant' }
}

/**
 * "회원 검색으로 추가"의 검색 결과를 계산한다(순수 함수 — 회원명부·정산 데이터를 읽기만 하고
 * 절대 수정하지 않는다). 이미 이 정산의 참가자로 들어와 있는 회원(memberId로 매칭)은 결과에서
 * 제외해, 검색 결과 단계에서부터 중복 추가가 불가능하도록 한다.
 */
export function searchAddableMembers(members: Member[], participants: SettlementParticipant[], searchTerm: string): Member[] {
  const trimmed = searchTerm.trim()
  if (!trimmed) return []
  const alreadyAdded = new Set(participants.map((p) => p.memberId).filter((id): id is string => !!id))
  return members.filter((m) => m.active && m.name.includes(trimmed) && !alreadyAdded.has(m.id))
}

export type AmountClearResult = { action: 'set-zero' } | { action: 'clear-all' }

/**
 * 표에서 금액을 빈칸으로 지웠을 때 dues/donation 객체를 통째로 지워도 되는지(clear-all) 판정한다.
 * status가 기본값이 아니거나 note·paidAt이 있으면(=관리자가 이전에 실제로 손댄 기록) 데이터
 * 손실을 막기 위해 금액만 0으로 바꾸라고 판정한다(set-zero) — status/note/paidAt은 그대로 둔다.
 * 완전히 비어있던(방금 생성됐거나 기본값 그대로인) 행만 진짜로 지운다(clear-all).
 */
export function planClearAmount(
  existing: { status: string; note?: string; paidAt?: string } | undefined,
  defaultStatus: string,
): AmountClearResult {
  const hasMeta = !!existing && (!!existing.note || !!existing.paidAt || existing.status !== defaultStatus)
  return hasMeta ? { action: 'set-zero' } : { action: 'clear-all' }
}

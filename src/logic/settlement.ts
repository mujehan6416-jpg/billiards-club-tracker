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
} from '../types/settlement'

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
 */
export function calcIncomeSummary(settlement: RegularSettlement): SettlementIncomeSummary {
  const dues = settlement.participants.map((p) => p.dues).filter((d): d is NonNullable<typeof d> => !!d)
  const donations = settlement.participants.map((p) => p.donation).filter((d): d is NonNullable<typeof d> => !!d)

  const duesCash = sum(dues.filter((d) => d.method === '현금' && d.status === '입금확인').map((d) => d.amount))
  const duesTransferConfirmed = sum(dues.filter((d) => d.method === '계좌이체' && d.status === '입금확인').map((d) => d.amount))
  const duesTransferUnconfirmed = sum(dues.filter((d) => d.method === '계좌이체' && d.status === '미확인').map((d) => d.amount))
  const duesOther = sum(dues.filter((d) => d.method === '기타' && d.status === '입금확인').map((d) => d.amount))

  const donationCash = sum(donations.filter((d) => d.method === '현금' && d.status === '입금확인').map((d) => d.amount))
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
  /** 회식비(DinnerContribution) 모임 회계 부담분 합계 — 참고용(위 cash/card/transfer/other 안에 이미 포함됨). */
  dinnerClubShare: number
  total: number
}

/**
 * 지출 집계는 clubShare(모임 회계가 실제 부담한 금액)만 결제수단별로 더한다.
 * SettlementExpense와 DinnerContribution 양쪽 모두 결제수단(method)을 갖고 있어 같은 방식으로 합산한다.
 * 회식비는 SettlementExpense에 이중으로 입력하지 않는다는 전제이므로(store에서 강제),
 * 여기서도 두 목록을 합쳐서 한 번만 계산한다.
 */
export function calcExpenseSummary(settlement: RegularSettlement): SettlementExpenseSummary {
  const byMethod = (method: SettlementExpense['method']) =>
    sum(settlement.expenses.filter((e) => e.method === method).map((e) => e.clubShare)) +
    sum(settlement.dinnerContributions.filter((d) => d.method === method).map((d) => d.clubShare))

  const cash = byMethod('현금')
  const card = byMethod('체크카드')
  const transfer = byMethod('계좌이체')
  const other = byMethod('기타')
  const dinnerClubShare = sum(settlement.dinnerContributions.map((d) => d.clubShare))
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

/** 입금확인된 찬조자만 이름 목록으로 (일반 정기모임 감사문구용). 순서는 참가자 등록 순서를 따른다. */
export function confirmedDonorNames(participants: SettlementParticipant[]): string[] {
  return participants
    .filter((p) => p.donation && p.donation.status === '입금확인')
    .map((p) => p.displayName)
}

/** 입금확인된 찬조자 이름+금액 (정기대회 감사문구용). */
export function confirmedDonorAmounts(participants: SettlementParticipant[]): { name: string; amount: number }[] {
  return participants
    .filter((p) => p.donation && p.donation.status === '입금확인')
    .map((p) => ({ name: p.displayName, amount: p.donation!.amount }))
}

/** 주요 지출 항목(금액 큰 순). 공유 요약에 몇 건만 노출할 때 사용. */
export function majorExpenses(settlement: RegularSettlement, limit = 3): { label: string; amount: number }[] {
  return [...settlement.expenses]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit)
    .map((e) => ({ label: e.label, amount: e.amount }))
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

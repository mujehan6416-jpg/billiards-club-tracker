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
  DuesPayment,
  BankCashWithdrawal,
} from '../types/settlement'
import type { Member } from '../types'
import { EXPENSE_CATEGORIES, displayExpenseCategory, DINNER_CATEGORY } from '../lib/settlementConstants'

const sum = (nums: number[]) => nums.reduce((a, b) => a + b, 0)

// ────────────────────────────────────────────────────────────
// 회비·찬조 여러 행 — 읽기/저장 공통 기준
//
// 한 사람이 회비·찬조를 여러 번(또는 여러 결제수단으로) 나눠 낼 수 있도록 duesPayments/donationPayments
// 배열을 쓴다. 예전 정산에는 배열이 없고 dues/donation 하나만 있으므로, 화면·합계·공유 문구·찬조자 계산은
// 모두 아래 함수로만 읽는다 → 예전 정산은 변환(migration) 없이 그대로 1행으로 보이고 합계도 같다.
// ────────────────────────────────────────────────────────────

/** 회비 내역. duesPayments가 있으면 그 배열, 없으면 예전 단일 dues를 1행으로(그것도 없으면 빈 목록). */
export function duesEntriesOf(p: SettlementParticipant): DuesPayment[] {
  return p.duesPayments ?? (p.dues ? [p.dues] : [])
}

/** 찬조 내역. donationPayments가 있으면 그 배열, 없으면 예전 단일 donation을 1행으로(그것도 없으면 빈 목록). */
export function donationEntriesOf(p: SettlementParticipant): DonationPayment[] {
  return p.donationPayments ?? (p.donation ? [p.donation] : [])
}

/**
 * 회비 행 목록을 참가자에 저장하는 형태로 만든다: 배열 전체 + dues에 첫 행 복사본(배열을 모르는 옛 앱도
 * 첫 행은 볼 수 있게). 행이 하나도 없으면 dues도 비운다(예전 "회비 지우기"와 같은 결과).
 */
export function withDuesEntries(p: SettlementParticipant, rows: DuesPayment[]): SettlementParticipant {
  return { ...p, duesPayments: rows, dues: rows[0] ? { ...rows[0] } : undefined }
}

/** 찬조 행 목록을 저장 형태로: 배열 전체 + donation에 첫 행 복사본. 행이 없으면 donation도 비운다. */
export function withDonationEntries(p: SettlementParticipant, rows: DonationPayment[]): SettlementParticipant {
  return { ...p, donationPayments: rows, donation: rows[0] ? { ...rows[0] } : undefined }
}

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
  // 여러 행이면 모든 행을 각각 더한다(행마다 결제수단·확인상태가 따로 있다).
  const dues = settlement.participants.flatMap(duesEntriesOf)
  const donations = settlement.participants.flatMap(donationEntriesOf)

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

// ────────────────────────────────────────────────────────────
// 통장에서 현금 인출 (통장 → 현금 한 방향 전용)
//
// 인출은 수입도 지출도 아니다 — 총수입·총지출·모임 순익(calcIncomeSummary/calcExpenseSummary/
// calcProfitSummary)에는 전혀 들어가지 않고, 아래 현금·통장 잔액 계산에서만 반대로 반영된다.
// 반대 방향(현금 → 통장 입금)은 기존 cashDeposits가 담당하며 그 계산은 그대로다 — 여기서 다시 세지 않는다.
// 예전 정산에는 bankCashWithdrawals 필드가 없으므로 항상 withdrawalsOf로 읽는다(없으면 빈 목록 → 기존 계산과 동일).
// ────────────────────────────────────────────────────────────

/** 통장에서 현금 인출 내역. 필드가 없는 예전 정산은 빈 목록. */
export function withdrawalsOf(settlement: RegularSettlement): BankCashWithdrawal[] {
  return settlement.bankCashWithdrawals ?? []
}

/** 통장에서 현금으로 찾아온 금액 합계. */
export function calcWithdrawalTotal(settlement: RegularSettlement): number {
  return sum(withdrawalsOf(settlement).map((w) => w.amount))
}

/** 통합 자금이동 내역 1줄 — 기존 두 기록(인출·입금)을 그대로 보여주기 위한 표시용 값이다(저장하지 않는다). */
export interface FundMovementEntry {
  /** 'withdrawal' = 통장에서 현금 인출(통장 → 현금), 'deposit' = 현금을 통장에 입금(현금 → 통장). */
  kind: 'withdrawal' | 'deposit'
  /** 출금일(bankCashWithdrawals.date) 또는 입금일(cashDeposits.depositDate). 두 날짜를 서로 맞추지 않는다. */
  date: string
  amount: number
  note?: string
  /** 원본 기록의 id(화면 key용). */
  id: string
}

/**
 * 통장 거래내역과 대조하기 위한 통합 자금이동 내역: 통장에서 현금 인출(bankCashWithdrawals) +
 * 현금을 통장에 입금(cashDeposits, '입금확인'만 — 잔액 계산에 반영되는 입금과 똑같은 기준이고, 입금예정·
 * 입금전·취소는 실제 통장 거래가 아니므로 제외한다). 읽기 전용 — 두 원본 배열과 계산에는 영향이 없다.
 *
 * 정렬: 날짜 오름차순(오래된 것 → 최근, 통장 거래내역 흐름과 같은 순서). 같은 날짜는 ① 인출 → 입금 순,
 * ② 같은 종류끼리는 기록 시각(createdAt, 인출만 있음) → ③ 원래 입력 순서. 이 키 조합은 항상 같은 결과를 낸다.
 */
export function buildFundMovementLog(settlement: RegularSettlement): FundMovementEntry[] {
  const keyed = [
    ...withdrawalsOf(settlement).map((w, index) => ({
      entry: { kind: 'withdrawal' as const, date: w.date, amount: w.amount, note: w.note, id: w.id },
      rank: 0, createdAt: w.createdAt ?? '', index,
    })),
    ...settlement.cashDeposits
      .filter((d) => d.status === '입금확인')
      .map((d, index) => ({
        entry: { kind: 'deposit' as const, date: d.depositDate, amount: d.amount, note: d.note, id: d.id },
        rank: 1, createdAt: '', index,
      })),
  ]
  keyed.sort((a, b) =>
    a.entry.date.localeCompare(b.entry.date) ||
    a.rank - b.rank ||
    a.createdAt.localeCompare(b.createdAt) ||
    a.index - b.index)
  return keyed.map((k) => ({ ...k.entry, note: k.entry.note?.trim() || undefined }))
}

export interface SettlementCashSummary {
  cashIncome: number
  cashExpense: number
  /** 현금 수입 − 현금 지출 (자금이동은 반영하지 않는다 — 기존 의미 유지). */
  cashBalanceBeforeDeposit: number
  confirmedDeposit: number
  /** 입금 전 잔액 − 통장 입금확인액 (자금이동은 반영하지 않는다 — 기존 의미 유지). */
  cashBalanceAfterDeposit: number
  /** 통장에서 현금으로 찾아온(인출) 금액 합계. */
  bankWithdrawal: number
  /** 현금잔액(최종) = 입금 후 현금 잔액 + 통장에서 인출한 현금. 인출 기록이 없으면 cashBalanceAfterDeposit과 같다. */
  cashBalance: number
}

/** 현금 수입/지출/입금전·후 잔액. 통장 입금은 '입금확인' 상태만 반영한다. 통장 인출은 별도 필드로만 반영한다. */
export function calcCashSummary(settlement: RegularSettlement): SettlementCashSummary {
  const income = calcIncomeSummary(settlement)
  const expense = calcExpenseSummary(settlement)
  const cashIncome = income.duesCash + income.donationCash
  const cashExpense = expense.cash
  const cashBalanceBeforeDeposit = cashIncome - cashExpense
  const confirmedDeposit = sum(settlement.cashDeposits.filter((d) => d.status === '입금확인').map((d) => d.amount))
  const cashBalanceAfterDeposit = cashBalanceBeforeDeposit - confirmedDeposit
  const bankWithdrawal = calcWithdrawalTotal(settlement)
  const cashBalance = cashBalanceAfterDeposit + bankWithdrawal

  return {
    cashIncome, cashExpense, cashBalanceBeforeDeposit, confirmedDeposit, cashBalanceAfterDeposit,
    bankWithdrawal, cashBalance,
  }
}

export interface SettlementBankSummary {
  prevBalance: number
  confirmedTransferIncome: number
  confirmedCashDeposit: number
  otherBankIncome: number
  cardExpense: number
  transferExpense: number
  otherAdjustment: number
  /** 통장에서 현금으로 인출한 금액. 통장잔액이 줄어든다. */
  bankWithdrawal: number
  bankChange: number
  currentBalance: number
  unconfirmedTransferAmount: number
}

/**
 * 통장 잔액 = 전월 잔액 + 입금확인된 계좌이체 수입 + 입금확인된 현금 통장입금액
 *            + 기타 계좌 입금 - 체크카드 지출 - 계좌이체 지출 ± 기타 통장 조정액
 *            - 통장에서 현금 인출
 * (현금 → 통장 입금은 위 "입금확인된 현금 통장입금액"(cashDeposits)이 이미 담당한다.)
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

  const bankWithdrawal = calcWithdrawalTotal(settlement)

  const bankChange =
    confirmedTransferIncome + confirmedCashDeposit + otherBankIncome - cardExpense - transferExpense + otherAdjustment
    - bankWithdrawal
  const currentBalance = prevBalance + bankChange

  return {
    prevBalance, confirmedTransferIncome, confirmedCashDeposit, otherBankIncome,
    cardExpense, transferExpense, otherAdjustment, bankWithdrawal, bankChange, currentBalance,
    unconfirmedTransferAmount,
  }
}

export interface SettlementHoldingsSummary {
  bankBalance: number
  cashBalance: number
  /** 전체 보유액 = 통장잔액 + 현금잔액. 통장 인출·현금 통장입금은 이 값을 바꾸지 않는다. */
  totalHoldings: number
}

export function calcHoldingsSummary(settlement: RegularSettlement): SettlementHoldingsSummary {
  const bankBalance = calcBankSummary(settlement).currentBalance
  const cashBalance = calcCashSummary(settlement).cashBalance
  return { bankBalance, cashBalance, totalHoldings: bankBalance + cashBalance }
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

/** 참가자의 확정된 찬조 행만(여러 행이면 각각 판정). */
const confirmedDonationsOf = (p: SettlementParticipant) => donationEntriesOf(p).filter(isConfirmedDonation)

/**
 * 확정된 찬조자만 이름 목록으로 (일반 정기모임 감사문구용). 순서는 참가자 등록 순서를 따른다.
 * 한 사람이 찬조를 여러 행으로 냈어도 이름은 한 번만 나온다.
 */
export function confirmedDonorNames(participants: SettlementParticipant[]): string[] {
  return participants
    .filter((p) => confirmedDonationsOf(p).length > 0)
    .map((p) => p.displayName)
}

/**
 * 확정된 찬조자 이름+금액 (정기대회 감사문구용). 한 사람의 여러 찬조 행은 확정된 행만 더해 한 줄로 낸다
 * (예: 현금 100,000 + 계좌이체 입금확인 50,000 → 150,000원). 미확인 계좌이체 행은 기존 규칙대로 빠진다.
 */
export function confirmedDonorAmounts(participants: SettlementParticipant[]): { name: string; amount: number }[] {
  return participants
    .map((p) => ({ name: p.displayName, rows: confirmedDonationsOf(p) }))
    .filter((d) => d.rows.length > 0)
    .map((d) => ({ name: d.name, amount: sum(d.rows.map((r) => r.amount)) }))
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
  const cashSummary = calcCashSummary(settlement)
  // 통장에서 인출해 온 현금도 다시 입금할 수 있다. 인출 기록이 없으면 예전과 똑같이 입금 전 현금 잔액이 한도다.
  const cashBalanceBeforeDeposit = cashSummary.cashBalanceBeforeDeposit + cashSummary.bankWithdrawal
  const otherConfirmed = sum(
    settlement.cashDeposits
      .filter((d) => d.id !== candidate.id && d.status === '입금확인')
      .map((d) => d.amount),
  )
  const candidateConfirmed = candidate.status === '입금확인' ? candidate.amount : 0
  const totalConfirmed = otherConfirmed + candidateConfirmed
  if (totalConfirmed > cashBalanceBeforeDeposit) {
    // 조건은 그대로, 안내 문구만 화면 용어("보유 현금")에 맞춘다 — 현금이 모자라면 음수 잔액 대신 "현금 부족"으로 알린다.
    const error = cashBalanceBeforeDeposit < 0
      ? `현금이 ${(-cashBalanceBeforeDeposit).toLocaleString('ko-KR')}원 부족해서 입금할 수 없습니다. 현금 지출 또는 입금 내역을 확인해 주세요.`
      : `입금 확인 금액 합계(${totalConfirmed.toLocaleString('ko-KR')}원)가 입금할 수 있는 현금(${cashBalanceBeforeDeposit.toLocaleString('ko-KR')}원)보다 많습니다.`
    return { ok: false, error }
  }
  return { ok: true }
}

/**
 * 통장 현금 인출 입력 검증: 금액이 0보다 큰 정수이고 날짜가 있어야 한다.
 * 통장잔액 한도는 두지 않는다 — 전월 통장 잔액을 아직 입력하지 않았을 수 있어 정상 입력이 막힐 수 있다.
 * 대신 통장잔액이 마이너스가 되면 화면에 경고로 보여준다(SettlementSummary·BankCashWithdrawalForm).
 */
export function validateBankCashWithdrawal(candidate: { amount: number; date: string }): ValidationResult {
  if (!Number.isInteger(candidate.amount) || candidate.amount <= 0) {
    return { ok: false, error: '금액은 0원보다 커야 합니다.' }
  }
  if (!candidate.date) return { ok: false, error: '날짜를 입력해주세요.' }
  return { ok: true }
}

// ────────────────────────────────────────────────────────────
// 회비·찬조 입력표 (참가자별 dues/donation을 "이름·구분·금액·결제수단" 행으로 펼쳐서 보여준다)
//
// 참가자 1명의 회비·찬조는 각각 여러 행일 수 있다(duesEntriesOf/donationEntriesOf 기준).
// 표에는 회비 행들 다음에 찬조 행들이 이어진다.
// ────────────────────────────────────────────────────────────

export type IncomeRowCategory = 'dues' | 'donation'
export type IncomeRowMethod = DuesPaymentMethod | DonationPaymentMethod

export interface IncomeTableRow {
  participantId: string
  category: IncomeRowCategory
  /** 이 참가자의 같은 구분 행 목록 안에서의 위치(0부터). 아직 저장된 회비가 없는 기본 빈 행은 0. */
  index: number
  /** 실제로 저장된 행이면 true. 회비가 하나도 없는 참가자에게 보여주는 기본 빈 행은 false. */
  saved: boolean
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
 * 참가자 배열을 표의 행 순서(① 참석자 순서 그대로 → ② 같은 사람의 회비 행들 다음 찬조 행들)로 펼친다.
 * participants 배열 자체의 순서는 절대 바꾸지 않는다(정렬 없음) — 순서 보존은 이 함수가 아니라
 * settlementStore의 참가자 추가 액션들(항상 append)과 Firestore 배열 저장이 이미 보장한다.
 * 회비가 하나도 없는 참가자에게도 기본 빈 회비 행 1개를 만든다(saved=false). 찬조 행은 찬조가 있을 때만 만든다.
 */
export function buildIncomeTableRows(participants: SettlementParticipant[]): IncomeTableRow[] {
  const rows: IncomeTableRow[] = []
  for (const p of participants) {
    const base = { participantId: p.id, displayName: p.displayName }
    const dues = duesEntriesOf(p)
    if (dues.length === 0) {
      rows.push({ ...base, category: 'dues', index: 0, saved: false, amount: undefined, method: undefined, status: undefined })
    }
    dues.forEach((d, index) => rows.push({ ...base, category: 'dues', index, saved: true, amount: d.amount, method: d.method, status: d.status }))
    donationEntriesOf(p).forEach((d, index) =>
      rows.push({ ...base, category: 'donation', index, saved: true, amount: d.amount, method: d.method, status: d.status }))
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
 * - 이름이 기존 참가자와 정확히 같으면 → 그 참가자에 그 구분의 행을 하나 더 붙인다(update-existing).
 *   한 사람이 회비·찬조를 여러 행으로 낼 수 있으므로 이미 값이 있어도 막지 않는다.
 * - 이름이 새로우면 → 새 비회원 참가자를 만든다(create-guest, addGuestParticipant 재사용)
 */
export function planAddTableRow(
  participants: SettlementParticipant[],
  name: string,
  // 구분과 관계없이 판정이 같지만, 호출부 시그니처는 유지한다.
  _category: IncomeRowCategory,
): AddTableRowResult {
  const trimmed = name.trim()
  if (!trimmed) return { action: 'blocked', error: '이름을 입력해주세요.' }
  const existing = participants.find((p) => p.displayName === trimmed)
  if (!existing) return { action: 'create-guest' }
  return { action: 'update-existing', participantId: existing.id }
}

export type DeleteTableRowResult = { action: 'remove-row' } | { action: 'clear-category' } | { action: 'remove-participant' }

/**
 * 표의 행 삭제 버튼을 눌렀을 때 어떤 액션을 할지 판정한다.
 * index를 주면 그 행 하나만 지우는 경우(remove-row), 주지 않으면 그 구분 전체를 비우는 경우(clear-category)다.
 * - 실제 모임 참석자(addedVia === 'meeting_attendee')는 절대 참가자 자체를 지우지 않는다
 *   (기본 참석자 행 삭제 금지 — 회비/찬조 값만 비운다).
 * - 그 외(관리자가 정산에만 추가한 사람)는, 지운 뒤 남는 회비·찬조 행이 하나도 없으면 참가자 자체를 지운다.
 */
export function planDeleteTableRow(participant: SettlementParticipant, category: IncomeRowCategory, index?: number): DeleteTableRowResult {
  const keep: DeleteTableRowResult = index === undefined ? { action: 'clear-category' } : { action: 'remove-row' }
  if (participant.addedVia === 'meeting_attendee') return keep
  const same = category === 'dues' ? duesEntriesOf(participant) : donationEntriesOf(participant)
  const other = category === 'dues' ? donationEntriesOf(participant) : duesEntriesOf(participant)
  const sameLeft = index === undefined ? 0 : same.filter((_, i) => i !== index).length
  return sameLeft > 0 || other.length > 0 ? keep : { action: 'remove-participant' }
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

// 정기모임 회계정산 — 관리자 원본은 clubs/skkubc/settlements/{id},
// 회원 공개용 요약은 clubs/skkubc/settlementPublic/{id}에 분리 저장한다 (기존 clubs/skkubc AppState와는 완전히 별도).
// 이 파일은 타입만 정의하며, Firestore 읽기/쓰기 코드는 포함하지 않는다.

// 주의: 이 상태와 관리자 전용 액션은 지금은 관리자 PIN(브라우저 로컬 값)으로만 UI에서 막고 있다.
// Firebase Authentication이 없어 Firestore 서버 단에서 "관리자만 쓰기 가능"을 강제할 방법이 없으므로,
// 이 상태 필드는 화면 잠금/이력 기록용일 뿐 서버 보안 경계가 아니다 (자세한 근거는 이전 분석 보고서 참고).
export type SettlementStatus = 'draft' | 'confirmed' | 'revised' | 'cancelled'
export type MeetingType = 'regular' | 'tournament'
export type ParticipantType = 'member' | 'guest'
export type AddedVia = 'meeting_attendee' | 'manually_added_member' | 'manually_added_guest'

export type DuesPaymentMethod = '현금' | '계좌이체' | '기타'
export type DuesStatus = '미납' | '미확인' | '입금확인' | '취소'

export type DonationPaymentMethod = '현금' | '계좌이체' | '기타'
export type DonationStatus = '미확인' | '입금확인' | '취소'

export type ExpensePaymentMethod = '현금' | '체크카드' | '계좌이체' | '기타'

export type DinnerContributionType = '모임회계지출' | '일부찬조' | '전액찬조'

export type CashDepositStatus = '입금전' | '입금예정' | '입금확인' | '취소'

export interface DuesPayment {
  amount: number
  method: DuesPaymentMethod
  status: DuesStatus
  paidAt?: string
  note?: string
}

export interface DonationPayment {
  amount: number
  method: DonationPaymentMethod
  status: DonationStatus
  paidAt?: string
  note?: string
}

/** 정산 대상자(참가 회원 또는 비회원) 1명. 회비·찬조는 별개 거래로 각각 선택 입력한다. */
export interface SettlementParticipant {
  id: string
  participantType: ParticipantType
  /** 비회원(guest)이면 null. */
  memberId: string | null
  displayName: string
  addedVia: AddedVia
  dues?: DuesPayment
  donation?: DonationPayment
}

/** 지출 1건. clubShare(모임 회계 부담액)만 모임 지출 집계에 들어가고, personalDonation은 개인이 낸 부분이다. */
export interface SettlementExpense {
  id: string
  date: string
  label: string
  category: string
  amount: number
  method: ExpensePaymentMethod
  paidBy?: string
  clubShare: number
  personalDonation: number
  note?: string
}

/** 선택형 호칭 프리셋 (이미 '님'을 포함한 형태로 저장). '직접 입력'을 고르면 자유 텍스트를 그대로 저장한다. */
export type DinnerContributorTitlePreset = '회원님' | '회장님' | '총무님' | '고문님' | '선배님'

export interface DinnerContributor {
  name: string
  memberId: string | null
  amount: number
  /**
   * 감사 문구용 호칭. 이미 '님'을 포함한 값을 저장한다(예: '회장님').
   * 기존 Member 타입에는 직책이 없으므로 여기서 자동 판별하지 않고, 이 정산에서만 수동 선택/입력한다.
   * 지정 없으면 기본값 '회원님'.
   */
  title?: string
}

/**
 * 회식비 차수별(1차/2차/3차 등) 기록. 회식비는 여기에만 입력하고 SettlementExpense에는
 * 절대 별도로 추가하지 않는다(이중 입력 방지 — store의 addExpense가 category='회식비'를 거부한다).
 * clubShare(모임 회계 부담액)는 method(결제수단) 기준으로 지출 집계에 합산된다.
 */
export interface DinnerContribution {
  id: string
  dinnerRound: number
  totalAmount: number
  method: ExpensePaymentMethod
  paidBy?: string
  clubShare: number
  contributionType: DinnerContributionType
  contributors: DinnerContributor[]
  note?: string
}

export interface CashDeposit {
  id: string
  depositDate: string
  amount: number
  status: CashDepositStatus
  note?: string
}

export interface RevisionEntry {
  fromStatus: SettlementStatus
  toStatus: SettlementStatus
  changedAt: string
  /** 향후 Firebase Authentication 도입 시 실제 UID로 채운다. 지금은 PIN 기반 UI 통제뿐이라 비어있을 수 있다. */
  changedByUid?: string
  /** 처리자 표시명(로그인 이름). UID가 없어도 "누가 눌렀는지"는 기록하기 위해 별도로 둔다. */
  actorDisplayName: string
  reason?: string
}

/** 관리자 전용 원본. clubs/skkubc/settlements/{id}에 저장 (일반 회원에게 노출 금지). */
export interface RegularSettlement {
  id: string
  sessionId?: string
  meetingName: string
  meetingRound?: number
  meetingDate: string
  meetingType: MeetingType
  status: SettlementStatus

  participants: SettlementParticipant[]
  expenses: SettlementExpense[]
  dinnerContributions: DinnerContribution[]
  cashDeposits: CashDeposit[]

  prevBankBalance: number
  otherBankAdjustment: number
  adminNote?: string

  // Firebase Authentication 도입 전까지는 비어있을 수 있다 (optional).
  createdByUid?: string
  createdAt: string
  updatedByUid?: string
  updatedAt?: string
  confirmedByUid?: string
  confirmedAt?: string
  cancelledByUid?: string
  cancelledAt?: string
  version: number
  revisionLog: RevisionEntry[]
}

/**
 * 회원 공개용 확정 요약. clubs/skkubc/settlementPublic/{id}에 저장.
 * 통장 잔액·현금 보유액·회원별 납부액·미확인 계좌이체·관리자 메모·변경 이력은
 * 절대 포함하지 않는다 (RegularSettlement에서 원본을 읽어 이 형태로만 재생성해서 내보낸다).
 */
export interface SettlementPublicSummary {
  id: string
  meetingName: string
  meetingDate: string
  meetingType: MeetingType
  totalIncome: number
  totalExpense: number
  netProfit: number
  majorExpenses: { label: string; amount: number }[]
  /** 일반 정기모임: 이름만. */
  donorNames: string[]
  /** 정기대회: 이름 + 금액 (입금확인된 찬조만). 일반 모임이면 비워둔다. */
  donorAmounts?: { name: string; amount: number }[]
  thankYouMessages: string[]
  confirmedAt: string
  version: number
  /** 회비 합계(입금확인된 현금+계좌이체+기타). 개인별 납부액은 포함하지 않는다. */
  duesTotal: number
  /** 찬조 합계(입금확인된 현금+계좌이체+기타). */
  donationTotal: number
  /** 회비+찬조 중 현금으로 받은 합계. */
  cashIncomeTotal: number
  /** 회비+찬조 중 계좌이체(입금확인)로 받은 합계. */
  transferIncomeTotal: number
  /** 지출 분류(당구비/다과비/회식비/상금/기타)별 모임 부담액 합계. 0원인 분류는 제외한다. */
  expenseByCategory: { category: string; amount: number }[]
  /** 회식비 차수 수와 모임 부담 합계(개인 찬조분 제외) — 통장·현금 잔액 등 민감 정보는 포함하지 않는다. */
  dinnerSummary: { roundCount: number; clubShareTotal: number }
}

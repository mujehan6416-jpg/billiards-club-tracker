export interface HandicapChange {
  value: number
  changedAt: string // ISO datetime
}

export interface Member {
  id: string
  name: string
  handicap: number // 현재 핸디(=목표 개수)
  handicapHistory: HandicapChange[]
  active: boolean
  password?: string // 미설정시 기본값 '0000'
}

export type GameEndType = 'cleared' | 'time'

export interface Game {
  id: string
  playerAId: string
  playerBId: string
  handicapA: number // 경기 시점 스냅샷 (과거 임포트 데이터는 0 = 미상)
  handicapB: number
  scoreA: number // 실제 친 개수
  scoreB: number
  endType: GameEndType
  playedAt: string // ISO datetime
  round?: number // 정기모임 라운드(1=1부, 2=2부). 과거 임포트 데이터는 없음
  /**
   * 명시적으로 기록된 승자(과거 CSV 임포트·수기 확정용).
   * undefined이면 달성률(rate)로 자동 계산, null이면 무승부로 확정.
   */
  winnerId?: string | null
  /** 일반회원이 제출한 경기결과 — 관리자 승인 대기 중 (번개모임 결과, 정기모임 참가자 본인 입력 결과 모두 이 필드를 쓴다) */
  pending?: boolean
  /**
   * 관리자가 "수정 요청"을 눌러 참가자가 결과를 다시 입력해야 하는 상태. pending은 계속 true로 남는다
   * (관리자 확인 대기 상태 자체는 안 바뀌고, 어떤 pending인지만 구분). 참가자가 재제출하면 false로 돌아간다.
   * 이 필드가 없던 기존 데이터는 false와 동일하게 취급한다(항상 옵셔널, 하위호환).
   */
  revisionRequested?: boolean
}

/** 게시된 대진표의 한 경기(라운드별). */
export interface LineupMatch {
  round: number // 1 = 1부, 2 = 2부
  aId: string
  bId: string
  handicapA: number
  handicapB: number
}

export interface Session {
  id: string
  date: string // YYYY-MM-DD
  type?: 'regular' | 'flash'  // 미지정 = regular
  approved?: boolean           // 번개모임: 관리자 승인 여부
  attendeeIds: string[]
  lineup?: LineupMatch[]       // 게시된 대진표 (일반회원 열람용)
  sitOutIds?: string[]         // 대진표상 대기자 (과거 버전 호환용 — round1ParticipantIds가 없으면 이 값으로 유추)
  /**
   * 라운드별 "이번 라운드 경기 참가" 명단(관리자가 직접 선택). 미지정이면 attendeeIds 전체를
   * 기본값으로 쓴다(기존 세션과 100% 호환). 참가자에 없는 attendeeIds 인원은 그 라운드의
   * 미대진자(대기)로 취급한다 — 별도의 sitOut 배열을 두지 않고 참가자 명단 하나로 표현한다.
   */
  round1ParticipantIds?: string[]
  /**
   * 2라운드 참가자 명단. round1ParticipantIds와 달리 attendeeIds가 나중에 늘어나도(1라운드 이후
   * 늦게 온 참석자) 자동으로 반영되지 않는다 — 관리자가 이 목록에 명시적으로 추가해야
   * 2라운드에 참가할 수 있다. 마찬가지로 중도 귀가자는 이 목록에서만 빼면 1라운드 결과는 그대로 남는다.
   */
  round2ParticipantIds?: string[]
  games: Game[]
}

export interface LedgerRecord {
  id: string
  date: string
  note?: string
  // 수입
  inCashMembership: number      // 현금 회비
  inCashDonation: number        // 현금 찬조금
  inTransferMembership: number  // 계좌이체 회비
  inTransferDonation: number    // 계좌이체 찬조금
  inCardDonation: number        // 카드 찬조
  inAnnualFee: number           // 이달 연회비
  // 지출
  outCash: number               // 현금 지출
  outCard: number               // 체크카드 지출
  outTransfer: number           // 계좌이체 지출
}

export interface AppState {
  members: Member[]
  sessions: Session[]
  settings: { lastBackupAt: string | null }
  ledger: LedgerRecord[]
}

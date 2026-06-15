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
  sitOutIds?: string[]         // 대진표상 대기자
  games: Game[]
}

export interface AppState {
  members: Member[]
  sessions: Session[]
  settings: { lastBackupAt: string | null }
}

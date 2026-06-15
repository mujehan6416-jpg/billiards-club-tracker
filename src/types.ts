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
  /**
   * 명시적으로 기록된 승자(과거 CSV 임포트·수기 확정용).
   * undefined이면 달성률(rate)로 자동 계산, null이면 무승부로 확정.
   */
  winnerId?: string | null
}

export interface Session {
  id: string
  date: string // YYYY-MM-DD
  type?: 'regular' | 'flash'  // 미지정 = regular
  approved?: boolean           // 번개모임: 관리자 승인 여부
  attendeeIds: string[]
  games: Game[]
}

export interface AppState {
  members: Member[]
  sessions: Session[]
  settings: { lastBackupAt: string | null }
}

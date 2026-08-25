import type { Game, HandicapChange, LedgerRecord, Session } from '../types'

// 분리된 Firestore 구조 (보안 강화 3단계).
//
// 지금은 AppState 전체가 clubs/{clubId} 문서 하나에 JSON 문자열로 들어 있어서, Firestore 규칙이
// "회원은 읽기만, 관리자는 수정" 같은 구분을 할 수 없다(문서 단위 권한 + 문자열 안은 규칙이 못 봄).
// 그래서 권한을 나눌 수 있는 최소 단위로 문서를 쪼갠다.
//
//   clubs/{clubId}/config/main                     모임 설정 (민감하지 않음)
//   clubs/{clubId}/members/{memberId}              회원 공개정보 (연결회원 읽기)
//   clubs/{clubId}/memberPrivate/{memberId}        회원 관리자 전용 (지금은 자리만 확보)
//   clubs/{clubId}/sessions/{sessionId}            모임 1건 (games 제외)
//   clubs/{clubId}/sessions/{sessionId}/games/{gameId}   경기 1건
//   clubs/{clubId}/ledger/{recordId}               회계 1건 (관리자 전용)
//
// 이번 단계에서는 타입과 변환 함수까지만 만들고, 실제 운영 데이터를 이 경로로 옮기지 않는다.

/** clubs/{clubId}/config/main — 모임 전체 설정. 회원·경기·회계 데이터를 넣지 않는다. */
export interface ClubConfig {
  lastBackupAt: string | null
}

/**
 * clubs/{clubId}/members/{memberId} — 일반회원에게 공개해도 되는 최소 정보.
 *
 * Member에서 password를 **의도적으로 제외**한다. 비밀번호는 새 구조로 옮기지 않는 것이 목표이고,
 * 기존 로그인이 아직 필요해서 legacy AppState에만 남겨 둔다(이번 단계에서 삭제하지 않는다).
 */
export interface PublicMember {
  id: string
  name: string
  handicap: number
  handicapHistory: HandicapChange[]
  active: boolean
  displayTag?: string
}

/**
 * clubs/{clubId}/memberPrivate/{memberId} — 관리자 전용 회원정보 자리.
 *
 * 지금은 실제 개인정보를 넣지 않는다. 향후 학번·학과·연락처·관리자 메모가 추가되더라도
 * 일반회원에게 통째로 내려가지 않도록 처음부터 문서를 분리해 둔다.
 */
export interface MemberPrivate {
  memberId: string
}

/** clubs/{clubId}/sessions/{sessionId} — 경기 배열을 뺀 모임 정보. */
export type SessionDoc = Omit<Session, 'games'>

/** clubs/{clubId}/sessions/{sessionId}/games/{gameId} — 경기 1건과 그 경기가 속한 세션. */
export interface SplitGame {
  sessionId: string
  game: Game
}

/** splitLegacyAppState()의 결과 — 아직 Firestore에 쓰지 않은 "이렇게 나뉜다"는 계획. */
export interface SplitFirestoreData {
  config: ClubConfig
  members: PublicMember[]
  memberPrivate: MemberPrivate[]
  sessions: SessionDoc[]
  games: SplitGame[]
  ledger: LedgerRecord[]
}

/** 변환이 데이터를 잃지 않았는지 확인한 결과. */
export interface SplitValidation {
  ok: boolean
  counts: {
    members: { legacy: number; split: number }
    sessions: { legacy: number; split: number }
    games: { legacy: number; split: number }
    ledger: { legacy: number; split: number }
  }
  /** 사람이 읽을 수 있는 문제 목록. 비어 있으면 이상 없음. */
  issues: string[]
}

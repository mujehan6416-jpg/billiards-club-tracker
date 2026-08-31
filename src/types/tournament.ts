// 대회 토너먼트 (단식 · 단일 탈락) 타입.
//
// 기존 일반 모임 경기(types.ts의 Session/Game)와 **완전히 분리된 독립 도메인**이다.
// 이 파일은 types.ts를 수정하지 않고, AppState에도 들어가지 않는다 — 그래서 기존 통계
// (logic/stats.ts)는 토너먼트 경기를 볼 수 없다(설계상 의도).
//
// 향후 Firestore 저장 경로 후보(이번 단계에서는 만들지 않는다):
//   clubs/{clubId}/tournaments/{tournamentId}
//   clubs/{clubId}/tournaments/{tournamentId}/participants/{participantId}
//   clubs/{clubId}/tournaments/{tournamentId}/matches/{matchId}
//   clubs/{clubId}/tournaments/{tournamentId}/private/draw        ← 관리자 전용
//
// 마지막 경로가 따로 있는 이유: Firestore는 문서를 통째로 내려주고 규칙에 필드 단위 읽기
// 제어가 없다. 추첨번호↔실제 슬롯 매핑과 부전승 위치가 회원이 읽을 수 있는 문서에 들어가면
// 그대로 노출된다. 그래서 아래 TournamentDrawMapping은 Tournament와 **별개 타입**으로 두고,
// 어느 공개 타입에도 포함시키지 않는다.

/** 대회 진행 단계. 회원 화면에 이 값을 그대로 보여주기 위한 것이 아니라 내부 진행 제어용이다. */
export type TournamentStatus =
  | 'draft' // 대회 생성됨, 참가 신청 받는 중
  | 'entryClosed' // 관리자가 최종 참가자를 확정함, 대진 생성 전
  | 'drawReady' // 빈 대진·부전승 위치·비공개 매핑까지 만들어짐 (현장 번호 추첨 전)
  | 'bracketFixed' // 관리자가 대진을 확정·공개함
  | 'finished' // 대회 종료
  | 'cancelled'

/**
 * 회원의 참가 응답 상태.
 * 'noResponse'가 기본값이다 — "불참"과 "아직 답하지 않음"은 반드시 구분해야 관리자가
 * 누구에게 다시 물어봐야 하는지 알 수 있다.
 * 'excluded'는 관리자가 신청자를 임의로 제외한 상태로, 회원이 스스로 만들 수 없다.
 */
export type TournamentEntryStatus = 'noResponse' | 'entered' | 'declined' | 'excluded'

/** 경기 한 건이 다음 경기의 어느 자리로 연결되는지. */
export type TournamentMatchSlot = 'playerA' | 'playerB'

/**
 * 경기 결과의 종류.
 *   normal  — 실제로 친 경기(점수 있음)
 *   bye     — 부전승. 경기가 아니므로 점수·달성률이 없고 경기수·승수에도 넣지 않는다.
 *   forfeit — 기권승. 상대가 기권해 이긴 경기로, 가짜 점수를 만들지 않는다.
 */
export type TournamentResultType = 'normal' | 'bye' | 'forfeit'

/**
 * 경기 내부 진행 상태. 화면에는 이 문자열을 그대로 노출하지 않는다
 * (기존 앱도 pending·revisionRequested 플래그를 두고 화면에는 "승인대기" 같은 쉬운 말만 쓴다).
 *
 * 수정 요청은 별도 상태를 만들지 않고 TournamentMatchResultLog.correctionRequested 플래그로
 * 표현한다 — 기존 Game의 pending + revisionRequested 조합과 같은 방식이라 상태 수가 늘지 않는다.
 */
export type TournamentMatchStatus =
  | 'awaitingResult' // 아직 아무도 점수를 넣지 않음
  | 'awaitingVerification' // 참가자 1명이 입력함, 상대 확인 대기
  | 'awaitingApproval' // 확인까지 끝남, 관리자 최종 승인 대기
  | 'official' // 관리자 최종 승인 완료 (여기서만 공식 승자·다음 라운드 진출이 생긴다)

/** 결과 확인을 누가 했는지 — 회원 확인과 관리자 직권 확인을 데이터상 반드시 구분한다. */
export type TournamentVerificationType = 'player' | 'adminOverride'

/** clubs/{clubId}/tournaments/{tournamentId} — 대회 1건. */
export interface Tournament {
  id: string
  name: string
  date: string // YYYY-MM-DD
  /** 경기 제한시간(분). MVP에서는 모든 라운드가 같은 값을 쓴다. */
  timeLimitMinutes: number
  status: TournamentStatus
  /** 관리자가 확정한 최종 참가 인원. 추첨번호의 허용 범위(1..이 값)가 여기서 나온다. */
  participantCount?: number
  /** 대진 규모(2의 거듭제곱). 대진을 만들기 전에는 없다. */
  bracketSize?: number
  createdAt: string // ISO datetime
  createdByAdminUid?: string
  /** 관리자가 대진을 확정·공개한 시각. 대진 확정 취소를 하면 다시 비운다. */
  drawConfirmedAt?: string
  /** 결승이 공식 확정되어 대회를 마감한 시각. */
  completedAt?: string
  championParticipantId?: string | null
  runnerUpParticipantId?: string | null
}

/**
 * clubs/{clubId}/tournaments/{tournamentId}/participants/{participantId} — 참가자 1명.
 *
 * 회원 원본(clubs/{clubId}/members/{memberId})을 참조만 하지 않고 이름·핸디를 복사해 둔다.
 * 관리자가 회원을 수정·삭제하면 서버 문서까지 지워지므로(lib/splitFirestore.ts의
 * syncSplitChanges), 복사해 두지 않으면 과거 대회 기록이 "알수없음"이 된다.
 */
export interface TournamentParticipant {
  id: string
  memberId: string
  /** 참가 확정 시점의 회원 이름. 회원이 개명·삭제돼도 이 값은 바뀌지 않는다. */
  displayNameSnapshot: string
  /** 참가 확정 시점의 회원 기본 핸디(Member.handicap). "얼마를 조정했는지"의 근거가 된다. */
  baseHandicapSnapshot: number
  /** 이 대회에서 실제로 적용할 핸디. 기본값은 baseHandicapSnapshot이고 관리자가 대회 시작 전에 조정한다. */
  tournamentHandicap: number
  entryStatus: TournamentEntryStatus
  /**
   * 관리자가 신청자를 제외했을 때 누가·언제 했는지. 참가자 문서를 지우지 않고 상태만
   * 'excluded'로 두는 이유는, 나중에 "왜 빠졌는지"를 확인할 수 있어야 하기 때문이다.
   */
  excludedByAdminUid?: string
  excludedAt?: string
  /** 현장 오프라인 추첨에서 받은 번호(1..참가자수). 관리자가 입력하기 전에는 없다. */
  drawNumber?: number
  /** 중도 기권·철회 여부. */
  withdrawn?: boolean
  /** 최종 순위(1=우승, 2=준우승, 3=공동 3위). 대회가 끝난 뒤에만 채운다. */
  finalPlacement?: number
}

/**
 * clubs/{clubId}/tournaments/{tournamentId}/matches/{matchId} — 경기 1건.
 *
 * 선수를 participantId와 memberId 둘 다로 들고 있다. 중복처럼 보이지만 목적이 다르다:
 *   participantId — 대진 배치·순위 계산의 기준(이 대회 안에서의 신원)
 *   memberId      — Firestore 규칙이 **이 문서 하나만 보고** "이 사람이 참가자 본인인가",
 *                   "입력자와 확인자가 다른 사람인가"를 판정하려면 반드시 문서 안에 있어야 한다
 *                   (기존 firestore.rules의 isGameParticipant()가 같은 이유로 Game에
 *                   playerAId/playerBId를 요구한다).
 *
 * 선수 이름은 **일부러 담지 않는다**. 기존 Game도 이름을 저장하지 않고 회원 목록에서 찾아 쓰고,
 * 과거 기록 보존이라는 목적은 TournamentParticipant.displayNameSnapshot 하나로 이미 충족된다
 * (참가자 문서는 대회 하위 컬렉션이라 회원이 삭제돼도 남는다). 두 곳에 같은 이름을 두면
 * 관리자가 오타를 고칠 때 한쪽만 바뀌어 서로 어긋난다.
 */
export interface TournamentMatch {
  id: string
  /** 1 = 첫 라운드. */
  roundNumber: number
  /**
   * 이 라운드에 남아 있는 선수 수(16 = 16강, 4 = 4강, 2 = 결승).
   * "16강" 같은 화면 문구를 도메인에 박지 않고 숫자만 두어, 표기는 화면이 정하게 한다.
   */
  playerCountInRound: number
  /** 같은 라운드 안에서의 경기 순번(1부터). */
  matchNumber: number

  playerAParticipantId: string | null
  playerBParticipantId: string | null
  playerAMemberId: string | null
  playerBMemberId: string | null

  /**
   * 경기 시점의 적용 핸디 스냅샷. 참가자의 tournamentHandicap이 나중에 바뀌어도
   * 이미 만들어진 이 경기의 계산 결과는 달라지지 않는다(기존 Game.handicapA/B와 같은 사상).
   */
  playerAHandicapSnapshot: number | null
  playerBHandicapSnapshot: number | null

  /** 실제로 친 개수. 부전승·기권에는 가짜 점수를 넣지 않으므로 null로 남는다. */
  scoreA: number | null
  scoreB: number | null

  resultType: TournamentResultType
  status: TournamentMatchStatus

  /**
   * 점수와 적용 핸디로 자동 계산된 승자(participantId). 달성률이 완전히 같으면 null이다.
   * 이 값은 "계산 결과"일 뿐이고, 공식 기록이 아니다.
   */
  calculatedWinnerParticipantId?: string | null

  /**
   * 관리자 최종 승인으로 확정된 공식 승자·패자. 승인 전에는 **절대 채우지 않는다** —
   * 이 필드가 있어야만 다음 라운드 진출이 생긴다.
   */
  officialWinnerParticipantId?: string | null
  officialLoserParticipantId?: string | null

  /** 누가 입력·확인·수정·승인했는지 기록. */
  resultLog?: TournamentMatchResultLog

  /**
   * 관리자가 현장에서 두 선수 대신 점수를 직접 입력했을 때. **일부러 resultLog가 아니라
   * 최상위 필드로 둔다** — resultLog는 회원 쓰기 Rules(memberLogKeysOnly)가 필드 목록을
   * 엄격히 제한하는 자리라서, 여기에 관리자 전용 필드를 넣으면 그 뒤 회원이 "상대 확인"을
   * 누를 때 resultLog를 그대로 이어 쓰다가(nowLog) 화이트리스트에 없는 필드가 섞여 들어가
   * Rules가 그 확인 자체를 거부하게 된다. 최상위 필드로 두면 회원 쓰기(changedKeys가
   * ['status','resultLog']만 바꿈)에 전혀 영향을 주지 않아 Rules를 손대지 않아도 된다.
   */
  enteredByAdminUid?: string
  enteredAt?: string

  /** 이 경기 승자가 갈 다음 경기. 결승이면 둘 다 null. */
  nextMatchId: string | null
  nextSlot: TournamentMatchSlot | null
}

/**
 * 결과 입력 → 확인 → (필요 시 수정) → 관리자 최종 승인 과정의 기록.
 *
 * 회원은 memberId로, 관리자는 Firebase UID로 기록한다 — 이 프로젝트가 이미 지키는 원칙이다
 * (types.ts의 byAdminId, lib/memberLink.ts의 approvedBy, types/settlement.ts의 changedByUid).
 * 기기 localStorage의 관리자 PIN은 서버가 신뢰할 수 없는 값이라 실행자 기록에 쓰지 않는다.
 */
export interface TournamentMatchResultLog {
  /** 점수를 입력한 참가자의 memberId. */
  submittedByMemberId?: string
  submittedAt?: string

  verificationType?: TournamentVerificationType
  /** verificationType === 'player'일 때만 채운다. */
  verifiedByMemberId?: string
  /** verificationType === 'adminOverride'일 때만 채운다(관리자 직권 확인). */
  verifiedByAdminUid?: string
  verifiedAt?: string

  /** 상대 참가자가 "수정 요청"을 눌렀는지. 회원이 직접 점수를 고치지는 못한다. */
  correctionRequested?: boolean
  correctionRequestedByMemberId?: string
  correctionRequestedAt?: string

  /** 수정 요청을 받아 관리자가 점수를 고쳤을 때. */
  correctedByAdminUid?: string
  correctedAt?: string

  approvedByAdminUid?: string
  approvedAt?: string
}

/**
 * clubs/{clubId}/tournaments/{tournamentId}/private/draw — **관리자 전용**.
 *
 * ⚠ 이 타입은 어떤 공개 타입에도 포함시키지 않는다. 회원이 읽을 수 있는 문서에 들어가는 순간
 * "몇 번이 부전승 자리인지"가 노출되어, 현장에서 번호를 뽑기도 전에 결과를 알 수 있게 된다.
 *
 * 숨겨야 하는 것은 부전승 "개수"가 아니다(참가 인원만 알면 누구나 계산한다).
 * 숨겨야 하는 것은 "어느 추첨번호가 어느 실제 슬롯·부전승 위치로 연결되는가"이다.
 */
export interface TournamentDrawMapping {
  bracketSize: number
  /** 추첨번호(1..참가자수) → 실제 대진 슬롯 번호(1..bracketSize). */
  numberToSlot: Record<number, number>
  /** 참가자가 배치되지 않고 비워 두는 부전승 자리(슬롯 번호). */
  byeSlots: number[]
}

/**
 * 현장에서 뽑은 번호를 관리자가 입력하는 형태.
 * 참가자 한 명당 정확히 하나이며, 검증을 통과하기 전에는 어디에도 반영하지 않는다.
 */
export interface TournamentDrawEntry {
  participantId: string
  drawNumber: number
}

/** 추첨번호를 실제 슬롯으로 바꾼 결과 — 대진 생성에 그대로 넣을 수 있는 좌석 배정. */
export interface TournamentSeat {
  participantId: string
  memberId: string
  /**
   * 배치 시점의 대회 적용 핸디. 이 값이 경기의 핸디 스냅샷이 된다 —
   * 이후 참가자의 tournamentHandicap이 바뀌어도 만들어진 경기는 영향을 받지 않는다.
   */
  handicap: number
  /** 1..bracketSize */
  slotNumber: number
}

/** 참가자가 아직 배치되지 않은 빈 대진 구조 한 칸. */
export interface TournamentBracketNode {
  id: string
  roundNumber: number
  playerCountInRound: number
  matchNumber: number
  /** 1라운드에만 있다 — 2라운드부터는 이전 경기 승자가 채운다. */
  slotA: number | null
  slotB: number | null
  nextMatchId: string | null
  nextSlot: TournamentMatchSlot | null
}

/** 승인된 경기의 승자를 다음 경기 어느 자리에 넣어야 하는지. */
export interface TournamentPromotion {
  nextMatchId: string
  nextSlot: TournamentMatchSlot
  participantId: string
  memberId: string
  handicap: number
}

/**
 * 순수 함수의 성공/실패 표현. 기존 logic/game.ts의 GameResultValidation과 같은 모양을 쓴다 —
 * 실패 메시지는 그대로 화면에 보여줄 수 있는 쉬운 한국어 문장이다.
 */
export type TournamentResult<T> = { ok: true; value: T } | { ok: false; message: string }

/** 한 참가자의 대회 내 전적. 부전승은 경기수·승수에 넣지 않는다. */
export interface TournamentRecord {
  played: number
  wins: number
  losses: number
}

/**
 * 대회 최종 순위. 계산 결과 타입일 뿐 Firestore에 저장되는 필드가 아니므로, 여기 필드를
 * 늘려도 문서 스키마에는 영향이 없다.
 *
 * 기본(3·4위전 없음): 준결승 공식 패자 2명이 공동 3위 — thirdPlaceParticipantIds에 둘 다 들어가고
 * fourthPlaceParticipantId는 없다(undefined).
 *
 * 3·4위전이 있는 대회: thirdPlaceParticipantIds에는 그 경기의 승자 1명만 들어가고,
 * fourthPlaceParticipantId에 패자가 채워진다. 3·4위전 여부는 TournamentMatch.playerCountInRound
 * === 3(일반 대진에서는 나오지 않는 값 — roundLabel()의 "정의되지 않은 규모" 관례와 같은 방식)로
 * 표시한다 — 새 필드를 추가하지 않고 기존 숫자 필드의 값 하나만 예약해서 쓴다.
 */
export interface TournamentFinalPlacements {
  championParticipantId: string | null
  runnerUpParticipantId: string | null
  /**
   * 3·4위전이 없으면 준결승 공식 패자 2명(공동 3위), 있으면 그 경기의 승자 1명만 들어간다.
   * 대진 규모가 2면 준결승이 없어 빈 배열이다.
   */
  thirdPlaceParticipantIds: string[]
  /** 3·4위전이 있고 공식 확정됐을 때만 채워진다. 없으면 undefined(기존 공동 3위 동작 유지). */
  fourthPlaceParticipantId?: string | null
}

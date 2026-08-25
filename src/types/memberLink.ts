// 회원-기기 연결 구조 (보안 강화 2단계).
//
// 기존 AppState(clubs/skkubc 단일 문서)와 완전히 분리된 별도 경로에 저장한다 —
// 이번 단계에서는 기존 데이터·로그인 방식을 전혀 건드리지 않는 부가 기능이다.
//
//   clubs/{clubId}/linkRequests/{firebaseUid}  회원이 만드는 연결 요청
//   clubs/{clubId}/memberLinks/{firebaseUid}   관리자가 승인해 만드는 연결 기록
//
// 문서 ID를 Firebase UID로 두면 Firestore 규칙이 get() 한 번으로
// "이 기기가 어느 회원인지 + 역할이 무엇인지"를 판정할 수 있다.

export type MemberLinkRole = 'member' | 'admin'

/** 관리자가 승인해 만들어지는 연결 기록. 회원 한 명이 여러 기기(UID)를 가질 수 있다. */
export interface MemberLink {
  /** 이 기기가 어느 회원인지 (AppState의 Member.id). */
  memberId: string
  /**
   * 역할. 일반 기기 연결 승인은 항상 'member'로만 만든다 —
   * 'admin'은 별도 관리자 작업으로만 부여한다(요청자가 지정할 수 없다).
   */
  role: MemberLinkRole
  active: boolean
  linkedAt: string // ISO datetime
  /** 관리자가 기기를 구분하려고 붙이는 메모(예: '안방 폰'). */
  deviceLabel?: string
  /**
   * 승인한 관리자의 Firebase UID. 신뢰할 수 있는 관리자 신원(Firebase Authentication)이
   * 확인된 경우에만 기록한다 — 기기 localStorage의 PIN 값을 관리자 ID처럼 저장하지 않는다.
   */
  approvedBy?: string
}

/**
 * 회원이 자기 기기에서 만드는 연결 요청.
 * 일반 사용자가 쓸 수 있는 값은 아래 두 개뿐이다 — role·active·승인정보는 요청자가 정할 수 없고,
 * Firestore 규칙에서도 이 두 필드만 허용한다.
 */
export interface LinkRequest {
  memberId: string
  requestedAt: string // ISO datetime
}

/** 관리자 화면에서 쓰는, 문서 ID(Firebase UID)를 함께 들고 다니는 형태. */
export interface LinkRequestEntry {
  firebaseUid: string
  request: LinkRequest
}

export interface MemberLinkEntry {
  firebaseUid: string
  link: MemberLink
}

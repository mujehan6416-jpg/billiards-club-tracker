/**
 * 홈 공지 게시판 전용 타입.
 *
 * 기존 AppState(회원·모임·경기·회계)와 완전히 분리된 새 Firestore 경로만 사용한다 —
 * 이 파일의 타입이 기존 데이터 구조를 바꾸거나 기존 문서에 필드를 더하지 않는다.
 *
 * 공지를 쓰고 고치고 지우는 일은 관리자만 한다. 회원이 글을 올리고 관리자가 승인하는
 * 기능은 이번 범위에서 뺐다(추후 작업). 그래서 "승인 대기" 같은 상태가 없다.
 */

/**
 * 공개 상태. 지금은 관리자가 올린 공개 글만 존재하므로 값이 하나뿐이다.
 *
 * 값이 하나여도 필드를 남겨 두는 이유가 있다. Firestore 규칙이 "회원은 status가
 * 'published'인 글만 읽을 수 있다"로 막고 있어서, 어떤 이유로든 이 값이 아닌 문서가
 * 생기면 회원 화면에 절대 나타나지 않는다(안전장치). 나중에 승인 기능을 붙일 때도
 * 이 자리를 그대로 쓰면 된다.
 */
export type NoticeStatus = 'published'

/**
 * clubs/{clubId}/notices/{noticeId}
 *
 * 작성자 표시는 두 필드로 나눠 둔다.
 * - authorMemberId: 이 기기의 회원 연결(memberLinks)로 확인된 회원 ID. 확인할 수 없는
 *   관리자 기기면 null이다. 확인되지 않은 신원에 아무 회원 ID나 붙이지 않는다.
 * - authorName: 화면에 보일 이름. 회원으로 확인되면 그 회원의 실명이고, 확인할 수 없으면
 *   '관리자'라는 역할 표기다. 확인되지 않은 사람에게 임의의 실명을 지어 붙이지 않는다.
 *
 * 화면에는 authorMemberId로 찾은 "현재" 회원 이름을 먼저 쓴다(이름이 바뀌면 바뀐 이름이
 * 보인다). 못 찾을 때만 저장된 authorName을 쓴다.
 */
export interface Notice {
  id: string
  title: string
  body: string
  /** 맨 위 고정 여부. 관리자만 바꿀 수 있다. */
  pinned: boolean
  status: NoticeStatus
  /** 회원 연결로 확인된 작성자 회원 ID. 확인할 수 없으면 null. */
  authorMemberId: string | null
  /** 화면에 보일 작성자 이름(실명 또는 '관리자'). */
  authorName: string
  /** ISO datetime */
  createdAt: string
}

/**
 * clubs/{clubId}/noticeReads/{memberId} — 회원별 "읽은 글" 기록.
 *
 * 기기(Firebase uid)가 아니라 회원(memberId) 단위라, 같은 회원이 폰을 바꾸거나 기기를
 * 하나 더 연결해도 읽음 상태가 이어진다. 본인 문서만 읽고 쓸 수 있다(규칙에서 강제).
 */
export interface NoticeRead {
  memberId: string
  readNoticeIds: string[]
}

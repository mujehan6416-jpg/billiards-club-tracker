import {
  collection, deleteDoc, doc, getDoc, getDocs, orderBy, query, setDoc, updateDoc, where,
} from 'firebase/firestore'
import { db } from './firebase'
import type { Notice, NoticeRead } from '../types/notice'

/**
 * 홈 공지 게시판 전용 Firestore 접근.
 *
 * 새 경로 두 개만 쓴다. 기존 members·sessions·games·ledger·config 문서는 이 파일에서
 * 읽지도 쓰지도 않는다(기존 데이터 이동·일괄 변경 없음).
 *
 *   clubs/{clubId}/notices/{noticeId}
 *   clubs/{clubId}/noticeReads/{memberId}
 *
 * 공지를 쓰고 고치고 지우는 일은 관리자만 한다. 화면에서 버튼을 숨기는 것과 별개로,
 * 실제 권한은 firestore.rules가 서버에서 막는다.
 */

export const DEFAULT_CLUB_ID = 'skkubc'

const noticesCol = (clubId: string) => collection(db, 'clubs', clubId, 'notices')
const noticeDoc = (clubId: string, noticeId: string) => doc(db, 'clubs', clubId, 'notices', noticeId)
const noticeReadDoc = (clubId: string, memberId: string) =>
  doc(db, 'clubs', clubId, 'noticeReads', memberId)

const newId = () => crypto.randomUUID()

// ── 읽기 ────────────────────────────────────────────────────────────

/**
 * 공지를 최신순으로 가져온다. 관리자와 일반 회원이 같은 경로를 쓴다.
 *
 * where(status == 'published')는 화면 편의가 아니라 보안 규칙 조건이다 — 규칙의 list 허용
 * 조건이 이 제약을 요구하므로, 이 조건을 빼면 회원 기기에서는 쿼리 자체가 서버에서
 * 거부된다. 복합 인덱스는 firestore.indexes.json에 정의해 두었다.
 */
export async function fetchNotices(clubId = DEFAULT_CLUB_ID): Promise<Notice[]> {
  const snap = await getDocs(
    query(noticesCol(clubId), where('status', '==', 'published'), orderBy('createdAt', 'desc')),
  )
  return snap.docs.map((d) => d.data() as Notice)
}

/** 이 회원이 읽은 글 목록. 기록이 없으면 빈 배열. */
export async function fetchMyReadNoticeIds(
  memberId: string,
  clubId = DEFAULT_CLUB_ID,
): Promise<string[]> {
  const snap = await getDoc(noticeReadDoc(clubId, memberId))
  if (!snap.exists()) return []
  return (snap.data() as NoticeRead).readNoticeIds ?? []
}

// ── 읽음 기록 ────────────────────────────────────────────────────────

/**
 * 이 회원의 "읽은 글" 목록에 하나를 더한다.
 *
 * arrayUnion 대신 전체 배열을 그대로 보낸다 — 규칙이 readNoticeIds의 타입과 개수를 검사하고
 * 필드 목록도 딱 두 개로 제한하기 때문에, 보내는 모양을 코드에서 분명히 하는 편이 안전하다.
 * 문서 ID가 memberId라 남의 읽음 기록을 건드릴 수 없다(규칙에서도 같은 조건을 검사한다).
 */
export async function markNoticeRead(
  memberId: string,
  noticeId: string,
  currentReadIds: string[],
  clubId = DEFAULT_CLUB_ID,
): Promise<string[]> {
  if (currentReadIds.includes(noticeId)) return currentReadIds
  // 오래된 것부터 잘라 규칙의 개수 상한(500) 아래로 유지한다.
  const next = [...currentReadIds, noticeId].slice(-500)
  const payload: NoticeRead = { memberId, readNoticeIds: next }
  await setDoc(noticeReadDoc(clubId, memberId), payload)
  return next
}

// ── 쓰기 (관리자 전용 — 규칙에서도 관리자만 통과한다) ──────────────────

/**
 * 공지를 새로 올린다.
 *
 * authorMemberId는 이 기기의 회원 연결로 확인된 값이거나 null이다. 확인할 수 없는 관리자
 * 기기에 아무 회원 ID나 지어 붙이지 않는다(그 경우 authorName은 '관리자' 역할 표기가 된다).
 */
export async function createNotice(
  params: { authorMemberId: string | null; authorName: string; title: string; body: string },
  clubId = DEFAULT_CLUB_ID,
): Promise<Notice> {
  const notice: Notice = {
    id: newId(),
    title: params.title,
    body: params.body,
    pinned: false,
    status: 'published',
    authorMemberId: params.authorMemberId,
    authorName: params.authorName,
    createdAt: new Date().toISOString(),
  }
  await setDoc(noticeDoc(clubId, notice.id), notice)
  return notice
}

/** 제목·내용을 고친다. */
export async function updateNoticeText(
  noticeId: string,
  patch: { title: string; body: string },
  clubId = DEFAULT_CLUB_ID,
): Promise<void> {
  await updateDoc(noticeDoc(clubId, noticeId), { title: patch.title, body: patch.body })
}

/** 맨 위 고정 여부를 바꾼다. */
export async function setNoticePinned(
  noticeId: string,
  pinned: boolean,
  clubId = DEFAULT_CLUB_ID,
): Promise<void> {
  await updateDoc(noticeDoc(clubId, noticeId), { pinned })
}

/** 공지를 지운다. */
export async function deleteNotice(noticeId: string, clubId = DEFAULT_CLUB_ID): Promise<void> {
  await deleteDoc(noticeDoc(clubId, noticeId))
}

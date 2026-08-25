import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore'
import { db } from './firebase'
import type { LinkRequest, LinkRequestEntry, MemberLink, MemberLinkEntry } from '../types/memberLink'

// 회원-기기 연결 전용 Firestore 접근. 기존 cloudSync.ts(clubs/skkubc AppState 문서)와 완전히
// 분리돼 있고, 이 파일은 그 문서를 읽거나 쓰지 않는다.
//
// clubId는 지금 'skkubc' 하나뿐이지만, 나중에 모임이 늘어도 경로만 바꾸면 되도록 인자로 받는다.

export const DEFAULT_CLUB_ID = 'skkubc'

const linkRequestsCol = (clubId: string) => collection(db, 'clubs', clubId, 'linkRequests')
const linkRequestDoc = (clubId: string, uid: string) => doc(db, 'clubs', clubId, 'linkRequests', uid)
const memberLinksCol = (clubId: string) => collection(db, 'clubs', clubId, 'memberLinks')
const memberLinkDoc = (clubId: string, uid: string) => doc(db, 'clubs', clubId, 'memberLinks', uid)

/** 이 기기(uid)의 연결 기록. 없으면 null. 일반 회원도 자기 문서는 읽을 수 있다. */
export async function fetchMyLink(uid: string, clubId = DEFAULT_CLUB_ID): Promise<MemberLink | null> {
  const snap = await getDoc(memberLinkDoc(clubId, uid))
  return snap.exists() ? (snap.data() as MemberLink) : null
}

/** 이 기기(uid)가 보낸 연결 요청. 없으면 null. */
export async function fetchMyRequest(uid: string, clubId = DEFAULT_CLUB_ID): Promise<LinkRequest | null> {
  const snap = await getDoc(linkRequestDoc(clubId, uid))
  return snap.exists() ? (snap.data() as LinkRequest) : null
}

/**
 * 연결 요청을 만든다. 일부러 memberId·requestedAt "두 개만" 쓴다 —
 * role·active·승인정보를 요청자가 넣을 수 없어야 하고, Firestore 규칙도 이 두 필드만 허용한다.
 * 문서 ID가 본인 uid라 남의 요청을 만들 수도 없다.
 */
export async function createLinkRequest(uid: string, memberId: string, clubId = DEFAULT_CLUB_ID): Promise<void> {
  const payload: LinkRequest = { memberId, requestedAt: new Date().toISOString() }
  await setDoc(linkRequestDoc(clubId, uid), payload)
}

/** 회원이 자기 요청을 취소한다(다른 회원으로 다시 요청하려면 취소 후 새로 만든다). */
export async function cancelMyRequest(uid: string, clubId = DEFAULT_CLUB_ID): Promise<void> {
  await deleteDoc(linkRequestDoc(clubId, uid))
}

/** 대기 중인 연결 요청 전체. Firebase 관리자만 읽을 수 있다(규칙에서 강제). */
export async function fetchPendingRequests(clubId = DEFAULT_CLUB_ID): Promise<LinkRequestEntry[]> {
  const snap = await getDocs(linkRequestsCol(clubId))
  return snap.docs.map((d) => ({ firebaseUid: d.id, request: d.data() as LinkRequest }))
}

/** 연결된 기기 전체. Firebase 관리자만 읽을 수 있다. */
export async function fetchMemberLinks(clubId = DEFAULT_CLUB_ID): Promise<MemberLinkEntry[]> {
  const snap = await getDocs(memberLinksCol(clubId))
  return snap.docs.map((d) => ({ firebaseUid: d.id, link: d.data() as MemberLink }))
}

/**
 * 요청을 승인해 연결을 만든다(Firebase 관리자 전용).
 *
 * role은 항상 'member'로 고정한다 — 기기 연결 승인이 관리자 권한 부여로 이어지면 안 된다.
 * 'admin' 부여는 별도 관리자 작업으로만 처리한다.
 * approvedBy는 신뢰할 수 있는 Firebase 관리자 UID가 있을 때만 넣는다.
 */
export async function approveLinkRequest(
  firebaseUid: string,
  memberId: string,
  approvedBy?: string,
  clubId = DEFAULT_CLUB_ID,
): Promise<void> {
  const link: MemberLink = {
    memberId,
    role: 'member',
    active: true,
    linkedAt: new Date().toISOString(),
    ...(approvedBy ? { approvedBy } : {}),
  }
  await setDoc(memberLinkDoc(clubId, firebaseUid), link)
  await deleteDoc(linkRequestDoc(clubId, firebaseUid))
}

/** 요청을 거절한다 — 요청 문서만 지우고 연결은 만들지 않는다. 회원은 다시 요청할 수 있다. */
export async function rejectLinkRequest(firebaseUid: string, clubId = DEFAULT_CLUB_ID): Promise<void> {
  await deleteDoc(linkRequestDoc(clubId, firebaseUid))
}

/**
 * 연결을 해제/재활성한다(Firebase 관리자 전용).
 * 문서를 지우지 않고 active만 바꾼다 — 분실 기기를 언제 끊었는지 기록이 남아야 하고,
 * 같은 기기가 다시 붙었을 때 이전 연결이 있었다는 사실을 알 수 있어야 한다.
 */
export async function setLinkActive(firebaseUid: string, active: boolean, clubId = DEFAULT_CLUB_ID): Promise<void> {
  await updateDoc(memberLinkDoc(clubId, firebaseUid), { active })
}

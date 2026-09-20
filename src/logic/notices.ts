import type { Notice } from '../types/notice'

/**
 * 홈 공지 게시판 정렬 규칙 (순수 함수).
 *
 * 화면(NoticeBoard)과 완전히 분리해 두어, 정렬 기준을 테스트로 그대로 검증할 수 있게 한다.
 */

/** 홈에 한 번에 보여주는 글 개수 상한. */
export const HOME_NOTICE_LIMIT = 5

/** 홈에서 "고정" 대우를 받는 글 개수 상한. */
export const HOME_PINNED_LIMIT = 3

export interface HomeNoticeItem {
  notice: Notice
  /** 이 회원이 이미 읽은 글인지. */
  read: boolean
  /** "고정" 표시를 받는 글인지(고정글 중 최신 3개까지). */
  pinnedSlot: boolean
}

/** 최신 글이 먼저. 작성 시각이 같으면 id로 갈라 항상 같은 순서가 나오게 한다. */
function byNewestFirst(a: Notice, b: Notice): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * 홈에 보여줄 글을 순서대로 고른다.
 *
 * 순서 기준 — 세 묶음으로 나누고, 각 묶음 안에서는 최신 글이 먼저 온다.
 *
 *   ① 아직 안 읽은 글          (고정글이든 아니든)
 *   ② 읽은 고정글
 *   ③ 읽은 일반 글
 *
 * 즉 안 읽은 새 공지가 항상 맨 위에 올라오고, 그 글을 읽고 나면 고정글 아래로 내려간다.
 * 고정글은 "읽어도 계속 위쪽에 남는 글"이 된다(①에 새 글이 없으면 고정글이 맨 위).
 *
 * 개수 상한 두 가지는 서로 단계를 나눠 적용하므로 충돌하지 않는다.
 *  - "고정" 대우(pinnedSlot)는 고정글 중 최신 3개(HOME_PINNED_LIMIT)까지만 준다.
 *    3개를 넘은 고정글은 일반 글과 똑같이 취급해 ①/③으로 내려간다.
 *  - 그렇게 정한 순서에서 앞에서부터 5개(HOME_NOTICE_LIMIT)만 화면에 보여준다.
 *
 * 예) 고정 2개(둘 다 읽음) + 안 읽은 새 글 1개 + 읽은 일반 글 3개 →
 *     [새 글] → [고정1] → [고정2] → [읽은글1] → [읽은글2] (여기까지 5개, 마지막 1개는 잘림)
 */
export function selectHomeNotices(notices: Notice[], readNoticeIds: Iterable<string>): HomeNoticeItem[] {
  const readSet = new Set(readNoticeIds)
  // status 확인은 안전장치다 — 규칙상 회원에게는 공개 글만 내려오지만, 혹시 다른 값이
  // 섞여 들어와도 홈에 나타나지 않게 한 번 더 거른다.
  const published = notices.filter((n) => n.status === 'published').sort(byNewestFirst)

  const pinnedSlotIds = new Set(
    published.filter((n) => n.pinned).slice(0, HOME_PINNED_LIMIT).map((n) => n.id),
  )

  const unread = published.filter((n) => !readSet.has(n.id))
  const readPinned = published.filter((n) => readSet.has(n.id) && pinnedSlotIds.has(n.id))
  const readPlain = published.filter((n) => readSet.has(n.id) && !pinnedSlotIds.has(n.id))

  return [...unread, ...readPinned, ...readPlain]
    .slice(0, HOME_NOTICE_LIMIT)
    .map((notice) => ({
      notice,
      read: readSet.has(notice.id),
      pinnedSlot: pinnedSlotIds.has(notice.id),
    }))
}

/** 지금 고정된 공개 글 수. 관리자가 4번째 글을 고정하려 할 때 막는 데 쓴다. */
export function pinnedCount(notices: Notice[]): number {
  return notices.filter((n) => n.status === 'published' && n.pinned).length
}

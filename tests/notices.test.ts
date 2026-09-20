import { describe, it, expect } from 'vitest'
import {
  HOME_NOTICE_LIMIT, HOME_PINNED_LIMIT, pinnedCount, selectHomeNotices,
} from '../src/logic/notices'
import type { Notice } from '../src/types/notice'

// 아래 이름·ID·내용은 전부 테스트용 가상 데이터이며 실제 회원 정보나 운영 공지가 아니다.

function makeNotice(over: Partial<Notice> & { id: string; createdAt: string }): Notice {
  return {
    title: '제목 ' + over.id,
    body: '내용 ' + over.id,
    pinned: false,
    status: 'published',
    authorMemberId: 'member-001',
    authorName: '테스트회원A',
    ...over,
  }
}

const ids = (items: { notice: Notice }[]) => items.map((i) => i.notice.id)

/**
 * 정렬 기준 — 세 묶음, 각 묶음 안에서는 최신순.
 *   ① 안 읽은 글 → ② 읽은 고정글 → ③ 읽은 일반 글
 */
describe('selectHomeNotices — 홈 공지 정렬', () => {
  it('안 읽은 최신 글이 맨 위에 오고, 읽고 나면 고정글 아래로 내려간다', () => {
    const list = [
      makeNotice({ id: 'pin', title: '고정글', pinned: true, createdAt: '2026-09-01T10:00:00+09:00' }),
      makeNotice({ id: 'fresh', title: '새 공지', createdAt: '2026-09-09T10:00:00+09:00' }),
    ]
    // 아직 안 읽었을 때: 새 공지가 고정글보다 위
    expect(ids(selectHomeNotices(list, ['pin']))).toEqual(['fresh', 'pin'])
    // 읽고 난 뒤: 고정글 아래로 내려간다
    expect(ids(selectHomeNotices(list, ['pin', 'fresh']))).toEqual(['pin', 'fresh'])
  })

  it('안 읽은 글 → 읽은 고정글 → 읽은 일반 글 순서로 나온다', () => {
    const list = [
      makeNotice({ id: 'read-plain', createdAt: '2026-09-08T10:00:00+09:00' }),
      makeNotice({ id: 'read-pinned', pinned: true, createdAt: '2026-09-02T10:00:00+09:00' }),
      makeNotice({ id: 'unread', createdAt: '2026-09-01T10:00:00+09:00' }),
    ]
    // 읽은 일반 글이 가장 최신이어도 맨 아래로 간다
    expect(ids(selectHomeNotices(list, ['read-plain', 'read-pinned'])))
      .toEqual(['unread', 'read-pinned', 'read-plain'])
  })

  it('같은 묶음 안에서는 최신 글이 먼저 온다', () => {
    const list = [
      makeNotice({ id: 'u-old', createdAt: '2026-09-01T10:00:00+09:00' }),
      makeNotice({ id: 'u-new', createdAt: '2026-09-05T10:00:00+09:00' }),
      makeNotice({ id: 'r-old', createdAt: '2026-09-02T10:00:00+09:00' }),
      makeNotice({ id: 'r-new', createdAt: '2026-09-04T10:00:00+09:00' }),
    ]
    expect(ids(selectHomeNotices(list, ['r-old', 'r-new'])))
      .toEqual(['u-new', 'u-old', 'r-new', 'r-old'])
  })

  it('안 읽은 고정글도 안 읽은 묶음에 들어가 맨 위에 온다', () => {
    const list = [
      makeNotice({ id: 'unread-pin', pinned: true, createdAt: '2026-09-03T10:00:00+09:00' }),
      makeNotice({ id: 'read-pin', pinned: true, createdAt: '2026-09-05T10:00:00+09:00' }),
    ]
    const items = selectHomeNotices(list, ['read-pin'])
    expect(ids(items)).toEqual(['unread-pin', 'read-pin'])
    // 둘 다 고정 표시는 유지된다
    expect(items.every((i) => i.pinnedSlot)).toBe(true)
  })

  it('고정 표시는 최신 3개까지만이고, 넘친 고정글은 읽은 일반 글로 내려간다', () => {
    const list = [
      makeNotice({ id: 'p1', pinned: true, createdAt: '2026-09-05T10:00:00+09:00' }),
      makeNotice({ id: 'p2', pinned: true, createdAt: '2026-09-04T10:00:00+09:00' }),
      makeNotice({ id: 'p3', pinned: true, createdAt: '2026-09-03T10:00:00+09:00' }),
      makeNotice({ id: 'p4', pinned: true, createdAt: '2026-09-02T10:00:00+09:00' }),
      makeNotice({ id: 'plain', createdAt: '2026-09-01T10:00:00+09:00' }),
    ]
    const items = selectHomeNotices(list, ['p1', 'p2', 'p3', 'p4', 'plain'])
    // p4는 고정글이지만 고정 표시를 못 받아 읽은 일반 글과 같은 묶음으로 내려간다
    expect(ids(items)).toEqual(['p1', 'p2', 'p3', 'p4', 'plain'])
    expect(items.filter((i) => i.pinnedSlot).length).toBe(HOME_PINNED_LIMIT)
    expect(items.find((i) => i.notice.id === 'p4')!.pinnedSlot).toBe(false)
  })

  it('고정글이 6개여도 고정 표시는 3개를 넘지 않고 화면은 5개를 넘지 않는다', () => {
    const list = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].map((id, i) =>
      makeNotice({ id, pinned: true, createdAt: '2026-09-0' + (6 - i) + 'T10:00:00+09:00' }),
    )
    const items = selectHomeNotices(list, [])
    expect(items.length).toBe(HOME_NOTICE_LIMIT)
    expect(items.filter((i) => i.pinnedSlot).length).toBe(HOME_PINNED_LIMIT)
  })

  it('글이 많아도 홈에는 5개까지만 보여준다', () => {
    const list = Array.from({ length: 12 }, (_, i) =>
      makeNotice({ id: 'n' + i, createdAt: '2026-09-' + String(i + 10) + 'T10:00:00+09:00' }),
    )
    expect(selectHomeNotices(list, []).length).toBe(HOME_NOTICE_LIMIT)
  })

  it('안 읽은 글이 5개를 넘으면 읽은 고정글은 화면에서 밀려난다', () => {
    const unread = Array.from({ length: 5 }, (_, i) =>
      makeNotice({ id: 'u' + i, createdAt: '2026-09-' + String(20 + i) + 'T10:00:00+09:00' }),
    )
    const list = [...unread, makeNotice({ id: 'pin', pinned: true, createdAt: '2026-09-01T10:00:00+09:00' })]
    const items = selectHomeNotices(list, ['pin'])
    expect(items.length).toBe(HOME_NOTICE_LIMIT)
    expect(ids(items)).not.toContain('pin')
  })

  it('읽음 여부를 항목마다 알려준다', () => {
    const list = [
      makeNotice({ id: 'a', createdAt: '2026-09-02T10:00:00+09:00' }),
      makeNotice({ id: 'b', createdAt: '2026-09-01T10:00:00+09:00' }),
    ]
    const items = selectHomeNotices(list, ['b'])
    expect(items.find((i) => i.notice.id === 'a')!.read).toBe(false)
    expect(items.find((i) => i.notice.id === 'b')!.read).toBe(true)
  })

  it('작성 시각이 같아도 항상 같은 순서가 나온다', () => {
    const same = '2026-09-03T10:00:00+09:00'
    const list = [makeNotice({ id: 'b', createdAt: same }), makeNotice({ id: 'a', createdAt: same })]
    expect(ids(selectHomeNotices(list, []))).toEqual(['a', 'b'])
    expect(ids(selectHomeNotices([...list].reverse(), []))).toEqual(['a', 'b'])
  })

  it('공개 값이 아닌 문서가 섞여 들어와도 홈에 보여주지 않는다(안전장치)', () => {
    const list = [
      makeNotice({ id: 'ok', createdAt: '2026-09-02T10:00:00+09:00' }),
      // 규칙상 회원에게 내려올 수 없는 모양이지만, 방어적으로 한 번 더 거르는지 확인한다.
      { ...makeNotice({ id: 'bad', createdAt: '2026-09-03T10:00:00+09:00' }), status: 'draft' } as unknown as Notice,
    ]
    expect(ids(selectHomeNotices(list, []))).toEqual(['ok'])
  })
})

describe('pinnedCount', () => {
  it('고정된 공개 글 수를 센다', () => {
    const list = [
      makeNotice({ id: 'p1', pinned: true, createdAt: '2026-09-01T10:00:00+09:00' }),
      makeNotice({ id: 'p2', pinned: true, createdAt: '2026-09-02T10:00:00+09:00' }),
      makeNotice({ id: 'plain', createdAt: '2026-09-03T10:00:00+09:00' }),
    ]
    expect(pinnedCount(list)).toBe(2)
  })
})

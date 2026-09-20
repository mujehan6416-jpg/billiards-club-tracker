// @vitest-environment node
import { afterAll, beforeEach, describe, it } from 'vitest'
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import {
  createRulesTestEnv,
  CLUB_A,
  CLUB_B,
  MEMBER_ID_1,
  MEMBER_ID_2,
  SPLIT_CLUB_ID,
  UID_ADMIN_ACTIVE,
  UID_MEMBER_ACTIVE,
  UID_MEMBER_B,
  UID_MEMBER_INACTIVE,
  UID_UNLINKED,
  seedAdmin,
  seedMemberLink,
} from './support/testEnv'

const testEnv: RulesTestEnvironment | null = await createRulesTestEnv()

// 아래 이름·ID·내용은 전부 테스트용 가상 데이터이며 실제 회원 정보나 운영 공지가 아니다.
//
// 이 기능의 권한 모델은 단순하다.
//   쓰기(만들기·고치기·지우기·고정) = 관리자만
//   읽기 = 연결된 활성 회원 + 관리자, 그것도 status가 'published'인 문서만

describe.skipIf(!testEnv)('firestore.rules — clubs/{clubId}/notices (관리자 전용 공지)', () => {
  afterAll(async () => {
    await testEnv!.cleanup()
  })

  beforeEach(async () => {
    await testEnv!.clearFirestore()
  })

  const noticePath = (id: string, clubId = SPLIT_CLUB_ID) => `clubs/${clubId}/notices/${id}`

  const noticeData = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    title: '공지 제목',
    body: '공지 내용',
    pinned: false,
    status: 'published',
    authorMemberId: MEMBER_ID_1,
    authorName: '테스트회원A',
    createdAt: '2026-09-05T10:00:00+09:00',
    ...over,
  })

  const seedNotice = (id: string, over: Record<string, unknown> = {}, clubId = SPLIT_CLUB_ID) =>
    testEnv!.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc(noticePath(id, clubId)).set(noticeData(id, over))
    })

  // ── 읽기 ──────────────────────────────────────────────────────────

  it('비인증 사용자는 공개된 공지도 읽을 수 없다', async () => {
    await seedNotice('n1')
    const db = testEnv!.unauthenticatedContext().firestore()
    await assertFails(db.doc(noticePath('n1')).get())
  })

  it('연결 안 된 인증 사용자는 공지를 읽을 수 없다', async () => {
    await seedNotice('n1')
    const db = testEnv!.authenticatedContext(UID_UNLINKED).firestore()
    await assertFails(db.doc(noticePath('n1')).get())
  })

  it('연결이 비활성인 회원은 공지를 읽을 수 없다', async () => {
    await seedNotice('n1')
    await seedMemberLink(testEnv!, SPLIT_CLUB_ID, UID_MEMBER_INACTIVE, MEMBER_ID_1, false)
    const db = testEnv!.authenticatedContext(UID_MEMBER_INACTIVE).firestore()
    await assertFails(db.doc(noticePath('n1')).get())
  })

  it('활성 연결 회원은 공개된 공지를 읽을 수 있다', async () => {
    await seedNotice('n1')
    await seedMemberLink(testEnv!, SPLIT_CLUB_ID, UID_MEMBER_ACTIVE, MEMBER_ID_1, true)
    const db = testEnv!.authenticatedContext(UID_MEMBER_ACTIVE).firestore()
    await assertSucceeds(db.doc(noticePath('n1')).get())
  })

  it('관리자는 공지를 읽을 수 있다', async () => {
    await seedNotice('n1')
    await seedAdmin(testEnv!, UID_ADMIN_ACTIVE, true)
    const db = testEnv!.authenticatedContext(UID_ADMIN_ACTIVE).firestore()
    await assertSucceeds(db.doc(noticePath('n1')).get())
  })

  it('공개 값이 아닌(pending) 문서는 회원이 개별 조회해도 거부된다', async () => {
    await seedNotice('draft', { status: 'pending' })
    await seedMemberLink(testEnv!, SPLIT_CLUB_ID, UID_MEMBER_ACTIVE, MEMBER_ID_1, true)
    const db = testEnv!.authenticatedContext(UID_MEMBER_ACTIVE).firestore()
    await assertFails(db.doc(noticePath('draft')).get())
  })

  it('공개 값이 아닌(pending) 문서는 남이 지목해도 거부된다', async () => {
    await seedNotice('draft', { status: 'pending', authorMemberId: MEMBER_ID_1 })
    await seedMemberLink(testEnv!, SPLIT_CLUB_ID, UID_MEMBER_B, MEMBER_ID_2, true)
    const db = testEnv!.authenticatedContext(UID_MEMBER_B).firestore()
    await assertFails(db.doc(noticePath('draft')).get())
  })

  it('작성자로 적힌 회원 본인이라도 공개 값이 아닌 문서는 읽을 수 없다', async () => {
    await seedNotice('draft', { status: 'pending', authorMemberId: MEMBER_ID_1 })
    await seedMemberLink(testEnv!, SPLIT_CLUB_ID, UID_MEMBER_ACTIVE, MEMBER_ID_1, true)
    const db = testEnv!.authenticatedContext(UID_MEMBER_ACTIVE).firestore()
    await assertFails(db.doc(noticePath('draft')).get())
  })

  it('회원의 목록 조회는 status == published 제약이 있어야만 통과한다', async () => {
    await seedNotice('n1')
    await seedMemberLink(testEnv!, SPLIT_CLUB_ID, UID_MEMBER_ACTIVE, MEMBER_ID_1, true)
    const db = testEnv!.authenticatedContext(UID_MEMBER_ACTIVE).firestore()
    await assertSucceeds(db.collection(`clubs/${SPLIT_CLUB_ID}/notices`).where('status', '==', 'published').get())
  })

  it('회원이 제약 없이 전체 목록을 조회하면 거부된다', async () => {
    await seedNotice('n1')
    await seedMemberLink(testEnv!, SPLIT_CLUB_ID, UID_MEMBER_ACTIVE, MEMBER_ID_1, true)
    const db = testEnv!.authenticatedContext(UID_MEMBER_ACTIVE).firestore()
    await assertFails(db.collection(`clubs/${SPLIT_CLUB_ID}/notices`).get())
  })

  it('회원이 pending 목록을 조회하면 거부된다', async () => {
    await seedNotice('draft', { status: 'pending' })
    await seedMemberLink(testEnv!, SPLIT_CLUB_ID, UID_MEMBER_ACTIVE, MEMBER_ID_1, true)
    const db = testEnv!.authenticatedContext(UID_MEMBER_ACTIVE).firestore()
    await assertFails(db.collection(`clubs/${SPLIT_CLUB_ID}/notices`).where('status', '==', 'pending').get())
  })

  it('관리자는 제약 없이 전체 목록을 조회할 수 있다', async () => {
    await seedNotice('n1')
    await seedAdmin(testEnv!, UID_ADMIN_ACTIVE, true)
    const db = testEnv!.authenticatedContext(UID_ADMIN_ACTIVE).firestore()
    await assertSucceeds(db.collection(`clubs/${SPLIT_CLUB_ID}/notices`).get())
  })

  // ── 회원 쓰기 거부 (이번 범위의 핵심) ──────────────────────────────

  it('활성 연결 회원은 공지를 직접 만들 수 없다', async () => {
    await seedMemberLink(testEnv!, SPLIT_CLUB_ID, UID_MEMBER_ACTIVE, MEMBER_ID_1, true)
    const db = testEnv!.authenticatedContext(UID_MEMBER_ACTIVE).firestore()
    await assertFails(db.doc(noticePath('new1')).set(noticeData('new1')))
  })

  it('회원은 승인 대기(pending) 모양으로도 공지를 만들 수 없다', async () => {
    await seedMemberLink(testEnv!, SPLIT_CLUB_ID, UID_MEMBER_ACTIVE, MEMBER_ID_1, true)
    const db = testEnv!.authenticatedContext(UID_MEMBER_ACTIVE).firestore()
    await assertFails(db.doc(noticePath('new1')).set(noticeData('new1', { status: 'pending' })))
  })

  it('회원은 자기 이름으로 적힌 공지라도 고칠 수 없다', async () => {
    await seedNotice('n1', { authorMemberId: MEMBER_ID_1 })
    await seedMemberLink(testEnv!, SPLIT_CLUB_ID, UID_MEMBER_ACTIVE, MEMBER_ID_1, true)
    const db = testEnv!.authenticatedContext(UID_MEMBER_ACTIVE).firestore()
    await assertFails(db.doc(noticePath('n1')).update({ title: '몰래 고친 제목' }))
  })

  it('회원은 공지를 스스로 고정할 수 없다', async () => {
    await seedNotice('n1', { authorMemberId: MEMBER_ID_1 })
    await seedMemberLink(testEnv!, SPLIT_CLUB_ID, UID_MEMBER_ACTIVE, MEMBER_ID_1, true)
    const db = testEnv!.authenticatedContext(UID_MEMBER_ACTIVE).firestore()
    await assertFails(db.doc(noticePath('n1')).update({ pinned: true }))
  })

  it('회원은 공지를 지울 수 없다', async () => {
    await seedNotice('n1', { authorMemberId: MEMBER_ID_1 })
    await seedMemberLink(testEnv!, SPLIT_CLUB_ID, UID_MEMBER_ACTIVE, MEMBER_ID_1, true)
    const db = testEnv!.authenticatedContext(UID_MEMBER_ACTIVE).firestore()
    await assertFails(db.doc(noticePath('n1')).delete())
  })

  it('비인증 사용자는 공지를 만들 수 없다', async () => {
    const db = testEnv!.unauthenticatedContext().firestore()
    await assertFails(db.doc(noticePath('new1')).set(noticeData('new1')))
  })

  it('비활성 관리자는 공지를 만들 수 없다', async () => {
    await seedAdmin(testEnv!, UID_ADMIN_ACTIVE, false)
    const db = testEnv!.authenticatedContext(UID_ADMIN_ACTIVE).firestore()
    await assertFails(db.doc(noticePath('new1')).set(noticeData('new1')))
  })

  // ── 관리자 쓰기 ────────────────────────────────────────────────────

  it('활성 관리자는 공지를 만들 수 있다', async () => {
    await seedAdmin(testEnv!, UID_ADMIN_ACTIVE, true)
    const db = testEnv!.authenticatedContext(UID_ADMIN_ACTIVE).firestore()
    await assertSucceeds(db.doc(noticePath('a1')).set(noticeData('a1')))
  })

  it('활성 관리자는 회원으로 확인되지 않은 표기(authorMemberId=null)로도 만들 수 있다', async () => {
    await seedAdmin(testEnv!, UID_ADMIN_ACTIVE, true)
    const db = testEnv!.authenticatedContext(UID_ADMIN_ACTIVE).firestore()
    await assertSucceeds(db.doc(noticePath('a1')).set(
      noticeData('a1', { authorMemberId: null, authorName: '관리자' }),
    ))
  })

  it('활성 관리자는 공지를 고치고 고정하고 지울 수 있다', async () => {
    await seedNotice('n1')
    await seedAdmin(testEnv!, UID_ADMIN_ACTIVE, true)
    const db = testEnv!.authenticatedContext(UID_ADMIN_ACTIVE).firestore()
    await assertSucceeds(db.doc(noticePath('n1')).update({ title: '고친 제목' }))
    await assertSucceeds(db.doc(noticePath('n1')).update({ pinned: true }))
    await assertSucceeds(db.doc(noticePath('n1')).delete())
  })

  // ── 다른 모임(클럽) 격리 ───────────────────────────────────────────

  it('다른 모임에 연결된 회원은 이 모임 공지를 읽을 수 없다', async () => {
    await seedNotice('n1', {}, CLUB_A)
    await seedMemberLink(testEnv!, CLUB_B, UID_MEMBER_ACTIVE, MEMBER_ID_1, true)
    const db = testEnv!.authenticatedContext(UID_MEMBER_ACTIVE).firestore()
    await assertFails(db.doc(noticePath('n1', CLUB_A)).get())
  })

  it('다른 모임에 연결된 회원은 이 모임 공지 목록을 조회할 수 없다', async () => {
    await seedNotice('n1', {}, CLUB_A)
    await seedMemberLink(testEnv!, CLUB_B, UID_MEMBER_ACTIVE, MEMBER_ID_1, true)
    const db = testEnv!.authenticatedContext(UID_MEMBER_ACTIVE).firestore()
    await assertFails(
      db.collection(`clubs/${CLUB_A}/notices`).where('status', '==', 'published').get(),
    )
  })

  it('다른 모임에 연결된 회원은 이 모임에 공지를 만들 수 없다', async () => {
    await seedMemberLink(testEnv!, CLUB_B, UID_MEMBER_ACTIVE, MEMBER_ID_1, true)
    const db = testEnv!.authenticatedContext(UID_MEMBER_ACTIVE).firestore()
    await assertFails(db.doc(noticePath('new1', CLUB_A)).set(noticeData('new1')))
  })
})

describe.skipIf(!testEnv)('firestore.rules — clubs/{clubId}/noticeReads (회원별 읽음 기록)', () => {
  afterAll(async () => {
    await testEnv!.cleanup()
  })

  beforeEach(async () => {
    await testEnv!.clearFirestore()
  })

  const readPath = (memberId: string, clubId = SPLIT_CLUB_ID) =>
    `clubs/${clubId}/noticeReads/${memberId}`

  const readDoc = (memberId: string, ids: string[] = ['n1']) => ({ memberId, readNoticeIds: ids })

  const seedRead = (memberId: string, ids: string[] = ['n1'], clubId = SPLIT_CLUB_ID) =>
    testEnv!.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc(readPath(memberId, clubId)).set(readDoc(memberId, ids))
    })

  it('비인증 사용자는 읽음 기록을 읽을 수 없다', async () => {
    await seedRead(MEMBER_ID_1)
    const db = testEnv!.unauthenticatedContext().firestore()
    await assertFails(db.doc(readPath(MEMBER_ID_1)).get())
  })

  it('연결된 회원은 본인 읽음 기록을 읽을 수 있다', async () => {
    await seedRead(MEMBER_ID_1)
    await seedMemberLink(testEnv!, SPLIT_CLUB_ID, UID_MEMBER_ACTIVE, MEMBER_ID_1, true)
    const db = testEnv!.authenticatedContext(UID_MEMBER_ACTIVE).firestore()
    await assertSucceeds(db.doc(readPath(MEMBER_ID_1)).get())
  })

  it('남의 읽음 기록은 읽을 수 없다', async () => {
    await seedRead(MEMBER_ID_2)
    await seedMemberLink(testEnv!, SPLIT_CLUB_ID, UID_MEMBER_ACTIVE, MEMBER_ID_1, true)
    const db = testEnv!.authenticatedContext(UID_MEMBER_ACTIVE).firestore()
    await assertFails(db.doc(readPath(MEMBER_ID_2)).get())
  })

  it('연결된 회원은 본인 읽음 기록을 저장할 수 있다', async () => {
    await seedMemberLink(testEnv!, SPLIT_CLUB_ID, UID_MEMBER_ACTIVE, MEMBER_ID_1, true)
    const db = testEnv!.authenticatedContext(UID_MEMBER_ACTIVE).firestore()
    await assertSucceeds(db.doc(readPath(MEMBER_ID_1)).set(readDoc(MEMBER_ID_1)))
  })

  it('본인 읽음 기록을 나중에 갱신할 수 있다', async () => {
    await seedRead(MEMBER_ID_1, ['n1'])
    await seedMemberLink(testEnv!, SPLIT_CLUB_ID, UID_MEMBER_ACTIVE, MEMBER_ID_1, true)
    const db = testEnv!.authenticatedContext(UID_MEMBER_ACTIVE).firestore()
    await assertSucceeds(db.doc(readPath(MEMBER_ID_1)).set(readDoc(MEMBER_ID_1, ['n1', 'n2'])))
  })

  it('남의 읽음 기록은 새로 만들 수 없다', async () => {
    await seedMemberLink(testEnv!, SPLIT_CLUB_ID, UID_MEMBER_ACTIVE, MEMBER_ID_1, true)
    const db = testEnv!.authenticatedContext(UID_MEMBER_ACTIVE).firestore()
    await assertFails(db.doc(readPath(MEMBER_ID_2)).set(readDoc(MEMBER_ID_2)))
  })

  it('남의 읽음 기록은 고칠 수 없다', async () => {
    await seedRead(MEMBER_ID_2)
    await seedMemberLink(testEnv!, SPLIT_CLUB_ID, UID_MEMBER_ACTIVE, MEMBER_ID_1, true)
    const db = testEnv!.authenticatedContext(UID_MEMBER_ACTIVE).firestore()
    await assertFails(db.doc(readPath(MEMBER_ID_2)).update({ readNoticeIds: ['n9'] }))
  })

  it('남의 읽음 기록은 지울 수 없다', async () => {
    await seedRead(MEMBER_ID_2)
    await seedMemberLink(testEnv!, SPLIT_CLUB_ID, UID_MEMBER_ACTIVE, MEMBER_ID_1, true)
    const db = testEnv!.authenticatedContext(UID_MEMBER_ACTIVE).firestore()
    await assertFails(db.doc(readPath(MEMBER_ID_2)).delete())
  })

  it('문서 ID와 memberId 필드가 다르면 거부된다', async () => {
    await seedMemberLink(testEnv!, SPLIT_CLUB_ID, UID_MEMBER_ACTIVE, MEMBER_ID_1, true)
    const db = testEnv!.authenticatedContext(UID_MEMBER_ACTIVE).firestore()
    await assertFails(db.doc(readPath(MEMBER_ID_1)).set(readDoc(MEMBER_ID_2)))
  })

  it('정해진 필드 외의 값을 끼워 넣으면 거부된다', async () => {
    await seedMemberLink(testEnv!, SPLIT_CLUB_ID, UID_MEMBER_ACTIVE, MEMBER_ID_1, true)
    const db = testEnv!.authenticatedContext(UID_MEMBER_ACTIVE).firestore()
    await assertFails(db.doc(readPath(MEMBER_ID_1)).set({ ...readDoc(MEMBER_ID_1), isAdmin: true }))
  })

  it('연결 안 된 사용자는 읽음 기록을 저장할 수 없다', async () => {
    const db = testEnv!.authenticatedContext(UID_UNLINKED).firestore()
    await assertFails(db.doc(readPath(MEMBER_ID_1)).set(readDoc(MEMBER_ID_1)))
  })

  it('연결이 비활성인 회원은 읽음 기록을 저장할 수 없다', async () => {
    await seedMemberLink(testEnv!, SPLIT_CLUB_ID, UID_MEMBER_INACTIVE, MEMBER_ID_1, false)
    const db = testEnv!.authenticatedContext(UID_MEMBER_INACTIVE).firestore()
    await assertFails(db.doc(readPath(MEMBER_ID_1)).set(readDoc(MEMBER_ID_1)))
  })

  it('다른 모임에 연결된 회원은 이 모임의 읽음 기록을 저장할 수 없다', async () => {
    await seedMemberLink(testEnv!, CLUB_B, UID_MEMBER_ACTIVE, MEMBER_ID_1, true)
    const db = testEnv!.authenticatedContext(UID_MEMBER_ACTIVE).firestore()
    await assertFails(db.doc(readPath(MEMBER_ID_1, CLUB_A)).set(readDoc(MEMBER_ID_1)))
  })

  it('다른 모임에 연결된 회원은 이 모임의 읽음 기록을 읽을 수 없다', async () => {
    await seedRead(MEMBER_ID_1, ['n1'], CLUB_A)
    await seedMemberLink(testEnv!, CLUB_B, UID_MEMBER_ACTIVE, MEMBER_ID_1, true)
    const db = testEnv!.authenticatedContext(UID_MEMBER_ACTIVE).firestore()
    await assertFails(db.doc(readPath(MEMBER_ID_1, CLUB_A)).get())
  })

  it('관리자는 회원의 읽음 기록을 대신 쓸 수 없다', async () => {
    await seedAdmin(testEnv!, UID_ADMIN_ACTIVE, true)
    const db = testEnv!.authenticatedContext(UID_ADMIN_ACTIVE).firestore()
    await assertFails(db.doc(readPath(MEMBER_ID_1)).set(readDoc(MEMBER_ID_1)))
  })

  it('관리자는 읽음 기록을 정리(삭제)할 수 있다', async () => {
    await seedRead(MEMBER_ID_1)
    await seedAdmin(testEnv!, UID_ADMIN_ACTIVE, true)
    const db = testEnv!.authenticatedContext(UID_ADMIN_ACTIVE).firestore()
    await assertSucceeds(db.doc(readPath(MEMBER_ID_1)).delete())
  })
})

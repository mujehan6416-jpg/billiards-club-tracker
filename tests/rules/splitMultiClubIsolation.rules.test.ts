// @vitest-environment node
import { afterAll, beforeEach, describe, it } from 'vitest'
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import {
  CLUB_A,
  CLUB_B,
  MEMBER_ID_1,
  UID_ADMIN_ACTIVE,
  UID_MEMBER_ACTIVE,
  createRulesTestEnv,
  seedAdmin,
  seedMemberLink,
} from './support/testEnv'

const testEnv: RulesTestEnvironment | null = await createRulesTestEnv()

/**
 * 멀티클럽(당구총무) 격리 확인.
 *
 * hasActiveMemberLink(clubId)는 clubId별로 memberLinks 문서를 따로 확인하므로,
 * A 모임에만 연결된 회원은 B 모임 데이터를 볼 수 없어야 한다.
 *
 * [알려진 한계] isAdmin()은 top-level admins/{uid} 기반 "전역" 관리자 판정이라 clubId로
 * 나뉘지 않는다 — 활성 관리자 한 명이 club-a·club-b 모두에 접근할 수 있다. 클럽별 관리자
 * 분리는 이번 작업 범위 밖이며, 향후 멀티클럽 권한 모델에서 별도로 설계한다.
 */
describe.skipIf(!testEnv)('firestore.rules — 멀티클럽(clubId) 격리 (split, 보안 4단계)', () => {
  afterAll(async () => {
    await testEnv!.cleanup()
  })

  beforeEach(async () => {
    await testEnv!.clearFirestore()
  })

  const membersCollectionPath = (clubId: string) => `clubs/${clubId}/members`
  const memberPath = (clubId: string, memberId: string) => `${membersCollectionPath(clubId)}/${memberId}`

  const seedMember = (clubId: string, memberId: string) =>
    testEnv!.withSecurityRulesDisabled(async (context) => {
      await context
        .firestore()
        .doc(memberPath(clubId, memberId))
        .set({ id: memberId, name: '가상회원', handicap: 20, handicapHistory: [], active: true })
    })

  it('club-a에만 연결된 회원은 club-a 회원 문서를 read할 수 있다', async () => {
    await seedMember(CLUB_A, MEMBER_ID_1)
    await seedMemberLink(testEnv!, CLUB_A, UID_MEMBER_ACTIVE, MEMBER_ID_1, true)
    const db = testEnv!.authenticatedContext(UID_MEMBER_ACTIVE).firestore()
    await assertSucceeds(db.doc(memberPath(CLUB_A, MEMBER_ID_1)).get())
  })

  it('club-a에만 연결된 회원은 club-b 회원 문서를 read할 수 없다', async () => {
    await seedMember(CLUB_B, MEMBER_ID_1)
    await seedMemberLink(testEnv!, CLUB_A, UID_MEMBER_ACTIVE, MEMBER_ID_1, true)
    const db = testEnv!.authenticatedContext(UID_MEMBER_ACTIVE).firestore()
    await assertFails(db.doc(memberPath(CLUB_B, MEMBER_ID_1)).get())
  })

  it('club-a에만 연결된 회원은 club-b 회원 목록도 list할 수 없다', async () => {
    await seedMember(CLUB_B, MEMBER_ID_1)
    await seedMemberLink(testEnv!, CLUB_A, UID_MEMBER_ACTIVE, MEMBER_ID_1, true)
    const db = testEnv!.authenticatedContext(UID_MEMBER_ACTIVE).firestore()
    await assertFails(db.collection(membersCollectionPath(CLUB_B)).get())
  })

  it('[알려진 한계] 활성 관리자(전역)는 club-a·club-b 회원 문서에 모두 접근할 수 있다', async () => {
    await seedMember(CLUB_A, MEMBER_ID_1)
    await seedMember(CLUB_B, MEMBER_ID_1)
    await seedAdmin(testEnv!, UID_ADMIN_ACTIVE, true)
    const db = testEnv!.authenticatedContext(UID_ADMIN_ACTIVE).firestore()
    await assertSucceeds(db.doc(memberPath(CLUB_A, MEMBER_ID_1)).get())
    await assertSucceeds(db.doc(memberPath(CLUB_B, MEMBER_ID_1)).get())
  })
})

// @vitest-environment node
import { afterAll, beforeEach, describe, it } from 'vitest'
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import {
  createRulesTestEnv,
  MEMBER_ID_1,
  MEMBER_ID_2,
  SPLIT_CLUB_ID,
  UID_ADMIN_ACTIVE,
  UID_MEMBER_ACTIVE,
  UID_MEMBER_INACTIVE,
  UID_UNLINKED,
  seedAdmin,
  seedMemberLink,
} from './support/testEnv'

const testEnv: RulesTestEnvironment | null = await createRulesTestEnv()

describe.skipIf(!testEnv)('firestore.rules — clubs/{clubId}/members/{memberId} (split, 보안 4단계)', () => {
  afterAll(async () => {
    await testEnv!.cleanup()
  })

  beforeEach(async () => {
    await testEnv!.clearFirestore()
  })

  const membersCollectionPath = `clubs/${SPLIT_CLUB_ID}/members`
  const memberPath = (memberId: string) => `${membersCollectionPath}/${memberId}`
  const memberData = (memberId: string) => ({
    id: memberId,
    name: '가상회원',
    handicap: 20,
    handicapHistory: [],
    active: true,
  })

  const seedMember = (memberId: string) =>
    testEnv!.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc(memberPath(memberId)).set(memberData(memberId))
    })

  it('비인증 사용자는 회원 문서를 read할 수 없다', async () => {
    await seedMember(MEMBER_ID_1)
    const db = testEnv!.unauthenticatedContext().firestore()
    await assertFails(db.doc(memberPath(MEMBER_ID_1)).get())
  })

  it('연결 안 된 인증 사용자는 회원 문서를 read할 수 없다', async () => {
    await seedMember(MEMBER_ID_1)
    const db = testEnv!.authenticatedContext(UID_UNLINKED).firestore()
    await assertFails(db.doc(memberPath(MEMBER_ID_1)).get())
  })

  it('연결이 비활성인 사용자는 회원 문서를 read할 수 없다', async () => {
    await seedMember(MEMBER_ID_1)
    await seedMemberLink(testEnv!, SPLIT_CLUB_ID, UID_MEMBER_INACTIVE, MEMBER_ID_1, false)
    const db = testEnv!.authenticatedContext(UID_MEMBER_INACTIVE).firestore()
    await assertFails(db.doc(memberPath(MEMBER_ID_1)).get())
  })

  it('활성 연결 회원은 다른 회원의 공개 문서를 read할 수 있다', async () => {
    await seedMember(MEMBER_ID_2)
    await seedMemberLink(testEnv!, SPLIT_CLUB_ID, UID_MEMBER_ACTIVE, MEMBER_ID_1, true)
    const db = testEnv!.authenticatedContext(UID_MEMBER_ACTIVE).firestore()
    await assertSucceeds(db.doc(memberPath(MEMBER_ID_2)).get())
  })

  it('활성 연결 회원은 자기 회원 문서도 read할 수 있다', async () => {
    await seedMember(MEMBER_ID_1)
    await seedMemberLink(testEnv!, SPLIT_CLUB_ID, UID_MEMBER_ACTIVE, MEMBER_ID_1, true)
    const db = testEnv!.authenticatedContext(UID_MEMBER_ACTIVE).firestore()
    await assertSucceeds(db.doc(memberPath(MEMBER_ID_1)).get())
  })

  it('활성 연결 회원은 회원 목록을 list할 수 있다', async () => {
    await seedMember(MEMBER_ID_1)
    await seedMemberLink(testEnv!, SPLIT_CLUB_ID, UID_MEMBER_ACTIVE, MEMBER_ID_1, true)
    const db = testEnv!.authenticatedContext(UID_MEMBER_ACTIVE).firestore()
    await assertSucceeds(db.collection(membersCollectionPath).get())
  })

  it('비인증 사용자는 회원 목록을 list할 수 없다', async () => {
    const db = testEnv!.unauthenticatedContext().firestore()
    await assertFails(db.collection(membersCollectionPath).get())
  })

  it('활성 연결 회원은 회원 문서를 create할 수 없다', async () => {
    await seedMemberLink(testEnv!, SPLIT_CLUB_ID, UID_MEMBER_ACTIVE, MEMBER_ID_1, true)
    const db = testEnv!.authenticatedContext(UID_MEMBER_ACTIVE).firestore()
    await assertFails(db.doc(memberPath(MEMBER_ID_1)).set(memberData(MEMBER_ID_1)))
  })

  it('활성 연결 회원은 회원 문서를 update할 수 없다', async () => {
    await seedMember(MEMBER_ID_1)
    await seedMemberLink(testEnv!, SPLIT_CLUB_ID, UID_MEMBER_ACTIVE, MEMBER_ID_1, true)
    const db = testEnv!.authenticatedContext(UID_MEMBER_ACTIVE).firestore()
    await assertFails(db.doc(memberPath(MEMBER_ID_1)).update({ handicap: 25 }))
  })

  it('활성 연결 회원은 회원 문서를 delete할 수 없다', async () => {
    await seedMember(MEMBER_ID_1)
    await seedMemberLink(testEnv!, SPLIT_CLUB_ID, UID_MEMBER_ACTIVE, MEMBER_ID_1, true)
    const db = testEnv!.authenticatedContext(UID_MEMBER_ACTIVE).firestore()
    await assertFails(db.doc(memberPath(MEMBER_ID_1)).delete())
  })

  it('활성 관리자는 회원 문서를 read할 수 있다', async () => {
    await seedMember(MEMBER_ID_1)
    await seedAdmin(testEnv!, UID_ADMIN_ACTIVE, true)
    const db = testEnv!.authenticatedContext(UID_ADMIN_ACTIVE).firestore()
    await assertSucceeds(db.doc(memberPath(MEMBER_ID_1)).get())
  })

  it('활성 관리자는 회원 문서를 create할 수 있다', async () => {
    await seedAdmin(testEnv!, UID_ADMIN_ACTIVE, true)
    const db = testEnv!.authenticatedContext(UID_ADMIN_ACTIVE).firestore()
    await assertSucceeds(db.doc(memberPath(MEMBER_ID_1)).set(memberData(MEMBER_ID_1)))
  })

  it('활성 관리자는 회원 문서를 update할 수 있다', async () => {
    await seedMember(MEMBER_ID_1)
    await seedAdmin(testEnv!, UID_ADMIN_ACTIVE, true)
    const db = testEnv!.authenticatedContext(UID_ADMIN_ACTIVE).firestore()
    await assertSucceeds(db.doc(memberPath(MEMBER_ID_1)).update({ handicap: 25 }))
  })

  it('활성 관리자는 회원 문서를 delete할 수 있다', async () => {
    await seedMember(MEMBER_ID_1)
    await seedAdmin(testEnv!, UID_ADMIN_ACTIVE, true)
    const db = testEnv!.authenticatedContext(UID_ADMIN_ACTIVE).firestore()
    await assertSucceeds(db.doc(memberPath(MEMBER_ID_1)).delete())
  })
})

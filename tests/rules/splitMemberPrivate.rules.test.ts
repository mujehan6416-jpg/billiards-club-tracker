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
  UID_UNLINKED,
  seedAdmin,
  seedMemberLink,
} from './support/testEnv'

const testEnv: RulesTestEnvironment | null = await createRulesTestEnv()

describe.skipIf(!testEnv)('firestore.rules — clubs/{clubId}/memberPrivate/{memberId} (split, 보안 4단계)', () => {
  afterAll(async () => {
    await testEnv!.cleanup()
  })

  beforeEach(async () => {
    await testEnv!.clearFirestore()
  })

  const privateCollectionPath = `clubs/${SPLIT_CLUB_ID}/memberPrivate`
  const privatePath = (memberId: string) => `${privateCollectionPath}/${memberId}`
  const privateData = (memberId: string) => ({ memberId })

  const seedPrivate = (memberId: string) =>
    testEnv!.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc(privatePath(memberId)).set(privateData(memberId))
    })

  it('비인증 사용자는 memberPrivate를 read할 수 없다', async () => {
    await seedPrivate(MEMBER_ID_1)
    const db = testEnv!.unauthenticatedContext().firestore()
    await assertFails(db.doc(privatePath(MEMBER_ID_1)).get())
  })

  it('연결 안 된 인증 사용자는 memberPrivate를 read할 수 없다', async () => {
    await seedPrivate(MEMBER_ID_1)
    const db = testEnv!.authenticatedContext(UID_UNLINKED).firestore()
    await assertFails(db.doc(privatePath(MEMBER_ID_1)).get())
  })

  it('활성 연결 회원은 (자기 memberId와 연결돼 있어도) 자기 private 문서를 read할 수 없다', async () => {
    await seedPrivate(MEMBER_ID_1)
    await seedMemberLink(testEnv!, SPLIT_CLUB_ID, UID_MEMBER_ACTIVE, MEMBER_ID_1, true)
    const db = testEnv!.authenticatedContext(UID_MEMBER_ACTIVE).firestore()
    await assertFails(db.doc(privatePath(MEMBER_ID_1)).get())
  })

  it('활성 연결 회원은 다른 회원의 private 문서도 read할 수 없다', async () => {
    await seedPrivate(MEMBER_ID_2)
    await seedMemberLink(testEnv!, SPLIT_CLUB_ID, UID_MEMBER_ACTIVE, MEMBER_ID_1, true)
    const db = testEnv!.authenticatedContext(UID_MEMBER_ACTIVE).firestore()
    await assertFails(db.doc(privatePath(MEMBER_ID_2)).get())
  })

  it('활성 연결 회원은 memberPrivate를 write할 수 없다', async () => {
    await seedMemberLink(testEnv!, SPLIT_CLUB_ID, UID_MEMBER_ACTIVE, MEMBER_ID_1, true)
    const db = testEnv!.authenticatedContext(UID_MEMBER_ACTIVE).firestore()
    await assertFails(db.doc(privatePath(MEMBER_ID_1)).set(privateData(MEMBER_ID_1)))
  })

  it('일반회원은 memberPrivate 목록을 list할 수 없다', async () => {
    await seedMemberLink(testEnv!, SPLIT_CLUB_ID, UID_MEMBER_ACTIVE, MEMBER_ID_1, true)
    const db = testEnv!.authenticatedContext(UID_MEMBER_ACTIVE).firestore()
    await assertFails(db.collection(privateCollectionPath).get())
  })

  it('활성 관리자는 memberPrivate를 read할 수 있다', async () => {
    await seedPrivate(MEMBER_ID_1)
    await seedAdmin(testEnv!, UID_ADMIN_ACTIVE, true)
    const db = testEnv!.authenticatedContext(UID_ADMIN_ACTIVE).firestore()
    await assertSucceeds(db.doc(privatePath(MEMBER_ID_1)).get())
  })

  it('활성 관리자는 memberPrivate를 create·update·delete할 수 있다', async () => {
    await seedAdmin(testEnv!, UID_ADMIN_ACTIVE, true)
    const db = testEnv!.authenticatedContext(UID_ADMIN_ACTIVE).firestore()
    await assertSucceeds(db.doc(privatePath(MEMBER_ID_1)).set(privateData(MEMBER_ID_1)))
    await assertSucceeds(db.doc(privatePath(MEMBER_ID_1)).update({ memberId: MEMBER_ID_1 }))
    await assertSucceeds(db.doc(privatePath(MEMBER_ID_1)).delete())
  })
})

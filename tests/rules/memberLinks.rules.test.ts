// @vitest-environment node
import { afterAll, beforeEach, describe, it } from 'vitest'
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import {
  createRulesTestEnv,
  MEMBER_TEST_ID,
  UID_ADMIN_ACTIVE,
  UID_MEMBER_A,
  UID_MEMBER_B,
  seedAdmin,
} from './support/testEnv'

const testEnv: RulesTestEnvironment | null = await createRulesTestEnv()

describe.skipIf(!testEnv)('firestore.rules — clubs/{clubId}/memberLinks/{uid}', () => {
  afterAll(async () => {
    await testEnv!.cleanup()
  })

  beforeEach(async () => {
    await testEnv!.clearFirestore()
  })

  const linkPath = (uid: string) => `clubs/skkubc/memberLinks/${uid}`
  const validLink = {
    memberId: MEMBER_TEST_ID,
    role: 'member',
    active: true,
    linkedAt: '2026-08-26T00:00:00+09:00',
  }

  it('본인 UID의 연결 기록을 get할 수 있다', async () => {
    await testEnv!.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc(linkPath(UID_MEMBER_A)).set(validLink)
    })
    const db = testEnv!.authenticatedContext(UID_MEMBER_A).firestore()
    await assertSucceeds(db.doc(linkPath(UID_MEMBER_A)).get())
  })

  it('다른 사람 UID의 연결 기록은 get할 수 없다', async () => {
    await testEnv!.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc(linkPath(UID_MEMBER_B)).set(validLink)
    })
    const db = testEnv!.authenticatedContext(UID_MEMBER_A).firestore()
    await assertFails(db.doc(linkPath(UID_MEMBER_B)).get())
  })

  it('일반 사용자는 연결 기록을 create할 수 없다', async () => {
    const db = testEnv!.authenticatedContext(UID_MEMBER_A).firestore()
    await assertFails(db.doc(linkPath(UID_MEMBER_A)).set(validLink))
  })

  it('일반 사용자는 연결 기록을 update할 수 없다', async () => {
    await testEnv!.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc(linkPath(UID_MEMBER_A)).set(validLink)
    })
    const db = testEnv!.authenticatedContext(UID_MEMBER_A).firestore()
    await assertFails(db.doc(linkPath(UID_MEMBER_A)).update({ active: false }))
  })

  it('일반 사용자는 연결 기록을 delete할 수 없다', async () => {
    await testEnv!.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc(linkPath(UID_MEMBER_A)).set(validLink)
    })
    const db = testEnv!.authenticatedContext(UID_MEMBER_A).firestore()
    await assertFails(db.doc(linkPath(UID_MEMBER_A)).delete())
  })

  it('일반 사용자는 연결 기록 목록을 list할 수 없다', async () => {
    const db = testEnv!.authenticatedContext(UID_MEMBER_A).firestore()
    await assertFails(db.collection('clubs/skkubc/memberLinks').get())
  })

  it('활성 관리자는 연결 기록을 create할 수 있다', async () => {
    await seedAdmin(testEnv!, UID_ADMIN_ACTIVE, true)
    const db = testEnv!.authenticatedContext(UID_ADMIN_ACTIVE).firestore()
    await assertSucceeds(db.doc(linkPath(UID_MEMBER_A)).set(validLink))
  })

  it('활성 관리자는 연결 기록을 update할 수 있다', async () => {
    await seedAdmin(testEnv!, UID_ADMIN_ACTIVE, true)
    await testEnv!.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc(linkPath(UID_MEMBER_A)).set(validLink)
    })
    const db = testEnv!.authenticatedContext(UID_ADMIN_ACTIVE).firestore()
    await assertSucceeds(db.doc(linkPath(UID_MEMBER_A)).update({ active: false }))
  })

  it('활성 관리자는 연결 기록을 delete할 수 있다', async () => {
    await seedAdmin(testEnv!, UID_ADMIN_ACTIVE, true)
    await testEnv!.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc(linkPath(UID_MEMBER_A)).set(validLink)
    })
    const db = testEnv!.authenticatedContext(UID_ADMIN_ACTIVE).firestore()
    await assertSucceeds(db.doc(linkPath(UID_MEMBER_A)).delete())
  })

  it('활성 관리자는 연결 기록 목록을 list할 수 있다', async () => {
    await seedAdmin(testEnv!, UID_ADMIN_ACTIVE, true)
    const db = testEnv!.authenticatedContext(UID_ADMIN_ACTIVE).firestore()
    await assertSucceeds(db.collection('clubs/skkubc/memberLinks').get())
  })
})

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

describe.skipIf(!testEnv)('firestore.rules — clubs/{clubId}/linkRequests/{uid}', () => {
  afterAll(async () => {
    await testEnv!.cleanup()
  })

  beforeEach(async () => {
    await testEnv!.clearFirestore()
  })

  const requestPath = (uid: string) => `clubs/skkubc/linkRequests/${uid}`
  const validRequest = { memberId: MEMBER_TEST_ID, requestedAt: '2026-08-26T00:00:00+09:00' }

  it('본인 UID의 연결 요청 문서를 get할 수 있다', async () => {
    await testEnv!.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc(requestPath(UID_MEMBER_A)).set(validRequest)
    })
    const db = testEnv!.authenticatedContext(UID_MEMBER_A).firestore()
    await assertSucceeds(db.doc(requestPath(UID_MEMBER_A)).get())
  })

  it('다른 사람 UID의 연결 요청 문서는 get할 수 없다', async () => {
    await testEnv!.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc(requestPath(UID_MEMBER_B)).set(validRequest)
    })
    const db = testEnv!.authenticatedContext(UID_MEMBER_A).firestore()
    await assertFails(db.doc(requestPath(UID_MEMBER_B)).get())
  })

  it('memberId·requestedAt 두 필드만 담아 본인 요청을 생성할 수 있다', async () => {
    const db = testEnv!.authenticatedContext(UID_MEMBER_A).firestore()
    await assertSucceeds(db.doc(requestPath(UID_MEMBER_A)).set(validRequest))
  })

  it.each([
    ['role', { ...validRequest, role: 'admin' }],
    ['active', { ...validRequest, active: true }],
    ['approvedBy', { ...validRequest, approvedBy: 'someone' }],
    ['임의 관리자 필드(isSuperAdmin)', { ...validRequest, isSuperAdmin: true }],
  ])('%s 필드가 섞이면 요청 생성이 거부된다', async (_label, payload) => {
    const db = testEnv!.authenticatedContext(UID_MEMBER_A).firestore()
    await assertFails(db.doc(requestPath(UID_MEMBER_A)).set(payload))
  })

  it('다른 사람 UID 경로에는 연결 요청을 생성할 수 없다', async () => {
    const db = testEnv!.authenticatedContext(UID_MEMBER_A).firestore()
    await assertFails(db.doc(requestPath(UID_MEMBER_B)).set(validRequest))
  })

  it('연결 요청 문서의 update는 누구에게도 허용되지 않는다 (rules상 update 자체가 항상 거부)', async () => {
    await testEnv!.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc(requestPath(UID_MEMBER_A)).set(validRequest)
    })
    const db = testEnv!.authenticatedContext(UID_MEMBER_A).firestore()
    await assertFails(db.doc(requestPath(UID_MEMBER_A)).update({ memberId: 'other-member' }))
  })

  it('본인 연결 요청은 delete할 수 있다', async () => {
    await testEnv!.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc(requestPath(UID_MEMBER_A)).set(validRequest)
    })
    const db = testEnv!.authenticatedContext(UID_MEMBER_A).firestore()
    await assertSucceeds(db.doc(requestPath(UID_MEMBER_A)).delete())
  })

  it('일반 사용자는 연결 요청 목록을 list할 수 없다', async () => {
    const db = testEnv!.authenticatedContext(UID_MEMBER_A).firestore()
    await assertFails(db.collection('clubs/skkubc/linkRequests').get())
  })

  it('활성 관리자는 연결 요청 목록을 list할 수 있다', async () => {
    await seedAdmin(testEnv!, UID_ADMIN_ACTIVE, true)
    const db = testEnv!.authenticatedContext(UID_ADMIN_ACTIVE).firestore()
    await assertSucceeds(db.collection('clubs/skkubc/linkRequests').get())
  })
})

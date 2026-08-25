// @vitest-environment node
import { afterAll, beforeEach, describe, it } from 'vitest'
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import {
  createRulesTestEnv,
  MEMBER_ID_1,
  SPLIT_CLUB_ID,
  UID_ADMIN_ACTIVE,
  UID_MEMBER_ACTIVE,
  UID_MEMBER_INACTIVE,
  UID_UNLINKED,
  seedAdmin,
  seedMemberLink,
} from './support/testEnv'

const testEnv: RulesTestEnvironment | null = await createRulesTestEnv()

const SESSION_ID = 'session-001'

describe.skipIf(!testEnv)('firestore.rules — clubs/{clubId}/sessions/{sessionId} (split, 보안 4단계)', () => {
  afterAll(async () => {
    await testEnv!.cleanup()
  })

  beforeEach(async () => {
    await testEnv!.clearFirestore()
  })

  const sessionsCollectionPath = `clubs/${SPLIT_CLUB_ID}/sessions`
  const sessionPath = `${sessionsCollectionPath}/${SESSION_ID}`
  const sessionData = { id: SESSION_ID, date: '2026-08-26' }

  const seedSession = () =>
    testEnv!.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc(sessionPath).set(sessionData)
    })

  it('비인증 사용자는 세션을 read할 수 없다', async () => {
    await seedSession()
    const db = testEnv!.unauthenticatedContext().firestore()
    await assertFails(db.doc(sessionPath).get())
  })

  it('연결 안 된 인증 사용자는 세션을 read할 수 없다', async () => {
    await seedSession()
    const db = testEnv!.authenticatedContext(UID_UNLINKED).firestore()
    await assertFails(db.doc(sessionPath).get())
  })

  it('연결이 비활성인 사용자는 세션을 read할 수 없다', async () => {
    await seedSession()
    await seedMemberLink(testEnv!, SPLIT_CLUB_ID, UID_MEMBER_INACTIVE, MEMBER_ID_1, false)
    const db = testEnv!.authenticatedContext(UID_MEMBER_INACTIVE).firestore()
    await assertFails(db.doc(sessionPath).get())
  })

  it('활성 연결 회원은 세션 문서를 get할 수 있다', async () => {
    await seedSession()
    await seedMemberLink(testEnv!, SPLIT_CLUB_ID, UID_MEMBER_ACTIVE, MEMBER_ID_1, true)
    const db = testEnv!.authenticatedContext(UID_MEMBER_ACTIVE).firestore()
    await assertSucceeds(db.doc(sessionPath).get())
  })

  it('활성 연결 회원은 세션 목록을 list할 수 있다', async () => {
    await seedSession()
    await seedMemberLink(testEnv!, SPLIT_CLUB_ID, UID_MEMBER_ACTIVE, MEMBER_ID_1, true)
    const db = testEnv!.authenticatedContext(UID_MEMBER_ACTIVE).firestore()
    await assertSucceeds(db.collection(sessionsCollectionPath).get())
  })

  it('활성 연결 회원은 세션을 create·update·delete할 수 없다', async () => {
    await seedMemberLink(testEnv!, SPLIT_CLUB_ID, UID_MEMBER_ACTIVE, MEMBER_ID_1, true)
    const db = testEnv!.authenticatedContext(UID_MEMBER_ACTIVE).firestore()
    await assertFails(db.doc(sessionPath).set(sessionData))
    await seedSession()
    await assertFails(db.doc(sessionPath).update({ date: '2026-09-01' }))
    await assertFails(db.doc(sessionPath).delete())
  })

  it('활성 관리자는 세션을 read·list할 수 있다', async () => {
    await seedSession()
    await seedAdmin(testEnv!, UID_ADMIN_ACTIVE, true)
    const db = testEnv!.authenticatedContext(UID_ADMIN_ACTIVE).firestore()
    await assertSucceeds(db.doc(sessionPath).get())
    await assertSucceeds(db.collection(sessionsCollectionPath).get())
  })

  it('활성 관리자는 세션을 create·update·delete할 수 있다', async () => {
    await seedAdmin(testEnv!, UID_ADMIN_ACTIVE, true)
    const db = testEnv!.authenticatedContext(UID_ADMIN_ACTIVE).firestore()
    await assertSucceeds(db.doc(sessionPath).set(sessionData))
    await assertSucceeds(db.doc(sessionPath).update({ date: '2026-09-01' }))
    await assertSucceeds(db.doc(sessionPath).delete())
  })
})

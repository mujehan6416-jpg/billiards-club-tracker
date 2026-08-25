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

describe.skipIf(!testEnv)('firestore.rules — clubs/{clubId}/config/main (split, 보안 4단계)', () => {
  afterAll(async () => {
    await testEnv!.cleanup()
  })

  beforeEach(async () => {
    await testEnv!.clearFirestore()
  })

  const configPath = `clubs/${SPLIT_CLUB_ID}/config/main`
  const configData = { lastBackupAt: null }

  const seedConfig = () =>
    testEnv!.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc(configPath).set(configData)
    })

  it('비인증 사용자는 config/main을 read할 수 없다', async () => {
    await seedConfig()
    const db = testEnv!.unauthenticatedContext().firestore()
    await assertFails(db.doc(configPath).get())
  })

  it('연결 안 된 인증 사용자는 config/main을 read할 수 없다', async () => {
    await seedConfig()
    const db = testEnv!.authenticatedContext(UID_UNLINKED).firestore()
    await assertFails(db.doc(configPath).get())
  })

  it('연결이 비활성(inactive)인 사용자는 config/main을 read할 수 없다', async () => {
    await seedConfig()
    await seedMemberLink(testEnv!, SPLIT_CLUB_ID, UID_MEMBER_INACTIVE, MEMBER_ID_1, false)
    const db = testEnv!.authenticatedContext(UID_MEMBER_INACTIVE).firestore()
    await assertFails(db.doc(configPath).get())
  })

  it('활성 연결 회원은 config/main을 read할 수 있다', async () => {
    await seedConfig()
    await seedMemberLink(testEnv!, SPLIT_CLUB_ID, UID_MEMBER_ACTIVE, MEMBER_ID_1, true)
    const db = testEnv!.authenticatedContext(UID_MEMBER_ACTIVE).firestore()
    await assertSucceeds(db.doc(configPath).get())
  })

  it('활성 연결 회원은 config/main을 write할 수 없다', async () => {
    await seedMemberLink(testEnv!, SPLIT_CLUB_ID, UID_MEMBER_ACTIVE, MEMBER_ID_1, true)
    const db = testEnv!.authenticatedContext(UID_MEMBER_ACTIVE).firestore()
    await assertFails(db.doc(configPath).set(configData))
  })

  it('활성 관리자는 config/main을 read할 수 있다', async () => {
    await seedConfig()
    await seedAdmin(testEnv!, UID_ADMIN_ACTIVE, true)
    const db = testEnv!.authenticatedContext(UID_ADMIN_ACTIVE).firestore()
    await assertSucceeds(db.doc(configPath).get())
  })

  it('활성 관리자는 config/main을 write할 수 있다', async () => {
    await seedAdmin(testEnv!, UID_ADMIN_ACTIVE, true)
    const db = testEnv!.authenticatedContext(UID_ADMIN_ACTIVE).firestore()
    await assertSucceeds(db.doc(configPath).set(configData))
  })
})

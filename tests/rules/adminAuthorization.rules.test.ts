// @vitest-environment node
import { afterAll, beforeEach, describe, it } from 'vitest'
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { createRulesTestEnv, UID_ADMIN_ACTIVE, UID_ADMIN_DISABLED, UID_MEMBER_A, seedAdmin } from './support/testEnv'

const testEnv: RulesTestEnvironment | null = await createRulesTestEnv()

describe.skipIf(!testEnv)('firestore.rules — isAdmin() 판정', () => {
  afterAll(async () => {
    await testEnv!.cleanup()
  })

  beforeEach(async () => {
    await testEnv!.clearFirestore()
  })

  // isAdmin() 판정은 관리자만 허용되는 memberLinks / linkRequests list 권한을 통해 간접 검증한다.
  const memberLinksList = (uid: string) =>
    testEnv!.authenticatedContext(uid).firestore().collection('clubs/skkubc/memberLinks').get()
  const linkRequestsList = (uid: string) =>
    testEnv!.authenticatedContext(uid).firestore().collection('clubs/skkubc/linkRequests').get()

  it('Firebase Authentication이 되어 있다는 사실만으로는 admin 권한이 생기지 않는다', async () => {
    await assertFails(memberLinksList(UID_MEMBER_A))
  })

  it('admins/{uid} 문서가 아예 없으면 admin이 아니다', async () => {
    await assertFails(linkRequestsList(UID_MEMBER_A))
  })

  it('admins/{uid}.active가 false이면 admin이 아니다', async () => {
    await seedAdmin(testEnv!, UID_ADMIN_DISABLED, false)
    await assertFails(memberLinksList(UID_ADMIN_DISABLED))
  })

  it('admins/{uid}.active가 true인 경우에만 admin 권한이 적용된다', async () => {
    await seedAdmin(testEnv!, UID_ADMIN_ACTIVE, true)
    await assertSucceeds(memberLinksList(UID_ADMIN_ACTIVE))
  })
})

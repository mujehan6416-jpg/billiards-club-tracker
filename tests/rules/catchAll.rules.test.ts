// @vitest-environment node
import { afterAll, beforeEach, describe, it } from 'vitest'
import { assertFails, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { createRulesTestEnv, UID_MEMBER_A } from './support/testEnv'

const testEnv: RulesTestEnvironment | null = await createRulesTestEnv()

describe.skipIf(!testEnv)('firestore.rules — catch-all (명시되지 않은 경로)', () => {
  afterAll(async () => {
    await testEnv!.cleanup()
  })

  beforeEach(async () => {
    await testEnv!.clearFirestore()
  })

  const db = () => testEnv!.authenticatedContext(UID_MEMBER_A).firestore()

  it('명시적으로 허용되지 않은 임의 경로는 인증된 사용자도 read할 수 없다', async () => {
    await assertFails(db().doc('someRandomCollection/doc-1').get())
  })

  it('명시적으로 허용되지 않은 임의 경로는 인증된 사용자도 write할 수 없다', async () => {
    await assertFails(db().doc('someRandomCollection/doc-1').set({ hack: true }))
  })
})

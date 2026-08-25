// @vitest-environment node
import { afterAll, beforeEach, describe, it } from 'vitest'
import { assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { createRulesTestEnv } from './support/testEnv'

const testEnv: RulesTestEnvironment | null = await createRulesTestEnv()

/**
 * clubs/skkubc 문서는 현재 `allow read, write: if true`로 완전히 공개되어 있다.
 * 아래 두 테스트는 "지금 이렇게 동작한다"는 사실을 자동 테스트로 고정해 기록해 두는
 * 것이지, 이 상태가 안전하다고 승인하는 것이 아니다. legacy(단일 문서) 구조 호환을
 * 위해 남아 있는 보안 기술부채이며, 향후 split Firestore 구조로 완전히 전환한 뒤에는
 * 반드시 차단해야 한다. 이번 작업 범위에서는 firestore.rules 자체를 바꾸지 않으므로
 * 현재 상태를 있는 그대로만 기록한다.
 */
describe.skipIf(!testEnv)('firestore.rules — clubs/skkubc (legacy 공개 문서, 보안 기술부채)', () => {
  afterAll(async () => {
    await testEnv!.cleanup()
  })

  beforeEach(async () => {
    await testEnv!.clearFirestore()
  })

  it('[기술부채] 인증되지 않은 사용자도 clubs/skkubc를 read할 수 있다', async () => {
    const db = testEnv!.unauthenticatedContext().firestore()
    await assertSucceeds(db.doc('clubs/skkubc').get())
  })

  it('[기술부채] 인증되지 않은 사용자도 clubs/skkubc를 write할 수 있다', async () => {
    const db = testEnv!.unauthenticatedContext().firestore()
    await assertSucceeds(db.doc('clubs/skkubc').set({ probedBy: 'rules-test', at: '2026-08-26T00:00:00+09:00' }))
  })
})

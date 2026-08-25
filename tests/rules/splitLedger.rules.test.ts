// @vitest-environment node
import { afterAll, beforeEach, describe, it } from 'vitest'
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import {
  createRulesTestEnv,
  MEMBER_ID_1,
  SPLIT_CLUB_ID,
  UID_ADMIN_ACTIVE,
  UID_MEMBER_ACTIVE,
  UID_UNLINKED,
  seedAdmin,
  seedMemberLink,
} from './support/testEnv'

const testEnv: RulesTestEnvironment | null = await createRulesTestEnv()

const RECORD_ID = 'record-001'

describe.skipIf(!testEnv)('firestore.rules — clubs/{clubId}/ledger/{recordId} (split, 보안 4단계)', () => {
  afterAll(async () => {
    await testEnv!.cleanup()
  })

  beforeEach(async () => {
    await testEnv!.clearFirestore()
  })

  const ledgerCollectionPath = `clubs/${SPLIT_CLUB_ID}/ledger`
  const ledgerPath = `${ledgerCollectionPath}/${RECORD_ID}`
  const ledgerData = { id: RECORD_ID, type: 'dues', amount: 10000 }

  const seedRecord = () =>
    testEnv!.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc(ledgerPath).set(ledgerData)
    })

  it('비인증 사용자는 ledger를 read할 수 없다', async () => {
    await seedRecord()
    const db = testEnv!.unauthenticatedContext().firestore()
    await assertFails(db.doc(ledgerPath).get())
  })

  it('연결 안 된 인증 사용자는 ledger를 read할 수 없다', async () => {
    await seedRecord()
    const db = testEnv!.authenticatedContext(UID_UNLINKED).firestore()
    await assertFails(db.doc(ledgerPath).get())
  })

  it('활성 연결 회원(일반회원)은 ledger를 read할 수 없다', async () => {
    await seedRecord()
    await seedMemberLink(testEnv!, SPLIT_CLUB_ID, UID_MEMBER_ACTIVE, MEMBER_ID_1, true)
    const db = testEnv!.authenticatedContext(UID_MEMBER_ACTIVE).firestore()
    await assertFails(db.doc(ledgerPath).get())
  })

  it('활성 연결 회원(일반회원)은 ledger 목록을 list할 수 없다', async () => {
    await seedMemberLink(testEnv!, SPLIT_CLUB_ID, UID_MEMBER_ACTIVE, MEMBER_ID_1, true)
    const db = testEnv!.authenticatedContext(UID_MEMBER_ACTIVE).firestore()
    await assertFails(db.collection(ledgerCollectionPath).get())
  })

  it('활성 연결 회원은 ledger를 create·update·delete할 수 없다', async () => {
    await seedMemberLink(testEnv!, SPLIT_CLUB_ID, UID_MEMBER_ACTIVE, MEMBER_ID_1, true)
    const db = testEnv!.authenticatedContext(UID_MEMBER_ACTIVE).firestore()
    await assertFails(db.doc(ledgerPath).set(ledgerData))
    await seedRecord()
    await assertFails(db.doc(ledgerPath).update({ amount: 20000 }))
    await assertFails(db.doc(ledgerPath).delete())
  })

  it('활성 관리자는 ledger를 read·list할 수 있다', async () => {
    await seedRecord()
    await seedAdmin(testEnv!, UID_ADMIN_ACTIVE, true)
    const db = testEnv!.authenticatedContext(UID_ADMIN_ACTIVE).firestore()
    await assertSucceeds(db.doc(ledgerPath).get())
    await assertSucceeds(db.collection(ledgerCollectionPath).get())
  })

  it('활성 관리자는 ledger를 create·update·delete할 수 있다', async () => {
    await seedAdmin(testEnv!, UID_ADMIN_ACTIVE, true)
    const db = testEnv!.authenticatedContext(UID_ADMIN_ACTIVE).firestore()
    await assertSucceeds(db.doc(ledgerPath).set(ledgerData))
    await assertSucceeds(db.doc(ledgerPath).update({ amount: 20000 }))
    await assertSucceeds(db.doc(ledgerPath).delete())
  })
})

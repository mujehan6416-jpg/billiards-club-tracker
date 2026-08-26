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

/**
 * clubs/{clubId}/memberIndex — 최종 보안 마감 단계.
 *
 * 이 컬렉션의 존재 이유 자체가 "아직 연결 안 된 새 기기도 읽을 수 있어야 한다"이므로,
 * 다른 split 컬렉션(연결된 회원만 read)과 read 조건이 다르다는 점을 이 파일에서 명확히
 * 확인한다 — request.auth != null(로그인만 됐으면)이면 충분하고, hasActiveMemberLink는
 * 요구하지 않는다.
 */
describe.skipIf(!testEnv)('firestore.rules — clubs/{clubId}/memberIndex (최종 보안 마감)', () => {
  afterAll(async () => {
    await testEnv!.cleanup()
  })

  beforeEach(async () => {
    await testEnv!.clearFirestore()
  })

  const indexCollectionPath = `clubs/${SPLIT_CLUB_ID}/memberIndex`
  const indexPath = `${indexCollectionPath}/${MEMBER_ID_1}`
  const indexData = { id: MEMBER_ID_1, name: '가상회원', active: true }

  const seedIndex = () =>
    testEnv!.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc(indexPath).set(indexData)
    })

  it('비인증(로그인 전) 사용자는 read할 수 없다', async () => {
    await seedIndex()
    const db = testEnv!.unauthenticatedContext().firestore()
    await assertFails(db.doc(indexPath).get())
  })

  it('연결 안 된 인증(로그인만 된) 사용자도 get할 수 있다 — 이 컬렉션의 핵심 목적', async () => {
    await seedIndex()
    const db = testEnv!.authenticatedContext(UID_UNLINKED).firestore()
    await assertSucceeds(db.doc(indexPath).get())
  })

  it('연결 안 된 인증 사용자도 list(목록 조회)할 수 있다', async () => {
    await seedIndex()
    const db = testEnv!.authenticatedContext(UID_UNLINKED).firestore()
    await assertSucceeds(db.collection(indexCollectionPath).get())
  })

  it('연결이 비활성인 사용자도 read할 수 있다(연결 여부와 무관하게 로그인만 확인)', async () => {
    await seedIndex()
    await seedMemberLink(testEnv!, SPLIT_CLUB_ID, UID_MEMBER_INACTIVE, MEMBER_ID_1, false)
    const db = testEnv!.authenticatedContext(UID_MEMBER_INACTIVE).firestore()
    await assertSucceeds(db.doc(indexPath).get())
  })

  it('활성 연결 회원도 read할 수 있다', async () => {
    await seedIndex()
    await seedMemberLink(testEnv!, SPLIT_CLUB_ID, UID_MEMBER_ACTIVE, MEMBER_ID_1, true)
    const db = testEnv!.authenticatedContext(UID_MEMBER_ACTIVE).firestore()
    await assertSucceeds(db.doc(indexPath).get())
  })

  it('연결 안 된 사용자는 write할 수 없다(회원 목록을 스스로 조작 불가)', async () => {
    const db = testEnv!.authenticatedContext(UID_UNLINKED).firestore()
    await assertFails(db.doc(indexPath).set(indexData))
  })

  it('활성 연결 회원도 write할 수 없다', async () => {
    await seedMemberLink(testEnv!, SPLIT_CLUB_ID, UID_MEMBER_ACTIVE, MEMBER_ID_1, true)
    const db = testEnv!.authenticatedContext(UID_MEMBER_ACTIVE).firestore()
    await assertFails(db.doc(indexPath).set(indexData))
    await seedIndex()
    await assertFails(db.doc(indexPath).delete())
  })

  it('활성 관리자는 read·write 모두 할 수 있다', async () => {
    await seedAdmin(testEnv!, UID_ADMIN_ACTIVE, true)
    const db = testEnv!.authenticatedContext(UID_ADMIN_ACTIVE).firestore()
    await assertSucceeds(db.doc(indexPath).set(indexData))
    await assertSucceeds(db.doc(indexPath).get())
    await assertSucceeds(db.doc(indexPath).delete())
  })

  it('handicap처럼 실적 데이터에 해당하는 필드가 있어도 admin은 자유롭게 쓸 수 있지만(규칙상 제한 없음), 이 컬렉션에는 애초에 그런 필드를 넣지 않는 것이 애플리케이션 규칙이다', async () => {
    // Rules 자체는 memberIndex 필드를 제한하지 않는다(관리자 전용 컬렉션이라 admin 쓰기는
    // 무제한) — 실적 데이터를 넣지 않는 책임은 애플리케이션 코드(toMemberIndexEntry)에 있고
    // 이는 tests/splitAdminSync.test.ts, tests/splitAppState.test.ts에서 이미 확인한다.
    await seedAdmin(testEnv!, UID_ADMIN_ACTIVE, true)
    const db = testEnv!.authenticatedContext(UID_ADMIN_ACTIVE).firestore()
    await assertSucceeds(db.doc(indexPath).set({ ...indexData, displayTag: '90학번' }))
  })
})

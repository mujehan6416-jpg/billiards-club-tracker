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

// 이 파일에는 describe가 두 개 있다. cleanup()은 테스트 환경 자체를 없애므로 describe마다
// afterAll에서 부르면, 첫 번째 describe가 끝나는 순간 환경이 사라져 두 번째 describe의
// 테스트가 전부 실패한다. 그래서 정리는 파일 전체에서 딱 한 번만 한다.
afterAll(async () => {
  if (testEnv) await testEnv.cleanup()
})

beforeEach(async () => {
  if (testEnv) await testEnv.clearFirestore()
})

/**
 * clubs/skkubc (legacy 단일 문서) — 공개 접근 폐쇄 확인.
 *
 * 예전에는 이 문서에 앱 데이터 전체가 JSON으로 들어 있었고 규칙이 `if true`라 인증 없이
 * 누구나 읽고 쓸 수 있었다(보안 기술부채). split 구조 전환이 끝나고 정상 운영 경로에서 이
 * 문서를 쓰는 곳이 모두 없어져서 이제 완전히 닫았다.
 *
 * 이 파일은 "정말 아무도 접근할 수 없는지"를 신원별로 확인한다 — 관리자까지 포함해서 막는다.
 * 관리자도 막는 이유: 이 문서는 rollback용 보관물일 뿐 정상 운영에서 읽고 쓸 일이 없고,
 * 실수로 여기에 쓰면 split 데이터와 내용이 갈라지기 때문이다.
 */
describe.skipIf(!testEnv)('firestore.rules — clubs/skkubc (legacy 공개 접근 폐쇄)', () => {
  const legacyPath = 'clubs/skkubc'
  const payload = { probedBy: 'rules-test', at: '2026-08-27T00:00:00+09:00' }

  /** 규칙과 무관하게 문서를 미리 심어 둔다 — "문서가 없어서 실패"와 "권한 때문에 실패"를 구분한다. */
  const seedLegacyDoc = () =>
    testEnv!.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc(legacyPath).set({ data: '{}', updatedAt: '2026-08-01T00:00:00.000Z' })
    })

  it('인증되지 않은 사용자는 read할 수 없다', async () => {
    await seedLegacyDoc()
    const db = testEnv!.unauthenticatedContext().firestore()
    await assertFails(db.doc(legacyPath).get())
  })

  it('인증되지 않은 사용자는 write할 수 없다', async () => {
    const db = testEnv!.unauthenticatedContext().firestore()
    await assertFails(db.doc(legacyPath).set(payload))
  })

  it('로그인만 된(연결 안 된) 사용자도 read/write할 수 없다', async () => {
    await seedLegacyDoc()
    const db = testEnv!.authenticatedContext(UID_UNLINKED).firestore()
    await assertFails(db.doc(legacyPath).get())
    await assertFails(db.doc(legacyPath).set(payload))
  })

  it('연결된 활성 회원도 read/write할 수 없다', async () => {
    await seedLegacyDoc()
    await seedMemberLink(testEnv!, SPLIT_CLUB_ID, UID_MEMBER_ACTIVE, MEMBER_ID_1, true)
    const db = testEnv!.authenticatedContext(UID_MEMBER_ACTIVE).firestore()
    await assertFails(db.doc(legacyPath).get())
    await assertFails(db.doc(legacyPath).set(payload))
  })

  it('활성 관리자도 read/write할 수 없다 — rollback용 보관물이라 정상 운영에서 건드리지 않는다', async () => {
    await seedLegacyDoc()
    await seedAdmin(testEnv!, UID_ADMIN_ACTIVE, true)
    const db = testEnv!.authenticatedContext(UID_ADMIN_ACTIVE).firestore()
    await assertFails(db.doc(legacyPath).get())
    await assertFails(db.doc(legacyPath).set(payload))
  })

  it('삭제도 할 수 없다 — legacy 데이터는 보존되어야 한다', async () => {
    await seedLegacyDoc()
    await seedAdmin(testEnv!, UID_ADMIN_ACTIVE, true)
    const admin = testEnv!.authenticatedContext(UID_ADMIN_ACTIVE).firestore()
    await assertFails(admin.doc(legacyPath).delete())
    const anon = testEnv!.unauthenticatedContext().firestore()
    await assertFails(anon.doc(legacyPath).delete())
  })
})

/**
 * legacy 문서를 닫아도 하위 컬렉션 규칙은 전혀 영향을 받지 않아야 한다.
 *
 * Firestore 규칙은 문서 match(`match /clubs/skkubc`)가 하위 컬렉션으로 전파되지 않지만,
 * 그 사실에 의존하는 만큼 자동 테스트로 못 박아 둔다 — 특히 settlements는 경로가
 * `clubs/skkubc/settlements/{id}`로 legacy 문서 바로 아래에 있어 착각하기 쉽다.
 */
describe.skipIf(!testEnv)('firestore.rules — legacy 폐쇄가 하위 컬렉션에 영향을 주지 않는다', () => {
  it('settlements는 기존대로 관리자만 read/write할 수 있다', async () => {
    await seedAdmin(testEnv!, UID_ADMIN_ACTIVE, true)
    const admin = testEnv!.authenticatedContext(UID_ADMIN_ACTIVE).firestore()
    await assertSucceeds(admin.doc(`clubs/${SPLIT_CLUB_ID}/settlements/s1`).set({ id: 's1' }))
    await assertSucceeds(admin.doc(`clubs/${SPLIT_CLUB_ID}/settlements/s1`).get())
  })

  it('settlements는 연결된 회원에게는 여전히 막혀 있다', async () => {
    await seedMemberLink(testEnv!, SPLIT_CLUB_ID, UID_MEMBER_ACTIVE, MEMBER_ID_1, true)
    const db = testEnv!.authenticatedContext(UID_MEMBER_ACTIVE).firestore()
    await assertFails(db.doc(`clubs/${SPLIT_CLUB_ID}/settlements/s1`).get())
  })

  it('연결된 활성 회원의 split 데이터 조회는 그대로 동작한다', async () => {
    await seedMemberLink(testEnv!, SPLIT_CLUB_ID, UID_MEMBER_ACTIVE, MEMBER_ID_1, true)
    await testEnv!.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc(`clubs/${SPLIT_CLUB_ID}/members/${MEMBER_ID_1}`).set({ id: MEMBER_ID_1, name: '가상회원', active: true })
      await context.firestore().doc(`clubs/${SPLIT_CLUB_ID}/config/main`).set({ lastBackupAt: null })
      await context.firestore().doc(`clubs/${SPLIT_CLUB_ID}/sessions/s1`).set({ id: 's1', date: '2026-08-01' })
    })
    const db = testEnv!.authenticatedContext(UID_MEMBER_ACTIVE).firestore()

    await assertSucceeds(db.collection(`clubs/${SPLIT_CLUB_ID}/members`).get())
    await assertSucceeds(db.doc(`clubs/${SPLIT_CLUB_ID}/config/main`).get())
    await assertSucceeds(db.collection(`clubs/${SPLIT_CLUB_ID}/sessions`).get())
  })

  it('신규 기기 온보딩(memberIndex 조회 → 연결 요청)이 그대로 동작한다', async () => {
    await testEnv!.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc(`clubs/${SPLIT_CLUB_ID}/memberIndex/${MEMBER_ID_1}`).set({ id: MEMBER_ID_1, name: '가상회원', active: true })
    })
    const db = testEnv!.authenticatedContext(UID_UNLINKED).firestore()

    await assertSucceeds(db.collection(`clubs/${SPLIT_CLUB_ID}/memberIndex`).get())
    await assertSucceeds(db.doc(`clubs/${SPLIT_CLUB_ID}/linkRequests/${UID_UNLINKED}`).set({
      memberId: MEMBER_ID_1, requestedAt: '2026-08-27T00:00:00.000Z',
    }))
  })

  it('관리자의 split 쓰기(회원 수정)가 그대로 동작한다', async () => {
    await seedAdmin(testEnv!, UID_ADMIN_ACTIVE, true)
    const db = testEnv!.authenticatedContext(UID_ADMIN_ACTIVE).firestore()

    await assertSucceeds(db.doc(`clubs/${SPLIT_CLUB_ID}/members/${MEMBER_ID_1}`).set({
      id: MEMBER_ID_1, name: '가상회원', handicap: 20, handicapHistory: [], active: true,
    }))
    await assertSucceeds(db.doc(`clubs/${SPLIT_CLUB_ID}/memberIndex/${MEMBER_ID_1}`).set({
      id: MEMBER_ID_1, name: '가상회원', active: true,
    }))
  })

  it('관리자의 기기 연결 승인(memberLinks 생성)이 그대로 동작한다', async () => {
    await seedAdmin(testEnv!, UID_ADMIN_ACTIVE, true)
    const db = testEnv!.authenticatedContext(UID_ADMIN_ACTIVE).firestore()

    await assertSucceeds(db.doc(`clubs/${SPLIT_CLUB_ID}/memberLinks/${UID_UNLINKED}`).set({
      memberId: MEMBER_ID_1, role: 'member', active: true, linkedAt: '2026-08-27T00:00:00.000Z',
    }))
    await assertSucceeds(db.collection(`clubs/${SPLIT_CLUB_ID}/linkRequests`).get())
  })
})

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
const GAME_ID = 'game-001'

describe.skipIf(!testEnv)(
  'firestore.rules — clubs/{clubId}/sessions/{sessionId}/games/{gameId} (split, 보안 4단계)',
  () => {
    afterAll(async () => {
      await testEnv!.cleanup()
    })

    beforeEach(async () => {
      await testEnv!.clearFirestore()
    })

    const gamesCollectionPath = `clubs/${SPLIT_CLUB_ID}/sessions/${SESSION_ID}/games`
    const gamePath = `${gamesCollectionPath}/${GAME_ID}`
    const gameData = { id: GAME_ID, playerAId: 'p-a', playerBId: 'p-b', scoreA: 0, scoreB: 0 }

    const seedGame = () =>
      testEnv!.withSecurityRulesDisabled(async (context) => {
        await context.firestore().doc(gamePath).set(gameData)
      })

    it('비인증 사용자는 경기를 read할 수 없다', async () => {
      await seedGame()
      const db = testEnv!.unauthenticatedContext().firestore()
      await assertFails(db.doc(gamePath).get())
    })

    it('연결 안 된 인증 사용자는 경기를 read할 수 없다', async () => {
      await seedGame()
      const db = testEnv!.authenticatedContext(UID_UNLINKED).firestore()
      await assertFails(db.doc(gamePath).get())
    })

    it('연결이 비활성인 사용자는 경기를 read할 수 없다', async () => {
      await seedGame()
      await seedMemberLink(testEnv!, SPLIT_CLUB_ID, UID_MEMBER_INACTIVE, MEMBER_ID_1, false)
      const db = testEnv!.authenticatedContext(UID_MEMBER_INACTIVE).firestore()
      await assertFails(db.doc(gamePath).get())
    })

    it('활성 연결 회원은 경기 문서를 get할 수 있다', async () => {
      await seedGame()
      await seedMemberLink(testEnv!, SPLIT_CLUB_ID, UID_MEMBER_ACTIVE, MEMBER_ID_1, true)
      const db = testEnv!.authenticatedContext(UID_MEMBER_ACTIVE).firestore()
      await assertSucceeds(db.doc(gamePath).get())
    })

    it('활성 연결 회원은 경기 목록을 list할 수 있다', async () => {
      await seedGame()
      await seedMemberLink(testEnv!, SPLIT_CLUB_ID, UID_MEMBER_ACTIVE, MEMBER_ID_1, true)
      const db = testEnv!.authenticatedContext(UID_MEMBER_ACTIVE).firestore()
      await assertSucceeds(db.collection(gamesCollectionPath).get())
    })

    it('활성 연결 회원은 경기를 create할 수 없다', async () => {
      await seedMemberLink(testEnv!, SPLIT_CLUB_ID, UID_MEMBER_ACTIVE, MEMBER_ID_1, true)
      const db = testEnv!.authenticatedContext(UID_MEMBER_ACTIVE).firestore()
      await assertFails(db.doc(gamePath).set(gameData))
    })

    it('활성 연결 회원은 경기를 update할 수 없다', async () => {
      await seedGame()
      await seedMemberLink(testEnv!, SPLIT_CLUB_ID, UID_MEMBER_ACTIVE, MEMBER_ID_1, true)
      const db = testEnv!.authenticatedContext(UID_MEMBER_ACTIVE).firestore()
      await assertFails(db.doc(gamePath).update({ scoreA: 10 }))
    })

    it('활성 연결 회원은 경기를 delete할 수 없다', async () => {
      await seedGame()
      await seedMemberLink(testEnv!, SPLIT_CLUB_ID, UID_MEMBER_ACTIVE, MEMBER_ID_1, true)
      const db = testEnv!.authenticatedContext(UID_MEMBER_ACTIVE).firestore()
      await assertFails(db.doc(gamePath).delete())
    })

    it('활성 관리자는 경기를 read·list할 수 있다', async () => {
      await seedGame()
      await seedAdmin(testEnv!, UID_ADMIN_ACTIVE, true)
      const db = testEnv!.authenticatedContext(UID_ADMIN_ACTIVE).firestore()
      await assertSucceeds(db.doc(gamePath).get())
      await assertSucceeds(db.collection(gamesCollectionPath).get())
    })

    it('활성 관리자는 경기를 create·update·delete할 수 있다', async () => {
      await seedAdmin(testEnv!, UID_ADMIN_ACTIVE, true)
      const db = testEnv!.authenticatedContext(UID_ADMIN_ACTIVE).firestore()
      await assertSucceeds(db.doc(gamePath).set(gameData))
      await assertSucceeds(db.doc(gamePath).update({ scoreA: 10 }))
      await assertSucceeds(db.doc(gamePath).delete())
    })
  },
)

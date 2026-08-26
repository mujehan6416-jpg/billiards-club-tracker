// @vitest-environment node
import { afterAll, beforeEach, describe, it } from 'vitest'
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import {
  CLUB_A,
  CLUB_B,
  MEMBER_ID_1,
  MEMBER_ID_2,
  SPLIT_CLUB_ID,
  UID_ADMIN_ACTIVE,
  UID_MEMBER_ACTIVE,
  UID_MEMBER_INACTIVE,
  UID_UNLINKED,
  createRulesTestEnv,
  seedAdmin,
  seedMemberLink,
} from './support/testEnv'

const testEnv: RulesTestEnvironment | null = await createRulesTestEnv()

/**
 * 보안 7단계 — 연결된 활성 회원에게 실제로 필요한 최소 write 권한 확인.
 *
 * 기존 splitSessions/splitGames.rules.test.ts는 "회원은 세션·경기를 전혀 못 쓴다"는
 * 보안 4단계 기준선을 그대로 유지한다(비참가자·타입 미지정 세션 기준 fixture라 이번 단계와
 * 충돌하지 않는다). 이 파일은 그 위에 새로 열린 좁은 구멍(번개모임 생성·참석자 편집,
 * 본인 참가 경기의 pending 상태 제출·재제출·삭제)이 정확히 그만큼만 열려 있는지 확인한다.
 */
describe.skipIf(!testEnv)('firestore.rules — 회원 전용 split write (보안 7단계)', () => {
  afterAll(async () => {
    await testEnv!.cleanup()
  })

  beforeEach(async () => {
    await testEnv!.clearFirestore()
  })

  const sessionPath = (id: string, clubId = SPLIT_CLUB_ID) => `clubs/${clubId}/sessions/${id}`
  const gamePath = (sessionId: string, id: string, clubId = SPLIT_CLUB_ID) =>
    `clubs/${clubId}/sessions/${sessionId}/games/${id}`

  const seedDoc = (path: string, data: object) =>
    testEnv!.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc(path).set(data)
    })

  const asMember = () => testEnv!.authenticatedContext(UID_MEMBER_ACTIVE).firestore()
  const asOtherMember = () => testEnv!.authenticatedContext('uid-member-other').firestore()
  const linkActive = (clubId = SPLIT_CLUB_ID) => seedMemberLink(testEnv!, clubId, UID_MEMBER_ACTIVE, MEMBER_ID_1, true)
  const linkOtherActive = (clubId = SPLIT_CLUB_ID) =>
    seedMemberLink(testEnv!, clubId, 'uid-member-other', MEMBER_ID_2, true)

  // ── 세션: 번개모임 생성 ────────────────────────────────────────────
  describe('sessions — 번개모임 생성', () => {
    const FLASH_ID = 'flash-1'
    const flashData = (over: object = {}) => ({
      id: FLASH_ID, date: '2026-08-26', type: 'flash', attendeeIds: [MEMBER_ID_1], approved: false, ...over,
    })

    it('활성 연결 회원은 approved:false인 번개모임을 만들 수 있다', async () => {
      await linkActive()
      await assertSucceeds(asMember().doc(sessionPath(FLASH_ID)).set(flashData()))
    })

    it('활성 연결 회원은 스스로 approved:true로 만들 수 없다(자가 승인 차단)', async () => {
      await linkActive()
      await assertFails(asMember().doc(sessionPath(FLASH_ID)).set(flashData({ approved: true })))
    })

    it('활성 연결 회원은 type:regular(정기모임)로 만들 수 없다', async () => {
      await linkActive()
      await assertFails(asMember().doc(sessionPath(FLASH_ID)).set(flashData({ type: 'regular' })))
    })

    it('활성 연결 회원은 문서 id와 경로 sessionId가 다르면 만들 수 없다', async () => {
      await linkActive()
      await assertFails(asMember().doc(sessionPath(FLASH_ID)).set(flashData({ id: 'other-id' })))
    })

    it('활성 연결 회원은 허용되지 않은 필드(lineup 등)를 끼워 넣을 수 없다', async () => {
      await linkActive()
      await assertFails(asMember().doc(sessionPath(FLASH_ID)).set(flashData({ lineup: [] })))
    })

    it('연결 안 된 사용자는 번개모임을 만들 수 없다', async () => {
      const db = testEnv!.authenticatedContext(UID_UNLINKED).firestore()
      await assertFails(db.doc(sessionPath(FLASH_ID)).set(flashData()))
    })

    it('비활성 연결 사용자는 번개모임을 만들 수 없다', async () => {
      await seedMemberLink(testEnv!, SPLIT_CLUB_ID, UID_MEMBER_INACTIVE, MEMBER_ID_1, false)
      const db = testEnv!.authenticatedContext(UID_MEMBER_INACTIVE).firestore()
      await assertFails(db.doc(sessionPath(FLASH_ID)).set(flashData()))
    })

    it('다른 클럽에만 연결된 회원은 이 클럽에 번개모임을 만들 수 없다', async () => {
      await seedMemberLink(testEnv!, CLUB_A, UID_MEMBER_ACTIVE, MEMBER_ID_1, true)
      const db = testEnv!.authenticatedContext(UID_MEMBER_ACTIVE).firestore()
      await assertFails(db.doc(sessionPath(FLASH_ID, CLUB_B)).set(flashData()))
    })
  })

  // ── 세션: 번개모임 수정(참석자) ────────────────────────────────────
  describe('sessions — 번개모임 참석자 편집', () => {
    const FLASH_ID = 'flash-1'
    const seedFlash = (over: object = {}) =>
      seedDoc(sessionPath(FLASH_ID), { id: FLASH_ID, date: '2026-08-26', type: 'flash', attendeeIds: [MEMBER_ID_1], approved: false, ...over })

    it('활성 연결 회원은 attendeeIds만 바꿀 수 있다', async () => {
      await seedFlash()
      await linkActive()
      await assertSucceeds(asMember().doc(sessionPath(FLASH_ID)).update({ attendeeIds: [MEMBER_ID_1, MEMBER_ID_2] }))
    })

    it('활성 연결 회원은 attendeeIds와 approved를 함께 바꿀 수 없다(자가 승인 차단)', async () => {
      await seedFlash()
      await linkActive()
      await assertFails(
        asMember().doc(sessionPath(FLASH_ID)).update({ attendeeIds: [MEMBER_ID_1, MEMBER_ID_2], approved: true }),
      )
    })

    it('활성 연결 회원은 approved만 단독으로도 바꿀 수 없다', async () => {
      await seedFlash()
      await linkActive()
      await assertFails(asMember().doc(sessionPath(FLASH_ID)).update({ approved: true }))
    })

    it('활성 연결 회원은 type을 regular로 바꿀 수 없다', async () => {
      await seedFlash()
      await linkActive()
      await assertFails(asMember().doc(sessionPath(FLASH_ID)).update({ type: 'regular' }))
    })

    it('활성 연결 회원은 정기모임(type 미지정)의 attendeeIds는 바꿀 수 없다', async () => {
      const REGULAR_ID = 'regular-1'
      await seedDoc(sessionPath(REGULAR_ID), { id: REGULAR_ID, date: '2026-08-26', attendeeIds: [MEMBER_ID_1] })
      await linkActive()
      await assertFails(asMember().doc(sessionPath(REGULAR_ID)).update({ attendeeIds: [MEMBER_ID_1, MEMBER_ID_2] }))
    })
  })

  // ── 세션: 삭제는 관리자 전용 ───────────────────────────────────────
  describe('sessions — 삭제', () => {
    const FLASH_ID = 'flash-1'
    const seedFlash = () =>
      seedDoc(sessionPath(FLASH_ID), { id: FLASH_ID, date: '2026-08-26', type: 'flash', attendeeIds: [MEMBER_ID_1], approved: false })

    it('활성 연결 회원은 번개모임이라도 세션을 삭제할 수 없다', async () => {
      await seedFlash()
      await linkActive()
      await assertFails(asMember().doc(sessionPath(FLASH_ID)).delete())
    })

    it('활성 관리자는 번개모임 세션을 삭제할 수 있다', async () => {
      await seedFlash()
      await seedAdmin(testEnv!, UID_ADMIN_ACTIVE, true)
      const db = testEnv!.authenticatedContext(UID_ADMIN_ACTIVE).firestore()
      await assertSucceeds(db.doc(sessionPath(FLASH_ID)).delete())
    })
  })

  // ── 경기: 생성 ─────────────────────────────────────────────────────
  describe('games — 생성', () => {
    const REGULAR_ID = 'regular-1'
    const FLASH_ID = 'flash-1'
    const GAME_ID = 'game-1'
    const pendingGame = (over: object = {}) => ({
      id: GAME_ID, playerAId: MEMBER_ID_1, playerBId: MEMBER_ID_2,
      handicapA: 18, handicapB: 20, scoreA: 10, scoreB: 12,
      endType: 'time', playedAt: '2026-08-26T10:00:00.000Z', pending: true, ...over,
    })

    it('정기모임 참가자 본인은 pending:true 경기를 만들 수 있다', async () => {
      await seedDoc(sessionPath(REGULAR_ID), { id: REGULAR_ID, date: '2026-08-26', attendeeIds: [MEMBER_ID_1, MEMBER_ID_2] })
      await linkActive()
      await assertSucceeds(asMember().doc(gamePath(REGULAR_ID, GAME_ID)).set(pendingGame()))
    })

    it('정기모임에서 참가자가 아닌 회원은 남의 경기를 만들 수 없다', async () => {
      await seedDoc(sessionPath(REGULAR_ID), { id: REGULAR_ID, date: '2026-08-26', attendeeIds: [MEMBER_ID_1, MEMBER_ID_2] })
      await linkOtherActive() // uid-member-other → MEMBER_ID_2, 이 게임엔 A/B로 안 씀
      await assertFails(
        asOtherMember().doc(gamePath(REGULAR_ID, GAME_ID)).set(pendingGame({ playerAId: MEMBER_ID_1, playerBId: 'member-003' })),
      )
    })

    it('번개모임은 참가자가 아닌 연결 회원도(대리 입력) 경기를 만들 수 있다', async () => {
      await seedDoc(sessionPath(FLASH_ID), { id: FLASH_ID, date: '2026-08-26', type: 'flash', attendeeIds: [MEMBER_ID_1, MEMBER_ID_2], approved: false })
      await linkActive() // MEMBER_ID_1은 이 경기의 A/B가 아님
      await assertSucceeds(
        asMember().doc(gamePath(FLASH_ID, GAME_ID)).set(pendingGame({ playerAId: MEMBER_ID_2, playerBId: 'member-003' })),
      )
    })

    it('회원은 pending:false(자기 확정)로 만들 수 없다', async () => {
      await seedDoc(sessionPath(REGULAR_ID), { id: REGULAR_ID, date: '2026-08-26', attendeeIds: [MEMBER_ID_1, MEMBER_ID_2] })
      await linkActive()
      await assertFails(asMember().doc(gamePath(REGULAR_ID, GAME_ID)).set(pendingGame({ pending: false })))
    })

    it('회원은 winnerId 같은 관리자 전용 필드를 끼워 넣을 수 없다', async () => {
      await seedDoc(sessionPath(REGULAR_ID), { id: REGULAR_ID, date: '2026-08-26', attendeeIds: [MEMBER_ID_1, MEMBER_ID_2] })
      await linkActive()
      await assertFails(asMember().doc(gamePath(REGULAR_ID, GAME_ID)).set(pendingGame({ winnerId: MEMBER_ID_1 })))
    })

    it('연결 안 된 사용자는 경기를 만들 수 없다', async () => {
      await seedDoc(sessionPath(FLASH_ID), { id: FLASH_ID, date: '2026-08-26', type: 'flash', attendeeIds: [MEMBER_ID_1], approved: false })
      const db = testEnv!.authenticatedContext(UID_UNLINKED).firestore()
      await assertFails(db.doc(gamePath(FLASH_ID, GAME_ID)).set(pendingGame()))
    })

    it('비활성 연결 사용자는 경기를 만들 수 없다', async () => {
      await seedDoc(sessionPath(FLASH_ID), { id: FLASH_ID, date: '2026-08-26', type: 'flash', attendeeIds: [MEMBER_ID_1], approved: false })
      await seedMemberLink(testEnv!, SPLIT_CLUB_ID, UID_MEMBER_INACTIVE, MEMBER_ID_1, false)
      const db = testEnv!.authenticatedContext(UID_MEMBER_INACTIVE).firestore()
      await assertFails(db.doc(gamePath(FLASH_ID, GAME_ID)).set(pendingGame()))
    })

    it('다른 클럽에만 연결된 회원은 이 클럽에 경기를 만들 수 없다', async () => {
      await seedDoc(sessionPath(FLASH_ID, CLUB_B), { id: FLASH_ID, date: '2026-08-26', type: 'flash', attendeeIds: [MEMBER_ID_1], approved: false })
      await seedMemberLink(testEnv!, CLUB_A, UID_MEMBER_ACTIVE, MEMBER_ID_1, true)
      const db = testEnv!.authenticatedContext(UID_MEMBER_ACTIVE).firestore()
      await assertFails(db.doc(gamePath(FLASH_ID, GAME_ID, CLUB_B)).set(pendingGame()))
    })
  })

  // ── 경기: 수정(재제출) ────────────────────────────────────────────
  describe('games — 수정(재제출)', () => {
    const SESSION_ID = 'regular-1'
    const GAME_ID = 'game-1'
    // playerBId는 MEMBER_ID_2가 아니라 이 describe 블록과 무관한 제3자('member-003')로 둔다 —
    // linkOtherActive()가 MEMBER_ID_2에 연결돼 있으므로, 여기서 MEMBER_ID_2를 참가자로 넣으면
    // "참가자가 아닌 회원" 테스트가 실제로는 본인 확인이 되어버려 의도와 반대로 통과해 버린다.
    const seedGame = (over: object = {}) =>
      seedDoc(gamePath(SESSION_ID, GAME_ID), {
        id: GAME_ID, playerAId: MEMBER_ID_1, playerBId: 'member-003',
        handicapA: 18, handicapB: 20, scoreA: 10, scoreB: 12,
        endType: 'time', playedAt: '2026-08-26T10:00:00.000Z',
        pending: true, revisionRequested: true, ...over,
      })

    it('참가자 본인은 pending 상태인 자기 경기를 재제출할 수 있다', async () => {
      await seedGame()
      await linkActive()
      await assertSucceeds(
        asMember().doc(gamePath(SESSION_ID, GAME_ID)).update({ scoreA: 15, scoreB: 18, endType: 'cleared', pending: true, revisionRequested: false }),
      )
    })

    it('참가자 본인이라도 이미 확정(pending:false)된 경기는 다시 pending으로 되돌릴 수 없다', async () => {
      await seedGame({ pending: false, revisionRequested: false })
      await linkActive()
      await assertFails(
        asMember().doc(gamePath(SESSION_ID, GAME_ID)).update({ scoreA: 99, pending: true, revisionRequested: false }),
      )
    })

    it('참가자 본인은 스스로 pending:false(자기 확정)로 바꿀 수 없다', async () => {
      await seedGame()
      await linkActive()
      await assertFails(
        asMember().doc(gamePath(SESSION_ID, GAME_ID)).update({ scoreA: 15, pending: false, revisionRequested: false }),
      )
    })

    it('참가자 본인이라도 handicapA·playerAId 같은 필드는 바꿀 수 없다', async () => {
      await seedGame()
      await linkActive()
      await assertFails(
        asMember().doc(gamePath(SESSION_ID, GAME_ID)).update({ handicapA: 30, pending: true, revisionRequested: false }),
      )
    })

    it('참가자가 아닌 회원은 남의 경기를 재제출할 수 없다', async () => {
      await seedGame()
      await linkOtherActive()
      await assertFails(
        asOtherMember().doc(gamePath(SESSION_ID, GAME_ID)).update({ scoreA: 15, pending: true, revisionRequested: false }),
      )
    })
  })

  // ── 경기: 삭제 ─────────────────────────────────────────────────────
  describe('games — 삭제', () => {
    const SESSION_ID = 'flash-1'
    const GAME_ID = 'game-1'
    // playerBId는 MEMBER_ID_2가 아니라 제3자('member-003')로 둔다 — 이유는 위 "게임 수정" 블록과 같다.
    const seedGame = (over: object = {}) =>
      seedDoc(gamePath(SESSION_ID, GAME_ID), {
        id: GAME_ID, playerAId: MEMBER_ID_1, playerBId: 'member-003',
        handicapA: 18, handicapB: 20, scoreA: 10, scoreB: 12,
        endType: 'time', playedAt: '2026-08-26T10:00:00.000Z', pending: true, ...over,
      })

    it('참가자 본인은 아직 확정 전(pending)인 자기 경기를 지울 수 있다', async () => {
      await seedGame()
      await linkActive()
      await assertSucceeds(asMember().doc(gamePath(SESSION_ID, GAME_ID)).delete())
    })

    it('참가자 본인이라도 이미 확정(pending:false)된 경기는 지울 수 없다', async () => {
      await seedGame({ pending: false })
      await linkActive()
      await assertFails(asMember().doc(gamePath(SESSION_ID, GAME_ID)).delete())
    })

    it('참가자가 아닌 연결 회원은 같은 번개모임이라도 남의 경기를 지울 수 없다', async () => {
      await seedGame()
      await linkOtherActive()
      await assertFails(asOtherMember().doc(gamePath(SESSION_ID, GAME_ID)).delete())
    })

    it('활성 관리자는 확정된 경기도 지울 수 있다', async () => {
      await seedGame({ pending: false })
      await seedAdmin(testEnv!, UID_ADMIN_ACTIVE, true)
      const db = testEnv!.authenticatedContext(UID_ADMIN_ACTIVE).firestore()
      await assertSucceeds(db.doc(gamePath(SESSION_ID, GAME_ID)).delete())
    })
  })
})

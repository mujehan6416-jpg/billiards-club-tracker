// @vitest-environment node
import { afterAll, beforeEach, describe, it } from 'vitest'
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { UID_ADMIN_ACTIVE, createRulesTestEnv, seedAdmin, seedMemberLink } from './support/testEnv'

const testEnv: RulesTestEnvironment | null = await createRulesTestEnv()

/**
 * 대회 토너먼트 Rules 검증.
 *
 * 확인하려는 핵심은 넷이다.
 *   ① 관리자 전용 추첨 매핑(private/draw)을 회원이 읽을 수 없다
 *   ② 결과를 입력한 사람이 같은 경기를 스스로 확인할 수 없다 — 기기를 바꿔도 마찬가지다
 *   ③ 회원은 공식 승패·다음 라운드 배치를 만들 수 없다
 *   ④ 다른 모임(club)의 대회 데이터에 접근할 수 없다
 *
 * 여기 나오는 ID는 전부 가상값이다 — 실제 회원 정보·운영 Firebase와 무관하다.
 */

// 가상 모임 · 가상 회원 · 가상 기기
const CLUB_T = 'club-tournament-a'
const CLUB_OTHER = 'club-tournament-b'
const MEMBER_A = 'member-a'
const MEMBER_B = 'member-b'
const MEMBER_OUTSIDER = 'member-outsider'
/** 같은 회원(member-a)이 쓰는 서로 다른 기기 두 대. ②를 검증하는 핵심 fixture다. */
const UID_A1 = 'uid-player-a-1'
const UID_A2 = 'uid-player-a-2'
const UID_B = 'uid-player-b'
const UID_OUTSIDER = 'uid-outsider'
const UID_OTHER_CLUB = 'uid-other-club-member'

const TID = 'tournament-1'
const AT = '2026-09-01T10:00:00.000Z'

describe.skipIf(!testEnv)('firestore.rules — 대회 토너먼트', () => {
  afterAll(async () => {
    await testEnv!.cleanup()
  })

  beforeEach(async () => {
    await testEnv!.clearFirestore()
  })

  // ── 경로 ──
  const tournamentPath = (clubId = CLUB_T) => `clubs/${clubId}/tournaments/${TID}`
  const participantPath = (pid: string, clubId = CLUB_T) => `${tournamentPath(clubId)}/participants/${pid}`
  const matchPath = (mid: string, clubId = CLUB_T) => `${tournamentPath(clubId)}/matches/${mid}`
  const drawPath = (clubId = CLUB_T) => `${tournamentPath(clubId)}/private/draw`

  const seedDoc = (path: string, data: object) =>
    testEnv!.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc(path).set(data)
    })

  // ── 사용자 ──
  const asAdmin = () => testEnv!.authenticatedContext(UID_ADMIN_ACTIVE).firestore()
  const asPlayerA1 = () => testEnv!.authenticatedContext(UID_A1).firestore()
  const asPlayerA2 = () => testEnv!.authenticatedContext(UID_A2).firestore()
  const asPlayerB = () => testEnv!.authenticatedContext(UID_B).firestore()
  const asOutsider = () => testEnv!.authenticatedContext(UID_OUTSIDER).firestore()
  const asOtherClubMember = () => testEnv!.authenticatedContext(UID_OTHER_CLUB).firestore()
  const asUnauthenticated = () => testEnv!.unauthenticatedContext().firestore()

  /** 이 대회에 필요한 기기 연결을 전부 심는다(회원 A는 기기 두 대). */
  async function linkEveryone() {
    await seedAdmin(testEnv!, UID_ADMIN_ACTIVE, true)
    await seedMemberLink(testEnv!, CLUB_T, UID_A1, MEMBER_A, true)
    await seedMemberLink(testEnv!, CLUB_T, UID_A2, MEMBER_A, true)
    await seedMemberLink(testEnv!, CLUB_T, UID_B, MEMBER_B, true)
    await seedMemberLink(testEnv!, CLUB_T, UID_OUTSIDER, MEMBER_OUTSIDER, true)
    await seedMemberLink(testEnv!, CLUB_OTHER, UID_OTHER_CLUB, MEMBER_A, true)
  }

  // ── 문서 모양 ──
  const tournamentData = (over: object = {}) => ({
    id: TID, name: '가상 대회', date: '2026-09-01', timeLimitMinutes: 60,
    status: 'bracketFixed', createdAt: AT, ...over,
  })

  const participantData = (pid: string, memberId: string, over: object = {}) => ({
    id: pid, memberId, displayNameSnapshot: '가상참가자',
    baseHandicapSnapshot: 20, tournamentHandicap: 20, entryStatus: 'entered', ...over,
  })

  const drawData = { bracketSize: 4, byeSlots: [4], numberToSlot: { 1: 3, 2: 1, 3: 2 } }

  const matchData = (over: object = {}) => ({
    id: 'r1m1', roundNumber: 1, playerCountInRound: 4, matchNumber: 1,
    playerAParticipantId: 'participant-a', playerBParticipantId: 'participant-b',
    playerAMemberId: MEMBER_A, playerBMemberId: MEMBER_B,
    playerAHandicapSnapshot: 20, playerBHandicapSnapshot: 20,
    scoreA: null, scoreB: null,
    resultType: 'normal', status: 'awaitingResult',
    nextMatchId: 'r2m1', nextSlot: 'playerA',
    ...over,
  })

  /** 회원 A가 결과를 넣어 상대 확인을 기다리는 상태. */
  const submittedByA = (over: object = {}) => matchData({
    scoreA: 18, scoreB: 15, calculatedWinnerParticipantId: 'participant-a',
    status: 'awaitingVerification',
    resultLog: { submittedByMemberId: MEMBER_A, submittedAt: AT, correctionRequested: false },
    ...over,
  })

  // ── service가 실제로 보내는 payload와 똑같은 모양 ──
  const submitPatch = (me: string, over: object = {}) => ({
    scoreA: 18, scoreB: 15, calculatedWinnerParticipantId: 'participant-a',
    status: 'awaitingVerification',
    resultLog: { submittedByMemberId: me, submittedAt: AT, correctionRequested: false },
    ...over,
  })

  const verifyPatch = (me: string, over: object = {}) => ({
    status: 'awaitingApproval',
    resultLog: {
      submittedByMemberId: MEMBER_A, submittedAt: AT, correctionRequested: false,
      verificationType: 'player', verifiedByMemberId: me, verifiedAt: AT,
    },
    ...over,
  })

  const correctionPatch = (me: string, over: object = {}) => ({
    resultLog: {
      submittedByMemberId: MEMBER_A, submittedAt: AT, correctionRequested: true,
      correctionRequestedByMemberId: me, correctionRequestedAt: AT,
    },
    ...over,
  })

  // ══════════════════════════════════════════════════════════════
  describe('대회 기본 문서', () => {
    it('관리자는 대회를 만들 수 있다', async () => {
      await linkEveryone()
      await assertSucceeds(asAdmin().doc(tournamentPath()).set(tournamentData()))
    })

    it('연결된 회원은 대회를 읽을 수 있다', async () => {
      await linkEveryone()
      await seedDoc(tournamentPath(), tournamentData())
      await assertSucceeds(asPlayerA1().doc(tournamentPath()).get())
    })

    it('연결된 회원은 대회를 고칠 수 없다', async () => {
      await linkEveryone()
      await seedDoc(tournamentPath(), tournamentData())
      await assertFails(asPlayerA1().doc(tournamentPath()).update({ name: '내가 바꾼 이름' }))
    })

    it('연결된 회원은 대회를 만들 수 없다', async () => {
      await linkEveryone()
      await assertFails(asPlayerA1().doc(tournamentPath()).set(tournamentData()))
    })

    it('연결 안 된 사용자는 대회를 읽을 수 없다', async () => {
      await seedDoc(tournamentPath(), tournamentData())
      await assertFails(asOutsider().doc(tournamentPath()).get())
    })

    it('로그인하지 않은 사용자는 대회를 읽을 수 없다', async () => {
      await seedDoc(tournamentPath(), tournamentData())
      await assertFails(asUnauthenticated().doc(tournamentPath()).get())
    })

    it('다른 모임 회원은 이 모임 대회를 읽을 수 없다', async () => {
      await linkEveryone()
      await seedDoc(tournamentPath(), tournamentData())
      await assertFails(asOtherClubMember().doc(tournamentPath()).get())
    })
  })

  // ══════════════════════════════════════════════════════════════
  describe('참가자', () => {
    it('연결된 회원은 참가자 명단을 읽을 수 있다', async () => {
      await linkEveryone()
      await seedDoc(participantPath('participant-a'), participantData('participant-a', MEMBER_A))
      await assertSucceeds(asPlayerA1().doc(participantPath('participant-a')).get())
      await assertSucceeds(asPlayerA1().collection(`${tournamentPath()}/participants`).get())
    })

    it('관리자는 참가자를 만들 수 있다', async () => {
      await linkEveryone()
      await assertSucceeds(
        asAdmin().doc(participantPath('participant-a')).set(participantData('participant-a', MEMBER_A)),
      )
    })

    it('관리자는 참가자를 고칠 수 있다 (제외·핸디 조정·추첨번호 기록)', async () => {
      await linkEveryone()
      await seedDoc(participantPath('participant-a'), participantData('participant-a', MEMBER_A))
      const ref = asAdmin().doc(participantPath('participant-a'))
      await assertSucceeds(ref.update({ entryStatus: 'excluded', excludedByAdminUid: UID_ADMIN_ACTIVE, excludedAt: AT }))
      await assertSucceeds(ref.update({ tournamentHandicap: 18 }))
      await assertSucceeds(ref.update({ drawNumber: 3 }))
    })

    it('일반 회원은 참가자 문서를 고칠 수 없다 (자기 문서라도)', async () => {
      await linkEveryone()
      await seedDoc(participantPath('participant-a'), participantData('participant-a', MEMBER_A))
      await assertFails(asPlayerA1().doc(participantPath('participant-a')).update({ tournamentHandicap: 5 }))
      await assertFails(asPlayerA1().doc(participantPath('participant-a')).update({ entryStatus: 'excluded' }))
      await assertFails(asPlayerA1().doc(participantPath('participant-a')).update({ drawNumber: 1 }))
    })

    it('다른 모임 회원은 이 모임 참가자를 읽을 수 없다', async () => {
      await linkEveryone()
      await seedDoc(participantPath('participant-a'), participantData('participant-a', MEMBER_A))
      await assertFails(asOtherClubMember().doc(participantPath('participant-a')).get())
    })
  })

  // ══════════════════════════════════════════════════════════════
  describe('관리자 전용 추첨 매핑 (private/draw)', () => {
    it('관리자는 읽을 수 있다', async () => {
      await linkEveryone()
      await seedDoc(drawPath(), drawData)
      await assertSucceeds(asAdmin().doc(drawPath()).get())
    })

    it('관리자는 쓸 수 있다', async () => {
      await linkEveryone()
      await assertSucceeds(asAdmin().doc(drawPath()).set(drawData))
    })

    it('★ 연결된 정상 회원도 추첨 매핑을 읽을 수 없다 (부전승 위치 은닉)', async () => {
      await linkEveryone()
      await seedDoc(drawPath(), drawData)
      await assertFails(asPlayerA1().doc(drawPath()).get())
      await assertFails(asPlayerB().doc(drawPath()).get())
    })

    it('★ 연결된 회원은 private 컬렉션 목록도 볼 수 없다', async () => {
      await linkEveryone()
      await seedDoc(drawPath(), drawData)
      await assertFails(asPlayerA1().collection(`${tournamentPath()}/private`).get())
    })

    it('연결된 회원은 추첨 매핑을 쓸 수도 없다', async () => {
      await linkEveryone()
      await assertFails(asPlayerA1().doc(drawPath()).set(drawData))
    })

    it('다른 모임 회원·비연결 사용자도 접근할 수 없다', async () => {
      await linkEveryone()
      await seedDoc(drawPath(), drawData)
      await assertFails(asOtherClubMember().doc(drawPath()).get())
      await assertFails(asOutsider().doc(drawPath()).get())
      await assertFails(asUnauthenticated().doc(drawPath()).get())
    })
  })

  // ══════════════════════════════════════════════════════════════
  describe('경기 읽기', () => {
    it('연결된 회원은 경기를 읽을 수 있다', async () => {
      await linkEveryone()
      await seedDoc(matchPath('r1m1'), matchData())
      await assertSucceeds(asPlayerA1().doc(matchPath('r1m1')).get())
      await assertSucceeds(asPlayerA1().collection(`${tournamentPath()}/matches`).get())
    })

    it('연결 안 된 사용자는 경기를 읽을 수 없다', async () => {
      await seedDoc(matchPath('r1m1'), matchData())
      await assertFails(asOutsider().doc(matchPath('r1m1')).get())
    })

    it('다른 모임 회원은 이 모임 경기를 읽을 수 없다', async () => {
      await linkEveryone()
      await seedDoc(matchPath('r1m1'), matchData())
      await assertFails(asOtherClubMember().doc(matchPath('r1m1')).get())
    })

    it('회원은 경기를 만들거나 지울 수 없다 (대진 생성·취소는 관리자 작업)', async () => {
      await linkEveryone()
      await assertFails(asPlayerA1().doc(matchPath('r9m9')).set(matchData()))
      await seedDoc(matchPath('r1m1'), matchData())
      await assertFails(asPlayerA1().doc(matchPath('r1m1')).delete())
    })
  })

  // ══════════════════════════════════════════════════════════════
  describe('회원 결과 제출', () => {
    beforeEach(async () => {
      await linkEveryone()
      await seedDoc(matchPath('r1m1'), matchData())
    })

    it('A쪽 선수는 자기 경기 결과를 제출할 수 있다', async () => {
      await assertSucceeds(asPlayerA1().doc(matchPath('r1m1')).update(submitPatch(MEMBER_A)))
    })

    it('B쪽 선수도 자기 경기 결과를 제출할 수 있다', async () => {
      await assertSucceeds(asPlayerB().doc(matchPath('r1m1')).update(submitPatch(MEMBER_B)))
    })

    it('이 경기에 나오지 않은 회원은 제출할 수 없다', async () => {
      await assertFails(asOutsider().doc(matchPath('r1m1')).update(submitPatch(MEMBER_OUTSIDER)))
    })

    it('다른 모임 사용자는 제출할 수 없다', async () => {
      await assertFails(asOtherClubMember().doc(matchPath('r1m1')).update(submitPatch(MEMBER_A)))
    })

    it('남의 이름으로 제출할 수 없다 (제출자를 상대로 적기)', async () => {
      await assertFails(asPlayerA1().doc(matchPath('r1m1')).update(submitPatch(MEMBER_B)))
    })

    it('제출하면서 공식 승자를 함께 쓸 수 없다', async () => {
      await assertFails(
        asPlayerA1().doc(matchPath('r1m1'))
          .update(submitPatch(MEMBER_A, { officialWinnerParticipantId: 'participant-a' })),
      )
    })

    it('제출하면서 곧바로 공식 확정할 수 없다', async () => {
      await assertFails(
        asPlayerA1().doc(matchPath('r1m1')).update(submitPatch(MEMBER_A, { status: 'official' })),
      )
    })

    it('적용 핸디 스냅샷을 바꿀 수 없다', async () => {
      await assertFails(
        asPlayerA1().doc(matchPath('r1m1')).update(submitPatch(MEMBER_A, { playerAHandicapSnapshot: 5 })),
      )
    })

    it('참가자 신원을 바꿀 수 없다', async () => {
      await assertFails(
        asPlayerA1().doc(matchPath('r1m1')).update(submitPatch(MEMBER_A, { playerBParticipantId: 'participant-x' })),
      )
    })

    it('회원 신원을 바꿀 수 없다', async () => {
      await assertFails(
        asPlayerA1().doc(matchPath('r1m1')).update(submitPatch(MEMBER_A, { playerBMemberId: MEMBER_OUTSIDER })),
      )
    })

    it('nextMatchId를 바꿀 수 없다', async () => {
      await assertFails(
        asPlayerA1().doc(matchPath('r1m1')).update(submitPatch(MEMBER_A, { nextMatchId: 'r2m2' })),
      )
    })

    it('nextSlot을 바꿀 수 없다', async () => {
      await assertFails(
        asPlayerA1().doc(matchPath('r1m1')).update(submitPatch(MEMBER_A, { nextSlot: 'playerB' })),
      )
    })

    it('resultType을 바꿀 수 없다 (스스로 기권승 만들기 차단)', async () => {
      await assertFails(
        asPlayerA1().doc(matchPath('r1m1')).update(submitPatch(MEMBER_A, { resultType: 'forfeit' })),
      )
    })

    it('허용되지 않은 임의 필드를 끼워 넣을 수 없다', async () => {
      await assertFails(
        asPlayerA1().doc(matchPath('r1m1')).update(submitPatch(MEMBER_A, { 무단필드: 'x' })),
      )
    })

    it('resultLog에 관리자 승인 기록을 끼워 넣을 수 없다', async () => {
      await assertFails(
        asPlayerA1().doc(matchPath('r1m1')).update({
          ...submitPatch(MEMBER_A),
          resultLog: {
            submittedByMemberId: MEMBER_A, submittedAt: AT, correctionRequested: false,
            approvedByAdminUid: UID_ADMIN_ACTIVE, approvedAt: AT,
          },
        }),
      )
    })

    it('점수는 숫자여야 하고 음수일 수 없다', async () => {
      await assertFails(asPlayerA1().doc(matchPath('r1m1')).update(submitPatch(MEMBER_A, { scoreA: '18' })))
      await assertFails(asPlayerA1().doc(matchPath('r1m1')).update(submitPatch(MEMBER_A, { scoreA: -1 })))
    })
  })

  // ══════════════════════════════════════════════════════════════
  describe('★ 같은 회원이 기기만 바꿔 입력·확인을 모두 하는 것 차단', () => {
    it('회원 A가 기기 1로 결과를 제출한다', async () => {
      await linkEveryone()
      await seedDoc(matchPath('r1m1'), matchData())
      await assertSucceeds(asPlayerA1().doc(matchPath('r1m1')).update(submitPatch(MEMBER_A)))
    })

    it('같은 회원 A가 기기 2로 그 결과를 확인하려 하면 거부된다', async () => {
      await linkEveryone()
      await seedDoc(matchPath('r1m1'), submittedByA())
      // 기기(UID)는 다르지만 memberLinks가 가리키는 회원이 같으므로 서버가 막는다.
      await assertFails(asPlayerA2().doc(matchPath('r1m1')).update(verifyPatch(MEMBER_A)))
    })

    it('같은 회원 A가 기기 2로 상대 이름을 빌려 확인하려 해도 거부된다', async () => {
      await linkEveryone()
      await seedDoc(matchPath('r1m1'), submittedByA())
      await assertFails(asPlayerA2().doc(matchPath('r1m1')).update(verifyPatch(MEMBER_B)))
    })

    it('같은 회원 A가 기기 2로 수정 요청하는 것도 거부된다', async () => {
      await linkEveryone()
      await seedDoc(matchPath('r1m1'), submittedByA())
      await assertFails(asPlayerA2().doc(matchPath('r1m1')).update(correctionPatch(MEMBER_A)))
    })
  })

  // ══════════════════════════════════════════════════════════════
  describe('상대 확인', () => {
    beforeEach(async () => {
      await linkEveryone()
      await seedDoc(matchPath('r1m1'), submittedByA())
    })

    it('결과를 입력한 사람은 스스로 확인할 수 없다', async () => {
      await assertFails(asPlayerA1().doc(matchPath('r1m1')).update(verifyPatch(MEMBER_A)))
    })

    it('상대 참가자는 확인할 수 있다', async () => {
      await assertSucceeds(asPlayerB().doc(matchPath('r1m1')).update(verifyPatch(MEMBER_B)))
    })

    it('이 경기에 나오지 않은 회원은 확인할 수 없다', async () => {
      await assertFails(asOutsider().doc(matchPath('r1m1')).update(verifyPatch(MEMBER_OUTSIDER)))
    })

    it('확인하면서 공식 확정할 수 없다', async () => {
      await assertFails(asPlayerB().doc(matchPath('r1m1')).update(verifyPatch(MEMBER_B, { status: 'official' })))
    })

    it('확인하면서 공식 승자를 쓸 수 없다', async () => {
      await assertFails(
        asPlayerB().doc(matchPath('r1m1'))
          .update(verifyPatch(MEMBER_B, { officialWinnerParticipantId: 'participant-b' })),
      )
    })

    it('확인하면서 점수를 바꿀 수 없다', async () => {
      await assertFails(asPlayerB().doc(matchPath('r1m1')).update(verifyPatch(MEMBER_B, { scoreA: 3 })))
    })

    it('확인하면서 제출자를 바꿔치기할 수 없다', async () => {
      await assertFails(
        asPlayerB().doc(matchPath('r1m1')).update({
          status: 'awaitingApproval',
          resultLog: {
            submittedByMemberId: MEMBER_B, submittedAt: AT, correctionRequested: false,
            verificationType: 'player', verifiedByMemberId: MEMBER_B, verifiedAt: AT,
          },
        }),
      )
    })

    it('회원이 관리자 직권 확인으로 위장할 수 없다', async () => {
      await assertFails(
        asPlayerB().doc(matchPath('r1m1')).update({
          status: 'awaitingApproval',
          resultLog: {
            submittedByMemberId: MEMBER_A, submittedAt: AT, correctionRequested: false,
            verificationType: 'adminOverride', verifiedByAdminUid: UID_ADMIN_ACTIVE, verifiedAt: AT,
          },
        }),
      )
    })

    it('수정 요청이 접수된 경기는 회원이 확인할 수 없다', async () => {
      await seedDoc(matchPath('r1m1'), submittedByA({
        resultLog: {
          submittedByMemberId: MEMBER_A, submittedAt: AT, correctionRequested: true,
          correctionRequestedByMemberId: MEMBER_B, correctionRequestedAt: AT,
        },
      }))
      await assertFails(asPlayerB().doc(matchPath('r1m1')).update(verifyPatch(MEMBER_B)))
    })
  })

  // ══════════════════════════════════════════════════════════════
  describe('수정 요청', () => {
    beforeEach(async () => {
      await linkEveryone()
      await seedDoc(matchPath('r1m1'), submittedByA())
    })

    it('상대 참가자는 수정을 요청할 수 있다', async () => {
      await assertSucceeds(asPlayerB().doc(matchPath('r1m1')).update(correctionPatch(MEMBER_B)))
    })

    it('결과를 입력한 사람은 수정을 요청할 수 없다', async () => {
      await assertFails(asPlayerA1().doc(matchPath('r1m1')).update(correctionPatch(MEMBER_A)))
    })

    it('이 경기에 나오지 않은 회원은 수정을 요청할 수 없다', async () => {
      await assertFails(asOutsider().doc(matchPath('r1m1')).update(correctionPatch(MEMBER_OUTSIDER)))
    })

    it('수정 요청과 함께 점수를 바꿀 수 없다', async () => {
      await assertFails(asPlayerB().doc(matchPath('r1m1')).update(correctionPatch(MEMBER_B, { scoreA: 1 })))
    })

    it('수정 요청과 함께 상태를 바꿀 수 없다', async () => {
      await assertFails(
        asPlayerB().doc(matchPath('r1m1')).update(correctionPatch(MEMBER_B, { status: 'awaitingApproval' })),
      )
    })

    it('남의 이름으로 수정 요청할 수 없다', async () => {
      await assertFails(asPlayerB().doc(matchPath('r1m1')).update(correctionPatch(MEMBER_OUTSIDER)))
    })
  })

  // ══════════════════════════════════════════════════════════════
  describe('관리자 직권 확인 · 결과 수정', () => {
    beforeEach(async () => {
      await linkEveryone()
      await seedDoc(matchPath('r1m1'), submittedByA())
    })

    it('관리자는 직권으로 확인할 수 있다', async () => {
      await assertSucceeds(
        asAdmin().doc(matchPath('r1m1')).update({
          status: 'awaitingApproval',
          resultLog: {
            submittedByMemberId: MEMBER_A, submittedAt: AT, correctionRequested: false,
            verificationType: 'adminOverride', verifiedByAdminUid: UID_ADMIN_ACTIVE, verifiedAt: AT,
          },
        }),
      )
    })

    it('관리자는 수정 요청된 결과를 고칠 수 있다', async () => {
      await assertSucceeds(
        asAdmin().doc(matchPath('r1m1')).update({
          scoreA: 12, scoreB: 19, calculatedWinnerParticipantId: 'participant-b',
          status: 'awaitingApproval',
          resultLog: {
            submittedByMemberId: MEMBER_A, submittedAt: AT, correctionRequested: false,
            correctedByAdminUid: UID_ADMIN_ACTIVE, correctedAt: AT,
          },
        }),
      )
    })

    it('회원은 직권 확인 뒤에도 스스로 공식 확정할 수 없다', async () => {
      await seedDoc(matchPath('r1m1'), submittedByA({
        status: 'awaitingApproval',
        resultLog: {
          submittedByMemberId: MEMBER_A, submittedAt: AT, correctionRequested: false,
          verificationType: 'adminOverride', verifiedByAdminUid: UID_ADMIN_ACTIVE, verifiedAt: AT,
        },
      }))
      await assertFails(
        asPlayerB().doc(matchPath('r1m1')).update({
          status: 'official',
          officialWinnerParticipantId: 'participant-b',
          officialLoserParticipantId: 'participant-a',
        }),
      )
    })
  })

  // ══════════════════════════════════════════════════════════════
  describe('관리자 최종 승인 · 다음 라운드 배치', () => {
    const approvedLog = {
      submittedByMemberId: MEMBER_A, submittedAt: AT, correctionRequested: false,
      verificationType: 'player', verifiedByMemberId: MEMBER_B, verifiedAt: AT,
      approvedByAdminUid: UID_ADMIN_ACTIVE, approvedAt: AT,
    }

    beforeEach(async () => {
      await linkEveryone()
      await seedDoc(matchPath('r1m1'), submittedByA({ status: 'awaitingApproval' }))
      await seedDoc(matchPath('r2m1'), matchData({
        id: 'r2m1', roundNumber: 2, playerCountInRound: 2, matchNumber: 1,
        playerAParticipantId: null, playerBParticipantId: null,
        playerAMemberId: null, playerBMemberId: null,
        playerAHandicapSnapshot: null, playerBHandicapSnapshot: null,
        nextMatchId: null, nextSlot: null,
      }))
    })

    it('관리자는 경기를 공식 확정할 수 있다', async () => {
      await assertSucceeds(
        asAdmin().doc(matchPath('r1m1')).update({
          status: 'official',
          officialWinnerParticipantId: 'participant-a',
          officialLoserParticipantId: 'participant-b',
          resultLog: approvedLog,
        }),
      )
    })

    it('관리자는 공식 확정과 다음 라운드 배치를 하나의 배치로 처리할 수 있다', async () => {
      const db = asAdmin()
      const batch = db.batch()
      batch.update(db.doc(matchPath('r1m1')), {
        status: 'official',
        officialWinnerParticipantId: 'participant-a',
        officialLoserParticipantId: 'participant-b',
        resultLog: approvedLog,
      })
      batch.update(db.doc(matchPath('r2m1')), {
        playerAParticipantId: 'participant-a',
        playerAMemberId: MEMBER_A,
        playerAHandicapSnapshot: 20,
      })
      await assertSucceeds(batch.commit())
    })

    it('회원은 다음 경기의 선수 자리를 바꿀 수 없다', async () => {
      await assertFails(
        asPlayerA1().doc(matchPath('r2m1')).update({
          playerAParticipantId: 'participant-a',
          playerAMemberId: MEMBER_A,
          playerAHandicapSnapshot: 20,
        }),
      )
    })

    it('회원은 상대 확인이 끝난 경기라도 스스로 공식 확정할 수 없다', async () => {
      await assertFails(
        asPlayerB().doc(matchPath('r1m1')).update({
          status: 'official',
          officialWinnerParticipantId: 'participant-b',
          officialLoserParticipantId: 'participant-a',
          resultLog: approvedLog,
        }),
      )
    })

    it('회원은 관리자 승인 기록을 스스로 남길 수 없다', async () => {
      await assertFails(asPlayerB().doc(matchPath('r1m1')).update({ resultLog: approvedLog }))
    })
  })

  // ══════════════════════════════════════════════════════════════
  describe('기권 · 부전승', () => {
    beforeEach(async () => {
      await linkEveryone()
      await seedDoc(matchPath('r1m1'), matchData())
    })

    it('관리자는 점수 없이 기권승으로 확정할 수 있다', async () => {
      await assertSucceeds(
        asAdmin().doc(matchPath('r1m1')).update({
          resultType: 'forfeit',
          status: 'official',
          officialWinnerParticipantId: 'participant-b',
          officialLoserParticipantId: 'participant-a',
          resultLog: { approvedByAdminUid: UID_ADMIN_ACTIVE, approvedAt: AT },
        }),
      )
    })

    it('회원은 기권승을 스스로 확정할 수 없다', async () => {
      await assertFails(
        asPlayerB().doc(matchPath('r1m1')).update({
          resultType: 'forfeit',
          status: 'official',
          officialWinnerParticipantId: 'participant-b',
          officialLoserParticipantId: 'participant-a',
        }),
      )
    })

    it('회원은 부전승 상태를 만들 수 없다', async () => {
      await assertFails(
        asPlayerA1().doc(matchPath('r1m1')).update({
          resultType: 'bye',
          status: 'official',
          officialWinnerParticipantId: 'participant-a',
        }),
      )
    })

    it('회원은 이미 만들어진 부전승 경기도 고칠 수 없다', async () => {
      await seedDoc(matchPath('r1m2'), matchData({
        id: 'r1m2', matchNumber: 2, resultType: 'bye', status: 'official',
        playerBParticipantId: null, playerBMemberId: null, playerBHandicapSnapshot: null,
        officialWinnerParticipantId: 'participant-a', officialLoserParticipantId: null,
        nextSlot: 'playerB',
      }))
      await assertFails(asPlayerA1().doc(matchPath('r1m2')).update(submitPatch(MEMBER_A)))
    })
  })

  // ══════════════════════════════════════════════════════════════
  describe('공식 확정 이후 보호', () => {
    beforeEach(async () => {
      await linkEveryone()
      await seedDoc(matchPath('r1m1'), submittedByA({
        status: 'official',
        officialWinnerParticipantId: 'participant-a',
        officialLoserParticipantId: 'participant-b',
        resultLog: {
          submittedByMemberId: MEMBER_A, submittedAt: AT, correctionRequested: false,
          verificationType: 'player', verifiedByMemberId: MEMBER_B, verifiedAt: AT,
          approvedByAdminUid: UID_ADMIN_ACTIVE, approvedAt: AT,
        },
      }))
    })

    it('회원은 공식 확정된 경기의 점수를 바꿀 수 없다', async () => {
      await assertFails(asPlayerA1().doc(matchPath('r1m1')).update({ scoreA: 20 }))
      await assertFails(asPlayerB().doc(matchPath('r1m1')).update({ scoreB: 20 }))
    })

    it('회원은 공식 확정된 경기의 확인 정보를 바꿀 수 없다', async () => {
      await assertFails(asPlayerB().doc(matchPath('r1m1')).update(verifyPatch(MEMBER_B)))
    })

    it('회원은 공식 확정된 경기에 수정을 요청할 수 없다', async () => {
      await assertFails(asPlayerB().doc(matchPath('r1m1')).update(correctionPatch(MEMBER_B)))
    })

    it('회원은 공식 확정된 경기의 상태를 되돌릴 수 없다', async () => {
      await assertFails(asPlayerA1().doc(matchPath('r1m1')).update({ status: 'awaitingResult' }))
    })

    it('회원은 공식 승자를 바꿀 수 없다', async () => {
      await assertFails(
        asPlayerB().doc(matchPath('r1m1')).update({ officialWinnerParticipantId: 'participant-b' }),
      )
    })

    it('관리자는 공식 확정된 경기를 정정할 수 있다', async () => {
      await assertSucceeds(asAdmin().doc(matchPath('r1m1')).update({ scoreA: 16, scoreB: 17 }))
    })
  })

  // ══════════════════════════════════════════════════════════════
  describe('모임(club) 격리', () => {
    beforeEach(async () => {
      await linkEveryone()
      await seedDoc(matchPath('r1m1', CLUB_OTHER), matchData())
      await seedDoc(participantPath('participant-a', CLUB_OTHER), participantData('participant-a', MEMBER_A))
      await seedDoc(tournamentPath(CLUB_OTHER), tournamentData())
      await seedDoc(drawPath(CLUB_OTHER), drawData)
    })

    it('이 모임 회원은 다른 모임의 대회·참가자·경기·추첨매핑을 읽을 수 없다', async () => {
      const db = asPlayerA1()
      await assertFails(db.doc(tournamentPath(CLUB_OTHER)).get())
      await assertFails(db.doc(participantPath('participant-a', CLUB_OTHER)).get())
      await assertFails(db.doc(matchPath('r1m1', CLUB_OTHER)).get())
      await assertFails(db.doc(drawPath(CLUB_OTHER)).get())
    })

    it('이 모임 회원은 다른 모임 경기에 결과를 제출할 수 없다', async () => {
      // memberId(member-a)는 그 경기의 참가자와 같지만, 그 모임에 연결돼 있지 않다.
      await assertFails(asPlayerA1().doc(matchPath('r1m1', CLUB_OTHER)).update(submitPatch(MEMBER_A)))
    })
  })

  // ══════════════════════════════════════════════════════════════
  // 4A — 회원 참가/불참 (participants.entryStatus 본인 write)
  // ══════════════════════════════════════════════════════════════
  describe('회원 참가/불참 (4A)', () => {
    const draftTournamentData = (over: object = {}) => ({
      id: TID, name: '가상 대회', date: '2026-09-01', timeLimitMinutes: 60,
      status: 'draft', createdAt: AT, ...over,
    })

    beforeEach(async () => {
      await linkEveryone()
      await seedDoc(tournamentPath(), draftTournamentData())
      await seedDoc(participantPath('participant-a'), participantData('participant-a', MEMBER_A, { entryStatus: 'noResponse' }))
      await seedDoc(participantPath('participant-b'), participantData('participant-b', MEMBER_B, { entryStatus: 'noResponse' }))
    })

    it('1. 연결 회원이 자기 참가 상태를 참가로 변경할 수 있다', async () => {
      await assertSucceeds(asPlayerA1().doc(participantPath('participant-a')).update({ entryStatus: 'entered' }))
    })

    it('2. 연결 회원이 자기 참가 상태를 불참으로 변경할 수 있다', async () => {
      await assertSucceeds(asPlayerA1().doc(participantPath('participant-a')).update({ entryStatus: 'declined' }))
    })

    it('3. 참가 → 불참으로 변경할 수 있다', async () => {
      await seedDoc(participantPath('participant-a'), participantData('participant-a', MEMBER_A, { entryStatus: 'entered' }))
      await assertSucceeds(asPlayerA1().doc(participantPath('participant-a')).update({ entryStatus: 'declined' }))
    })

    it('4. 불참 → 참가로 변경할 수 있다', async () => {
      await seedDoc(participantPath('participant-a'), participantData('participant-a', MEMBER_A, { entryStatus: 'declined' }))
      await assertSucceeds(asPlayerA1().doc(participantPath('participant-a')).update({ entryStatus: 'entered' }))
    })

    it('5. 다른 회원의 participant 문서는 변경할 수 없다', async () => {
      await assertFails(asPlayerA1().doc(participantPath('participant-b')).update({ entryStatus: 'entered' }))
    })

    it('6. 비연결 사용자는 변경할 수 없다', async () => {
      await assertFails(asOutsider().doc(participantPath('participant-a')).update({ entryStatus: 'entered' }))
    })

    it('7. 다른 모임 회원은 이 모임 participant를 변경할 수 없다', async () => {
      await assertFails(asOtherClubMember().doc(participantPath('participant-a')).update({ entryStatus: 'entered' }))
    })

    it('8. entryStatus와 함께 memberId를 바꾸려 하면 차단된다', async () => {
      await assertFails(
        asPlayerA1().doc(participantPath('participant-a')).update({ entryStatus: 'entered', memberId: MEMBER_OUTSIDER }),
      )
    })

    it('9. entryStatus와 함께 tournamentHandicap을 바꾸려 하면 차단된다', async () => {
      await assertFails(
        asPlayerA1().doc(participantPath('participant-a')).update({ entryStatus: 'entered', tournamentHandicap: 5 }),
      )
    })

    it('10. entryStatus와 함께 displayNameSnapshot을 바꾸려 하면 차단된다', async () => {
      await assertFails(
        asPlayerA1().doc(participantPath('participant-a')).update({ entryStatus: 'entered', displayNameSnapshot: '가짜이름' }),
      )
    })

    it('11. entryStatus와 함께 baseHandicapSnapshot을 바꾸려 하면 차단된다', async () => {
      await assertFails(
        asPlayerA1().doc(participantPath('participant-a')).update({ entryStatus: 'entered', baseHandicapSnapshot: 99 }),
      )
    })

    it('12. 관리자 제외 필드(excludedByAdminUid 등)를 스스로 써 넣을 수 없다', async () => {
      await assertFails(
        asPlayerA1().doc(participantPath('participant-a'))
          .update({ entryStatus: 'entered', excludedByAdminUid: UID_A1, excludedAt: AT }),
      )
    })

    it('13. entered/declined 외의 값으로는 바꿀 수 없다', async () => {
      await assertFails(asPlayerA1().doc(participantPath('participant-a')).update({ entryStatus: 'excluded' }))
      await assertFails(asPlayerA1().doc(participantPath('participant-a')).update({ entryStatus: 'noResponse' }))
    })

    it('★ 이미 관리자가 제외한 참가자는 스스로 되돌릴 수 없다', async () => {
      await seedDoc(participantPath('participant-a'), participantData('participant-a', MEMBER_A, {
        entryStatus: 'excluded', excludedByAdminUid: UID_ADMIN_ACTIVE, excludedAt: AT,
      }))
      await assertFails(asPlayerA1().doc(participantPath('participant-a')).update({ entryStatus: 'entered' }))
    })

    it('14. 참가자 확정(entryClosed) 이후에는 회원이 변경할 수 없다', async () => {
      await seedDoc(tournamentPath(), draftTournamentData({ status: 'entryClosed', participantCount: 1 }))
      await assertFails(asPlayerA1().doc(participantPath('participant-a')).update({ entryStatus: 'entered' }))
    })

    it('15. 관리자는 참가자 상태를 변경할 수 있다', async () => {
      await assertSucceeds(asAdmin().doc(participantPath('participant-a')).update({ entryStatus: 'entered' }))
    })

    it('16. 관리자는 참가자를 제외할 수 있다', async () => {
      await assertSucceeds(
        asAdmin().doc(participantPath('participant-a'))
          .update({ entryStatus: 'excluded', excludedByAdminUid: UID_ADMIN_ACTIVE, excludedAt: AT }),
      )
    })

    it('17. 관리자는 tournamentHandicap을 변경할 수 있다', async () => {
      await assertSucceeds(asAdmin().doc(participantPath('participant-a')).update({ tournamentHandicap: 18 }))
    })

    it('회원은 여전히 participant 문서를 새로 만들 수 없다(create는 관리자 전용 그대로)', async () => {
      await assertFails(
        asPlayerA1().doc(participantPath('participant-new'))
          .set(participantData('participant-new', MEMBER_A, { entryStatus: 'noResponse' })),
      )
    })
  })
})

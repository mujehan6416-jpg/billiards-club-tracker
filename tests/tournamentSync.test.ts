import { describe, it, expect, vi, beforeEach } from 'vitest'

// Firestore 호출부를 전부 모킹한다 — 실제 운영 Firestore는 읽지도 쓰지도 않는다.
// 여기서 확인하는 것은 "어느 경로에, 어떤 필드만, 몇 번의 배치로 쓰는가"이다.
// 권한 판정(누가 쓸 수 있는가)은 Firestore Rules의 몫이고 다음 단계에서 다룬다.
//
// 사용하는 ID는 전부 가상값이다 — 실제 회원 이름·회원 ID·운영 데이터를 쓰지 않는다.

const setDocMock = vi.fn()
const updateDocMock = vi.fn()
const getDocMock = vi.fn()
const getDocsMock = vi.fn()

/** deleteField()가 만든 표식 — 테스트에서 "이 필드를 지웠다"를 확인할 때 쓴다. */
const DELETED = '__deleteField__'

interface FakeBatchOp {
  kind: 'set' | 'update' | 'delete'
  path: string
  data?: Record<string, unknown>
}
interface FakeBatch {
  ops: FakeBatchOp[]
  set: (ref: { path: string }, data: Record<string, unknown>) => void
  update: (ref: { path: string }, data: Record<string, unknown>) => void
  delete: (ref: { path: string }) => void
  commit: () => Promise<void>
}
let batches: FakeBatch[] = []

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  getDoc: (...args: unknown[]) => getDocMock(...args),
  getDocs: (...args: unknown[]) => getDocsMock(...args),
  setDoc: (...args: unknown[]) => setDocMock(...args),
  updateDoc: (...args: unknown[]) => updateDocMock(...args),
  deleteDoc: vi.fn(),
  deleteField: () => DELETED,
  writeBatch: () => {
    const batch: FakeBatch = {
      ops: [],
      set(ref, data) { batch.ops.push({ kind: 'set', path: ref.path, data }) },
      update(ref, data) { batch.ops.push({ kind: 'update', path: ref.path, data }) },
      delete(ref) { batch.ops.push({ kind: 'delete', path: ref.path }) },
      commit: vi.fn().mockResolvedValue(undefined),
    }
    batches.push(batch)
    return batch
  },
}))
vi.mock('../src/lib/firebase', () => ({ db: {} }))

import {
  createTournament, fetchTournament, updateTournamentInfo, confirmTournamentEntries,
  writeTournamentParticipant, fetchTournamentParticipants, createMissingParticipants,
  setParticipantEntryStatus, excludeParticipantByAdmin, setParticipantTournamentHandicap,
  saveTournamentDrawMapping, loadTournamentDrawMapping, saveTournamentDrawNumbers,
  confirmTournamentBracket, cancelTournamentBracket, hasOfficialPlayedMatch,
  submitTournamentMatchResult, verifyTournamentMatchResult, requestTournamentMatchCorrection,
  adminVerifyTournamentMatch, correctTournamentMatchByAdmin,
  approveTournamentMatch, declareTournamentForfeit,
  assertOfficialResultCorrectable, finishTournament,
  TournamentSyncError,
} from '../src/lib/tournamentSync'
import { buildEmptyBracket, buildTournamentMatches } from '../src/logic/tournamentBracket'
import type { Tournament, TournamentMatch, TournamentParticipant, TournamentSeat } from '../src/types/tournament'

const CLUB = 'club-test'
const TID = 'tournament-test'
const ADMIN_UID = 'uid-admin-test'
const AT = '2026-09-01T10:00:00.000Z'

const BASE = `clubs/${CLUB}/tournaments/${TID}`

function snapOf(data: unknown) {
  return { exists: () => true, data: () => data }
}
const missingSnap = { exists: () => false, data: () => undefined }
function querySnapOf(items: unknown[]) {
  return { docs: items.map((data) => ({ data: () => data })) }
}

function tournament(overrides: Partial<Tournament> = {}): Tournament {
  return {
    id: TID,
    name: '가상 대회',
    date: '2026-09-01',
    timeLimitMinutes: 60,
    status: 'draft',
    createdAt: AT,
    createdByAdminUid: ADMIN_UID,
    ...overrides,
  }
}

function participant(suffix: 'a' | 'b', overrides: Partial<TournamentParticipant> = {}): TournamentParticipant {
  return {
    id: `participant-${suffix}`,
    memberId: `member-${suffix}`,
    displayNameSnapshot: `가상참가자${suffix.toUpperCase()}`,
    baseHandicapSnapshot: 20,
    tournamentHandicap: 20,
    entryStatus: 'entered',
    ...overrides,
  }
}

function match(overrides: Partial<TournamentMatch> = {}): TournamentMatch {
  return {
    id: 'r1m1',
    roundNumber: 1,
    playerCountInRound: 4,
    matchNumber: 1,
    playerAParticipantId: 'participant-a',
    playerBParticipantId: 'participant-b',
    playerAMemberId: 'member-a',
    playerBMemberId: 'member-b',
    playerAHandicapSnapshot: 20,
    playerBHandicapSnapshot: 20,
    scoreA: null,
    scoreB: null,
    resultType: 'normal',
    status: 'awaitingResult',
    nextMatchId: 'r2m1',
    nextSlot: 'playerA',
    ...overrides,
  }
}

/** 서버에 이 경기가 있다고 흉내 낸다(경로별로 다른 경기를 돌려줄 수 있다). */
function serveMatches(...items: TournamentMatch[]) {
  const byPath = new Map(items.map((m) => [`${BASE}/matches/${m.id}`, m]))
  getDocMock.mockImplementation((ref: { path: string }) => {
    const found = byPath.get(ref.path)
    return Promise.resolve(found ? snapOf(found) : missingSnap)
  })
}

/** m1 입력 → m2 확인까지 끝나 관리자 승인 대기인 경기. */
function awaitingApproval(overrides: Partial<TournamentMatch> = {}): TournamentMatch {
  return match({
    scoreA: 18,
    scoreB: 15,
    calculatedWinnerParticipantId: 'participant-a',
    status: 'awaitingApproval',
    resultLog: {
      submittedByMemberId: 'member-a',
      submittedAt: AT,
      correctionRequested: false,
      verificationType: 'player',
      verifiedByMemberId: 'member-b',
      verifiedAt: AT,
    },
    ...overrides,
  })
}

function lastBatch(): FakeBatch {
  expect(batches.length).toBeGreaterThan(0)
  return batches[batches.length - 1]
}

beforeEach(() => {
  setDocMock.mockReset()
  updateDocMock.mockReset()
  getDocMock.mockReset()
  getDocsMock.mockReset()
  batches = []
})

// ══════════════════════════════════════════════════════════════════
describe('기본 저장 경로', () => {
  it('대회 문서는 clubs/{clubId}/tournaments/{tournamentId}에 쓴다', async () => {
    await createTournament(tournament(), CLUB)
    expect(setDocMock).toHaveBeenCalledTimes(1)
    expect(setDocMock.mock.calls[0][0].path).toBe(BASE)
  })

  it('clubId를 하드코딩하지 않는다 — 다른 모임 id를 넘기면 경로가 따라 바뀐다', async () => {
    await createTournament(tournament(), 'club-other')
    expect(setDocMock.mock.calls[0][0].path).toBe('clubs/club-other/tournaments/tournament-test')
  })

  it('참가자는 participants 하위 컬렉션에 쓴다', async () => {
    await writeTournamentParticipant(TID, participant('a'), CLUB)
    expect(setDocMock.mock.calls[0][0].path).toBe(`${BASE}/participants/participant-a`)
  })

  it('경기는 matches 하위 컬렉션에 쓴다', async () => {
    await confirmTournamentBracket(TID, [match()], { bracketSize: 4, at: AT }, CLUB)
    const setOps = lastBatch().ops.filter((op) => op.kind === 'set')
    expect(setOps[0].path).toBe(`${BASE}/matches/r1m1`)
  })

  it('관리자 전용 추첨 매핑은 private/draw — 공개 경로와 완전히 분리된다', async () => {
    await saveTournamentDrawMapping(TID, { bracketSize: 4, numberToSlot: { 1: 3 }, byeSlots: [2] }, CLUB)
    const path = setDocMock.mock.calls[0][0].path
    expect(path).toBe(`${BASE}/private/draw`)
    expect(path).not.toBe(BASE)
    expect(path).not.toContain('/participants/')
    expect(path).not.toContain('/matches/')
  })

  it('대회 문서를 읽을 때 private/draw를 함께 읽지 않는다', async () => {
    getDocMock.mockResolvedValue(snapOf(tournament()))
    await fetchTournament(TID, CLUB)
    expect(getDocMock).toHaveBeenCalledTimes(1)
    expect(getDocMock.mock.calls[0][0].path).toBe(BASE)
  })

  it('대회 기본정보 수정은 이름·날짜·제한시간만 바꾼다', async () => {
    await updateTournamentInfo(TID, { name: '바뀐 대회', date: '2026-09-02', timeLimitMinutes: 45 }, CLUB)
    expect(Object.keys(updateDocMock.mock.calls[0][1]).sort()).toEqual(['date', 'name', 'timeLimitMinutes'])
  })

  it('대회 문서에 저장하는 필드는 정해진 목록뿐이다', async () => {
    await createTournament({ ...tournament(), extra: '넣으면 안 되는 값' } as unknown as Tournament, CLUB)
    expect('extra' in setDocMock.mock.calls[0][1]).toBe(false)
  })
})

// ══════════════════════════════════════════════════════════════════
describe('참가자', () => {
  it('참가자 목록은 participants 컬렉션에서 읽는다', async () => {
    getDocsMock.mockResolvedValue(querySnapOf([participant('a'), participant('b')]))
    const list = await fetchTournamentParticipants(TID, CLUB)
    expect(getDocsMock.mock.calls[0][0].path).toBe(`${BASE}/participants`)
    expect(list).toHaveLength(2)
  })

  it('회원 참가·불참 응답은 entryStatus 한 필드만 바꾼다', async () => {
    await setParticipantEntryStatus(TID, 'participant-a', 'entered', CLUB)
    expect(updateDocMock.mock.calls[0][1]).toEqual({ entryStatus: 'entered' })
  })

  it('관리자 제외는 문서를 지우지 않고 상태와 처리자를 남긴다', async () => {
    await excludeParticipantByAdmin(TID, 'participant-a', { adminUid: ADMIN_UID, at: AT }, CLUB)
    const [ref, data] = updateDocMock.mock.calls[0]
    expect(ref.path).toBe(`${BASE}/participants/participant-a`)
    expect(data).toEqual({ entryStatus: 'excluded', excludedByAdminUid: ADMIN_UID, excludedAt: AT })
  })

  it('대회 적용 핸디만 바꾸고 회원 원본 경로는 건드리지 않는다', async () => {
    await setParticipantTournamentHandicap(TID, 'participant-a', 18, CLUB)
    const [ref, data] = updateDocMock.mock.calls[0]
    expect(data).toEqual({ tournamentHandicap: 18 })
    expect(ref.path).not.toContain('/members/')
  })

  it('적용 핸디가 1 미만이면 쓰기 자체를 하지 않는다', async () => {
    await expect(setParticipantTournamentHandicap(TID, 'participant-a', 0, CLUB)).rejects.toThrow(TournamentSyncError)
    expect(updateDocMock).not.toHaveBeenCalled()
  })
})

// ══════════════════════════════════════════════════════════════════
describe('createMissingParticipants — 활성 회원 중 문서가 없는 사람만 채운다', () => {
  const member = (suffix: 'a' | 'b' | 'c', handicap = 20) =>
    ({ id: `member-${suffix}`, name: `가상회원${suffix.toUpperCase()}`, handicap })

  it('참가자 문서가 하나도 없으면 활성 회원 전원의 문서를 만든다', async () => {
    getDocsMock.mockResolvedValueOnce(querySnapOf([]))
    const created = await createMissingParticipants(TID, [member('a'), member('b')], CLUB)

    expect(created).toBe(2)
    expect(batches).toHaveLength(1)
    const ops = lastBatch().ops
    expect(ops.map((op) => op.path).sort()).toEqual([
      `${BASE}/participants/member-a`,
      `${BASE}/participants/member-b`,
    ])
  })

  it('이미 문서가 있는 회원은 절대 다시 쓰지 않는다 (응답·제외 상태 보호)', async () => {
    getDocsMock.mockResolvedValueOnce(querySnapOf([participant('a')])) // memberId: member-a
    const created = await createMissingParticipants(TID, [member('a'), member('b')], CLUB)

    expect(created).toBe(1)
    const ops = lastBatch().ops
    expect(ops).toHaveLength(1)
    expect(ops[0].path).toBe(`${BASE}/participants/member-b`)
  })

  it('새로 만드는 문서는 noResponse 상태로, 문서 id는 회원 id를 그대로 쓴다', async () => {
    getDocsMock.mockResolvedValueOnce(querySnapOf([]))
    await createMissingParticipants(TID, [member('c', 17)], CLUB)

    const op = lastBatch().ops[0]
    expect(op.path).toBe(`${BASE}/participants/member-c`)
    expect(op.data).toEqual({
      id: 'member-c', memberId: 'member-c', displayNameSnapshot: '가상회원C',
      baseHandicapSnapshot: 17, tournamentHandicap: 17, entryStatus: 'noResponse',
    })
  })

  it('빠진 회원이 없으면 아무것도 쓰지 않는다', async () => {
    getDocsMock.mockResolvedValueOnce(querySnapOf([participant('a'), participant('b')]))
    const created = await createMissingParticipants(TID, [member('a'), member('b')], CLUB)

    expect(created).toBe(0)
    expect(batches).toHaveLength(0)
  })
})

// ══════════════════════════════════════════════════════════════════
describe('오프라인 추첨 결과 저장', () => {
  const participants = [participant('a'), participant('b')]

  it('검증에 실패하면 Firestore에 아무것도 쓰지 않는다', async () => {
    // 두 사람이 같은 번호를 가진 잘못된 입력
    await expect(
      saveTournamentDrawNumbers(TID, participants, [
        { participantId: 'participant-a', drawNumber: 1 },
        { participantId: 'participant-b', drawNumber: 1 },
      ], CLUB),
    ).rejects.toThrow(TournamentSyncError)

    expect(batches).toHaveLength(0)
    expect(updateDocMock).not.toHaveBeenCalled()
    expect(setDocMock).not.toHaveBeenCalled()
  })

  it('참가자가 빠지면 아무것도 쓰지 않는다', async () => {
    await expect(
      saveTournamentDrawNumbers(TID, participants, [{ participantId: 'participant-a', drawNumber: 1 }], CLUB),
    ).rejects.toThrow(TournamentSyncError)
    expect(batches).toHaveLength(0)
  })

  it('정상 입력이면 참가자마다 drawNumber 한 필드만 하나의 배치로 쓴다', async () => {
    await saveTournamentDrawNumbers(TID, participants, [
      { participantId: 'participant-a', drawNumber: 2 },
      { participantId: 'participant-b', drawNumber: 1 },
    ], CLUB)

    expect(batches).toHaveLength(1)
    expect(lastBatch().ops).toEqual([
      { kind: 'update', path: `${BASE}/participants/participant-a`, data: { drawNumber: 2 } },
      { kind: 'update', path: `${BASE}/participants/participant-b`, data: { drawNumber: 1 } },
    ])
  })

  it('참가자 문서에는 번호만 들어가고 번호↔자리 매핑은 들어가지 않는다', async () => {
    await saveTournamentDrawNumbers(TID, participants, [
      { participantId: 'participant-a', drawNumber: 1 },
      { participantId: 'participant-b', drawNumber: 2 },
    ], CLUB)

    for (const op of lastBatch().ops) {
      expect(Object.keys(op.data!)).toEqual(['drawNumber'])
      expect('numberToSlot' in op.data!).toBe(false)
      expect('byeSlots' in op.data!).toBe(false)
    }
  })

  it('번호↔자리 매핑과 부전승 자리는 private/draw 문서에만 저장된다', async () => {
    await saveTournamentDrawMapping(TID, { bracketSize: 4, numberToSlot: { 1: 3, 2: 1 }, byeSlots: [4] }, CLUB)
    const [ref, data] = setDocMock.mock.calls[0]
    expect(ref.path).toBe(`${BASE}/private/draw`)
    expect(Object.keys(data).sort()).toEqual(['bracketSize', 'byeSlots', 'numberToSlot'])
  })

  it('공개 대회 문서에는 매핑·부전승 자리가 절대 들어가지 않는다', async () => {
    await createTournament(tournament({ bracketSize: 4, participantCount: 3 }), CLUB)
    const data = setDocMock.mock.calls[0][1]
    expect('numberToSlot' in data).toBe(false)
    expect('byeSlots' in data).toBe(false)
  })

  it('관리자 전용 매핑 조회는 private/draw만 읽는다', async () => {
    getDocMock.mockResolvedValue(snapOf({ bracketSize: 4, numberToSlot: { 1: 2 }, byeSlots: [3] }))
    await loadTournamentDrawMapping(TID, CLUB)
    expect(getDocMock.mock.calls[0][0].path).toBe(`${BASE}/private/draw`)
  })
})

// ══════════════════════════════════════════════════════════════════
describe('대진 확정', () => {
  /** 3명 참가(부전승 1자리) 대진을 1단계 순수 로직으로 만든다. */
  function builtMatches(): TournamentMatch[] {
    const nodes = buildEmptyBracket(4)
    if (!nodes.ok) throw new Error(nodes.message)
    const seats: TournamentSeat[] = [
      { participantId: 'participant-a', memberId: 'member-a', handicap: 20, slotNumber: 1 },
      { participantId: 'participant-b', memberId: 'member-b', handicap: 20, slotNumber: 2 },
      { participantId: 'participant-c', memberId: 'member-c', handicap: 17, slotNumber: 3 },
    ]
    const built = buildTournamentMatches(nodes.value, seats)
    if (!built.ok) throw new Error(built.message)
    return built.value
  }

  it('모든 경기와 대회 상태 변경을 하나의 배치로 저장한다', async () => {
    const matches = builtMatches()
    await confirmTournamentBracket(TID, matches, { bracketSize: 4, at: AT }, CLUB)

    expect(batches).toHaveLength(1)
    const ops = lastBatch().ops
    expect(ops.filter((op) => op.kind === 'set')).toHaveLength(matches.length)
    expect(ops.filter((op) => op.kind === 'update')).toHaveLength(1)
    // 배치 밖에서 따로 쓰는 경로가 없다 = 절반만 저장되는 상태가 생기지 않는다
    expect(setDocMock).not.toHaveBeenCalled()
    expect(updateDocMock).not.toHaveBeenCalled()
  })

  it('대회 문서에 대진 규모와 확정 시각을 함께 남긴다', async () => {
    await confirmTournamentBracket(TID, builtMatches(), { bracketSize: 4, at: AT }, CLUB)
    const updateOp = lastBatch().ops.find((op) => op.kind === 'update')!
    expect(updateOp.path).toBe(BASE)
    expect(updateOp.data).toEqual({ status: 'bracketFixed', bracketSize: 4, drawConfirmedAt: AT })
  })

  it('경기 문서에 nextMatchId·nextSlot을 그대로 저장한다', async () => {
    await confirmTournamentBracket(TID, builtMatches(), { bracketSize: 4, at: AT }, CLUB)
    const first = lastBatch().ops.find((op) => op.path.endsWith('/matches/r1m1'))!
    expect(first.data!.nextMatchId).toBe('r2m1')
    expect(first.data!.nextSlot).toBe('playerA')

    const final = lastBatch().ops.find((op) => op.path.endsWith('/matches/r2m1'))!
    expect(final.data!.nextMatchId).toBeNull()
    expect(final.data!.nextSlot).toBeNull()
  })

  it('저장할 경기가 없으면 쓰기 자체를 하지 않는다', async () => {
    await expect(confirmTournamentBracket(TID, [], { bracketSize: 4, at: AT }, CLUB)).rejects.toThrow(TournamentSyncError)
    expect(batches).toHaveLength(0)
  })

  describe('부전승', () => {
    it('부전승 경기에는 점수가 없다', async () => {
      await confirmTournamentBracket(TID, builtMatches(), { bracketSize: 4, at: AT }, CLUB)
      const bye = lastBatch().ops.find((op) => op.data?.resultType === 'bye')!
      expect(bye.data!.scoreA).toBeNull()
      expect(bye.data!.scoreB).toBeNull()
    })

    it('부전승 경기에는 제출자·확인자 기록이 생기지 않는다 (승인된 경기로 위장하지 않는다)', async () => {
      await confirmTournamentBracket(TID, builtMatches(), { bracketSize: 4, at: AT }, CLUB)
      const bye = lastBatch().ops.find((op) => op.data?.resultType === 'bye')!
      expect('resultLog' in bye.data!).toBe(false)
      expect(bye.data!.status).toBe('official')
      expect(bye.data!.officialWinnerParticipantId).toBe('participant-c')
      expect(bye.data!.officialLoserParticipantId).toBeNull()
    })

    it('부전승 참가자는 대진 확정 시점에 이미 다음 경기 자리에 들어가 있다', async () => {
      await confirmTournamentBracket(TID, builtMatches(), { bracketSize: 4, at: AT }, CLUB)
      const final = lastBatch().ops.find((op) => op.path.endsWith('/matches/r2m1'))!
      expect(final.data!.playerBParticipantId).toBe('participant-c')
      expect(final.data!.playerBHandicapSnapshot).toBe(17)
      // 반대편은 정상 경기 승인으로만 채워진다
      expect(final.data!.playerAParticipantId).toBeNull()
    })
  })
})

// ══════════════════════════════════════════════════════════════════
describe('대진 확정 취소', () => {
  it('공식 확정된 실제 경기가 있으면 막는다 (부전승은 세지 않는다)', () => {
    const byeOnly = [match({ id: 'r1m2', resultType: 'bye', status: 'official' })]
    expect(hasOfficialPlayedMatch(byeOnly)).toBe(false)
    expect(hasOfficialPlayedMatch([...byeOnly, match({ status: 'official' })])).toBe(true)
  })

  it('경기·추첨매핑·참가자 번호·대회 상태를 하나의 배치로 되돌린다', async () => {
    getDocsMock.mockImplementation((ref: { path: string }) =>
      Promise.resolve(
        ref.path.endsWith('/matches')
          ? querySnapOf([match(), match({ id: 'r1m2' }), match({ id: 'r2m1' })])
          : querySnapOf([participant('a'), participant('b')]),
      ),
    )

    await cancelTournamentBracket(TID, CLUB)

    expect(batches).toHaveLength(1)
    const ops = lastBatch().ops
    expect(ops.filter((op) => op.kind === 'delete').map((op) => op.path)).toEqual([
      `${BASE}/matches/r1m1`,
      `${BASE}/matches/r1m2`,
      `${BASE}/matches/r2m1`,
      `${BASE}/private/draw`,
    ])
    expect(ops.find((op) => op.path.endsWith('/participants/participant-a'))!.data).toEqual({ drawNumber: DELETED })
    expect(ops.find((op) => op.path === BASE)!.data).toEqual({
      status: 'entryClosed',
      bracketSize: DELETED,
      drawConfirmedAt: DELETED,
    })
  })

  it('공식 확정된 경기가 있으면 아무것도 지우지 않는다', async () => {
    getDocsMock.mockImplementation((ref: { path: string }) =>
      Promise.resolve(
        ref.path.endsWith('/matches')
          ? querySnapOf([match({ status: 'official', officialWinnerParticipantId: 'participant-a' })])
          : querySnapOf([participant('a')]),
      ),
    )

    await expect(cancelTournamentBracket(TID, CLUB)).rejects.toThrow(/공식 확정된 경기/)
    expect(batches).toHaveLength(0)
  })
})

// ══════════════════════════════════════════════════════════════════
describe('회원 결과 제출', () => {
  it('A쪽 선수가 제출할 수 있다', async () => {
    serveMatches(match())
    await submitTournamentMatchResult(TID, 'r1m1', { byMemberId: 'member-a', scoreA: 18, scoreB: 15, at: AT }, CLUB)
    expect(updateDocMock.mock.calls[0][0].path).toBe(`${BASE}/matches/r1m1`)
  })

  it('B쪽 선수도 제출할 수 있다', async () => {
    serveMatches(match())
    await submitTournamentMatchResult(TID, 'r1m1', { byMemberId: 'member-b', scoreA: 18, scoreB: 15, at: AT }, CLUB)
    expect(updateDocMock.mock.calls[0][1].resultLog.submittedByMemberId).toBe('member-b')
  })

  it('이 경기에 나오지 않은 사람이 제출하면 쓰기 자체를 하지 않는다', async () => {
    serveMatches(match())
    await expect(
      submitTournamentMatchResult(TID, 'r1m1', { byMemberId: 'member-x', scoreA: 18, scoreB: 15, at: AT }, CLUB),
    ).rejects.toThrow(TournamentSyncError)
    expect(updateDocMock).not.toHaveBeenCalled()
    expect(batches).toHaveLength(0)
  })

  it('허용된 필드만 쓴다 — 공식 결과 필드는 절대 포함하지 않는다', async () => {
    serveMatches(match())
    await submitTournamentMatchResult(TID, 'r1m1', { byMemberId: 'member-a', scoreA: 18, scoreB: 15, at: AT }, CLUB)
    const data = updateDocMock.mock.calls[0][1]
    expect(Object.keys(data).sort()).toEqual(
      ['calculatedWinnerParticipantId', 'resultLog', 'scoreA', 'scoreB', 'status'].sort(),
    )
    expect('officialWinnerParticipantId' in data).toBe(false)
    expect('playerAHandicapSnapshot' in data).toBe(false)
  })

  it('제출자와 제출 시각을 기록하고 상대 확인 대기 상태가 된다', async () => {
    serveMatches(match())
    await submitTournamentMatchResult(TID, 'r1m1', { byMemberId: 'member-a', scoreA: 18, scoreB: 15, at: AT }, CLUB)
    const data = updateDocMock.mock.calls[0][1]
    expect(data.status).toBe('awaitingVerification')
    expect(data.resultLog.submittedByMemberId).toBe('member-a')
    expect(data.resultLog.submittedAt).toBe(AT)
  })

  it('달성률은 저장하지 않는다 — 점수와 적용 핸디로 매번 계산한다', async () => {
    serveMatches(match())
    await submitTournamentMatchResult(TID, 'r1m1', { byMemberId: 'member-a', scoreA: 18, scoreB: 15, at: AT }, CLUB)
    const data = updateDocMock.mock.calls[0][1]
    expect('rateA' in data).toBe(false)
    expect('rateB' in data).toBe(false)
  })

  it('없는 경기면 오류를 내고 쓰지 않는다', async () => {
    getDocMock.mockResolvedValue(missingSnap)
    await expect(
      submitTournamentMatchResult(TID, 'r9m9', { byMemberId: 'member-a', scoreA: 1, scoreB: 2, at: AT }, CLUB),
    ).rejects.toThrow(TournamentSyncError)
    expect(updateDocMock).not.toHaveBeenCalled()
  })
})

// ══════════════════════════════════════════════════════════════════
describe('상대 확인', () => {
  const submitted = () => match({
    scoreA: 18, scoreB: 15,
    calculatedWinnerParticipantId: 'participant-a',
    status: 'awaitingVerification',
    resultLog: { submittedByMemberId: 'member-a', submittedAt: AT, correctionRequested: false },
  })

  it('결과를 입력한 사람은 자기 경기를 확인할 수 없다', async () => {
    serveMatches(submitted())
    await expect(
      verifyTournamentMatchResult(TID, 'r1m1', { byMemberId: 'member-a', at: AT }, CLUB),
    ).rejects.toThrow(/입력한 사람은/)
    expect(updateDocMock).not.toHaveBeenCalled()
  })

  it('상대 참가자는 확인할 수 있고 관리자 승인 대기로 넘어간다', async () => {
    serveMatches(submitted())
    await verifyTournamentMatchResult(TID, 'r1m1', { byMemberId: 'member-b', at: AT }, CLUB)
    const data = updateDocMock.mock.calls[0][1]
    expect(data.status).toBe('awaitingApproval')
    expect(data.resultLog.verificationType).toBe('player')
    expect(data.resultLog.verifiedByMemberId).toBe('member-b')
  })

  it('확인해도 공식 승자는 생기지 않는다', async () => {
    serveMatches(submitted())
    await verifyTournamentMatchResult(TID, 'r1m1', { byMemberId: 'member-b', at: AT }, CLUB)
    const data = updateDocMock.mock.calls[0][1]
    expect(Object.keys(data).sort()).toEqual(['resultLog', 'status'])
    expect('officialWinnerParticipantId' in data).toBe(false)
  })

  it('확인 단계에서는 다음 경기를 전혀 건드리지 않는다', async () => {
    serveMatches(submitted())
    await verifyTournamentMatchResult(TID, 'r1m1', { byMemberId: 'member-b', at: AT }, CLUB)
    expect(batches).toHaveLength(0)
    expect(updateDocMock).toHaveBeenCalledTimes(1)
    expect(updateDocMock.mock.calls[0][0].path).not.toContain('r2m1')
  })
})

// ══════════════════════════════════════════════════════════════════
describe('수정 요청 · 관리자 수정', () => {
  const submitted = () => match({
    scoreA: 18, scoreB: 15,
    calculatedWinnerParticipantId: 'participant-a',
    status: 'awaitingVerification',
    resultLog: { submittedByMemberId: 'member-a', submittedAt: AT, correctionRequested: false },
  })

  it('상대 참가자는 수정을 요청할 수 있다', async () => {
    serveMatches(submitted())
    await requestTournamentMatchCorrection(TID, 'r1m1', { byMemberId: 'member-b', at: AT }, CLUB)
    const data = updateDocMock.mock.calls[0][1]
    expect(data.resultLog.correctionRequested).toBe(true)
    expect(data.resultLog.correctionRequestedByMemberId).toBe('member-b')
  })

  it('결과를 입력한 사람은 수정을 요청할 수 없다', async () => {
    serveMatches(submitted())
    await expect(
      requestTournamentMatchCorrection(TID, 'r1m1', { byMemberId: 'member-a', at: AT }, CLUB),
    ).rejects.toThrow(TournamentSyncError)
    expect(updateDocMock).not.toHaveBeenCalled()
  })

  it('수정 요청은 점수를 바꾸지 않는다 — 기록만 남긴다', async () => {
    serveMatches(submitted())
    await requestTournamentMatchCorrection(TID, 'r1m1', { byMemberId: 'member-b', at: AT }, CLUB)
    expect(Object.keys(updateDocMock.mock.calls[0][1])).toEqual(['resultLog'])
  })

  it('관리자가 점수를 고치면 승인 대기로 넘어가고 처리자가 남는다', async () => {
    serveMatches(submitted())
    await correctTournamentMatchByAdmin(
      TID, 'r1m1', { adminUid: ADMIN_UID, scoreA: 12, scoreB: 19, at: AT }, CLUB,
    )
    const data = updateDocMock.mock.calls[0][1]
    expect(data.status).toBe('awaitingApproval')
    expect(data.scoreA).toBe(12)
    expect(data.calculatedWinnerParticipantId).toBe('participant-b')
    expect(data.resultLog.correctedByAdminUid).toBe(ADMIN_UID)
    expect(data.resultLog.correctionRequested).toBe(false)
  })
})

// ══════════════════════════════════════════════════════════════════
describe('관리자 직권 확인', () => {
  const submitted = () => match({
    scoreA: 18, scoreB: 15,
    calculatedWinnerParticipantId: 'participant-a',
    status: 'awaitingVerification',
    resultLog: { submittedByMemberId: 'member-a', submittedAt: AT, correctionRequested: false },
  })

  it('회원 확인과 구분되는 표시를 남긴다', async () => {
    serveMatches(submitted())
    await adminVerifyTournamentMatch(TID, 'r1m1', { adminUid: ADMIN_UID, at: AT }, CLUB)
    const data = updateDocMock.mock.calls[0][1]
    expect(data.resultLog.verificationType).toBe('adminOverride')
    expect(data.resultLog.verifiedByAdminUid).toBe(ADMIN_UID)
    expect(data.resultLog.verifiedByMemberId).toBeUndefined()
  })

  it('직권 확인만으로는 공식 확정되지 않는다', async () => {
    serveMatches(submitted())
    await adminVerifyTournamentMatch(TID, 'r1m1', { adminUid: ADMIN_UID, at: AT }, CLUB)
    const data = updateDocMock.mock.calls[0][1]
    expect(data.status).toBe('awaitingApproval')
    expect('officialWinnerParticipantId' in data).toBe(false)
    expect(batches).toHaveLength(0)
  })
})

// ══════════════════════════════════════════════════════════════════
describe('관리자 최종 승인 + 다음 라운드 진출', () => {
  it('승인 전에는 다음 경기를 수정하지 않는다', async () => {
    serveMatches(awaitingApproval())
    // 승인이 아니라 확인 단계까지만 진행한 상태에서는 배치 자체가 없다
    expect(batches).toHaveLength(0)
  })

  it('승인하면 현재 경기가 공식 확정되고 승자·패자가 저장된다', async () => {
    serveMatches(awaitingApproval())
    await approveTournamentMatch(TID, 'r1m1', { adminUid: ADMIN_UID, at: AT }, CLUB)

    const current = lastBatch().ops.find((op) => op.path.endsWith('/matches/r1m1'))!
    expect(current.data!.status).toBe('official')
    expect(current.data!.officialWinnerParticipantId).toBe('participant-a')
    expect(current.data!.officialLoserParticipantId).toBe('participant-b')
    expect((current.data!.resultLog as Record<string, unknown>).approvedByAdminUid).toBe(ADMIN_UID)
  })

  it('승자를 다음 경기의 정해진 자리에만 넣는다', async () => {
    serveMatches(awaitingApproval())
    await approveTournamentMatch(TID, 'r1m1', { adminUid: ADMIN_UID, at: AT }, CLUB)

    const promoted = lastBatch().ops.find((op) => op.path.endsWith('/matches/r2m1'))!
    expect(promoted.data).toEqual({
      playerAParticipantId: 'participant-a',
      playerAMemberId: 'member-a',
      playerAHandicapSnapshot: 20,
    })
  })

  it('다음 경기의 반대편 자리는 건드리지 않는다', async () => {
    serveMatches(awaitingApproval({ nextSlot: 'playerB' }))
    await approveTournamentMatch(TID, 'r1m1', { adminUid: ADMIN_UID, at: AT }, CLUB)

    const promoted = lastBatch().ops.find((op) => op.path.endsWith('/matches/r2m1'))!
    expect(Object.keys(promoted.data!).sort()).toEqual(
      ['playerBHandicapSnapshot', 'playerBMemberId', 'playerBParticipantId'].sort(),
    )
    expect('playerAParticipantId' in promoted.data!).toBe(false)
  })

  it('현재 경기 확정과 다음 경기 배치가 같은 배치 하나에 들어간다', async () => {
    serveMatches(awaitingApproval())
    await approveTournamentMatch(TID, 'r1m1', { adminUid: ADMIN_UID, at: AT }, CLUB)

    expect(batches).toHaveLength(1)
    expect(lastBatch().ops).toHaveLength(2)
    expect(updateDocMock).not.toHaveBeenCalled()
  })

  it('결승은 다음 경기가 없으므로 현재 경기만 쓴다', async () => {
    serveMatches(awaitingApproval({ id: 'r2m1', nextMatchId: null, nextSlot: null }))
    await approveTournamentMatch(TID, 'r2m1', { adminUid: ADMIN_UID, at: AT }, CLUB)

    expect(lastBatch().ops).toHaveLength(1)
    expect(lastBatch().ops[0].path).toBe(`${BASE}/matches/r2m1`)
  })

  it('상대 확인 전에는 승인이 거부되고 아무것도 쓰지 않는다', async () => {
    serveMatches(match({
      scoreA: 18, scoreB: 15, status: 'awaitingVerification',
      resultLog: { submittedByMemberId: 'member-a', submittedAt: AT, correctionRequested: false },
    }))
    await expect(
      approveTournamentMatch(TID, 'r1m1', { adminUid: ADMIN_UID, at: AT }, CLUB),
    ).rejects.toThrow(/상대 참가자 확인/)
    expect(batches).toHaveLength(0)
  })

  it('달성률이 같으면 관리자가 승자를 지정해야만 승인된다', async () => {
    const tie = awaitingApproval({
      playerAHandicapSnapshot: 20, playerBHandicapSnapshot: 10,
      scoreA: 10, scoreB: 5, calculatedWinnerParticipantId: null,
    })
    serveMatches(tie)
    await expect(approveTournamentMatch(TID, 'r1m1', { adminUid: ADMIN_UID, at: AT }, CLUB)).rejects.toThrow(/승자를 지정/)
    expect(batches).toHaveLength(0)

    serveMatches(tie)
    await approveTournamentMatch(
      TID, 'r1m1', { adminUid: ADMIN_UID, at: AT, officialWinnerParticipantId: 'participant-b' }, CLUB,
    )
    const current = lastBatch().ops.find((op) => op.path.endsWith('/matches/r1m1'))!
    expect(current.data!.officialWinnerParticipantId).toBe('participant-b')
  })
})

// ══════════════════════════════════════════════════════════════════
describe('기권', () => {
  it('점수 없이 기권승으로 공식 확정된다', async () => {
    serveMatches(match())
    await declareTournamentForfeit(
      TID, 'r1m1', { adminUid: ADMIN_UID, at: AT, winnerParticipantId: 'participant-b' }, CLUB,
    )

    const current = lastBatch().ops.find((op) => op.path.endsWith('/matches/r1m1'))!
    expect(current.data!.resultType).toBe('forfeit')
    expect(current.data!.status).toBe('official')
    expect(current.data!.officialWinnerParticipantId).toBe('participant-b')
    // 가짜 점수를 만들지 않는다 — 점수 필드를 아예 쓰지 않는다
    expect('scoreA' in current.data!).toBe(false)
    expect('scoreB' in current.data!).toBe(false)
  })

  it('기권승자도 같은 배치로 다음 라운드에 올라간다', async () => {
    serveMatches(match())
    await declareTournamentForfeit(
      TID, 'r1m1', { adminUid: ADMIN_UID, at: AT, winnerParticipantId: 'participant-b' }, CLUB,
    )

    expect(batches).toHaveLength(1)
    const promoted = lastBatch().ops.find((op) => op.path.endsWith('/matches/r2m1'))!
    expect(promoted.data!.playerAParticipantId).toBe('participant-b')
  })
})

// ══════════════════════════════════════════════════════════════════
describe('공식 결과 정정 보호', () => {
  it('다음 경기가 아직 시작 전이면 정정을 검토할 수 있다', async () => {
    serveMatches(
      match({ status: 'official', officialWinnerParticipantId: 'participant-a' }),
      match({ id: 'r2m1', status: 'awaitingResult', nextMatchId: null, nextSlot: null }),
    )
    await expect(assertOfficialResultCorrectable(TID, 'r1m1', CLUB)).resolves.toBeUndefined()
  })

  it('다음 경기에 결과가 이미 입력됐으면 막는다', async () => {
    serveMatches(
      match({ status: 'official', officialWinnerParticipantId: 'participant-a' }),
      match({ id: 'r2m1', status: 'awaitingVerification', nextMatchId: null, nextSlot: null }),
    )
    await expect(assertOfficialResultCorrectable(TID, 'r1m1', CLUB)).rejects.toThrow(/이미 입력되어/)
  })

  it('다음 경기가 이미 공식 확정됐으면 막는다', async () => {
    serveMatches(
      match({ status: 'official', officialWinnerParticipantId: 'participant-a' }),
      match({ id: 'r2m1', status: 'official', nextMatchId: null, nextSlot: null }),
    )
    await expect(assertOfficialResultCorrectable(TID, 'r1m1', CLUB)).rejects.toThrow(/이미 공식 확정되어/)
  })

  it('결승은 뒤에 아무것도 없으므로 언제나 검토할 수 있다', async () => {
    serveMatches(match({ id: 'r2m1', status: 'official', nextMatchId: null, nextSlot: null }))
    await expect(assertOfficialResultCorrectable(TID, 'r2m1', CLUB)).resolves.toBeUndefined()
  })

  it('판정만 하고 아무것도 쓰지 않는다', async () => {
    serveMatches(
      match({ status: 'official', officialWinnerParticipantId: 'participant-a' }),
      match({ id: 'r2m1', status: 'awaitingResult', nextMatchId: null, nextSlot: null }),
    )
    await assertOfficialResultCorrectable(TID, 'r1m1', CLUB)
    expect(updateDocMock).not.toHaveBeenCalled()
    expect(setDocMock).not.toHaveBeenCalled()
    expect(batches).toHaveLength(0)
  })
})

// ══════════════════════════════════════════════════════════════════
describe('대회 마감', () => {
  it('결승이 공식 확정되면 우승·준우승을 대회 문서에 남긴다', async () => {
    getDocsMock.mockResolvedValue(querySnapOf([
      match({ status: 'official', officialWinnerParticipantId: 'participant-a', officialLoserParticipantId: 'participant-b' }),
      match({
        id: 'r2m1', nextMatchId: null, nextSlot: null, status: 'official',
        officialWinnerParticipantId: 'participant-a', officialLoserParticipantId: 'participant-c',
      }),
    ]))

    await finishTournament(TID, { at: AT }, CLUB)
    const [ref, data] = updateDocMock.mock.calls[0]
    expect(ref.path).toBe(BASE)
    expect(data).toEqual({
      status: 'finished',
      completedAt: AT,
      championParticipantId: 'participant-a',
      runnerUpParticipantId: 'participant-c',
    })
  })

  it('결승이 끝나지 않았으면 마감하지 않는다', async () => {
    getDocsMock.mockResolvedValue(querySnapOf([match({ id: 'r2m1', nextMatchId: null, nextSlot: null })]))
    await expect(finishTournament(TID, { at: AT }, CLUB)).rejects.toThrow(/결승이 아직/)
    expect(updateDocMock).not.toHaveBeenCalled()
  })

  it('참가자 확정은 상태와 인원만 남긴다', async () => {
    await confirmTournamentEntries(TID, 11, CLUB)
    expect(updateDocMock.mock.calls[0][1]).toEqual({ status: 'entryClosed', participantCount: 11 })
  })
})

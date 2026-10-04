import { describe, it, expect, vi, beforeEach } from 'vitest'

// 리스타트 대진 생성 · 합류 자리 자동 배치의 저장 동작 테스트.
// Firestore는 전부 모킹한다 — 실제 운영 Firestore는 읽지도 쓰지도 않는다. 이름·ID는 전부 가상값이다.

const getDocMock = vi.fn()
const getDocsMock = vi.fn()

interface FakeBatchOp { kind: 'set' | 'update' | 'delete'; path: string; data?: Record<string, unknown> }
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
  onSnapshot: vi.fn(),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  deleteField: () => '__deleteField__',
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

import { createRestartBracket, placeRestartJoiner, syncRestartJoiners } from '../src/lib/tournamentSync'
import { analyzeRestartSource, buildRestartBracket } from '../src/logic/tournamentRestartBracket'
import type { Tournament, TournamentMatch, TournamentParticipant } from '../src/types/tournament'
import { decide, decideRound, fullMain, mainWithByes, seededRng } from './fixtures/restartMain'

const CLUB = 'club-test'
const TID = 'main-tournament'
const RID = 'restart-tournament'
const BASE = `clubs/${CLUB}/tournaments/${TID}`
const RBASE = `clubs/${CLUB}/tournaments/${RID}`
const AT = '2026-10-05T10:00:00.000Z'

const snapOf = (data: unknown) => ({ exists: () => true, data: () => data })
const missingSnap = { exists: () => false, data: () => undefined }
const querySnapOf = (items: unknown[]) => ({ docs: items.map((data) => ({ data: () => data })) })

function tournament(over: Partial<Tournament> = {}): Tournament {
  return { id: RID, name: '가상 리스타트', date: '2026-10-05', timeLimitMinutes: 50, status: 'draft', createdAt: AT, ...over }
}
function person(n: number, over: Partial<TournamentParticipant> = {}): TournamentParticipant {
  return {
    id: `p${n}`, memberId: `m${n}`, displayNameSnapshot: `가상선수${n}`,
    baseHandicapSnapshot: 20, tournamentHandicap: 20, entryStatus: 'entered', ...over,
  }
}

// 가상 본선(16명) 1차 승인 완료 → 리스타트 대진 생성 결과
const mainR1 = decideRound(fullMain(16), 1)
const analysis = (() => { const a = analyzeRestartSource(mainR1); if (!a.ok) throw new Error(a.message); return a.value })()
const restart = (() => {
  const built = buildRestartBracket({
    sourceTournamentId: TID, analysis, sourceMatches: mainR1, rng: seededRng(3),
    entrants: [2, 4, 6, 8, 10, 12, 14, 16].map((n) => ({ participantId: `m${n}`, memberId: `m${n}`, handicap: 20 })),
  })
  if (!built.ok) throw new Error(built.message)
  return built.value.matches
})()
const sourceParticipants = Array.from({ length: 16 }, (_, i) => person(i + 1))

/** 경로별로 서버 상태를 흉내 낸다. */
function serve(opts: { restartMatches: TournamentMatch[]; sourceMatches: TournamentMatch[]; restartParticipants?: TournamentParticipant[] }) {
  getDocMock.mockImplementation((ref: { path: string }) => {
    if (ref.path === RBASE) return Promise.resolve(snapOf(tournament({ status: 'bracketFixed', restartSourceTournamentId: TID })))
    const m = opts.restartMatches.find((x) => `${RBASE}/matches/${x.id}` === ref.path)
    return Promise.resolve(m ? snapOf(m) : missingSnap)
  })
  getDocsMock.mockImplementation((ref: { path: string }) => {
    if (ref.path === `${RBASE}/matches`) return Promise.resolve(querySnapOf(opts.restartMatches))
    if (ref.path === `${BASE}/matches`) return Promise.resolve(querySnapOf(opts.sourceMatches))
    if (ref.path === `${RBASE}/participants`) return Promise.resolve(querySnapOf(opts.restartParticipants ?? []))
    if (ref.path === `${BASE}/participants`) return Promise.resolve(querySnapOf(sourceParticipants))
    return Promise.resolve(querySnapOf([]))
  })
}

beforeEach(() => {
  batches = []
  getDocMock.mockReset()
  getDocsMock.mockReset()
})

describe('createRestartBracket', () => {
  const input = { sourceTournamentId: TID, bracketSize: 16, participantCount: 8, at: AT }

  it('경기 전체와 대회 상태 변경을 하나의 배치로 저장한다', async () => {
    getDocsMock.mockResolvedValue(querySnapOf([]))
    getDocMock.mockResolvedValue(snapOf(tournament()))
    await createRestartBracket(RID, restart, input, CLUB)
    expect(batches).toHaveLength(1)
    const sets = batches[0].ops.filter((o) => o.kind === 'set')
    expect(sets).toHaveLength(11)
    expect(sets.every((o) => o.path.startsWith(`${RBASE}/matches/`))).toBe(true)
    expect(batches[0].ops.filter((o) => o.kind === 'update')).toEqual([{
      kind: 'update', path: RBASE,
      data: { status: 'bracketFixed', bracketSize: 16, participantCount: 8, drawConfirmedAt: AT, restartSourceTournamentId: TID },
    }])
    // 합류 예약 필드가 경기 문서에 그대로 저장된다(부전승이 아니라 비어 있는 일반 경기)
    const r2m1 = sets.find((o) => o.path.endsWith('/r2m1'))!
    expect(r2m1.data).toMatchObject({
      playerBJoinFrom: { tournamentId: TID, matchId: 'r2m1' }, playerBParticipantId: null, resultType: 'normal', status: 'awaitingResult',
    })
  })

  it('이미 경기가 있으면 다시 만들지 않는다(한 번 만든 대진은 다시 섞지 않음)', async () => {
    getDocsMock.mockResolvedValue(querySnapOf([restart[0]]))
    getDocMock.mockResolvedValue(snapOf(tournament()))
    await expect(createRestartBracket(RID, restart, input, CLUB)).rejects.toMatchObject({ code: 'blocked' })
    expect(batches).toHaveLength(0)
  })

  it('참가 신청 중이 아닌(이미 대진 확정된) 대회에는 만들지 않는다', async () => {
    getDocsMock.mockResolvedValue(querySnapOf([]))
    getDocMock.mockResolvedValue(snapOf(tournament({ status: 'bracketFixed' })))
    await expect(createRestartBracket(RID, restart, input, CLUB)).rejects.toMatchObject({ code: 'blocked' })
    expect(batches).toHaveLength(0)
  })
})

describe('placeRestartJoiner', () => {
  it('B 자리가 이미 차 있으면 아무것도 쓰지 않는다(덮어쓰기 없음)', async () => {
    const filled = { ...restart.find((m) => m.id === 'r2m1')!, playerBParticipantId: 'm3', playerBMemberId: 'm3', playerBHandicapSnapshot: 20 }
    serve({ restartMatches: [filled], sourceMatches: mainR1 })
    expect(await placeRestartJoiner(RID, 'r2m1', person(9, { id: 'm9' }), false, CLUB)).toBe(false)
    expect(batches).toHaveLength(0)
  })

  it('새 참가자는 만들고, 이미 있는 참가자는 참가 상태만 바꾸며, 경기 B 자리를 한 배치로 함께 쓴다', async () => {
    serve({ restartMatches: restart, sourceMatches: mainR1 })
    const p = person(9, { id: 'm9', tournamentHandicap: 22 })
    expect(await placeRestartJoiner(RID, 'r2m2', p, false, CLUB)).toBe(true)
    expect(batches[0].ops.map((o) => `${o.kind}:${o.path}`)).toEqual([`set:${RBASE}/participants/m9`, `update:${RBASE}/matches/r2m2`])
    expect(batches[0].ops[1].data).toEqual({ playerBParticipantId: 'm9', playerBMemberId: 'm9', playerBHandicapSnapshot: 22 })

    expect(await placeRestartJoiner(RID, 'r2m3', p, true, CLUB)).toBe(true)
    expect(batches[1].ops[0]).toEqual({ kind: 'update', path: `${RBASE}/participants/m9`, data: { entryStatus: 'entered' } })
  })
})

describe('syncRestartJoiners — 본선 최종 승인 결과로 합류 자리 자동 채움', () => {
  it('승인 대기 중인 본선 2차 결과로는 아무것도 배치하지 않는다', async () => {
    const pending = mainR1.map((m) => (m.id === 'r2m1'
      ? { ...m, status: 'awaitingApproval' as const, scoreA: 20, scoreB: 5, calculatedWinnerParticipantId: m.playerAParticipantId }
      : m))
    serve({ restartMatches: restart, sourceMatches: pending })
    expect(await syncRestartJoiners(RID, CLUB)).toBe(0)
    expect(batches).toHaveLength(0)
  })

  it('본선 2차 경기 1의 패자가 확정되면 합류 슬롯 1에 자동 배치된다', async () => {
    const source = decide(mainR1, 'r2m1', 'B')
    const loser = source.find((m) => m.id === 'r2m1')!.officialLoserParticipantId!.slice(1)
    serve({ restartMatches: restart, sourceMatches: source })
    expect(await syncRestartJoiners(RID, CLUB)).toBe(1)
    const ops = batches[0].ops
    expect(ops[0]).toMatchObject({ kind: 'set', path: `${RBASE}/participants/m${loser}` })
    expect(ops[0].data).toMatchObject({ displayNameSnapshot: `가상선수${loser}`, entryStatus: 'entered' })
    expect(ops[1]).toMatchObject({ kind: 'update', path: `${RBASE}/matches/r2m1` })
  })

  it('리스타트 대회에 이미 참가자 문서가 있는 합류자는 새로 만들지 않고 참가 상태만 바꾼다', async () => {
    const source = decide(mainR1, 'r2m1', 'B')
    const loser = source.find((m) => m.id === 'r2m1')!.officialLoserParticipantId!.slice(1)
    serve({
      restartMatches: restart, sourceMatches: source,
      restartParticipants: [person(Number(loser), { id: `m${loser}`, entryStatus: 'noResponse', tournamentHandicap: 23 })],
    })
    expect(await syncRestartJoiners(RID, CLUB)).toBe(1)
    expect(batches[0].ops[0]).toEqual({ kind: 'update', path: `${RBASE}/participants/m${loser}`, data: { entryStatus: 'entered' } })
    expect(batches[0].ops[1].data).toMatchObject({ playerBHandicapSnapshot: 23 })
  })

  it('본선 2차 패자 4명이 모두 확정되면 슬롯 1~4가 순서대로 모두 채워진다', async () => {
    serve({ restartMatches: restart, sourceMatches: decideRound(mainR1, 2) })
    expect(await syncRestartJoiners(RID, CLUB)).toBe(4)
    expect(batches.map((b) => b.ops[b.ops.length - 1].path)).toEqual([1, 2, 3, 4].map((n) => `${RBASE}/matches/r2m${n}`))
  })

  it('이미 모두 채워져 있으면 다시 불러도 아무것도 쓰지 않는다(여러 번 불러도 안전)', async () => {
    const source = decideRound(mainR1, 2)
    const filled = restart.map((m, i) => (m.playerBJoinFrom
      ? { ...m, playerBParticipantId: `m${i}`, playerBMemberId: `m${i}`, playerBHandicapSnapshot: 20 } : m))
    serve({ restartMatches: filled, sourceMatches: source })
    expect(await syncRestartJoiners(RID, CLUB)).toBe(0)
    expect(batches).toHaveLength(0)
  })

  it('리스타트 대진이 아닌 대회(연결된 본선 없음)에서는 아무것도 하지 않는다', async () => {
    getDocMock.mockResolvedValue(snapOf(tournament({ status: 'bracketFixed' })))
    expect(await syncRestartJoiners(RID, CLUB)).toBe(0)
    expect(getDocsMock).not.toHaveBeenCalled()
  })
})

describe('15명 본선(부전승 1명) — 저장', () => {
  const main15R1 = decideRound(mainWithByes([16]), 1)
  const a15 = (() => { const a = analyzeRestartSource(main15R1); if (!a.ok) throw new Error(a.message); return a.value })()
  const restart15 = (() => {
    const built = buildRestartBracket({
      sourceTournamentId: TID, analysis: a15, sourceMatches: main15R1, rng: seededRng(4),
      entrants: [2, 4, 6, 8, 10, 12, 14].map((n) => ({ participantId: `m${n}`, memberId: `m${n}`, handicap: 20 })),
    })
    if (!built.ok) throw new Error(built.message)
    return built.value.matches
  })()
  const input = { sourceTournamentId: TID, bracketSize: 16, participantCount: 7, at: AT }

  it('부전승 경기를 포함한 11경기를 한 배치로 저장한다(부전승은 공식 처리된 상태 그대로)', async () => {
    getDocsMock.mockResolvedValue(querySnapOf([]))
    getDocMock.mockResolvedValue(snapOf(tournament()))
    await createRestartBracket(RID, restart15, input, CLUB)
    const sets = batches[0].ops.filter((o) => o.kind === 'set')
    expect(sets).toHaveLength(11)
    expect(sets.filter((o) => o.data?.resultType === 'bye')).toHaveLength(1)
    expect(sets.find((o) => o.data?.resultType === 'bye')!.data).toMatchObject({ status: 'official', officialLoserParticipantId: null })
  })

  it('이미 만들어진 뒤 다시 생성을 요청하면 저장하지 않는다(재추첨 없음)', async () => {
    getDocsMock.mockResolvedValue(querySnapOf(restart15))
    getDocMock.mockResolvedValue(snapOf(tournament()))
    await expect(createRestartBracket(RID, restart15, input, CLUB)).rejects.toMatchObject({ code: 'blocked' })
    expect(batches).toHaveLength(0)
  })

  it('본선 8강 패자 4명이 확정되면 합류 자리 4개가 채워진다(부전승으로 올라온 A 자리는 그대로)', async () => {
    serve({ restartMatches: restart15, sourceMatches: decideRound(main15R1, 2) })
    expect(await syncRestartJoiners(RID, CLUB)).toBe(4)
    for (const b of batches) {
      const update = b.ops[b.ops.length - 1]
      expect(Object.keys(update.data!)).toEqual(['playerBParticipantId', 'playerBMemberId', 'playerBHandicapSnapshot'])
    }
  })
})

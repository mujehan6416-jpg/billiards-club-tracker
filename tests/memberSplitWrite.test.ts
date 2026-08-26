import { describe, it, expect, vi, beforeEach } from 'vitest'

// Firestore 호출부를 전부 모킹한다 — 실제 운영 Firestore는 읽지도 쓰지도 않는다.
// 보안 7단계(연결된 회원 전용 split write adapter)의 "실제 필요한 문서만 쓰는지,
// 무관한 문서를 건드리지 않는지, 재실행해도 안전한지"를 이 파일에서 확인한다.
// Firestore Rules 자체(권한 판정)는 tests/rules/splitMemberWrite.rules.test.ts에서 확인한다.

const setDocMock = vi.fn()
const deleteDocMock = vi.fn()
const getDocsMock = vi.fn()

interface FakeBatch {
  deletedPaths: string[]
  delete: (ref: { path: string }) => void
  commit: () => Promise<void>
}
let lastBatch: FakeBatch | null = null

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  getDoc: vi.fn(),
  getDocs: (...args: unknown[]) => getDocsMock(...args),
  setDoc: (...args: unknown[]) => setDocMock(...args),
  deleteDoc: (...args: unknown[]) => deleteDocMock(...args),
  writeBatch: () => {
    const batch: FakeBatch = {
      deletedPaths: [],
      delete(ref) {
        batch.deletedPaths.push(ref.path)
      },
      commit: vi.fn().mockResolvedValue(undefined),
    }
    lastBatch = batch
    return batch
  },
}))
vi.mock('../src/lib/firebase', () => ({ db: {} }))

import {
  submitMemberGameResult,
  resubmitMemberGameResult,
  deleteSplitSession,
  deleteSplitGame,
} from '../src/lib/splitFirestore'
import type { Game } from '../src/types'

const baseGame: Game = {
  id: 'game-1',
  playerAId: 'member-1',
  playerBId: 'member-2',
  handicapA: 18,
  handicapB: 20,
  scoreA: 10,
  scoreB: 12,
  endType: 'time',
  playedAt: '2026-08-26T10:00:00.000Z',
  round: 1,
}

beforeEach(() => {
  setDocMock.mockReset()
  deleteDocMock.mockReset()
  getDocsMock.mockReset()
  lastBatch = null
})

describe('submitMemberGameResult — 회원 최초 경기 결과 제출', () => {
  it('세션·경기 ID로 결정되는 경로 하나에만 쓴다', async () => {
    await submitMemberGameResult('session-1', baseGame)

    expect(setDocMock).toHaveBeenCalledTimes(1)
    const [ref] = setDocMock.mock.calls[0]
    expect(ref.path).toBe('clubs/skkubc/sessions/session-1/games/game-1')
  })

  it('pending을 항상 true로 강제한다', async () => {
    await submitMemberGameResult('session-1', { ...baseGame, pending: false })

    const [, data] = setDocMock.mock.calls[0]
    expect(data.pending).toBe(true)
  })

  it('winnerId·revisionRequested가 입력 game 객체에 있어도 쓰는 문서에는 포함하지 않는다 — Rules의 hasOnly와 어긋나지 않게', async () => {
    await submitMemberGameResult('session-1', {
      ...baseGame,
      winnerId: 'member-1',
      revisionRequested: true,
    } as Game)

    const [, data] = setDocMock.mock.calls[0]
    expect('winnerId' in data).toBe(false)
    expect('revisionRequested' in data).toBe(false)
  })

  it('round가 없는 경기(번개모임 등)는 round 키 자체를 만들지 않는다', async () => {
    const { round: _round, ...withoutRound } = baseGame
    await submitMemberGameResult('session-1', withoutRound as Game)

    const [, data] = setDocMock.mock.calls[0]
    expect('round' in data).toBe(false)
  })

  it('허용된 필드만 정확히 담는다(id·참가자·핸디·점수·종료유형·시각·round·pending)', async () => {
    await submitMemberGameResult('session-1', baseGame)

    const [, data] = setDocMock.mock.calls[0]
    expect(Object.keys(data).sort()).toEqual(
      ['endType', 'handicapA', 'handicapB', 'id', 'pending', 'playedAt', 'playerAId', 'playerBId', 'round', 'scoreA', 'scoreB'].sort(),
    )
  })

  it('다른 세션·다른 경기 경로는 건드리지 않는다', async () => {
    await submitMemberGameResult('session-1', baseGame)

    expect(deleteDocMock).not.toHaveBeenCalled()
    const [ref] = setDocMock.mock.calls[0]
    expect(ref.path).not.toContain('session-2')
  })
})

describe('resubmitMemberGameResult — 수정 요청 후 회원 재제출', () => {
  it('세션·경기 ID로 결정되는 경로에 merge:true로 쓴다', async () => {
    await resubmitMemberGameResult('session-1', { id: 'game-1', scoreA: 15, scoreB: 18, endType: 'cleared' })

    expect(setDocMock).toHaveBeenCalledTimes(1)
    const [ref, data, options] = setDocMock.mock.calls[0]
    expect(ref.path).toBe('clubs/skkubc/sessions/session-1/games/game-1')
    expect(options).toEqual({ merge: true })
    expect(data).toEqual({ scoreA: 15, scoreB: 18, endType: 'cleared', pending: true, revisionRequested: false })
  })

  it('Rules가 허용하는 diff 필드(scoreA·scoreB·endType·pending·revisionRequested) 밖의 값은 절대 포함하지 않는다', async () => {
    await resubmitMemberGameResult('session-1', { id: 'game-1', scoreA: 1, scoreB: 2, endType: 'time' })

    const [, data] = setDocMock.mock.calls[0]
    expect(Object.keys(data).sort()).toEqual(['endType', 'pending', 'revisionRequested', 'scoreA', 'scoreB'].sort())
  })
})

describe('deleteSplitSession — 세션과 그 경기 전체를 하나의 배치로 지운다', () => {
  it('그 세션의 games 전부와 세션 문서 자신을 지운다', async () => {
    getDocsMock.mockResolvedValueOnce({
      docs: [
        { ref: { path: 'clubs/skkubc/sessions/session-1/games/game-1' } },
        { ref: { path: 'clubs/skkubc/sessions/session-1/games/game-2' } },
      ],
    })

    await deleteSplitSession('session-1')

    expect(lastBatch).not.toBeNull()
    expect(lastBatch!.deletedPaths).toEqual([
      'clubs/skkubc/sessions/session-1/games/game-1',
      'clubs/skkubc/sessions/session-1/games/game-2',
      'clubs/skkubc/sessions/session-1',
    ])
  })

  it('다른 세션의 games 컬렉션은 조회하지 않는다 — 무관한 세션에 영향 없음', async () => {
    getDocsMock.mockResolvedValueOnce({ docs: [] })

    await deleteSplitSession('session-1')

    const [gamesColRef] = getDocsMock.mock.calls[0]
    expect(gamesColRef.path).toBe('clubs/skkubc/sessions/session-1/games')
  })

  it('이미 games가 없는 세션(중복 실행)에도 안전하게 세션 문서만 지운다', async () => {
    getDocsMock.mockResolvedValueOnce({ docs: [] })

    await deleteSplitSession('session-1')

    expect(lastBatch!.deletedPaths).toEqual(['clubs/skkubc/sessions/session-1'])
  })
})

describe('deleteSplitGame — 경기 문서 하나만 지운다', () => {
  it('결정되는 경로 하나만 지우고, 세션 문서나 다른 경기는 건드리지 않는다', async () => {
    await deleteSplitGame('session-1', 'game-1')

    expect(deleteDocMock).toHaveBeenCalledTimes(1)
    const [ref] = deleteDocMock.mock.calls[0]
    expect(ref.path).toBe('clubs/skkubc/sessions/session-1/games/game-1')
    expect(setDocMock).not.toHaveBeenCalled()
  })
})

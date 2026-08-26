import { describe, it, expect, vi, beforeEach } from 'vitest'

// Firestore 호출부를 전부 모킹한다 — 실제 운영 Firestore는 읽지도 쓰지도 않는다.
// 이 파일의 데이터는 전부 가상 fixture이며 실제 회원 정보가 아니다.
const getDocMock = vi.fn()
const getDocsMock = vi.fn()

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  getDoc: (...args: unknown[]) => getDocMock(...args),
  getDocs: (...args: unknown[]) => getDocsMock(...args),
  setDoc: vi.fn(),
  writeBatch: vi.fn(),
}))
vi.mock('../src/lib/firebase', () => ({ db: {} }))

import { loadSplitAppState } from '../src/lib/splitFirestore'
import { splitLegacyAppState } from '../src/logic/splitAppState'
import { makeLegacyAppState, withoutPassword } from './fixtures/legacyAppState'
import type { AppState } from '../src/types'

const legacy = () => makeLegacyAppState()

/** legacy AppState를 split한 뒤, Firestore 컬렉션 조회가 그 데이터를 돌려주는 것처럼 모킹한다.
 *  일부러 배열 순서를 뒤섞어서(shuffleOrder), 읽기 순서가 저장 순서와 다를 수 있다는 점을
 *  실제 Firestore 컬렉션 조회처럼 재현한다. */
function mockSplitFirestore(state: AppState, { shuffleOrder = false } = {}) {
  const split = splitLegacyAppState(state)
  const maybeShuffle = <T,>(arr: T[]) => (shuffleOrder ? [...arr].reverse() : arr)

  getDocMock.mockResolvedValue({ exists: () => true, data: () => split.config })
  getDocsMock.mockImplementation((ref: { path: string }) => {
    if (ref.path === 'clubs/skkubc/members') {
      return Promise.resolve({ docs: maybeShuffle(split.members).map((m) => ({ data: () => m })) })
    }
    if (ref.path === 'clubs/skkubc/sessions') {
      return Promise.resolve({ docs: maybeShuffle(split.sessions).map((s) => ({ data: () => s })) })
    }
    if (ref.path === 'clubs/skkubc/ledger') {
      return Promise.resolve({ docs: maybeShuffle(split.ledger).map((r) => ({ data: () => r })) })
    }
    const m = /^clubs\/skkubc\/sessions\/(.+)\/games$/.exec(ref.path)
    if (m) {
      const games = split.games.filter((g) => g.sessionId === m[1]).map((g) => g.game)
      return Promise.resolve({ docs: maybeShuffle(games).map((g) => ({ data: () => g })) })
    }
    return Promise.resolve({ docs: [] })
  })
}

beforeEach(() => {
  getDocMock.mockReset()
  getDocsMock.mockReset()
})

describe('loadSplitAppState — split을 읽어 legacy AppState로 재조립', () => {
  it('회원 수와 ID가 legacy와 같다', async () => {
    const state = legacy()
    mockSplitFirestore(state)

    const loaded = await loadSplitAppState()

    expect(loaded.members.map((m) => m.id).sort()).toEqual(state.members.map((m) => m.id).sort())
  })

  it('회원별 핸디·핸디이력·활성상태·구분정보가 ID 기준으로 일치한다', async () => {
    const state = legacy()
    mockSplitFirestore(state)

    const loaded = await loadSplitAppState()

    for (const original of state.members) {
      const back = loaded.members.find((m) => m.id === original.id)!
      expect(back.handicap).toBe(original.handicap)
      expect(back.handicapHistory).toEqual(original.handicapHistory)
      expect(back.active).toBe(original.active)
      expect(back.displayTag).toBe(original.displayTag)
    }
  })

  it('회원 문서에 비밀번호가 없다 — 로그인 화면 값과 다르다', async () => {
    const state = legacy()
    mockSplitFirestore(state)

    const loaded = await loadSplitAppState()

    for (const m of loaded.members) expect('password' in m).toBe(false)
  })

  it('세션 수와 ID가 legacy와 같다', async () => {
    const state = legacy()
    mockSplitFirestore(state)

    const loaded = await loadSplitAppState()

    expect(loaded.sessions.map((s) => s.id).sort()).toEqual(state.sessions.map((s) => s.id).sort())
  })

  it('경기 수가 legacy와 같고, 각 경기가 원래 속했던 모임 안에 그대로 있다', async () => {
    const state = legacy()
    mockSplitFirestore(state)

    const loaded = await loadSplitAppState()

    const legacyGameCount = state.sessions.reduce((n, s) => n + s.games.length, 0)
    const loadedGameCount = loaded.sessions.reduce((n, s) => n + s.games.length, 0)
    expect(loadedGameCount).toBe(legacyGameCount)

    for (const originalSession of state.sessions) {
      const backSession = loaded.sessions.find((s) => s.id === originalSession.id)!
      expect(backSession.games.map((g) => g.id).sort()).toEqual(originalSession.games.map((g) => g.id).sort())
    }
  })

  it('경기의 적용 핸디·점수·winnerId·pending·revisionRequested가 ID 기준으로 그대로 보존된다', async () => {
    const state = legacy()
    mockSplitFirestore(state)

    const loaded = await loadSplitAppState()

    for (const originalSession of state.sessions) {
      const backSession = loaded.sessions.find((s) => s.id === originalSession.id)!
      for (const originalGame of originalSession.games) {
        const backGame = backSession.games.find((g) => g.id === originalGame.id)!
        expect(backGame).toEqual(originalGame)
      }
    }
  })

  it('회계 건수와 ID가 legacy와 같다', async () => {
    const state = legacy()
    mockSplitFirestore(state)

    const loaded = await loadSplitAppState()

    expect(loaded.ledger.map((r) => r.id).sort()).toEqual(state.ledger.map((r) => r.id).sort())
  })

  it('설정(settings)이 보존된다', async () => {
    const state = legacy()
    mockSplitFirestore(state)

    const loaded = await loadSplitAppState()

    expect(loaded.settings).toEqual(state.settings)
  })

  it('Firestore 컬렉션 조회 순서가 저장 순서와 달라도 결과는 legacy와 의미상 동일하다', async () => {
    const state = legacy()
    mockSplitFirestore(state, { shuffleOrder: true })

    const loaded = await loadSplitAppState()

    const expected: AppState = { ...state, members: state.members.map(withoutPassword) }
    // 배열 순서가 아니라 ID 기준으로 비교한다 — Firestore는 조회 순서를 보장하지 않는다.
    const byId = <T extends { id: string }>(arr: T[]) => [...arr].sort((a, b) => a.id.localeCompare(b.id))
    expect(byId(loaded.members)).toEqual(byId(expected.members))
    expect(byId(loaded.sessions).map((s) => ({ ...s, games: byId(s.games) })))
      .toEqual(byId(expected.sessions).map((s) => ({ ...s, games: byId(s.games) })))
    expect(byId(loaded.ledger)).toEqual(byId(expected.ledger))
  })

  it('config 문서가 아직 없어도(null) 오류 없이 기본값으로 처리한다', async () => {
    const state = legacy()
    mockSplitFirestore(state)
    getDocMock.mockResolvedValue({ exists: () => false })

    const loaded = await loadSplitAppState()

    expect(loaded.settings).toEqual({ lastBackupAt: null })
  })

  it('읽기만 한다 — Firestore에 아무것도 쓰지 않는다', async () => {
    const state = legacy()
    mockSplitFirestore(state)

    await loadSplitAppState()

    const firestore = await import('firebase/firestore')
    expect(firestore.setDoc).not.toHaveBeenCalled()
    expect(firestore.writeBatch).not.toHaveBeenCalled()
  })
})

describe('loadSplitAppState — 회계 읽기 권한이 없는 일반 회원 기기', () => {
  /** 회계만 권한 거부되고 나머지는 정상인 상태 — 연결된 "일반 회원" 기기의 실제 상황이다.
   *  (firestore.rules상 ledger는 관리자만 읽을 수 있고, 나머지는 연결된 회원도 읽을 수 있다.) */
  function mockLedgerDenied(state: AppState) {
    mockSplitFirestore(state)
    const allowed = getDocsMock.getMockImplementation()!
    getDocsMock.mockImplementation((ref: { path: string }) => {
      if (ref.path === 'clubs/skkubc/ledger') {
        return Promise.reject(Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' }))
      }
      return allowed(ref)
    })
  }

  it('회계 권한이 없어도 전체 읽기가 실패하지 않는다', async () => {
    const state = legacy()
    mockLedgerDenied(state)

    // 예전에는 여기서 permission-denied가 그대로 터졌고, 앱은 그것을 "이 기기가 아직 연결되지
    // 않음"으로 잘못 해석해 승인이 끝난 회원 기기를 기기 연결 화면으로 되돌려 보냈다.
    const result = await loadSplitAppState()

    expect(result.members).toHaveLength(state.members.length)
    expect(result.sessions).toHaveLength(state.sessions.length)
  })

  it('회계는 빈 목록으로 돌려준다 — 회계 화면은 어차피 관리자 전용이다', async () => {
    const state = legacy()
    mockLedgerDenied(state)

    const result = await loadSplitAppState()

    expect(result.ledger).toEqual([])
  })

  it('관리자처럼 회계를 읽을 수 있으면 그대로 다 담는다', async () => {
    const state = legacy()
    mockSplitFirestore(state)

    const result = await loadSplitAppState()

    expect(result.ledger).toHaveLength(state.ledger.length)
  })

  it('권한 문제가 아닌 실패(네트워크 등)는 조용히 삼키지 않고 그대로 알린다', async () => {
    const state = legacy()
    mockSplitFirestore(state)
    const allowed = getDocsMock.getMockImplementation()!
    getDocsMock.mockImplementation((ref: { path: string }) => {
      if (ref.path === 'clubs/skkubc/ledger') return Promise.reject(new Error('offline'))
      return allowed(ref)
    })

    // 관리자가 회계를 못 읽은 것을 눈치채지 못한 채 앱을 쓰는 일이 없어야 한다.
    await expect(loadSplitAppState()).rejects.toThrow('offline')
  })
})

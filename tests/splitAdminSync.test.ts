import { describe, it, expect, vi, beforeEach } from 'vitest'

// Firestore 호출부를 전부 모킹한다 — 실제 운영 Firestore는 읽지도 쓰지도 않는다.
// 이 파일은 보안 8단계의 핵심 부품인 syncSplitChanges(관리자 전체 상태 diff 동기화)와
// toPublicMember/toSessionDoc(필드 화이트리스트)를 검증한다. Firestore Rules 자체(권한 판정)는
// tests/rules/*.rules.test.ts에서 확인한다 — 여기서는 "실제 바뀐 문서만, 정확한 필드로,
// 무관한 문서는 건드리지 않고" 쓰는지를 확인한다.

const setDocMock = vi.fn()
const deleteDocMock = vi.fn()
const updateDocMock = vi.fn()

interface BatchOp { kind: 'set' | 'delete'; path: string; data?: unknown }
const allBatchOps: BatchOp[][] = [] // 커밋된 배치마다 그 배치의 연산 목록 하나
const commitMocks: ReturnType<typeof vi.fn>[] = []

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  setDoc: (...args: unknown[]) => setDocMock(...args),
  deleteDoc: (...args: unknown[]) => deleteDocMock(...args),
  updateDoc: (...args: unknown[]) => updateDocMock(...args),
  writeBatch: () => {
    const ops: BatchOp[] = []
    allBatchOps.push(ops)
    const commit = vi.fn().mockResolvedValue(undefined)
    commitMocks.push(commit)
    return {
      set: (ref: { path: string }, data: unknown) => ops.push({ kind: 'set', path: ref.path, data }),
      delete: (ref: { path: string }) => ops.push({ kind: 'delete', path: ref.path }),
      commit,
    }
  },
}))
vi.mock('../src/lib/firebase', () => ({ db: {} }))

import { syncSplitChanges, toPublicMember, toSessionDoc, toMemberIndexEntry, updateFlashSessionAttendees } from '../src/lib/splitFirestore'
import type { AppState, Member, Session } from '../src/types'

const member = (over: Partial<Member> = {}): Member => ({
  id: 'member-1', name: '테스트회원', handicap: 20,
  handicapHistory: [{ value: 20, changedAt: '2026-01-01T00:00:00.000Z', source: 'admin' }],
  active: true, ...over,
})

const session = (over: Partial<Session> = {}): Session => ({
  id: 'session-1', date: '2026-08-26', attendeeIds: ['member-1', 'member-2'], games: [], ...over,
})

const emptyState = (): AppState => ({
  members: [], sessions: [], settings: { lastBackupAt: null }, ledger: [],
})

beforeEach(() => {
  setDocMock.mockReset()
  deleteDocMock.mockReset()
  updateDocMock.mockReset()
  allBatchOps.length = 0
  commitMocks.length = 0
})

const opsFlat = () => allBatchOps.flat()

describe('toPublicMember / toSessionDoc — 필드 화이트리스트', () => {
  it('password가 있는 Member를 넣어도 결과에는 password가 없다', () => {
    const withPw = member({ password: '1234' })
    const pub = toPublicMember(withPw)
    expect('password' in pub).toBe(false)
    expect(pub).toEqual({
      id: 'member-1', name: '테스트회원', handicap: 20,
      handicapHistory: withPw.handicapHistory, active: true,
    })
  })

  it('displayTag가 없으면 필드 자체가 생기지 않는다(Firestore가 undefined 필드를 거부)', () => {
    const pub = toPublicMember(member())
    expect('displayTag' in pub).toBe(false)
  })

  it('Session을 SessionDoc으로 바꾸면 games 필드가 빠진다', () => {
    const s = session({ games: [{ id: 'g1', playerAId: 'a', playerBId: 'b', handicapA: 1, handicapB: 1, scoreA: 0, scoreB: 0, endType: 'time', playedAt: 'x' }] })
    const doc = toSessionDoc(s)
    expect('games' in doc).toBe(false)
    expect(doc.id).toBe('session-1')
  })
})

describe('syncSplitChanges — 회원 (+ 미연결 기기용 이름 찾기 목록)', () => {
  it('새 회원은 members·memberIndex 둘 다 create(set)한다', async () => {
    const previous = emptyState()
    const next = { ...emptyState(), members: [member()] }
    await syncSplitChanges(previous, next)
    expect(opsFlat()).toEqual(expect.arrayContaining([
      { kind: 'set', path: 'clubs/skkubc/members/member-1', data: toPublicMember(member()) },
      { kind: 'set', path: 'clubs/skkubc/memberIndex/member-1', data: toMemberIndexEntry(member()) },
    ]))
    expect(opsFlat()).toHaveLength(2)
  })

  it('공개정보(이름·핸디 등)가 바뀐 회원만 set한다 — 안 바뀐 회원은 건드리지 않는다', async () => {
    const untouched = member({ id: 'member-2', name: '그대로' })
    const previous = { ...emptyState(), members: [member(), untouched] }
    const next = { ...emptyState(), members: [member({ handicap: 22 }), untouched] }
    await syncSplitChanges(previous, next)
    // handicap만 바뀌었으므로 members는 다시 쓰지만, memberIndex(이름·활성·구분정보만 담음)는
    // 실제로 안 바뀌었으니 쓰지 않는다 — 무관한 컬렉션까지 매번 다시 쓰지 않는다는 원칙 그대로.
    expect(opsFlat()).toEqual([
      { kind: 'set', path: 'clubs/skkubc/members/member-1', data: toPublicMember(member({ handicap: 22 })) },
    ])
  })

  it('이름이 바뀌면 members와 memberIndex 둘 다 다시 쓴다', async () => {
    const previous = { ...emptyState(), members: [member()] }
    const next = { ...emptyState(), members: [member({ name: '이름바뀜' })] }
    await syncSplitChanges(previous, next)
    expect(opsFlat()).toEqual(expect.arrayContaining([
      { kind: 'set', path: 'clubs/skkubc/members/member-1', data: toPublicMember(member({ name: '이름바뀜' })) },
      { kind: 'set', path: 'clubs/skkubc/memberIndex/member-1', data: toMemberIndexEntry(member({ name: '이름바뀜' })) },
    ]))
    expect(opsFlat()).toHaveLength(2)
  })

  it('password만 바뀌면 아무것도 쓰지 않는다(members·memberIndex 둘 다 password가 없어 차이가 안 생김)', async () => {
    const previous = { ...emptyState(), members: [member({ password: 'old-pw' })] }
    const next = { ...emptyState(), members: [member({ password: 'new-pw' })] }
    await syncSplitChanges(previous, next)
    expect(opsFlat()).toEqual([])
    expect(commitMocks.length).toBe(0)
  })

  it('없어진 회원은 members·memberIndex 둘 다 delete한다', async () => {
    const previous = { ...emptyState(), members: [member()] }
    const next = emptyState()
    await syncSplitChanges(previous, next)
    expect(opsFlat()).toEqual(expect.arrayContaining([
      { kind: 'delete', path: 'clubs/skkubc/members/member-1' },
      { kind: 'delete', path: 'clubs/skkubc/memberIndex/member-1' },
    ]))
    expect(opsFlat()).toHaveLength(2)
  })

  it('아무것도 안 바뀌면 batch.commit을 한 번도 호출하지 않는다', async () => {
    const state = { ...emptyState(), members: [member()] }
    await syncSplitChanges(state, state)
    expect(opsFlat()).toEqual([])
    expect(commitMocks.length).toBe(0)
  })
})

describe('syncSplitChanges — 세션과 경기', () => {
  it('새 세션(경기 포함)을 만들면 세션 문서와 각 경기 문서를 모두 set한다', async () => {
    const game = { id: 'g1', playerAId: 'member-1', playerBId: 'member-2', handicapA: 20, handicapB: 20, scoreA: 20, scoreB: 15, endType: 'cleared' as const, playedAt: 'x' }
    const previous = emptyState()
    const next = { ...emptyState(), sessions: [session({ games: [game] })] }
    await syncSplitChanges(previous, next)
    expect(opsFlat()).toEqual(expect.arrayContaining([
      { kind: 'set', path: 'clubs/skkubc/sessions/session-1', data: toSessionDoc(session()) },
      { kind: 'set', path: 'clubs/skkubc/sessions/session-1/games/g1', data: game },
    ]))
    expect(opsFlat()).toHaveLength(2)
  })

  it('세션 필드(approved)만 바뀌면 세션 문서만 쓰고 경기는 건드리지 않는다', async () => {
    const game = { id: 'g1', playerAId: 'member-1', playerBId: 'member-2', handicapA: 20, handicapB: 20, scoreA: 20, scoreB: 15, endType: 'cleared' as const, playedAt: 'x', pending: true }
    const previous = { ...emptyState(), sessions: [session({ type: 'flash', approved: false, games: [game] })] }
    const next = { ...emptyState(), sessions: [session({ type: 'flash', approved: true, games: [{ ...game, pending: false }] })] }
    await syncSplitChanges(previous, next)
    // approved 변경(세션 문서) + pending 변경(경기 문서) 둘 다 실제로 바뀐 값이라 둘 다 쓴다
    expect(opsFlat()).toEqual(expect.arrayContaining([
      { kind: 'set', path: 'clubs/skkubc/sessions/session-1', data: toSessionDoc(session({ type: 'flash', approved: true })) },
      { kind: 'set', path: 'clubs/skkubc/sessions/session-1/games/g1', data: { ...game, pending: false } },
    ]))
    expect(opsFlat()).toHaveLength(2)
  })

  it('세션은 그대로고 경기 하나만 추가되면 그 경기 문서 하나만 set한다(세션 문서는 다시 안 씀)', async () => {
    const g1 = { id: 'g1', playerAId: 'member-1', playerBId: 'member-2', handicapA: 20, handicapB: 20, scoreA: 20, scoreB: 15, endType: 'cleared' as const, playedAt: 'x' }
    const g2 = { ...g1, id: 'g2' }
    const previous = { ...emptyState(), sessions: [session({ games: [g1] })] }
    const next = { ...emptyState(), sessions: [session({ games: [g1, g2] })] }
    await syncSplitChanges(previous, next)
    expect(opsFlat()).toEqual([{ kind: 'set', path: 'clubs/skkubc/sessions/session-1/games/g2', data: g2 }])
  })

  it('경기 하나가 삭제되면 그 경기 문서만 delete한다(다른 경기·세션 문서는 안 건드림)', async () => {
    const g1 = { id: 'g1', playerAId: 'member-1', playerBId: 'member-2', handicapA: 20, handicapB: 20, scoreA: 20, scoreB: 15, endType: 'cleared' as const, playedAt: 'x' }
    const g2 = { ...g1, id: 'g2' }
    const previous = { ...emptyState(), sessions: [session({ games: [g1, g2] })] }
    const next = { ...emptyState(), sessions: [session({ games: [g1] })] }
    await syncSplitChanges(previous, next)
    expect(opsFlat()).toEqual([{ kind: 'delete', path: 'clubs/skkubc/sessions/session-1/games/g2' }])
  })

  it('세션 자체가 삭제되면 세션 문서와 그 경기 전부를 delete한다', async () => {
    const g1 = { id: 'g1', playerAId: 'member-1', playerBId: 'member-2', handicapA: 20, handicapB: 20, scoreA: 20, scoreB: 15, endType: 'cleared' as const, playedAt: 'x' }
    const other = session({ id: 'session-2', games: [] })
    const previous = { ...emptyState(), sessions: [session({ games: [g1] }), other] }
    const next = { ...emptyState(), sessions: [other] }
    await syncSplitChanges(previous, next)
    expect(opsFlat()).toEqual(expect.arrayContaining([
      { kind: 'delete', path: 'clubs/skkubc/sessions/session-1/games/g1' },
      { kind: 'delete', path: 'clubs/skkubc/sessions/session-1' },
    ]))
    expect(opsFlat()).toHaveLength(2)
    // 무관한 다른 세션(session-2)은 전혀 등장하지 않는다
    expect(opsFlat().some((o) => o.path.includes('session-2'))).toBe(false)
  })
})

describe('syncSplitChanges — 회계·설정', () => {
  it('회계 기록 생성·수정·삭제를 각각 set/set/delete로 반영한다', async () => {
    const r1 = { id: 'r1', date: '2026-08-01', inCashMembership: 1000, inCashDonation: 0, inTransferMembership: 0, inTransferDonation: 0, inCardDonation: 0, inAnnualFee: 0, outCash: 0, outCard: 0, outTransfer: 0 }
    const r2 = { ...r1, id: 'r2' }
    const previous = { ...emptyState(), ledger: [r1, r2] }
    const next = { ...emptyState(), ledger: [{ ...r1, inCashMembership: 2000 }] } // r1 수정, r2 삭제
    await syncSplitChanges(previous, next)
    expect(opsFlat()).toEqual(expect.arrayContaining([
      { kind: 'set', path: 'clubs/skkubc/ledger/r1', data: { ...r1, inCashMembership: 2000 } },
      { kind: 'delete', path: 'clubs/skkubc/ledger/r2' },
    ]))
    expect(opsFlat()).toHaveLength(2)
  })

  it('lastBackupAt이 바뀌면 config 문서를 쓴다', async () => {
    const previous = emptyState()
    const next = { ...emptyState(), settings: { lastBackupAt: '2026-08-26T00:00:00.000Z' } }
    await syncSplitChanges(previous, next)
    expect(opsFlat()).toEqual([{ kind: 'set', path: 'clubs/skkubc/config/main', data: { lastBackupAt: '2026-08-26T00:00:00.000Z' } }])
  })
})

describe('syncSplitChanges — 배치 나누기(500개 제한)', () => {
  it('연산이 450개를 넘으면 배치를 나눠 여러 번 commit한다', async () => {
    // 회원 한 명당 members·memberIndex 2개씩 생기므로 500명 = 1000개 연산
    const many = Array.from({ length: 500 }, (_, i) => member({ id: `member-${i}` }))
    const previous = emptyState()
    const next = { ...emptyState(), members: many }
    await syncSplitChanges(previous, next)
    expect(opsFlat()).toHaveLength(1000)
    expect(commitMocks.length).toBeGreaterThan(1)
    for (const c of commitMocks) expect(c).toHaveBeenCalledTimes(1)
  })
})

describe('updateFlashSessionAttendees — 회원용 부분 업데이트', () => {
  it('updateDoc으로 attendeeIds 하나만 정확히 보낸다(setDoc 전체 덮어쓰기를 쓰지 않음)', async () => {
    await updateFlashSessionAttendees('session-1', ['member-1', 'member-2'])
    expect(updateDocMock).toHaveBeenCalledTimes(1)
    const [ref, data] = updateDocMock.mock.calls[0]
    expect(ref.path).toBe('clubs/skkubc/sessions/session-1')
    expect(data).toEqual({ attendeeIds: ['member-1', 'member-2'] })
    expect(setDocMock).not.toHaveBeenCalled()
  })
})

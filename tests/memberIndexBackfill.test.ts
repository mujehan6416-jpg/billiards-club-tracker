import { describe, it, expect, vi, beforeEach } from 'vitest'

// Firestore 실제 호출부를 전부 모킹 — "memberIndex 말고 다른 컬렉션은 절대 쓰지 않는다"를
// 확인하려면 모든 쓰기 호출의 경로를 세어야 한다. 실제 운영 데이터는 읽지도 쓰지도 않는다.
const setDocMock = vi.fn()
const deleteDocMock = vi.fn()
const batchSetMock = vi.fn()
const batchDeleteMock = vi.fn()
const batchCommitMock = vi.fn()
const getDocsMock = vi.fn()
const getDocMock = vi.fn()

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  getDoc: (...args: unknown[]) => getDocMock(...args),
  getDocs: (...args: unknown[]) => getDocsMock(...args),
  setDoc: (...args: unknown[]) => setDocMock(...args),
  deleteDoc: (...args: unknown[]) => deleteDocMock(...args),
  updateDoc: vi.fn(),
  writeBatch: () => ({
    set: (...args: unknown[]) => batchSetMock(...args),
    delete: (...args: unknown[]) => batchDeleteMock(...args),
    commit: () => batchCommitMock(),
  }),
}))
vi.mock('../src/lib/firebase', () => ({ db: {} }))

import {
  MEMBER_INDEX_CONFIRM_PHRASE, prepareMemberIndexBackfill, runAdminMemberIndexBackfill, verifyMemberIndex,
} from '../src/lib/migration'
import { makeLegacyAppState } from './fixtures/legacyAppState'

const legacy = () => makeLegacyAppState()
const ADMIN_UID = 'admin-uid-test'
const MEMBER_COUNT = 24 // fixture의 회원 수

/** batch/단건 쓰기로 실제로 건드린 문서 경로 전부. */
const writtenPaths = () => [
  ...batchSetMock.mock.calls.map((c) => (c[0] as { path: string }).path),
  ...batchDeleteMock.mock.calls.map((c) => (c[0] as { path: string }).path),
  ...setDocMock.mock.calls.map((c) => (c[0] as { path: string }).path),
  ...deleteDocMock.mock.calls.map((c) => (c[0] as { path: string }).path),
]

beforeEach(() => {
  setDocMock.mockReset(); setDocMock.mockResolvedValue(undefined)
  deleteDocMock.mockReset(); deleteDocMock.mockResolvedValue(undefined)
  batchSetMock.mockReset()
  batchDeleteMock.mockReset()
  batchCommitMock.mockReset(); batchCommitMock.mockResolvedValue(undefined)
  getDocsMock.mockReset(); getDocsMock.mockResolvedValue({ docs: [] })
  getDocMock.mockReset()
})

describe('prepareMemberIndexBackfill — 계획만 세운다', () => {
  it('Firestore에 아무것도 쓰지 않는다', () => {
    prepareMemberIndexBackfill(legacy())
    expect(writtenPaths()).toEqual([])
    expect(batchCommitMock).not.toHaveBeenCalled()
  })

  it('만들어질 문서 수는 회원 수와 같다', () => {
    const plan = prepareMemberIndexBackfill(legacy())
    expect(plan.documentCount).toBe(MEMBER_COUNT)
    expect(plan.entries).toHaveLength(MEMBER_COUNT)
    expect(plan.ok).toBe(true)
    expect(plan.issues).toEqual([])
  })

  it('비활성 회원도 목록에 포함한다 — 화면에서 거르더라도 목록 자체는 회원 전체를 담는다', () => {
    const state = legacy()
    const inactiveCount = state.members.filter((m) => !m.active).length
    expect(inactiveCount).toBeGreaterThan(0) // fixture 전제 확인

    const plan = prepareMemberIndexBackfill(state)
    expect(plan.entries).toHaveLength(state.members.length)
    expect(plan.entries.filter((e) => !e.active)).toHaveLength(inactiveCount)
  })

  it('목록에는 이름·활성여부·구분정보만 담고 비밀번호·핸디는 절대 담지 않는다', () => {
    const plan = prepareMemberIndexBackfill(legacy())
    for (const entry of plan.entries) {
      expect(entry).not.toHaveProperty('password')
      expect(entry).not.toHaveProperty('handicap')
      expect(entry).not.toHaveProperty('handicapHistory')
      expect(Object.keys(entry).sort()).toEqual(
        expect.arrayContaining(['id', 'name', 'active']),
      )
      // 허용된 키 말고는 아무것도 없어야 한다
      for (const key of Object.keys(entry)) {
        expect(['id', 'name', 'active', 'displayTag']).toContain(key)
      }
    }
  })

  it('회원 ID가 중복되면 문제로 잡는다', () => {
    const broken = legacy()
    broken.members[1].id = broken.members[0].id
    const plan = prepareMemberIndexBackfill(broken)
    expect(plan.ok).toBe(false)
    expect(plan.issues.join()).toContain('중복')
  })

  it('회원이 하나도 없으면 문제로 잡는다', () => {
    const empty = legacy()
    empty.members = []
    const plan = prepareMemberIndexBackfill(empty)
    expect(plan.ok).toBe(false)
    expect(plan.documentCount).toBe(0)
  })
})

describe('runAdminMemberIndexBackfill — 안전장치', () => {
  it('관리자 인증이 없으면 저장하지 않는다', async () => {
    const result = await runAdminMemberIndexBackfill(legacy(), { confirmPhrase: MEMBER_INDEX_CONFIRM_PHRASE })
    expect(result.written).toBe(false)
    expect(result.skippedReason).toContain('관리자 로그인')
    expect(writtenPaths()).toEqual([])
  })

  it('확인 문구가 없거나 틀리면 저장하지 않는다', async () => {
    const noPhrase = await runAdminMemberIndexBackfill(legacy(), { adminUid: ADMIN_UID })
    expect(noPhrase.written).toBe(false)
    expect(noPhrase.skippedReason).toContain('확인 문구')

    const wrongPhrase = await runAdminMemberIndexBackfill(legacy(), { adminUid: ADMIN_UID, confirmPhrase: '만들어줘' })
    expect(wrongPhrase.written).toBe(false)

    expect(writtenPaths()).toEqual([])
    expect(batchCommitMock).not.toHaveBeenCalled()
  })

  it('검사를 통과하지 못하면 확인 문구가 맞아도 저장하지 않는다', async () => {
    const broken = legacy()
    broken.members[1].id = broken.members[0].id
    const result = await runAdminMemberIndexBackfill(broken, {
      adminUid: ADMIN_UID, confirmPhrase: MEMBER_INDEX_CONFIRM_PHRASE,
    })
    expect(result.written).toBe(false)
    expect(result.skippedReason).toContain('검사')
    expect(writtenPaths()).toEqual([])
  })
})

describe('runAdminMemberIndexBackfill — memberIndex만 쓴다', () => {
  const run = () => runAdminMemberIndexBackfill(legacy(), {
    adminUid: ADMIN_UID, confirmPhrase: MEMBER_INDEX_CONFIRM_PHRASE,
  })

  it('관리자 인증 + 확인 문구가 모두 맞으면 저장한다', async () => {
    const result = await run()
    expect(result.written).toBe(true)
    expect(result.documentCount).toBe(MEMBER_COUNT)
    expect(batchCommitMock).toHaveBeenCalled()
  })

  it('건드린 문서 경로가 전부 memberIndex다 — 다른 컬렉션은 하나도 쓰지 않는다', async () => {
    await run()

    const paths = writtenPaths()
    expect(paths).toHaveLength(MEMBER_COUNT)
    for (const path of paths) {
      expect(path).toMatch(/^clubs\/skkubc\/memberIndex\/[^/]+$/)
    }
    // 다른 컬렉션 경로가 단 하나라도 섞이면 안 된다.
    for (const forbidden of ['/members/', '/memberPrivate/', '/sessions/', '/games/', '/ledger/', '/config/']) {
      expect(paths.some((p) => p.includes(forbidden))).toBe(false)
    }
    // legacy 단일 문서도 절대 건드리지 않는다.
    expect(paths).not.toContain('clubs/skkubc')
  })

  it('삭제는 전혀 하지 않는다 — 기존 문서를 지우지 않는다', async () => {
    await run()
    expect(batchDeleteMock).not.toHaveBeenCalled()
    expect(deleteDocMock).not.toHaveBeenCalled()
  })

  it('저장되는 값에 비밀번호·핸디가 들어가지 않는다', async () => {
    await run()
    const written = batchSetMock.mock.calls.map((c) => c[1] as Record<string, unknown>)
    expect(written).toHaveLength(MEMBER_COUNT)
    for (const w of written) {
      expect(w).not.toHaveProperty('password')
      expect(w).not.toHaveProperty('handicap')
      expect(w).not.toHaveProperty('handicapHistory')
    }
  })

  it('다시 실행해도 같은 문서를 같은 값으로 덮어쓴다(idempotent)', async () => {
    const first = await run()
    const firstPaths = writtenPaths()
    const firstValues = batchSetMock.mock.calls.map((c) => JSON.stringify(c[1]))

    batchSetMock.mockReset(); batchDeleteMock.mockReset()
    setDocMock.mockReset(); setDocMock.mockResolvedValue(undefined)
    deleteDocMock.mockReset(); deleteDocMock.mockResolvedValue(undefined)

    const second = await run()
    const secondPaths = writtenPaths()
    const secondValues = batchSetMock.mock.calls.map((c) => JSON.stringify(c[1]))

    expect(second.documentCount).toBe(first.documentCount)
    expect(secondPaths).toEqual(firstPaths) // 문서 ID가 회원 ID라 중복 생성되지 않는다
    expect(secondValues).toEqual(firstValues)
  })

  it('회원이 많아도 배치 제한(500)에 걸리지 않게 나눠 저장한다', async () => {
    const many = legacy()
    many.members = Array.from({ length: 1000 }, (_, i) => ({
      id: `bulk-${i}`, name: `대량회원${i}`, handicap: 20, handicapHistory: [], active: true,
    }))
    const result = await runAdminMemberIndexBackfill(many, {
      adminUid: ADMIN_UID, confirmPhrase: MEMBER_INDEX_CONFIRM_PHRASE,
    })

    expect(result.written).toBe(true)
    expect(result.documentCount).toBe(1000)
    expect(batchCommitMock).toHaveBeenCalledTimes(Math.ceil(1000 / 450))
  })
})

describe('verifyMemberIndex — 읽기만 한다', () => {
  /** getDocs가 돌려줄 memberIndex 문서 목록을 흉내 낸다. */
  const serverHas = (entries: Array<Record<string, unknown>>) => {
    getDocsMock.mockResolvedValue({ docs: entries.map((data) => ({ data: () => data })) })
  }

  it('확인 과정에서 어떤 문서도 쓰거나 지우지 않는다', async () => {
    serverHas([])
    await verifyMemberIndex(legacy())
    expect(writtenPaths()).toEqual([])
    expect(batchCommitMock).not.toHaveBeenCalled()
  })

  it('목록이 비어 있으면 회원 전원을 빠진 것으로 잡는다 — iPad에서 이름이 안 뜨던 상태', async () => {
    serverHas([])
    const result = await verifyMemberIndex(legacy())

    expect(result.ok).toBe(false)
    expect(result.counts).toEqual({ expected: MEMBER_COUNT, actual: 0 })
    expect(result.missing).toBe(MEMBER_COUNT)
    expect(result.extra).toBe(0)
    expect(result.issues.join()).toContain('이름 찾기 목록에 없습니다')
  })

  it('회원 전원이 목록에 있으면 정상으로 판정한다', async () => {
    const state = legacy()
    serverHas(state.members.map((m) => ({ id: m.id, name: m.name, active: m.active })))

    const result = await verifyMemberIndex(state)
    expect(result.ok).toBe(true)
    expect(result.counts).toEqual({ expected: MEMBER_COUNT, actual: MEMBER_COUNT })
    expect(result.missing).toBe(0)
    expect(result.extra).toBe(0)
  })

  it('일부만 있으면 빠진 수를 정확히 알려준다', async () => {
    const state = legacy()
    serverHas(state.members.slice(0, 20).map((m) => ({ id: m.id, name: m.name, active: m.active })))

    const result = await verifyMemberIndex(state)
    expect(result.ok).toBe(false)
    expect(result.missing).toBe(MEMBER_COUNT - 20)
    expect(result.extra).toBe(0)
  })

  it('회원이 아닌 항목이 남아 있으면 따로 알려준다', async () => {
    const state = legacy()
    serverHas([
      ...state.members.map((m) => ({ id: m.id, name: m.name, active: m.active })),
      { id: 'gone-1', name: '탈퇴회원', active: false },
    ])

    const result = await verifyMemberIndex(state)
    expect(result.ok).toBe(false)
    expect(result.missing).toBe(0)
    expect(result.extra).toBe(1)
    expect(result.issues.join()).toContain('회원이 아닌 항목')
  })

  it('목록에 비밀번호나 핸디가 섞여 있으면 문제로 잡는다', async () => {
    const state = legacy()
    serverHas(state.members.map((m) => ({ id: m.id, name: m.name, active: m.active, handicap: 20 })))

    const result = await verifyMemberIndex(state)
    expect(result.ok).toBe(false)
    expect(result.issues.join()).toContain('실적(핸디)')
  })
})

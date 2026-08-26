import { describe, it, expect, vi, beforeEach } from 'vitest'

// Firestore 호출부를 전부 모킹한다 — 실제 운영 Firestore는 읽지도 쓰지도 않는다.
// 이 파일의 데이터는 전부 가상 fixture이며 실제 회원 정보가 아니다.
const setDocMock = vi.fn()
const batchSetMock = vi.fn()
const batchCommitMock = vi.fn()
const getDocMock = vi.fn()
const getDocsMock = vi.fn()

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  getDoc: (...args: unknown[]) => getDocMock(...args),
  getDocs: (...args: unknown[]) => getDocsMock(...args),
  setDoc: (...args: unknown[]) => setDocMock(...args),
  writeBatch: () => ({
    set: (...args: unknown[]) => batchSetMock(...args),
    commit: () => batchCommitMock(),
  }),
}))
vi.mock('../src/lib/firebase', () => ({ db: {} }))

import { MIGRATION_CONFIRM_PHRASE, runAdminMigration, verifyMigration } from '../src/lib/migration'
import { USE_SPLIT_FIRESTORE } from '../src/lib/splitFirestore'
import { makeLegacyAppState } from './fixtures/legacyAppState'
import type { AppState } from '../src/types'

const ADMIN_UID = 'uid-admin-test'
const legacy = () => makeLegacyAppState()
const gameCount = (s: AppState) => s.sessions.reduce((n, x) => n + x.games.length, 0)

/** 배치에 담긴 문서 경로 목록. */
const writtenPaths = () => batchSetMock.mock.calls.map((c) => (c[0] as { path: string }).path)

beforeEach(() => {
  setDocMock.mockReset(); setDocMock.mockResolvedValue(undefined)
  batchSetMock.mockReset()
  batchCommitMock.mockReset(); batchCommitMock.mockResolvedValue(undefined)
  getDocMock.mockReset()
  getDocsMock.mockReset()
})

describe('runAdminMigration — 관리자 인증 게이트', () => {
  it('관리자 UID가 없으면 확인 문구가 맞아도 저장하지 않는다', async () => {
    const result = await runAdminMigration(legacy(), { confirmPhrase: MIGRATION_CONFIRM_PHRASE })

    expect(result.written).toBe(false)
    expect(batchSetMock).not.toHaveBeenCalled()
    expect(batchCommitMock).not.toHaveBeenCalled()
  })

  it('관리자 UID가 빈 문자열이어도 저장하지 않는다', async () => {
    const result = await runAdminMigration(legacy(), { adminUid: '', confirmPhrase: MIGRATION_CONFIRM_PHRASE })

    expect(result.written).toBe(false)
    expect(batchCommitMock).not.toHaveBeenCalled()
  })

  it('관리자 UID가 있어도 확인 문구가 틀리면 저장하지 않는다', async () => {
    const result = await runAdminMigration(legacy(), { adminUid: ADMIN_UID, confirmPhrase: '아무거나' })

    expect(result.written).toBe(false)
    expect(batchCommitMock).not.toHaveBeenCalled()
  })

  it('관리자 UID와 확인 문구가 모두 맞아야 저장한다', async () => {
    const result = await runAdminMigration(legacy(), {
      adminUid: ADMIN_UID, confirmPhrase: MIGRATION_CONFIRM_PHRASE,
    })

    expect(result.written).toBe(true)
    expect(batchCommitMock).toHaveBeenCalled()
  })

  it('복사는 기존 legacy 문서(clubs/skkubc)를 절대 건드리지 않는다', async () => {
    await runAdminMigration(legacy(), { adminUid: ADMIN_UID, confirmPhrase: MIGRATION_CONFIRM_PHRASE })

    expect(writtenPaths()).not.toContain('clubs/skkubc')
    expect(setDocMock).not.toHaveBeenCalled() // 배치로만 쓴다
  })
})

describe('재실행 안전성 (idempotent)', () => {
  it('같은 데이터를 두 번 복사해도 문서 경로가 완전히 같다 — 중복이 생기지 않는다', async () => {
    const state = legacy()

    await runAdminMigration(state, { adminUid: ADMIN_UID, confirmPhrase: MIGRATION_CONFIRM_PHRASE })
    const firstRun = writtenPaths()

    batchSetMock.mockReset()
    await runAdminMigration(state, { adminUid: ADMIN_UID, confirmPhrase: MIGRATION_CONFIRM_PHRASE })
    const secondRun = writtenPaths()

    expect(secondRun).toEqual(firstRun)
    // 자동 생성 ID가 아니라 데이터의 ID를 그대로 쓰므로 경로에 중복이 없다
    expect(new Set(firstRun).size).toBe(firstRun.length)
  })

  it('문서 경로가 legacy ID에서 그대로 결정된다 (자동 생성 ID를 쓰지 않는다)', async () => {
    const state = legacy()
    await runAdminMigration(state, { adminUid: ADMIN_UID, confirmPhrase: MIGRATION_CONFIRM_PHRASE })

    const paths = writtenPaths()
    for (const m of state.members) expect(paths).toContain(`clubs/skkubc/members/${m.id}`)
    for (const s of state.sessions) {
      expect(paths).toContain(`clubs/skkubc/sessions/${s.id}`)
      for (const g of s.games) expect(paths).toContain(`clubs/skkubc/sessions/${s.id}/games/${g.id}`)
    }
    for (const r of state.ledger) expect(paths).toContain(`clubs/skkubc/ledger/${r.id}`)
  })
})

describe('도중에 실패한 경우', () => {
  it('배치 커밋이 실패하면 오류를 감추지 않고 그대로 알린다', async () => {
    batchCommitMock.mockRejectedValue(new Error('network down'))

    await expect(
      runAdminMigration(legacy(), { adminUid: ADMIN_UID, confirmPhrase: MIGRATION_CONFIRM_PHRASE }),
    ).rejects.toThrow()
  })

  it('실패해도 legacy 문서에는 쓰지 않는다 — 기존 데이터는 그대로다', async () => {
    batchCommitMock.mockRejectedValue(new Error('network down'))

    await runAdminMigration(legacy(), {
      adminUid: ADMIN_UID, confirmPhrase: MIGRATION_CONFIRM_PHRASE,
    }).catch(() => {})

    expect(writtenPaths()).not.toContain('clubs/skkubc')
    expect(setDocMock).not.toHaveBeenCalled()
  })

  it('실패 뒤 다시 실행하면 같은 경로에 다시 써서 복구된다', async () => {
    const state = legacy()
    batchCommitMock.mockRejectedValueOnce(new Error('network down'))

    await runAdminMigration(state, { adminUid: ADMIN_UID, confirmPhrase: MIGRATION_CONFIRM_PHRASE }).catch(() => {})
    const failedRun = writtenPaths()

    batchSetMock.mockReset()
    batchCommitMock.mockResolvedValue(undefined)
    const retry = await runAdminMigration(state, { adminUid: ADMIN_UID, confirmPhrase: MIGRATION_CONFIRM_PHRASE })

    expect(retry.written).toBe(true)
    expect(writtenPaths()).toEqual(failedRun)
  })
})

// ── 복사 후 확인 ────────────────────────────────────────────────────────
// verifyMigration()은 새 구조에서 읽기만 한다. 아래 모킹은 전부 가상 값이다.

/** 새 구조에서 읽히는 척하는 응답을 만든다. */
function mockSplitReads(state: AppState, opts: { dropMembers?: number; withPassword?: boolean } = {}) {
  const members = state.members
    .slice(0, state.members.length - (opts.dropMembers ?? 0))
    .map((m) => ({
      id: m.id, name: m.name, handicap: m.handicap, handicapHistory: m.handicapHistory, active: m.active,
      ...(opts.withPassword ? { password: 'x' } : {}),
    }))

  getDocMock.mockResolvedValue({ exists: () => true, data: () => ({ lastBackupAt: null }) })
  getDocsMock.mockImplementation((ref: { path: string }) => {
    if (ref.path === 'clubs/skkubc/members') {
      return Promise.resolve({ docs: members.map((m) => ({ data: () => m })) })
    }
    // 이름 찾기 목록도 회원과 같은 범위로 복사돼 있다고 본다(회원을 일부러 뺀 경우 함께 빠진다).
    if (ref.path === 'clubs/skkubc/memberIndex') {
      return Promise.resolve({
        docs: members.map((m) => ({ data: () => ({ id: m.id, name: m.name, active: m.active }) })),
      })
    }
    if (ref.path === 'clubs/skkubc/sessions') {
      return Promise.resolve({
        docs: state.sessions.map((s) => ({ data: () => ({ id: s.id, date: s.date }) })),
      })
    }
    if (ref.path === 'clubs/skkubc/ledger') {
      return Promise.resolve({ docs: state.ledger.map((r) => ({ data: () => r })) })
    }
    // clubs/skkubc/sessions/{id}/games
    const m = /^clubs\/skkubc\/sessions\/(.+)\/games$/.exec(ref.path)
    if (m) {
      const session = state.sessions.find((s) => s.id === m[1])
      return Promise.resolve({ docs: (session?.games ?? []).map((g) => ({ data: () => g })) })
    }
    return Promise.resolve({ docs: [] })
  })
}

describe('verifyMigration — 복사 후 확인', () => {
  it('읽기만 하고 아무것도 쓰지 않는다', async () => {
    const state = legacy()
    mockSplitReads(state)

    await verifyMigration(state)

    expect(setDocMock).not.toHaveBeenCalled()
    expect(batchSetMock).not.toHaveBeenCalled()
    expect(batchCommitMock).not.toHaveBeenCalled()
  })

  it('전부 제대로 복사됐으면 정상으로 판정한다', async () => {
    const state = legacy()
    mockSplitReads(state)

    const result = await verifyMigration(state)

    expect(result.ok).toBe(true)
    expect(result.missing).toBe(0)
    expect(result.mismatched).toBe(0)
    expect(result.issues).toEqual([])
  })

  it('개수와 ID를 legacy 기준으로 비교한다', async () => {
    const state = legacy()
    mockSplitReads(state)

    const result = await verifyMigration(state)

    expect(result.counts.members).toEqual({ legacy: state.members.length, split: state.members.length })
    expect(result.counts.sessions).toEqual({ legacy: state.sessions.length, split: state.sessions.length })
    expect(result.counts.games).toEqual({ legacy: gameCount(state), split: gameCount(state) })
    expect(result.counts.ledger).toEqual({ legacy: state.ledger.length, split: state.ledger.length })
    expect(result.counts.config).toEqual({ legacy: 1, split: 1 })
  })

  it('일부가 빠졌으면 빠진 수를 알려주고 정상으로 보지 않는다', async () => {
    const state = legacy()
    mockSplitReads(state, { dropMembers: 3 })

    const result = await verifyMigration(state)

    expect(result.ok).toBe(false)
    expect(result.missing).toBeGreaterThanOrEqual(3)
    expect(result.issues.length).toBeGreaterThan(0)
  })

  it('새 구조에 비밀번호가 들어 있으면 문제로 잡아낸다', async () => {
    const state = legacy()
    mockSplitReads(state, { withPassword: true })

    const result = await verifyMigration(state)

    expect(result.ok).toBe(false)
    expect(result.issues.some((i) => i.includes('비밀번호'))).toBe(true)
  })

  it('확인 결과에 회원 이름 같은 실제 값을 담지 않는다', async () => {
    const state = legacy()
    mockSplitReads(state, { dropMembers: 2 })

    const result = await verifyMigration(state)

    const text = JSON.stringify(result)
    for (const m of state.members) expect(text).not.toContain(m.name)
  })
})

describe('전환 스위치', () => {
  // Split Firestore 최종 전환(보안 8단계 다음 단계)으로 이제 켜져 있다. 이 파일이 다루는
  // migration 도구(runAdminMigration 등) 자체는 이 값과 무관하게 항상 같은 방식으로
  // 동작해야 하므로, 다른 테스트에는 영향이 없다.
  it('새 구조가 켜져 있다', () => {
    expect(USE_SPLIT_FIRESTORE).toBe(true)
  })
})

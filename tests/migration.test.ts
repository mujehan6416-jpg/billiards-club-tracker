import { describe, it, expect, vi, beforeEach } from 'vitest'

// Firestore 실제 호출부를 전부 모킹 — dry-run이 정말 쓰지 않는지 확인하려면 쓰기 호출을 세야 한다.
const setDocMock = vi.fn()
const batchSetMock = vi.fn()
const batchCommitMock = vi.fn()

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  setDoc: (...args: unknown[]) => setDocMock(...args),
  writeBatch: () => ({
    set: (...args: unknown[]) => batchSetMock(...args),
    commit: () => batchCommitMock(),
  }),
}))
vi.mock('../src/lib/firebase', () => ({ db: {} }))

import { executeMigration, prepareMigration, MIGRATION_CONFIRM_PHRASE } from '../src/lib/migration'
import { USE_SPLIT_FIRESTORE } from '../src/lib/splitFirestore'
import { makeLegacyAppState } from './fixtures/legacyAppState'
import type { AppState } from '../src/types'

// 전부 가상 fixture 기준이다. 실제 운영 Firestore 데이터는 읽지도 쓰지도 않는다.

const legacy = () => makeLegacyAppState()
const legacyGameCount = (s: AppState) => s.sessions.reduce((n, x) => n + x.games.length, 0)

beforeEach(() => {
  setDocMock.mockReset(); setDocMock.mockResolvedValue(undefined)
  batchSetMock.mockReset()
  batchCommitMock.mockReset(); batchCommitMock.mockResolvedValue(undefined)
})

describe('전환 스위치', () => {
  // Split Firestore 최종 전환(보안 8단계 다음 단계)으로 이제 켜져 있다. 이 테스트는 원래
  // "의도치 않게 조기 전환되지 않았는지" 지키는 tripwire였는데, 이제는 반대로 "전환 뒤에도
  // 실수로 다시 꺼지지 않았는지" 지키는 역할로 남겨 둔다.
  it('새 구조가 켜져 있다 — 앱은 split 경로를 기본으로 쓴다', () => {
    expect(USE_SPLIT_FIRESTORE).toBe(true)
  })
})

describe('prepareMigration — 계획만 세운다', () => {
  it('Firestore에 아무것도 쓰지 않는다', () => {
    prepareMigration(legacy())

    expect(setDocMock).not.toHaveBeenCalled()
    expect(batchSetMock).not.toHaveBeenCalled()
    expect(batchCommitMock).not.toHaveBeenCalled()
  })

  it('경로별로 만들어질 문서 수를 알려준다', () => {
    const state = legacy()
    const plan = prepareMigration(state)

    expect(plan.documentCounts.config).toBe(1)
    expect(plan.documentCounts.members).toBe(24)
    expect(plan.documentCounts.memberPrivate).toBe(24)
    expect(plan.documentCounts.sessions).toBe(18)
    expect(plan.documentCounts.games).toBe(legacyGameCount(state))
    expect(plan.documentCounts.ledger).toBe(32)
    expect(plan.documentCounts.total).toBe(
      1 + 24 + 24 + 18 + legacyGameCount(state) + 32,
    )
  })

  it('정상 데이터면 검증을 통과한다', () => {
    const plan = prepareMigration(legacy())
    expect(plan.validation.ok).toBe(true)
    expect(plan.validation.issues).toEqual([])
  })
})

describe('executeMigration — 기본은 미리보기(dry-run)', () => {
  it('인자 없이 부르면 실제로 저장하지 않는다', async () => {
    const result = await executeMigration(legacy())

    expect(result.written).toBe(false)
    expect(result.skippedReason).toContain('미리보기')
    expect(setDocMock).not.toHaveBeenCalled()
    expect(batchSetMock).not.toHaveBeenCalled()
    expect(batchCommitMock).not.toHaveBeenCalled()
  })

  it('미리보기에서도 만들어질 문서 수는 알려준다', async () => {
    const state = legacy()
    const result = await executeMigration(state)

    expect(result.documentCount).toBe(1 + 24 + 24 + 18 + legacyGameCount(state) + 32)
    expect(result.validation.ok).toBe(true)
  })

  it('dryRun을 껐어도 확인 문구가 없으면 저장하지 않는다', async () => {
    const result = await executeMigration(legacy(), { dryRun: false })

    expect(result.written).toBe(false)
    expect(result.skippedReason).toContain('확인 문구')
    expect(batchCommitMock).not.toHaveBeenCalled()
  })

  it('확인 문구가 틀리면 저장하지 않는다', async () => {
    const result = await executeMigration(legacy(), { dryRun: false, confirmPhrase: '옮겨줘' })

    expect(result.written).toBe(false)
    expect(batchCommitMock).not.toHaveBeenCalled()
  })

  it('검증에 실패하면 확인 문구가 맞아도 저장하지 않는다', async () => {
    const broken = legacy()
    broken.members[1].id = broken.members[0].id // ID 중복

    const result = await executeMigration(broken, {
      dryRun: false, confirmPhrase: MIGRATION_CONFIRM_PHRASE,
    })

    expect(result.written).toBe(false)
    expect(result.skippedReason).toContain('검증')
    expect(batchCommitMock).not.toHaveBeenCalled()
  })

  it('dryRun을 끄고 확인 문구까지 맞아야만 저장한다', async () => {
    const state = legacy()
    const result = await executeMigration(state, {
      dryRun: false, confirmPhrase: MIGRATION_CONFIRM_PHRASE,
    })

    expect(result.written).toBe(true)
    expect(batchCommitMock).toHaveBeenCalled()
    // 계획한 문서 수만큼 배치에 담긴다 (config, members, memberPrivate, memberIndex, sessions, games, ledger)
    expect(batchSetMock).toHaveBeenCalledTimes(1 + 24 + 24 + 24 + 18 + legacyGameCount(state) + 32)
  })

  it('저장할 때 경로가 새 구조 규칙대로 만들어진다', async () => {
    await executeMigration(legacy(), { dryRun: false, confirmPhrase: MIGRATION_CONFIRM_PHRASE })

    const paths = batchSetMock.mock.calls.map((c) => (c[0] as { path: string }).path)
    expect(paths).toContain('clubs/skkubc/config/main')
    expect(paths).toContain('clubs/skkubc/members/member-1')
    expect(paths).toContain('clubs/skkubc/memberPrivate/member-1')
    expect(paths).toContain('clubs/skkubc/memberIndex/member-1')
    expect(paths).toContain('clubs/skkubc/sessions/session-1')
    expect(paths).toContain('clubs/skkubc/sessions/session-1/games/game-s1-0')
    expect(paths).toContain('clubs/skkubc/ledger/ledger-1')
    // 기존 문서는 건드리지 않는다
    expect(paths).not.toContain('clubs/skkubc')
  })

  it('저장되는 회원 문서·이름 찾기 목록에 비밀번호가 들어가지 않는다', async () => {
    await executeMigration(legacy(), { dryRun: false, confirmPhrase: MIGRATION_CONFIRM_PHRASE })

    const memberWrites = batchSetMock.mock.calls
      .filter((c) => (c[0] as { path: string }).path.startsWith('clubs/skkubc/members/'))
      .map((c) => c[1] as Record<string, unknown>)
    expect(memberWrites.length).toBe(24)
    for (const w of memberWrites) expect(w).not.toHaveProperty('password')

    const indexWrites = batchSetMock.mock.calls
      .filter((c) => (c[0] as { path: string }).path.startsWith('clubs/skkubc/memberIndex/'))
      .map((c) => c[1] as Record<string, unknown>)
    expect(indexWrites.length).toBe(24)
    for (const w of indexWrites) {
      expect(w).not.toHaveProperty('password')
      expect(w).not.toHaveProperty('handicap')
      expect(w).not.toHaveProperty('handicapHistory')
    }
  })

  it('큰 데이터도 배치 제한에 걸리지 않게 나눠 저장한다', async () => {
    const state = legacy()
    const total = 1 + 24 + 24 + 18 + legacyGameCount(state) + 32
    await executeMigration(state, { dryRun: false, confirmPhrase: MIGRATION_CONFIRM_PHRASE })

    // 450개씩 끊어서 커밋한다
    expect(batchCommitMock).toHaveBeenCalledTimes(Math.ceil(total / 450))
  })
})

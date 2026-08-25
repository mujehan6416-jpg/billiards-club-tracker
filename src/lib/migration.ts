import type { AppState } from '../types'
import type { SplitFirestoreData, SplitValidation } from '../types/splitFirestore'
import { splitLegacyAppState, validateSplit } from '../logic/splitAppState'
import {
  writeAllSplitData, DEFAULT_CLUB_ID, fetchConfig, fetchMembers, fetchSessions, fetchGames, fetchLedger,
} from './splitFirestore'

/**
 * 기존 AppState를 새 Firestore 구조로 옮기는 작업.
 *
 * 안전장치:
 *  1. prepareMigration()은 계획만 세운다 — Firestore에 아무것도 쓰지 않는다.
 *  2. executeMigration()은 기본값이 dryRun: true라, 그냥 부르면 쓰지 않는다.
 *  3. 실제로 쓰려면 dryRun: false와 확인 문구를 둘 다 넘겨야 한다.
 *  4. 검증(validateSplit)을 통과하지 못하면 실제 쓰기를 거부한다.
 *  5. 앱 어디에서도 자동으로 부르지 않는다(앱 시작·로그인·일반회원 화면 모두).
 */

/** 실제 쓰기를 하려면 이 문구를 그대로 넘겨야 한다 — 실수로 운영 데이터를 만드는 것을 막는다. */
export const MIGRATION_CONFIRM_PHRASE = '실제로 옮깁니다'

export interface MigrationPlan {
  split: SplitFirestoreData
  validation: SplitValidation
  /** 새 구조에 만들어질 문서 수 (경로별). */
  documentCounts: {
    config: number
    members: number
    memberPrivate: number
    sessions: number
    games: number
    ledger: number
    total: number
  }
}

/**
 * 계획 세우기 — 순수 계산만 한다. Firestore를 읽지도 쓰지도 않는다.
 * 결과의 validation.ok가 false면 실제 이전을 진행해서는 안 된다.
 */
export function prepareMigration(state: AppState): MigrationPlan {
  const split = splitLegacyAppState(state)
  const validation = validateSplit(state, split)

  const documentCounts = {
    config: 1,
    members: split.members.length,
    memberPrivate: split.memberPrivate.length,
    sessions: split.sessions.length,
    games: split.games.length,
    ledger: split.ledger.length,
    total: 0,
  }
  documentCounts.total =
    documentCounts.config + documentCounts.members + documentCounts.memberPrivate +
    documentCounts.sessions + documentCounts.games + documentCounts.ledger

  return { split, validation, documentCounts }
}

export interface MigrationResult {
  /** 실제로 썼는지. dryRun이면 항상 false. */
  written: boolean
  /** 쓴(또는 dryRun에서 쓸 예정인) 문서 수. */
  documentCount: number
  validation: SplitValidation
  /** 쓰지 않은 이유(있다면). */
  skippedReason?: string
}

/**
 * 실제 이전 실행.
 *
 * 기본값이 dryRun: true다 — 인자 없이 부르면 계산만 하고 Firestore에는 손대지 않는다.
 * 실제로 쓰려면 dryRun: false와 confirmPhrase를 모두 정확히 넘겨야 한다.
 */
export async function executeMigration(
  state: AppState,
  options: { dryRun?: boolean; confirmPhrase?: string; clubId?: string } = {},
): Promise<MigrationResult> {
  const { dryRun = true, confirmPhrase, clubId = DEFAULT_CLUB_ID } = options
  const plan = prepareMigration(state)

  if (!plan.validation.ok) {
    return {
      written: false,
      documentCount: plan.documentCounts.total,
      validation: plan.validation,
      skippedReason: '검증을 통과하지 못했습니다. 문제를 해결한 뒤 다시 시도해 주세요.',
    }
  }

  if (dryRun) {
    return {
      written: false,
      documentCount: plan.documentCounts.total,
      validation: plan.validation,
      skippedReason: '미리보기(dry-run)라 실제로 저장하지 않았습니다.',
    }
  }

  if (confirmPhrase !== MIGRATION_CONFIRM_PHRASE) {
    return {
      written: false,
      documentCount: plan.documentCounts.total,
      validation: plan.validation,
      skippedReason: '확인 문구가 맞지 않아 저장하지 않았습니다.',
    }
  }

  const count = await writeAllSplitData(plan.split, clubId)
  return { written: true, documentCount: count, validation: plan.validation }
}

/**
 * 관리자 화면에서 실제 복사를 실행할 때 쓰는 입구.
 *
 * executeMigration()의 안전장치(dry-run 기본값·확인 문구·검증 게이트)를 그대로 쓰면서,
 * "Firebase 관리자로 인증된 상태"라는 조건을 하나 더 요구한다. 기기 localStorage의
 * 관리자 PIN은 서버가 신뢰할 수 없으므로 이 값으로 쓸 수 없다 — 반드시 Firebase
 * Authentication으로 확인된 UID여야 한다(Firestore 규칙도 같은 기준으로 막고 있다).
 *
 * 실패해도 legacy(clubs/{clubId} 단일 문서)는 건드리지 않는다. 이 함수는 새 split 경로에
 * "복사"만 하며, 기존 데이터를 지우거나 고치지 않는다.
 */
export async function runAdminMigration(
  state: AppState,
  options: { adminUid?: string | null; confirmPhrase?: string; clubId?: string } = {},
): Promise<MigrationResult> {
  const { adminUid, confirmPhrase, clubId } = options

  if (!adminUid) {
    return {
      written: false,
      documentCount: prepareMigration(state).documentCounts.total,
      validation: prepareMigration(state).validation,
      skippedReason: '관리자 로그인이 확인되지 않아 실행하지 않았습니다.',
    }
  }

  return executeMigration(state, { dryRun: false, confirmPhrase, clubId })
}

/** 복사가 끝난 뒤, 새 구조에서 다시 읽어 legacy와 개수·ID가 맞는지 확인한 결과. */
export interface MigrationVerification {
  ok: boolean
  counts: {
    config: { legacy: number; split: number }
    members: { legacy: number; split: number }
    sessions: { legacy: number; split: number }
    games: { legacy: number; split: number }
    ledger: { legacy: number; split: number }
  }
  /** legacy에는 있는데 새 구조에서 찾지 못한 항목 수. */
  missing: number
  /** 개수는 맞지만 값이 다른 항목 수(현재는 ID 기준). */
  mismatched: number
  /** 사람이 읽을 수 있는 문제 목록. 개인정보는 담지 않고 개수·종류만 적는다. */
  issues: string[]
}

/**
 * 실제 복사가 끝난 뒤 새 split 경로를 다시 읽어 legacy와 맞는지 확인한다.
 *
 * 읽기만 한다 — 어떤 문서도 쓰거나 지우지 않는다.
 * 결과에는 회원 이름·경기 내용 같은 실제 값을 담지 않고 개수와 ID 일치 여부만 담는다.
 */
export async function verifyMigration(
  state: AppState,
  clubId = DEFAULT_CLUB_ID,
): Promise<MigrationVerification> {
  const [config, members, sessions, ledger] = await Promise.all([
    fetchConfig(clubId),
    fetchMembers(clubId),
    fetchSessions(clubId),
    fetchLedger(clubId),
  ])

  // 경기는 모임별 하위 컬렉션이라 모임 수만큼 나눠 읽는다.
  const gamesBySession = await Promise.all(
    sessions.map(async (s) => ({ sessionId: s.id, games: await fetchGames(s.id, clubId) })),
  )
  const splitGameCount = gamesBySession.reduce((n, g) => n + g.games.length, 0)
  const legacyGameCount = state.sessions.reduce((n, s) => n + s.games.length, 0)

  const counts = {
    config: { legacy: 1, split: config ? 1 : 0 },
    members: { legacy: state.members.length, split: members.length },
    sessions: { legacy: state.sessions.length, split: sessions.length },
    games: { legacy: legacyGameCount, split: splitGameCount },
    ledger: { legacy: state.ledger.length, split: ledger.length },
  }

  const issues: string[] = []
  let missing = 0
  let mismatched = 0

  for (const [name, c] of Object.entries(counts)) {
    if (c.split < c.legacy) {
      missing += c.legacy - c.split
      issues.push(`${name}: ${c.legacy}건 중 ${c.split}건만 확인됩니다.`)
    } else if (c.split > c.legacy) {
      mismatched += c.split - c.legacy
      issues.push(`${name}: 새 구조에 ${c.split - c.legacy}건이 더 있습니다.`)
    }
  }

  // ID 대조 — 개수가 같아도 다른 문서가 들어가 있을 수 있다.
  const splitMemberIds = new Set(members.map((m) => m.id))
  const memberIdMisses = state.members.filter((m) => !splitMemberIds.has(m.id)).length
  if (memberIdMisses > 0) {
    missing += memberIdMisses
    issues.push(`회원 ID ${memberIdMisses}건을 새 구조에서 찾지 못했습니다.`)
  }

  const splitSessionIds = new Set(sessions.map((s) => s.id))
  const sessionIdMisses = state.sessions.filter((s) => !splitSessionIds.has(s.id)).length
  if (sessionIdMisses > 0) {
    missing += sessionIdMisses
    issues.push(`모임 ID ${sessionIdMisses}건을 새 구조에서 찾지 못했습니다.`)
  }

  const splitLedgerIds = new Set(ledger.map((r) => r.id))
  const ledgerIdMisses = state.ledger.filter((r) => !splitLedgerIds.has(r.id)).length
  if (ledgerIdMisses > 0) {
    missing += ledgerIdMisses
    issues.push(`회계 ID ${ledgerIdMisses}건을 새 구조에서 찾지 못했습니다.`)
  }

  // 비밀번호가 새 구조로 새어 들어갔는지 — 복사 후에도 반드시 확인한다.
  if (members.some((m) => 'password' in m)) {
    mismatched += 1
    issues.push('새 구조 회원 문서에 비밀번호가 들어 있습니다.')
  }

  return { ok: issues.length === 0, counts, missing, mismatched, issues }
}

import type { AppState } from '../types'
import type { MemberIndexEntry, SplitFirestoreData, SplitValidation } from '../types/splitFirestore'
import { splitLegacyAppState, validateSplit } from '../logic/splitAppState'
import {
  writeAllSplitData, writeMemberIndexOnly, DEFAULT_CLUB_ID,
  fetchConfig, fetchMembers, fetchMemberIndex, fetchSessions, fetchGames, fetchLedger,
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
    memberIndex: number
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
    // memberIndex도 writeAllSplitData()가 실제로 쓰는 문서다 — 예전에는 이 줄이 빠져 있어서
    // 화면에 표시되는 "새로 만들어질 문서" 수가 실제보다 회원 수만큼 적게 나왔다.
    memberIndex: split.memberIndex.length,
    sessions: split.sessions.length,
    games: split.games.length,
    ledger: split.ledger.length,
    total: 0,
  }
  documentCounts.total =
    documentCounts.config + documentCounts.members + documentCounts.memberPrivate +
    documentCounts.memberIndex + documentCounts.sessions + documentCounts.games + documentCounts.ledger

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

// ── 이름 찾기 목록(memberIndex) 전용 초기화 ──────────────────────────────
// 전체 복사(runAdminMigration)와 완전히 분리된 별개 기능이다. 아래 세 함수는 memberIndex
// 컬렉션만 다루며, config·members·memberPrivate·sessions·games·ledger는 읽지도 쓰지도 않는다.

/** memberIndex 전용 초기화를 실제로 실행하려면 이 문구를 그대로 넘겨야 한다. */
export const MEMBER_INDEX_CONFIRM_PHRASE = '이름 목록 만들기'

export interface MemberIndexBackfillPlan {
  /** 만들어질 이름 찾기 목록 문서들. 이름·활성여부·구분정보만 담긴다(핸디·비밀번호 없음). */
  entries: MemberIndexEntry[]
  /** 만들어질 문서 수 = 현재 회원 수. */
  documentCount: number
  /** 사람이 읽을 수 있는 문제 목록. 비어 있으면 이상 없음. */
  issues: string[]
  ok: boolean
}

/**
 * 계획만 세운다 — Firestore를 읽지도 쓰지도 않는다.
 *
 * splitLegacyAppState()가 이미 만들어 주는 memberIndex를 그대로 쓴다(같은 변환 규칙을 두 번
 * 구현하지 않는다). 그중 memberIndex만 꺼내 쓰고 나머지 결과(members·sessions 등)는 버린다.
 */
export function prepareMemberIndexBackfill(state: AppState): MemberIndexBackfillPlan {
  const { memberIndex } = splitLegacyAppState(state)
  const issues: string[] = []

  if (memberIndex.length === 0) {
    issues.push('회원이 한 명도 없어 만들 목록이 없습니다.')
  }
  if (memberIndex.some((m) => !m.id)) {
    issues.push('ID가 비어 있는 회원이 있습니다.')
  }
  const ids = new Set<string>()
  const dupes = new Set<string>()
  for (const m of memberIndex) {
    if (ids.has(m.id)) dupes.add(m.id)
    else ids.add(m.id)
  }
  if (dupes.size) issues.push(`회원 ID가 중복됩니다: ${dupes.size}건`)

  // 이 목록은 아직 연결되지 않은 기기도 읽을 수 있으므로, 민감한 값이 섞이면 절대 안 된다.
  if (memberIndex.some((m) => 'password' in m)) {
    issues.push('이름 찾기 목록에 비밀번호가 들어 있습니다.')
  }
  if (memberIndex.some((m) => 'handicap' in m || 'handicapHistory' in m)) {
    issues.push('이름 찾기 목록에 실적(핸디) 데이터가 들어 있습니다.')
  }

  return { entries: memberIndex, documentCount: memberIndex.length, issues, ok: issues.length === 0 }
}

export interface MemberIndexBackfillResult {
  written: boolean
  documentCount: number
  plan: MemberIndexBackfillPlan
  skippedReason?: string
}

/**
 * 관리자 화면에서 "이름 찾기 목록 만들기"를 실행하는 입구.
 *
 * 안전장치는 전체 복사와 같은 기준을 따른다:
 *  1. Firebase 관리자로 인증된 UID가 있어야 한다(기기 PIN은 서버가 믿을 수 없으므로 불가).
 *  2. 확인 문구가 정확해야 한다.
 *  3. 계획 검사(prepareMemberIndexBackfill)를 통과해야 한다.
 * 그리고 실제 쓰기는 writeMemberIndexOnly() — memberIndex 컬렉션 하나만 건드린다.
 */
export async function runAdminMemberIndexBackfill(
  state: AppState,
  options: { adminUid?: string | null; confirmPhrase?: string; clubId?: string } = {},
): Promise<MemberIndexBackfillResult> {
  const { adminUid, confirmPhrase, clubId = DEFAULT_CLUB_ID } = options
  const plan = prepareMemberIndexBackfill(state)

  if (!adminUid) {
    return { written: false, documentCount: plan.documentCount, plan, skippedReason: '관리자 로그인이 확인되지 않아 실행하지 않았습니다.' }
  }
  if (!plan.ok) {
    return { written: false, documentCount: plan.documentCount, plan, skippedReason: '검사를 통과하지 못했습니다. 문제를 해결한 뒤 다시 시도해 주세요.' }
  }
  if (confirmPhrase !== MEMBER_INDEX_CONFIRM_PHRASE) {
    return { written: false, documentCount: plan.documentCount, plan, skippedReason: '확인 문구가 맞지 않아 저장하지 않았습니다.' }
  }

  const count = await writeMemberIndexOnly(plan.entries, clubId)
  return { written: true, documentCount: count, plan }
}

/** 이름 찾기 목록이 실제로 서버에 잘 만들어졌는지 확인한 결과. */
export interface MemberIndexVerification {
  ok: boolean
  /** 앱이 알고 있는 회원 수 vs 서버 memberIndex 문서 수. */
  counts: { expected: number; actual: number }
  /** 회원인데 서버 목록에 없는 수. */
  missing: number
  /** 서버 목록에 있는데 지금 회원이 아닌 수(탈퇴 회원 잔여 등). */
  extra: number
  issues: string[]
}

/**
 * memberIndex만 다시 읽어 앱의 회원 목록과 맞는지 확인한다.
 * 읽기만 한다 — 어떤 문서도 쓰거나 지우지 않는다. 회원 이름 같은 실제 값은 결과에 담지 않는다.
 */
export async function verifyMemberIndex(
  state: AppState,
  clubId = DEFAULT_CLUB_ID,
): Promise<MemberIndexVerification> {
  const actual = await fetchMemberIndex(clubId)
  const actualIds = new Set(actual.map((m) => m.id))
  const expectedIds = new Set(state.members.map((m) => m.id))

  const missing = [...expectedIds].filter((id) => !actualIds.has(id)).length
  const extra = [...actualIds].filter((id) => !expectedIds.has(id)).length

  const issues: string[] = []
  if (missing > 0) issues.push(`회원 ${missing}명이 이름 찾기 목록에 없습니다.`)
  if (extra > 0) issues.push(`지금 회원이 아닌 항목이 목록에 ${extra}건 남아 있습니다.`)
  // 민감한 값이 목록에 섞여 있는지 — 미연결 기기도 읽을 수 있는 목록이라 반드시 확인한다.
  if (actual.some((m) => 'password' in m)) issues.push('이름 찾기 목록에 비밀번호가 들어 있습니다.')
  if (actual.some((m) => 'handicap' in m || 'handicapHistory' in m)) {
    issues.push('이름 찾기 목록에 실적(핸디) 데이터가 들어 있습니다.')
  }

  return {
    ok: issues.length === 0,
    counts: { expected: expectedIds.size, actual: actual.length },
    missing,
    extra,
    issues,
  }
}

/** 복사가 끝난 뒤, 새 구조에서 다시 읽어 legacy와 개수·ID가 맞는지 확인한 결과. */
export interface MigrationVerification {
  ok: boolean
  counts: {
    config: { legacy: number; split: number }
    members: { legacy: number; split: number }
    memberIndex: { legacy: number; split: number }
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
  const [config, members, memberIndex, sessions, ledger] = await Promise.all([
    fetchConfig(clubId),
    fetchMembers(clubId),
    fetchMemberIndex(clubId),
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
    // 이름 찾기 목록도 회원 수만큼 있어야 한다 — 이게 비어 있으면 아직 연결되지 않은 새 기기가
    // 이름을 고르지 못한다(DeviceConnectScreen의 목록이 빈 상태가 된다).
    memberIndex: { legacy: state.members.length, split: memberIndex.length },
    sessions: { legacy: state.sessions.length, split: sessions.length },
    games: { legacy: legacyGameCount, split: splitGameCount },
    ledger: { legacy: state.ledger.length, split: ledger.length },
  }

  const issues: string[] = []
  let missing = 0
  let mismatched = 0

  // 이 문구는 관리자 화면에 그대로 보이므로 영어 키 대신 쉬운 한국어 이름으로 바꿔서 적는다.
  const COUNT_LABELS: Record<string, string> = {
    config: '설정', members: '회원', memberIndex: '이름 찾기 목록',
    sessions: '모임', games: '경기', ledger: '회계',
  }
  for (const [name, c] of Object.entries(counts)) {
    const label = COUNT_LABELS[name] ?? name
    if (c.split < c.legacy) {
      missing += c.legacy - c.split
      issues.push(`${label}: ${c.legacy}건 중 ${c.split}건만 확인됩니다.`)
    } else if (c.split > c.legacy) {
      mismatched += c.split - c.legacy
      issues.push(`${label}: 새 구조에 ${c.split - c.legacy}건이 더 있습니다.`)
    }
  }

  // ID 대조 — 개수가 같아도 다른 문서가 들어가 있을 수 있다.
  const splitMemberIds = new Set(members.map((m) => m.id))
  const memberIdMisses = state.members.filter((m) => !splitMemberIds.has(m.id)).length
  if (memberIdMisses > 0) {
    missing += memberIdMisses
    issues.push(`회원 ID ${memberIdMisses}건을 새 구조에서 찾지 못했습니다.`)
  }

  const splitMemberIndexIds = new Set(memberIndex.map((m) => m.id))
  const memberIndexIdMisses = state.members.filter((m) => !splitMemberIndexIds.has(m.id)).length
  if (memberIndexIdMisses > 0) {
    missing += memberIndexIdMisses
    issues.push(`회원 ${memberIndexIdMisses}명이 이름 찾기 목록에 없습니다.`)
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
  // 이름 찾기 목록은 아직 연결되지 않은 기기도 읽을 수 있으므로 특히 엄격하게 확인한다.
  if (memberIndex.some((m) => 'password' in m)) {
    mismatched += 1
    issues.push('이름 찾기 목록에 비밀번호가 들어 있습니다.')
  }
  if (memberIndex.some((m) => 'handicap' in m || 'handicapHistory' in m)) {
    mismatched += 1
    issues.push('이름 찾기 목록에 실적(핸디) 데이터가 들어 있습니다.')
  }

  return { ok: issues.length === 0, counts, missing, mismatched, issues }
}

import type { AppState } from '../types'
import type {
  MemberPrivate, PublicMember, SessionDoc, SplitFirestoreData, SplitGame, SplitValidation,
} from '../types/splitFirestore'

/**
 * 기존 AppState(clubs/{clubId} 한 문서)를 권한 분리가 가능한 여러 문서로 나눈다.
 *
 * 순수 함수다 — Firestore에 쓰지 않고, 입력 AppState도 바꾸지 않는다.
 * 실제 데이터 이동은 이 결과를 보고 사용자가 승인한 뒤 별도로 진행한다.
 *
 * 회원 비밀번호는 새 구조로 옮기지 않는다(공개 members에도, 관리자용 memberPrivate에도 넣지 않는다).
 * 기존 로그인이 아직 그 값을 쓰므로 legacy AppState 쪽에서는 지우지 않는다.
 */
export function splitLegacyAppState(state: AppState): SplitFirestoreData {
  const members: PublicMember[] = state.members.map((m) => ({
    id: m.id,
    name: m.name,
    handicap: m.handicap,
    // 이력 배열도 새로 만들어 원본과 공유하지 않는다(호출부가 결과를 고쳐도 원본이 안 바뀌게).
    handicapHistory: m.handicapHistory.map((h) => ({ ...h })),
    active: m.active,
    // 값이 없으면 필드 자체를 만들지 않는다 — Firestore는 undefined 필드를 거부한다.
    ...(m.displayTag ? { displayTag: m.displayTag } : {}),
  }))

  // 지금은 옮길 관리자 전용 개인정보가 없다. 자리만 회원 수만큼 만들어 둔다.
  const memberPrivate: MemberPrivate[] = state.members.map((m) => ({ memberId: m.id }))

  const sessions: SessionDoc[] = []
  const games: SplitGame[] = []
  for (const session of state.sessions) {
    const { games: sessionGames, ...rest } = session
    // 얕은 복사만 하면 attendeeIds·lineup 같은 배열을 원본과 공유해서, 결과를 손대는 순간
    // 운영 중인 AppState까지 같이 바뀐다. 값이 전부 JSON으로 표현되는 데이터라 깊은 복사로 끊는다.
    // (덤으로 값이 undefined인 키가 사라져 Firestore에 그대로 넣을 수 있는 형태가 된다.)
    sessions.push(deepCopy(rest))
    for (const game of sessionGames) {
      games.push({ sessionId: session.id, game: deepCopy(game) })
    }
  }

  return {
    config: { lastBackupAt: state.settings.lastBackupAt },
    members,
    memberPrivate,
    sessions,
    games,
    ledger: state.ledger.map((r) => ({ ...r })),
  }
}

/**
 * 중첩된 배열·객체까지 원본과 완전히 끊어진 복사본을 만든다.
 * 이 데이터는 전부 JSON으로 저장되는 값(문자열·숫자·불리언·배열·객체)이라 이 방식으로 충분하다.
 */
function deepCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** 같은 값이 두 번 나오는 id 목록. */
function duplicateIds(ids: string[]): string[] {
  const seen = new Set<string>()
  const dupes = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) dupes.add(id)
    else seen.add(id)
  }
  return [...dupes]
}

/**
 * 나눈 결과가 원본과 개수·ID가 맞는지, 중복이나 빠진 값이 없는지 확인한다.
 * 실제 데이터를 옮기기 전에 반드시 이 검사를 통과해야 한다.
 */
export function validateSplit(state: AppState, split: SplitFirestoreData): SplitValidation {
  const legacyGameCount = state.sessions.reduce((n, s) => n + s.games.length, 0)
  const issues: string[] = []

  const counts = {
    members: { legacy: state.members.length, split: split.members.length },
    sessions: { legacy: state.sessions.length, split: split.sessions.length },
    games: { legacy: legacyGameCount, split: split.games.length },
    ledger: { legacy: state.ledger.length, split: split.ledger.length },
  }

  for (const [name, c] of Object.entries(counts)) {
    if (c.legacy !== c.split) issues.push(`${name} 개수가 다릅니다: ${c.legacy} → ${c.split}`)
  }

  // ID 중복 — Firestore 문서 ID로 쓰이므로 겹치면 데이터가 덮어써진다.
  const memberDupes = duplicateIds(split.members.map((m) => m.id))
  if (memberDupes.length) issues.push(`회원 ID가 중복됩니다: ${memberDupes.length}건`)
  const sessionDupes = duplicateIds(split.sessions.map((s) => s.id))
  if (sessionDupes.length) issues.push(`모임 ID가 중복됩니다: ${sessionDupes.length}건`)
  const ledgerDupes = duplicateIds(split.ledger.map((r) => r.id))
  if (ledgerDupes.length) issues.push(`회계 ID가 중복됩니다: ${ledgerDupes.length}건`)
  // 경기는 세션 안에서만 유일하면 된다(경로가 sessions/{id}/games/{gameId}라서).
  for (const session of split.sessions) {
    const inSession = split.games.filter((g) => g.sessionId === session.id).map((g) => g.game.id)
    const dupes = duplicateIds(inSession)
    if (dupes.length) issues.push(`모임 ${session.id} 안에서 경기 ID가 중복됩니다: ${dupes.length}건`)
  }

  // 빈 ID — 문서를 만들 수 없다.
  if (split.members.some((m) => !m.id)) issues.push('ID가 비어 있는 회원이 있습니다.')
  if (split.sessions.some((s) => !s.id)) issues.push('ID가 비어 있는 모임이 있습니다.')
  if (split.games.some((g) => !g.game.id)) issues.push('ID가 비어 있는 경기가 있습니다.')
  if (split.ledger.some((r) => !r.id)) issues.push('ID가 비어 있는 회계 기록이 있습니다.')

  // 어느 모임에도 속하지 않는 경기 — 저장할 경로가 없다.
  const sessionIds = new Set(split.sessions.map((s) => s.id))
  const orphans = split.games.filter((g) => !sessionIds.has(g.sessionId))
  if (orphans.length) issues.push(`속한 모임이 없는 경기가 있습니다: ${orphans.length}건`)

  // 비밀번호가 새 구조로 새어 들어갔는지 — 절대 있으면 안 된다.
  if (split.members.some((m) => 'password' in m)) {
    issues.push('회원 공개정보에 비밀번호가 들어 있습니다.')
  }

  return { ok: issues.length === 0, counts, issues }
}

/**
 * 나눈 데이터를 다시 AppState 모양으로 합친다.
 *
 * 운영에서 쓰려고 만든 것이 아니라, "나눴다 합쳐도 값이 그대로인지" 검증하기 위한 함수다.
 * 비밀번호는 새 구조에 없으므로 합쳐도 돌아오지 않는다 — 그래서 원본과 비교할 때는
 * 비밀번호를 뺀 나머지가 같은지를 본다.
 */
export function mergeSplitToAppState(split: SplitFirestoreData): AppState {
  const gamesBySession = new Map<string, SplitGame[]>()
  for (const g of split.games) {
    const list = gamesBySession.get(g.sessionId)
    if (list) list.push(g)
    else gamesBySession.set(g.sessionId, [g])
  }

  return {
    members: split.members.map((m) => ({
      id: m.id,
      name: m.name,
      handicap: m.handicap,
      handicapHistory: m.handicapHistory.map((h) => ({ ...h })),
      active: m.active,
      ...(m.displayTag ? { displayTag: m.displayTag } : {}),
    })),
    sessions: split.sessions.map((s) => ({
      ...deepCopy(s),
      games: (gamesBySession.get(s.id) ?? []).map((g) => deepCopy(g.game)),
    })),
    settings: { lastBackupAt: split.config.lastBackupAt },
    ledger: split.ledger.map((r) => ({ ...r })),
  }
}

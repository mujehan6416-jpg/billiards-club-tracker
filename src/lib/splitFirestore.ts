import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc, writeBatch } from 'firebase/firestore'
import { db } from './firebase'
import type { AppState, Game, LedgerRecord, Member, Session } from '../types'
import type {
  ClubConfig, MemberPrivate, PublicMember, SessionDoc, SplitFirestoreData, SplitGame,
} from '../types/splitFirestore'
import { mergeSplitToAppState } from '../logic/splitAppState'

/**
 * 분리된 Firestore 구조 접근 어댑터.
 *
 * ⚠ 이번 단계에서 앱은 이 어댑터를 쓰지 않는다. 기존 cloudSync.ts(clubs/{clubId} 단일 문서)가
 * 여전히 기본 경로이고, 이 파일은 다음 단계의 전환 준비물이다.
 *
 * 아래 USE_SPLIT_FIRESTORE가 false인 동안에는 이 어댑터를 통한 쓰기가 일어나지 않는다.
 */

/**
 * 새 구조를 실제로 쓰기 시작할 때 켜는 스위치.
 *
 * false = 기존 clubs/{clubId} 단일 문서만 사용(현재 상태).
 * 이 값을 true로 바꾸는 것은 별도 작업이며, 그 전에 데이터 이전과 Rules 준비가 끝나 있어야 한다.
 */
export const USE_SPLIT_FIRESTORE = false

export const DEFAULT_CLUB_ID = 'skkubc'

const configDoc = (clubId: string) => doc(db, 'clubs', clubId, 'config', 'main')
const membersCol = (clubId: string) => collection(db, 'clubs', clubId, 'members')
const memberDoc = (clubId: string, memberId: string) => doc(db, 'clubs', clubId, 'members', memberId)
const memberPrivateDoc = (clubId: string, memberId: string) => doc(db, 'clubs', clubId, 'memberPrivate', memberId)
const sessionsCol = (clubId: string) => collection(db, 'clubs', clubId, 'sessions')
const sessionDoc = (clubId: string, sessionId: string) => doc(db, 'clubs', clubId, 'sessions', sessionId)
const gamesCol = (clubId: string, sessionId: string) =>
  collection(db, 'clubs', clubId, 'sessions', sessionId, 'games')
const gameDoc = (clubId: string, sessionId: string, gameId: string) =>
  doc(db, 'clubs', clubId, 'sessions', sessionId, 'games', gameId)
const ledgerCol = (clubId: string) => collection(db, 'clubs', clubId, 'ledger')
const ledgerDoc = (clubId: string, recordId: string) => doc(db, 'clubs', clubId, 'ledger', recordId)

// ── legacy ↔ split 문서 모양 변환 ─────────────────────────────────────
// 이 두 함수가 split에 실제로 나가는 문서의 "허용 필드 목록"이다. 절대 원본 객체를 그대로
// spread하지 않는다 — 특히 Member에는 password가 있고, 이 필드는 어떤 이유로도 split
// members(연결된 회원이면 누구나 read 가능)에 들어가면 안 된다. Session도 games는 별도
// 하위컬렉션이라 여기서 뺀다.

/** Member → PublicMember. password는 의도적으로 옮기지 않는다(설계 문서: types/splitFirestore.ts). */
export function toPublicMember(member: Member): PublicMember {
  return {
    id: member.id,
    name: member.name,
    handicap: member.handicap,
    handicapHistory: member.handicapHistory.map((h) => ({ ...h })),
    active: member.active,
    ...(member.displayTag ? { displayTag: member.displayTag } : {}),
  }
}

/** Session → SessionDoc. games 배열은 하위컬렉션(sessions/{id}/games)이라 여기서 뺀다. */
export function toSessionDoc(session: Session): SessionDoc {
  const { games: _games, ...rest } = session
  return JSON.parse(JSON.stringify(rest)) as SessionDoc
}

// ── 읽기 ────────────────────────────────────────────────────────────

export async function fetchConfig(clubId = DEFAULT_CLUB_ID): Promise<ClubConfig | null> {
  const snap = await getDoc(configDoc(clubId))
  return snap.exists() ? (snap.data() as ClubConfig) : null
}

export async function fetchMembers(clubId = DEFAULT_CLUB_ID): Promise<PublicMember[]> {
  const snap = await getDocs(membersCol(clubId))
  return snap.docs.map((d) => d.data() as PublicMember)
}

export async function fetchSessions(clubId = DEFAULT_CLUB_ID): Promise<SessionDoc[]> {
  const snap = await getDocs(sessionsCol(clubId))
  return snap.docs.map((d) => d.data() as SessionDoc)
}

export async function fetchGames(sessionId: string, clubId = DEFAULT_CLUB_ID): Promise<Game[]> {
  const snap = await getDocs(gamesCol(clubId, sessionId))
  return snap.docs.map((d) => d.data() as Game)
}

export async function fetchLedger(clubId = DEFAULT_CLUB_ID): Promise<LedgerRecord[]> {
  const snap = await getDocs(ledgerCol(clubId))
  return snap.docs.map((d) => d.data() as LedgerRecord)
}

/**
 * split 경로 전체를 읽어 legacy AppState 모양으로 다시 합친다.
 *
 * ⚠ 이 함수는 아직 앱 부팅 흐름에 연결돼 있지 않다(호출하는 곳 없음). USE_SPLIT_FIRESTORE가
 * false인 동안에는 이 함수가 있어도 실제로 쓰이지 않는다 — split "쓰기" 경로가 아직 일반회원
 * 기기에는 열려 있지 않아서(현재 split Rules는 members/sessions/games/ledger write를
 * 관리자에게만 허용한다), 지금 이 함수로 읽기를 전환하면 회원이 만든 새 변경이 split에는
 * 반영되지 않아 다음 접속 때 사라진 것처럼 보일 수 있다. 이 문제가 먼저 해결된 뒤에
 * App.tsx 부팅 흐름에서 이 함수를 호출하도록 연결해야 한다.
 *
 * Firestore 컬렉션 조회는 저장 순서를 보장하지 않는다 — 화면들은 이미 필요한 곳마다
 * 자체적으로 정렬(.sort())하므로 이 함수는 순서를 맞추지 않고 그대로 돌려준다.
 */
export async function loadSplitAppState(clubId = DEFAULT_CLUB_ID): Promise<AppState> {
  const [config, members, sessions, ledger] = await Promise.all([
    fetchConfig(clubId),
    fetchMembers(clubId),
    fetchSessions(clubId),
    fetchLedger(clubId),
  ])

  const gamesBySession = await Promise.all(
    sessions.map(async (s): Promise<SplitGame[]> => {
      const games = await fetchGames(s.id, clubId)
      return games.map((game) => ({ sessionId: s.id, game }))
    }),
  )

  return mergeSplitToAppState({
    config: config ?? { lastBackupAt: null },
    members,
    memberPrivate: [], // mergeSplitToAppState는 memberPrivate를 쓰지 않는다
    sessions,
    games: gamesBySession.flat(),
    ledger,
  })
}

// ── 쓰기 ────────────────────────────────────────────────────────────
// 낱개 쓰기 함수들. 앱이 새 구조로 전환한 뒤에 쓰인다.

export async function writeConfig(config: ClubConfig, clubId = DEFAULT_CLUB_ID): Promise<void> {
  await setDoc(configDoc(clubId), config)
}

export async function writeMember(member: PublicMember, clubId = DEFAULT_CLUB_ID): Promise<void> {
  await setDoc(memberDoc(clubId, member.id), member)
}

export async function writeMemberPrivate(record: MemberPrivate, clubId = DEFAULT_CLUB_ID): Promise<void> {
  await setDoc(memberPrivateDoc(clubId, record.memberId), record)
}

export async function writeSession(session: SessionDoc, clubId = DEFAULT_CLUB_ID): Promise<void> {
  await setDoc(sessionDoc(clubId, session.id), session)
}

export async function writeGame(sessionId: string, game: Game, clubId = DEFAULT_CLUB_ID): Promise<void> {
  await setDoc(gameDoc(clubId, sessionId, game.id), game)
}

/**
 * 세션 문서와 그 밑의 games 하위컬렉션 전체를 함께 지운다.
 *
 * Firestore는 문서를 지워도 그 하위컬렉션을 자동으로 지우지 않는다 — 세션 문서만 지우면
 * 그 세션의 경기 문서들이 고아로 남는다(다음 목록 조회에는 안 보이지만 저장소에는 계속
 * 남는다). 이 함수는 두 컬렉션 지우기를 하나의 배치로 묶어서, 이미 지워진 세션에 다시
 * 호출해도(games가 비어 있으면 삭제할 문서가 없을 뿐) 안전하게 재실행할 수 있다.
 */
export async function deleteSplitSession(sessionId: string, clubId = DEFAULT_CLUB_ID): Promise<void> {
  const gamesSnap = await getDocs(gamesCol(clubId, sessionId))
  const batch = writeBatch(db)
  for (const gameSnap of gamesSnap.docs) batch.delete(gameSnap.ref)
  batch.delete(sessionDoc(clubId, sessionId))
  await batch.commit()
}

export async function deleteSplitGame(sessionId: string, gameId: string, clubId = DEFAULT_CLUB_ID): Promise<void> {
  await deleteDoc(gameDoc(clubId, sessionId, gameId))
}

export async function writeLedgerRecord(record: LedgerRecord, clubId = DEFAULT_CLUB_ID): Promise<void> {
  await setDoc(ledgerDoc(clubId, record.id), record)
}

export async function deleteSplitLedgerRecord(recordId: string, clubId = DEFAULT_CLUB_ID): Promise<void> {
  await deleteDoc(ledgerDoc(clubId, recordId))
}

// ── 회원 전용 쓰기 (보안 7단계) ────────────────────────────────────────
// 관리자 없이도 Rules가 허용하는 범위(연결된 활성 회원)에서 쓰는 함수들.
// 아직 앱 UI 어디에서도 호출하지 않는다 — write 정책이 확정·검증된 뒤 연결한다.

/**
 * 회원이 자기 참가 경기 결과를 처음 제출한다.
 * pending을 항상 true로 강제한다 — 관리자가 확인하기 전에는 확정 통계에 반영되지 않는다.
 * (Rules에서도 같은 조건을 검증하므로 이건 방어적 이중 확인이다.)
 *
 * 넘겨받은 game 객체를 그대로 펼쳐 쓰지 않고 허용된 필드만 하나씩 골라 담는다 — 호출하는
 * 쪽이 winnerId·revisionRequested처럼 회원 create Rules가 막는 필드가 든 Game 객체를
 * 실수로 넘기더라도, 여기서 걸러지므로 Firestore 요청 자체가 그 필드를 포함하지 않는다.
 */
export async function submitMemberGameResult(sessionId: string, game: Game, clubId = DEFAULT_CLUB_ID): Promise<void> {
  const payload: Omit<Game, 'winnerId' | 'revisionRequested'> & { pending: true } = {
    id: game.id,
    playerAId: game.playerAId,
    playerBId: game.playerBId,
    handicapA: game.handicapA,
    handicapB: game.handicapB,
    scoreA: game.scoreA,
    scoreB: game.scoreB,
    endType: game.endType,
    playedAt: game.playedAt,
    pending: true,
    ...(game.round !== undefined ? { round: game.round } : {}),
  }
  await setDoc(gameDoc(clubId, sessionId, game.id), payload)
}

/**
 * 회원이 번개모임 세션의 참석자 명단만 바꾼다(참석자 추가 등).
 *
 * setDoc(전체 덮어쓰기) 대신 updateDoc(부분 갱신)을 쓴다 — Rules는 이 update가 attendeeIds
 * 외의 필드를 하나도 바꾸지 않을 때만 허용하는데, updateDoc은 여기 적은 필드만 실제로
 * Firestore에 보내므로 로컬 상태가 서버와 잠깐 어긋나 있어도(다른 필드 값 차이) 항상
 * attendeeIds 하나만 바뀐 것으로 평가된다. setDoc으로 세션 전체를 다시 써서 보내면 그
 * 순간의 로컬 스냅샷에 있는 다른 필드 값 차이가 통째로 "바뀐 필드"로 잡혀 거부될 수 있다.
 */
export async function updateFlashSessionAttendees(
  sessionId: string,
  attendeeIds: string[],
  clubId = DEFAULT_CLUB_ID,
): Promise<void> {
  await updateDoc(sessionDoc(clubId, sessionId), { attendeeIds })
}

/**
 * 회원이 자기 참가 경기 결과를 다시 제출한다(관리자가 "수정 요청"한 뒤).
 * 점수·종료유형만 바꾸고 pending을 true로, revisionRequested를 false로 되돌린다 —
 * Rules의 update 규칙이 허용하는 필드 범위와 정확히 같다.
 */
export async function resubmitMemberGameResult(
  sessionId: string,
  game: Pick<Game, 'id' | 'scoreA' | 'scoreB' | 'endType'>,
  clubId = DEFAULT_CLUB_ID,
): Promise<void> {
  await setDoc(
    gameDoc(clubId, sessionId, game.id),
    { scoreA: game.scoreA, scoreB: game.scoreB, endType: game.endType, pending: true, revisionRequested: false },
    { merge: true },
  )
}

/**
 * 나눈 데이터 전체를 새 구조에 쓴다 — 실제 데이터 이전에만 쓰는 함수다.
 *
 * ⚠ 이 함수는 운영 데이터를 실제로 만든다. 앱 어디에서도 자동으로 부르지 않으며,
 * migration.ts의 executeMigration()이 명시적인 승인 인자를 받았을 때만 호출한다.
 *
 * Firestore 배치는 한 번에 500개까지라 나눠서 커밋한다.
 */
export async function writeAllSplitData(split: SplitFirestoreData, clubId = DEFAULT_CLUB_ID): Promise<number> {
  const ops: { ref: ReturnType<typeof doc>; data: object }[] = [
    { ref: configDoc(clubId), data: split.config },
    ...split.members.map((m) => ({ ref: memberDoc(clubId, m.id), data: m })),
    ...split.memberPrivate.map((p) => ({ ref: memberPrivateDoc(clubId, p.memberId), data: p })),
    ...split.sessions.map((s) => ({ ref: sessionDoc(clubId, s.id), data: s })),
    ...split.games.map((g) => ({ ref: gameDoc(clubId, g.sessionId, g.game.id), data: g.game })),
    ...split.ledger.map((r) => ({ ref: ledgerDoc(clubId, r.id), data: r })),
  ]

  const BATCH_LIMIT = 450 // 500 제한보다 여유를 둔다
  for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db)
    for (const op of ops.slice(i, i + BATCH_LIMIT)) batch.set(op.ref, op.data)
    await batch.commit()
  }
  return ops.length
}

// ── 관리자 전체 상태 동기화 (보안 8단계) ──────────────────────────────
// 관리자 화면(회원 관리·에버리지 수정·CSV 반영·세션 삭제·경기 확인/수정·정산 등)에서 상태를
// 바꾼 뒤, 바뀐 문서만 골라 split에 반영한다. admin은 Rules상 쓰기 제한이 없으므로(각
// 컬렉션의 `allow ...: if isAdmin()`) 여기서는 실제로 값이 달라진 문서만 set/delete하면
// 된다 — 매번 회원·세션·경기 전체를 다시 쓰는 legacy식 "전체 스냅샷" 방식은 쓰지 않는다.
//
// ⚠ 일반회원 행동에는 이 함수를 쓰지 않는다. 일반회원은 Rules가 허용하는 좁은 필드만 쓸 수
// 있는데, 이 함수는 바뀐 필드가 무엇이든 문서를 통째로 set()하므로 회원 Rules(예: 경기 수정은
// scoreA/scoreB/endType/pending/revisionRequested 다섯 필드로 제한)에 걸려 거부된다.
// 회원 행동은 submitMemberGameResult/resubmitMemberGameResult/updateFlashSessionAttendees처럼
// "그 행동이 실제로 바꾸는 필드만" 쓰는 전용 함수를 쓴다.
export async function syncSplitChanges(
  previous: AppState,
  next: AppState,
  clubId = DEFAULT_CLUB_ID,
): Promise<void> {
  type Op =
    | { kind: 'set'; ref: ReturnType<typeof doc>; data: object }
    | { kind: 'delete'; ref: ReturnType<typeof doc> }
  const ops: Op[] = []
  // 이 값들은 전부 JSON으로 표현되는 데이터(문자열·숫자·불리언·배열·객체)이고, toPublicMember·
  // toSessionDoc이 항상 같은 순서로 필드를 만들어 내므로 문자열 비교로 충분하다.
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

  // ── 회원 ──
  const prevMembers = new Map(previous.members.map((m) => [m.id, m]))
  const nextMembers = new Map(next.members.map((m) => [m.id, m]))
  for (const [id, m] of nextMembers) {
    const before = prevMembers.get(id)
    const pub = toPublicMember(m)
    if (!before || !same(toPublicMember(before), pub)) {
      ops.push({ kind: 'set', ref: memberDoc(clubId, id), data: pub })
    }
  }
  for (const id of prevMembers.keys()) {
    if (!nextMembers.has(id)) ops.push({ kind: 'delete', ref: memberDoc(clubId, id) })
  }

  // ── 세션 + 경기(하위컬렉션) ──
  const prevSessions = new Map(previous.sessions.map((s) => [s.id, s]))
  const nextSessions = new Map(next.sessions.map((s) => [s.id, s]))
  for (const [id, s] of nextSessions) {
    const before = prevSessions.get(id)
    const sessionData = toSessionDoc(s)
    if (!before || !same(toSessionDoc(before), sessionData)) {
      ops.push({ kind: 'set', ref: sessionDoc(clubId, id), data: sessionData })
    }
    const prevGames = new Map((before?.games ?? []).map((g) => [g.id, g]))
    const nextGames = new Map(s.games.map((g) => [g.id, g]))
    for (const [gid, g] of nextGames) {
      const gameBefore = prevGames.get(gid)
      if (!gameBefore || !same(gameBefore, g)) {
        ops.push({ kind: 'set', ref: gameDoc(clubId, id, gid), data: g })
      }
    }
    for (const gid of prevGames.keys()) {
      if (!nextGames.has(gid)) ops.push({ kind: 'delete', ref: gameDoc(clubId, id, gid) })
    }
  }
  for (const [id, s] of prevSessions) {
    if (!nextSessions.has(id)) {
      // 세션 자체가 없어졌다 — 그 세션의 경기까지 함께 지운다(deleteSplitSession과 같은 이유).
      for (const g of s.games) ops.push({ kind: 'delete', ref: gameDoc(clubId, id, g.id) })
      ops.push({ kind: 'delete', ref: sessionDoc(clubId, id) })
    }
  }

  // ── 회계 ──
  const prevLedger = new Map(previous.ledger.map((r) => [r.id, r]))
  const nextLedger = new Map(next.ledger.map((r) => [r.id, r]))
  for (const [id, r] of nextLedger) {
    const before = prevLedger.get(id)
    if (!before || !same(before, r)) ops.push({ kind: 'set', ref: ledgerDoc(clubId, id), data: r })
  }
  for (const id of prevLedger.keys()) {
    if (!nextLedger.has(id)) ops.push({ kind: 'delete', ref: ledgerDoc(clubId, id) })
  }

  // ── 설정 ──
  if (previous.settings.lastBackupAt !== next.settings.lastBackupAt) {
    ops.push({ kind: 'set', ref: configDoc(clubId), data: { lastBackupAt: next.settings.lastBackupAt } })
  }

  if (ops.length === 0) return

  const BATCH_LIMIT = 450
  for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db)
    for (const op of ops.slice(i, i + BATCH_LIMIT)) {
      if (op.kind === 'set') batch.set(op.ref, op.data)
      else batch.delete(op.ref)
    }
    await batch.commit()
  }
}

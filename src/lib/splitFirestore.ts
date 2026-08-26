import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, writeBatch } from 'firebase/firestore'
import { db } from './firebase'
import type { AppState, Game, LedgerRecord } from '../types'
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

import { collection, doc, getDoc, getDocs, setDoc, writeBatch } from 'firebase/firestore'
import { db } from './firebase'
import type { Game, LedgerRecord } from '../types'
import type {
  ClubConfig, MemberPrivate, PublicMember, SessionDoc, SplitFirestoreData,
} from '../types/splitFirestore'

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

export async function writeLedgerRecord(record: LedgerRecord, clubId = DEFAULT_CLUB_ID): Promise<void> {
  await setDoc(ledgerDoc(clubId, record.id), record)
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

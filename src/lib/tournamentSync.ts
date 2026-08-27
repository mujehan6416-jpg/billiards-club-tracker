import { collection, deleteField, doc, getDoc, getDocs, setDoc, updateDoc, writeBatch } from 'firebase/firestore'
import { db } from './firebase'
import { createDrawMapping, createTournamentParticipant, validateDrawEntries } from '../logic/tournamentDraw'
import type { Member } from '../types'
import {
  approveTournamentMatch as applyApproval,
  adminVerifyTournamentMatchResult as applyAdminVerification,
  calculateFinalPlacements,
  canCorrectOfficialResult,
  correctTournamentMatchResult as applyAdminCorrection,
  declareTournamentForfeit as applyForfeit,
  requestTournamentMatchCorrection as applyCorrectionRequest,
  submitTournamentMatchResult as applyResultSubmission,
  verifyTournamentMatchResult as applyResultVerification,
} from '../logic/tournamentMatch'
import type {
  Tournament, TournamentDrawEntry, TournamentDrawMapping, TournamentEntryStatus,
  TournamentMatch, TournamentParticipant, TournamentPromotion,
} from '../types/tournament'

// 대회 토너먼트 전용 Firestore 접근 계층.
//
// 기존 splitFirestore.ts(회원·모임·경기)와 settlementSync.ts(정산)처럼 **독립된 파일**이다.
// 이 파일은 clubs/{clubId}/tournaments/... 아래만 읽고 쓰며, 회원·모임·경기·회계 문서를
// 절대 건드리지 않는다. 그래서 토너먼트 작업이 기존 통계나 일반 경기에 영향을 주지 않는다.
//
// 저장 구조
//   clubs/{clubId}/tournaments/{tournamentId}                        대회 기본정보 (공개)
//   clubs/{clubId}/tournaments/{tournamentId}/participants/{pid}     참가자 (공개)
//   clubs/{clubId}/tournaments/{tournamentId}/matches/{matchId}      경기 (대진 확정 후 생성, 공개)
//   clubs/{clubId}/tournaments/{tournamentId}/private/draw           번호↔자리 매핑 (관리자 전용)
//
// ⚠ 마지막 private/draw는 **회원용 조회 함수에서 절대 부르지 않는다.** Firestore는 문서를
// 통째로 내려주고 규칙에 필드 단위 읽기 제어가 없어서, 이 내용이 공개 문서에 섞이면 현장에서
// 번호를 뽑기도 전에 어느 번호가 부전승인지 알 수 있게 된다.
//
// 쓰기 원칙: 클라이언트가 건네는 객체를 통째로 저장하지 않고, 그 동작이 실제로 바꾸는 필드만
// 골라 담는다(splitFirestore.ts의 submitMemberGameResult와 같은 방식). 나중에 Firestore 규칙이
// 필드 목록을 제한할 때 요청이 규칙과 어긋나지 않게 하기 위해서다.

export const DEFAULT_CLUB_ID = 'skkubc'

/**
 * 값이 명시적으로 undefined인 필드를 재귀적으로 걷어낸다 — Firestore가 그런 필드를 거부하기
 * 때문이다. null·0·false·빈 문자열은 의도된 값이므로 그대로 둔다.
 *
 * 정산(settlementSync.ts)에도 같은 목적의 함수가 있지만 일부러 가져다 쓰지 않는다.
 * 토너먼트가 정산 구현 파일에 의존하면, 나중에 둘 중 하나만 손볼 때 서로를 깨뜨릴 수 있다.
 * 열 줄짜리 순수 함수를 각자 갖는 편이 안전하다.
 */
function withoutUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => withoutUndefined(item)) as unknown as T
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue
      result[key] = withoutUndefined(v)
    }
    return result as T
  }
  return value
}

const tournamentsCol = (clubId: string) => collection(db, 'clubs', clubId, 'tournaments')
const tournamentDoc = (clubId: string, tournamentId: string) =>
  doc(db, 'clubs', clubId, 'tournaments', tournamentId)
const participantsCol = (clubId: string, tournamentId: string) =>
  collection(db, 'clubs', clubId, 'tournaments', tournamentId, 'participants')
const participantDoc = (clubId: string, tournamentId: string, participantId: string) =>
  doc(db, 'clubs', clubId, 'tournaments', tournamentId, 'participants', participantId)
const matchesCol = (clubId: string, tournamentId: string) =>
  collection(db, 'clubs', clubId, 'tournaments', tournamentId, 'matches')
const matchDoc = (clubId: string, tournamentId: string, matchId: string) =>
  doc(db, 'clubs', clubId, 'tournaments', tournamentId, 'matches', matchId)

/** 관리자 전용 추첨 매핑 문서. 공개 조회 경로와 완전히 분리된 자리다. */
const drawDoc = (clubId: string, tournamentId: string) =>
  doc(db, 'clubs', clubId, 'tournaments', tournamentId, 'private', 'draw')

// ── 오류 ────────────────────────────────────────────────────────────

export type TournamentSyncErrorCode = 'not-found' | 'validation' | 'blocked' | 'permission-denied' | 'unknown'

export class TournamentSyncError extends Error {
  code: TournamentSyncErrorCode
  constructor(code: TournamentSyncErrorCode, message: string) {
    super(message)
    this.code = code
    this.name = 'TournamentSyncError'
  }
}

function toSyncError(e: unknown): TournamentSyncError {
  if (e instanceof TournamentSyncError) return e
  if ((e as { code?: string })?.code === 'permission-denied') {
    return new TournamentSyncError('permission-denied', '권한이 없습니다. 관리자 로그인 상태를 확인해 주세요.')
  }
  return new TournamentSyncError('unknown', e instanceof Error ? e.message : '알 수 없는 오류가 발생했습니다.')
}

// ── 대회 기본정보 ────────────────────────────────────────────────────

/** 대회 문서에 저장하는 필드 목록. 여기 없는 값은 저장하지 않는다. */
function toTournamentDoc(tournament: Tournament): Tournament {
  return withoutUndefined({
    id: tournament.id,
    name: tournament.name,
    date: tournament.date,
    timeLimitMinutes: tournament.timeLimitMinutes,
    status: tournament.status,
    participantCount: tournament.participantCount,
    bracketSize: tournament.bracketSize,
    createdAt: tournament.createdAt,
    createdByAdminUid: tournament.createdByAdminUid,
    drawConfirmedAt: tournament.drawConfirmedAt,
    completedAt: tournament.completedAt,
    championParticipantId: tournament.championParticipantId,
    runnerUpParticipantId: tournament.runnerUpParticipantId,
  })
}

export async function createTournament(tournament: Tournament, clubId = DEFAULT_CLUB_ID): Promise<void> {
  try {
    await setDoc(tournamentDoc(clubId, tournament.id), toTournamentDoc(tournament))
  } catch (e) {
    throw toSyncError(e)
  }
}

/**
 * 대회 기본정보 하나를 읽는다.
 *
 * ⚠ 이 함수는 관리자 전용 private/draw를 **절대 함께 읽지 않는다.** 회원 화면이 부르는
 * 경로이므로, 여기서 추첨 매핑을 같이 가져오면 그 값이 앱 메모리에 올라가고 결국 노출된다.
 */
export async function fetchTournament(
  tournamentId: string,
  clubId = DEFAULT_CLUB_ID,
): Promise<Tournament | null> {
  try {
    const snap = await getDoc(tournamentDoc(clubId, tournamentId))
    return snap.exists() ? (snap.data() as Tournament) : null
  } catch (e) {
    throw toSyncError(e)
  }
}

export async function fetchTournaments(clubId = DEFAULT_CLUB_ID): Promise<Tournament[]> {
  try {
    const snap = await getDocs(tournamentsCol(clubId))
    return snap.docs.map((d) => d.data() as Tournament)
  } catch (e) {
    throw toSyncError(e)
  }
}

/** 대회명·날짜·제한시간만 고친다. 진행 단계나 대진 관련 값은 여기서 바꾸지 않는다. */
export async function updateTournamentInfo(
  tournamentId: string,
  patch: Pick<Tournament, 'name' | 'date' | 'timeLimitMinutes'>,
  clubId = DEFAULT_CLUB_ID,
): Promise<void> {
  try {
    await updateDoc(tournamentDoc(clubId, tournamentId), {
      name: patch.name,
      date: patch.date,
      timeLimitMinutes: patch.timeLimitMinutes,
    })
  } catch (e) {
    throw toSyncError(e)
  }
}

/** 관리자가 최종 참가자를 확정한다 — 이후 대진 규모 계산의 기준이 된다. */
export async function confirmTournamentEntries(
  tournamentId: string,
  participantCount: number,
  clubId = DEFAULT_CLUB_ID,
): Promise<void> {
  try {
    await updateDoc(tournamentDoc(clubId, tournamentId), {
      status: 'entryClosed',
      participantCount,
    })
  } catch (e) {
    throw toSyncError(e)
  }
}

/**
 * 참가자 확정을 취소하고 참가 신청 단계(draft)로 되돌린다 — 4B §6의 CASE 1·2.
 *
 * 대진이 이미 확정(bracketFixed)된 뒤에는 이 함수로 되돌릴 수 없다. 그 상태에서는 먼저
 * cancelTournamentBracket()으로 bracketFixed → entryClosed까지 내려온 뒤 다시 불러야 한다.
 * 그 함수가 이미 "공식 확정된 경기가 있으면 막는다"를 지키므로(hasOfficialPlayedMatch),
 * 대진 문서 자체가 아직 없는 draft·entryClosed·drawReady 상태에서는 애초에 공식 경기가
 * 존재할 수 없다 — 그래서 이 함수는 그 확인을 별도로 하지 않는다(상태 자체가 그것을 보장한다).
 *
 * 추첨 준비(prepareTournamentDraw)를 이미 눌러 private/draw와 참가자 drawNumber가 남아
 * 있을 수 있으므로(CASE 2) 함께 지운다 — 남겨 두면 다음 추첨 준비 때 옛 매핑이 섞일 수 있다.
 */
export async function reopenTournamentEntries(
  tournamentId: string,
  clubId = DEFAULT_CLUB_ID,
): Promise<void> {
  try {
    const tournament = await fetchTournament(tournamentId, clubId)
    if (!tournament) throw new TournamentSyncError('not-found', '대회를 찾을 수 없습니다.')
    if (tournament.status !== 'entryClosed' && tournament.status !== 'drawReady') {
      throw new TournamentSyncError(
        'blocked',
        tournament.status === 'bracketFixed' || tournament.status === 'finished'
          ? '대진이 이미 확정되어 있습니다. 먼저 대진 확정을 취소해 주세요.'
          : '지금은 참가자 확정을 취소할 수 있는 상태가 아닙니다.',
      )
    }

    const participants = await fetchTournamentParticipants(tournamentId, clubId)
    const batch = writeBatch(db)
    batch.delete(drawDoc(clubId, tournamentId))
    for (const participant of participants) {
      if (participant.drawNumber !== undefined) {
        batch.update(participantDoc(clubId, tournamentId, participant.id), { drawNumber: deleteField() })
      }
    }
    batch.update(tournamentDoc(clubId, tournamentId), {
      status: 'draft',
      participantCount: deleteField(),
    })
    await batch.commit()
  } catch (e) {
    throw toSyncError(e)
  }
}

// ── 참가자 ──────────────────────────────────────────────────────────

function toParticipantDoc(participant: TournamentParticipant): TournamentParticipant {
  return withoutUndefined({
    id: participant.id,
    memberId: participant.memberId,
    displayNameSnapshot: participant.displayNameSnapshot,
    baseHandicapSnapshot: participant.baseHandicapSnapshot,
    tournamentHandicap: participant.tournamentHandicap,
    entryStatus: participant.entryStatus,
    excludedByAdminUid: participant.excludedByAdminUid,
    excludedAt: participant.excludedAt,
    drawNumber: participant.drawNumber,
    withdrawn: participant.withdrawn,
    finalPlacement: participant.finalPlacement,
  })
}

/**
 * 참가자 문서 하나를 만든다(또는 통째로 다시 쓴다).
 *
 * 이름·기본 핸디 snapshot은 호출부가 회원 원본에서 만들어 넘긴다
 * (logic/tournamentDraw.ts의 createTournamentParticipant). 이 파일은 회원 문서를 읽지 않는다 —
 * 회원 조회는 이미 splitFirestore.ts의 책임이고, 두 곳에서 같은 데이터를 읽으면 기준이 갈린다.
 */
export async function writeTournamentParticipant(
  tournamentId: string,
  participant: TournamentParticipant,
  clubId = DEFAULT_CLUB_ID,
): Promise<void> {
  try {
    await setDoc(participantDoc(clubId, tournamentId, participant.id), toParticipantDoc(participant))
  } catch (e) {
    throw toSyncError(e)
  }
}

export async function fetchTournamentParticipants(
  tournamentId: string,
  clubId = DEFAULT_CLUB_ID,
): Promise<TournamentParticipant[]> {
  try {
    const snap = await getDocs(participantsCol(clubId, tournamentId))
    return snap.docs.map((d) => d.data() as TournamentParticipant)
  } catch (e) {
    throw toSyncError(e)
  }
}

/**
 * 활성 회원 중 아직 이 대회의 participant 문서가 없는 사람에게만 문서를 만들어 준다
 * (entryStatus는 'noResponse'로 시작). 문서 id는 회원 id를 그대로 쓴다 — 한 대회 안에서
 * "이 회원의 참가자 문서가 이미 있는지"를 목록을 다시 훑지 않고 바로 찾을 수 있고,
 * Firestore 규칙(participants 블록)이 "본인 문서인지"를 memberId 필드로만 판정하는 것과도 맞는다.
 *
 * 이미 있는 참가자는 절대 건드리지 않는다 — 회원이 이미 응답했거나 관리자가 제외한 상태를
 * 덮어쓰면 안 되기 때문이다. 그래서 회원 목록으로 몇 번을 다시 불러도 안전하다(idempotent).
 *
 * 회원은 스스로 자기 participant 문서를 만들 수 없다(Rules가 참가자 create를 관리자 전용으로
 * 막아 둔다) — 그래서 대회를 만든 직후 이 함수로 활성 회원 전원의 문서를 미리 만들어 둬야
 * 회원이 참가/불참을 누를 대상이 생긴다. 나중에 새로 활성화된 회원이나 관리자가 현장에서
 * 참가자를 추가할 때도 같은 함수를 다시 불러 빠진 사람만 채울 수 있다.
 */
export async function createMissingParticipants(
  tournamentId: string,
  activeMembers: Pick<Member, 'id' | 'name' | 'handicap'>[],
  clubId = DEFAULT_CLUB_ID,
): Promise<number> {
  try {
    const existing = await fetchTournamentParticipants(tournamentId, clubId)
    const existingMemberIds = new Set(existing.map((p) => p.memberId))
    const missing = activeMembers.filter((m) => !existingMemberIds.has(m.id))
    if (missing.length === 0) return 0

    const BATCH_LIMIT = 450
    for (let i = 0; i < missing.length; i += BATCH_LIMIT) {
      const batch = writeBatch(db)
      for (const member of missing.slice(i, i + BATCH_LIMIT)) {
        const participant = createTournamentParticipant(member, { participantId: member.id })
        batch.set(participantDoc(clubId, tournamentId, participant.id), toParticipantDoc(participant))
      }
      await batch.commit()
    }
    return missing.length
  } catch (e) {
    throw toSyncError(e)
  }
}

/** 회원이 참가·불참을 고른다. 관리자 전용인 'excluded'는 이 함수로 만들 수 없다. */
export async function setParticipantEntryStatus(
  tournamentId: string,
  participantId: string,
  entryStatus: Exclude<TournamentEntryStatus, 'excluded'>,
  clubId = DEFAULT_CLUB_ID,
): Promise<void> {
  try {
    await updateDoc(participantDoc(clubId, tournamentId, participantId), { entryStatus })
  } catch (e) {
    throw toSyncError(e)
  }
}

/**
 * 관리자가 신청자를 제외한다. 문서를 지우지 않고 상태만 바꾼다 —
 * 나중에 "왜 빠졌는지"를 확인할 수 있어야 하고, 지워 버리면 그 근거가 사라진다.
 */
export async function excludeParticipantByAdmin(
  tournamentId: string,
  participantId: string,
  input: { adminUid: string; at: string },
  clubId = DEFAULT_CLUB_ID,
): Promise<void> {
  try {
    await updateDoc(participantDoc(clubId, tournamentId, participantId), {
      entryStatus: 'excluded',
      excludedByAdminUid: input.adminUid,
      excludedAt: input.at,
    })
  } catch (e) {
    throw toSyncError(e)
  }
}

/**
 * 관리자가 이 대회에서 적용할 핸디를 조정한다.
 * 회원의 기본 핸디(members/{memberId}.handicap)는 건드리지 않는다 — 이 문서만 바뀐다.
 */
export async function setParticipantTournamentHandicap(
  tournamentId: string,
  participantId: string,
  tournamentHandicap: number,
  clubId = DEFAULT_CLUB_ID,
): Promise<void> {
  if (!Number.isFinite(tournamentHandicap) || tournamentHandicap < 1) {
    throw new TournamentSyncError('validation', '대회 적용 핸디는 1 이상이어야 합니다.')
  }
  try {
    await updateDoc(participantDoc(clubId, tournamentId, participantId), { tournamentHandicap })
  } catch (e) {
    throw toSyncError(e)
  }
}

// ── 관리자 전용 추첨 매핑 (private/draw) ──────────────────────────────

/**
 * 번호↔자리 매핑과 부전승 자리를 **관리자 전용 문서에만** 저장한다.
 * 이 값은 어떤 공개 문서에도 복사해 넣지 않는다.
 */
export async function saveTournamentDrawMapping(
  tournamentId: string,
  mapping: TournamentDrawMapping,
  clubId = DEFAULT_CLUB_ID,
): Promise<void> {
  try {
    await setDoc(drawDoc(clubId, tournamentId), {
      bracketSize: mapping.bracketSize,
      byeSlots: [...mapping.byeSlots],
      numberToSlot: { ...mapping.numberToSlot },
    })
  } catch (e) {
    throw toSyncError(e)
  }
}

/** 관리자 전용. 회원용 화면이 부르는 어떤 함수도 이 함수를 호출하지 않는다. */
export async function loadTournamentDrawMapping(
  tournamentId: string,
  clubId = DEFAULT_CLUB_ID,
): Promise<TournamentDrawMapping | null> {
  try {
    const snap = await getDoc(drawDoc(clubId, tournamentId))
    return snap.exists() ? (snap.data() as TournamentDrawMapping) : null
  } catch (e) {
    throw toSyncError(e)
  }
}

/**
 * "추첨 준비" — 참가자 확정(entryClosed) 상태에서, 확정 당시 저장해 둔 참가 인원
 * (Tournament.participantCount)만으로 대진 규모·부전승 자리·번호↔자리 비공개 매핑을 만들어
 * private/draw에 저장하고, 대회 상태를 drawReady로 옮긴다.
 *
 * 참가자 목록이나 이름·핸디를 전혀 읽지 않는다 — 1단계 createDrawMapping()이 인원 수만
 * 받는 것과 같은 이유로, 특정 회원에게 유리한 배치가 이 함수 차원에서도 구조적으로
 * 불가능하다. 만든 매핑은 관리자 전용 문서에만 들어가며, 이 함수는 대회 공개 문서에
 * bracketSize를 아직 쓰지 않는다 — 그 값은 대진 확정(confirmTournamentBracket) 시점에만
 * 공개된다(추첨 준비 단계의 관리자 화면에는 "번호 범위 1~N"만 보여주면 되고, 대진 규모까지
 * 미리 알 필요는 없다).
 */
export async function prepareTournamentDraw(
  tournamentId: string,
  participantCount: number,
  clubId = DEFAULT_CLUB_ID,
  rng: () => number = Math.random,
): Promise<TournamentDrawMapping> {
  const mapping = createDrawMapping(participantCount, rng)
  if (!mapping.ok) throw new TournamentSyncError('validation', mapping.message)
  try {
    await saveTournamentDrawMapping(tournamentId, mapping.value, clubId)
    await updateDoc(tournamentDoc(clubId, tournamentId), { status: 'drawReady' })
    return mapping.value
  } catch (e) {
    throw toSyncError(e)
  }
}

// ── 오프라인 추첨 결과 저장 ───────────────────────────────────────────

/**
 * 현장에서 뽑은 번호를 관리자가 입력한 결과를 저장한다.
 *
 * **검증을 먼저 하고, 하나라도 어긋나면 Firestore에 아무것도 쓰지 않는다.** 일부만 저장되면
 * 어떤 번호가 맞는지 알 수 없는 상태로 남는다. 통과한 경우에만 참가자 문서의 drawNumber
 * 한 필드씩을 하나의 배치로 함께 쓴다.
 *
 * 참가자 문서에는 번호만 들어간다 — 그 번호가 어느 자리로 가는지(numberToSlot)는
 * 관리자 전용 private/draw에만 있다.
 */
export async function saveTournamentDrawNumbers(
  tournamentId: string,
  participants: TournamentParticipant[],
  entries: TournamentDrawEntry[],
  clubId = DEFAULT_CLUB_ID,
): Promise<void> {
  const checked = validateDrawEntries(participants.map((p) => p.id), entries)
  if (!checked.ok) throw new TournamentSyncError('validation', checked.message)

  try {
    const batch = writeBatch(db)
    for (const entry of checked.value) {
      batch.update(participantDoc(clubId, tournamentId, entry.participantId), { drawNumber: entry.drawNumber })
    }
    await batch.commit()
  } catch (e) {
    throw toSyncError(e)
  }
}

// ── 대진 확정 ───────────────────────────────────────────────────────

function toMatchDoc(match: TournamentMatch): TournamentMatch {
  return withoutUndefined({ ...match })
}

/**
 * 대진을 확정해 경기 문서 전체를 만든다. **대진 공개 전에는 경기 문서를 만들지 않는다** —
 * 미리 만들어 두면 자리 구조에서 부전승 위치를 역산할 수 있기 때문이다.
 *
 * 경기 전체와 대회 문서의 상태 변경을 하나의 배치로 묶는다. 중간까지만 저장되어
 * "경기 절반만 있는 대진"이 생기는 상태를 만들지 않는다.
 */
export async function confirmTournamentBracket(
  tournamentId: string,
  matches: TournamentMatch[],
  input: { bracketSize: number; at: string },
  clubId = DEFAULT_CLUB_ID,
): Promise<void> {
  if (matches.length === 0) {
    throw new TournamentSyncError('validation', '저장할 경기가 없습니다.')
  }
  try {
    const batch = writeBatch(db)
    for (const match of matches) {
      batch.set(matchDoc(clubId, tournamentId, match.id), toMatchDoc(match))
    }
    batch.update(tournamentDoc(clubId, tournamentId), {
      status: 'bracketFixed',
      bracketSize: input.bracketSize,
      drawConfirmedAt: input.at,
    })
    await batch.commit()
  } catch (e) {
    throw toSyncError(e)
  }
}

export async function fetchTournamentMatches(
  tournamentId: string,
  clubId = DEFAULT_CLUB_ID,
): Promise<TournamentMatch[]> {
  try {
    const snap = await getDocs(matchesCol(clubId, tournamentId))
    return snap.docs.map((d) => d.data() as TournamentMatch)
  } catch (e) {
    throw toSyncError(e)
  }
}

async function loadMatch(
  clubId: string,
  tournamentId: string,
  matchId: string,
): Promise<TournamentMatch> {
  const snap = await getDoc(matchDoc(clubId, tournamentId, matchId))
  if (!snap.exists()) throw new TournamentSyncError('not-found', '경기를 찾을 수 없습니다.')
  return snap.data() as TournamentMatch
}

// ── 대진 확정 취소 ───────────────────────────────────────────────────

/**
 * 실제로 치른 경기가 하나라도 공식 확정됐는지. 부전승은 경기가 아니므로 세지 않는다
 * (대진을 만든 순간부터 official 상태라, 이걸 세면 부전승이 있는 대회는 취소 자체가 불가능해진다).
 */
export function hasOfficialPlayedMatch(matches: TournamentMatch[]): boolean {
  return matches.some((m) => m.status === 'official' && m.resultType !== 'bye')
}

/**
 * 대진 확정을 취소하고 처음부터 다시 진행할 수 있게 되돌린다.
 *
 * 부분 수정을 하지 않는다 — 경기 문서 전체, 관리자 전용 추첨 매핑, 참가자의 추첨번호를
 * **하나의 배치로 함께** 지운다. Firestore는 부모 문서를 지워도 하위 컬렉션을 자동으로
 * 지우지 않으므로(splitFirestore.ts의 deleteSplitSession과 같은 이유) 경기 문서를 하나씩
 * 모아 지운다.
 *
 * 경기가 한 번이라도 공식 확정된 뒤에는 막는다 — 이미 나온 결과가 사라지기 때문이다.
 */
export async function cancelTournamentBracket(
  tournamentId: string,
  clubId = DEFAULT_CLUB_ID,
): Promise<void> {
  try {
    const [matches, participants] = await Promise.all([
      fetchTournamentMatches(tournamentId, clubId),
      fetchTournamentParticipants(tournamentId, clubId),
    ])
    if (hasOfficialPlayedMatch(matches)) {
      throw new TournamentSyncError(
        'blocked',
        '이미 공식 확정된 경기가 있어 대진을 취소할 수 없습니다.',
      )
    }

    const batch = writeBatch(db)
    for (const match of matches) batch.delete(matchDoc(clubId, tournamentId, match.id))
    batch.delete(drawDoc(clubId, tournamentId))
    for (const participant of participants) {
      batch.update(participantDoc(clubId, tournamentId, participant.id), { drawNumber: deleteField() })
    }
    batch.update(tournamentDoc(clubId, tournamentId), {
      status: 'entryClosed',
      bracketSize: deleteField(),
      drawConfirmedAt: deleteField(),
    })
    await batch.commit()
  } catch (e) {
    throw toSyncError(e)
  }
}

// ── 경기 결과: 입력 → 확인 → 관리자 승인 ─────────────────────────────
//
// 아래 함수들은 모두 같은 모양이다: 서버에서 지금 경기를 읽고 → 순수 도메인 함수에 넘겨
// 판정하고 → 그 동작이 실제로 바꾸는 필드만 골라 update한다.
// 클라이언트가 건넨 경기 객체를 그대로 믿고 저장하지 않는다.

/** 참가자 1명이 두 선수의 점수를 입력한다. 이것만으로는 공식 결과가 되지 않는다. */
export async function submitTournamentMatchResult(
  tournamentId: string,
  matchId: string,
  input: { byMemberId: string; scoreA: number | string; scoreB: number | string; at: string },
  clubId = DEFAULT_CLUB_ID,
): Promise<TournamentMatch> {
  try {
    const current = await loadMatch(clubId, tournamentId, matchId)
    const applied = applyResultSubmission(current, input)
    if (!applied.ok) throw new TournamentSyncError('validation', applied.message)

    const next = applied.value
    await updateDoc(matchDoc(clubId, tournamentId, matchId), withoutUndefined({
      scoreA: next.scoreA,
      scoreB: next.scoreB,
      calculatedWinnerParticipantId: next.calculatedWinnerParticipantId ?? null,
      status: next.status,
      resultLog: next.resultLog,
    }))
    return next
  } catch (e) {
    throw toSyncError(e)
  }
}

/** 입력하지 않은 상대가 확인한다. 입력자와 같은 사람이면 도메인 함수가 막는다. */
export async function verifyTournamentMatchResult(
  tournamentId: string,
  matchId: string,
  input: { byMemberId: string; at: string },
  clubId = DEFAULT_CLUB_ID,
): Promise<TournamentMatch> {
  try {
    const current = await loadMatch(clubId, tournamentId, matchId)
    const applied = applyResultVerification(current, input)
    if (!applied.ok) throw new TournamentSyncError('validation', applied.message)

    const next = applied.value
    await updateDoc(matchDoc(clubId, tournamentId, matchId), {
      status: next.status,
      resultLog: next.resultLog,
    })
    return next
  } catch (e) {
    throw toSyncError(e)
  }
}

/** 상대가 "결과가 다르다"고 알린다. 회원이 점수를 직접 고치지는 못한다. */
export async function requestTournamentMatchCorrection(
  tournamentId: string,
  matchId: string,
  input: { byMemberId: string; at: string },
  clubId = DEFAULT_CLUB_ID,
): Promise<TournamentMatch> {
  try {
    const current = await loadMatch(clubId, tournamentId, matchId)
    const applied = applyCorrectionRequest(current, input)
    if (!applied.ok) throw new TournamentSyncError('validation', applied.message)

    const next = applied.value
    await updateDoc(matchDoc(clubId, tournamentId, matchId), { resultLog: next.resultLog })
    return next
  } catch (e) {
    throw toSyncError(e)
  }
}

/** 상대가 확인하지 않을 때 관리자가 직권으로 확인한다. 이것만으로 공식 확정되지는 않는다. */
export async function adminVerifyTournamentMatch(
  tournamentId: string,
  matchId: string,
  input: { adminUid: string; at: string },
  clubId = DEFAULT_CLUB_ID,
): Promise<TournamentMatch> {
  try {
    const current = await loadMatch(clubId, tournamentId, matchId)
    const applied = applyAdminVerification(current, input)
    if (!applied.ok) throw new TournamentSyncError('validation', applied.message)

    const next = applied.value
    await updateDoc(matchDoc(clubId, tournamentId, matchId), {
      status: next.status,
      resultLog: next.resultLog,
    })
    return next
  } catch (e) {
    throw toSyncError(e)
  }
}

/** 수정 요청을 받아 관리자가 점수를 고친다. 관리자 신원은 Firebase UID로만 기록한다(PIN 금지). */
export async function correctTournamentMatchByAdmin(
  tournamentId: string,
  matchId: string,
  input: { adminUid: string; scoreA: number | string; scoreB: number | string; at: string },
  clubId = DEFAULT_CLUB_ID,
): Promise<TournamentMatch> {
  try {
    const current = await loadMatch(clubId, tournamentId, matchId)
    const applied = applyAdminCorrection(current, input)
    if (!applied.ok) throw new TournamentSyncError('validation', applied.message)

    const next = applied.value
    await updateDoc(matchDoc(clubId, tournamentId, matchId), withoutUndefined({
      scoreA: next.scoreA,
      scoreB: next.scoreB,
      calculatedWinnerParticipantId: next.calculatedWinnerParticipantId ?? null,
      status: next.status,
      resultLog: next.resultLog,
    }))
    return next
  } catch (e) {
    throw toSyncError(e)
  }
}

// ── 관리자 최종 승인 + 다음 라운드 진출 (원자적) ───────────────────────

/** 승자를 다음 경기의 A/B 자리에만 쓴다. 반대편 자리 값은 건드리지 않는다. */
function promotionPatch(promotion: TournamentPromotion) {
  return promotion.nextSlot === 'playerA'
    ? {
        playerAParticipantId: promotion.participantId,
        playerAMemberId: promotion.memberId,
        playerAHandicapSnapshot: promotion.handicap,
      }
    : {
        playerBParticipantId: promotion.participantId,
        playerBMemberId: promotion.memberId,
        playerBHandicapSnapshot: promotion.handicap,
      }
}

/**
 * 공식 확정 + 다음 라운드 배치를 **하나의 배치로 묶어** 쓴다.
 *
 * 둘이 따로 저장되면 "승자는 확정됐는데 다음 경기에 아무도 없는" 또는 그 반대의 어긋난
 * 상태가 남는다. writeBatch는 전부 성공하거나 전부 실패하므로 그런 중간 상태가 생기지 않는다.
 *
 * 참가자 2명의 입력·확인만으로는 절대 여기 도달하지 않는다 — 도메인 함수가 상태를 확인한다.
 */
async function commitOfficialResult(
  clubId: string,
  tournamentId: string,
  matchId: string,
  approved: { match: TournamentMatch; promotion: TournamentPromotion | null },
  fields: Record<string, unknown>,
): Promise<TournamentMatch> {
  const batch = writeBatch(db)
  batch.update(matchDoc(clubId, tournamentId, matchId), withoutUndefined(fields))
  if (approved.promotion) {
    batch.update(
      matchDoc(clubId, tournamentId, approved.promotion.nextMatchId),
      promotionPatch(approved.promotion),
    )
  }
  await batch.commit()
  return approved.match
}

/**
 * 관리자 최종 승인. **여기서만** 공식 승자가 생기고 다음 라운드에 승자가 올라간다.
 * 달성률이 같으면 officialWinnerParticipantId를 직접 지정해야 승인된다.
 */
export async function approveTournamentMatch(
  tournamentId: string,
  matchId: string,
  input: { adminUid: string; at: string; officialWinnerParticipantId?: string },
  clubId = DEFAULT_CLUB_ID,
): Promise<TournamentMatch> {
  try {
    const current = await loadMatch(clubId, tournamentId, matchId)
    const applied = applyApproval(current, input)
    if (!applied.ok) throw new TournamentSyncError('validation', applied.message)

    const next = applied.value.match
    return await commitOfficialResult(clubId, tournamentId, matchId, applied.value, {
      status: next.status,
      officialWinnerParticipantId: next.officialWinnerParticipantId ?? null,
      officialLoserParticipantId: next.officialLoserParticipantId ?? null,
      resultLog: next.resultLog,
    })
  } catch (e) {
    throw toSyncError(e)
  }
}

/**
 * 기권 처리(관리자 전용). 가짜 점수를 만들지 않고, 승자만 확정해 다음 라운드로 올린다.
 * 회원 혼자서는 기권승을 확정할 수 없다 — 이 함수는 관리자 UID를 요구한다.
 */
export async function declareTournamentForfeit(
  tournamentId: string,
  matchId: string,
  input: { adminUid: string; at: string; winnerParticipantId: string },
  clubId = DEFAULT_CLUB_ID,
): Promise<TournamentMatch> {
  try {
    const current = await loadMatch(clubId, tournamentId, matchId)
    const applied = applyForfeit(current, input)
    if (!applied.ok) throw new TournamentSyncError('validation', applied.message)

    const next = applied.value.match
    return await commitOfficialResult(clubId, tournamentId, matchId, applied.value, {
      resultType: next.resultType,
      status: next.status,
      officialWinnerParticipantId: next.officialWinnerParticipantId ?? null,
      officialLoserParticipantId: next.officialLoserParticipantId ?? null,
      resultLog: next.resultLog,
    })
  } catch (e) {
    throw toSyncError(e)
  }
}

// ── 공식 결과 정정 보호 ───────────────────────────────────────────────

/**
 * 이미 공식 확정된 경기를 지금 고쳐도 안전한지 서버 상태로 확인한다.
 *
 * 다음 경기가 이미 시작됐으면 막는다 — 승자를 바꾸면 다음 경기에 나가지도 않은 사람의
 * 결과가 남아 대진이 무너지기 때문이다. **뒤 경기를 자동으로 되돌리지 않는다.**
 * 이 함수는 판정만 하고 아무것도 쓰지 않는다.
 */
export async function assertOfficialResultCorrectable(
  tournamentId: string,
  matchId: string,
  clubId = DEFAULT_CLUB_ID,
): Promise<void> {
  try {
    const match = await loadMatch(clubId, tournamentId, matchId)
    const nextMatch = match.nextMatchId
      ? await loadMatch(clubId, tournamentId, match.nextMatchId).catch(() => null)
      : null
    const check = canCorrectOfficialResult(match, nextMatch)
    if (!check.ok) throw new TournamentSyncError('blocked', check.message)
  } catch (e) {
    throw toSyncError(e)
  }
}

// ── 대회 마감 ───────────────────────────────────────────────────────

/**
 * 결승이 공식 확정된 뒤 대회를 마감한다. 우승·준우승·공동 3위는 1단계 순수 함수로 계산한다.
 * 참가자별 최종 순위 저장은 화면 단계에서 필요해지면 추가한다(지금은 대회 문서에만 남긴다).
 */
export async function finishTournament(
  tournamentId: string,
  input: { at: string },
  clubId = DEFAULT_CLUB_ID,
): Promise<void> {
  try {
    const matches = await fetchTournamentMatches(tournamentId, clubId)
    const placements = calculateFinalPlacements(matches)
    if (!placements.championParticipantId) {
      throw new TournamentSyncError('blocked', '결승이 아직 공식 확정되지 않아 대회를 마감할 수 없습니다.')
    }
    await updateDoc(tournamentDoc(clubId, tournamentId), {
      status: 'finished',
      completedAt: input.at,
      championParticipantId: placements.championParticipantId,
      runnerUpParticipantId: placements.runnerUpParticipantId ?? null,
    })
  } catch (e) {
    throw toSyncError(e)
  }
}

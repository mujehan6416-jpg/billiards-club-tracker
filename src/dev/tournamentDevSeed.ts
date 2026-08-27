import type { Tournament, TournamentDrawEntry, TournamentDrawMapping, TournamentMatch, TournamentParticipant } from '../types/tournament'
import type { Member } from '../types'
import { calculateBracketSize, buildEmptyBracket, buildTournamentMatches, tournamentMatchId } from '../logic/tournamentBracket'
import { createDrawMapping, buildSeatsFromDraw } from '../logic/tournamentDraw'
import {
  submitTournamentMatchResult, verifyTournamentMatchResult, adminVerifyTournamentMatchResult,
  requestTournamentMatchCorrection, approveTournamentMatch, applyPromotion, declareTournamentForfeit,
} from '../logic/tournamentMatch'

// 토너먼트 4A·4B(대회 생성·참가 신청·참가자 관리·추첨·대진 확정) 개발 미리보기 전용 가상 데이터.
// 실제 회원 실명·ID·연락처를 전혀 사용하지 않는다 — 기존 dev 픽스처(settlementDevSeed.ts)와
// 같은 이름 체계(가상회원N)를 그대로 쓴다. Firestore를 전혀 건드리지 않는다
// (실제 저장·전송은 DevTournamentPreview.tsx가 전부 컴포넌트 로컬 state로만 시뮬레이션한다).

/** 시드용 결정적 난수 — 매번 같은 미리보기 결과를 보여준다(진짜 추첨과 무관, 화면 확인용). */
function seededRng(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648
    return s / 2147483648
  }
}

/** 개발 미리보기용 가상 회원 16명. 실제 앱의 회원 목록(useApp.members) 자리를 대신한다. */
export function buildTournamentDevMembers(): Member[] {
  return Array.from({ length: 16 }, (_, i) => ({
    id: `dev-tm-${i + 1}`,
    name: `가상회원${i + 1}`,
    handicap: 15 + (i % 8),
    handicapHistory: [{ value: 15 + (i % 8), changedAt: '2026-01-01T00:00:00.000Z' }],
    active: true,
  }))
}

const NOW = '2026-09-01T09:00:00.000Z'

function entered(m: Member, tournamentHandicap?: number): TournamentParticipant {
  return {
    id: m.id,
    memberId: m.id,
    displayNameSnapshot: m.name,
    baseHandicapSnapshot: m.handicap,
    tournamentHandicap: tournamentHandicap ?? m.handicap,
    entryStatus: 'entered',
  }
}

// ── 4A: 참가 신청 중 / 참가자 확정 완료 (기존, 변경 없음) ──────────────

/** 참가 신청 중인 대회 — 참가/불참/미응답이 섞여 있고, 한 명은 대회 핸디를 기본값과 다르게 조정. */
export function buildDraftTournament(): Tournament {
  return {
    id: 'dev-tournament-draft',
    name: '[개발미리보기] 가상 추석맞이 대회',
    date: '2026-09-20',
    timeLimitMinutes: 50,
    status: 'draft',
    createdAt: NOW,
    createdByAdminUid: 'dev-admin-uid',
  }
}

export function buildDraftTournamentParticipants(members: Member[]): TournamentParticipant[] {
  const of = (idx: number) => members[idx]
  const base = (m: Member, entryStatus: TournamentParticipant['entryStatus']): TournamentParticipant => ({
    id: m.id,
    memberId: m.id,
    displayNameSnapshot: m.name,
    baseHandicapSnapshot: m.handicap,
    tournamentHandicap: m.handicap,
    entryStatus,
  })
  return [
    base(of(0), 'entered'),
    base(of(1), 'entered'),
    { ...base(of(2), 'entered'), tournamentHandicap: of(2).handicap - 2 }, // 대회 핸디를 낮춰 조정한 예시
    base(of(3), 'declined'),
    base(of(4), 'noResponse'),
    base(of(5), 'noResponse'),
    {
      ...base(of(6), 'excluded'),
      excludedByAdminUid: 'dev-admin-uid',
      excludedAt: '2026-09-02T10:00:00.000Z',
    },
    base(of(7), 'noResponse'),
    base(of(8), 'noResponse'),
    base(of(9), 'noResponse'),
  ]
}

/** 참가자 확정까지 끝난 대회 — 회원 화면에서 "확정됨" 상태와 대진 대기 안내를 볼 때 쓴다. */
export function buildConfirmedTournament(): Tournament {
  return {
    id: 'dev-tournament-confirmed',
    name: '[개발미리보기] 가상 신년 대회',
    date: '2026-09-10',
    timeLimitMinutes: 60,
    status: 'entryClosed',
    participantCount: 4,
    createdAt: NOW,
    createdByAdminUid: 'dev-admin-uid',
  }
}

export function buildConfirmedTournamentParticipants(members: Member[]): TournamentParticipant[] {
  return [members[0], members[1], members[2], members[3]].map((m) => entered(m))
}

// ── 4B 시나리오 A·B·C: 참가자 확정 완료, 추첨 준비 전 (인원 수별 bracket 확인용) ──────

/** 8명 참가 확정 — 추첨 준비를 누르면 8강(부전승 없음)이 나온다. */
export function buildScenarioA(): { tournament: Tournament; participants: TournamentParticipant[] } {
  const members = buildTournamentDevMembers().slice(0, 8)
  return {
    tournament: {
      id: 'dev-tournament-scenario-a', name: '[개발미리보기] 시나리오A 8명(8강)', date: '2026-10-01',
      timeLimitMinutes: 50, status: 'entryClosed', participantCount: 8, createdAt: NOW,
    },
    participants: members.map((m) => entered(m)),
  }
}

/** 11명 참가 확정 — 추첨 준비를 누르면 16강 + 부전승 5자리가 나온다. */
export function buildScenarioB(): { tournament: Tournament; participants: TournamentParticipant[] } {
  const members = buildTournamentDevMembers().slice(0, 11)
  return {
    tournament: {
      id: 'dev-tournament-scenario-b', name: '[개발미리보기] 시나리오B 11명(16강+부전승5)', date: '2026-10-02',
      timeLimitMinutes: 50, status: 'entryClosed', participantCount: 11, createdAt: NOW,
    },
    participants: members.map((m) => entered(m)),
  }
}

/** 16명 참가 확정 — 추첨 준비를 누르면 16강(부전승 없음)이 나온다. */
export function buildScenarioC(): { tournament: Tournament; participants: TournamentParticipant[] } {
  const members = buildTournamentDevMembers()
  return {
    tournament: {
      id: 'dev-tournament-scenario-c', name: '[개발미리보기] 시나리오C 16명(16강)', date: '2026-10-03',
      timeLimitMinutes: 50, status: 'entryClosed', participantCount: 16, createdAt: NOW,
    },
    participants: members.map((m) => entered(m)),
  }
}

// ── 4B 시나리오 D·E: 추첨 준비 완료, 번호 입력 중/완료 ──────────────────

/**
 * 8명용 비공개 번호↔자리 매핑. 시나리오 D·E는 이미 "추첨 준비"를 마친 상태에서 시작하므로,
 * 실제 흐름(prepareTournamentDraw)이 만들었을 매핑을 미리 계산해 함께 둔다 — 그래야 화면에서
 * 바로 "대진표 확인"을 눌러도 매핑이 없어 실패하지 않는다.
 */
function build8PlayerDrawMapping(): TournamentDrawMapping {
  const mapping = createDrawMapping(8, seededRng(42))
  if (!mapping.ok) throw new Error(mapping.message)
  return mapping.value
}

/** 8명, 추첨 준비까지 끝났고 절반만 번호를 입력한 상태(D) — 나머지 입력 흐름을 확인할 때 쓴다. */
export function buildScenarioD(): { tournament: Tournament; participants: TournamentParticipant[]; drawMapping: TournamentDrawMapping } {
  const members = buildTournamentDevMembers().slice(0, 8)
  const participants = members.map((m) => entered(m))
  participants[0].drawNumber = 3
  participants[1].drawNumber = 7
  participants[2].drawNumber = 1
  return {
    tournament: {
      id: 'dev-tournament-scenario-d', name: '[개발미리보기] 시나리오D 번호 입력 중', date: '2026-10-04',
      timeLimitMinutes: 50, status: 'drawReady', participantCount: 8, createdAt: NOW,
    },
    participants,
    drawMapping: build8PlayerDrawMapping(),
  }
}

/** 8명, 번호 입력까지 전부 끝난 상태(E) — "대진표 확인" 버튼이 활성화되는 것을 볼 때 쓴다. */
export function buildScenarioE(): { tournament: Tournament; participants: TournamentParticipant[]; drawMapping: TournamentDrawMapping } {
  const members = buildTournamentDevMembers().slice(0, 8)
  const participants = members.map((m) => entered(m))
  const order = [3, 7, 1, 5, 2, 8, 4, 6]
  participants.forEach((p, i) => { p.drawNumber = order[i] })
  return {
    tournament: {
      id: 'dev-tournament-scenario-e', name: '[개발미리보기] 시나리오E 번호 입력 완료', date: '2026-10-05',
      timeLimitMinutes: 50, status: 'drawReady', participantCount: 8, createdAt: NOW,
    },
    participants,
    drawMapping: build8PlayerDrawMapping(),
  }
}

// ── 4B 시나리오 G: 대진 확정 완료 ───────────────────────────────────────

/**
 * 11명 참가 · 대진 확정까지 끝난 상태 — 회원 공개 대진표(부전승 포함)와 "대진 확정 취소"
 * 버튼(H)을 함께 확인할 수 있다. 실제 도메인 함수로 만들어서 nextMatchId/nextSlot이
 * 실제 운영과 동일하게 서로 맞물린다.
 */
export function buildScenarioG(): { tournament: Tournament; participants: TournamentParticipant[]; matches: TournamentMatch[] } {
  const members = buildTournamentDevMembers().slice(0, 11)
  const participants = members.map((m) => entered(m))
  const rng = seededRng(2026)

  const size = calculateBracketSize(11)
  if (!size.ok) throw new Error(size.message)
  const mapping = createDrawMapping(11, rng)
  if (!mapping.ok) throw new Error(mapping.message)

  const entries: TournamentDrawEntry[] = participants.map((p, i) => ({ participantId: p.id, drawNumber: i + 1 }))
  participants.forEach((p, i) => { p.drawNumber = i + 1 })

  const bracket = buildEmptyBracket(mapping.value.bracketSize)
  if (!bracket.ok) throw new Error(bracket.message)
  const seats = buildSeatsFromDraw(participants, entries, mapping.value)
  if (!seats.ok) throw new Error(seats.message)
  const matches = buildTournamentMatches(bracket.value, seats.value)
  if (!matches.ok) throw new Error(matches.message)

  return {
    tournament: {
      id: 'dev-tournament-scenario-g', name: '[개발미리보기] 시나리오G 대진 확정 완료', date: '2026-10-06',
      timeLimitMinutes: 50, status: 'bracketFixed', participantCount: 11, bracketSize: size.value.bracketSize,
      drawConfirmedAt: NOW, createdAt: NOW,
    },
    participants,
    matches: matches.value,
  }
}

// ── 4C: 경기 진행(결과 입력 → 확인 → 관리자 승인 → 다음 라운드 진출 → 결승) ─────────

/** 8명, 대진 확정까지 끝난 빈 대진(부전승 없음) — 4C 시나리오들이 이 위에 서로 다른 경기 상태를 얹는다. */
function build8PlayerFixedBracket(id: string, name: string, date: string): {
  tournament: Tournament; participants: TournamentParticipant[]; matches: TournamentMatch[]
} {
  const members = buildTournamentDevMembers().slice(0, 8)
  const participants = members.map((m) => entered(m))
  participants.forEach((p, i) => { p.drawNumber = i + 1 })
  const entries: TournamentDrawEntry[] = participants.map((p, i) => ({ participantId: p.id, drawNumber: i + 1 }))

  const bracket = buildEmptyBracket(8)
  if (!bracket.ok) throw new Error(bracket.message)
  const mapping = createDrawMapping(8, seededRng(7))
  if (!mapping.ok) throw new Error(mapping.message)
  const seats = buildSeatsFromDraw(participants, entries, mapping.value)
  if (!seats.ok) throw new Error(seats.message)
  const matches = buildTournamentMatches(bracket.value, seats.value)
  if (!matches.ok) throw new Error(matches.message)

  return {
    tournament: {
      id, name, date, timeLimitMinutes: 50, status: 'bracketFixed', participantCount: 8, bracketSize: 8,
      drawConfirmedAt: NOW, createdAt: NOW,
    },
    participants,
    matches: matches.value,
  }
}

function findMatch(matches: TournamentMatch[], id: string): TournamentMatch {
  const m = matches.find((x) => x.id === id)
  if (!m) throw new Error(`시드 데이터 오류: ${id} 경기를 찾을 수 없습니다.`)
  return m
}

function replaceMatch(matches: TournamentMatch[], next: TournamentMatch): TournamentMatch[] {
  return matches.map((m) => (m.id === next.id ? next : m))
}

/**
 * A 선수가 확실히 이기는 점수 조합을 그 경기의 실제 적용 핸디에 맞춰 만든다. 참가자별
 * 핸디가 15~22 사이로 서로 다르므로(15 + i%8), 고정 숫자를 쓰면 "입력 점수가 핸디를
 * 초과한다"는 검증에 걸릴 수 있다 — 그래서 항상 그 경기의 핸디를 기준으로 계산한다.
 */
function clearWinScores(match: TournamentMatch): { scoreA: number; scoreB: number } {
  return { scoreA: match.playerAHandicapSnapshot!, scoreB: Math.floor(match.playerBHandicapSnapshot! * 0.6) }
}

/** H: 결과 입력됨, 상대 확인 대기. */
export function buildScenarioH() {
  const built = build8PlayerFixedBracket('dev-tournament-scenario-h', '[개발미리보기] 시나리오H 결과 입력·확인 대기', '2026-10-07')
  const r1m1 = findMatch(built.matches, tournamentMatchId(1, 1))
  const submitted = submitTournamentMatchResult(r1m1, { byMemberId: r1m1.playerAMemberId!, ...clearWinScores(r1m1), at: NOW })
  if (!submitted.ok) throw new Error(submitted.message)
  return { ...built, matches: replaceMatch(built.matches, submitted.value) }
}

/** I: 상대 확인까지 끝남, 관리자 최종 승인 대기(회원 확인). */
export function buildScenarioI() {
  const built = build8PlayerFixedBracket('dev-tournament-scenario-i', '[개발미리보기] 시나리오I 관리자 승인 대기(회원 확인)', '2026-10-08')
  const r1m1 = findMatch(built.matches, tournamentMatchId(1, 1))
  const submitted = submitTournamentMatchResult(r1m1, { byMemberId: r1m1.playerAMemberId!, ...clearWinScores(r1m1), at: NOW })
  if (!submitted.ok) throw new Error(submitted.message)
  const verified = verifyTournamentMatchResult(submitted.value, { byMemberId: r1m1.playerBMemberId!, at: NOW })
  if (!verified.ok) throw new Error(verified.message)
  return { ...built, matches: replaceMatch(built.matches, verified.value) }
}

/** J: 상대가 확인하지 않아 관리자가 직권 확인함, 관리자 최종 승인 대기. */
export function buildScenarioJ() {
  const built = build8PlayerFixedBracket('dev-tournament-scenario-j', '[개발미리보기] 시나리오J 관리자 직권 확인', '2026-10-09')
  const r1m1 = findMatch(built.matches, tournamentMatchId(1, 1))
  const submitted = submitTournamentMatchResult(r1m1, { byMemberId: r1m1.playerAMemberId!, ...clearWinScores(r1m1), at: NOW })
  if (!submitted.ok) throw new Error(submitted.message)
  const adminVerified = adminVerifyTournamentMatchResult(submitted.value, { adminUid: 'dev-admin-uid', at: NOW })
  if (!adminVerified.ok) throw new Error(adminVerified.message)
  return { ...built, matches: replaceMatch(built.matches, adminVerified.value) }
}

/** K: 상대가 "결과가 다르다"며 수정을 요청함 — 관리자 정정이 필요한 상태. */
export function buildScenarioK() {
  const built = build8PlayerFixedBracket('dev-tournament-scenario-k', '[개발미리보기] 시나리오K 수정 요청', '2026-10-10')
  const r1m1 = findMatch(built.matches, tournamentMatchId(1, 1))
  const submitted = submitTournamentMatchResult(r1m1, { byMemberId: r1m1.playerAMemberId!, scoreA: 13, scoreB: 13, at: NOW })
  if (!submitted.ok) throw new Error(submitted.message)
  const corrected = requestTournamentMatchCorrection(submitted.value, { byMemberId: r1m1.playerBMemberId!, at: NOW })
  if (!corrected.ok) throw new Error(corrected.message)
  return { ...built, matches: replaceMatch(built.matches, corrected.value) }
}

/** L: 두 선수의 달성률이 완전히 같음(동률) — 관리자가 직접 승자를 골라야 승인된다. */
export function buildScenarioL() {
  const built = build8PlayerFixedBracket('dev-tournament-scenario-l', '[개발미리보기] 시나리오L 달성률 동률', '2026-10-11')
  const r1m1 = findMatch(built.matches, tournamentMatchId(1, 1))
  // 두 선수의 적용 핸디가 같은 자리(핸디 15+i%8이므로 슬롯 배치에 따라 다를 수 있다)라도,
  // 같은 달성률이 나오도록 핸디 비례로 점수를 맞춘다.
  const handicapA = r1m1.playerAHandicapSnapshot!
  const handicapB = r1m1.playerBHandicapSnapshot!
  const submitted = submitTournamentMatchResult(r1m1, { byMemberId: r1m1.playerAMemberId!, scoreA: handicapA, scoreB: handicapB, at: NOW })
  if (!submitted.ok) throw new Error(submitted.message)
  const verified = verifyTournamentMatchResult(submitted.value, { byMemberId: r1m1.playerBMemberId!, at: NOW })
  if (!verified.ok) throw new Error(verified.message)
  return { ...built, matches: replaceMatch(built.matches, verified.value) }
}

/** 경기를 입력→확인→관리자 최종 승인까지 한 번에 진행시키고(A 선수 승), 결과 목록을 되돌린다. */
function playAndApprove(matches: TournamentMatch[], matchId: string): TournamentMatch[] {
  const m = findMatch(matches, matchId)
  const submitted = submitTournamentMatchResult(m, { byMemberId: m.playerAMemberId!, ...clearWinScores(m), at: NOW })
  if (!submitted.ok) throw new Error(submitted.message)
  const verified = verifyTournamentMatchResult(submitted.value, { byMemberId: m.playerBMemberId!, at: NOW })
  if (!verified.ok) throw new Error(verified.message)
  const approved = approveTournamentMatch(verified.value, { adminUid: 'dev-admin-uid', at: NOW })
  if (!approved.ok) throw new Error(approved.message)
  let next = replaceMatch(matches, approved.value.match)
  if (approved.value.promotion) {
    const nextMatch = findMatch(next, approved.value.promotion.nextMatchId)
    next = replaceMatch(next, applyPromotion(nextMatch, approved.value.promotion))
  }
  return next
}

/** M: 1경기만 관리자 최종 승인 완료 — 4강 한쪽 자리만 채워지고 반대편은 아직 비어 있다. */
export function buildScenarioM() {
  const built = build8PlayerFixedBracket('dev-tournament-scenario-m', '[개발미리보기] 시나리오M 4강 한쪽만 확정', '2026-10-12')
  const matches = playAndApprove(built.matches, tournamentMatchId(1, 1))
  return { ...built, matches }
}

/** N: 4강 두 자리 모두 채워진 정상 대진(한쪽은 승인, 한쪽은 기권승) — 바로 다음 경기를 치를 수 있다. */
export function buildScenarioN() {
  const built = build8PlayerFixedBracket('dev-tournament-scenario-n', '[개발미리보기] 시나리오N 4강 양쪽 확정', '2026-10-13')
  let matches = playAndApprove(built.matches, tournamentMatchId(1, 1))

  const r1m2 = findMatch(matches, tournamentMatchId(1, 2))
  const forfeited = declareTournamentForfeit(r1m2, { adminUid: 'dev-admin-uid', at: NOW, winnerParticipantId: r1m2.playerAParticipantId! })
  if (!forfeited.ok) throw new Error(forfeited.message)
  matches = replaceMatch(matches, forfeited.value.match)
  if (forfeited.value.promotion) {
    const next = findMatch(matches, forfeited.value.promotion.nextMatchId)
    matches = replaceMatch(matches, applyPromotion(next, forfeited.value.promotion))
  }

  return { ...built, matches }
}

/** O: 모든 라운드가 공식 확정되어 대회가 종료된 상태 — 우승·준우승·공동 3위 화면을 확인할 때 쓴다. */
export function buildScenarioO() {
  const built = build8PlayerFixedBracket('dev-tournament-scenario-o', '[개발미리보기] 시나리오O 대회 종료', '2026-10-14')
  let matches = built.matches

  // 라운드1(4경기) → 항상 A 선수 승리로 확정하며 순서대로 진행한다.
  for (let i = 1; i <= 4; i++) matches = playAndApprove(matches, tournamentMatchId(1, i))
  // 라운드2(4강, 2경기)
  for (let i = 1; i <= 2; i++) matches = playAndApprove(matches, tournamentMatchId(2, i))
  // 결승
  matches = playAndApprove(matches, tournamentMatchId(3, 1))

  return {
    ...built,
    tournament: {
      ...built.tournament, status: 'finished' as const, completedAt: NOW,
      championParticipantId: findMatch(matches, tournamentMatchId(3, 1)).officialWinnerParticipantId ?? null,
      runnerUpParticipantId: findMatch(matches, tournamentMatchId(3, 1)).officialLoserParticipantId ?? null,
    },
    matches,
  }
}

import type { Tournament, TournamentDrawEntry, TournamentDrawMapping, TournamentMatch, TournamentParticipant } from '../types/tournament'
import type { Member } from '../types'
import { calculateBracketSize, buildEmptyBracket, buildTournamentMatches } from '../logic/tournamentBracket'
import { createDrawMapping, buildSeatsFromDraw } from '../logic/tournamentDraw'

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

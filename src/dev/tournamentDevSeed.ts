import type { Tournament, TournamentParticipant } from '../types/tournament'
import type { Member } from '../types'

// 토너먼트 4A(대회 생성·참가 신청·참가자 관리) 개발 미리보기 전용 가상 데이터.
// 실제 회원 실명·ID·연락처를 전혀 사용하지 않는다 — 기존 dev 픽스처(settlementDevSeed.ts)와
// 같은 이름 체계(가상회원N)를 그대로 쓴다. Firestore를 전혀 건드리지 않는다
// (실제 저장·전송은 DevTournamentPreview.tsx가 전부 컴포넌트 로컬 state로만 시뮬레이션한다).

/** 개발 미리보기용 가상 회원 10명. 실제 앱의 회원 목록(useApp.members) 자리를 대신한다. */
export function buildTournamentDevMembers(): Member[] {
  return Array.from({ length: 10 }, (_, i) => ({
    id: `dev-tm-${i + 1}`,
    name: `가상회원${i + 1}`,
    handicap: 15 + i,
    handicapHistory: [{ value: 15 + i, changedAt: '2026-01-01T00:00:00.000Z' }],
    active: true,
  }))
}

const NOW = '2026-09-01T09:00:00.000Z'

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
  const of = (idx: number) => members[idx]
  const entered = (m: Member): TournamentParticipant => ({
    id: m.id,
    memberId: m.id,
    displayNameSnapshot: m.name,
    baseHandicapSnapshot: m.handicap,
    tournamentHandicap: m.handicap,
    entryStatus: 'entered',
  })
  return [of(0), of(1), of(2), of(3)].map(entered)
}

import type { Game, LineupMatch, Session } from '../types'
import type { RegularSettlement } from '../types/settlement'
import { buildScenarioCMembers } from './settlementDevSeed'

// 모임(경기결과·재매칭)·일반회원 정산공개 개발 미리보기 전용 가상 데이터.
// 실제 회원 실명·ID·연락처를 전혀 사용하지 않는다 — settlementDevSeed.ts의 가상회원(가상회원1~8,
// buildScenarioCMembers)을 그대로 재사용해 이름 체계를 하나로 유지한다.
// 이 파일은 순수 데이터만 만들고 useApp/useSettlementStore/Firestore를 전혀 건드리지 않는다
// (실제 저장·전송은 DevMeetingPreview.tsx가 전부 컴포넌트 로컬 state로만 시뮬레이션한다).

export const devMeetingMembers = buildScenarioCMembers()

/** 일반회원 확정 정산 공개 확인용 가상 세션 — 대진 결과 아래 "정산 결과" 카드가 뜨는지 볼 때 쓴다. */
export function buildConfirmedSettlementSession(): Session {
  return { id: 'dev-meeting-confirmed', date: '2026-06-01', type: 'regular', attendeeIds: ['dev-mem-1', 'dev-mem-2'], games: [] }
}

export function buildDraftSettlementSession(): Session {
  return { id: 'dev-meeting-draft', date: '2026-06-08', type: 'regular', attendeeIds: ['dev-mem-1', 'dev-mem-2'], games: [] }
}

export function buildNoSettlementSession(): Session {
  return { id: 'dev-meeting-none', date: '2026-06-15', type: 'regular', attendeeIds: ['dev-mem-1', 'dev-mem-2'], games: [] }
}

const nowIso = new Date().toISOString()

/** 확정된 정산 — buildConfirmedSettlementSession()과 sessionId로 연결. 일반회원 화면에 표시돼야 한다. */
export function buildConfirmedSettlementForMeeting(): RegularSettlement {
  return {
    id: 'dev-meeting-settle-confirmed',
    sessionId: 'dev-meeting-confirmed',
    meetingName: '[개발미리보기] 가상 경기결과 검토 모임',
    meetingDate: '2026-06-01',
    meetingType: 'regular',
    status: 'confirmed',
    participants: [
      { id: 'dev-p1', participantType: 'guest', memberId: null, displayName: '가상참가자1', addedVia: 'meeting_attendee', dues: { amount: 30000, method: '현금', status: '입금확인' } },
      { id: 'dev-p2', participantType: 'guest', memberId: null, displayName: '가상참가자2', addedVia: 'meeting_attendee', dues: { amount: 30000, method: '계좌이체', status: '입금확인' } },
    ],
    expenses: [
      { id: 'dev-me1', date: '2026-06-01', label: '당구장 대관료', category: '당구비', amount: 40000, method: '현금', clubShare: 40000, personalDonation: 0 },
    ],
    dinnerContributions: [],
    cashDeposits: [],
    prevBankBalance: 0,
    otherBankAdjustment: 0,
    createdAt: nowIso,
    confirmedAt: nowIso,
    version: 1,
    revisionLog: [{ fromStatus: 'draft', toStatus: 'confirmed', changedAt: nowIso, actorDisplayName: '개발미리보기', reason: '가상 데이터 시드' }],
  }
}

/** draft 상태 정산 — buildDraftSettlementSession()과 연결. 일반회원 화면에는 표시되면 안 된다. */
export function buildDraftSettlementForMeeting(): RegularSettlement {
  return {
    id: 'dev-meeting-settle-draft',
    sessionId: 'dev-meeting-draft',
    meetingName: '[개발미리보기] 가상 재매칭 확인 모임',
    meetingDate: '2026-06-08',
    meetingType: 'regular',
    status: 'draft',
    participants: [],
    expenses: [],
    dinnerContributions: [],
    cashDeposits: [],
    prevBankBalance: 0,
    otherBankAdjustment: 0,
    createdAt: nowIso,
    version: 1,
    revisionLog: [{ fromStatus: 'draft', toStatus: 'draft', changedAt: nowIso, actorDisplayName: '개발미리보기', reason: '가상 데이터 시드' }],
  }
}

/** 경기결과 검토용 초기 대진(라운드별 고정 매치업). 참가자는 전부 devMeetingMembers(가상회원1~4)만 쓴다. */
export function buildDemoLineup(): LineupMatch[] {
  return [
    { round: 1, aId: 'dev-mem-1', bId: 'dev-mem-2', handicapA: 18, handicapB: 20 },
    { round: 1, aId: 'dev-mem-3', bId: 'dev-mem-4', handicapA: 19, handicapB: 21 },
    { round: 2, aId: 'dev-mem-1', bId: 'dev-mem-3', handicapA: 18, handicapB: 19 },
    { round: 2, aId: 'dev-mem-2', bId: 'dev-mem-4', handicapA: 20, handicapB: 21 },
  ]
}

/**
 * 초기 경기결과 상태(실제 Game 타입을 그대로 써서 logic/matching.ts의 canRematchRound 등
 * 운영 순수 함수를 미리보기에서도 그대로 재사용할 수 있게 한다):
 * - 1라운드 가상회원1 vs 가상회원2: 아직 결과 없음 → 가상회원1로 보면 결과 입력 폼이 보여야 한다.
 * - 1라운드 가상회원3 vs 가상회원4: 관리자 확인 대기(pending) → 관리자 화면에서 확인완료/수정요청 대상.
 * - 2라운드 가상회원1 vs 가상회원3: 관리자가 수정 요청함(pending+revisionRequested) → 가상회원1이 다시 입력 가능해야 한다.
 * - 2라운드 가상회원2 vs 가상회원4: 확인 완료(pending 아님) → 완료된 경기로 표시, 재매칭 차단 사유가 된다.
 * 이 상태만으로 1·2라운드 모두 "결과가 있어 재매칭 차단" 상태가 되므로, 미리보기 화면의
 * "결과 초기화" 버튼으로 games를 비우면 두 라운드 모두 재매칭 가능 상태로 바뀌는 것도 볼 수 있다.
 */
export function buildInitialDemoGames(): Game[] {
  return [
    { id: 'dev-g1', playerAId: 'dev-mem-3', playerBId: 'dev-mem-4', handicapA: 19, handicapB: 21, scoreA: 15, scoreB: 10, endType: 'time', playedAt: nowIso, round: 1, pending: true },
    { id: 'dev-g2', playerAId: 'dev-mem-1', playerBId: 'dev-mem-3', handicapA: 18, handicapB: 19, scoreA: 12, scoreB: 9, endType: 'time', playedAt: nowIso, round: 2, pending: true, revisionRequested: true },
    { id: 'dev-g3', playerAId: 'dev-mem-2', playerBId: 'dev-mem-4', handicapA: 20, handicapB: 21, scoreA: 20, scoreB: 14, endType: 'cleared', playedAt: nowIso, round: 2, pending: false },
  ]
}

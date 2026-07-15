import type { Member, Session } from '../types'
import type { RegularSettlement } from '../types/settlement'

// 개발 미리보기 전용 가상 데이터. 실제 회원 실명·ID·금액을 전혀 사용하지 않는다.
// 시나리오 A/B의 참가자는 participantType: 'guest' (memberId: null)로 만들어 실제 회원명부와 완전히 분리한다.
// 시나리오 C는 Member/Session 연결 흐름 자체를 검증하기 위한 것이라, 실제 appStore와는
// 별개인 가상 Member[]/Session 객체를 만들어 컴포넌트에 props로 주입한다 (실제 회원명부 미사용·미수정).

const nowIso = new Date().toISOString()

function guest(name: string, overrides: Partial<RegularSettlement['participants'][number]> = {}) {
  return {
    id: `dev-${name}`,
    participantType: 'guest' as const,
    memberId: null,
    displayName: name,
    addedVia: 'meeting_attendee' as const,
    ...overrides,
  }
}

/** 시나리오 A: 일반 정기모임 — 회비 현금/계좌이체 혼합, 계좌이체 미확인 1건, 찬조자 2명, 1차 회식비 전액찬조, 현금 일부 통장입금. */
export function buildScenarioA(): RegularSettlement {
  return {
    id: 'dev-scenario-a',
    meetingName: '[개발미리보기] 가상 27차 정기모임',
    meetingDate: '2026-02-07',
    meetingType: 'regular',
    status: 'draft',
    participants: [
      guest('가상참석자1', { dues: { amount: 30000, method: '현금', status: '입금확인' } }),
      guest('가상참석자2', { dues: { amount: 30000, method: '계좌이체', status: '입금확인' }, donation: { amount: 20000, method: '현금', status: '입금확인' } }),
      guest('가상참석자3', { dues: { amount: 30000, method: '계좌이체', status: '미확인' } }),
      guest('가상참석자4', { dues: { amount: 30000, method: '현금', status: '입금확인' } }),
      guest('가상참석자5', { dues: { amount: 30000, method: '현금', status: '입금확인' } }),
      guest('가상참석자6', { dues: { amount: 30000, method: '계좌이체', status: '입금확인' }, donation: { amount: 30000, method: '계좌이체', status: '입금확인' } }),
      guest('가상비회원1', { addedVia: 'manually_added_guest', dues: { amount: 30000, method: '현금', status: '입금확인' } }),
    ],
    expenses: [
      { id: 'dev-e1', date: '2026-02-07', label: '당구장 대관료', category: '대관비', amount: 100000, method: '체크카드', clubShare: 100000, personalDonation: 0 },
      { id: 'dev-e2', date: '2026-02-07', label: '음료수', category: '음료수비', amount: 20000, method: '현금', clubShare: 20000, personalDonation: 0 },
      { id: 'dev-e3', date: '2026-02-07', label: '상품비', category: '상품비', amount: 15000, method: '계좌이체', clubShare: 15000, personalDonation: 0 },
    ],
    dinnerContributions: [
      {
        id: 'dev-d1', dinnerRound: 1, totalAmount: 200000, method: '현금', clubShare: 0, contributionType: '전액찬조',
        contributors: [{ name: '가상참석자4', memberId: null, amount: 200000, title: '회장님' }],
      },
    ],
    cashDeposits: [
      { id: 'dev-c1', depositDate: '2026-02-08', amount: 80000, status: '입금확인', note: '일부만 통장 입금' },
    ],
    prevBankBalance: 500000,
    otherBankAdjustment: 0,
    createdAt: nowIso,
    version: 1,
    revisionLog: [{ fromStatus: 'draft', toStatus: 'draft', changedAt: nowIso, actorDisplayName: '개발미리보기', reason: '가상 데이터 시드' }],
  }
}

/** 시나리오 B: 정기대회 — 찬조자 이름+금액 표시, 1차/2차 회식비 각각 다른 찬조자. */
export function buildScenarioB(): RegularSettlement {
  return {
    id: 'dev-scenario-b',
    meetingName: '[개발미리보기] 가상 하계 정기대회',
    meetingDate: '2026-08-15',
    meetingType: 'tournament',
    status: 'draft',
    participants: [
      guest('가상대회참석자1', { dues: { amount: 20000, method: '현금', status: '입금확인' }, donation: { amount: 500000, method: '계좌이체', status: '입금확인' } }),
      guest('가상대회참석자2', { dues: { amount: 20000, method: '현금', status: '입금확인' }, donation: { amount: 300000, method: '현금', status: '입금확인' } }),
      guest('가상대회참석자3', { dues: { amount: 20000, method: '현금', status: '입금확인' }, donation: { amount: 100000, method: '계좌이체', status: '입금확인' } }),
      guest('가상대회참석자4', { dues: { amount: 20000, method: '현금', status: '입금확인' } }),
      guest('가상대회참석자5', { dues: { amount: 20000, method: '현금', status: '입금확인' } }),
    ],
    expenses: [
      { id: 'dev-e4', date: '2026-08-15', label: '대회 상금', category: '상금', amount: 200000, method: '현금', clubShare: 200000, personalDonation: 0 },
      { id: 'dev-e5', date: '2026-08-15', label: '트로피/상품', category: '상품비', amount: 50000, method: '체크카드', clubShare: 50000, personalDonation: 0 },
      { id: 'dev-e6', date: '2026-08-15', label: '대관비', category: '대관비', amount: 100000, method: '계좌이체', clubShare: 100000, personalDonation: 0 },
    ],
    dinnerContributions: [
      {
        id: 'dev-d2', dinnerRound: 1, totalAmount: 150000, method: '현금', clubShare: 0, contributionType: '전액찬조',
        contributors: [{ name: '가상대회참석자1', memberId: null, amount: 150000, title: '회장님' }],
      },
      {
        id: 'dev-d3', dinnerRound: 2, totalAmount: 100000, method: '현금', clubShare: 0, contributionType: '전액찬조',
        contributors: [{ name: '가상대회참석자2', memberId: null, amount: 100000, title: '회원님' }],
      },
    ],
    cashDeposits: [
      { id: 'dev-c2', depositDate: '2026-08-16', amount: 100000, status: '입금확인' },
    ],
    prevBankBalance: 300000,
    otherBankAdjustment: 0,
    createdAt: nowIso,
    version: 1,
    revisionLog: [{ fromStatus: 'draft', toStatus: 'draft', changedAt: nowIso, actorDisplayName: '개발미리보기', reason: '가상 데이터 시드' }],
  }
}

// ────────────────────────────────────────────────────────────
// 시나리오 C: Member/Session 연결 흐름 검증용 가상 데이터
// (실제 useApp 회원명부·모임과 완전히 분리된 별도 객체 — 컴포넌트에 props로만 주입한다)
// ────────────────────────────────────────────────────────────

/** 가상 회원 8명. 실제 회원명부(SEED_MEMBERS)와 무관한 별도 객체. */
export function buildScenarioCMembers(): Member[] {
  return Array.from({ length: 8 }, (_, i) => ({
    id: `dev-mem-${i + 1}`,
    name: `가상회원${i + 1}`,
    handicap: 15 + i,
    handicapHistory: [{ value: 15 + i, changedAt: '2026-01-01T00:00:00.000Z' }],
    active: true,
  }))
}

/** 가상 정기모임 세션 1건. 8명 중 5명만 참석자로 등록(가상회원1~5), 6~8은 미참석. */
export function buildScenarioCSession(): Session {
  return {
    id: 'dev-session-c1',
    date: '2026-03-01',
    type: 'regular',
    attendeeIds: ['dev-mem-1', 'dev-mem-2', 'dev-mem-3', 'dev-mem-4', 'dev-mem-5'],
    games: [],
  }
}

/** 참석 기록이 없는(0명) 가상 세션 — "참석 기록 없음" 안내 문구를 UI에서 직접 검증할 때 쓴다. */
export function buildScenarioCEmptySession(): Session {
  return { id: 'dev-session-c-empty', date: '2026-04-01', type: 'regular', attendeeIds: [], games: [] }
}

/**
 * 탈퇴·삭제된 회원(가상회원8과 회원명부에 아예 없는 유령 ID)이 섞인 가상 세션 —
 * "이름 확인 필요" 표시를 UI에서 직접 검증할 때 쓴다. buildScenarioCMembers()는 8명까지만
 * 만들므로 'dev-mem-999-ghost'는 일부러 그 목록에 없는 ID다.
 */
export function buildScenarioCGhostSession(): Session {
  return {
    id: 'dev-session-c-ghost',
    date: '2026-05-01',
    type: 'regular',
    attendeeIds: ['dev-mem-1', 'dev-mem-999-ghost'],
    games: [],
  }
}

/** 시나리오 C 정산: 참가자 0명으로 시작 — 화면에서 "참석자 자동 불러오기"를 직접 눌러 검증한다. */
export function buildScenarioC(): RegularSettlement {
  return {
    id: 'dev-scenario-c',
    meetingName: '[개발미리보기] 가상 Member·Session 연결 검증',
    meetingDate: '2026-03-01',
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

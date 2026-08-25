import type { AppState, Game, LedgerRecord, Member, Session } from '../../src/types'

// 마이그레이션 검증용 가상 데이터. 실제 회원 이름·경기 기록을 쓰지 않는다.
// 실제 운영 데이터는 이 테스트에서 전혀 읽지 않는다.

function member(i: number, over: Partial<Member> = {}): Member {
  return {
    id: `member-${i}`,
    name: `테스트회원${i}`,
    handicap: 15 + (i % 15),
    handicapHistory: [
      { value: 15 + (i % 15), changedAt: '2026-01-01T00:00:00.000Z', source: 'admin' },
      { value: 16 + (i % 15), changedAt: '2026-04-01T00:00:00.000Z', prev: 15 + (i % 15), source: 'csv' },
    ],
    active: i % 7 !== 0, // 일부는 비활성
    password: `pw${i}${i}${i}${i}`, // 새 구조로 넘어가면 안 되는 값
    ...over,
  }
}

function game(sessionIndex: number, i: number, over: Partial<Game> = {}): Game {
  const a = (i % 10) + 1
  const b = ((i + 3) % 10) + 1
  return {
    id: `game-s${sessionIndex}-${i}`,
    playerAId: `member-${a}`,
    playerBId: `member-${b}`,
    handicapA: 18 + (i % 5),
    handicapB: 20 + (i % 4),
    scoreA: 10 + (i % 8),
    scoreB: 12 + (i % 6),
    endType: i % 3 === 0 ? 'cleared' : 'time',
    playedAt: `2026-0${(sessionIndex % 9) + 1}-15T1${i % 8}:00:00.000Z`,
    round: (i % 2) + 1,
    ...over,
  }
}

function session(i: number): Session {
  const gameCount = 4 + (i % 5)
  return {
    id: `session-${i}`,
    date: `2026-0${(i % 9) + 1}-15`,
    type: i % 6 === 0 ? 'flash' : 'regular',
    approved: i % 6 === 0 ? i % 12 === 0 : undefined,
    attendeeIds: Array.from({ length: 8 }, (_, k) => `member-${k + 1}`),
    lineup: [{ round: 1, aId: 'member-1', bId: 'member-2', handicapA: 20, handicapB: 22 }],
    round1ParticipantIds: ['member-1', 'member-2', 'member-3', 'member-4'],
    round2ParticipantIds: ['member-1', 'member-3'],
    games: Array.from({ length: gameCount }, (_, k) => game(i, k)),
  }
}

function ledgerRecord(i: number): LedgerRecord {
  return {
    id: `ledger-${i}`,
    date: `2026-0${(i % 9) + 1}-20`,
    note: i % 4 === 0 ? `가상 메모 ${i}` : undefined,
    inCashMembership: 10000 * (i % 5),
    inCashDonation: 0,
    inTransferMembership: 20000 * (i % 3),
    inTransferDonation: 5000 * (i % 2),
    inCardDonation: 0,
    inAnnualFee: i % 12 === 0 ? 120000 : 0,
    outCash: 3000 * (i % 4),
    outCard: 15000 * (i % 2),
    outTransfer: 0,
  }
}

/**
 * 실제 운영 규모와 비슷한 형태의 가상 AppState.
 * 회원 24명 / 모임 18개 / 경기 다수 / 회계 32건 — 실제 값이 아니라 구조 검증용이다.
 */
export function makeLegacyAppState(): AppState {
  const members = Array.from({ length: 24 }, (_, i) => member(i + 1))
  // 특이 케이스를 섞는다: 동명이인 구분정보, 명시적 승자(과거 CSV 임포트), 승인 대기 경기
  members[5] = member(6, { displayTag: '90학번 · 경영' })
  members[6] = member(7, { displayTag: '02학번 · 전자', password: undefined })

  const sessions = Array.from({ length: 18 }, (_, i) => session(i + 1))
  sessions[0].games[0] = game(1, 0, { winnerId: 'member-1' })       // 명시적 승자
  sessions[0].games[1] = game(1, 1, { winnerId: null })              // 무승부 확정
  sessions[1].games[0] = game(2, 0, { pending: true })               // 승인 대기
  sessions[1].games[1] = game(2, 1, { pending: true, revisionRequested: true })

  return {
    members,
    sessions,
    settings: { lastBackupAt: '2026-08-20T10:00:00.000Z' },
    ledger: Array.from({ length: 32 }, (_, i) => ledgerRecord(i + 1)),
  }
}

/** 비밀번호를 뺀 회원 — legacy와 새 구조를 비교할 때 쓴다. */
export function withoutPassword(m: Member): Omit<Member, 'password'> {
  const copy = { ...m }
  delete copy.password
  return copy
}

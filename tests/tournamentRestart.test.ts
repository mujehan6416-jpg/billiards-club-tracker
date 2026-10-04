import { describe, it, expect } from 'vitest'
import {
  restartCandidates, restartTargetState, planRestartTransfer, isAlreadyInTarget,
} from '../src/logic/tournamentRestart'
import type { Tournament, TournamentMatch, TournamentMatchStatus, TournamentParticipant } from '../src/types/tournament'

// 가상 데이터만 사용한다 — 실제 회원 이름·ID·운영 데이터를 쓰지 않는다.

function participant(n: number, over: Partial<TournamentParticipant> = {}): TournamentParticipant {
  return {
    id: `p${n}`, memberId: `m${n}`, displayNameSnapshot: `가상선수${n}`,
    baseHandicapSnapshot: 20, tournamentHandicap: 20, entryStatus: 'entered', ...over,
  }
}
const people = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => participant(n))

function match(id: string, a: number, b: number, status: TournamentMatchStatus, loser?: number, over: Partial<TournamentMatch> = {}): TournamentMatch {
  const official = status === 'official'
  return {
    id, roundNumber: 1, playerCountInRound: 8, matchNumber: 1,
    playerAParticipantId: `p${a}`, playerBParticipantId: `p${b}`, playerAMemberId: `m${a}`, playerBMemberId: `m${b}`,
    playerAHandicapSnapshot: 20, playerBHandicapSnapshot: 20,
    scoreA: status === 'awaitingResult' ? null : 20, scoreB: status === 'awaitingResult' ? null : 10,
    resultType: 'normal', status, nextMatchId: null, nextSlot: null,
    ...(official && loser ? { officialWinnerParticipantId: `p${loser === a ? b : a}`, officialLoserParticipantId: `p${loser}` } : {}),
    ...over,
  }
}

function tournament(id: string, status: Tournament['status']): Tournament {
  return { id, name: `가상 대회 ${id}`, date: '2026-10-05', timeLimitMinutes: 50, status, createdAt: '2026-10-01T00:00:00.000Z' }
}

describe('restartCandidates — 후보 판정', () => {
  it('최종 승인(official)된 경기의 패자가 후보가 된다', () => {
    const list = restartCandidates([match('a', 1, 2, 'official', 2)], people)
    expect(list).toEqual([{ memberId: 'm2', participantId: 'p2', name: '가상선수2' }])
  })

  it('승인 대기·확인 대기 경기의 패자는 후보가 아니다', () => {
    const list = restartCandidates([
      match('a', 1, 2, 'awaitingApproval', undefined, { calculatedWinnerParticipantId: 'p1' }),
      match('b', 3, 4, 'awaitingVerification'),
    ], people)
    expect(list).toEqual([])
  })

  it('아직 치르지 않은 경기(점수 없음)는 후보가 아니다', () => {
    expect(restartCandidates([match('a', 1, 2, 'awaitingResult')], people)).toEqual([])
  })

  it('부전승은 후보가 아니다', () => {
    const bye = match('a', 1, 2, 'official', undefined, { resultType: 'bye', playerBParticipantId: null })
    expect(restartCandidates([bye], people)).toEqual([])
  })

  it('기권으로 확정된 경기의 기권자는 후보가 된다', () => {
    const forfeit = match('a', 1, 2, 'official', 2, { resultType: 'forfeit', scoreA: null, scoreB: null })
    expect(restartCandidates([forfeit], people).map((c) => c.memberId)).toEqual(['m2'])
  })

  it('같은 회원이 여러 경기의 패자여도 회원 ID 기준으로 한 번만 나온다(이름이 같아도 다른 회원은 따로)', () => {
    const twin = [...people, participant(9, { displayNameSnapshot: '가상선수2' })]
    const list = restartCandidates([
      match('a', 1, 2, 'official', 2),
      match('b', 2, 3, 'official', 2, { id: 'b' }),
      match('c', 4, 9, 'official', 9),
    ], twin)
    expect(list.map((c) => c.memberId)).toEqual(['m2', 'm9'])
  })

  it('현재 대회 참가자 목록에 없는 패자는 후보에서 제외한다', () => {
    expect(restartCandidates([match('a', 1, 2, 'official', 2)], [people[0]])).toEqual([])
  })

  it('결과가 정정돼 패자가 바뀌면 후보도 그에 맞게 바뀐다(호출 시점 데이터 기준)', () => {
    expect(restartCandidates([match('a', 1, 2, 'official', 2)], people).map((c) => c.memberId)).toEqual(['m2'])
    expect(restartCandidates([match('a', 1, 2, 'official', 1)], people).map((c) => c.memberId)).toEqual(['m1'])
  })
})

describe('restartTargetState — 대상 대회', () => {
  it('현재 대회 자신은 고를 수 없다', () => {
    expect(restartTargetState(tournament('t1', 'draft'), 't1').selectable).toBe(false)
  })
  it('종료된 대회는 고를 수 없다', () => {
    expect(restartTargetState(tournament('t2', 'finished'), 't1').selectable).toBe(false)
    expect(restartTargetState(tournament('t2', 'cancelled'), 't1').selectable).toBe(false)
  })
  it('대진이 확정된 대회는 고를 수 없고 안내 문구가 나온다', () => {
    const s = restartTargetState(tournament('t2', 'bracketFixed'), 't1')
    expect(s.selectable).toBe(false)
    expect(s.reason).toBe('이미 대진이 확정된 대회에는 참가자를 추가할 수 없습니다.')
  })
  it('참가자가 이미 확정된 대회(대진 전)도 고를 수 없다', () => {
    expect(restartTargetState(tournament('t2', 'entryClosed'), 't1').selectable).toBe(false)
    expect(restartTargetState(tournament('t2', 'drawReady'), 't1').selectable).toBe(false)
  })
  it('참가 신청 중인 다른 대회는 고를 수 있다 — 이름에 "리스타트"가 없어도 마찬가지', () => {
    expect(restartTargetState(tournament('t2', 'draft'), 't1')).toEqual({ selectable: true })
  })
})

describe('planRestartTransfer — 중복 참가 방지', () => {
  const target = [
    participant(1, { id: 'q1', entryStatus: 'entered' }),
    participant(2, { id: 'q2', entryStatus: 'noResponse' }),
    participant(3, { id: 'q3', entryStatus: 'declined' }),
  ]
  it('이미 참가 상태인 회원은 건너뛰고, 미응답·불참·문서 없는 회원은 추가 대상이다', () => {
    expect(planRestartTransfer(['m1', 'm2', 'm3', 'm7'], target)).toEqual({ toAdd: ['m2', 'm3', 'm7'], alreadyIn: ['m1'] })
  })
  it('같은 회원이 선택에 두 번 들어와도 한 번만 센다', () => {
    expect(planRestartTransfer(['m2', 'm2'], target).toAdd).toEqual(['m2'])
  })
  it('아무도 선택하지 않으면 추가 대상이 없다', () => {
    expect(planRestartTransfer([], target)).toEqual({ toAdd: [], alreadyIn: [] })
  })
  it('isAlreadyInTarget은 참가(entered) 상태만 참가 중으로 본다', () => {
    expect(isAlreadyInTarget('m1', target)).toBe(true)
    expect(isAlreadyInTarget('m2', target)).toBe(false)
  })
})

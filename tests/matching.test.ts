import { describe, it, expect } from 'vitest'
import { pairKey, buildMeetCount, recommendNext, matchAll } from '../src/logic/matching'
import type { Game, Session } from '../src/types'

function game(a: string, b: string): Game {
  return {
    id: a + b,
    playerAId: a,
    playerBId: b,
    handicapA: 20,
    handicapB: 20,
    scoreA: 1,
    scoreB: 0,
    endType: 'time',
    playedAt: '',
  }
}

describe('pairKey', () => {
  it('순서 무관 동일 키', () => {
    expect(pairKey('A', 'B')).toBe(pairKey('B', 'A'))
  })
})

describe('buildMeetCount', () => {
  it('누적 맞대결 횟수 집계', () => {
    const sessions: Session[] = [
      {
        id: 's1',
        date: '2026-06-01',
        attendeeIds: ['A', 'B', 'C'],
        games: [game('A', 'B'), game('A', 'B'), game('A', 'C')],
      },
    ]
    const m = buildMeetCount(sessions)
    expect(m.get(pairKey('A', 'B'))).toBe(2)
    expect(m.get(pairKey('A', 'C'))).toBe(1)
  })
})

describe('recommendNext', () => {
  it('가장 안 만난 짝 우선', () => {
    const meetCount = new Map([
      [pairKey('A', 'B'), 3],
      [pairKey('A', 'C'), 0],
    ])
    const p = recommendNext({ waitingIds: ['A', 'B', 'C'], meetCount, todayGameCount: new Map(), rng: () => 0.5 })
    expect(pairKey(p!.aId, p!.bId)).toBe(pairKey('A', 'C'))
  })
  it('맞대결 같으면 오늘 적게 친 사람 우선', () => {
    const meetCount = new Map<string, number>()
    const today = new Map([
      ['A', 2],
      ['B', 0],
      ['C', 0],
    ])
    const p = recommendNext({ waitingIds: ['A', 'B', 'C'], meetCount, todayGameCount: today, rng: () => 0.5 })
    expect(pairKey(p!.aId, p!.bId)).toBe(pairKey('B', 'C'))
  })
  it('대기자 1명이면 null', () => {
    expect(recommendNext({ waitingIds: ['A'], meetCount: new Map(), todayGameCount: new Map() })).toBeNull()
  })
})

describe('matchAll', () => {
  it('짝수면 전원 매칭', () => {
    const pairs = matchAll({ waitingIds: ['A', 'B', 'C', 'D'], meetCount: new Map(), todayGameCount: new Map(), rng: () => 0.5 })
    expect(pairs).toHaveLength(2)
  })
  it('홀수면 1명 제외', () => {
    const pairs = matchAll({ waitingIds: ['A', 'B', 'C'], meetCount: new Map(), todayGameCount: new Map(), rng: () => 0.5 })
    expect(pairs).toHaveLength(1)
  })
})

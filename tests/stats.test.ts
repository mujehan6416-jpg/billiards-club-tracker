import { describe, it, expect } from 'vitest'
import { memberStats, headToHead, memberTimeline, winStreaks } from '../src/logic/stats'
import type { Game, Session } from '../src/types'

function g(a: string, b: string, sA: number, hA: number, sB: number, hB: number): Game {
  return {
    id: a + b + sA,
    playerAId: a,
    playerBId: b,
    handicapA: hA,
    handicapB: hB,
    scoreA: sA,
    scoreB: sB,
    endType: 'time',
    playedAt: '2026-06-14T10:00:00Z',
  }
}

const sessions: Session[] = [
  {
    id: 's1',
    date: '2026-06-14',
    attendeeIds: ['A', 'B'],
    games: [
      g('A', 'B', 20, 25, 15, 20), // A 80% vs B 75% → A 승
      g('A', 'B', 10, 25, 18, 20), // A 40% vs B 90% → B 승
    ],
  },
]

describe('memberStats', () => {
  it('승/패/승률/평균달성률', () => {
    const s = memberStats(sessions).find((m) => m.memberId === 'A')!
    expect(s.games).toBe(2)
    expect(s.wins).toBe(1)
    expect(s.losses).toBe(1)
    expect(s.winRate).toBeCloseTo(0.5)
    expect(s.avgRate).toBeCloseTo((0.8 + 0.4) / 2)
  })
})

describe('headToHead', () => {
  it('A vs B 누적', () => {
    const h = headToHead(sessions, 'A', 'B')
    expect(h.aWins).toBe(1)
    expect(h.bWins).toBe(1)
    expect(h.draws).toBe(0)
    expect(h.games).toBe(2)
  })
})

describe('memberTimeline', () => {
  it('시간순 결과 + 달성률', () => {
    const t = memberTimeline(
      [
        {
          id: 's1',
          date: '2026-06-14',
          attendeeIds: ['A', 'B'],
          games: [
            { ...g('A', 'B', 20, 25, 15, 20), playedAt: '2026-06-14T10:00:00Z' },
            { ...g('A', 'B', 10, 25, 18, 20), playedAt: '2026-06-14T11:00:00Z' },
          ],
        },
      ],
      'A',
    )
    expect(t).toHaveLength(2)
    expect(t[0].result).toBe('W')
    expect(t[0].rate).toBeCloseTo(0.8)
    expect(t[1].result).toBe('L')
    expect(t[0].opponentId).toBe('B')
  })
})

describe('winStreaks', () => {
  it('현재/최장 연승', () => {
    const t = memberTimeline(sessions, 'A')
    const s = winStreaks(t)
    expect(s.max).toBe(1)
    expect(s.current).toBe(0)
  })
})

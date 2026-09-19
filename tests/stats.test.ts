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

  it('상대 선수의 득점·적용 핸디도 함께 담는다 (검색한 회원이 A 선수일 때)', () => {
    const t = memberTimeline(sessions, 'A')
    expect(t[0].score).toBe(20)
    expect(t[0].handicap).toBe(25)
    expect(t[0].opponentScore).toBe(15)
    expect(t[0].opponentHandicap).toBe(20)
  })

  it('검색한 회원이 B 선수인 경기도 본인 점수/상대 점수가 뒤바뀌지 않는다', () => {
    const t = memberTimeline(sessions, 'B')
    // 같은 경기를 B 기준으로 보면 본인은 15/20, 상대(A)는 20/25 이고 결과는 패(L)다.
    expect(t[0].score).toBe(15)
    expect(t[0].handicap).toBe(20)
    expect(t[0].opponentId).toBe('A')
    expect(t[0].opponentScore).toBe(20)
    expect(t[0].opponentHandicap).toBe(25)
    expect(t[0].result).toBe('L')
    expect(t[1].result).toBe('W')
  })

  it('달성률이 같으면 무승부(D)로 담는다', () => {
    const t = memberTimeline(
      [
        {
          id: 'sd',
          date: '2026-06-15',
          attendeeIds: ['A', 'B'],
          games: [g('A', 'B', 20, 20, 15, 15)], // 둘 다 100% → 무승부
        },
      ],
      'A',
    )
    expect(t[0].result).toBe('D')
    expect(t[0].opponentScore).toBe(15)
    expect(t[0].opponentHandicap).toBe(15)
  })

  it('핸디가 0인 과거 기록도 오류 없이 담는다', () => {
    const t = memberTimeline(
      [
        {
          id: 'sz',
          date: '2026-06-16',
          attendeeIds: ['A', 'B'],
          games: [g('A', 'B', 20, 0, 15, 0)],
        },
      ],
      'A',
    )
    expect(t).toHaveLength(1)
    expect(t[0].handicap).toBe(0)
    expect(t[0].opponentHandicap).toBe(0)
    expect(Number.isFinite(t[0].rate)).toBe(true)
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

describe('토너먼트 실제 경기(source:"tournament" 세션)도 일반 경기와 동일하게 통계에 반영된다', () => {
  const tournamentSessions: Session[] = [
    {
      id: 'tournament-session-t1',
      date: '2026-07-01',
      source: 'tournament',
      attendeeIds: [],
      games: [g('A', 'C', 20, 20, 10, 20)], // A 100% vs C 50% → A 승
    },
  ]

  it('경기수·승패가 일반 경기와 똑같이 집계된다(source가 있어도 제외되지 않는다)', () => {
    const stats = memberStats(tournamentSessions)
    const a = stats.find((s) => s.memberId === 'A')!
    const c = stats.find((s) => s.memberId === 'C')!
    expect(a.games).toBe(1)
    expect(a.wins).toBe(1)
    expect(c.games).toBe(1)
    expect(c.losses).toBe(1)
  })

  it('상대전적에도 정상 반영된다', () => {
    const h2h = headToHead(tournamentSessions, 'A', 'C')
    expect(h2h.aWins).toBe(1)
    expect(h2h.games).toBe(1)
  })
})

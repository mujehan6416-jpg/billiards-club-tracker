import type { Session } from '../types'
import { rate, winnerId } from './game'

export interface MemberStat {
  memberId: string
  games: number
  wins: number
  losses: number
  draws: number
  winRate: number
  avgRate: number
}

/** 승패 집계에 포함할 세션 필터 (번개모임은 승인된 것만). */
export function approvedSessions(sessions: Session[]): Session[] {
  return sessions.filter((s) => !s.type || s.type === 'regular' || s.approved)
}

/** 회원별 누적 전적 + 평균 달성률. */
export function memberStats(sessions: Session[]): MemberStat[] {
  const acc = new Map<string, { g: number; w: number; l: number; d: number; rateSum: number; rateGames: number }>()
  const bump = (id: string) => {
    let a = acc.get(id)
    if (!a) {
      a = { g: 0, w: 0, l: 0, d: 0, rateSum: 0, rateGames: 0 }
      acc.set(id, a)
    }
    return a
  }

  for (const s of approvedSessions(sessions)) {
    for (const game of s.games) {
      const win = winnerId(game)
      const sides = [
        [game.playerAId, game.scoreA, game.handicapA],
        [game.playerBId, game.scoreB, game.handicapB],
      ] as const
      for (const [id, score, hcap] of sides) {
        const a = bump(id)
        a.g++
        if (hcap > 0) {
          a.rateSum += rate(score, hcap)
          a.rateGames++
        }
        if (win === null) a.d++
        else if (win === id) a.w++
        else a.l++
      }
    }
  }

  return [...acc.entries()].map(([memberId, a]) => ({
    memberId,
    games: a.g,
    wins: a.w,
    losses: a.l,
    draws: a.d,
    winRate: a.g ? a.w / a.g : 0,
    avgRate: a.rateGames ? a.rateSum / a.rateGames : 0,
  }))
}

export interface H2H {
  aWins: number
  bWins: number
  draws: number
  games: number
}

/** 두 회원의 상대전적(aId 기준). */
export function headToHead(sessions: Session[], aId: string, bId: string): H2H {
  const r: H2H = { aWins: 0, bWins: 0, draws: 0, games: 0 }
  for (const s of approvedSessions(sessions)) {
    for (const game of s.games) {
      const ids = [game.playerAId, game.playerBId]
      if (!ids.includes(aId) || !ids.includes(bId)) continue
      r.games++
      const win = winnerId(game)
      if (win === null) r.draws++
      else if (win === aId) r.aWins++
      else r.bWins++
    }
  }
  return r
}

export type GameResult = 'W' | 'L' | 'D'

export interface TimelineEntry {
  gameId: string
  date: string
  playedAt: string
  opponentId: string
  score: number
  handicap: number
  rate: number
  result: GameResult
}

/** 한 회원의 경기를 시간순으로 펼친 추이 목록. */
export function memberTimeline(sessions: Session[], memberId: string): TimelineEntry[] {
  const entries: TimelineEntry[] = []
  for (const s of approvedSessions(sessions)) {
    for (const game of s.games) {
      const isA = game.playerAId === memberId
      const isB = game.playerBId === memberId
      if (!isA && !isB) continue
      const score = isA ? game.scoreA : game.scoreB
      const handicap = isA ? game.handicapA : game.handicapB
      const opponentId = isA ? game.playerBId : game.playerAId
      const win = winnerId(game)
      const result: GameResult = win === null ? 'D' : win === memberId ? 'W' : 'L'
      entries.push({
        gameId: game.id,
        date: s.date,
        playedAt: game.playedAt,
        opponentId,
        score,
        handicap,
        rate: rate(score, handicap),
        result,
      })
    }
  }
  entries.sort((a, b) => (a.playedAt < b.playedAt ? -1 : a.playedAt > b.playedAt ? 1 : 0))
  return entries
}

/** 추이 목록에서 현재(최근 연속)·최장 연승. */
export function winStreaks(entries: TimelineEntry[]): { current: number; max: number } {
  let current = 0
  let max = 0
  for (const e of entries) {
    if (e.result === 'W') {
      current++
      if (current > max) max = current
    } else {
      current = 0
    }
  }
  return { current, max }
}

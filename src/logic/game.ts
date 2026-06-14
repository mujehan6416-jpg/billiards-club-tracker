import type { Game } from '../types'

/** 달성률 = 친 개수 ÷ 핸디(목표). 핸디가 0 이하이면 0. */
export function rate(score: number, handicap: number): number {
  if (handicap <= 0) return 0
  return score / handicap
}

/**
 * 승자 판정. 명시적 winnerId가 있으면 그것을 신뢰(과거 임포트 데이터),
 * 없으면 달성률(rate)이 높은 쪽. 달성률 동일하면 무승부(null).
 */
export function winnerId(game: Game): string | null {
  if (game.winnerId !== undefined) return game.winnerId
  const rA = rate(game.scoreA, game.handicapA)
  const rB = rate(game.scoreB, game.handicapB)
  if (rA > rB) return game.playerAId
  if (rB > rA) return game.playerBId
  return null
}

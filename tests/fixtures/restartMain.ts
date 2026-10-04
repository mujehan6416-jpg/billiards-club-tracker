import { buildEmptyBracket, buildTournamentMatches } from '../../src/logic/tournamentBracket'
import { applyPromotion, promotionFor } from '../../src/logic/tournamentMatch'
import type { TournamentMatch, TournamentSeat } from '../../src/types/tournament'

// 리스타트 테스트 전용 가상 본선 대진. 이름·ID는 전부 가상이다(실제 회원 정보 아님).
// 선수 n = 참가자 id `p{n}` / 회원 id `m{n}` / 자리 번호 n.

export function seat(n: number, slotNumber = n, handicap = 20): TournamentSeat {
  return { participantId: `p${n}`, memberId: `m${n}`, handicap, slotNumber }
}

/** 자리를 모두 채운 대진(부전승 없음). players는 2의 거듭제곱이어야 한다. */
export function fullMain(players = 16): TournamentMatch[] {
  const bracket = buildEmptyBracket(players)
  if (!bracket.ok) throw new Error(bracket.message)
  const built = buildTournamentMatches(bracket.value, Array.from({ length: players }, (_, i) => seat(i + 1)))
  if (!built.ok) throw new Error(built.message)
  return built.value
}

/** 16칸 대진에서 지정한 자리를 비워 부전승이 생기게 한 대진(12명 등). */
export function mainWithByes(emptySlots: number[]): TournamentMatch[] {
  const bracket = buildEmptyBracket(16)
  if (!bracket.ok) throw new Error(bracket.message)
  const seats = Array.from({ length: 16 }, (_, i) => i + 1)
    .filter((slot) => !emptySlots.includes(slot))
    .map((slot) => seat(slot))
  const built = buildTournamentMatches(bracket.value, seats)
  if (!built.ok) throw new Error(built.message)
  return built.value
}

/** 경기를 최종 승인(official)한 것처럼 만들고, 승자를 다음 경기 자리에 올린다. loser는 지는 쪽(A/B). */
export function decide(matches: TournamentMatch[], id: string, loser: 'A' | 'B' = 'B'): TournamentMatch[] {
  const m = matches.find((x) => x.id === id)
  if (!m) throw new Error(`경기가 없습니다: ${id}`)
  const winnerIsA = loser === 'B'
  const done: TournamentMatch = {
    ...m,
    status: 'official',
    scoreA: winnerIsA ? 20 : 5,
    scoreB: winnerIsA ? 5 : 20,
    officialWinnerParticipantId: winnerIsA ? m.playerAParticipantId : m.playerBParticipantId,
    officialLoserParticipantId: winnerIsA ? m.playerBParticipantId : m.playerAParticipantId,
  }
  const promo = promotionFor(done)
  return matches.map((x) => {
    if (x.id === id) return done
    return promo && x.id === promo.nextMatchId ? applyPromotion(x, promo) : x
  })
}

/** 한 라운드의 모든 경기를 최종 승인한다(기본: B 쪽이 진다). */
export function decideRound(matches: TournamentMatch[], roundNumber: number, loser: 'A' | 'B' = 'B'): TournamentMatch[] {
  return matches
    .filter((m) => m.roundNumber === roundNumber && m.playerCountInRound !== 3 && m.resultType !== 'bye')
    .reduce((acc, m) => decide(acc, m.id, loser), matches)
}

/** 확정된 합류자를 리스타트 경기 B 자리에 넣는다(서버의 placeRestartJoiner와 같은 결과). */
export function fillJoiner(matches: TournamentMatch[], restartMatchId: string, n: number, handicap = 20): TournamentMatch[] {
  return matches.map((m) => (m.id === restartMatchId
    ? { ...m, playerBParticipantId: `p${n}`, playerBMemberId: `m${n}`, playerBHandicapSnapshot: handicap }
    : m))
}

/** 같은 입력이면 같은 순서가 나오는 가짜 난수(테스트 재현용). */
export function seededRng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

/**
 * n명 본선(2 ≤ n). 대진 규모는 n 이상인 가장 작은 2의 거듭제곱이고, 부전승은 기존 엔진 규칙대로
 * 한 경기에 하나씩 놓인다(여기서는 재현을 위해 앞 경기들의 B 자리를 비운다).
 */
export function mainOf(n: number): TournamentMatch[] {
  let size = 2
  while (size < n) size *= 2
  const byes = size - n
  const empty = Array.from({ length: byes }, (_, i) => (i + 1) * 2)
  const bracket = buildEmptyBracket(size)
  if (!bracket.ok) throw new Error(bracket.message)
  const seats = Array.from({ length: size }, (_, i) => i + 1).filter((slot) => !empty.includes(slot)).map((slot) => seat(slot))
  const built = buildTournamentMatches(bracket.value, seats)
  if (!built.ok) throw new Error(built.message)
  return built.value
}
